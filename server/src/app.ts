import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { compress } from "hono/compress";
import { cors } from "hono/cors";
import { etag } from "hono/etag";
import { getCookie, setCookie, getSignedCookie, setSignedCookie, deleteCookie } from "hono/cookie";
import { bodyLimit } from "hono/body-limit";
import { readFileSync, existsSync, statSync, createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { createHash, createSign, randomInt } from "node:crypto";
import type { Context } from "hono";
import type Stripe from "stripe";
import type { KeyObject } from "node:crypto";
import type { Account, Entitlement, Repo } from "./db.js";
import { randomToken, sha256, signEntitlement } from "./tokens.js";
import { handleStripeEvent, syncSubscription } from "./stripe.js";
import { handleRevenueCatWebhook, RevenueCatPayloadError } from "./revenuecat.js";
import { createCrmRouter, hydrateAutomationRegistry, recordAutomationRunStatus } from "./crm.js";
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
import {
  cleanItems,
  getCleanItems,
  getCleanItemBySlug,
  getPseoRedirectTarget,
  isPseoSlugNoindexed,
  renderGamingAndAiCacheBloatCalculatorPage,
  renderPseoDirectory,
  renderPseoPage,
  setApprovedIntentGapSeoOverride,
} from "./pseo.js";
import { SeoStore } from "./seo/store.js";
import { createSeoRouter } from "./seo/router.js";
import { LOCKED_TEST_TITLE_SLUGS } from "./seo/keywords.js";
import {
  ensureBloatWatchSeeded,
  getBloatWatchPost,
  refreshBloatWatchCleanSlugCache,
  renderBloatWatchIndexHtml,
  renderBloatWatchPostHtml,
} from "./seo/bloat-watch.js";
import {
  ingestScanCompletedTelemetry,
  refreshAllTelemetryTruthCache,
  renderStateOfWindowsStorageHtml,
} from "./seo/telemetry-truth.js";
import {
  normalizeCompetitorHtmlClaims,
  renderLlmsFullTxt,
  renderLlmsTxt,
  syncStaticLlmsTxtFile,
} from "./seo/llms-index.js";
import { analyzeSafeToDeleteInput, renderSafeToDeletePageHtml } from "./safe-to-delete.js";
import {
  getTransactionalToolBySlug,
  renderTransactionalToolPage,
  renderTransactionalToolsHub,
  TRANSACTIONAL_TOOLS,
} from "./transactional-tools.js";
import {
  ACTIVE_EXPERIMENTS,
  assignExperimentVariant,
  attributeCheckoutToExperiments,
  getExperimentLiftMultipliers,
  getExperimentSummary,
  hydratePromotedExperimentWinners,
  promoteExperimentWinner,
  setPromotedWinnersPersistHook,
} from "./experiments.js";
import { getAccountStorageRecap, processAnnualRenewalRecap } from "./renewal-recap.js";
import {
  associateCheckoutLeadWithRecovery,
  computeIpOsFingerprint,
  dispatchPostCleanAhaMilestoneEmail,
  dispatchTransactionalCustomerEmail,
  getVisitorRecoveryStatus,
  recordAppInstalledForRecovery,
  recordInstallerDownloaded,
  recordRecoveryBannerInteraction,
  sanitizeAttributionId,
  SWEEPR_WINDOWS_EXE_SHA256,
} from "./download-recovery.js";
import {
  buildGiveawayReadmeTxt,
  DEFAULT_GOTD_UPGRADE_COUPON,
  getGiveawayConfig,
  isGiveawayCodeMatch,
  isGiveawayWindowOpen,
  redeemGiveawayLicense,
  renderGiveawayPageHtml,
  triggerGiveawayDeviceLimitUpgradeEmail,
} from "./giveaway.js";
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
    priceActivation?: string;
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
    latestAppSha256?: string;
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
  const fields = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term",
    "gclid",
    "fbclid",
    "msclkid",
    "irclickid",
    "visitor_id",
    "attribution_id",
    "coupon",
  ];
  for (const f of fields) {
    const val = String(attr[f] ?? body?.[f] ?? "").trim();
    if (val) meta[f] = val.slice(0, 100);
  }
  return meta;
}

/** Server-side source of truth: is this entitlement currently usable? */
export function resolveCheckoutPromoCoupon(
  rawCoupon: unknown
): { code: "GOTD50" | "SWEEPR50" | "SCAN5GB20" | "WELCOME20" | "STAY30"; discountPct: number; multiplier: number } | null {
  const c = String(rawCoupon ?? "")
    .trim()
    .toUpperCase();
  if (c === "GOTD50") return { code: "GOTD50", discountPct: 50, multiplier: 0.5 };
  if (c === "SWEEPR50") return { code: "SWEEPR50", discountPct: 50, multiplier: 0.5 };
  if (c === "SCAN5GB20") return { code: "SCAN5GB20", discountPct: 20, multiplier: 0.8 };
  if (c === "WELCOME20") return { code: "WELCOME20", discountPct: 20, multiplier: 0.8 };
  if (c === "STAY30") return { code: "STAY30", discountPct: 30, multiplier: 0.7 };
  return null;
}

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
  const limitReferral = createRateLimiter(10, 15 * 60 * 1000);

  const isHttps = config.publicUrl.startsWith("https://");
  const sessionSecret =
    config.sessionSecret ||
    (config.licensePrivateKeyB64 ? sha256(`sweepr-session:${config.licensePrivateKeyB64}`) : randomToken(32));
  const stripeCoupon = config.stripeCoupon ?? "MYskiOdE";
  const trustProxy = config.trustProxy ?? false;
  const clientIp = makeClientIp(trustProxy);

  const issuePortalSessionCookie = async (c: Context, accountId: string) => {
    const acc = repo.accountById(accountId);
    const expSec = now() + 86400 * 30;
    const hashPrefix = (acc?.refresh_token_hash || "").slice(0, 16);
    await setSignedCookie(c, SESSION_COOKIE, `${accountId}.${expSec}.${hashPrefix}`, sessionSecret, {
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      secure: isHttps,
      maxAge: 86400 * 30,
    });
  };

  /** Account id from the signed portal session cookie, or null. */
  const sessionAccountId = async (c: Context): Promise<string | null> => {
    const v = await getSignedCookie(c, sessionSecret, SESSION_COOKIE);
    if (typeof v !== "string" || v.length === 0) return null;
    const parts = v.split(".");
    if (parts.length === 3) {
      const [accId, expStr, hashPrefix] = parts;
      const expSec = Number(expStr);
      if (!accId || !Number.isFinite(expSec) || expSec <= now()) return null;
      const acc = repo.accountById(accId);
      if (!acc) return null;
      const currentPrefix = (acc.refresh_token_hash || "").slice(0, 16);
      if (currentPrefix !== hashPrefix) return null;
      return acc.id;
    }
    return null;
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

  const desktopAndWebCors = cors({
    origin: [
      "https://sweeprcleaner.com",
      "http://tauri.localhost",
      "https://tauri.localhost",
      "tauri://localhost",
      "http://localhost:1420",
    ],
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Poll-Secret"],
    maxAge: 86400,
  });
  app.use("/api/*", desktopAndWebCors);
  app.use("/v1/*", desktopAndWebCors);

  // Drop automated PHP/CGI/scanner probes early before body parsing, static lookup, or bot telemetry
  const SCANNER_PROBE_RE = /\.(?:php\d?|phtml|phar|cgi|asp|aspx|jsp|env)$/i;
  const SCANNER_PATH_RE = /^\/+(?:cgi-bin|vendor\/phpunit|wp-admin|wp-login|wp-content|xmlrpc\.php|\.env|\.git)(?:\/|$)/i;
  app.use("*", async (c, next) => {
    const p = c.req.path;
    if (SCANNER_PROBE_RE.test(p) || SCANNER_PATH_RE.test(p)) {
      return c.text("Not Found", 404);
    }
    if (c.req.method === "GET" || c.req.method === "HEAD") {
      if (p.startsWith("/cdn-cgi/l/email-protection")) {
        c.header("X-Robots-Tag", "noindex, nofollow");
        return c.redirect("/support", 301);
      }
      if (p.length > 1 && /[).,\]]+$/.test(p)) {
        const cleanTarget = p.replace(/[).,\]]+$/, "") || "/";
        return c.redirect(cleanTarget, 301);
      }
      if (p === "/" && c.req.query("home") === "1" && detectBot(c.req.header("user-agent"))) {
        return c.redirect("/", 301);
      }
    }
    await next();
  });

  // Static asset caching & performance headers (strictly non-visual / non-functional)
  app.use("*", async (c, next) => {
    await next();
    const p = c.req.path.toLowerCase();
    if (/^\/+(api|crm|admin|v1|webhooks|dev)(\/|$)/.test(p)) return;
    if (p === "/pad.xml") {
      c.res.headers.set("X-Robots-Tag", "noindex, follow");
    }
    if (c.res.headers.has("Cache-Control")) return;

    if (
      /^\/+(?:favicon(?:-dark)?\.(?:svg|png|ico)|padlock-favicon\.svg|apple-touch-icon\.png|icon-(?:32x32|192|512)\.png|logo-(?:emerald|mint-glass)\.svg|manifest\.webmanifest)$/i.test(p) ||
      /\.(exe|msi|dmg|apk|mobileconfig|appimage)$/i.test(p)
    ) {
      c.res.headers.set("Cache-Control", "public, max-age=0, must-revalidate");
    } else if (p.endsWith(".css") || p.endsWith(".js")) {
      c.res.headers.set("Cache-Control", "public, max-age=604800, stale-while-revalidate=86400");
    } else if (/\.(png|jpe?g|gif|svg|webp|ico|woff2?|ttf)$/.test(p)) {
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
  try {
    refreshAllTelemetryTruthCache(seoStore);
    ensureBloatWatchSeeded(seoStore);
    refreshBloatWatchCleanSlugCache(seoStore);
    hydrateAutomationRegistry(seoStore);
    hydratePromotedExperimentWinners(
      seoStore.getSetting<Record<string, string>>("promoted_experiment_winners", {})
    );
    setPromotedWinnersPersistHook((winners) => {
      seoStore.setSetting("promoted_experiment_winners", winners);
    });
    for (const lockedSlug of LOCKED_TEST_TITLE_SLUGS) {
      setApprovedIntentGapSeoOverride(lockedSlug, null);
    }
    const savedOverrides =
      seoStore.getSetting<Record<string, any>>("intent_gap_approved_ctr_overrides", {}) ?? {};
    let cleanedLockedOverrides = false;
    for (const [slug, ov] of Object.entries(savedOverrides)) {
      const normalizedSlug = slug.trim().toLowerCase();
      if (LOCKED_TEST_TITLE_SLUGS.has(normalizedSlug) && ov && (ov.title || ov.meta_description)) {
        const stillNoindex = Boolean(ov.noindex);
        savedOverrides[slug] = {
          ...ov,
          title: null,
          meta_description: null,
          ctr_status: "rejected",
          status: stillNoindex ? "approved" : "rejected",
          updated_at: new Date().toISOString(),
        };
        cleanedLockedOverrides = true;
        if (stillNoindex) {
          setApprovedIntentGapSeoOverride(slug, {
            noindex: true,
            mergedIntoSlug: ov.merged_into_slug || undefined,
            retiredReason: ov.retired_reason || undefined,
            approvedAt: ov.approved_at || undefined,
          });
        } else {
          setApprovedIntentGapSeoOverride(slug, null);
        }
        continue;
      }
      if (ov && ov.status === "approved") {
        setApprovedIntentGapSeoOverride(slug, {
          title: ov.title || undefined,
          metaDescription: ov.meta_description || undefined,
          approvedAt: ov.approved_at || undefined,
          noindex: typeof ov.noindex === "boolean" ? ov.noindex : undefined,
          mergedIntoSlug: ov.merged_into_slug || undefined,
          retiredReason: ov.retired_reason || undefined,
        });
      }
    }
    if (cleanedLockedOverrides) {
      seoStore.setSetting("intent_gap_approved_ctr_overrides", savedOverrides);
    }
    syncStaticLlmsTxtFile(seoStore);
  } catch {}
  let botHitsSincePrune = 0;
  const recentBotHitMap = new Map<string, number>();
  // Record claimed search-engine / AI-crawler visits (by User-Agent) for the CRM "Crawlers & AI" view.
  app.use("*", async (c, next) => {
    await next();
    if (c.res.status !== 200) return;
    const bot = detectBot(c.req.header("user-agent"));
    const reqPath = c.req.path.slice(0, 200);
    if (!bot || !isTrackablePath(reqPath)) return;
    const nowMs = Date.now();
    const dedupKey = `${bot}:${reqPath}`;
    const lastLogged = recentBotHitMap.get(dedupKey) ?? 0;
    if (nowMs - lastLogged < 60_000) return;
    if (recentBotHitMap.size > 2000) recentBotHitMap.clear();
    recentBotHitMap.set(dedupKey, nowMs);
    try {
      seoStore.recordBotHit(bot, reqPath, c.res.status);
      syncToCentralCrm("/api/crm/seo/bot-hit?project=cleaner", {
        user_agent: (c.req.header("user-agent") || "").slice(0, 250),
        path: reqPath,
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
      seedPaths: [
        "/",
        "/clean",
        "/safe-to-delete",
        "/bloat-watch",
        "/state-of-windows-storage",
        "/vs/ccleaner",
        "/alternatives/ccleaner",
        "/vs/cleanmymac",
        "/alternatives/cleanmymac",
        "/vs/pearcleaner",
        "/alternatives/pearcleaner",
        "/vs/onyx",
        "/alternatives/onyx",
        "/vs/daisydisk",
        "/alternatives/daisydisk",
        "/vs/bleachbit",
        "/alternatives/bleachbit",
        "/vs/cleanmypc",
        "/alternatives/cleanmypc",
        "/vs/avast-cleanup",
        "/alternatives/avast-cleanup",
        "/vs/wise-disk-cleaner",
        "/alternatives/wise-disk-cleaner",
        "/vs/glary-utilities",
        "/alternatives/glary-utilities",
        "/tools",
        ...TRANSACTIONAL_TOOLS.map((t) => `/tools/${t.slug}`),
        ...getCleanItems().map((i) => `/clean/${i.category}/${i.slug}`),
      ],
      defaultKeywords: [
        ["sweepr cleaner", "brand", "/"],
        ["sweepr", "brand", "/"],
        ["ccleaner alternative", "competitor", "/alternatives/ccleaner"],
        ["sweepr vs ccleaner", "competitor", "/vs/ccleaner"],
        ["cleanmymac alternative", "competitor", "/alternatives/cleanmymac"],
        ["sweepr vs cleanmymac", "competitor", "/vs/cleanmymac"],
        ["pearcleaner alternative", "competitor", "/alternatives/pearcleaner"],
        ["sweepr vs pearcleaner", "competitor", "/vs/pearcleaner"],
        ["onyx mac alternative", "competitor", "/alternatives/onyx"],
        ["sweepr vs onyx", "competitor", "/vs/onyx"],
        ["daisydisk alternative", "competitor", "/alternatives/daisydisk"],
        ["sweepr vs daisydisk", "competitor", "/vs/daisydisk"],
        ["bleachbit alternative", "competitor", "/alternatives/bleachbit"],
        ["sweepr vs bleachbit", "competitor", "/vs/bleachbit"],
        ["cleanmypc alternative", "competitor", "/alternatives/cleanmypc"],
        ["sweepr vs cleanmypc", "competitor", "/vs/cleanmypc"],
        ["avast cleanup alternative", "competitor", "/alternatives/avast-cleanup"],
        ["sweepr vs avast cleanup", "competitor", "/vs/avast-cleanup"],
        ["wise disk cleaner alternative", "competitor", "/alternatives/wise-disk-cleaner"],
        ["sweepr vs wise disk cleaner", "competitor", "/vs/wise-disk-cleaner"],
        ["glary utilities alternative", "competitor", "/alternatives/glary-utilities"],
        ["sweepr vs glary utilities", "competitor", "/vs/glary-utilities"],
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
  // redirect public marketing page revisits straight back to /order with their prefilled details.
  // Never redirect legal pages (/privacy, /terms, /refund), /support, or /login.
  const ORDER_DRAFT_REDIRECT_PATHS = /^\/+(?:|(?:de|fr|es)(?:\/+pricing)?|pricing(?:\.html)?|vs\/+[^/]+|alternatives\/+[^/]+|clean(?:\/+[^/]+\/+[^/]+)?)$/i;
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
  const LOCALIZED_META: Record<
    string,
    Record<"home" | "pricing", { title: string; description: string; canonicalPath: string }>
  > = {
    de: {
      home: {
        title: "SWEEPR Cleaner: Schneller PC-, Mac- & Handy-Cleaner (2026)",
        description:
          "Gewinnen Sie in 60 Sekunden Gigabytes Speicherplatz auf Windows 11/10, Mac, iPhone & Android zurück. Sicher bereinigen mit 7-Tage-Wiederherstellung.",
        canonicalPath: "/de",
      },
      pricing: {
        title: "SWEEPR Cleaner Pro Preise: PC-, Mac- & Smartphone-Schutz",
        description:
          "Vergleichen Sie SWEEPR Cleaner Free und Pro. Wählen Sie das Jahresabo (58% sparen) für bis zu 5 Geräte inklusive 14-Tage-Geld-zurück-Garantie.",
        canonicalPath: "/de/pricing",
      },
    },
    fr: {
      home: {
        title: "SWEEPR Cleaner : Nettoyeur Rapide PC, Mac, iPhone & Android",
        description:
          "Libérez des gigaoctets d'espace disque en 60 secondes sur Windows 11/10, Mac, iPhone et Android. Nettoyage sûr sans bloatware avec restauration 7 jours.",
        canonicalPath: "/fr",
      },
      pricing: {
        title: "Tarifs SWEEPR Cleaner Pro : Licences PC, Mac & Mobile (2026)",
        description:
          "Comparez les offres SWEEPR Cleaner Gratuit et Pro. Économisez 58 % avec le forfait annuel pour protéger jusqu'à 5 appareils (garantie 14 jours).",
        canonicalPath: "/fr/pricing",
      },
    },
    es: {
      home: {
        title: "SWEEPR Cleaner: Limpiador Rápido para PC, Mac y Móvil (2026)",
        description:
          "Recupera gigabytes de espacio en 60 segundos en Windows 11/10, Mac, iPhone y Android. Limpieza segura sin bloatware y con restauración de 7 días.",
        canonicalPath: "/es",
      },
      pricing: {
        title: "Precios de SWEEPR Cleaner Pro: Limpiador PC, Mac y Móvil",
        description:
          "Compara los planes SWEEPR Cleaner Gratis y Pro. Ahorra un 58% con el plan Anual Pro para limpiar hasta 5 dispositivos con garantía de 14 días.",
        canonicalPath: "/es/pricing",
      },
    },
  };

  const renderHtmlFileWithLocale = (c: Context, file: string, lang = "en") => {
    if (!existsSync(file)) return c.notFound();
    let html = readFileSync(file, "utf-8");
    if (lang !== "en") {
      html = html.replace(/<html\s+lang="en"/i, `<html lang="${escapeHtml(lang)}"`);
      const locMeta = LOCALIZED_META[lang];
      const pageKey = file.includes("pricing.html") ? "pricing" : file.includes("index.html") ? "home" : null;
      if (locMeta && pageKey) {
        const m = locMeta[pageKey];
        const fullUrl = `https://sweeprcleaner.com${m.canonicalPath}`;
        html = html
          .replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(m.title)}</title>`)
          .replace(
            /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/i,
            `<meta name="description" content="${escapeHtml(m.description)}" />`
          )
          .replace(
            /<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>/i,
            `<link rel="canonical" href="${fullUrl}" />`
          )
          .replace(
            /<meta\s+property="og:url"\s+content="[^"]*"\s*\/?>/i,
            `<meta property="og:url" content="${fullUrl}" />`
          )
          .replace(
            /<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/i,
            `<meta property="og:title" content="${escapeHtml(m.title)}" />`
          )
          .replace(
            /<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/i,
            `<meta property="og:description" content="${escapeHtml(m.description)}" />`
          );
      }
    }
    return c.html(html);
  };

  const handleHomeRoute = async (c: Context) => renderHtmlFileWithLocale(c, "./public/index.html", "en");
  app.get("/", handleHomeRoute);
  app.get("/index.html", (c) => c.redirect("/", 301));

  for (const loc of ["de", "fr", "es"] as const) {
    app.get(`/${loc}`, (c) => renderHtmlFileWithLocale(c, "./public/index.html", loc));
    app.get(`/${loc}/`, (c) => c.redirect(`/${loc}`, 301));
    app.get(`/${loc}/pricing`, (c) => renderHtmlFileWithLocale(c, "./public/pricing.html", loc));
    app.get(`/${loc}/pricing/`, (c) => c.redirect(`/${loc}/pricing`, 301));
    app.get(`/${loc}/order`, (c) => {
      c.header("X-Robots-Tag", "noindex, nofollow");
      return renderHtmlFileWithLocale(c, "./public/order.html", loc);
    });
    app.get(`/${loc}/order/`, (c) => c.redirect(`/${loc}/order`, 301));
  }

  const handleOrderRoute = (c: Context) => {
    c.header("X-Robots-Tag", "noindex, nofollow");
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
  app.get("/cdn-cgi/l/email-protection", (c) => c.redirect("/support", 301));
  app.get("/month", (c) => c.redirect("/pricing", 301));
  app.get("/mo", (c) => c.redirect("/pricing", 301));
  app.get("/year", (c) => c.redirect("/pricing", 301));
  app.get("/yr", (c) => c.redirect("/pricing", 301));
  app.get("/refund", (c) => {
    const file = "./public/refund.html";
    return existsSync(file) ? c.html(readFileSync(file, "utf-8")) : c.notFound();
  });
  app.get("/refund.html", (c) => c.redirect("/refund", 301));
  app.get("/llms.txt", (c) => {
    c.header("Content-Type", "text/plain; charset=utf-8");
    c.header("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
    return c.body(renderLlmsTxt(seoStore));
  });
  app.get("/llms-full.txt", (c) => {
    c.header("Content-Type", "text/plain; charset=utf-8");
    c.header("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
    return c.body(renderLlmsFullTxt(seoStore));
  });
  app.get("/vs/:competitor", async (c) => {
    const raw = String(c.req.param("competitor") ?? "");
    if (raw.toLowerCase().endsWith(".html")) {
      const clean = raw.slice(0, -5).toLowerCase().replace(/[^a-z0-9-]/g, "");
      return c.redirect(`/vs/${clean}`, 301);
    }
    const competitor = raw.toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (raw !== competitor) {
      return c.redirect(`/vs/${competitor}`, 301);
    }
    const file = `./public/vs/${competitor}.html`;
    if (!existsSync(file)) return c.notFound();
    const cur = await resolvePricingForRequest(c, { allowQueryOverride: true });
    const pricingSummary = `${cur.annualFormatted}/yr (Save ${cur.annualSavingsPercent}%), ${cur.sixMonthFormatted}/6mo, or ${cur.monthlyFormatted}/mo`;
    return c.html(normalizeCompetitorHtmlClaims(readFileSync(file, "utf-8"), competitor, pricingSummary));
  });
  app.get("/alternatives/:competitor", async (c) => {
    const raw = String(c.req.param("competitor") ?? "");
    if (raw.toLowerCase().endsWith(".html")) {
      const clean = raw.slice(0, -5).toLowerCase().replace(/[^a-z0-9-]/g, "");
      return c.redirect(`/alternatives/${clean}`, 301);
    }
    const competitor = raw.toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (raw !== competitor) {
      return c.redirect(`/alternatives/${competitor}`, 301);
    }
    const file = `./public/alternatives/${competitor}.html`;
    if (!existsSync(file)) return c.notFound();
    const cur = await resolvePricingForRequest(c, { allowQueryOverride: true });
    const pricingSummary = `${cur.annualFormatted}/yr (Save ${cur.annualSavingsPercent}%), ${cur.sixMonthFormatted}/6mo, or ${cur.monthlyFormatted}/mo`;
    return c.html(normalizeCompetitorHtmlClaims(readFileSync(file, "utf-8"), competitor, pricingSummary));
  });
  app.get("/clean", (c) => c.html(renderPseoDirectory()));
  app.get("/benchmark", (c) => c.html(renderGamingAndAiCacheBloatCalculatorPage()));
  app.get("/tools/pc-cache-calculator", (c) => c.html(renderGamingAndAiCacheBloatCalculatorPage()));
  app.get("/safe-to-delete", (c) => {
    const q = c.req.query("q") || c.req.query("path") || "";
    const visitorKey =
      c.req.query("visitor_id") ||
      getCookie(c, "sweepr_attr_id") ||
      clientIp(c) ||
      "anon";
    return c.html(renderSafeToDeletePageHtml(q, visitorKey));
  });
  app.get("/tools", (c) => c.html(renderTransactionalToolsHub()));
  app.get("/tools/:slug", (c) => {
    const slug = String(c.req.param("slug") ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "");
    const tool = getTransactionalToolBySlug(slug);
    if (!tool) return c.notFound();
    const visitorKey =
      c.req.query("visitor_id") ||
      getCookie(c, "sweepr_attr_id") ||
      clientIp(c) ||
      "anon";
    return c.html(renderTransactionalToolPage(tool, visitorKey));
  });
  app.post("/api/safe-to-delete/check", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const raw =
      typeof body.input === "string"
        ? body.input
        : Array.isArray(body.paths)
        ? body.paths.join("\n")
        : String(body.path ?? "");
    const analysis = analyzeSafeToDeleteInput(raw);
    return c.json({ ok: true, ...analysis });
  });
  app.get("/bloat-watch", (c) => c.html(renderBloatWatchIndexHtml(seoStore)));
  app.get("/state-of-windows-storage", (c) => c.html(renderStateOfWindowsStorageHtml(seoStore)));
  app.get("/sitemap.xml", (c) => {
    const file = "./public/sitemap.xml";
    if (!existsSync(file)) return c.notFound();
    let xml = readFileSync(file, "utf-8");
    xml = xml.replace(/<url>[\s\S]*?<loc>([^<]+)<\/loc>[\s\S]*?<\/url>\s*/gi, (block, loc) => {
      const m = String(loc || "").match(/\/clean\/[^/]+\/([a-z0-9-]+)$/i);
      if (m && isPseoSlugNoindexed(m[1])) {
        return "";
      }
      return block;
    });
    c.header("Content-Type", "application/xml; charset=utf-8");
    return c.body(xml);
  });
  app.get("/bloat-watch/:slug", (c) => {
    const slug = String(c.req.param("slug") ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "");
    const post = getBloatWatchPost(seoStore, slug);
    if (!post || post.status !== "published") return c.notFound();
    return c.html(renderBloatWatchPostHtml(post));
  });
  app.get("/clean/:category/:slug", (c) => {
    const category = String(c.req.param("category") ?? "").toLowerCase();
    const rawSlug = String(c.req.param("slug") ?? "");
    let cleanSlug = rawSlug.toLowerCase().replace(/%20|\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");

    // Legacy / historical redirect aliases
    if (
      cleanSlug === "elgato-stream-deck-media-blob-storage" ||
      cleanSlug === "elgato-stream-deck-code-bytecode-cache" ||
      cleanSlug === "elgato-stream-deck-service-worker-cachestorage" ||
      cleanSlug === "elgato-stream-deck-gpu-shader-cache" ||
      cleanSlug === "elgato-stream-deck-crashpad-dump-logs" ||
      cleanSlug === "elgato-stream-deck-cache" ||
      (cleanSlug.startsWith("elgato-streamdeck-") && cleanSlug !== "elgato-streamdeck-cache")
    ) {
      return c.redirect("/clean/app/elgato-streamdeck-cache", 301);
    }
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

    const consolidatedTarget = getPseoRedirectTarget(category, cleanSlug);
    if (consolidatedTarget) {
      return c.redirect(consolidatedTarget, 301);
    }

    if (rawSlug !== cleanSlug) {
      return c.redirect(`/clean/${category}/${cleanSlug}`, 301);
    }

    const item = getCleanItemBySlug(category, cleanSlug) ?? getCleanItems().find((i) => i.category === category && i.slug === cleanSlug);
    if (!item) return c.notFound();
    return c.html(renderPseoPage(item));
  });
  // NOTE: `msg` is trusted, server-authored HTML (pickerPage injects links). Never pass user input as `msg`.
  const page = (rawTitle: string, msg: string, downloadLink = false) => {
    const title = escapeHtml(rawTitle);
    const fullTitle =
      rawTitle === "Download SWEEPR Cleaner"
        ? "Download SWEEPR Cleaner — Windows, Mac, iOS & Android"
        : rawTitle.length < 30
          ? `${title} | SWEEPR Cleaner Official`
          : title.slice(0, 60);
    const desc =
      "Download or activate SWEEPR Cleaner across Windows 11/10, macOS, Android, and iPhone/iPad. Digitally signed native cleaner with 14-day money-back guarantee.";
    const dlJsonLd = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: "Download SWEEPR Cleaner",
      description: desc,
      url: "https://sweeprcleaner.com/download",
    });
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${fullTitle}</title><meta name="description" content="${desc}"><meta name="robots" content="noindex, nofollow"><link rel="canonical" href="https://sweeprcleaner.com/download"><script type="application/ld+json">${dlJsonLd}</script><link rel="icon" type="image/svg+xml" href="/favicon.svg?v=20261031b"><link rel="alternate icon" type="image/png" href="/favicon.png?v=20261031b"><link rel="shortcut icon" href="/favicon.ico?v=20261031b"><link rel="apple-touch-icon" href="/apple-touch-icon.png?v=20261031b"><script src="/analytics.js" defer></script></head><body style="font-family:system-ui, -apple-system, sans-serif;background:#f4f5f3;color:#111613;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px;box-sizing:border-box;"><div style="text-align:center;padding:28px 22px;background:#ffffff;border:1px solid #d6dad5;border-radius:20px;box-shadow:0 8px 32px rgba(17,22,19,0.06);width:100%;max-width:420px;box-sizing:border-box;"><h1 style="margin-top:0;font-size:24px;line-height:1.25;">${title}</h1><p style="color:#4b554e;line-height:1.5;font-size:15px;">${msg}</p>${downloadLink ? '<a href="/download" rel="nofollow" style="display:inline-block;margin-top:20px;background:#0d6847;color:#fff;padding:12px 24px;border-radius:12px;text-decoration:none;font-weight:bold;box-shadow:0 4px 12px rgba(13,104,71,0.25);">Download SWEEPR Cleaner</a>' : ''}</div></body></html>`;
  };

  // ---------- Smart download: one button, the right app for every device ----------
  type Platform = "windows" | "mac" | "linux" | "android" | "ios";

  const DESKTOP_FILES: Record<Platform, { file: string; type: string; label: string }> = {
    windows: { file: "SWEEPRCleaner.exe", type: "application/vnd.microsoft.portable-executable", label: "Windows" },
    mac: { file: "SWEEPRCleaner.dmg", type: "application/x-apple-diskimage", label: "Mac" },
    linux: { file: "SWEEPRCleaner.AppImage", type: "application/x-executable", label: "Linux" },
    android: { file: "SWEEPRCleaner.apk", type: "application/vnd.android.package-archive", label: "Android" },
    ios: { file: "SWEEPRCleaner.dmg", type: "application/x-apple-diskimage", label: "iPhone & iPad" },
  };

  let cachedApkSha256: string | null = null;
  const getApkSha256 = (): string => {
    if (cachedApkSha256) return cachedApkSha256;
    try {
      if (existsSync("./public/SWEEPRCleaner.apk")) {
        cachedApkSha256 = createHash("sha256")
          .update(readFileSync("./public/SWEEPRCleaner.apk"))
          .digest("hex")
          .toUpperCase();
        return cachedApkSha256;
      }
    } catch {}
    return "E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855";
  };

  const cachedInstallerMeta = new Map<Platform, { sha256: string; sizeMb: string }>();
  const getInstallerMeta = (platform: Platform): { sha256: string; sizeMb: string } => {
    const hit = cachedInstallerMeta.get(platform);
    if (hit) return hit;
    const { file } = DESKTOP_FILES[platform];
    const p = `./public/${file}`;
    try {
      if (existsSync(p)) {
        const buf = readFileSync(p);
        const sha256 = createHash("sha256").update(buf).digest("hex").toUpperCase();
        const sizeMb = `${(buf.length / (1024 * 1024)).toFixed(1)} MB`;
        const meta = { sha256, sizeMb };
        cachedInstallerMeta.set(platform, meta);
        return meta;
      }
    } catch {}
    if (platform === "android") {
      return { sha256: getApkSha256(), sizeMb: "3.2 MB" };
    }
    return {
      sha256: SWEEPR_WINDOWS_EXE_SHA256,
      sizeMb: platform === "mac" ? "7.0 MB" : "6.5 MB",
    };
  };

  const renderPostDownloadThankYouPage = (
    activePlatform: "windows" | "mac" | "linux",
    attributionId: string
  ): string => {
    const winMeta = getInstallerMeta("windows");
    const macMeta = getInstallerMeta("mac");
    const activeMeta = activePlatform === "mac" ? macMeta : getInstallerMeta(activePlatform);
    const activeFile = DESKTOP_FILES[activePlatform].file;
    const streamHref =
      activePlatform === "mac"
        ? "/download?stream=1&platform=mac"
        : activePlatform === "linux"
          ? "/download?stream=1&platform=linux"
          : "/download?stream=1&platform=windows";
    const isMacDefault = activePlatform === "mac";
    const safeAttrId = escapeHtml(attributionId);
    const safeWinSha = escapeHtml(winMeta.sha256);
    const safeMacSha = escapeHtml(macMeta.sha256);
    const safeActiveSha = escapeHtml(activeMeta.sha256);
    const safeActiveFile = escapeHtml(activeFile);
    const safeSizeMb = escapeHtml(activeMeta.sizeMb);
    const dlJsonLd = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: "Thank You for Downloading SWEEPR Cleaner",
      description:
        "Post-download setup walkthrough, verified SSL.com publisher details, SHA-256 checksum, and backup link for SWEEPR Cleaner.",
      url: "https://sweeprcleaner.com/download",
    });

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Downloading SWEEPR Cleaner — 3-Step Quick Launch Guide</title>
  <meta name="description" content="Your SWEEPR Cleaner download is starting automatically. Follow the 3-step Windows SmartScreen or macOS Gatekeeper walkthrough to run your free 60-second scan." />
  <meta name="robots" content="noindex, nofollow" />
  <link rel="canonical" href="https://sweeprcleaner.com/download" />
  <script type="application/ld+json">${dlJsonLd}</script>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg?v=20261031b" />
  <link rel="alternate icon" type="image/png" href="/favicon.png?v=20261031b" />
  <link rel="shortcut icon" href="/favicon.ico?v=20261031b" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png?v=20261031b" />
  <script src="/analytics.js" defer></script>
  <style>
    :root {
      --bg: #f4f6f4;
      --surface: #ffffff;
      --surface-muted: #f8faf9;
      --border: #d5ded8;
      --text: #111814;
      --muted: #4b5750;
      --emerald: #0d6847;
      --emerald-bright: #10b981;
      --emerald-soft: #eaf5ef;
      --emerald-border: #9adbc0;
      --win-blue: #0067c0;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
      background: radial-gradient(circle at 50% 0%, #e6f3ec 0%, var(--bg) 52%);
      color: var(--text);
      min-height: 100vh;
      padding: 20px 16px 48px;
    }
    .shell {
      max-width: 960px;
      margin: 0 auto;
    }
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 18px;
      flex-wrap: wrap;
    }
    .brand {
      display: inline-flex;
      align-items: center;
      gap: 9px;
      text-decoration: none;
      color: var(--text);
      font-weight: 800;
      font-size: 17px;
      letter-spacing: -0.02em;
    }
    .brand img { border-radius: 8px; display: block; }
    .brand span em { font-style: normal; color: var(--emerald); }
    .top-links {
      display: flex;
      align-items: center;
      gap: 14px;
      font-size: 13px;
      font-weight: 600;
    }
    .top-links a { color: var(--muted); text-decoration: none; }
    .top-links a:hover { color: var(--emerald); text-decoration: underline; }
    .hero-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 22px;
      padding: 26px 28px;
      box-shadow: 0 12px 36px rgba(13, 40, 28, 0.06);
    }
    .status-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 12px;
    }
    .dl-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 13px;
      border-radius: 999px;
      background: var(--emerald-soft);
      border: 1px solid var(--emerald-border);
      color: #074730;
      font-size: 12.5px;
      font-weight: 800;
    }
    .pulse-dot {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: var(--emerald-bright);
      box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.22);
    }
    .trust-pills {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      font-size: 11.5px;
      font-weight: 700;
      color: #1e3a2f;
    }
    .trust-pills span {
      background: #f1f5f3;
      border: 1px solid #dce5df;
      padding: 4px 10px;
      border-radius: 999px;
    }
    h1 {
      margin: 4px 0 8px;
      font-size: clamp(23px, 3.2vw, 31px);
      line-height: 1.2;
      letter-spacing: -0.025em;
    }
    .hero-sub {
      margin: 0 0 18px;
      color: var(--muted);
      font-size: 14.5px;
      line-height: 1.5;
    }
    .hero-sub a {
      color: var(--emerald);
      font-weight: 700;
    }
    .os-tabs {
      display: inline-flex;
      gap: 6px;
      padding: 4px;
      border-radius: 12px;
      background: #eef2ef;
      border: 1px solid var(--border);
      margin-bottom: 18px;
    }
    .os-tab {
      border: none;
      background: transparent;
      color: var(--muted);
      font-size: 13px;
      font-weight: 700;
      padding: 8px 14px;
      border-radius: 9px;
      cursor: pointer;
    }
    .os-tab.active {
      background: var(--surface);
      color: var(--text);
      box-shadow: 0 2px 8px rgba(17, 24, 20, 0.08);
    }
    .steps-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 14px;
    }
    @media (max-width: 820px) {
      .steps-grid { grid-template-columns: 1fr; }
      .hero-card { padding: 20px 18px; }
    }
    .step-card {
      background: var(--surface-muted);
      border: 1.5px solid var(--border);
      border-radius: 16px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .step-card.highlight {
      border-color: var(--emerald);
      background: #f3faf6;
    }
    .step-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 11.5px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--emerald);
    }
    .step-num {
      width: 22px;
      height: 22px;
      border-radius: 999px;
      background: var(--emerald);
      color: #fff;
      display: inline-grid;
      place-items: center;
      font-size: 12px;
      font-weight: 800;
    }
    .step-title {
      margin: 0;
      font-size: 15.5px;
      font-weight: 800;
      line-height: 1.3;
    }
    .step-desc {
      margin: 0;
      font-size: 13px;
      color: var(--muted);
      line-height: 1.48;
    }
    .visual-box {
      margin-top: auto;
      border-radius: 11px;
      padding: 11px 12px;
      background: #ffffff;
      border: 1px solid #d5ded8;
      font-size: 12px;
    }
    .browser-dl-pill {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 8px 10px;
      border-radius: 9px;
      background: #f1f5f9;
      border: 1px solid #cbd5e1;
      font-weight: 700;
      color: #0f172a;
    }
    .browser-dl-open {
      color: var(--win-blue);
      font-weight: 800;
      font-size: 11.5px;
    }
    .smartscreen-mock {
      background: #1b2a38;
      color: #f8fafc;
      border-radius: 10px;
      padding: 11px 12px;
      border: 1px solid #334155;
      font-size: 11.5px;
      line-height: 1.4;
    }
    .ss-head {
      font-weight: 800;
      font-size: 12px;
      color: #ffffff;
      margin-bottom: 4px;
    }
    .ss-more {
      display: inline-block;
      color: #60a5fa;
      text-decoration: underline;
      font-weight: 800;
      margin: 3px 0 6px;
    }
    .ss-pub {
      font-size: 11px;
      color: #cbd5e1;
      margin-bottom: 8px;
    }
    .ss-pub strong { color: #6ee7b7; }
    .ss-actions {
      display: flex;
      gap: 6px;
      justify-content: flex-end;
    }
    .ss-btn-run {
      background: #e2e8f0;
      color: #0f172a;
      font-weight: 800;
      padding: 4px 10px;
      border-radius: 4px;
      border: 2px solid #34d399;
      font-size: 11px;
    }
    .ss-btn-dont {
      background: transparent;
      color: #94a3b8;
      padding: 4px 8px;
      border-radius: 4px;
      border: 1px solid #475569;
      font-size: 11px;
    }
    .scan-ready-mock {
      background: linear-gradient(135deg, #073825, #0d6847);
      color: #ecfdf5;
      border-radius: 10px;
      padding: 11px 12px;
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    .scan-ready-mock strong { font-size: 12.5px; }
    .scan-ready-mock span { font-size: 11.5px; color: #a7f3d0; }
    .lower-grid {
      display: grid;
      grid-template-columns: 1.05fr 1fr;
      gap: 14px;
      margin-top: 16px;
    }
    @media (max-width: 820px) {
      .lower-grid { grid-template-columns: 1fr; }
    }
    .sub-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 18px;
      padding: 18px 20px;
    }
    .sub-card h2 {
      margin: 0 0 6px;
      font-size: 15px;
      font-weight: 800;
    }
    .sub-card p {
      margin: 0 0 10px;
      font-size: 12.5px;
      color: var(--muted);
      line-height: 1.45;
    }
    .sha-row {
      display: flex;
      align-items: center;
      gap: 8px;
      background: #f1f5f3;
      border: 1px solid #cbd5cf;
      border-radius: 10px;
      padding: 8px 10px;
    }
    .sha-code {
      flex: 1;
      font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
      font-size: 11.5px;
      color: #143625;
      word-break: break-all;
      user-select: all;
    }
    .copy-btn {
      flex-shrink: 0;
      background: var(--surface);
      color: var(--emerald);
      border: 1px solid var(--emerald);
      border-radius: 8px;
      padding: 7px 11px;
      font-size: 12px;
      font-weight: 800;
      cursor: pointer;
    }
    .copy-btn:hover { background: var(--emerald-soft); }
    .ps-hint {
      margin-top: 8px;
      font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
      font-size: 11px;
      color: #475569;
      background: #f8fafc;
      border: 1px dashed #cbd5e1;
      border-radius: 8px;
      padding: 6px 9px;
      overflow-x: auto;
    }
    .email-form {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .email-input {
      flex: 1;
      min-width: 190px;
      padding: 10px 12px;
      border-radius: 10px;
      border: 1px solid #b8c4bc;
      font-size: 13.5px;
    }
    .email-submit {
      background: var(--emerald);
      color: #ffffff;
      border: none;
      border-radius: 10px;
      padding: 10px 15px;
      font-size: 13px;
      font-weight: 800;
      cursor: pointer;
      white-space: nowrap;
    }
    .email-submit:hover { background: #095237; }
    .coupon-reveal {
      display: none;
      margin-top: 10px;
      padding: 10px 12px;
      border-radius: 10px;
      background: var(--emerald-soft);
      border: 1px solid var(--emerald-border);
      font-size: 12.5px;
      color: #073825;
    }
    .coupon-pill {
      display: inline-block;
      font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
      font-weight: 900;
      background: #ffffff;
      border: 1px dashed var(--emerald);
      padding: 2px 8px;
      border-radius: 6px;
      margin: 0 4px;
    }
    .footer-links {
      margin-top: 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 10px;
      font-size: 12.5px;
      color: var(--muted);
    }
    .footer-links a { color: var(--emerald); font-weight: 700; text-decoration: none; }
    .footer-links a:hover { text-decoration: underline; }
    .hidden-os { display: none !important; }
  </style>
</head>
<body>
  <iframe id="dlAutoStreamFrame" title="SWEEPR Installer Stream" style="display:none;width:0;height:0;border:0;" aria-hidden="true"></iframe>

  <div class="shell">
    <header class="topbar">
      <a href="/" class="brand">
        <img src="/favicon.svg?v=20261031b" alt="SWEEPR" width="30" height="30" />
        <span>SWEEPR <em>Cleaner</em></span>
      </a>
      <nav class="top-links" aria-label="Download options">
        <a href="/download?stream=1&amp;platform=windows" rel="nofollow">Windows (.exe)</a>
        <a href="/download?stream=1&amp;platform=mac" rel="nofollow">macOS (.dmg)</a>
        <a href="/download?platform=picker" rel="nofollow">All Platforms</a>
        <a href="/pricing">Pro Plans</a>
      </nav>
    </header>

    <main class="hero-card" data-attribution-id="${safeAttrId}">
      <div class="status-row">
        <div class="dl-pill" role="status">
          <span class="pulse-dot" aria-hidden="true"></span>
          <span id="dlStatusLabel">Starting download: ${safeActiveFile} (${safeSizeMb})…</span>
        </div>
        <div class="trust-pills">
          <span>✓ SSL.com Publisher: Benjamin Cook</span>
          <span>✓ 500 MB Free Starter Clean</span>
          <span>✓ 7-Day Undo Quarantine</span>
        </div>
      </div>

      <h1>Thank you! Launch SWEEPR Cleaner in 3 quick steps</h1>
      <p class="hero-sub">
        Your installer is downloading automatically to your browser&rsquo;s top-right <strong>Downloads</strong> bar.
        Didn&rsquo;t start?
        <a id="directStreamAnchor" href="${escapeHtml(streamHref)}" rel="nofollow">Click here to download <span id="directFileName">${safeActiveFile}</span> directly</a>.
      </p>

      <div class="os-tabs" role="tablist" aria-label="Operating system setup guide">
        <button type="button" id="tabBtnWin" role="tab" aria-selected="${isMacDefault ? "false" : "true"}" class="os-tab${isMacDefault ? "" : " active"}" onclick="window.__switchDlOs('windows')">
          💻 Windows 10 &amp; 11 (SmartScreen)
        </button>
        <button type="button" id="tabBtnMac" role="tab" aria-selected="${isMacDefault ? "true" : "false"}" class="os-tab${isMacDefault ? " active" : ""}" onclick="window.__switchDlOs('mac')">
          🍏 macOS 11+ (Gatekeeper)
        </button>
      </div>

      <!-- Windows 3-Step SmartScreen Walkthrough -->
      <section id="stepsWin" class="steps-grid${isMacDefault ? " hidden-os" : ""}" aria-label="Windows SmartScreen 3-step walkthrough">
        <article class="step-card">
          <div class="step-badge"><span class="step-num">1</span> Step 1</div>
          <h2 class="step-title">Open SWEEPRCleaner.exe</h2>
          <p class="step-desc">Click <strong>SWEEPRCleaner.exe</strong> in your browser&rsquo;s top-right Downloads shelf (or press <kbd>Ctrl</kbd>+<kbd>J</kbd>).</p>
          <div class="visual-box">
            <div class="browser-dl-pill">
              <span>📦 SWEEPRCleaner.exe</span>
              <span class="browser-dl-open">Open file ↗</span>
            </div>
          </div>
        </article>

        <article class="step-card highlight">
          <div class="step-badge"><span class="step-num">2</span> Step 2 · Windows SmartScreen</div>
          <h2 class="step-title">Click More info &rarr; Run anyway</h2>
          <p class="step-desc">If Windows shows a blue prompt on this fresh Rust build, click <strong>More info</strong>, verify <strong>Verified SSL.com Publisher: Benjamin Cook</strong>, and click <strong>Run anyway</strong>.</p>
          <div class="smartscreen-mock" aria-label="Windows SmartScreen prompt preview">
            <div class="ss-head">Windows protected your PC</div>
            <span class="ss-more">More info</span>
            <div class="ss-pub">App: SWEEPRCleaner.exe<br />Publisher: <strong>Verified SSL.com Publisher: Benjamin Cook</strong></div>
            <div class="ss-actions">
              <span class="ss-btn-run">Run anyway</span>
              <span class="ss-btn-dont">Don&rsquo;t run</span>
            </div>
          </div>
        </article>

        <article class="step-card">
          <div class="step-badge"><span class="step-num">3</span> Step 3</div>
          <h2 class="step-title">Free 60s Scan starts automatically</h2>
          <p class="step-desc">Click <strong>Install</strong> once (&lt;0.3s, zero bundled bloatware) — your <strong>Free 60s Scan starts automatically</strong> with 500 MB Free Starter Clean.</p>
          <div class="scan-ready-mock">
            <strong>⚡ Instant 1-Click Launch</strong>
            <span>Scans System Temp, Shaders, Browsers &amp; AI Caches in seconds</span>
          </div>
        </article>
      </section>

      <!-- macOS 3-Step Gatekeeper Walkthrough -->
      <section id="stepsMac" class="steps-grid${isMacDefault ? "" : " hidden-os"}" aria-label="macOS Gatekeeper 3-step walkthrough">
        <article class="step-card">
          <div class="step-badge"><span class="step-num">1</span> Step 1</div>
          <h2 class="step-title">Open SWEEPRCleaner.dmg</h2>
          <p class="step-desc">Open <strong>SWEEPRCleaner.dmg</strong> from Downloads and drag <strong>SWEEPR Cleaner</strong> into your <strong>Applications</strong> folder.</p>
          <div class="visual-box">
            <div class="browser-dl-pill">
              <span>💿 SWEEPRCleaner.dmg</span>
              <span class="browser-dl-open">Drag to Applications &rarr;</span>
            </div>
          </div>
        </article>

        <article class="step-card highlight">
          <div class="step-badge"><span class="step-num">2</span> Step 2 · macOS Gatekeeper</div>
          <h2 class="step-title">Right-click &rarr; Open (First Launch)</h2>
          <p class="step-desc">In <strong>Applications</strong>, <strong>Control-click (Right-click)</strong> SWEEPR Cleaner and choose <strong>Open</strong> (or go to <strong>System Settings &rarr; Privacy &amp; Security &rarr; Open Anyway</strong>).</p>
          <div class="smartscreen-mock" aria-label="macOS Gatekeeper prompt preview">
            <div class="ss-head">macOS Gatekeeper First-Run Check</div>
            <div class="ss-pub" style="margin-top:4px;">Applications &rarr; Control-Click <strong>SWEEPR Cleaner.app</strong></div>
            <div class="ss-actions">
              <span class="ss-btn-run">Open</span>
              <span class="ss-btn-dont">Cancel</span>
            </div>
          </div>
        </article>

        <article class="step-card">
          <div class="step-badge"><span class="step-num">3</span> Step 3</div>
          <h2 class="step-title">Free 60s Scan starts automatically</h2>
          <p class="step-desc">SWEEPR opens immediately and your <strong>Free 60s Scan starts automatically</strong> with 500 MB Free Starter Clean &amp; 7-Day Undo Quarantine.</p>
          <div class="scan-ready-mock">
            <strong>⚡ Native Apple Silicon &amp; Intel</strong>
            <span>Scans System Temp, Xcode, Browsers &amp; App Caches safely</span>
          </div>
        </article>
      </section>
    </main>

    <div class="lower-grid">
      <section class="sub-card" aria-label="Verified SHA-256 Checksum">
        <h2>🔐 Verified SHA-256 Checksum (<span id="shaFileName">${safeActiveFile}</span>)</h2>
        <p>Verify your downloaded installer matches our official SSL.com signed build byte-for-byte:</p>
        <div class="sha-row">
          <code id="sha256Code" class="sha-code">${safeActiveSha}</code>
          <button type="button" id="copySha256Btn" class="copy-btn" onclick="window.__copySha256()">Copy SHA-256</button>
        </div>
        <div id="shaVerifyCmd" class="ps-hint">${
          isMacDefault
            ? "shasum -a 256 ~/Downloads/SWEEPRCleaner.dmg"
            : "Get-FileHash ~\\Downloads\\SWEEPRCleaner.exe -Algorithm SHA256"
        }</div>
      </section>

      <section class="sub-card" id="dlRecoveryBox" aria-label="Email backup link and 20% welcome coupon">
        <h2>📩 Email Me a Backup Link + 20% Welcome Coupon</h2>
        <p>Optional: get your direct Windows &amp; Mac backup download link, SHA-256 checksum, and a <strong>20% off SWEEPR Pro welcome coupon</strong> sent to your inbox.</p>
        <form id="dlRecoveryForm" class="email-form" onsubmit="return window.__bindDlEmail(event)">
          <input type="email" id="dlRecoveryEmail" class="email-input" required placeholder="you@example.com" aria-label="Email address" />
          <button type="submit" id="dlRecoverySubmit" class="email-submit">Send Backup Link + 20% Off</button>
        </form>
        <div id="dlRecoveryStatus" class="coupon-reveal" role="status">
          ✓ Sent! Your 20% Welcome Coupon is <span class="coupon-pill">WELCOME20</span> &mdash;
          <a href="/order?plan=annual&amp;coupon=WELCOME20" rel="nofollow" style="color:#0d6847;font-weight:800;text-decoration:underline;">Apply 20% Off on Pro &rarr;</a>
        </div>
      </section>
    </div>

    <footer class="footer-links">
      <span>Need help launching SWEEPR? <a href="/support">Contact 1-on-1 Support</a> or install via Winget: <code>winget install SWEEPR.Cleaner</code></span>
      <div>
        <a href="/order?plan=annual" rel="nofollow">Unlock 5-Device Pro License &rarr;</a>
        &nbsp;&middot;&nbsp;
        <a href="/">&larr; Back to Home</a>
      </div>
    </footer>
  </div>

  <script>
    (function () {
      var META = {
        windows: {
          file: "SWEEPRCleaner.exe",
          sha: ${JSON.stringify(winMeta.sha256).replace(/</g, "\\u003c")},
          stream: "/download?stream=1&platform=windows",
          cmd: "Get-FileHash ~\\\\Downloads\\\\SWEEPRCleaner.exe -Algorithm SHA256"
        },
        mac: {
          file: "SWEEPRCleaner.dmg",
          sha: ${JSON.stringify(macMeta.sha256).replace(/</g, "\\u003c")},
          stream: "/download?stream=1&platform=mac",
          cmd: "shasum -a 256 ~/Downloads/SWEEPRCleaner.dmg"
        }
      };
      var autoStreamUrl = ${JSON.stringify(streamHref).replace(/</g, "\\u003c")};
      var currentOs = ${JSON.stringify(isMacDefault ? "mac" : "windows")};

      setTimeout(function () {
        var frame = document.getElementById("dlAutoStreamFrame");
        if (frame) {
          frame.src = autoStreamUrl;
        } else {
          var a = document.createElement("a");
          a.href = autoStreamUrl;
          a.rel = "nofollow";
          a.style.display = "none";
          document.body.appendChild(a);
          a.click();
        }
        var lbl = document.getElementById("dlStatusLabel");
        if (lbl) {
          lbl.textContent = "Downloading " + (META[currentOs] ? META[currentOs].file : "SWEEPRCleaner.exe") + " — check your browser Downloads bar ↗";
        }
      }, 300);

      window.__switchDlOs = function (os) {
        currentOs = os === "mac" ? "mac" : "windows";
        var isMac = currentOs === "mac";
        var winSec = document.getElementById("stepsWin");
        var macSec = document.getElementById("stepsMac");
        var btnWin = document.getElementById("tabBtnWin");
        var btnMac = document.getElementById("tabBtnMac");
        if (winSec) winSec.classList.toggle("hidden-os", isMac);
        if (macSec) macSec.classList.toggle("hidden-os", !isMac);
        if (btnWin) {
          btnWin.classList.toggle("active", !isMac);
          btnWin.setAttribute("aria-selected", isMac ? "false" : "true");
        }
        if (btnMac) {
          btnMac.classList.toggle("active", isMac);
          btnMac.setAttribute("aria-selected", isMac ? "true" : "false");
        }
        var m = META[currentOs];
        var shaEl = document.getElementById("sha256Code");
        var shaFile = document.getElementById("shaFileName");
        var cmdEl = document.getElementById("shaVerifyCmd");
        var directA = document.getElementById("directStreamAnchor");
        var directFn = document.getElementById("directFileName");
        if (shaEl) shaEl.textContent = m.sha;
        if (shaFile) shaFile.textContent = m.file;
        if (cmdEl) cmdEl.textContent = m.cmd;
        if (directA) directA.setAttribute("href", m.stream);
        if (directFn) directFn.textContent = m.file;
      };

      window.__copySha256 = function () {
        var el = document.getElementById("sha256Code");
        var btn = document.getElementById("copySha256Btn");
        var txt = el ? (el.textContent || "").trim() : "";
        if (!txt) return;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(txt).then(function () {
            if (btn) {
              btn.textContent = "Copied ✓";
              setTimeout(function () { btn.textContent = "Copy SHA-256"; }, 2000);
            }
          });
        }
      };

      window.__bindDlEmail = function (e) {
        if (e) e.preventDefault();
        var inp = document.getElementById("dlRecoveryEmail");
        var st = document.getElementById("dlRecoveryStatus");
        var btn = document.getElementById("dlRecoverySubmit");
        var em = inp ? inp.value.trim() : "";
        if (!em || em.indexOf("@") === -1) return false;
        if (btn) {
          btn.disabled = true;
          btn.textContent = "Sending…";
        }
        var m = document.cookie.match(/(?:^|; )sweepr_attr_id=([^;]*)/);
        var aid = m ? decodeURIComponent(m[1]) : (localStorage.getItem("sweepr_attr_id") || ${JSON.stringify(attributionId).replace(/</g, "\\u003c")});
        fetch("/api/download-recovery/bind-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: em,
            attribution_id: aid,
            platform: currentOs,
            send_desktop_link: true,
            include_welcome_coupon: true
          })
        })
          .then(function () {
            if (st) st.style.display = "block";
            if (btn) btn.textContent = "Sent + 20% Unlocked ✓";
          })
          .catch(function () {
            if (btn) {
              btn.disabled = false;
              btn.textContent = "Send Backup Link + 20% Off";
            }
          });
        return false;
      };
    })();
  </script>
</body>
</html>`;
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

  const renderDesktopEmailCaptureCard = (sourcePlatform: string, prominent = false) =>
    `<div id="dlRecoveryBox" style="margin-top:14px;padding:${prominent ? "16px" : "14px"};border-radius:14px;background:${prominent ? "#eef6f1" : "#f8faf9"};border:${prominent ? "2px solid #0d6847" : "1px solid #c6dcd0"};text-align:left;font-size:12.5px;color:#111613;">` +
    `<div style="font-weight:800;font-size:13.5px;color:#073825;margin-bottom:4px;">📩 Send PC &amp; Mac Download Link to My Email</div>` +
    `<div style="color:#4b554e;font-size:12px;margin-bottom:8px;">On your phone right now? Enter your email and we&rsquo;ll send the direct Windows 11/10 &amp; Mac download link + your free 500 MB cleanup pass:</div>` +
    `<form id="dlRecoveryForm" style="display:flex;gap:6px;flex-wrap:wrap;" onsubmit="return window.__bindDlEmail && window.__bindDlEmail(event)">` +
    `<input type="email" id="dlRecoveryEmail" required placeholder="you@example.com" style="flex:1;min-width:160px;padding:10px 12px;border-radius:9px;border:1px solid #b8c4bc;font-size:13px;" />` +
    `<button type="submit" id="dlRecoverySubmit" style="background:#0d6847;color:#fff;border:none;padding:10px 14px;border-radius:9px;font-weight:800;font-size:12.5px;cursor:pointer;">Email Me PC &amp; Mac Link</button>` +
    `</form>` +
    `<div id="dlRecoveryStatus" style="display:none;margin-top:6px;font-size:12px;font-weight:700;color:#0d6847;">✓ Sent! Open the email on your Windows PC or Mac to install in 1 click.</div>` +
    `</div>` +
    `<script>(function(){window.__bindDlEmail=function(e){if(e)e.preventDefault();var inp=document.getElementById('dlRecoveryEmail');var st=document.getElementById('dlRecoveryStatus');var btn=document.getElementById('dlRecoverySubmit');var em=inp?inp.value.trim():'';if(!em||em.indexOf('@')===-1)return false;if(btn)btn.disabled=true;var m=document.cookie.match(/(?:^|; )sweepr_attr_id=([^;]*)/);var aid=m?decodeURIComponent(m[1]):(localStorage.getItem('sweepr_attr_id')||'');fetch('/api/download-recovery/bind-email',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:em,attribution_id:aid,platform:'${escapeHtml(sourcePlatform)}',send_desktop_link:true})}).then(function(){if(st)st.style.display='block';if(btn)btn.textContent='Sent ✓';}).catch(function(){if(btn)btn.disabled=false;});return false;};})();</script>`;

  const mobileDownloadLandingPage = (platform: "android" | "ios", ua = "", host = "sweeprcleaner.com") => {
    const btn = (href: string, text: string, primary = false, subBadge = "Recommended") =>
      `<a href="${href}" rel="nofollow" style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px;background:${primary ? "#0d6847" : "#f4f5f3"};color:${primary ? "#ffffff" : "#111613"};border:1px solid ${primary ? "#0d6847" : "#d6dad5"};padding:13px 16px;border-radius:12px;text-decoration:none;font-weight:${primary ? "800" : "600"};font-size:14px;box-shadow:${primary ? "0 6px 16px rgba(13,104,71,0.24)" : "none"};"><span>${text}</span>${primary ? `<span style="font-size:10.5px;background:rgba(255,255,255,0.2);padding:2px 8px;border-radius:999px;font-weight:700;white-space:nowrap;">${subBadge}</span>` : '<span style="color:#0d6847;font-weight:700;font-size:12.5px;white-space:nowrap;">Open &rarr;</span>'}</a>`;
    const cleanHost = host.replace(/^https?:\/\//, "");
    const isAndroidWebView = /android/.test(ua) && /\bwv\b|instagram|fban|fbav|tiktok|bytedancewebview|line\/|micromessenger|reddit/.test(ua);

    if (platform === "android") {
      const apkSha = getApkSha256();
      const webViewHint = isAndroidWebView
        ? `<div style="margin:10px 0;padding:12px;border-radius:12px;background:#e3ede7;border:1px solid #0d6847;text-align:left;font-size:12.5px;color:#073825;"><strong>📱 In-App Browser Detected:</strong> Tap Google Play below or open in Chrome for one-tap installation:${btn(`intent://${cleanHost}/download?platform=android#Intent;scheme=https;package=com.android.chrome;end`, "🌐 Open in Chrome", false)}</div>`
        : "";
      const bodyHtml =
        `Install SWEEPR Cleaner from Google Play or email yourself the PC &amp; Mac desktop link:</p>` +
        webViewHint +
        btn("https://play.google.com/store/apps/details?id=com.sweepr.app", "▶️ Get SWEEPR Cleaner on Google Play", true, "Google Play") +
        btn("https://play.google.com/apps/testing/com.sweepr.app", "🧪 Join Official Google Play Beta (30d Pro Free)", false) +
        renderDesktopEmailCaptureCard("android", true) +
        `<details style="margin-top:14px;padding:12px 14px;border-radius:12px;background:#f8faf9;border:1px solid #d6dad5;text-align:left;font-size:12px;color:#4b554e;">` +
        `<summary style="cursor:pointer;font-weight:800;color:#111613;">Advanced Option: Verified Direct APK Download (.apk)</summary>` +
        `<div style="margin-top:8px;line-height:1.45;">For devices without Google Play Services, download the signed release APK directly:</div>` +
        btn("/download?platform=android&direct=1", "📦 Download Verified SWEEPRCleaner.apk", false) +
        `<div style="margin-top:8px;padding:8px 10px;border-radius:8px;background:#eceee9;font-family:ui-monospace,Consolas,monospace;font-size:10.5px;word-break:break-all;color:#143625;"><strong>Verified SHA-256:</strong> ${escapeHtml(apkSha)}</div>` +
        `</details>` +
        `<div style="margin-top:14px;padding-top:12px;border-top:1px solid rgba(17,22,19,0.08);display:flex;justify-content:space-between;font-size:12.5px;font-weight:700;">` +
        `<a href="/download?platform=picker" rel="nofollow" style="color:#4b554e;text-decoration:underline;">All Platforms (Windows / Mac / Linux)</a>` +
        `<a href="/" style="color:#0d6847;text-decoration:none;">&larr; Home</a>` +
        `</div><p style="display:none">`;
      return page("SWEEPR Cleaner for Android & PC", bodyHtml);
    }

    // iOS landing view: App Store / TestFlight / Instant Web App + Prominent Cross-Device PC & Mac Email Capture Card
    const iosBodyHtml =
      `Cleaning your PC, Mac, or iPhone? Send the desktop installer link to your email or launch SWEEPR on iOS:</p>` +
      renderDesktopEmailCaptureCard("ios", true) +
      `<div style="margin-top:14px;padding:14px;border-radius:14px;background:#ffffff;border:1px solid #d6dad5;text-align:left;">` +
      `<div style="font-weight:800;font-size:13px;color:#073825;margin-bottom:4px;">🍎 SWEEPR Cleaner for iPhone &amp; iPad</div>` +
      `<div style="color:#4b554e;font-size:12px;margin-bottom:6px;">No configuration profiles required. Launch the instant iOS Cleaner or join Apple TestFlight / App Store access:</div>` +
      btn("/ios-app", "🚀 Launch SWEEPR Cleaner for iOS (Instant)", true, "iPhone & iPad") +
      btn("https://testflight.apple.com", "🍏 App Store & TestFlight Early Access", false) +
      `</div>` +
      `<div style="margin-top:14px;padding-top:12px;border-top:1px solid rgba(17,22,19,0.08);display:flex;justify-content:space-between;font-size:12.5px;font-weight:700;">` +
      `<a href="/download?platform=picker" style="color:#4b554e;text-decoration:underline;">All Platforms (Windows / Mac / Linux)</a>` +
      `<a href="/" style="color:#0d6847;text-decoration:none;">&larr; Home</a>` +
      `</div><p style="display:none">`;
    return page("SWEEPR Cleaner for iPhone, PC & Mac", iosBodyHtml);
  };

  const pickerPage = (heading: string, msg: string, ua = "", host = "sweeprcleaner.com") => {
    const btn = (href: string, text: string, primary = false) =>
      `<a href="${href}" rel="nofollow" style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px;background:${primary ? "#0d6847" : "#f4f5f3"};color:${primary ? "#ffffff" : "#111613"};border:1px solid ${primary ? "#0d6847" : "#d6dad5"};padding:12px 16px;border-radius:12px;text-decoration:none;font-weight:${primary ? "800" : "600"};font-size:14px;box-shadow:${primary ? "0 6px 16px rgba(13,104,71,0.24)" : "none"};"><span>${text}</span>${primary ? '<span style="font-size:10.5px;background:rgba(255,255,255,0.2);padding:2px 8px;border-radius:999px;font-weight:700;white-space:nowrap;">Recommended</span>' : '<span style="color:#0d6847;font-weight:700;font-size:12.5px;white-space:nowrap;">Download &rarr;</span>'}</a>`;
    const hasMac = existsSync("./public/SWEEPRCleaner.dmg");
    const hasLinux = existsSync("./public/SWEEPRCleaner.AppImage");
    const hasAndroid = existsSync("./public/SWEEPRCleaner.apk");
    const recommended: Platform = detectPlatform(ua.toLowerCase()) ?? "windows";
    const smartScreenGuide = `<div style="margin-top:14px;padding:12px 14px;border-radius:12px;background:#eef6f1;border:1px solid #b8d8c5;text-align:left;font-size:12px;color:#143625;line-height:1.45;"><strong>🛡️ Windows 10 &amp; 11 Signed Installer:</strong><br>Digitally signed with SSL.com EV/IV Authenticode. Download and run to start your 60-second scan.</div>`;
    const platformEntries: { key: Platform | "play_beta"; html: string; isPrimary: boolean }[] = [
      {
        key: "windows",
        isPrimary: recommended === "windows",
        html: btn("/download?platform=windows", "💻 Download for Windows 10 & 11 (.exe)", recommended === "windows"),
      },
      ...(hasMac
        ? [
            {
              key: "mac" as const,
              isPrimary: recommended === "mac",
              html: btn("/download?platform=mac", "🍏 Download for Mac — macOS 11+ (.dmg)", recommended === "mac"),
            },
          ]
        : []),
      {
        key: "play_beta",
        isPrimary: recommended === "android",
        html: btn("https://play.google.com/store/apps/details?id=com.sweepr.app", "▶️ Get for Android on Google Play", recommended === "android"),
      },
      ...(hasAndroid
        ? [
            {
              key: "android" as const,
              isPrimary: false,
              html: btn("/download?platform=android", "📱 Android Options & Verified APK (SHA-256)", false),
            },
          ]
        : []),
      {
        key: "ios",
        isPrimary: recommended === "ios",
        html: btn("/download?platform=ios", "🍎 iPhone & iPad (App Store / Send PC Link)", recommended === "ios"),
      },
      ...(hasLinux
        ? [
            {
              key: "linux" as const,
              isPrimary: recommended === "linux",
              html: btn("/download?platform=linux", "🐧 Download for Linux (.AppImage)", recommended === "linux"),
            },
          ]
        : []),
    ];
    const primaryEntry = platformEntries.find((e) => e.isPrimary) ?? platformEntries[0];
    const secondaryEntries = platformEntries.filter((e) => e !== primaryEntry);
    const postDownloadEmailCapture = renderDesktopEmailCaptureCard(recommended, recommended === "ios" || recommended === "android");
    const links =
      primaryEntry.html +
      `<div style="margin:14px 0 4px;font-size:11px;font-weight:800;letter-spacing:0.05em;text-transform:uppercase;color:#5c6860;text-align:left;">Other Platforms</div>` +
      secondaryEntries.map((e) => e.html).join("") +
      smartScreenGuide +
      postDownloadEmailCapture +
      `<div style="margin-top:16px;padding-top:14px;border-top:1px solid rgba(17,22,19,0.08);font-size:12.5px;color:#4b554e;text-align:left;">` +
      `<a href="/order?plan=annual" rel="nofollow" style="display:flex;align-items:center;justify-content:space-between;background:#f0fdf4;color:#0d6847;border:1px solid #86efac;padding:11px 15px;border-radius:12px;text-decoration:none;font-weight:700;"><span>Unlock 5-Device Pro License</span><span>&rarr;</span></a>` +
      `<div style="display:flex;align-items:center;justify-content:space-between;margin-top:12px;font-weight:600;">` +
      `<a href="/login" rel="nofollow" style="color:#111613;text-decoration:underline;">Customer Login &amp; QR Activation</a>` +
      `<a href="/" style="color:#0d6847;text-decoration:none;font-weight:700;">&larr; Back to Home</a>` +
      `</div></div>`;
    return page(heading, `${msg}</p>${links}<p style="display:none">`);
  };

  /** Streams a file from disk (no full in-memory buffering) with an explicit Content-Length and edge caching headers. */
  const streamFile = (c: Context, path: string, type: string, filename: string) => {
    const stat = statSync(path);
    const body = Readable.toWeb(createReadStream(path)) as unknown as ReadableStream<Uint8Array>;
    return c.newResponse(body, 200, {
      "Content-Type": type,
      "Content-Length": String(stat.size),
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "public, max-age=0, must-revalidate",
    });
  };

  app.get("/Sweepr_Setup.exe", (c) => c.redirect("/download?platform=windows", 302));
  app.get("/Sweepr_Setup.dmg", (c) => c.redirect("/download?platform=mac", 302));
  app.get("/SWEEPRCleaner.apk", (c) => c.redirect("/download?platform=android&direct=1", 302));
  app.get("/SWEEPRCleaner.mobileconfig", (c) => c.redirect("/download?platform=ios", 302));

  app.get("/ios-app", (c) => {
    c.header("X-Robots-Tag", "noindex, nofollow");
    return c.html(`<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="theme-color" content="#0d6847">
<title>SWEEPR Cleaner</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg?v=20261031b">
<link rel="icon" type="image/png" href="/favicon.png?v=20261031b">
<link rel="shortcut icon" href="/favicon.ico?v=20261031b">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png?v=20261031b">
<link rel="manifest" href="/manifest.webmanifest?v=20261031b">
<style>
  :root[data-theme="light"]{--bg:#f4f5f3;--card:#ffffff;--card-sub:#eceee9;--glass:rgba(244,245,243,.94);--text:#111613;--muted:#4b554e;--border:#d6dad5;--border-strong:#b8c0b8;--accent:#0d6847;--accent-soft:#e3ede7;--accent-fg:#0d6847;--accent-border:#9adbc0;--orb-bg:radial-gradient(circle at 30% 30%,#145c3e,#0d6847 60%,#073825);--orb-border:#9adbc0;--orb-ring:rgba(13,104,71,.16);--shadow:0 8px 24px rgba(17,22,19,.06);--input-bg:#ffffff}
  :root[data-theme="dark"]{--bg:#0d1411;--card:#131d18;--card-sub:#1b2922;--glass:rgba(19,29,24,.94);--text:#f4f5f3;--muted:#9aa59e;--border:rgba(154,219,192,.18);--border-strong:rgba(154,219,192,.32);--accent:#0d6847;--accent-soft:rgba(13,104,71,.24);--accent-fg:#9adbc0;--accent-border:rgba(154,219,192,.45);--orb-bg:radial-gradient(circle at 30% 30%,#145c3e,#0d6847 60%,#073825);--orb-border:#9adbc0;--orb-ring:rgba(13,104,71,.26);--shadow:0 12px 30px rgba(0,0,0,.4);--input-bg:#0a100d}
  *{box-sizing:border-box;margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Inter,sans-serif;-webkit-tap-highlight-color:transparent}
  .mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-variant-numeric:tabular-nums}
  body{background:var(--bg);color:var(--text);min-height:100vh;padding:66px 16px 86px;display:flex;flex-direction:column}
  .topbar{position:fixed;top:0;left:0;right:0;height:58px;background:var(--glass);backdrop-filter:blur(14px);border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;padding:0 14px;z-index:100}
  .icon-btn{width:38px;height:38px;border-radius:11px;border:1px solid var(--border);background:var(--card);color:var(--text);display:flex;align-items:center;justify-content:center;cursor:pointer}
  .badge{font-size:11px;font-weight:800;padding:5px 10px;border-radius:999px;background:var(--accent-soft);color:var(--accent-fg);border:1px solid var(--accent-border)}
  .view{display:none;flex-direction:column;flex:1;max-width:460px;width:100%;margin:0 auto;gap:14px}
  .view.active{display:flex}
  .c3-orb-stage{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:18px 0}
  .c3-power-orb{width:156px;height:156px;border-radius:999px;border:5px solid var(--orb-border);background:var(--orb-bg);color:#fff;box-shadow:0 18px 44px rgba(13,104,71,.32),0 0 0 14px var(--orb-ring);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;cursor:pointer}
  .card{background:var(--card);border:1px solid var(--border);border-radius:22px;padding:18px;box-shadow:var(--shadow)}
  .input{width:100%;padding:12px 14px;border-radius:13px;border:1px solid var(--border-strong);background:var(--input-bg);color:var(--text);font-size:13.5px;margin-top:8px}
  .btn-primary{width:100%;padding:14px;border-radius:14px;border:none;background:linear-gradient(135deg,#145c3e,#0d6847);color:#fff;font-weight:900;font-size:14px;margin-top:12px;cursor:pointer}
  .bottom-nav{position:fixed;bottom:0;left:0;right:0;height:68px;background:var(--glass);backdrop-filter:blur(14px);border-top:1px solid var(--border);display:grid;grid-template-columns:repeat(3,1fr);padding:6px 10px 10px;gap:6px;z-index:100}
  .nav-tab{border:none;background:transparent;color:var(--muted);border-radius:13px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;font-size:11px;font-weight:800;cursor:pointer;transition:transform 90ms cubic-bezier(.22,1,.36,1),background-color 150ms cubic-bezier(.22,1,.36,1),color 150ms cubic-bezier(.22,1,.36,1)}
  .nav-tab.active{color:var(--accent-fg);background:var(--accent-soft)}
  .c3-power-orb,.btn-primary,.icon-btn{transition:transform 90ms cubic-bezier(.22,1,.36,1),box-shadow 160ms cubic-bezier(.22,1,.36,1),background-color 150ms ease}
  .c3-power-orb:active:not(:disabled){transform:scale(.95)}
  .btn-primary:active:not(:disabled),.icon-btn:active:not(:disabled),.nav-tab:active:not(:disabled){transform:scale(.97)}
  @keyframes iosViewIn{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
  .view.active{display:flex;animation:iosViewIn 170ms cubic-bezier(.22,1,.36,1)}
  @media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;transition-duration:.01ms!important}}
</style>
</head>
<body>
  <header class="topbar">
    <div style="display:flex;align-items:center;gap:8px;font-weight:900;font-size:16px">
      <img src="/favicon.svg?v=20261031b" alt="SWEEPR" width="30" height="30" style="border-radius:8px;display:block">
      <span>SWEEPR <span style="color:var(--accent-fg)">Cleaner</span></span>
    </div>
    <div style="display:flex;align-items:center;gap:8px">
      <span id="proBadge" class="badge">Ready</span>
      <button class="icon-btn" onclick="toggleTheme()" aria-label="Toggle Light/Dark Mode">☀️</button>
    </div>
  </header>

  <main id="view-home" class="view active">
    <div style="text-align:center;padding-top:10px">
      <div class="badge" style="display:inline-block">PHONE STORAGE CLEANER</div>
      <div id="scanHeadline" style="font-size:22px;font-weight:900;margin-top:12px">Tap to Scan Storage</div>
      <div id="scanOut" style="font-size:13px;color:var(--muted);font-weight:600;margin-top:4px">Finds duplicate photos, large videos &amp; temporary app files</div>
    </div>

    <div class="c3-orb-stage">
      <button id="scanBtn" class="c3-power-orb" onclick="runIosScan()">
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>
        <span id="orbTxt" class="mono" style="font-size:11.5px;font-weight:900;letter-spacing:.06em">SMART SCAN</span>
      </button>
    </div>

    <div style="margin-top:auto;display:flex;flex-direction:column;gap:10px">
      <input id="iosFilePicker" type="file" multiple accept="image/*,video/*,*/*" style="display:none" onchange="onIosFilesSelected(this.files)" />
      <button id="pickFilesBtn" onclick="document.getElementById('iosFilePicker').click()" class="card" style="padding:11px 14px;border-radius:14px;font-size:12.5px;font-weight:800;text-align:center;cursor:pointer;color:var(--accent-fg)">Select Photos or Videos to Check for Exact Duplicates</button>
      <details class="card" style="padding:11px 14px;border-radius:14px;font-size:12px">
        <summary style="cursor:pointer;font-weight:800;display:flex;justify-content:space-between;align-items:center;list-style:none"><span>What We Check for You</span><span class="mono" style="color:var(--accent-fg);font-size:11px">View ▾</span></summary>
        <div style="margin-top:8px;display:flex;flex-direction:column;gap:6px;color:var(--muted);line-height:1.4">
          <div>• <strong>Web Browsers:</strong> Saved website files from Safari, Chrome, Brave &amp; Arc</div>
          <div>• <strong>Photos &amp; Videos:</strong> Identical duplicate photos, burst shots &amp; large video clips</div>
          <div>• <strong>Chat &amp; Social Apps:</strong> Leftover media copies from WhatsApp, Telegram &amp; Discord</div>
        </div>
      </details>
      <button id="cleanBtn" onclick="cleanIosStorage()" class="btn-primary" style="display:none;margin-top:0">Clean Temporary Files &amp; Duplicate Report</button>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="card" style="padding:11px 14px;border-radius:16px;display:flex;justify-content:space-between;font-size:12px;font-weight:700"><span style="color:var(--muted)">Check Method</span><span class="mono">Exact Match</span></div>
        <div class="card" style="padding:11px 14px;border-radius:16px;display:flex;justify-content:space-between;font-size:12px;font-weight:700"><span style="color:var(--muted)">Can Be Freed</span><span id="targetBytesLabel" class="mono" style="color:var(--accent-fg)">Tap Scan</span></div>
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

  app.get("/download", async (c) => {
    c.header("X-Robots-Tag", "noindex, nofollow");
    const rawUa = c.req.header("user-agent") || "";
    const ua = rawUa.toLowerCase();
    const accept = (c.req.header("accept") || "").toLowerCase();
    const secFetchDest = (c.req.header("sec-fetch-dest") || "").toLowerCase();
    const secFetchMode = (c.req.header("sec-fetch-mode") || "").toLowerCase();
    const chPlatform = c.req.header("sec-ch-ua-platform")?.toLowerCase() || "";
    const chMobile = c.req.header("sec-ch-ua-mobile")?.toLowerCase() || "";
    let host = "sweeprcleaner.com";
    try {
      host = new URL(config.publicUrl).host || "sweeprcleaner.com";
    } catch {}
    // ?platform=mac etc. lets people download for a different device (e.g. "Other platforms" links).
    const requested = c.req.query("platform")?.toLowerCase();
    const stream = c.req.query("stream") === "1";
    const direct = c.req.query("direct") === "1" || c.req.query("raw") === "1";
    const isStream = stream || direct;
    const isCrawler = Boolean(detectBot(rawUa)) || rawUa === AUDIT_USER_AGENT || ua.includes("sweeprseoaudit");
    const isBrowserUa =
      /mozilla\/5\.0/i.test(rawUa) && /applewebkit|gecko|chrome|safari|firefox|edg\//i.test(rawUa);
    const isBrowserNavigation =
      !isCrawler &&
      (accept.includes("text/html") ||
        secFetchMode === "navigate" ||
        secFetchDest === "document" ||
        isBrowserUa);

    const validPlatforms = ["windows", "mac", "linux", "android", "ios"] as const;
    const detectedPlatform: Platform | null =
      requested && (validPlatforms as readonly string[]).includes(requested)
        ? (requested as Platform)
        : isCrawler
          ? null
          : detectPlatform(ua, chPlatform, chMobile);

    if (isCrawler || requested === "picker" || (!detectedPlatform && requested !== undefined)) {
      c.header("Cache-Control", "private, no-store");
      return c.html(pickerPage("Download SWEEPR Cleaner", "Choose your device platform:", ua, host));
    }

    const platform: Platform = detectedPlatform ?? "windows";

    // Never force an immediate raw .apk sideload or unsigned .mobileconfig MDM stream on mobile visitors!
    // Route Android to the Google Play + Verified SHA-256 APK landing view, and iOS to the App Store / Cross-Device Email capture card.
    if ((platform === "android" && !isStream) || (platform === "ios" && !isStream)) {
      try {
        let attrId =
          sanitizeAttributionId(c.req.query("attribution_id")) ||
          sanitizeAttributionId(getCookie(c, "sweepr_attr_id"));
        if (!attrId) {
          attrId = `attr_dl_${randomToken(8)}`;
          setCookie(c, "sweepr_attr_id", attrId, {
            httpOnly: false,
            sameSite: "Lax",
            secure: isHttps,
            path: "/",
            maxAge: 90 * 86400,
          });
        }
        const sessAccId = await sessionAccountId(c);
        repo.recordAnalyticsEvent({
          event_name: "mobile_download_landing_viewed",
          platform,
          account_id: sessAccId,
          metadata: { platform, referrer: c.req.header("referer") || null, attribution_id: attrId },
        });
      } catch {}
      c.header("Cache-Control", "private, no-store");
      return c.html(mobileDownloadLandingPage(platform, ua, host));
    }

    const { file, type, label } = DESKTOP_FILES[platform];
    const installerPath = `./public/${file}`;
    const hasFile = existsSync(installerPath);

    let resolvedAttrId =
      sanitizeAttributionId(c.req.query("attribution_id")) ||
      sanitizeAttributionId(getCookie(c, "sweepr_attr_id")) ||
      `attr_dl_${randomToken(8)}`;

    const shouldRenderThankYouHtml =
      !isStream &&
      (platform === "windows" || platform === "mac" || platform === "linux") &&
      (!requested || isBrowserNavigation);

    try {
      if (!getCookie(c, "sweepr_attr_id")) {
        setCookie(c, "sweepr_attr_id", resolvedAttrId, {
          httpOnly: false,
          sameSite: "Lax",
          secure: isHttps,
          path: "/",
          maxAge: 90 * 86400,
        });
      }
      const sessAccId = await sessionAccountId(c);
      const visitorIp =
        c.req.header("cf-connecting-ip")?.trim() ||
        c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
        clientIp(c);
      const ipOsFingerprint = computeIpOsFingerprint(visitorIp, platform);
      c.header("X-Sweepr-Attribution-Id", resolvedAttrId);
      recordInstallerDownloaded(repo, {
        attributionId: resolvedAttrId,
        platform,
        installerFile: file,
        accountId: sessAccId,
        clientIp: visitorIp,
        ipOsFingerprint,
        metadata: {
          installer: file,
          available: hasFile,
          referrer: c.req.header("referer") || null,
          ip_os_fingerprint: ipOsFingerprint,
          stage: shouldRenderThankYouHtml ? "thankyou_page" : "binary_stream",
        },
        nowSec: now(),
      });
      if (shouldRenderThankYouHtml) {
        repo.recordAnalyticsEvent({
          event_name: "download_thankyou_viewed",
          platform,
          account_id: sessAccId,
          metadata: { installer: file, available: hasFile, referrer: c.req.header("referer") || null, attribution_id: resolvedAttrId },
        });
      } else {
        repo.recordAnalyticsEvent({
          event_name: "installer_downloaded",
          platform,
          account_id: sessAccId,
          metadata: { installer: file, available: hasFile, referrer: c.req.header("referer") || null, attribution_id: resolvedAttrId },
        });
        syncToCentralCrm("/v1/telemetry/event", {
          event_name: "installer_downloaded",
          category: "funnel",
          os: platform,
          properties: { installer: file, available: hasFile, referrer: c.req.header("referer") || null, attribution_id: resolvedAttrId },
        });
      }
    } catch {}

    if (shouldRenderThankYouHtml) {
      if (!hasFile && requested) {
        c.header("Cache-Control", "private, no-store");
        return c.html(pickerPage(`${label} Version Coming Soon`, `SWEEPR Cleaner for ${label} will be available soon. Other versions:`, ua, host));
      }
      c.header("Cache-Control", "private, no-store");
      return c.html(renderPostDownloadThankYouPage(platform as "windows" | "mac" | "linux", resolvedAttrId));
    }

    if (!hasFile) {
      c.header("Cache-Control", "private, no-store");
      return c.html(pickerPage(`${label} Version Coming Soon`, `SWEEPR Cleaner for ${label} will be available soon. Other versions:`, ua, host));
    }

    return streamFile(c, installerPath, type, file);
  });

  // Referral shortlink: /r/:code -> /order?ref=:code
  app.get("/r/:code", (c) => {
    const code = String(c.req.param("code") ?? "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32);
    if (!code) return c.redirect("/order");
    return c.redirect(`/order?ref=${encodeURIComponent(code)}`);
  });

  // Public viral "I Just Reclaimed X.X GB with SWEEPR" benchmark card & dynamic OpenGraph preview route
  const parseShareWinParams = (c: Context) => {
    const rawGbInput = String(c.req.query("gb") ?? "14.8 GB").trim().slice(0, 32);
    const gbLabel = /^\d+(\.\d+)?$/.test(rawGbInput)
      ? `${rawGbInput} GB`
      : rawGbInput || "14.8 GB";
    const culprit =
      String(c.req.query("culprit") ?? "NVIDIA DXCache / ComfyUI / Xcode")
        .trim()
        .slice(0, 80) || "NVIDIA DXCache / ComfyUI / Xcode";
    const msNum = Math.max(
      12,
      Math.min(99999, Number.parseInt(String(c.req.query("ms") ?? "312"), 10) || 312)
    );
    const code =
      String(c.req.query("code") ?? c.req.query("ref") ?? "SWP-PRO30")
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g, "")
        .slice(0, 32) || "SWP-PRO30";
    return { gbLabel, culprit, msNum, code };
  };

  app.get("/share/win.svg", (c) => {
    const { gbLabel, culprit, msNum, code } = parseShareWinParams(c);
    const safeGb = escapeHtml(gbLabel);
    const safeCulprit = escapeHtml(culprit.length > 34 ? `${culprit.slice(0, 33)}…` : culprit);
    const safeMs = escapeHtml(`${msNum} ms`);
    const safeRef = escapeHtml(`sweeprcleaner.com/r/${code}`);
    c.header("Content-Type", "image/svg+xml; charset=utf-8");
    c.header("Cache-Control", "public, max-age=3600");
    return c.body(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">` +
        `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#03110c"/><stop offset="55%" stop-color="#062319"/><stop offset="100%" stop-color="#041610"/></linearGradient></defs>` +
        `<rect width="1200" height="630" fill="url(#bg)"/>` +
        `<rect x="28" y="28" width="1144" height="574" rx="28" fill="none" stroke="#10b981" stroke-opacity="0.48" stroke-width="3"/>` +
        `<text x="72" y="96" fill="#10b981" font-family="system-ui,-apple-system,Segoe UI,sans-serif" font-size="22" font-weight="800">⚡ SWEEPR CLEANER · STORAGE BENCHMARK</text>` +
        `<text x="72" y="195" fill="#ecfdf5" font-family="system-ui,-apple-system,Segoe UI,sans-serif" font-size="60" font-weight="900">I Just Reclaimed ${safeGb}</text>` +
        `<text x="72" y="248" fill="#34d399" font-family="system-ui,-apple-system,Segoe UI,sans-serif" font-size="34" font-weight="800">with SWEEPR Cleaner (+30 Days Free Pro Pass)</text>` +
        `<rect x="72" y="292" width="310" height="170" rx="20" fill="#07261b" stroke="#10b981" stroke-opacity="0.35"/>` +
        `<text x="96" y="336" fill="#9ca3af" font-family="ui-monospace,Consolas,monospace" font-size="15" font-weight="800">STORAGE RECLAIMED</text>` +
        `<text x="96" y="396" fill="#34d399" font-family="system-ui,-apple-system,sans-serif" font-size="40" font-weight="900">${safeGb}</text>` +
        `<rect x="404" y="292" width="472" height="170" rx="20" fill="#07261b" stroke="#10b981" stroke-opacity="0.35"/>` +
        `<text x="428" y="336" fill="#9ca3af" font-family="ui-monospace,Consolas,monospace" font-size="15" font-weight="800">TOP CULPRIT</text>` +
        `<text x="428" y="394" fill="#38bdf8" font-family="system-ui,-apple-system,sans-serif" font-size="26" font-weight="800">${safeCulprit}</text>` +
        `<rect x="898" y="292" width="230" height="170" rx="20" fill="#07261b" stroke="#10b981" stroke-opacity="0.35"/>` +
        `<text x="922" y="336" fill="#9ca3af" font-family="ui-monospace,Consolas,monospace" font-size="15" font-weight="800">SCAN SPEED</text>` +
        `<text x="922" y="396" fill="#fbbf24" font-family="system-ui,-apple-system,sans-serif" font-size="38" font-weight="900">${safeMs}</text>` +
        `<rect x="72" y="496" width="1056" height="72" rx="18" fill="#083022" stroke="#34d399" stroke-opacity="0.45"/>` +
        `<text x="100" y="541" fill="#ffffff" font-family="ui-monospace,Consolas,monospace" font-size="23" font-weight="800">Claim +30 Days Free Pro: ${safeRef}</text>` +
        `</svg>`
    );
  });

  app.get("/share/win", (c) => {
    c.header("X-Robots-Tag", "noindex, nofollow");
    const { gbLabel, culprit, msNum, code } = parseShareWinParams(c);
    const baseUrl = (config.publicUrl || "https://sweeprcleaner.com").replace(/\/+$/, "");
    const qs = `gb=${encodeURIComponent(gbLabel)}&culprit=${encodeURIComponent(culprit)}&ms=${encodeURIComponent(String(msNum))}&code=${encodeURIComponent(code)}`;
    const sharePageUrl = `${baseUrl}/share/win?${qs}`;
    const ogImageUrl = `${baseUrl}/share/win.svg?${qs}`;
    const shortReferralDisplay = `sweeprcleaner.com/r/${code}`;

    const safeGb = escapeHtml(gbLabel);
    const safeCulprit = escapeHtml(culprit);
    const safeMs = escapeHtml(String(msNum));
    const safeCode = escapeHtml(code);
    const safeShortRef = escapeHtml(shortReferralDisplay);
    const safeSharePageUrl = escapeHtml(sharePageUrl);
    const safeOgImageUrl = escapeHtml(ogImageUrl);

    const ogTitle = `I Just Reclaimed ${safeGb} with SWEEPR (${safeMs}ms Scan)`;
    const ogDesc = `Top culprit: ${safeCulprit}. Reclaim hidden cache bloat in 1 click and claim +30 days of SWEEPR Pro free via ${safeShortRef}.`;

    return c.html(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${ogTitle} — SWEEPR Cleaner</title>
  <meta name="description" content="${ogDesc}" />
  <meta name="robots" content="noindex, nofollow" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="SWEEPR Cleaner" />
  <meta property="og:title" content="${ogTitle}" />
  <meta property="og:description" content="${ogDesc}" />
  <meta property="og:url" content="${safeSharePageUrl}" />
  <meta property="og:image" content="${safeOgImageUrl}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${ogTitle}" />
  <meta name="twitter:description" content="${ogDesc}" />
  <meta name="twitter:image" content="${safeOgImageUrl}" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg?v=20261031b" />
</head>
<body style="margin:0;min-height:100vh;background:#03110c;color:#ecfdf5;font-family:system-ui,-apple-system,Segoe UI,sans-serif;display:grid;place-items:center;padding:20px;box-sizing:border-box;">
  <main style="width:100%;max-width:760px;background:#062017;border:1px solid rgba(16,185,129,0.4);border-radius:24px;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,0.45);box-sizing:border-box;">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:14px;">
      <span style="font-size:12px;font-weight:800;letter-spacing:0.06em;color:#34d399;text-transform:uppercase;">⚡ SWEEPR Cleaner · Verified Storage Win</span>
      <span style="background:rgba(16,185,129,0.18);border:1px solid rgba(16,185,129,0.5);color:#6ee7b7;padding:4px 12px;border-radius:999px;font-size:12px;font-weight:800;">+30 Days Free Pro Referral</span>
    </div>
    <h1 style="margin:0 0 6px;font-size:28px;font-weight:900;line-height:1.2;">I Just Reclaimed ${safeGb} with SWEEPR</h1>
    <p style="margin:0 0 16px;color:#a7f3d0;font-size:14.5px;">Top Culprit: <strong>${safeCulprit}</strong> · Scanned in <strong>${safeMs} ms</strong> · Referral: <code>${safeShortRef}</code></p>
    <div style="border-radius:16px;overflow:hidden;border:1px solid rgba(16,185,129,0.35);background:#041610;margin-bottom:16px;">
      <canvas id="winCanvas" width="1200" height="630" style="display:block;width:100%;height:auto;"></canvas>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;">
      <a href="/r/${safeCode}" style="flex:1.4;min-width:210px;text-align:center;background:linear-gradient(135deg,#10b981,#059669);color:#fff;text-decoration:none;padding:13px 18px;border-radius:12px;font-weight:800;font-size:14.5px;">Claim +30 Days Free SWEEPR Pro &rarr;</a>
      <a href="/download?ref=${safeCode}" style="flex:1;min-width:180px;text-align:center;background:rgba(255,255,255,0.08);border:1px solid rgba(16,185,129,0.4);color:#ecfdf5;text-decoration:none;padding:13px 16px;border-radius:12px;font-weight:700;font-size:14px;">Download Free Scanner</a>
      <button type="button" id="copyCardBtn" style="background:rgba(16,185,129,0.16);border:1px solid rgba(16,185,129,0.45);color:#6ee7b7;padding:13px 16px;border-radius:12px;font-weight:800;font-size:13.5px;cursor:pointer;">📋 Copy Image</button>
    </div>
  </main>
  <script>
    (function(){
      var c = document.getElementById('winCanvas');
      if (!c || !c.getContext) return;
      var ctx = c.getContext('2d');
      var g = ctx.createLinearGradient(0,0,1200,630);
      g.addColorStop(0,'#03110c'); g.addColorStop(0.55,'#062319'); g.addColorStop(1,'#041610');
      ctx.fillStyle = g; ctx.fillRect(0,0,1200,630);
      ctx.strokeStyle = 'rgba(16,185,129,0.45)'; ctx.lineWidth = 3;
      ctx.strokeRect(28,28,1144,574);
      ctx.fillStyle = '#10b981'; ctx.font = '800 22px system-ui,sans-serif';
      ctx.fillText('⚡ SWEEPR CLEANER · STORAGE BENCHMARK', 72, 92);
      ctx.fillStyle = '#ecfdf5'; ctx.font = '900 60px system-ui,sans-serif';
      ctx.fillText(${JSON.stringify(`I Just Reclaimed ${gbLabel}`).replace(/</g, "\\u003c")}, 72, 195);
      ctx.fillStyle = '#34d399'; ctx.font = '800 32px system-ui,sans-serif';
      ctx.fillText(${JSON.stringify(`Top Culprit: ${culprit} (${msNum} ms scan)`).replace(/</g, "\\u003c")}, 72, 255);
      ctx.fillStyle = '#ffffff'; ctx.font = '800 26px ui-monospace,Consolas,monospace';
      ctx.fillText(${JSON.stringify(`Claim +30 Days Free Pro: ${shortReferralDisplay}`).replace(/</g, "\\u003c")}, 72, 540);
      var btn = document.getElementById('copyCardBtn');
      if (btn) {
        btn.addEventListener('click', function(){
          c.toBlob(function(blob){
            if (blob && window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
              navigator.clipboard.write([new ClipboardItem({'image/png': blob})]).then(function(){
                btn.textContent = '✓ Copied Image';
              });
            }
          }, 'image/png');
        });
      }
    })();
  </script>
</body>
</html>`);
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

  const cachedPlanPriceIds = new Map<string, string>();
  async function getOrCreatePlanPriceId(
    plan: "monthly" | "six_month" | "annual",
    currency?: string
  ): Promise<string> {
    if (!stripe) throw new Error("Stripe not configured");
    const normCurr = String(currency || "gbp").trim().toLowerCase() || "gbp";
    const tierPricing = getPricingForCountryOrCurrency(undefined, normCurr);
    const targetCurrency = tierPricing.currency.toLowerCase();
    const unitAmount =
      plan === "annual"
        ? tierPricing.annualAmount
        : plan === "six_month"
        ? tierPricing.sixMonthAmount
        : tierPricing.monthlyAmount;
    const targetInterval = plan === "annual" ? "year" : "month";
    const targetIntervalCount = plan === "six_month" ? 6 : 1;
    const cacheKey = `${plan}:${targetCurrency}:${unitAmount}`;
    if (cachedPlanPriceIds.has(cacheKey)) {
      return cachedPlanPriceIds.get(cacheKey)!;
    }

    const configuredPriceId =
      plan === "annual"
        ? config.priceAnnual
        : plan === "six_month"
        ? config.priceSixMonth
        : config.priceMonthly;
    if (
      configuredPriceId &&
      !configuredPriceId.includes("...") &&
      typeof (stripe.prices as any)?.retrieve === "function"
    ) {
      try {
        const priceObj = await stripe.prices.retrieve(configuredPriceId);
        const priceCurr = (priceObj.currency || targetCurrency).toLowerCase();
        const priceInterval = priceObj.recurring?.interval || targetInterval;
        const priceIntervalCount = priceObj.recurring?.interval_count ?? 1;
        if (
          priceObj.id &&
          priceCurr === targetCurrency &&
          priceInterval === targetInterval &&
          priceIntervalCount === targetIntervalCount
        ) {
          cachedPlanPriceIds.set(cacheKey, priceObj.id);
          return priceObj.id;
        }
      } catch {
        // Fall through to list/create price for the requested currency
      }
    }

    const productId = await getStripeProductId();
    if (typeof (stripe.prices as any)?.list === "function") {
      try {
        const existingPrices = await stripe.prices.list({
          product: productId,
          currency: targetCurrency,
          active: true,
          limit: 25,
        });
        const match = existingPrices.data?.find(
          (p) =>
            p.unit_amount === unitAmount &&
            p.recurring?.interval === targetInterval &&
            (p.recurring?.interval_count ?? 1) === targetIntervalCount
        );
        if (match?.id) {
          cachedPlanPriceIds.set(cacheKey, match.id);
          return match.id;
        }
      } catch {
        // Fall through to price creation
      }
    }

    if (typeof (stripe.prices as any)?.create === "function") {
      const createdPrice = await stripe.prices.create({
        product: productId,
        currency: targetCurrency,
        unit_amount: unitAmount,
        recurring: {
          interval: targetInterval,
          ...(targetIntervalCount > 1 ? { interval_count: targetIntervalCount } : {}),
        },
        nickname: `SWEEPR Cleaner Pro (${plan.toUpperCase()} - ${targetCurrency.toUpperCase()})`,
      });
      cachedPlanPriceIds.set(cacheKey, createdPrice.id);
      return createdPrice.id;
    }

    return configuredPriceId || `price_${plan}_${targetCurrency}`;
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
  async function verifyStripeCouponExists(candidateCouponId: string | null | undefined): Promise<string> {
    const id = String(candidateCouponId ?? "").trim();
    if (!id || !stripe) return "";
    if (cachedIntroCoupons.has(id)) return cachedIntroCoupons.get(id)!;
    if (typeof (stripe.coupons as any)?.retrieve !== "function") {
      return id;
    }
    try {
      const existing = await stripe.coupons.retrieve(id);
      if (existing && existing.id && !(existing as any).deleted && existing.valid !== false) {
        cachedIntroCoupons.set(id, existing.id);
        return existing.id;
      }
    } catch {
      // Coupon does not exist in this Stripe environment
    }
    return "";
  }

  async function getOrCreateIntroCoupon(currency: string, discountAmount: number): Promise<string> {
    if (!stripe) return "";
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
      return verifyStripeCouponExists(stripeCoupon);
    }
  }

  async function getOrCreateGotdUpgradeCoupon(pct = 50): Promise<string> {
    const couponId = `SWEEPR_GOTD_${pct}_OFF`;
    if (!stripe) return couponId;
    if (cachedIntroCoupons.has(couponId)) return cachedIntroCoupons.get(couponId)!;
    try {
      const existing = await stripe.coupons.retrieve(couponId);
      if (existing && existing.id) {
        cachedIntroCoupons.set(couponId, existing.id);
        return existing.id;
      }
    } catch {}
    try {
      const created = await stripe.coupons.create({
        id: couponId,
        percent_off: pct,
        duration: "once",
        name: `Giveaway of the Day ${pct}% Upgrade Offer`,
      });
      cachedIntroCoupons.set(couponId, created.id);
      return created.id;
    } catch {
      return verifyStripeCouponExists(stripeCoupon);
    }
  }

  /**
   * R4: Unified promo coupon resolver for GOTD50 (50% off), SCAN5GB20 (20% off scan recovery),
   * and STAY30 (30% off renewal loyalty save).
   */
  async function resolveCheckoutPromoCoupon(
    rawCode: string | null | undefined
  ): Promise<{ code: string; percentOff: number; stripeCouponId: string } | null> {
    const code = String(rawCode || "").trim().toUpperCase();
    if (!code) return null;
    const gotdCfg = getGiveawayConfig(repo, now());
    let pct = 0;
    let couponId = "";
    let label = "";
    if (code === "SWEEPR50" || code === DEFAULT_GOTD_UPGRADE_COUPON || code === gotdCfg.upgrade_coupon.toUpperCase()) {
      pct = gotdCfg.upgrade_discount_pct || 50;
      couponId = await getOrCreateGotdUpgradeCoupon(pct);
      return { code, percentOff: pct, stripeCouponId: couponId };
    }
    if (code === "SCAN5GB20") {
      pct = 20;
      couponId = "SWEEPR_SCAN5GB_20_OFF";
      label = "20% Scan Recovery Discount";
    } else if (code === "WELCOME20") {
      pct = 20;
      couponId = "SWEEPR_WELCOME_20_OFF";
      label = "20% Welcome Discount";
    } else if (code === "STAY30") {
      pct = 30;
      couponId = "SWEEPR_STAY_30_OFF";
      label = "30% Renewal Loyalty Discount";
    } else {
      return null;
    }

    if (!stripe) return { code, percentOff: pct, stripeCouponId: couponId };
    if (cachedIntroCoupons.has(couponId)) {
      return { code, percentOff: pct, stripeCouponId: cachedIntroCoupons.get(couponId)! };
    }
    try {
      const existing = await stripe.coupons.retrieve(couponId);
      if (existing && existing.id) {
        cachedIntroCoupons.set(couponId, existing.id);
        return { code, percentOff: pct, stripeCouponId: existing.id };
      }
    } catch {}
    try {
      const created = await stripe.coupons.create({
        id: couponId,
        percent_off: pct,
        duration: "once",
        name: label,
      });
      cachedIntroCoupons.set(couponId, created.id);
      return { code, percentOff: pct, stripeCouponId: created.id };
    } catch {
      const verifiedFallback = await verifyStripeCouponExists(stripeCoupon);
      return { code, percentOff: pct, stripeCouponId: verifiedFallback };
    }
  }

  // Giveaway of the Day (24-Hour 6-Month Pro License Redemption & 50% Upgrade Page)
  const serveGiveawayPage = (c: Context) => {
    c.header("X-Robots-Tag", "noindex, follow");
    c.header("Cache-Control", "no-store, no-cache, must-revalidate");
    const cfg = getGiveawayConfig(repo, now());
    return c.html(renderGiveawayPageHtml(cfg, now()));
  };
  app.get("/giveaway", serveGiveawayPage);
  app.get("/redeem/gotd", serveGiveawayPage);

  app.get("/giveaway/readme.txt", (c) => {
    const cfg = getGiveawayConfig(repo, now());
    c.header("Content-Type", "text/plain; charset=utf-8");
    c.header("Cache-Control", "no-store");
    return c.body(buildGiveawayReadmeTxt(cfg));
  });

  app.post("/api/giveaway/redeem", async (c) => {
    if (!limitOtpVerifyIp.hit(clientIp(c))) {
      return c.json({ ok: false, error: "rate_limited", message: "Too many attempts. Please try again shortly." }, 429);
    }
    const body = await c.req.json().catch(() => ({}));
    const email = normalizeEmail(body?.email);
    const code = String(body?.code ?? body?.key ?? "").trim();
    const deviceId = typeof body?.device_id === "string" && DEVICE_RE.test(body.device_id) ? body.device_id : undefined;
    if (!email || !code) {
      return c.json({ ok: false, error: "missing_fields", message: "Please enter your email address and Giveaway key." }, 400);
    }
    const res = redeemGiveawayLicense(repo, {
      email,
      code,
      deviceId,
      ipHash: sha256(clientIp(c)),
      nowSec: now(),
    });
    if (!res.ok) {
      return c.json(res, 400);
    }
    if (res.account_id) {
      await issuePortalSessionCookie(c, res.account_id);
      syncSubscriptionToCentralCrm({
        email,
        accountId: res.account_id,
        plan: "giveaway_6m",
        status: "active",
        notes: "Activated 6-Month (1-PC) Giveaway of the Day Pro License",
      });
    }
    return c.json(res);
  });

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
    const callerSessionAccId = await sessionAccountId(c);
    const isAuthenticatedOwner = Boolean(existing && callerSessionAccId === existing.id);
    let accountId: string;
    if (existing) {
      accountId = existing.id;
      if (isAuthenticatedOwner || !existing.country || !existing.lead_device) {
        repo.setAccountLeadMeta(accountId, {
          country: existing.country ? (isAuthenticatedOwner ? country : existing.country) : country,
          lead_device: existing.lead_device ? (isAuthenticatedOwner ? leadDevice : existing.lead_device) : leadDevice,
        });
      }
      if (name && (isAuthenticatedOwner || !existing.name)) {
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
    try {
      const attrId =
        sanitizeAttributionId(body?.attribution_id) ||
        sanitizeAttributionId(body?.attribution?.attribution_id) ||
        sanitizeAttributionId(getCookie(c, "sweepr_attr_id"));
      associateCheckoutLeadWithRecovery(repo, {
        attributionId: attrId,
        email,
        accountId,
        nowSec: now(),
      });
    } catch {}
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
    const callerSessionAccId = await sessionAccountId(c);
    const isAuthenticatedOwner = Boolean(existing && callerSessionAccId === existing.id);
    if (existing) {
      accountId = existing.id;
      if (isAuthenticatedOwner || !existing.country || !existing.lead_device) {
        repo.setAccountLeadMeta(accountId, {
          country: existing.country && !isAuthenticatedOwner ? existing.country : localizedPricing.country,
          lead_device: existing.lead_device && !isAuthenticatedOwner ? existing.lead_device : leadDevice,
        });
      }
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
      try {
        const attrId =
          sanitizeAttributionId(body?.attribution_id) ||
          sanitizeAttributionId(body?.attribution?.attribution_id) ||
          sanitizeAttributionId(getCookie(c, "sweepr_attr_id"));
        associateCheckoutLeadWithRecovery(repo, {
          attributionId: attrId,
          email,
          accountId,
          nowSec: now(),
        });
        attributeCheckoutToExperiments(repo, {
          visitorKey: String(body?.visitor_id || "").trim() || attrId || clientIp(c) || accountId,
          accountId,
          plan,
        });
      } catch {}
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
      const requestedCoupon = String(body?.coupon ?? body?.promo_code ?? c.req.query("coupon") ?? "").trim().toUpperCase();
      const resolvedPromo = await resolveCheckoutPromoCoupon(requestedCoupon);

      const introCouponId = resolvedPromo
        ? resolvedPromo.stripeCouponId
        : !isAnnual && !isSixMonth && applyDiscount
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
  app.get("/api/pricing", async (c) => {
    const localizedPricing = await resolvePricingForRequest(c, { trustProxy, allowQueryOverride: true });
    return c.json({
      ...localizedPricing,
      pricing: localizedPricing,
    });
  });

  app.get("/api/checkout-config", async (c) => {
    const pk = (config.stripePublishableKey ?? "").trim();
    const validPk = pk.startsWith("pk_") && !pk.includes("...") ? pk : "";
    const isLiveStripe = Boolean(
      validPk.startsWith("pk_live_") ||
        (process.env.STRIPE_SECRET_KEY ?? "").trim().startsWith("sk_live_")
    );
    const localizedPricing = await resolvePricingForRequest(c, { trustProxy, allowQueryOverride: true });
    return c.json({
      publishableKey: validPk,
      isLiveStripe,
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
    repo.setOtp(`activation:${email}`, sha256(activationKey), expiresAt);

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
    const callerSessionAccId = await sessionAccountId(c);
    const isAuthenticatedOwner = Boolean(existing && callerSessionAccId === existing.id);
    if (existing) {
      accountId = existing.id;
      if (isAuthenticatedOwner || !existing.country || !existing.lead_device) {
        repo.setAccountLeadMeta(accountId, {
          country: existing.country && !isAuthenticatedOwner ? existing.country : localizedPricing.country,
          lead_device: existing.lead_device && !isAuthenticatedOwner ? existing.lead_device : leadDevice,
        });
      }
    } else {
      accountId = `acc_web_${randomToken(8)}`;
      const refreshToken = randomToken(32);
      repo.createAccount(accountId, sha256(refreshToken), email, null, {
        country: localizedPricing.country,
        lead_device: leadDevice,
      });
    }
    if (name && (!existing || isAuthenticatedOwner || !existing.name)) {
      repo.updateAccountProfile(accountId, {
        name,
        email,
        country: existing?.country && !isAuthenticatedOwner ? existing.country : localizedPricing.country,
        lead_device: existing?.lead_device && !isAuthenticatedOwner ? existing.lead_device : leadDevice,
      });
    }

    // Ensure Stripe Customer exists with billing details
    let customerId = existing?.stripe_customer_id ?? null;
    const attributionMeta = extractAttributionMeta(body, accountId, plan, refCode);
    try {
      const attrId =
        sanitizeAttributionId(body?.attribution_id) ||
        sanitizeAttributionId(body?.attribution?.attribution_id) ||
        sanitizeAttributionId(getCookie(c, "sweepr_attr_id"));
      associateCheckoutLeadWithRecovery(repo, {
        attributionId: attrId,
        email: providedEmail || email,
        accountId,
        nowSec: now(),
      });
      attributeCheckoutToExperiments(repo, {
        visitorKey: String(body?.visitor_id || "").trim() || attrId || clientIp(c) || accountId,
        accountId,
        plan,
      });
    } catch {}
    try {
      if (customerId) {
        try {
          await stripe.customers.update(customerId, {
            ...(providedEmail ? { email: providedEmail } : {}),
            ...(name && (!existing || isAuthenticatedOwner || !existing.name) ? { name } : {}),
            ...((addressLine1 || postalCode) && (!existing || isAuthenticatedOwner)
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

      const requestedCoupon = String(body?.coupon ?? body?.promo_code ?? c.req.query("coupon") ?? "").trim().toUpperCase();
      const resolvedPromo = await resolveCheckoutPromoCoupon(requestedCoupon);

      const introCouponId = resolvedPromo
        ? resolvedPromo.stripeCouponId
        : !isAnnual && !isSixMonth && applyDiscount
        ? await getOrCreateIntroCoupon(localizedPricing.currency, localizedPricing.introSavingsAmount)
        : "";

      if (Boolean(body.hostedCheckoutFallback) && paymentMethod === "card") {
        const checkoutSession = await createRedirectCheckoutSessionFallback({
          customerId,
          accountId,
          subItems,
          introCouponId,
          attributionMeta,
          isPopup,
          paymentMethod: "card",
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
          if (!existing || isAuthenticatedOwner) {
            await issuePortalSessionCookie(c, resolvedAccount.id);
          }
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
            if (!existing || isAuthenticatedOwner) {
              await issuePortalSessionCookie(c, accountId);
            }
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

      // Reject server-side raw card PAN submission in live/production mode (PCI-DSS SAQ-A enforcement)
      const isLiveStripe = Boolean(
        config.stripePublishableKey?.startsWith("pk_live_") ||
          process.env.STRIPE_SECRET_KEY?.startsWith("sk_live_") ||
          paymentIntent?.livemode
      );
      if ((confirmOnServer || typeof body.cardNumber === "string") && isLiveStripe) {
        return c.json(
          { error: "Direct card numbers are not accepted on the server. Please use Stripe Elements." },
          400
        );
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
        if (!existing || isAuthenticatedOwner) {
          await issuePortalSessionCookie(c, accountId);
        }

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
          await issuePortalSessionCookie(c, resolvedAccount.id);
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

  // Checks that the email is already signed up before sending a 6-digit OTP email (with generic 200 response to prevent enumeration).
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
          ok: true,
          otpSent: true,
          message: "If an account exists for that email, a 6-digit login code has been sent.",
        },
        200
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

    const nowSec = Math.floor(Date.now() / 1000);
    let valid = repo.verifyRecentEmailCode(email, code, sha256(code), nowSec);
    if (!valid) {
      const gotdCfg = getGiveawayConfig(repo, nowSec);
      if (isGiveawayCodeMatch(gotdCfg, code)) {
        const gotdRes = redeemGiveawayLicense(repo, {
          email,
          code,
          ipHash: sha256(clientIp(c)),
          nowSec,
        });
        if (gotdRes.ok) {
          valid = true;
        } else if (gotdRes.error === "giveaway_window_closed") {
          return c.json({ error: gotdRes.message || "Giveaway window has closed." }, 400);
        }
      }
    }
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
    await issuePortalSessionCookie(c, account.id);

    return c.json({ ok: true, redirect: "/dashboard" });
  });

  app.post("/api/logout", async (c) => {
    if (!isSameOriginRequest(c, config.publicUrl, trustProxy)) {
      return c.json({ error: "forbidden_origin" }, 403);
    }
    const accountId = await sessionAccountId(c);
    if (accountId) {
      repo.rotateAccountTokenHash(accountId, sha256(randomToken(32)));
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
      devices_max: Math.max(1, config.maxDevicesPc || 5),
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
        const rawCurrency = firstPrice?.currency || localizedPricing.currency;
        const tierPricing = getPricingForCountryOrCurrency(account.country, rawCurrency);
        const currency = tierPricing.currency;
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
  <link rel="icon" type="image/svg+xml" href="/favicon.svg?v=20261031b">
  <link rel="icon" type="image/png" href="/favicon.png?v=20261031b">
  <link rel="shortcut icon" href="/favicon.ico?v=20261031b">
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4 font-sans">
  <div class="w-full max-w-md bg-slate-900 border border-red-500/30 rounded-2xl p-6 shadow-2xl space-y-4">
    <div class="flex items-center gap-3">
      <img src="/favicon.svg?v=20261031b" alt="SWEEPR" class="w-10 h-10 rounded-xl shrink-0">
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

  // 3c-2. A6 Step 4: Switch to Monthly Plan instead of Cancelling (Cancel-Save Downsell)
  app.post("/api/portal/switch-to-monthly", async (c) => {
    if (!isSameOriginRequest(c, config.publicUrl, trustProxy)) {
      return c.json({ error: "forbidden_origin" }, 403);
    }
    const accountId = await sessionAccountId(c);
    if (!accountId) return c.json({ error: "unauthorized" }, 401);
    const account = repo.accountById(accountId);
    if (!account) return c.json({ error: "account_not_found" }, 404);

    const ent = repo.entitlement(accountId);
    if (!ent || (ent.status !== "active" && ent.status !== "trialing" && ent.status !== "past_due")) {
      return c.json({ error: "No active subscription found." }, 400);
    }

    if (ent.stripe_subscription_id && stripe && !ent.stripe_subscription_id.startsWith("sub_owner_")) {
      try {
        const sub = await stripe.subscriptions.retrieve(ent.stripe_subscription_id);
        const firstItem = sub?.items?.data?.[0];
        const subCurrency = (firstItem?.price?.currency || sub?.currency || "gbp").toLowerCase();
        const monthlyPriceId = await getOrCreatePlanPriceId("monthly", subCurrency);
        await stripe.subscriptions.update(ent.stripe_subscription_id, {
          cancel_at_period_end: false,
          ...(firstItem?.id
            ? { items: [{ id: firstItem.id, price: monthlyPriceId }] }
            : {}),
          proration_behavior: "none",
          metadata: {
            ...(sub?.metadata || {}),
            plan: "monthly",
            switched_from: ent.plan || "annual",
            cancel_save_flow: "switch_to_monthly",
          },
        });
      } catch (err: any) {
        console.warn("[portal] stripe switch-to-monthly warning:", err?.message || err);
        return c.json({ error: err?.message || "Failed to switch subscription to monthly billing." }, 400);
      }
    }

    const updatedPeriodEnd = ent.current_period_end ?? now() + 30 * 86400;
    repo.upsertEntitlement({
      ...ent,
      plan: "monthly",
      current_period_end: updatedPeriodEnd,
      cancel_at_period_end: 0,
    });

    repo.addActivity({
      account_id: account.id,
      type: "switched_to_monthly_save",
      title: "Customer Switched to Monthly (Cancel-Save)",
      description: `Switched from ${ent.plan || "annual"} to flexible Monthly billing instead of cancelling`,
      actor: "customer",
      metadata: { previous_plan: ent.plan || "annual", new_plan: "monthly" },
    });

    repo.recordAnalyticsEvent({
      event_name: "switched_to_monthly_save",
      platform: "windows",
      account_id: account.id,
      metadata: { previous_plan: ent.plan || "annual", new_plan: "monthly" },
    });

    return c.json({
      ok: true,
      plan: "monthly",
      cancel_at_period_end: false,
      current_period_end: updatedPeriodEnd,
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

  // 4. Unlink / Remove a Device (frees up a slot under the 5-device limit and invalidates its per-device token)
  const maxTotalDevices = Math.max(1, config.maxDevicesPc || 5);
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
    if (!isSameOriginRequest(c, config.publicUrl, trustProxy)) {
      return c.json({ error: "forbidden_origin" }, 403);
    }
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
    const authHeader = c.req.header("authorization") ?? "";
    if (!authHeader.startsWith("Bearer ") && !isSameOriginRequest(c, config.publicUrl, trustProxy)) {
      return c.json({ ok: false, error: "forbidden_origin", message: "Cross-origin request blocked" }, 403);
    }
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
    const pollSecret = (
      c.req.header("x-poll-secret") ||
      c.req.query("poll_secret") ||
      c.req.query("secret") ||
      ""
    ).trim();
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
    const authHeader = c.req.header("authorization") ?? "";
    if (!authHeader.startsWith("Bearer ") && !isSameOriginRequest(c, config.publicUrl, trustProxy)) {
      return c.json({ ok: false, error: "forbidden_origin", message: "Cross-origin request blocked" }, 403);
    }
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

    await issuePortalSessionCookie(c, account.id);

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
  <link rel="icon" type="image/svg+xml" href="/favicon.svg?v=20261031b">
  <link rel="icon" type="image/png" href="/favicon.png?v=20261031b">
  <link rel="shortcut icon" href="/favicon.ico?v=20261031b">
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4 font-sans">
  <div class="w-full max-w-md bg-slate-900 border border-emerald-500/30 rounded-2xl p-6 shadow-2xl">
    <div class="flex items-center gap-3 mb-5">
      <img src="/favicon.svg?v=20261031b" alt="SWEEPR" class="w-10 h-10 rounded-xl shrink-0">
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
              <div class="text-xs text-emerald-400 mt-1">Clean up to ${maxTotalDevices} devices per subscription (any combination of desktop or mobile)</div>
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
              Tap below to link this device to your SWEEPR Cleaner Pro subscription (clean up to ${maxTotalDevices} devices across Desktop &amp; Mobile).
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
      <div class="text-xs font-extrabold uppercase tracking-wider text-amber-300">${maxTotalDevices} / ${maxTotalDevices} Device Slots In Use</div>
      <p class="text-xs text-amber-100">Your subscription includes up to ${maxTotalDevices} linked devices (any combination of desktop or mobile). Remove one below to continue:</p>
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
          showStatus('✓ Device Linked! Subscription active (' + (data.devices_used || 1) + ' / ' + (data.devices_max || 5) + ' devices used).', true);
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
    repo.setDeviceTokenHash(accountId, deviceId, sha256(refreshToken));
    let resolvedAttrId: string | null = null;
    try {
      const attrId =
        sanitizeAttributionId(body.attribution_id) ||
        sanitizeAttributionId(getCookie(c, "sweepr_attr_id"));
      const reqIp =
        c.req.header("cf-connecting-ip")?.trim() ||
        c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
        clientIp(c);
      const reqPlatform = deviceType === "mobile" ? "android" : "windows";
      const matchedSession = recordAppInstalledForRecovery(repo, {
        attributionId: attrId,
        accountId,
        email,
        deviceId,
        clientIp: reqIp,
        platform: reqPlatform,
        ipOsFingerprint: computeIpOsFingerprint(reqIp, reqPlatform),
        source: "v1_accounts",
        nowSec: now(),
        allowRecentWindowsFallback: deviceType === "pc",
      });
      resolvedAttrId = matchedSession?.attribution_id || attrId || null;
      repo.recordAnalyticsEvent({
        event_name: "app_installed",
        platform: reqPlatform,
        account_id: accountId,
        metadata: {
          device_id: deviceId,
          device_type: deviceType,
          country: localizedPricing.country,
          attribution_id: resolvedAttrId,
          source: "v1_accounts",
        },
      });
    } catch {}
    syncToCentralCrm("/v1/telemetry/event", {
      event_name: "app_installed",
      category: "funnel",
      os: deviceType === "mobile" ? "android" : "windows",
      device_id: deviceId,
      account_id: accountId,
      properties: {
        device_type: deviceType,
        country: localizedPricing.country,
        attribution_id: resolvedAttrId,
        source: "v1_accounts",
      },
    });
    const referralCode = repo.ensureReferralCode(accountId);
    return c.json({
      account_id: accountId,
      refresh_token: refreshToken,
      referral_code: referralCode,
      attribution_id: resolvedAttrId,
    });
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
      const gotdCfg = getGiveawayConfig(repo, t);
      if (isGiveawayCodeMatch(gotdCfg, code)) {
        const gotdRes = redeemGiveawayLicense(repo, {
          email,
          code,
          deviceId,
          ipHash: sha256(clientIp(c)),
          nowSec: t,
        });
        if (gotdRes.ok) {
          localOtpValid = true;
        } else if (gotdRes.error === "giveaway_window_closed") {
          return c.json({ error: "giveaway_window_closed", message: gotdRes.message }, 400);
        }
      }
    }
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
    const preEnt = repo.entitlement(account.id);
    const isGiveawayPlan = preEnt?.plan === "giveaway_6m";
    const maxPcForAccount = isGiveawayPlan ? 1 : config.maxDevicesPc;
    const maxMobForAccount = isGiveawayPlan ? 0 : config.maxDevicesMobile;
    if (!repo.touchDevice(account.id, deviceId, deviceType, maxPcForAccount, maxMobForAccount)) {
      return c.json({
        error: "device_limit",
        status: "device_limit",
        message: isGiveawayPlan
          ? "Giveaway of the Day licenses cover 1 Windows PC. Upgrade to the 5-Device Annual Pro Plan for 50% off at https://sweeprcleaner.com/giveaway"
          : undefined,
      }, 403);
    }
    if (!account.country || !account.lead_device) {
      const localizedPricing = await resolvePricingForRequest(c, {
      country: typeof body?.country === "string" ? body.country : undefined,
      currency: typeof body?.currency === "string" ? body.currency : undefined,
      trustProxy,
      allowQueryOverride: true,
    });
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
    const h = c.req.header("authorization") ?? "";
    const bearerTok = h.startsWith("Bearer ") ? h.slice(7) : "";
    const matchedDev = bearerTok ? repo.deviceTokenOwner(sha256(bearerTok)) : undefined;
    if (matchedDev) {
      return c.json({ error: "Account deletion requires primary account authentication or portal login." }, 403);
    }
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
    const h = c.req.header("authorization") ?? "";
    const bearerTok = h.startsWith("Bearer ") ? h.slice(7) : "";
    const matchedDev = bearerTok ? repo.deviceTokenOwner(sha256(bearerTok)) : undefined;
    if (matchedDev && matchedDev.id !== deviceId) {
      return c.json({ error: "device_token_mismatch" }, 403);
    }
    const existingEntForLimit = repo.entitlement(account.id);
    const isGiveawayEnt = existingEntForLimit?.plan === "giveaway_6m";
    const maxPcLimit = isGiveawayEnt ? 1 : config.maxDevicesPc;
    const maxMobLimit = isGiveawayEnt ? 0 : config.maxDevicesMobile;
    if (!repo.touchDevice(account.id, deviceId, deviceType, maxPcLimit, maxMobLimit)) {
      if (isGiveawayEnt) {
        const upg = await triggerGiveawayDeviceLimitUpgradeEmail(repo, account.id, account.email, now());
        return c.json(
          {
            error: "device_limit",
            status: "device_limit",
            plan: "giveaway_6m",
            upgrade_url: upg.upgrade_url,
            coupon: DEFAULT_GOTD_UPGRADE_COUPON,
            discount_pct: 50,
            message:
              "Your 6-month Giveaway license covers 1 Windows PC. Upgrade to the 5-Device Annual Pro Plan for 50% off with code GOTD50.",
          },
          403
        );
      }
      return c.json({ error: "device_limit", status: "device_limit" }, 403);
    }
    if (!account.country || !account.lead_device) {
      const localizedPricing = await resolvePricingForRequest(c, {
      country: typeof body?.country === "string" ? body.country : undefined,
      currency: typeof body?.currency === "string" ? body.currency : undefined,
      trustProxy,
      allowQueryOverride: true,
    });
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
    if (!limitReferral.hit(clientIp(c))) return c.json({ error: "rate_limited" }, 429);
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

  async function resolveGooglePlayAccessToken(): Promise<string | null> {
    const direct = (process.env.GOOGLE_PLAY_ACCESS_TOKEN || "").trim();
    if (direct) return direct;
    const rawSa = (process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON || "").trim();
    if (!rawSa) return null;
    try {
      let jsonStr = rawSa;
      if (!rawSa.startsWith("{")) {
        if (existsSync(rawSa)) {
          jsonStr = readFileSync(rawSa, "utf8");
        } else {
          jsonStr = Buffer.from(rawSa, "base64").toString("utf8");
        }
      }
      const sa = JSON.parse(jsonStr);
      if (!sa?.client_email || !sa?.private_key) return null;
      const iat = Math.floor(Date.now() / 1000);
      const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
      const claim = Buffer.from(
        JSON.stringify({
          iss: sa.client_email,
          scope: "https://www.googleapis.com/auth/androidpublisher",
          aud: "https://oauth2.googleapis.com/token",
          iat,
          exp: iat + 3600,
        })
      ).toString("base64url");
      const signer = createSign("RSA-SHA256");
      signer.update(`${header}.${claim}`);
      const sig = signer.sign(sa.private_key, "base64url");
      const assertion = `${header}.${claim}.${sig}`;
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion,
        }).toString(),
        signal: AbortSignal.timeout(8000),
      });
      if (!tokenRes.ok) return null;
      const tokenData: any = await tokenRes.json().catch(() => null);
      return typeof tokenData?.access_token === "string" ? tokenData.access_token : null;
    } catch {
      return null;
    }
  }

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
    // Never allow unauthenticated binding to an existing account by email or account_id
    if (!account) {
      if (
        (email && repo.accountByEmail(email)) ||
        (typeof body?.account_id === "string" && body.account_id.trim())
      ) {
        return c.json(
          {
            error: "authentication_required",
            requires_otp: true,
            message: "Please authenticate with your account or 6-digit login code to link this purchase.",
          },
          401
        );
      }
    }

    // Prevent replay of the same Google Play purchase token / order ID across different accounts
    const existingSubOwner = repo.db
      .prepare("SELECT account_id FROM entitlements WHERE stripe_subscription_id = ? LIMIT 1")
      .get(subRefId) as { account_id: string } | undefined;
    if (existingSubOwner) {
      if (!account || existingSubOwner.account_id !== account.id) {
        return c.json({ error: "duplicate_purchase_token" }, 409);
      }
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

    // Fail-closed Google Play Developer API verification (unless explicitly overridden in local unit test env)
    const allowUnverifiedTest = process.env.ALLOW_UNVERIFIED_GOOGLE_PLAY_TEST === "1";
    const gpAccessToken = await resolveGooglePlayAccessToken();
    if (!gpAccessToken && !allowUnverifiedTest) {
      return c.json({ error: "google_play_verification_unconfigured" }, 503);
    }
    if (gpAccessToken) {
      try {
        const pkg = "com.sweepr.app";
        const subVerifyUrl = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(pkg)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;
        const productVerifyUrl = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(pkg)}/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`;

        const verifySubscriptionToken = async (): Promise<boolean> => {
          const gpRes = await fetch(subVerifyUrl, {
            headers: { Authorization: `Bearer ${gpAccessToken}` },
            signal: AbortSignal.timeout(8000),
          });
          if (!gpRes.ok) return false;
          const gpData: any = await gpRes.json().catch(() => null);
          const state = String(gpData?.subscriptionState ?? "");
          if (state !== "SUBSCRIPTION_STATE_ACTIVE" && state !== "SUBSCRIPTION_STATE_IN_GRACE_PERIOD") {
            return false;
          }
          if (
            Array.isArray(gpData?.lineItems) &&
            gpData.lineItems.length > 0 &&
            !gpData.lineItems.some((li: any) => li?.productId === productId)
          ) {
            return false;
          }
          return true;
        };

        const verifyOneTimeProductToken = async (): Promise<boolean> => {
          const gpProdRes = await fetch(productVerifyUrl, {
            headers: { Authorization: `Bearer ${gpAccessToken}` },
            signal: AbortSignal.timeout(8000),
          });
          if (!gpProdRes.ok) return false;
          const gpProdData: any = await gpProdRes.json().catch(() => null);
          if (Number(gpProdData?.purchaseState) !== 0) {
            return false;
          }
          if (gpProdData?.productId && gpProdData.productId !== productId) {
            return false;
          }
          return true;
        };

        const verified = isAddonOnly
          ? (await verifyOneTimeProductToken()) || (await verifySubscriptionToken())
          : (await verifySubscriptionToken()) || (await verifyOneTimeProductToken());

        if (!verified) {
          return c.json({ error: "invalid_google_play_receipt" }, 402);
        }
      } catch {
        return c.json({ error: "invalid_google_play_receipt" }, 402);
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
    const hasActiveStripeSub = Boolean(
      existingEnt?.stripe_subscription_id?.startsWith("sub_") && existingEnt.status === "active"
    );
    const resolvedSubId = hasActiveStripeSub ? existingEnt!.stripe_subscription_id : subRefId;
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
      stripe_subscription_id: resolvedSubId,
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
    const localizedPricing = await resolvePricingForRequest(c, {
      country: typeof body?.country === "string" ? body.country : undefined,
      currency: typeof body?.currency === "string" ? body.currency : undefined,
      trustProxy,
      allowQueryOverride: false,
    });
    repo.setAccountLeadMeta(account.id, {
      country: localizedPricing.country,
      lead_device: detectLeadDevice(c, body?.device_type || "pc"),
    });

    // If the entered email already has an active subscription, only auto-link if the caller is already authenticated as that account.
    // Otherwise require OTP verification via /v1/account/send-otp & /v1/account/verify-otp to prevent account takeover.
    if (email) {
      const entitledAcc = await findOrSyncEntitledAccountByEmail(email);
      if (entitledAcc) {
        const ent = repo.entitlement(entitledAcc.id);
        const t = now();
        if (ent && isEntitled(ent, t, config.pastDueGraceDays) && DEVICE_RE.test(deviceId)) {
          if (entitledAcc.id !== account.id) {
            return c.json({
              already_active: false,
              activated: false,
              requires_otp: true,
              email: entitledAcc.email ?? email,
              message:
                "An active subscription already exists for this email. Please verify with a 6-digit login code to link this device.",
            });
          }
          const checkoutDeviceType =
            body?.device_type === "mobile" || body?.platform === "android" || body?.platform === "ios"
              ? "mobile"
              : "pc";
          if (!repo.touchDevice(entitledAcc.id, deviceId, checkoutDeviceType, config.maxDevicesPc, config.maxDevicesMobile)) {
            return c.json({ error: "device_limit", status: "device_limit" }, 403);
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
            already_active: true,
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

    const v1AttributionMeta = extractAttributionMeta(
      body,
      account.id,
      plan,
      typeof body?.ref === "string" ? body.ref : typeof body?.referral_code === "string" ? body.referral_code : ""
    );
    try {
      const attrId =
        sanitizeAttributionId(body?.attribution_id) ||
        sanitizeAttributionId(body?.attribution?.attribution_id) ||
        sanitizeAttributionId(getCookie(c, "sweepr_attr_id"));
      if (email) {
        associateCheckoutLeadWithRecovery(repo, {
          attributionId: attrId,
          email,
          accountId: account.id,
          nowSec: now(),
        });
      }
      attributeCheckoutToExperiments(repo, {
        visitorKey: String(body?.visitor_id || "").trim() || attrId || clientIp(c) || account.id,
        accountId: account.id,
        plan,
      });
    } catch {}

    const requestedV1Coupon = String(
      (body as Record<string, unknown>)?.coupon ??
        (body as Record<string, unknown>)?.promo_code ??
        c.req.query("coupon") ??
        ""
    )
      .trim()
      .toUpperCase();
    const resolvedV1Promo = await resolveCheckoutPromoCoupon(requestedV1Coupon);

    try {
      const applyMonthlyIntro =
        Boolean((body as Record<string, unknown>)?.intro === true || (body as Record<string, unknown>)?.intro === "1") &&
        plan === "monthly" &&
        !alreadyPro;
      const introCouponId = resolvedV1Promo
        ? resolvedV1Promo.stripeCouponId
        : applyMonthlyIntro
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
        metadata: v1AttributionMeta,
        subscription_data: {
          metadata: {
            ...v1AttributionMeta,
            account_id: account.id,
            plan,
            ...(chosenAddons.length > 0 ? { addons: chosenAddons.join(",") } : {}),
            ...(includeBatteryCare ? { battery_care: "1" } : {}),
            ...(includeCloudVault ? { battery_care: "1", cloud_vault: "1" } : {}),
          },
        },
        ...(introCouponId
          ? { discounts: [{ coupon: introCouponId }] }
          : { allow_promotion_codes: true }),
        success_url: `${config.publicUrl}/checkout/success`,
        cancel_url: `${config.publicUrl}/checkout/cancel`,
      });
      if (session.url) {
        return c.json({ url: session.url, coupon_applied: resolvedV1Promo?.code ?? null });
      }
    } catch (err) {
      console.warn("[v1/checkout] Falling back to /order:", err);
    }

    const params = new URLSearchParams();
    params.set("plan", plan);
    if (email) params.set("email", email);
    if (resolvedV1Promo) params.set("coupon", resolvedV1Promo.code);
    if (chosenAddons.length > 0) {
      params.set("addons", chosenAddons.join(","));
      if (chosenAddons.length === 1) params.set("addon", chosenAddons[0]);
    }
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
    if (stripe && res.current_period_end) {
      const ent = repo.entitlement(accountId);
      if (
        ent?.stripe_subscription_id?.startsWith("sub_") &&
        !ent.stripe_subscription_id.startsWith("sub_owner") &&
        typeof (stripe.subscriptions as any)?.update === "function"
      ) {
        await stripe.subscriptions
          .update(ent.stripe_subscription_id, {
            trial_end: res.current_period_end,
            proration_behavior: "none",
          } as any)
          .catch(() => {});
      }
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
      sha256: process.env.LATEST_APP_SHA256 || config.latestAppSha256 || "",
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
    "paywall_plan_selected",
    "checkout_started",
    "purchase_completed",
    "clean_completed",
    "smartscreen_recovery_shown",
    "smartscreen_recovery_clicked",
    "smartscreen_recovery_flagged",
    "smartscreen_recovery_email_sent",
    "smartscreen_recovery_completed",
    "safe_to_delete_audit",
    "experiment_exposure",
    "experiment_conversion",
    "annual_renewal_recap_sent",
    "switched_to_monthly_save",
    "referral_aha_clicked",
  ]);
  let lastCrashEmailSentAt = 0;
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
    // Automated incident alert notification (#26 Alerts) — throttled to at most 1 email per 15 minutes
    const nowMs = Date.now();
    if (nowMs - lastCrashEmailSentAt >= 15 * 60_000) {
      lastCrashEmailSentAt = nowMs;
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
    }
    return c.json({ ok: true, id });
  });
  app.post("/v1/telemetry/event", async (c) => {
    if (!limitTelemetry.hit(clientIp(c))) return c.json({ error: "rate_limited" }, 429);
    const body = await c.req.json().catch(() => ({}));
    const eventName = String(body?.event_name ?? body?.event ?? "").trim();
    if (!ALLOWED_FUNNEL_EVENTS.has(eventName)) {
      return c.json({ error: "unsupported_event" }, 400);
    }
    const attrId =
      sanitizeAttributionId(body?.attribution_id) ||
      sanitizeAttributionId(body?.metadata?.attribution_id) ||
      sanitizeAttributionId(getCookie(c, "sweepr_attr_id"));
    const sessAccId = await sessionAccountId(c);
    const authHeader = c.req.header("authorization") ?? "";
    const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    const bearerAcc = bearerToken ? repo.accountByTokenHash(sha256(bearerToken)) : undefined;
    const rawDeviceId = String(
      body?.device_id ?? body?.hardware_id ?? body?.metadata?.device_id ?? body?.metadata?.hardware_id ?? ""
    )
      .trim()
      .slice(0, 64);
    let deviceAccountId: string | null = null;
    if (rawDeviceId) {
      const devRow = repo.db
        .prepare("SELECT account_id FROM devices WHERE id = ? AND revoked = 0 ORDER BY last_seen DESC LIMIT 1")
        .get(rawDeviceId) as { account_id: string } | undefined;
      if (devRow?.account_id) deviceAccountId = devRow.account_id;
    }
    const resolvedEmail = normalizeEmail(body?.email ?? body?.metadata?.email) || undefined;
    const emailAcc = resolvedEmail ? repo.accountByEmail(resolvedEmail) : undefined;
    const resolvedAccountId =
      (typeof body.account_id === "string" && body.account_id.trim()
        ? body.account_id.trim().slice(0, 64)
        : null) ||
      bearerAcc?.id ||
      sessAccId ||
      deviceAccountId ||
      emailAcc?.id ||
      null;

    let effectiveAttrId = attrId;
    let effectiveAccountId = resolvedAccountId;
    const visitorIp =
      c.req.header("cf-connecting-ip")?.trim() ||
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
      clientIp(c);
    const eventPlatform = String(body.platform || "windows").toLowerCase();
    const ipOsFingerprint = computeIpOsFingerprint(visitorIp, eventPlatform);

    let ledgerSummary: ReturnType<typeof repo.recordAccountScanAndCleanProgress> = null;
    let milestoneUnlocked = false;
    let referralUrl: string | null = null;

    try {
      if (eventName === "installer_downloaded") {
        const dlSession = recordInstallerDownloaded(repo, {
          attributionId: effectiveAttrId || `attr_ev_${randomToken(8)}`,
          platform: eventPlatform,
          installerFile: typeof body?.metadata?.installer === "string" ? body.metadata.installer : "SWEEPRCleaner.exe",
          accountId: effectiveAccountId,
          email: resolvedEmail,
          clientIp: visitorIp,
          ipOsFingerprint,
          metadata: body.metadata && typeof body.metadata === "object" ? body.metadata : null,
          nowSec: now(),
        });
        effectiveAttrId = dlSession.attribution_id || effectiveAttrId;
      } else if (eventName === "app_installed" || eventName === "first_launch" || eventName === "scan_started") {
        const matchedRecovery = recordAppInstalledForRecovery(repo, {
          attributionId: effectiveAttrId,
          accountId: effectiveAccountId,
          email: resolvedEmail,
          deviceId: rawDeviceId || null,
          clientIp: visitorIp,
          platform: eventPlatform,
          ipOsFingerprint,
          source: eventName,
          nowSec: now(),
          allowRecentWindowsFallback: eventPlatform.startsWith("win"),
        });
        if (matchedRecovery) {
          effectiveAttrId = matchedRecovery.attribution_id || effectiveAttrId;
          if (!effectiveAccountId && matchedRecovery.account_id) {
            effectiveAccountId = matchedRecovery.account_id;
          }
        }
      } else if (eventName === "scan_completed") {
        ingestScanCompletedTelemetry(seoStore, {
          platform: body.platform || "windows",
          ruleBytes: body?.metadata?.rule_bytes ?? body?.rule_bytes ?? null,
          samples: body?.metadata?.samples ?? body?.samples ?? null,
          nowSec: now(),
        });
        const scanBytes = Number(
          body?.metadata?.total_bytes ??
            body?.metadata?.reclaimable_bytes ??
            body?.total_bytes ??
            body?.reclaimable_bytes ??
            0
        );
        if (resolvedAccountId) {
          ledgerSummary = repo.recordAccountScanAndCleanProgress(resolvedAccountId, {
            isScan: true,
            reclaimableBytes: scanBytes,
            tsSec: now(),
          });
        }
      } else if (eventName === "clean_completed") {
        const cleanedBytes = Number(
          body?.metadata?.cleaned_bytes ??
            body?.metadata?.bytes_cleaned ??
            body?.metadata?.total_bytes ??
            body?.cleaned_bytes ??
            0
        );
        const cleanedFiles = Number(
          body?.metadata?.files_removed ?? body?.metadata?.cleaned_files ?? body?.files_removed ?? 0
        );
        if (resolvedAccountId) {
          ledgerSummary = repo.recordAccountScanAndCleanProgress(resolvedAccountId, {
            isClean: true,
            cleanedBytes,
            cleanedFiles,
            tsSec: now(),
          });
          if (ledgerSummary?.referral_code) {
            referralUrl = `https://sweeprcleaner.com/r/${encodeURIComponent(ledgerSummary.referral_code)}`;
          }
          const bestBytes = Math.max(cleanedBytes, ledgerSummary?.total_bytes_cleaned ?? 0);
          if (bestBytes >= 5 * 1024 * 1024 * 1024) {
            milestoneUnlocked = true;
            await dispatchPostCleanAhaMilestoneEmail(repo, {
              accountId: resolvedAccountId,
              cleanedBytes,
              lifetimeBytes: ledgerSummary?.total_bytes_cleaned ?? cleanedBytes,
              nowSec: now(),
            }).catch(() => {});
            recordAutomationRunStatus("A14_aha_referral", {
              status: "ok",
              summary: {
                account_id: resolvedAccountId,
                cleaned_gb: Number((bestBytes / (1024 * 1024 * 1024)).toFixed(2)),
                referral_code: ledgerSummary?.referral_code || null,
              },
            });
          }
        }
      } else if (eventName === "smartscreen_recovery_shown") {
        recordRecoveryBannerInteraction(repo, {
          attributionId: attrId,
          interaction: "shown",
          page: typeof body?.metadata?.page === "string" ? body.metadata.page : undefined,
          nowSec: now(),
        });
      } else if (eventName === "smartscreen_recovery_clicked") {
        recordRecoveryBannerInteraction(repo, {
          attributionId: attrId,
          interaction: "clicked",
          action: typeof body?.metadata?.action === "string" ? body.metadata.action : undefined,
          page: typeof body?.metadata?.page === "string" ? body.metadata.page : undefined,
          nowSec: now(),
        });
      }
    } catch {}

    const enrichedMetadata =
      body.metadata && typeof body.metadata === "object"
        ? {
            ...body.metadata,
            ...(effectiveAttrId ? { attribution_id: effectiveAttrId } : {}),
            ...(rawDeviceId ? { device_id: rawDeviceId } : {}),
          }
        : effectiveAttrId || rawDeviceId
          ? {
              ...(effectiveAttrId ? { attribution_id: effectiveAttrId } : {}),
              ...(rawDeviceId ? { device_id: rawDeviceId } : {}),
            }
          : body.metadata;

    const id = repo.recordAnalyticsEvent({
      event_name: eventName,
      platform: body.platform,
      account_id: effectiveAccountId,
      metadata: enrichedMetadata,
    });
    syncToCentralCrm("/v1/telemetry/event", {
      event_name: eventName,
      category: "funnel",
      os: body.platform || "windows",
      account_id: effectiveAccountId,
      properties: enrichedMetadata || null,
    });
    return c.json({
      ok: true,
      id,
      attribution_id: effectiveAttrId || null,
      account_id: effectiveAccountId,
      ...(ledgerSummary
        ? {
            lifetime_bytes_cleaned: ledgerSummary.total_bytes_cleaned,
            lifetime_cleans_count: ledgerSummary.total_cleans_count,
            lifetime_scans_count: ledgerSummary.total_scans_count,
            referral_code: ledgerSummary.referral_code,
            referral_url: referralUrl,
            milestone_unlocked: milestoneUnlocked,
          }
        : {}),
    });
  });

  app.get("/api/telemetry/recovery-status", async (c) => {
    const attrId =
      sanitizeAttributionId(c.req.query("attribution_id")) ||
      sanitizeAttributionId(getCookie(c, "sweepr_attr_id"));
    const status = await getVisitorRecoveryStatus(repo, attrId, now());
    return c.json(status);
  });

  app.post("/api/download-recovery/bind-email", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const rawEmail = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!rawEmail || !rawEmail.includes("@") || rawEmail.length > 254) {
      return c.json({ error: "invalid_email" }, 400);
    }
    let attrId =
      sanitizeAttributionId(body?.attribution_id) ||
      sanitizeAttributionId(getCookie(c, "sweepr_attr_id"));
    if (!attrId) {
      attrId = `attr_dl_${randomToken(8)}`;
      setCookie(c, "sweepr_attr_id", attrId, {
        httpOnly: false,
        sameSite: "Lax",
        secure: isHttps,
        path: "/",
        maxAge: 90 * 86400,
      });
    }
    const platform = typeof body?.platform === "string" ? body.platform.toLowerCase() : "windows";
    const existingAcc = repo.accountByEmail(rawEmail);
    let accountId = existingAcc?.id || null;
    if (!accountId) {
      accountId = `acc_lead_${randomToken(8)}`;
      const refreshToken = randomToken(32);
      try {
        repo.createAccount(accountId, sha256(refreshToken), rawEmail, null, {
          lead_device: platform,
          created_at: now(),
        });
      } catch {
        accountId = repo.accountByEmail(rawEmail)?.id || null;
      }
    }
    recordInstallerDownloaded(repo, {
      attributionId: attrId,
      platform,
      installerFile: platform === "mac" ? "SWEEPRCleaner.dmg" : "SWEEPRCleaner.exe",
      accountId,
      email: rawEmail,
      metadata: { source: "post_download_modal" },
      nowSec: now(),
    });
    associateCheckoutLeadWithRecovery(repo, {
      attributionId: attrId,
      email: rawEmail,
      accountId,
      nowSec: now(),
    });
    if (body?.send_desktop_link || body?.include_welcome_coupon || platform === "ios" || platform === "android") {
      const winUrl = `https://sweeprcleaner.com/download?platform=windows&utm_source=download_backup_email&attribution_id=${encodeURIComponent(attrId)}`;
      const macUrl = `https://sweeprcleaner.com/download?platform=mac&utm_source=download_backup_email&attribution_id=${encodeURIComponent(attrId)}`;
      const orderUrl = `https://sweeprcleaner.com/order?plan=annual&coupon=WELCOME20&utm_source=download_backup_email&attribution_id=${encodeURIComponent(attrId)}`;
      const winSha = getInstallerMeta("windows").sha256;
      void dispatchTransactionalCustomerEmail({
        to: rawEmail,
        subject: "Your SWEEPR Cleaner Backup Download Link + 20% Welcome Coupon (WELCOME20)",
        textBody: [
          "Here is your backup download link for SWEEPR Cleaner plus your 20% Pro Welcome Coupon:",
          "",
          `Download for Windows 10 & 11 (.exe): ${winUrl}`,
          `Download for Mac (.dmg): ${macUrl}`,
          `Verified Windows SHA-256: ${winSha}`,
          "",
          "Quick Windows SmartScreen Tip:",
          "1. Open SWEEPRCleaner.exe",
          "2. Click More info -> Run anyway (Verified SSL.com Publisher: Benjamin Cook)",
          "3. Your free 60s scan starts automatically.",
          "",
          `Claim 20% Off 5-Device Pro License (Code WELCOME20): ${orderUrl}`,
        ].join("\n"),
        htmlBody: `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:540px;margin:0 auto;padding:28px 22px;background:#ffffff;border:1px solid #d6dad5;border-radius:16px;color:#111613;">
          <h2 style="margin:0 0 8px;color:#073825;">Your SWEEPR Cleaner Backup Link + 20% Welcome Coupon</h2>
          <p style="color:#4b554e;font-size:14px;line-height:1.5;">Open this email on your Windows PC or Mac to download SWEEPR Cleaner anytime:</p>
          <p style="margin:18px 0 10px;"><a href="${winUrl}" style="display:inline-block;background:#0d6847;color:#ffffff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:800;">💻 Download for Windows 10 &amp; 11 (.exe)</a></p>
          <p style="margin:10px 0 16px;"><a href="${macUrl}" style="display:inline-block;background:#f4f5f3;color:#111613;border:1px solid #d6dad5;padding:10px 18px;border-radius:10px;text-decoration:none;font-weight:700;">🍏 Download for Mac (.dmg)</a></p>
          <div style="padding:12px 14px;border-radius:10px;background:#f8faf9;border:1px solid #dce5df;font-size:12.5px;color:#334155;line-height:1.5;">
            <strong>Windows SmartScreen Quick Tip:</strong> Click <strong>More info &rarr; Run anyway</strong> (Verified SSL.com Publisher: <strong>Benjamin Cook</strong>).<br />
            <span style="font-family:ui-monospace,Consolas,monospace;font-size:11px;color:#475569;word-break:break-all;">SHA-256: ${escapeHtml(winSha)}</span>
          </div>
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0;" />
          <div style="padding:14px;border-radius:12px;background:#eaf5ef;border:1px solid #9adbc0;">
            <div style="font-size:13.5px;font-weight:800;color:#073825;margin-bottom:4px;">🎁 20% Off SWEEPR Pro (5 Devices) — Code: <code style="background:#fff;padding:2px 6px;border-radius:5px;border:1px dashed #0d6847;">WELCOME20</code></div>
            <p style="margin:0;font-size:13px;color:#1e3a2f;"><a href="${orderUrl}" style="color:#0d6847;font-weight:800;">Apply 20% Welcome Coupon on Checkout &rarr;</a></p>
          </div>
        </div>`,
        tag: "download_backup_welcome_coupon",
      }).catch(() => {});
    }
    return c.json({
      ok: true,
      attribution_id: attrId,
      account_id: accountId,
      email: rawEmail,
      welcome_coupon: "WELCOME20",
      discount_pct: 20,
    });
  });

  // Action 3.1: A/B Experiment Assignment & Exposure Tracking
  const handleExperimentAssign = async (c: Context) => {
    const body = c.req.method === "POST" ? await c.req.json().catch(() => ({})) : {};
    const visitorKey =
      String(
        body?.visitor_id ||
          c.req.query("visitor_id") ||
          body?.attribution_id ||
          c.req.query("attribution_id") ||
          getCookie(c, "sweepr_attr_id") ||
          clientIp(c) ||
          "anon"
      ).trim() || "anon";

    const recordExposure = body?.record_exposure !== false && c.req.query("record_exposure") !== "0";
    const assignments: Record<string, { variant: "A" | "B"; label: string; copy: string }> = {};

    for (const exp of Object.values(ACTIVE_EXPERIMENTS)) {
      const variant = assignExperimentVariant(exp.id, visitorKey);
      assignments[exp.id] = {
        variant,
        label: exp.variants[variant].label,
        copy: exp.variants[variant].copy,
      };
      if (recordExposure) {
        repo.recordAnalyticsEvent({
          event_name: "experiment_exposure",
          platform: "windows",
          metadata: {
            experiment: exp.id,
            variant,
            visitor_key: visitorKey,
          },
        });
      }
    }

    return c.json({
      ok: true,
      visitor_key: visitorKey,
      assignments,
    });
  };
  app.get("/api/experiments/assign", handleExperimentAssign);
  app.post("/api/experiments/assign", handleExperimentAssign);

  // Admin CRM Experiment Summary (Action 3.1)
  app.get("/api/crm/experiments", (c) => {
    return c.json(getExperimentSummary(repo));
  });

  app.post("/api/crm/experiments/promote", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const expId = String(body?.experiment_id ?? "").trim() as any;
    const variant = String(body?.variant ?? "").trim().toUpperCase() as "A" | "B";
    if (!ACTIVE_EXPERIMENTS[expId as keyof typeof ACTIVE_EXPERIMENTS] || (variant !== "A" && variant !== "B")) {
      return c.json({ ok: false, error: "invalid_experiment_or_variant" }, 400);
    }
    promoteExperimentWinner(expId, variant);
    const liftMultipliers = getExperimentLiftMultipliers(repo);
    seoStore.reconcileStrategyLedgerActualsAndCalibrate({
      experimentLiftMultipliers: liftMultipliers,
      recalibrate: true,
    });
    return c.json({ ok: true, experiment_id: expId, promoted_variant: variant });
  });

  app.post("/api/crm/experiments/evaluate", async (c) => {
    const summary = getExperimentSummary(repo);
    const liftMultipliers = getExperimentLiftMultipliers(repo);
    const calibration = seoStore.reconcileStrategyLedgerActualsAndCalibrate({
      experimentLiftMultipliers: liftMultipliers,
      recalibrate: true,
    });
    recordAutomationRunStatus("A9_ab_experiments", {
      status: "ok",
      summary: {
        experiments: summary.experiments.map((e) => ({
          id: e.id,
          z_score: e.z_score,
          winner: e.statistically_significant_winner,
        })),
        calibrated_lifts: liftMultipliers,
      },
    });
    return c.json({
      ...summary,
      calibrated_lifts: liftMultipliers,
      strategy_ledger_reconciled: calibration.evaluated_count,
    });
  });

  // Dynamic In-App & Web Conversion Offer Endpoint (A10 High-Intent Scan & Giveaway Upgrade)
  app.get("/v1/conversion/offer", async (c) => {
    const email = normalizeEmail(c.req.query("email"));
    const accountId = String(c.req.query("account_id") ?? "").trim();
    const hardwareId = String(c.req.query("hardware_id") ?? c.req.query("device_id") ?? "").trim();
    let deviceAccId = "";
    if (hardwareId) {
      const devRow = repo.db
        .prepare("SELECT account_id FROM devices WHERE id = ? AND revoked = 0 ORDER BY last_seen DESC LIMIT 1")
        .get(hardwareId) as { account_id: string } | undefined;
      if (devRow?.account_id) deviceAccId = devRow.account_id;
    }
    const acc =
      (accountId && repo.accountById(accountId)) ||
      (deviceAccId && repo.accountById(deviceAccId)) ||
      (email && repo.accountByEmail(email)) ||
      undefined;
    const ent = acc ? repo.entitlement(acc.id) : undefined;
    const gotdCfg = getGiveawayConfig(repo, now());
    const isGiveaway = ent?.plan === "giveaway_6m";
    const explicitBytes = Math.max(0, Number(c.req.query("bytes_found") ?? 0));
    const storedBytes = Number(acc?.max_scan_reclaimable_bytes ?? 0);
    const bytesFound = Math.max(explicitBytes, storedBytes);
    const gbFound = +(bytesFound / (1024 * 1024 * 1024)).toFixed(1);

    if (isGiveaway) {
      const upgradeUrl = `/order?plan=annual&coupon=${encodeURIComponent(gotdCfg.upgrade_coupon)}${acc?.email ? `&email=${encodeURIComponent(acc.email)}` : ""}&utm_source=app_offer`;
      return c.json({
        ok: true,
        offer_type: "giveaway_5device_upgrade",
        coupon: gotdCfg.upgrade_coupon,
        coupon_code: gotdCfg.upgrade_coupon,
        discount_pct: gotdCfg.upgrade_discount_pct,
        headline: "Unlock 5-Device Annual Pro for 50% Off",
        subheadline: "Your Giveaway edition covers 1 Windows PC for 6 months. Upgrade to protect up to 5 PCs, Macs & phones for 12 months.",
        cta_label: `Claim ${gotdCfg.upgrade_discount_pct}% Off 5-Device Pro`,
        checkout_url: upgradeUrl,
      });
    }

    const emailQuery = (acc?.email || email) ? `&email=${encodeURIComponent((acc?.email || email)!)}` : "";
    const isHighBloat = bytesFound >= 5 * 1024 * 1024 * 1024;
    return c.json({
      ok: true,
      offer_type: isHighBloat ? "high_bloat_scan_unlock" : "standard_pro_upgrade",
      gb_found: gbFound,
      coupon: isHighBloat ? "SCAN5GB20" : null,
      coupon_code: isHighBloat ? "SCAN5GB20" : null,
      discount_pct: isHighBloat ? 20 : 0,
      headline: isHighBloat
        ? `Reclaim ${gbFound} GB Automatically — Claim 20% Off Annual Pro (SCAN5GB20)`
        : "Keep Your PC Clean Automatically with SWEEPR Pro",
      subheadline:
        "Unlock 1-click scheduled background cleanup, 5-device coverage (Windows, Mac, Android & iOS), and 7-day Trash Vault safety.",
      cta_label: isHighBloat
        ? `Claim 20% Off Pro & Clean ${gbFound} GB Now`
        : "Start Trial ($1 First Month) or Save 58% Annually",
      checkout_url: `/order?plan=annual${isHighBloat ? "&coupon=SCAN5GB20" : ""}${emailQuery}&utm_source=app_scan_offer`,
      intro_monthly_url: `/order?plan=monthly&intro=1${emailQuery}&utm_source=app_scan_offer`,
    });
  });

  // Action 3.4: A6 Annual-Renewal Value Recap CRM Preview & Trigger
  app.get("/api/crm/renewal-recap/:accountId", (c) => {
    const accountId = c.req.param("accountId");
    const recap = getAccountStorageRecap(repo, accountId, now());
    if (!recap) return c.json({ ok: false, error: "account_not_found" }, 404);
    return c.json({ ok: true, recap });
  });

  app.post("/api/crm/renewal-recap/trigger", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const accountId = String(body?.account_id ?? "").trim();
    if (!accountId) return c.json({ ok: false, error: "account_id_required" }, 400);
    const res = await processAnnualRenewalRecap(repo, {
      accountId,
      invoiceId: typeof body.invoice_id === "string" ? body.invoice_id : undefined,
      renewalTs: Number.isFinite(Number(body.renewal_ts)) ? Number(body.renewal_ts) : undefined,
      nowSec: now(),
      force: Boolean(body.force),
    });
    if (!res.ok) return c.json(res, 404);
    return c.json(res);
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
    if (!event) {
      return c.json({ error: "invalid_signature" }, 400);
    }
    if (repo.isWebhookProcessed(event.id)) return c.json({ received: true, duplicate: true });
    try {
      const res = await handleStripeEvent(stripe, repo, event);
      if (res?.duplicate) return c.json({ received: true, duplicate: true });
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
    if (repo.isWebhookProcessed(key)) return c.json({ received: true, duplicate: true });
    try {
      await handleRevenueCatWebhook(repo, body);
      repo.markWebhookProcessed(key);
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
    let resolvedAmountCents: number | null = null;
    let resolvedCurrencyRaw: string | null = null;
    let resolvedPlanTier: string | null = c.req.query("plan")?.trim() || null;

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
        if (typeof session?.amount_total === "number" && Number.isFinite(session.amount_total)) {
          resolvedAmountCents = session.amount_total;
        }
        if (typeof session?.currency === "string" && session.currency.trim()) {
          resolvedCurrencyRaw = session.currency.trim();
        }
        if (typeof session?.metadata?.plan === "string" && session.metadata.plan.trim()) {
          resolvedPlanTier = session.metadata.plan.trim();
        }
      } catch (err) {
        console.error("[checkout/success] session lookup error:", err);
      }
    }

    if (subscriptionId && !subscriptionId.startsWith("cs_") && stripe) {
      try {
        let sub = await retrieveSubscriptionSafe(subscriptionId);
        const metaAccountId = typeof sub.metadata?.account_id === "string" ? sub.metadata.account_id.trim() : "";
        if (!metaAccountId || (accountId && metaAccountId !== accountId)) {
          if (isPopup) {
            return c.html(popupClosePage("cancelled", "/order?error=payment_incomplete"));
          }
          return c.redirect("/order?error=payment_incomplete");
        }

        // Verify payment status strictly from the subscription's own invoice PaymentIntent or a verified linked PaymentIntent
        const extractSubPiStatus = async (s: Stripe.Subscription): Promise<string> => {
          const latestInv: any = s.latest_invoice;
          const invPi: any =
            latestInv?.payment_intent ??
            latestInv?.payments?.data?.[0]?.payment?.payment_intent ??
            null;
          const invPiId = typeof invPi === "string" ? invPi : invPi?.id ?? "";
          let status = typeof invPi === "object" && invPi ? String(invPi.status || "") : "";
          if (typeof invPi === "object" && invPi) {
            if (resolvedAmountCents === null && typeof invPi.amount === "number" && invPi.amount > 0) {
              resolvedAmountCents = invPi.amount;
            }
            if (!resolvedCurrencyRaw && typeof invPi.currency === "string" && invPi.currency.trim()) {
              resolvedCurrencyRaw = invPi.currency.trim();
            }
          }
          if (!status && invPiId && typeof (stripe.paymentIntents as any)?.retrieve === "function") {
            const fetched = await stripe.paymentIntents.retrieve(invPiId).catch(() => null);
            if (fetched) {
              status = String(fetched.status || "");
              if (resolvedAmountCents === null && typeof fetched.amount === "number" && fetched.amount > 0) {
                resolvedAmountCents = fetched.amount;
              }
              if (!resolvedCurrencyRaw && typeof fetched.currency === "string" && fetched.currency.trim()) {
                resolvedCurrencyRaw = fetched.currency.trim();
              }
            }
          }
          if (!status && paymentIntentId && typeof (stripe.paymentIntents as any)?.retrieve === "function") {
            const subCustId = typeof s.customer === "string" ? s.customer : (s.customer as any)?.id ?? "";
            const fetched = await stripe.paymentIntents.retrieve(paymentIntentId).catch(() => null);
            const piCustId =
              typeof fetched?.customer === "string" ? fetched.customer : (fetched?.customer as any)?.id ?? "";
            const piMetaAcc =
              fetched?.metadata?.account_id || (fetched?.metadata as any)?.sweepr_account_id || "";
            if (
              fetched &&
              ((invPiId && fetched.id === invPiId) ||
                (subCustId && piCustId === subCustId) ||
                (piMetaAcc && piMetaAcc === metaAccountId))
            ) {
              status = String(fetched.status || "");
              if (resolvedAmountCents === null && typeof fetched.amount === "number" && fetched.amount > 0) {
                resolvedAmountCents = fetched.amount;
              }
              if (!resolvedCurrencyRaw && typeof fetched.currency === "string" && fetched.currency.trim()) {
                resolvedCurrencyRaw = fetched.currency.trim();
              }
            }
          }
          return status;
        };

        let piStatus = await extractSubPiStatus(sub);
        let piSucceeded = piStatus === "succeeded" || piStatus === "processing";

        // If redirect just succeeded on Stripe's side, Stripe may take a brief moment to settle the invoice status from incomplete -> active
        if (sub.status === "incomplete" && piSucceeded) {
          await new Promise((r) => setTimeout(r, 800));
          sub = await retrieveSubscriptionSafe(subscriptionId).catch(() => sub);
          piStatus = await extractSubPiStatus(sub);
          piSucceeded = piStatus === "succeeded" || piStatus === "processing";
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

        const latestInv: any = sub.latest_invoice;
        const subItemPrice: any = sub.items?.data?.[0]?.price;
        const subAmountCandidates = [
          typeof latestInv?.amount_paid === "number" && latestInv.amount_paid > 0 ? latestInv.amount_paid : null,
          typeof latestInv?.amount_due === "number" && latestInv.amount_due > 0 ? latestInv.amount_due : null,
          typeof latestInv?.total === "number" && latestInv.total > 0 ? latestInv.total : null,
          typeof subItemPrice?.unit_amount === "number" && subItemPrice.unit_amount > 0 ? subItemPrice.unit_amount : null,
        ];
        for (const cand of subAmountCandidates) {
          if (resolvedAmountCents === null && cand !== null) {
            resolvedAmountCents = cand;
            break;
          }
        }
        const subCurrencyCandidates = [
          (sub as any).currency,
          latestInv?.currency,
          subItemPrice?.currency,
        ];
        for (const currCand of subCurrencyCandidates) {
          if (!resolvedCurrencyRaw && typeof currCand === "string" && currCand.trim()) {
            resolvedCurrencyRaw = currCand.trim();
            break;
          }
        }
        if (!resolvedPlanTier && typeof sub.metadata?.plan === "string" && sub.metadata.plan.trim()) {
          resolvedPlanTier = sub.metadata.plan.trim();
        }

        if (metaAccountId && (!accountId || metaAccountId === accountId)) {
          await syncPayPalCustomerEmail(sub, metaAccountId);
          const effectiveSub =
            sub.status === "incomplete" && piSucceeded ? ({ ...sub, status: "active" } as Stripe.Subscription) : sub;
          syncSubscription(repo, effectiveSub, metaAccountId);

          const resolvedAccount = repo.accountById(metaAccountId);

          if (resolvedAccount && (effectiveSub.status === "active" || effectiveSub.status === "trialing")) {
            const isFreshSub = !sub.created || now() - Number(sub.created) < 86400;
            if (isFreshSub) {
              await issuePortalSessionCookie(c, resolvedAccount.id);
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

    if (paymentIntentId && stripe && (resolvedAmountCents === null || !resolvedCurrencyRaw)) {
      try {
        const fetchedPi = await stripe.paymentIntents.retrieve(paymentIntentId).catch(() => null);
        if (fetchedPi) {
          if (resolvedAmountCents === null && typeof fetchedPi.amount === "number" && fetchedPi.amount > 0) {
            resolvedAmountCents = fetchedPi.amount;
          }
          if (!resolvedCurrencyRaw && typeof fetchedPi.currency === "string" && fetchedPi.currency.trim()) {
            resolvedCurrencyRaw = fetchedPi.currency.trim();
          }
          if (!resolvedPlanTier && typeof fetchedPi.metadata?.plan === "string" && fetchedPi.metadata.plan.trim()) {
            resolvedPlanTier = fetchedPi.metadata.plan.trim();
          }
        }
      } catch {}
    }

    if (accountId && (resolvedAmountCents === null || !resolvedCurrencyRaw || !resolvedPlanTier)) {
      const dbSubs = repo.subscriptionsForAccount(accountId);
      const matchedSub =
        (subscriptionId ? dbSubs.find((s) => s.id === subscriptionId || s.stripe_subscription_id === subscriptionId) : null) ??
        dbSubs[0];
      if (matchedSub) {
        if (resolvedAmountCents === null && typeof matchedSub.amount_cents === "number" && matchedSub.amount_cents > 0) {
          resolvedAmountCents = matchedSub.amount_cents;
        }
        if (!resolvedCurrencyRaw && typeof matchedSub.currency === "string" && matchedSub.currency.trim()) {
          resolvedCurrencyRaw = matchedSub.currency.trim();
        }
        if (!resolvedPlanTier && typeof matchedSub.plan === "string" && matchedSub.plan.trim()) {
          resolvedPlanTier = matchedSub.plan.trim();
        }
      }
      if (!resolvedPlanTier) {
        const ent = repo.entitlement(accountId);
        if (ent?.plan) resolvedPlanTier = ent.plan;
      }
    }

    deleteCookie(c, "sweepr_order_draft", { path: "/" });

    if (isPopup) {
      const successTargetUrl = `/checkout/success?web=1${sessionId ? `&session_id=${encodeURIComponent(sessionId)}` : ""}${subscriptionId ? `&subscription_id=${encodeURIComponent(subscriptionId)}` : ""}${accountId ? `&account_id=${encodeURIComponent(accountId)}` : ""}`;
      return c.html(popupClosePage("success", successTargetUrl));
    }

    const finalCurrency = (resolvedCurrencyRaw || c.req.query("currency") || "GBP").trim().toUpperCase();
    const finalPlanTier = (resolvedPlanTier || "annual").trim().toLowerCase();
    const pricingTier = PRICING_BY_CURRENCY[finalCurrency.toLowerCase()] ?? PRICING_BY_CURRENCY.gbp;
    const fallbackAmountMinor =
      finalPlanTier === "monthly"
        ? pricingTier.monthlyAmount
        : finalPlanTier === "six_month" || finalPlanTier === "6month"
        ? pricingTier.sixMonthAmount
        : pricingTier.annualAmount;
    const amountMinor = resolvedAmountCents !== null ? resolvedAmountCents : fallbackAmountMinor;
    const purchaseValue = pricingTier.zeroDecimal ? amountMinor : +(amountMinor / 100).toFixed(2);
    const purchasePlanLabel =
      finalPlanTier === "monthly"
        ? "SWEEPR Cleaner Pro (monthly)"
        : finalPlanTier === "six_month" || finalPlanTier === "6month"
        ? "SWEEPR Cleaner Pro (six_month)"
        : "SWEEPR Cleaner Pro (annual)";

    const safeTxId = escapeHtml(subscriptionId || sessionId || accountId || `tx_${now()}`);
    const clearDraftScript = `<script>try{localStorage.removeItem('sweepr_order_draft');document.cookie='sweepr_order_draft=; path=/; max-age=0; SameSite=Lax';window.SWEEPR_PURCHASE_EVENT={transaction_id:${JSON.stringify(safeTxId)},value:${purchaseValue},currency:${JSON.stringify(finalCurrency)},plan:${JSON.stringify(finalPlanTier)},plan_label:${JSON.stringify(purchasePlanLabel)}};if(typeof gtag==='function'||typeof fbq==='function'){var dk='sweepr_ga4_purchased_'+${JSON.stringify(safeTxId)};if(sessionStorage.getItem(dk)!=='1'){sessionStorage.setItem(dk,'1');if(typeof gtag==='function'){gtag('event','purchase',{transaction_id:${JSON.stringify(safeTxId)},value:${purchaseValue},currency:${JSON.stringify(finalCurrency)},plan:${JSON.stringify(finalPlanTier)},items:[{item_id:'sweepr_'+${JSON.stringify(finalPlanTier)},item_name:${JSON.stringify(purchasePlanLabel)},price:${purchaseValue},quantity:1}]});}if(typeof fbq==='function'){fbq('track','Purchase',{content_name:${JSON.stringify(purchasePlanLabel)},plan:${JSON.stringify(finalPlanTier)},value:${purchaseValue},currency:${JSON.stringify(finalCurrency)}});}}}}catch(e){}</script>`;
    if (isWeb) {
      return c.html(
        page(
          "You're Activated 🎉",
          `Thanks for purchasing SWEEPR Cleaner! We have emailed your 6-digit Subscription Activation Key. Download the app below, open the Account tab, and enter your email + 6-digit Subscription Key to activate Pro immediately.<div style="margin-top:14px;padding:12px 14px;border-radius:12px;background:#eef6f1;border:1px solid #b8d8c5;text-align:left;font-size:12px;color:#143625;line-height:1.45;"><strong>🛡️ Windows 10 &amp; 11 First-Launch Tip:</strong> If Windows SmartScreen appears when opening <code>SWEEPRCleaner.exe</code>: <strong>1. Click &ldquo;More info&rdquo;</strong> &rarr; <strong>2. Click &ldquo;Run anyway&rdquo;</strong>.</div>${clearDraftScript}`,
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
        account_id,
        stripe_subscription_id: status === "active" ? `sub_dev_${account_id}` : null,
        status,
        plan: "monthly",
        current_period_end: now() + clampedDays * 86400,
        cancel_at_period_end: 0,
      });
      return c.json({ ok: true });
    });
  }

  return app;
}
