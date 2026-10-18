import { existsSync } from "node:fs";
import { createDecipheriv, createHash, randomBytes } from "node:crypto";

if (existsSync(".env")) process.loadEnvFile(".env");

const num = (v: string | undefined, d: number) => (v && !Number.isNaN(Number(v)) ? Number(v) : d);

const licensePrivateKeyB64 = process.env.LICENSE_PRIVATE_KEY_B64 ?? "";
const crmAdminPassword = process.env.CRM_ADMIN_PASSWORD ?? "";

const ENCRYPTED_LIVE_SK =
  "470d39e60a24f3fffe19aec3:ba391bb1c9a2cd9161824d5d93d86df1:bd75ddc8b938da7b5524ee13eb700fdcc95cee8c16b99810ca1a5591e5c3edb3d155dc86ea788f6f5c9016aa6ac93121bde579b374226b9d2be451c73dba1430a9030dd43acf39ce1e49ab27072131a648f1b6ead5ac4996446e1b4dfd36987eb6378ece98caabb2ddba50";

const ENCRYPTED_LIVE_WHSEC =
  "3d486c5d6548beda3c2cae05:377fd91eff5aca68c778481036adc802:692cac42717a966f754dc1befe79bbdbea910aee31df75012ba8f008eb61111c05405d8957bc";

function decryptWithAdminKey(payload: string): string {
  if (!crmAdminPassword) return "";
  try {
    const [ivHex, tagHex, encHex] = payload.split(":");
    const key = createHash("sha256").update(crmAdminPassword).digest();
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return Buffer.concat([decipher.update(Buffer.from(encHex, "hex")), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}

function resolveStripeSecretKey(): string {
  const envKey = (process.env.STRIPE_SECRET_KEY ?? "").trim();
  if (envKey.startsWith("sk_live_")) return envKey;
  const dec = decryptWithAdminKey(ENCRYPTED_LIVE_SK);
  if (dec.startsWith("sk_live_")) return dec;
  return envKey;
}

const resolvedSecretKey = resolveStripeSecretKey();
const isLiveStripe = resolvedSecretKey.startsWith("sk_live_");

function resolveStripeWebhookSecret(): string {
  const envWh = (process.env.STRIPE_WEBHOOK_SECRET ?? "").trim();
  if (isLiveStripe) {
    const dec = decryptWithAdminKey(ENCRYPTED_LIVE_WHSEC);
    if (dec.startsWith("whsec_")) return dec;
  }
  return envWh;
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
};
