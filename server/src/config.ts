import { existsSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";

if (existsSync(".env")) process.loadEnvFile(".env");

const num = (v: string | undefined, d: number) => (v && !Number.isNaN(Number(v)) ? Number(v) : d);

const licensePrivateKeyB64 = process.env.LICENSE_PRIVATE_KEY_B64 ?? "";

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
  crmAdminPassword: process.env.CRM_ADMIN_PASSWORD ?? "",
  // Shared secret configured as the Authorization header value in the RevenueCat webhook settings.
  revenueCatWebhookSecret: process.env.REVENUECAT_WEBHOOK_SECRET ?? "",
  // Only trust cf-connecting-ip / x-forwarded-for when running behind a trusted reverse proxy (e.g. Railway / Cloudflare).
  trustProxy: process.env.TRUST_PROXY === "1" || Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID),
  stripeCoupon: process.env.STRIPE_COUPON ?? "MYskiOdE",
  stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? "",
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? "",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
  priceActivation: process.env.STRIPE_PRICE_ACTIVATION ?? "",
  priceMonthly: process.env.STRIPE_PRICE_MONTHLY ?? "",
  priceAnnual: process.env.STRIPE_PRICE_ANNUAL ?? "",
  latestAppVersion: process.env.LATEST_APP_VERSION ?? "0.1.0",
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
  gaMeasurementId: process.env.GA_MEASUREMENT_ID ?? "",
  metaPixelId: process.env.META_PIXEL_ID ?? "",
  clarityProjectId: process.env.CLARITY_PROJECT_ID ?? "",
};
