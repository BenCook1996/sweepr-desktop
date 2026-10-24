import type { DatabaseSync } from "node:sqlite";

/**
 * SEO Intelligence data layer (SQLite, same database as the CRM).
 *
 * Data provenance rule: every number stored here comes from a real observation
 * (our own crawl, a live HTTP check, an incoming bot request, or a Google / Open PageRank API response).
 * Nothing is synthesised. Metrics that need a third-party link index (true DR, competitor backlinks,
 * search volume, KD, CPC) are intentionally absent until a provider is added.
 */

export type IssueSeverity = "error" | "warning" | "notice";

/** Evidence -> Finding -> Path record (pattern borrowed from reverse-skill's ops/evidence-finding-path.md). */
export interface AuditIssue {
  code: string;
  severity: IssueSeverity;
  finding: string;
  evidence: string;
  fix: string;
}

export interface PageAuditRow {
  path: string;
  url: string;
  http_status: number;
  response_ms: number;
  content_type: string | null;
  title: string | null;
  meta_description: string | null;
  meta_robots: string | null;
  canonical: string | null;
  h1_count: number;
  h2_count: number;
  word_count: number;
  links_in: number;
  links_out_internal: number;
  links_out_external: number;
  images_missing_alt: number;
  depth: number | null;
  in_sitemap: number;
  schema_types: string; // JSON array
  score: number;
  issues_json: string; // JSON AuditIssue[]
  run_id: number;
  audited_at: number;
}

export interface AuditRunRow {
  id: number;
  source: string;
  base_url: string;
  started_at: number;
  finished_at: number | null;
  pages: number;
  health_score: number | null;
  errors: number;
  warnings: number;
  notices: number;
  site_issues_json: string;
  status: string;
}

export type BacklinkStatus =
  | "unverified"
  | "live"
  | "nofollow"
  | "missing"
  | "needs_listing_url"
  | "blocked"
  | "unreachable";

export interface BacklinkRow {
  id: number;
  outreach_id: number | null;
  source_url: string;
  source_domain: string;
  target_domain: string;
  status: BacklinkStatus;
  anchor_text: string | null;
  rel: string | null;
  found_href: string | null;
  http_status: number | null;
  evidence_json: string | null;
  last_checked_at: number | null;
  first_live_at: number | null;
  created_at: number;
}

export interface KeywordRow {
  id: number;
  keyword: string;
  cluster: string;
  target_path: string | null;
  search_volume: number | null;
  cpc: number | null;
  competition: string | null;
  competition_index: number | null;
  kd: number | null;
  search_intent: string | null;
  serp_position: number | null;
  serp_url: string | null;
  serp_etv: number | null;
  monthly_searches_json: string | null;
  dfs_updated_at: number | null;
  created_at: number;
}

export interface DomainMetricRow {
  domain: string;
  opr_decimal: number | null;
  opr_integer: number | null;
  opr_rank: number | null;
  fetched_at: number;
  dfs_rank: number | null;
  dfs_backlinks: number | null;
  dfs_dofollow_backlinks: number | null;
  dfs_referring_domains: number | null;
  dfs_dofollow_rd: number | null;
  dfs_referring_ips: number | null;
  dfs_broken_backlinks: number | null;
  dfs_spam_score: number | null;
  dfs_organic_keywords: number | null;
  dfs_organic_etv: number | null;
  dfs_traffic_cost_usd: number | null;
  dfs_pos_1: number | null;
  dfs_pos_2_3: number | null;
  dfs_pos_4_10: number | null;
  dfs_pos_11_20: number | null;
  dfs_updated_at: number | null;
}

export interface LinkGapRow {
  referring_domain: string;
  rank: number | null;
  spam_score: number | null;
  intersections_count: number;
  competitor_links_json: string;
  total_competitor_backlinks: number;
  first_seen: string | null;
  fetched_at: number;
}

export interface DfsLogRow {
  id: number;
  endpoint: string;
  status_code: number;
  cost_usd: number;
  summary: string | null;
  created_at: number;
}

function addColumnIfMissing(db: DatabaseSync, table: string, column: string, def: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
  }
}

export function ensureSeoSchema(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS seo_keywords (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword TEXT NOT NULL UNIQUE COLLATE NOCASE,
      cluster TEXT NOT NULL DEFAULT 'general',
      target_path TEXT,
      search_volume INTEGER,
      cpc REAL,
      competition TEXT,
      competition_index INTEGER,
      kd INTEGER,
      search_intent TEXT,
      serp_position INTEGER,
      serp_url TEXT,
      serp_etv REAL,
      monthly_searches_json TEXT,
      dfs_updated_at INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS seo_gsc_rows (
      date TEXT NOT NULL,
      query TEXT NOT NULL,
      page TEXT NOT NULL,
      clicks INTEGER NOT NULL,
      impressions INTEGER NOT NULL,
      ctr REAL NOT NULL,
      position REAL NOT NULL,
      PRIMARY KEY (date, query, page)
    );
    CREATE INDEX IF NOT EXISTS idx_seo_gsc_query ON seo_gsc_rows(query COLLATE NOCASE, date);
    CREATE INDEX IF NOT EXISTS idx_seo_gsc_page ON seo_gsc_rows(page, date);
    CREATE TABLE IF NOT EXISTS seo_audit_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      base_url TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      pages INTEGER NOT NULL DEFAULT 0,
      health_score INTEGER,
      errors INTEGER NOT NULL DEFAULT 0,
      warnings INTEGER NOT NULL DEFAULT 0,
      notices INTEGER NOT NULL DEFAULT 0,
      site_issues_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'running'
    );
    CREATE TABLE IF NOT EXISTS seo_page_audits (
      run_id INTEGER NOT NULL,
      path TEXT NOT NULL,
      url TEXT NOT NULL,
      http_status INTEGER NOT NULL,
      response_ms INTEGER NOT NULL,
      content_type TEXT,
      title TEXT,
      meta_description TEXT,
      meta_robots TEXT,
      canonical TEXT,
      h1_count INTEGER NOT NULL DEFAULT 0,
      h2_count INTEGER NOT NULL DEFAULT 0,
      word_count INTEGER NOT NULL DEFAULT 0,
      links_in INTEGER NOT NULL DEFAULT 0,
      links_out_internal INTEGER NOT NULL DEFAULT 0,
      links_out_external INTEGER NOT NULL DEFAULT 0,
      images_missing_alt INTEGER NOT NULL DEFAULT 0,
      depth INTEGER,
      in_sitemap INTEGER NOT NULL DEFAULT 0,
      schema_types TEXT NOT NULL DEFAULT '[]',
      score INTEGER NOT NULL DEFAULT 0,
      issues_json TEXT NOT NULL DEFAULT '[]',
      audited_at INTEGER NOT NULL,
      PRIMARY KEY (run_id, path)
    );
    CREATE TABLE IF NOT EXISTS seo_backlinks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      outreach_id INTEGER UNIQUE,
      source_url TEXT NOT NULL UNIQUE,
      source_domain TEXT NOT NULL,
      target_domain TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unverified',
      anchor_text TEXT,
      rel TEXT,
      found_href TEXT,
      http_status INTEGER,
      evidence_json TEXT,
      last_checked_at INTEGER,
      first_live_at INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS seo_bot_hits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bot TEXT NOT NULL,
      path TEXT NOT NULL,
      status INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_seo_bot_hits_time ON seo_bot_hits(created_at);
    CREATE TABLE IF NOT EXISTS seo_cwv (
      url TEXT NOT NULL,
      strategy TEXT NOT NULL,
      source TEXT NOT NULL,
      perf_score INTEGER,
      seo_score INTEGER,
      accessibility_score INTEGER,
      best_practices_score INTEGER,
      lab_lcp_ms REAL,
      lab_cls REAL,
      lab_tbt_ms REAL,
      lab_fcp_ms REAL,
      field_lcp_ms REAL,
      field_inp_ms REAL,
      field_cls REAL,
      field_ttfb_ms REAL,
      field_category TEXT,
      fetched_at INTEGER NOT NULL,
      PRIMARY KEY (url, strategy, source)
    );
    CREATE TABLE IF NOT EXISTS seo_domain_metrics (
      domain TEXT PRIMARY KEY,
      opr_decimal REAL,
      opr_integer INTEGER,
      opr_rank INTEGER,
      fetched_at INTEGER NOT NULL,
      dfs_rank INTEGER,
      dfs_backlinks INTEGER,
      dfs_dofollow_backlinks INTEGER,
      dfs_referring_domains INTEGER,
      dfs_dofollow_rd INTEGER,
      dfs_referring_ips INTEGER,
      dfs_broken_backlinks INTEGER,
      dfs_spam_score INTEGER,
      dfs_organic_keywords INTEGER,
      dfs_organic_etv REAL,
      dfs_traffic_cost_usd REAL,
      dfs_pos_1 INTEGER,
      dfs_pos_2_3 INTEGER,
      dfs_pos_4_10 INTEGER,
      dfs_pos_11_20 INTEGER,
      dfs_updated_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS seo_link_gap (
      referring_domain TEXT PRIMARY KEY,
      rank INTEGER,
      spam_score INTEGER,
      intersections_count INTEGER NOT NULL DEFAULT 1,
      competitor_links_json TEXT NOT NULL DEFAULT '{}',
      total_competitor_backlinks INTEGER NOT NULL DEFAULT 0,
      first_seen TEXT,
      fetched_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS seo_dfs_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      endpoint TEXT NOT NULL,
      status_code INTEGER NOT NULL,
      cost_usd REAL NOT NULL DEFAULT 0,
      summary TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS seo_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Idempotent column migrations for databases created under Phase 1/2.
  const kwCols: Array<[string, string]> = [
    ["search_volume", "INTEGER"],
    ["cpc", "REAL"],
    ["competition", "TEXT"],
    ["competition_index", "INTEGER"],
    ["kd", "INTEGER"],
    ["search_intent", "TEXT"],
    ["serp_position", "INTEGER"],
    ["serp_url", "TEXT"],
    ["serp_etv", "REAL"],
    ["monthly_searches_json", "TEXT"],
    ["dfs_updated_at", "INTEGER"],
  ];
  for (const [col, def] of kwCols) addColumnIfMissing(db, "seo_keywords", col, def);

  const domCols: Array<[string, string]> = [
    ["dfs_rank", "INTEGER"],
    ["dfs_backlinks", "INTEGER"],
    ["dfs_dofollow_backlinks", "INTEGER"],
    ["dfs_referring_domains", "INTEGER"],
    ["dfs_dofollow_rd", "INTEGER"],
    ["dfs_referring_ips", "INTEGER"],
    ["dfs_broken_backlinks", "INTEGER"],
    ["dfs_spam_score", "INTEGER"],
    ["dfs_organic_keywords", "INTEGER"],
    ["dfs_organic_etv", "REAL"],
    ["dfs_traffic_cost_usd", "REAL"],
    ["dfs_pos_1", "INTEGER"],
    ["dfs_pos_2_3", "INTEGER"],
    ["dfs_pos_4_10", "INTEGER"],
    ["dfs_pos_11_20", "INTEGER"],
    ["dfs_updated_at", "INTEGER"],
  ];
  for (const [col, def] of domCols) addColumnIfMissing(db, "seo_domain_metrics", col, def);
}

const nowSec = () => Math.floor(Date.now() / 1000);

export class SeoStore {
  constructor(readonly db: DatabaseSync, private readonly now: () => number = nowSec) {
    ensureSeoSchema(db);
  }

  // ---------- settings ----------
  getSetting<T>(key: string, fallback: T): T {
    const row = this.db.prepare("SELECT value FROM seo_settings WHERE key = ?").get(key) as { value: string } | undefined;
    if (!row) return fallback;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return fallback;
    }
  }
  setSetting(key: string, value: unknown) {
    this.db
      .prepare("INSERT INTO seo_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, JSON.stringify(value));
  }

  // ---------- keywords ----------
  listKeywords(): KeywordRow[] {
    return this.db.prepare("SELECT * FROM seo_keywords ORDER BY cluster, keyword").all() as unknown as KeywordRow[];
  }
  addKeyword(keyword: string, cluster = "general", targetPath: string | null = null): KeywordRow | undefined {
    const kw = keyword.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 200);
    if (!kw) return undefined;
    this.db
      .prepare("INSERT OR IGNORE INTO seo_keywords (keyword, cluster, target_path, created_at) VALUES (?, ?, ?, ?)")
      .run(kw, cluster.slice(0, 40) || "general", targetPath ? targetPath.slice(0, 300) : null, this.now());
    return this.db.prepare("SELECT * FROM seo_keywords WHERE keyword = ?").get(kw) as KeywordRow | undefined;
  }
  deleteKeyword(id: number): boolean {
    return Number(this.db.prepare("DELETE FROM seo_keywords WHERE id = ?").run(id).changes) > 0;
  }
  updateKeywordDfs(
    keyword: string,
    patch: {
      search_volume?: number | null;
      cpc?: number | null;
      competition?: string | null;
      competition_index?: number | null;
      kd?: number | null;
      search_intent?: string | null;
      serp_position?: number | null;
      serp_url?: string | null;
      serp_etv?: number | null;
      monthly_searches?: unknown;
    }
  ) {
    const kw = keyword.trim().toLowerCase().replace(/\s+/g, " ");
    if (!kw) return;
    const t = this.now();
    this.db
      .prepare(
        `UPDATE seo_keywords SET
           search_volume = COALESCE(?, search_volume),
           cpc = COALESCE(?, cpc),
           competition = COALESCE(?, competition),
           competition_index = COALESCE(?, competition_index),
           kd = COALESCE(?, kd),
           search_intent = COALESCE(?, search_intent),
           serp_position = COALESCE(?, serp_position),
           serp_url = COALESCE(?, serp_url),
           serp_etv = COALESCE(?, serp_etv),
           monthly_searches_json = COALESCE(?, monthly_searches_json),
           dfs_updated_at = ?
         WHERE keyword = ? COLLATE NOCASE`
      )
      .run(
        patch.search_volume ?? null,
        patch.cpc ?? null,
        patch.competition ?? null,
        patch.competition_index ?? null,
        patch.kd ?? null,
        patch.search_intent ?? null,
        patch.serp_position ?? null,
        patch.serp_url ?? null,
        patch.serp_etv ?? null,
        patch.monthly_searches !== undefined ? JSON.stringify(patch.monthly_searches) : null,
        t,
        kw
      );
  }

  // ---------- Google Search Console rows ----------
  upsertGscRows(rows: Array<{ date: string; query: string; page: string; clicks: number; impressions: number; ctr: number; position: number }>) {
    const stmt = this.db.prepare(`
      INSERT INTO seo_gsc_rows (date, query, page, clicks, impressions, ctr, position)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(date, query, page) DO UPDATE SET clicks = excluded.clicks, impressions = excluded.impressions,
        ctr = excluded.ctr, position = excluded.position
    `);
    this.db.exec("BEGIN");
    try {
      for (const r of rows) stmt.run(r.date, r.query, r.page, r.clicks, r.impressions, r.ctr, r.position);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  gscLatestDate(): string | null {
    const row = this.db.prepare("SELECT MAX(date) AS d FROM seo_gsc_rows").get() as { d: string | null };
    return row?.d ?? null;
  }
  gscRowCount(): number {
    return (this.db.prepare("SELECT COUNT(*) AS c FROM seo_gsc_rows").get() as { c: number }).c;
  }

  /** Aggregate GSC totals in an inclusive [from, to] date window (YYYY-MM-DD). */
  gscTotals(from: string, to: string) {
    const r = this.db
      .prepare(
        `SELECT COALESCE(SUM(clicks),0) AS clicks, COALESCE(SUM(impressions),0) AS impressions,
                CASE WHEN SUM(impressions) > 0 THEN SUM(position * impressions) / SUM(impressions) END AS position
         FROM seo_gsc_rows WHERE date BETWEEN ? AND ?`
      )
      .get(from, to) as { clicks: number; impressions: number; position: number | null };
    return { clicks: r.clicks, impressions: r.impressions, ctr: r.impressions ? r.clicks / r.impressions : 0, position: r.position };
  }
  gscDailySeries(from: string, to: string) {
    return this.db
      .prepare(
        `SELECT date, SUM(clicks) AS clicks, SUM(impressions) AS impressions
         FROM seo_gsc_rows WHERE date BETWEEN ? AND ? GROUP BY date ORDER BY date`
      )
      .all(from, to) as Array<{ date: string; clicks: number; impressions: number }>;
  }
  /** Impression-weighted position etc. for one exact query in a window. */
  gscQueryStats(query: string, from: string, to: string) {
    const r = this.db
      .prepare(
        `SELECT COALESCE(SUM(clicks),0) AS clicks, COALESCE(SUM(impressions),0) AS impressions,
                CASE WHEN SUM(impressions) > 0 THEN SUM(position * impressions) / SUM(impressions) END AS position
         FROM seo_gsc_rows WHERE query = ? COLLATE NOCASE AND date BETWEEN ? AND ?`
      )
      .get(query, from, to) as { clicks: number; impressions: number; position: number | null };
    const top = this.db
      .prepare(
        `SELECT page, SUM(impressions) AS imp FROM seo_gsc_rows
         WHERE query = ? COLLATE NOCASE AND date BETWEEN ? AND ? GROUP BY page ORDER BY imp DESC LIMIT 2`
      )
      .all(query, from, to) as Array<{ page: string; imp: number }>;
    return { ...r, ranking_url: top[0]?.page ?? null, competing_urls: top.length };
  }
  gscQuerySeries(query: string, from: string, to: string) {
    return this.db
      .prepare(
        `SELECT date, SUM(position * impressions) / SUM(impressions) AS position
         FROM seo_gsc_rows WHERE query = ? COLLATE NOCASE AND date BETWEEN ? AND ? AND impressions > 0
         GROUP BY date ORDER BY date`
      )
      .all(query, from, to) as Array<{ date: string; position: number }>;
  }
  gscTopQueries(from: string, to: string, limit = 100) {
    return this.db
      .prepare(
        `SELECT query, SUM(clicks) AS clicks, SUM(impressions) AS impressions,
                SUM(position * impressions) / SUM(impressions) AS position
         FROM seo_gsc_rows WHERE date BETWEEN ? AND ? GROUP BY query COLLATE NOCASE
         ORDER BY impressions DESC LIMIT ?`
      )
      .all(from, to, limit) as Array<{ query: string; clicks: number; impressions: number; position: number }>;
  }
  gscTopPages(from: string, to: string, limit = 50) {
    return this.db
      .prepare(
        `SELECT page, SUM(clicks) AS clicks, SUM(impressions) AS impressions,
                SUM(position * impressions) / SUM(impressions) AS position, COUNT(DISTINCT query) AS queries
         FROM seo_gsc_rows WHERE date BETWEEN ? AND ? GROUP BY page ORDER BY clicks DESC, impressions DESC LIMIT ?`
      )
      .all(from, to, limit) as Array<{ page: string; clicks: number; impressions: number; position: number; queries: number }>;
  }
  /** Queries where 2+ of our URLs each collected a meaningful share of impressions (cannibalisation candidates). */
  gscCannibalisation(from: string, to: string, minShare = 0.2) {
    const rows = this.db
      .prepare(
        `SELECT query, page, SUM(impressions) AS imp, SUM(position * impressions) / SUM(impressions) AS position
         FROM seo_gsc_rows WHERE date BETWEEN ? AND ? GROUP BY query COLLATE NOCASE, page HAVING imp > 0`
      )
      .all(from, to) as Array<{ query: string; page: string; imp: number; position: number }>;
    const byQuery = new Map<string, Array<{ page: string; imp: number; position: number }>>();
    for (const r of rows) {
      const k = r.query.toLowerCase();
      if (!byQuery.has(k)) byQuery.set(k, []);
      byQuery.get(k)!.push(r);
    }
    const out: Array<{ query: string; total_impressions: number; pages: Array<{ page: string; share: number; position: number }> }> = [];
    for (const [query, pages] of byQuery) {
      const total = pages.reduce((s, p) => s + p.imp, 0);
      const strong = pages.filter((p) => p.imp / total >= minShare);
      if (strong.length >= 2 && total >= 20) {
        out.push({
          query,
          total_impressions: total,
          pages: strong.map((p) => ({ page: p.page, share: p.imp / total, position: p.position })).sort((a, b) => b.share - a.share),
        });
      }
    }
    return out.sort((a, b) => b.total_impressions - a.total_impressions).slice(0, 50);
  }

  // ---------- audits ----------
  startAuditRun(source: string, baseUrl: string): number {
    const res = this.db
      .prepare("INSERT INTO seo_audit_runs (source, base_url, started_at, status) VALUES (?, ?, ?, 'running')")
      .run(source, baseUrl, this.now());
    return Number(res.lastInsertRowid);
  }
  finishAuditRun(
    id: number,
    summary: { pages: number; health_score: number; errors: number; warnings: number; notices: number; site_issues: AuditIssue[]; status?: string }
  ) {
    this.db
      .prepare(
        `UPDATE seo_audit_runs SET finished_at = ?, pages = ?, health_score = ?, errors = ?, warnings = ?, notices = ?,
           site_issues_json = ?, status = ? WHERE id = ?`
      )
      .run(
        this.now(),
        summary.pages,
        summary.health_score,
        summary.errors,
        summary.warnings,
        summary.notices,
        JSON.stringify(summary.site_issues),
        summary.status ?? "done",
        id
      );
  }
  insertPageAudit(row: PageAuditRow) {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO seo_page_audits (run_id, path, url, http_status, response_ms, content_type, title, meta_description,
           meta_robots, canonical, h1_count, h2_count, word_count, links_in, links_out_internal, links_out_external,
           images_missing_alt, depth, in_sitemap, schema_types, score, issues_json, audited_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        row.run_id,
        row.path,
        row.url,
        row.http_status,
        row.response_ms,
        row.content_type,
        row.title,
        row.meta_description,
        row.meta_robots,
        row.canonical,
        row.h1_count,
        row.h2_count,
        row.word_count,
        row.links_in,
        row.links_out_internal,
        row.links_out_external,
        row.images_missing_alt,
        row.depth,
        row.in_sitemap,
        row.schema_types,
        row.score,
        row.issues_json,
        row.audited_at
      );
  }
  latestAuditRun(): AuditRunRow | undefined {
    return this.db
      .prepare("SELECT * FROM seo_audit_runs WHERE status = 'done' ORDER BY id DESC LIMIT 1")
      .get() as AuditRunRow | undefined;
  }
  auditRuns(limit = 10): AuditRunRow[] {
    return this.db.prepare("SELECT * FROM seo_audit_runs ORDER BY id DESC LIMIT ?").all(limit) as unknown as AuditRunRow[];
  }
  pageAudits(runId: number): PageAuditRow[] {
    return this.db
      .prepare("SELECT * FROM seo_page_audits WHERE run_id = ? ORDER BY score ASC, path ASC")
      .all(runId) as unknown as PageAuditRow[];
  }

  // ---------- backlinks ----------
  listBacklinks(status?: string): BacklinkRow[] {
    if (status && status !== "all") {
      return this.db
        .prepare("SELECT * FROM seo_backlinks WHERE status = ? ORDER BY source_domain")
        .all(status) as unknown as BacklinkRow[];
    }
    return this.db.prepare("SELECT * FROM seo_backlinks ORDER BY source_domain").all() as unknown as BacklinkRow[];
  }
  backlinkById(id: number): BacklinkRow | undefined {
    return this.db.prepare("SELECT * FROM seo_backlinks WHERE id = ?").get(id) as BacklinkRow | undefined;
  }
  addBacklink(sourceUrl: string, targetDomain: string, outreachId: number | null = null): BacklinkRow | undefined {
    let u: URL;
    try {
      u = new URL(sourceUrl);
    } catch {
      return undefined;
    }
    if (!/^https?:$/.test(u.protocol)) return undefined;
    const domain = u.hostname.replace(/^www\./, "").toLowerCase();
    this.db
      .prepare(
        `INSERT OR IGNORE INTO seo_backlinks (outreach_id, source_url, source_domain, target_domain, status, created_at)
         VALUES (?, ?, ?, ?, 'unverified', ?)`
      )
      .run(outreachId, u.toString(), domain, targetDomain, this.now());
    return this.db.prepare("SELECT * FROM seo_backlinks WHERE source_url = ?").get(u.toString()) as BacklinkRow | undefined;
  }
  updateBacklinkUrl(id: number, sourceUrl: string): BacklinkRow | undefined {
    let u: URL;
    try {
      u = new URL(sourceUrl);
    } catch {
      return undefined;
    }
    if (!/^https?:$/.test(u.protocol)) return undefined;
    this.db
      .prepare(
        `UPDATE seo_backlinks SET source_url = ?, source_domain = ?, status = 'unverified', anchor_text = NULL, rel = NULL,
           found_href = NULL, http_status = NULL, evidence_json = NULL WHERE id = ?`
      )
      .run(u.toString(), u.hostname.replace(/^www\./, "").toLowerCase(), id);
    return this.backlinkById(id);
  }
  recordBacklinkCheck(
    id: number,
    r: { status: BacklinkStatus; anchor_text: string | null; rel: string | null; found_href: string | null; http_status: number | null; evidence: unknown }
  ) {
    const t = this.now();
    this.db
      .prepare(
        `UPDATE seo_backlinks SET status = ?, anchor_text = ?, rel = ?, found_href = ?, http_status = ?, evidence_json = ?,
           last_checked_at = ?, first_live_at = CASE WHEN ? IN ('live','nofollow') AND first_live_at IS NULL THEN ? ELSE first_live_at END
         WHERE id = ?`
      )
      .run(r.status, r.anchor_text, r.rel, r.found_href, r.http_status, JSON.stringify(r.evidence), t, r.status, t, id);
  }
  deleteBacklink(id: number): boolean {
    return Number(this.db.prepare("DELETE FROM seo_backlinks WHERE id = ?").run(id).changes) > 0;
  }
  importOutreachAsBacklinks(targetDomain: string): number {
    const rows = this.db.prepare("SELECT id, url FROM outreach_logs").all() as Array<{ id: number; url: string }>;
    let added = 0;
    this.db.exec("BEGIN");
    try {
      for (const r of rows) {
        const exists = this.db.prepare("SELECT 1 FROM seo_backlinks WHERE outreach_id = ?").get(r.id);
        if (exists) continue;
        const before = this.db.prepare("SELECT COUNT(*) AS c FROM seo_backlinks").get() as { c: number };
        this.addBacklink(r.url, targetDomain, r.id);
        const after = this.db.prepare("SELECT COUNT(*) AS c FROM seo_backlinks").get() as { c: number };
        if (after.c > before.c) added++;
      }
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    return added;
  }
  backlinkSummary() {
    const byStatus = this.db
      .prepare("SELECT status, COUNT(*) AS c FROM seo_backlinks GROUP BY status")
      .all() as Array<{ status: string; c: number }>;
    const counts: Record<string, number> = {};
    for (const r of byStatus) counts[r.status] = r.c;
    const rd = this.db
      .prepare("SELECT COUNT(DISTINCT source_domain) AS c FROM seo_backlinks WHERE status IN ('live','nofollow')")
      .get() as { c: number };
    const rdFollow = this.db
      .prepare("SELECT COUNT(DISTINCT source_domain) AS c FROM seo_backlinks WHERE status = 'live'")
      .get() as { c: number };
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const anchors = this.db
      .prepare(
        `SELECT anchor_text, COUNT(*) AS c FROM seo_backlinks WHERE status IN ('live','nofollow') AND anchor_text IS NOT NULL
         GROUP BY anchor_text ORDER BY c DESC LIMIT 10`
      )
      .all() as Array<{ anchor_text: string; c: number }>;
    return {
      tracked: total,
      by_status: counts,
      live_links: (counts.live ?? 0) + (counts.nofollow ?? 0),
      dofollow_links: counts.live ?? 0,
      referring_domains: rd.c,
      dofollow_referring_domains: rdFollow.c,
      top_anchors: anchors,
    };
  }

  // ---------- bot hits ----------
  recordBotHit(bot: string, path: string, status: number) {
    this.db.prepare("INSERT INTO seo_bot_hits (bot, path, status, created_at) VALUES (?, ?, ?, ?)").run(bot, path.slice(0, 300), status, this.now());
  }
  pruneBotHits(olderThanDays = 90) {
    this.db.prepare("DELETE FROM seo_bot_hits WHERE created_at < ?").run(this.now() - olderThanDays * 86400);
  }
  botSummary(days = 30) {
    const since = this.now() - days * 86400;
    const byBot = this.db
      .prepare(
        `SELECT bot, COUNT(*) AS hits, COUNT(DISTINCT path) AS paths, MAX(created_at) AS last_seen,
                SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END) AS errors
         FROM seo_bot_hits WHERE created_at >= ? GROUP BY bot ORDER BY hits DESC`
      )
      .all(since) as Array<{ bot: string; hits: number; paths: number; last_seen: number; errors: number }>;
    const topPaths = this.db
      .prepare(
        `SELECT path, COUNT(*) AS hits, GROUP_CONCAT(DISTINCT bot) AS bots FROM seo_bot_hits WHERE created_at >= ?
         GROUP BY path ORDER BY hits DESC LIMIT 25`
      )
      .all(since) as Array<{ path: string; hits: number; bots: string }>;
    const recent = this.db
      .prepare("SELECT bot, path, status, created_at FROM seo_bot_hits ORDER BY id DESC LIMIT 50")
      .all() as Array<{ bot: string; path: string; status: number; created_at: number }>;
    return { days, by_bot: byBot, top_paths: topPaths, recent };
  }

  // ---------- Core Web Vitals ----------
  upsertCwv(row: {
    url: string;
    strategy: string;
    source: string;
    perf_score?: number | null;
    seo_score?: number | null;
    accessibility_score?: number | null;
    best_practices_score?: number | null;
    lab_lcp_ms?: number | null;
    lab_cls?: number | null;
    lab_tbt_ms?: number | null;
    lab_fcp_ms?: number | null;
    field_lcp_ms?: number | null;
    field_inp_ms?: number | null;
    field_cls?: number | null;
    field_ttfb_ms?: number | null;
    field_category?: string | null;
  }) {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO seo_cwv (url, strategy, source, perf_score, seo_score, accessibility_score, best_practices_score,
           lab_lcp_ms, lab_cls, lab_tbt_ms, lab_fcp_ms, field_lcp_ms, field_inp_ms, field_cls, field_ttfb_ms, field_category, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        row.url,
        row.strategy,
        row.source,
        row.perf_score ?? null,
        row.seo_score ?? null,
        row.accessibility_score ?? null,
        row.best_practices_score ?? null,
        row.lab_lcp_ms ?? null,
        row.lab_cls ?? null,
        row.lab_tbt_ms ?? null,
        row.lab_fcp_ms ?? null,
        row.field_lcp_ms ?? null,
        row.field_inp_ms ?? null,
        row.field_cls ?? null,
        row.field_ttfb_ms ?? null,
        row.field_category ?? null,
        this.now()
      );
  }
  listCwv() {
    return this.db.prepare("SELECT * FROM seo_cwv ORDER BY fetched_at DESC").all() as Array<Record<string, unknown>>;
  }

  // ---------- domain authority (Open PageRank + DataForSEO) ----------
  upsertDomainMetric(domain: string, m: { opr_decimal: number | null; opr_integer: number | null; opr_rank: number | null }) {
    const d = domain.toLowerCase().replace(/^www\./, "").trim();
    const t = this.now();
    this.db
      .prepare(
        `INSERT INTO seo_domain_metrics (domain, opr_decimal, opr_integer, opr_rank, fetched_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(domain) DO UPDATE SET
           opr_decimal = excluded.opr_decimal,
           opr_integer = excluded.opr_integer,
           opr_rank = excluded.opr_rank,
           fetched_at = excluded.fetched_at`
      )
      .run(d, m.opr_decimal, m.opr_integer, m.opr_rank, t);
  }
  upsertDfsDomainMetrics(
    domain: string,
    m: {
      dfs_rank?: number | null;
      dfs_backlinks?: number | null;
      dfs_dofollow_backlinks?: number | null;
      dfs_referring_domains?: number | null;
      dfs_dofollow_rd?: number | null;
      dfs_referring_ips?: number | null;
      dfs_broken_backlinks?: number | null;
      dfs_spam_score?: number | null;
      dfs_organic_keywords?: number | null;
      dfs_organic_etv?: number | null;
      dfs_traffic_cost_usd?: number | null;
      dfs_pos_1?: number | null;
      dfs_pos_2_3?: number | null;
      dfs_pos_4_10?: number | null;
      dfs_pos_11_20?: number | null;
    }
  ) {
    const d = domain.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").trim();
    if (!d) return;
    const t = this.now();
    this.db
      .prepare(
        `INSERT INTO seo_domain_metrics (
           domain, fetched_at, dfs_rank, dfs_backlinks, dfs_dofollow_backlinks, dfs_referring_domains, dfs_dofollow_rd,
           dfs_referring_ips, dfs_broken_backlinks, dfs_spam_score, dfs_organic_keywords, dfs_organic_etv,
           dfs_traffic_cost_usd, dfs_pos_1, dfs_pos_2_3, dfs_pos_4_10, dfs_pos_11_20, dfs_updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(domain) DO UPDATE SET
           dfs_rank = COALESCE(excluded.dfs_rank, seo_domain_metrics.dfs_rank),
           dfs_backlinks = COALESCE(excluded.dfs_backlinks, seo_domain_metrics.dfs_backlinks),
           dfs_dofollow_backlinks = COALESCE(excluded.dfs_dofollow_backlinks, seo_domain_metrics.dfs_dofollow_backlinks),
           dfs_referring_domains = COALESCE(excluded.dfs_referring_domains, seo_domain_metrics.dfs_referring_domains),
           dfs_dofollow_rd = COALESCE(excluded.dfs_dofollow_rd, seo_domain_metrics.dfs_dofollow_rd),
           dfs_referring_ips = COALESCE(excluded.dfs_referring_ips, seo_domain_metrics.dfs_referring_ips),
           dfs_broken_backlinks = COALESCE(excluded.dfs_broken_backlinks, seo_domain_metrics.dfs_broken_backlinks),
           dfs_spam_score = COALESCE(excluded.dfs_spam_score, seo_domain_metrics.dfs_spam_score),
           dfs_organic_keywords = COALESCE(excluded.dfs_organic_keywords, seo_domain_metrics.dfs_organic_keywords),
           dfs_organic_etv = COALESCE(excluded.dfs_organic_etv, seo_domain_metrics.dfs_organic_etv),
           dfs_traffic_cost_usd = COALESCE(excluded.dfs_traffic_cost_usd, seo_domain_metrics.dfs_traffic_cost_usd),
           dfs_pos_1 = COALESCE(excluded.dfs_pos_1, seo_domain_metrics.dfs_pos_1),
           dfs_pos_2_3 = COALESCE(excluded.dfs_pos_2_3, seo_domain_metrics.dfs_pos_2_3),
           dfs_pos_4_10 = COALESCE(excluded.dfs_pos_4_10, seo_domain_metrics.dfs_pos_4_10),
           dfs_pos_11_20 = COALESCE(excluded.dfs_pos_11_20, seo_domain_metrics.dfs_pos_11_20),
           dfs_updated_at = excluded.dfs_updated_at`
      )
      .run(
        d,
        t,
        m.dfs_rank ?? null,
        m.dfs_backlinks ?? null,
        m.dfs_dofollow_backlinks ?? null,
        m.dfs_referring_domains ?? null,
        m.dfs_dofollow_rd ?? null,
        m.dfs_referring_ips ?? null,
        m.dfs_broken_backlinks ?? null,
        m.dfs_spam_score ?? null,
        m.dfs_organic_keywords ?? null,
        m.dfs_organic_etv ?? null,
        m.dfs_traffic_cost_usd ?? null,
        m.dfs_pos_1 ?? null,
        m.dfs_pos_2_3 ?? null,
        m.dfs_pos_4_10 ?? null,
        m.dfs_pos_11_20 ?? null,
        t
      );
  }
  domainMetrics(domains?: string[]): DomainMetricRow[] {
    if (domains && domains.length) {
      const ph = domains.map(() => "?").join(",");
      return this.db.prepare(`SELECT * FROM seo_domain_metrics WHERE domain IN (${ph})`).all(...domains) as unknown as DomainMetricRow[];
    }
    return this.db
      .prepare("SELECT * FROM seo_domain_metrics ORDER BY COALESCE(dfs_rank, opr_decimal * 10, -1) DESC")
      .all() as unknown as DomainMetricRow[];
  }

  // ---------- competitor link gap (DataForSEO domain_intersection) ----------
  replaceLinkGap(
    items: Array<{
      referring_domain: string;
      rank: number | null;
      spam_score: number | null;
      intersections_count: number;
      competitor_links: Record<string, number>;
      total_competitor_backlinks: number;
      first_seen: string | null;
    }>
  ) {
    const t = this.now();
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO seo_link_gap
        (referring_domain, rank, spam_score, intersections_count, competitor_links_json, total_competitor_backlinks, first_seen, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.db.exec("BEGIN");
    try {
      this.db.exec("DELETE FROM seo_link_gap");
      for (const it of items) {
        stmt.run(
          it.referring_domain,
          it.rank,
          it.spam_score,
          it.intersections_count,
          JSON.stringify(it.competitor_links),
          it.total_competitor_backlinks,
          it.first_seen,
          t
        );
      }
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  listLinkGap(limit = 100) {
    const rows = this.db
      .prepare("SELECT * FROM seo_link_gap ORDER BY intersections_count DESC, COALESCE(rank, 0) DESC, total_competitor_backlinks DESC LIMIT ?")
      .all(limit) as unknown as LinkGapRow[];
    return rows.map((r) => ({
      ...r,
      competitor_links: JSON.parse(r.competitor_links_json || "{}") as Record<string, number>,
      competitor_links_json: undefined,
    }));
  }
  pushLinkGapToOutreach(referringDomain: string): { outreach_id: number; already_existed: boolean } {
    const dom = referringDomain.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").trim();
    const existing = this.db
      .prepare("SELECT id FROM outreach_logs WHERE LOWER(website) = ? LIMIT 1")
      .get(dom) as { id: number } | undefined;
    if (existing) return { outreach_id: existing.id, already_existed: true };
    const gap = this.db
      .prepare("SELECT * FROM seo_link_gap WHERE referring_domain = ?")
      .get(dom) as LinkGapRow | undefined;
    const comps = gap ? Object.keys(JSON.parse(gap.competitor_links_json || "{}")).join(", ") : "competitors";
    const drLabel = gap?.rank != null ? `DR ${gap.rank} · ` : "";
    const res = this.db
      .prepare(
        `INSERT INTO outreach_logs (who, website, url, how, category, status, reached_out_at)
         VALUES (?, ?, ?, ?, ?, 'submitted', ?)`
      )
      .run(
        `Editorial / Partnerships (${dom})`,
        dom,
        `https://${dom}`,
        "DataForSEO Link Gap Prospect",
        `${drLabel}Links to ${comps}`,
        this.now()
      );
    return { outreach_id: Number(res.lastInsertRowid), already_existed: false };
  }

  // ---------- DataForSEO API spend & call ledger ----------
  recordDfsCall(endpoint: string, statusCode: number, costUsd: number, summary: string | null = null) {
    this.db
      .prepare("INSERT INTO seo_dfs_log (endpoint, status_code, cost_usd, summary, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(endpoint, statusCode, Number.isFinite(costUsd) ? costUsd : 0, summary, this.now());
  }
  dfsTotalSpend(): number {
    const r = this.db.prepare("SELECT COALESCE(SUM(cost_usd), 0) AS s FROM seo_dfs_log").get() as { s: number };
    return Number(r?.s ?? 0);
  }
  dfsRecentCalls(limit = 25): DfsLogRow[] {
    return this.db.prepare("SELECT * FROM seo_dfs_log ORDER BY id DESC LIMIT ?").all(limit) as unknown as DfsLogRow[];
  }
}

