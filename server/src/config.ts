import { existsSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";

if (process.env.NODE_ENV !== "production" && existsSync(".env")) process.loadEnvFile(".env");

const num = (v: string | undefined, d: number) => (v && !Number.isNaN(Number(v)) ? Number(v) : d);

const licensePrivateKeyB64 = process.env.LICENSE_PRIVATE_KEY_B64 ?? "";
const crmAdminPassword = process.env.CRM_ADMIN_PASSWORD ?? "";

const resolvedSecretKey = (process.env.STRIPE_SECRET_KEY ?? "").trim();
const isLiveStripe = resolvedSecretKey.startsWith("sk_live_");

function resolveStripeWebhookSecret(): string {
  return (process.env.STRIPE_WEBHOOK_SECRET ?? "").trim();
}

function resolvePriceId(envVal: string | undefined, liveDefault: string): string {
  const v = (envVal ?? "").trim();
  if (isLiveStripe && (!v || v.includes("17inokASBD") || v.includes("..."))) {
    return liveDefault;
  }
  return v || liveDefault;
}

export const config = {
  port: num(process.env.PORT, 8787),
  publicUrl: process.env.PUBLIC_URL ?? "http://localhost:8787",
  databasePath: process.env.DATABASE_PATH ?? "./data/sweepr.db",
  licensePrivateKeyB64,
  // Secret for signing the customer portal session cookie. Falls back to a value derived from the licence key,
  // or a random per-process secret (sessions won't survive restarts) if neither is set.
  sessionSecret: process.env.SESSION_SECRET
    || (licensePrivateKeyB64
      ? createHash("sha256").update(`sweepr-session:${licensePrivateKeyB64}`).digest("hex")
      : randomBytes(32).toString("hex")),
  // HTTP Basic credentials protecting /crm, /admin and /api/crm/*. CRM is disabled if the password is unset.
  crmAdminUser: process.env.CRM_ADMIN_USER || "admin",
  crmAdminPassword,
  // Shared secret configured as the Authorization header value in the RevenueCat webhook settings.
  revenueCatWebhookSecret: process.env.REVENUECAT_WEBHOOK_SECRET ?? "",
  // Only trust cf-connecting-ip / x-forwarded-for when running behind a trusted reverse proxy (e.g. Render / Railway / Cloudflare).
  trustProxy:
    process.env.TRUST_PROXY === "1" ||
    Boolean(
      process.env.RENDER ||
        process.env.RENDER_SERVICE_ID ||
        process.env.RAILWAY_ENVIRONMENT ||
        process.env.RAILWAY_PROJECT_ID
    ),
  stripeCoupon: process.env.STRIPE_COUPON ?? "MYskiOdE",
  stripePublishableKey:
    (process.env.STRIPE_PUBLISHABLE_KEY ?? "").trim() ||
    "pk_live_51UPMkj0Y0NLVZ2yqEhyw8TQdFT9YA86RzxfzhtyXtnpGzQ1cw2LnKJs7GzElp2RdtynJbK9sWhPBjFN7VUR9w0Wd00UtJ7gia9",
  stripeSecretKey: resolvedSecretKey,
  stripeWebhookSecret: resolveStripeWebhookSecret(),
  priceActivation: process.env.STRIPE_PRICE_ACTIVATION ?? "",
  priceMonthly: resolvePriceId(process.env.STRIPE_PRICE_MONTHLY, "price_1URdu10Y0NLVZ2yqqlOZlh4Y"),
  priceSixMonth: resolvePriceId(process.env.STRIPE_PRICE_SIX_MONTH, "price_1URdu20Y0NLVZ2yqSCbMxbzb"),
  priceAnnual: resolvePriceId(process.env.STRIPE_PRICE_ANNUAL, "price_1URdu20Y0NLVZ2yq4KMNHQdJ"),
  latestAppVersion: process.env.LATEST_APP_VERSION ?? "0.1.0",
  minAppVersion: process.env.MIN_APP_VERSION ?? "0.1.0",
  latestAndroidVersion: process.env.LATEST_ANDROID_VERSION ?? "1.0.0",
  minAndroidVersion: process.env.MIN_ANDROID_VERSION ?? "1.0.0",
  forceAppUpdate: process.env.FORCE_APP_UPDATE === "true",
  latestAppNotes: process.env.LATEST_APP_NOTES ?? "Bug fixes and new cleaning tools.",
  latestAppSignature: process.env.LATEST_APP_SIGNATURE ?? "",
  hibpApiKey: process.env.HIBP_API_KEY ?? "",
  trialDays: num(process.env.TRIAL_DAYS, 30),
  tokenTtlHours: num(process.env.TOKEN_TTL_HOURS, 72),
  maxDevicesPc: num(process.env.MAX_DEVICES_PC, 3),
  maxDevicesMobile: num(process.env.MAX_DEVICES_MOBILE, 2),
  devEndpoints:
    process.env.DEV_ENDPOINTS === "1" &&
    process.env.NODE_ENV !== "production" &&
    /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|test)(:|\/|$)/i.test(process.env.PUBLIC_URL ?? "http://localhost:8787"),
  pastDueGraceDays: 3,
  gaMeasurementId: process.env.GA_MEASUREMENT_ID || "G-CM9FPJV4C2",
  metaPixelId: process.env.META_PIXEL_ID ?? "",
  clarityProjectId: process.env.CLARITY_PROJECT_ID ?? "",
  // SEO Intelligence suite (CRM > SEO). Everything optional; audits, backlink checks and bot telemetry need no keys.
  seo: {
    siteUrl: process.env.SEO_SITE_URL || "https://sweeprcleaner.com",
    // e.g. "sc-domain:sweeprcleaner.com" or "https://sweeprcleaner.com/"
    gscSiteUrl: process.env.GSC_SITE_URL ?? "",
    // Service-account JSON: raw JSON, base64 of it, or a file path. Add the account's email as a user on the GSC property.
    gscServiceAccountJson: process.env.GSC_SERVICE_ACCOUNT_JSON ?? "",
    // Google Cloud API key with PageSpeed Insights + Chrome UX Report APIs enabled.
    googleApiKey: process.env.GOOGLE_API_KEY ?? "",
    // Free key from keywordseverywhere.com/account/openpagerank (domain authority 0-10).
    openPageRankApiKey: process.env.OPEN_PAGERANK_API_KEY ?? "",
    // DataForSEO v3 API credentials (0-100 DR, backlink index, competitor link gap, US search volume, KD%, CPC, ETV).
    dataForSeoLogin: (process.env.DATAFORSEO_LOGIN ?? "").trim(),
    dataForSeoPassword: (process.env.DATAFORSEO_PASSWORD ?? "").trim(),
    dataForSeoLocationCode: num(process.env.DATAFORSEO_LOCATION_CODE, 2840), // 2840 = United States, 2826 = United Kingdom
    dataForSeoLanguageCode: (process.env.DATAFORSEO_LANGUAGE_CODE || "en").trim(),
  },
};
