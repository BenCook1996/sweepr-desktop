import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { runSiteAudit, AUDIT_USER_AGENT, type PathFetcher } from "./audit.js";
import { verifyBacklinks, isPublicHttpUrl } from "./backlinks.js";
import { AI_BOTS } from "./bots.js";
import {
  DEFAULT_DFS_SPEND_CAP_USD,
  fetchDfsAccountStatus,
  syncDfsBacklinks,
  syncDfsCompetitorLinkGap,
  syncDfsDomainOverview,
  syncDfsKeywords,
  type FetchLike,
} from "./dataforseo.js";
import {
  loadOAuthRefreshCredential,
  loadServiceAccount,
  providerStatus,
  refreshOpenPageRank,
  runCrux,
  runPageSpeed,
  syncSearchConsole,
  type SeoProviderConfig,
} from "./google.js";
import {
  approveIntentGapRecommendation,
  computeIntentGapReport,
  executeIntentGapAutomation,
  getApprovedIntentGapAdsExport,
  loadVerifiedGscSeedRows,
} from "./intent-gap.js";
import {
  BLOAT_WATCH_FEEDS,
  getBloatWatchPost,
  listBloatWatchPosts,
  publishBloatWatchPost,
  scanBloatWatchSignals,
  updateBloatWatchMeasurements,
} from "./bloat-watch.js";
import {
  checkDirectoryListings,
  getDirectorySubmissionPack,
  listDirectoryListings,
  listListingCrmTasks,
  readCurrentReleaseVersion,
  upsertDirectoryListing,
} from "./listings.js";
import {
  ingestScanCompletedTelemetry,
  refreshAllTelemetryTruthCache,
  TELEMETRY_TRUTH_MIN_SAMPLES,
} from "./telemetry-truth.js";
import {
  publishDiscoveredCleanItem,
  runKeywordDiscoveryPipeline,
  WINDOWS_ECOSYSTEM_OPPORTUNITY_REGISTRY,
} from "./keywords.js";
import type { SeoStore } from "./store.js";

export interface SeoRouterDeps {
  store: SeoStore;
  providers: SeoProviderConfig;
  /** In-process fetcher for auditing the app itself without network access. */
  localFetcher: PathFetcher;
  /** Paths that must always be audited (pSEO routes etc.). */
  seedPaths: string[];
  /** Default keywords to seed on first use: [keyword, cluster, targetPath]. */
  defaultKeywords: Array<[string, string, string | null]>;
  /** Optional custom fetch implementation for DataForSEO (used in unit tests). */
  dfsFetcher?: FetchLike;
}

/**
 * Industry-average organic CTR by position (desktop+mobile blend, no SERP features).
 * Used ONLY for the clearly-labelled "traffic potential" estimate; actual clicks always come from GSC.
 */
const CTR_CURVE = [0, 0.28, 0.15, 0.11, 0.08, 0.065, 0.05, 0.04, 0.032, 0.027, 0.023];
export const ctrForPosition = (pos: number | null) => {
  if (pos === null || !Number.isFinite(pos) || pos < 1) return 0;
  const p = Math.round(pos);
  if (p <= 10) return CTR_CURVE[p];
  if (p <= 20) return 0.01;
  if (p <= 50) return 0.003;
  return 0.001;
};

const DEFAULT_COMPETITORS = ["ccleaner.com", "bleachbit.org", "wisecleaner.com", "glarysoft.com"];

interface Job {
  id: string;
  type: string;
  status: "running" | "done" | "error";
  progress: number;
  total: number | null;
  message: string | null;
  result: unknown;
  error: string | null;
  started_at: number;
  finished_at: number | null;
}

const addDays = (iso: string, n: number) => new Date(Date.parse(iso + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);

export function createSeoRouter(deps: SeoRouterDeps) {
  const { store, providers } = deps;
  const dfsFetch = deps.dfsFetcher ?? fetch;
  const router = new Hono();
  const siteHost = new URL(providers.siteUrl).hostname.replace(/^www\./, "");
  const jobs = new Map<string, Job>();

  if (store.listKeywords().length === 0 && !store.getSetting("keywords_seeded", false)) {
    store.db.exec("BEGIN");
    try {
      for (const [k, c, p] of deps.defaultKeywords) store.addKeyword(k, c, p);
      store.setSetting("keywords_seeded", true);
      store.db.exec("COMMIT");
    } catch (e) {
      store.db.exec("ROLLBACK");
      throw e;
    }
  }

  if (Boolean(providers.gscSiteUrl) && store.gscRowCount() === 0 && !store.getSetting("gsc_seed_applied", false)) {
    const seedRows = loadVerifiedGscSeedRows();
    if (seedRows.length > 0) {
      store.upsertGscRows(seedRows);
      store.setSetting("gsc_seed_applied", true);
      const latest = store.gscLatestDate();
      if (latest) {
        executeIntentGapAutomation(store, {
          from: addDays(latest, -27),
          to: latest,
          siteUrl: providers.siteUrl,
          persistState: false,
        });
      }
    }
  }

  const startJob = (type: string, run: (job: Job) => Promise<unknown>): Job | { conflict: Job } => {
    for (const j of jobs.values()) if (j.type === type && j.status === "running") return { conflict: j };
    const job: Job = { id: randomUUID(), type, status: "running", progress: 0, total: null, message: null, result: null, error: null, started_at: Date.now(), finished_at: null };
    jobs.set(job.id, job);
    run(job)
      .then((r) => {
        job.status = "done";
        job.result = r;
      })
      .catch((e) => {
        job.status = "error";
        job.error = (e as Error).message;
      })
      .finally(() => {
        job.finished_at = Date.now();
        // Keep the 30 most recent jobs.
        const all = [...jobs.values()].sort((a, b) => b.started_at - a.started_at);
        for (const old of all.slice(30)) jobs.delete(old.id);
      });
    return job;
  };
  const jobResponse = (c: any, j: Job | { conflict: Job }) =>
    "conflict" in j ? c.json({ error: "job_already_running", job: j.conflict }, 409) : c.json({ job: j }, 202);

  const gscWindow = () => {
    const latest = store.gscLatestDate();
    if (!latest) return null;
    return { to: latest, from: addDays(latest, -27), prevTo: addDays(latest, -28), prevFrom: addDays(latest, -55), seriesFrom: addDays(latest, -89) };
  };

  const keywordMetrics = () => {
    const w = gscWindow();
    return store.listKeywords().map((k) => {
      const monthly = k.monthly_searches_json ? JSON.parse(k.monthly_searches_json) : null;
      const svPotential = k.search_volume ? Math.round(k.search_volume * CTR_CURVE[1]) : null;
      if (!w) {
        return {
          ...k,
          monthly_searches: monthly,
          monthly_searches_json: undefined,
          position: k.serp_position ?? null,
          position_source: k.serp_position !== null && k.serp_position !== undefined ? ("dfs_serp" as const) : null,
          previous_position: null,
          delta: null,
          clicks: 0,
          impressions: 0,
          ctr: 0,
          ranking_url: k.serp_url ?? null,
          competing_urls: 0,
          potential_clicks_at_1: svPotential,
          series: [],
        };
      }
      const cur = store.gscQueryStats(k.keyword, w.from, w.to);
      const prev = store.gscQueryStats(k.keyword, w.prevFrom, w.prevTo);
      const delta = cur.position !== null && prev.position !== null ? prev.position - cur.position : null; // positive = improved
      const pos = cur.position ?? k.serp_position ?? null;
      const posSource = cur.position !== null ? ("gsc" as const) : k.serp_position !== null ? ("dfs_serp" as const) : null;
      return {
        ...k,
        monthly_searches: monthly,
        monthly_searches_json: undefined,
        position: pos,
        position_source: posSource,
        previous_position: prev.position,
        delta,
        clicks: cur.clicks,
        impressions: cur.impressions,
        ctr: cur.impressions ? cur.clicks / cur.impressions : 0,
        ranking_url: cur.ranking_url ?? k.serp_url ?? null,
        competing_urls: cur.competing_urls,
        potential_clicks_at_1: cur.impressions ? Math.round(cur.impressions * CTR_CURVE[1]) : svPotential,
        series: store.gscQuerySeries(k.keyword, w.seriesFrom, w.to),
      };
    });
  };

  // ---------------- Overview ----------------
  router.get("/overview", (c) => {
    const status = providerStatus(providers, store);
    const competitors = store.getSetting<string[]>("competitors", DEFAULT_COMPETITORS);
    const metrics = store.domainMetrics([siteHost, ...competitors]);
    const own = metrics.find((m) => m.domain === siteHost) ?? null;

    const w = gscWindow();
    const kws = keywordMetrics();
    const ranked = kws.filter((k) => k.position !== null);
    const withSv = kws.filter((k) => k.search_volume !== null && k.search_volume !== undefined);
    const withKd = kws.filter((k) => k.kd !== null && k.kd !== undefined);
    const buckets = { top3: 0, top10: 0, top20: 0, top100: 0 };
    for (const k of ranked) {
      const p = k.position as number;
      if (p <= 3) buckets.top3++;
      else if (p <= 10) buckets.top10++;
      else if (p <= 20) buckets.top20++;
      else buckets.top100++;
    }
    const traffic = w
      ? {
          window: { from: w.from, to: w.to },
          current: store.gscTotals(w.from, w.to),
          previous: store.gscTotals(w.prevFrom, w.prevTo),
          series: store.gscDailySeries(w.seriesFrom, w.to),
        }
      : null;

    const run = store.latestAuditRun();
    const bots = store.botSummary(7);
    const aiHits = bots.by_bot.filter((b) => AI_BOTS.has(b.bot)).reduce((s, b) => s + b.hits, 0);
    const searchHits = bots.by_bot.filter((b) => !AI_BOTS.has(b.bot)).reduce((s, b) => s + b.hits, 0);
    const dfsCache = store.getSetting<Record<string, unknown> | null>("dfs_account_cache", null);

    return c.json({
      site: providers.siteUrl,
      providers: status,
      gsc: {
        ...status.gsc,
        intent_gap_last_run: store.getSetting<Record<string, unknown> | null>("intent_gap_last_run", null),
      },
      dfs: {
        configured: status.dataforseo.configured,
        login: status.dataforseo.login,
        location_code: status.dataforseo.location_code,
        balance_usd: (dfsCache?.balance_usd as number | null) ?? null,
        spend_logged_usd: store.dfsTotalSpend(),
        spend_cap_usd: store.getSetting<number>("dfs_spend_cap_usd", DEFAULT_DFS_SPEND_CAP_USD),
        link_gap_count: store.listLinkGap(200).length,
      },
      authority: {
        source: own?.dfs_rank != null ? "dataforseo_and_opr" : own?.opr_decimal != null ? "open_pagerank" : null,
        own,
        competitors: competitors.map(
          (d) =>
            metrics.find((m) => m.domain === d) ?? {
              domain: d,
              opr_decimal: null,
              opr_integer: null,
              opr_rank: null,
              fetched_at: null,
              dfs_rank: null,
              dfs_backlinks: null,
              dfs_referring_domains: null,
              dfs_organic_keywords: null,
              dfs_organic_etv: null,
              dfs_traffic_cost_usd: null,
            }
        ),
        note: "DataForSEO Domain Rank (0-100) is scaled identically to Ahrefs DR using DataForSEO's backlink index. Open PageRank (0-10) is computed from Common Crawl.",
      },
      backlinks: {
        ...store.backlinkSummary(),
        dfs_index: own
          ? {
              dr_100: own.dfs_rank,
              backlinks: own.dfs_backlinks,
              dofollow_backlinks: own.dfs_dofollow_backlinks,
              referring_domains: own.dfs_referring_domains,
              dofollow_rd: own.dfs_dofollow_rd,
              spam_score: own.dfs_spam_score,
              updated_at: own.dfs_updated_at,
            }
          : null,
      },
      keywords: {
        tracked: kws.length,
        ranked: ranked.length,
        avg_position: ranked.length ? ranked.reduce((s, k) => s + (k.position as number), 0) / ranked.length : null,
        distribution: buckets,
        improved: ranked.filter((k) => (k.delta ?? 0) >= 1).length,
        declined: ranked.filter((k) => (k.delta ?? 0) <= -1).length,
        total_search_volume: withSv.length ? withSv.reduce((s, k) => s + (k.search_volume ?? 0), 0) : null,
        avg_kd: withKd.length ? Math.round(withKd.reduce((s, k) => s + (k.kd ?? 0), 0) / withKd.length) : null,
        with_volume_count: withSv.length,
      },
      traffic,
      audit: run
        ? { run_id: run.id, finished_at: run.finished_at, source: run.source, pages: run.pages, health_score: run.health_score, errors: run.errors, warnings: run.warnings, notices: run.notices }
        : null,
      cwv: store.listCwv().slice(0, 6),
      bots: { days: 7, ai_hits: aiHits, search_hits: searchHits, by_bot: bots.by_bot },
    });
  });

  router.get("/providers", (c) => c.json(providerStatus(providers, store)));

  // ---------------- Jobs ----------------
  router.get("/jobs", (c) => c.json({ jobs: [...jobs.values()].sort((a, b) => b.started_at - a.started_at) }));
  router.get("/jobs/:id", (c) => {
    const j = jobs.get(c.req.param("id"));
    return j ? c.json({ job: j }) : c.json({ error: "not_found" }, 404);
  });

  // ---------------- Keywords & rankings ----------------
  router.get("/keywords", (c) =>
    c.json({
      keywords: keywordMetrics(),
      gsc_window: gscWindow(),
      gsc_rows: store.gscRowCount(),
      dfs_configured: providerStatus(providers, store).dataforseo.configured,
    })
  );
  router.post("/keywords", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const list: string[] = Array.isArray(body.keywords) ? body.keywords : String(body.keyword ?? "").split(/\r?\n|,/);
    const added = list.map((k) => store.addKeyword(String(k), String(body.cluster ?? "general"), body.target_path ? String(body.target_path) : null)).filter(Boolean);
    if (!added.length) return c.json({ error: "keyword_required" }, 400);
    return c.json({ added: added.length });
  });
  router.delete("/keywords/:id", (c) => (store.deleteKeyword(Number(c.req.param("id"))) ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404)));
  router.post("/keywords/import-gsc", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const w = gscWindow();
    if (!w) return c.json({ error: "no_gsc_data", message: "Sync Search Console first." }, 400);
    const limit = Math.min(Math.max(Number(body.limit) || 25, 1), 200);
    const top = store.gscTopQueries(w.from, w.to, limit);
    let added = 0;
    for (const q of top) if (store.addKeyword(q.query, "gsc-discovered", null)) added++;
    return c.json({ considered: top.length, added });
  });

  // Automated Keyword Research & Low-Competition Opportunity Engine endpoints
  router.get("/keywords/opportunities", async (c) => {
    const minScore = Number(c.req.query("min_score") ?? 70);
    const intent = c.req.query("intent") || undefined;
    const lowCompOnly = c.req.query("low_comp_only") !== "false";
    const action = c.req.query("action") || undefined;
    const limit = Number(c.req.query("limit") ?? 50);

    let stored = store.listKeywordOpportunities({ minScore, intent, lowCompOnly, action, limit });
    const report = await runKeywordDiscoveryPipeline(store, providers, {
      fetch_autocomplete: false,
      enrich_dfs: false,
      limit,
      persistReport: false,
    });
    if (stored.length === 0) {
      stored = store.listKeywordOpportunities({ minScore, intent, lowCompOnly, action, limit });
    }
    return c.json({
      ok: true,
      summary: report.summary,
      opportunities: stored,
      new_pseo_candidates: report.new_pseo_candidates,
      ctr_enrichment_candidates: report.ctr_enrichment_candidates,
      transactional_tool_candidates: report.transactional_tool_candidates,
      ad_exact_match_candidates: report.ad_exact_match_candidates,
      ecosystem_registry_total: WINDOWS_ECOSYSTEM_OPPORTUNITY_REGISTRY.length,
    });
  });

  router.post("/keywords/discover", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const report = await runKeywordDiscoveryPipeline(store, providers, {
      seeds: Array.isArray(body.seeds) ? body.seeds.map(String) : undefined,
      fetch_autocomplete: Boolean(body.fetch_autocomplete),
      enrich_dfs: Boolean(body.enrich_dfs),
      limit: Number(body.limit) || 60,
      fetchImpl: dfsFetch,
      persistReport: body.persist_report !== false,
    });
    return c.json(report);
  });

  router.post("/keywords/opportunities/publish", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const slug = String(body.slug || "").trim().toLowerCase();
    if (!slug) return c.json({ ok: false, error: "slug_required" }, 400);
    const result = publishDiscoveredCleanItem(store, slug, {
      dryRun: body.dry_run !== false,
    });
    if (!result.ok) return c.json(result, 400);
    return c.json(result);
  });

  router.get("/gsc/config", (c) =>
    c.json({
      ...providerStatus(providers, store).gsc,
      intent_gap_last_run: store.getSetting<Record<string, unknown> | null>("intent_gap_last_run", null),
    })
  );

  const handleGscConfigUpdate = async (c: any) => {
    const body = await c.req.json().catch(() => ({}));
    if (typeof body.site_url === "string" && body.site_url.trim()) {
      store.setSetting("gsc_site_url", body.site_url.trim());
    }
    if (body.service_account_json !== undefined) {
      const raw =
        typeof body.service_account_json === "string"
          ? body.service_account_json.trim()
          : JSON.stringify(body.service_account_json);
      if (raw) {
        const sa = loadServiceAccount(raw);
        const oauth = sa ? null : loadOAuthRefreshCredential(raw);
        if (!sa && !oauth) {
          return c.json(
            {
              error: "invalid_gsc_credential",
              message:
                "Provide a valid Google Service Account JSON (client_email + private_key) or OAuth2 Authorized User JSON (client_id + client_secret + refresh_token).",
            },
            400
          );
        }
        store.setSetting("gsc_service_account_json", raw);
      } else {
        store.setSetting("gsc_service_account_json", "");
      }
    }
    return c.json({ ok: true, gsc: providerStatus(providers, store).gsc });
  };
  router.put("/gsc/config", handleGscConfigUpdate);
  router.post("/gsc/config", handleGscConfigUpdate);

  router.post("/gsc/ingest", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const rawRows: Array<Record<string, unknown>> = body.use_seed
      ? loadVerifiedGscSeedRows()
      : Array.isArray(body.rows)
        ? body.rows
        : [];
    if (!rawRows.length) {
      return c.json({ error: "rows_required", message: "Pass rows: [...] or use_seed: true" }, 400);
    }
    const normalized = rawRows
      .map((r) => {
        const clicks = Math.max(0, Number(r.clicks ?? 0));
        const impressions = Math.max(0, Number(r.impressions ?? 0));
        const ctr = r.ctr !== undefined ? Number(r.ctr) : impressions > 0 ? clicks / impressions : 0;
        const position = Number(r.position ?? 0);
        return {
          date: String(r.date ?? new Date().toISOString().slice(0, 10)).slice(0, 10),
          query: String(r.query ?? "").trim().toLowerCase(),
          page: String(r.page ?? "").trim(),
          clicks,
          impressions,
          ctr,
          position,
        };
      })
      .filter((r) => r.date && r.query && r.page && r.position > 0);

    if (!normalized.length) {
      return c.json({ error: "no_valid_rows" }, 400);
    }
    if (typeof body.site_url === "string" && body.site_url.trim()) {
      store.setSetting("gsc_site_url", body.site_url.trim());
    } else if (!store.getSetting("gsc_site_url", "") && !providers.gscSiteUrl) {
      store.setSetting("gsc_site_url", "sc-domain:sweeprcleaner.com");
    }

    store.upsertGscRows(normalized);

    let intentGapSummary: unknown = null;
    if (body.run_intent_gap !== false) {
      const w = gscWindow();
      if (w) {
        const execRes = executeIntentGapAutomation(store, {
          from: w.from,
          to: w.to,
          siteUrl: providers.siteUrl,
          persistState: Boolean(body.persist_state),
        });
        intentGapSummary = {
          keywords_classified_and_synced: execRes.keywords_classified_and_synced,
          queued_ctr_rewrite_slugs: execRes.queued_ctr_rewrite_slugs,
          intent_distribution: execRes.intent_distribution,
        };
      }
    }

    return c.json({
      ok: true,
      ingested: normalized.length,
      total_rows: store.gscRowCount(),
      latest_date: store.gscLatestDate(),
      gsc: providerStatus(providers, store).gsc,
      intent_gap: intentGapSummary,
    });
  });

  router.get("/gsc/insights", (c) => {
    const w = gscWindow();
    if (!w) return c.json({ window: null, queries: [], pages: [], cannibalisation: [], opportunities: [] });
    const queries = store.gscTopQueries(w.from, w.to, 200);
    // "Striking distance": ranking 4-20 with real impressions - the cheapest wins.
    const opportunities = queries
      .filter((q) => q.position >= 4 && q.position <= 20 && q.impressions >= 10)
      .map((q) => ({ ...q, potential_clicks_top3: Math.round(q.impressions * CTR_CURVE[3]), extra_clicks: Math.max(0, Math.round(q.impressions * CTR_CURVE[3]) - q.clicks) }))
      .sort((a, b) => b.extra_clicks - a.extra_clicks)
      .slice(0, 25);
    return c.json({ window: w, queries: queries.slice(0, 100), pages: store.gscTopPages(w.from, w.to, 50), cannibalisation: store.gscCannibalisation(w.from, w.to), opportunities });
  });

  router.get("/gsc/intent-gap", (c) => {
    const w = gscWindow();
    if (!w) {
      return c.json({
        configured: providerStatus(providers, store).gsc.configured,
        window: null,
        intent_distribution: [],
        ctr_rewrite_queue: [],
        commercial_gap_queue: [],
        transactional_ad_queue: [],
        last_run: store.getSetting("intent_gap_last_run", null),
      });
    }
    const report = computeIntentGapReport(store, {
      from: w.from,
      to: w.to,
      siteUrl: providers.siteUrl,
    });
    return c.json({
      configured: providerStatus(providers, store).gsc.configured,
      ...report,
      last_run: store.getSetting("intent_gap_last_run", null),
    });
  });

  router.post("/gsc/intent-gap/execute", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    let w = gscWindow();
    if (!w && body.use_seed !== false) {
      const seedRows = loadVerifiedGscSeedRows();
      if (seedRows.length > 0) {
        store.upsertGscRows(seedRows);
        w = gscWindow();
      }
    }
    if (!w) {
      return c.json({ error: "no_gsc_data", message: "Ingest or sync Search Console data first." }, 400);
    }
    const result = executeIntentGapAutomation(store, {
      from: w.from,
      to: w.to,
      siteUrl: providers.siteUrl,
      persistState: body.persist_state !== false,
    });
    return c.json(result);
  });

  router.post("/gsc/intent-gap/approve", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const res = approveIntentGapRecommendation(store, {
      action_type: body.action_type,
      decision: body.decision,
      slug: body.slug,
      title: body.title,
      meta_description: body.meta_description,
      query: body.query,
      target_url: body.target_url,
      max_cpc_gbp: body.max_cpc_gbp !== undefined ? Number(body.max_cpc_gbp) : undefined,
    });
    if (!res.ok) return c.json(res, 400);
    return c.json(res);
  });

  router.get("/gsc/intent-gap/ads-export", (c) => {
    const exportData = getApprovedIntentGapAdsExport(store);
    if (c.req.query("format") === "csv") {
      c.header("Content-Type", "text/csv; charset=utf-8");
      c.header("Content-Disposition", 'attachment; filename="sweepr-microsoft-ads-intent-gap.csv"');
      return c.body(exportData.csv);
    }
    return c.json(exportData);
  });

  router.post("/gsc/sync", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (!providerStatus(providers, store).gsc.configured) return c.json({ error: "gsc_not_configured", providers: providerStatus(providers, store) }, 400);
    const days = Math.min(Math.max(Number(body.days) || 90, 7), 480);
    return jobResponse(
      c,
      startJob("gsc_sync", async (job) => {
        job.message = `Fetching last ${days} days`;
        return syncSearchConsole(store, providers, days, (rows) => {
          job.progress = rows;
          job.message = `${rows} rows imported`;
        });
      })
    );
  });

  // ---------------- Site audit ----------------
  router.post("/audit/run", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const source = body.source === "live" ? "live" : "local";
    const maxPages = Math.min(Math.max(Number(body.max_pages) || 150, 1), 500);
    const base = providers.siteUrl.replace(/\/+$/, "");
    const fetcher: PathFetcher =
      source === "local"
        ? deps.localFetcher
        : (path) => fetch(base + path, { redirect: "manual", headers: { "user-agent": AUDIT_USER_AGENT }, signal: AbortSignal.timeout(20000) });
    return jobResponse(
      c,
      startJob("audit", async (job) => {
        job.message = `Crawling ${source === "local" ? "in-process app" : base}`;
        return runSiteAudit(store, { siteUrl: providers.siteUrl, baseLabel: source === "local" ? "in-process" : base, source, fetcher, seedPaths: deps.seedPaths, maxPages });
      })
    );
  });
  router.get("/audit", (c) => {
    const runs = store.auditRuns(10);
    const requested = Number(c.req.query("run_id"));
    const run = requested ? runs.find((r) => r.id === requested) : store.latestAuditRun();
    if (!run) return c.json({ run: null, runs, pages: [], site_issues: [] });
    const pages = store.pageAudits(run.id).map((p) => ({ ...p, schema_types: JSON.parse(p.schema_types), issues: JSON.parse(p.issues_json), issues_json: undefined }));
    // Issue rollup: code -> count + affected pages.
    const rollup = new Map<string, { code: string; severity: string; finding: string; fix: string; pages: string[] }>();
    for (const p of pages) {
      for (const i of p.issues as Array<{ code: string; severity: string; finding: string; fix: string }>) {
        if (!rollup.has(i.code)) rollup.set(i.code, { code: i.code, severity: i.severity, finding: i.finding.replace(/\(\d+.*?\)|\d+/g, "").replace(/\s+/g, " ").trim(), fix: i.fix, pages: [] });
        rollup.get(i.code)!.pages.push(p.path);
      }
    }
    const order = { error: 0, warning: 1, notice: 2 } as Record<string, number>;
    return c.json({
      run,
      runs,
      site_issues: JSON.parse(run.site_issues_json),
      issue_summary: [...rollup.values()].sort((a, b) => order[a.severity] - order[b.severity] || b.pages.length - a.pages.length),
      pages,
    });
  });

  // ---------------- Backlinks ----------------
  router.get("/backlinks", (c) => {
    const own = store.domainMetrics([siteHost])[0] ?? null;
    return c.json({
      summary: store.backlinkSummary(),
      dfs_summary: own
        ? {
            dr_100: own.dfs_rank,
            backlinks: own.dfs_backlinks,
            dofollow_backlinks: own.dfs_dofollow_backlinks,
            referring_domains: own.dfs_referring_domains,
            dofollow_rd: own.dfs_dofollow_rd,
            broken_backlinks: own.dfs_broken_backlinks,
            spam_score: own.dfs_spam_score,
            updated_at: own.dfs_updated_at,
          }
        : null,
      dfs_configured: providerStatus(providers).dataforseo.configured,
      link_gap: store.listLinkGap(100),
      backlinks: store.listBacklinks(c.req.query("status")).map((b) => ({
        ...b,
        evidence: b.evidence_json ? JSON.parse(b.evidence_json) : null,
        evidence_json: undefined,
      })),
    });
  });
  router.post("/backlinks", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const url = String(body.source_url ?? "").trim();
    if (!isPublicHttpUrl(url)) return c.json({ error: "invalid_url" }, 400);
    const row = store.addBacklink(url, siteHost, null);
    return row ? c.json({ backlink: row }) : c.json({ error: "invalid_url" }, 400);
  });
  router.patch("/backlinks/:id", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const url = String(body.source_url ?? "").trim();
    if (!isPublicHttpUrl(url)) return c.json({ error: "invalid_url" }, 400);
    try {
      const row = store.updateBacklinkUrl(Number(c.req.param("id")), url);
      return row ? c.json({ backlink: row }) : c.json({ error: "not_found" }, 404);
    } catch {
      return c.json({ error: "duplicate_url" }, 409);
    }
  });
  router.delete("/backlinks/:id", (c) => (store.deleteBacklink(Number(c.req.param("id"))) ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404)));
  router.post("/backlinks/import-outreach", (c) => c.json({ added: store.importOutreachAsBacklinks(siteHost), summary: store.backlinkSummary() }));
  router.post("/backlinks/verify", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    let rows = store.listBacklinks();
    if (Array.isArray(body.ids) && body.ids.length) {
      const ids = new Set(body.ids.map(Number));
      rows = rows.filter((r) => ids.has(r.id));
    } else if (body.only === "unchecked") {
      rows = rows.filter((r) => r.status === "unverified");
    }
    rows = rows.slice(0, Math.min(Math.max(Number(body.limit) || 2000, 1), 10000));
    if (!rows.length) return c.json({ error: "nothing_to_verify" }, 400);
    return jobResponse(
      c,
      startJob("backlink_verify", async (job) => {
        job.total = rows.length;
        return verifyBacklinks(store, rows, (done, total) => {
          job.progress = done;
          job.message = `${done}/${total} checked`;
        });
      })
    );
  });

  // ---------------- Authority (Open PageRank + DataForSEO DR & Organic Overview) ----------------
  router.get("/authority", (c) => {
    const competitors = store.getSetting<string[]>("competitors", DEFAULT_COMPETITORS);
    const st = providerStatus(providers);
    return c.json({
      own_domain: siteHost,
      competitors,
      metrics: store.domainMetrics(),
      link_gap: store.listLinkGap(100),
      configured: st.open_pagerank.configured,
      dfs_configured: st.dataforseo.configured,
    });
  });
  router.put("/authority/competitors", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const list = (Array.isArray(body.competitors) ? body.competitors : String(body.competitors ?? "").split(/[\s,]+/))
      .map((d: unknown) => String(d).toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").trim())
      .filter((d: string) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d))
      .slice(0, 20);
    store.setSetting("competitors", list);
    return c.json({ competitors: list });
  });
  router.post("/authority/refresh", async (c) => {
    if (!providers.openPageRankApiKey) return c.json({ error: "opr_not_configured", message: "Set OPEN_PAGERANK_API_KEY" }, 400);
    const competitors = store.getSetting<string[]>("competitors", DEFAULT_COMPETITORS);
    const referring = [...new Set(store.listBacklinks().map((b) => b.source_domain))];
    try {
      const r = await refreshOpenPageRank(store, providers, [siteHost, ...competitors, ...referring]);
      return c.json(r);
    } catch (e) {
      return c.json({ error: "opr_failed", message: (e as Error).message }, 502);
    }
  });

  // ---------------- DataForSEO (Phase 3: US Search Volume, KD%, SERP ETV, 0-100 DR, Link Gap) ----------------
  router.get("/dfs/status", async (c) => {
    return c.json(await fetchDfsAccountStatus(store, providers, dfsFetch));
  });
  router.put("/dfs/spend-cap", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const cap = Math.max(0, Math.min(Number(body.spend_cap_usd ?? DEFAULT_DFS_SPEND_CAP_USD) || 0, 1000));
    store.setSetting("dfs_spend_cap_usd", cap);
    return c.json({ spend_cap_usd: cap, spend_logged_usd: store.dfsTotalSpend() });
  });
  router.post("/dfs/keywords", async (c) => {
    if (!providerStatus(providers).dataforseo.configured) {
      return c.json({ error: "dfs_not_configured", message: "Set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in server/.env" }, 400);
    }
    try {
      const res = await syncDfsKeywords(store, providers, dfsFetch);
      return c.json({ ok: true, ...res });
    } catch (e) {
      return c.json({ error: "dfs_keywords_failed", message: (e as Error).message }, 502);
    }
  });
  router.post("/dfs/domain-overview", async (c) => {
    if (!providerStatus(providers).dataforseo.configured) {
      return c.json({ error: "dfs_not_configured", message: "Set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in server/.env" }, 400);
    }
    const body = await c.req.json().catch(() => ({}));
    const competitors = store.getSetting<string[]>("competitors", DEFAULT_COMPETITORS);
    const includeCompetitors = body.include_competitors !== false;
    try {
      const res = await syncDfsDomainOverview(store, providers, competitors, includeCompetitors, dfsFetch);
      return c.json({ ok: true, ...res });
    } catch (e) {
      return c.json({ error: "dfs_domain_overview_failed", message: (e as Error).message }, 502);
    }
  });
  router.post("/dfs/backlinks", async (c) => {
    if (!providerStatus(providers).dataforseo.configured) {
      return c.json({ error: "dfs_not_configured", message: "Set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in server/.env" }, 400);
    }
    const competitors = store.getSetting<string[]>("competitors", DEFAULT_COMPETITORS);
    try {
      const res = await syncDfsBacklinks(store, providers, competitors, dfsFetch);
      return c.json({ ok: true, ...res });
    } catch (e) {
      return c.json({ error: "dfs_backlinks_failed", message: (e as Error).message }, 502);
    }
  });
  router.post("/dfs/link-gap", async (c) => {
    if (!providerStatus(providers).dataforseo.configured) {
      return c.json({ error: "dfs_not_configured", message: "Set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in server/.env" }, 400);
    }
    const body = await c.req.json().catch(() => ({}));
    const competitors = store.getSetting<string[]>("competitors", DEFAULT_COMPETITORS);
    const limit = Math.min(Math.max(Number(body.limit) || 50, 5), 200);
    try {
      const res = await syncDfsCompetitorLinkGap(store, providers, competitors, limit, dfsFetch);
      return c.json({ ok: true, ...res });
    } catch (e) {
      return c.json({ error: "dfs_link_gap_failed", message: (e as Error).message }, 502);
    }
  });
  router.post("/dfs/link-gap/outreach", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const dom = String(body.domain ?? "").trim();
    if (!dom) return c.json({ error: "domain_required" }, 400);
    const res = store.pushLinkGapToOutreach(dom);
    return c.json({ ok: true, ...res });
  });

  // ---------------- Core Web Vitals ----------------
  router.get("/cwv", (c) => c.json({ cwv: store.listCwv(), providers: providerStatus(providers) }));
  router.post("/pagespeed/run", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const path = String(body.path ?? "/").startsWith("/") ? String(body.path ?? "/") : "/";
    const url = providers.siteUrl.replace(/\/+$/, "") + path;
    const strategy = body.strategy === "desktop" ? "desktop" : "mobile";
    try {
      return c.json({ result: await runPageSpeed(store, providers, url, strategy) });
    } catch (e) {
      return c.json({ error: "pagespeed_failed", message: (e as Error).message }, 502);
    }
  });
  router.post("/crux/run", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const formFactor = body.form_factor === "DESKTOP" ? "DESKTOP" : "PHONE";
    const target = body.path ? { url: providers.siteUrl.replace(/\/+$/, "") + String(body.path) } : { origin: new URL(providers.siteUrl).origin };
    try {
      return c.json({ result: await runCrux(store, providers, target, formFactor) });
    } catch (e) {
      return c.json({ error: "crux_failed", message: (e as Error).message }, 502);
    }
  });

  // ---------------- Crawler / AI bot telemetry ----------------
  router.get("/bots", (c) => {
    const days = Math.min(Math.max(Number(c.req.query("days")) || 30, 1), 90);
    const s = store.botSummary(days);
    return c.json({ ...s, by_bot: s.by_bot.map((b) => ({ ...b, type: AI_BOTS.has(b.bot) ? "ai" : "search" })) });
  });

  // ---------------- A4: Bloat Watch Detector ----------------
  router.get("/bloat-watch", (c) => {
    const status = c.req.query("status");
    const posts = listBloatWatchPosts(store, status);
    return c.json({
      posts,
      counts: {
        total: posts.length,
        published: posts.filter((p) => p.status === "published").length,
        draft: posts.filter((p) => p.status === "draft" || p.status === "measured").length,
      },
      feeds: BLOAT_WATCH_FEEDS,
    });
  });

  router.get("/bloat-watch/:slug", (c) => {
    const post = getBloatWatchPost(store, c.req.param("slug"));
    return post ? c.json({ post }) : c.json({ error: "not_found" }, 404);
  });

  router.post("/bloat-watch/scan", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const res = await scanBloatWatchSignals(store, {
      custom_signals: Array.isArray(body.signals) ? body.signals : undefined,
      fetch_live_feeds: Boolean(body.fetch_live_feeds),
      min_score: body.min_score != null ? Number(body.min_score) : 7,
    });
    return c.json({ ok: true, ...res, posts: listBloatWatchPosts(store) });
  });

  const handleMeasureBloatWatch = async (c: any) => {
    const slug = c.req.param("slug");
    const body = await c.req.json().catch(() => ({}));
    const updated = updateBloatWatchMeasurements(store, slug, {
      before_gb: body.before_gb != null ? Number(body.before_gb) : undefined,
      after_gb: body.after_gb != null ? Number(body.after_gb) : undefined,
      reclaimed_gb: body.reclaimed_gb != null ? Number(body.reclaimed_gb) : undefined,
      tested_os_build: body.tested_os_build,
      app_version: body.app_version,
      safe_verdict: body.safe_verdict,
      vm_notes: body.vm_notes,
      title: body.title,
      summary: body.summary,
    });
    if (!updated) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true, post: updated });
  };
  router.put("/bloat-watch/:slug/measure", handleMeasureBloatWatch);
  router.post("/bloat-watch/:slug/measure", handleMeasureBloatWatch);

  router.post("/bloat-watch/:slug/publish", async (c) => {
    const slug = c.req.param("slug");
    const body = await c.req.json().catch(() => ({}));
    const res = await publishBloatWatchPost(store, slug, providers.siteUrl, body.ping_indexnow !== false);
    if (!res) return c.json({ error: "not_found" }, 404);
    return c.json({
      ok: true,
      ...res,
      reddit_reply_draft: res.post.reddit_reply_draft,
      press_pitch_draft: res.post.press_pitch_draft,
    });
  });

  // ---------------- A5: Listing Freshness & Auto-Publish ----------------
  router.get("/listings/submission-pack", (c) => {
    return c.json(getDirectorySubmissionPack(store));
  });

  router.get("/listings/tasks", (c) => {
    return c.json(listListingCrmTasks(store));
  });

  router.get("/listings", (c) => {
    const listings = listDirectoryListings(store);
    return c.json({
      expected_version: readCurrentReleaseVersion(),
      listings,
      summary: {
        total: listings.length,
        current: listings.filter((l) => l.version_status === "current").length,
        stale: listings.filter((l) => l.version_status === "stale").length,
        open_tasks: listings.filter((l) => l.crm_task_status === "open").length,
      },
    });
  });

  const handleUpsertListing = async (c: any) => {
    const body = await c.req.json().catch(() => ({}));
    const platformId = String(body.platform_id ?? "").trim();
    const listingUrl = String(body.listing_url ?? "").trim();
    if (!platformId || !listingUrl) return c.json({ error: "platform_id_and_listing_url_required" }, 400);
    if (!isPublicHttpUrl(listingUrl)) return c.json({ error: "invalid_public_url" }, 400);
    const row = upsertDirectoryListing(store, {
      platform_id: platformId,
      platform_name: body.platform_name ? String(body.platform_name) : undefined,
      listing_url: listingUrl,
      expected_version: body.expected_version ? String(body.expected_version) : undefined,
    });
    return c.json({ ok: true, listing: row });
  };
  router.put("/listings", handleUpsertListing);
  router.post("/listings", handleUpsertListing);

  router.post("/listings/check", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const res = await checkDirectoryListings(store, {
      targetDomain: siteHost,
      expectedVersion: body.expected_version ? String(body.expected_version) : undefined,
      platformId: body.platform_id ? String(body.platform_id) : undefined,
      customHtmlByPlatform: body.mock_html && typeof body.mock_html === "object" ? body.mock_html : undefined,
    });
    return c.json({ ok: true, ...res });
  });

  // ---------------- A1: Telemetry -> Content Truth Loop ----------------
  router.get("/telemetry-truth", (c) => {
    const summaries = refreshAllTelemetryTruthCache(store);
    const qualified = summaries.filter((s) => s.qualifies_k_anonymity);
    return c.json({
      ok: true,
      k_anonymity_floor: TELEMETRY_TRUTH_MIN_SAMPLES,
      total_slugs_with_samples: summaries.length,
      qualified_slugs_count: qualified.length,
      qualified_slugs: qualified,
      all_slugs: summaries,
    });
  });

  router.post("/telemetry-truth/ingest", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const res = ingestScanCompletedTelemetry(store, {
      platform: typeof body.platform === "string" ? body.platform : "windows",
      ruleBytes: body.rule_bytes && typeof body.rule_bytes === "object" ? body.rule_bytes : null,
      samples: Array.isArray(body.samples) ? body.samples : null,
    });
    return c.json({
      ok: true,
      k_anonymity_floor: TELEMETRY_TRUTH_MIN_SAMPLES,
      ...res,
    });
  });

  return router;
}

