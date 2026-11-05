import { openDb } from "../src/db.js";
import { SeoStore } from "../src/seo/store.js";
import { loadVerifiedGscSeedRows, computeIntentGapReport, executeIntentGapAutomation } from "../src/seo/intent-gap.js";

async function main() {
  const dbPath = process.env.DATABASE_PATH || "./data/sweepr.db";
  const repo = openDb(dbPath);
  const store = new SeoStore(repo.db);
  if (store.gscRowCount() === 0) {
    const rows = loadVerifiedGscSeedRows();
    store.upsertGscRows(rows);
  }
  const latestDate = store.gscLatestDate() ?? new Date().toISOString().slice(0, 10);
  const fromDate = new Date(new Date(`${latestDate}T00:00:00Z`).getTime() - 89 * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const report = computeIntentGapReport(store, {
    from: fromDate,
    to: latestDate,
    siteUrl: "https://sweeprcleaner.com",
  });

  console.log("=== SEARCH CONSOLE INTENT-GAP & CTR OPTIMIZER REPORT ===");
  console.log(`Window: ${report.window.from} to ${report.window.to}`);
  console.log(`Total Queries Analyzed: ${report.total_queries_analyzed}`);
  console.log(`Total Impressions: ${report.total_impressions}`);
  console.log(`Total Clicks: ${report.total_clicks}`);
  console.log(`Active Cooldown Slugs (${report.cooldown_policy.active_cooldown_slugs.length}):`, report.cooldown_policy.active_cooldown_slugs.join(", "));

  console.log("\n--- Inpages S1/S2 Intent Distribution Benchmark ---");
  for (const b of report.intent_distribution) {
    console.log(
      `- ${b.intent.toUpperCase()}: ${b.query_share_pct}% queries (Benchmark: ${b.inpages_benchmark_pct}%, Gap: ${b.gap_vs_benchmark_pct > 0 ? "+" : ""}${b.gap_vs_benchmark_pct}%), ${b.impressions} imps, ${b.clicks} clicks, CTR: ${(b.ctr * 100).toFixed(2)}%, Avg Pos: ${b.avg_position}`
    );
  }

  console.log("\n--- Striking-Distance CTR Rewrite Queue (Top 10 Pages) ---");
  for (const item of report.ctr_rewrite_queue.slice(0, 10)) {
    console.log(`* /${item.category}/${item.slug}:`);
    console.log(`  Pos: ${item.position} | Impr: ${item.impressions} | Clicks: ${item.clicks} | Actual CTR: ${(item.ctr * 100).toFixed(2)}% | Expected CTR: ${(item.expected_ctr * 100).toFixed(2)}%`);
    console.log(`  Top Query: "${item.primary_query}"`);
    console.log(`  Status: ${item.on_cooldown ? `ON 14-DAY COOLDOWN (${item.cooldown_days_remaining}d remaining)` : "ELIGIBLE FOR REWRITE"}`);
    console.log(`  Action: ${item.recommended_action}`);
  }

  console.log("\n--- Commercial Gap Queue (Competitor & Switcher Comparisons) ---");
  for (const c of report.commercial_gap_queue.slice(0, 6)) {
    console.log(`* "${c.query}" (Impr: ${c.impressions}, Pos: ${c.position}) -> ${c.ranking_url || "No dedicated page"}`);
    console.log(`  Action: ${c.recommended_action}`);
  }

  console.log("\n--- Transactional / High-Intent Paid Search Sniping Queue (Microsoft Ads cid=255115583) ---");
  for (const a of report.transactional_ad_queue.slice(0, 5)) {
    console.log(`* ${a.exact_match_keyword} | Max CPC: £${a.recommended_max_cpc_gbp} | Impr: ${a.gsc_impressions} | URL: ${a.smartscreen_safe_final_url}`);
  }

  // Execute sync
  const exec = executeIntentGapAutomation(store, {
    from: fromDate,
    to: latestDate,
    siteUrl: "https://sweeprcleaner.com",
    persistState: true,
  });
  console.log("\n=== EXECUTION SUMMARY ===");
  console.log(`Keywords Classified & Synced: ${exec.keywords_classified_and_synced}`);
  console.log(`Queued CTR Rewrite Slugs: ${exec.queued_ctr_rewrite_slugs.join(", ") || "None"}`);
  console.log(`90-Day Retirement Candidates: ${exec.retirement_candidates_90d_count}`);
  console.log(`Winners Promoted: ${exec.winners_promoted_count}`);
}

main().catch(console.error);
