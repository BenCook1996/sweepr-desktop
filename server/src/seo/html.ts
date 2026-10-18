/**
 * Dependency-free HTML extraction for SEO auditing. Regex-based on purpose: we only need a handful of
 * well-known tags from pages we (mostly) author ourselves, and the server has no HTML parser dependency.
 */

export interface ParsedLink {
  href: string;
  rel: string;
  text: string;
}

export interface ParsedPage {
  title: string | null;
  metaDescription: string | null;
  metaRobots: string | null;
  canonical: string | null;
  lang: string | null;
  hasViewport: boolean;
  ogTitle: string | null;
  h1: string[];
  h2Count: number;
  wordCount: number;
  links: ParsedLink[];
  imagesMissingAlt: number;
  imageCount: number;
  jsonLdTypes: string[];
  jsonLdErrors: number;
  hreflangCount: number;
}

const decodeEntities = (s: string) =>
  s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));

const stripTags = (s: string) => decodeEntities(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

/** Reads an attribute value from a single tag's source. */
export function attr(tag: string, name: string): string | null {
  const re = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i");
  const m = tag.match(re);
  if (!m) return null;
  return decodeEntities(m[1] ?? m[2] ?? m[3] ?? "");
}

function metaContent(html: string, key: "name" | "property", value: string): string | null {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const t of tags) {
    const v = attr(t, key);
    if (v && v.toLowerCase() === value) return attr(t, "content");
  }
  return null;
}

function collectTypes(node: unknown, out: Set<string>) {
  if (Array.isArray(node)) {
    for (const n of node) collectTypes(n, out);
    return;
  }
  if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    const t = o["@type"];
    if (typeof t === "string") out.add(t);
    else if (Array.isArray(t)) t.forEach((x) => typeof x === "string" && out.add(x));
    for (const v of Object.values(o)) if (v && typeof v === "object") collectTypes(v, out);
  }
}

export function parseHtml(html: string): ParsedPage {
  const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? html;
  const titleRaw = head.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const canonicalTag = (head.match(/<link\b[^>]*>/gi) ?? []).find((t) => (attr(t, "rel") ?? "").toLowerCase().split(/\s+/).includes("canonical"));
  const hreflangCount = (head.match(/<link\b[^>]*>/gi) ?? []).filter((t) => attr(t, "hreflang")).length;
  const htmlTag = html.match(/<html\b[^>]*>/i)?.[0] ?? "";

  // JSON-LD before stripping scripts.
  const types = new Set<string>();
  let jsonLdErrors = 0;
  const ldRe = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(ldRe)) {
    try {
      collectTypes(JSON.parse(m[1].trim()), types);
    } catch {
      jsonLdErrors++;
    }
  }

  const body = (html.match(/<body\b[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? html)
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

  const h1 = [...body.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => stripTags(m[1]));
  const h2Count = (body.match(/<h2\b/gi) ?? []).length;

  const links: ParsedLink[] = [];
  for (const m of body.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const tag = `<a${m[1]}>`;
    const href = attr(tag, "href");
    if (!href) continue;
    const imgAlt = m[2].match(/<img\b[^>]*>/i)?.[0];
    links.push({ href: href.trim(), rel: (attr(tag, "rel") ?? "").toLowerCase(), text: stripTags(m[2]) || (imgAlt ? attr(imgAlt, "alt") ?? "" : "") });
  }

  const imgs = body.match(/<img\b[^>]*>/gi) ?? [];
  const imagesMissingAlt = imgs.filter((t) => attr(t, "alt") === null).length;

  const text = stripTags(body);
  const wordCount = text ? text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length : 0;

  return {
    title: titleRaw ? stripTags(titleRaw) : null,
    metaDescription: metaContent(head, "name", "description"),
    metaRobots: metaContent(head, "name", "robots"),
    canonical: canonicalTag ? attr(canonicalTag, "href") : null,
    lang: attr(htmlTag, "lang"),
    hasViewport: metaContent(head, "name", "viewport") !== null,
    ogTitle: metaContent(head, "property", "og:title"),
    h1,
    h2Count,
    wordCount,
    links,
    imagesMissingAlt,
    imageCount: imgs.length,
    jsonLdTypes: [...types],
    jsonLdErrors,
    hreflangCount,
  };
}

/** Extracts <loc> entries from a sitemap or sitemap index. */
export function parseSitemap(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => decodeEntities(m[1]));
}
