import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { readFileSync, existsSync } from "node:fs";
import type { Context } from "hono";
import type Stripe from "stripe";
import type { KeyObject } from "node:crypto";
import type { Account, Entitlement, Repo } from "./db.js";
import { randomToken, sha256, signEntitlement } from "./tokens.js";
import { handleStripeEvent } from "./stripe.js";
import { handleRevenueCatWebhook } from "./revenuecat.js";
import { createCrmRouter } from "./crm.js";

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
  };
  now?: () => number;
}

const DEVICE_RE = /^[a-f0-9]{64}$/;

/** Server-side source of truth: is this entitlement currently usable? */
export function isEntitled(e: Entitlement | undefined, now: number, graceDays: number): boolean {
  if (!e) return false;
  if (e.status === "active" || e.status === "trialing") return true;
  if (e.status === "past_due" && e.current_period_end) {
    return now < e.current_period_end + graceDays * 86400; // dunning grace period
  }
  return false;
}

// Very small in-memory rate limiter. Use Redis/Cloudflare rules in production.
function rateLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (key: string) => {
    const t = Date.now();
    const h = hits.get(key);
    if (!h || h.reset < t) {
      hits.set(key, { n: 1, reset: t + windowMs });
      return true;
    }
    return ++h.n <= limit;
  };
}

export function createApp(deps: AppDeps) {
  const { repo, signingKey, stripe, config } = deps;
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));
  const app = new Hono<{ Variables: { account: Account } }>();
  const limitAccounts = rateLimiter(20, 60 * 60 * 1000);
  const limitEntitlement = rateLimiter(120, 60 * 60 * 1000);

  const clientIp = (c: Context) =>
    c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";

  const auth = async (c: Context, next: () => Promise<void>) => {
    const h = c.req.header("authorization") ?? "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : "";
    const account = token ? repo.accountByTokenHash(sha256(token)) : undefined;
    if (!account) return c.json({ error: "unauthorized" }, 401);
    c.set("account", account);
    await next();
  };

  app.get("/health", (c) => c.json({ ok: true }));

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
  const page = (title: string, msg: string, downloadLink = false) =>
    `<!doctype html><head><meta charset="utf-8"><title>${title}</title><link rel="icon" type="image/svg+xml" href="/favicon.svg"><link rel="alternate icon" type="image/png" href="/favicon.png"><link rel="shortcut icon" href="/favicon.ico"></head><body style="font-family:system-ui, sans-serif;background:#ffffff;background-image:radial-gradient(circle at 10% 20%, rgba(220, 255, 230, 0.4) 0%, rgba(255, 255, 255, 1) 40%),radial-gradient(circle at 90% 80%, rgba(240, 255, 250, 0.5) 0%, rgba(255, 255, 255, 1) 40%);color:#1f2937;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center;padding:40px;background:rgba(255,255,255,0.7);backdrop-filter:blur(24px);border:1px solid rgba(0,0,0,0.05);border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,0.05);max-width:400px;"><h1 style="margin-top:0">${title}</h1><p style="color:#6b7280;line-height:1.5">${msg}</p>${downloadLink ? '<a href="/download" style="display:inline-block;margin-top:20px;background:#10b981;color:#fff;padding:12px 24px;border-radius:12px;text-decoration:none;font-weight:bold;box-shadow:0 4px 12px rgba(16,185,129,0.25);">Download Sweepr</a>' : ''}</div></body>`;

  app.get("/download", (c) => {
    const ua = c.req.header("user-agent")?.toLowerCase() || "";
    
    // Check for mobile devices
    if (/android|webos|iphone|ipad|ipod|blackberry|windows phone/i.test(ua)) {
      return c.html(page("Desktop Required", "Sweepr is a desktop application. Please visit this site on your Windows, Mac, or Linux computer to download the app."));
    }

    let installerPath = "./public/Sweepr_Setup.exe";
    let contentType = "application/vnd.microsoft.portable-executable";
    let filename = "Sweepr_Setup.exe";

    if (ua.includes("mac os") || ua.includes("macintosh")) {
      installerPath = "./public/Sweepr_Setup.dmg";
      contentType = "application/x-apple-diskimage";
      filename = "Sweepr_Setup.dmg";
    } else if (ua.includes("linux")) {
      installerPath = "./public/Sweepr_Setup.AppImage";
      contentType = "application/x-executable";
      filename = "Sweepr_Setup.AppImage";
    }

    if (!existsSync(installerPath)) {
      if (installerPath !== "./public/Sweepr_Setup.exe") {
        return c.html(page("Coming Soon", `The ${filename} version of Sweepr is currently compiling and will be available soon! Please check back later.`));
      }
      return c.text("Installer not found", 404);
    }

    const buffer = readFileSync(installerPath);
    return new Response(buffer, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  });

  // Serve the website frontend
  app.use("/*", serveStatic({ root: "./public" }));

  app.post("/api/web-checkout", async (c) => {
    if (!stripe) return c.json({ error: "stripe_not_configured" }, 503);
    const body = await c.req.json().catch(() => ({}));
    if (!body.email) return c.json({ error: "email_required" }, 400);

    const accountId = `acc_web_${randomToken(8)}`;
    const refreshToken = randomToken(32);
    repo.createAccount(accountId, sha256(refreshToken));
    
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      client_reference_id: accountId,
      customer_email: body.email,
      line_items: [
        { price: config.priceMonthly, quantity: 1 },
      ],
      discounts: [{ coupon: 'MYskiOdE' }],
      subscription_data: {
        metadata: { account_id: accountId },
      },
      managed_payments: { enabled: false },

      success_url: `${config.publicUrl}/checkout/success?web=1`,
      cancel_url: `${config.publicUrl}/order`,
    });
    return c.json({ url: session.url });
  });

  app.post("/api/portal-login", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (!body.email) return c.json({ error: "email_required" }, 400);

    const account = repo.accountByEmail(body.email);
    if (!account) return c.json({ error: "No subscription found for this email." }, 404);

    const { randomInt } = await import("node:crypto");
    const code = randomInt(100000, 999999).toString();
    const expiresAt = Math.floor(Date.now() / 1000) + 15 * 60; // 15 mins
    repo.setOtp(body.email, code, expiresAt);

    import("./email.js").then((m) => {
      m.sendSubscriptionEmail(body.email, "otp", code).catch(console.error);
    });

    return c.json({ otpSent: true });
  });

  app.post("/api/verify-otp", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (!body.email || !body.code) return c.json({ error: "missing_fields" }, 400);

    const account = repo.accountByEmail(body.email);
    if (!account) return c.json({ error: "Account not found." }, 404);

    const valid = repo.verifyOtp(body.email, body.code, Math.floor(Date.now() / 1000));
    if (!valid) return c.json({ error: "Invalid or expired code." }, 400);

    const { setSignedCookie } = await import("hono/cookie");
    const secret = (await import("./tokens.js")).sha256(config.licensePrivateKeyB64);
    await setSignedCookie(c, "sweepr_session", account.id, secret, { path: "/", httpOnly: true, maxAge: 86400 * 30 });

    return c.json({ ok: true, redirect: "/dashboard" });
  });

  app.get("/dashboard", (c) => {
    const file = "./public/dashboard.html";
    return existsSync(file) ? c.html(readFileSync(file, "utf-8")) : c.notFound();
  });

  app.get("/api/dashboard-data", async (c) => {
    const { getSignedCookie } = await import("hono/cookie");
    const secret = (await import("./tokens.js")).sha256(config.licensePrivateKeyB64);
    const accountId = await getSignedCookie(c, secret, "sweepr_session");
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

  app.get("/api/billing-portal", async (c) => {
    if (!stripe) return c.json({ error: "stripe_not_configured" }, 503);
    const { getSignedCookie } = await import("hono/cookie");
    const secret = (await import("./tokens.js")).sha256(config.licensePrivateKeyB64);
    const accountId = await getSignedCookie(c, secret, "sweepr_session");
    if (!accountId) return c.json({ error: "unauthorized" }, 401);

    const account = repo.accountById(accountId);
    if (!account || !account.stripe_customer_id) {
      return c.json({ error: "no_stripe_customer" }, 404);
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: account.stripe_customer_id,
      return_url: `${config.publicUrl}/dashboard`,
    });
    return c.redirect(session.url);
  });

  // Anonymous, device-bound account. (Add email magic-link login for "restore purchase".)
  app.post("/v1/accounts", async (c) => {
    if (!limitAccounts(clientIp(c))) return c.json({ error: "rate_limited" }, 429);
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

  // The ONLY place an entitlement decision is made.
  app.post("/v1/entitlement", auth, async (c) => {
    const account = c.get("account");
    if (!limitEntitlement(account.id)) return c.json({ error: "rate_limited" }, 429);
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
      return c.json({ status: ent?.status ?? "none", token: null });
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
    return c.json({ status: ent!.status, token, expires_at: exp });
  });

  app.post("/v1/checkout", auth, async (c) => {
    if (!stripe) return c.json({ error: "stripe_not_configured" }, 503);
    const account = c.get("account");
    if (isEntitled(repo.entitlement(account.id), now(), config.pastDueGraceDays)) {
      return c.json({ error: "already_active" }, 409);
    }
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      client_reference_id: account.id,
      ...(account.stripe_customer_id ? { customer: account.stripe_customer_id } : {}),
      line_items: [
        { price: config.priceMonthly, quantity: 1 },    // 9.99/month renewal
      ],
      discounts: [{ coupon: 'MYskiOdE' }],
      subscription_data: {
        metadata: { account_id: account.id },
      },

      automatic_tax: { enabled: true },
      // Disable managed payments to avoid the tax_code error on test prices
      managed_payments: { enabled: false },
      allow_promotion_codes: true,
      success_url: `${config.publicUrl}/checkout/success`,
      cancel_url: `${config.publicUrl}/checkout/cancel`,
    });
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
    // Verify standard RevenueCat Authorization header
    // const authHeader = c.req.header("authorization");
    // if (authHeader !== `Bearer ${config.revenueCatWebhookSecret}`) return c.text("unauthorized", 401);

    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: "invalid body" }, 400);

    try {
      await handleRevenueCatWebhook(repo, body);
    } catch (e) {
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

  if (config.devEndpoints) {
    console.warn("[dev] DEV_ENDPOINTS enabled: /dev/grant is active. Never enable in production.");
    app.post("/dev/grant", async (c) => {
      const { account_id, status = "trialing", days = 7 } = await c.req.json();
      if (!repo.accountById(account_id)) return c.json({ error: "no such account" }, 404);
      repo.upsertEntitlement({
        account_id, stripe_subscription_id: null, status, plan: "monthly",
        current_period_end: now() + days * 86400, cancel_at_period_end: 0,
      });
      return c.json({ ok: true });
    });
  }

  return app;
}
