import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { getSignedCookie, setSignedCookie, deleteCookie } from "hono/cookie";
import { bodyLimit } from "hono/body-limit";
import { readFileSync, existsSync, statSync, createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { randomInt } from "node:crypto";
import type { Context } from "hono";
import type Stripe from "stripe";
import type { KeyObject } from "node:crypto";
import type { Account, Entitlement, Repo } from "./db.js";
import { randomToken, sha256, signEntitlement } from "./tokens.js";
import { handleStripeEvent } from "./stripe.js";
import { handleRevenueCatWebhook, RevenueCatPayloadError } from "./revenuecat.js";
import { createCrmRouter } from "./crm.js";
import {
  adminBasicAuth,
  createRateLimiter,
  escapeHtml,
  isSameOriginRequest,
  makeClientIp,
  normalizeEmail,
  safeEqual,
  securityHeaders,
} from "./security.js";

export interface AppDeps {
  repo: Repo;
  signingKey: KeyObject;
  stripe: Stripe | null;
  config: {
    publicUrl: string;
    stripeWebhookSecret: string;
    priceActivation: string;
    priceMonthly: string;
    trialDays: number;
    tokenTtlHours: number;
    maxDevicesPc: number;
    maxDevicesMobile: number;
    pastDueGraceDays: number;
    devEndpoints: boolean;
    /** Used only to derive a session secret when sessionSecret isn't provided. */
    licensePrivateKeyB64?: string;
    /** HMAC secret for the sweepr_session cookie (env SESSION_SECRET). */
    sessionSecret?: string;
    /** HTTP Basic credentials for /crm, /admin and /api/crm/*. CRM returns 503 if the password is empty. */
    crmAdminUser?: string;
    crmAdminPassword?: string;
    /** Expected Authorization header value for /webhooks/revenuecat. Webhook returns 503 if empty. */
    revenueCatWebhookSecret?: string;
    /** Trust cf-connecting-ip / x-forwarded-for (only behind a trusted reverse proxy). */
    trustProxy?: boolean;
    stripeCoupon?: string;
  };
  now?: () => number;
}

const DEVICE_RE = /^[a-f0-9]{64}$/;
const SESSION_COOKIE = "sweepr_session";

/** Server-side source of truth: is this entitlement currently usable? */
export function isEntitled(e: Entitlement | undefined, now: number, graceDays: number): boolean {
  if (!e) return false;
  if (e.status === "active" || e.status === "trialing") return true;
  if (e.status === "past_due" && e.current_period_end) {
    return now < e.current_period_end + graceDays * 86400; // dunning grace period
  }
  return false;
}

export function createApp(deps: AppDeps) {
  const { repo, signingKey, stripe, config } = deps;
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));
  const app = new Hono<{ Variables: { account: Account } }>();
  const HOUR = 60 * 60 * 1000;
  const limitAccounts = createRateLimiter(20, HOUR);
  const limitEntitlement = createRateLimiter(120, HOUR);
  const limitCheckoutIp = createRateLimiter(10, HOUR);
  const limitOtpSendIp = createRateLimiter(10, 15 * 60 * 1000);
  const limitOtpSendEmail = createRateLimiter(5, HOUR);
  const limitOtpVerifyIp = createRateLimiter(20, 15 * 60 * 1000);
  const limitOtpVerifyEmail = createRateLimiter(10, 15 * 60 * 1000);

  const isHttps = config.publicUrl.startsWith("https://");
  const sessionSecret =
    config.sessionSecret ||
    (config.licensePrivateKeyB64 ? sha256(`sweepr-session:${config.licensePrivateKeyB64}`) : randomToken(32));
  const stripeCoupon = config.stripeCoupon ?? "MYskiOdE";
  const trustProxy = config.trustProxy ?? false;
  const clientIp = makeClientIp(trustProxy);

  /** Account id from the signed portal session cookie, or null. */
  const sessionAccountId = async (c: Context): Promise<string | null> => {
    const v = await getSignedCookie(c, sessionSecret, SESSION_COOKIE);
    return typeof v === "string" && v.length > 0 ? v : null;
  };

  const auth = async (c: Context, next: () => Promise<void>) => {
    const h = c.req.header("authorization") ?? "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : "";
    const account = token ? repo.accountByTokenHash(sha256(token)) : undefined;
    if (!account) return c.json({ error: "unauthorized" }, 401);
    c.set("account", account);
    await next();
  };

  app.use("*", securityHeaders({ hsts: isHttps }));
  // Nothing we accept legitimately needs more than this; protects JSON parsing from huge bodies.
  app.use("/api/*", bodyLimit({ maxSize: 256 * 1024, onError: (c) => c.json({ error: "payload_too_large" }, 413) }));
  app.use("/v1/*", bodyLimit({ maxSize: 256 * 1024, onError: (c) => c.json({ error: "payload_too_large" }, 413) }));
  app.use("/webhooks/*", bodyLimit({ maxSize: 1024 * 1024, onError: (c) => c.json({ error: "payload_too_large" }, 413) }));

  app.get("/health", (c) => c.json({ ok: true }));

  // Admin-only surface: CRM API, dashboard HTML (including the static copy under /crm/*) and /admin.
  const adminAuth = adminBasicAuth({
    user: config.crmAdminUser || "admin",
    password: config.crmAdminPassword ?? "",
    clientIp,
    trustProxy,
    allowedOrigins: (() => {
      try {
        return [new URL(config.publicUrl).origin];
      } catch {
        return [];
      }
    })(),
  });
  const ADMIN_PATH_RE = /^\/+(api\/+crm|crm|admin)(\/|$)/;
  const normalisedPath = (c: Context) => {
    let p = c.req.path;
    try {
      p = decodeURIComponent(p);
    } catch {
      /* keep raw */
    }
    return p.replace(/\\/g, "/").toLowerCase();
  };
  app.use("*", async (c, next) => {
    if (ADMIN_PATH_RE.test(normalisedPath(c))) return adminAuth(c, next);
    await next();
  });

  // Mount CRM Subscriptions & Customers Router
  const crmRouter = createCrmRouter({
    repo,
    signingKey,
    stripe,
    config: {
      publicUrl: config.publicUrl,
      pastDueGraceDays: config.pastDueGraceDays,
      tokenTtlHours: config.tokenTtlHours,
      trialDays: config.trialDays,
      maxDevicesPc: config.maxDevicesPc,
      maxDevicesMobile: config.maxDevicesMobile,
      devEndpoints: config.devEndpoints,
      sessionSecret,
    },
    now,
  });
  app.route("/api/crm", crmRouter);

  // CRM Web Dashboard
  app.get("/crm", (c) => {
    const file = "./public/crm/index.html";
    return existsSync(file) ? c.html(readFileSync(file, "utf-8")) : c.notFound();
  });
  app.get("/admin", (c) => c.redirect("/crm"));

  // Explicit HTML page routes for clean URLs
  app.get("/order", (c) => {
    const file = "./public/order.html";
    return existsSync(file) ? c.html(readFileSync(file, "utf-8")) : c.notFound();
  });
  app.get("/checkout", (c) => {
    const file = "./public/order.html";
    return existsSync(file) ? c.html(readFileSync(file, "utf-8")) : c.notFound();
  });
  app.get("/pricing", (c) => {
    const file = "./public/pricing.html";
    return existsSync(file) ? c.html(readFileSync(file, "utf-8")) : c.notFound();
  });
  app.get("/login", (c) => {
    const file = "./public/login.html";
    return existsSync(file) ? c.html(readFileSync(file, "utf-8")) : c.notFound();
  });
  app.get("/terms", (c) => {
    const file = "./public/terms.html";
    return existsSync(file) ? c.html(readFileSync(file, "utf-8")) : c.notFound();
  });
  app.get("/privacy", (c) => {
    const file = "./public/privacy.html";
    return existsSync(file) ? c.html(readFileSync(file, "utf-8")) : c.notFound();
  });
  app.get("/support", (c) => {
    const file = "./public/support.html";
    return existsSync(file) ? c.html(readFileSync(file, "utf-8")) : c.notFound();
  });
  // NOTE: `msg` is trusted, server-authored HTML (pickerPage injects links). Never pass user input as `msg`.
  const page = (rawTitle: string, msg: string, downloadLink = false) => {
    const title = escapeHtml(rawTitle);
    return `<!doctype html><head><meta charset="utf-8"><title>${title}</title><link rel="icon" type="image/svg+xml" href="/favicon.svg"><link rel="alternate icon" type="image/png" href="/favicon.png"><link rel="shortcut icon" href="/favicon.ico"></head><body style="font-family:system-ui, sans-serif;background:#ffffff;background-image:radial-gradient(circle at 10% 20%, rgba(220, 255, 230, 0.4) 0%, rgba(255, 255, 255, 1) 40%),radial-gradient(circle at 90% 80%, rgba(240, 255, 250, 0.5) 0%, rgba(255, 255, 255, 1) 40%);color:#1f2937;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center;padding:40px;background:rgba(255,255,255,0.7);backdrop-filter:blur(24px);border:1px solid rgba(0,0,0,0.05);border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,0.05);max-width:400px;"><h1 style="margin-top:0">${title}</h1><p style="color:#6b7280;line-height:1.5">${msg}</p>${downloadLink ? '<a href="/download" style="display:inline-block;margin-top:20px;background:#10b981;color:#fff;padding:12px 24px;border-radius:12px;text-decoration:none;font-weight:bold;box-shadow:0 4px 12px rgba(16,185,129,0.25);">Download Sweepr</a>' : ''}</div></body>`;
  };

  // ---------- Smart download: one button, the right app for every device ----------
  type Platform = "android" | "ios" | "windows" | "mac" | "linux";

  const DESKTOP_FILES: Record<"windows" | "mac" | "linux", { file: string; type: string; label: string }> = {
    windows: { file: "Sweepr_Setup.exe", type: "application/vnd.microsoft.portable-executable", label: "Windows" },
    mac: { file: "Sweepr_Setup.dmg", type: "application/x-apple-diskimage", label: "Mac" },
    linux: { file: "Sweepr_Setup.AppImage", type: "application/x-executable", label: "Linux" },
  };

  /** Order matters: Android and ChromeOS user agents also contain "Linux". */
  const detectPlatform = (ua: string): Platform | null => {
    if (/android/.test(ua)) return "android";
    if (/iphone|ipad|ipod/.test(ua)) return "ios";
    if (/cros/.test(ua)) return "android"; // Chromebooks run Android apps from Google Play
    if (/windows/.test(ua)) return "windows";
    if (/macintosh|mac os x/.test(ua)) return "mac";
    if (/linux|x11/.test(ua)) return "linux";
    return null;
  };

  const pickerPage = (heading: string, msg: string) => {
    const btn = (href: string, text: string) =>
      `<a href="${href}" style="display:block;margin-top:10px;background:#10b981;color:#fff;padding:12px 24px;border-radius:12px;text-decoration:none;font-weight:bold">${text}</a>`;
    const links =
      btn("/download?platform=windows", "Windows") +
      btn("/download?platform=mac", "Mac") +
      btn("/download?platform=linux", "Linux") +
      btn("/download?platform=android", "Android") +
      btn("/download?platform=ios", "iPhone &amp; iPad");
    return page(heading, `${msg}</p>${links}<p style="display:none">`);
  };

  /** Streams a file from disk (no full in-memory buffering) with an explicit Content-Length. */
  const streamFile = (path: string, type: string, filename: string) => {
    const { size } = statSync(path);
    const body = Readable.toWeb(createReadStream(path)) as unknown as ReadableStream<Uint8Array>;
    return new Response(body, {
      headers: {
        "Content-Type": type,
        "Content-Length": String(size),
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  };

  app.get("/download", (c) => {
    const ua = c.req.header("user-agent")?.toLowerCase() || "";
    // ?platform=mac etc. lets people download for a different device (e.g. "Other platforms" links).
    const requested = c.req.query("platform")?.toLowerCase() as Platform | undefined;
    const platform = requested && ["android", "ios", "windows", "mac", "linux"].includes(requested)
      ? requested
      : detectPlatform(ua);

    if (!platform) {
      return c.html(pickerPage("Download Sweepr", "Choose your device:"));
    }

    // Mobile: send to the store listing once it's live; until then, serve the APK directly on Android.
    if (platform === "android") {
      const playUrl = process.env.PLAY_STORE_URL;
      if (playUrl) return c.redirect(playUrl);
      const apk = "./public/Sweepr.apk";
      if (existsSync(apk)) {
        return streamFile(apk, "application/vnd.android.package-archive", "Sweepr.apk");
      }
      return c.html(pickerPage("Android App Coming Soon", "Sweepr for Android will be on Google Play very soon. In the meantime you can get the desktop version:"));
    }
    if (platform === "ios") {
      const appStoreUrl = process.env.APP_STORE_URL;
      if (appStoreUrl) return c.redirect(appStoreUrl);
      return c.html(pickerPage("iPhone App Coming Soon", "Sweepr for iPhone and iPad is on the way. In the meantime you can get the desktop version:"));
    }

    const { file, type, label } = DESKTOP_FILES[platform];
    const installerPath = `./public/${file}`;
    if (!existsSync(installerPath)) {
      return c.html(pickerPage(`${label} Version Coming Soon`, `Sweepr for ${label} will be available soon. Other versions:`));
    }

    return streamFile(installerPath, type, file);
  });

  // Serve the website frontend. The CRM HTML under public/crm is only served via the authenticated /crm route.
  app.use("/*", async (c, next) => {
    if (/^\/+crm(\/|$)/.test(normalisedPath(c))) return c.notFound();
    await next();
  });
  app.use("/*", serveStatic({ root: "./public" }));

  app.post("/api/web-checkout", async (c) => {
    if (!limitCheckoutIp.hit(clientIp(c))) return c.json({ error: "rate_limited" }, 429);
    if (!stripe) return c.json({ error: "stripe_not_configured" }, 503);
    const body = await c.req.json().catch(() => ({}));
    if (!body.email) return c.json({ error: "email_required" }, 400);
    const email = normalizeEmail(body.email);
    if (!email) return c.json({ error: "invalid_email" }, 400);

    // Reuse an existing account for this email if present (avoids orphaned duplicate rows).
    const existing = repo.accountByEmail(email);
    if (existing && isEntitled(repo.entitlement(existing.id), now(), config.pastDueGraceDays)) {
      return c.json({ error: "already_active" }, 409);
    }
    let accountId: string;
    if (existing) {
      accountId = existing.id;
    } else {
      accountId = `acc_web_${randomToken(8)}`;
      const refreshToken = randomToken(32);
      repo.createAccount(accountId, sha256(refreshToken), email);
    }

    // managed_payments isn't in the Stripe SDK's typings yet, hence the cast.
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      client_reference_id: accountId,
      ...(existing?.stripe_customer_id ? { customer: existing.stripe_customer_id } : { customer_email: email }),
      line_items: [
        { price: config.priceMonthly, quantity: 1 },
      ],
      discounts: [{ coupon: stripeCoupon }],
      subscription_data: {
        metadata: { account_id: accountId },
      },
      managed_payments: { enabled: false },

      success_url: `${config.publicUrl}/checkout/success?web=1`,
      cancel_url: `${config.publicUrl}/order`,
    } as unknown as Stripe.Checkout.SessionCreateParams);
    return c.json({ url: session.url });
  });

  // Same response whether or not the account exists, so this can't be used to enumerate customers.
  app.post("/api/portal-login", async (c) => {
    if (!limitOtpSendIp.hit(clientIp(c))) return c.json({ error: "Too many requests. Please try again later." }, 429);
    const body = await c.req.json().catch(() => ({}));
    if (!body.email) return c.json({ error: "email_required" }, 400);
    const email = normalizeEmail(body.email);
    if (!email) return c.json({ error: "Please enter a valid email address." }, 400);
    if (!limitOtpSendEmail.hit(email)) return c.json({ error: "Too many requests. Please try again later." }, 429);

    const account = repo.accountByEmail(email);
    if (account) {
      const code = randomInt(100000, 1000000).toString();
      const expiresAt = Math.floor(Date.now() / 1000) + 15 * 60; // 15 mins
      repo.setOtp(email, sha256(code), expiresAt);

      const { sendSubscriptionEmail } = await import("./email.js");
      const dispatch = await sendSubscriptionEmail(email, "otp", code);
      const statusText = dispatch.ok
        ? `Sent via ${dispatch.provider}${dispatch.id ? ` (id: ${dispatch.id})` : ""}`
        : `Failed (${dispatch.provider}): ${dispatch.error || "Unknown error"}`;

      repo.addActivity({
        account_id: account.id,
        type: "otp_requested",
        title: "Customer Requested Login Code",
        description: `6-digit code (${code}) requested via /login — ${statusText}`,
        actor: "customer",
        metadata: { code, email, dispatch },
      });
    }

    return c.json({ otpSent: true });
  });

  app.post("/api/verify-otp", async (c) => {
    if (!limitOtpVerifyIp.hit(clientIp(c))) return c.json({ error: "Too many attempts. Please try again later." }, 429);
    const body = await c.req.json().catch(() => ({}));
    if (!body.email || !body.code) return c.json({ error: "missing_fields" }, 400);
    const email = normalizeEmail(body.email);
    const code = String(body.code).trim();
    const invalid = () => c.json({ error: "Invalid or expired code." }, 400);
    if (!email) return invalid();
    if (!limitOtpVerifyEmail.hit(email)) return c.json({ error: "Too many attempts. Please try again later." }, 429);
    if (!/^\d{6}$/.test(code)) return invalid();

    const valid = repo.verifyOtp(email, sha256(code), Math.floor(Date.now() / 1000));
    if (!valid) return invalid();

    const account = repo.accountByEmail(email);
    if (!account) return invalid();

    limitOtpVerifyEmail.reset(email);
    limitOtpSendEmail.reset(email);
    repo.addActivity({
      account_id: account.id,
      type: "portal_login",
      title: "Customer Logged Into Portal",
      description: `Verified 6-digit OTP code and signed in to customer dashboard`,
      actor: "customer",
    });
    await setSignedCookie(c, SESSION_COOKIE, account.id, sessionSecret, {
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      secure: isHttps,
      maxAge: 86400 * 30,
    });

    return c.json({ ok: true, redirect: "/dashboard" });
  });

  app.post("/api/logout", (c) => {
    if (!isSameOriginRequest(c, config.publicUrl, trustProxy)) {
      return c.json({ error: "forbidden_origin" }, 403);
    }
    deleteCookie(c, SESSION_COOKIE, { path: "/", secure: isHttps, httpOnly: true, sameSite: "Lax" });
    return c.json({ ok: true });
  });

  app.get("/dashboard", (c) => {
    const file = "./public/dashboard.html";
    return existsSync(file) ? c.html(readFileSync(file, "utf-8")) : c.notFound();
  });

  app.get("/api/dashboard-data", async (c) => {
    const accountId = await sessionAccountId(c);
    if (!accountId) return c.json({ error: "unauthorized" }, 401);

    const account = repo.accountById(accountId);
    if (!account) return c.json({ error: "account_not_found" }, 404);

    const ent = repo.entitlement(accountId);
    const devices = repo.db.prepare("SELECT * FROM devices WHERE account_id = ? AND revoked = 0").all(accountId);

    return c.json({
      email: account.email,
      name: account.name,
      plan: ent?.plan || "None",
      status: ent?.status || "none",
      has_stripe: !!account.stripe_customer_id,
      devices
    });
  });

  const createBillingPortalSession = async (c: Context) => {
    if (!isSameOriginRequest(c, config.publicUrl, trustProxy)) {
      return c.json({ error: "forbidden_origin" }, 403);
    }
    if (!stripe) return c.json({ error: "stripe_not_configured" }, 503);
    const accountId = await sessionAccountId(c);
    if (!accountId) return c.json({ error: "unauthorized" }, 401);

    const account = repo.accountById(accountId);
    if (!account || !account.stripe_customer_id) {
      return c.json({ error: "no_stripe_customer" }, 404);
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: account.stripe_customer_id,
      return_url: `${config.publicUrl}/dashboard`,
    });
    if (c.req.method === "POST") {
      return c.json({ url: session.url });
    }
    return c.redirect(session.url);
  };

  app.get("/api/billing-portal", createBillingPortalSession);
  app.post("/api/billing-portal", createBillingPortalSession);

  // Anonymous, device-bound account.
  app.post("/v1/accounts", async (c) => {
    if (!limitAccounts.hit(clientIp(c))) return c.json({ error: "rate_limited" }, 429);
    const body = await c.req.json().catch(() => ({}));
    const deviceId = String(body.device_id ?? "");
    const deviceType = body.device_type === "mobile" ? "mobile" : "pc";
    if (!DEVICE_RE.test(deviceId)) return c.json({ error: "invalid device_id" }, 400);
    const accountId = `acc_${randomToken(12)}`;
    const refreshToken = randomToken(32);
    repo.createAccount(accountId, sha256(refreshToken));
    repo.touchDevice(accountId, deviceId, deviceType, config.maxDevicesPc, config.maxDevicesMobile);
    return c.json({ account_id: accountId, refresh_token: refreshToken });
  });

  // Step 1 of linking an existing web/email purchase to a desktop/mobile device via OTP.
  app.post("/v1/account/send-otp", async (c) => {
    if (!limitOtpSendIp.hit(clientIp(c))) return c.json({ error: "rate_limited" }, 429);
    const body = await c.req.json().catch(() => ({}));
    const email = normalizeEmail(body.email);
    if (!email) return c.json({ error: "invalid_email" }, 400);
    if (!limitOtpSendEmail.hit(email)) return c.json({ error: "rate_limited" }, 429);

    const account = repo.accountByEmail(email);
    if (account) {
      const code = randomInt(100000, 1000000).toString();
      const expiresAt = now() + 15 * 60;
      repo.setOtp(email, sha256(code), expiresAt);
      const { sendSubscriptionEmail } = await import("./email.js");
      const dispatch = await sendSubscriptionEmail(email, "otp", code);
      const statusText = dispatch.ok
        ? `Sent via ${dispatch.provider}${dispatch.id ? ` (id: ${dispatch.id})` : ""}`
        : `Failed (${dispatch.provider}): ${dispatch.error || "Unknown error"}`;

      repo.addActivity({
        account_id: account.id,
        type: "otp_requested",
        title: "Device Link Login Code Requested",
        description: `6-digit code (${code}) requested via app — ${statusText}`,
        actor: "customer",
        metadata: { code, email, dispatch },
      });
    }
    return c.json({ otpSent: true });
  });

  // Step 2 of linking an existing web/email purchase to a device: verifies OTP and issues a device-scoped refresh token.
  app.post("/v1/account/verify-otp", async (c) => {
    if (!limitOtpVerifyIp.hit(clientIp(c))) return c.json({ error: "rate_limited" }, 429);
    const body = await c.req.json().catch(() => ({}));
    const email = normalizeEmail(body.email);
    const code = String(body.code ?? "").trim();
    const deviceId = String(body.device_id ?? "");
    const deviceType = body.device_type === "mobile" ? "mobile" : "pc";
    if (!email || !/^\d{6}$/.test(code) || !DEVICE_RE.test(deviceId)) {
      return c.json({ error: "invalid_request" }, 400);
    }
    if (!limitOtpVerifyEmail.hit(email)) return c.json({ error: "rate_limited" }, 429);

    if (!repo.verifyOtp(email, sha256(code), now())) {
      return c.json({ error: "invalid_or_expired_code" }, 400);
    }
    const account = repo.accountByEmail(email);
    if (!account) {
      return c.json({ error: "invalid_or_expired_code" }, 400);
    }
    if (!repo.touchDevice(account.id, deviceId, deviceType, config.maxDevicesPc, config.maxDevicesMobile)) {
      return c.json({ error: "device_limit", status: "device_limit" }, 403);
    }

    limitOtpVerifyEmail.reset(email);
    limitOtpSendEmail.reset(email);
    const refreshToken = randomToken(32);
    repo.setDeviceTokenHash(account.id, deviceId, sha256(refreshToken));
    const ent = repo.entitlement(account.id);
    const active = isEntitled(ent, now(), config.pastDueGraceDays);
    return c.json({
      account_id: account.id,
      email: account.email ?? email,
      refresh_token: refreshToken,
      active,
      status: ent?.status ?? "none",
      plan: ent?.plan ?? null,
      expires_at: ent?.current_period_end ?? null,
    });
  });

  // Apple App Store (Guideline 5.1.1(v)) & Google Play Account Deletion compliance endpoint.
  app.delete("/v1/account", auth, async (c) => {
    const account = c.get("account");
    if (stripe && account.stripe_customer_id) {
      const ent = repo.entitlement(account.id);
      if (ent?.stripe_subscription_id && (ent.status === "active" || ent.status === "trialing" || ent.status === "past_due")) {
        await stripe.subscriptions.cancel(ent.stripe_subscription_id).catch(() => {});
      }
    }
    repo.deleteAccount(account.id);
    return c.json({ ok: true, deleted: true });
  });

  // The ONLY place an entitlement decision is made.
  app.post("/v1/entitlement", auth, async (c) => {
    const account = c.get("account");
    if (!limitEntitlement.hit(account.id)) return c.json({ error: "rate_limited" }, 429);
    const body = await c.req.json().catch(() => ({}));
    const deviceId = String(body.device_id ?? "");
    const deviceType = body.device_type === "mobile" ? "mobile" : "pc";
    if (!DEVICE_RE.test(deviceId)) return c.json({ error: "invalid device_id" }, 400);
    if (!repo.touchDevice(account.id, deviceId, deviceType, config.maxDevicesPc, config.maxDevicesMobile)) {
      return c.json({ error: "device_limit", status: "device_limit" }, 403);
    }

    const ent = repo.entitlement(account.id);
    const t = now();
    if (!isEntitled(ent, t, config.pastDueGraceDays)) {
      return c.json({ status: ent?.status ?? "none", token: null, email: account.email ?? null });
    }

    // Token never outlives the paid period (+ grace), and is capped at the TTL.
    let exp = t + config.tokenTtlHours * 3600;
    if (ent!.current_period_end) {
      exp = Math.min(exp, ent!.current_period_end + config.pastDueGraceDays * 86400);
    }
    exp = Math.max(exp, t + 300);

    const token = signEntitlement(signingKey, {
      sub: account.id,
      device_id: deviceId,
      status: ent!.status === "trialing" ? "trialing" : "active",
      plan: ent!.plan ?? "monthly",
      iat: t,
      exp,
    });
    return c.json({ status: ent!.status, token, expires_at: exp, email: account.email ?? null });
  });

  app.post("/v1/checkout", auth, async (c) => {
    if (!stripe) return c.json({ error: "stripe_not_configured" }, 503);
    const account = c.get("account");
    if (isEntitled(repo.entitlement(account.id), now(), config.pastDueGraceDays)) {
      return c.json({ error: "already_active" }, 409);
    }
    const body = await c.req.json().catch(() => ({}));
    const email = normalizeEmail(body?.email) ?? account.email ?? undefined;
    if (email && !account.email) {
      repo.updateAccountProfile(account.id, { email });
    }
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      client_reference_id: account.id,
      ...(account.stripe_customer_id
        ? { customer: account.stripe_customer_id }
        : email
        ? { customer_email: email }
        : {}),
      line_items: [
        { price: config.priceMonthly, quantity: 1 },    // 9.99/month renewal
      ],
      discounts: [{ coupon: stripeCoupon }],
      subscription_data: {
        metadata: { account_id: account.id },
      },

      automatic_tax: { enabled: true },
      // Disable managed payments to avoid the tax_code error on test prices
      // (not in the Stripe SDK's typings yet, hence the cast below).
      managed_payments: { enabled: false },
      allow_promotion_codes: true,
      success_url: `${config.publicUrl}/checkout/success`,
      cancel_url: `${config.publicUrl}/checkout/cancel`,
    } as unknown as Stripe.Checkout.SessionCreateParams);
    return c.json({ url: session.url });
  });

  app.post("/v1/portal", auth, async (c) => {
    if (!stripe) return c.json({ error: "stripe_not_configured" }, 503);
    const account = c.get("account");
    if (!account.stripe_customer_id) return c.json({ error: "no_customer" }, 404);
    const session = await stripe.billingPortal.sessions.create({
      customer: account.stripe_customer_id,
      return_url: `${config.publicUrl}/checkout/portal-return`,
    });
    return c.json({ url: session.url });
  });

  app.post("/webhooks/stripe", async (c) => {
    if (!stripe) return c.json({ error: "stripe_not_configured" }, 503);
    const sig = c.req.header("stripe-signature") ?? "";
    const raw = await c.req.text(); // raw body is required for signature verification
    let event: Stripe.Event;
    try {
      event = await stripe.webhooks.constructEventAsync(raw, sig, config.stripeWebhookSecret);
    } catch {
      return c.json({ error: "invalid signature" }, 400);
    }
    if (!repo.markEventProcessed(event.id)) return c.json({ received: true, duplicate: true });
    try {
      await handleStripeEvent(stripe, repo, event);
    } catch (e) {
      repo.unmarkEvent(event.id); // let Stripe retry
      console.error(`[stripe] failed handling ${event.type} ${event.id}`, e);
      return c.json({ error: "handler_failed" }, 500);
    }
    return c.json({ received: true });
  });

  app.post("/webhooks/revenuecat", async (c) => {
    // Verify standard RevenueCat Authorization header. RC sends exactly the value configured in its dashboard,
    // so accept either "Bearer <secret>" or the raw secret.
    const secret = config.revenueCatWebhookSecret ?? "";
    if (!secret) return c.json({ error: "revenuecat_not_configured" }, 503);
    const authHeader = c.req.header("authorization") ?? "";
    const presented = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
    // Evaluate both (no short-circuit) to keep timing uniform.
    const okBearer = safeEqual(presented, secret);
    const okRaw = safeEqual(authHeader, secret);
    if (!authHeader || !(okBearer || okRaw)) return c.json({ error: "unauthorized" }, 401);

    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") return c.json({ error: "invalid body" }, 400);
    const eventId = (body as any).event?.id;
    if (typeof eventId !== "string" || eventId.length === 0 || eventId.length > 200) {
      return c.json({ error: "invalid event id" }, 400);
    }

    const key = `rc_${eventId}`;
    if (!repo.markEventProcessed(key)) return c.json({ received: true, duplicate: true });
    try {
      await handleRevenueCatWebhook(repo, body);
    } catch (e) {
      repo.unmarkEvent(key); // let RevenueCat retry
      if (e instanceof RevenueCatPayloadError) return c.json({ error: e.message }, 400);
      console.error("[revenuecat] failed handling webhook", e);
      return c.json({ error: "handler_failed" }, 500);
    }
    return c.json({ received: true });
  });

  // Simple pages the browser lands on after checkout.
  
  app.get("/checkout/success", (c) => {
    const isWeb = c.req.query("web") === "1";
    if (isWeb) {
      return c.html(page("You're Activated 🎉", "Thanks for purchasing Sweepr! Download the app below. When you launch it, enter your email on the Account tab to link your purchase.", true));
    }
    return c.html(page("You're Activated 🎉", "Return to Sweepr. It will unlock automatically within a few seconds."));
  });
  app.get("/checkout/cancel", (c) => c.html(page("Checkout Cancelled", "No charge was made. You can safely close this tab.")));
  app.get("/checkout/portal-return", (c) => c.html(page("All Set", "You can close this tab and return to Sweepr.")));

  if (config.devEndpoints && process.env.NODE_ENV !== "production") {
    console.warn("[dev] DEV_ENDPOINTS enabled: /dev/grant is active (loopback only). Never enable in production.");
    app.post("/dev/grant", async (c) => {
      const ip = clientIp(c);
      if (!["local", "127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(ip)) {
        return c.json({ error: "forbidden_non_local" }, 403);
      }
      const { account_id, status = "trialing", days = 7 } = await c.req.json();
      if (typeof account_id !== "string" || !repo.accountById(account_id)) {
        return c.json({ error: "no such account" }, 404);
      }
      const clampedDays = Math.max(1, Math.min(Number(days) || 7, 3650));
      repo.upsertEntitlement({
        account_id, stripe_subscription_id: null, status, plan: "monthly",
        current_period_end: now() + clampedDays * 86400, cancel_at_period_end: 0,
      });
      return c.json({ ok: true });
    });
  }

  return app;
}
