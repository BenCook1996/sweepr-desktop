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

  // Automatically ensure PayPal, Apple Pay, Google Pay & Link are enabled in Stripe Payment Method Configurations,
  // and register Apple Pay domain(s) in Stripe once server is listening.
  if (stripe) {
    setTimeout(async () => {
      try {
        const configs = await stripe.paymentMethodConfigurations.list({ limit: 10 });
        for (const pmc of configs.data) {
          if (!pmc.active || pmc.application) continue;
          const paypalPref = (pmc as any).paypal?.display_preference?.preference;
          const applePayPref = (pmc as any).apple_pay?.display_preference?.preference;
          const googlePayPref = (pmc as any).google_pay?.display_preference?.preference;
          const linkPref = (pmc as any).link?.display_preference?.preference;

          const updatePayload: Record<string, any> = {};
          if (paypalPref && paypalPref !== "on") {
            updatePayload.paypal = { display_preference: { preference: "on" } };
          }
          if (applePayPref && applePayPref !== "on") {
            updatePayload.apple_pay = { display_preference: { preference: "on" } };
          }
          if (googlePayPref && googlePayPref !== "on") {
            updatePayload.google_pay = { display_preference: { preference: "on" } };
          }
          if (linkPref && linkPref !== "on") {
            updatePayload.link = { display_preference: { preference: "on" } };
          }

          if (Object.keys(updatePayload).length > 0) {
            try {
              await stripe.paymentMethodConfigurations.update(pmc.id, updatePayload as any);
              console.log(`[stripe] Enabled payment methods on configuration ${pmc.id}:`, Object.keys(updatePayload).join(", "));
            } catch (pmErr: any) {
              // If one method fails (e.g. Link), still try enabling PayPal specifically
              if (updatePayload.paypal) {
                try {
                  await stripe.paymentMethodConfigurations.update(pmc.id, {
                    paypal: { display_preference: { preference: "on" } },
                  } as any);
                  console.log(`[stripe] Enabled PayPal on configuration ${pmc.id}`);
                } catch (ppErr: any) {
                  console.warn(`[stripe] Could not enable PayPal on configuration ${pmc.id}: ${ppErr?.message || ppErr}`);
                }
              } else {
                console.warn(`[stripe] Payment method config update skipped for ${pmc.id}: ${pmErr?.message || pmErr}`);
              }
            }
          } else {
            console.log(`[stripe] Payment method configuration ${pmc.id} already has PayPal=${paypalPref ?? "default"} enabled.`);
          }
        }
      } catch (err: any) {
        console.warn(`[stripe] Could not inspect payment method configurations: ${err?.message || err}`);
      }

      if (config.stripeSecretKey.startsWith("sk_live_")) {
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
      }
    }, 3000);
  }
});
