import { parseHtml, parseSitemap, type ParsedPage } from "./html.js";
import type { AuditIssue, IssueSeverity, SeoStore } from "./store.js";

/** Fetches a site-relative path ("/pricing") and returns the raw response (redirects NOT followed). */
export type PathFetcher = (path: string) => Promise<Response>;

export interface AuditOptions {
  /** Canonical production origin, e.g. https://sweeprcleaner.com (used for canonical / sitemap host checks). */
  siteUrl: string;
  /** Where pages were fetched from (for display): "in-process" or the live origin. */
  baseLabel: string;
  source: "local" | "live";
  fetcher: PathFetcher;
  /** Paths that must be audited even if nothing links to them (e.g. pSEO routes). */
  seedPaths?: string[];
  maxPages?: number;
  concurrency?: number;
}

interface CrawledPage {
  path: string;
  status: number;
  ms: number;
  contentType: string | null;
  location: string | null;
  depth: number;
  parsed: ParsedPage | null;
  internalTargets: string[];
  externalCount: number;
}

const SKIP_PREFIXES = ["/api/", "/v1/", "/crm", "/admin", "/dashboard", "/checkout", "/webhooks", "/dev/", "/r/", "/portal"];
const NON_HTML_EXT = /\.(exe|msi|apk|dmg|appimage|zip|png|jpe?g|gif|svg|webp|ico|css|js|json|xml|txt|pdf|woff2?|mp4)$/i;

export const AUDIT_USER_AGENT = "SweeprSEOAudit/1.0 (+https://sweeprcleaner.com)";

function normalisePath(raw: string): string {
  let p = raw.split("#")[0].split("?")[0] || "/";
  if (!p.startsWith("/")) p = "/" + p;
  p = p.replace(/\/{2,}/g, "/");
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

function parseRobotsDisallow(txt: string): string[] {
  const out: string[] = [];
  let applies = false;
  for (const line of txt.split(/\r?\n/)) {
    const l = line.split("#")[0].trim();
    if (!l) continue;
    const [k, ...rest] = l.split(":");
    const v = rest.join(":").trim();
    if (/^user-agent$/i.test(k.trim())) applies = v === "*";
    else if (applies && /^disallow$/i.test(k.trim()) && v) out.push(v);
  }
  return out;
}

const issue = (severity: IssueSeverity, code: string, finding: string, evidence: string, fix: string): AuditIssue => ({
  code,
  severity,
  finding,
  evidence,
  fix,
});

export async function runSiteAudit(store: SeoStore, opts: AuditOptions) {
  const siteOrigin = new URL(opts.siteUrl);
  const siteHosts = new Set([siteOrigin.hostname.toLowerCase(), siteOrigin.hostname.toLowerCase().replace(/^www\./, ""), "www." + siteOrigin.hostname.toLowerCase().replace(/^www\./, "")]);
  const maxPages = Math.min(Math.max(opts.maxPages ?? 150, 1), 500);
  const runId = store.startAuditRun(opts.source, opts.baseLabel);
  const siteIssues: AuditIssue[] = [];

  const readText = async (path: string) => {
    try {
      const res = await opts.fetcher(path);
      return { status: res.status, text: res.status === 200 ? await res.text() : "" };
    } catch (e) {
      return { status: 0, text: "", error: (e as Error).message };
    }
  };

  // ---- Site-level files ----
  const robots = await readText("/robots.txt");
  let disallow: string[] = [];
  if (robots.status !== 200) {
    siteIssues.push(issue("error", "robots_missing", "robots.txt is not reachable", `GET /robots.txt -> HTTP ${robots.status}`, "Serve a robots.txt at the site root."));
  } else {
    disallow = parseRobotsDisallow(robots.text);
    if (disallow.includes("/")) {
      siteIssues.push(issue("error", "robots_blocks_all", "robots.txt blocks the whole site for all crawlers", "Disallow: / under User-agent: *", "Remove the blanket Disallow unless the site should be hidden."));
    }
    if (!/^sitemap:/im.test(robots.text)) {
      siteIssues.push(issue("warning", "robots_no_sitemap", "robots.txt does not reference the sitemap", "No 'Sitemap:' line found", "Add 'Sitemap: https://<domain>/sitemap.xml' to robots.txt."));
    }
  }

  const sitemap = await readText("/sitemap.xml");
  const sitemapPaths = new Set<string>();
  if (sitemap.status !== 200) {
    siteIssues.push(issue("error", "sitemap_missing", "sitemap.xml is not reachable", `GET /sitemap.xml -> HTTP ${sitemap.status}`, "Publish an XML sitemap listing every indexable page."));
  } else {
    const locs = parseSitemap(sitemap.text);
    const foreign: string[] = [];
    for (const loc of locs) {
      try {
        const u = new URL(loc);
        if (siteHosts.has(u.hostname.toLowerCase())) sitemapPaths.add(normalisePath(u.pathname));
        else foreign.push(loc);
      } catch {
        foreign.push(loc);
      }
    }
    if (foreign.length) {
      siteIssues.push(issue("warning", "sitemap_foreign_urls", `${foreign.length} sitemap URL(s) are not on ${siteOrigin.hostname}`, foreign.slice(0, 5).join(", "), "Sitemap URLs must use the canonical host."));
    }
    if (locs.length === 0) siteIssues.push(issue("error", "sitemap_empty", "sitemap.xml contains no <loc> entries", "0 URLs parsed", "Regenerate the sitemap."));
  }

  const llms = await readText("/llms.txt");
  if (llms.status !== 200) {
    siteIssues.push(issue("notice", "llms_missing", "No llms.txt for AI answer engines", `GET /llms.txt -> HTTP ${llms.status}`, "Publish /llms.txt summarising the product for LLM crawlers."));
  }

  const isAllowed = (p: string) =>
    !SKIP_PREFIXES.some((s) => p === s.replace(/\/$/, "") || p.startsWith(s)) && !NON_HTML_EXT.test(p) && !disallow.some((d) => d !== "/" && p.startsWith(d));

  // ---- Crawl (BFS from "/" + sitemap + seeds) ----
  const queue: Array<{ path: string; depth: number | null }> = [{ path: "/", depth: 0 }];
  const seen = new Set<string>(["/"]);
  const enqueue = (p: string, depth: number | null) => {
    if (seen.has(p) || !isAllowed(p) || seen.size >= maxPages) return;
    seen.add(p);
    queue.push({ path: p, depth });
  };
  for (const p of sitemapPaths) enqueue(p, null);
  for (const p of opts.seedPaths ?? []) enqueue(normalisePath(p), null);

  const crawled = new Map<string, CrawledPage>();
  const concurrency = Math.min(Math.max(opts.concurrency ?? (opts.source === "live" ? 4 : 1), 1), 8);

  const crawlOne = async (path: string, depth: number | null): Promise<CrawledPage> => {
    const t0 = performance.now();
    let res: Response;
    try {
      res = await opts.fetcher(path);
    } catch (e) {
      return { path, status: 0, ms: Math.round(performance.now() - t0), contentType: null, location: null, depth: depth ?? -1, parsed: null, internalTargets: [], externalCount: 0 };
    }
    const contentType = res.headers.get("content-type");
    const location = res.headers.get("location");
    let parsed: ParsedPage | null = null;
    if (res.status === 200 && contentType && /text\/html/i.test(contentType)) {
      parsed = parseHtml(await res.text());
    } else {
      await res.body?.cancel().catch(() => {});
    }
    const ms = Math.round(performance.now() - t0);
    const internalTargets: string[] = [];
    let externalCount = 0;
    for (const l of parsed?.links ?? []) {
      if (/^(mailto:|tel:|javascript:|#)/i.test(l.href)) continue;
      let target: string | null = null;
      if (l.href.startsWith("/") && !l.href.startsWith("//")) target = normalisePath(l.href);
      else {
        try {
          const u = new URL(l.href, siteOrigin);
          if (siteHosts.has(u.hostname.toLowerCase())) target = normalisePath(u.pathname);
          else if (/^https?:$/.test(u.protocol)) externalCount++;
        } catch {
          /* ignore malformed */
        }
      }
      if (target) internalTargets.push(target);
    }
    if (location && res.status >= 300 && res.status < 400) {
      try {
        const u = new URL(location, siteOrigin);
        if (siteHosts.has(u.hostname.toLowerCase()) || location.startsWith("/")) internalTargets.push(normalisePath(u.pathname));
      } catch {
        /* ignore */
      }
    }
    return { path, status: res.status, ms, contentType, location, depth: depth ?? -1, parsed, internalTargets: [...new Set(internalTargets)], externalCount };
  };

  while (queue.length) {
    const batch = queue.splice(0, concurrency);
    const results = await Promise.all(batch.map((b) => crawlOne(b.path, b.depth)));
    for (const r of results) {
      crawled.set(r.path, r);
      for (const t of r.internalTargets) enqueue(t, r.depth >= 0 ? r.depth + 1 : null);
    }
  }

  // ---- Link graph: inbound counts + true click depth from "/" ----
  const inbound = new Map<string, Set<string>>();
  for (const p of crawled.values()) {
    for (const t of p.internalTargets) {
      if (t === p.path) continue;
      if (!inbound.has(t)) inbound.set(t, new Set());
      inbound.get(t)!.add(p.path);
    }
  }
  const depth = new Map<string, number>([["/", 0]]);
  const bfs = ["/"];
  while (bfs.length) {
    const cur = bfs.shift()!;
    for (const t of crawled.get(cur)?.internalTargets ?? []) {
      if (!depth.has(t) && crawled.has(t)) {
        depth.set(t, depth.get(cur)! + 1);
        bfs.push(t);
      }
    }
  }

  // ---- Per-page findings ----
  const titleOwners = new Map<string, string[]>();
  const descOwners = new Map<string, string[]>();
  for (const p of crawled.values()) {
    if (p.parsed?.title) titleOwners.set(p.parsed.title, [...(titleOwners.get(p.parsed.title) ?? []), p.path]);
    if (p.parsed?.metaDescription) descOwners.set(p.parsed.metaDescription, [...(descOwners.get(p.parsed.metaDescription) ?? []), p.path]);
  }

  let totErr = 0;
  let totWarn = 0;
  let totNotice = 0;
  let scoreSum = 0;
  let htmlPages = 0;

  for (const p of crawled.values()) {
    const issues: AuditIssue[] = [];
    const pp = p.parsed;
    const inSitemap = sitemapPaths.has(p.path);
    const linksIn = inbound.get(p.path)?.size ?? 0;
    const d = depth.get(p.path) ?? null;

    if (p.status === 0) issues.push(issue("error", "unreachable", "Page could not be fetched", "Network error / timeout", "Check the route and server logs."));
    else if (p.status >= 500) issues.push(issue("error", "http_5xx", `Server error HTTP ${p.status}`, `GET ${p.path} -> ${p.status}`, "Fix the handler; 5xx pages drop out of the index."));
    else if (p.status >= 400) issues.push(issue("error", "http_4xx", `Broken page HTTP ${p.status}`, `GET ${p.path} -> ${p.status}`, inSitemap ? "Remove it from sitemap.xml or restore the page." : "Restore the page or 301-redirect it."));
    else if (p.status >= 300) {
      issues.push(issue(inSitemap ? "warning" : "notice", "redirect", `Redirects (HTTP ${p.status})`, `Location: ${p.location ?? "?"}`, inSitemap ? "List the final URL in the sitemap, not the redirect." : "Link directly to the destination URL."));
    }
    if (inSitemap && p.status >= 400) issues.push(issue("error", "sitemap_broken", "Sitemap lists a non-200 URL", `HTTP ${p.status}`, "Keep only indexable 200 URLs in sitemap.xml."));

    // Broken internal links from this page.
    const broken = p.internalTargets.filter((t) => {
      const tp = crawled.get(t);
      return tp && (tp.status >= 400 || tp.status === 0);
    });
    if (broken.length) issues.push(issue("error", "broken_internal_links", `${broken.length} broken internal link(s)`, broken.slice(0, 5).join(", "), "Update or remove the links."));

    if (pp) {
      htmlPages++;
      const noindex = /noindex/i.test(pp.metaRobots ?? "");
      if (!pp.title) issues.push(issue("error", "title_missing", "Missing <title>", "No <title> in <head>", "Add a unique 50-60 character title with the primary keyword early."));
      else {
        const len = pp.title.length;
        if (len < 30) issues.push(issue("warning", "title_short", `Title is short (${len} chars)`, pp.title, "Aim for 50-60 characters (seo-meta-optimizer rule)."));
        if (len > 60) issues.push(issue("warning", "title_long", `Title may truncate in SERPs (${len} chars)`, pp.title, "Trim to <= 60 characters, primary keyword in first 30."));
        const dup = titleOwners.get(pp.title) ?? [];
        if (dup.length > 1) issues.push(issue("warning", "title_duplicate", `Title duplicated on ${dup.length} pages`, dup.filter((x) => x !== p.path).slice(0, 4).join(", "), "Give each page a unique title."));
      }
      if (!pp.metaDescription) issues.push(issue("warning", "meta_missing", "Missing meta description", "No <meta name=description>", "Write a 150-160 character description with a CTA."));
      else {
        const len = pp.metaDescription.length;
        if (len < 70) issues.push(issue("notice", "meta_short", `Meta description short (${len} chars)`, pp.metaDescription, "Aim for 150-160 characters."));
        if (len > 160) issues.push(issue("notice", "meta_long", `Meta description may truncate (${len} chars)`, pp.metaDescription.slice(0, 180), "Trim to <= 160 characters."));
        const dup = descOwners.get(pp.metaDescription) ?? [];
        if (dup.length > 1) issues.push(issue("warning", "meta_duplicate", `Meta description duplicated on ${dup.length} pages`, dup.filter((x) => x !== p.path).slice(0, 4).join(", "), "Write a unique description per page."));
      }
      if (pp.h1.length === 0) issues.push(issue("error", "h1_missing", "No <h1> heading", "0 <h1> elements in <body>", "Add exactly one H1 matching the page topic."));
      if (pp.h1.length > 1) issues.push(issue("warning", "h1_multiple", `${pp.h1.length} <h1> headings`, pp.h1.slice(0, 3).join(" | "), "Keep a single H1; demote others to H2 (seo-structure-architect)."));
      if (!pp.canonical) issues.push(issue("warning", "canonical_missing", "No canonical tag", "No <link rel=canonical>", `Add <link rel="canonical" href="${siteOrigin.origin}${p.path === "/" ? "/" : p.path}">.`));
      else {
        try {
          const c = new URL(pp.canonical, siteOrigin);
          if (!siteHosts.has(c.hostname.toLowerCase())) issues.push(issue("warning", "canonical_foreign", "Canonical points to another host", pp.canonical, "Canonical must point at this site's URL."));
          else if (normalisePath(c.pathname) !== p.path) issues.push(issue("notice", "canonical_other", "Canonical points to a different path", pp.canonical, "Confirm this page is meant to consolidate into the canonical target."));
        } catch {
          issues.push(issue("warning", "canonical_invalid", "Canonical URL is invalid", pp.canonical, "Use an absolute URL."));
        }
      }
      if (noindex) issues.push(issue("warning", "noindex", "Page is marked noindex", `meta robots: ${pp.metaRobots}`, "Remove noindex if this page should rank."));
      if (!inSitemap && !noindex) issues.push(issue("warning", "not_in_sitemap", "Indexable page missing from sitemap.xml", `${p.path} not in sitemap`, "Add it to sitemap.xml."));
      if (inSitemap && linksIn === 0 && p.path !== "/") issues.push(issue("warning", "orphan", "Orphan page: in sitemap but no internal links point to it", "0 inbound internal links", "Link to it from a hub page (e.g. /clean directory or footer)."));
      if (pp.wordCount < 300) issues.push(issue("notice", "thin_content", `Low word count (${pp.wordCount})`, `${pp.wordCount} words of visible text`, "Expand with unique, useful content if this page targets search traffic."));
      if (pp.imagesMissingAlt > 0) issues.push(issue("warning", "img_alt_missing", `${pp.imagesMissingAlt} image(s) missing alt text`, `${pp.imagesMissingAlt}/${pp.imageCount} images`, "Add descriptive alt attributes."));
      if (pp.jsonLdErrors > 0) issues.push(issue("error", "jsonld_invalid", `${pp.jsonLdErrors} JSON-LD block(s) fail to parse`, "JSON.parse error", "Fix the structured data syntax."));
      else if (pp.jsonLdTypes.length === 0) issues.push(issue("notice", "jsonld_missing", "No structured data", "No application/ld+json", "Add relevant schema (FAQPage, HowTo, SoftwareApplication, BreadcrumbList)."));
      if (!pp.lang) issues.push(issue("notice", "lang_missing", "<html> has no lang attribute", "lang attribute absent", 'Add <html lang="en">.'));
      if (!pp.hasViewport) issues.push(issue("warning", "viewport_missing", "No mobile viewport meta", "No <meta name=viewport>", "Add a responsive viewport meta tag."));
      if (d !== null && d > 3) issues.push(issue("notice", "deep_page", `Page is ${d} clicks from the homepage`, `click depth ${d}`, "Link it from a shallower hub page."));
      if (d === null && p.path !== "/") issues.push(issue("notice", "unreachable_from_home", "Not reachable by following links from the homepage", "Found only via sitemap/seed", "Add an internal link path from the homepage."));
    }
    if (p.ms > 1500) issues.push(issue("notice", "slow_response", `Slow response (${p.ms} ms)`, `${p.ms} ms server time`, "Cache or optimise this route (TTFB target < 600 ms)."));

    const errors = issues.filter((i) => i.severity === "error").length;
    const warnings = issues.filter((i) => i.severity === "warning").length;
    const notices = issues.filter((i) => i.severity === "notice").length;
    totErr += errors;
    totWarn += warnings;
    totNotice += notices;
    const score = Math.max(0, 100 - errors * 20 - warnings * 6 - notices);
    scoreSum += score;

    store.insertPageAudit({
      run_id: runId,
      path: p.path,
      url: `${siteOrigin.origin}${p.path}`,
      http_status: p.status,
      response_ms: p.ms,
      content_type: p.contentType,
      title: pp?.title ?? null,
      meta_description: pp?.metaDescription ?? null,
      meta_robots: pp?.metaRobots ?? null,
      canonical: pp?.canonical ?? null,
      h1_count: pp?.h1.length ?? 0,
      h2_count: pp?.h2Count ?? 0,
      word_count: pp?.wordCount ?? 0,
      links_in: linksIn,
      links_out_internal: p.internalTargets.length,
      links_out_external: p.externalCount,
      images_missing_alt: pp?.imagesMissingAlt ?? 0,
      depth: d,
      in_sitemap: inSitemap ? 1 : 0,
      schema_types: JSON.stringify(pp?.jsonLdTypes ?? []),
      score,
      issues_json: JSON.stringify(issues),
      audited_at: Math.floor(Date.now() / 1000),
    });
  }

  for (const i of siteIssues) {
    if (i.severity === "error") totErr++;
    else if (i.severity === "warning") totWarn++;
    else totNotice++;
  }
  const pages = crawled.size;
  const health = pages ? Math.round(scoreSum / pages) : 0;
  store.finishAuditRun(runId, { pages, health_score: health, errors: totErr, warnings: totWarn, notices: totNotice, site_issues: siteIssues });
  return { run_id: runId, pages, html_pages: htmlPages, health_score: health, errors: totErr, warnings: totWarn, notices: totNotice, truncated: seen.size >= maxPages };
}
