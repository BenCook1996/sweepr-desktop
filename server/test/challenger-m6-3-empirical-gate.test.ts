import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
import { openDb } from "../src/db.js";
import { createApp } from "../src/app.js";
import { parseHtml, parseSitemap } from "../src/seo/html.js";
import { getCleanItems, buildPseoTitle } from "../src/pseo.js";
import { LOCKED_TEST_TITLE_SLUGS } from "../src/seo/keywords.js";

const { privateKey } = generateKeyPairSync("ed25519");
const ADMIN_PASSWORD = "test-admin-password";

function setup() {
  const repo = openDb(":memory:");
  const app = createApp({
    repo,
    signingKey: privateKey,
    stripe: null,
    config: {
      publicUrl: "http://test",
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

describe("Milestone 6 Challenger 1 (challenger_m6_3): Final Adversarial Acceptance Gate", () => {
  // =========================================================================
  // Mission Requirement 1: Sitemap & Encodings
  // =========================================================================
  describe("1. Sitemap & Encodings", () => {
    test("1.1: server/public/sitemap.xml byte-level BOM absence and exact header bytes (60, 63, 120, 109)", () => {
      const buffer = readFileSync("public/sitemap.xml");
      assert.ok(buffer.length > 500, `Sitemap buffer too small: ${buffer.length}`);

      // Byte assertions: 60, 63, 120, 109 ('<', '?', 'x', 'm')
      assert.equal(buffer[0], 60, "Byte 0 must be 60 (<)");
      assert.equal(buffer[1], 63, "Byte 1 must be 63 (?)");
      assert.equal(buffer[2], 120, "Byte 2 must be 120 (x)");
      assert.equal(buffer[3], 109, "Byte 3 must be 109 (m)");

      // Explicitly reject UTF-8 BOM bytes (0xEF, 0xBB, 0xBF)
      assert.notEqual(buffer[0], 0xef, "Must not start with UTF-8 BOM byte 1 (0xEF)");
      assert.notEqual(buffer[1], 0xbb, "Must not start with UTF-8 BOM byte 2 (0xBB)");
      assert.notEqual(buffer[2], 0xbf, "Must not start with UTF-8 BOM byte 3 (0xBF)");

      const rawText = buffer.toString("utf8");
      assert.ok(rawText.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), "Must start with XML declaration");
      assert.ok(!rawText.includes("\uFEFF"), "Must not contain unicode BOM zero-width character anywhere");
    });

    test("1.2: Valid XML grammar and tag balancing in server/public/sitemap.xml", () => {
      const xml = readFileSync("public/sitemap.xml", "utf8");

      assert.ok(xml.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'), "Missing urlset with schema");
      assert.ok(xml.trim().endsWith("</urlset>"), "Must cleanly close with </urlset>");

      // Tag balance checks
      const openUrls = (xml.match(/<url>/g) || []).length;
      const closeUrls = (xml.match(/<\/url>/g) || []).length;
      assert.equal(openUrls, 76, `Expected exactly 76 <url> tags, found ${openUrls}`);
      assert.equal(closeUrls, 76, `Expected exactly 76 </url> tags, found ${closeUrls}`);

      const openLocs = (xml.match(/<loc>/g) || []).length;
      const closeLocs = (xml.match(/<\/loc>/g) || []).length;
      assert.equal(openLocs, 76, `Expected exactly 76 <loc> tags, found ${openLocs}`);
      assert.equal(closeLocs, 76, `Expected exactly 76 </loc> tags, found ${closeLocs}`);

      // Ensure no raw unescaped ampersands in URLs
      const locContents = [...xml.matchAll(/<loc>([\s\S]*?)<\/loc>/g)].map((m) => m[1]);
      for (const loc of locContents) {
        assert.ok(!loc.includes("& ") && !loc.includes("&="), `Unescaped & in loc: ${loc}`);
      }
    });

    test("1.3: Static sitemap contains EXACTLY 76 curated Tier-1 URLs with required components", () => {
      const xml = readFileSync("public/sitemap.xml", "utf8");
      const urls = parseSitemap(xml);
      assert.equal(urls.length, 76, `Expected exact 76 URLs, got ${urls.length}`);

      // Check unique URLs (no duplicates)
      const uniqueUrls = new Set(urls);
      assert.equal(uniqueUrls.size, 76, `Duplicate URLs found in sitemap: ${urls.length} vs ${uniqueUrls.size} unique`);

      // 8 Core Commercial / Hub URLs
      const requiredHubs = [
        "https://sweeprcleaner.com/",
        "https://sweeprcleaner.com/pricing",
        "https://sweeprcleaner.com/download",
        "https://sweeprcleaner.com/clean",
        "https://sweeprcleaner.com/safe-to-delete",
        "https://sweeprcleaner.com/bloat-watch",
        "https://sweeprcleaner.com/state-of-windows-storage",
        "https://sweeprcleaner.com/tools",
      ];
      for (const hub of requiredHubs) {
        assert.ok(uniqueUrls.has(hub), `Missing required core hub: ${hub}`);
      }

      // 20 Switchers (10 /vs/* and 10 /alternatives/*)
      const competitors = [
        "ccleaner", "bleachbit", "cleanmypc", "avast-cleanup", "wise-disk-cleaner",
        "glary-utilities", "cleanmymac", "pearcleaner", "onyx", "daisydisk",
      ];
      for (const comp of competitors) {
        assert.ok(uniqueUrls.has(`https://sweeprcleaner.com/vs/${comp}`), `Missing /vs/${comp}`);
        assert.ok(uniqueUrls.has(`https://sweeprcleaner.com/alternatives/${comp}`), `Missing /alternatives/${comp}`);
      }

      // Exactly 48 indexed clean guides (76 - 8 hubs - 20 switchers = 48)
      const guideUrls = urls.filter((u) => u.includes("/clean/app/") || u.includes("/clean/folder/"));
      assert.equal(guideUrls.length, 48, `Expected exactly 48 clean guide URLs, got ${guideUrls.length}`);
    });

    test("1.4: Zero long-tail noindexed guides appear in static or dynamic sitemap", async () => {
      const { app } = setup();
      const allItems = getCleanItems();
      const noindexed = allItems.filter((i) => i.noindex);
      assert.equal(noindexed.length, 329, "Expected 329 noindexed long-tail guides in catalog");

      const staticUrls = new Set(parseSitemap(readFileSync("public/sitemap.xml", "utf8")));

      const dynRes = await app.request("/sitemap.xml");
      assert.equal(dynRes.status, 200);
      const dynUrls = new Set(parseSitemap(await dynRes.text()));

      for (const item of noindexed) {
        const url = `https://sweeprcleaner.com/clean/${item.category}/${item.slug}`;
        assert.equal(staticUrls.has(url), false, `Noindexed item '${item.slug}' leaked into static sitemap`);
        assert.equal(dynUrls.has(url), false, `Noindexed item '${item.slug}' leaked into dynamic sitemap`);
      }
    });

    test("1.5: Zero localized /de, /fr, /es routes appear in static or dynamic sitemap", async () => {
      const { app } = setup();
      const staticUrls = parseSitemap(readFileSync("public/sitemap.xml", "utf8"));
      const dynRes = await app.request("/sitemap.xml");
      const dynUrls = parseSitemap(await dynRes.text());

      const locRegex = /\/(?:de|fr|es)(?:\/|$)/;
      for (const u of staticUrls) {
        assert.equal(locRegex.test(new URL(u).pathname), false, `Localized URL in static sitemap: ${u}`);
      }
      for (const u of dynUrls) {
        assert.equal(locRegex.test(new URL(u).pathname), false, `Localized URL in dynamic sitemap: ${u}`);
      }
    });

    test("1.6: 1:1 bidirectional parity between static server/public/sitemap.xml and dynamic /sitemap.xml", async () => {
      const { app } = setup();
      const staticXml = readFileSync("public/sitemap.xml", "utf8");
      const staticUrls = parseSitemap(staticXml);

      const dynRes = await app.request("/sitemap.xml");
      assert.equal(dynRes.status, 200);
      assert.equal(dynRes.headers.get("content-type"), "application/xml; charset=utf-8");
      const dynXml = await dynRes.text();
      const dynUrls = parseSitemap(dynXml);

      assert.equal(staticUrls.length, 76, "Static sitemap count must be 76");
      assert.equal(dynUrls.length, 76, "Dynamic sitemap count must be 76");
      assert.deepEqual(dynUrls, staticUrls, "Dynamic and static URLs must match identically in count and sequence");
    });
  });

  // =========================================================================
  // Mission Requirement 2: /download Header Matrix
  // =========================================================================
  describe("2. /download Header Matrix", () => {
    const { app } = setup();

    const crawlerBots = [
      { name: "Googlebot Desktop", ua: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" },
      { name: "Googlebot Smartphone", ua: "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" },
      { name: "Google-InspectionTool", ua: "Mozilla/5.0 (compatible; Google-InspectionTool/1.0)" },
      { name: "Bingbot", ua: "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)" },
      { name: "ClaudeBot", ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)" },
      { name: "GPTBot", ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.0; +https://openai.com/gptbot)" },
      { name: "PerplexityBot", ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)" },
      { name: "Applebot", ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)" },
      { name: "YandexBot", ua: "Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)" },
      { name: "Baiduspider", ua: "Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)" },
      // Mixed-case / unusual crawler UAs
      { name: "Mixed Case Googlebot", ua: "Mozilla/5.0 (compatible; GoOgLeBoT/2.1)" },
      { name: "Lowercase Bingbot", ua: "bingbot/2.0" },
    ];

    for (const bot of crawlerBots) {
      test(`2.1: /download with crawler UA '${bot.name}' serves X-Robots-Tag: noindex, nofollow`, async () => {
        const res = await app.request("/download", { headers: { "user-agent": bot.ua } });
        assert.equal(res.status, 200);
        assert.equal(
          res.headers.get("x-robots-tag"),
          "noindex, nofollow",
          `Missing or incorrect X-Robots-Tag for crawler: ${bot.name}`
        );
        const html = await res.text();
        assert.ok(
          html.includes('<meta name="robots" content="noindex, nofollow">'),
          `Crawler ${bot.name} HTML response must contain meta robots noindex, nofollow`
        );
      });

      test(`2.1b: /download with query params (?ref=partner&gclid=123) and crawler UA '${bot.name}' preserves noindex`, async () => {
        const res = await app.request("/download?ref=partner&gclid=123", { headers: { "user-agent": bot.ua } });
        assert.equal(res.status, 200);
        assert.equal(res.headers.get("x-robots-tag"), "noindex, nofollow");
      });
    }

    test("2.2: /download?platform=picker serves X-Robots-Tag: noindex, nofollow (across browser and crawler UAs)", async () => {
      const uas = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15",
        "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      ];

      for (const ua of uas) {
        const res = await app.request("/download?platform=picker", { headers: { "user-agent": ua } });
        assert.equal(res.status, 200);
        assert.equal(res.headers.get("x-robots-tag"), "noindex, nofollow");
        const html = await res.text();
        assert.ok(html.includes('<meta name="robots" content="noindex, nofollow">'));
      }
    });

    test("2.2b: /download?platform=PICKER (case-insensitive) serves X-Robots-Tag: noindex, nofollow", async () => {
      const browserUa = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";
      const res = await app.request("/download?platform=PICKER", { headers: { "user-agent": browserUa } });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("x-robots-tag"), "noindex, nofollow");
    });

    const standardBrowsers = [
      { name: "Chrome Windows", ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" },
      { name: "Edge Windows", ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0" },
      { name: "Firefox Windows", ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0" },
      { name: "Safari macOS", ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15" },
      { name: "Mobile Safari iOS", ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1" },
      { name: "Mobile Chrome Android", ua: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36" },
      { name: "Generic Crawler Simulator (no bot tokens)", ua: "SweeprCrawlSimulator/1.0" },
    ];

    for (const b of standardBrowsers) {
      test(`2.3: /download standard browser '${b.name}' serves NO noindex tag`, async () => {
        const res = await app.request("/download", { headers: { "user-agent": b.ua } });
        assert.equal(res.status, 200);
        const xRobots = res.headers.get("x-robots-tag");
        assert.ok(!xRobots || !xRobots.includes("noindex"), `Browser ${b.name} incorrectly received noindex: ${xRobots}`);
      });

      test(`2.3b: /download?platform=windows for '${b.name}' serves NO noindex tag`, async () => {
        const res = await app.request("/download?platform=windows", { headers: { "user-agent": b.ua } });
        assert.equal(res.status, 200);
        const xRobots = res.headers.get("x-robots-tag");
        assert.ok(!xRobots || !xRobots.includes("noindex"), `Browser platform=windows incorrectly received noindex: ${xRobots}`);
      });
    }
  });

  // =========================================================================
  // Mission Requirement 3: Localized Routes & Phantom 404s
  // =========================================================================
  describe("3. Localized Routes & Phantom 404s", () => {
    const { app } = setup();

    const mountedLocRoutes = [
      "/de", "/de/pricing",
      "/fr", "/fr/pricing",
      "/es", "/es/pricing",
    ];

    for (const p of mountedLocRoutes) {
      test(`3.1a: Mounted localized route '${p}' returns HTTP 200 with X-Robots-Tag: noindex, follow`, async () => {
        const res = await app.request(p);
        assert.equal(res.status, 200, `Expected 200 for ${p}`);
        assert.equal(res.headers.get("x-robots-tag"), "noindex, follow", `Failed for ${p}`);
      });
    }

    const unmountedLocRoutes = [
      "/de/tools", "/de/clean", "/de/nonexistent-slug",
      "/fr/tools", "/fr/clean", "/fr/nonexistent-slug",
      "/es/tools", "/es/clean", "/es/nonexistent-slug",
    ];

    for (const p of unmountedLocRoutes) {
      test(`3.1b: Unmounted localized route '${p}' returns HTTP 404 with X-Robots-Tag: noindex, follow`, async () => {
        const res = await app.request(p);
        assert.equal(res.status, 404, `Expected 404 for ${p}`);
        assert.equal(res.headers.get("x-robots-tag"), "noindex, follow", `Failed for unmounted ${p}`);
      });
    }

    test("3.1c: Localized order routes return HTTP 200 with X-Robots-Tag: noindex, nofollow", async () => {
      for (const loc of ["de", "fr", "es"]) {
        const res = await app.request(`/${loc}/order`);
        assert.equal(res.status, 200);
        assert.equal(res.headers.get("x-robots-tag"), "noindex, nofollow");
      }
    });

    test("3.2: Localized trailing slash routes redirect 301 to clean canonical path", async () => {
      const pairs = [
        ["/de/", "/de"],
        ["/fr/", "/fr"],
        ["/es/", "/es"],
        ["/de/pricing/", "/de/pricing"],
        ["/fr/pricing/", "/fr/pricing"],
        ["/es/pricing/", "/es/pricing"],
      ];
      for (const [slashPath, cleanPath] of pairs) {
        const res = await app.request(slashPath);
        assert.equal(res.status, 301, `Expected 301 for ${slashPath}`);
        assert.equal(res.headers.get("location"), cleanPath, `Expected redirect to ${cleanPath}`);
      }
    });

    const phantomPaths = ["/month", "/mo", "/year", "/yr"];

    for (const p of phantomPaths) {
      test(`3.3: Phantom path '${p}' returns HTTP 301 to /pricing`, async () => {
        const res = await app.request(p);
        assert.equal(res.status, 301, `Expected 301 for ${p}, got ${res.status}`);
        assert.equal(res.headers.get("location"), "/pricing");
      });

      test(`3.3b: Phantom path '${p}?promo=SAVE50&ref=partner' returns HTTP 301 to /pricing`, async () => {
        const res = await app.request(`${p}?promo=SAVE50&ref=partner`);
        assert.equal(res.status, 301, `Expected 301 for ${p}?query, got ${res.status}`);
        assert.equal(res.headers.get("location"), "/pricing");
      });
    }
  });

  // =========================================================================
  // Mission Requirement 4: Locked Titles
  // =========================================================================
  describe("4. Locked Titles", () => {
    const { app } = setup();

    const expectedLockedTitles: Record<string, { category: "app" | "folder"; expectedTitle: string }> = {
      "steam-depotcache": {
        category: "app",
        expectedTitle: "Can I Delete Steam depotcache? YES — Safe Cleanup Guide (Reclaim 2–25 GB)",
      },
      "riot-client-logs": {
        category: "app",
        expectedTitle: "Can I Delete Riot Client Logs? YES — Safe Cleanup Guide (Reclaim 1.5–8 GB)",
      },
      "logitech-ghub-installer-cache": {
        category: "app",
        expectedTitle: "Can I Delete LGHUB Depots Cache? YES — Safe Cleanup Guide (Reclaim 1.5–8 GB)",
      },
      "stremio-desktop-cache": {
        category: "app",
        expectedTitle: "Can I Delete Stremio Cache? YES — Safe Cleanup Guide (Reclaim 1.5–9.5 GB)",
      },
      "amd-shader-cache": {
        category: "app",
        expectedTitle: "Can I Delete AMD DxCache? YES — Safe Cleanup Guide (Reclaim 2–12 GB)",
      },
      "comfyui-temp-output-cache": {
        category: "app",
        expectedTitle: "Can I Delete ComfyUI Temp Cache? YES — Safe Cleanup Guide (Reclaim 2–18 GB)",
      },
      "genshin-impact-update-cache": {
        category: "app",
        expectedTitle: "Can I Delete Genshin Impact Temp? YES — Safe Cleanup Guide (Reclaim 3–22 GB)",
      },
      "winsxs": {
        category: "folder",
        expectedTitle: "Can I Delete C:\\Windows\\WinSxS? YES — Safe Cleanup Guide (Reclaim 6–20 GB)",
      },
      "programdata-package-cache": {
        category: "folder",
        expectedTitle: "Can I Delete ProgramData Package Cache? YES — Safe Cleanup Guide (Reclaim 3.5–22 GB)",
      },
      "elgato-streamdeck-cache": {
        category: "app",
        expectedTitle: "Can I Delete %APPDATA%\\Elgato\\StreamDeck? YES — Safe Cleanup Guide (Reclaim 1–4 GB)",
      },
      "windows-livekernelreports": {
        category: "folder",
        expectedTitle: "Can I Delete LiveKernelReports? YES — Safe Cleanup Guide (Reclaim 1.5–10 GB)",
      },
      "vivaldi-browser-cache": {
        category: "app",
        expectedTitle: "Can I Delete Vivaldi Browser Cache? YES — Safe Cleanup Guide (Reclaim 1–5 GB)",
      },
      "jetbrains-intellij-cache": {
        category: "app",
        expectedTitle: "Can I Delete IntelliJ IDEA Cache? YES — Safe Cleanup Guide (Reclaim 1.5–9.5 GB)",
      },
      "gradle-wrapper-caches": {
        category: "app",
        expectedTitle: "Can I Delete .gradle\\caches? YES — Safe Cleanup Guide (Reclaim 4–35 GB)",
      },
    };

    test("4.1: Exactly 14 locked title slugs are asserted and present in LOCKED_TEST_TITLE_SLUGS", () => {
      const slugKeys = Object.keys(expectedLockedTitles);
      assert.equal(slugKeys.length, 14, "Expected exactly 14 locked slugs in test assertion dictionary");
      for (const slug of slugKeys) {
        assert.ok(
          LOCKED_TEST_TITLE_SLUGS.has(slug),
          `Slug '${slug}' must be explicitly included in LOCKED_TEST_TITLE_SLUGS`
        );
      }
    });

    for (const [slug, spec] of Object.entries(expectedLockedTitles)) {
      test(`4.2: Locked slug '${slug}' renders verbatim in HTML <title>`, async () => {
        const path = `/clean/${spec.category}/${slug}`;
        const res = await app.request(path);
        assert.equal(res.status, 200, `Path ${path} returned ${res.status}`);
        const html = await res.text();
        const parsed = parseHtml(html);
        assert.equal(
          parsed.title,
          spec.expectedTitle,
          `Title mismatch for ${path}: expected '${spec.expectedTitle}', got '${parsed.title}'`
        );
      });
    }

    test("4.3: buildPseoTitle maintains exact verbatim stability for all 14 locked slugs", () => {
      const allItems = getCleanItems();
      for (const [slug, spec] of Object.entries(expectedLockedTitles)) {
        const item = allItems.find((i) => i.slug === slug);
        assert.ok(item, `Item with slug '${slug}' not found in catalog`);
        const title = buildPseoTitle(item);
        assert.equal(
          title,
          spec.expectedTitle,
          `buildPseoTitle('${slug}') produced '${title}', expected '${spec.expectedTitle}'`
        );
      }
    });
  });

  // =========================================================================
  // Mission Requirement 5: Adversarial Stress & Race Condition Burst
  // =========================================================================
  describe("5. Adversarial Stress & Race Condition Burst", () => {
    test("5.1: 150 concurrent asynchronous requests preserve strict header isolation across bots and browsers", async () => {
      const { app } = setup();

      const scenarios = [
        {
          name: "Crawler on /download",
          path: "/download",
          headers: { "user-agent": "Googlebot/2.1 (+http://www.google.com/bot.html)" },
          expectStatus: 200,
          expectXRobots: "noindex, nofollow",
        },
        {
          name: "Browser Chrome on /download",
          path: "/download",
          headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0" },
          expectStatus: 200,
          forbidXRobots: "noindex",
        },
        {
          name: "Platform Picker on /download",
          path: "/download?platform=picker",
          headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0" },
          expectStatus: 200,
          expectXRobots: "noindex, nofollow",
        },
        {
          name: "Localized Route /de",
          path: "/de",
          headers: { "user-agent": "Mozilla/5.0" },
          expectStatus: 200,
          expectXRobots: "noindex, follow",
        },
        {
          name: "Localized Route /fr/pricing",
          path: "/fr/pricing",
          headers: { "user-agent": "Mozilla/5.0" },
          expectStatus: 200,
          expectXRobots: "noindex, follow",
        },
        {
          name: "Unmounted Localized 404 /es/unknown",
          path: "/es/unknown",
          headers: { "user-agent": "Mozilla/5.0" },
          expectStatus: 404,
          expectXRobots: "noindex, follow",
        },
        {
          name: "Core English /pricing",
          path: "/pricing",
          headers: { "user-agent": "Mozilla/5.0" },
          expectStatus: 200,
          forbidXRobots: "noindex",
        },
        {
          name: "Phantom Route /year",
          path: "/year?gclid=abc",
          headers: {},
          expectStatus: 301,
          expectLocation: "/pricing",
        },
      ];

      const tasks: Array<{ scenario: (typeof scenarios)[0]; index: number; promise: Promise<Response> }> = [];
      const startTime = Date.now();

      for (let i = 0; i < 150; i++) {
        const scenario = scenarios[i % scenarios.length];
        const promise = app.request(scenario.path, { headers: scenario.headers });
        tasks.push({ scenario, index: i, promise });
      }

      const results = await Promise.all(tasks.map((t) => t.promise));
      const elapsed = Date.now() - startTime;

      assert.equal(results.length, 150);

      for (let i = 0; i < 150; i++) {
        const res = results[i];
        const { scenario } = tasks[i];

        assert.equal(res.status, scenario.expectStatus, `Request ${i} (${scenario.name}) expected ${scenario.expectStatus}`);

        if (scenario.expectXRobots) {
          assert.equal(res.headers.get("x-robots-tag"), scenario.expectXRobots, `Request ${i} (${scenario.name}) header mismatch`);
        }

        if (scenario.forbidXRobots) {
          const xr = res.headers.get("x-robots-tag");
          assert.ok(!xr || !xr.includes(scenario.forbidXRobots), `Request ${i} (${scenario.name}) leaked forbidden header: ${xr}`);
        }

        if (scenario.expectLocation) {
          assert.equal(res.headers.get("location"), scenario.expectLocation, `Request ${i} (${scenario.name}) redirect mismatch`);
        }
      }

      assert.ok(elapsed < 12000, `150 concurrent requests took ${elapsed}ms (expected < 12s)`);
    });
  });
});
