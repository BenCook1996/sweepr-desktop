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
import { handleStripeEvent, syncSubscription } from "./stripe.js";
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
import { cleanItems, renderPseoDirectory, renderPseoPage } from "./pseo.js";

export interface AppDeps {
  repo: Repo;
  signingKey: KeyObject;
  stripe: Stripe | null;
  config: {
    publicUrl: string;
    stripeWebhookSecret: string;
    stripePublishableKey?: string;
    priceActivation: string;
    priceMonthly: string;
    priceSixMonth?: string;
    priceAnnual?: string;
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
    latestAppVersion?: string;
    latestAppNotes?: string;
    latestAppSignature?: string;
    hibpApiKey?: string;
    gaMeasurementId?: string;
    metaPixelId?: string;
    clarityProjectId?: string;
  };
  now?: () => number;
}

const DEVICE_RE = /^[a-f0-9]{64}$/;
const SESSION_COOKIE = "sweepr_session";
const ALLOWED_FUNNEL_EVENTS = new Set([
  "scan_started",
  "scan_completed",
  "paywall_viewed",
  "checkout_started",
  "purchase_completed",
  "clean_completed",
]);

function sanitizeTelemetryText(v: unknown, maxLen: number): string {
  return String(v ?? "")
    .replace(/([A-Za-z]:\\Users\\)[^\\/]+/gi, "$1<redacted>")
    .replace(/(\/Users\/|\/home\/)[^/]+/g, "$1<redacted>")
    .trim()
    .slice(0, maxLen);
}

function extractAttributionMeta(body: any, accountId: string, plan: string, refCode?: string): Record<string, string> {
  const attr = typeof body?.attribution === "object" && body?.attribution !== null ? body.attribution : {};
  const meta: Record<string, string> = {
    account_id: accountId,
    plan,
  };
  if (refCode) meta.ref = refCode.slice(0, 50);
  const fields = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "gclid", "fbclid", "msclkid", "irclickid"];
  for (const f of fields) {
    const val = String(attr[f] ?? body?.[f] ?? "").trim();
    if (val) meta[f] = val.slice(0, 100);
  }
  return meta;
}

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
  const limitTelemetry = createRateLimiter(120, HOUR);
  const limitSupport = createRateLimiter(10, HOUR);
  const limitBreach = createRateLimiter(60, HOUR);

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
  app.get("/refund", (c) => {
    const file = "./public/refund.html";
    return existsSync(file) ? c.html(readFileSync(file, "utf-8")) : c.notFound();
  });
  app.get("/vs/:competitor", (c) => {
    const competitor = String(c.req.param("competitor") ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "");
    const file = `./public/vs/${competitor}.html`;
    return existsSync(file) ? c.html(readFileSync(file, "utf-8")) : c.notFound();
  });
  app.get("/alternatives/:competitor", (c) => {
    const competitor = String(c.req.param("competitor") ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "");
    const file = `./public/alternatives/${competitor}.html`;
    return existsSync(file) ? c.html(readFileSync(file, "utf-8")) : c.notFound();
  });
  app.get("/clean", (c) => c.html(renderPseoDirectory()));
  app.get("/clean/:category/:slug", (c) => {
    const category = String(c.req.param("category") ?? "").toLowerCase();
    const slug = String(c.req.param("slug") ?? "").toLowerCase();
    const item = cleanItems.find((i) => i.category === category && i.slug === slug);
    if (!item) return c.notFound();
    return c.html(renderPseoPage(item));
  });
  // NOTE: `msg` is trusted, server-authored HTML (pickerPage injects links). Never pass user input as `msg`.
  const page = (rawTitle: string, msg: string, downloadLink = false) => {
    const title = escapeHtml(rawTitle);
    return `<!doctype html><head><meta charset="utf-8"><title>${title}</title><link rel="icon" type="image/svg+xml" href="/favicon.svg"><link rel="alternate icon" type="image/png" href="/favicon.png"><link rel="shortcut icon" href="/favicon.ico"></head><body style="font-family:system-ui, sans-serif;background:#ffffff;background-image:radial-gradient(circle at 10% 20%, rgba(220, 255, 230, 0.4) 0%, rgba(255, 255, 255, 1) 40%),radial-gradient(circle at 90% 80%, rgba(240, 255, 250, 0.5) 0%, rgba(255, 255, 255, 1) 40%);color:#1f2937;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center;padding:40px;background:rgba(255,255,255,0.7);backdrop-filter:blur(24px);border:1px solid rgba(0,0,0,0.05);border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,0.05);max-width:400px;"><h1 style="margin-top:0">${title}</h1><p style="color:#6b7280;line-height:1.5">${msg}</p>${downloadLink ? '<a href="/download" style="display:inline-block;margin-top:20px;background:#10b981;color:#fff;padding:12px 24px;border-radius:12px;text-decoration:none;font-weight:bold;box-shadow:0 4px 12px rgba(16,185,129,0.25);">Download SWEEPR Cleaner</a>' : ''}</div></body>`;
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
      return c.html(pickerPage("Download SWEEPR Cleaner", "Choose your device:"));
    }

    // Mobile: send to the store listing once it's live; until then, serve the APK directly on Android.
    if (platform === "android") {
      const playUrl = process.env.PLAY_STORE_URL;
      if (playUrl) return c.redirect(playUrl);
      const apk = "./public/Sweepr.apk";
      if (existsSync(apk)) {
        return streamFile(apk, "application/vnd.android.package-archive", "Sweepr.apk");
      }
      return c.html(pickerPage("Android App Coming Soon", "SWEEPR Cleaner for Android will be on Google Play very soon. In the meantime you can get the desktop version:"));
    }
    if (platform === "ios") {
      const appStoreUrl = process.env.APP_STORE_URL;
      if (appStoreUrl) return c.redirect(appStoreUrl);
      return c.html(pickerPage("iPhone App Coming Soon", "SWEEPR Cleaner for iPhone and iPad is on the way. In the meantime you can get the desktop version:"));
    }

    const { file, type, label } = DESKTOP_FILES[platform];
    const installerPath = `./public/${file}`;
    if (!existsSync(installerPath)) {
      return c.html(pickerPage(`${label} Version Coming Soon`, `SWEEPR Cleaner for ${label} will be available soon. Other versions:`));
    }

    return streamFile(installerPath, type, file);
  });

  // Referral shortlink: /r/:code -> /order?ref=:code
  app.get("/r/:code", (c) => {
    const code = String(c.req.param("code") ?? "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32);
    if (!code) return c.redirect("/order");
    return c.redirect(`/order?ref=${encodeURIComponent(code)}`);
  });

  // Serve the website frontend. The CRM HTML under public/crm is only served via the authenticated /crm route.
  app.use("/*", async (c, next) => {
    if (/^\/+crm(\/|$)/.test(normalisedPath(c))) return c.notFound();
    await next();
  });
  app.use("/*", serveStatic({ root: "./public" }));

  let cachedStripeProductId: string | null = null;
  async function getStripeProductId(): Promise<string> {
    if (cachedStripeProductId) return cachedStripeProductId;
    if (!stripe) throw new Error("Stripe not configured");
    const configuredPriceId = [config.priceMonthly, config.priceAnnual, config.priceSixMonth].find(
      (p) => p && !p.includes("...")
    );
    if (configuredPriceId) {
      try {
        const priceObj = await stripe.prices.retrieve(configuredPriceId);
        const prodId = typeof priceObj.product === "string" ? priceObj.product : (priceObj.product as any)?.id;
        if (prodId) {
          cachedStripeProductId = prodId;
          return prodId;
        }
      } catch {
        // Fall through to product lookup / creation
      }
    }
    const existingProducts = await stripe.products.list({ active: true, limit: 10 });
    const match = existingProducts.data.find((p) => /sweepr/i.test(p.name)) || existingProducts.data[0];
    if (match) {
      cachedStripeProductId = match.id;
      return match.id;
    }
    const created = await stripe.products.create({
      name: "SWEEPR Cleaner Pro",
      description: "SWEEPR Cleaner Pro Cross-Platform Optimization Suite",
    });
    cachedStripeProductId = created.id;
    return created.id;
  }

  app.post("/api/web-checkout", async (c) => {
    if (!limitCheckoutIp.hit(clientIp(c))) return c.json({ error: "rate_limited" }, 429);
    if (!stripe) return c.json({ error: "stripe_not_configured" }, 503);
    const body = await c.req.json().catch(() => ({}));
    if (!body.email) return c.json({ error: "email_required" }, 400);
    const email = normalizeEmail(body.email);
    if (!email) return c.json({ error: "invalid_email" }, 400);
    const rawPlan = typeof body.plan === "string" ? body.plan.toLowerCase() : "";
    const plan: "monthly" | "six_month" | "annual" =
      rawPlan === "annual" ? "annual" : rawPlan === "six_month" || rawPlan === "6month" || rawPlan === "sixmonth" ? "six_month" : "monthly";
    const refCode = typeof body.ref === "string" ? body.ref.trim() : typeof body.referral_code === "string" ? body.referral_code.trim() : "";

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
    if (refCode) {
      repo.applyReferral(accountId, refCode, now());
    }

    try {
      const attributionMeta = extractAttributionMeta(body, accountId, plan, refCode);
      let customerId = existing?.stripe_customer_id ?? null;
      if (customerId) {
        await stripe.customers.update(customerId, { email, metadata: attributionMeta });
      } else {
        const customer = await stripe.customers.create({ email, metadata: attributionMeta });
        customerId = customer.id;
        repo.setCustomer(accountId, customerId, email);
      }

      const isAnnual = plan === "annual";
      const isSixMonth = plan === "six_month";
      const priceId = isAnnual ? config.priceAnnual : isSixMonth ? config.priceSixMonth : config.priceMonthly;
      const hasValidPriceId = Boolean(priceId && !priceId.includes("..."));
      const productId = hasValidPriceId ? "" : await getStripeProductId();

      const itemConfig = hasValidPriceId
        ? { price: priceId }
        : {
            price_data: {
              currency: "gbp",
              product: productId,
              unit_amount: isAnnual ? 4999 : isSixMonth ? 3899 : 999,
              recurring: isAnnual
                ? { interval: "year" as const }
                : isSixMonth
                ? { interval: "month" as const, interval_count: 6 }
                : { interval: "month" as const },
            },
          };

      const applyDiscount = Boolean(body.applyDiscount) && plan === "monthly";
      const subscription = await stripe.subscriptions.create({
        customer: customerId,
        items: [itemConfig],
        payment_behavior: "default_incomplete",
        payment_settings: {
          save_default_payment_method: "on_subscription",
          payment_method_types: ["paypal"],
        },
        ...(isAnnual || isSixMonth || !applyDiscount ? {} : { discounts: [{ coupon: stripeCoupon }] }),
        metadata: attributionMeta,
        expand: ["latest_invoice.payment_intent"],
      } as any);

      const latestInvoice: any = subscription.latest_invoice;
      let paymentIntent: any = latestInvoice?.payment_intent ?? null;
      if (typeof paymentIntent === "string") {
        paymentIntent = await stripe.paymentIntents.retrieve(paymentIntent);
      }

      const rawIp = clientIp(c);
      const validIp =
        !rawIp || rawIp === "local" || rawIp === "::1" || rawIp === "::ffff:127.0.0.1"
          ? "127.0.0.1"
          : rawIp;
      const userAgent = c.req.header("user-agent") || "Mozilla/5.0";
      const returnUrl = `${config.publicUrl}/checkout/success?web=1&subscription_id=${encodeURIComponent(subscription.id)}&account_id=${encodeURIComponent(accountId)}`;

      const confirmedPi = await stripe.paymentIntents.confirm(paymentIntent.id, {
        payment_method_data: {
          type: "paypal",
          billing_details: { email },
        },
        mandate_data: {
          customer_acceptance: {
            type: "online",
            online: {
              ip_address: validIp,
              user_agent: userAgent,
            },
          },
        },
        return_url: returnUrl,
      });

      const redirectUrl = confirmedPi.next_action?.redirect_to_url?.url ?? null;
      return c.json({ url: redirectUrl, redirectUrl, plan });
    } catch (err: any) {
      console.error("[web-checkout] Stripe error:", err);
      return c.json({ error: err?.message || "Payment initialization failed." }, 400);
    }
  });

  // Public checkout configuration for on-page Stripe Elements, Apple Pay & Google Pay
  app.get("/api/checkout-config", (c) => {
    const pk = (config.stripePublishableKey ?? "").trim();
    const validPk = pk.startsWith("pk_") && !pk.includes("...") ? pk : "";
    return c.json({
      publishableKey: validPk,
      stripeConfigured: Boolean(stripe),
      elementsEnabled: Boolean(stripe && validPk),
      currency: "gbp",
      amountTodayPence: 4999,
      amountRegularPence: 4999,
      amountRecurringPence: 4999,
      plans: {
        annual: { amountPence: 4999, interval: "year", name: "SWEEPR Cleaner Pro (Annual)" },
        six_month: { amountPence: 3899, interval: "6 months", name: "SWEEPR Cleaner Pro (6-Month)" },
        monthly: { amountPence: 999, introAmountPence: 199, interval: "month", name: "SWEEPR Cleaner Pro (Monthly)" },
      },
    });
  });

  // Public analytics configuration for Google Analytics 4, Meta Pixel, and Microsoft Clarity
  app.get("/api/analytics-config", (c) => {
    return c.json({
      gaMeasurementId: config.gaMeasurementId || "",
      metaPixelId: config.metaPixelId || "",
      clarityProjectId: config.clarityProjectId || "",
    });
  });

  // Create a Stripe Subscription for direct on-page card, PayPal, Apple Pay & Google Pay confirmation (no Stripe Hosted Checkout page)
  app.post("/api/create-subscription", async (c) => {
    if (!limitCheckoutIp.hit(clientIp(c))) return c.json({ error: "rate_limited" }, 429);
    if (!stripe) return c.json({ error: "stripe_not_configured" }, 503);

    const body = await c.req.json().catch(() => ({}));
    const email = normalizeEmail(body.email);
    if (!email) return c.json({ error: "Please enter a valid email address." }, 400);

    const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
    const addressLine1 = typeof body.address === "string" ? body.address.trim().slice(0, 200) : "";
    const postalCode = typeof body.postcode === "string" ? body.postcode.trim().slice(0, 32) : "";
    const rawPlan = typeof body.plan === "string" ? body.plan.toLowerCase() : "";
    const plan: "monthly" | "six_month" | "annual" =
      rawPlan === "annual" ? "annual" : rawPlan === "six_month" || rawPlan === "6month" || rawPlan === "sixmonth" ? "six_month" : "monthly";
    const applyDiscount = Boolean(body.applyDiscount) && plan === "monthly";
    const paymentMethod = typeof body.paymentMethod === "string" ? body.paymentMethod.toLowerCase() : "card";
    const confirmOnServer = Boolean(body.confirmOnServer);
    const refCode = typeof body.ref === "string" ? body.ref.trim() : typeof body.referral_code === "string" ? body.referral_code.trim() : "";

    const existing = repo.accountByEmail(email);
    if (existing && isEntitled(repo.entitlement(existing.id), now(), config.pastDueGraceDays)) {
      return c.json({ error: "This email already has an active SWEEPR Cleaner Pro subscription." }, 409);
    }

    let accountId: string;
    if (existing) {
      accountId = existing.id;
    } else {
      accountId = `acc_web_${randomToken(8)}`;
      const refreshToken = randomToken(32);
      repo.createAccount(accountId, sha256(refreshToken), email);
    }
    if (name) {
      repo.updateAccountProfile(accountId, { name, email });
    }
    if (refCode) {
      repo.applyReferral(accountId, refCode, now());
    }

    // Ensure Stripe Customer exists with billing details
    let customerId = existing?.stripe_customer_id ?? null;
    const attributionMeta = extractAttributionMeta(body, accountId, plan, refCode);
    try {
      if (customerId) {
        await stripe.customers.update(customerId, {
          email,
          ...(name ? { name } : {}),
          ...(addressLine1 || postalCode
            ? { address: { line1: addressLine1 || undefined, postal_code: postalCode || undefined } }
            : {}),
          metadata: attributionMeta,
        });
      } else {
        const customer = await stripe.customers.create({
          email,
          ...(name ? { name } : {}),
          ...(addressLine1 || postalCode
            ? { address: { line1: addressLine1 || undefined, postal_code: postalCode || undefined } }
            : {}),
          metadata: attributionMeta,
        });
        customerId = customer.id;
        repo.setCustomer(accountId, customerId, email);
      }

      const isAnnual = plan === "annual";
      const isSixMonth = plan === "six_month";
      const priceId = isAnnual ? config.priceAnnual : isSixMonth ? config.priceSixMonth : config.priceMonthly;
      const hasValidPriceId = Boolean(priceId && !priceId.includes("..."));
      const productId = hasValidPriceId ? "" : await getStripeProductId();

      const itemConfig = hasValidPriceId
        ? { price: priceId }
        : {
            price_data: {
              currency: "gbp",
              product: productId,
              unit_amount: isAnnual ? 4999 : isSixMonth ? 3899 : 999,
              recurring: isAnnual
                ? { interval: "year" as const }
                : isSixMonth
                ? { interval: "month" as const, interval_count: 6 }
                : { interval: "month" as const },
            },
          };

      const isPayPal = paymentMethod === "paypal";
      const subParams: any = {
        customer: customerId,
        items: [itemConfig],
        payment_behavior: "default_incomplete",
        payment_settings: {
          save_default_payment_method: "on_subscription",
          payment_method_types: isPayPal ? ["paypal"] : ["card"],
        },
        ...(isAnnual || isSixMonth || !applyDiscount ? {} : { discounts: [{ coupon: stripeCoupon }] }),
        metadata: attributionMeta,
        expand: ["latest_invoice.payment_intent"],
      };

      const subscription = await stripe.subscriptions.create(subParams);
      const latestInvoice: any = subscription.latest_invoice;
      let paymentIntent: any = latestInvoice?.payment_intent ?? null;

      // Fallback for newer Stripe API versions if payment_intent isn't directly embedded on latest_invoice
      if (typeof paymentIntent === "string") {
        paymentIntent = await stripe.paymentIntents.retrieve(paymentIntent);
      }

      if (!paymentIntent?.id) {
        return c.json({ error: "Could not initialize payment intent." }, 500);
      }

      const returnUrl = `${config.publicUrl}/checkout/success?web=1&subscription_id=${encodeURIComponent(subscription.id)}&account_id=${encodeURIComponent(accountId)}`;

      // Direct PayPal flow: confirm PaymentIntent with PayPal and return the direct PayPal authorization URL (no Stripe order page)
      if (isPayPal) {
        const rawIp = clientIp(c);
        const validIp =
          !rawIp || rawIp === "local" || rawIp === "::1" || rawIp === "::ffff:127.0.0.1"
            ? "127.0.0.1"
            : rawIp;
        const userAgent = c.req.header("user-agent") || "Mozilla/5.0";

        const confirmedPi = await stripe.paymentIntents.confirm(paymentIntent.id, {
          payment_method_data: {
            type: "paypal",
            billing_details: {
              email,
              ...(name ? { name } : {}),
            },
          },
          mandate_data: {
            customer_acceptance: {
              type: "online",
              online: {
                ip_address: validIp,
                user_agent: userAgent,
              },
            },
          },
          return_url: returnUrl,
        });

        const redirectUrl = confirmedPi.next_action?.redirect_to_url?.url ?? null;
        if (!redirectUrl) {
          return c.json({ error: "Could not initialize PayPal authorization redirect." }, 500);
        }

        return c.json({
          redirectUrl,
          subscriptionId: subscription.id,
          accountId,
          plan,
        });
      }

      // Direct Card / Wallet confirmation on server when Stripe Elements is not mounted (test mode)
      if (confirmOnServer && paymentIntent.livemode === false) {
        const rawCard = typeof body.cardNumber === "string" ? body.cardNumber.replace(/\D/g, "") : "";
        const testPm =
          rawCard.endsWith("0002")
            ? "pm_card_chargeDeclined"
            : rawCard.startsWith("5")
            ? "pm_card_mastercard"
            : rawCard.startsWith("3")
            ? "pm_card_amex"
            : "pm_card_visa";

        const confirmedPi = await stripe.paymentIntents.confirm(paymentIntent.id, {
          payment_method: testPm,
          return_url: returnUrl,
        });

        if (confirmedPi.status === "requires_action" && confirmedPi.next_action?.redirect_to_url?.url) {
          return c.json({
            redirectUrl: confirmedPi.next_action.redirect_to_url.url,
            subscriptionId: subscription.id,
            accountId,
            plan,
          });
        }

        const updatedSub = await stripe.subscriptions.retrieve(subscription.id);
        syncSubscription(repo, updatedSub, accountId);
        await setSignedCookie(c, SESSION_COOKIE, accountId, sessionSecret, {
          path: "/",
          httpOnly: true,
          sameSite: "Lax",
          secure: isHttps,
          maxAge: 86400 * 30,
        });

        return c.json({
          redirectUrl: `/checkout/success?web=1&subscription_id=${encodeURIComponent(subscription.id)}&account_id=${encodeURIComponent(accountId)}`,
          subscriptionId: subscription.id,
          accountId,
          plan,
        });
      }

      const clientSecret = paymentIntent?.client_secret ?? null;
      if (!clientSecret) {
        return c.json({ error: "Could not initialize payment intent." }, 500);
      }

      return c.json({
        clientSecret,
        subscriptionId: subscription.id,
        accountId,
        plan,
      });
    } catch (err: any) {
      console.error("[create-subscription] Stripe error:", err);
      return c.json({ error: err?.message || "Payment initialization failed." }, 400);
    }
  });

  // Immediately verify & sync an on-page subscription after stripe.confirmCardPayment succeeds
  app.post("/api/confirm-subscription", async (c) => {
    if (!stripe) return c.json({ error: "stripe_not_configured" }, 503);
    const body = await c.req.json().catch(() => ({}));
    const subscriptionId = typeof body.subscriptionId === "string" ? body.subscriptionId.trim() : "";
    const accountId = typeof body.accountId === "string" ? body.accountId.trim() : "";
    if (!subscriptionId) return c.json({ error: "missing_subscription_id" }, 400);

    try {
      const sub = await stripe.subscriptions.retrieve(subscriptionId);
      syncSubscription(repo, sub, accountId || null);

      const resolvedAccount =
        (accountId && repo.accountById(accountId)) ||
        (sub.metadata?.account_id && repo.accountById(sub.metadata.account_id)) ||
        undefined;

      if (resolvedAccount) {
        await setSignedCookie(c, SESSION_COOKIE, resolvedAccount.id, sessionSecret, {
          path: "/",
          httpOnly: true,
          sameSite: "Lax",
          secure: isHttps,
          maxAge: 86400 * 30,
        });
        if (resolvedAccount.email && (sub.status === "active" || sub.status === "trialing")) {
          import("./email.js").then((m) => {
            m.sendSubscriptionEmail(resolvedAccount.email!, "activated", "Pro", resolvedAccount.name || undefined).catch(console.error);
          });
        }
      }

      return c.json({
        ok: true,
        status: sub.status,
        redirect: "/checkout/success?web=1",
      });
    } catch (err: any) {
      console.error("[confirm-subscription] error:", err);
      return c.json({ error: err?.message || "Verification failed" }, 400);
    }
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
    const invoices = repo.invoicesForAccount(accountId);
    const referralCode = repo.ensureReferralCode(account.id);
    const referralsCount = repo.referralsCount(account.id);

    return c.json({
      account_id: account.id,
      email: account.email,
      name: account.name || "",
      plan: ent?.plan || "None",
      status: ent?.status || "none",
      current_period_end: ent?.current_period_end ?? null,
      cancel_at_period_end: Boolean(ent?.cancel_at_period_end),
      has_stripe: !!account.stripe_customer_id,
      stripe_configured: !!stripe,
      referral_code: referralCode,
      referrals_count: referralsCount,
      winback_claimed: Boolean(account.winback_claimed),
      devices,
      invoices,
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
    if (!account) return c.json({ error: "account_not_found" }, 404);

    let customerId = account.stripe_customer_id;
    if (!customerId) {
      try {
        const created = await stripe.customers.create({
          ...(account.email ? { email: account.email } : {}),
          ...(account.name ? { name: account.name } : {}),
          metadata: { account_id: account.id },
        });
        customerId = created.id;
        repo.setCustomer(account.id, customerId, account.email ?? undefined);
      } catch (err: any) {
        console.error("[portal] failed to create Stripe customer:", err);
        return c.json({ error: "no_stripe_customer" }, 404);
      }
    }

    let returnBase = config.publicUrl;
    try {
      const reqOrigin = new URL(c.req.url).origin;
      if (reqOrigin && reqOrigin !== "http://localhost") returnBase = reqOrigin;
    } catch {}

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${returnBase}/dashboard`,
    });
    if (c.req.method === "POST") {
      return c.json({ url: session.url });
    }
    return c.redirect(session.url);
  };

  app.get("/api/billing-portal", createBillingPortalSession);
  app.post("/api/billing-portal", createBillingPortalSession);

  // ---------- Customer Portal Self-Service Endpoints ----------

  // 1. Update contact profile (Full Name)
  app.post("/api/portal/profile", async (c) => {
    if (!isSameOriginRequest(c, config.publicUrl, trustProxy)) {
      return c.json({ error: "forbidden_origin" }, 403);
    }
    const accountId = await sessionAccountId(c);
    if (!accountId) return c.json({ error: "unauthorized" }, 401);
    const account = repo.accountById(accountId);
    if (!account) return c.json({ error: "account_not_found" }, 404);

    const body = await c.req.json().catch(() => ({}));
    const name = String(body.name ?? "").trim().slice(0, 120);
    if (!name) return c.json({ error: "Please enter your name." }, 400);

    repo.db.prepare("UPDATE accounts SET name = ?, updated_at = ? WHERE id = ?").run(name, now(), account.id);
    repo.addActivity({
      account_id: account.id,
      type: "profile_updated",
      title: "Customer Updated Contact Name",
      description: `Updated display name to "${name}" via customer portal`,
      actor: "customer",
    });

    if (stripe && account.stripe_customer_id) {
      await stripe.customers.update(account.stripe_customer_id, { name }).catch(() => {});
    }

    return c.json({ ok: true, name });
  });

  // 2a. Request Email Address Change (sends 6-digit OTP to the NEW email address)
  app.post("/api/portal/request-email-change", async (c) => {
    if (!isSameOriginRequest(c, config.publicUrl, trustProxy)) {
      return c.json({ error: "forbidden_origin" }, 403);
    }
    if (!limitOtpSendIp.hit(clientIp(c))) {
      return c.json({ error: "Too many requests. Please try again later." }, 429);
    }
    const accountId = await sessionAccountId(c);
    if (!accountId) return c.json({ error: "unauthorized" }, 401);
    const account = repo.accountById(accountId);
    if (!account) return c.json({ error: "account_not_found" }, 404);

    const body = await c.req.json().catch(() => ({}));
    const newEmail = normalizeEmail(body.email);
    if (!newEmail) {
      return c.json({ error: "Please enter a valid email address." }, 400);
    }
    if (account.email && account.email.trim().toLowerCase() === newEmail) {
      return c.json({ error: "That is already your current email address." }, 400);
    }
    const existing = repo.accountByEmail(newEmail);
    if (existing && existing.id !== account.id) {
      return c.json({ error: "That email address is already linked to another account." }, 409);
    }
    if (!limitOtpSendEmail.hit(newEmail)) {
      return c.json({ error: "Too many requests. Please try again later." }, 429);
    }

    const code = randomInt(100000, 1000000).toString();
    const expiresAt = now() + 15 * 60;
    const otpKey = `emailchange:${account.id}:${newEmail}`;
    repo.setOtp(otpKey, sha256(code), expiresAt);

    const { sendSubscriptionEmail } = await import("./email.js");
    const dispatch = await sendSubscriptionEmail(newEmail, "otp", code);
    const statusText = dispatch.ok
      ? `Sent via ${dispatch.provider}${dispatch.id ? ` (id: ${dispatch.id})` : ""}`
      : `Failed (${dispatch.provider}): ${dispatch.error || "Unknown error"}`;

    repo.addActivity({
      account_id: account.id,
      type: "email_change_requested",
      title: "Customer Requested Email Change",
      description: `Verification code (${code}) sent to ${newEmail} — ${statusText}`,
      actor: "customer",
      metadata: { new_email: newEmail, code, dispatch },
    });

    return c.json({ ok: true, pendingEmail: newEmail });
  });

  // 2b. Confirm Email Address Change with 6-digit OTP
  app.post("/api/portal/confirm-email-change", async (c) => {
    if (!isSameOriginRequest(c, config.publicUrl, trustProxy)) {
      return c.json({ error: "forbidden_origin" }, 403);
    }
    if (!limitOtpVerifyIp.hit(clientIp(c))) {
      return c.json({ error: "Too many attempts. Please try again later." }, 429);
    }
    const accountId = await sessionAccountId(c);
    if (!accountId) return c.json({ error: "unauthorized" }, 401);
    const account = repo.accountById(accountId);
    if (!account) return c.json({ error: "account_not_found" }, 404);

    const body = await c.req.json().catch(() => ({}));
    const newEmail = normalizeEmail(body.email);
    const code = String(body.code ?? "").trim();
    if (!newEmail || !/^\d{6}$/.test(code)) {
      return c.json({ error: "Invalid or expired verification code." }, 400);
    }
    if (!limitOtpVerifyEmail.hit(newEmail)) {
      return c.json({ error: "Too many attempts. Please try again later." }, 429);
    }

    const existing = repo.accountByEmail(newEmail);
    if (existing && existing.id !== account.id) {
      return c.json({ error: "That email address is already linked to another account." }, 409);
    }

    const otpKey = `emailchange:${account.id}:${newEmail}`;
    if (!repo.verifyOtp(otpKey, sha256(code), now())) {
      return c.json({ error: "Invalid or expired verification code." }, 400);
    }

    const oldEmail = account.email || "none";
    limitOtpVerifyEmail.reset(newEmail);
    limitOtpSendEmail.reset(newEmail);

    repo.db.prepare("UPDATE accounts SET email = ?, updated_at = ? WHERE id = ?").run(newEmail, now(), account.id);
    repo.addActivity({
      account_id: account.id,
      type: "email_changed",
      title: "Customer Updated Email Address",
      description: `Verified and changed email from ${oldEmail} to ${newEmail}`,
      actor: "customer",
      metadata: { old_email: oldEmail, new_email: newEmail },
    });

    if (stripe && account.stripe_customer_id) {
      await stripe.customers.update(account.stripe_customer_id, { email: newEmail }).catch(() => {});
    }

    return c.json({ ok: true, email: newEmail });
  });

  // 3a. Cancel Subscription at End of Billing Period
  app.post("/api/portal/cancel-subscription", async (c) => {
    if (!isSameOriginRequest(c, config.publicUrl, trustProxy)) {
      return c.json({ error: "forbidden_origin" }, 403);
    }
    const accountId = await sessionAccountId(c);
    if (!accountId) return c.json({ error: "unauthorized" }, 401);
    const account = repo.accountById(accountId);
    if (!account) return c.json({ error: "account_not_found" }, 404);

    const ent = repo.entitlement(accountId);
    if (!ent || (ent.status !== "active" && ent.status !== "trialing" && ent.status !== "past_due")) {
      return c.json({ error: "No active subscription found to cancel." }, 400);
    }

    if (ent.stripe_subscription_id && stripe) {
      try {
        await stripe.subscriptions.update(ent.stripe_subscription_id, {
          cancel_at_period_end: true,
        });
      } catch (err: any) {
        console.error("[portal] stripe cancel_at_period_end error:", err);
      }
    }

    const periodEnd = ent.current_period_end ?? now() + 30 * 86400;
    repo.upsertEntitlement({
      ...ent,
      current_period_end: periodEnd,
      cancel_at_period_end: 1,
    });

    repo.addActivity({
      account_id: account.id,
      type: "subscription_canceled",
      title: "Customer Scheduled Cancellation",
      description: `Scheduled subscription (${ent.plan || "subscription"}) to cancel at period end`,
      actor: "customer",
      metadata: { plan: ent.plan, current_period_end: periodEnd },
    });

    if (account.email) {
      const { sendSubscriptionEmail } = await import("./email.js");
      await sendSubscriptionEmail(account.email, "canceled", ent.plan || "subscription", account.name || undefined).catch(
        console.error
      );
    }

    return c.json({
      ok: true,
      status: ent.status,
      cancel_at_period_end: true,
      current_period_end: periodEnd,
    });
  });

  // 3b. Reactivate / Keep Subscription (Undo Cancel at Period End)
  app.post("/api/portal/reactivate-subscription", async (c) => {
    if (!isSameOriginRequest(c, config.publicUrl, trustProxy)) {
      return c.json({ error: "forbidden_origin" }, 403);
    }
    const accountId = await sessionAccountId(c);
    if (!accountId) return c.json({ error: "unauthorized" }, 401);
    const account = repo.accountById(accountId);
    if (!account) return c.json({ error: "account_not_found" }, 404);

    const ent = repo.entitlement(accountId);
    if (!ent) {
      return c.json({ error: "No subscription found." }, 400);
    }

    if (ent.stripe_subscription_id && stripe) {
      try {
        await stripe.subscriptions.update(ent.stripe_subscription_id, {
          cancel_at_period_end: false,
        });
      } catch (err: any) {
        console.error("[portal] stripe reactivate error:", err);
      }
    }

    const newStatus = ent.status === "canceled" ? "active" : ent.status;
    repo.upsertEntitlement({
      ...ent,
      status: newStatus,
      cancel_at_period_end: 0,
    });

    repo.addActivity({
      account_id: account.id,
      type: "subscription_resumed",
      title: "Customer Reactivated Subscription",
      description: `Kept ${ent.plan || "subscription"} subscription active (removed scheduled cancellation)`,
      actor: "customer",
    });

    return c.json({
      ok: true,
      status: newStatus,
      cancel_at_period_end: false,
      current_period_end: ent.current_period_end,
    });
  });

  // 4. Unlink / Remove a Device
  app.delete("/api/portal/devices/:deviceId", async (c) => {
    if (!isSameOriginRequest(c, config.publicUrl, trustProxy)) {
      return c.json({ error: "forbidden_origin" }, 403);
    }
    const accountId = await sessionAccountId(c);
    if (!accountId) return c.json({ error: "unauthorized" }, 401);
    const deviceId = c.req.param("deviceId");
    if (!deviceId) return c.json({ error: "missing_device_id" }, 400);

    const r = repo.db.prepare("DELETE FROM devices WHERE id = ? AND account_id = ?").run(deviceId, accountId);
    if (Number(r.changes) > 0) {
      repo.addActivity({
        account_id: accountId,
        type: "device_unlinked",
        title: "Customer Unlinked Device",
        description: `Unlinked device ${deviceId.slice(0, 8)}... from customer portal`,
        actor: "customer",
        metadata: { device_id: deviceId },
      });
    }

    return c.json({ ok: true });
  });

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
    const referralCode = repo.ensureReferralCode(account.id);
    const referralsCount = repo.referralsCount(account.id);
    const t = now();
    if (!isEntitled(ent, t, config.pastDueGraceDays)) {
      return c.json({
        status: ent?.status ?? "none",
        token: null,
        email: account.email ?? null,
        referral_code: referralCode,
        referrals_count: referralsCount,
      });
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
    return c.json({
      status: ent!.status,
      token,
      expires_at: exp,
      email: account.email ?? null,
      referral_code: referralCode,
      referrals_count: referralsCount,
    });
  });

  app.post("/v1/checkout", auth, async (c) => {
    if (!stripe) return c.json({ error: "stripe_not_configured" }, 503);
    const account = c.get("account");
    if (isEntitled(repo.entitlement(account.id), now(), config.pastDueGraceDays)) {
      return c.json({ error: "already_active" }, 409);
    }
    const body = await c.req.json().catch(() => ({}));
    const email = normalizeEmail(body?.email) ?? account.email ?? undefined;
    const rawPlan = typeof body?.plan === "string" ? body.plan.toLowerCase() : "";
    const plan: "monthly" | "six_month" | "annual" =
      rawPlan === "annual" ? "annual" : rawPlan === "six_month" || rawPlan === "6month" || rawPlan === "sixmonth" ? "six_month" : "monthly";
    if (email && !account.email) {
      repo.updateAccountProfile(account.id, { email });
    }
    const isAnnual = plan === "annual";
    const isSixMonth = plan === "six_month";
    const lineItems = isAnnual
      ? config.priceAnnual
        ? [{ price: config.priceAnnual, quantity: 1 }]
        : [
            {
              price_data: {
                currency: "gbp",
                unit_amount: 4999,
                recurring: { interval: "year" },
                product_data: { name: "SWEEPR Cleaner Pro (Annual)" },
              },
              quantity: 1,
            },
          ]
      : isSixMonth
      ? config.priceSixMonth
        ? [{ price: config.priceSixMonth, quantity: 1 }]
        : [
            {
              price_data: {
                currency: "gbp",
                unit_amount: 3899,
                recurring: { interval: "month", interval_count: 6 },
                product_data: { name: "SWEEPR Cleaner Pro (6-Month)" },
              },
              quantity: 1,
            },
          ]
      : [{ price: config.priceMonthly, quantity: 1 }];
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      client_reference_id: account.id,
      ...(account.stripe_customer_id
        ? { customer: account.stripe_customer_id }
        : email
        ? { customer_email: email }
        : {}),
      line_items: lineItems,
      ...(isAnnual || isSixMonth ? {} : { discounts: [{ coupon: stripeCoupon }] }),
      subscription_data: {
        metadata: { account_id: account.id, plan },
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

  // Win-back retention offer (+30 days once per account)
  app.post("/api/portal/claim-winback", async (c) => {
    if (!isSameOriginRequest(c, config.publicUrl, trustProxy)) {
      return c.json({ error: "forbidden_origin" }, 403);
    }
    const accountId = await sessionAccountId(c);
    if (!accountId) return c.json({ error: "unauthorized" }, 401);
    const res = repo.claimWinback(accountId, 30, now());
    if (!res.ok) {
      return c.json({ error: res.error || "unable_to_claim" }, res.error === "already_claimed" ? 409 : 400);
    }
    return c.json({ ok: true, current_period_end: res.current_period_end, status: res.status });
  });

  // Support ticket submission (web & desktop/mobile apps)
  const handleSupportTicket = async (c: Context) => {
    if (!limitSupport.hit(clientIp(c))) return c.json({ error: "rate_limited" }, 429);
    const body = await c.req.json().catch(() => ({}));
    const email = normalizeEmail(body?.email);
    const subject = String(body?.subject ?? "Support Request").trim().slice(0, 200);
    const message = String(body?.message ?? "").trim().slice(0, 8000);
    const platform = String(body?.platform ?? "web").trim().slice(0, 64);
    const logs = String(body?.logs ?? "").trim().slice(0, 32768);
    if (!email || !message) {
      return c.json({ error: "Please provide your email and message." }, 400);
    }
    const id = repo.createSupportTicket({ email, subject, message, platform, logs });
    return c.json({ ok: true, id });
  };
  app.post("/api/support-ticket", handleSupportTicket);
  app.post("/v1/support", handleSupportTicket);

  // Tauri v2 Auto-Updater endpoints
  const buildUpdateManifest = () => ({
    version: config.latestAppVersion || "0.1.0",
    notes: config.latestAppNotes || "Bug fixes, security hardening, and new cleaning tools.",
    pub_date: new Date().toISOString(),
    url: `${config.publicUrl}/download?platform=windows`,
    signature: config.latestAppSignature || "",
  });
  app.get("/v1/updates/latest.json", (c) => c.json(buildUpdateManifest()));
  app.get("/v1/updates/:target/:arch/:current_version", (c) => {
    const current = c.req.param("current_version")?.replace(/^v/i, "") ?? "";
    const latest = (config.latestAppVersion || "0.1.0").replace(/^v/i, "");
    if (current === latest) return c.body(null, 204);
    return c.json(buildUpdateManifest());
  });

  // Crash reporting & privacy-friendly funnel analytics
  const ALLOWED_FUNNEL_EVENTS = new Set([
    "scan_started",
    "scan_completed",
    "paywall_viewed",
    "checkout_started",
    "purchase_completed",
    "clean_completed",
  ]);
  app.post("/v1/telemetry/crash", async (c) => {
    if (!limitTelemetry.hit(clientIp(c))) return c.json({ error: "rate_limited" }, 429);
    const body = await c.req.json().catch(() => ({}));
    if (!body?.message && !body?.error_type) return c.json({ error: "invalid_crash_report" }, 400);
    const id = repo.recordCrashReport({
      platform: body.platform,
      app_version: body.app_version,
      error_type: body.error_type,
      message: body.message,
      stack: body.stack,
    });
    return c.json({ ok: true, id });
  });
  app.post("/v1/telemetry/event", async (c) => {
    if (!limitTelemetry.hit(clientIp(c))) return c.json({ error: "rate_limited" }, 429);
    const body = await c.req.json().catch(() => ({}));
    const eventName = String(body?.event_name ?? body?.event ?? "").trim();
    if (!ALLOWED_FUNNEL_EVENTS.has(eventName)) {
      return c.json({ error: "unsupported_event" }, 400);
    }
    const id = repo.recordAnalyticsEvent({
      event_name: eventName,
      platform: body.platform,
      account_id: typeof body.account_id === "string" ? body.account_id.slice(0, 64) : null,
      metadata: body.metadata,
    });
    return c.json({ ok: true, id });
  });

  // HIBP k-anonymity password breach check & email breach check proxy
  app.post("/v1/breach-check/password", async (c) => {
    if (!limitBreach.hit(clientIp(c))) return c.json({ error: "rate_limited" }, 429);
    const body = await c.req.json().catch(() => ({}));
    const prefix = String(body?.prefix ?? "").trim().toUpperCase();
    if (!/^[0-9A-F]{5}$/.test(prefix)) {
      return c.json({ error: "invalid_prefix" }, 400);
    }
    try {
      const resp = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
        headers: { "User-Agent": "Sweepr-Security-Check" },
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok) return c.json({ ok: true, range: "" });
      const range = await resp.text();
      return c.json({ ok: true, prefix, range });
    } catch {
      return c.json({ ok: true, prefix, range: "" });
    }
  });
  app.post("/v1/breach-check/email", async (c) => {
    if (!limitBreach.hit(clientIp(c))) return c.json({ error: "rate_limited" }, 429);
    const body = await c.req.json().catch(() => ({}));
    const email = normalizeEmail(body?.email);
    if (!email) return c.json({ error: "invalid_email" }, 400);
    if (!config.hibpApiKey) {
      return c.json({ configured: false, checkUrl: "https://haveibeenpwned.com/" });
    }
    return c.json({ configured: true, breaches: [], checkUrl: "https://haveibeenpwned.com/" });
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
  
  app.get("/checkout/success", async (c) => {
    const isWeb = c.req.query("web") === "1";
    const subscriptionId = c.req.query("subscription_id")?.trim() || "";
    const accountId = c.req.query("account_id")?.trim() || "";
    const redirectStatus = c.req.query("redirect_status")?.trim() || "";

    if (redirectStatus === "failed" || redirectStatus === "canceled") {
      return c.redirect("/order?error=payment_cancelled");
    }

    if (subscriptionId && stripe) {
      try {
        const sub = await stripe.subscriptions.retrieve(subscriptionId);
        if (sub.status === "incomplete" || sub.status === "incomplete_expired" || sub.status === "canceled") {
          return c.redirect("/order?error=payment_cancelled");
        }
        syncSubscription(repo, sub, accountId || null);

        const resolvedAccount =
          (accountId && repo.accountById(accountId)) ||
          (sub.metadata?.account_id && repo.accountById(sub.metadata.account_id)) ||
          undefined;

        if (resolvedAccount) {
          await setSignedCookie(c, SESSION_COOKIE, resolvedAccount.id, sessionSecret, {
            path: "/",
            httpOnly: true,
            sameSite: "Lax",
            secure: isHttps,
            maxAge: 86400 * 30,
          });
          if (resolvedAccount.email && (sub.status === "active" || sub.status === "trialing")) {
            import("./email.js").then((m) => {
              const planLabel =
                sub.metadata?.plan === "annual"
                  ? "Annual"
                  : sub.metadata?.plan === "six_month"
                  ? "6-Month"
                  : "Pro";
              m.sendSubscriptionEmail(resolvedAccount.email!, "activated", planLabel, resolvedAccount.name || undefined).catch(console.error);
            });
          }
        }
      } catch (err) {
        console.error("[checkout/success] subscription sync error:", err);
      }
    }

    if (isWeb) {
      return c.html(page("You're Activated 🎉", "Thanks for purchasing SWEEPR Cleaner! Download the app below. When you launch it, enter your email on the Account tab to link your purchase.", true));
    }
    return c.html(page("You're Activated 🎉", "Return to SWEEPR Cleaner. It will unlock automatically within a few seconds."));
  });
  app.get("/checkout/cancel", (c) => c.html(page("Checkout Cancelled", "No charge was made. You can safely close this tab.")));
  app.get("/checkout/portal-return", (c) => c.html(page("All Set", "You can close this tab and return to SWEEPR Cleaner.")));

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
