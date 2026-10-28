import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { compress } from "hono/compress";
import { etag } from "hono/etag";
import { getCookie, setCookie, getSignedCookie, setSignedCookie, deleteCookie } from "hono/cookie";
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
import { cleanItems, getCleanItems, renderPseoDirectory, renderPseoPage } from "./pseo.js";
import { SeoStore } from "./seo/store.js";
import { createSeoRouter } from "./seo/router.js";
import { detectBot, isTrackablePath } from "./seo/bots.js";
import { AUDIT_USER_AGENT } from "./seo/audit.js";
import {
  syncToCentralCrm,
  syncSubscriptionToCentralCrm,
  reportAffiliateClickToCentralCrm,
  verifyCentralEntitlement,
  verifyCentralOtp,
} from "./crm-sync.js";
import {
  resolvePricingForRequest,
  getPricingForCountryOrCurrency,
  detectLeadDevice,
  PRICING_BY_CURRENCY,
  COUNTRY_TO_CURRENCY,
  COUNTRY_TO_LANG,
} from "./pricing.js";
import { generateQrSvg } from "./qr.js";

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
    minAppVersion?: string;
    latestAndroidVersion?: string;
    minAndroidVersion?: string;
    forceAppUpdate?: boolean;
    latestAppNotes?: string;
    latestAppSignature?: string;
    hibpApiKey?: string;
    gaMeasurementId?: string;
    metaPixelId?: string;
    clarityProjectId?: string;
    /** SEO Intelligence suite providers (all optional). */
    seo?: {
      siteUrl?: string;
      gscSiteUrl?: string;
      gscServiceAccountJson?: string;
      googleApiKey?: string;
      openPageRankApiKey?: string;
      dataForSeoLogin?: string;
      dataForSeoPassword?: string;
      dataForSeoLocationCode?: number;
      dataForSeoLanguageCode?: string;
    };
  };
  now?: () => number;
}

const DEVICE_RE = /^([a-f0-9]{64}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|and_[a-zA-Z0-9_-]{8,64}|[a-zA-Z0-9_-]{8,128})$/;
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

function hasBatteryCareAddon(body: any): boolean {
  if (!body || typeof body !== "object") return false;
  if (body.batteryCareAddon === true || body.battery_care === true || body.battery_care === "1") return true;
  if (Array.isArray(body.addons)) {
    return body.addons.some((a: any) => String(a).trim().toLowerCase() === "battery_care");
  }
  if (typeof body.addons === "string") {
    return body.addons
      .split(",")
      .map((s: string) => s.trim().toLowerCase())
      .includes("battery_care");
  }
  return false;
}

function hasCloudVaultAddon(body: any): boolean {
  if (!body || typeof body !== "object") return false;
  if (body.cloudVaultAddon === true || body.cloud_vault === true || body.cloud_vault === "1") return true;
  if (Array.isArray(body.addons)) {
    return body.addons.some((a: any) => String(a).trim().toLowerCase() === "cloud_vault");
  }
  if (typeof body.addons === "string") {
    return body.addons
      .split(",")
      .map((s: string) => s.trim().toLowerCase())
      .includes("cloud_vault");
  }
  return false;
}

function extractAttributionMeta(body: any, accountId: string, plan: string, refCode?: string): Record<string, string> {
  const attr = typeof body?.attribution === "object" && body?.attribution !== null ? body.attribution : {};
  const meta: Record<string, string> = {
    account_id: accountId,
    plan,
  };
  const addons: string[] = [];
  if (hasBatteryCareAddon(body)) {
    addons.push("battery_care");
    meta.battery_care = "1";
  }
  if (hasCloudVaultAddon(body)) {
    addons.push("cloud_vault");
    meta.cloud_vault = "1";
  }
  if (addons.length > 0) {
    meta.addons = addons.join(",");
  }
  const resolvedRef = String(refCode || attr.ref || body?.affiliate_code || "").trim();
  if (resolvedRef) meta.ref = resolvedRef.slice(0, 50);
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
  if (e.status === "active" || e.status === "trialing") {
    return !e.current_period_end || now < e.current_period_end + graceDays * 86400;
  }
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

  app.use("*", compress());
  app.use("*", etag());
  app.use("*", securityHeaders({ hsts: isHttps }));

  // Drop automated PHP/CGI/scanner probes early before body parsing, static lookup, or bot telemetry
  const SCANNER_PROBE_RE = /\.(?:php\d?|phtml|phar|cgi|asp|aspx|jsp|env)$/i;
  const SCANNER_PATH_RE = /^\/+(?:cgi-bin|vendor\/phpunit|wp-admin|wp-login|wp-content|xmlrpc\.php|\.env|\.git)(?:\/|$)/i;
  app.use("*", async (c, next) => {
    const p = c.req.path;
    if (SCANNER_PROBE_RE.test(p) || SCANNER_PATH_RE.test(p)) {
      return c.text("Not Found", 404);
    }
    await next();
  });

  // Static asset caching & performance headers (strictly non-visual / non-functional)
  app.use("*", async (c, next) => {
    await next();
    const p = c.req.path.toLowerCase();
    if (/^\/+(api|crm|admin|v1|webhooks|dev)(\/|$)/.test(p)) return;
    if (c.res.headers.has("Cache-Control")) return;

    if (p.endsWith(".css") || p.endsWith(".js")) {
      c.res.headers.set("Cache-Control", "public, max-age=604800, stale-while-revalidate=86400");
    } else if (/\.(png|jpe?g|gif|svg|webp|ico|woff2?|ttf|exe|msi|dmg|apk|mobileconfig)$/.test(p)) {
      c.res.headers.set("Cache-Control", "public, max-age=2592000, stale-while-revalidate=604800");
    } else if (p === "/robots.txt" || p === "/sitemap.xml" || p === "/llms.txt" || p === "/pad.xml" || p.endsWith(".txt")) {
      c.res.headers.set("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
    } else if (c.res.headers.get("content-type")?.includes("text/html")) {
      c.res.headers.set("Cache-Control", "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400");
    }
  });
  // Nothing we accept legitimately needs more than this; protects JSON parsing from huge bodies.
  app.use("/api/*", bodyLimit({ maxSize: 256 * 1024, onError: (c) => c.json({ error: "payload_too_large" }, 413) }));
  app.use("/v1/*", bodyLimit({ maxSize: 256 * 1024, onError: (c) => c.json({ error: "payload_too_large" }, 413) }));
  app.use("/webhooks/*", bodyLimit({ maxSize: 1024 * 1024, onError: (c) => c.json({ error: "payload_too_large" }, 413) }));

  app.get("/health", (c) => {
    let dbOk = false;
    try {
      dbOk = Boolean(repo.db.prepare("SELECT 1 AS ok").get());
    } catch {
      dbOk = false;
    }
    return c.json({ ok: dbOk, db: dbOk, ts: Math.floor(Date.now() / 1000) }, dbOk ? 200 : 503);
  });

  // Apple Pay Web Domain Verification File (Required by Stripe & Apple for Safari Apple Pay)
  app.get("/.well-known/apple-developer-merchantid-domain-association", (c) => {
    const file = "./public/.well-known/apple-developer-merchantid-domain-association";
    if (!existsSync(file)) return c.notFound();
    c.header("Content-Type", "text/plain; charset=utf-8");
    c.header("Cache-Control", "public, max-age=86400");
    return c.body(readFileSync(file, "utf-8"));
  });

  // Android Digital Asset Links (App Links autoVerify for https://sweeprcleaner.com/pair)
  app.get("/.well-known/assetlinks.json", (c) => {
    const baseFingerprint = "62:53:82:F9:86:E2:6B:13:DB:4F:F8:57:CD:F0:F0:D7:4C:C6:36:F3:56:6C:5F:54:03:C7:55:EC:2A:19:83:D7";
    const extraFingerprints = String(process.env.ANDROID_ASSETLINKS_SHA256 ?? "")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter((s) => s.length > 0 && s !== baseFingerprint);
    const fingerprints = [baseFingerprint, ...extraFingerprints];
    c.header("Cache-Control", "public, max-age=86400");
    return c.json([
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: "com.sweepr.app",
          sha256_cert_fingerprints: fingerprints,
        },
      },
    ]);
  });

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

  // ---------- SEO Intelligence suite ----------
  const seoStore = new SeoStore(repo.db);
  seoStore.pruneBotHits(90);
  let botHitsSincePrune = 0;
  // Record claimed search-engine / AI-crawler visits (by User-Agent) for the CRM "Crawlers & AI" view.
  app.use("*", async (c, next) => {
    await next();
    const bot = detectBot(c.req.header("user-agent"));
    if (!bot || !isTrackablePath(c.req.path)) return;
    try {
      seoStore.recordBotHit(bot, c.req.path, c.res.status);
      syncToCentralCrm("/api/crm/seo/bot-hit?project=cleaner", {
        user_agent: c.req.header("user-agent") || "",
        path: c.req.path,
        status: c.res.status,
      });
      if (++botHitsSincePrune >= 5000) {
        botHitsSincePrune = 0;
        seoStore.pruneBotHits(90);
      }
    } catch (e) {
      console.warn("[seo] bot hit logging failed:", (e as Error).message);
    }
  });
  const seoSiteUrl = config.seo?.siteUrl || "https://sweeprcleaner.com";
  app.route(
    "/api/crm/seo",
    createSeoRouter({
      store: seoStore,
      providers: {
        siteUrl: seoSiteUrl,
        gscSiteUrl: config.seo?.gscSiteUrl,
        gscServiceAccountJson: config.seo?.gscServiceAccountJson,
        googleApiKey: config.seo?.googleApiKey,
        openPageRankApiKey: config.seo?.openPageRankApiKey,
        dataForSeoLogin: config.seo?.dataForSeoLogin,
        dataForSeoPassword: config.seo?.dataForSeoPassword,
        dataForSeoLocationCode: config.seo?.dataForSeoLocationCode,
        dataForSeoLanguageCode: config.seo?.dataForSeoLanguageCode,
      },
      // Audits the running app in-process (no network), so it works locally and before deploys.
      localFetcher: async (path) => app.request(path, { headers: { "user-agent": AUDIT_USER_AGENT } }),
      seedPaths: ["/", "/clean", ...getCleanItems().map((i) => `/clean/${i.category}/${i.slug}`)],
      defaultKeywords: [
        ["sweepr cleaner", "brand", "/"],
        ["sweepr", "brand", "/"],
        ["ccleaner alternative", "competitor", "/alternatives/ccleaner"],
        ["sweepr vs ccleaner", "competitor", "/vs/ccleaner"],
        ...getCleanItems().map((i): [string, string, string] => [
          `${i.slug.replace(/-/g, " ")}${i.category === "folder" ? " folder" : ""}`,
          `pseo-${i.category}`,
          `/clean/${i.category}/${i.slug}`,
        ]),
      ],
    })
  );

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
    if (!existsSync(file)) return c.notFound();
    c.header("Cache-Control", "no-store, no-cache, must-revalidate");
    return c.html(readFileSync(file, "utf-8"));
  });
  app.get("/admin", (c) => c.redirect("/crm"));

  // If a visitor filled out checkout details on /order in the last 30 minutes (sweepr_order_draft=1 cookie),
  // redirect any public HTML page revisit straight back to /order with their prefilled details.
  const ORDER_DRAFT_REDIRECT_PATHS = /^\/+(?:|(?:de|fr|es)(?:\/+pricing)?|pricing(?:\.html)?|login(?:\.html)?|terms(?:\.html)?|privacy(?:\.html)?|support(?:\.html)?|refund(?:\.html)?|vs\/+[^/]+|alternatives\/+[^/]+|clean(?:\/+[^/]+\/+[^/]+)?)$/i;
  app.use("*", async (c, next) => {
    if (c.req.method === "GET" && ORDER_DRAFT_REDIRECT_PATHS.test(c.req.path)) {
      const ua = c.req.header("user-agent");
      if (!detectBot(ua) && ua !== AUDIT_USER_AGENT && getCookie(c, "sweepr_order_draft") === "1") {
        c.header("Cache-Control", "private, no-store, no-cache, must-revalidate");
        return c.redirect("/order", 302);
      }
    }
    await next();
  });

  // Explicit HTML page routes for clean URLs
  const renderHtmlFileWithLocale = (c: Context, file: string, lang = "en") => {
    if (!existsSync(file)) return c.notFound();
    let html = readFileSync(file, "utf-8");
    if (lang !== "en") {
      html = html.replace(/<html\s+lang="en"/i, `<html lang="${escapeHtml(lang)}"`);
    }
    return c.html(html);
  };

  const handleHomeRoute = async (c: Context) => renderHtmlFileWithLocale(c, "./public/index.html", "en");
  app.get("/", handleHomeRoute);
  app.get("/index.html", (c) => c.redirect("/", 301));

  for (const loc of ["de", "fr", "es"] as const) {
    app.get(`/${loc}`, (c) => renderHtmlFileWithLocale(c, "./public/index.html", loc));
    app.get(`/${loc}/pricing`, (c) => renderHtmlFileWithLocale(c, "./public/pricing.html", loc));
    app.get(`/${loc}/order`, (c) => renderHtmlFileWithLocale(c, "./public/order.html", loc));
  }

  const handleOrderRoute = (c: Context) => {
    const file = "./public/order.html";
    return existsSync(file) ? c.html(readFileSync(file, "utf-8")) : c.notFound();
  };
  app.get("/order", handleOrderRoute);
  app.get("/order.html", handleOrderRoute);
  app.get("/checkout", handleOrderRoute);
  app.get("/pricing", (c) => {
    const file = "./public/pricing.html";
    return existsSync(file) ? c.html(readFileSync(file, "utf-8")) : c.notFound();
  });
  app.get("/pricing.html", (c) => c.redirect("/pricing", 301));
  app.get("/login", (c) => {
    const file = "./public/login.html";
    return existsSync(file) ? c.html(readFileSync(file, "utf-8")) : c.notFound();
  });
  app.get("/login.html", (c) => c.redirect("/login", 301));
  app.get("/terms", (c) => {
    const file = "./public/terms.html";
    return existsSync(file) ? c.html(readFileSync(file, "utf-8")) : c.notFound();
  });
  app.get("/terms.html", (c) => c.redirect("/terms", 301));
  app.get("/privacy", (c) => {
    const file = "./public/privacy.html";
    return existsSync(file) ? c.html(readFileSync(file, "utf-8")) : c.notFound();
  });
  app.get("/privacy.html", (c) => c.redirect("/privacy", 301));
  app.get("/support", (c) => {
    const file = "./public/support.html";
    return existsSync(file) ? c.html(readFileSync(file, "utf-8")) : c.notFound();
  });
  app.get("/support.html", (c) => c.redirect("/support", 301));
  app.get("/refund", (c) => {
    const file = "./public/refund.html";
    return existsSync(file) ? c.html(readFileSync(file, "utf-8")) : c.notFound();
  });
  app.get("/refund.html", (c) => c.redirect("/refund", 301));
  app.get("/vs/:competitor", (c) => {
    const raw = String(c.req.param("competitor") ?? "");
    if (raw.toLowerCase().endsWith(".html")) {
      const clean = raw.slice(0, -5).toLowerCase().replace(/[^a-z0-9-]/g, "");
      return c.redirect(`/vs/${clean}`, 301);
    }
    const competitor = raw.toLowerCase().replace(/[^a-z0-9-]/g, "");
    const file = `./public/vs/${competitor}.html`;
    return existsSync(file) ? c.html(readFileSync(file, "utf-8")) : c.notFound();
  });
  app.get("/alternatives/:competitor", (c) => {
    const raw = String(c.req.param("competitor") ?? "");
    if (raw.toLowerCase().endsWith(".html")) {
      const clean = raw.slice(0, -5).toLowerCase().replace(/[^a-z0-9-]/g, "");
      return c.redirect(`/alternatives/${clean}`, 301);
    }
    const competitor = raw.toLowerCase().replace(/[^a-z0-9-]/g, "");
    const file = `./public/alternatives/${competitor}.html`;
    return existsSync(file) ? c.html(readFileSync(file, "utf-8")) : c.notFound();
  });
  app.get("/clean", (c) => c.html(renderPseoDirectory()));
  app.get("/clean/:category/:slug", (c) => {
    const category = String(c.req.param("category") ?? "").toLowerCase();
    const rawSlug = String(c.req.param("slug") ?? "");
    let cleanSlug = rawSlug.toLowerCase().replace(/%20|\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");

    // Legacy / historical redirect aliases
    if (category === "folder" && cleanSlug === "davinci-resolve-render-cache") {
      return c.redirect("/clean/folder/davinci-resolve-fusion-cache", 301);
    }
    if (category === "folder" && cleanSlug === "localappdata-explorer-thumbcache-db") {
      return c.redirect("/clean/folder/windows-iconcache-db", 301);
    }
    if (category === "app" && (cleanSlug === "qbittorrent-itunes-logs" || rawSlug.includes("qBittorrent"))) {
      cleanSlug = "qbittorrent-itunes-logs";
    }
    if (category === "folder" && cleanSlug.startsWith("recycle-bin-hidden")) {
      cleanSlug = "recycle-bin-hidden-folder";
    }

    if (rawSlug !== cleanSlug) {
      return c.redirect(`/clean/${category}/${cleanSlug}`, 301);
    }

    const item = getCleanItems().find((i) => i.category === category && i.slug === cleanSlug);
    if (!item) return c.notFound();
    return c.html(renderPseoPage(item));
  });
  // NOTE: `msg` is trusted, server-authored HTML (pickerPage injects links). Never pass user input as `msg`.
  const page = (rawTitle: string, msg: string, downloadLink = false) => {
    const title = escapeHtml(rawTitle);
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${title}</title><link rel="icon" type="image/svg+xml" href="/favicon.svg"><link rel="alternate icon" type="image/png" href="/favicon.png"><link rel="shortcut icon" href="/favicon.ico"></head><body style="font-family:system-ui, -apple-system, sans-serif;background:#ffffff;background-image:radial-gradient(circle at 10% 20%, rgba(220, 255, 230, 0.4) 0%, rgba(255, 255, 255, 1) 40%),radial-gradient(circle at 90% 80%, rgba(240, 255, 250, 0.5) 0%, rgba(255, 255, 255, 1) 40%);color:#1f2937;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px;box-sizing:border-box;"><div style="text-align:center;padding:28px 22px;background:rgba(255,255,255,0.85);backdrop-filter:blur(24px);border:1px solid rgba(0,0,0,0.06);border-radius:20px;box-shadow:0 8px 32px rgba(0,0,0,0.06);width:100%;max-width:420px;box-sizing:border-box;"><h1 style="margin-top:0;font-size:24px;line-height:1.25;">${title}</h1><p style="color:#6b7280;line-height:1.5;font-size:15px;">${msg}</p>${downloadLink ? '<a href="/download" style="display:inline-block;margin-top:20px;background:#10b981;color:#fff;padding:12px 24px;border-radius:12px;text-decoration:none;font-weight:bold;box-shadow:0 4px 12px rgba(16,185,129,0.25);">Download SWEEPR Cleaner</a>' : ''}</div></body></html>`;
  };

  // ---------- Smart download: one button, the right app for every device ----------
  type Platform = "windows" | "mac" | "linux" | "android" | "ios";

  const DESKTOP_FILES: Record<Platform, { file: string; type: string; label: string }> = {
    windows: { file: "SWEEPRCleaner.exe", type: "application/vnd.microsoft.portable-executable", label: "Windows" },
    mac: { file: "SWEEPRCleaner.dmg", type: "application/x-apple-diskimage", label: "Mac" },
    linux: { file: "SWEEPRCleaner.AppImage", type: "application/x-executable", label: "Linux" },
    android: { file: "SWEEPRCleaner.apk", type: "application/vnd.android.package-archive", label: "Android" },
    ios: { file: "SWEEPRCleaner.mobileconfig", type: "application/x-apple-aspen-config; charset=utf-8", label: "iPhone & iPad" },
  };

  /** Order matters: Android and ChromeOS user agents also contain "Linux". */
  const detectPlatform = (ua: string, chPlatform = "", chMobile = ""): Platform | null => {
    if (/iphone|ipad|ipod/.test(ua) || chPlatform.includes("ios")) return "ios";
    if (/android/.test(ua) || chPlatform.includes("android") || (chMobile === "?1" && /linux|x11/.test(ua)) || /mobile|iemobile|opera mini/.test(ua)) return "android";
    if (/cros/.test(ua)) return null;
    if (/windows/.test(ua) || chPlatform.includes("win")) return "windows";
    if (/macintosh|mac os x/.test(ua) || chPlatform.includes("mac")) return "mac";
    if (/linux|x11/.test(ua) || chPlatform.includes("linux")) return "linux";
    return null;
  };

  const pickerPage = (heading: string, msg: string, ua = "", host = "sweeprcleaner.com") => {
    const btn = (href: string, text: string, primary = true) =>
      `<a href="${href}" style="display:block;margin-top:10px;background:${primary ? "#10b981" : "#0f172a"};color:#fff;padding:13px 20px;border-radius:12px;text-decoration:none;font-weight:bold;font-size:15px;">${text}</a>`;
    const hasMac = existsSync("./public/SWEEPRCleaner.dmg");
    const hasLinux = existsSync("./public/SWEEPRCleaner.AppImage");
    const hasAndroid = existsSync("./public/SWEEPRCleaner.apk");
    const isNonSafariIos = /iphone|ipad|ipod/.test(ua) && (/crios|fxios|edgios|opios|instagram|fban|fbav|tiktok|line\/|wv/.test(ua) || !ua.includes("safari"));
    const isAndroidWebView = /android/.test(ua) && /\bwv\b|instagram|fban|fbav|tiktok|bytedancewebview|line\/|micromessenger|reddit/.test(ua);
    const cleanHost = host.replace(/^https?:\/\//, "");
    const assistBanner = isNonSafariIos
      ? `<div style="margin:12px 0;padding:14px;border-radius:14px;border:2px solid #10b981;background:#ecfdf5;text-align:left;font-size:13px;color:#064e3b;"><strong>📱 iPhone / iPad Detected:</strong> Apple requires iOS Configuration Profiles to be opened in Safari, or you can launch the iOS app directly:${btn(`x-safari-https://${cleanHost}/download?platform=ios&direct=1`, "🧭 Open in Safari & Install iOS App", true)}${btn("/ios-app", "🚀 Launch SWEEPR Cleaner iOS App", false)}</div>`
      : isAndroidWebView
      ? `<div style="margin:12px 0;padding:14px;border-radius:14px;border:2px solid #10b981;background:#ecfdf5;text-align:left;font-size:13px;color:#064e3b;"><strong>📱 Android Detected:</strong> Downloading SWEEPRCleaner.apk... If your in-app browser blocks APK installs, tap below to open in Chrome:${btn(`intent://${cleanHost}/download?platform=android&direct=1#Intent;scheme=https;package=com.android.chrome;end`, "🌐 Open in Chrome & Install APK", true)}<iframe src="/download?platform=android&direct=1" style="display:none"></iframe></div>`
      : "";
    const links =
      assistBanner +
      (hasAndroid ? btn("/download?platform=android&direct=1", "📱 Download for Android (.apk)", true) : "") +
      btn("/download?platform=ios&direct=1", "🍎 Install on iPhone & iPad (iOS / iPadOS)", true) +
      btn("/download?platform=windows", "💻 Download for Windows 10 & 11 (.exe)", true) +
      (hasMac ? btn("/download?platform=mac", "🍏 Download for Mac — macOS 11+ Universal (.dmg)", true) : "") +
      (hasLinux ? btn("/download?platform=linux", "Download for Linux (.AppImage)", false) : "") +
      `<div style="margin-top:16px;padding-top:14px;border-top:1px solid rgba(0,0,0,0.08);font-size:13px;color:#4b5563;">Already purchased on another device? Log in to your Customer Portal to activate this device via QR code:<a href="/login" style="display:block;margin-top:10px;background:#111827;color:#fff;padding:12px 18px;border-radius:12px;text-decoration:none;font-weight:bold;">Customer Login &amp; QR Activation &rarr;</a><a href="/" style="display:inline-block;margin-top:12px;color:#059669;text-decoration:none;font-weight:600;">&larr; Back to Home</a></div>`;
    return page(heading, `${msg}</p>${links}<p style="display:none">`);
  };

  /** Streams a file from disk (no full in-memory buffering) with an explicit Content-Length and edge caching headers. */
  const streamFile = (path: string, type: string, filename: string) => {
    const stat = statSync(path);
    const body = Readable.toWeb(createReadStream(path)) as unknown as ReadableStream<Uint8Array>;
    return new Response(body, {
      headers: {
        "Content-Type": type,
        "Content-Length": String(stat.size),
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "public, max-age=3600, s-maxage=86400",
      },
    });
  };

  app.get("/Sweepr_Setup.exe", (c) => c.redirect("/download?platform=windows", 302));
  app.get("/Sweepr_Setup.dmg", (c) => c.redirect("/download?platform=mac", 302));
  app.get("/SWEEPRCleaner.apk", (c) => c.redirect("/download?platform=android&direct=1", 302));
  app.get("/SWEEPRCleaner.mobileconfig", (c) => c.redirect("/download?platform=ios&direct=1", 302));

  app.get("/ios-app", (c) => {
    c.header("X-Robots-Tag", "noindex, nofollow");
    return c.html(`<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<title>SWEEPR Cleaner</title>
<style>
  :root[data-theme="light"]{--bg:#f8fafc;--card:#ffffff;--card-sub:#f1f5f9;--glass:rgba(255,255,255,.94);--text:#0f172a;--muted:#64748b;--border:#e2e8f0;--border-strong:#cbd5e1;--accent:#059669;--accent-soft:#d1fae5;--accent-fg:#065f46;--accent-border:#10b981;--orb-bg:radial-gradient(circle at 30% 30%,#10b981,#059669);--orb-border:#34d399;--orb-ring:rgba(16,185,129,.16);--shadow:0 8px 24px rgba(15,23,42,.06);--input-bg:#ffffff}
  :root[data-theme="dark"]{--bg:#070b14;--card:#0f172a;--card-sub:#1e293b;--glass:rgba(15,23,42,.94);--text:#f8fafc;--muted:#94a3b8;--border:rgba(148,163,184,.16);--border-strong:rgba(148,163,184,.32);--accent:#10b981;--accent-soft:rgba(16,185,129,.16);--accent-fg:#34d399;--accent-border:rgba(52,211,153,.45);--orb-bg:radial-gradient(circle at 30% 30%,#34d399,#059669);--orb-border:#6ee7b7;--orb-ring:rgba(16,185,129,.22);--shadow:0 12px 30px rgba(0,0,0,.4);--input-bg:#090d16}
  *{box-sizing:border-box;margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Inter,sans-serif;-webkit-tap-highlight-color:transparent}
  .mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-variant-numeric:tabular-nums}
  body{background:var(--bg);color:var(--text);min-height:100vh;padding:66px 16px 86px;display:flex;flex-direction:column}
  .topbar{position:fixed;top:0;left:0;right:0;height:58px;background:var(--glass);backdrop-filter:blur(14px);border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;padding:0 14px;z-index:100}
  .icon-btn{width:38px;height:38px;border-radius:11px;border:1px solid var(--border);background:var(--card);color:var(--text);display:flex;align-items:center;justify-content:center;cursor:pointer}
  .badge{font-size:11px;font-weight:800;padding:5px 10px;border-radius:999px;background:var(--accent-soft);color:var(--accent-fg);border:1px solid var(--accent-border)}
  .view{display:none;flex-direction:column;flex:1;max-width:460px;width:100%;margin:0 auto;gap:14px}
  .view.active{display:flex}
  .c3-orb-stage{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:18px 0}
  .c3-power-orb{width:156px;height:156px;border-radius:999px;border:5px solid var(--orb-border);background:var(--orb-bg);color:#fff;box-shadow:0 18px 44px rgba(16,185,129,.36),0 0 0 14px var(--orb-ring);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;cursor:pointer}
  .card{background:var(--card);border:1px solid var(--border);border-radius:22px;padding:18px;box-shadow:var(--shadow)}
  .input{width:100%;padding:12px 14px;border-radius:13px;border:1px solid var(--border-strong);background:var(--input-bg);color:var(--text);font-size:13.5px;margin-top:8px}
  .btn-primary{width:100%;padding:14px;border-radius:14px;border:none;background:linear-gradient(135deg,#10b981,#059669);color:#fff;font-weight:900;font-size:14px;margin-top:12px;cursor:pointer}
  .bottom-nav{position:fixed;bottom:0;left:0;right:0;height:68px;background:var(--glass);backdrop-filter:blur(14px);border-top:1px solid var(--border);display:grid;grid-template-columns:repeat(3,1fr);padding:6px 10px 10px;gap:6px;z-index:100}
  .nav-tab{border:none;background:transparent;color:var(--muted);border-radius:13px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;font-size:11px;font-weight:800;cursor:pointer}
  .nav-tab.active{color:var(--accent-fg);background:var(--accent-soft)}
</style>
</head>
<body>
  <header class="topbar">
    <div style="display:flex;align-items:center;gap:8px;font-weight:900;font-size:16px">
      <div style="width:30px;height:30px;border-radius:9px;background:linear-gradient(135deg,#10b981,#059669);color:#fff;display:flex;align-items:center;justify-content:center">S</div>
      <span>SWEEPR <span style="color:var(--accent)">Cleaner</span></span>
    </div>
    <div style="display:flex;align-items:center;gap:8px">
      <span id="proBadge" class="badge">Ready</span>
      <button class="icon-btn" onclick="toggleTheme()" aria-label="Toggle Light/Dark Mode">☀️</button>
    </div>
  </header>

  <main id="view-home" class="view active">
    <div style="text-align:center;padding-top:10px">
      <div class="badge" style="display:inline-block">SMART STORAGE SHIELD</div>
      <div id="scanHeadline" style="font-size:22px;font-weight:900;margin-top:12px">Tap Orb to Smart Scan</div>
      <div id="scanOut" style="font-size:13px;color:var(--muted);font-weight:600;margin-top:4px">Finds duplicate photos, burst shots &amp; cache</div>
    </div>

    <div class="c3-orb-stage">
      <button id="scanBtn" class="c3-power-orb" onclick="runIosScan()">
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>
        <span id="orbTxt" class="mono" style="font-size:11.5px;font-weight:900;letter-spacing:.06em">SMART SCAN</span>
      </button>
    </div>

    <div style="margin-top:auto;display:flex;flex-direction:column;gap:10px">
      <input id="iosFilePicker" type="file" multiple accept="image/*,video/*,*/*" style="display:none" onchange="onIosFilesSelected(this.files)" />
      <button id="pickFilesBtn" onclick="document.getElementById('iosFilePicker').click()" class="card" style="padding:11px 14px;border-radius:14px;font-size:12.5px;font-weight:800;text-align:center;cursor:pointer;color:var(--accent-fg)">Select Photos / Videos to Check for Real Duplicates (SHA-256)</button>
      <button id="cleanBtn" onclick="cleanIosStorage()" class="btn-primary" style="display:none;margin-top:0">Clean Web Cache &amp; Duplicate Report</button>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="card" style="padding:11px 14px;border-radius:16px;display:flex;justify-content:space-between;font-size:12px;font-weight:700"><span style="color:var(--muted)">Engine</span><span class="mono">SHA-256 + Quota</span></div>
        <div class="card" style="padding:11px 14px;border-radius:16px;display:flex;justify-content:space-between;font-size:12px;font-weight:700"><span style="color:var(--muted)">Reclaimable</span><span id="targetBytesLabel" class="mono" style="color:var(--accent-fg)">Tap Scan</span></div>
      </div>
    </div>
  </main>

  <section id="view-account" class="view">
    <div class="card">
      <div style="font-size:16px;font-weight:900">Activate Device</div>
      <p style="font-size:12px;color:var(--muted);margin-top:4px;line-height:1.45">Enter your email and tap <strong>Send 6-Digit Code</strong>, or paste your <code>ptk_...</code> pairing code from <strong>sweeprcleaner.com/dashboard</strong>.</p>
      <input id="emailInput" class="input" type="email" placeholder="Account Email (you@example.com)" />
      <button id="sendIosOtpBtn" class="card" style="width:100%;padding:10px;border-radius:12px;font-size:12.5px;font-weight:800;margin-top:8px;cursor:pointer;color:var(--accent-fg)" onclick="sendIosOtp()">Send 6-Digit Code to Email</button>
      <input id="codeInput" class="input mono" placeholder="ptk_... or 6-digit code" />
      <button class="btn-primary" onclick="activateIos()">Activate Pro on This Device</button>
      <div id="actMsg" style="font-size:12px;margin-top:8px;font-weight:700"></div>
    </div>
  </section>

  <section id="view-support" class="view">
    <div class="card">
      <div style="font-size:16px;font-weight:900">Message SWEEPR Support</div>
      <input id="supEmail" class="input" type="email" placeholder="Your email address" />
      <textarea id="supMsg" class="input" rows="3" placeholder="How can we help?"></textarea>
      <button id="supBtn" class="btn-primary" onclick="sendCleanerIosSupport()">Send Message</button>
      <div id="supStatus" style="font-size:12px;margin-top:8px;font-weight:700"></div>
    </div>
  </section>

  <nav class="bottom-nav">
    <button class="nav-tab active" id="tab-home" onclick="switchTab('home')"><span>Clean</span></button>
    <button class="nav-tab" id="tab-account" onclick="switchTab('account')"><span>Profile</span></button>
    <button class="nav-tab" id="tab-support" onclick="switchTab('support')"><span>Support</span></button>
  </nav>

<script>
  let lastScanReclaimableBytes = 0;
  let duplicateFileNames = [];
  function fmtBytes(b){if(!b||b<=0)return '0 B';if(b>=1073741824)return (b/1073741824).toFixed(2)+' GB';if(b>=1048576)return (b/1048576).toFixed(2)+' MB';if(b>=1024)return (b/1024).toFixed(1)+' KB';return b+' B';}
  function toggleTheme(){const cur=document.documentElement.getAttribute('data-theme')||'light';const next=cur==='dark'?'light':'dark';document.documentElement.setAttribute('data-theme',next);localStorage.setItem('sweepr_cln_theme',next);}
  function switchTab(t){['home','account','support'].forEach(v=>{document.getElementById('view-'+v).classList.toggle('active',v===t);document.getElementById('tab-'+v).classList.toggle('active',v===t);});}
  function getDevId(){let id=localStorage.getItem('sweepr_cln_ios_id');if(!id){id='ios_'+Math.random().toString(36).slice(2,12)+Date.now().toString(36);localStorage.setItem('sweepr_cln_ios_id',id);}return id;}
  async function runIosScan(){
    const out=document.getElementById('scanOut');
    const head=document.getElementById('scanHeadline');
    const orbTxt=document.getElementById('orbTxt');
    const cBtn=document.getElementById('cleanBtn');
    const tgt=document.getElementById('targetBytesLabel');
    orbTxt.textContent='SCANNING...';
    head.textContent='Inspecting Device Storage...';
    out.textContent='Querying StorageManager quota, Cache API & IndexedDB...';
    let quotaUsage=0, quotaTotal=0, cacheCount=0, idbCount=0, lsBytes=0;
    try{
      if(navigator.storage&&navigator.storage.estimate){
        const est=await navigator.storage.estimate();
        quotaUsage=est.usage||0;
        quotaTotal=est.quota||0;
      }
      if(window.caches&&caches.keys){
        const keys=await caches.keys();
        cacheCount=keys.length;
      }
      if(window.indexedDB&&indexedDB.databases){
        const dbs=await indexedDB.databases();
        idbCount=Array.isArray(dbs)?dbs.length:0;
      }
      for(let i=0;i<localStorage.length;i++){
        const k=localStorage.key(i)||'';
        if(!k.startsWith('sweepr_cln_')){lsBytes+=(k.length+(localStorage.getItem(k)||'').length)*2;}
      }
    }catch{}
    const totalReclaimable=quotaUsage+lsBytes+lastScanReclaimableBytes;
    const label=fmtBytes(totalReclaimable);
    orbTxt.textContent=totalReclaimable>0?(label+' FOUND'):'SCAN DONE';
    head.textContent=totalReclaimable>0?(label+' Reclaimable'):'Web Storage Clean (Select Photos Below)';
    out.textContent='Origin Cache: '+fmtBytes(quotaUsage+lsBytes)+' ('+cacheCount+' caches, '+idbCount+' DBs)'+(duplicateFileNames.length?' • '+duplicateFileNames.length+' duplicate file(s) ('+fmtBytes(lastScanReclaimableBytes)+')':' • Quota: '+fmtBytes(quotaTotal));
    tgt.textContent=label;
    cBtn.textContent='Clean Web Cache & Export Duplicate Report ('+label+')';
    cBtn.style.display='block';
  }
  async function onIosFilesSelected(fileList){
    if(!fileList||!fileList.length)return;
    const out=document.getElementById('scanOut');
    const head=document.getElementById('scanHeadline');
    const orbTxt=document.getElementById('orbTxt');
    const cBtn=document.getElementById('cleanBtn');
    const tgt=document.getElementById('targetBytesLabel');
    orbTxt.textContent='HASHING...';
    head.textContent='Computing SHA-256 Digests...';
    const seen=new Map();
    let dupBytes=0;
    const dups=[];
    for(let i=0;i<fileList.length;i++){
      const f=fileList[i];
      try{
        const buf=await f.arrayBuffer();
        const hashBuf=await crypto.subtle.digest('SHA-256',buf);
        const hashHex=Array.from(new Uint8Array(hashBuf)).map(b=>b.toString(16).padStart(2,'0')).join('');
        if(seen.has(hashHex)){
          dupBytes+=f.size;
          dups.push(f.name+' (duplicate of '+seen.get(hashHex)+')');
        }else{
          seen.set(hashHex,f.name);
        }
      }catch{}
    }
    lastScanReclaimableBytes=dupBytes;
    duplicateFileNames=dups;
    await runIosScan();
  }
  async function cleanIosStorage(){
    const out=document.getElementById('scanOut');
    const head=document.getElementById('scanHeadline');
    const orbTxt=document.getElementById('orbTxt');
    const cBtn=document.getElementById('cleanBtn');
    const tgt=document.getElementById('targetBytesLabel');
    cBtn.disabled=true;cBtn.textContent='Purging caches & temporary storage...';
    let clearedCaches=0;
    try{
      if(window.caches&&caches.keys){
        const keys=await caches.keys();
        for(const k of keys){await caches.delete(k);clearedCaches++;}
      }
      const removeKeys=[];
      for(let i=0;i<localStorage.length;i++){
        const k=localStorage.key(i)||'';
        if(!k.startsWith('sweepr_cln_'))removeKeys.push(k);
      }
      removeKeys.forEach(k=>localStorage.removeItem(k));
      sessionStorage.clear();
    }catch{}
    const summary=duplicateFileNames.length?('Cleared '+clearedCaches+' cache(s). Duplicates to delete in Photos: '+duplicateFileNames.join(', ')):('Cleared '+clearedCaches+' browser cache(s) & temporary session data.');
    lastScanReclaimableBytes=0;
    duplicateFileNames=[];
    cBtn.style.display='none';cBtn.disabled=false;
    orbTxt.textContent='CLEANED ✓';
    head.textContent='Storage Optimized';
    out.textContent=summary;
    tgt.textContent='0 B';
  }
  async function sendCleanerIosSupport(){
    const email=(document.getElementById('supEmail').value||document.getElementById('emailInput').value||'').trim();
    const message=(document.getElementById('supMsg').value||'').trim();
    const st=document.getElementById('supStatus');
    const btn=document.getElementById('supBtn');
    if(!email||!email.includes('@')){st.style.color='#ef4444';st.textContent='Please enter a valid email address.';return;}
    if(!message){st.style.color='#ef4444';st.textContent='Please enter a message.';return;}
    btn.disabled=true;st.style.color='var(--muted)';st.textContent='Sending...';
    let ok=false;
    for(const u of ['/v1/support','http://127.0.0.1:8788/api/support/contact']){
      try{
        const r=await fetch(u,{method:'POST',headers:{'Content-Type':'application/json','x-sweepr-project':'cleaner'},body:JSON.stringify({project_id:'cleaner',email,subject:'SWEEPR Cleaner iOS Support',message,platform:'ios',os:'ios'})});
        if(r.ok){ok=true;break;}
      }catch{}
    }
    btn.disabled=false;
    if(ok){document.getElementById('supMsg').value='';st.style.color='var(--accent-fg)';st.textContent="Sent to SWEEPR Support — we'll reply by email.";}
    else{st.style.color='#ef4444';st.textContent='Could not reach support server.';}
  }
  async function sendIosOtp(){
    const email=(document.getElementById('emailInput').value||'').trim();
    const msg=document.getElementById('actMsg');
    if(!email||!email.includes('@')){msg.style.color='#ef4444';msg.textContent='Enter your email address first.';return;}
    msg.style.color='var(--muted)';msg.textContent='Sending 6-digit code...';
    try{
      const r=await fetch('/v1/account/send-otp',{method:'POST',headers:{'Content-Type':'application/json','x-sweepr-project':'cleaner'},body:JSON.stringify({email,project_id:'cleaner'})});
      const d=await r.json();
      if(r.ok&&d.ok){msg.style.color='var(--accent-fg)';msg.textContent='6-digit code sent to '+email+'! Enter it below.';}
      else{msg.style.color='#ef4444';msg.textContent=d.error||'Could not send code.';}
    }catch{msg.style.color='#ef4444';msg.textContent='Network error.';}
  }
  async function activateIos(){
    const raw=(document.getElementById('codeInput').value||'').trim();
    const email=(document.getElementById('emailInput').value||'').trim();
    const msg=document.getElementById('actMsg');
    if(!raw){msg.style.color='#ef4444';msg.textContent='Enter your ptk_ pairing code or 6-digit code.';return;}
    msg.style.color='var(--muted)';msg.textContent='Verifying...';
    try{
      const ptk=raw.match(/ptk_[A-Za-z0-9_-]{12,64}/);
      const url=ptk?'/api/device-link/redeem':'/v1/account/verify-otp';
      const body=ptk
        ?{token:ptk[0],device_id:getDevId(),device_type:'mobile',device_name:'iPhone / iPad',platform:'ios',project_id:'cleaner'}
        :{email,code:raw,device_id:getDevId(),device_type:'mobile',platform:'ios',device_label:'iPhone / iPad',project_id:'cleaner'};
      const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','x-sweepr-project':'cleaner'},body:JSON.stringify(body)});
      const d=await r.json();
      if(r.ok&&(d.ok||d.token||d.refresh_token)){
        localStorage.setItem('sweepr_cln_token',d.token||d.refresh_token||'active');
        document.getElementById('proBadge').textContent=d.active?'PRO ACTIVE':'LINKED';
        msg.style.color='var(--accent-fg)';msg.textContent=d.active?'Pro Activated on this iPhone / iPad!':'Account linked on this iPhone / iPad!';
      }else{
        msg.style.color='#ef4444';msg.textContent=d.message||d.error||'Invalid code.';
      }
    }catch{msg.style.color='#ef4444';msg.textContent='Network error.';}
  }
  (function(){
    const savedTheme=localStorage.getItem('sweepr_cln_theme')||'light';
    document.documentElement.setAttribute('data-theme',savedTheme);
    if(localStorage.getItem('sweepr_cln_token'))document.getElementById('proBadge').textContent='PRO ACTIVE';
  })();
</script>
</body></html>`);
  });

  app.get("/download", (c) => {
    c.header("X-Robots-Tag", "noindex, nofollow");
    const ua = c.req.header("user-agent")?.toLowerCase() || "";
    const chPlatform = c.req.header("sec-ch-ua-platform")?.toLowerCase() || "";
    const chMobile = c.req.header("sec-ch-ua-mobile")?.toLowerCase() || "";
    const host = c.req.header("host") || "sweeprcleaner.com";
    // ?platform=mac etc. lets people download for a different device (e.g. "Other platforms" links).
    const requested = c.req.query("platform")?.toLowerCase();
    const validPlatforms = ["windows", "mac", "linux", "android", "ios"] as const;
    const platform: Platform | null =
      requested && (validPlatforms as readonly string[]).includes(requested)
        ? (requested as Platform)
        : detectPlatform(ua, chPlatform, chMobile);

    if (!platform || requested === "picker") {
      return c.html(pickerPage("Download SWEEPR Cleaner", "Choose your device platform:", ua, host));
    }

    const { file, type, label } = DESKTOP_FILES[platform];
    const installerPath = `./public/${file}`;
    const hasFile = existsSync(installerPath);

    try {
      repo.recordAnalyticsEvent({
        event_name: "installer_downloaded",
        platform,
        metadata: { installer: file, available: hasFile, referrer: c.req.header("referer") || null },
      });
      syncToCentralCrm("/v1/telemetry/event", {
        event_name: "installer_downloaded",
        category: "funnel",
        os: platform,
        properties: { installer: file, available: hasFile, referrer: c.req.header("referer") || null },
      });
    } catch {}

    if (!hasFile) {
      return c.html(pickerPage(`${label} Version Coming Soon`, `SWEEPR Cleaner for ${label} will be available soon. Other versions:`, ua, host));
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

  let cachedStripeBatteryProductId: string | null = null;
  async function getStripeBatteryProductId(): Promise<string> {
    if (cachedStripeBatteryProductId) return cachedStripeBatteryProductId;
    if (!stripe) throw new Error("Stripe not configured");
    try {
      const existingProducts = await stripe.products.list({ active: true, limit: 20 });
      const match = existingProducts.data.find((p) => /battery.*care/i.test(p.name));
      if (match) {
        cachedStripeBatteryProductId = match.id;
        return match.id;
      }
      const created = await stripe.products.create({
        name: "Total Battery & Mac/Phone Care — Device Lifespan Extender",
        description: "Smart 80% Charge-Limiter, Automatic Thermal Throttling & Browser Tab Hibernate Add-on",
      });
      cachedStripeBatteryProductId = created.id;
      return created.id;
    } catch {
      return getStripeProductId();
    }
  }

  let cachedStripeCloudVaultProductId: string | null = null;
  async function getStripeCloudVaultProductId(): Promise<string> {
    if (cachedStripeCloudVaultProductId) return cachedStripeCloudVaultProductId;
    if (!stripe) throw new Error("Stripe not configured");
    try {
      const existingProducts = await stripe.products.list({ active: true, limit: 20 });
      const match = existingProducts.data.find((p) => /cloud.*(vault|protection)/i.test(p.name));
      if (match) {
        cachedStripeCloudVaultProductId = match.id;
        return match.id;
      }
      const created = await stripe.products.create({
        name: "SWEEPR Cloud Protection — Encrypted Photo Vault & Multi-Cloud Backup Sync",
        description: "AES-256 Argon2id Encrypted Photo & Document Vault + Automated Multi-Cloud Backup Sync Add-on",
      });
      cachedStripeCloudVaultProductId = created.id;
      return created.id;
    } catch {
      return getStripeProductId();
    }
  }

  const cachedIntroCoupons = new Map<string, string>();
  async function getOrCreateIntroCoupon(currency: string, discountAmount: number): Promise<string> {
    if (!stripe) return stripeCoupon;
    const normCurr = currency.toLowerCase();
    const couponId = `sweepr_intro_${normCurr}_${discountAmount}`;
    if (cachedIntroCoupons.has(couponId)) return cachedIntroCoupons.get(couponId)!;
    try {
      const existingCoupon = await stripe.coupons.retrieve(couponId);
      if (existingCoupon && existingCoupon.id) {
        cachedIntroCoupons.set(couponId, existingCoupon.id);
        return existingCoupon.id;
      }
    } catch {
      // Create currency-specific coupon below
    }
    try {
      const created = await stripe.coupons.create({
        id: couponId,
        currency: normCurr,
        amount_off: discountAmount,
        duration: "once",
        name: "Introductory 1st-Month Offer",
      });
      cachedIntroCoupons.set(couponId, created.id);
      return created.id;
    } catch {
      return stripeCoupon;
    }
  }

  // Currencies supported by Stripe's recurring PayPal integration
  const SUPPORTED_PAYPAL_CURRENCIES = new Set([
    "gbp", "eur", "usd", "aud", "cad", "chf", "czk", "dkk", "hkd",
    "huf", "ils", "jpy", "mxn", "nok", "nzd", "php", "pln", "sek", "sgd",
  ]);

  const SUPPORTED_REVOLUT_CURRENCIES = new Set([
    "gbp", "eur", "usd", "pln", "ron", "czk", "chf", "sek", "nok", "dkk", "bgn", "huf",
  ]);

  const SUPPORTED_AMAZON_PAY_CURRENCIES = new Set([
    "gbp", "eur", "usd", "chf", "sek", "dkk", "nok", "jpy", "aud", "hkd", "nzd",
  ]);

  function resolvePayPalPricing(pricing: ReturnType<typeof getPricingForCountryOrCurrency>) {
    if (SUPPORTED_PAYPAL_CURRENCIES.has(pricing.currency.toLowerCase())) {
      return pricing;
    }
    return getPricingForCountryOrCurrency(pricing.country, "gbp");
  }

  function resolvePaymentMethodPricing(
    pricing: ReturnType<typeof getPricingForCountryOrCurrency>,
    paymentMethod: string
  ) {
    const pm = paymentMethod.toLowerCase();
    const curr = pricing.currency.toLowerCase();
    if (pm === "paypal") {
      return resolvePayPalPricing(pricing);
    }
    if (pm === "ideal" || pm === "bancontact" || pm === "sepa_debit") {
      return curr === "eur" ? pricing : getPricingForCountryOrCurrency(pricing.country, "eur");
    }
    if (pm === "revolut_pay") {
      return SUPPORTED_REVOLUT_CURRENCIES.has(curr)
        ? pricing
        : getPricingForCountryOrCurrency(pricing.country, "gbp");
    }
    if (pm === "amazon_pay") {
      return SUPPORTED_AMAZON_PAY_CURRENCIES.has(curr)
        ? pricing
        : getPricingForCountryOrCurrency(pricing.country, "gbp");
    }
    if (pm === "cashapp") {
      return curr === "usd" ? pricing : getPricingForCountryOrCurrency(pricing.country, "usd");
    }
    if (pm === "kakao_pay" || pm === "naver_pay" || pm === "kr_card") {
      return curr === "krw" ? pricing : getPricingForCountryOrCurrency(pricing.country, "krw");
    }
    return pricing;
  }

  function getGeoPaymentProfile(countryCode: string, currencyCode: string) {
    const c = (countryCode || "GB").toUpperCase();
    const curr = (currencyCode || "gbp").toLowerCase();

    if (c === "NL") {
      return {
        country: c,
        expressWindows: ["ideal", "paypal", "google_pay"],
        expressApple: ["ideal", "apple_pay", "paypal"],
        logoStripMethods: [
          { id: "ideal", label: "iDEAL", tag: "Dutch Bank" },
          { id: "card", label: "Card", tag: "+ Stripe Link" },
          { id: "sepa_debit", label: "SEPA Incasso", tag: "IBAN" },
        ],
        defaultLogoMethod: "ideal",
      };
    }

    if (c === "BE") {
      return {
        country: c,
        expressWindows: ["bancontact", "paypal", "google_pay"],
        expressApple: ["bancontact", "apple_pay", "paypal"],
        logoStripMethods: [
          { id: "bancontact", label: "Bancontact", tag: "#1 in Belgium" },
          { id: "card", label: "Card", tag: "+ Stripe Link" },
          { id: "sepa_debit", label: "SEPA IBAN", tag: "Domiciliëring" },
        ],
        defaultLogoMethod: "bancontact",
      };
    }

    if (c === "DE" || c === "AT") {
      return {
        country: c,
        expressWindows: ["paypal", "sepa_debit", "google_pay"],
        expressApple: ["paypal", "apple_pay", "sepa_debit"],
        logoStripMethods: [
          { id: "sepa_debit", label: "SEPA IBAN", tag: "Lastschrift" },
          { id: "card", label: "Card", tag: "+ Stripe Link" },
          { id: "amazon_pay", label: "Amazon Pay", tag: "1-Click" },
        ],
        defaultLogoMethod: "sepa_debit",
      };
    }

    if (c === "KR" || curr === "krw") {
      return {
        country: c,
        expressWindows: ["kakao_pay", "naver_pay", "paypal"],
        expressApple: ["kakao_pay", "naver_pay", "apple_pay"],
        logoStripMethods: [
          { id: "kakao_pay", label: "Kakao Pay", tag: "#1 in Korea" },
          { id: "naver_pay", label: "Naver Pay", tag: "1-Click" },
          { id: "card", label: "Card", tag: "kr_card" },
        ],
        defaultLogoMethod: "kakao_pay",
      };
    }

    if (["FR", "ES", "IT", "IE", "PT", "FI", "LU", "GR"].includes(c) || curr === "eur") {
      return {
        country: c,
        expressWindows: ["paypal", "google_pay", "revolut_pay"],
        expressApple: ["apple_pay", "paypal", "revolut_pay"],
        logoStripMethods: [
          {
            id: "card",
            label: "Card",
            tag: "+ Stripe Link",
          },
          { id: "revolut_pay", label: "Revolut Pay", tag: "1-Click App" },
          {
            id: "sepa_debit",
            label: "SEPA IBAN",
            tag: "Direct Debit",
          },
        ],
        defaultLogoMethod: "card",
      };
    }

    if (c === "US") {
      return {
        country: c,
        expressWindows: ["paypal", "google_pay", "amazon_pay"],
        expressApple: ["apple_pay", "paypal", "google_pay"],
        logoStripMethods: [
          { id: "card", label: "Card", tag: "+ Stripe Link" },
          { id: "cashapp", label: "Cash App", tag: "Instant Mobile" },
          { id: "amazon_pay", label: "Amazon Pay", tag: "Use Amazon" },
        ],
        defaultLogoMethod: "card",
      };
    }

    if (c === "CA" || c === "AU" || c === "NZ") {
      return {
        country: c,
        expressWindows: ["paypal", "google_pay", "amazon_pay"],
        expressApple: ["apple_pay", "paypal", "google_pay"],
        logoStripMethods: [
          { id: "card", label: "Card", tag: "+ Stripe Link" },
          { id: "amazon_pay", label: "Amazon Pay", tag: "Use Amazon" },
          { id: "revolut_pay", label: "Revolut Pay", tag: "1-Click App" },
        ],
        defaultLogoMethod: "card",
      };
    }

    // Default: UK (GB), Poland, Nordics, Switzerland, Rest of World
    return {
      country: c,
      expressWindows: ["paypal", "google_pay", "revolut_pay"],
      expressApple: ["apple_pay", "paypal", "google_pay"],
      logoStripMethods: [
        { id: "card", label: "Card", tag: "+ Stripe Link" },
        { id: "revolut_pay", label: "Revolut Pay", tag: "1-Click App" },
        { id: "amazon_pay", label: "Amazon Pay", tag: "Use Amazon" },
      ],
      defaultLogoMethod: "card",
    };
  }

  async function createRedirectCheckoutSessionFallback(opts: {
    customerId: string;
    accountId: string;
    subItems: any[];
    introCouponId: string;
    attributionMeta: Record<string, string>;
    isPopup?: boolean;
    paymentMethod?: string;
  }) {
    if (!stripe) return null;
    const pm = (opts.paymentMethod || "paypal").toLowerCase();
    const pmTypes =
      pm === "ideal"
        ? ["ideal"]
        : pm === "bancontact"
        ? ["bancontact"]
        : [pm];
    const baseSessionParams: any = {
      mode: "subscription",
      customer: opts.customerId,
      client_reference_id: opts.accountId,
      line_items: opts.subItems.map((it: any) => ({
        price_data: it.price_data,
        quantity: 1,
      })),
      ...(opts.introCouponId ? { discounts: [{ coupon: opts.introCouponId }] } : {}),
      subscription_data: { metadata: opts.attributionMeta },
      metadata: opts.attributionMeta,
      success_url: `${config.publicUrl}/checkout/success?web=1&session_id={CHECKOUT_SESSION_ID}&account_id=${encodeURIComponent(opts.accountId)}${opts.isPopup ? "&popup=1" : ""}`,
      cancel_url: `${config.publicUrl}/order?error=payment_cancelled`,
    };
    try {
      return await stripe.checkout.sessions.create({
        ...baseSessionParams,
        managed_payments: { enabled: false },
        payment_method_types: pmTypes,
      } as any);
    } catch {
      try {
        return await stripe.checkout.sessions.create({
          ...baseSessionParams,
          managed_payments: { enabled: false },
        } as any);
      } catch {
        return await stripe.checkout.sessions.create(baseSessionParams);
      }
    }
  }

  const createPayPalCheckoutSessionFallback = createRedirectCheckoutSessionFallback;

  async function retrieveSubscriptionSafe(subscriptionId: string): Promise<Stripe.Subscription> {
    if (!stripe) throw new Error("Stripe not configured");
    try {
      return await stripe.subscriptions.retrieve(subscriptionId, {
        expand: ["default_payment_method", "latest_invoice.payments.data.payment.payment_intent"],
      });
    } catch {
      try {
        return await stripe.subscriptions.retrieve(subscriptionId, {
          expand: ["default_payment_method", "latest_invoice.payment_intent.payment_method"],
        });
      } catch {
        return await stripe.subscriptions.retrieve(subscriptionId);
      }
    }
  }

  // Capture lead with country, device, and datetime when a visitor enters their email on /order or checkout
  app.post("/api/lead", async (c) => {
    if (!limitCheckoutIp.hit(clientIp(c))) return c.json({ error: "rate_limited" }, 429);
    const body = await c.req.json().catch(() => ({}));
    const email = normalizeEmail(body?.email);
    const name = typeof body?.name === "string" ? body.name.trim().slice(0, 120) : "";
    const localizedPricing = await resolvePricingForRequest(c, {
      country: typeof body?.country === "string" ? body.country : undefined,
      currency: typeof body?.currency === "string" ? body.currency : undefined,
      trustProxy,
    });
    const leadDevice = detectLeadDevice(c, typeof body?.device === "string" ? body.device : "web");
    const country = localizedPricing.country;

    if (!email) {
      return c.json({ error: "invalid_email" }, 400);
    }

    const existing = repo.accountByEmail(email);
    let accountId: string;
    if (existing) {
      accountId = existing.id;
      repo.setAccountLeadMeta(accountId, { country, lead_device: leadDevice });
      if (name && !existing.name) {
        repo.updateAccountProfile(accountId, { name });
      }
    } else {
      accountId = `acc_lead_${randomToken(8)}`;
      const refreshToken = randomToken(32);
      repo.createAccount(accountId, sha256(refreshToken), email, null, {
        country,
        lead_device: leadDevice,
        created_at: now(),
      });
      if (name) {
        repo.updateAccountProfile(accountId, { name });
      }
    }

    const acc = repo.accountById(accountId);
    syncToCentralCrm("/v1/leads/capture", {
      email,
      name: name || undefined,
      country: acc?.country ?? country,
      device: acc?.lead_device ?? leadDevice,
      source: "cleaner_checkout_lead",
    });
    return c.json({
      ok: true,
      account_id: accountId,
      country: acc?.country ?? country,
      device: acc?.lead_device ?? leadDevice,
      lead_device: acc?.lead_device ?? leadDevice,
      created_at: acc?.created_at ?? now(),
    });
  });

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

    const rawPricing = await resolvePricingForRequest(c, { trustProxy });
    const localizedPricing = resolvePayPalPricing(rawPricing);
    const leadDevice = detectLeadDevice(c, typeof body.device === "string" ? body.device : "web");

    // Reuse an existing account for this email if present (avoids orphaned duplicate rows).
    const existing = repo.accountByEmail(email);
    if (existing && isEntitled(repo.entitlement(existing.id), now(), config.pastDueGraceDays)) {
      const existingEnt = repo.entitlement(existing.id);
      let isRealActiveSub = true;
      if (existingEnt?.stripe_subscription_id && typeof (stripe.subscriptions as any)?.retrieve === "function") {
        try {
          const sub = await stripe.subscriptions.retrieve(existingEnt.stripe_subscription_id);
          if (sub && sub.status && !["active", "trialing", "past_due"].includes(sub.status)) {
            isRealActiveSub = false;
          }
        } catch (err: any) {
          if (err?.code === "resource_missing" || String(err?.message || "").includes("No such subscription")) {
            isRealActiveSub = false;
          }
        }
      }
      if (isRealActiveSub) {
        return c.json({ error: "already_active" }, 409);
      }
    }
    let accountId: string;
    if (existing) {
      accountId = existing.id;
      repo.setAccountLeadMeta(accountId, { country: localizedPricing.country, lead_device: leadDevice });
    } else {
      accountId = `acc_web_${randomToken(8)}`;
      const refreshToken = randomToken(32);
      repo.createAccount(accountId, sha256(refreshToken), email, null, {
        country: localizedPricing.country,
        lead_device: leadDevice,
      });
    }

    try {
      const attributionMeta = extractAttributionMeta(body, accountId, plan, refCode);
      let customerId = existing?.stripe_customer_id ?? null;
      if (customerId) {
        try {
          await stripe.customers.update(customerId, { email, metadata: attributionMeta });
        } catch (custErr: any) {
          if (custErr?.code === "resource_missing" || String(custErr?.message || "").includes("No such customer")) {
            customerId = null;
          } else {
            throw custErr;
          }
        }
      }
      if (!customerId) {
        const customer = await stripe.customers.create({ email, metadata: attributionMeta });
        customerId = customer.id;
        repo.setCustomer(accountId, customerId, email);
      }

      const isAnnual = plan === "annual";
      const isSixMonth = plan === "six_month";
      const includeBatteryCare = hasBatteryCareAddon(body);
      const includeCloudVault = hasCloudVaultAddon(body);
      const productId = await getStripeProductId();
      const unitAmount = isAnnual
        ? localizedPricing.annualAmount
        : isSixMonth
        ? localizedPricing.sixMonthAmount
        : localizedPricing.monthlyAmount;

      const recurringConfig = isAnnual
        ? { interval: "year" as const }
        : isSixMonth
        ? { interval: "month" as const, interval_count: 6 }
        : { interval: "month" as const };

      const itemConfig = {
        price_data: {
          currency: localizedPricing.currency,
          product: productId,
          unit_amount: unitAmount,
          recurring: recurringConfig,
        },
      };

      const subItems: any[] = [itemConfig];
      if (includeBatteryCare) {
        const batteryProductId = await getStripeBatteryProductId();
        const addonUnitAmount = isAnnual
          ? localizedPricing.batteryCareAnnualAmount
          : isSixMonth
          ? localizedPricing.batteryCareSixMonthAmount
          : localizedPricing.batteryCareMonthlyAmount;
        subItems.push({
          price_data: {
            currency: localizedPricing.currency,
            product: batteryProductId,
            unit_amount: addonUnitAmount,
            recurring: recurringConfig,
          },
        });
      }
      if (includeCloudVault) {
        const cloudVaultProductId = await getStripeCloudVaultProductId();
        const addonUnitAmount = isAnnual
          ? localizedPricing.cloudVaultAnnualAmount
          : isSixMonth
          ? localizedPricing.cloudVaultSixMonthAmount
          : localizedPricing.cloudVaultMonthlyAmount;
        subItems.push({
          price_data: {
            currency: localizedPricing.currency,
            product: cloudVaultProductId,
            unit_amount: addonUnitAmount,
            recurring: recurringConfig,
          },
        });
      }

      const applyDiscount = Boolean(body.applyDiscount) && plan === "monthly";
      const introCouponId =
        !isAnnual && !isSixMonth && applyDiscount
          ? await getOrCreateIntroCoupon(localizedPricing.currency, localizedPricing.introSavingsAmount)
          : "";
      let subscription: any = null;
      try {
        subscription = await stripe.subscriptions.create({
          customer: customerId,
          items: subItems,
          payment_behavior: "default_incomplete",
          payment_settings: {
            save_default_payment_method: "on_subscription",
            payment_method_types: ["paypal"],
          },
          ...(introCouponId ? { discounts: [{ coupon: introCouponId }] } : {}),
          metadata: attributionMeta,
          expand: ["latest_invoice.confirmation_secret", "latest_invoice.payments"],
        } as any);

        const latestInvoice: any = subscription.latest_invoice;
        let paymentIntent: any =
          latestInvoice?.payment_intent ??
          latestInvoice?.payments?.data?.[0]?.payment?.payment_intent ??
          null;
        if (typeof paymentIntent === "string") {
          paymentIntent = await stripe.paymentIntents.retrieve(paymentIntent);
        }
        if (!paymentIntent?.id && typeof latestInvoice?.confirmation_secret?.client_secret === "string") {
          const cs: string = latestInvoice.confirmation_secret.client_secret;
          const piId = cs.split("_secret_")[0];
          if (piId) {
            paymentIntent = { id: piId, client_secret: cs, livemode: subscription.livemode };
          }
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
        if (redirectUrl) {
          return c.json({
            url: redirectUrl,
            redirectUrl,
            subscriptionId: subscription.id,
            accountId,
            plan,
            currency: localizedPricing.currency,
          });
        }
      } catch (subErr: any) {
        if (subscription?.id && typeof (stripe.subscriptions as any)?.cancel === "function") {
          await stripe.subscriptions.cancel(subscription.id).catch(() => {});
        }
        const checkoutSession = await createPayPalCheckoutSessionFallback({
          customerId,
          accountId,
          subItems,
          introCouponId,
          attributionMeta,
        }).catch(() => null);
        if (checkoutSession?.url) {
          return c.json({
            url: checkoutSession.url,
            redirectUrl: checkoutSession.url,
            subscriptionId: checkoutSession.id,
            accountId,
            plan,
            currency: localizedPricing.currency,
          });
        }
        throw subErr;
      }

      const fallbackSession = await createPayPalCheckoutSessionFallback({
        customerId,
        accountId,
        subItems,
        introCouponId,
        attributionMeta,
      });
      if (fallbackSession?.url) {
        return c.json({
          url: fallbackSession.url,
          redirectUrl: fallbackSession.url,
          subscriptionId: fallbackSession.id,
          accountId,
          plan,
          currency: localizedPricing.currency,
        });
      }
      return c.json({ error: "Could not initialize PayPal authorization redirect." }, 500);
    } catch (err: any) {
      console.error("[web-checkout] Stripe error:", err);
      return c.json({ error: err?.message || "Payment initialization failed." }, 400);
    }
  });

  // Public checkout configuration for on-page Stripe Elements, Apple Pay, Google Pay & localized Geo-Pricing
  app.get("/api/checkout-config", async (c) => {
    const pk = (config.stripePublishableKey ?? "").trim();
    const validPk = pk.startsWith("pk_") && !pk.includes("...") ? pk : "";
    const localizedPricing = await resolvePricingForRequest(c, { trustProxy, allowQueryOverride: true });
    return c.json({
      publishableKey: validPk,
      stripeConfigured: Boolean(stripe),
      elementsEnabled: Boolean(stripe && validPk),
      country: localizedPricing.country,
      countryFlag: localizedPricing.countryFlag,
      language: localizedPricing.language,
      currency: localizedPricing.currency,
      currencyCode: localizedPricing.currencyCode,
      symbol: localizedPricing.symbol,
      symbolPosition: localizedPricing.symbolPosition,
      zeroDecimal: localizedPricing.zeroDecimal,
      pricing: localizedPricing,
      paymentProfile: getGeoPaymentProfile(localizedPricing.country, localizedPricing.currency),
      amountTodayPence: localizedPricing.annualAmount,
      amountRegularPence: localizedPricing.annualAmount,
      amountRecurringPence: localizedPricing.annualAmount,
      plans: {
        annual: {
          amountPence: localizedPricing.annualAmount,
          formatted: localizedPricing.annualFormatted,
          monthlyEqFormatted: localizedPricing.annualMonthlyEqFormatted,
          savingsPercent: localizedPricing.annualSavingsPercent,
          interval: "year",
          name: "SWEEPR Cleaner Pro (Annual)",
        },
        six_month: {
          amountPence: localizedPricing.sixMonthAmount,
          formatted: localizedPricing.sixMonthFormatted,
          monthlyEqFormatted: localizedPricing.sixMonthMonthlyEqFormatted,
          savingsPercent: localizedPricing.sixMonthSavingsPercent,
          interval: "6 months",
          name: "SWEEPR Cleaner Pro (6-Month)",
        },
        monthly: {
          amountPence: localizedPricing.monthlyAmount,
          formatted: localizedPricing.monthlyFormatted,
          introAmountPence: localizedPricing.introMonthlyAmount,
          introFormatted: localizedPricing.introMonthlyFormatted,
          introSavingsFormatted: localizedPricing.introSavingsFormatted,
          interval: "month",
          name: "SWEEPR Cleaner Pro (Monthly)",
        },
      },
      addons: {
        battery_care: {
          id: "battery_care",
          name: "Total Battery & Mac/Phone Care — Device Lifespan Extender",
          annualAmountPence: localizedPricing.batteryCareAnnualAmount,
          annualFormatted: localizedPricing.batteryCareAnnualFormatted,
          annualMonthlyEqFormatted: localizedPricing.batteryCareAnnualMonthlyEqFormatted,
          sixMonthAmountPence: localizedPricing.batteryCareSixMonthAmount,
          sixMonthFormatted: localizedPricing.batteryCareSixMonthFormatted,
          sixMonthMonthlyEqFormatted: localizedPricing.batteryCareSixMonthMonthlyEqFormatted,
          monthlyAmountPence: localizedPricing.batteryCareMonthlyAmount,
          monthlyFormatted: localizedPricing.batteryCareMonthlyFormatted,
        },
        cloud_vault: {
          id: "cloud_vault",
          name: "SWEEPR Cloud Protection — Encrypted Photo Vault & Multi-Cloud Backup Sync",
          annualAmountPence: localizedPricing.cloudVaultAnnualAmount,
          annualFormatted: localizedPricing.cloudVaultAnnualFormatted,
          annualMonthlyEqFormatted: localizedPricing.cloudVaultAnnualMonthlyEqFormatted,
          sixMonthAmountPence: localizedPricing.cloudVaultSixMonthAmount,
          sixMonthFormatted: localizedPricing.cloudVaultSixMonthFormatted,
          sixMonthMonthlyEqFormatted: localizedPricing.cloudVaultSixMonthMonthlyEqFormatted,
          monthlyAmountPence: localizedPricing.cloudVaultMonthlyAmount,
          monthlyFormatted: localizedPricing.cloudVaultMonthlyFormatted,
        },
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

  // Helper to sync PayPal payer_email onto accounts created via Express PayPal popup without upfront email
  async function syncPayPalCustomerEmail(sub: Stripe.Subscription, accountIdHint?: string | null) {
    if (!stripe) return;
    try {
      const customerId = typeof sub.customer === "string" ? sub.customer : (sub.customer as any)?.id ?? null;
      const metaAccountId = typeof sub.metadata?.account_id === "string" ? sub.metadata.account_id.trim() : "";
      const resolvedAccount =
        (metaAccountId && repo.accountById(metaAccountId)) ||
        (accountIdHint && repo.accountById(accountIdHint)) ||
        (customerId && repo.accountByCustomer(customerId)) ||
        undefined;
      if (!resolvedAccount) return;
      const currentEmail = resolvedAccount.email || "";
      if (currentEmail && !currentEmail.endsWith("@pending.sweeprcleaner.com")) return;

      let pm: any =
        typeof sub.default_payment_method === "object" && sub.default_payment_method
          ? sub.default_payment_method
          : null;
      if (!pm) {
        const latestInv: any = sub.latest_invoice;
        let pi: any =
          latestInv?.payment_intent ??
          latestInv?.payments?.data?.[0]?.payment?.payment_intent ??
          null;
        if (typeof pi === "string" && typeof (stripe.paymentIntents as any)?.retrieve === "function") {
          pi = await stripe.paymentIntents.retrieve(pi, { expand: ["payment_method"] }).catch(() => null);
        }
        if (pi && typeof pi.payment_method === "object" && pi.payment_method) {
          pm = pi.payment_method;
        } else if (pi && typeof pi.payment_method === "string" && typeof (stripe.paymentMethods as any)?.retrieve === "function") {
          pm = await stripe.paymentMethods.retrieve(pi.payment_method).catch(() => null);
        } else if (typeof sub.default_payment_method === "string" && typeof (stripe.paymentMethods as any)?.retrieve === "function") {
          pm = await stripe.paymentMethods.retrieve(sub.default_payment_method).catch(() => null);
        }
      }
      if (!pm && (customerId || resolvedAccount.stripe_customer_id) && typeof (stripe.paymentMethods as any)?.list === "function") {
        const pms = await stripe.paymentMethods
          .list({ customer: (customerId || resolvedAccount.stripe_customer_id)!, type: "paypal", limit: 1 })
          .catch(() => null);
        if (pms?.data?.[0]) pm = pms.data[0];
      }
      const payerEmail = normalizeEmail(pm?.paypal?.payer_email || pm?.billing_details?.email);
      if (payerEmail && !payerEmail.endsWith("@pending.sweeprcleaner.com")) {
        const existingWithEmail = repo.accountByEmail(payerEmail);
        if (!existingWithEmail || existingWithEmail.id === resolvedAccount.id) {
          repo.updateAccountProfile(resolvedAccount.id, { email: payerEmail });
          if (resolvedAccount.stripe_customer_id && typeof (stripe.customers as any)?.update === "function") {
            await stripe.customers.update(resolvedAccount.stripe_customer_id, { email: payerEmail }).catch(() => {});
          }
        }
      }
    } catch (e) {
      console.warn("[paypal-sync] Failed to sync PayPal payer email:", e);
    }
  }

  async function dispatchActivationEmail(account: Account, planLabel: string) {
    const email = normalizeEmail(account.email);
    if (!email || email.endsWith("@pending.sweeprcleaner.com")) return;

    const recentSent = repo.db
      .prepare(
        "SELECT id FROM activities WHERE account_id = ? AND type = 'welcome_email_sent' AND created_at > ? LIMIT 1"
      )
      .get(account.id, now() - 300);
    if (recentSent) return;

    const activationKey = randomInt(100000, 1000000).toString();
    const expiresAt = now() + 7 * 86400; // 7 days validity for subscription activation key
    repo.setOtp(email, sha256(activationKey), expiresAt);

    const { sendSubscriptionEmail } = await import("./email.js");
    const dispatch = await sendSubscriptionEmail(
      email,
      "activated",
      planLabel,
      account.name || undefined,
      activationKey
    ).catch((err) => ({ ok: false, provider: "error", error: String(err) }));

    repo.addActivity({
      account_id: account.id,
      type: "welcome_email_sent",
      title: "Welcome & Subscription Key Sent",
      description: `6-digit Subscription Key sent to ${email}`,
      actor: "system",
      metadata: { email, plan: planLabel, dispatch },
    });
  }

  // Create a Stripe Subscription for direct on-page card, PayPal, Apple Pay & Google Pay confirmation (no Stripe Hosted Checkout page)
  app.post("/api/create-subscription", async (c) => {
    if (!isSameOriginRequest(c, config.publicUrl, trustProxy)) return c.json({ error: "forbidden_origin" }, 403);
    if (!limitCheckoutIp.hit(clientIp(c))) return c.json({ error: "rate_limited" }, 429);
    if (!stripe) return c.json({ error: "stripe_not_configured" }, 503);

    const body = await c.req.json().catch(() => ({}));
    const paymentMethod = typeof body.paymentMethod === "string" ? body.paymentMethod.toLowerCase() : "card";
    const isPayPal = paymentMethod === "paypal";
    const isSepaDebit = paymentMethod === "sepa_debit";
    const isRedirectMethod = [
      "paypal",
      "revolut_pay",
      "amazon_pay",
      "ideal",
      "bancontact",
      "cashapp",
      "kakao_pay",
      "naver_pay",
    ].includes(paymentMethod);
    const isWallet = paymentMethod === "wallet" || paymentMethod === "google_pay" || paymentMethod === "apple_pay";
    const isPopup = Boolean(body.popup);
    const providedEmail = normalizeEmail(body.email);
    const email =
      providedEmail ||
      (isRedirectMethod || isWallet
        ? `${paymentMethod}_${randomToken(6).toLowerCase()}@pending.sweeprcleaner.com`
        : null);
    if (!email) return c.json({ error: "Please enter a valid email address." }, 400);

    const rawIban = typeof body.iban === "string" ? body.iban.replace(/\s+/g, "").toUpperCase() : "";
    if (isSepaDebit && (!rawIban || rawIban.length < 14 || !/^[A-Z]{2}[0-9A-Z]{12,32}$/.test(rawIban))) {
      return c.json({ error: "Please enter a valid IBAN (e.g. DE89 3704 0044 0532 0130 00)." }, 400);
    }

    const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
    const addressLine1 = typeof body.address === "string" ? body.address.trim().slice(0, 200) : "";
    const postalCode = typeof body.postcode === "string" ? body.postcode.trim().slice(0, 32) : "";
    const rawPlan = typeof body.plan === "string" ? body.plan.toLowerCase() : "";
    const plan: "monthly" | "six_month" | "annual" =
      rawPlan === "annual" ? "annual" : rawPlan === "six_month" || rawPlan === "6month" || rawPlan === "sixmonth" ? "six_month" : "monthly";
    const applyDiscount = Boolean(body.applyDiscount) && plan === "monthly";
    const confirmOnServer = Boolean(body.confirmOnServer);
    const refCode = typeof body.ref === "string" ? body.ref.trim() : typeof body.referral_code === "string" ? body.referral_code.trim() : "";

    const existing = providedEmail ? repo.accountByEmail(providedEmail) : undefined;
    if (existing && isEntitled(repo.entitlement(existing.id), now(), config.pastDueGraceDays)) {
      const existingEnt = repo.entitlement(existing.id);
      let isRealActiveSub = true;
      if (existingEnt?.stripe_subscription_id && typeof (stripe.subscriptions as any)?.retrieve === "function") {
        try {
          const sub = await stripe.subscriptions.retrieve(existingEnt.stripe_subscription_id);
          if (sub && sub.status && !["active", "trialing", "past_due"].includes(sub.status)) {
            isRealActiveSub = false;
          }
        } catch (err: any) {
          if (err?.code === "resource_missing" || String(err?.message || "").includes("No such subscription")) {
            isRealActiveSub = false;
          }
        }
      }
      if (isRealActiveSub) {
        return c.json({ error: "This email already has an active SWEEPR Cleaner Pro subscription." }, 409);
      }
    }

    const rawPricing = await resolvePricingForRequest(c, { trustProxy });
    const localizedPricing = resolvePaymentMethodPricing(rawPricing, paymentMethod);
    const leadDevice = detectLeadDevice(c, typeof body.device === "string" ? body.device : "web");

    let accountId: string;
    if (existing) {
      accountId = existing.id;
      repo.setAccountLeadMeta(accountId, { country: localizedPricing.country, lead_device: leadDevice });
    } else {
      accountId = `acc_web_${randomToken(8)}`;
      const refreshToken = randomToken(32);
      repo.createAccount(accountId, sha256(refreshToken), email, null, {
        country: localizedPricing.country,
        lead_device: leadDevice,
      });
    }
    if (name) {
      repo.updateAccountProfile(accountId, { name, email, country: localizedPricing.country, lead_device: leadDevice });
    }

    // Ensure Stripe Customer exists with billing details
    let customerId = existing?.stripe_customer_id ?? null;
    const attributionMeta = extractAttributionMeta(body, accountId, plan, refCode);
    try {
      if (customerId) {
        try {
          await stripe.customers.update(customerId, {
            ...(providedEmail ? { email: providedEmail } : {}),
            ...(name ? { name } : {}),
            ...(addressLine1 || postalCode
              ? { address: { line1: addressLine1 || undefined, postal_code: postalCode || undefined } }
              : {}),
            metadata: attributionMeta,
          });
        } catch (custErr: any) {
          if (custErr?.code === "resource_missing" || String(custErr?.message || "").includes("No such customer")) {
            customerId = null;
          } else {
            throw custErr;
          }
        }
      }
      if (!customerId) {
        const customer = await stripe.customers.create({
          ...(providedEmail ? { email: providedEmail } : {}),
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
      const includeBatteryCare = hasBatteryCareAddon(body);
      const includeCloudVault = hasCloudVaultAddon(body);
      const productId = await getStripeProductId();
      const unitAmount = isAnnual
        ? localizedPricing.annualAmount
        : isSixMonth
        ? localizedPricing.sixMonthAmount
        : localizedPricing.monthlyAmount;

      const recurringConfig = isAnnual
        ? { interval: "year" as const }
        : isSixMonth
        ? { interval: "month" as const, interval_count: 6 }
        : { interval: "month" as const };

      const itemConfig = {
        price_data: {
          currency: localizedPricing.currency,
          product: productId,
          unit_amount: unitAmount,
          recurring: recurringConfig,
        },
      };

      const subItems: any[] = [itemConfig];
      if (includeBatteryCare) {
        const batteryProductId = await getStripeBatteryProductId();
        const addonUnitAmount = isAnnual
          ? localizedPricing.batteryCareAnnualAmount
          : isSixMonth
          ? localizedPricing.batteryCareSixMonthAmount
          : localizedPricing.batteryCareMonthlyAmount;
        subItems.push({
          price_data: {
            currency: localizedPricing.currency,
            product: batteryProductId,
            unit_amount: addonUnitAmount,
            recurring: recurringConfig,
          },
        });
      }
      if (includeCloudVault) {
        const cloudVaultProductId = await getStripeCloudVaultProductId();
        const addonUnitAmount = isAnnual
          ? localizedPricing.cloudVaultAnnualAmount
          : isSixMonth
          ? localizedPricing.cloudVaultSixMonthAmount
          : localizedPricing.cloudVaultMonthlyAmount;
        subItems.push({
          price_data: {
            currency: localizedPricing.currency,
            product: cloudVaultProductId,
            unit_amount: addonUnitAmount,
            recurring: recurringConfig,
          },
        });
      }

      const introCouponId =
        !isAnnual && !isSixMonth && applyDiscount
          ? await getOrCreateIntroCoupon(localizedPricing.currency, localizedPricing.introSavingsAmount)
          : "";

      const subscriptionPaymentMethodTypes =
        paymentMethod === "ideal"
          ? ["ideal", "sepa_debit"]
          : paymentMethod === "bancontact"
          ? ["bancontact", "sepa_debit"]
          : isSepaDebit
          ? ["sepa_debit"]
          : isRedirectMethod
          ? [paymentMethod]
          : ["card"];

      const subParams: any = {
        customer: customerId,
        items: subItems,
        payment_behavior: "default_incomplete",
        payment_settings: {
          save_default_payment_method: "on_subscription",
          payment_method_types: subscriptionPaymentMethodTypes,
        },
        ...(introCouponId ? { discounts: [{ coupon: introCouponId }] } : {}),
        metadata: attributionMeta,
        expand: ["latest_invoice.confirmation_secret", "latest_invoice.payments"],
      };

      let subscription: any = null;
      try {
        subscription = await stripe.subscriptions.create(subParams);
      } catch (subErr: any) {
        if (subscriptionPaymentMethodTypes.length > 1) {
          try {
            subscription = await stripe.subscriptions.create({
              ...subParams,
              payment_settings: {
                save_default_payment_method: "on_subscription",
                payment_method_types: [paymentMethod],
              },
            });
          } catch {
            // Fall through to checkout session fallback
          }
        }
        if (!subscription && (isRedirectMethod || isSepaDebit)) {
          const checkoutSession = await createRedirectCheckoutSessionFallback({
            customerId,
            accountId,
            subItems,
            introCouponId,
            attributionMeta,
            isPopup,
            paymentMethod,
          }).catch(() => null);
          if (checkoutSession?.url) {
            return c.json({
              redirectUrl: checkoutSession.url,
              subscriptionId: checkoutSession.id,
              accountId,
              plan,
              livemode: Boolean(checkoutSession.livemode),
            });
          }
        }
        if (!subscription) {
          throw subErr;
        }
      }
      const latestInvoice: any = subscription.latest_invoice;
      let paymentIntent: any =
        latestInvoice?.payment_intent ??
        latestInvoice?.payments?.data?.[0]?.payment?.payment_intent ??
        null;

      // Fallback for newer Stripe API versions if payment_intent is a string or exposed via confirmation_secret
      if (typeof paymentIntent === "string") {
        paymentIntent = await stripe.paymentIntents.retrieve(paymentIntent);
      }
      if (!paymentIntent?.id && typeof latestInvoice?.confirmation_secret?.client_secret === "string") {
        const cs: string = latestInvoice.confirmation_secret.client_secret;
        const piId = cs.split("_secret_")[0];
        if (piId) {
          paymentIntent = { id: piId, client_secret: cs, livemode: subscription.livemode };
        }
      }

      if (!paymentIntent?.id) {
        if (isRedirectMethod || isSepaDebit) {
          if (subscription?.id && typeof (stripe.subscriptions as any)?.cancel === "function") {
            await stripe.subscriptions.cancel(subscription.id).catch(() => {});
          }
          const checkoutSession = await createRedirectCheckoutSessionFallback({
            customerId,
            accountId,
            subItems,
            introCouponId,
            attributionMeta,
            isPopup,
            paymentMethod,
          }).catch(() => null);
          if (checkoutSession?.url) {
            return c.json({
              redirectUrl: checkoutSession.url,
              subscriptionId: checkoutSession.id,
              accountId,
              plan,
              livemode: Boolean(checkoutSession.livemode),
            });
          }
        }
        return c.json({ error: "Could not initialize payment intent." }, 500);
      }

      const returnUrl = `${config.publicUrl}/checkout/success?web=1&subscription_id=${encodeURIComponent(subscription.id)}&account_id=${encodeURIComponent(accountId)}${isPopup ? "&popup=1" : ""}`;
      const rawIp = clientIp(c);
      const validIp =
        !rawIp || rawIp === "local" || rawIp === "::1" || rawIp === "::ffff:127.0.0.1"
          ? "127.0.0.1"
          : rawIp;
      const userAgent = c.req.header("user-agent") || "Mozilla/5.0";

      // Direct SEPA Direct Debit (IBAN) confirmation with online recurring mandate
      if (isSepaDebit) {
        const confirmedPi: any = await stripe.paymentIntents.confirm(paymentIntent.id, {
          payment_method_data: {
            type: "sepa_debit",
            sepa_debit: { iban: rawIban },
            billing_details: {
              name: name || (providedEmail ? providedEmail.split("@")[0] : "Account Holder"),
              email: providedEmail || email,
              ...(addressLine1 || postalCode
                ? { address: { line1: addressLine1 || undefined, postal_code: postalCode || undefined } }
                : {}),
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
        } as any);

        if (confirmedPi?.status === "requires_action" && confirmedPi?.next_action?.redirect_to_url?.url) {
          return c.json({
            redirectUrl: confirmedPi.next_action.redirect_to_url.url,
            subscriptionId: subscription.id,
            accountId,
            plan,
            livemode: Boolean(confirmedPi.livemode),
          });
        }

        const updatedSub = await retrieveSubscriptionSafe(subscription.id).catch(() => subscription);
        const effectiveSub =
          updatedSub.status === "incomplete" &&
          (confirmedPi?.status === "processing" || confirmedPi?.status === "succeeded")
            ? ({ ...updatedSub, status: "active" } as Stripe.Subscription)
            : updatedSub;
        syncSubscription(repo, effectiveSub, accountId);

        const resolvedAccount = repo.accountById(accountId);
        if (resolvedAccount) {
          await setSignedCookie(c, SESSION_COOKIE, resolvedAccount.id, sessionSecret, {
            path: "/",
            httpOnly: true,
            sameSite: "Lax",
            secure: isHttps,
            maxAge: 86400 * 30,
          });
          const planLabel =
            plan === "annual" ? "Annual" : plan === "six_month" ? "6-Month" : "Pro";
          await dispatchActivationEmail(resolvedAccount, planLabel);
        }

        return c.json({
          redirectUrl: `/checkout/success?web=1&subscription_id=${encodeURIComponent(subscription.id)}&account_id=${encodeURIComponent(accountId)}`,
          subscriptionId: subscription.id,
          accountId,
          plan,
          livemode: Boolean(confirmedPi?.livemode),
        });
      }

      // Direct Redirect / Popup Mandate flow: PayPal, Revolut Pay, Amazon Pay, iDEAL, Bancontact, Cash App, Kakao Pay, Naver Pay
      if (isRedirectMethod) {
        const requiresBillingName = paymentMethod === "ideal" || paymentMethod === "bancontact";
        const effectiveName =
          name || (requiresBillingName ? (providedEmail ? providedEmail.split("@")[0] : "Customer") : "");

        let confirmedPi: any = null;
        try {
          confirmedPi = await stripe.paymentIntents.confirm(paymentIntent.id, {
            payment_method_data: {
              type: paymentMethod as any,
              ...(providedEmail || effectiveName
                ? {
                    billing_details: {
                      ...(providedEmail ? { email: providedEmail } : {}),
                      ...(effectiveName ? { name: effectiveName } : {}),
                    },
                  }
                : {}),
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
          } as any);
        } catch (piErr: any) {
          if (subscription?.id && typeof (stripe.subscriptions as any)?.cancel === "function") {
            await stripe.subscriptions.cancel(subscription.id).catch(() => {});
          }
          const checkoutSession = await createRedirectCheckoutSessionFallback({
            customerId,
            accountId,
            subItems,
            introCouponId,
            attributionMeta,
            isPopup,
            paymentMethod,
          }).catch(() => null);
          if (checkoutSession?.url) {
            return c.json({
              redirectUrl: checkoutSession.url,
              subscriptionId: checkoutSession.id,
              accountId,
              plan,
              livemode: Boolean(checkoutSession.livemode),
            });
          }
          throw piErr;
        }

        const redirectUrl =
          confirmedPi?.next_action?.redirect_to_url?.url ??
          confirmedPi?.next_action?.cashapp_handle_redirect_or_display_qr_code?.hosted_instructions_url ??
          null;
        if (!redirectUrl) {
          if (confirmedPi?.status === "succeeded" || confirmedPi?.status === "processing") {
            const updatedSub = await retrieveSubscriptionSafe(subscription.id).catch(() => subscription);
            syncSubscription(repo, { ...updatedSub, status: "active" } as Stripe.Subscription, accountId);
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
              livemode: Boolean(confirmedPi.livemode),
            });
          }
          if (subscription?.id && typeof (stripe.subscriptions as any)?.cancel === "function") {
            await stripe.subscriptions.cancel(subscription.id).catch(() => {});
          }
          const checkoutSession = await createRedirectCheckoutSessionFallback({
            customerId,
            accountId,
            subItems,
            introCouponId,
            attributionMeta,
            isPopup,
            paymentMethod,
          }).catch(() => null);
          if (checkoutSession?.url) {
            return c.json({
              redirectUrl: checkoutSession.url,
              subscriptionId: checkoutSession.id,
              accountId,
              plan,
              livemode: Boolean(checkoutSession.livemode),
            });
          }
          return c.json({ error: `Could not initialize ${paymentMethod} authorization redirect.` }, 500);
        }

        return c.json({
          redirectUrl,
          subscriptionId: subscription.id,
          accountId,
          plan,
          livemode: Boolean(confirmedPi.livemode),
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

  // Immediately verify & sync an on-page or popup subscription
  app.post("/api/confirm-subscription", async (c) => {
    if (!isSameOriginRequest(c, config.publicUrl, trustProxy)) return c.json({ error: "forbidden_origin" }, 403);
    if (!stripe) return c.json({ error: "stripe_not_configured" }, 503);
    const body = await c.req.json().catch(() => ({}));
    let subscriptionId = typeof body.subscriptionId === "string" ? body.subscriptionId.trim() : "";
    let accountId = typeof body.accountId === "string" ? body.accountId.trim() : "";
    const checkOnly = Boolean(body.checkOnly);
    if (!subscriptionId) return c.json({ error: "missing_subscription_id" }, 400);

    try {
      if (subscriptionId.startsWith("cs_")) {
        const session = await stripe.checkout.sessions.retrieve(subscriptionId);
        const sessionSubId =
          typeof session.subscription === "string"
            ? session.subscription
            : (session.subscription as any)?.id ?? "";
        if (!accountId && typeof session.metadata?.account_id === "string") {
          accountId = session.metadata.account_id.trim();
        }
        if (!sessionSubId) {
          return c.json(
            {
              ok: false,
              status: session.status || "open",
            },
            checkOnly ? 200 : 402
          );
        }
        subscriptionId = sessionSubId;
      }

      const sub = await retrieveSubscriptionSafe(subscriptionId);

      const metaAccountId = typeof sub.metadata?.account_id === "string" ? sub.metadata.account_id.trim() : "";
      if (!metaAccountId || !accountId || metaAccountId !== accountId) {
        return c.json({ error: "account_mismatch" }, 403);
      }

      if (sub.status !== "active" && sub.status !== "trialing") {
        return c.json(
          {
            ok: false,
            status: sub.status,
          },
          checkOnly ? 200 : 402
        );
      }

      await syncPayPalCustomerEmail(sub, metaAccountId);
      syncSubscription(repo, sub, metaAccountId);

      const resolvedAccount = repo.accountById(metaAccountId);

      if (resolvedAccount) {
        const isFreshSub = !sub.created || now() - Number(sub.created) < 86400;
        if (isFreshSub) {
          await setSignedCookie(c, SESSION_COOKIE, resolvedAccount.id, sessionSecret, {
            path: "/",
            httpOnly: true,
            sameSite: "Lax",
            secure: isHttps,
            maxAge: 86400 * 30,
          });
        }
        const planLabel =
          sub.metadata?.plan === "annual"
            ? "Annual"
            : sub.metadata?.plan === "six_month"
            ? "6-Month"
            : "Pro";
        await dispatchActivationEmail(resolvedAccount, planLabel);
      }

      return c.json({
        ok: true,
        status: sub.status,
        redirect: `/checkout/success?web=1&subscription_id=${encodeURIComponent(subscriptionId)}&account_id=${encodeURIComponent(resolvedAccount?.id || accountId)}`,
      });
    } catch (err: any) {
      console.error("[confirm-subscription] error:", err);
      return c.json({ error: err?.message || "Verification failed" }, 400);
    }
  });

  // Checks that the email is already signed up before sending a 6-digit OTP email.
  app.post("/api/portal-login", async (c) => {
    if (!limitOtpSendIp.hit(clientIp(c))) return c.json({ error: "Too many requests. Please try again later." }, 429);
    const body = await c.req.json().catch(() => ({}));
    if (!body.email) return c.json({ error: "email_required" }, 400);
    const email = normalizeEmail(body.email);
    if (!email) return c.json({ error: "Please enter a valid email address." }, 400);
    if (!limitOtpSendEmail.hit(email)) return c.json({ error: "Too many requests. Please try again later." }, 429);

    const account = await findSignedUpAccountByEmail(email);
    if (!account) {
      return c.json(
        {
          ok: false,
          otpSent: false,
          error: "No account found for this email address. Please sign up first or check your email.",
        },
        404
      );
    }

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
      description: `6-digit code requested via /login — ${statusText}`,
      actor: "customer",
      metadata: { email, dispatch },
    });

    return c.json({ ok: true, otpSent: true });
  });

  app.post("/api/verify-otp", async (c) => {
    if (!isSameOriginRequest(c, config.publicUrl, trustProxy)) return c.json({ error: "forbidden_origin" }, 403);
    if (!limitOtpVerifyIp.hit(clientIp(c))) return c.json({ error: "Too many attempts. Please try again later." }, 429);
    const body = await c.req.json().catch(() => ({}));
    if (!body.email || !body.code) return c.json({ error: "missing_fields" }, 400);
    const email = normalizeEmail(body.email);
    const code = String(body.code).trim();
    const invalid = () => c.json({ error: "Invalid or expired code." }, 400);
    if (!email) return invalid();
    if (!limitOtpVerifyEmail.hit(email)) return c.json({ error: "Too many attempts. Please try again later." }, 429);
    if (!/^\d{6}$/.test(code)) return invalid();

    let valid = repo.verifyRecentEmailCode(email, code, sha256(code), Math.floor(Date.now() / 1000));
    if (!valid) {
      const centralOtp = await verifyCentralOtp({ email, code, deviceType: "pc" });
      if (centralOtp?.valid) {
        valid = true;
      }
    }
    if (!valid) return invalid();

    const account = (await findOrSyncEntitledAccountByEmail(email)) ?? repo.accountByEmail(email);
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

    let paymentMethod: {
      id: string;
      brand: string;
      last4: string;
      exp_month: number;
      exp_year: number;
    } | null = null;
    let billingAddress: {
      line1?: string;
      line2?: string;
      city?: string;
      state?: string;
      postal_code?: string;
      country?: string;
    } | null = null;
    let subscriptionDetails: {
      unit_amount: number | null;
      currency: string;
      interval: string;
      interval_count: number;
      discount_percent: number | null;
    } | null = null;

    if (stripe && account.stripe_customer_id) {
      try {
        const cust = await stripe.customers.retrieve(account.stripe_customer_id, {
          expand: ["invoice_settings.default_payment_method"],
        });
        if (!(cust as any).deleted) {
          const cObj = cust as Stripe.Customer;
          if (cObj.address) {
            billingAddress = {
              line1: cObj.address.line1 || "",
              line2: cObj.address.line2 || "",
              city: cObj.address.city || "",
              state: cObj.address.state || "",
              postal_code: cObj.address.postal_code || "",
              country: cObj.address.country || "",
            };
          }
          const defPm = cObj.invoice_settings?.default_payment_method;
          if (defPm && typeof defPm === "object" && (defPm as Stripe.PaymentMethod).card) {
            const pm = defPm as Stripe.PaymentMethod;
            paymentMethod = {
              id: pm.id,
              brand: pm.card!.brand || "card",
              last4: pm.card!.last4 || "••••",
              exp_month: pm.card!.exp_month || 0,
              exp_year: pm.card!.exp_year || 0,
            };
          } else if (defPm && typeof defPm === "object" && ((defPm as any).type === "paypal" || (defPm as any).paypal)) {
            const pm = defPm as any;
            paymentMethod = {
              id: pm.id,
              brand: "paypal",
              last4: pm.paypal?.payer_email || pm.billing_details?.email || "PayPal",
              exp_month: 0,
              exp_year: 0,
            };
          } else if (defPm && typeof defPm === "object" && ((defPm as any).type === "sepa_debit" || (defPm as any).sepa_debit)) {
            const pm = defPm as any;
            paymentMethod = {
              id: pm.id,
              brand: "sepa_debit",
              last4: pm.sepa_debit?.last4 || "IBAN",
              exp_month: 0,
              exp_year: 0,
            };
          } else if (defPm && typeof defPm === "object" && (defPm as any).type) {
            const pm = defPm as any;
            paymentMethod = {
              id: pm.id,
              brand: String(pm.type),
              last4: pm.billing_details?.email || String(pm.type).toUpperCase(),
              exp_month: 0,
              exp_year: 0,
            };
          } else {
            const pms = await stripe.paymentMethods.list({
              customer: account.stripe_customer_id,
              type: "card",
              limit: 1,
            });
            const firstPm = pms.data[0];
            if (firstPm?.card) {
              paymentMethod = {
                id: firstPm.id,
                brand: firstPm.card.brand || "card",
                last4: firstPm.card.last4 || "••••",
                exp_month: firstPm.card.exp_month || 0,
                exp_year: firstPm.card.exp_year || 0,
              };
            } else {
              const paypalPms = await stripe.paymentMethods
                .list({
                  customer: account.stripe_customer_id,
                  type: "paypal",
                  limit: 1,
                })
                .catch(() => null);
              const firstPaypalPm = paypalPms?.data?.[0] as any;
              if (firstPaypalPm) {
                paymentMethod = {
                  id: firstPaypalPm.id,
                  brand: "paypal",
                  last4: firstPaypalPm.paypal?.payer_email || firstPaypalPm.billing_details?.email || "PayPal",
                  exp_month: 0,
                  exp_year: 0,
                };
              }
            }
          }
        }
      } catch (err) {
        console.warn("[dashboard-data] Failed to retrieve Stripe customer details:", err);
      }

      if (ent?.stripe_subscription_id && !ent.stripe_subscription_id.startsWith("sub_owner_")) {
        try {
          const sub = await stripe.subscriptions.retrieve(ent.stripe_subscription_id);
          const item = sub.items?.data?.[0];
          const price = item?.price;
          const discountObj = (sub as any).discount || (sub as any).discounts?.[0];
          const discountPct = discountObj?.coupon?.percent_off ?? null;
          if (price) {
            subscriptionDetails = {
              unit_amount: price.unit_amount ?? null,
              currency: (price.currency || "usd").toUpperCase(),
              interval: price.recurring?.interval || "month",
              interval_count: price.recurring?.interval_count || 1,
              discount_percent: discountPct,
            };
          }
        } catch (err) {
          console.warn("[dashboard-data] Failed to retrieve Stripe subscription details:", err);
        }
      }
    }

    const localizedPricing = await resolvePricingForRequest(c, {
      country: account.country ?? undefined,
      trustProxy,
    });
    const addons = repo.addonsForAccount(accountId);

    return c.json({
      account_id: account.id,
      email: account.email,
      name: account.name || "",
      plan: ent?.plan || "None",
      status: ent?.status || "none",
      addons,
      addon_pricing: {
        battery_care: {
          annualFormatted: localizedPricing.batteryCareAnnualFormatted,
          annualMonthlyEqFormatted: localizedPricing.batteryCareAnnualMonthlyEqFormatted,
          sixMonthFormatted: localizedPricing.batteryCareSixMonthFormatted,
          monthlyFormatted: localizedPricing.batteryCareMonthlyFormatted,
        },
        cloud_vault: {
          annualFormatted: localizedPricing.cloudVaultAnnualFormatted,
          annualMonthlyEqFormatted: localizedPricing.cloudVaultAnnualMonthlyEqFormatted,
          sixMonthFormatted: localizedPricing.cloudVaultSixMonthFormatted,
          monthlyFormatted: localizedPricing.cloudVaultMonthlyFormatted,
        },
      },
      current_period_end: ent?.current_period_end ?? null,
      cancel_at_period_end: Boolean(ent?.cancel_at_period_end),
      has_stripe: !!account.stripe_customer_id,
      stripe_configured: !!stripe,
      stripe_publishable_key: config.stripePublishableKey || null,
      payment_method: paymentMethod,
      billing_address: billingAddress,
      subscription_details: subscriptionDetails,
      referral_code: referralCode,
      referrals_count: referralsCount,
      winback_claimed: Boolean(account.winback_claimed),
      devices,
      devices_used: devices.length,
      devices_max: Math.max(1, config.maxDevicesPc || 3),
      invoices,
    });
  });

  // 1-Click Add-on Upgrade for existing active subscribers ("battery_care" | "cloud_vault")
  app.post("/api/portal/purchase-addon", async (c) => {
    if (!isSameOriginRequest(c, config.publicUrl, trustProxy)) {
      return c.json({ error: "forbidden_origin" }, 403);
    }
    const accountId = await sessionAccountId(c);
    if (!accountId) return c.json({ error: "unauthorized" }, 401);
    const account = repo.accountById(accountId);
    if (!account) return c.json({ error: "account_not_found" }, 404);

    const body = await c.req.json().catch(() => ({}));
    const addon = String(body?.addon ?? "battery_care").trim().toLowerCase();
    if (addon !== "battery_care" && addon !== "cloud_vault") {
      return c.json({ error: "unsupported_addon" }, 400);
    }

    const ent = repo.entitlement(accountId);
    if (!ent || !isEntitled(ent, now(), config.pastDueGraceDays)) {
      return c.json({ error: "Active SWEEPR Cleaner Pro subscription required to attach an add-on." }, 402);
    }

    const existingAddons = repo.addonsForAccount(accountId);
    if (existingAddons.includes(addon)) {
      return c.json({ ok: true, addons: existingAddons, already_active: true });
    }

    const localizedPricing = await resolvePricingForRequest(c, {
      country: account.country ?? undefined,
      trustProxy,
    });

    if (stripe && ent.stripe_subscription_id !== "sub_owner_lifetime") {
      if (!ent.stripe_subscription_id || !ent.stripe_subscription_id.startsWith("sub_")) {
        return c.json({ error: "Active paid Stripe subscription required to attach an add-on." }, 402);
      }
      try {
        const sub = await stripe.subscriptions.retrieve(ent.stripe_subscription_id);
        const firstPrice = sub.items?.data?.[0]?.price;
        const interval = firstPrice?.recurring?.interval ?? (ent.plan === "annual" ? "year" : "month");
        const intervalCount = firstPrice?.recurring?.interval_count ?? (ent.plan === "six_month" ? 6 : 1);
        const currency = firstPrice?.currency || localizedPricing.currency;
        const tierPricing = getPricingForCountryOrCurrency(account.country, currency);
        const unitAmount =
          addon === "cloud_vault"
            ? interval === "year"
              ? tierPricing.cloudVaultAnnualAmount
              : intervalCount === 6
              ? tierPricing.cloudVaultSixMonthAmount
              : tierPricing.cloudVaultMonthlyAmount
            : interval === "year"
            ? tierPricing.batteryCareAnnualAmount
            : intervalCount === 6
            ? tierPricing.batteryCareSixMonthAmount
            : tierPricing.batteryCareMonthlyAmount;

        const addonProductId =
          addon === "cloud_vault" ? await getStripeCloudVaultProductId() : await getStripeBatteryProductId();
        await stripe.subscriptions.update(sub.id, {
          items: [
            ...sub.items.data.map((it) => ({ id: it.id })),
            {
              price_data: {
                currency,
                product: addonProductId,
                unit_amount: unitAmount,
                recurring: {
                  interval: interval as "month" | "year",
                  ...(intervalCount > 1 ? { interval_count: intervalCount } : {}),
                },
              },
            } as any,
          ],
          metadata: {
            ...(sub.metadata || {}),
            addons: Array.from(new Set([...existingAddons, addon])).join(","),
            ...(addon === "cloud_vault" ? { cloud_vault: "1" } : { battery_care: "1" }),
          },
          proration_behavior: "always_invoice",
          payment_behavior: "error_if_incomplete",
        });
      } catch (err: any) {
        console.warn("[portal] purchase-addon Stripe update error:", err?.message || err);
        return c.json({ error: (err as Error)?.message || "Payment failed for add-on upgrade." }, 402);
      }
    }

    const updatedAddons = repo.grantAddon(accountId, addon);
    syncSubscriptionToCentralCrm({
      email: account.email,
      name: account.name,
      country: account.country,
      plan: ent.plan || "annual",
      status: ent.status,
      addons: updatedAddons,
      notes: `Add-on activated: ${addon}`,
    });
    const addonTitle =
      addon === "cloud_vault"
        ? "SWEEPR Cloud Protection — Encrypted Photo Vault & Multi-Cloud Backup Sync"
        : "Total Battery & Mac/Phone Care";
    repo.addActivity({
      account_id: accountId,
      type: "addon_purchased",
      title: `Add-on Activated: ${addonTitle}`,
      description: `Customer activated ${addonTitle} add-on`,
      actor: "customer",
      metadata: { addon, addons: updatedAddons },
    });

    return c.json({ ok: true, addons: updatedAddons });
  });

  const createBillingPortalSession = async (c: Context) => {
    if (!isSameOriginRequest(c, config.publicUrl, trustProxy)) {
      return c.json({ error: "forbidden_origin" }, 403);
    }
    const accountId = await sessionAccountId(c);
    if (!accountId) return c.json({ error: "unauthorized" }, 401);

    const account = repo.accountById(accountId);
    if (!account) return c.json({ error: "account_not_found" }, 404);

    if (stripe && account.stripe_customer_id && typeof (stripe as any).billingPortal?.sessions?.create === "function") {
      try {
        const portalSession = await stripe.billingPortal.sessions.create({
          customer: account.stripe_customer_id,
          return_url: `${config.publicUrl.replace(/\/+$/, "")}/dashboard`,
        });
        if (portalSession?.url) {
          if (c.req.method === "POST") {
            return c.json({ url: portalSession.url });
          }
          return c.redirect(portalSession.url);
        }
      } catch (err) {
        console.warn("[billing-portal] Stripe billingPortal.sessions.create fallback to #billing:", (err as Error)?.message || err);
      }
    }

    if (c.req.method === "POST") {
      return c.json({ url: "/dashboard#billing" });
    }
    return c.redirect("/dashboard#billing");
  };

  app.get("/api/billing-portal", createBillingPortalSession);
  app.post("/api/billing-portal", createBillingPortalSession);

  // Google Play Console Mandatory Web Account Deletion URL & Portal Account Deletion
  app.post("/api/portal/delete-account", async (c) => {
    if (!isSameOriginRequest(c, config.publicUrl, trustProxy)) {
      return c.json({ error: "forbidden_origin" }, 403);
    }
    const body = await c.req.json().catch(() => ({}));
    let account = await resolvePortalOrBearerOrOtpAccount(c, body);
    if (!account) {
      return c.json({ error: "Please sign in or enter a valid email and 6-digit verification code." }, 401);
    }
    if (stripe && account.stripe_customer_id) {
      const ent = repo.entitlement(account.id);
      if (ent?.stripe_subscription_id && (ent.status === "active" || ent.status === "trialing" || ent.status === "past_due")) {
        await stripe.subscriptions.cancel(ent.stripe_subscription_id).catch(() => {});
      }
    }
    syncToCentralCrm("/v1/account/delete", { account_id: account.id, email: account.email });
    if (account.email) {
      syncSubscriptionToCentralCrm({
        email: account.email,
        accountId: account.id,
        status: "canceled",
        notes: "Account deleted via web portal / delete-account page",
      });
    }
    repo.deleteAccount(account.id);
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true, deleted: true });
  });

  app.get("/delete-account", (c) => {
    c.header("Cache-Control", "private, no-store, no-cache, must-revalidate");
    return c.html(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Delete Account &amp; Data — SWEEPR Cleaner</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4 font-sans">
  <div class="w-full max-w-md bg-slate-900 border border-red-500/30 rounded-2xl p-6 shadow-2xl space-y-4">
    <div class="flex items-center gap-3">
      <div class="w-10 h-10 rounded-xl bg-red-500/15 border border-red-500/40 flex items-center justify-center text-red-400 font-black text-lg">S</div>
      <div>
        <div class="text-xs font-extrabold uppercase tracking-wider text-red-400">SWEEPR Cleaner — Data Privacy</div>
        <h1 class="text-lg font-extrabold text-white">Delete Your Account &amp; Data</h1>
      </div>
    </div>
    <p class="text-xs text-slate-300 leading-relaxed">
      Enter your account email and 6-digit verification code (or Subscription Key) to permanently delete your SWEEPR Cleaner account, linked device tokens, and stored account data across SWEEPR Cleaner and our CRM.
    </p>
    <div class="space-y-3">
      <div>
        <label class="block text-xs font-bold text-slate-300 mb-1">Account Email</label>
        <input id="delEmail" type="email" placeholder="you@example.com" class="w-full px-3.5 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm focus:outline-none focus:border-red-500">
      </div>
      <div>
        <div class="flex items-center justify-between mb-1">
          <label class="block text-xs font-bold text-slate-300">6-Digit Code / Subscription Key</label>
          <button id="delSendOtpBtn" type="button" class="text-xs font-bold text-emerald-400 hover:underline cursor-pointer">Email me a code</button>
        </div>
        <input id="delCode" type="text" inputmode="numeric" maxlength="6" placeholder="123456" class="w-full px-3.5 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-center font-mono text-lg tracking-widest focus:outline-none focus:border-red-500">
      </div>
      <button id="delSubmitBtn" type="button" class="w-full py-3.5 px-4 rounded-xl bg-red-600 hover:bg-red-500 text-white font-extrabold text-sm transition cursor-pointer">
        Permanently Delete Account &amp; Data
      </button>
    </div>
    <div id="delStatus" class="hidden p-3.5 rounded-xl text-xs font-semibold"></div>
    <div class="text-center pt-2">
      <a href="/privacy" class="text-xs text-slate-400 hover:text-slate-200 underline">Privacy Policy</a>
      <span class="text-slate-600 mx-2">·</span>
      <a href="/dashboard" class="text-xs text-slate-400 hover:text-slate-200 underline">Return to Portal</a>
    </div>
  </div>
  <script>
    const statusEl = document.getElementById('delStatus');
    function showMsg(msg, ok) {
      statusEl.textContent = msg;
      statusEl.className = 'p-3.5 rounded-xl text-xs font-semibold ' + (ok ? 'bg-emerald-950/70 border border-emerald-500/40 text-emerald-200' : 'bg-red-950/70 border border-red-500/40 text-red-200');
      statusEl.classList.remove('hidden');
    }
    document.getElementById('delSendOtpBtn').addEventListener('click', async () => {
      const email = (document.getElementById('delEmail').value || '').trim();
      if (!email) { showMsg('Please enter your account email first.', false); return; }
      const r = await fetch('/v1/account/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      showMsg(r.ok ? 'Verification code sent! Check your email.' : 'No account found for that email address.', r.ok);
    });
    document.getElementById('delSubmitBtn').addEventListener('click', async () => {
      const email = (document.getElementById('delEmail').value || '').trim();
      const code = (document.getElementById('delCode').value || '').trim();
      if (!confirm('Are you sure you want to permanently delete your SWEEPR Cleaner account and all associated data? This cannot be undone.')) return;
      const r = await fetch('/api/portal/delete-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code })
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.deleted) {
        showMsg('Your account and all associated data have been permanently deleted.', true);
      } else {
        showMsg(d.error || 'Could not verify account deletion request.', false);
      }
    });
  </script>
</body>
</html>`);
  });

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
      description: `Verification code sent to ${newEmail} — ${statusText}`,
      actor: "customer",
      metadata: { new_email: newEmail, dispatch },
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

  // 3a. Cancel Subscription at End of Billing Period (with Exit Survey telemetry)
  app.post("/api/portal/cancel-subscription", async (c) => {
    if (!isSameOriginRequest(c, config.publicUrl, trustProxy)) {
      return c.json({ error: "forbidden_origin" }, 403);
    }
    const accountId = await sessionAccountId(c);
    if (!accountId) return c.json({ error: "unauthorized" }, 401);
    const account = repo.accountById(accountId);
    if (!account) return c.json({ error: "account_not_found" }, 404);

    const body = await c.req.json().catch(() => ({}));
    const reason = String(body?.reason ?? "unspecified").trim().slice(0, 120);
    const feedback = String(body?.feedback ?? "").trim().slice(0, 1000);

    const ent = repo.entitlement(accountId);
    if (!ent || (ent.status !== "active" && ent.status !== "trialing" && ent.status !== "past_due")) {
      return c.json({ error: "No active subscription found to cancel." }, 400);
    }

    if (ent.stripe_subscription_id && stripe && !ent.stripe_subscription_id.startsWith("sub_owner_")) {
      try {
        await stripe.subscriptions.update(ent.stripe_subscription_id, {
          cancel_at_period_end: true,
          metadata: {
            cancel_reason: reason,
            ...(feedback ? { cancel_feedback: feedback.slice(0, 450) } : {}),
          },
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
    syncSubscriptionToCentralCrm({
      email: account.email,
      name: account.name,
      country: account.country,
      plan: ent.plan || "annual",
      status: ent.status,
      addons: repo.addonsForAccount(accountId),
      notes: `Scheduled cancellation at period end (${reason})`,
    });

    repo.addActivity({
      account_id: account.id,
      type: "subscription_canceled",
      title: "Customer Scheduled Cancellation",
      description: `Scheduled subscription (${ent.plan || "subscription"}) to cancel at period end (Reason: ${reason}${feedback ? ` — "${feedback}"` : ""})`,
      actor: "customer",
      metadata: { plan: ent.plan, current_period_end: periodEnd, reason, feedback },
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
    if ((ent.status !== "active" && ent.status !== "trialing") || !ent.cancel_at_period_end || (ent.current_period_end && ent.current_period_end <= now())) {
      return c.json({ error: "Subscription cannot be reactivated without a new payment." }, 400);
    }

    if (stripe && ent.stripe_subscription_id && ent.stripe_subscription_id.startsWith("sub_") && !ent.stripe_subscription_id.startsWith("sub_owner")) {
      try {
        await stripe.subscriptions.update(ent.stripe_subscription_id, {
          cancel_at_period_end: false,
        });
      } catch (err: any) {
        console.error("[portal] stripe reactivate error:", err);
        return c.json({ error: err?.message || "Failed to reactivate subscription with billing provider." }, 400);
      }
    }

    const newStatus = ent.status;
    repo.upsertEntitlement({
      ...ent,
      status: newStatus,
      cancel_at_period_end: 0,
    });
    syncSubscriptionToCentralCrm({
      email: account.email,
      name: account.name,
      country: account.country,
      plan: ent.plan || "annual",
      status: newStatus,
      addons: repo.addonsForAccount(accountId),
      notes: "Customer reactivated subscription",
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

  // 3c. Claim 50% Off Loyalty Retention Discount (3 Months, once per account)
  app.post("/api/portal/claim-retention-discount", async (c) => {
    if (!isSameOriginRequest(c, config.publicUrl, trustProxy)) {
      return c.json({ error: "forbidden_origin" }, 403);
    }
    const accountId = await sessionAccountId(c);
    if (!accountId) return c.json({ error: "unauthorized" }, 401);
    const account = repo.accountById(accountId);
    if (!account) return c.json({ error: "account_not_found" }, 404);
    if (account.winback_claimed) {
      return c.json({ error: "already_claimed" }, 409);
    }

    const ent = repo.entitlement(accountId);
    if (!ent || ent.status !== "active" || !isEntitled(ent, now(), config.pastDueGraceDays)) {
      return c.json({ error: "No active subscription found." }, 400);
    }

    if (ent.stripe_subscription_id && stripe && !ent.stripe_subscription_id.startsWith("sub_owner_")) {
      try {
        const couponId = "SWEEPR_RETENTION_50_3MO";
        try {
          await stripe.coupons.retrieve(couponId);
        } catch {
          await stripe.coupons.create({
            id: couponId,
            percent_off: 50,
            duration: "repeating",
            duration_in_months: 3,
            name: "50% Off Loyalty Retention Offer (3 Months)",
          });
        }
        await stripe.subscriptions.update(ent.stripe_subscription_id, {
          discounts: [{ coupon: couponId }],
          cancel_at_period_end: false,
        });
      } catch (err: any) {
        console.warn("[portal] stripe retention coupon warning:", err?.message || err);
        return c.json({ error: err?.message || "Failed to apply retention discount." }, 400);
      }
    }

    repo.db.prepare("UPDATE accounts SET winback_claimed = 1, updated_at = ? WHERE id = ?").run(now(), account.id);
    repo.upsertEntitlement({
      ...ent,
      cancel_at_period_end: 0,
    });

    repo.addActivity({
      account_id: account.id,
      type: "retention_discount_claimed",
      title: "Customer Claimed 50% Loyalty Retention Offer",
      description: `Applied 50% off for next 3 billing cycles and kept subscription active`,
      actor: "customer",
    });

    return c.json({
      ok: true,
      discount_percent: 50,
      cancel_at_period_end: false,
      current_period_end: ent.current_period_end,
    });
  });

  // 3d. Update Billing Information (Name & Address)
  app.post("/api/portal/billing-info", async (c) => {
    if (!isSameOriginRequest(c, config.publicUrl, trustProxy)) {
      return c.json({ error: "forbidden_origin" }, 403);
    }
    const accountId = await sessionAccountId(c);
    if (!accountId) return c.json({ error: "unauthorized" }, 401);
    const account = repo.accountById(accountId);
    if (!account) return c.json({ error: "account_not_found" }, 404);

    const body = await c.req.json().catch(() => ({}));
    const name = String(body?.name ?? account.name ?? "").trim().slice(0, 120);
    const line1 = String(body?.line1 ?? "").trim().slice(0, 200);
    const city = String(body?.city ?? "").trim().slice(0, 100);
    const postalCode = String(body?.postal_code ?? "").trim().slice(0, 40);
    const country = String(body?.country ?? "").trim().toUpperCase().slice(0, 2);

    if (name) {
      repo.db.prepare("UPDATE accounts SET name = ?, updated_at = ? WHERE id = ?").run(name, now(), account.id);
    }

    if (stripe && account.stripe_customer_id) {
      try {
        await stripe.customers.update(account.stripe_customer_id, {
          ...(name ? { name } : {}),
          address: {
            line1,
            city,
            postal_code: postalCode,
            ...(country ? { country } : {}),
          },
        });
      } catch (err: any) {
        console.warn("[portal] failed to update Stripe customer address:", err?.message || err);
      }
    }

    repo.addActivity({
      account_id: account.id,
      type: "billing_info_updated",
      title: "Customer Updated Billing Information",
      description: `Updated billing address (${[line1, city, postalCode].filter(Boolean).join(", ") || "updated"})`,
      actor: "customer",
    });

    return c.json({
      ok: true,
      name,
      billing_address: { line1, city, postal_code: postalCode, country },
    });
  });

  // 3e. Create Stripe SetupIntent for inline Branded Card Update
  app.post("/api/portal/setup-intent", async (c) => {
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
      const created = await stripe.customers.create({
        ...(account.email ? { email: account.email } : {}),
        ...(account.name ? { name: account.name } : {}),
        metadata: { account_id: account.id },
      });
      customerId = created.id;
      repo.setCustomer(account.id, customerId, account.email ?? undefined);
    }

    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      allowed_payment_method_types: ["card"],
      usage: "off_session",
    });

    return c.json({ clientSecret: setupIntent.client_secret });
  });

  // 3f. Attach & Set Default Payment Method from Branded Card Modal
  app.post("/api/portal/update-payment-method", async (c) => {
    if (!isSameOriginRequest(c, config.publicUrl, trustProxy)) {
      return c.json({ error: "forbidden_origin" }, 403);
    }
    if (!stripe) return c.json({ error: "stripe_not_configured" }, 503);
    const accountId = await sessionAccountId(c);
    if (!accountId) return c.json({ error: "unauthorized" }, 401);
    const account = repo.accountById(accountId);
    if (!account || !account.stripe_customer_id) return c.json({ error: "no_stripe_customer" }, 404);

    const body = await c.req.json().catch(() => ({}));
    const paymentMethodId = String(body?.paymentMethodId ?? "").trim();
    if (!paymentMethodId) return c.json({ error: "missing_payment_method" }, 400);

    try {
      await stripe.paymentMethods.attach(paymentMethodId, {
        customer: account.stripe_customer_id,
      }).catch(() => {});

      await stripe.customers.update(account.stripe_customer_id, {
        invoice_settings: { default_payment_method: paymentMethodId },
      });

      const ent = repo.entitlement(accountId);
      if (ent?.stripe_subscription_id && !ent.stripe_subscription_id.startsWith("sub_owner_")) {
        await stripe.subscriptions.update(ent.stripe_subscription_id, {
          default_payment_method: paymentMethodId,
        }).catch(() => {});
      }

      const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
      repo.addActivity({
        account_id: account.id,
        type: "payment_method_updated",
        title: "Customer Updated Payment Card",
        description: `Updated default card to ${(pm.card?.brand || "Card").toUpperCase()} •••• ${pm.card?.last4 || ""}`,
        actor: "customer",
      });

      return c.json({
        ok: true,
        payment_method: pm.card
          ? {
              id: pm.id,
              brand: pm.card.brand,
              last4: pm.card.last4,
              exp_month: pm.card.exp_month,
              exp_year: pm.card.exp_year,
            }
          : null,
      });
    } catch (err: any) {
      return c.json({ error: err?.message || "Failed to update payment method." }, 400);
    }
  });

  // 4. Unlink / Remove a Device (frees up a slot under the 3-device limit and invalidates its per-device token)
  const maxTotalDevices = Math.max(1, config.maxDevicesPc || 3);
  const limitQrCreate = createRateLimiter(30, 10 * 60 * 1000);
  const limitQrRedeem = createRateLimiter(20, 10 * 60 * 1000);
  const limitQrChallenge = createRateLimiter(30, 10 * 60 * 1000);
  const limitQrPoll = createRateLimiter(240, 10 * 60 * 1000);

  const activeDevicesForAccount = (accountId: string) =>
    repo.db
      .prepare(
        "SELECT id, type, device_name, platform, first_seen, last_seen FROM devices WHERE account_id = ? AND revoked = 0 ORDER BY last_seen DESC"
      )
      .all(accountId) as Array<{
      id: string;
      type: string;
      device_name: string | null;
      platform: string | null;
      first_seen: number;
      last_seen: number;
    }>;

  const resolvePortalOrBearerOrOtpAccount = async (c: Context, body?: any): Promise<Account | null> => {
    const sessId = await sessionAccountId(c);
    if (sessId) {
      const acc = repo.accountById(sessId);
      if (acc) return acc;
    }
    const authHeader = c.req.header("authorization") ?? "";
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (bearer) {
      const acc = repo.accountByTokenHash(sha256(bearer));
      if (acc) return acc;
    }
    const email = normalizeEmail(body?.email);
    const code = String(body?.code ?? body?.otp ?? "").trim();
    if (email && /^\d{6}$/.test(code)) {
      if (!limitOtpVerifyIp.hit(clientIp(c)) || !limitOtpVerifyEmail.hit(email)) {
        return null;
      }
      const t = now();
      let valid = repo.verifyRecentEmailCode(email, code, sha256(code), t);
      if (!valid) {
        const centralOtp = await verifyCentralOtp({ email, code, deviceType: "pc" });
        if (centralOtp?.valid) valid = true;
      }
      if (valid) {
        limitOtpVerifyEmail.reset(email);
        limitOtpSendEmail.reset(email);
        const acc = (await findOrSyncEntitledAccountByEmail(email)) ?? repo.accountByEmail(email) ?? null;
        return acc;
      }
    }
    return null;
  };

  app.delete("/api/portal/devices/:deviceId", async (c) => {
    if (!isSameOriginRequest(c, config.publicUrl, trustProxy)) {
      return c.json({ error: "forbidden_origin" }, 403);
    }
    const account = await resolvePortalOrBearerOrOtpAccount(c);
    if (!account) return c.json({ error: "unauthorized" }, 401);
    const deviceId = c.req.param("deviceId");
    if (!deviceId) return c.json({ error: "missing_device_id" }, 400);

    const existingDev = repo.db
      .prepare("SELECT id, device_name FROM devices WHERE id = ? AND account_id = ?")
      .get(deviceId, account.id) as { id: string; device_name?: string | null } | undefined;
    if (existingDev) {
      repo.db.prepare("DELETE FROM devices WHERE id = ? AND account_id = ?").run(deviceId, account.id);
      repo.addActivity({
        account_id: account.id,
        type: "device_revoked",
        title: "Customer Unlinked Device",
        description: `Removed device ${existingDev.device_name || deviceId.slice(0, 8) + "..."} from subscription`,
        actor: "customer",
        metadata: { device_id: deviceId },
      });
    }
    const remaining = activeDevicesForAccount(account.id);
    return c.json({
      ok: true,
      devices: remaining,
      devices_used: remaining.length,
      devices_max: maxTotalDevices,
    });
  });

  app.post("/api/portal/devices/remove", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const account = await resolvePortalOrBearerOrOtpAccount(c, body);
    if (!account) return c.json({ ok: false, error: "unauthorized" }, 401);
    const deviceId = String(body?.device_id ?? "").trim();
    if (!deviceId) return c.json({ ok: false, error: "missing_device_id" }, 400);

    const existingDev = repo.db
      .prepare("SELECT id, device_name FROM devices WHERE id = ? AND account_id = ?")
      .get(deviceId, account.id) as { id: string; device_name?: string | null } | undefined;
    if (existingDev) {
      repo.db.prepare("DELETE FROM devices WHERE id = ? AND account_id = ?").run(deviceId, account.id);
      repo.addActivity({
        account_id: account.id,
        type: "device_revoked",
        title: "Customer Unlinked Device",
        description: `Removed device ${existingDev.device_name || deviceId.slice(0, 8) + "..."} from subscription`,
        actor: "customer",
        metadata: { device_id: deviceId },
      });
    }
    const remaining = activeDevicesForAccount(account.id);
    return c.json({
      ok: true,
      devices: remaining,
      devices_used: remaining.length,
      devices_max: maxTotalDevices,
    });
  });

  // ---------- Bi-Directional QR-Code Account & Device Linking (Flow A & Flow B) ----------

  const normalizePairDeviceId = (raw: unknown): string | null => {
    const s = String(raw ?? "").trim();
    if (DEVICE_RE.test(s)) return s;
    if (/^[a-zA-Z0-9_-]{8,128}$/.test(s)) {
      return sha256(`sweepr-cleaner-dev:${s}`);
    }
    return null;
  };

  const issueDeviceEntitlementCredentials = (
    account: Account,
    deviceId: string,
    deviceType: "pc" | "mobile",
    meta?: { deviceName?: string | null; platform?: string | null }
  ) => {
    const t = now();
    const ent = repo.entitlement(account.id);
    if (!ent || !isEntitled(ent, t, config.pastDueGraceDays)) {
      return { ok: false as const, status: 402 as const, error: "subscription_inactive" };
    }
    if (!repo.touchDevice(account.id, deviceId, deviceType, maxTotalDevices, maxTotalDevices, meta)) {
      const activeDevs = activeDevicesForAccount(account.id);
      return {
        ok: false as const,
        status: 403 as const,
        error: "device_limit_reached",
        message: `Maximum of ${maxTotalDevices} linked devices reached (any combination of desktop or mobile). Remove an existing device to link this one.`,
        devices: activeDevs,
        devices_used: activeDevs.length,
        devices_max: maxTotalDevices,
      };
    }
    const refreshToken = randomToken(32);
    repo.setDeviceTokenHash(account.id, deviceId, sha256(refreshToken));
    const addons = repo.addonsForAccount(account.id);
    let exp = t + config.tokenTtlHours * 3600;
    if (ent.current_period_end) {
      exp = Math.min(exp, ent.current_period_end + config.pastDueGraceDays * 86400);
    }
    exp = Math.max(exp, t + 300);
    const jws = signEntitlement(signingKey, {
      sub: account.id,
      device_id: deviceId,
      status: ent.status === "trialing" ? "trialing" : "active",
      plan: ent.plan ?? "annual",
      addons,
      iat: t,
      exp,
    });
    const activeDevs = activeDevicesForAccount(account.id);
    return {
      ok: true as const,
      account_id: account.id,
      email: account.email,
      refresh_token: refreshToken,
      token: jws,
      active: true,
      status: ent.status,
      plan: ent.plan ?? "annual",
      addons,
      expires_at: exp,
      device_id: deviceId,
      devices: activeDevs,
      devices_used: activeDevs.length,
      devices_max: maxTotalDevices,
    };
  };

  // Flow A — Step 1: Authenticated Website Portal generates a 120-second one-time QR token (ptk_...)
  app.post("/api/device-link/create-token", async (c) => {
    if (!limitQrCreate.hit(clientIp(c))) {
      return c.json({ ok: false, error: "rate_limited" }, 429);
    }
    const body = await c.req.json().catch(() => ({}));
    const account = await resolvePortalOrBearerOrOtpAccount(c, body);
    if (!account) {
      return c.json({ ok: false, error: "unauthorized", message: "Please log in on the website Customer Portal to generate a QR code for activating a separate device." }, 401);
    }
    const t = now();
    let ent = repo.entitlement(account.id);
    if (!isEntitled(ent, t, config.pastDueGraceDays) && account.email) {
      const synced = await findOrSyncEntitledAccountByEmail(account.email);
      if (synced) ent = repo.entitlement(synced.id);
    }
    if (!ent || !isEntitled(ent, t, config.pastDueGraceDays)) {
      return c.json({ ok: false, error: "subscription_inactive", message: "Active Pro subscription required to link devices." }, 403);
    }
    const activeDevs = activeDevicesForAccount(account.id);
    if (activeDevs.length >= maxTotalDevices) {
      return c.json(
        {
          ok: false,
          error: "device_limit_reached",
          message: `You have reached the maximum of ${maxTotalDevices} linked devices on your subscription. Remove a device first to link a new one.`,
          devices: activeDevs,
          devices_used: activeDevs.length,
          devices_max: maxTotalDevices,
        },
        403
      );
    }

    const rawToken = `ptk_${randomToken(24)}`;
    const tokenHash = sha256(rawToken);
    const expiresAt = t + 120;
    repo.db
      .prepare("DELETE FROM qr_pairing_tokens WHERE expires_at < ? OR (account_id = ? AND consumed = 0)")
      .run(t, account.id);
    repo.db
      .prepare(
        "INSERT INTO qr_pairing_tokens (token_hash, account_id, created_at, expires_at, consumed, created_by_ip) VALUES (?, ?, ?, ?, 0, ?)"
      )
      .run(tokenHash, account.id, t, expiresAt, clientIp(c));

    const baseUrl = config.publicUrl.replace(/\/+$/, "");
    const pairUrl = `${baseUrl}/pair?token=${encodeURIComponent(rawToken)}`;
    const qrSvg = generateQrSvg(pairUrl);

    return c.json({
      ok: true,
      token: rawToken,
      pair_url: pairUrl,
      qr_svg: qrSvg,
      expires_at: expiresAt,
      ttl_seconds: 120,
      devices_used: activeDevs.length,
      devices_max: maxTotalDevices,
      devices: activeDevs,
    });
  });

  // Flow A — Step 2: Target device (Mobile App, Second PC, or Mobile Web /pair) redeems ptk_...
  app.post("/api/device-link/redeem", async (c) => {
    if (!limitQrRedeem.hit(clientIp(c))) {
      return c.json({ ok: false, error: "rate_limited" }, 429);
    }
    const body = await c.req.json().catch(() => ({}));
    const rawToken = String(body?.token ?? "").trim();
    if (!/^ptk_[A-Za-z0-9_-]{20,64}$/.test(rawToken)) {
      return c.json({ ok: false, error: "invalid_or_expired_token", message: "Invalid or expired QR pairing token." }, 400);
    }
    const deviceId = normalizePairDeviceId(body?.device_id);
    if (!deviceId) {
      return c.json({ ok: false, error: "invalid_device_id", message: "Valid device_id is required." }, 400);
    }
    const rawPlatform = String(body?.platform ?? "").trim().toLowerCase();
    const deviceType: "pc" | "mobile" =
      body?.device_type === "mobile" || /ios|iphone|ipad|android|mobile/.test(rawPlatform) ? "mobile" : "pc";
    const deviceName =
      String(body?.device_name ?? "").trim().slice(0, 80) ||
      (deviceType === "mobile" ? "Mobile Device" : "Desktop PC");

    const t = now();
    const tokenHash = sha256(rawToken);
    const tokenRow = repo.db
      .prepare("SELECT * FROM qr_pairing_tokens WHERE token_hash = ?")
      .get(tokenHash) as { token_hash: string; account_id: string; expires_at: number; consumed: number } | undefined;

    if (!tokenRow || tokenRow.consumed || tokenRow.expires_at < t) {
      return c.json({ ok: false, error: "invalid_or_expired_token", message: "This QR code has expired or has already been used." }, 400);
    }

    const account = repo.accountById(tokenRow.account_id);
    if (!account) {
      return c.json({ ok: false, error: "account_not_found" }, 404);
    }

    // Check device limit before consuming token so user can remove a device and retry if needed, or burn atomically
    const consumeRes = repo.db
      .prepare("UPDATE qr_pairing_tokens SET consumed = 1 WHERE token_hash = ? AND consumed = 0 AND expires_at >= ?")
      .run(tokenHash, t);
    if (Number(consumeRes.changes) === 0) {
      return c.json({ ok: false, error: "invalid_or_expired_token", message: "This QR code has already been used." }, 400);
    }

    const cred = issueDeviceEntitlementCredentials(account, deviceId, deviceType, {
      deviceName,
      platform: rawPlatform || (deviceType === "mobile" ? "mobile" : "windows"),
    });
    if (!cred.ok) {
      return c.json(cred, cred.status);
    }

    return c.json(cred);
  });

  // Flow B — Step 1: Unactivated Desktop or Mobile App requests a 120s QR Challenge (chk_... + psec_...)
  app.post("/api/device-link/challenge", async (c) => {
    if (!limitQrChallenge.hit(clientIp(c))) {
      return c.json({ ok: false, error: "rate_limited" }, 429);
    }
    const body = await c.req.json().catch(() => ({}));
    const deviceId = normalizePairDeviceId(body?.device_id);
    if (!deviceId) {
      return c.json({ ok: false, error: "invalid_device_id" }, 400);
    }
    const rawPlatform = String(body?.platform ?? "windows").trim().toLowerCase().slice(0, 40);
    const deviceType: "pc" | "mobile" =
      body?.device_type === "mobile" || /ios|iphone|ipad|android|mobile/.test(rawPlatform) ? "mobile" : "pc";
    const deviceName =
      String(body?.device_name ?? "").trim().slice(0, 80) ||
      (rawPlatform === "macos" || rawPlatform === "mac"
        ? "Mac Desktop"
        : rawPlatform === "linux"
        ? "Linux Desktop"
        : deviceType === "mobile"
        ? "Mobile Device"
        : "Windows PC");

    const t = now();
    const challengeId = `chk_${randomToken(24)}`;
    const pollSecret = `psec_${randomToken(24)}`;
    const expiresAt = t + 120;

    repo.db.prepare("DELETE FROM qr_pairing_challenges WHERE expires_at < ?").run(t);
    repo.db
      .prepare(
        `INSERT INTO qr_pairing_challenges
         (challenge_id, poll_secret_hash, device_id, device_type, device_name, platform, status, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
      )
      .run(challengeId, sha256(pollSecret), deviceId, deviceType, deviceName, rawPlatform, t, expiresAt);

    const baseUrl = config.publicUrl.replace(/\/+$/, "");
    const approveUrl = `${baseUrl}/pair?mode=approve&challenge=${encodeURIComponent(challengeId)}`;
    const qrSvg = generateQrSvg(approveUrl);

    return c.json({
      ok: true,
      challenge_id: challengeId,
      poll_secret: pollSecret,
      approve_url: approveUrl,
      qr_svg: qrSvg,
      device_id: deviceId,
      device_name: deviceName,
      expires_at: expiresAt,
      ttl_seconds: 120,
    });
  });

  // Flow B — Step 2: Unactivated App polls for challenge approval
  app.get("/api/device-link/poll", (c) => {
    if (!limitQrPoll.hit(clientIp(c))) {
      return c.json({ ok: false, error: "rate_limited" }, 429);
    }
    const challengeId = String(c.req.query("challenge_id") ?? "").trim();
    const pollSecret = String(c.req.query("poll_secret") ?? "").trim();
    if (!/^chk_[A-Za-z0-9_-]{20,64}$/.test(challengeId) || !/^psec_[A-Za-z0-9_-]{20,64}$/.test(pollSecret)) {
      return c.json({ ok: false, error: "invalid_challenge" }, 400);
    }

    const row = repo.db
      .prepare("SELECT * FROM qr_pairing_challenges WHERE challenge_id = ?")
      .get(challengeId) as
      | {
          challenge_id: string;
          poll_secret_hash: string;
          device_id: string;
          device_type: "pc" | "mobile";
          device_name: string | null;
          platform: string | null;
          status: string;
          account_id: string | null;
          issued_refresh_token: string | null;
          issued_jws: string | null;
          expires_at: number;
        }
      | undefined;

    if (!row || !safeEqual(sha256(pollSecret), row.poll_secret_hash)) {
      return c.json({ ok: false, error: "not_found" }, 404);
    }

    const t = now();
    if (row.status === "approved" && row.account_id && row.issued_refresh_token) {
      const acc = repo.accountById(row.account_id);
      const ent = repo.entitlement(row.account_id);
      const addons = repo.addonsForAccount(row.account_id);
      repo.db
        .prepare(
          "UPDATE qr_pairing_challenges SET status = 'delivered', issued_refresh_token = NULL, issued_jws = NULL WHERE challenge_id = ?"
        )
        .run(challengeId);
      return c.json({
        ok: true,
        status: "approved",
        account_id: row.account_id,
        email: acc?.email ?? null,
        refresh_token: row.issued_refresh_token,
        token: row.issued_jws,
        plan: ent?.plan ?? "annual",
        addons,
        expires_at: ent?.current_period_end ?? null,
      });
    }

    if (row.expires_at < t || row.status === "delivered") {
      return c.json({ ok: true, status: "expired" });
    }

    return c.json({
      ok: true,
      status: "pending",
      expires_at: row.expires_at,
    });
  });

  // Flow B — Step 3: Phone / Portal approves the waiting Desktop/Mobile challenge
  app.post("/api/device-link/approve", async (c) => {
    if (!limitQrRedeem.hit(clientIp(c))) {
      return c.json({ ok: false, error: "rate_limited" }, 429);
    }
    const body = await c.req.json().catch(() => ({}));
    const challengeId = String(body?.challenge_id ?? body?.challenge ?? "").trim();
    if (!/^chk_[A-Za-z0-9_-]{20,64}$/.test(challengeId)) {
      return c.json({ ok: false, error: "invalid_challenge", message: "Invalid or expired QR challenge." }, 400);
    }

    const t = now();
    const row = repo.db
      .prepare("SELECT * FROM qr_pairing_challenges WHERE challenge_id = ?")
      .get(challengeId) as
      | {
          challenge_id: string;
          device_id: string;
          device_type: "pc" | "mobile";
          device_name: string | null;
          platform: string | null;
          status: string;
          expires_at: number;
        }
      | undefined;

    if (!row || row.expires_at < t || row.status !== "pending") {
      return c.json({ ok: false, error: "challenge_expired", message: "This QR code has expired or was already approved. Please refresh the QR code in the app." }, 400);
    }

    const account = await resolvePortalOrBearerOrOtpAccount(c, body);
    if (!account) {
      return c.json(
        {
          ok: false,
          error: "authentication_required",
          message: "Please sign in with your account email and 6-digit Subscription Key to approve this device.",
        },
        401
      );
    }

    const cred = issueDeviceEntitlementCredentials(account, row.device_id, row.device_type === "mobile" ? "mobile" : "pc", {
      deviceName: row.device_name,
      platform: row.platform,
    });
    if (!cred.ok) {
      return c.json(cred, cred.status);
    }

    repo.db
      .prepare(
        "UPDATE qr_pairing_challenges SET status = 'approved', account_id = ?, issued_refresh_token = ?, issued_jws = ? WHERE challenge_id = ?"
      )
      .run(account.id, cred.refresh_token, cred.token, challengeId);

    await setSignedCookie(c, SESSION_COOKIE, account.id, sessionSecret, {
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      secure: isHttps,
      maxAge: 86400 * 30,
    });

    return c.json({
      ok: true,
      status: "approved",
      account_id: account.id,
      email: account.email,
      device_id: row.device_id,
      device_name: row.device_name,
      devices: cred.devices,
      devices_used: cred.devices_used,
      devices_max: maxTotalDevices,
    });
  });

  // Mobile-First Web Pairing Landing Page (Handles both Flow A ?token=ptk_... and Flow B ?mode=approve&challenge=chk_...)
  app.get("/pair", async (c) => {
    c.header("Cache-Control", "private, no-store, no-cache, must-revalidate");
    c.header("X-Robots-Tag", "noindex, nofollow");
    const mode = String(c.req.query("mode") ?? "").trim().toLowerCase();
    const challengeId = String(c.req.query("challenge") ?? "").trim();
    const token = String(c.req.query("token") ?? "").trim();
    const sessAccId = await sessionAccountId(c);
    const sessAcc = sessAccId ? repo.accountById(sessAccId) : undefined;
    const isApproveMode = mode === "approve" || Boolean(challengeId);

    let challengeDeviceName = "SWEEPR Cleaner Desktop";
    let challengeValid = false;
    if (isApproveMode && /^chk_[A-Za-z0-9_-]{20,64}$/.test(challengeId)) {
      const row = repo.db
        .prepare("SELECT device_name, status, expires_at FROM qr_pairing_challenges WHERE challenge_id = ?")
        .get(challengeId) as { device_name: string | null; status: string; expires_at: number } | undefined;
      if (row && row.status === "pending" && row.expires_at >= now()) {
        challengeValid = true;
        if (row.device_name) challengeDeviceName = row.device_name;
      }
    }

    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <title>Link Device via QR — SWEEPR Cleaner</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4 font-sans">
  <div class="w-full max-w-md bg-slate-900 border border-emerald-500/30 rounded-2xl p-6 shadow-2xl">
    <div class="flex items-center gap-3 mb-5">
      <div class="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center text-emerald-400 font-black text-lg">S</div>
      <div>
        <div class="text-xs font-extrabold uppercase tracking-wider text-emerald-400">SWEEPR Cleaner Pro</div>
        <h1 class="text-lg font-extrabold text-white">${isApproveMode ? "Approve Device Link" : "Link This Device"}</h1>
      </div>
    </div>

    ${
      isApproveMode
        ? `<div id="approveBox" class="space-y-4">
            <div class="p-3.5 rounded-xl bg-slate-800/80 border border-slate-700 text-sm">
              <div class="text-xs uppercase font-bold text-slate-400">Waiting Device</div>
              <div class="font-bold text-white mt-0.5">${escapeHtml(challengeDeviceName)}</div>
              <div class="text-xs text-emerald-400 mt-1">Up to 3 devices per subscription (any combination of desktop or mobile)</div>
            </div>
            ${
              !challengeValid
                ? `<div class="p-3.5 rounded-xl bg-red-950/60 border border-red-500/40 text-red-200 text-sm">
                    This QR challenge has expired or was already used. Please click <strong>Refresh QR</strong> inside the SWEEPR Cleaner app and scan again.
                  </div>`
                : sessAcc
                ? `<div class="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-500/30 text-xs text-emerald-200">
                    Signed in as <strong>${escapeHtml(sessAcc.email || sessAcc.id)}</strong>
                  </div>
                  <button id="oneTapApproveBtn" type="button" class="w-full py-3.5 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-sm transition cursor-pointer">
                    ✓ Approve &amp; Unlock ${escapeHtml(challengeDeviceName)}
                  </button>`
                : `<div class="space-y-3">
                    <div>
                      <label class="block text-xs font-bold text-slate-300 mb-1">Account Email</label>
                      <input id="pairEmail" type="email" placeholder="you@example.com" class="w-full px-3.5 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm focus:outline-none focus:border-emerald-500">
                    </div>
                    <div id="codeWrap">
                      <div class="flex items-center justify-between mb-1">
                        <label class="block text-xs font-bold text-slate-300">6-Digit Subscription Key / Login Code</label>
                        <button id="sendOtpBtn" type="button" class="text-xs font-bold text-emerald-400 hover:underline cursor-pointer">Email me a code</button>
                      </div>
                      <input id="pairCode" type="text" inputmode="numeric" maxlength="6" placeholder="123456" class="w-full px-3.5 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-center font-mono text-lg tracking-widest focus:outline-none focus:border-emerald-500">
                    </div>
                    <button id="formApproveBtn" type="button" class="w-full py-3.5 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-sm transition cursor-pointer">
                      Approve &amp; Unlock Device
                    </button>
                  </div>`
            }
            <a id="openInAppApproveBtn" href="sweeprcleaner://pair?mode=approve&amp;challenge=${encodeURIComponent(challengeId)}" class="block text-center w-full py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs border border-slate-700">
              Open in SWEEPR Cleaner Mobile App
            </a>
          </div>`
        : `<div id="redeemBox" class="space-y-4">
            <p class="text-sm text-slate-300 leading-relaxed">
              Tap below to link this device to your SWEEPR Cleaner Pro subscription (up to 3 devices across Desktop &amp; Mobile).
            </p>
            <button id="redeemBtn" type="button" class="w-full py-3.5 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-sm transition cursor-pointer">
              ✓ Link This Device Now
            </button>
            <a href="sweeprcleaner://pair?token=${encodeURIComponent(token)}" class="block text-center w-full py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs border border-slate-700">
              Open in SWEEPR Cleaner Mobile App
            </a>
          </div>`
    }

    <div id="pairStatus" class="hidden mt-4 p-3.5 rounded-xl text-sm font-semibold"></div>
    <div id="deviceLimitBox" class="hidden mt-4 p-4 rounded-xl bg-amber-950/50 border border-amber-500/40 space-y-3">
      <div class="text-xs font-extrabold uppercase tracking-wider text-amber-300">3 / 3 Device Slots In Use</div>
      <p class="text-xs text-amber-100">Your subscription includes up to 3 linked devices (any combination of desktop or mobile). Remove one below to continue:</p>
      <ul id="limitDeviceList" class="space-y-2"></ul>
    </div>
  </div>

  <script>
    const challengeId = ${JSON.stringify(challengeId)};
    const pairToken = ${JSON.stringify(token)};
    const statusEl = document.getElementById('pairStatus');
    const limitBox = document.getElementById('deviceLimitBox');
    const limitList = document.getElementById('limitDeviceList');

    function showStatus(msg, ok) {
      statusEl.textContent = msg;
      statusEl.className = 'mt-4 p-3.5 rounded-xl text-sm font-semibold ' + (ok ? 'bg-emerald-950/70 border border-emerald-500/40 text-emerald-200' : 'bg-red-950/70 border border-red-500/40 text-red-200');
      statusEl.classList.remove('hidden');
    }

    function renderDeviceLimitList(devices, retryFn) {
      if (!Array.isArray(devices) || !devices.length) return;
      limitBox.classList.remove('hidden');
      limitList.innerHTML = devices.map(d => \`
        <li class="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-slate-900/90 border border-slate-700 text-xs">
          <div>
            <div class="font-bold text-white">\${(d.device_name || (d.type === 'mobile' ? 'Mobile Device' : 'Desktop PC')).replace(/</g, '&lt;')}</div>
            <div class="text-slate-400 font-mono">\${String(d.id || '').slice(0, 12)}...</div>
          </div>
          <button type="button" data-dev="\${String(d.id || '').replace(/"/g, '&quot;')}" class="rm-dev-btn px-2.5 py-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-300 font-bold cursor-pointer">
            Remove
          </button>
        </li>
      \`).join('');
      limitList.querySelectorAll('.rm-dev-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const devId = btn.getAttribute('data-dev');
          btn.textContent = '...';
          const emailEl = document.getElementById('pairEmail');
          const codeEl = document.getElementById('pairCode');
          const res = await fetch('/api/portal/devices/remove', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              device_id: devId,
              email: emailEl ? emailEl.value : undefined,
              code: codeEl ? codeEl.value : undefined
            })
          });
          if (res.ok) {
            limitBox.classList.add('hidden');
            if (retryFn) retryFn();
          }
        });
      });
    }

    async function doApprove(extra) {
      showStatus('Approving device link...', true);
      const res = await fetch('/api/device-link/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challenge_id: challengeId, ...(extra || {}) })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        showStatus('✓ Approved! Your SWEEPR Cleaner app is now unlocked.', true);
      } else {
        showStatus(data.message || data.error || 'Could not approve device link.', false);
        if (data.error === 'device_limit_reached' && data.devices) {
          renderDeviceLimitList(data.devices, () => doApprove(extra));
        }
      }
    }

    const oneTapBtn = document.getElementById('oneTapApproveBtn');
    if (oneTapBtn) {
      oneTapBtn.addEventListener('click', () => doApprove({}));
    }
    const formApproveBtn = document.getElementById('formApproveBtn');
    if (formApproveBtn) {
      formApproveBtn.addEventListener('click', () => {
        const email = (document.getElementById('pairEmail')?.value || '').trim();
        const code = (document.getElementById('pairCode')?.value || '').trim();
        doApprove({ email, code });
      });
    }
    const sendOtpBtn = document.getElementById('sendOtpBtn');
    if (sendOtpBtn) {
      sendOtpBtn.addEventListener('click', async () => {
        const email = (document.getElementById('pairEmail')?.value || '').trim();
        if (!email) { showStatus('Enter your account email first.', false); return; }
        sendOtpBtn.textContent = 'Sending...';
        const r = await fetch('/v1/account/send-otp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });
        sendOtpBtn.textContent = r.ok ? 'Code Sent! Check Email' : 'Email me a code';
      });
    }
    const redeemBtn = document.getElementById('redeemBtn');
    if (redeemBtn) {
      redeemBtn.addEventListener('click', async () => {
        let devId = localStorage.getItem('sweepr_cleaner_device_id');
        if (!devId) {
          devId = (crypto.randomUUID ? crypto.randomUUID() : 'a'.repeat(64));
          localStorage.setItem('sweepr_cleaner_device_id', devId);
        }
        const isMobile = /iphone|ipad|ipod|android/i.test(navigator.userAgent);
        showStatus('Linking this device...', true);
        const res = await fetch('/api/device-link/redeem', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: pairToken,
            device_id: devId,
            device_type: isMobile ? 'mobile' : 'pc',
            device_name: isMobile ? 'Mobile Browser / App' : 'Desktop Browser',
            platform: isMobile ? 'mobile' : 'web'
          })
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok) {
          localStorage.setItem('sweepr_cleaner_paired', JSON.stringify(data));
          showStatus('✓ Device Linked! Subscription active (' + (data.devices_used || 1) + ' / ' + (data.devices_max || 3) + ' devices used).', true);
        } else {
          showStatus(data.message || data.error || 'Could not redeem QR token.', false);
          if (data.error === 'device_limit_reached' && data.devices) {
            renderDeviceLimitList(data.devices);
          }
        }
      });
    }
  </script>
</body>
</html>`;
    return c.html(html);
  });

  // Anonymous, device-bound account.
  app.post("/v1/accounts", async (c) => {
    if (!limitAccounts.hit(clientIp(c))) return c.json({ error: "rate_limited" }, 429);
    const body = await c.req.json().catch(() => ({}));
    const deviceId = String(body.device_id ?? "");
    const deviceType = body.device_type === "mobile" ? "mobile" : "pc";
    if (!DEVICE_RE.test(deviceId)) return c.json({ error: "invalid device_id" }, 400);
    const email = normalizeEmail(body.email) || undefined;
    const localizedPricing = await resolvePricingForRequest(c, {
      country: typeof body.country === "string" ? body.country : undefined,
      trustProxy,
    });
    const leadDevice = detectLeadDevice(c, typeof body.device === "string" ? body.device : deviceType);
    const accountId = `acc_${randomToken(12)}`;
    const refreshToken = randomToken(32);
    repo.createAccount(accountId, sha256(refreshToken), email, null, {
      country: localizedPricing.country,
      lead_device: leadDevice,
      created_at: now(),
    });
    repo.touchDevice(accountId, deviceId, deviceType, config.maxDevicesPc, config.maxDevicesMobile);
    syncToCentralCrm("/v1/telemetry/event", {
      event_name: "app_installed",
      category: "funnel",
      os: deviceType === "mobile" ? "android" : "windows",
      device_id: deviceId,
      account_id: accountId,
      properties: { device_type: deviceType, country: localizedPricing.country, source: "v1_accounts" },
    });
    const referralCode = repo.ensureReferralCode(accountId);
    return c.json({ account_id: accountId, refresh_token: refreshToken, referral_code: referralCode });
  });

  async function findOrSyncEntitledAccountByEmail(rawEmail?: string | null): Promise<Account | null> {
    const email = normalizeEmail(rawEmail);
    if (!email) return null;

    const existing = repo.accountByEmail(email);
    if (existing && isEntitled(repo.entitlement(existing.id), now(), config.pastDueGraceDays)) {
      return existing;
    }

    const ownerEmail = normalizeEmail(process.env.OWNER_EMAIL);
    if (ownerEmail && email === ownerEmail) {
      let acc = existing;
      if (!acc) {
        const id = `acc_owner_${randomToken(8)}`;
        repo.createAccount(id, sha256(randomToken(32)), email);
        acc = repo.accountById(id)!;
      }
      const periodEnd = now() + 3650 * 86400;
      repo.upsertEntitlement({
        account_id: acc.id,
        stripe_subscription_id: "sub_owner_lifetime",
        status: "active",
        plan: "annual",
        current_period_end: periodEnd,
        cancel_at_period_end: 0,
      });
      return repo.accountById(acc.id) ?? acc;
    }

    // Check Centralized SWEEPR Multi-Project CRM Hub (`sweepr-crm`) for active Cleaner or cross-project Bundle (`sweepr_secure_bundle`) entitlements
    const central = await verifyCentralEntitlement(email);
    if (central && central.valid) {
      let acc = existing;
      if (!acc) {
        const id = central.account_id || `acc_${randomToken(12)}`;
        repo.createAccount(id, sha256(randomToken(32)), email);
        acc = repo.accountById(id)!;
      }
      const periodEnd = central.current_period_end || now() + 35 * 86400;
      const addonsList = Array.from(
        new Set([
          ...(central.addons || []),
          ...(central.addons?.includes("sweepr_secure_bundle") ? ["battery_care", "cloud_vault"] : []),
        ])
      );
      repo.upsertEntitlement({
        account_id: acc.id,
        stripe_subscription_id: null,
        status: central.status === "trialing" ? "trialing" : "active",
        plan: central.plan || "annual",
        addons_list: addonsList,
        current_period_end: periodEnd,
        cancel_at_period_end: central.cancel_at_period_end ? 1 : 0,
      });
      return repo.accountById(acc.id) ?? acc;
    }

    if (stripe) {
      try {
        const customers = await stripe.customers.list({ email, limit: 5 });
        for (const cust of customers.data) {
          if ((cust as any).deleted) continue;
          const subs = await stripe.subscriptions.list({
            customer: cust.id,
            status: "all",
            limit: 5,
          });
          const activeSub = subs.data.find(
            (s) => s.status === "active" || s.status === "trialing" || s.status === "past_due"
          );
          if (activeSub) {
            let acc = repo.accountByCustomer(cust.id) || existing;
            if (!acc) {
              const id = `acc_${randomToken(12)}`;
              repo.createAccount(id, sha256(randomToken(32)), email);
              acc = repo.accountById(id)!;
            }
            if (!acc.stripe_customer_id) {
              repo.setCustomer(acc.id, cust.id, email);
            }
            const interval = activeSub.items?.data?.[0]?.price?.recurring?.interval;
            const intervalCount = activeSub.items?.data?.[0]?.price?.recurring?.interval_count;
            const plan =
              activeSub.metadata?.plan ||
              (interval === "year" ? "annual" : interval === "month" && intervalCount === 6 ? "six_month" : "monthly");
            const periodEnd =
              (activeSub as any).current_period_end ||
              (activeSub.items?.data?.[0] as any)?.current_period_end ||
              now() + 35 * 86400;
            repo.upsertEntitlement({
              account_id: acc.id,
              stripe_subscription_id: activeSub.id,
              status: activeSub.status === "trialing" ? "trialing" : "active",
              plan,
              current_period_end: periodEnd,
              cancel_at_period_end: activeSub.cancel_at_period_end ? 1 : 0,
            });
            return repo.accountById(acc.id) ?? acc;
          }
        }
      } catch (err) {
        console.warn("[sync-stripe-email] Failed to lookup Stripe customer by email:", err);
      }
    }

    return null;
  }

  async function findSignedUpAccountByEmail(email: string): Promise<Account | null> {
    const existing = repo.accountByEmail(email);
    const isUnpaidCheckoutDraft =
      existing &&
      (existing.id.startsWith("acc_lead_") || existing.id.startsWith("acc_web_")) &&
      !repo.entitlement(existing.id) &&
      repo.subscriptionsForAccount(existing.id).length === 0;
    if (existing && !isUnpaidCheckoutDraft) {
      return existing;
    }
    const synced = await findOrSyncEntitledAccountByEmail(email);
    if (synced) return synced;
    return null;
  }

  // Step 1 of linking an existing web/email purchase or free account to a desktop/mobile device via OTP.
  app.post("/v1/account/send-otp", async (c) => {
    if (!limitOtpSendIp.hit(clientIp(c))) return c.json({ error: "rate_limited" }, 429);
    const body = await c.req.json().catch(() => ({}));
    const email = normalizeEmail(body.email);
    if (!email) return c.json({ error: "invalid_email" }, 400);
    if (!limitOtpSendEmail.hit(email)) return c.json({ error: "rate_limited" }, 429);

    let account = await findSignedUpAccountByEmail(email);
    if (!account) {
      const existing = repo.accountByEmail(email);
      if (existing) {
        account = existing;
      } else {
        const newId = `acc_${randomToken(12)}`;
        repo.createAccount(newId, sha256(randomToken(32)), email);
        account = repo.accountById(newId) ?? null;
      }
    }
    if (!account) {
      return c.json({ ok: false, otpSent: false, error: "Could not initialize account." }, 500);
    }

    const code = randomInt(100000, 1000000).toString();
    const expiresAt = now() + 7 * 86400;
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
      description: `6-digit code requested via app — ${statusText}`,
      actor: "customer",
      metadata: { email, dispatch },
    });

    return c.json({ ok: true, otpSent: true });
  });

  // Step 2 of linking an existing web/email purchase to a device: verifies OTP and issues a device-scoped refresh token.
  app.post("/v1/account/verify-otp", async (c) => {
    if (!limitOtpVerifyIp.hit(clientIp(c))) return c.json({ error: "rate_limited" }, 429);
    const body = await c.req.json().catch(() => ({}));
    const email = normalizeEmail(body.email);
    const code = String(body.code ?? "").trim();
    const deviceId = String(body.device_id ?? "");
    const deviceType =
      body.device_type === "mobile" || body.platform === "android" || body.platform === "ios"
        ? "mobile"
        : "pc";
    if (!email || !/^\d{6}$/.test(code) || !DEVICE_RE.test(deviceId)) {
      return c.json({ error: "invalid_request" }, 400);
    }
    if (!limitOtpVerifyEmail.hit(email)) return c.json({ error: "rate_limited" }, 429);

    const t = now();
    let localOtpValid = repo.verifyRecentEmailCode(email, code, sha256(code), t);
    if (!localOtpValid) {
      const centralOtp = await verifyCentralOtp({
        email,
        code,
        deviceId,
        deviceType,
        platform: typeof body.platform === "string" ? body.platform : undefined,
        deviceLabel: typeof body.device_label === "string" ? body.device_label : undefined,
      });
      if (centralOtp?.valid) {
        localOtpValid = true;
      }
    }
    if (!localOtpValid) {
      return c.json({ error: "invalid_or_expired_code" }, 400);
    }
    const account = (await findOrSyncEntitledAccountByEmail(email)) ?? repo.accountByEmail(email);
    if (!account) {
      return c.json({ error: "invalid_or_expired_code" }, 400);
    }
    if (!repo.touchDevice(account.id, deviceId, deviceType, config.maxDevicesPc, config.maxDevicesMobile)) {
      return c.json({ error: "device_limit", status: "device_limit" }, 403);
    }
    if (!account.country || !account.lead_device) {
      const localizedPricing = await resolvePricingForRequest(c, { trustProxy });
      repo.setAccountLeadMeta(account.id, {
        country: localizedPricing.country,
        lead_device: detectLeadDevice(c, deviceType),
      });
    }

    limitOtpVerifyEmail.reset(email);
    limitOtpSendEmail.reset(email);
    const refreshToken = randomToken(32);
    repo.setDeviceTokenHash(account.id, deviceId, sha256(refreshToken));
    const ent = repo.entitlement(account.id);
    const active = isEntitled(ent, t, config.pastDueGraceDays);
    const addons = repo.addonsForAccount(account.id);
    let token: string | null = null;
    if (active && ent) {
      let exp = t + config.tokenTtlHours * 3600;
      if (ent.current_period_end) {
        exp = Math.min(exp, ent.current_period_end + config.pastDueGraceDays * 86400);
      }
      exp = Math.max(exp, t + 300);
      token = signEntitlement(signingKey, {
        sub: account.id,
        device_id: deviceId,
        status: ent.status === "trialing" ? "trialing" : "active",
        plan: ent.plan ?? "monthly",
        addons,
        iat: t,
        exp,
      });
    }
    return c.json({
      account_id: account.id,
      email: account.email ?? email,
      refresh_token: refreshToken,
      token,
      active,
      status: ent?.status ?? "none",
      plan: ent?.plan ?? null,
      addons,
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
    syncToCentralCrm("/v1/account/delete", { account_id: account.id, email: account.email });
    if (account.email) {
      syncSubscriptionToCentralCrm({
        email: account.email,
        accountId: account.id,
        status: "canceled",
        notes: "Account deleted via DELETE /v1/account",
      });
    }
    repo.deleteAccount(account.id);
    return c.json({ ok: true, deleted: true });
  });

  // The ONLY place an entitlement decision is made.
  app.post("/v1/entitlement", auth, async (c) => {
    let account = c.get("account");
    if (!limitEntitlement.hit(account.id)) return c.json({ error: "rate_limited" }, 429);
    const body = await c.req.json().catch(() => ({}));
    const deviceId = String(body.device_id ?? "");
    const deviceType =
      body.device_type === "mobile" || body.platform === "android" || body.platform === "ios"
        ? "mobile"
        : "pc";
    if (!DEVICE_RE.test(deviceId)) return c.json({ error: "invalid device_id" }, 400);
    if (!repo.touchDevice(account.id, deviceId, deviceType, config.maxDevicesPc, config.maxDevicesMobile)) {
      return c.json({ error: "device_limit", status: "device_limit" }, 403);
    }
    if (!account.country || !account.lead_device) {
      const localizedPricing = await resolvePricingForRequest(c, { trustProxy });
      repo.setAccountLeadMeta(account.id, {
        country: localizedPricing.country,
        lead_device: detectLeadDevice(c, deviceType),
      });
    }

    let ent = repo.entitlement(account.id);
    const t = now();
    if (account.email) {
      const synced = await findOrSyncEntitledAccountByEmail(account.email);
      if (synced && synced.id === account.id) {
        ent = repo.entitlement(account.id);
      }
    } else if (!isEntitled(ent, t, config.pastDueGraceDays)) {
      const centralById = await verifyCentralEntitlement(account.id, deviceId);
      if (centralById && centralById.valid) {
        repo.upsertEntitlement({
          account_id: account.id,
          stripe_subscription_id: null,
          status: centralById.status === "trialing" ? "trialing" : "active",
          plan: centralById.plan || "annual",
          addons_list: centralById.addons || [],
          current_period_end: centralById.current_period_end || t + 35 * 86400,
          cancel_at_period_end: centralById.cancel_at_period_end ? 1 : 0,
        });
        ent = repo.entitlement(account.id);
      }
    }

    const referralCode = repo.ensureReferralCode(account.id);
    const referralsCount = repo.referralsCount(account.id);
    const addons = repo.addonsForAccount(account.id);
    const disabledRules = (process.env.DISABLED_CLEAN_RULES || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (!isEntitled(ent, t, config.pastDueGraceDays)) {
      return c.json({
        active: false,
        status: ent?.status ?? "none",
        plan: ent?.plan ?? null,
        addons: [],
        expires_at: 0,
        token: null,
        email: account.email ?? null,
        referral_code: referralCode,
        referrals_count: referralsCount,
        disabledRules,
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
      addons,
      iat: t,
      exp,
    });
    const baseProActive = ent!.plan !== "addon_only";
    return c.json({
      active: baseProActive,
      status: baseProActive ? ent!.status : "addon_only",
      plan: ent!.plan ?? "monthly",
      addons,
      token,
      expires_at: exp,
      email: account.email ?? null,
      referral_code: referralCode,
      referrals_count: referralsCount,
      disabledRules,
    });
  });

  app.post("/v1/referral/apply", auth, async (c) => {
    const account = c.get("account");
    const t = now();
    const body = await c.req.json().catch(() => ({}));
    const code = String(body?.code ?? body?.referral_code ?? "").trim();
    if (!code) return c.json({ error: "missing_code" }, 400);
    const applied = repo.applyReferral(account.id, code, t);
    if (!applied) return c.json({ error: "invalid_or_already_applied" }, 400);
    const updatedEnt = repo.entitlement(account.id);
    return c.json({
      ok: true,
      days_added: 30,
      status: updatedEnt?.status ?? "trialing",
      plan: updatedEnt?.plan ?? "monthly",
      expires_at: updatedEnt?.current_period_end ?? t + 30 * 86400,
    });
  });

  // Direct Google Play Billing Verification & Immediate Central CRM Sync
  app.post("/v1/billing/google-play/verify", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const productId = String(body?.product_id ?? "").trim();
    const purchaseToken = String(body?.purchase_token ?? "").trim();
    const orderId = String(body?.order_id ?? "").trim();
    const rawDeviceId = String(body?.device_id ?? "").trim();
    const deviceId = DEVICE_RE.test(rawDeviceId) ? rawDeviceId : `and_${randomToken(12)}`;

    if (!productId || !purchaseToken) {
      return c.json({ error: "missing_purchase_details" }, 400);
    }
    if (purchaseToken.length < 10 || !/^[A-Za-z0-9._:-]+$/.test(purchaseToken)) {
      return c.json({ error: "invalid_purchase_token" }, 400);
    }

    const subRefId = orderId || `gp_${purchaseToken.slice(0, 32)}`;

    let account = await resolvePortalOrBearerOrOtpAccount(c, body);
    const email = normalizeEmail(body?.email) ?? account?.email ?? undefined;
    if (!account && email) {
      account = repo.accountByEmail(email) ?? null;
    }
    if (!account && typeof body?.account_id === "string" && body.account_id.trim()) {
      account = repo.accountById(body.account_id.trim()) ?? null;
    }

    // Prevent replay of the same Google Play purchase token / order ID across different accounts
    const existingSubOwner = repo.db
      .prepare("SELECT account_id FROM entitlements WHERE stripe_subscription_id = ? LIMIT 1")
      .get(subRefId) as { account_id: string } | undefined;
    if (existingSubOwner && account && existingSubOwner.account_id !== account.id) {
      return c.json({ error: "duplicate_purchase_token" }, 409);
    }
    if (existingSubOwner && !account) {
      account = repo.accountById(existingSubOwner.account_id) ?? null;
    }

    // Optional live Google Play Developer API verification when GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is configured
    if (process.env.GOOGLE_PLAY_ACCESS_TOKEN) {
      try {
        const pkg = String(body?.package_name || "com.sweepr.app");
        const verifyUrl = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(pkg)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;
        const gpRes = await fetch(verifyUrl, {
          headers: { Authorization: `Bearer ${process.env.GOOGLE_PLAY_ACCESS_TOKEN}` },
        });
        if (gpRes.status === 404 || gpRes.status === 410) {
          return c.json({ error: "google_play_token_rejected" }, 402);
        }
      } catch (err) {
        console.warn("[google-play] Developer API check warning:", err);
      }
    }

    let refreshToken = "";
    if (!account) {
      const newAccId = `acc_gp_${randomToken(10)}`;
      refreshToken = randomToken(32);
      repo.createAccount(newAccId, sha256(refreshToken), email);
      account = repo.accountById(newAccId)!;
    }

    const t = now();
    repo.touchDevice(account.id, deviceId, "mobile", config.maxDevicesPc, config.maxDevicesMobile, {
      deviceName: typeof body?.device_name === "string" ? body.device_name : "Android Phone",
      platform: "android",
    });
    if (!refreshToken) {
      refreshToken = randomToken(32);
      repo.setDeviceTokenHash(account.id, deviceId, sha256(refreshToken));
    }

    const isBatteryAddon =
      productId.toLowerCase().includes("battery") || hasBatteryCareAddon(body);
    const isCloudAddon =
      productId.toLowerCase().includes("vault") || productId.toLowerCase().includes("cloud") || hasCloudVaultAddon(body);
    const isBaseSubProduct =
      productId.toLowerCase().includes("monthly") ||
      productId.toLowerCase().includes("six_month") ||
      productId.toLowerCase().includes("6month") ||
      productId.toLowerCase().includes("annual") ||
      productId.includes("4999") ||
      productId.includes("3899") ||
      body?.plan === "monthly" ||
      body?.plan === "six_month" ||
      body?.plan === "annual";
    const isAddonOnly = (isBatteryAddon || isCloudAddon) && !isBaseSubProduct;

    const plan =
      body?.plan === "annual" || productId.includes("annual") || productId.includes("4999")
        ? "annual"
        : body?.plan === "six_month" || productId.includes("six_month") || productId.includes("6month") || productId.includes("3899")
        ? "six_month"
        : "monthly";
    const days = isAddonOnly ? 365 : plan === "annual" ? 365 : plan === "six_month" ? 183 : 30;
    const periodEnd = t + days * 86400;

    const existingEnt = repo.entitlement(account.id);
    const effectivePeriodEnd = Math.max(existingEnt?.current_period_end ?? 0, periodEnd);
    // When purchasing or upgrading a base plan, always apply the newly purchased plan tier!
    // When purchasing an add-on alone, preserve the existing base plan (or "addon_only" if none).
    const hasBasePro = Boolean(
      existingEnt &&
        existingEnt.plan !== "addon_only" &&
        isEntitled(existingEnt, t, config.pastDueGraceDays)
    );
    const effectivePlan: string = isAddonOnly ? (hasBasePro ? (existingEnt!.plan || "annual") : "addon_only") : plan;
    const effectiveStatus = isAddonOnly
      ? hasBasePro
        ? existingEnt!.status
        : ("active" as const)
      : ("active" as const);
    const baseProActive = effectivePlan !== "addon_only";

    repo.upsertEntitlement({
      account_id: account.id,
      stripe_subscription_id: subRefId,
      status: effectiveStatus,
      plan: effectivePlan,
      current_period_end: effectivePeriodEnd,
      cancel_at_period_end: 0,
    });
    if (isBatteryAddon) repo.grantAddon(account.id, "battery_care");
    if (isCloudAddon) repo.grantAddon(account.id, "cloud_vault");
    const addons = repo.addonsForAccount(account.id);

    repo.addActivity({
      account_id: account.id,
      type: "google_play_purchase",
      title: `Google Play Purchase Verified (${productId})`,
      description: `Activated ${productId} on Android (${orderId || "Google Play Billing"})`,
      actor: "customer",
      metadata: { product_id: productId, order_id: orderId, plan: effectivePlan, addons },
    });

    syncSubscriptionToCentralCrm({
      email: account.email ?? email,
      accountId: account.id,
      name: account.name,
      country: account.country,
      plan: effectivePlan,
      status: "active",
      days,
      addons,
      notes: `Google Play purchase verified (${productId}${orderId ? `, order ${orderId}` : ""})`,
    });

    let exp = t + config.tokenTtlHours * 3600;
    exp = Math.min(exp, effectivePeriodEnd + config.pastDueGraceDays * 86400);
    exp = Math.max(exp, t + 300);
    const token = signEntitlement(signingKey, {
      sub: account.id,
      device_id: deviceId,
      status: "active",
      plan: effectivePlan,
      addons,
      iat: t,
      exp,
    });

    return c.json({
      ok: true,
      active: baseProActive,
      account_id: account.id,
      email: account.email ?? email ?? null,
      refresh_token: refreshToken,
      token,
      status: baseProActive ? "active" : "addon_only",
      plan: effectivePlan,
      addons,
      expires_at: effectivePeriodEnd,
    });
  });

  app.post("/v1/checkout", auth, async (c) => {
    const account = c.get("account");
    const body = await c.req.json().catch(() => ({}));
    const email = normalizeEmail(body?.email) ?? account.email ?? undefined;
    const rawDeviceId = String(body?.device_id ?? "");
    const fallbackDevice = repo.db
      .prepare("SELECT id FROM devices WHERE account_id = ? LIMIT 1")
      .get(account.id) as { id: string } | undefined;
    const deviceId = DEVICE_RE.test(rawDeviceId) ? rawDeviceId : fallbackDevice?.id ?? "";
    const localizedPricing = await resolvePricingForRequest(c, { trustProxy });
    repo.setAccountLeadMeta(account.id, {
      country: localizedPricing.country,
      lead_device: detectLeadDevice(c, body?.device_type || "pc"),
    });

    // If the entered email already has an active subscription, auto-activate this desktop device immediately
    // and return the entitled account's credentials + signed Ed25519 entitlement token.
    if (email) {
      const entitledAcc = await findOrSyncEntitledAccountByEmail(email);
      if (entitledAcc) {
        const ent = repo.entitlement(entitledAcc.id);
        const t = now();
        if (ent && isEntitled(ent, t, config.pastDueGraceDays) && DEVICE_RE.test(deviceId)) {
          if (!repo.touchDevice(entitledAcc.id, deviceId, "pc", config.maxDevicesPc, config.maxDevicesMobile)) {
            const oldest = repo.db
              .prepare("SELECT id FROM devices WHERE account_id = ? AND type = 'pc' AND revoked = 0 ORDER BY last_seen ASC LIMIT 1")
              .get(entitledAcc.id) as { id: string } | undefined;
            if (oldest) {
              repo.db.prepare("DELETE FROM devices WHERE id = ? AND account_id = ?").run(oldest.id, entitledAcc.id);
            }
            repo.db.prepare("UPDATE devices SET revoked = 0 WHERE id = ? AND account_id = ?").run(deviceId, entitledAcc.id);
            repo.touchDevice(entitledAcc.id, deviceId, "pc", config.maxDevicesPc, config.maxDevicesMobile);
          }
          const refreshToken = randomToken(32);
          repo.setDeviceTokenHash(entitledAcc.id, deviceId, sha256(refreshToken));
          let exp = t + config.tokenTtlHours * 3600;
          if (ent.current_period_end) {
            exp = Math.min(exp, ent.current_period_end + config.pastDueGraceDays * 86400);
          }
          exp = Math.max(exp, t + 300);
          const addons = repo.addonsForAccount(entitledAcc.id);
          const token = signEntitlement(signingKey, {
            sub: entitledAcc.id,
            device_id: deviceId,
            status: ent.status === "trialing" ? "trialing" : "active",
            plan: ent.plan ?? "annual",
            addons,
            iat: t,
            exp,
          });
          return c.json({
            activated: true,
            account_id: entitledAcc.id,
            refresh_token: refreshToken,
            token,
            status: ent.status,
            plan: ent.plan ?? "annual",
            addons,
            expires_at: exp,
          });
        }
      }
    }

    if (!stripe) return c.json({ error: "stripe_not_configured" }, 503);
    const existingEnt = repo.entitlement(account.id);
    const alreadyPro = isEntitled(existingEnt, now(), config.pastDueGraceDays);
    const wantBatteryAddon = hasBatteryCareAddon(body);
    const wantCloudVaultAddon = hasCloudVaultAddon(body);
    const currentAddons = repo.addonsForAccount(account.id);
    const missingWantedAddon =
      (wantBatteryAddon && !currentAddons.includes("battery_care")) ||
      (wantCloudVaultAddon && !currentAddons.includes("cloud_vault"));
    if (alreadyPro && !missingWantedAddon) {
      return c.json({ error: "already_active" }, 409);
    }
    const rawPlan = typeof body?.plan === "string" ? body.plan.toLowerCase() : "";
    const plan: "monthly" | "six_month" | "annual" =
      rawPlan === "annual" ? "annual" : rawPlan === "six_month" || rawPlan === "6month" || rawPlan === "sixmonth" ? "six_month" : "monthly";
    if (email && !account.email) {
      try {
        if (!repo.accountByEmail(email)) {
          repo.updateAccountProfile(account.id, { email });
        }
      } catch {
        // Ignore if email is already associated with another account
      }
    }
    const isAnnual = plan === "annual";
    const isSixMonth = plan === "six_month";
    const includeBatteryCare = wantBatteryAddon && (!alreadyPro || !currentAddons.includes("battery_care"));
    const includeCloudVault = wantCloudVaultAddon && (!alreadyPro || !currentAddons.includes("cloud_vault"));
    const lineItems: any[] = alreadyPro && (includeBatteryCare || includeCloudVault)
      ? []
      : isAnnual
      ? [
          {
            price_data: {
              currency: localizedPricing.currency,
              unit_amount: localizedPricing.annualAmount,
              recurring: { interval: "year" as const },
              product_data: { name: "SWEEPR Cleaner Pro (Annual)" },
            },
            quantity: 1,
          },
        ]
      : isSixMonth
      ? [
          {
            price_data: {
              currency: localizedPricing.currency,
              unit_amount: localizedPricing.sixMonthAmount,
              recurring: { interval: "month" as const, interval_count: 6 },
              product_data: { name: "SWEEPR Cleaner Pro (6-Month)" },
            },
            quantity: 1,
          },
        ]
      : [
          {
            price_data: {
              currency: localizedPricing.currency,
              unit_amount: localizedPricing.monthlyAmount,
              recurring: { interval: "month" as const },
              product_data: { name: "SWEEPR Cleaner Pro (Monthly)" },
            },
            quantity: 1,
          },
        ];

    if (includeBatteryCare) {
      lineItems.push({
        price_data: {
          currency: localizedPricing.currency,
          unit_amount: isAnnual
            ? localizedPricing.batteryCareAnnualAmount
            : isSixMonth
            ? localizedPricing.batteryCareSixMonthAmount
            : localizedPricing.batteryCareMonthlyAmount,
          recurring: isAnnual
            ? { interval: "year" as const }
            : isSixMonth
            ? { interval: "month" as const, interval_count: 6 }
            : { interval: "month" as const },
          product_data: { name: "Total Battery & Mac/Phone Care — Device Lifespan Extender" },
        },
        quantity: 1,
      });
    }
    if (includeCloudVault) {
      lineItems.push({
        price_data: {
          currency: localizedPricing.currency,
          unit_amount: isAnnual
            ? localizedPricing.cloudVaultAnnualAmount
            : isSixMonth
            ? localizedPricing.cloudVaultSixMonthAmount
            : localizedPricing.cloudVaultMonthlyAmount,
          recurring: isAnnual
            ? { interval: "year" as const }
            : isSixMonth
            ? { interval: "month" as const, interval_count: 6 }
            : { interval: "month" as const },
          product_data: { name: "SWEEPR Cloud Protection — Encrypted Photo Vault & Multi-Cloud Backup Sync" },
        },
        quantity: 1,
      });
    }

    const chosenAddons = [
      ...(includeBatteryCare ? ["battery_care"] : []),
      ...(includeCloudVault ? ["cloud_vault"] : []),
    ];

    try {
      const applyMonthlyIntro = plan === "monthly" && !alreadyPro;
      const introCouponId = applyMonthlyIntro
        ? await getOrCreateIntroCoupon(localizedPricing.currency, localizedPricing.introSavingsAmount)
        : null;
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        client_reference_id: account.id,
        ...(account.stripe_customer_id
          ? { customer: account.stripe_customer_id }
          : email
          ? { customer_email: email }
          : {}),
        line_items: lineItems,
        subscription_data: {
          metadata: {
            account_id: account.id,
            plan,
            ...(chosenAddons.length > 0 ? { addons: chosenAddons.join(",") } : {}),
            ...(includeBatteryCare ? { battery_care: "1" } : {}),
            ...(includeCloudVault ? { cloud_vault: "1" } : {}),
          },
        },
        ...(introCouponId
          ? { discounts: [{ coupon: introCouponId }] }
          : { allow_promotion_codes: true }),
        success_url: `${config.publicUrl}/checkout/success`,
        cancel_url: `${config.publicUrl}/checkout/cancel`,
      });
      if (session.url) {
        return c.json({ url: session.url });
      }
    } catch (err) {
      console.warn("[v1/checkout] Falling back to /order:", err);
    }

    const params = new URLSearchParams();
    params.set("plan", plan);
    if (plan === "monthly" && !alreadyPro) params.set("intro", "1");
    if (email) params.set("email", email);
    if (includeCloudVault) params.set("addon", "cloud_vault");
    else if (includeBatteryCare) params.set("addon", "battery_care");
    const qs = params.toString();
    const fallbackUrl = `${config.publicUrl}/order${qs ? `?${qs}` : ""}`;
    return c.json({ url: fallbackUrl });
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
    syncToCentralCrm("/api/support/contact", {
      email,
      subject,
      message,
      os: platform,
      diagnostics: logs ? { logs } : undefined,
    });
    import("./email.js")
      .then(({ sendSupportNotificationEmail }) =>
        sendSupportNotificationEmail({ fromEmail: email, subject, message, platform, ticketId: String(id) })
      )
      .catch(() => {});
    return c.json({ ok: true, id });
  };
  app.post("/api/support-ticket", handleSupportTicket);
  app.post("/v1/support", handleSupportTicket);

  // Tauri v2 Auto-Updater endpoints
  const parseSemverTuple = (v: string): [number, number, number] => {
    const parts = v.replace(/^v/i, "").split("-")[0].split(".");
    return [
      Number.parseInt(parts[0] || "0", 10) || 0,
      Number.parseInt(parts[1] || "0", 10) || 0,
      Number.parseInt(parts[2] || "0", 10) || 0,
    ];
  };
  const isNewerSemver = (latestVer: string, currentVer: string): boolean => {
    const [lMaj, lMin, lPat] = parseSemverTuple(latestVer);
    const [cMaj, cMin, cPat] = parseSemverTuple(currentVer);
    if (lMaj !== cMaj) return lMaj > cMaj;
    if (lMin !== cMin) return lMin > cMin;
    return lPat > cPat;
  };
  const buildUpdateManifest = (opts?: { platform?: string; currentVersion?: string }) => {
    const platform = (opts?.platform || "").trim().toLowerCase();
    const current = (opts?.currentVersion || "").trim().replace(/^v/i, "");
    const desktopLatest = (config.latestAppVersion || process.env.LATEST_APP_VERSION || "0.1.0").replace(/^v/i, "");
    const desktopMin = (config.minAppVersion || process.env.MIN_APP_VERSION || "0.1.0").replace(/^v/i, "");
    const androidLatest = (config.latestAndroidVersion || process.env.LATEST_ANDROID_VERSION || "1.0.0").replace(/^v/i, "");
    const androidMin = (config.minAndroidVersion || process.env.MIN_ANDROID_VERSION || "1.0.0").replace(/^v/i, "");
    const isAndroid = platform === "android";
    const isMac = platform === "macos" || platform === "mac" || platform === "darwin";
    const latest_version = isAndroid ? androidLatest : desktopLatest;
    const min_version = isAndroid ? androidMin : desktopMin;
    const update_available = current ? isNewerSemver(latest_version, current) : false;
    const belowMin = current ? isNewerSemver(min_version, current) : false;
    const envForce = Boolean(config.forceAppUpdate || process.env.FORCE_APP_UPDATE === "true");
    const force_update = current ? belowMin || (envForce && update_available) : envForce;
    const playStoreUrl = "https://play.google.com/store/apps/details?id=com.sweepr.app";
    const marketUri = "market://details?id=com.sweepr.app";
    const downloadUrl = isAndroid
      ? playStoreUrl
      : isMac
        ? `${config.publicUrl}/download?platform=mac`
        : `${config.publicUrl}/download?platform=windows`;
    return {
      version: latest_version,
      latest_version,
      min_version,
      android_version: androidLatest,
      android_min_version: androidMin,
      force_update,
      update_available,
      play_store_url: playStoreUrl,
      market_uri: marketUri,
      notes: config.latestAppNotes || "Bug fixes, security hardening, and new cleaning tools.",
      pub_date: new Date().toISOString(),
      url: downloadUrl,
      signature: config.latestAppSignature || "",
      sha256: process.env.LATEST_APP_SHA256 || "",
      disabledRules: (process.env.DISABLED_CLEAN_RULES || "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    };
  };
  app.get("/v1/updates/latest.json", (c) =>
    c.json(
      buildUpdateManifest({
        platform: c.req.query("platform"),
        currentVersion: c.req.query("current_version"),
      })
    )
  );
  app.get("/v1/updates/:target/:arch/:current_version", (c) => {
    const target = c.req.param("target") ?? "";
    const current = c.req.param("current_version")?.replace(/^v/i, "") ?? "";
    const manifest = buildUpdateManifest({ platform: target, currentVersion: current });
    if (current && !isNewerSemver(manifest.version, current)) return c.body(null, 204);
    return c.json(manifest);
  });

  // Admin-authenticated SQLite logical backup snapshot (#10 Backups)
  app.get("/api/crm/backup-db", (c) => {
    try {
      repo.db.exec("PRAGMA wal_checkpoint(PASSIVE);");
    } catch {}
    const snapshot = {
      exported_at: new Date().toISOString(),
      accounts: repo.db.prepare("SELECT * FROM accounts").all(),
      entitlements: repo.db.prepare("SELECT * FROM entitlements").all(),
      subscriptions: repo.db.prepare("SELECT * FROM subscriptions").all(),
      devices: repo.db.prepare("SELECT * FROM devices").all(),
      support_tickets: repo.db.prepare("SELECT * FROM support_tickets").all(),
      crash_reports: repo.db.prepare("SELECT * FROM crash_reports ORDER BY id DESC LIMIT 500").all(),
      webhook_dlq: repo.db.prepare("SELECT * FROM webhook_dlq ORDER BY created_at DESC LIMIT 200").all(),
    };
    c.header("Content-Disposition", `attachment; filename="sweepr-backup-${ now() }.json"`);
    return c.json(snapshot);
  });

  // Crash reporting & privacy-friendly funnel analytics
  const ALLOWED_FUNNEL_EVENTS = new Set([
    "installer_downloaded",
    "download_completed",
    "download_started",
    "app_installed",
    "extension_installed",
    "first_launch",
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
    syncToCentralCrm("/v1/telemetry/crash", {
      os: body.platform || "windows",
      app_version: body.app_version || "0.1.0",
      error_type: body.error_type || "panic",
      message: body.message || body.error_type || "crash",
      stack_trace: body.stack || null,
    });
    // Automated incident alert notification (#26 Alerts)
    import("./email.js")
      .then(({ sendSupportNotificationEmail }) =>
        sendSupportNotificationEmail({
          fromEmail: "alerts@sweeprcleaner.com",
          subject: `[SWEEPR CRASH ALERT] v${body.app_version || "0.1.0"} on ${body.platform || "windows"}`,
          message: `Crash Report #${id}: ${body.error_type || "panic"} — ${body.message || ""}\n\n${body.stack || ""}`,
          platform: String(body.platform || "windows"),
          ticketId: `crash_${id}`,
        })
      )
      .catch(() => {});
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
    syncToCentralCrm("/v1/telemetry/event", {
      event_name: eventName,
      category: "funnel",
      os: body.platform || "windows",
      account_id: typeof body.account_id === "string" ? body.account_id.slice(0, 64) : null,
      properties: body.metadata || null,
    });
    return c.json({ ok: true, id });
  });

  app.post("/api/affiliate/click", async (c) => {
    if (!limitTelemetry.hit(clientIp(c))) return c.json({ error: "rate_limited" }, 429);
    const body = await c.req.json().catch(() => ({}));
    const code = String(body?.code || body?.ref || "").trim().slice(0, 64);
    if (!code) return c.json({ ok: false, error: "missing_code" }, 400);
    reportAffiliateClickToCentralCrm({
      code,
      landingPath: typeof body?.landing_path === "string" ? body.landing_path.slice(0, 250) : "/",
      referrer: typeof body?.referrer === "string" ? body.referrer.slice(0, 250) : c.req.header("referer") || undefined,
    });
    return c.json({ ok: true });
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
    const account = c.get("account");
    const emailParam = account?.email ? `?email=${encodeURIComponent(account.email)}` : "";
    return c.json({ url: `${config.publicUrl}/login${emailParam}` });
  });

  const handleStripeWebhook = async (c: any) => {
    if (!stripe) return c.json({ error: "stripe_not_configured" }, 503);
    const sig = c.req.header("stripe-signature") ?? "";
    const raw = await c.req.text(); // raw body is required for signature verification
    let event: Stripe.Event | null = null;
    if (config.stripeWebhookSecret && sig) {
      const secrets = config.stripeWebhookSecret
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const secret of secrets) {
        try {
          event = await stripe.webhooks.constructEventAsync(raw, sig, secret);
          if (event) break;
        } catch {
          event = null;
        }
      }
    }
    // Fallback when multiple Stripe webhook endpoints exist with distinct signing secrets:
    // verify the event ID directly against Stripe's API (`stripe.events.retrieve`) using STRIPE_SECRET_KEY.
    if (!event && sig && typeof (stripe.events as any)?.retrieve === "function") {
      try {
        const parsed = JSON.parse(raw);
        const evtId = typeof parsed?.id === "string" ? parsed.id.trim() : "";
        if (/^evt_[A-Za-z0-9_]+$/.test(evtId)) {
          const verified = await stripe.events.retrieve(evtId);
          if (verified && verified.id === evtId) {
            event = verified;
          }
        }
      } catch {
        event = null;
      }
    }
    if (!event) {
      return c.json({ error: "invalid signature" }, 400);
    }
    if (!repo.markEventProcessed(event.id)) return c.json({ received: true, duplicate: true });
    try {
      await handleStripeEvent(stripe, repo, event);
    } catch (e) {
      repo.unmarkEvent(event.id); // let Stripe retry
      repo.recordWebhookDlq(event.id, "stripe", event.type, raw, String((e as Error)?.message || e));
      console.error(`[stripe] failed handling ${event.type} ${event.id}`, e);
      return c.json({ error: "handler_failed" }, 500);
    }
    return c.json({ received: true });
  };

  app.post("/webhooks/stripe", handleStripeWebhook);
  app.post("/api/webhook/stripe", handleStripeWebhook);
  app.post("/api/webhooks/stripe", handleStripeWebhook);
  app.post("/api/stripe-webhook", handleStripeWebhook);
  app.post("/stripe-webhook", handleStripeWebhook);

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
      repo.recordWebhookDlq(key, "revenuecat", String((body as any)?.event?.type || "rc_event"), JSON.stringify(body), String((e as Error)?.message || e));
      console.error("[revenuecat] failed handling webhook", e);
      return c.json({ error: "handler_failed" }, 500);
    }
    return c.json({ received: true });
  });

  // Simple pages the browser lands on after checkout.
  
  const popupClosePage = (status: "success" | "cancelled", targetUrl: string) => {
    const safeUrl = JSON.stringify(targetUrl);
    const safeStatus = JSON.stringify(status);
    return `<!doctype html><html><head><meta charset="utf-8"><title>Pay with PayPal</title></head><body style="font-family:system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#f8fafc;color:#1e293b;"><div style="text-align:center;padding:24px;"><p style="font-weight:600;margin-bottom:12px;">${status === "success" ? "Payment authorized! Returning to SWEEPR Cleaner..." : "Returning to SWEEPR Cleaner..."}</p></div><script>
      (function() {
        var targetUrl = ${safeUrl};
        var status = ${safeStatus};
        var payload = { type: status === 'success' ? 'paypal_success' : 'paypal_cancelled', redirectUrl: targetUrl, ts: Date.now() };
        try {
          if (window.BroadcastChannel) {
            var bc = new BroadcastChannel('sweepr_paypal_checkout');
            bc.postMessage(payload);
          }
        } catch (e) {}
        try {
          localStorage.setItem('sweepr_paypal_event', JSON.stringify(payload));
        } catch (e) {}
        try {
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage(payload, window.location.origin);
            if (status === 'success') {
              window.opener.location.href = targetUrl;
            }
            window.close();
            return;
          }
        } catch (e) {}
        try { window.close(); } catch (e) {}
        setTimeout(function() {
          window.location.href = targetUrl;
        }, 400);
      })();
    </script></body></html>`;
  };

  app.get("/checkout/success", async (c) => {
    const isWeb = c.req.query("web") === "1";
    const isPopup = c.req.query("popup") === "1";
    const sessionId = c.req.query("session_id")?.trim() || "";
    let subscriptionId = c.req.query("subscription_id")?.trim() || "";
    let accountId = c.req.query("account_id")?.trim() || "";
    const redirectStatus = c.req.query("redirect_status")?.trim() || "";
    const paymentIntentId = c.req.query("payment_intent")?.trim() || "";

    if (redirectStatus === "failed" || redirectStatus === "canceled") {
      if (isPopup) {
        return c.html(popupClosePage("cancelled", "/order?error=payment_cancelled"));
      }
      return c.redirect("/order?error=payment_cancelled");
    }

    if ((sessionId || subscriptionId.startsWith("cs_")) && stripe) {
      const targetSessionId = sessionId || subscriptionId;
      try {
        const session = await stripe.checkout.sessions.retrieve(targetSessionId);
        if (session?.subscription) {
          subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
        }
        if (!accountId && typeof session?.metadata?.account_id === "string") {
          accountId = session.metadata.account_id.trim();
        }
      } catch (err) {
        console.error("[checkout/success] session lookup error:", err);
      }
    }

    if (subscriptionId && !subscriptionId.startsWith("cs_") && stripe) {
      try {
        let sub = await retrieveSubscriptionSafe(subscriptionId);
        let piSucceeded = redirectStatus === "succeeded";
        if (!piSucceeded && paymentIntentId && typeof (stripe.paymentIntents as any)?.retrieve === "function") {
          const piObj = await stripe.paymentIntents.retrieve(paymentIntentId).catch(() => null);
          if (piObj && (piObj.status === "succeeded" || piObj.status === "processing")) {
            piSucceeded = true;
          }
        }
        // If PayPal redirect just succeeded, Stripe may take a brief moment to settle the invoice status from incomplete -> active
        if (sub.status === "incomplete" && piSucceeded) {
          await new Promise((r) => setTimeout(r, 800));
          sub = await retrieveSubscriptionSafe(subscriptionId).catch(() => sub);
        }
        if (
          (sub.status === "incomplete" && !piSucceeded) ||
          sub.status === "incomplete_expired" ||
          sub.status === "canceled"
        ) {
          if (isPopup) {
            return c.html(popupClosePage("cancelled", "/order?error=payment_cancelled"));
          }
          return c.redirect("/order?error=payment_cancelled");
        }
        const metaAccountId = typeof sub.metadata?.account_id === "string" ? sub.metadata.account_id.trim() : "";
        if (metaAccountId && accountId && metaAccountId === accountId) {
          await syncPayPalCustomerEmail(sub, metaAccountId);
          const effectiveSub =
            sub.status === "incomplete" && piSucceeded ? ({ ...sub, status: "active" } as Stripe.Subscription) : sub;
          syncSubscription(repo, effectiveSub, metaAccountId);

          const resolvedAccount = repo.accountById(metaAccountId);

          if (resolvedAccount && (effectiveSub.status === "active" || effectiveSub.status === "trialing")) {
            const isFreshSub = !sub.created || now() - Number(sub.created) < 86400;
            if (isFreshSub) {
              await setSignedCookie(c, SESSION_COOKIE, resolvedAccount.id, sessionSecret, {
                path: "/",
                httpOnly: true,
                sameSite: "Lax",
                secure: isHttps,
                maxAge: 86400 * 30,
              });
            }
            const planLabel =
              sub.metadata?.plan === "annual"
                ? "Annual"
                : sub.metadata?.plan === "six_month"
                ? "6-Month"
                : "Pro";
            await dispatchActivationEmail(resolvedAccount, planLabel);
          }
        }
      } catch (err) {
        console.error("[checkout/success] subscription sync error:", err);
      }
    }

    deleteCookie(c, "sweepr_order_draft", { path: "/" });

    if (isPopup) {
      const successTargetUrl = `/checkout/success?web=1${subscriptionId ? `&subscription_id=${encodeURIComponent(subscriptionId)}` : ""}${accountId ? `&account_id=${encodeURIComponent(accountId)}` : ""}`;
      return c.html(popupClosePage("success", successTargetUrl));
    }

    const clearDraftScript = `<script>try{localStorage.removeItem('sweepr_order_draft');document.cookie='sweepr_order_draft=; path=/; max-age=0; SameSite=Lax';}catch(e){}</script>`;
    if (isWeb) {
      return c.html(
        page(
          "You're Activated 🎉",
          `Thanks for purchasing SWEEPR Cleaner! We have emailed your 6-digit Subscription Activation Key. Download the app below, open the Account tab, and enter your email + 6-digit Subscription Key to activate Pro immediately.${clearDraftScript}`,
          true
        )
      );
    }
    return c.html(page("You're Activated 🎉", `Return to SWEEPR Cleaner. It will unlock automatically within a few seconds.${clearDraftScript}`));
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
