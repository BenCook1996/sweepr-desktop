import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { SeoStore } from "./store.js";

export type SearchIntentType = "informational" | "navigational" | "commercial" | "transactional";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DAILY_STATE_PATH = resolve(__dirname, "../data/daily-seo-pages-state.json");
const GSC_SEED_PATH = resolve(__dirname, "../data/gsc-seed.json");

/** Inpages S1/S2 empirical search intent distribution benchmark (% of queries). */
export const INPAGES_INTENT_BENCHMARK: Record<SearchIntentType, number> = {
  informational: 52.65,
  navigational: 32.15,
  commercial: 14.51,
  transactional: 0.69,
};

const NAVIGATIONAL_RE = /\b(sweepr|sweeprcleaner|sweepr\s+cleaner|sweepr\s+pc)\b/i;
const COMMERCIAL_RE =
  /\b(vs|versus|alternative|alternatives|best|compare|comparison|review|reviews|bloatware|worth\s+it|switch\s+from|replace|better\s+than)\b/i;
const INFORMATIONAL_QUESTION_RE =
  /\b(what\s+is|why\s+is|where\s+is|can\s+i|is\s+it\s+safe|safe\s+to\s+delete|how\s+to|location|meaning|folder\s+size)\b/i;
const TRANSACTIONAL_ACTION_RE =
  /\b(clean|cleaner|cleanup|clear|delete|remove|remover|free\s+up|purge|reset|wipe|uninstall|tool|utility|download|fix)\b/i;

/**
 * Deterministically classifies a Search Console query into one of the 4 Inpages S1/S2 intent buckets.
 */
export function classifyQueryIntent(query: string, rankingUrl?: string | null): SearchIntentType {
  const q = (query || "").trim().toLowerCase();
  const u = (rankingUrl || "").toLowerCase();
  if (NAVIGATIONAL_RE.test(q)) return "navigational";
  if (COMMERCIAL_RE.test(q) || u.includes("/vs/") || u.includes("/alternatives/")) return "commercial";
  if (INFORMATIONAL_QUESTION_RE.test(q)) return "informational";
  if (TRANSACTIONAL_ACTION_RE.test(q)) return "transactional";
  return "informational";
}

function expectedCtrForPosition(pos: number | null): number {
  if (!pos || pos <= 0) return 0;
  const p = Math.round(pos);
  const table: Record<number, number> = {
    1: 0.28,
    2: 0.15,
    3: 0.11,
    4: 0.08,
    5: 0.06,
    6: 0.05,
    7: 0.04,
    8: 0.03,
    9: 0.025,
    10: 0.02,
  };
  if (p <= 10) return table[p] ?? 0.02;
  if (p <= 20) return 0.01;
  return 0.003;
}

function extractCleanSlug(urlOrPath: string | null): { category: string; slug: string; path: string } | null {
  if (!urlOrPath) return null;
  const m = String(urlOrPath).match(/(\/clean\/(app|folder)\/([^/?#]+))/i);
  if (!m) return null;
  return { path: m[1], category: m[2].toLowerCase(), slug: m[3].toLowerCase() };
}

interface DailySeoStateFile {
  lastRunAt?: string;
  ctrCooldownDays?: number;
  ctrOptimizedAt?: Record<string, string>;
  lastCtrEnrichedSlugs?: string[];
  nextStrikeZoneBatch?: string[];
  [k: string]: unknown;
}

function readDailyState(): DailySeoStateFile {
  if (!existsSync(DAILY_STATE_PATH)) return { ctrCooldownDays: 14, ctrOptimizedAt: {}, nextStrikeZoneBatch: [] };
  try {
    return JSON.parse(readFileSync(DAILY_STATE_PATH, "utf8")) as DailySeoStateFile;
  } catch {
    return { ctrCooldownDays: 14, ctrOptimizedAt: {}, nextStrikeZoneBatch: [] };
  }
}

export function loadVerifiedGscSeedRows(): Array<{
  date: string;
  query: string;
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}> {
  if (!existsSync(GSC_SEED_PATH)) return [];
  try {
    const raw = JSON.parse(readFileSync(GSC_SEED_PATH, "utf8")) as {
      rows?: Array<{
        date: string;
        query: string;
        page: string;
        clicks: number;
        impressions: number;
        ctr?: number;
        position: number;
      }>;
    };
    return (raw.rows ?? []).map((r) => ({
      date: String(r.date),
      query: String(r.query).trim().toLowerCase(),
      page: String(r.page).trim(),
      clicks: Number(r.clicks || 0),
      impressions: Number(r.impressions || 0),
      ctr: r.ctr !== undefined ? Number(r.ctr) : r.impressions > 0 ? Number(r.clicks || 0) / Number(r.impressions) : 0,
      position: Number(r.position || 0),
    }));
  } catch {
    return [];
  }
}

export function computeIntentGapReport(
  store: SeoStore,
  opts: { from: string; to: string; siteUrl: string }
) {
  const topQueries = store.gscTopQueries(opts.from, opts.to, 500);
  const dailyState = readDailyState();
  const cooldownDays = Number(dailyState.ctrCooldownDays || 14);
  const ctrOptimizedAt = dailyState.ctrOptimizedAt || {};
  const nowMs = Date.now();

  const buckets: Record<
    SearchIntentType,
    {
      intent: SearchIntentType;
      queries: number;
      impressions: number;
      clicks: number;
      weighted_pos_sum: number;
    }
  > = {
    informational: { intent: "informational", queries: 0, impressions: 0, clicks: 0, weighted_pos_sum: 0 },
    navigational: { intent: "navigational", queries: 0, impressions: 0, clicks: 0, weighted_pos_sum: 0 },
    commercial: { intent: "commercial", queries: 0, impressions: 0, clicks: 0, weighted_pos_sum: 0 },
    transactional: { intent: "transactional", queries: 0, impressions: 0, clicks: 0, weighted_pos_sum: 0 },
  };

  const classifiedQueries = topQueries.map((q) => {
    const stats = store.gscQueryStats(q.query, opts.from, opts.to);
    const intent = classifyQueryIntent(q.query, stats.ranking_url);
    const ctr = q.impressions > 0 ? q.clicks / q.impressions : 0;
    const b = buckets[intent];
    b.queries += 1;
    b.impressions += q.impressions;
    b.clicks += q.clicks;
    b.weighted_pos_sum += q.position * q.impressions;

    return {
      query: q.query,
      intent,
      clicks: q.clicks,
      impressions: q.impressions,
      ctr: Math.round(ctr * 10000) / 10000,
      position: Math.round(q.position * 10) / 10,
      ranking_url: stats.ranking_url,
      competing_urls: stats.competing_urls,
    };
  });

  const totalQueries = Math.max(1, classifiedQueries.length);
  const totalImpressions = Math.max(
    1,
    classifiedQueries.reduce((s, q) => s + q.impressions, 0)
  );

  const intent_distribution = (["informational", "navigational", "commercial", "transactional"] as const).map(
    (intent) => {
      const b = buckets[intent];
      const querySharePct = Math.round((b.queries / totalQueries) * 10000) / 100;
      const impressionSharePct = Math.round((b.impressions / totalImpressions) * 10000) / 100;
      const benchmarkPct = INPAGES_INTENT_BENCHMARK[intent];
      return {
        intent,
        queries: b.queries,
        query_share_pct: querySharePct,
        inpages_benchmark_pct: benchmarkPct,
        gap_vs_benchmark_pct: Math.round((querySharePct - benchmarkPct) * 100) / 100,
        impressions: b.impressions,
        impression_share_pct: impressionSharePct,
        clicks: b.clicks,
        ctr: b.impressions > 0 ? Math.round((b.clicks / b.impressions) * 10000) / 10000 : 0,
        avg_position: b.impressions > 0 ? Math.round((b.weighted_pos_sum / b.impressions) * 10) / 10 : null,
      };
    }
  );

  // 1. CTR Rewrite Queue (Striking-Distance Informational & Transactional /clean/* pages with 14-day cooldown guard)
  const bySlug = new Map<
    string,
    {
      slug: string;
      category: string;
      path: string;
      url: string;
      clicks: number;
      impressions: number;
      weighted_pos: number;
      top_queries: Array<{ query: string; impressions: number; position: number; intent: SearchIntentType }>;
    }
  >();

  for (const q of classifiedQueries) {
    const parsed = extractCleanSlug(q.ranking_url);
    if (!parsed) continue;
    const existing = bySlug.get(parsed.slug) ?? {
      slug: parsed.slug,
      category: parsed.category,
      path: parsed.path,
      url: q.ranking_url!,
      clicks: 0,
      impressions: 0,
      weighted_pos: 0,
      top_queries: [],
    };
    existing.clicks += q.clicks;
    existing.impressions += q.impressions;
    existing.weighted_pos += q.position * q.impressions;
    existing.top_queries.push({
      query: q.query,
      impressions: q.impressions,
      position: q.position,
      intent: q.intent,
    });
    bySlug.set(parsed.slug, existing);
  }

  const ctr_rewrite_queue = [...bySlug.values()]
    .map((item) => {
      const avgPos = item.impressions > 0 ? item.weighted_pos / item.impressions : 99;
      const ctr = item.impressions > 0 ? item.clicks / item.impressions : 0;
      const expectedCtr = expectedCtrForPosition(avgPos);
      const lastOptIso = ctrOptimizedAt[item.slug] || null;
      let onCooldown = false;
      let cooldownDaysRemaining = 0;
      if (lastOptIso) {
        const elapsedDays = (nowMs - new Date(lastOptIso).getTime()) / 86400000;
        if (elapsedDays < cooldownDays) {
          onCooldown = true;
          cooldownDaysRemaining = Math.max(1, Math.ceil(cooldownDays - elapsedDays));
        }
      }
      const potentialClicksAtCurrentPos = Math.max(0, Math.round(item.impressions * expectedCtr - item.clicks));
      const potentialClicksAtPos1 = Math.max(0, Math.round(item.impressions * 0.28 - item.clicks));
      const topQuery = item.top_queries.sort((a, b) => b.impressions - a.impressions)[0]?.query ?? item.slug;

      return {
        slug: item.slug,
        path: item.path,
        url: item.url,
        clicks: item.clicks,
        impressions: item.impressions,
        ctr: Math.round(ctr * 10000) / 10000,
        expected_ctr: expectedCtr,
        position: Math.round(avgPos * 10) / 10,
        primary_query: topQuery,
        top_queries: item.top_queries.slice(0, 4),
        on_cooldown: onCooldown,
        last_optimized_at: lastOptIso,
        cooldown_days_remaining: cooldownDaysRemaining,
        eligible_for_rewrite: !onCooldown && avgPos <= 20 && ctr < expectedCtr,
        potential_clicks_at_current_pos: potentialClicksAtCurrentPos,
        potential_clicks_at_pos1: potentialClicksAtPos1,
        recommended_action: onCooldown
          ? `Hold title/meta edits for ${cooldownDaysRemaining}d (14-day GSC CTR measurement window active since ${lastOptIso})`
          : `Rewrite <title> & FAQ schema around "${topQuery}" with explicit safety verdict + GB savings`,
      };
    })
    .filter((i) => i.position <= 22 && i.impressions >= 4)
    .sort((a, b) => {
      if (a.eligible_for_rewrite !== b.eligible_for_rewrite) return a.eligible_for_rewrite ? -1 : 1;
      return b.impressions - a.impressions;
    });

  // 2. Commercial Switcher & Comparison Gap Queue (/vs/* and /alternatives/*)
  const commercial_gap_queue = classifiedQueries
    .filter((q) => q.intent === "commercial" || /\b(cleaner|ccleaner|bleachbit|opera\s*gx)\b/i.test(q.query))
    .map((q) => {
      const hasDedicatedComparison = Boolean(
        q.ranking_url && (q.ranking_url.includes("/vs/") || q.ranking_url.includes("/alternatives/"))
      );
      return {
        query: q.query,
        intent: q.intent,
        impressions: q.impressions,
        clicks: q.clicks,
        position: q.position,
        ranking_url: q.ranking_url,
        has_dedicated_comparison_page: hasDedicatedComparison,
        recommended_action: hasDedicatedComparison
          ? q.position > 10
            ? `Add internal comparison table links from top /clean/* guides to ${q.ranking_url} to push from Pos ${q.position} to Page 1`
            : `Optimize comparison hero CTA on ${q.ranking_url} for direct /order Annual checkout`
          : `Add commercial comparison callout & internal link to /vs/ccleaner on ${q.ranking_url || "/clean"}`,
      };
    })
    .sort((a, b) => b.impressions - a.impressions);

  // 3. Transactional & High-Intent Paid Search Sniping Queue (Microsoft Ads cid=255115583)
  const transactional_ad_queue = classifiedQueries
    .filter(
      (q) =>
        (q.intent === "transactional" || q.intent === "commercial" || q.position <= 12) &&
        q.impressions >= 4 &&
        q.intent !== "navigational"
    )
    .map((q) => {
      const recommendedCpcGbp = q.intent === "commercial" ? 0.65 : q.intent === "transactional" ? 0.45 : 0.35;
      return {
        exact_match_keyword: `[${q.query}]`,
        phrase_match_keyword: `"${q.query}"`,
        query: q.query,
        intent: q.intent,
        gsc_impressions: q.impressions,
        gsc_clicks: q.clicks,
        gsc_position: q.position,
        organic_ranking_url: q.ranking_url,
        microsoft_ads_customer_id: "255115583",
        recommended_max_cpc_gbp: recommendedCpcGbp,
        smartscreen_safe_final_url:
          q.intent === "commercial"
            ? `${opts.siteUrl.replace(/\/$/, "")}/vs/ccleaner?utm_source=bing&utm_medium=cpc&utm_campaign=gsc_intent_gap`
            : `${q.ranking_url || `${opts.siteUrl.replace(/\/$/, "")}/pricing`}?utm_source=bing&utm_medium=cpc&utm_campaign=gsc_intent_gap`,
      };
    })
    .sort((a, b) => b.gsc_impressions - a.gsc_impressions)
    .slice(0, 25);

  return {
    window: { from: opts.from, to: opts.to },
    total_queries_analyzed: classifiedQueries.length,
    total_impressions: classifiedQueries.reduce((s, q) => s + q.impressions, 0),
    total_clicks: classifiedQueries.reduce((s, q) => s + q.clicks, 0),
    cooldown_policy: {
      cooldown_days: cooldownDays,
      active_cooldown_slugs: Object.keys(ctrOptimizedAt),
    },
    intent_distribution,
    ctr_rewrite_queue,
    commercial_gap_queue,
    transactional_ad_queue,
    queries: classifiedQueries,
  };
}

export function executeIntentGapAutomation(
  store: SeoStore,
  opts: { from: string; to: string; siteUrl: string; persistState?: boolean }
) {
  const report = computeIntentGapReport(store, opts);

  // 1. Sync classified search_intent and target_path back into seo_keywords
  let keywordsUpdated = 0;
  for (const q of report.queries) {
    let targetPath: string | null = null;
    if (q.ranking_url) {
      try {
        targetPath = new URL(q.ranking_url).pathname;
      } catch {
        targetPath = q.ranking_url.startsWith("/") ? q.ranking_url : null;
      }
    }
    const cluster =
      q.intent === "commercial"
        ? "competitor"
        : q.intent === "transactional"
          ? "transactional"
          : q.intent === "navigational"
            ? "brand"
            : "pseo-intent";
    store.addKeyword(q.query, cluster, targetPath);
    store.updateKeywordDfs(q.query, {
      search_intent: q.intent,
      serp_position: Math.round(q.position),
      serp_url: q.ranking_url,
    });
    keywordsUpdated += 1;
  }

  // 2. Queue top eligible CTR rewrite slugs into nextStrikeZoneBatch
  const eligibleSlugs = report.ctr_rewrite_queue
    .filter((item) => item.eligible_for_rewrite)
    .slice(0, 4)
    .map((item) => item.slug);

  if (opts.persistState !== false && eligibleSlugs.length > 0 && existsSync(DAILY_STATE_PATH)) {
    try {
      const state = readDailyState();
      state.nextStrikeZoneBatch = eligibleSlugs;
      writeFileSync(DAILY_STATE_PATH, JSON.stringify(state, null, 2) + "\n", "utf8");
    } catch {
      /* ignore write error on read-only fs */
    }
  }

  const summary = {
    executed_at: new Date().toISOString(),
    window: report.window,
    keywords_classified_and_synced: keywordsUpdated,
    queued_ctr_rewrite_slugs: eligibleSlugs,
    commercial_gaps_identified: report.commercial_gap_queue.length,
    transactional_ad_candidates_ready: report.transactional_ad_queue.length,
    intent_distribution: report.intent_distribution,
  };
  store.setSetting("intent_gap_last_run", summary);

  return {
    ok: true,
    ...summary,
    report,
  };
}
