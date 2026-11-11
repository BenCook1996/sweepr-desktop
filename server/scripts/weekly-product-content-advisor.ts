#!/usr/bin/env node
/**
 * SWEEPR Cleaner — Weekly Content-to-Product & UI Mockup Advisor (`A20`)
 *
 * Strictly Read-Only Advisory Automation:
 *  1. Logs all web content produced or enriched across `clean-items.json`, `daily-50-seo-pages.mjs`,
 *     `A18` Self-Healing Refresher, `A19` Strike-Zone Booster, and `A17` GSC Strategy Ledger.
 *  2. Inspects the Desktop (`app/src-tauri/src/rules.rs`, `app/src/components/Cleaner.svelte`) and
 *     Mobile (`DashboardScreen.kt`, `DashboardView.swift`) codebases in read-only mode.
 *  3. Computes the Web-to-App Capability Gap Matrix and ranks Product Integration Proposals (`P1`–`P6`)
 *     with copy-paste Rust, Svelte, Jetpack Compose, and SwiftUI implementation blueprints.
 *  4. Writes:
 *     - `server/src/data/weekly-product-advisor-report.json` (JSON report + 52-week rolling history)
 *     - `WEEKLY_PRODUCT_CONTENT_ADVISORY.md` (Executive brief & engineering specifications)
 *     - `server/public/crm/weekly-product-mockups.html` (Interactive Desktop/Android/iOS UI Mockup Studio)
 *
 * Usage:
 *   npx --prefix server tsx server/scripts/weekly-product-content-advisor.ts
 */

import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { SeoStore } from "../src/seo/store.js";
import { loadVerifiedGscSeedRows } from "../src/seo/intent-gap.js";
import {
  DEFAULT_WEEKLY_PRODUCT_ADVISORY_MD_PATH,
  DEFAULT_WEEKLY_PRODUCT_ADVISOR_JSON_PATH,
  DEFAULT_WEEKLY_PRODUCT_MOCKUPS_HTML_PATH,
  generateWeeklyContentToProductReport,
} from "../src/seo/product-advisor.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, "..");

async function main() {
  const dbPath = process.env.SWEEPR_DB_PATH || path.join(SERVER_ROOT, "data", "sweepr.db");
  let store: SeoStore | null = null;
  try {
    const db = new DatabaseSync(dbPath);
    store = new SeoStore(db);
    store.hydrateStrategyLedgerFromJsonFile();
    const gscSeed = loadVerifiedGscSeedRows();
    store.reconcileStrategyLedgerActualsAndCalibrate({
      seedGscRows: gscSeed,
      recalibrate: true,
    });
  } catch {
    // Fallback to clean-items.json + daily-seo-pages-state.json if local SQLite DB isn't initialized
  }

  const report = generateWeeklyContentToProductReport(store, {
    persist: true,
    reportJsonPath: DEFAULT_WEEKLY_PRODUCT_ADVISOR_JSON_PATH,
    advisoryMdPath: DEFAULT_WEEKLY_PRODUCT_ADVISORY_MD_PATH,
    mockupsHtmlPath: DEFAULT_WEEKLY_PRODUCT_MOCKUPS_HTML_PATH,
  });

  console.log("================================================================================");
  console.log(`SWEEPR Weekly Content-to-Product & UI Mockup Advisor (A20) — ${report.week_id}`);
  console.log("================================================================================");
  console.log(`Read-Only Mode Verified     : ${report.read_only_mode} (Zero app/ or mobile/ files modified)`);
  console.log(`Total Catalog Guides        : ${report.summary.total_catalog_pages}`);
  console.log(`Produced / Enriched Cycle   : ${report.summary.weekly_produced_or_enriched_count}`);
  console.log(`GSC Active Guides Cross-Ref : ${report.summary.gsc_active_pages_evaluated}`);
  console.log(
    `Desktop Rule Coverage       : ${report.summary.desktop_any_rule_coverage_pct}% (${report.summary.desktop_first_class_coverage_pct}% dedicated first-class)`
  );
  console.log(`Uncaptured/Bundled GB Pool  : ${report.summary.uncaptured_or_bundled_midpoint_gb_pool} GB`);
  console.log(`Proposals Ranked            : ${report.summary.proposals_count}`);
  console.log("");
  console.log("Top Product Integration Proposals:");
  for (const p of report.proposals) {
    console.log(
      `  #${p.rank} [${p.product_impact_score}/100] ${p.title} (${p.target_platforms.join(", ")}) -> Est. ${p.estimated_reclaimable_gb_range}`
    );
  }
  console.log("");
  console.log(`JSON Report Written   : ${DEFAULT_WEEKLY_PRODUCT_ADVISOR_JSON_PATH}`);
  console.log(`Markdown Brief Written: ${DEFAULT_WEEKLY_PRODUCT_ADVISORY_MD_PATH}`);
  console.log(`Mockup Studio Written : ${DEFAULT_WEEKLY_PRODUCT_MOCKUPS_HTML_PATH}`);
}

main().catch((err) => {
  console.error("[A20 Weekly Product Advisor] Fatal error:", err);
  process.exit(1);
});
