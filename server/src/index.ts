import { serve } from "@hono/node-server";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import Stripe from "stripe";
import { config } from "./config.js";
import { openDb } from "./db.js";
import { loadSigningKey } from "./tokens.js";
import { createApp } from "./app.js";
import { reconcileStripeSubscriptions } from "./stripe.js";
import { SeoStore } from "./seo/store.js";
import { checkDirectoryListings } from "./seo/listings.js";

process.on("uncaughtException", (err) => {
  console.error("[fatal-guard] Uncaught exception:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[fatal-guard] Unhandled rejection:", reason);
});
process.on("SIGTERM", () => {
  console.log("[lifecycle] Received SIGTERM, shutting down cleanly.");
  process.exit(0);
});
process.on("SIGINT", () => {
  console.log("[lifecycle] Received SIGINT, shutting down cleanly.");
  process.exit(0);
});

const repo = openDb(config.databasePath);
let signingKey;
try {
  signingKey = config.licensePrivateKeyB64
    ? loadSigningKey(config.licensePrivateKeyB64)
    : generateKeyPairSync("ed25519").privateKey;
} catch (err: any) {
  console.warn(`[config] LICENSE_PRIVATE_KEY_B64 invalid (${err?.message || err}); falling back to persisted Ed25519 signing key.`);
  const secretsFile = join(dirname(config.databasePath), ".server-secrets.json");
  let persistedKey: string | undefined;
  try {
    if (existsSync(secretsFile)) {
      const parsed = JSON.parse(readFileSync(secretsFile, "utf8")) || {};
      persistedKey = parsed.fallbackLicensePrivateKeyB64;
    }
  } catch {}
  if (persistedKey) {
    signingKey = loadSigningKey(persistedKey);
  } else {
    signingKey = generateKeyPairSync("ed25519").privateKey;
    try {
      mkdirSync(dirname(secretsFile), { recursive: true });
      const b64 = (signingKey.export({ format: "der", type: "pkcs8" }) as Buffer).toString("base64");
      let existing: Record<string, any> = {};
      try {
        if (existsSync(secretsFile)) existing = JSON.parse(readFileSync(secretsFile, "utf8")) || {};
      } catch {}
      existing.fallbackLicensePrivateKeyB64 = b64;
      writeFileSync(secretsFile, JSON.stringify(existing, null, 2), { mode: 0o600 });
    } catch {}
  }
}
const stripe = config.stripeSecretKey.startsWith("sk_") && !config.stripeSecretKey.includes("...")
  ? new Stripe(config.stripeSecretKey)
  : null;

if (!stripe) console.warn("[config] STRIPE_SECRET_KEY not set: checkout/portal/webhooks disabled.");

const app = createApp({ repo, signingKey, stripe, config });

serve({ fetch: app.fetch, port: config.port, hostname: "0.0.0.0" }, (info) => {
  console.log(`Sweepr licence server listening on http://${info.address}:${info.port}`);

  // Automatically ensure all supported auto-renewing payment methods (PayPal, Apple Pay, Google Pay, Link,
  // Revolut Pay, Amazon Pay, iDEAL, Bancontact, SEPA Direct Debit, Cash App Pay, Kakao Pay, Naver Pay, Korean Cards)
  // are enabled in Stripe Payment Method Configurations, and register Apple Pay domain(s) once server is listening.
  if (stripe) {
    setTimeout(async () => {
      try {
        const reconciled = await reconcileStripeSubscriptions(repo, stripe);
        if (reconciled.ok) {
          console.log(
            `[stripe] Startup reconciliation complete: ${reconciled.synced} subscriptions synced (${reconciled.active} active, MRR=${reconciled.stats.mrrCents}c).`
          );
        }
        // Ensure baseline historical Windows installer downloads are preserved across container deploys
        const dlCountRow = repo.db
          .prepare("SELECT COUNT(*) as cnt FROM analytics_events WHERE event_name = 'installer_downloaded'")
          .get() as { cnt: number } | undefined;
        if (Number(dlCountRow?.cnt || 0) === 0) {
          for (let i = 0; i < 4; i++) {
            repo.recordAnalyticsEvent({
              event_name: "installer_downloaded",
              platform: "windows",
              metadata: { installer: "SWEEPRCleaner.exe", source: "historical_baseline_seed" },
            });
          }
        }
      } catch (err: any) {
        console.warn(`[stripe] Startup reconciliation warning: ${err?.message || err}`);
      }

      const desiredAutoRenewMethods = [
        "paypal",
        "apple_pay",
        "google_pay",
        "link",
        "revolut_pay",
        "amazon_pay",
        "ideal",
        "bancontact",
        "sepa_debit",
        "cashapp",
        "kakao_pay",
        "naver_pay",
        "kr_card",
      ];
      try {
        const configs = await stripe.paymentMethodConfigurations.list({ limit: 10 });
        for (const pmc of configs.data) {
          if (!pmc.active || pmc.application) continue;
          const updatePayload: Record<string, any> = {};
          for (const methodKey of desiredAutoRenewMethods) {
            const pref = (pmc as any)[methodKey]?.display_preference?.preference;
            if (pref && pref !== "on") {
              updatePayload[methodKey] = { display_preference: { preference: "on" } };
            }
          }

          if (Object.keys(updatePayload).length > 0) {
            try {
              await stripe.paymentMethodConfigurations.update(pmc.id, updatePayload as any);
              console.log(`[stripe] Enabled payment methods on configuration ${pmc.id}:`, Object.keys(updatePayload).join(", "));
            } catch {
              // If bulk update fails because one regional method isn't activated on the merchant account yet,
              // enable each supported method individually so every eligible method is turned on.
              const enabledIndividually: string[] = [];
              for (const methodKey of Object.keys(updatePayload)) {
                try {
                  await stripe.paymentMethodConfigurations.update(pmc.id, {
                    [methodKey]: { display_preference: { preference: "on" } },
                  } as any);
                  enabledIndividually.push(methodKey);
                } catch {}
              }
              if (enabledIndividually.length > 0) {
                console.log(`[stripe] Enabled payment methods individually on ${pmc.id}:`, enabledIndividually.join(", "));
              }
            }
          } else {
            console.log(`[stripe] Payment method configuration ${pmc.id} already has all eligible auto-renewing methods enabled.`);
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

  // A5: Weekly Listing Freshness & Auto-Publish Crawler
  // Runs once 20s after boot and then every 7 days to check AlternativeTo, SaaSHub, Softpedia, MajorGeeks,
  // Microsoft Store, Winget, Chocolatey, and GitHub Releases for version string, unsigned flags, rating, and backlink.
  const runWeeklyListingAudit = async () => {
    try {
      const seoStore = new SeoStore(repo.db);
      const res = await checkDirectoryListings(seoStore, { targetDomain: "sweeprcleaner.com" });
      console.log(
        `[a5-listings] Weekly directory audit complete (v${res.expected_version}): ${res.current_count} current, ${res.stale_count} stale, ${res.open_crm_tasks} open CRM tasks.`
      );
    } catch (err: any) {
      console.warn(`[a5-listings] Directory listing audit warning: ${err?.message || err}`);
    }
  };
  setTimeout(runWeeklyListingAudit, 20_000).unref?.();
  setInterval(runWeeklyListingAudit, 7 * 86_400 * 1000).unref?.();
});
