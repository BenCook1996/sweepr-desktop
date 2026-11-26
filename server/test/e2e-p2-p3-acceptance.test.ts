import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { serve, type ServerType } from "@hono/node-server";
import { createHash, generateKeyPairSync } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), ".."));

import { openDb } from "../src/db.js";
import { createApp } from "../src/app.js";
import { TRANSACTIONAL_TOOLS, renderTransactionalToolPage } from "../src/transactional-tools.js";
import { parseHtml } from "../src/seo/html.js";
import { SeoStore } from "../src/seo/store.js";
import { auditInternalBrandFactConsistency, getDirectorySubmissionPack } from "../src/seo/listings.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SERVER_DIR = resolve(REPO_ROOT, "server");
const PUBLIC_DIR = resolve(SERVER_DIR, "public");
const APP_DIR = resolve(REPO_ROOT, "app");

const WINDOWS_CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const LEGACY_SCREENSHOT_SHA256_PREFIX = "d8dd9dc75a6761c4";
const LEGACY_PROOF_SHA256_PREFIXES = new Set([
  "b43733f05fb0",
  "72f8ab14efa5",
  "d447c12480f9",
  "ae7197aa7221",
  "c15316dbb5f2",
  "7b3d0dc75ea9",
  "80a25d448a5b",
  "5c41d4cb2122",
  "30c2beffac32",
  "a287de543c6a",
]);

const CANONICAL_EXE_BYTES = 7085912;
const CANONICAL_EXE_SHA256 = "FEAE464CA121CF897D27916C632F4DB8F84A87D4B79642403AD1B0E0F2BB706A";
const CANONICAL_MSI_BYTES = 3993600;
const CANONICAL_MSI_SHA256 = "33E5427E84AB8FC4F3D01DFD17404F7CB38B70B9731A8C2CCFBB62876711933A";
const CANONICAL_DMG_BYTES = 7412590;
const CANONICAL_DMG_SHA256 = "D13A23AACA6B2AEE1BC2E5602F792C31D0CEFA147121686944FEDEC66B17AE6A";
const CANONICAL_LOGO_URL = "https://sweeprcleaner.com/icon-512.png";

const TOP_25_DIRECT_ANSWER_ROUTES = [
  "/clean/folder/winsxs",
  "/clean/folder/windows-old",
  "/clean/app/nvidia-dxcache",
  "/clean/app/amd-shader-cache",
  "/clean/app/riot-client-logs",
  "/clean/app/capcut-desktop-cache",
  "/clean/app/opera-gx-cache",
  "/clean/app/vivaldi-browser-cache",
  "/clean/app/logitech-ghub-installer-cache",
  "/clean/folder/hiberfil-sys",
  "/clean/folder/windows-livekernelreports",
  "/clean/folder/programdata-package-cache",
  "/clean/folder/localappdata-webview2-ebwebview-cache",
  "/clean/app/medal-tv-cache",
  "/clean/app/jetbrains-intellij-cache",
  "/clean/app/logitech-options-plus-cache",
  "/clean/app/stremio-desktop-cache",
  "/clean/folder/c-drive-filling-up-by-itself-windows-11",
  "/clean/folder/system-and-reserved-storage-100gb-windows-11",
  "/clean/folder/appdata-local-folder-huge-windows-11",
  "/clean/folder/windows-11-24h2-update-cache-8gb-bug",
  "/clean/folder/other-storage-full-windows-11-cleanup",
  "/clean/mac/system-data-huge",
  "/clean/ios/iphone-system-data-full",
  "/clean/android/other-storage-full",
] as const;

const EXTRA_PROOF_ROUTES = [
  "/clean/app/discord-cache",
  "/clean/app/spotify-cache",
  "/clean/app/steam-depotcache",
  "/clean/app/genshin-impact-update-cache",
] as const;

const WINDOWS_COMPETITOR_SLUGS = [
  "avast-cleanup",
  "bleachbit",
  "ccleaner",
  "cleanmypc",
  "glary-utilities",
  "wise-disk-cleaner",
] as const;

const MAC_COMPETITOR_SLUGS = ["cleanmymac", "daisydisk", "onyx", "pearcleaner"] as const;

const ALL_COMPETITOR_SLUGS = [...WINDOWS_COMPETITOR_SLUGS, ...MAC_COMPETITOR_SLUGS] as const;

interface CleanItemEntry {
  category: string;
  slug: string;
  name: string;
  platform?: string;
  directAnswer?: unknown;
  proofImage?: string | null;
  visualProof?: { alt?: string; caption?: string } | null;
  labMeasurement?: {
    beforeGb?: number;
    afterGb?: number;
    reclaimedGb?: number;
    osBuild?: string;
  } | null;
  noindex?: boolean;
  mergedIntoSlug?: string;
}

let tmpDir: string;
let repo: ReturnType<typeof openDb>;
let server: ServerType;
let baseUrl: string;
let originalLlmsTxt: Buffer | null = null;

before(async () => {
  const llmsPath = resolve(PUBLIC_DIR, "llms.txt");
  originalLlmsTxt = existsSync(llmsPath) ? readFileSync(llmsPath) : null;

  tmpDir = mkdtempSync(join(tmpdir(), "sweepr-e2e-p2p3-"));
  repo = openDb(join(tmpDir, "sweepr-e2e.db"));
  const { privateKey } = generateKeyPairSync("ed25519");
  const app = createApp({
    repo,
    signingKey: privateKey,
    stripe: null,
    config: {
      publicUrl: "https://sweeprcleaner.com",
      stripeWebhookSecret: "",
      priceMonthly: "",
      trialDays: 7,
      tokenTtlHours: 72,
      maxDevicesPc: 5,
      maxDevicesMobile: 5,
      pastDueGraceDays: 3,
      devEndpoints: false,
      sessionSecret: "e2e-p2-p3-acceptance-secret",
    },
  });

  await new Promise<void>((resolveReady) => {
    server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, (info) => {
      baseUrl = `http://127.0.0.1:${info.port}`;
      resolveReady();
    });
  });
});

after(async () => {
  const srv = server as unknown as { closeAllConnections?: () => void };
  srv.closeAllConnections?.();
  await new Promise<void>((resolveClose) => {
    server.close(() => resolveClose());
  });
  try {
    repo.db.close();
  } catch {}
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
  try {
    const llmsPath = resolve(PUBLIC_DIR, "llms.txt");
    if (originalLlmsTxt !== null && existsSync(llmsPath)) {
      const current = readFileSync(llmsPath);
      if (Buffer.compare(current, originalLlmsTxt) !== 0) {
        writeFileSync(llmsPath, originalLlmsTxt);
      }
    }
  } catch {}
});

async function httpGet(
  path: string,
  opts: { ua?: string; redirect?: RequestRedirect } = {}
): Promise<{ status: number; headers: Headers; text: string; buffer: Buffer; finalPath: string }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "GET",
    redirect: opts.redirect ?? "follow",
    headers: {
      "user-agent": opts.ua ?? WINDOWS_CHROME_UA,
      accept: "text/html,application/json,application/xml,image/*,*/*;q=0.8",
    },
  });
  const ab = await res.arrayBuffer();
  const buffer = Buffer.from(ab);
  const finalUrl = res.url ? new URL(res.url) : new URL(`${baseUrl}${path}`);
  return {
    status: res.status,
    headers: res.headers,
    text: buffer.toString("utf-8"),
    buffer,
    finalPath: finalUrl.pathname + finalUrl.search,
  };
}

async function httpGetFollowLocal(
  path: string,
  opts: { ua?: string } = {}
): Promise<{ status: number; headers: Headers; text: string; buffer: Buffer; finalPath: string; redirected: boolean }> {
  const initial = await httpGet(path, { ua: opts.ua, redirect: "manual" });
  if (initial.status === 301 || initial.status === 302) {
    const loc = initial.headers.get("location");
    assert.ok(loc, `${path} returned ${initial.status} without Location header`);
    const target = toLocalPath(loc, path);
    const dest = await httpGet(target, { ua: opts.ua, redirect: "follow" });
    return { ...dest, redirected: true };
  }
  return { ...initial, redirected: false };
}

function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function parseImageBinary(buf: Buffer): { format: "png" | "webp" | "jpeg"; width: number; height: number } {
  // PNG
  if (
    buf.length >= 24 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    assert.equal(buf.subarray(12, 16).toString("ascii"), "IHDR", "PNG missing IHDR header");
    return { format: "png", width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // WebP
  if (
    buf.length >= 30 &&
    buf.subarray(0, 4).toString("ascii") === "RIFF" &&
    buf.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    const chunk = buf.subarray(12, 16).toString("ascii");
    if (chunk === "VP8X") {
      const width = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
      const height = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
      return { format: "webp", width, height };
    }
    if (chunk === "VP8L") {
      const bits = buf.readUInt32LE(21);
      return { format: "webp", width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8 ") {
      return {
        format: "webp",
        width: buf.readUInt16LE(26) & 0x3fff,
        height: buf.readUInt16LE(28) & 0x3fff,
      };
    }
  }
  // JPEG
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let offset = 2;
    while (offset < buf.length) {
      if (buf[offset] !== 0xff) {
        throw new Error(`Corrupt JPEG marker alignment at offset ${offset}`);
      }
      while (offset < buf.length && buf[offset] === 0xff) offset++;
      if (offset >= buf.length) break;
      const marker = buf[offset];
      offset++;
      // Standalone / lengthless markers: 0x00 (stuffed), 0x01 (TEM), 0xD0..0xD7 (RSTn), 0xD8 (SOI)
      if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
        continue;
      }
      // EOI (0xD9) or SOS (0xDA) reached without SOFn frame
      if (marker === 0xd9 || marker === 0xda) {
        break;
      }
      if (offset + 2 > buf.length) break;
      const len = buf.readUInt16BE(offset);
      if (len < 2 || offset + len > buf.length) {
        throw new Error(`Corrupt JPEG segment length ${len} at marker 0x${marker.toString(16)}`);
      }
      // SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15
      const isSof =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf);
      if (isSof) {
        if (len < 7 || offset + 7 > buf.length) {
          throw new Error(`Corrupt JPEG SOFn segment length ${len} at marker 0x${marker.toString(16)}`);
        }
        const height = buf.readUInt16BE(offset + 3);
        const width = buf.readUInt16BE(offset + 5);
        if (width <= 0 || height <= 0) {
          throw new Error(`Invalid JPEG SOFn dimensions ${width}x${height}`);
        }
        return { format: "jpeg", width, height };
      }
      offset += len;
    }
    throw new Error("Corrupt or incomplete JPEG: missing SOFn frame");
  }
  throw new Error(`Unsupported/corrupt image binary (magic=${buf.subarray(0, 12).toString("hex")})`);
}

function attrValue(tag: string, name: string): string | null {
  const re = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i");
  const m = tag.match(re);
  if (!m) return null;
  return m[1] ?? m[2] ?? m[3] ?? "";
}

function extractImgTags(html: string): Array<{
  tag: string;
  src: string;
  alt: string | null;
  width: number | null;
  height: number | null;
}> {
  const tags = html.match(/<img\b[^>]*>/gi) ?? [];
  return tags.map((tag) => {
    const rawSrc = attrValue(tag, "src") ?? "";
    const dataSrc = attrValue(tag, "data-src") ?? "";
    const src = (!rawSrc || rawSrc.startsWith("data:")) && dataSrc ? dataSrc : rawSrc;
    const alt = attrValue(tag, "alt");
    const wRaw = attrValue(tag, "width");
    const hRaw = attrValue(tag, "height");
    const width = wRaw && /^\d+$/.test(wRaw.trim()) ? Number(wRaw.trim()) : null;
    const height = hRaw && /^\d+$/.test(hRaw.trim()) ? Number(hRaw.trim()) : null;
    return { tag, src, alt, width, height };
  });
}

function isBrandIconOrLogo(src: string, width: number | null): boolean {
  if (/(?:^|\/)(?:favicon[^/]*|icon-\d+[^/]*|apple-touch-icon[^/]*|[^/]*logo[^/]*)\.(?:png|webp|jpe?g)(\?|$)/i.test(src)) {
    return true;
  }
  if (width !== null && width <= 100) {
    return true;
  }
  return false;
}

function extractMetaContent(html: string, key: "name" | "property", target: string): string | null {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const t of tags) {
    const k = attrValue(t, key);
    if (k && k.toLowerCase() === target.toLowerCase()) {
      return attrValue(t, "content");
    }
  }
  return null;
}

function extractJsonLdBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = (m[1] ?? "").trim();
    if (!raw) continue;
    blocks.push(JSON.parse(raw));
  }
  return blocks;
}

function walkJsonNodes(node: unknown, visitor: (obj: Record<string, unknown>) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) walkJsonNodes(item, visitor);
    return;
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    visitor(obj);
    for (const val of Object.values(obj)) {
      if (val && typeof val === "object") walkJsonNodes(val, visitor);
    }
  }
}

function hasJsonLdType(obj: Record<string, unknown>, target: string): boolean {
  const t = obj["@type"];
  return Array.isArray(t) ? t.includes(target) : t === target;
}

function isZeroPriceValue(val: unknown): boolean {
  if (val === "" || val === null || val === undefined || typeof val === "boolean") return false;
  const n = Number(val);
  return Number.isFinite(n) && n === 0;
}

function hasZeroPriceOffer(offerNode: unknown): boolean {
  if (Array.isArray(offerNode)) {
    return offerNode.some((entry) => hasZeroPriceOffer(entry));
  }
  if (!offerNode || typeof offerNode !== "object") return false;
  const o = offerNode as Record<string, unknown>;
  if (isZeroPriceValue(o.price)) return true;
  if (hasJsonLdType(o, "AggregateOffer") && isZeroPriceValue(o.lowPrice)) return true;
  if (o.offers && hasZeroPriceOffer(o.offers)) return true;
  return false;
}

function extractLogoUrl(logo: unknown): string | undefined {
  if (typeof logo === "string") return logo;
  if (logo && typeof logo === "object") {
    const l = logo as Record<string, unknown>;
    if (typeof l.url === "string") return l.url;
    if (typeof l.contentUrl === "string") return l.contentUrl;
  }
  return undefined;
}

function isFullOrganizationNode(obj: Record<string, unknown>): boolean {
  if (!hasJsonLdType(obj, "Organization")) return false;
  return Object.keys(obj).some((k) => k !== "@id" && k !== "@type");
}

function toLocalPath(rawUrl: string, routePath = "/"): string {
  const normalizedRoute = routePath.startsWith("/") ? routePath : `/${routePath}`;
  if (rawUrl.startsWith("https://sweeprcleaner.com")) {
    return rawUrl.slice("https://sweeprcleaner.com".length) || "/";
  }
  if (rawUrl.startsWith("http://sweeprcleaner.com")) {
    return rawUrl.slice("http://sweeprcleaner.com".length) || "/";
  }
  try {
    const resolved = new URL(rawUrl, `https://sweeprcleaner.com${normalizedRoute}`);
    if (resolved.hostname === "sweeprcleaner.com") {
      return `${resolved.pathname}${resolved.search}`;
    }
    return rawUrl;
  } catch {
    return rawUrl;
  }
}

function extractSection(html: string, id: string): string {
  const re = new RegExp(`<section[^>]*id=["']${id}["'][^>]*>([\\s\\S]*?)<\\/section>`, "i");
  const m = html.match(re);
  return m?.[1] ?? "";
}

function walkFilesRecursively(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFilesRecursively(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

function isSimpleWellFormedXml(xml: string, rootTag: string): boolean {
  const trimmed = xml.trim();
  if (!trimmed.startsWith("<?xml")) return false;
  const stripped = trimmed
    .replace(/<\?xml[\s\S]*?\?>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
  // Reject unescaped '&' outside valid XML entities or numeric character refs
  if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(stripped)) {
    return false;
  }
  const stack: string[] = [];
  const tagRe = /<\/?([A-Za-z_][\w.:-]*)(?:\s(?:[^>"']|"[^"]*"|'[^']*')*?)?(\/?)>/g;
  let m: RegExpExecArray | null;
  let lastIndex = 0;
  let rootCount = 0;
  let firstRootName = "";
  while ((m = tagRe.exec(stripped)) !== null) {
    if (stack.length === 0) {
      if (stripped.slice(lastIndex, m.index).trim() !== "") {
        return false;
      }
    }
    lastIndex = m.index + m[0].length;
    const full = m[0];
    const name = m[1];
    const selfClose = m[2] === "/" || full.endsWith("/>");
    if (full.startsWith("</")) {
      const top = stack.pop();
      if (top !== name) return false;
    } else {
      if (stack.length === 0) {
        rootCount += 1;
        if (rootCount === 1) firstRootName = name;
        if (rootCount > 1) return false;
      }
      if (!selfClose) {
        stack.push(name);
      }
    }
  }
  if (stripped.slice(lastIndex).trim() !== "") return false;
  return stack.length === 0 && rootCount === 1 && firstRootName === rootTag;
}

function readCleanItems(): CleanItemEntry[] {
  const raw = readFileSync(resolve(SERVER_DIR, "src/data/clean-items.json"), "utf-8");
  return JSON.parse(raw) as CleanItemEntry[];
}

function extractTop10LlmsGb(llmsText: string): { rankedLines: string[]; gbs: number[] } {
  const lines = llmsText.split(/\r?\n/);
  const rankedLines = lines.filter((l) => /^\s*(?:[-*]\s+\*\*#\d+|\d+\.)\s+.+\*\*[\d.]+\s*GB\*\*/i.test(l));
  const gbs = rankedLines.map((l) => {
    const m = l.match(/Median\s+\*\*([\d.]+)\s*GB\*\*/i) ?? l.match(/\*\*([\d.]+)\s*GB\*\*/i);
    return Number(m?.[1] ?? NaN);
  });
  return { rankedLines, gbs };
}

function extractStateTableMedianGbs(html: string): { rows: string[]; top10Gbs: number[] } {
  const section = extractSection(html, "top-15-heaviest-folders");
  assert.ok(section.length > 0, "Missing #top-15-heaviest-folders on /state-of-windows-storage");
  const thCells = [...section.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map((m) =>
    m[1].replace(/<[^>]*>/g, " ").trim()
  );
  const medianHeaderIdx = thCells.findIndex((h) => /^median$/i.test(h));
  const rows = section.match(/<tr\b[\s\S]*?<\/tr>/gi)?.filter((r) => /<td\b/i.test(r)) ?? [];
  assert.ok(rows.length >= 10, `Expected >=10 rows in #top-15-heaviest-folders, got ${rows.length}`);
  const top10Gbs = rows.slice(0, 10).map((row) => {
    const tds = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) =>
      m[1].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
    );
    const candidateCell =
      medianHeaderIdx >= 0 && medianHeaderIdx < tds.length
        ? tds[medianHeaderIdx]
        : (tds.find((c) => /^[\d.]+\s*GB$/i.test(c)) ?? "");
    const m = candidateCell.match(/^([\d.]+)\s*GB$/i);
    return Number(m?.[1] ?? NaN);
  });
  return { rows, top10Gbs };
}

// ============================================================================
// TIER 1: FEATURE COVERAGE (9 AREAS, >= 5 TESTS PER FEATURE AREA)
// ============================================================================

describe("Tier 1 — Area 1: Real Desktop/Android Captures & screenshot.png/og-image.png (p2-1, p2-1b)", () => {
  test("T1.1.1 GET /screenshot.png serves a valid, non-legacy PNG capture", async () => {
    const res = await httpGet("/screenshot.png");
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /^image\/png/i);
    const dims = parseImageBinary(res.buffer);
    assert.equal(dims.format, "png");
    assert.ok(dims.width >= 800 && dims.height >= 450, `Unexpected screenshot dimensions ${dims.width}x${dims.height}`);
    const hash = sha256Hex(res.buffer);
    assert.ok(
      !hash.startsWith(LEGACY_SCREENSHOT_SHA256_PREFIX),
      `screenshot.png still matches legacy synthetic SHA-256 ${LEGACY_SCREENSHOT_SHA256_PREFIX}`
    );
  });

  test("T1.1.2 GET /og-image.png serves a valid, non-legacy social card distinct from screenshot.png", async () => {
    const [shot, og] = await Promise.all([httpGet("/screenshot.png"), httpGet("/og-image.png")]);
    assert.equal(og.status, 200);
    assert.match(og.headers.get("content-type") ?? "", /^image\/(png|webp|jpeg)/i);
    const dims = parseImageBinary(og.buffer);
    assert.ok(dims.width >= 800 && dims.height >= 400, `Unexpected og-image dimensions ${dims.width}x${dims.height}`);
    const ogHash = sha256Hex(og.buffer);
    assert.ok(
      !ogHash.startsWith(LEGACY_SCREENSHOT_SHA256_PREFIX),
      `og-image.png still matches legacy synthetic SHA-256 ${LEGACY_SCREENSHOT_SHA256_PREFIX}`
    );
    assert.notEqual(Buffer.compare(shot.buffer, og.buffer), 0, "og-image.png must not be byte-identical to raw screenshot.png");
  });

  async function verifyFunnelPageCaptures(route: string) {
    const res = await httpGet(route);
    assert.equal(res.status, 200);
    const allRasterImgs = extractImgTags(res.text).filter(
      (i) => !i.src.endsWith(".svg") && !i.src.startsWith("data:") && /\.(png|webp|jpe?g)(\?|$)/i.test(i.src)
    );
    for (const img of allRasterImgs) {
      assert.ok(!/vpn-/i.test(img.src), `Unrelated VPN capture referenced on ${route}: ${img.src}`);
      assert.ok(img.alt && img.alt.trim().length > 0, `Missing alt text on ${route}: ${img.src}`);
      const asset = await httpGet(toLocalPath(img.src, route));
      assert.equal(asset.status, 200, `Image ${img.src} on ${route} returned HTTP ${asset.status}`);
      const dims = parseImageBinary(asset.buffer);
      if (img.width !== null && img.height !== null) {
        assert.equal(dims.width, img.width, `Width mismatch on ${route} for ${img.src}: HTML=${img.width} vs binary=${dims.width}`);
        assert.equal(dims.height, img.height, `Height mismatch on ${route} for ${img.src}: HTML=${img.height} vs binary=${dims.height}`);
      }
    }
    const productCaptures = allRasterImgs.filter((i) => !isBrandIconOrLogo(i.src, i.width));
    assert.ok(
      productCaptures.length >= 1,
      `${route} must embed at least 1 genuine non-logo raster product/UI capture <img>`
    );
    for (const cap of productCaptures) {
      assert.ok(
        cap.width !== null && cap.width >= 400 && cap.height !== null && cap.height >= 250,
        `${route} capture ${cap.src} must declare explicit width >= 400 and height >= 250 (got ${cap.width}x${cap.height})`
      );
      const asset = await httpGet(toLocalPath(cap.src, route));
      const dims = parseImageBinary(asset.buffer);
      assert.equal(dims.width, cap.width, `Width mismatch on ${route} for ${cap.src}: HTML=${cap.width} vs binary=${dims.width}`);
      assert.equal(dims.height, cap.height, `Height mismatch on ${route} for ${cap.src}: HTML=${cap.height} vs binary=${dims.height}`);
      const hash = sha256Hex(asset.buffer);
      assert.ok(
        !hash.startsWith(LEGACY_SCREENSHOT_SHA256_PREFIX),
        `${route} capture ${cap.src} still matches legacy synthetic SHA-256`
      );
    }
    return res;
  }

  test("T1.1.3 GET / embeds real annotated raster UI captures with explicit dimensions and zero broken images", async () => {
    await verifyFunnelPageCaptures("/");
  });

  test("T1.1.4 GET /pricing embeds real annotated raster capture and resolves /og-image.png (no og-card.png)", async () => {
    const res = await verifyFunnelPageCaptures("/pricing");
    assert.ok(!res.text.includes("og-card.png"), "/pricing still references 404 og-card.png");
    const ogImage = extractMetaContent(res.text, "property", "og:image");
    assert.equal(ogImage, "https://sweeprcleaner.com/og-image.png");
  });

  test("T1.1.5 GET /order replaces CSS laptop mockup with real annotated raster capture", async () => {
    const res = await verifyFunnelPageCaptures("/order");
    assert.ok(!res.text.includes('class="laptop-frame"'), "/order still renders legacy CSS .laptop-frame mockup");
    assert.ok(!res.text.includes("Illustrative Preview"), "/order still shows 'Illustrative Preview' placeholder text");
  });

  test("T1.1.6 Staged server/public/img captures cover desktop UI states + cleaner-only Android screens with zero vpn-*.png or clipped labels", async () => {
    const publicFiles = walkFilesRecursively(PUBLIC_DIR);
    const vpnAssets = publicFiles.filter((f) => /vpn-/i.test(f));
    assert.equal(vpnAssets.length, 0, `Unexpected VPN screen files found in server/public: ${vpnAssets.join(", ")}`);

    const imgDir = resolve(PUBLIC_DIR, "img");
    assert.ok(existsSync(imgDir), "server/public/img/ directory missing");
    const imgFiles = walkFilesRecursively(imgDir).filter((f) => /\.(png|webp|jpe?g)$/i.test(f));
    const isAndroidCapture = (filePath: string): boolean =>
      /(?:^|[\\/])android|cleaner-(?:dashboard|bestshot|swipe|tablet|battery|videoshrink)/i.test(filePath);
    const androidFiles = imgFiles.filter(isAndroidCapture);
    assert.ok(androidFiles.length >= 1, "Expected authentic cleaner-only Android screens staged in server/public/img/");
    for (const af of androidFiles) {
      assert.ok(!/vpn-/i.test(af), `Forbidden VPN Android screen staged: ${af}`);
      const dims = parseImageBinary(readFileSync(af));
      assert.ok(dims.width > 100 && dims.height > 100, `Android screen ${af} has invalid dimensions ${dims.width}x${dims.height}`);
    }

    const desktopFiles = imgFiles.filter((f) => !isAndroidCapture(f) && !/[\\/]proof[\\/]/i.test(f));
    assert.ok(desktopFiles.length >= 4, `Expected >=4 desktop UI state captures in server/public/img/, found ${desktopFiles.length}`);

    const funnelHtmls = await Promise.all(["/", "/pricing", "/order"].map((r) => httpGet(r)));
    const combinedEvidence = [
      ...desktopFiles,
      ...funnelHtmls.flatMap((r) =>
        extractImgTags(r.text).map((i) => `${i.src} ${i.alt ?? ""}`)
      ),
    ].join("\n");

    for (const [stateName, re] of [
      ["Smart Scan", /smart[-_ ]?scan|\bscan\b/i],
      ["Path Inspection", /path[-_ ]?inspect|inspect/i],
      ["7-Day Quarantine", /quarantine/i],
      ["Argon2id Lockbox", /lockbox|vault/i],
    ] as const) {
      assert.match(
        combinedEvidence,
        re,
        `Missing staged/embedded desktop UI capture for required state '${stateName}'`
      );
    }

    for (const [idx, route] of (["/", "/pricing", "/order"] as const).entries()) {
      const res = funnelHtmls[idx];
      assert.ok(!res.text.includes("GPU Shader Cac"), `${route} leaks clipped 'GPU Shader Cac' label`);
      assert.ok(!res.text.includes("DoD File Shredder"), `${route} leaks 'DoD File Shredder' label`);
      assert.ok(!res.text.includes("27.7 GB"), `${route} leaks contradictory '27.7 GB' math mismatch`);
    }
  });
});

describe("Tier 1 — Area 2: Top-25 Proofs, labMeasurement Math & Clean 24H2 Badges (p2-2a, p2-2b)", () => {
  test("T1.2.1 All 25 directAnswer routes and 4 extra proofImage routes return HTTP 200", async () => {
    for (const route of [...TOP_25_DIRECT_ANSWER_ROUTES, ...EXTRA_PROOF_ROUTES]) {
      const res = await httpGet(route);
      assert.equal(res.status, 200, `${route} returned HTTP ${res.status}`);
    }
  });

  test("T1.2.2 Every clean-items.json proofImage route + Top-25 guide resolves 200, is valid raster, and is NOT a legacy synthetic card", async () => {
    const items = readCleanItems();
    const jsonProofRoutes = items
      .filter((i) => typeof i.proofImage === "string" && i.proofImage.trim().length > 0)
      .map((i) => `/clean/${i.category}/${i.slug}`);
    const routesToInspect = [...new Set([...TOP_25_DIRECT_ANSWER_ROUTES, ...jsonProofRoutes])];

    let inspectedProofImages = 0;
    for (const route of routesToInspect) {
      const res = await httpGet(route);
      assert.equal(res.status, 200, `${route} returned ${res.status}`);
      const proofSection = extractSection(res.text, "verified-visual-proof");
      if (!proofSection) continue;
      const imgs = extractImgTags(proofSection);
      assert.ok(imgs.length >= 1, `${route} rendered #verified-visual-proof without an <img>`);
      for (const img of imgs) {
        inspectedProofImages += 1;
        assert.ok(img.alt && img.alt.trim().length > 0, `${route} proof image missing alt`);
        const asset = await httpGet(toLocalPath(img.src, route));
        assert.equal(asset.status, 200, `${route} proofImage ${img.src} returned ${asset.status}`);
        assert.match(asset.headers.get("content-type") ?? "", /^image\/(webp|png|jpeg)/i);
        const dims = parseImageBinary(asset.buffer);
        assert.ok(dims.width > 100 && dims.height > 100, `${route} proofImage ${img.src} has tiny dims ${dims.width}x${dims.height}`);
        const prefix = sha256Hex(asset.buffer).slice(0, 12);
        assert.ok(
          !LEGACY_PROOF_SHA256_PREFIXES.has(prefix) && !sha256Hex(asset.buffer).startsWith(LEGACY_SCREENSHOT_SHA256_PREFIX),
          `${route} still serves legacy synthetic proof card ${img.src} (sha256=${prefix})`
        );
      }
    }
    assert.ok(
      inspectedProofImages >= 3,
      `Expected at least 3 real proof captures rendered across clean-items.json routes, found ${inspectedProofImages}`
    );
  });

  test("T1.2.3 Core locally-verifiable Windows guides replace legacy synthetic proof WebPs on disk and serve authentic proofs", async () => {
    const proofDir = resolve(PUBLIC_DIR, "img/proof");
    assert.ok(existsSync(proofDir), "server/public/img/proof/ directory missing (must hold real local proof captures)");
    const files = readdirSync(proofDir).filter((f) => /\.(webp|png|jpe?g)$/i.test(f));
    assert.ok(files.length >= 3, `Expected >=3 real proof capture files in server/public/img/proof/, found ${files.length}`);
    for (const f of files) {
      const buf = readFileSync(join(proofDir, f));
      const prefix = sha256Hex(buf).slice(0, 12);
      assert.ok(
        !LEGACY_PROOF_SHA256_PREFIXES.has(prefix),
        `server/public/img/proof/${f} still has legacy synthetic SHA-256 prefix ${prefix}`
      );
      const dims = parseImageBinary(buf);
      assert.ok(dims.width > 100 && dims.height > 100, `proof file ${f} has invalid dims ${dims.width}x${dims.height}`);
    }

    const items = readCleanItems();
    const withProof = items.filter((i) => typeof i.proofImage === "string" && i.proofImage.trim().length > 0);
    assert.ok(withProof.length >= 3, `Expected >=3 clean-items.json entries with proofImage, found ${withProof.length}`);
    for (const item of withProof) {
      const asset = await httpGet(toLocalPath(item.proofImage!));
      assert.equal(asset.status, 200, `${item.category}/${item.slug} proofImage ${item.proofImage} returned ${asset.status}`);
      const prefix = sha256Hex(asset.buffer).slice(0, 12);
      assert.ok(!LEGACY_PROOF_SHA256_PREFIXES.has(prefix), `${item.slug} proofImage matches legacy synthetic SHA-256`);
    }

    const winsxs = await httpGet("/clean/folder/winsxs");
    assert.equal(winsxs.status, 200);
    assert.ok(
      extractSection(winsxs.text, "verified-visual-proof").length > 0,
      "/clean/folder/winsxs (core Windows guide) should present verified visual proof"
    );
  });

  test("T1.2.4 labMeasurement tables on JSON and rendered SSR guides satisfy before - after = reclaimed and authentic osBuild", async () => {
    const items = readCleanItems();
    const withLab = items.filter((i) => i.labMeasurement && typeof i.labMeasurement === "object");
    assert.ok(withLab.length >= 3, "Expected at least 3 clean-items with labMeasurement");
    for (const item of withLab) {
      const m = item.labMeasurement!;
      assert.equal(typeof m.beforeGb, "number", `${item.category}/${item.slug} beforeGb must be a number`);
      assert.equal(typeof m.afterGb, "number", `${item.category}/${item.slug} afterGb must be a number`);
      assert.equal(typeof m.reclaimedGb, "number", `${item.category}/${item.slug} reclaimedGb must be a number`);
      assert.ok(
        Number.isFinite(m.beforeGb!) && Number.isFinite(m.afterGb!) && Number.isFinite(m.reclaimedGb!),
        `${item.category}/${item.slug} labMeasurement has non-finite numbers`
      );
      assert.ok(m.reclaimedGb! >= 0 && m.beforeGb! >= m.afterGb!, `${item.category}/${item.slug} has negative reclaimedGb or before < after`);
      assert.ok(
        Math.abs(m.beforeGb! - m.afterGb! - m.reclaimedGb!) <= 0.15,
        `${item.category}/${item.slug} labMeasurement math mismatch: ${m.beforeGb} - ${m.afterGb} != ${m.reclaimedGb}`
      );
      assert.ok(
        typeof m.osBuild === "string" && m.osBuild.trim().length > 0,
        `${item.category}/${item.slug} labMeasurement missing osBuild`
      );
      assert.ok(
        !/24H2/i.test(m.osBuild!),
        `${item.category}/${item.slug} labMeasurement falsely claims 24H2 ('${m.osBuild}') instead of authentic Build 26200 / 25H2`
      );

      const route = `/clean/${item.category}/${item.slug}`;
      const res = await httpGet(route);
      assert.equal(res.status, 200, `${route} returned HTTP ${res.status}`);
      const box = extractSection(res.text, "lab-benchmark-box");
      assert.ok(box.length > 0, `${route} has labMeasurement in JSON but did not render #lab-benchmark-box`);
      assert.ok(box.includes(String(m.reclaimedGb)), `${route} #lab-benchmark-box missing reclaimedGb`);
      assert.ok(box.includes(m.osBuild!), `${route} #lab-benchmark-box missing osBuild '${m.osBuild}'`);
      assert.ok(
        !/Windows\s+11\s+24H2\s+Lab\s+VM/i.test(box),
        `${route} #lab-benchmark-box still claims 'Windows 11 24H2 Lab VM'`
      );
    }
  });

  test("T1.2.5 pseo.ts and unverified Windows guides omit blanket 'Tested on Windows 11 24H2' stamps", async () => {
    const pseoSrc = readFileSync(resolve(SERVER_DIR, "src/pseo.ts"), "utf-8");
    assert.ok(
      !/["']Tested on Windows 11 24H2["']/i.test(pseoSrc),
      "server/src/pseo.ts still hardcodes blanket 'Tested on Windows 11 24H2' stamp"
    );

    const items = readCleanItems();
    const unverifiedWindows = items.filter(
      (i) =>
        !i.noindex &&
        !i.mergedIntoSlug &&
        (i.category === "app" || i.category === "folder") &&
        !i.proofImage &&
        !i.labMeasurement
    );
    assert.ok(unverifiedWindows.length >= 10, "Expected unverified Windows guides to audit");
    for (const item of unverifiedWindows) {
      const route = `/clean/${item.category}/${item.slug}`;
      const res = await httpGet(route);
      assert.equal(res.status, 200, `${route} returned ${res.status}`);
      assert.ok(
        !/Tested on Windows 11 24H2/i.test(res.text),
        `${route} still displays unverified blanket 'Tested on Windows 11 24H2' stamp`
      );
    }
  });

  test("T1.2.6 Non-Windows guides (Mac, iOS, Android) never claim Windows Explorer captures or Windows 11 testing", async () => {
    const nonWindows = [
      "/clean/mac/system-data-huge",
      "/clean/ios/iphone-system-data-full",
      "/clean/android/other-storage-full",
    ];
    for (const route of nonWindows) {
      const res = await httpGet(route);
      assert.equal(res.status, 200);
      assert.ok(!/Windows 11 Disk Inspection Snapshot/i.test(res.text), `${route} falsely claims Windows 11 Disk Inspection Snapshot`);
      assert.ok(!/Tested on Windows 11 24H2/i.test(res.text), `${route} falsely claims Tested on Windows 11 24H2`);
      assert.ok(!/Windows Explorer Properties/i.test(res.text), `${route} falsely claims Windows Explorer Properties`);
    }
  });
});

describe("Tier 1 — Area 3: Named Hardware Benchmarks & safety.rs Boundaries (p2-3a, p2-3b, p2-3c)", () => {
  function assertNamedHardwareBenchmark(html: string, label: string) {
    assert.match(html, /Intel(?:\(R\))?\s+Celeron(?:\(R\))?\s+N5095/i, `${label} missing CPU 'Intel Celeron N5095'`);
    assert.match(html, /XINCUU[- ]?512GB[\s\S]{0,80}?SATA/i, `${label} missing storage 'XINCUU-512GB SATA'`);
    assert.match(html, /Windows\s+11[\s\S]{0,60}?Build\s*26200|Build\s*26200/i, `${label} missing 'Windows 11 ... Build 26200'`);
    assert.match(html, /\d[\d,.]*\s*files\/s(?:ec)?/i, `${label} missing files/sec throughput metric`);
    assert.match(html, /\d[\d,.]*\s*ms\b/i, `${label} missing ScanReport.duration_ms metric`);
    assert.match(html, /\d[\d,.]*\s*files\b/i, `${label} missing scanned file count`);
    assert.match(html, /\d+(?:\.\d+)?\s*GB\b/i, `${label} missing GB freed/reclaimable metric`);
    assert.match(html, /2026-\d{2}-\d{2}|Nov(?:ember)?\s+\d{1,2},\s+2026/i, `${label} missing test date`);
    assert.ok(
      !/XINCUU[^<\n]*NVMe|Celeron[^<\n]*NVMe|NVMe[^<\n]*N5095/i.test(html),
      `${label} falsely attributes NVMe to the SATA test rig`
    );
  }

  function assertSafetyBoundaries(html: string, label: string) {
    assert.match(html, /What SWEEPR Never Touches/i, `${label} missing 'What SWEEPR Never Touches' boundary section`);
    for (const token of ["Documents", "Desktop", "Pictures", "Videos"]) {
      assert.ok(html.includes(token), `${label} safety table missing protected user directory '${token}'`);
    }
    assert.match(html, /Audio|Music/i, `${label} safety table missing Audio/Music protection`);
    assert.match(html, /home_dir|home\s*dir|AppData|ProgramData/i, `${label} safety table missing home_dir/AppData/ProgramData protection`);
    assert.match(html, /SystemRoot|ProgramFiles|Program\s*Files/i, `${label} safety table missing OS root protections`);
    assert.match(html, /0x400|REPARSE_POINT|OneDrive/i, `${label} safety table missing NTFS reparse / OneDrive placeholder guard`);
    assert.match(html, /symlink|junction/i, `${label} safety table missing symlink/junction guard`);
  }

  test("T1.3.1 GET / publishes named local Celeron N5095 + XINCUU SATA + Build 26200 benchmark metrics", async () => {
    const res = await httpGet("/");
    assert.equal(res.status, 200);
    assertNamedHardwareBenchmark(res.text, "GET /");
  });

  test("T1.3.2 GET /state-of-windows-storage publishes named local hardware benchmark metrics (no NVMe/24H2 claim on test rig)", async () => {
    const res = await httpGet("/state-of-windows-storage");
    assert.equal(res.status, 200);
    assertNamedHardwareBenchmark(res.text, "GET /state-of-windows-storage");
  });

  test("T1.3.3 GET / publishes explicit 'What SWEEPR Never Touches' boundary table derived from safety.rs", async () => {
    const res = await httpGet("/");
    assert.equal(res.status, 200);
    assertSafetyBoundaries(res.text, "GET /");
  });

  test("T1.3.4 GET /state-of-windows-storage publishes 'What SWEEPR Never Touches' boundary table + 30-day Downloads rule", async () => {
    const res = await httpGet("/state-of-windows-storage");
    assert.equal(res.status, 200);
    assertSafetyBoundaries(res.text, "GET /state-of-windows-storage");
    assert.match(res.text, /30[- ]day|720\s*h/i, "/state-of-windows-storage missing 30-day (720h) Downloads safety rule");
  });

  test("T1.3.5 GET /safe-to-delete publishes 'What SWEEPR Never Touches' table and API returns exact safe vs protected verdicts", async () => {
    const res = await httpGet("/safe-to-delete");
    assert.equal(res.status, 200);
    assertSafetyBoundaries(res.text, "GET /safe-to-delete");

    const apiRes = await fetch(`${baseUrl}/api/safe-to-delete/check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        input: "C:\\Users\\Ben\\Documents\\Taxes.pdf\nC:\\Users\\Ben\\AppData\\Local\\NVIDIA\\DXCache",
      }),
    });
    assert.equal(apiRes.status, 200);
    const json = (await apiRes.json()) as {
      ok: boolean;
      results?: Array<{ input: string; verdict?: string; badge_color?: string }>;
    };
    assert.equal(json.ok, true);
    assert.ok(Array.isArray(json.results) && json.results.length === 2, "Expected 2 results from /api/safe-to-delete/check");
    const docEntry = json.results.find((r) => /Documents/i.test(r.input));
    const dxEntry = json.results.find((r) => /DXCache/i.test(r.input));
    assert.ok(docEntry, "Missing Documents entry in /api/safe-to-delete/check response");
    assert.ok(dxEntry, "Missing DXCache entry in /api/safe-to-delete/check response");
    assert.equal(dxEntry.verdict, "SAFE TO DELETE", `Expected DXCache verdict 'SAFE TO DELETE', got '${dxEntry.verdict}'`);
    assert.notEqual(docEntry.verdict, "SAFE TO DELETE", "Documents path must NEVER return SAFE TO DELETE");
    assert.notEqual(docEntry.badge_color, "green", "Documents path must NEVER have green badge");
  });
});

describe("Tier 1 — Area 4: Rust Engineering Differentiators & scan_stale_dev_artifacts UI Wiring (p2-4a, p2-4b)", () => {
  function assertRustDifferentiators(html: string, label: string) {
    assert.match(html, /Rayon|parallel\s+rule/i, `${label} missing Rayon parallel rule walker differentiator`);
    assert.match(
      html,
      /access_mode\(0\)|share_mode\(0\)|ERROR_SHARING_VIOLATION|non-touching\s+file[- ]lock/i,
      `${label} missing non-touching file-lock check differentiator`
    );
    assert.match(html, /Recent\\\*\.lnk|5[- ]signal/i, `${label} missing 5-signal Recent\\*.lnk differentiator`);
    assert.match(
      html,
      /2[- ]stage.*SHA-?256|SHA-?256.*dedup/is,
      `${label} missing 2-stage parallel SHA-256 deduplication differentiator`
    );
    assert.match(
      html,
      /Argon2id.*AES-?256-?GCM|AES-?256-?GCM.*STREAM/is,
      `${label} missing Argon2id + AES-256-GCM STREAM Lockbox differentiator`
    );
    assert.match(
      html,
      /Ed25519.*72[- ]?h|72[- ]?h(?:our)?\s+offline/is,
      `${label} missing 72h Ed25519 offline-grace licensing differentiator`
    );
  }

  test("T1.4.1 GET / surfaces all 6 verifiable Rust engineering differentiators", async () => {
    const res = await httpGet("/");
    assert.equal(res.status, 200);
    assertRustDifferentiators(res.text, "GET /");
  });

  test("T1.4.2 Active Windows /vs/*.html pages surface verifiable Rust engineering differentiators", async () => {
    for (const slug of WINDOWS_COMPETITOR_SLUGS) {
      const res = await httpGet(`/vs/${slug}`);
      assert.equal(res.status, 200, `/vs/${slug} returned ${res.status}`);
      assertRustDifferentiators(res.text, `/vs/${slug}`);
    }
  });

  test("T1.4.3 app/src/lib/api.ts exposes scan_stale_dev_artifacts IPC wrapper and TypeScript report contracts", () => {
    const apiTs = readFileSync(resolve(APP_DIR, "src/lib/api.ts"), "utf-8");
    assert.match(
      apiTs,
      /invoke\s*(?:<[^;()]*>)?\s*\(\s*["']scan_stale_dev_artifacts["']/,
      "app/src/lib/api.ts does not invoke Tauri command 'scan_stale_dev_artifacts'"
    );
    for (const field of [
      "artifacts",
      "total_artifact_bytes",
      "docker",
      "vhdx_files",
      "total_vhdx_bytes",
      "buildkit_reclaimable_bytes",
    ]) {
      assert.ok(apiTs.includes(field), `app/src/lib/api.ts missing StaleDevArtifactsReport field '${field}'`);
    }
  });

  test("T1.4.4 Svelte desktop UI wires scan_stale_dev_artifacts, renders project artifacts + Docker VHDX/BuildKit, and supports folder reveal", () => {
    const svelteFiles = walkFilesRecursively(resolve(APP_DIR, "src")).filter((f) => f.endsWith(".svelte"));
    assert.ok(svelteFiles.length > 0, "No Svelte files found in app/src");
    const combined = svelteFiles.map((f) => readFileSync(f, "utf-8")).join("\n");
    const apiTs = readFileSync(resolve(APP_DIR, "src/lib/api.ts"), "utf-8");
    const wrapperMatch =
      apiTs.match(/export\s+async\s+function\s+(\w+)\s*\([^)]*\)[^{]*\{(?:(?!export\s+async\s+function)[\s\S])*?scan_stale_dev_artifacts/) ??
      apiTs.match(/(\w+)\s*:\s*(?:async\s*)?\([^)]*\)(?:\s*:\s*[^=]+)?\s*=>\s*(?:(?!=>)[\s\S]){0,300}?scan_stale_dev_artifacts/) ??
      apiTs.match(/(\w+)\s*\([^)]*\)(?:\s*:\s*[^{=]+)?\s*\{\s*[\s\S]{0,300}?scan_stale_dev_artifacts/);
    const wrapperName = wrapperMatch?.[1];
    const hasInvocation =
      /scan_stale_dev_artifacts/.test(combined) ||
      (wrapperName ? new RegExp(`\\b(?:api\\.|cloudApi\\.)?${wrapperName}\\b`).test(combined) : false);
    assert.ok(hasInvocation, "No Svelte component under app/src/ invokes scan_stale_dev_artifacts or its api.ts wrapper");
    assert.match(combined, /node_modules|target|\.next|\.gradle|\.venv/, "Svelte UI missing stale dev artifact category display");
    assert.match(combined, /vhdx_files|total_vhdx_bytes|buildkit_reclaimable_bytes/i, "Svelte UI missing Docker VHDX / BuildKit rendering");
    assert.match(combined, /revealInFolder/, "Svelte UI stale dev view missing revealInFolder inspection action");
  });

  test("T1.4.5 Web copy does not overclaim decoded-pixel photo matching or DoD 5220.22-M shredding", async () => {
    for (const route of ["/", "/vs/ccleaner", "/vs/bleachbit", "/vs/avast-cleanup"]) {
      const res = await httpGet(route);
      assert.equal(res.status, 200);
      assert.ok(!/decoded[- ]pixel/i.test(res.text), `${route} overclaims decoded-pixel matching`);
      assert.ok(!/DoD\s+5220\.22-M|DoD\s+File\s+Shredder/i.test(res.text), `${route} claims uncertified DoD shredding`);
    }
  });
});

describe("Tier 1 — Area 5: /about Sole-Founder Page & Attribution Unification (p2-5a, p2-5b)", () => {
  test("T1.5.1 GET /about returns HTTP 200 with Benjamin Cook sole-trader details and transparency links", async () => {
    const res = await httpGet("/about");
    assert.equal(res.status, 200);
    assert.ok(res.text.includes("Benjamin Cook"), "/about missing 'Benjamin Cook'");
    assert.match(res.text, /sole\s+trader|independent\s+developer/i, "/about missing sole-trader context");
    assert.ok(res.text.includes("github.com/BenCook1996"), "/about missing GitHub link");
    assert.match(res.text, /winget/i, "/about missing Winget transparency reference");
    assert.match(res.text, /scoop/i, "/about missing Scoop transparency reference");
    assert.match(res.text, /SHA-?256|release-manifest\.json/i, "/about missing SHA-256 verification reference");
  });

  test("T1.5.2 GET /about includes UK correspondence address and 1 business day SLA with zero corporate fluff", async () => {
    const res = await httpGet("/about");
    assert.equal(res.status, 200);
    assert.match(
      res.text,
      /87 Upper Brighton Road,\s*Worthing,\s*West Sussex/i,
      "/about missing UK correspondence address"
    );
    assert.ok(!res.text.includes("To Be Completed"), "/about still contains To Be Completed placeholder");
    assert.match(res.text, /within 1 business day\s*\(UK time\)/i, "/about missing 'within 1 business day (UK time)' SLA");
    for (const forbidden of ["SWEEPR Cleaner Inc.", "24/7 Support Desk", "SWEEPR Storage Research Lab", "linkedin.com"]) {
      assert.ok(!res.text.toLowerCase().includes(forbidden.toLowerCase()), `/about contains forbidden '${forbidden}'`);
    }
  });

  test("T1.5.3 /support, /terms, /privacy, /refund include UK correspondence address, consistent SLA, and /about links", async () => {
    for (const route of ["/support", "/terms", "/privacy", "/refund"]) {
      const res = await httpGet(route);
      assert.equal(res.status, 200);
      assert.ok(res.text.includes("Benjamin Cook"), `${route} missing Benjamin Cook`);
      assert.match(
        res.text,
        /87 Upper Brighton Road,\s*Worthing,\s*West Sussex/i,
        `${route} missing UK correspondence address`
      );
      assert.ok(!res.text.includes("To Be Completed"), `${route} still contains To Be Completed placeholder`);
      assert.match(res.text, /href=["']\/about["']/i, `${route} missing link to /about`);
    }
    const support = await httpGet("/support");
    assert.match(support.text, /within 1 business day\s*\(UK time\)/i);
    const refund = await httpGet("/refund");
    assert.match(refund.text, /within 1 business day/i);
  });

  test("T1.5.4 Navigation/footer across ui-shell SSR routes, static pages, and active switchers link to /about", async () => {
    const routes = [
      "/",
      "/pricing",
      "/about",
      "/support",
      "/terms",
      "/privacy",
      "/refund",
      "/clean",
      "/tools",
      "/safe-to-delete",
      "/state-of-windows-storage",
      "/tools/pc-cache-calculator",
      ...ALL_COMPETITOR_SLUGS.map((s) => `/vs/${s}`),
      ...ALL_COMPETITOR_SLUGS.map((s) => `/alternatives/${s}`),
    ];
    for (const route of routes) {
      const res = await httpGetFollowLocal(route);
      assert.equal(res.status, 200, `${route} returned ${res.status}`);
      assert.match(res.text, /<a\b[^>]*href=["']\/about["'][^>]*>/i, `${route} header/footer does not link to /about`);
    }
  });

  test("T1.5.5 Zero occurrences of 'SWEEPR Storage Research Lab' across HTTP routes and SEO modules", async () => {
    for (const route of ["/state-of-windows-storage", "/about", "/clean/folder/winsxs", "/clean/app/nvidia-dxcache"]) {
      const res = await httpGet(route);
      assert.equal(res.status, 200);
      assert.ok(!/SWEEPR Storage Research Lab/i.test(res.text), `${route} leaks 'SWEEPR Storage Research Lab'`);
    }
    for (const rel of ["src/seo/telemetry-truth.ts", "src/seo/bloat-watch.ts", "src/pseo.ts"]) {
      const content = readFileSync(resolve(SERVER_DIR, rel), "utf-8");
      assert.ok(!/SWEEPR Storage Research Lab/i.test(content), `server/${rel} still contains 'SWEEPR Storage Research Lab'`);
    }
  });
});

describe("Tier 1 — Area 6: Release Metadata Sync 6.76 MB / 7.07 MB / IV (p3-1a, p3-1b)", () => {
  test("T1.6.1 GET /release-manifest.json returns canonical byte counts and SHA-256 digests", async () => {
    const res = await httpGet("/release-manifest.json");
    assert.equal(res.status, 200);
    const data = JSON.parse(res.text) as {
      version: string;
      exe: { bytes: number; sha256: string };
      msi: { bytes: number; sha256: string };
      dmg: { bytes: number; sha256: string };
    };
    assert.equal(data.exe.bytes, CANONICAL_EXE_BYTES);
    assert.equal(data.exe.sha256, CANONICAL_EXE_SHA256);
    assert.equal(data.msi.bytes, CANONICAL_MSI_BYTES);
    assert.equal(data.msi.sha256, CANONICAL_MSI_SHA256);
    assert.equal(data.dmg.bytes, CANONICAL_DMG_BYTES);
    assert.equal(data.dmg.sha256, CANONICAL_DMG_SHA256);
  });

  test("T1.6.2 /support, /download?platform=windows, /download?platform=picker, and download-recovery.ts align on 6.76 MB/MiB and IV", async () => {
    const support = await httpGet("/support");
    assert.equal(support.status, 200);
    assert.match(support.text, /6\.76\s*M(?:i?B)/i, "/support missing 6.76 MB/MiB");
    assert.match(support.text, /Individual Validation|\bIV\b|CN=Benjamin Cook/i, "/support missing IV cert tier");
    assert.ok(!/6\.52\s*M(?:i?B)|5\.8\s*M(?:i?B)|Authenticode OV/i.test(support.text), "/support contains stale 6.52/5.8 MB or OV");

    const dlWin = await httpGet("/download?platform=windows");
    assert.equal(dlWin.status, 200);
    assert.match(dlWin.text, /6\.76\s*M(?:i?B)/i, "/download?platform=windows missing 6.76 MB/MiB");
    assert.ok(!/6\.52\s*M(?:i?B)|5\.8\s*M(?:i?B)|Authenticode OV/i.test(dlWin.text), "/download?platform=windows leaks stale size or OV");

    const picker = await httpGet("/download?platform=picker");
    assert.equal(picker.status, 200);
    assert.match(picker.text, /Individual Validation|\bIV\b/i, "/download?platform=picker missing Individual Validation (IV)");
    assert.ok(!/6\.52\s*M(?:i?B)|5\.8\s*M(?:i?B)|Authenticode OV/i.test(picker.text), "/download picker contains stale size or OV");

    const recoverySrc = readFileSync(resolve(SERVER_DIR, "src/download-recovery.ts"), "utf-8");
    assert.ok(!/5\.8\s*M(?:i?B)|6\.52\s*M(?:i?B)/i.test(recoverySrc), "download-recovery.ts still contains 5.8 MB or 6.52 MB");
    assert.match(recoverySrc, /6\.76\s*M(?:i?B)/i, "download-recovery.ts missing 6.76 MB/MiB");
  });

  test("T1.6.3 listings.ts and update-release-listings.mjs sync 6.76 MB, Individual Validation (IV), and canonical URLs", () => {
    const store = new SeoStore(repo.db);
    const pack = getDirectorySubmissionPack(store);
    assert.match(pack.canonical_copy.tagline_80, /6\.76\s*M(?:i?B)/i, "listings.ts tagline_80 missing 6.76 MB");
    assert.match(pack.canonical_copy.description_250, /6\.76\s*M(?:i?B)/i, "listings.ts description_250 missing 6.76 MB");
    assert.ok(!/6\.52\s*M(?:i?B)/i.test(JSON.stringify(pack)), "listings.ts submission pack still contains 6.52 MB");
    assert.ok(!/OV\/EV|Authenticode OV/i.test(JSON.stringify(pack)), "listings.ts submission pack still contains OV/EV");

    const listingsSrc = readFileSync(resolve(SERVER_DIR, "src/seo/listings.ts"), "utf-8");
    assert.ok(!/winget-pkgs\/pull\/480164/.test(listingsSrc), "listings.ts still references winget-pkgs/pull/480164");
    assert.ok(!/6\.52\s*M(?:i?B)/.test(listingsSrc), "listings.ts still hardcodes 6.52 MB");
    assert.ok(!/OV\/EV/.test(listingsSrc), "listings.ts still references OV/EV");

    const audit = auditInternalBrandFactConsistency({ autoFix: false });
    assert.ok(Array.isArray(audit.files));
    assert.equal(audit.drift_detected_count, 0, `auditInternalBrandFactConsistency detected drift in ${audit.drift_detected_count} files`);

    const updaterSrc = readFileSync(resolve(SERVER_DIR, "scripts/update-release-listings.mjs"), "utf-8");
    assert.ok(!/winget-pkgs\/pull\/480164|6\.52\s*M(?:i?B)|Authenticode OV/i.test(updaterSrc), "update-release-listings.mjs contains stale metadata");
  });

  test("T1.6.4 All active /vs/* & /alternatives/* pages and package manifests/README sync 6.76 MB, 7.07 MB, IV, and canonical URLs", async () => {
    for (const prefix of ["/vs", "/alternatives"]) {
      for (const slug of ALL_COMPETITOR_SLUGS) {
        const res = await httpGetFollowLocal(`${prefix}/${slug}`);
        assert.equal(res.status, 200, `${prefix}/${slug} returned ${res.status}`);
        assert.ok(!/6\.52\s*M(?:i?B)|5\.8\s*M(?:i?B)|Authenticode OV/i.test(res.text), `${prefix}/${slug} leaks stale size or OV`);
        assert.ok(!/winget-pkgs\/pull\/480164/.test(res.text), `${prefix}/${slug} leaks stale PR URL`);
        assert.match(res.text, /6\.76\s*M(?:i?B)/i, `${prefix}/${slug} missing 6.76 MB/MiB`);
        assert.match(
          res.text,
          /Individual Validation|\bIV\b|CN=Benjamin Cook/i,
          `${prefix}/${slug} missing positive Individual Validation (IV) / CN=Benjamin Cook cert reference`
        );
        if ((MAC_COMPETITOR_SLUGS as readonly string[]).includes(slug) && !res.redirected) {
          assert.match(res.text, /7\.07\s*M(?:i?B)/i, `${prefix}/${slug} missing 7.07 MB dmg size`);
        }
      }
    }

    const readme = readFileSync(resolve(REPO_ROOT, "README.md"), "utf-8");
    assert.ok(readme.includes("7,085,912") && readme.includes("7,412,590"), "README.md missing canonical byte sizes");
    assert.match(readme, /Individual Validation|\bIV\b|CN=Benjamin Cook/i, "README.md missing Individual Validation (IV) / CN=Benjamin Cook");
    assert.ok(!readme.includes("winget-pkgs/pull/480164"), "README.md still links winget-pkgs/pull/480164");

    const chocoVerif = readFileSync(resolve(REPO_ROOT, "chocolatey/tools/VERIFICATION.txt"), "utf-8");
    assert.ok(chocoVerif.includes(CANONICAL_EXE_SHA256), "VERIFICATION.txt missing canonical EXE SHA-256");
    assert.match(chocoVerif, /Individual Validation|\bIV\b|CN=Benjamin Cook/i, "VERIFICATION.txt missing CN=Benjamin Cook / IV");
    assert.ok(!/6\.52\s*M(?:i?B)|Authenticode OV/i.test(chocoVerif), "VERIFICATION.txt contains stale 6.52 MB or OV");

    const wingetDir = resolve(REPO_ROOT, "winget-manifests/manifests/s/Sweepr/SweeprCleaner/0.1.0");
    const wingetText = readdirSync(wingetDir)
      .filter((f) => f.endsWith(".yaml"))
      .map((f) => readFileSync(join(wingetDir, f), "utf-8"))
      .join("\n");
    assert.ok(wingetText.includes(CANONICAL_EXE_SHA256), "winget manifest missing canonical EXE SHA-256");
    assert.match(wingetText, /6\.76\s*M(?:i?B)/i, "winget manifest missing 6.76 MB/MiB");
    assert.match(wingetText, /Benjamin Cook/i, "winget manifest missing Benjamin Cook publisher/author");
    assert.ok(!/6\.52\s*M(?:i?B)|Authenticode OV|winget-pkgs\/pull\/480164/i.test(wingetText), "winget manifest leaks stale metadata");

    const scoopJson = readFileSync(resolve(REPO_ROOT, "scoop/bucket/sweepr-cleaner.json"), "utf-8");
    assert.ok(scoopJson.toUpperCase().includes(CANONICAL_EXE_SHA256), "scoop manifest missing canonical EXE SHA-256");
    assert.ok(!/6\.52\s*M(?:i?B)|Authenticode OV|winget-pkgs\/pull\/480164/i.test(scoopJson), "scoop manifest leaks stale metadata");

    const chocoNuspec = readFileSync(resolve(REPO_ROOT, "chocolatey/sweepr-cleaner.nuspec"), "utf-8");
    assert.ok(chocoNuspec.includes("Benjamin Cook"), "chocolatey nuspec missing Benjamin Cook");
    assert.ok(!/6\.52\s*M(?:i?B)|Authenticode OV|winget-pkgs\/pull\/480164/i.test(chocoNuspec), "chocolatey nuspec leaks stale metadata");

    const homebrewCask = readFileSync(resolve(REPO_ROOT, "homebrew/Casks/sweepr-cleaner.rb"), "utf-8");
    assert.ok(homebrewCask.toUpperCase().includes(CANONICAL_DMG_SHA256), "homebrew cask missing canonical DMG SHA-256");
    assert.ok(!/6\.52\s*M(?:i?B)|Authenticode OV|winget-pkgs\/pull\/480164/i.test(homebrewCask), "homebrew cask leaks stale metadata");
  });

  test("T1.6.5 transactional-tools.ts and clean-items.json sync 6.76 MB and Individual Validation (IV)", async () => {
    const toolsHub = await httpGet("/tools");
    assert.equal(toolsHub.status, 200);
    assert.ok(!/6\.52\s*M(?:i?B)|Authenticode OV/i.test(toolsHub.text), "/tools hub leaks stale 6.52 MB or OV");

    const toolHtml = renderTransactionalToolPage(TRANSACTIONAL_TOOLS[0], "e2e-visitor");
    assert.ok(!/6\.52\s*M(?:i?B)|Authenticode OV/i.test(toolHtml), "renderTransactionalToolPage leaks 6.52 MB or OV");
    assert.match(toolHtml, /6\.76\s*M(?:i?B)/i, "renderTransactionalToolPage missing 6.76 MB");
    assert.match(toolHtml, /Individual Validation|\bIV\b/i, "renderTransactionalToolPage missing Individual Validation (IV)");

    const cleanItemsRaw = readFileSync(resolve(SERVER_DIR, "src/data/clean-items.json"), "utf-8");
    assert.ok(!/6\.52\s*M(?:i?B)|5\.8\s*M(?:i?B)|Authenticode OV/i.test(cleanItemsRaw), "clean-items.json still contains stale size or OV");
  });
});

describe("Tier 1 — Area 7: JSON-LD & OG Schema Hygiene (p3-2a, p3-2b)", () => {
  test("T1.7.1 /pricing og:image and JSON-LD Product.image resolve to og-image.png (zero og-card.png)", async () => {
    const res = await httpGet("/pricing");
    assert.equal(res.status, 200);
    assert.ok(!res.text.includes("og-card.png"), "/pricing still contains og-card.png");
    const og = extractMetaContent(res.text, "property", "og:image");
    assert.equal(og, "https://sweeprcleaner.com/og-image.png");
    const blocks = extractJsonLdBlocks(res.text);
    assert.ok(blocks.length >= 1, "/pricing missing JSON-LD");
    const rawJson = JSON.stringify(blocks);
    assert.ok(!rawJson.includes("og-card.png"), "/pricing JSON-LD still references og-card.png");
    assert.ok(rawJson.includes("og-image.png"), "/pricing JSON-LD missing og-image.png");
  });

  test("T1.7.2 Digital SaaS offers and free tools emit zero ReturnByMail or OfferShippingDetails", async () => {
    const routes = ["/", "/pricing", "/safe-to-delete", "/tools", "/tools/pc-cache-calculator"];
    for (const route of routes) {
      const res = await httpGet(route);
      assert.equal(res.status, 200);
      const blocks = extractJsonLdBlocks(res.text);
      const serialized = JSON.stringify(blocks);
      assert.ok(!serialized.includes("ReturnByMail"), `${route} JSON-LD still includes ReturnByMail`);
      assert.ok(!serialized.includes("OfferShippingDetails"), `${route} JSON-LD still includes OfferShippingDetails`);
    }
    const toolHtml = renderTransactionalToolPage(TRANSACTIONAL_TOOLS[0], "e2e-visitor");
    const toolBlocks = extractJsonLdBlocks(toolHtml);
    assert.ok(!JSON.stringify(toolBlocks).includes("ReturnByMail"), "renderTransactionalToolPage emits ReturnByMail");
    assert.ok(!JSON.stringify(toolBlocks).includes("OfferShippingDetails"), "renderTransactionalToolPage emits OfferShippingDetails");
  });

  test("T1.7.3 GET / SoftwareApplication JSON-LD includes $0/£0 Free Tier Offer and linked @id graph", async () => {
    const res = await httpGet("/");
    assert.equal(res.status, 200);
    const blocks = extractJsonLdBlocks(res.text);
    const ids = new Set<string>();
    let hasFreeOffer = false;
    walkJsonNodes(blocks, (obj) => {
      if (typeof obj["@id"] === "string") ids.add(obj["@id"]);
      if (hasJsonLdType(obj, "SoftwareApplication") && obj.offers) {
        if (hasZeroPriceOffer(obj.offers)) {
          hasFreeOffer = true;
        }
      }
    });
    assert.ok(hasFreeOffer, "GET / SoftwareApplication JSON-LD missing a $0 / £0 Free Tier Offer");
    const idList = [...ids];
    assert.ok(idList.some((id) => id.endsWith("#organization")), `GET / JSON-LD @id nodes missing #organization (got ${idList.join(", ")})`);
    assert.ok(idList.some((id) => id.endsWith("#software")), `GET / JSON-LD @id nodes missing #software (got ${idList.join(", ")})`);
    assert.ok(idList.some((id) => id.endsWith("#founder")), `GET / JSON-LD @id nodes missing #founder (got ${idList.join(", ")})`);
  });

  test("T1.7.4 All comparison, legal, and core routes emit clean headlines, icon-512.png Organization.logo, and canonical sameAs", async () => {
    const routesToCheck = [
      "/",
      "/pricing",
      "/about",
      "/support",
      "/terms",
      "/privacy",
      "/refund",
      "/state-of-windows-storage",
      "/clean/folder/winsxs",
      ...ALL_COMPETITOR_SLUGS.map((s) => `/vs/${s}`),
      ...ALL_COMPETITOR_SLUGS.map((s) => `/alternatives/${s}`),
    ];
    for (const route of routesToCheck) {
      const res = await httpGetFollowLocal(route);
      assert.equal(res.status, 200, `${route} returned ${res.status}`);
      const blocks = extractJsonLdBlocks(res.text);
      assert.ok(blocks.length >= 1, `${route} missing JSON-LD`);
      walkJsonNodes(blocks, (obj) => {
        if (typeof obj.headline === "string") {
          assert.ok(!/<[^>]+>|&(?:amp|lt|gt|quot);/i.test(obj.headline), `${route} JSON-LD headline contains HTML/entities: ${obj.headline}`);
        }
        if (isFullOrganizationNode(obj)) {
          assert.ok(obj.logo, `${route} Organization node missing required 'logo' property`);
          const logoUrl = extractLogoUrl(obj.logo);
          assert.equal(logoUrl, CANONICAL_LOGO_URL, `${route} Organization.logo=${String(logoUrl)}, expected ${CANONICAL_LOGO_URL}`);
        }
        if (Array.isArray(obj.sameAs)) {
          for (const u of obj.sameAs) {
            assert.ok(!String(u).includes("winget-pkgs/pull/480164"), `${route} sameAs contains stale PR URL`);
            assert.ok(!String(u).includes("linkedin.com"), `${route} sameAs contains forbidden LinkedIn URL`);
          }
        }
      });
    }
  });

  test("T1.7.5 /safe-to-delete BreadcrumbList matches HTML breadcrumb and seo/html.ts accepts digital SaaS offers cleanly across all merchant/tool routes", async () => {
    const res = await httpGet("/safe-to-delete");
    assert.equal(res.status, 200);
    assert.ok(!res.text.includes("og-card.png"), "/safe-to-delete still references og-card.png");
    assert.match(res.text, /<nav[^>]*class="ed-crumb"[^>]*>[\s\S]*?<a href="\/tools">Tools<\/a>/i);
    const blocks = extractJsonLdBlocks(res.text);
    let secondCrumb: { name?: string; item?: string } | undefined;
    walkJsonNodes(blocks, (obj) => {
      if (hasJsonLdType(obj, "BreadcrumbList") && Array.isArray(obj.itemListElement)) {
        secondCrumb = obj.itemListElement.find((x: any) => Number(x?.position) === 2) as
          | { name?: string; item?: string }
          | undefined;
      }
    });
    assert.ok(secondCrumb, "/safe-to-delete missing BreadcrumbList position 2");
    assert.equal(secondCrumb?.name, "Tools");
    assert.equal(secondCrumb?.item, "https://sweeprcleaner.com/tools");

    for (const route of ["/", "/pricing", "/safe-to-delete", "/tools", "/tools/pc-cache-calculator"]) {
      const page = await httpGet(route);
      assert.equal(page.status, 200);
      const parsed = parseHtml(page.text);
      assert.equal(parsed.jsonLdErrors, 0, `${route} has JSON-LD parse errors`);
      assert.deepEqual(
        parsed.merchantListingIssues,
        [],
        `seo/html.ts still flags digital SaaS offers on ${route}: ${parsed.merchantListingIssues.join("; ")}`
      );
    }

    const toolHtml = renderTransactionalToolPage(TRANSACTIONAL_TOOLS[0], "e2e-visitor");
    const parsedTool = parseHtml(toolHtml);
    assert.equal(parsedTool.jsonLdErrors, 0);
    assert.deepEqual(
      parsedTool.merchantListingIssues,
      [],
      `seo/html.ts flags renderTransactionalToolPage: ${parsedTool.merchantListingIssues.join("; ")}`
    );
  });
});

describe("Tier 1 — Area 8: llms.txt & telemetry-truth.ts GEO Polish (p3-3)", () => {
  test("T1.8.1 GET /llms.txt and /llms-full.txt reflect 6.76 MB/MiB and Individual Validation (IV)", async () => {
    for (const path of ["/llms.txt", "/llms-full.txt"]) {
      const res = await httpGet(path);
      assert.equal(res.status, 200, `${path} returned ${res.status}`);
      assert.match(res.headers.get("content-type") ?? "", /^text\/plain/i);
      assert.match(res.text, /6\.76\s*M(?:i?B)/i, `${path} missing 6.76 MB/MiB`);
      assert.match(res.text, /Individual Validation|\bIV\b/i, `${path} missing Individual Validation / IV`);
      assert.ok(!/6\.52\s*M(?:i?B)|Authenticode OV/i.test(res.text), `${path} leaks stale 6.52 MB or Authenticode OV`);
    }
  });

  test("T1.8.2 GET /llms.txt Top-10 heaviest folder list sorts monotonically descending by GB (46 GB Docker > 4.6 GB Elgato)", async () => {
    const res = await httpGet("/llms.txt");
    assert.equal(res.status, 200);
    const { rankedLines, gbs } = extractTop10LlmsGb(res.text);
    assert.ok(rankedLines.length >= 8, `Expected >=8 Top-10 ranked GB lines in /llms.txt, got ${rankedLines.length}`);
    for (const gb of gbs) {
      assert.ok(Number.isFinite(gb) && gb > 0, `/llms.txt Top-10 row failed GB extraction: ${gbs.join(", ")}`);
    }
    for (let i = 0; i < gbs.length - 1; i++) {
      assert.ok(gbs[i] >= gbs[i + 1], `/llms.txt Top-10 out of GB order at #${i + 1}: ${gbs[i]} GB before ${gbs[i + 1]} GB`);
    }
    const dockerIdx = rankedLines.findIndex((l) => /Docker/i.test(l));
    const elgatoIdx = rankedLines.findIndex((l) => /Elgato/i.test(l));
    assert.notEqual(dockerIdx, -1, "/llms.txt Top-10 missing Docker Desktop WSL2 (46 GB) entry");
    if (elgatoIdx !== -1) {
      assert.ok(dockerIdx < elgatoIdx, `/llms.txt ranked Elgato (#${elgatoIdx + 1}) above Docker (#${dockerIdx + 1})`);
    } else {
      assert.ok(
        gbs[gbs.length - 1] > 4.6,
        `/llms.txt omitted Elgato (4.6 GB) from Top-10 even though #${gbs.length} is only ${gbs[gbs.length - 1]} GB`
      );
    }
  });

  test("T1.8.3 GET /state-of-windows-storage Top-10 table sorts monotonically descending by Median GB cell", async () => {
    const res = await httpGet("/state-of-windows-storage");
    assert.equal(res.status, 200);
    const { rows, top10Gbs } = extractStateTableMedianGbs(res.text);
    for (const gb of top10Gbs) {
      assert.ok(Number.isFinite(gb) && gb > 0, `Invalid Median GB cell parsed in #top-15-heaviest-folders: ${top10Gbs.join(", ")}`);
    }
    for (let i = 0; i < top10Gbs.length - 1; i++) {
      assert.ok(
        top10Gbs[i] >= top10Gbs[i + 1],
        `/state-of-windows-storage row #${i + 1} (${top10Gbs[i]} GB) < row #${i + 2} (${top10Gbs[i + 1]} GB)`
      );
    }
    const top10Rows = rows.slice(0, 10);
    const dockerRowIdx = top10Rows.findIndex((r) => /Docker/i.test(r));
    const elgatoRowIdx = top10Rows.findIndex((r) => /Elgato/i.test(r));
    assert.notEqual(dockerRowIdx, -1, "/state-of-windows-storage Top-10 missing Docker Desktop WSL2 (46 GB)");
    if (elgatoRowIdx !== -1) {
      assert.ok(dockerRowIdx < elgatoRowIdx, "Docker (46 GB) must rank strictly above Elgato (4.6 GB)");
    } else {
      assert.ok(
        top10Gbs[top10Gbs.length - 1] > 4.6,
        `/state-of-windows-storage omitted Elgato (4.6 GB) while Top-10 row #10 is only ${top10Gbs[top10Gbs.length - 1]} GB`
      );
    }
  });

  test("T1.8.4 /llms.txt, /state-of-windows-storage, and telemetry-truth.ts remove '0 anonymized desktop scan samples' and * 30 sample inflation", async () => {
    const llms = await httpGet("/llms.txt");
    assert.ok(!/0 anonymized desktop scan samples/i.test(llms.text), "/llms.txt still outputs '0 anonymized desktop scan samples'");
    const state = await httpGet("/state-of-windows-storage");
    assert.ok(!/0 anonymized desktop scan samples/i.test(state.text), "/state-of-windows-storage outputs '0 anonymized desktop scan samples'");

    const telemetrySrc = readFileSync(resolve(SERVER_DIR, "src/seo/telemetry-truth.ts"), "utf-8");
    assert.ok(
      !/published_lab_benchmarks\s*\*\s*30/.test(telemetrySrc),
      "telemetry-truth.ts still inflates sample count via published_lab_benchmarks * 30"
    );
    assert.ok(
      !/>\s*180\s*<\s*\/div\s*>\s*[\s\S]{0,120}?k-anonymous/i.test(state.text),
      "/state-of-windows-storage still renders synthetic '180' sample count when live desktop samples = 0"
    );
  });

  test("T1.8.5 GET /llms.txt includes Benjamin Cook attribution, GitHub checksums, Winget/Scoop CLI, /pricing tiers, and 14-day /refund", async () => {
    const res = await httpGet("/llms.txt");
    assert.equal(res.status, 200);
    assert.ok(res.text.includes("Benjamin Cook"), "/llms.txt missing Benjamin Cook sole-trader attribution");
    assert.match(res.text, /github\.com\/BenCook1996\/sweepr-desktop|release-manifest\.json/i, "/llms.txt missing GitHub checksums/release link");
    assert.match(res.text, /winget install\s+Sweepr\.SweeprCleaner/i, "/llms.txt missing winget install command");
    assert.match(res.text, /scoop\s+(?:bucket\s+add|install)/i, "/llms.txt missing scoop install command");
    assert.match(res.text, /\/pricing/i, "/llms.txt missing /pricing reference");
    assert.match(res.text, /14[- ]day[\s\S]*\/refund|\/refund[\s\S]*14[- ]day/i, "/llms.txt missing 14-day /refund citation");
  });
});

describe("Tier 1 — Area 9: Refunds & Rust-Canonical Spec Harmonization (p3-4a, p3-4b)", () => {
  test("T1.9.1 GET /refund explicitly documents Stripe, PayPal, and Google Play / RevenueCat (com.sweepr.app) refund paths", async () => {
    const res = await httpGet("/refund");
    assert.equal(res.status, 200);
    assert.match(res.text, /Stripe/i, "/refund missing Stripe refund instructions");
    assert.match(res.text, /PayPal/i, "/refund missing PayPal refund instructions");
    assert.match(res.text, /Google Play/i, "/refund missing Google Play refund instructions");
    assert.match(res.text, /RevenueCat|com\.sweepr\.app/i, "/refund missing RevenueCat / com.sweepr.app Android subscription details");
  });

  test("T1.9.2 /refund, /privacy, and /terms share reconciled 'November 2026' effective/updated dates", async () => {
    for (const route of ["/refund", "/privacy", "/terms"]) {
      const res = await httpGet(route);
      assert.equal(res.status, 200);
      assert.match(res.text, /November\s+2026/i, `${route} missing reconciled 'November 2026' date`);
      assert.ok(!/October\s+2026/i.test(res.text), `${route} still carries stale 'October 2026' date`);
    }
  });

  test("T1.9.3 Core web/SSR pages and clean-items.json match Rust-canonical Unlimited Free + 2-10 GB Quarantine + Zero-Telemetry Offline Mode", async () => {
    const routes = ["/", "/pricing", "/order", "/terms", "/support", "/tools", "/safe-to-delete", "/state-of-windows-storage", "/clean/folder/winsxs"];
    for (const route of routes) {
      const res = await httpGet(route);
      assert.equal(res.status, 200);
      assert.ok(!/500\s*MB\s+Free\s+Starter/i.test(res.text), `${route} leaks stale '500 MB Free Starter'`);
      assert.ok(!/(?:<|&lt;)\s*50\s*MB|300\s+rolling\s+items|max\s+300\s+items/i.test(res.text), `${route} leaks stale '<50 MB / 300 items'`);
    }
    const cleanItemsRaw = readFileSync(resolve(SERVER_DIR, "src/data/clean-items.json"), "utf-8");
    assert.ok(
      !/500\s*MB\s+(?:Free\s+Starter|free\b|starter|cap|limit|per\s+run|monthly)/i.test(cleanItemsRaw),
      "clean-items.json still contains stale '500 MB' free-tier copy"
    );
    assert.ok(!/(?:<|&lt;)\s*50\s*MB|300\s+rolling\s+items/i.test(cleanItemsRaw), "clean-items.json still contains stale '<50 MB / 300 rolling items'");

    const home = await httpGet("/");
    assert.match(home.text, /Unlimited/i);
    assert.match(home.text, /2\s*(?:[–-]|&ndash;|&#8211;)\s*10\s*GB/i);
    assert.match(home.text, /Zero[- ]Telemetry|Offline\s+Mode/i, "GET / missing Zero-Telemetry / Offline Mode copy");
    const pricing = await httpGet("/pricing");
    assert.match(pricing.text, /Unlimited/i);
    assert.match(pricing.text, /2\s*(?:[–-]|&ndash;|&#8211;)\s*10\s*GB/i);
    assert.match(pricing.text, /Zero[- ]Telemetry|Offline\s+Mode/i, "GET /pricing missing Zero-Telemetry / Offline Mode copy");
  });

  test("T1.9.4 GET /pad.xml returns well-formed XML harmonized with Rust-canonical behavior and 6.76 MB binary", async () => {
    const res = await httpGet("/pad.xml");
    assert.equal(res.status, 200);
    assert.ok(isSimpleWellFormedXml(res.text, "XML_DIZ_INFO"), "/pad.xml is not well-formed XML");
    assert.ok(res.text.includes("<File_Size_Bytes>7085912</File_Size_Bytes>"), "/pad.xml missing 7085912 bytes");
    assert.ok(res.text.includes("<File_Size_MB>6.76</File_Size_MB>"), "/pad.xml missing 6.76 MB");
    assert.match(res.text, /Unlimited\s+(?:free\s+)?Temp/i, "/pad.xml missing Unlimited Temp clean spec");
    assert.match(res.text, /2\s*(?:[–-]|&ndash;|&#8211;)\s*10\s*GB/i, "/pad.xml missing 2-10 GB quarantine budget");
    assert.match(res.text, /Zero[- ]Telemetry|Offline\s+Mode/i, "/pad.xml missing Zero-Telemetry Offline Mode spec");
    assert.ok(!/500\s*MB\s+Free|(?:<|&lt;)\s*50\s*MB|300\s+rolling/i.test(res.text), "/pad.xml leaks stale caps");
    assert.ok(!/data\s+breach|checks\s+if\s+your\s+email\s+was\s+leaked|DoD\s+File\s+Shredder|DoD\s+5220\.22-M/i.test(res.text), "/pad.xml advertises unbuilt/invalid claims");
  });

  test("T1.9.5 Distribution manifests, i18n-dict.js, and localized /de, /fr, /es routes match Rust-canonical specs", async () => {
    const wingetDir = resolve(REPO_ROOT, "winget-manifests/manifests/s/Sweepr/SweeprCleaner/0.1.0");
    const wingetText = readdirSync(wingetDir)
      .filter((f) => f.endsWith(".yaml"))
      .map((f) => readFileSync(join(wingetDir, f), "utf-8"))
      .join("\n");
    assert.ok(wingetText.includes(CANONICAL_EXE_SHA256), "winget manifest missing EXE SHA-256");
    assert.ok(!/500\s*MB|(?:<|&lt;)\s*50\s*MB|300\s+rolling/i.test(wingetText), "winget manifest contains stale cap");
    assert.match(wingetText, /Zero[- ]Telemetry|Offline\s+Mode/i, "winget manifest missing Zero-Telemetry Offline Mode");

    const scoopJson = readFileSync(resolve(REPO_ROOT, "scoop/bucket/sweepr-cleaner.json"), "utf-8");
    assert.ok(scoopJson.toUpperCase().includes(CANONICAL_EXE_SHA256), "scoop manifest missing EXE SHA-256");
    assert.match(scoopJson, /2\s*[–-]\s*10\s*GB.*5\s*GB\s*default/i, "scoop manifest missing 2-10 GB quarantine spec");

    const chocoNuspec = readFileSync(resolve(REPO_ROOT, "chocolatey/sweepr-cleaner.nuspec"), "utf-8");
    assert.match(chocoNuspec, /2\s*[–-]\s*10\s*GB.*5\s*GB\s*default/i, "chocolatey nuspec missing 2-10 GB quarantine spec");
    assert.ok(!/500\s*MB|(?:<|&lt;)\s*50\s*MB|300\s+rolling/i.test(chocoNuspec), "chocolatey nuspec contains stale cap");

    const i18nDict = readFileSync(resolve(PUBLIC_DIR, "i18n-dict.js"), "utf-8");
    assert.ok(!/500\s*MB\s+Free\s+Starter|500\s*Mo/i.test(i18nDict), "i18n-dict.js still contains '500 MB Free Starter / 500 Mo'");
    assert.ok(!/(?:<|&lt;)\s*50\s*Mo/i.test(i18nDict), "i18n-dict.js still contains French '<50 Mo'");
    assert.ok(!/DoD\s+File\s+Shredder|DoD\s+5220\.22-M|DoD-Dateischredder/i.test(i18nDict), "i18n-dict.js still contains DoD shredder strings");

    for (const loc of ["/de", "/fr", "/es", "/de/pricing", "/fr/pricing", "/es/pricing", "/de/order", "/fr/order", "/es/order"]) {
      const res = await httpGet(loc);
      assert.equal(res.status, 200, `${loc} returned ${res.status}`);
      assert.ok(
        !/(?:<|&lt;)\s*50\s*M[Bo]|max\.?\s*300|m[aá]x\.?\s*300|500\s*M[Bo]|DoD-Dateischredder/i.test(res.text),
        `${loc} leaks stale <50 MB/Mo / 300 / 500 MB/Mo / DoD-Dateischredder copy`
      );
    }
  });
});

// ============================================================================
// TIER 2: BOUNDARY & CORNER CASES
// ============================================================================

describe("Tier 2 — Boundary & Corner Cases", () => {
  test("T2.1 Exact forbidden strings sweep across HTTP routes, localized pages, clean-items.json, manifests, and i18n", async () => {
    const forbiddenChecks: Array<{ label: string; re: RegExp }> = [
      { label: "SWEEPR Cleaner Inc.", re: /SWEEPR\s+Cleaner\s+Inc\b/i },
      { label: "24/7 Support Desk", re: /24\/7\s+Support\s+Desk/i },
      { label: "SWEEPR Storage Research Lab", re: /SWEEPR\s+Storage\s+Research\s+Lab/i },
      { label: "og-card.png", re: /og-card\.png/i },
      { label: "ReturnByMail", re: /ReturnByMail/ },
      { label: "OfferShippingDetails", re: /OfferShippingDetails/ },
      { label: "SSL.com Authenticode OV", re: /SSL\.com\s+Authenticode\s+OV\b/i },
      { label: "SSL.com OV/EV", re: /SSL\.com\s+OV\/EV/i },
      { label: "6.52 MB/MiB", re: /\b6\.52\s*M(?:i?B)\b/i },
      { label: "5.8 MB/MiB", re: /\b5\.8\s*M(?:i?B)\b/i },
      { label: "0 anonymized desktop scan samples", re: /0\s+anonymized\s+desktop\s+scan\s+samples/i },
      { label: "winget-pkgs/pull/480164", re: /winget-pkgs\/pull\/480164/i },
      { label: "500 MB Free Starter / 500 Mo", re: /500\s*MB\s+Free\s+Starter|\b500\s*Mo\b/i },
      { label: "<50 MB / <50 Mo", re: /(?:<|&lt;)\s*50\s*M(?:B|o)\b/i },
      { label: "300 rolling items / max 300", re: /300\s+rolling\s+items|max\.?\s+300\s+(?:items|Dateien|fichiers|archivos)/i },
      { label: "GPU Shader Cac", re: /GPU\s+Shader\s+Cac/ },
      { label: "DoD File Shredder / 5220.22-M / Dateischredder", re: /DoD\s+(?:File\s+Shredder|5220\.22-M)|DoD-Dateischredder/i },
      { label: "27.7 GB", re: /\b27\.7\s*GB\b/ },
      { label: "linkedin.com", re: /linkedin\.com/i },
    ];

    const routesToSweep = [
      "/",
      "/pricing",
      "/order",
      "/about",
      "/support",
      "/terms",
      "/privacy",
      "/refund",
      "/tools",
      "/tools/pc-cache-calculator",
      "/safe-to-delete",
      "/state-of-windows-storage",
      "/clean",
      "/llms.txt",
      "/llms-full.txt",
      "/pad.xml",
      "/download?platform=windows",
      "/download?platform=picker",
      "/de",
      "/fr",
      "/es",
      "/de/pricing",
      "/fr/pricing",
      "/es/pricing",
      "/de/order",
      "/fr/order",
      "/es/order",
      ...TOP_25_DIRECT_ANSWER_ROUTES,
      ...EXTRA_PROOF_ROUTES,
      ...ALL_COMPETITOR_SLUGS.map((s) => `/vs/${s}`),
      ...ALL_COMPETITOR_SLUGS.map((s) => `/alternatives/${s}`),
    ];

    const violations: string[] = [];
    for (const route of routesToSweep) {
      const res = await httpGetFollowLocal(route);
      if (res.status !== 200) {
        violations.push(`${route} returned HTTP ${res.status}`);
        continue;
      }
      for (const chk of forbiddenChecks) {
        if (chk.re.test(res.text)) {
          violations.push(`${route} matched forbidden pattern [${chk.label}]`);
        }
      }
    }

    const wingetDir = resolve(REPO_ROOT, "winget-manifests/manifests/s/Sweepr/SweeprCleaner/0.1.0");
    const wingetFiles = readdirSync(wingetDir).filter((f) => f.endsWith(".yaml")).map((f) => join(wingetDir, f));

    const diskArtifacts = [
      resolve(PUBLIC_DIR, "i18n-dict.js"),
      resolve(SERVER_DIR, "src/data/clean-items.json"),
      resolve(REPO_ROOT, "README.md"),
      resolve(REPO_ROOT, "chocolatey/tools/VERIFICATION.txt"),
      resolve(REPO_ROOT, "chocolatey/sweepr-cleaner.nuspec"),
      resolve(REPO_ROOT, "scoop/bucket/sweepr-cleaner.json"),
      resolve(REPO_ROOT, "homebrew/Casks/sweepr-cleaner.rb"),
      ...wingetFiles,
    ];
    for (const file of diskArtifacts) {
      const content = readFileSync(file, "utf-8");
      for (const chk of forbiddenChecks) {
        if (chk.re.test(content)) {
          violations.push(`${file} matched forbidden pattern [${chk.label}]`);
        }
      }
    }

    assert.deepEqual(violations, [], `Forbidden string / HTTP status violations:\n${violations.join("\n")}`);
  });

  test("T2.2 Programmatic JSON.parse() graph validation across all HTML, SSR, legal, and switcher JSON-LD blocks", async () => {
    const htmlRoutes = [
      "/",
      "/pricing",
      "/order",
      "/about",
      "/support",
      "/terms",
      "/privacy",
      "/refund",
      "/tools",
      "/tools/pc-cache-calculator",
      "/safe-to-delete",
      "/state-of-windows-storage",
      "/clean/folder/winsxs",
      "/clean/app/nvidia-dxcache",
      ...ALL_COMPETITOR_SLUGS.map((s) => `/vs/${s}`),
      ...ALL_COMPETITOR_SLUGS.map((s) => `/alternatives/${s}`),
    ];

    for (const route of htmlRoutes) {
      const res = await httpGetFollowLocal(route);
      assert.equal(res.status, 200, `${route} returned ${res.status}`);
      assert.ok(!res.text.includes("og-card.png"), `${route} leaks 404 og-card.png`);
      const blocks = extractJsonLdBlocks(res.text);
      assert.ok(blocks.length >= 1, `${route} emitted zero JSON-LD blocks`);
      const serialized = JSON.stringify(blocks);
      assert.ok(!serialized.includes("ReturnByMail"), `${route} JSON-LD contains ReturnByMail`);
      assert.ok(!serialized.includes("OfferShippingDetails"), `${route} JSON-LD contains OfferShippingDetails`);
      assert.ok(!serialized.includes("winget-pkgs/pull/480164"), `${route} JSON-LD sameAs contains stale PR URL`);

      walkJsonNodes(blocks, (obj) => {
        if (typeof obj.headline === "string") {
          assert.ok(!/<[^>]+>|&(?:amp|lt|gt|quot);/i.test(obj.headline), `${route} dirty headline: ${obj.headline}`);
        }
        if (typeof obj.name === "string") {
          assert.ok(!/<[^>]+>|&(?:amp|lt|gt|quot);/i.test(obj.name), `${route} dirty name: ${obj.name}`);
        }
        if (isFullOrganizationNode(obj)) {
          assert.ok(obj.logo, `${route} Organization missing logo`);
          const logoUrl = extractLogoUrl(obj.logo);
          assert.equal(logoUrl, CANONICAL_LOGO_URL, `${route} invalid Organization.logo: ${String(logoUrl)}`);
        }
      });
    }
  });

  test("T2.3 All referenced raster images (img, og:image, twitter:image, JSON-LD image/logo) return 200 with valid non-legacy PNG/WebP/JPEG headers", async () => {
    const items = readCleanItems();
    const proofRoutes = items
      .filter((i) => typeof i.proofImage === "string" && i.proofImage.trim().length > 0)
      .map((i) => `/clean/${i.category}/${i.slug}`);
    const routes = [
      "/",
      "/pricing",
      "/order",
      "/about",
      "/tools",
      "/safe-to-delete",
      "/state-of-windows-storage",
      ...TOP_25_DIRECT_ANSWER_ROUTES,
      ...proofRoutes,
      ...ALL_COMPETITOR_SLUGS.map((s) => `/vs/${s}`),
      ...ALL_COMPETITOR_SLUGS.map((s) => `/alternatives/${s}`),
    ];

    const seenUrls = new Set<string>();
    for (const route of [...new Set(routes)]) {
      const res = await httpGetFollowLocal(route);
      assert.equal(res.status, 200, `${route} returned ${res.status}`);
      for (const img of extractImgTags(res.text)) {
        if (!img.src || img.src.endsWith(".svg") || img.src.startsWith("data:")) continue;
        seenUrls.add(toLocalPath(img.src, res.finalPath));
      }
      const ogImg = extractMetaContent(res.text, "property", "og:image");
      if (ogImg) seenUrls.add(toLocalPath(ogImg, res.finalPath));
      const twImg = extractMetaContent(res.text, "name", "twitter:image");
      if (twImg) seenUrls.add(toLocalPath(twImg, res.finalPath));
      for (const block of extractJsonLdBlocks(res.text)) {
        walkJsonNodes(block, (obj) => {
          const imgs = Array.isArray(obj.image) ? obj.image : obj.image ? [obj.image] : [];
          for (const im of imgs) {
            const url = extractLogoUrl(im);
            if (url && !url.endsWith(".svg")) seenUrls.add(toLocalPath(url, res.finalPath));
          }
          if (obj.logo) {
            const url = extractLogoUrl(obj.logo);
            if (url && !url.endsWith(".svg")) seenUrls.add(toLocalPath(url, res.finalPath));
          }
        });
      }
    }

    assert.ok(seenUrls.size >= 3, "Expected >= 3 distinct raster asset URLs across pages");
    for (const urlPath of seenUrls) {
      assert.ok(!/vpn-/i.test(urlPath), `Forbidden VPN image referenced: ${urlPath}`);
      const res = await httpGet(urlPath);
      assert.equal(res.status, 200, `Asset ${urlPath} returned ${res.status}`);
      const dims = parseImageBinary(res.buffer);
      assert.ok(dims.width > 0 && dims.height > 0, `Asset ${urlPath} has zero dimensions`);
      const sha = sha256Hex(res.buffer);
      assert.ok(!sha.startsWith(LEGACY_SCREENSHOT_SHA256_PREFIX), `Asset ${urlPath} still has legacy screenshot SHA-256`);
      assert.ok(!LEGACY_PROOF_SHA256_PREFIXES.has(sha.slice(0, 12)), `Asset ${urlPath} still has legacy proof SHA-256`);
    }
  });

  test("T2.4 /sitemap.xml is well-formed XML, includes /about, excludes noindexed guides, and legal dates match November 2026", async () => {
    const res = await httpGet("/sitemap.xml");
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /application\/xml|text\/xml/i);
    assert.ok(isSimpleWellFormedXml(res.text, "urlset"), "/sitemap.xml is not well-formed XML");
    assert.ok(res.text.includes("<loc>https://sweeprcleaner.com/about</loc>"), "/sitemap.xml missing /about URL");

    const locs = [...res.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
    const locSet = new Set(locs);
    const noindexed = readCleanItems().filter((i) => i.noindex || i.mergedIntoSlug);
    assert.ok(noindexed.length > 0, "Expected noindexed items in clean-items.json");
    const leaked = noindexed
      .map((i) => `https://sweeprcleaner.com/clean/${i.category}/${i.slug}`)
      .filter((url) => locSet.has(url));
    assert.deepEqual(leaked, [], `/sitemap.xml leaked noindexed guide URLs: ${leaked.join(", ")}`);

    for (const legalRoute of ["/refund", "/privacy", "/terms"]) {
      const legalRes = await httpGet(legalRoute);
      assert.equal(legalRes.status, 200, `${legalRoute} returned ${legalRes.status}`);
      assert.match(legalRes.text, /November\s+2026/i, `${legalRoute} missing reconciled 'November 2026' date`);
      assert.ok(!/October\s+2026/i.test(legalRes.text), `${legalRoute} still carries stale 'October 2026' date`);
    }
  });

  test("T2.5 Monotonic Sort Boundary: /state-of-windows-storage and /llms.txt Top-10 GB lists are strictly non-increasing", async () => {
    const [llms, state] = await Promise.all([httpGet("/llms.txt"), httpGet("/state-of-windows-storage")]);
    assert.equal(llms.status, 200);
    assert.equal(state.status, 200);

    const { gbs: llmsGbs } = extractTop10LlmsGb(llms.text);
    assert.ok(llmsGbs.length >= 8, `Expected >=8 Top-10 lines in /llms.txt, got ${llmsGbs.length}`);
    for (let i = 0; i < llmsGbs.length - 1; i++) {
      assert.ok(llmsGbs[i] >= llmsGbs[i + 1], `/llms.txt monotonic sort boundary violated at #${i + 1}: ${llmsGbs[i]} < ${llmsGbs[i + 1]}`);
    }

    const { top10Gbs } = extractStateTableMedianGbs(state.text);
    for (let i = 0; i < top10Gbs.length - 1; i++) {
      assert.ok(top10Gbs[i] >= top10Gbs[i + 1], `/state-of-windows-storage monotonic sort boundary violated at #${i + 1}: ${top10Gbs[i]} < ${top10Gbs[i + 1]}`);
    }
  });
});

// ============================================================================
// TIER 3: CROSS-FEATURE COMBINATIONS
// ============================================================================

describe("Tier 3 — Cross-Feature Combinations", () => {
  test("T3.1 Desktop Rust safety.rs / cleaner.rs / rules.rs / licensing.rs canonical invariants align with web & manifest specs", async () => {
    const safetyRs = readFileSync(resolve(APP_DIR, "src-tauri/src/safety.rs"), "utf-8");
    assert.ok(safetyRs.includes("0x400"), "safety.rs missing 0x400 reparse point guard");
    assert.ok(safetyRs.includes("24 * 30"), "safety.rs missing 720h Downloads age guard");
    for (const protectedDir of ["document_dir", "desktop_dir", "download_dir", "picture_dir", "video_dir", "audio_dir"]) {
      assert.ok(safetyRs.includes(protectedDir), `safety.rs missing ${protectedDir}`);
    }

    const rulesRs = readFileSync(resolve(APP_DIR, "src-tauri/src/rules.rs"), "utf-8");
    const freeIds = ["temp", "chrome", "edge", "brave", "firefox"];
    for (const id of freeIds) {
      assert.match(rulesRs, new RegExp(`\\{[^}]*id:\\s*"${id}"[^}]*free:\\s*true[^}]*\\}`), `rules.rs missing free: true for '${id}'`);
    }
    assert.match(rulesRs, /\{[^}]*id:\s*"safari"[^}]*free:\s*false[^}]*\}/, "rules.rs must mark safari as free: false");

    const cleanerRs = readFileSync(resolve(APP_DIR, "src-tauri/src/cleaner.rs"), "utf-8");
    assert.ok(cleanerRs.includes("QUARANTINE_RETENTION_SECS: u64 = 7 * 24 * 3600"));
    assert.ok(cleanerRs.includes("QUARANTINE_MIN_BUDGET_BYTES: u64 = 2 * 1024 * 1024 * 1024"));
    assert.ok(cleanerRs.includes("QUARANTINE_DEFAULT_BUDGET_BYTES: u64 = 5 * 1024 * 1024 * 1024"));
    assert.ok(cleanerRs.includes("QUARANTINE_MAX_BUDGET_BYTES: u64 = 10 * 1024 * 1024 * 1024"));

    const commandsRs = readFileSync(resolve(APP_DIR, "src-tauri/src/commands.rs"), "utf-8");
    assert.ok(commandsRs.includes("unlimited: true"));
    assert.ok(commandsRs.includes("telemetry_enabled: false"));

    const licensingRs = readFileSync(resolve(APP_DIR, "src-tauri/src/licensing.rs"), "utf-8");
    assert.ok(licensingRs.includes("72 * 3600") && licensingRs.includes("CLOCK_SKEW_LEEWAY_SECS"));

    // Cross-layer web & manifest parity check
    const [home, pricing, pad] = await Promise.all([httpGet("/"), httpGet("/pricing"), httpGet("/pad.xml")]);
    assert.match(home.text, /Unlimited/i);
    assert.match(pricing.text, /2\s*(?:[–-]|&ndash;|&#8211;)\s*10\s*GB/i);
    assert.match(pad.text, /2\s*(?:[–-]|&ndash;|&#8211;)\s*10\s*GB/i);
    const scoopJson = readFileSync(resolve(REPO_ROOT, "scoop/bucket/sweepr-cleaner.json"), "utf-8");
    assert.match(scoopJson, /2\s*[–-]\s*10\s*GB.*5\s*GB\s*default/i);
  });

  test("T3.2 ui-shell.ts ORGANIZATION_SAME_AS and footer/header match static HTML pages", async () => {
    const uiShellSrc = readFileSync(resolve(SERVER_DIR, "src/ui-shell.ts"), "utf-8");
    assert.ok(!uiShellSrc.includes("winget-pkgs/pull/480164"), "ui-shell.ts ORGANIZATION_SAME_AS still contains stale PR URL");
    assert.ok(uiShellSrc.includes('href="/about"'), "ui-shell.ts header/footer missing /about link");

    const routes = [
      "/",
      "/pricing",
      "/about",
      "/support",
      "/terms",
      "/privacy",
      "/refund",
      "/clean",
      "/tools",
      "/safe-to-delete",
      "/state-of-windows-storage",
      ...ALL_COMPETITOR_SLUGS.map((s) => `/vs/${s}`),
      ...ALL_COMPETITOR_SLUGS.map((s) => `/alternatives/${s}`),
    ];
    for (const route of routes) {
      const res = await httpGetFollowLocal(route);
      assert.equal(res.status, 200, `${route} returned ${res.status}`);
      assert.match(res.text, /<a\b[^>]*href=["']\/about["'][^>]*>/i, `${route} missing /about nav/footer link`);
      assert.ok(res.text.includes("Benjamin Cook"), `${route} missing Benjamin Cook attribution`);
    }
  });

  test("T3.3 Localized Route Spec Parity (/de, /fr, /es, /pricing, /order) strips stale <50 MB/Mo, max 300, 500 MB/Mo, and DoD-Dateischredder", async () => {
    const localizedRoutes = ["/de", "/fr", "/es", "/de/pricing", "/fr/pricing", "/es/pricing", "/de/order", "/fr/order", "/es/order"];
    const staleRe = /(?:<|&lt;)\s*50\s*M(?:B|o)|max\.?\s*300|m[aá]x\.?\s*300|\b500\s*M(?:B|o)\b|DoD-Dateischredder/i;
    for (const route of localizedRoutes) {
      const res = await httpGet(route);
      assert.equal(res.status, 200, `${route} returned ${res.status}`);
      const title = res.text.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
      const metaDesc = extractMetaContent(res.text, "name", "description") ?? "";
      const ogDesc = extractMetaContent(res.text, "property", "og:description") ?? "";
      assert.ok(!staleRe.test(title), `${route} <title> leaks stale spec: ${title}`);
      assert.ok(!staleRe.test(metaDesc), `${route} meta description leaks stale spec: ${metaDesc}`);
      assert.ok(!staleRe.test(ogDesc), `${route} og:description leaks stale spec: ${ogDesc}`);
      assert.ok(!staleRe.test(res.text), `${route} HTML body leaks stale spec`);
    }
  });
});

// ============================================================================
// TIER 4: REAL-WORLD USER & CRAWLER JOURNEYS
// ============================================================================

describe("Tier 4 — Real-World User & Crawler Journeys", () => {
  test("T4.1 Windows downloader journey: / -> /pricing -> /order -> /download?platform=windows + /release-manifest.json", async () => {
    const home = await httpGet("/");
    assert.equal(home.status, 200);
    assert.match(home.text, /Intel(?:\(R\))?\s+Celeron(?:\(R\))?\s+N5095/i);
    assert.match(home.text, /What SWEEPR Never Touches/i);
    assert.match(home.text, /Unlimited/i);

    const pricing = await httpGet("/pricing");
    assert.equal(pricing.status, 200);
    assert.match(pricing.text, /2\s*(?:[–-]|&ndash;|&#8211;)\s*10\s*GB/i);
    assert.ok(!pricing.text.includes("og-card.png"));

    const order = await httpGet("/order");
    assert.equal(order.status, 200);
    assert.ok(!order.text.includes('class="laptop-frame"'));

    const dlWin = await httpGet("/download?platform=windows");
    assert.equal(dlWin.status, 200);
    assert.match(dlWin.text, /6\.76\s*M(?:i?B)/i);

    const manifest = await httpGet("/release-manifest.json");
    assert.equal(manifest.status, 200);
    const parsed = JSON.parse(manifest.text) as { exe: { bytes: number; sha256: string } };
    assert.equal(parsed.exe.bytes, CANONICAL_EXE_BYTES);
    assert.equal(parsed.exe.sha256, CANONICAL_EXE_SHA256);
  });

  test("T4.2 AI crawler journey: /llms.txt -> /llms-full.txt -> /state-of-windows-storage -> /safe-to-delete -> Top-25 guides", async () => {
    const llms = await httpGet("/llms.txt");
    assert.equal(llms.status, 200);
    assert.ok(llms.text.includes("Benjamin Cook"));
    assert.match(llms.text, /6\.76\s*M(?:i?B)/i);

    const llmsFull = await httpGet("/llms-full.txt");
    assert.equal(llmsFull.status, 200);

    const study = await httpGet("/state-of-windows-storage");
    assert.equal(study.status, 200);
    assert.match(study.text, /What SWEEPR Never Touches/i);

    const safe = await httpGet("/safe-to-delete");
    assert.equal(safe.status, 200);
    assert.match(safe.text, /What SWEEPR Never Touches/i);

    for (const guide of ["/clean/folder/winsxs", "/clean/app/nvidia-dxcache"]) {
      const g = await httpGet(guide);
      assert.equal(g.status, 200);
      assert.ok(!/SWEEPR Storage Research Lab/i.test(g.text));
    }
  });

  test("T4.3 Switcher buyer journey: /vs/ccleaner, /vs/cleanmymac, /alternatives/ccleaner, /alternatives/cleanmymac", async () => {
    for (const path of ["/vs/ccleaner", "/vs/cleanmymac", "/alternatives/ccleaner", "/alternatives/cleanmymac"]) {
      const res = await httpGetFollowLocal(path);
      assert.equal(res.status, 200, `${path} journey failed with ${res.status}`);
      assert.ok(!/500\s*MB\s+Free|(?:<|&lt;)\s*50\s*MB|300\s+rolling|6\.52\s*M(?:i?B)/i.test(res.text), `${path} journey leaked stale spec`);
      assert.ok(!/winget-pkgs\/pull\/480164/.test(res.text), `${path} journey leaked stale PR URL`);
    }
  });

  test("T4.4 Trust & refund journey: /about -> /support -> /refund -> /privacy -> /terms -> /sitemap.xml", async () => {
    const about = await httpGet("/about");
    assert.equal(about.status, 200);
    assert.match(about.text, /87 Upper Brighton Road,\s*Worthing,\s*West Sussex/i);

    const support = await httpGet("/support");
    assert.equal(support.status, 200);
    assert.match(support.text, /within 1 business day\s*\(UK time\)/i);

    const refund = await httpGet("/refund");
    assert.equal(refund.status, 200);
    assert.match(refund.text, /Stripe/i);
    assert.match(refund.text, /PayPal/i);
    assert.match(refund.text, /Google Play/i);
    assert.match(refund.text, /November\s+2026/i);

    const privacy = await httpGet("/privacy");
    assert.equal(privacy.status, 200);
    assert.match(privacy.text, /November\s+2026/i);

    const terms = await httpGet("/terms");
    assert.equal(terms.status, 200);
    assert.match(terms.text, /November\s+2026/i);

    const sitemap = await httpGet("/sitemap.xml");
    assert.equal(sitemap.status, 200);
    assert.ok(sitemap.text.includes("https://sweeprcleaner.com/about"));
  });

  test("T4.5 Calculator & API safety journey: /tools -> /tools/pc-cache-calculator -> POST /api/safe-to-delete/check -> /pad.xml", async () => {
    const tools = await httpGet("/tools");
    assert.equal(tools.status, 200);
    assert.ok(!/500\s*MB\s+Free|(?:<|&lt;)\s*50\s*MB|300\s+rolling/i.test(tools.text));

    const calc = await httpGet("/tools/pc-cache-calculator");
    assert.equal(calc.status, 200);
    assert.equal(parseHtml(calc.text).jsonLdErrors, 0);

    const api = await fetch(`${baseUrl}/api/safe-to-delete/check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "C:\\Windows\\System32\\drivers\\etc\\hosts\n%LOCALAPPDATA%\\Temp" }),
    });
    assert.equal(api.status, 200);
    const data = (await api.json()) as {
      ok: boolean;
      results?: Array<{ input: string; verdict?: string; badge_color?: string }>;
    };
    assert.equal(data.ok, true);
    assert.ok(Array.isArray(data.results) && data.results.length === 2);
    const hostsRes = data.results.find((r) => /hosts/i.test(r.input));
    const tempRes = data.results.find((r) => /Temp/i.test(r.input));
    assert.equal(hostsRes?.verdict, "DO NOT DELETE — OS CRITICAL", `Expected OS CRITICAL for hosts, got ${hostsRes?.verdict}`);
    assert.equal(tempRes?.verdict, "SAFE TO DELETE", `Expected SAFE TO DELETE for %LOCALAPPDATA%\\Temp, got ${tempRes?.verdict}`);

    const pad = await httpGet("/pad.xml");
    assert.equal(pad.status, 200);
    assert.ok(isSimpleWellFormedXml(pad.text, "XML_DIZ_INFO"));
  });
});
