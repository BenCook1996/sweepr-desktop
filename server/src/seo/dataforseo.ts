import type { SeoProviderConfig } from "./google.js";
import type { SeoStore } from "./store.js";

/**
 * Phase 3: DataForSEO v3 API integration (US market default: location_code 2840, language_code "en").
 *
 * Cost & safety rules:
 *  - Every response is cached in SQLite (seo_keywords, seo_domain_metrics, seo_link_gap, seo_backlinks, seo_settings).
 *  - Paid POST endpoints are NEVER called on page load or server startup — only on explicit operator actions.
 *  - Every API call's exact USD cost is recorded in seo_dfs_log and guarded by a configurable spend cap (default $0.95).
 */

export const DFS_BASE_URL = "https://api.dataforseo.com/v3";
export const DEFAULT_DFS_SPEND_CAP_USD = 0.95;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Normalises a DataForSEO rank onto the 0–100 scale (Ahrefs DR equivalent).
 * When `rank_scale: "one_hundred"` is passed in the request, DataForSEO already returns 0–100;
 * if an endpoint returns the raw 0–1000 scale, we apply DataForSEO's documented sin(r / 636.62) * 100 transform.
 */
export function normalizeRank100(rank: number | null | undefined): number | null {
  if (rank === null || rank === undefined || !Number.isFinite(Number(rank))) return null;
  const r = Number(rank);
  if (r <= 0) return 0;
  if (r <= 100) return Math.round(r);
  return Math.min(100, Math.max(0, Math.round(Math.sin(r / 636.62) * 100)));
}

function cleanDomain(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .trim();
}

function formatDfsError(statusCode: number | undefined, statusMessage: string | undefined, httpStatus: number): string {
  const code = statusCode ?? httpStatus;
  const msg = statusMessage || `HTTP ${httpStatus}`;
  if (code === 40104) {
    return "DataForSEO account verification is still propagating in their portal (code 40104). Please wait a few minutes and try again.";
  }
  if (code === 40200) {
    return "DataForSEO balance is insufficient for this request (code 40200).";
  }
  if (code === 40204 || code === 40210) {
    return `DataForSEO subscription required for this API module (code ${code}: ${msg}).`;
  }
  return `DataForSEO error ${code}: ${msg}`;
}

interface DfsCallResult<T = any> {
  taskResult: T[];
  cost: number;
  statusCode: number;
  statusMessage: string;
}

async function callDfs<T = any>(
  store: SeoStore,
  cfg: SeoProviderConfig,
  method: "GET" | "POST",
  endpoint: string,
  body?: unknown,
  fetchImpl: FetchLike = fetch
): Promise<DfsCallResult<T>> {
  const login = (cfg.dataForSeoLogin ?? "").trim();
  const password = (cfg.dataForSeoPassword ?? "").trim();
  if (!login || !password) {
    throw new Error("DataForSEO credentials not configured (set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in server/.env)");
  }

  if (method === "POST") {
    const cap = store.getSetting<number>("dfs_spend_cap_usd", DEFAULT_DFS_SPEND_CAP_USD);
    const spent = store.dfsTotalSpend();
    if (spent >= cap) {
      throw new Error(
        `DataForSEO spend cap reached ($${spent.toFixed(4)} spent of $${cap.toFixed(2)} cap). Increase the cap in Data Sources if you want to run more queries.`
      );
    }
  }

  const auth = "Basic " + Buffer.from(`${login}:${password}`).toString("base64");
  const res = await fetchImpl(`${DFS_BASE_URL}/${endpoint.replace(/^\/+/, "")}`, {
    method,
    headers: {
      authorization: auth,
      "content-type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(45000),
  });

  const json = (await res.json().catch(() => ({}))) as any;
  const topCode = Number(json?.status_code ?? res.status);
  const topMsg = String(json?.status_message ?? res.statusText ?? "");
  const task = json?.tasks?.[0];
  const taskCode = Number(task?.status_code ?? topCode);
  const taskMsg = String(task?.status_message ?? topMsg);
  const cost = Number(task?.cost ?? json?.cost ?? 0) || 0;

  if (method === "POST" || cost > 0 || taskCode !== 20000) {
    store.recordDfsCall(endpoint, taskCode, cost, taskCode === 20000 ? "ok" : taskMsg.slice(0, 200));
  }

  if (!res.ok || topCode !== 20000 || taskCode !== 20000) {
    throw new Error(formatDfsError(taskCode !== 20000 ? taskCode : topCode, taskCode !== 20000 ? taskMsg : topMsg, res.status));
  }

  return {
    taskResult: Array.isArray(task?.result) ? (task.result as T[]) : [],
    cost,
    statusCode: taskCode,
    statusMessage: taskMsg,
  };
}

/**
 * Free call (`GET /v3/appendix/user_data`) to check account balance, verification state and spend ledger.
 */
export async function fetchDfsAccountStatus(store: SeoStore, cfg: SeoProviderConfig, fetchImpl: FetchLike = fetch) {
  const configured = Boolean(cfg.dataForSeoLogin && cfg.dataForSeoPassword);
  const spendLogged = store.dfsTotalSpend();
  const spendCap = store.getSetting<number>("dfs_spend_cap_usd", DEFAULT_DFS_SPEND_CAP_USD);
  const cached = store.getSetting<Record<string, unknown> | null>("dfs_account_cache", null);

  if (!configured) {
    return {
      configured: false,
      login: null,
      balance_usd: null,
      total_deposited_usd: null,
      backlinks_subscription_expiry: null,
      spend_logged_usd: spendLogged,
      spend_cap_usd: spendCap,
      location_code: cfg.dataForSeoLocationCode ?? 2840,
      language_code: cfg.dataForSeoLanguageCode ?? "en",
      recent_calls: store.dfsRecentCalls(20),
    };
  }

  try {
    const r = await callDfs(store, cfg, "GET", "appendix/user_data", undefined, fetchImpl);
    const u = r.taskResult[0] ?? {};
    const snapshot = {
      login: u.login ?? cfg.dataForSeoLogin,
      balance_usd: typeof u.money?.balance === "number" ? u.money.balance : null,
      total_deposited_usd: typeof u.money?.total === "number" ? u.money.total : null,
      currency: u.money?.currency ?? "USD",
      backlinks_subscription_expiry: u.backlinks_subscription_expiry_date ?? null,
      checked_at: Math.floor(Date.now() / 1000),
    };
    store.setSetting("dfs_account_cache", snapshot);
    return {
      configured: true,
      ...snapshot,
      spend_logged_usd: store.dfsTotalSpend(),
      spend_cap_usd: spendCap,
      location_code: cfg.dataForSeoLocationCode ?? 2840,
      language_code: cfg.dataForSeoLanguageCode ?? "en",
      recent_calls: store.dfsRecentCalls(20),
    };
  } catch (e) {
    return {
      configured: true,
      login: cfg.dataForSeoLogin ?? null,
      balance_usd: (cached?.balance_usd as number | null) ?? null,
      total_deposited_usd: (cached?.total_deposited_usd as number | null) ?? null,
      backlinks_subscription_expiry: (cached?.backlinks_subscription_expiry as string | null) ?? null,
      error: (e as Error).message,
      spend_logged_usd: spendLogged,
      spend_cap_usd: spendCap,
      location_code: cfg.dataForSeoLocationCode ?? 2840,
      language_code: cfg.dataForSeoLanguageCode ?? "en",
      recent_calls: store.dfsRecentCalls(20),
    };
  }
}

/**
 * Enriches all tracked keywords with US Google Ads Search Volume, CPC, Competition, 12-month trend
 * AND DataForSEO Labs Keyword Difficulty (0–100%).
 *
 * Cost: ~$0.075 (Google Ads Search Volume batch) + ~$0.013 (Bulk KD batch) ≈ $0.088 total for up to 700 keywords.
 */
export async function syncDfsKeywords(store: SeoStore, cfg: SeoProviderConfig, fetchImpl: FetchLike = fetch) {
  const kws = store.listKeywords().map((k) => k.keyword);
  if (!kws.length) throw new Error("No keywords tracked yet. Add keywords first.");

  const location_code = cfg.dataForSeoLocationCode ?? 2840;
  const language_code = cfg.dataForSeoLanguageCode ?? "en";
  // Google Ads search_volume accepts up to 1,000 keywords per task; sanitize characters Google Ads rejects.
  const cleanKws = [
    ...new Set(
      kws
        .map((k) => k.replace(/[^\p{L}\p{N}\s\-+.'"/?]/gu, " ").replace(/\s+/g, " ").trim().toLowerCase())
        .filter((k) => k.length >= 2 && k.length <= 80 && k.split(" ").length <= 10)
    ),
  ].slice(0, 700);

  let svUpdated = 0;
  let kdUpdated = 0;
  let totalCost = 0;
  const warnings: string[] = [];

  // 1. Google Ads Search Volume + CPC + Competition + 12-month monthly_searches
  try {
    const svRes = await callDfs(
      store,
      cfg,
      "POST",
      "keywords_data/google_ads/search_volume/live",
      [{ keywords: cleanKws, location_code, language_code }],
      fetchImpl
    );
    totalCost += svRes.cost;
    // Note: keywords_data/google_ads/search_volume/live returns keyword objects directly in tasks[0].result[]
    // (or in result[0].items[] on some wrappers — we support both).
    const items: any[] = Array.isArray((svRes.taskResult[0] as any)?.items)
      ? (svRes.taskResult[0] as any).items
      : svRes.taskResult;
    for (const item of items) {
      if (!item?.keyword) continue;
      store.updateKeywordDfs(String(item.keyword), {
        search_volume: typeof item.search_volume === "number" ? item.search_volume : null,
        cpc: typeof item.cpc === "number" ? item.cpc : typeof item.high_top_of_page_bid === "number" ? item.high_top_of_page_bid : null,
        competition: typeof item.competition === "string" ? item.competition : null,
        competition_index: typeof item.competition_index === "number" ? item.competition_index : null,
        monthly_searches: Array.isArray(item.monthly_searches) ? item.monthly_searches.slice(0, 12) : undefined,
      });
      svUpdated++;
    }
  } catch (e) {
    warnings.push(`Search Volume: ${(e as Error).message}`);
  }

  // 2. DataForSEO Labs Bulk Keyword Difficulty (0–100)
  try {
    const kdRes = await callDfs(
      store,
      cfg,
      "POST",
      "dataforseo_labs/google/bulk_keyword_difficulty/live",
      [{ keywords: cleanKws, location_code, language_code }],
      fetchImpl
    );
    totalCost += kdRes.cost;
    const items: any[] = (kdRes.taskResult[0] as any)?.items ?? [];
    for (const item of items) {
      if (!item?.keyword) continue;
      store.updateKeywordDfs(String(item.keyword), {
        kd: typeof item.keyword_difficulty === "number" ? Math.round(item.keyword_difficulty) : null,
      });
      kdUpdated++;
    }
  } catch (e) {
    warnings.push(`Keyword Difficulty: ${(e as Error).message}`);
  }

  if (svUpdated === 0 && kdUpdated === 0 && warnings.length > 0) {
    throw new Error(warnings.join(" | "));
  }

  return {
    keywords_submitted: cleanKws.length,
    search_volume_updated: svUpdated,
    kd_updated: kdUpdated,
    cost_usd: Number(totalCost.toFixed(5)),
    warnings,
  };
}

/**
 * Pulls Google US SERP domain rank overview (ETV expected monthly visits, traffic value in USD, rank buckets)
 * + ranked keywords for our own domain and competitors.
 *
 * Uses `ranked_keywords/live` for our own domain (returns BOTH domain-wide `metrics.organic` AND the individual
 * ranked keywords + SERP positions + search volume + KD + search intent in one ~$0.015 call!) and
 * `domain_rank_overview/live` (~$0.01/domain) for competitors.
 */
export async function syncDfsDomainOverview(
  store: SeoStore,
  cfg: SeoProviderConfig,
  competitors: string[],
   includeCompetitors = true,
  fetchImpl: FetchLike = fetch
) {
  const siteHost = cleanDomain(new URL(cfg.siteUrl).hostname);
  const location_code = cfg.dataForSeoLocationCode ?? 2840;
  const language_code = cfg.dataForSeoLanguageCode ?? "en";
  let totalCost = 0;
  let rankedKeywordsImported = 0;
  const domainsUpdated: string[] = [];

  // 1. Own domain: ranked_keywords/live gives both metrics.organic AND top ranked keywords in Google US.
  const ownRes = await callDfs(
    store,
    cfg,
    "POST",
    "dataforseo_labs/google/ranked_keywords/live",
    [{ target: siteHost, location_code, language_code, limit: 100 }],
    fetchImpl
  );
  totalCost += ownRes.cost;
  const ownData = ownRes.taskResult[0] ?? {};
  const ownOrg = ownData.metrics?.organic ?? {};
  store.upsertDfsDomainMetrics(siteHost, {
    dfs_organic_keywords: typeof ownOrg.count === "number" ? ownOrg.count : 0,
    dfs_organic_etv: typeof ownOrg.etv === "number" ? ownOrg.etv : 0,
    dfs_traffic_cost_usd: typeof ownOrg.estimated_paid_traffic_cost === "number" ? ownOrg.estimated_paid_traffic_cost : 0,
    dfs_pos_1: typeof ownOrg.pos_1 === "number" ? ownOrg.pos_1 : 0,
    dfs_pos_2_3: typeof ownOrg.pos_2_3 === "number" ? ownOrg.pos_2_3 : 0,
    dfs_pos_4_10: typeof ownOrg.pos_4_10 === "number" ? ownOrg.pos_4_10 : 0,
    dfs_pos_11_20: typeof ownOrg.pos_11_20 === "number" ? ownOrg.pos_11_20 : 0,
  });
  domainsUpdated.push(siteHost);

  for (const item of ownData.items ?? []) {
    const kw = item?.keyword_data?.keyword;
    if (!kw) continue;
    const kwInfo = item.keyword_data?.keyword_info ?? {};
    const kwProps = item.keyword_data?.keyword_properties ?? {};
    const intentInfo = item.keyword_data?.search_intent_info ?? {};
    const serp = item.ranked_serp_element?.serp_item ?? {};
    const relPath = typeof serp.relative_url === "string" && serp.relative_url.startsWith("/") ? serp.relative_url : null;

    store.addKeyword(String(kw), "dfs-discovered", relPath);
    store.updateKeywordDfs(String(kw), {
      search_volume: typeof kwInfo.search_volume === "number" ? kwInfo.search_volume : undefined,
      cpc: typeof kwInfo.cpc === "number" ? kwInfo.cpc : undefined,
      competition: typeof kwInfo.competition_level === "string" ? kwInfo.competition_level : undefined,
      kd: typeof kwProps.keyword_difficulty === "number" ? Math.round(kwProps.keyword_difficulty) : undefined,
      search_intent: typeof intentInfo.main_intent === "string" ? intentInfo.main_intent : undefined,
      serp_position: typeof serp.rank_group === "number" ? serp.rank_group : typeof serp.rank_absolute === "number" ? serp.rank_absolute : undefined,
      serp_url: typeof serp.url === "string" ? serp.url : undefined,
      serp_etv: typeof serp.etv === "number" ? serp.etv : undefined,
      monthly_searches: Array.isArray(kwInfo.monthly_searches) ? kwInfo.monthly_searches.slice(0, 12) : undefined,
    });
    rankedKeywordsImported++;
  }

  // 2. Competitors: domain_rank_overview/live (~$0.01 each)
  if (includeCompetitors) {
    for (const comp of competitors.map(cleanDomain).filter(Boolean).slice(0, 6)) {
      if (comp === siteHost) continue;
      const compRes = await callDfs(
        store,
        cfg,
        "POST",
        "dataforseo_labs/google/domain_rank_overview/live",
        [{ target: comp, location_code, language_code }],
        fetchImpl
      );
      totalCost += compRes.cost;
      const org = compRes.taskResult[0]?.items?.[0]?.metrics?.organic ?? {};
      store.upsertDfsDomainMetrics(comp, {
        dfs_organic_keywords: typeof org.count === "number" ? org.count : 0,
        dfs_organic_etv: typeof org.etv === "number" ? org.etv : 0,
        dfs_traffic_cost_usd: typeof org.estimated_paid_traffic_cost === "number" ? org.estimated_paid_traffic_cost : 0,
        dfs_pos_1: typeof org.pos_1 === "number" ? org.pos_1 : 0,
        dfs_pos_2_3: typeof org.pos_2_3 === "number" ? org.pos_2_3 : 0,
        dfs_pos_4_10: typeof org.pos_4_10 === "number" ? org.pos_4_10 : 0,
        dfs_pos_11_20: typeof org.pos_11_20 === "number" ? org.pos_11_20 : 0,
      });
      domainsUpdated.push(comp);
    }
  }

  return {
    domains_updated: domainsUpdated,
    ranked_keywords_synced: rankedKeywordsImported,
    cost_usd: Number(totalCost.toFixed(5)),
  };
}

/**
 * Pulls DataForSEO Backlinks Summary (0–100 Domain Rank, total backlinks, referring domains, dofollow counts,
 * spam score), Bulk Ranks for competitors & referring domains, and live discovered backlinks pointing to our site.
 *
 * Cost: ~$0.02 (summary) + ~$0.02 (bulk_ranks) + ~$0.023 (backlinks list) ≈ $0.063 total.
 */
export async function syncDfsBacklinks(
  store: SeoStore,
  cfg: SeoProviderConfig,
  competitors: string[],
  fetchImpl: FetchLike = fetch
) {
  const siteHost = cleanDomain(new URL(cfg.siteUrl).hostname);
  let totalCost = 0;
  const warnings: string[] = [];

  // 1. Backlinks summary for our own domain
  const sumRes = await callDfs(
    store,
    cfg,
    "POST",
    "backlinks/summary/live",
    [{ target: siteHost, include_subdomains: true, rank_scale: "one_hundred", backlinks_status_type: "live", internal_list_limit: 10 }],
    fetchImpl
  );
  totalCost += sumRes.cost;
  const s = sumRes.taskResult[0] ?? {};
  const totalBl = typeof s.backlinks === "number" ? s.backlinks : 0;
  const nofollowBl = typeof s.referring_links_attributes?.nofollow === "number" ? s.referring_links_attributes.nofollow : typeof s.referring_pages_nofollow === "number" ? s.referring_pages_nofollow : 0;
  const totalRd = typeof s.referring_domains === "number" ? s.referring_domains : 0;
  const nofollowRd = typeof s.referring_domains_nofollow === "number" ? s.referring_domains_nofollow : 0;

  store.upsertDfsDomainMetrics(siteHost, {
    dfs_rank: normalizeRank100(s.rank),
    dfs_backlinks: totalBl,
    dfs_dofollow_backlinks: Math.max(0, totalBl - nofollowBl),
    dfs_referring_domains: totalRd,
    dfs_dofollow_rd: Math.max(0, totalRd - nofollowRd),
    dfs_referring_ips: typeof s.referring_ips === "number" ? s.referring_ips : null,
    dfs_broken_backlinks: typeof s.broken_backlinks === "number" ? s.broken_backlinks : null,
    dfs_spam_score: typeof s.backlinks_spam_score === "number" ? s.backlinks_spam_score : typeof s.info?.target_spam_score === "number" ? s.info.target_spam_score : null,
  });

  // 2. Bulk 0–100 Domain Ranks for competitors + referring domains (up to 500 in one ~$0.02 call)
  const referringDomains = [...new Set(store.listBacklinks().map((b) => b.source_domain))];
  const bulkTargets = [...new Set([siteHost, ...competitors.map(cleanDomain), ...referringDomains].filter(Boolean))].slice(0, 500);
  let bulkUpdated = 0;
  if (bulkTargets.length > 0) {
    try {
      const bulkRes = await callDfs(
        store,
        cfg,
        "POST",
        "backlinks/bulk_ranks/live",
        [{ targets: bulkTargets, rank_scale: "one_hundred" }],
        fetchImpl
      );
      totalCost += bulkRes.cost;
      for (const item of bulkRes.taskResult[0]?.items ?? []) {
        if (!item?.target) continue;
        store.upsertDfsDomainMetrics(String(item.target), {
          dfs_rank: normalizeRank100(item.rank),
        });
        bulkUpdated++;
      }
    } catch (e) {
      warnings.push(`Bulk Ranks: ${(e as Error).message}`);
    }
  }

  // 3. Discover live backlinks pointing to our domain (one_per_domain, top 100 by rank)
  let discoveredAdded = 0;
  try {
    const blRes = await callDfs(
      store,
      cfg,
      "POST",
      "backlinks/backlinks/live",
      [
        {
          target: siteHost,
          mode: "one_per_domain",
          include_subdomains: true,
          backlinks_status_type: "live",
          rank_scale: "one_hundred",
          limit: 100,
          order_by: ["rank,desc"],
        },
      ],
      fetchImpl
    );
    totalCost += blRes.cost;
    for (const item of blRes.taskResult[0]?.items ?? []) {
      const urlFrom = typeof item?.url_from === "string" ? item.url_from : null;
      if (!urlFrom) continue;
      const before = store.backlinkSummary().tracked;
      const row = store.addBacklink(urlFrom, siteHost, null);
      const after = store.backlinkSummary().tracked;
      if (after > before) discoveredAdded++;
      if (row && row.status === "unverified") {
        store.recordBacklinkCheck(row.id, {
          status: item.dofollow === false ? "nofollow" : "live",
          anchor_text: item.anchor || item.alt || null,
          rel: item.dofollow === false ? "nofollow" : null,
          found_href: item.url_to || cfg.siteUrl,
          http_status: typeof item.page_from_status_code === "number" ? item.page_from_status_code : 200,
          evidence: {
            source: "dataforseo_backlinks_index",
            domain_from_rank: normalizeRank100(item.domain_from_rank),
            page_from_rank: normalizeRank100(item.page_from_rank),
            spam_score: item.backlink_spam_score ?? null,
            first_seen: item.first_seen ?? null,
            last_seen: item.last_seen ?? null,
          },
        });
      }
      if (item.domain_from && item.domain_from_rank !== undefined) {
        store.upsertDfsDomainMetrics(String(item.domain_from), {
          dfs_rank: normalizeRank100(item.domain_from_rank),
        });
      }
    }
  } catch (e) {
    warnings.push(`Backlinks list: ${(e as Error).message}`);
  }

  return {
    domain: siteHost,
    dr_100: normalizeRank100(s.rank),
    backlinks: totalBl,
    referring_domains: totalRd,
    bulk_ranks_updated: bulkUpdated,
    discovered_backlinks_added: discoveredAdded,
    cost_usd: Number(totalCost.toFixed(5)),
    warnings,
  };
}

/**
 * Competitor Link Intersect ("Link Gap"): finds referring domains that link to one or more competitors
 * (e.g. ccleaner.com, bleachbit.org, wisecleaner.com, glarysoft.com) while excluding our own domain.
 *
 * Cost: ~$0.022 per run.
 */
export async function syncDfsCompetitorLinkGap(
  store: SeoStore,
  cfg: SeoProviderConfig,
  competitors: string[],
  limit = 50,
  fetchImpl: FetchLike = fetch
) {
  const siteHost = cleanDomain(new URL(cfg.siteUrl).hostname);
  const cleanComps = [...new Set(competitors.map(cleanDomain).filter((d) => d && d !== siteHost))].slice(0, 20);
  if (!cleanComps.length) throw new Error("Add at least one competitor domain first.");

  const targets: Record<string, string> = {};
  cleanComps.forEach((c, idx) => {
    targets[String(idx + 1)] = c;
  });

  const res = await callDfs(
    store,
    cfg,
    "POST",
    "backlinks/domain_intersection/live",
    [
      {
        targets,
        exclude_targets: [siteHost],
        include_subdomains: true,
        exclude_internal_backlinks: true,
        intersection_mode: "all",
        rank_scale: "one_hundred",
        limit: Math.min(Math.max(limit, 5), 200),
        order_by: ["1.backlinks,desc"],
      },
    ],
    fetchImpl
  );

  const rawItems: any[] = res.taskResult[0]?.items ?? [];
  const parsed: Array<{
    referring_domain: string;
    rank: number | null;
    spam_score: number | null;
    intersections_count: number;
    competitor_links: Record<string, number>;
    total_competitor_backlinks: number;
    first_seen: string | null;
  }> = [];

  for (const item of rawItems) {
    const map = item?.domain_intersection ?? {};
    let refDomain: string | null = null;
    let bestRank: number | null = null;
    let spamScore: number | null = null;
    let firstSeen: string | null = null;
    const compLinks: Record<string, number> = {};
    let totalLinks = 0;

    for (const [key, compDomain] of Object.entries(targets)) {
      const cell = map[key];
      if (!cell) continue;
      const links = typeof cell.backlinks === "number" ? cell.backlinks : 0;
      if (links > 0) {
        compLinks[compDomain] = links;
        totalLinks += links;
      }
      if (!refDomain && typeof cell.target === "string" && cell.target) {
        refDomain = cleanDomain(cell.target);
      }
      const r = normalizeRank100(cell.rank);
      if (r !== null && (bestRank === null || r > bestRank)) bestRank = r;
      if (spamScore === null && typeof cell.backlinks_spam_score === "number") spamScore = cell.backlinks_spam_score;
      if (!firstSeen && typeof cell.first_seen === "string") firstSeen = cell.first_seen;
    }

    if (!refDomain || totalLinks === 0) continue;
    const intersectionsCount =
      typeof item?.summary?.intersections_count === "number"
        ? item.summary.intersections_count
        : Object.keys(compLinks).length;

    parsed.push({
      referring_domain: refDomain,
      rank: bestRank,
      spam_score: spamScore,
      intersections_count: intersectionsCount,
      competitor_links: compLinks,
      total_competitor_backlinks: totalLinks,
      first_seen: firstSeen,
    });
  }

  store.replaceLinkGap(parsed);

  return {
    competitors: cleanComps,
    opportunities_found: parsed.length,
    cost_usd: Number(res.cost.toFixed(5)),
  };
}
