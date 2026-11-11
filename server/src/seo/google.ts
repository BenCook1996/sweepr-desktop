import { createSign } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SeoStore } from "./store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_INDEXING_QUEUE_PATH = path.resolve(__dirname, "../data/indexing-queue.json");

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

interface OAuthRefreshCredential {
  client_id: string;
  client_secret: string;
  refresh_token: string;
  token_uri?: string;
}

function parseCredentialText(raw: string | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  if (v.startsWith("{")) return v;
  if (existsSync(v)) {
    try {
      return readFileSync(v, "utf8");
    } catch {
      return null;
    }
  }
  try {
    const decoded = Buffer.from(v, "base64").toString("utf8");
    if (decoded.trim().startsWith("{")) return decoded;
  } catch {
    /* ignore */
  }
  return null;
}

export function loadServiceAccount(raw: string | undefined): ServiceAccount | null {
  const text = parseCredentialText(raw);
  if (!text) return null;
  try {
    const j = JSON.parse(text);
    if (typeof j.client_email === "string" && typeof j.private_key === "string") return j as ServiceAccount;
  } catch {
    /* fallthrough */
  }
  return null;
}

export function loadOAuthRefreshCredential(raw: string | undefined): OAuthRefreshCredential | null {
  const text = parseCredentialText(raw);
  if (!text) return null;
  try {
    const j = JSON.parse(text);
    if (
      typeof j.client_id === "string" &&
      typeof j.client_secret === "string" &&
      typeof j.refresh_token === "string"
    ) {
      return j as OAuthRefreshCredential;
    }
  } catch {
    /* fallthrough */
  }
  return null;
}

export function resolveGscConfig(cfg: SeoProviderConfig, store?: SeoStore) {
  const runtimeSiteUrl = store?.getSetting<string>("gsc_site_url", "")?.trim() || "";
  const defaultDomainProp = cfg.siteUrl?.includes("sweeprcleaner.com") ? "sc-domain:sweeprcleaner.com" : "";
  const siteUrl = runtimeSiteUrl || (cfg.gscSiteUrl ?? "").trim() || defaultDomainProp;

  const runtimeCredRaw = store?.getSetting<string>("gsc_service_account_json", "")?.trim() || "";
  const credRaw = runtimeCredRaw || (cfg.gscServiceAccountJson ?? "").trim();

  const sa = loadServiceAccount(credRaw);
  const oauth = sa ? null : loadOAuthRefreshCredential(credRaw);
  const rows = store?.gscRowCount() ?? 0;
  const latestDate = store?.gscLatestDate() ?? null;
  const apiConfigured = Boolean((sa || oauth) && siteUrl);
  const configured = Boolean(apiConfigured || (rows > 0 && siteUrl));
  const authMode: "service_account" | "oauth_refresh_token" | "ingest_bridge" | "none" = sa
    ? "service_account"
    : oauth
      ? "oauth_refresh_token"
      : rows > 0
        ? "ingest_bridge"
        : "none";

  return {
    siteUrl,
    sa,
    oauth,
    rows,
    latestDate,
    apiConfigured,
    configured,
    authMode,
  };
}

export function resolveGoogleApiKey(cfg: SeoProviderConfig, store?: SeoStore): string {
  const runtimeKey = store?.getSetting<string>("google_api_key", "")?.trim() || "";
  return runtimeKey || (cfg.googleApiKey ?? "").trim();
}

export function providerStatus(cfg: SeoProviderConfig, store?: SeoStore) {
  const gsc = resolveGscConfig(cfg, store);
  const googleApiKey = resolveGoogleApiKey(cfg, store);
  const dfsConfigured = Boolean((cfg.dataForSeoLogin ?? "").trim() && (cfg.dataForSeoPassword ?? "").trim());
  const lastSitemapSubmit = store?.getSetting<Record<string, unknown> | null>("gsc_last_sitemap_submit", null) ?? null;
  const inspectionLedger = store?.getSetting<Array<Record<string, unknown>>>("gsc_url_inspection_ledger", []) ?? [];
  return {
    site_url: cfg.siteUrl,
    gsc: {
      configured: gsc.configured,
      api_credentials_configured: gsc.apiConfigured,
      auth_mode: gsc.authMode,
      site_url: gsc.siteUrl || null,
      service_account:
        gsc.sa?.client_email ??
        (gsc.oauth ? "oauth_authorized_user" : gsc.rows > 0 ? "verified_gsc_telemetry_bridge" : null),
      rows: gsc.rows,
      latest_date: gsc.latestDate,
      last_sitemap_submit: lastSitemapSubmit,
      inspected_urls_count: inspectionLedger.length,
      missing: gsc.configured
        ? []
        : [
            !gsc.sa && !gsc.oauth ? "GSC_SERVICE_ACCOUNT_JSON" : null,
            !gsc.siteUrl ? "GSC_SITE_URL" : null,
          ].filter(Boolean),
    },
    pagespeed: { configured: true, keyed: Boolean(googleApiKey), note: googleApiKey ? null : "Works without a key at low quota; set GOOGLE_API_KEY for 25k/day." },
    crux: { configured: Boolean(googleApiKey), missing: googleApiKey ? [] : ["GOOGLE_API_KEY"] },
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

// ---------------- Google OAuth (service account JWT RS256 + OAuth2 refresh token) ----------------
const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
let cachedToken: { token: string; exp: number; email: string } | null = null;

async function googleAccessToken(sa: ServiceAccount, scope: string): Promise<string> {
  const nowS = Math.floor(Date.now() / 1000);
  const cacheKey = `${sa.client_email}:${scope}`;
  if (cachedToken && cachedToken.email === cacheKey && cachedToken.exp - 60 > nowS) return cachedToken.token;
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
  cachedToken = { token: j.access_token, exp: nowS + (j.expires_in ?? 3600), email: cacheKey };
  return j.access_token;
}

async function googleOAuthRefreshToken(oauth: OAuthRefreshCredential): Promise<string> {
  const nowS = Math.floor(Date.now() / 1000);
  const cacheKey = `oauth:${oauth.client_id}`;
  if (cachedToken && cachedToken.email === cacheKey && cachedToken.exp - 60 > nowS) return cachedToken.token;
  const tokenUri = oauth.token_uri || "https://oauth2.googleapis.com/token";
  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: oauth.client_id,
      client_secret: oauth.client_secret,
      refresh_token: oauth.refresh_token,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(20000),
  });
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
  if (!res.ok || !j.access_token) throw new Error(`Google OAuth refresh failed: ${j.error_description || j.error || res.status}`);
  cachedToken = { token: j.access_token, exp: nowS + (j.expires_in ?? 3600), email: cacheKey };
  return j.access_token;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Pulls date x query x page rows from Search Console into seo_gsc_rows. */
export async function syncSearchConsole(store: SeoStore, cfg: SeoProviderConfig, days = 90, onProgress?: (rows: number) => void) {
  const gsc = resolveGscConfig(cfg, store);
  if ((!gsc.sa && !gsc.oauth) || !gsc.siteUrl) {
    if (gsc.rows > 0 && gsc.siteUrl) {
      return {
        rows: gsc.rows,
        start: isoDay(new Date(Date.now() - 28 * 86400000)),
        end: gsc.latestDate ?? isoDay(new Date()),
        mode: "ingest_bridge",
      };
    }
    throw new Error("Search Console not configured (set GSC_SERVICE_ACCOUNT_JSON and GSC_SITE_URL or POST /api/crm/seo/gsc/ingest)");
  }
  const token = gsc.sa
    ? await googleAccessToken(gsc.sa, "https://www.googleapis.com/auth/webmasters.readonly")
    : await googleOAuthRefreshToken(gsc.oauth!);
  const end = new Date(Date.now() - 2 * 86400000); // GSC data lags ~2 days
  const start = new Date(end.getTime() - (Math.min(Math.max(days, 1), 480) - 1) * 86400000);
  const endpoint = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(gsc.siteUrl)}/searchAnalytics/query`;
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
  return { rows: total, start: isoDay(start), end: isoDay(end), mode: gsc.authMode };
}

// ---------------- PageSpeed Insights ----------------
export async function runPageSpeed(store: SeoStore, cfg: SeoProviderConfig, url: string, strategy: "mobile" | "desktop") {
  const qs = new URLSearchParams({ url, strategy });
  for (const c of ["performance", "seo", "accessibility", "best-practices"]) qs.append("category", c);
  const apiKey = resolveGoogleApiKey(cfg, store);
  if (apiKey) qs.set("key", apiKey);
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
  const apiKey = resolveGoogleApiKey(cfg, store);
  if (!apiKey) throw new Error("CrUX requires GOOGLE_API_KEY");
  const res = await fetch(`https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=${encodeURIComponent(apiKey)}`, {
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

// ---------------- Google Search Console Sitemaps API (Free Service Account) ----------------
export async function submitGscSitemap(
  store: SeoStore,
  cfg: SeoProviderConfig,
  sitemapUrl?: string
): Promise<{
  ok: boolean;
  submitted: boolean;
  mode: string;
  sitemap_url: string;
  site_url: string | null;
  submitted_at: string;
  note?: string;
}> {
  const gsc = resolveGscConfig(cfg, store);
  const targetSitemap = sitemapUrl || `${(cfg.siteUrl || "https://sweeprcleaner.com").replace(/\/$/, "")}/sitemap.xml`;
  const submittedAt = new Date().toISOString();

  if ((!gsc.sa && !gsc.oauth) || !gsc.siteUrl) {
    const fallback = {
      ok: true,
      submitted: false,
      mode: gsc.authMode,
      sitemap_url: targetSitemap,
      site_url: gsc.siteUrl || null,
      submitted_at: submittedAt,
      note: "Service account credentials not set yet; using IndexNow + sitemap.xml crawl bridge.",
    };
    store.setSetting("gsc_last_sitemap_submit", fallback);
    return fallback;
  }

  const token = gsc.sa
    ? await googleAccessToken(gsc.sa, "https://www.googleapis.com/auth/webmasters")
    : await googleOAuthRefreshToken(gsc.oauth!);

  const endpoint = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(
    gsc.siteUrl
  )}/sitemaps/${encodeURIComponent(targetSitemap)}`;

  const res = await fetch(endpoint, {
    method: "PUT",
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(`GSC Sitemaps API error ${res.status}: ${errBody.error?.message ?? res.statusText}`);
  }

  const record = {
    ok: true,
    submitted: true,
    mode: gsc.authMode,
    sitemap_url: targetSitemap,
    site_url: gsc.siteUrl,
    submitted_at: submittedAt,
  };
  store.setSetting("gsc_last_sitemap_submit", record);
  return record;
}

// ---------------- Google Search Console URL Inspection API (Free 2,000/day Service Account Quota) ----------------
export interface GscUrlInspectionResult {
  url: string;
  inspected_at: string;
  verdict: string;
  coverage_state: string;
  indexing_state: string;
  last_crawl_time: string | null;
  google_canonical: string | null;
}

export async function inspectGscPriorityUrls(
  store: SeoStore,
  cfg: SeoProviderConfig,
  opts?: {
    urls?: string[];
    maxUrls?: number;
    persistQueue?: boolean;
    queueFilePath?: string;
  }
): Promise<{
  ok: boolean;
  mode: string;
  inspected_count: number;
  indexed_pass_count: number;
  results: GscUrlInspectionResult[];
}> {
  const gsc = resolveGscConfig(cfg, store);
  const maxUrls = Math.min(20, Math.max(1, opts?.maxUrls ?? 6));
  const queuePath = opts?.queueFilePath || DEFAULT_INDEXING_QUEUE_PATH;

  let candidateUrls: string[] = Array.isArray(opts?.urls) ? [...opts!.urls!] : [];
  let queueData: { pending?: string[]; submitted?: string[]; [k: string]: unknown } = {};
  if (candidateUrls.length === 0 && existsSync(queuePath)) {
    try {
      queueData = JSON.parse(readFileSync(queuePath, "utf8")) || {};
      if (Array.isArray(queueData.pending) && queueData.pending.length > 0) {
        candidateUrls = queueData.pending.slice(0, maxUrls);
      } else if (Array.isArray(queueData.submitted) && queueData.submitted.length > 0) {
        candidateUrls = queueData.submitted.slice(0, maxUrls);
      }
    } catch {}
  }

  if (candidateUrls.length === 0) {
    const base = (cfg.siteUrl || "https://sweeprcleaner.com").replace(/\/$/, "");
    candidateUrls = [
      `${base}/`,
      `${base}/clean`,
      `${base}/safe-to-delete`,
      `${base}/vs/ccleaner`,
      `${base}/clean/folder/winsxs`,
      `${base}/clean/app/discord-cache`,
    ].slice(0, maxUrls);
  }

  if ((!gsc.sa && !gsc.oauth) || !gsc.siteUrl) {
    return {
      ok: true,
      mode: gsc.authMode,
      inspected_count: 0,
      indexed_pass_count: 0,
      results: [],
    };
  }

  const token = gsc.sa
    ? await googleAccessToken(gsc.sa, "https://www.googleapis.com/auth/webmasters.readonly")
    : await googleOAuthRefreshToken(gsc.oauth!);

  const results: GscUrlInspectionResult[] = [];
  const indexedUrls = new Set<string>();

  for (const url of candidateUrls.slice(0, maxUrls)) {
    try {
      const res = await fetch("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          inspectionUrl: url,
          siteUrl: gsc.siteUrl,
          languageCode: "en-US",
        }),
        signal: AbortSignal.timeout(25000),
      });
      if (!res.ok) continue;
      const j = (await res.json().catch(() => ({}))) as any;
      const idxResult = j?.inspectionResult?.indexStatusResult ?? {};
      const verdict = String(idxResult.verdict || "VERDICT_UNSPECIFIED");
      const coverageState = String(idxResult.coverageState || "Unknown");
      const indexingState = String(idxResult.indexingState || "INDEXING_STATE_UNSPECIFIED");
      const lastCrawlTime = idxResult.lastCrawlTime ? String(idxResult.lastCrawlTime) : null;
      const googleCanonical = idxResult.googleCanonical ? String(idxResult.googleCanonical) : null;

      if (verdict === "PASS") {
        indexedUrls.add(url);
      }

      results.push({
        url,
        inspected_at: new Date().toISOString(),
        verdict,
        coverage_state: coverageState,
        indexing_state: indexingState,
        last_crawl_time: lastCrawlTime,
        google_canonical: googleCanonical,
      });
    } catch {
      // non-fatal per-URL inspection error
    }
  }

  const existingLedger = store.getSetting<GscUrlInspectionResult[]>("gsc_url_inspection_ledger", []) ?? [];
  const byUrl = new Map<string, GscUrlInspectionResult>();
  for (const item of existingLedger) {
    if (item && item.url) byUrl.set(item.url, item);
  }
  for (const item of results) {
    byUrl.set(item.url, item);
  }
  store.setSetting("gsc_url_inspection_ledger", [...byUrl.values()].slice(-200));

  if (indexedUrls.size > 0 && opts?.persistQueue !== false && existsSync(queuePath)) {
    try {
      const currentQ = JSON.parse(readFileSync(queuePath, "utf8")) || {};
      if (Array.isArray(currentQ.pending)) {
        currentQ.pending = currentQ.pending.filter((u: string) => !indexedUrls.has(u));
        writeFileSync(queuePath, JSON.stringify(currentQ, null, 2) + "\n", "utf8");
      }
    } catch {}
  }

  return {
    ok: true,
    mode: gsc.authMode,
    inspected_count: results.length,
    indexed_pass_count: indexedUrls.size,
    results,
  };
}

// ---------------- A21: Unified Cloud Google Search Console, Sitemap, URL Inspection & CWV Sync ----------------
export async function runCloudGoogleSeoSync(
  store: SeoStore,
  cfg: SeoProviderConfig,
  opts?: {
    days?: number;
    maxInspectUrls?: number;
    runCwv?: boolean;
    persistQueue?: boolean;
  }
) {
  const gsc = resolveGscConfig(cfg, store);
  const googleApiKey = resolveGoogleApiKey(cfg, store);

  let searchAnalytics = {
    rows: gsc.rows,
    mode: gsc.authMode,
    synced_live: false,
  };

  if ((gsc.sa || gsc.oauth) && gsc.siteUrl) {
    try {
      const syncRes = await syncSearchConsole(store, cfg, opts?.days ?? 90);
      searchAnalytics = {
        rows: syncRes.rows,
        mode: syncRes.mode as any,
        synced_live: syncRes.mode === "service_account" || syncRes.mode === "oauth_refresh_token",
      };
    } catch (err: any) {
      searchAnalytics = {
        rows: gsc.rows,
        mode: gsc.authMode,
        synced_live: false,
      };
    }
  }

  let sitemapSubmit = {
    submitted: false,
    sitemap_url: `${(cfg.siteUrl || "https://sweeprcleaner.com").replace(/\/$/, "")}/sitemap.xml`,
  };
  try {
    const smRes = await submitGscSitemap(store, cfg);
    sitemapSubmit = {
      submitted: smRes.submitted,
      sitemap_url: smRes.sitemap_url,
    };
  } catch {}

  let urlInspection = {
    inspected_count: 0,
    indexed_pass_count: 0,
  };
  try {
    const inspRes = await inspectGscPriorityUrls(store, cfg, {
      maxUrls: opts?.maxInspectUrls ?? 6,
      persistQueue: opts?.persistQueue,
    });
    urlInspection = {
      inspected_count: inspRes.inspected_count,
      indexed_pass_count: inspRes.indexed_pass_count,
    };
  } catch {}

  let cwvChecked = 0;
  if (opts?.runCwv && googleApiKey) {
    const base = (cfg.siteUrl || "https://sweeprcleaner.com").replace(/\/$/, "");
    for (const targetUrl of [`${base}/`, `${base}/pricing`, `${base}/clean`]) {
      try {
        await runPageSpeed(store, cfg, targetUrl, "mobile");
        cwvChecked++;
      } catch {}
    }
    try {
      await runCrux(store, cfg, { origin: base }, "PHONE");
    } catch {}
  }

  const ga4PropertyId = (process.env.GA4_PROPERTY_ID || "559447184").trim();
  let ga4Sync: {
    property_id: string;
    synced_live: boolean;
    active_users_28d?: number;
    sessions_28d?: number;
    engagement_rate_pct?: number;
    total_events_28d?: number;
    error?: string;
  } = {
    property_id: ga4PropertyId,
    synced_live: false,
  };

  if (gsc.sa && ga4PropertyId) {
    try {
      const ga4Token = await googleAccessToken(gsc.sa, "https://www.googleapis.com/auth/analytics.readonly");
      const ga4Res = await fetch(
        `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(ga4PropertyId)}:runReport`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${ga4Token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            dateRanges: [{ startDate: "28daysAgo", endDate: "today" }],
            metrics: [
              { name: "activeUsers" },
              { name: "sessions" },
              { name: "engagementRate" },
              { name: "eventCount" },
            ],
          }),
          signal: AbortSignal.timeout(15000),
        }
      );
      if (ga4Res.ok) {
        const ga4Json = (await ga4Res.json().catch(() => ({}))) as any;
        const mVals = ga4Json?.rows?.[0]?.metricValues ?? [];
        ga4Sync = {
          property_id: ga4PropertyId,
          synced_live: true,
          active_users_28d: Number(mVals[0]?.value ?? 0),
          sessions_28d: Number(mVals[1]?.value ?? 0),
          engagement_rate_pct: Number((Number(mVals[2]?.value ?? 0) * 100).toFixed(2)),
          total_events_28d: Number(mVals[3]?.value ?? 0),
        };
        store.setSetting("ga4_last_cloud_report", ga4Sync);
      } else {
        const errBody = (await ga4Res.json().catch(() => ({}))) as any;
        ga4Sync = {
          property_id: ga4PropertyId,
          synced_live: false,
          error: `HTTP ${ga4Res.status}: ${errBody?.error?.message ?? ga4Res.statusText}`,
        };
      }
    } catch (err: any) {
      ga4Sync = {
        property_id: ga4PropertyId,
        synced_live: false,
        error: String(err?.message || err),
      };
    }
  }

  const summary = {
    ok: true,
    auth_mode: gsc.authMode,
    service_account_email: gsc.sa?.client_email ?? null,
    gsc_rows_synced: searchAnalytics.rows,
    gsc_synced_live: searchAnalytics.synced_live,
    sitemap_submitted: sitemapSubmit.submitted,
    urls_inspected: urlInspection.inspected_count,
    urls_indexed_pass: urlInspection.indexed_pass_count,
    google_api_key_configured: Boolean(googleApiKey),
    cwv_pages_checked: cwvChecked,
    ga4: ga4Sync,
    synced_at: new Date().toISOString(),
  };

  store.setSetting("a21_cloud_google_sync_last_summary", summary);
  return summary;
}

