import { createSign } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { SeoStore } from "./store.js";

/**
 * Phase 2 data providers (all free, all optional, all env-configured):
 *  - Google Search Console API  (GSC_SERVICE_ACCOUNT_JSON + GSC_SITE_URL)  -> real rankings, clicks, impressions
 *  - PageSpeed Insights API v5  (GOOGLE_API_KEY optional, raises quota)     -> Lighthouse lab scores + CrUX field data
 *  - Chrome UX Report API       (GOOGLE_API_KEY required)                   -> 28-day real-user Core Web Vitals
 *  - Open PageRank API          (OPEN_PAGERANK_API_KEY)                     -> 0-10 domain authority from Common Crawl link graph
 */

export interface SeoProviderConfig {
  siteUrl: string;
  gscSiteUrl?: string;
  gscServiceAccountJson?: string;
  googleApiKey?: string;
  openPageRankApiKey?: string;
  dataForSeoLogin?: string;
  dataForSeoPassword?: string;
  dataForSeoLocationCode?: number;
  dataForSeoLanguageCode?: string;
}

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export function loadServiceAccount(raw: string | undefined): ServiceAccount | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  let text = v;
  if (!v.startsWith("{")) {
    if (existsSync(v)) text = readFileSync(v, "utf8");
    else {
      try {
        text = Buffer.from(v, "base64").toString("utf8");
      } catch {
        return null;
      }
    }
  }
  try {
    const j = JSON.parse(text);
    if (typeof j.client_email === "string" && typeof j.private_key === "string") return j as ServiceAccount;
  } catch {
    /* fallthrough */
  }
  return null;
}

export function providerStatus(cfg: SeoProviderConfig) {
  const sa = loadServiceAccount(cfg.gscServiceAccountJson);
  const dfsConfigured = Boolean((cfg.dataForSeoLogin ?? "").trim() && (cfg.dataForSeoPassword ?? "").trim());
  return {
    site_url: cfg.siteUrl,
    gsc: {
      configured: Boolean(sa && cfg.gscSiteUrl),
      site_url: cfg.gscSiteUrl || null,
      service_account: sa?.client_email ?? null,
      missing: [!sa ? "GSC_SERVICE_ACCOUNT_JSON" : null, !cfg.gscSiteUrl ? "GSC_SITE_URL" : null].filter(Boolean),
    },
    pagespeed: { configured: true, keyed: Boolean(cfg.googleApiKey), note: cfg.googleApiKey ? null : "Works without a key at low quota; set GOOGLE_API_KEY for 25k/day." },
    crux: { configured: Boolean(cfg.googleApiKey), missing: cfg.googleApiKey ? [] : ["GOOGLE_API_KEY"] },
    open_pagerank: { configured: Boolean(cfg.openPageRankApiKey), missing: cfg.openPageRankApiKey ? [] : ["OPEN_PAGERANK_API_KEY"] },
    dataforseo: {
      configured: dfsConfigured,
      login: dfsConfigured ? (cfg.dataForSeoLogin ?? "").trim() : null,
      location_code: cfg.dataForSeoLocationCode ?? 2840,
      language_code: cfg.dataForSeoLanguageCode ?? "en",
      missing: [
        !(cfg.dataForSeoLogin ?? "").trim() ? "DATAFORSEO_LOGIN" : null,
        !(cfg.dataForSeoPassword ?? "").trim() ? "DATAFORSEO_PASSWORD" : null,
      ].filter(Boolean),
    },
    not_available: {
      ahrefs_dr_competitor_backlinks: dfsConfigured
        ? "Connected via DataForSEO Backlinks API (0-100 Domain Rank, backlinks, and Competitor Link Intersect)"
        : "Set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD to unlock 0-100 DR & competitor link gap",
      search_volume_kd_cpc: dfsConfigured
        ? "Connected via DataForSEO Google Ads & Labs APIs (US market location_code 2840)"
        : "Set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD to unlock US search volume, KD%, CPC & ETV",
    },
  };
}

// ---------------- Google OAuth (service account JWT, RS256) ----------------
const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
let cachedToken: { token: string; exp: number; email: string } | null = null;

async function googleAccessToken(sa: ServiceAccount, scope: string): Promise<string> {
  const nowS = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.email === sa.client_email && cachedToken.exp - 60 > nowS) return cachedToken.token;
  const tokenUri = sa.token_uri || "https://oauth2.googleapis.com/token";
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope, aud: tokenUri, iat: nowS, exp: nowS + 3600 }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const sig = b64url(signer.sign(sa.private_key));
  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${claims}.${sig}` }),
    signal: AbortSignal.timeout(20000),
  });
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
  if (!res.ok || !j.access_token) throw new Error(`Google OAuth failed: ${j.error_description || j.error || res.status}`);
  cachedToken = { token: j.access_token, exp: nowS + (j.expires_in ?? 3600), email: sa.client_email };
  return j.access_token;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Pulls date x query x page rows from Search Console into seo_gsc_rows. */
export async function syncSearchConsole(store: SeoStore, cfg: SeoProviderConfig, days = 90, onProgress?: (rows: number) => void) {
  const sa = loadServiceAccount(cfg.gscServiceAccountJson);
  if (!sa || !cfg.gscSiteUrl) throw new Error("Search Console not configured (set GSC_SERVICE_ACCOUNT_JSON and GSC_SITE_URL)");
  const token = await googleAccessToken(sa, "https://www.googleapis.com/auth/webmasters.readonly");
  const end = new Date(Date.now() - 2 * 86400000); // GSC data lags ~2 days
  const start = new Date(end.getTime() - (Math.min(Math.max(days, 1), 480) - 1) * 86400000);
  const endpoint = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(cfg.gscSiteUrl)}/searchAnalytics/query`;
  const pageSize = 25000;
  let startRow = 0;
  let total = 0;
  for (let guard = 0; guard < 40; guard++) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ startDate: isoDay(start), endDate: isoDay(end), dimensions: ["date", "query", "page"], rowLimit: pageSize, startRow, dataState: "all" }),
      signal: AbortSignal.timeout(60000),
    });
    const j = (await res.json().catch(() => ({}))) as { rows?: Array<{ keys: string[]; clicks: number; impressions: number; ctr: number; position: number }>; error?: { message?: string } };
    if (!res.ok) throw new Error(`Search Console API error ${res.status}: ${j.error?.message ?? "unknown"}`);
    const rows = j.rows ?? [];
    store.upsertGscRows(
      rows.map((r) => ({ date: r.keys[0], query: r.keys[1], page: r.keys[2], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position }))
    );
    total += rows.length;
    onProgress?.(total);
    if (rows.length < pageSize) break;
    startRow += pageSize;
  }
  return { rows: total, start: isoDay(start), end: isoDay(end) };
}

// ---------------- PageSpeed Insights ----------------
export async function runPageSpeed(store: SeoStore, cfg: SeoProviderConfig, url: string, strategy: "mobile" | "desktop") {
  const qs = new URLSearchParams({ url, strategy });
  for (const c of ["performance", "seo", "accessibility", "best-practices"]) qs.append("category", c);
  if (cfg.googleApiKey) qs.set("key", cfg.googleApiKey);
  const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${qs}`, { signal: AbortSignal.timeout(120000) });
  const j = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new Error(`PageSpeed Insights error ${res.status}: ${j?.error?.message ?? "unknown"}`);
  const cat = j.lighthouseResult?.categories ?? {};
  const audits = j.lighthouseResult?.audits ?? {};
  const score = (k: string) => (typeof cat[k]?.score === "number" ? Math.round(cat[k].score * 100) : null);
  const num = (k: string) => (typeof audits[k]?.numericValue === "number" ? audits[k].numericValue : null);
  const field = j.loadingExperience?.metrics ?? {};
  const fp = (k: string) => (typeof field[k]?.percentile === "number" ? field[k].percentile : null);
  const cls = fp("CUMULATIVE_LAYOUT_SHIFT_SCORE");
  const row = {
    url,
    strategy,
    source: "psi",
    perf_score: score("performance"),
    seo_score: score("seo"),
    accessibility_score: score("accessibility"),
    best_practices_score: score("best-practices"),
    lab_lcp_ms: num("largest-contentful-paint"),
    lab_cls: num("cumulative-layout-shift"),
    lab_tbt_ms: num("total-blocking-time"),
    lab_fcp_ms: num("first-contentful-paint"),
    field_lcp_ms: fp("LARGEST_CONTENTFUL_PAINT_MS"),
    field_inp_ms: fp("INTERACTION_TO_NEXT_PAINT"),
    field_cls: cls === null ? null : cls / 100,
    field_ttfb_ms: fp("EXPERIMENTAL_TIME_TO_FIRST_BYTE"),
    field_category: j.loadingExperience?.overall_category ?? null,
  };
  store.upsertCwv(row);
  const failed = Object.values(audits as Record<string, any>)
    .filter((a) => a && typeof a.score === "number" && a.score < 0.9 && a.scoreDisplayMode !== "informative" && a.scoreDisplayMode !== "notApplicable" && a.title)
    .sort((a, b) => (a.score ?? 1) - (b.score ?? 1))
    .slice(0, 12)
    .map((a) => ({ id: a.id, title: a.title, score: a.score, display: a.displayValue ?? null }));
  return { ...row, opportunities: failed };
}

// ---------------- Chrome UX Report ----------------
export async function runCrux(store: SeoStore, cfg: SeoProviderConfig, target: { origin?: string; url?: string }, formFactor: "PHONE" | "DESKTOP") {
  if (!cfg.googleApiKey) throw new Error("CrUX requires GOOGLE_API_KEY");
  const res = await fetch(`https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=${encodeURIComponent(cfg.googleApiKey)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...target, formFactor }),
    signal: AbortSignal.timeout(30000),
  });
  const j = (await res.json().catch(() => ({}))) as any;
  if (res.status === 404) return { insufficient_data: true, message: "Not enough real Chrome users yet for CrUX to report this URL/origin." };
  if (!res.ok) throw new Error(`CrUX error ${res.status}: ${j?.error?.message ?? "unknown"}`);
  const m = j.record?.metrics ?? {};
  const p75 = (k: string) => {
    const v = m[k]?.percentiles?.p75;
    return v === undefined || v === null ? null : Number(v);
  };
  const row = {
    url: target.origin ?? target.url ?? "",
    strategy: formFactor === "PHONE" ? "mobile" : "desktop",
    source: "crux",
    field_lcp_ms: p75("largest_contentful_paint"),
    field_inp_ms: p75("interaction_to_next_paint"),
    field_cls: p75("cumulative_layout_shift"),
    field_ttfb_ms: p75("experimental_time_to_first_byte"),
  };
  store.upsertCwv(row);
  return { insufficient_data: false, ...row };
}

// ---------------- Open PageRank ----------------
export async function refreshOpenPageRank(store: SeoStore, cfg: SeoProviderConfig, domains: string[]) {
  if (!cfg.openPageRankApiKey) throw new Error("Set OPEN_PAGERANK_API_KEY (free at keywordseverywhere.com/account/openpagerank)");
  const uniq = [...new Set(domains.map((d) => d.toLowerCase().replace(/^www\./, "").trim()).filter(Boolean))];
  let updated = 0;
  for (let i = 0; i < uniq.length; i += 100) {
    const chunk = uniq.slice(i, i + 100);
    const qs = chunk.map((d) => `domains[]=${encodeURIComponent(d)}`).join("&");
    const res = await fetch(`https://openpagerank.keywordseverywhere.com/api/v1.0/getPageRank?${qs}`, {
      headers: { "API-OPR": cfg.openPageRankApiKey },
      signal: AbortSignal.timeout(30000),
    });
    const j = (await res.json().catch(() => ({}))) as { response?: Array<{ status_code: number; page_rank_integer: number; page_rank_decimal: number; rank: string | null; domain: string }>; error?: string };
    if (!res.ok) throw new Error(`Open PageRank error ${res.status}: ${j.error ?? "unknown"}`);
    for (const r of j.response ?? []) {
      const found = r.status_code === 200;
      store.upsertDomainMetric(r.domain, {
        opr_decimal: found ? r.page_rank_decimal : null,
        opr_integer: found ? r.page_rank_integer : null,
        opr_rank: found && r.rank ? Number(r.rank) : null,
      });
      updated++;
    }
  }
  return { updated };
}
