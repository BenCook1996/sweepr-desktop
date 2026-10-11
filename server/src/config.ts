import { existsSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");

const num = (v: string | undefined, d: number) => (v && !Number.isNaN(Number(v)) ? Number(v) : d);

export const config = {
  port: num(process.env.PORT, 8787),
  publicUrl: process.env.PUBLIC_URL ?? "http://localhost:8787",
  databasePath: process.env.DATABASE_PATH ?? "./data/sweepr.db",
  licensePrivateKeyB64: process.env.LICENSE_PRIVATE_KEY_B64 ?? "",
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? "",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
  priceActivation: process.env.STRIPE_PRICE_ACTIVATION ?? "",
  priceMonthly: process.env.STRIPE_PRICE_MONTHLY ?? "",
  trialDays: num(process.env.TRIAL_DAYS, 30),
  tokenTtlHours: num(process.env.TOKEN_TTL_HOURS, 72),
  maxDevicesPc: num(process.env.MAX_DEVICES_PC, 3),
  maxDevicesMobile: num(process.env.MAX_DEVICES_MOBILE, 2),
  devEndpoints: process.env.DEV_ENDPOINTS === "1" && process.env.NODE_ENV !== "production",
  pastDueGraceDays: 3,
};
