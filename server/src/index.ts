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
import { auditInternalBrandFactConsistency, checkDirectoryListings } from "./seo/listings.js";
import {
  evaluateDownloadRecoverySessions,
  evaluateDunningAndWinbackLifecycle,
  evaluateHighIntentScanAndCheckoutAbandonment,
} from "./download-recovery.js";
import { runGiveawayUpgradeSweep } from "./giveaway.js";
import { runAnnualRenewalRecapSweep } from "./renewal-recap.js";
import { applyRoasReallocation } from "./roas.js";
import { getExperimentLiftMultipliers, getExperimentSummary } from "./experiments.js";
import { computeStateOfWindowsStorageReport, refreshAllTelemetryTruthCache } from "./seo/telemetry-truth.js";
import { scanBloatWatchSignals } from "./seo/bloat-watch.js";
import {
  executeIntentGapAutomation,
  loadVerifiedGscSeedRows,
  runGscInternalLinkBooster,
} from "./seo/intent-gap.js";
import { runKeywordDiscoveryPipeline } from "./seo/keywords.js";
import { harvestCompetitorOrganicPages, runUnderperformerAutoRefresh } from "./seo/competitor-intel.js";
import { syncStaticLlmsTxtFile } from "./seo/llms-index.js";
import { recordAutomationRunStatus } from "./crm.js";

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

  // 1. Every 5 minutes (+ T+15s boot): A3 Download-to-Install Recovery + A10 Scan/Checkout & Giveaway GOTD50 Sweep
  const runFiveMinuteConversionSweeps = async () => {
    const t0A3 = Date.now();
    try {
      const resA3 = await evaluateDownloadRecoverySessions(repo);
      recordAutomationRunStatus("A3_download_recovery", {
        status: "ok",
        durationMs: Date.now() - t0A3,
        summary: { ...resA3 },
      });
      if (resA3.newly_flagged_30m > 0 || resA3.emails_sent_2h > 0) {
        console.log(
          `[a3-recovery] Evaluated ${resA3.evaluated} pending downloads: ${resA3.newly_flagged_30m} flagged at T+30m, ${resA3.emails_sent_2h} transactional help emails sent at T+2h.`
        );
      }
    } catch (err: any) {
      recordAutomationRunStatus("A3_download_recovery", {
        status: "error",
        durationMs: Date.now() - t0A3,
        error: String(err?.message || err),
      });
      console.warn(`[a3-recovery] Sweep warning: ${err?.message || err}`);
    }

    const t0A10 = Date.now();
    try {
      const ab = await evaluateHighIntentScanAndCheckoutAbandonment(repo);
      const gw = await runGiveawayUpgradeSweep(repo);
      recordAutomationRunStatus("A10_conversion_recovery", {
        status: "ok",
        durationMs: Date.now() - t0A10,
        summary: { abandonment: ab, giveaway: gw },
      });
      if (ab.recovery_emails_sent > 0 || gw.nurture_3d_sent > 0 || gw.expiry_14d_sent > 0 || gw.expiry_3d_sent > 0) {
        console.log(
          `[a10-conversion] Recovery emails=${ab.recovery_emails_sent}, Giveaway T+3d=${gw.nurture_3d_sent}, T-14d=${gw.expiry_14d_sent}, T-3d=${gw.expiry_3d_sent}.`
        );
      }
    } catch (err: any) {
      recordAutomationRunStatus("A10_conversion_recovery", {
        status: "error",
        durationMs: Date.now() - t0A10,
        error: String(err?.message || err),
      });
      console.warn(`[a10-conversion] Sweep warning: ${err?.message || err}`);
    }

    const t0A13 = Date.now();
    try {
      const dun = await evaluateDunningAndWinbackLifecycle(repo);
      recordAutomationRunStatus("A13_dunning_winback", {
        status: "ok",
        durationMs: Date.now() - t0A13,
        summary: { ...dun },
      });
    } catch (err: any) {
      recordAutomationRunStatus("A13_dunning_winback", {
        status: "error",
        durationMs: Date.now() - t0A13,
        error: String(err?.message || err),
      });
    }
  };
  setTimeout(runFiveMinuteConversionSweeps, 15_000).unref?.();
  setInterval(runFiveMinuteConversionSweeps, 5 * 60_000).unref?.();

  // 2. Every 6 hours (+ T+30s boot): A1 Telemetry Truth & Storage Benchmark + A4 Bloat Watch + A12 GEO Index + A15 Competitor Freshness
  const runSixHourSeoIntelligence = async () => {
    const seoStore = new SeoStore(repo.db);
    const t0A1 = Date.now();
    try {
      const refreshed = refreshAllTelemetryTruthCache(seoStore);
      const bench = computeStateOfWindowsStorageReport(seoStore);
      recordAutomationRunStatus("A1_telemetry_truth", {
        status: "ok",
        durationMs: Date.now() - t0A1,
        summary: {
          updated_slugs: refreshed.length,
          total_guides: bench.total_canonical_guides,
          median_per_pc_gb: bench.median_reclaimable_per_pc_gb,
          p90_per_pc_gb: bench.p90_reclaimable_per_pc_gb,
        },
      });
    } catch (err: any) {
      recordAutomationRunStatus("A1_telemetry_truth", {
        status: "error",
        durationMs: Date.now() - t0A1,
        error: String(err?.message || err),
      });
    }

    const t0A4 = Date.now();
    try {
      const bw = await scanBloatWatchSignals(seoStore, { fetch_live_feeds: true, min_score: 7 });
      recordAutomationRunStatus("A4_bloat_watch", {
        status: "ok",
        durationMs: Date.now() - t0A4,
        summary: {
          evaluated: bw.evaluated.length,
          drafts_created: bw.drafts_created,
          discovered_keywords_added: (bw as any).discovered_keywords_added ?? 0,
        },
      });
    } catch (err: any) {
      recordAutomationRunStatus("A4_bloat_watch", {
        status: "error",
        durationMs: Date.now() - t0A4,
        error: String(err?.message || err),
      });
      console.warn(`[a4-bloat-watch] Radar scan warning: ${err?.message || err}`);
    }

    const t0A12 = Date.now();
    try {
      const llmsSync = syncStaticLlmsTxtFile(seoStore);
      recordAutomationRunStatus("A12_geo_llms_index", {
        status: "ok",
        durationMs: Date.now() - t0A12,
        summary: { ...llmsSync },
      });
    } catch (err: any) {
      recordAutomationRunStatus("A12_geo_llms_index", {
        status: "error",
        durationMs: Date.now() - t0A12,
        error: String(err?.message || err),
      });
    }

    const t0A15 = Date.now();
    try {
      const compAudit = auditInternalBrandFactConsistency({ autoFix: true });
      recordAutomationRunStatus("A15_competitor_freshness", {
        status: "ok",
        durationMs: Date.now() - t0A15,
        summary: {
          checked_count: compAudit.checked_count,
          drift_detected_count: compAudit.drift_detected_count,
          auto_fixed_count: compAudit.auto_fixed_count,
        },
      });
    } catch (err: any) {
      recordAutomationRunStatus("A15_competitor_freshness", {
        status: "error",
        durationMs: Date.now() - t0A15,
        error: String(err?.message || err),
      });
    }
  };
  setTimeout(runSixHourSeoIntelligence, 30_000).unref?.();
  setInterval(runSixHourSeoIntelligence, 6 * 3600 * 1000).unref?.();

  // 3. Every 12 hours (+ T+45s boot): A2 Intent-Gap -> A16 Competitor Intel -> A7 Keyword Discovery -> A17 Forecast Ledger -> A18 Self-Healing Refresh -> A8 ROAS -> A9 Experiments -> A6 Renewal Recap -> Stripe Reconcile
  const runTwelveHourLifecycleAndSeo = async () => {
    const seoStore = new SeoStore(repo.db);
    const t0A2 = Date.now();
    try {
      const nowMs = Date.now();
      const toIso = new Date(nowMs).toISOString().slice(0, 10);
      const fromIso = new Date(nowMs - 28 * 86_400_000).toISOString().slice(0, 10);
      const ig = executeIntentGapAutomation(seoStore, {
        from: fromIso,
        to: toIso,
        siteUrl: config.publicUrl || "https://sweeprcleaner.com",
        persistState: true,
        syncSeed: true,
      });
      recordAutomationRunStatus("A2_intent_gap_ctr", {
        status: "ok",
        durationMs: Date.now() - t0A2,
        summary: {
          queued_ctr_rewrite_slugs: ig.queued_ctr_rewrite_slugs.length,
          retirement_candidates_90d_count: ig.retirement_candidates_90d_count,
          winners_promoted_count: ig.winners_promoted_count,
        },
      });
    } catch (err: any) {
      recordAutomationRunStatus("A2_intent_gap_ctr", {
        status: "error",
        durationMs: Date.now() - t0A2,
        error: String(err?.message || err),
      });
    }

    const t0A16 = Date.now();
    try {
      const compRes = await harvestCompetitorOrganicPages(seoStore, undefined, { crawl_sitemaps: false });
      recordAutomationRunStatus("A16_competitor_organic_intel", {
        status: "ok",
        durationMs: Date.now() - t0A16,
        summary: {
          total_tracked_pages: compRes.total_tracked_pages,
          upserted_count: compRes.upserted_count,
          uncaptured_gaps: compRes.gap_status_breakdown.uncaptured,
        },
      });
    } catch (err: any) {
      recordAutomationRunStatus("A16_competitor_organic_intel", {
        status: "error",
        durationMs: Date.now() - t0A16,
        error: String(err?.message || err),
      });
    }

    const t0Kw = Date.now();
    try {
      const kw = await runKeywordDiscoveryPipeline(seoStore, undefined, {
        fetch_autocomplete: false,
        enrich_dfs: false,
        persistReport: true,
      });
      recordAutomationRunStatus("A7_keyword_discovery", {
        status: "ok",
        durationMs: Date.now() - t0Kw,
        summary: {
          total_scored: kw.summary.total_evaluated,
          net_new: kw.new_pseo_candidates.length,
          strike_zone: kw.ctr_enrichment_candidates.length,
        },
      });
    } catch (err: any) {
      recordAutomationRunStatus("A7_keyword_discovery", {
        status: "error",
        durationMs: Date.now() - t0Kw,
        error: String(err?.message || err),
      });
    }

    const t0A17 = Date.now();
    try {
      seoStore.hydrateStrategyLedgerFromJsonFile();
      const gscSeed = loadVerifiedGscSeedRows();
      const liftMultipliers = getExperimentLiftMultipliers(repo);
      const cal = seoStore.reconcileStrategyLedgerActualsAndCalibrate({
        seedGscRows: gscSeed,
        experimentLiftMultipliers: liftMultipliers,
        recalibrate: true,
      });
      recordAutomationRunStatus("A17_strategy_forecast_ledger", {
        status: "ok",
        durationMs: Date.now() - t0A17,
        summary: {
          total_entries: cal.total_entries,
          evaluated_count: cal.evaluated_count,
          outperforming_count: cal.outperforming_count,
          optimized_pages_count: cal.pre_vs_post_summary.optimized_pages_count,
          avg_clicks_lift_pct: cal.pre_vs_post_summary.avg_clicks_lift_pct,
        },
      });
    } catch (err: any) {
      recordAutomationRunStatus("A17_strategy_forecast_ledger", {
        status: "error",
        durationMs: Date.now() - t0A17,
        error: String(err?.message || err),
      });
    }

    const t0A18 = Date.now();
    try {
      const refreshRes = await runUnderperformerAutoRefresh(seoStore, { persist_disk: false });
      recordAutomationRunStatus("A18_underperformer_auto_refresh", {
        status: "ok",
        durationMs: Date.now() - t0A18,
        summary: {
          evaluated_candidates: refreshRes.evaluated_candidates,
          refreshed_count: refreshRes.refreshed_count,
          queued_for_indexnow: refreshRes.queued_for_indexnow,
        },
      });
    } catch (err: any) {
      recordAutomationRunStatus("A18_underperformer_auto_refresh", {
        status: "error",
        durationMs: Date.now() - t0A18,
        error: String(err?.message || err),
      });
    }

    const t0A19 = Date.now();
    try {
      const boostRes = runGscInternalLinkBooster(seoStore);
      recordAutomationRunStatus("A19_gsc_internal_link_booster", {
        status: "ok",
        durationMs: Date.now() - t0A19,
        summary: {
          boosted_count: boostRes.boosted_count,
          boosted_slugs: boostRes.boosted_slugs,
          hubs_updated: boostRes.hubs_updated,
        },
      });
    } catch (err: any) {
      recordAutomationRunStatus("A19_gsc_internal_link_booster", {
        status: "error",
        durationMs: Date.now() - t0A19,
        error: String(err?.message || err),
      });
    }

    const t0A8 = Date.now();
    try {
      const roasRes = applyRoasReallocation(repo, seoStore, { auto_adjust_bids: true });
      recordAutomationRunStatus("A8_roas_reallocation", {
        status: "ok",
        durationMs: Date.now() - t0A8,
        summary: {
          paid_roas: roasRes.report.totals.paid_roas,
          reinvestment_unlock_gbp: roasRes.report.totals.reinvestment_unlock_gbp,
          bids_adjusted: roasRes.bids_adjusted,
          losers_paused: roasRes.losers_paused,
        },
      });
    } catch (err: any) {
      recordAutomationRunStatus("A8_roas_reallocation", {
        status: "error",
        durationMs: Date.now() - t0A8,
        error: String(err?.message || err),
      });
    }

    const t0A9 = Date.now();
    try {
      const expSummary = getExperimentSummary(repo);
      recordAutomationRunStatus("A9_ab_experiments", {
        status: "ok",
        durationMs: Date.now() - t0A9,
        summary: {
          experiments: expSummary.experiments.length,
          auto_promoted: expSummary.experiments.filter((e) => e.auto_promoted_variant).length,
        },
      });
    } catch (err: any) {
      recordAutomationRunStatus("A9_ab_experiments", {
        status: "error",
        durationMs: Date.now() - t0A9,
        error: String(err?.message || err),
      });
    }

    const t0A6 = Date.now();
    try {
      const recapRes = await runAnnualRenewalRecapSweep(repo);
      recordAutomationRunStatus("A6_renewal_recap", {
        status: "ok",
        durationMs: Date.now() - t0A6,
        summary: { ...recapRes },
      });
    } catch (err: any) {
      recordAutomationRunStatus("A6_renewal_recap", {
        status: "error",
        durationMs: Date.now() - t0A6,
        error: String(err?.message || err),
      });
    }

    if (stripe) {
      const t0Stripe = Date.now();
      try {
        const rec = await reconcileStripeSubscriptions(repo, stripe);
        recordAutomationRunStatus("stripe_reconcile", {
          status: "ok",
          durationMs: Date.now() - t0Stripe,
          summary: { synced: rec.synced, active: rec.active },
        });
      } catch (err: any) {
        recordAutomationRunStatus("stripe_reconcile", {
          status: "error",
          durationMs: Date.now() - t0Stripe,
          error: String(err?.message || err),
        });
      }
    }
  };
  setTimeout(runTwelveHourLifecycleAndSeo, 45_000).unref?.();
  setInterval(runTwelveHourLifecycleAndSeo, 12 * 3600 * 1000).unref?.();

  // 4. Every 7 days (+ T+20s boot): A5 Weekly Listing Freshness & Auto-Publish Crawler
  const runWeeklyListingAudit = async () => {
    const t0A5 = Date.now();
    try {
      const seoStore = new SeoStore(repo.db);
      const res = await checkDirectoryListings(seoStore, { targetDomain: "sweeprcleaner.com" });
      recordAutomationRunStatus("A5_directory_listings", {
        status: "ok",
        durationMs: Date.now() - t0A5,
        summary: {
          current_count: res.current_count,
          stale_count: res.stale_count,
          open_crm_tasks: res.open_crm_tasks,
        },
      });
      console.log(
        `[a5-listings] Weekly directory audit complete (v${res.expected_version}): ${res.current_count} current, ${res.stale_count} stale, ${res.open_crm_tasks} open CRM tasks.`
      );
    } catch (err: any) {
      recordAutomationRunStatus("A5_directory_listings", {
        status: "error",
        durationMs: Date.now() - t0A5,
        error: String(err?.message || err),
      });
      console.warn(`[a5-listings] Directory listing audit warning: ${err?.message || err}`);
    }
  };
  setTimeout(runWeeklyListingAudit, 20_000).unref?.();
  setInterval(runWeeklyListingAudit, 7 * 86_400 * 1000).unref?.();
});
