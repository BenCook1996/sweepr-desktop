import { lookup } from "node:dns/promises";
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

function isPrivateIpv4Parts(a: number, b: number, c = 0): boolean {
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224 ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 192 && b === 88 && c === 99)
  );
}

function parseIpv6Words(h: string): number[] | null {
  let ipStr = h;
  const lastColon = ipStr.lastIndexOf(":");
  if (lastColon >= 0) {
    const tail = ipStr.slice(lastColon + 1);
    if (tail.includes(".")) {
      const parts = tail.split(".").map(Number);
      if (parts.length === 4 && parts.every((p) => Number.isInteger(p) && p >= 0 && p <= 255)) {
        const hi = (parts[0] << 8) | parts[1];
        const lo = (parts[2] << 8) | parts[3];
        ipStr = `${ipStr.slice(0, lastColon)}:${hi.toString(16)}:${lo.toString(16)}`;
      }
    }
  }

  const doubleColon = ipStr.indexOf("::");
  let leftParts: string[] = [];
  let rightParts: string[] = [];

  if (doubleColon >= 0) {
    const left = ipStr.slice(0, doubleColon);
    const right = ipStr.slice(doubleColon + 2);
    leftParts = left ? left.split(":") : [];
    rightParts = right ? right.split(":") : [];
  } else {
    leftParts = ipStr.split(":");
  }

  const totalKnown = leftParts.length + rightParts.length;
  if (totalKnown > 8) return null;
  const missing = 8 - totalKnown;
  const words: number[] = [];

  for (const part of leftParts) {
    const val = Number.parseInt(part, 16);
    if (Number.isNaN(val) || val < 0 || val > 0xffff) return null;
    words.push(val);
  }
  for (let i = 0; i < missing; i++) {
    words.push(0);
  }
  for (const part of rightParts) {
    const val = Number.parseInt(part, 16);
    if (Number.isNaN(val) || val < 0 || val > 0xffff) return null;
    words.push(val);
  }

  return words.length === 8 ? words : null;
}

/** Rejects internal, loopback, link-local, multicast, and IPv4-mapped IPv6 targets so admin/SEO tools cannot be used for SSRF. */
export function isPublicHttpUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (!/^https?:$/.test(u.protocol)) return false;
  if (u.port) {
    const portNum = Number.parseInt(u.port, 10);
    if (portNum !== 80 && portNum !== 443 && portNum !== 8080 && portNum !== 8443) {
      return false;
    }
  }
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    !h ||
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    h === "metadata.google.internal" ||
    h === "0.0.0.0" ||
    h === "::" ||
    h === "::1"
  ) {
    return false;
  }
  // Rejects hex/octal or integer decimal representations (e.g. 0x7f000001 or 2130706433)
  if (/^(0x[0-9a-f]+|\d+)$/i.test(h)) return false;

  // Reject non-standard dotted notations (octal segments with leading zeros, hex segments, or <4 segments e.g. 127.1, 0177.0.0.1)
  const dotted = h.split(".");
  if (dotted.length >= 1 && dotted.length <= 4 && dotted.every((p) => /^(0x[0-9a-f]+|\d+)$/i.test(p))) {
    if (dotted.length !== 4) return false;
    if (dotted.some((p) => /^0[0-9]+$/.test(p) || /^0x/i.test(p))) return false;
  }

  const ipv = isIP(h);
  if (ipv === 4) {
    const [a, b, c] = h.split(".").map(Number);
    if (isPrivateIpv4Parts(a, b, c)) return false;
  } else if (ipv === 6) {
    const words = parseIpv6Words(h);
    if (!words) return false;
    // Unspecified (::)
    if (words.every((w) => w === 0)) return false;
    // Loopback (::1, 0:0:0:0:0:0:0:1, etc.)
    if (words.slice(0, 7).every((w) => w === 0) && words[7] === 1) return false;
    // Unique-local (fc00::/7)
    if ((words[0] & 0xfe00) === 0xfc00) return false;
    // Link-local (fe80::/10) and deprecated Site-local (fec0::/10)
    if ((words[0] & 0xfe00) === 0xfe00) return false;
    // Multicast (ff00::/8)
    if ((words[0] & 0xff00) === 0xff00) return false;
    // Discard prefix (100::/64)
    if (words[0] === 0x0100 && words[1] === 0 && words[2] === 0 && words[3] === 0) return false;
    // Documentation (2001:db8::/32) and Benchmarking (2001:2::/48)
    if (words[0] === 0x2001 && (words[1] === 0x0db8 || (words[1] === 0x0002 && words[2] === 0))) return false;
    // IPv4-mapped (::ffff:0:0/96) and IPv4-compatible (::/96)
    const isMapped = words.slice(0, 5).every((w) => w === 0) && words[5] === 0xffff;
    const isCompatible = words.slice(0, 6).every((w) => w === 0);
    if (isMapped || isCompatible) {
      const a = (words[6] >> 8) & 0xff;
      const b = words[6] & 0xff;
      const c = (words[7] >> 8) & 0xff;
      if (isPrivateIpv4Parts(a, b, c)) return false;
    }
  }
  return true;
}

export async function fetchPublicUrlSafe(initialUrl: string, timeoutMs: number, maxRedirects = 5): Promise<{ res: Response; finalUrl: string }> {
  let currentUrl = initialUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (!isPublicHttpUrl(currentUrl)) {
      throw new Error("Redirect target is not a public http(s) address");
    }
    const u = new URL(currentUrl);
    const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (isIP(host) === 0) {
      const records = await lookup(host, { all: true });
      if (!records.length) {
        throw new Error("DNS resolution returned no records");
      }
      for (const rec of records) {
        const ipLiteral = rec.family === 6 ? `[${rec.address}]` : rec.address;
        if (!isPublicHttpUrl(`${u.protocol}//${ipLiteral}/`)) {
          throw new Error("Resolved IP is not a public address");
        }
      }
    }
    const res = await fetch(currentUrl, {
      headers: BROWSER_HEADERS,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return { res, finalUrl: currentUrl };
      currentUrl = new URL(loc, currentUrl).toString();
      continue;
    }
    return { res, finalUrl: currentUrl };
  }
  throw new Error("Too many redirects");
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
  let finalUrl = sourceUrl;
  try {
    const fetched = await fetchPublicUrlSafe(sourceUrl, timeoutMs, 5);
    res = fetched.res;
    finalUrl = fetched.finalUrl;
  } catch (e) {
    return { status: "unreachable", anchor_text: null, rel: null, found_href: null, http_status: null, evidence: { checked_at: checkedAt, error: (e as Error).message } };
  }
  const html = await readCapped(res).catch(() => "");
  const cfRay = res.headers.get("cf-ray");
  const mitigated = res.headers.get("cf-mitigated");
  const evidence: Record<string, unknown> = {
    checked_at: checkedAt,
    request_url: sourceUrl,
    final_url: finalUrl,
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
      const u = new URL(href, finalUrl);
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

  const path = new URL(finalUrl).pathname;
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
