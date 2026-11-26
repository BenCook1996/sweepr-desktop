import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
import { openDb } from "../src/db.js";
import { createApp } from "../src/app.js";
import { parseHtml, parseSitemap } from "../src/seo/html.js";
import { getCleanItems } from "../src/pseo.js";
import { RETIRED_TOOL_REDIRECTS } from "../src/transactional-tools.js";

const { privateKey } = generateKeyPairSync("ed25519");
const ADMIN_PASSWORD = "test-admin-password";

function setup() {
  const repo = openDb(":memory:");
  const app = createApp({
    repo,
    signingKey: privateKey,
    stripe: null,
    config: {
      publicUrl: "https://sweeprcleaner.com",
      stripeWebhookSecret: "",
      priceActivation: "",
      priceMonthly: "",
      trialDays: 7,
      tokenTtlHours: 72,
      maxDevicesPc: 2,
      maxDevicesMobile: 2,
      devEndpoints: false,
      pastDueGraceDays: 3,
      crmAdminUser: "admin",
      crmAdminPassword: ADMIN_PASSWORD,
    },
  });
  return { repo, app };
}

function toPathname(urlOrPath: string): string {
  if (urlOrPath.startsWith("http://") || urlOrPath.startsWith("https://")) {
    return new URL(urlOrPath).pathname || "/";
  }
  const clean = urlOrPath.split("#")[0].split("?")[0];
  return clean || "/";
}

function isIndexableResponse(res: Response, html: string): { ok: boolean; reason?: string } {
  const xRobots = (res.headers.get("x-robots-tag") || "").toLowerCase();
  if (xRobots.includes("noindex")) {
    return { ok: false, reason: `X-Robots-Tag=${xRobots}` };
  }
  const parsed = parseHtml(html);
  if ((parsed.metaRobots || "").toLowerCase().includes("noindex")) {
    return { ok: false, reason: `metaRobots=${parsed.metaRobots}` };
  }
  return { ok: true };
}

function stripScriptsAndStyles(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
}

const SURVIVING_VS = [
  "ccleaner",
  "cleanmymac",
  "bleachbit",
  "avast-cleanup",
  "daisydisk",
  "pearcleaner",
  "onyx",
  "cleanmypc",
  "glary-utilities",
  "wise-disk-cleaner",
];

const SURVIVING_ALT = [
  "ccleaner",
  "cleanmymac",
  "avast-cleanup",
  "bleachbit",
  "cleanmypc",
  "glary-utilities",
  "wise-disk-cleaner",
  "daisydisk",
  "pearcleaner",
  "onyx",
];

const COMPETITOR_LABELS: Record<string, string[]> = {
  ccleaner: ["CCleaner"],
  cleanmymac: ["CleanMyMac"],
  bleachbit: ["BleachBit"],
  "avast-cleanup": ["Avast Cleanup", "Avast"],
  daisydisk: ["DaisyDisk"],
  pearcleaner: ["Pearcleaner"],
  onyx: ["OnyX"],
  cleanmypc: ["CleanMyPC"],
  "glary-utilities": ["Glary Utilities"],
  "wise-disk-cleaner": ["Wise Disk Cleaner"],
};

const PRUNED_30_SLUGS = [
  "arc-browser-cache",
  "overwolf-client-cache",
  "github-desktop-cache",
  "league-of-legends-cache",
  "zen-browser-cache",
  "tor-browser-cache",
  "fl-studio-daw-cache",
  "dolphin-emulator-cache",
  "prism-minecraft-cache",
  "jetbrains-clion-cache",
  "jetbrains-goland-cache",
  "bruno-api-cache",
  "bambu-studio-cache",
  "krita-painting-cache",
  "anydesk-remote-cache",
  "handbrake-encoder-cache",
  "calibre-ebook-cache",
  "zed-editor-cache",
  "mongodb-compass-cache",
  "snagit-capture-cache",
  "ghostty-terminal-cache",
  "rekordbox-dj-cache",
  "line-desktop-cache",
  "topaz-video-ai-cache",
  "cryptneturlcache",
  "windows-logs-etw-sleepstudy",
  "osu-local-cache",
  "godot-editor-cache",
  "ryujinx-switch-vulkan-shader-cache",
  "clipchamp-uwp-cache",
];

describe("Editorial Redesign, Internal Linking & Consolidation Audit", () => {
  const { app } = setup();

  test("1. Sitemap & cleanup parity (101 Tier-1 URLs, all 200 indexable, 0 overlap)", async () => {
    const staticXml = readFileSync("public/sitemap.xml", "utf8");
    const staticUrls = parseSitemap(staticXml);

    const dynRes = await app.request("/sitemap.xml");
    assert.equal(dynRes.status, 200);
    const dynamicUrls = parseSitemap(await dynRes.text());

    assert.equal(staticUrls.length, 101, `Expected 101 static sitemap URLs, got ${staticUrls.length}`);
    assert.equal(dynamicUrls.length, 101, `Expected 101 dynamic sitemap URLs, got ${dynamicUrls.length}`);
    assert.deepEqual(dynamicUrls, staticUrls, "Static and dynamic sitemaps must match identically");

    const cleanupUrls = new Set(parseSitemap(readFileSync("public/sitemap-cleanup.xml", "utf8")));
    for (const url of staticUrls) {
      assert.equal(cleanupUrls.has(url), false, `Tier-1 URL ${url} must not appear in sitemap-cleanup.xml`);
      const res = await app.request(toPathname(url), { redirect: "manual" });
      assert.equal(res.status, 200, `Tier-1 sitemap URL ${url} must return HTTP 200, got ${res.status}`);
      const html = await res.text();
      const idx = isIndexableResponse(res, html);
      assert.equal(idx.ok, true, `Tier-1 sitemap URL ${url} must be indexable (${idx.reason})`);
    }
  });

  test("2. Editorial design system & anti-slop hygiene across all redesigned routes & /support", async () => {
    const curatedGuides = getCleanItems().filter((i) => !i.noindex && !i.mergedIntoSlug);
    assert.equal(curatedGuides.length, 69, `Expected 69 curated indexable guides, got ${curatedGuides.length}`);

    const targets = [
      "/clean",
      "/tools",
      "/safe-to-delete",
      "/tools/pc-cache-calculator",
      "/state-of-windows-storage",
      ...SURVIVING_VS.map((s) => `/vs/${s}`),
      ...SURVIVING_ALT.map((s) => `/alternatives/${s}`),
      "/support",
      "/privacy",
      "/terms",
      "/refund",
      ...curatedGuides.map((g) => `/clean/${g.category}/${g.slug}`),
    ];

    const forbiddenEmojis = ["\u{1F7E2}", "\u{1F525}", "\u26A1", "\u{1F6E1}\uFE0F", "\u{1F4CA}"];

    for (const path of targets) {
      const res = await app.request(path);
      assert.equal(res.status, 200, `GET ${path} must return HTTP 200`);
      const html = await res.text();
      const bodyOnly = stripScriptsAndStyles(html);

      assert.ok(html.includes('class="site-header"'), `${path} missing .site-header`);
      assert.ok(html.includes("/sweepr-editorial.css"), `${path} missing /sweepr-editorial.css`);
      assert.equal(html.includes("glass-nav"), false, `${path} contains legacy glass-nav`);
      assert.equal(html.includes("btn hidden"), false, `${path} contains btn hidden`);
      assert.equal(/\$n\s*\\ge\s*30\$/.test(bodyOnly), false, `${path} contains raw LaTeX $n \\ge 30$`);
      assert.equal(/(?:\n|>)\s*##\s+[A-Za-z0-9]/.test(bodyOnly), false, `${path} contains raw Markdown ## heading`);
      assert.equal(html.includes("/cdn-cgi/l/email-protection"), false, `${path} leaks /cdn-cgi/l/email-protection`);

      for (const emoji of forbiddenEmojis) {
        assert.equal(html.includes(emoji), false, `${path} contains forbidden emoji badge ${emoji}`);
      }

      if (path === "/support") {
        for (const reqId of ['id="supportForm"', 'id="supEmail"', 'id="supSubject"', 'id="supMessage"', 'id="supBtn"', 'id="supStatus"', "/api/support-ticket"]) {
          assert.ok(html.includes(reqId), `/support missing ${reqId}`);
        }
        assert.match(
          html,
          /<!--email_off-->[\s\S]*?support@sweeprcleaner\.com[\s\S]*?<!--\/email_off-->/i,
          "/support must wrap support@sweeprcleaner.com in <!--email_off-->"
        );
      }
    }
  });

  test("3. Full internal link-graph crawl across all 101 sitemap URLs", async () => {
    const sitemapUrls = parseSitemap(readFileSync("public/sitemap.xml", "utf8"));
    const intentionalNoindexPaths = new Set(["/download", "/order", "/login", "/dashboard"]);
    const responseCache = new Map<string, { status: number; indexable: boolean; reason?: string }>();
    const guideInboundSources = new Map<string, Set<string>>();

    const curatedGuides = getCleanItems().filter((i) => !i.noindex && !i.mergedIntoSlug);
    for (const g of curatedGuides) {
      guideInboundSources.set(`/clean/${g.category}/${g.slug}`, new Set<string>());
    }

    async function inspectTarget(pathname: string) {
      const cached = responseCache.get(pathname);
      if (cached) return cached;
      const res = await app.request(pathname, { redirect: "manual" });
      const text = res.status === 200 ? await res.text() : "";
      const idx = res.status === 200 ? isIndexableResponse(res, text) : { ok: false, reason: `status=${res.status}` };
      const entry = { status: res.status, indexable: idx.ok, reason: idx.reason };
      responseCache.set(pathname, entry);
      return entry;
    }

    for (const url of sitemapUrls) {
      const sourcePath = toPathname(url);
      const res = await app.request(sourcePath);
      assert.equal(res.status, 200, `Source sitemap URL ${sourcePath} returned ${res.status}`);
      const html = stripScriptsAndStyles(await res.text());

      const anchorTags = [...html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)];
      for (const match of anchorTags) {
        const tag = match[0];
        const hrefMatch = tag.match(/\bhref="([^"]+)"/i);
        if (!hrefMatch) continue;
        const rawHref = hrefMatch[1].trim();
        if (!rawHref || rawHref.startsWith("#") || rawHref.startsWith("mailto:") || rawHref.startsWith("tel:") || rawHref.startsWith("javascript:")) {
          continue;
        }
        if (rawHref.startsWith("http://") || rawHref.startsWith("https://")) {
          if (!rawHref.startsWith("https://sweeprcleaner.com/")) continue;
        } else if (!rawHref.startsWith("/")) {
          continue;
        }

        const targetPath = toPathname(rawHref);
        if (targetPath.startsWith("/api/") || /\.(?:xml|txt|svg|png|ico|webp|css|js|webmanifest)$/i.test(targetPath)) {
          continue;
        }

        if (targetPath === "/order" || (targetPath === "/download" && rawHref.includes("?"))) {
          assert.match(tag, /\brel="nofollow"/i, `CTA link on ${sourcePath} to ${rawHref} missing rel="nofollow": ${tag}`);
        } else if (targetPath === "/download") {
          assert.doesNotMatch(tag, /\brel="nofollow"/i, `Clean /download link on ${sourcePath} must not carry rel="nofollow": ${tag}`);
        }

        const info = await inspectTarget(targetPath);
        assert.notEqual(info.status, 404, `Broken 404 link on ${sourcePath} -> ${rawHref}`);
        assert.notEqual(info.status, 301, `Redirect 301 link on ${sourcePath} -> ${rawHref}`);
        assert.notEqual(info.status, 410, `Gone 410 link on ${sourcePath} -> ${rawHref}`);
        assert.equal(info.status, 200, `Unexpected status ${info.status} for link on ${sourcePath} -> ${rawHref}`);

        if (!intentionalNoindexPaths.has(targetPath)) {
          assert.equal(info.indexable, true, `Internal link on ${sourcePath} points to noindex route ${rawHref} (${info.reason})`);
        }

        const inbound = guideInboundSources.get(targetPath);
        if (inbound && sourcePath !== targetPath) {
          inbound.add(sourcePath);
        }
      }

      if (sourcePath.startsWith("/vs/") || sourcePath.startsWith("/alternatives/")) {
        for (const match of anchorTags) {
          const tag = match[0];
          const hrefMatch = tag.match(/\bhref="(\/(?:vs|alternatives)\/([a-z0-9-]+))"/i);
          if (!hrefMatch) continue;
          const linkSlug = hrefMatch[2];
          const anchorText = tag.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
          for (const [otherSlug, labels] of Object.entries(COMPETITOR_LABELS)) {
            if (otherSlug === linkSlug) continue;
            for (const lbl of labels) {
              assert.equal(
                anchorText.toLowerCase().includes(lbl.toLowerCase()),
                false,
                `Swapped competitor anchor on ${sourcePath}: href="${hrefMatch[1]}" has anchor text "${anchorText}" mentioning "${lbl}"`
              );
            }
          }
        }
      }
    }

    const starvedGuides: Array<{ path: string; inboundCount: number }> = [];
    for (const [guidePath, sources] of guideInboundSources.entries()) {
      if (sources.size < 4) {
        starvedGuides.push({ path: guidePath, inboundCount: sources.size });
      }
    }
    assert.deepEqual(
      starvedGuides,
      [],
      `Guides with fewer than 4 inbound internal links across the 101-URL graph: ${JSON.stringify(starvedGuides)}`
    );
  });

  test("4. All retired URLs (tools, bloat-watch) return single-hop 301 to 200 indexable targets", async () => {
    const bloatWatchSlugs = [
      "windows-11-24h2-8gb-update-cache-bug",
      "nvidia-rtx-shader-cache-10gb-limit-fix",
      "steam-depotcache-orphaned-chunks-spike",
      "logitech-ghub-options-plus-depots-media-blob-benchmark-2026",
      "elgato-streamdeck-cef-media-blob-cache-bloat-2026",
      "comfyui-cursor-ai-developer-cache-bloat-2026",
      "logitech-ghub-2026-media-blob-leak",
    ];

    const retiredPaths = [
      ...Object.keys(RETIRED_TOOL_REDIRECTS).map((slug) => `/tools/${slug}`),
      "/bloat-watch",
      ...bloatWatchSlugs.map((slug) => `/bloat-watch/${slug}`),
    ];

    assert.equal(retiredPaths.length, 18, "Expected 18 retired redirect URLs (10 tools + 1 bloat-watch + 7 posts)");

    for (const path of retiredPaths) {
      const res = await app.request(path, { redirect: "manual" });
      assert.equal(res.status, 301, `Retired path ${path} must return HTTP 301, got ${res.status}`);
      const loc = res.headers.get("location");
      assert.ok(loc && loc.startsWith("/"), `Retired path ${path} missing relative Location header: ${loc}`);

      const destRes = await app.request(loc, { redirect: "manual" });
      assert.equal(destRes.status, 200, `Redirect target ${loc} from ${path} must return HTTP 200 directly (single-hop), got ${destRes.status}`);
      const destHtml = await destRes.text();
      const idx = isIndexableResponse(destRes, destHtml);
      assert.equal(idx.ok, true, `Redirect target ${loc} from ${path} must be indexable (${idx.reason})`);
    }
  });

  test("5. All 30 newly pruned guides serve 200 noindex, follow and retired variant sub-cache 410/301 rules hold", async () => {
    const items = getCleanItems();
    for (const slug of PRUNED_30_SLUGS) {
      const item = items.find((i) => i.slug === slug);
      assert.ok(item, `Pruned slug ${slug} must exist in clean-items.json`);
      assert.equal(Boolean(item.noindex), true, `Pruned slug ${slug} must have noindex: true`);

      const res = await app.request(`/clean/${item.category}/${slug}`);
      assert.equal(res.status, 200, `Pruned guide ${slug} must return HTTP 200`);
      assert.equal(res.headers.get("x-robots-tag"), "noindex, follow", `Pruned guide ${slug} missing X-Robots-Tag: noindex, follow`);
      const parsed = parseHtml(await res.text());
      assert.equal(parsed.metaRobots, "noindex, follow", `Pruned guide ${slug} missing meta robots noindex, follow`);
    }

    const goneRes = await app.request("/clean/app/arc-browser-service-worker-cachestorage");
    assert.equal(goneRes.status, 410, "Noindexed parent retired sub-cache must return HTTP 410 Gone");
    assert.equal(goneRes.headers.get("x-robots-tag"), "noindex, nofollow", "410 Gone page must carry X-Robots-Tag: noindex, nofollow");

    const activeVariantRes = await app.request("/clean/app/logitech-options-plus-code-bytecode-cache", { redirect: "manual" });
    assert.equal(activeVariantRes.status, 301);
    assert.equal(activeVariantRes.headers.get("location"), "/clean/app/logitech-options-plus-cache");
    const canonRes = await app.request("/clean/app/logitech-options-plus-cache");
    assert.equal(canonRes.status, 200);
    const canonIdx = isIndexableResponse(canonRes, await canonRes.text());
    assert.equal(canonIdx.ok, true);
  });

  test("6. Multi-platform guides omit PowerShell snippets & non-Chromium apps omit Chromium sub-cache modules", async () => {
    for (const path of ["/clean/mac/system-data-huge", "/clean/ios/iphone-system-data-full", "/clean/android/other-storage-full"]) {
      const res = await app.request(path);
      assert.equal(res.status, 200, `${path} must return HTTP 200`);
      const html = await res.text();
      const idx = isIndexableResponse(res, html);
      assert.equal(idx.ok, true, `${path} must be indexable (${idx.reason})`);
      assert.equal(html.includes("Get-ChildItem"), false, `${path} must not emit Windows Get-ChildItem PowerShell snippet`);
    }

    for (const slug of ["steam-depotcache", "nvidia-dxcache", "stremio-desktop-cache", "jetbrains-intellij-cache"]) {
      const res = await app.request(`/clean/app/${slug}`);
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.equal(
        html.includes('id="consolidated-subcache-modules"'),
        false,
        `Non-Chromium guide ${slug} must not render id="consolidated-subcache-modules"`
      );
    }
  });

  test("7. All 8 Mac comparison pages enforce editorial shell, plain-text JSON-LD, Mac CTA & Contracts 1-3", async () => {
    const macPages = [
      "/vs/onyx",
      "/alternatives/pearcleaner",
      "/alternatives/onyx",
      "/alternatives/daisydisk",
      "/vs/cleanmymac",
      "/vs/pearcleaner",
      "/vs/daisydisk",
      "/alternatives/cleanmymac",
    ];
    const forbiddenStrings = [
      "SWEEPR Cleaner Inc.",
      "4.9 / 5.0",
      "CleanMyMac X",
      "500 MB",
      "<50 MB",
      "&lt;50 MB",
      "300 rolling",
      "max 300 items",
      "6.52 MB",
      "~190 MB",
      "Audit Your Suspicious Windows Folders",
      "/vendor/tailwind.min.css",
      "/style.css",
      "DaisyDisk & OnyX",
    ];

    for (const route of macPages) {
      const res = await app.request(route);
      assert.equal(res.status, 200, `${route} must return HTTP 200`);
      const html = await res.text();

      for (const bad of forbiddenStrings) {
        assert.equal(html.includes(bad), false, `${route} must not contain stale string "${bad}"`);
      }

      assert.ok(html.includes("/sweepr-editorial.css"), `${route} must load /sweepr-editorial.css`);
      assert.ok(html.includes("Benjamin Cook t/a SWEEPR Cleaner"), `${route} missing legal entity`);
      assert.ok(html.includes("When to keep"), `${route} missing "When to keep" card`);
      assert.ok(html.includes('id="switcher-interactive-audit-cta"'), `${route} missing #switcher-interactive-audit-cta`);
      assert.ok(html.includes("~/Library/Caches"), `${route} CTA must reference ~/Library/Caches`);
      assert.ok(html.includes("/clean/mac/system-data-huge"), `${route} CTA must link /clean/mac/system-data-huge`);
      assert.match(html, /Safari\s+web\s+companion\s*\/\s*TestFlight\s+beta/i, `${route} missing qualified iOS framing`);
      assert.equal(html.includes("iOS web/TestFlight beta"), false, `${route} must not use shorthand iOS web/TestFlight beta`);
      assert.match(html, /Unlimited\s+Temp\s+&(?:amp;)?\s*Browser\s+Cache\s+Clean/i, `${route} missing Contract 1 copy`);
      assert.match(html, /2[–-]10\s*GB/i, `${route} missing Contract 2 2-10 GB budget`);
      assert.match(html, /5\s*GB\s+default/i, `${route} missing Contract 2 5 GB default`);
      assert.ok(html.includes("1800DBEA6FE847D384E549D02CA372C3D45D8B81"), `${route} missing Authenticode thumbprint`);
      assert.ok(html.includes("certutil") || html.includes("Get-AuthenticodeSignature"), `${route} missing #5 Windows Authenticode CLI snippet`);
      assert.ok(html.includes("shasum"), `${route} missing #5 macOS shasum snippet`);
      assert.ok(html.includes("codesign"), `${route} missing #5 macOS codesign snippet`);
      assert.ok(html.includes("spctl"), `${route} missing #5 macOS spctl snippet`);
      assert.ok(html.includes("/release-manifest.json"), `${route} missing #5 /release-manifest.json reference`);
      assert.ok(html.includes("brew install --cask sweepr-cleaner"), `${route} missing Homebrew Cask command`);

      // #18 Local macOS maintenance helpers without claiming Mac App Store or Setapp is live
      assert.ok(html.includes("mdutil"), `${route} missing #18 Spotlight mdutil helper`);
      assert.ok(html.includes("lsregister"), `${route} missing #18 LaunchServices lsregister helper`);
      assert.ok(
        html.includes("dscacheutil") || html.includes("mDNSResponder"),
        `${route} missing #18 DNS flush dscacheutil/mDNSResponder helper`
      );
      assert.equal(
        /SWEEPR[^<.]{0,80}(?:Mac App Store|Setapp)|(?:available|download|distributed|live)\s+(?:on|via)\s+(?:the\s+)?(?:Mac App Store|Setapp)/i.test(html),
        false,
        `${route} must not claim Mac App Store or Setapp distribution is live for SWEEPR`
      );

      if (route === "/alternatives/pearcleaner" || route === "/vs/pearcleaner") {
        assert.ok(html.includes("docs/public-rules-catalog.json"), `${route} missing public-rules-catalog.json reference`);
      }

      const ldBlocks = [...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
      assert.ok(ldBlocks.length > 0, `${route} must include JSON-LD`);
      let itemListNames: string[] = [];
      for (const m of ldBlocks) {
        const parsed = JSON.parse(m[1]);
        const nodes: any[] = Array.isArray(parsed["@graph"]) ? parsed["@graph"] : [parsed];
        for (const node of nodes) {
          if (node["@type"] === "Article") {
            assert.equal(/<[^>]+>|&amp;/.test(String(node.headline || "")), false, `${route} JSON-LD headline contains HTML/entity: ${node.headline}`);
          }
          if (node["@type"] === "ItemList") {
            assert.equal(node.numberOfItems, 5, `${route} ItemList must have numberOfItems=5`);
            assert.equal(Array.isArray(node.itemListElement) ? node.itemListElement.length : 0, 5, `${route} ItemList must have 5 ListItem elements`);
            itemListNames = (node.itemListElement as any[]).map((el) => String(el?.name || "").trim());
          }
        }
      }

      if (route.startsWith("/alternatives/")) {
        assert.equal(itemListNames.length, 5, `${route} missing 5-item ItemList`);
        const numberedHeadings = [...html.matchAll(/<h3\b[^>]*class="ed-h3"[^>]*>\s*[1-5]\.\s*([^<]+)<\/h3>/gi)].map((m) => m[1].trim());
        assert.equal(numberedHeadings.length, 5, `${route} must render exactly 5 numbered <article> cards, found ${numberedHeadings.length}`);
        assert.deepEqual(itemListNames, numberedHeadings, `${route} ItemList names must match the 5 rendered <h3 class="ed-h3"> card titles`);
      }
    }
  });
});
