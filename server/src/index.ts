import { serve } from "@hono/node-server";
import { generateKeyPairSync } from "node:crypto";
import Stripe from "stripe";
import { config } from "./config.js";
import { openDb } from "./db.js";
import { loadSigningKey } from "./tokens.js";
import { createApp } from "./app.js";

process.on("uncaughtException", (err) => {
  console.error("[fatal-guard] Uncaught exception:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[fatal-guard] Unhandled rejection:", reason);
});

const repo = openDb(config.databasePath);
let signingKey;
try {
  signingKey = config.licensePrivateKeyB64
    ? loadSigningKey(config.licensePrivateKeyB64)
    : generateKeyPairSync("ed25519").privateKey;
} catch (err: any) {
  console.warn(`[config] LICENSE_PRIVATE_KEY_B64 invalid (${err?.message || err}); falling back to ephemeral Ed25519 signing key.`);
  signingKey = generateKeyPairSync("ed25519").privateKey;
}
const stripe = config.stripeSecretKey.startsWith("sk_") && !config.stripeSecretKey.includes("...")
  ? new Stripe(config.stripeSecretKey)
  : null;

if (!stripe) console.warn("[config] STRIPE_SECRET_KEY not set: checkout/portal/webhooks disabled.");

const app = createApp({ repo, signingKey, stripe, config });

serve({ fetch: app.fetch, port: config.port, hostname: "0.0.0.0" }, (info) => {
  console.log(`Sweepr licence server listening on http://${info.address}:${info.port}`);

  // Automatically register Apple Pay domain(s) in Stripe once server is listening
  if (stripe && config.stripeSecretKey.startsWith("sk_live_")) {
    setTimeout(async () => {
      const domains = new Set<string>(["sweeprcleaner.com", "www.sweeprcleaner.com"]);
      try {
        const host = new URL(config.publicUrl).hostname;
        if (host && host !== "localhost" && !/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
          domains.add(host);
        }
      } catch {}

      try {
        const existing = await stripe.applePayDomains.list({ limit: 100 });
        const registered = new Set(existing.data.map((d) => d.domain_name.toLowerCase()));
        for (const domain of domains) {
          if (!registered.has(domain.toLowerCase())) {
            try {
              await stripe.applePayDomains.create({ domain_name: domain });
              console.log(`[stripe] Registered Apple Pay domain: ${domain}`);
            } catch (err: any) {
              console.warn(`[stripe] Apple Pay domain registration skipped for ${domain}: ${err?.message || err}`);
            }
          }
        }
      } catch (err: any) {
        console.warn(`[stripe] Could not list Apple Pay domains: ${err?.message || err}`);
      }
    }, 3000);
  }
});
