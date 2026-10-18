import { isIP } from "node:net";
import { attr } from "./html.js";
import type { BacklinkRow, BacklinkStatus, SeoStore } from "./store.js";

/**
 * Live backlink verifier.
 *
 * Uses a real browser header set first because many directories sit behind Cloudflare/CDN WAFs that return
 * 403 to bare datacenter clients (playbook from reverse-skill pentest-tools/references/recon-pipeline.md §0.1).
 * A challenge page is recorded as `blocked` (needs a manual check), never as `missing`.
 */

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-GB,en;q=0.9",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Dest": "document",
  "Upgrade-Insecure-Requests": "1",
};

const MAX_BYTES = 3 * 1024 * 1024;

/** Rejects obviously internal targets so the admin tool can't be pointed at the host's private network. */
export function isPublicHttpUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (!/^https?:$/.test(u.protocol)) return false;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return false;
  const ipv = isIP(h);
  if (ipv === 4) {
    const [a, b] = h.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return false;
  } else if (ipv === 6) {
    if (h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80")) return false;
  }
  return true;
}

async function readCapped(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    chunks.push(value);
    if (total >= MAX_BYTES) {
      await reader.cancel().catch(() => {});
      break;
    }
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
}

export interface BacklinkCheckResult {
  status: BacklinkStatus;
  anchor_text: string | null;
  rel: string | null;
  found_href: string | null;
  http_status: number | null;
  evidence: Record<string, unknown>;
}

export async function checkBacklink(sourceUrl: string, targetDomain: string, timeoutMs = 15000): Promise<BacklinkCheckResult> {
  const checkedAt = new Date().toISOString();
  const target = targetDomain.toLowerCase().replace(/^www\./, "");
  if (!isPublicHttpUrl(sourceUrl)) {
    return { status: "unreachable", anchor_text: null, rel: null, found_href: null, http_status: null, evidence: { checked_at: checkedAt, error: "URL is not a public http(s) address" } };
  }
  let res: Response;
  try {
    res = await fetch(sourceUrl, { headers: BROWSER_HEADERS, redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    return { status: "unreachable", anchor_text: null, rel: null, found_href: null, http_status: null, evidence: { checked_at: checkedAt, error: (e as Error).message } };
  }
  const html = await readCapped(res).catch(() => "");
  const cfRay = res.headers.get("cf-ray");
  const mitigated = res.headers.get("cf-mitigated");
  const evidence: Record<string, unknown> = {
    checked_at: checkedAt,
    request_url: sourceUrl,
    final_url: res.url,
    http_status: res.status,
    server: res.headers.get("server"),
    cf_ray: cfRay,
    bytes_read: html.length,
  };

  const challenged =
    mitigated === "challenge" ||
    ((res.status === 403 || res.status === 429 || res.status === 503) && (cfRay || /cf-chl|challenge-platform|just a moment|attention required/i.test(html)));
  if (challenged) {
    return { status: "blocked", anchor_text: null, rel: null, found_href: null, http_status: res.status, evidence: { ...evidence, note: "Bot challenge / WAF - verify manually in a browser" } };
  }
  if (res.status >= 400) {
    return { status: "unreachable", anchor_text: null, rel: null, found_href: null, http_status: res.status, evidence };
  }

  // Look for <a href> pointing at the target domain (any subdomain).
  const matches: Array<{ href: string; rel: string; text: string }> = [];
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const tag = `<a${m[1]}>`;
    const href = attr(tag, "href");
    if (!href) continue;
    try {
      const u = new URL(href, res.url || sourceUrl);
      const host = u.hostname.toLowerCase().replace(/^www\./, "");
      if (host === target || host.endsWith("." + target)) {
        const text = m[2].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
        matches.push({ href: u.toString(), rel: (attr(tag, "rel") ?? "").toLowerCase(), text: text || "(image/empty anchor)" });
      }
    } catch {
      /* ignore */
    }
  }
  const mentions = (html.match(new RegExp(target.replace(/\./g, "\\."), "gi")) ?? []).length;
  evidence.links_to_target = matches.length;
  evidence.text_mentions = mentions;

  if (matches.length) {
    // Prefer a followed link if any exists.
    const followed = matches.find((x) => !/\b(nofollow|ugc|sponsored)\b/.test(x.rel));
    const best = followed ?? matches[0];
    return {
      status: followed ? "live" : "nofollow",
      anchor_text: best.text.slice(0, 200),
      rel: best.rel || null,
      found_href: best.href,
      http_status: res.status,
      evidence: { ...evidence, sample_links: matches.slice(0, 5) },
    };
  }

  const path = new URL(res.url || sourceUrl).pathname;
  const isHomepage = path === "/" || path === "";
  return {
    status: isHomepage ? "needs_listing_url" : "missing",
    anchor_text: null,
    rel: null,
    found_href: null,
    http_status: res.status,
    evidence: { ...evidence, note: isHomepage ? "Checked a homepage. Add the exact listing/article URL to verify the link." : mentions ? "Domain mentioned in text but not linked (unlinked mention)" : "No link to target found" },
  };
}

export async function verifyBacklinks(
  store: SeoStore,
  rows: BacklinkRow[],
  onProgress?: (done: number, total: number) => void,
  concurrency = 6
) {
  let done = 0;
  const queue = [...rows];
  const tally: Record<string, number> = {};
  const worker = async () => {
    while (queue.length) {
      const row = queue.shift()!;
      const r = await checkBacklink(row.source_url, row.target_domain);
      store.recordBacklinkCheck(row.id, r);
      tally[r.status] = (tally[r.status] ?? 0) + 1;
      done++;
      onProgress?.(done, rows.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length || 1) }, worker));
  return { checked: done, by_status: tally };
}
