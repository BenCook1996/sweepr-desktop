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
import { getCleanItems, buildPseoTitle, buildPseoDescription } from "../src/pseo.js";
import { LOCKED_TEST_TITLE_SLUGS } from "../src/seo/keywords.js";

const { privateKey } = generateKeyPairSync("ed25519");
const ADMIN_PASSWORD = "test-admin-password";
const auth = { authorization: `Basic ${Buffer.from(`admin:${ADMIN_PASSWORD}`).toString("base64")}` };

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

describe("Milestone 6 Challenger 1: Empirical SEO, Sitemap & Routing Stress Gate", () => {
  // =========================================================================
  // Section 1: Sitemap & Encodings
  // =========================================================================
  describe("1. Sitemap & Encodings", () => {
    test("1.1: Physical server/public/sitemap.xml has NO UTF-8 BOM, starts with XML declaration", () => {
      const buffer = readFileSync("public/sitemap.xml");
      // Check first 4 bytes
      assert.equal(buffer[0], 0x3c, "Byte 0 must be '<' (0x3c)");
      assert.equal(buffer[1], 0x3f, "Byte 1 must be '?' (0x3f)");
      assert.equal(buffer[2], 0x78, "Byte 2 must be 'x' (0x78)");
      assert.equal(buffer[3], 0x6d, "Byte 3 must be 'm' (0x6d)");

      // Assert NO UTF-8 BOM (0xEF, 0xBB, 0xBF)
      assert.notEqual(buffer[0], 0xef, "Must not start with UTF-8 BOM byte 1");
      assert.notEqual(buffer[1], 0xbb, "Must not start with UTF-8 BOM byte 2");
      assert.notEqual(buffer[2], 0xbf, "Must not start with UTF-8 BOM byte 3");

      const text = buffer.toString("utf8");
      assert.ok(text.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), "Must start with XML declaration");
      assert.ok(!text.includes("\uFEFF"), "Text must not contain unicode BOM zero-width character");
    });

    test("1.2: Static server/public/sitemap.xml contains exact 101 Tier-1 URLs", () => {
      const xml = readFileSync("public/sitemap.xml", "utf8");
      const urls = parseSitemap(xml);
      assert.equal(urls.length, 101, `Expected exactly 101 Tier-1 URLs, got ${urls.length}`);

      // Count check by regex
      const locTags = (xml.match(/<loc>/g) || []).length;
      assert.equal(locTags, 101, `Expected exactly 101 <loc> tags, got ${locTags}`);

      // All 6 Indexable Core Hubs + /about + 4 Policy Pages + /tools/pc-cache-calculator present (/download & /bloat-watch excluded)
      const coreHubs = [
        "https://sweeprcleaner.com/",
        "https://sweeprcleaner.com/about",
        "https://sweeprcleaner.com/pricing",
        "https://sweeprcleaner.com/clean",
        "https://sweeprcleaner.com/safe-to-delete",
        "https://sweeprcleaner.com/state-of-windows-storage",
        "https://sweeprcleaner.com/tools",
        "https://sweeprcleaner.com/tools/pc-cache-calculator",
      ];
      for (const hub of coreHubs) {
        assert.ok(urls.includes(hub), `Static sitemap missing core hub: ${hub}`);
      }
      assert.equal(urls.includes("https://sweeprcleaner.com/download"), false, "Noindexed /download must NOT appear in static sitemap.xml");
      assert.equal(urls.includes("https://sweeprcleaner.com/bloat-watch"), false, "Retired /bloat-watch must NOT appear in static sitemap.xml");

      // All 20 Switchers present (12 Windows + 8 macOS)
      const vsSwitchers = [
        "ccleaner", "cleanmymac", "bleachbit", "avast-cleanup", "daisydisk", "pearcleaner", "onyx",
        "cleanmypc", "glary-utilities", "wise-disk-cleaner",
      ];
      for (const sw of vsSwitchers) {
        assert.ok(urls.includes(`https://sweeprcleaner.com/vs/${sw}`), `Missing /vs/${sw}`);
      }
      const altSwitchers = [
        "ccleaner", "cleanmymac", "avast-cleanup", "bleachbit", "cleanmypc", "glary-utilities", "wise-disk-cleaner",
        "daisydisk", "pearcleaner", "onyx",
      ];
      for (const sw of altSwitchers) {
        assert.ok(urls.includes(`https://sweeprcleaner.com/alternatives/${sw}`), `Missing /alternatives/${sw}`);
      }
    });

    test("1.3: Zero long-tail noindexed guides appear in static or dynamic sitemap", async () => {
      const { app } = setup();
      const allItems = getCleanItems();
      const noindexed = allItems.filter((i) => i.noindex);
      assert.equal(noindexed.length, 311, `Expected exactly 311 noindexed long-tail guides`);

      const staticXml = readFileSync("public/sitemap.xml", "utf8");
      const staticUrls = parseSitemap(staticXml);

      const dynamicRes = await app.request("/sitemap.xml");
      assert.equal(dynamicRes.status, 200);
      const dynamicXml = await dynamicRes.text();
      const dynamicUrls = parseSitemap(dynamicXml);

      for (const item of noindexed) {
        const url = `https://sweeprcleaner.com/clean/${item.category}/${item.slug}`;
        assert.equal(staticUrls.includes(url), false, `Pruned guide ${url} must not appear in static sitemap`);
        assert.equal(dynamicUrls.includes(url), false, `Pruned guide ${url} must not appear in dynamic sitemap`);
      }
    });

    test("1.4: Zero localized /de, /fr, /es routes appear in static or dynamic sitemap", async () => {
      const { app } = setup();
      const staticXml = readFileSync("public/sitemap.xml", "utf8");
      const staticUrls = parseSitemap(staticXml);

      const dynamicRes = await app.request("/sitemap.xml");
      const dynamicXml = await dynamicRes.text();
      const dynamicUrls = parseSitemap(dynamicXml);

      const locRegex = /\/(?:de|fr|es)(?:\/|$)/;
      for (const u of staticUrls) {
        assert.equal(locRegex.test(new URL(u).pathname), false, `Static sitemap contains localized URL: ${u}`);
      }
      for (const u of dynamicUrls) {
        assert.equal(locRegex.test(new URL(u).pathname), false, `Dynamic sitemap contains localized URL: ${u}`);
      }
    });

    test("1.5: Exact 1:1 bidirectional parity between static and dynamic /sitemap.xml", async () => {
      const { app } = setup();
      const staticXml = readFileSync("public/sitemap.xml", "utf8");
      const staticUrls = parseSitemap(staticXml);

      const dynamicRes = await app.request("/sitemap.xml");
      assert.equal(dynamicRes.status, 200);
      assert.equal(dynamicRes.headers.get("content-type"), "application/xml; charset=utf-8");
      const dynamicXml = await dynamicRes.text();
      const dynamicUrls = parseSitemap(dynamicXml);

      assert.equal(staticUrls.length, 101, "Static sitemap count must be 101");
      assert.equal(dynamicUrls.length, 101, "Dynamic sitemap count must be 101");
      assert.deepEqual(dynamicUrls, staticUrls, "Dynamic and static sitemaps must have identical URL list in identical order");
    });
  });

  // =========================================================================
  // Section 2: /download Header Matrix
  // =========================================================================
  describe("2. /download Header Matrix", () => {
    const { app } = setup();

    const crawlerUserAgents = [
      { name: "Googlebot Desktop", ua: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" },
      { name: "Googlebot Smartphone", ua: "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" },
      { name: "Google-InspectionTool", ua: "Mozilla/5.0 (compatible; Google-InspectionTool/1.0)" },
      { name: "Bingbot", ua: "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)" },
      { name: "ClaudeBot", ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)" },
      { name: "GPTBot", ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.0; +https://openai.com/gptbot)" },
    ];

    for (const bot of crawlerUserAgents) {
      test(`2.1: /download with crawler UA (${bot.name}) serves X-Robots-Tag: noindex, nofollow`, async () => {
        const res = await app.request("/download", { headers: { "user-agent": bot.ua } });
        assert.equal(res.status, 200);
        assert.equal(res.headers.get("x-robots-tag"), "noindex, nofollow", `Failed for crawler: ${bot.name}`);
        const html = await res.text();
        assert.ok(html.includes('<meta name="robots" content="noindex, nofollow">'));
      });
    }

    test("2.2: /download?platform=picker serves X-Robots-Tag: noindex, nofollow (even with browser UA)", async () => {
      const browserUa = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
      const res = await app.request("/download?platform=picker", { headers: { "user-agent": browserUa } });
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
      { name: "Generic Crawler Simulator (no bot name in UA)", ua: "SweeprCrawlSimulator/1.0" },
    ];

    for (const b of standardBrowsers) {
      test(`2.3: /download standard browser (${b.name}) serves NO noindex tag`, async () => {
        const res = await app.request("/download", { headers: { "user-agent": b.ua } });
        assert.equal(res.status, 200);
        const xRobots = res.headers.get("x-robots-tag");
        assert.ok(!xRobots || !xRobots.includes("noindex"), `Browser ${b.name} must NOT receive noindex, got: ${xRobots}`);
      });
    }
  });

  // =========================================================================
  // Section 3: Localized Routes & Phantom 404s
  // =========================================================================
  describe("3. Localized Routes & Phantom 404s", () => {
    const { app } = setup();

    const mountedLocalizedPaths = [
      "/de", "/de/pricing",
      "/fr", "/fr/pricing",
      "/es", "/es/pricing",
    ];

    for (const p of mountedLocalizedPaths) {
      test(`3.1a: Mounted localized route ${p} serves HTTP 200 and X-Robots-Tag: noindex, follow`, async () => {
        const res = await app.request(p);
        assert.equal(res.status, 200, `Expected 200 for mounted localized route: ${p}`);
        assert.equal(res.headers.get("x-robots-tag"), "noindex, follow", `Failed for path: ${p}`);
      });
    }

    const unmountedLocalizedPaths = [
      "/de/tools", "/de/clean", "/de/unmounted-path",
      "/fr/tools", "/fr/clean", "/fr/unmounted-path",
      "/es/tools", "/es/clean", "/es/unmounted-path",
    ];

    for (const p of unmountedLocalizedPaths) {
      test(`3.1b: Unmounted localized route ${p} serves X-Robots-Tag: noindex, follow on 404`, async () => {
        const res = await app.request(p);
        assert.equal(res.status, 404, `Expected 404 for unmounted path: ${p}`);
        assert.equal(
          res.headers.get("x-robots-tag"),
          "noindex, follow",
          `Unmounted localized route ${p} must serve X-Robots-Tag: noindex, follow`
        );
      });
    }

    test("3.1c: Localized order routes serve X-Robots-Tag: noindex, nofollow", async () => {
      for (const loc of ["de", "fr", "es"]) {
        const res = await app.request(`/${loc}/order`);
        assert.equal(res.status, 200);
        assert.equal(res.headers.get("x-robots-tag"), "noindex, nofollow");
      }
    });

    test("3.2: Localized trailing slashes redirect to normalized path (/de/ -> /de)", async () => {
      for (const loc of ["de", "fr", "es"]) {
        const res = await app.request(`/${loc}/`);
        assert.equal(res.status, 301);
        assert.equal(res.headers.get("location"), `/${loc}`);
      }
    });

    const phantomPaths = ["/month", "/mo", "/year", "/yr"];

    for (const p of phantomPaths) {
      test(`3.3: Phantom path ${p} returns HTTP 301 redirect to /pricing`, async () => {
        const res = await app.request(p);
        assert.equal(res.status, 301, `Expected 301 for ${p}, got ${res.status}`);
        assert.equal(res.headers.get("location"), "/pricing");
      });

      test(`3.3b: Phantom path ${p} with query parameters returns HTTP 301 redirect to /pricing`, async () => {
        const res = await app.request(`${p}?promo=SAVE50&ref=partner`);
        assert.equal(res.status, 301, `Expected 301 for ${p}?query, got ${res.status}`);
        assert.equal(res.headers.get("location"), "/pricing");
      });
    }
  });

  // =========================================================================
  // Section 4: Locked Titles
  // =========================================================================
  describe("4. Locked Titles", () => {
    const { app } = setup();

    const expectedLockedTitles: Record<string, { category: "app" | "folder"; expectedTitle: string }> = {
      "steam-depotcache": {
        category: "app",
        expectedTitle: "Can I Delete Steam depotcache? YES (2–25 GB) — Safe Guide",
      },
      "riot-client-logs": {
        category: "app",
        expectedTitle: "Can I Delete Riot Client Logs? YES (1.5–8 GB) — Safe Guide",
      },
      "logitech-ghub-installer-cache": {
        category: "app",
        expectedTitle: "Can I Delete LGHUB Depots? YES (1.5–8 GB) — Safe Guide",
      },
      "stremio-desktop-cache": {
        category: "app",
        expectedTitle: "Can I Delete Stremio Cache? YES (2–10 GB) — Safe Guide",
      },
      "amd-shader-cache": {
        category: "app",
        expectedTitle: "Can I Delete AMD DxCache? YES (2–12 GB) — Safe Guide",
      },
      "comfyui-temp-output-cache": {
        category: "app",
        expectedTitle: "Can I Delete ComfyUI Temp? YES (2–18 GB) — Safe Guide",
      },
      "genshin-impact-update-cache": {
        category: "app",
        expectedTitle: "Can I Delete Genshin Temp? YES (3–22 GB) — Safe Guide",
      },
      "winsxs": {
        category: "folder",
        expectedTitle: "Can You Delete WinSxS? No — Safe DISM Cleanup Guide (Win 11)",
      },
      "programdata-package-cache": {
        category: "folder",
        expectedTitle: "ProgramData\\Package Cache: Safe to Delete? (MSI Guide)",
      },
      "elgato-streamdeck-cache": {
        category: "app",
        expectedTitle: "Delete Elgato StreamDeck Cache? YES (1–4 GB) — Safe Guide",
      },
      "windows-livekernelreports": {
        category: "folder",
        expectedTitle: "LiveKernelReports & WATCHDOG .dmp: Safe to Delete? (Win 11)",
      },
      "vivaldi-browser-cache": {
        category: "app",
        expectedTitle: "Can I Delete Vivaldi Cache? YES (1–5 GB) — Safe Guide",
      },
      "jetbrains-intellij-cache": {
        category: "app",
        expectedTitle: "Delete IntelliJ IDEA Cache? YES (1–8 GB) — Safe Guide",
      },
      "gradle-wrapper-caches": {
        category: "app",
        expectedTitle: "Can I Delete .gradle\\caches? YES (4–35 GB) — Safe Guide",
      },
    };

    for (const [slug, spec] of Object.entries(expectedLockedTitles)) {
      test(`4.1: Locked title slug '${slug}' renders expected title verbatim`, async () => {
        // Assert slug is part of LOCKED_TEST_TITLE_SLUGS
        assert.ok(
          LOCKED_TEST_TITLE_SLUGS.has(slug),
          `Slug '${slug}' must be explicitly included in LOCKED_TEST_TITLE_SLUGS`
        );

        const path = `/clean/${spec.category}/${slug}`;
        const res = await app.request(path);
        assert.equal(res.status, 200, `Path ${path} returned status ${res.status}`);
        const html = await res.text();
        const parsed = parseHtml(html);
        assert.equal(
          parsed.title,
          spec.expectedTitle,
          `Title mismatch for ${path}: expected '${spec.expectedTitle}', got '${parsed.title}'`
        );
      });
    }

    test("4.2: All slugs in LOCKED_TEST_TITLE_SLUGS maintain title stability under buildPseoTitle", () => {
      const allItems = getCleanItems();
      for (const slug of LOCKED_TEST_TITLE_SLUGS) {
        const item = allItems.find((i) => i.slug === slug);
        if (item) {
          const title = buildPseoTitle(item);
          assert.ok(
            title.length >= 30 && title.length <= 115,
            `Title for locked item '${slug}' out of length bounds [30, 115]: ${title.length}`
          );
        }
      }
    });
  });

  // =========================================================================
  // Section 5: Adversarial Concurrency & Header Isolation Burst
  // =========================================================================
  describe("5. Adversarial Concurrency & Header Isolation", () => {
    test("5.1: 120 interleaved parallel requests never leak headers between crawlers and browsers", async () => {
      const { app } = setup();

      const scenarioTypes = [
        {
          name: "Crawler on /download",
          path: "/download",
          headers: { "user-agent": "Googlebot/2.1" },
          expectStatus: 200,
          expectXRobots: "noindex, nofollow",
        },
        {
          name: "Standard Browser on /download",
          path: "/download",
          headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0" },
          expectStatus: 200,
          expectNoRobotsHeader: true,
        },
        {
          name: "Picker on /download",
          path: "/download?platform=picker",
          headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0" },
          expectStatus: 200,
          expectXRobots: "noindex, nofollow",
        },
        {
          name: "Localized Route /de/pricing",
          path: "/de/pricing",
          headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0" },
          expectStatus: 200,
          expectXRobots: "noindex, follow",
        },
        {
          name: "Core English /pricing",
          path: "/pricing",
          headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0" },
          expectStatus: 200,
          expectNoRobotsHeader: true,
        },
        {
          name: "Phantom Route /month",
          path: "/month?ref=test",
          headers: {},
          expectStatus: 301,
          expectLocation: "/pricing",
        },
      ];

      // Build 120 interleaved requests (20 iterations of 6 scenarios)
      const tasks: Array<{ scenario: (typeof scenarioTypes)[0]; index: number; promise: Promise<Response> }> = [];
      const startTime = Date.now();

      for (let i = 0; i < 120; i++) {
        const scenario = scenarioTypes[i % scenarioTypes.length];
        const promise = Promise.resolve(
          app.request(scenario.path, scenario.headers ? { headers: scenario.headers as Record<string, string> } : undefined)
        );
        tasks.push({ scenario, index: i, promise });
      }

      const results = await Promise.all(tasks.map((t) => t.promise));
      const durationMs = Date.now() - startTime;

      assert.equal(results.length, 120, "All 120 parallel requests must resolve");
      for (let i = 0; i < 120; i++) {
        const res = results[i];
        const { scenario } = tasks[i];

        assert.equal(
          res.status,
          scenario.expectStatus,
          `Request ${i} (${scenario.name}) returned status ${res.status}`
        );

        if (scenario.expectXRobots) {
          assert.equal(
            res.headers.get("x-robots-tag"),
            scenario.expectXRobots,
            `Request ${i} (${scenario.name}) expected X-Robots-Tag: ${scenario.expectXRobots}`
          );
        }

        if (scenario.expectNoRobotsHeader) {
          const xr = res.headers.get("x-robots-tag");
          assert.ok(
            !xr || !xr.includes("noindex"),
            `Request ${i} (${scenario.name}) leaked noindex X-Robots-Tag: ${xr}`
          );
        }

        if (scenario.expectLocation) {
          assert.equal(
            res.headers.get("location"),
            scenario.expectLocation,
            `Request ${i} (${scenario.name}) expected redirect to ${scenario.expectLocation}`
          );
        }
      }

      assert.ok(durationMs < 10000, `120 interleaved parallel requests must complete in <10s (took ${durationMs}ms)`);
    });
  });
});
