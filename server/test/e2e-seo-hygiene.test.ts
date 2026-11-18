import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Switch to server directory so relative paths (e.g. ./public) resolve correctly
process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
import { openDb } from "../src/db.js";
import { createApp } from "../src/app.js";
import { parseHtml, parseSitemap } from "../src/seo/html.js";
import { getCleanItems } from "../src/pseo.js";
import { LOCKED_TEST_TITLE_SLUGS } from "../src/seo/keywords.js";

const { privateKey } = generateKeyPairSync("ed25519");
const ADMIN_PASSWORD = "test-admin-password";
const auth = { authorization: `Basic ${Buffer.from(`admin:${ADMIN_PASSWORD}`).toString("base64")}` };

// Hoisted shared test environment (instantiated once for all read-only tests)
let repo!: ReturnType<typeof openDb>;
let app!: ReturnType<typeof createApp>;

before(() => {
  repo = openDb(":memory:");
  app = createApp({
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
});

after(() => {
  try {
    repo.db.close();
  } catch {}
});

// Shared helpers for dual dynamic & static sitemap validation
const STATIC_SITEMAP_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../public/sitemap.xml");

function loadStaticSitemap(): { path: string; xml: string; urls: string[] } {
  assert.ok(
    existsSync(STATIC_SITEMAP_PATH),
    `Physical static sitemap must exist at ${STATIC_SITEMAP_PATH}`
  );
  const xml = readFileSync(STATIC_SITEMAP_PATH, "utf-8");
  const urls = parseSitemap(xml);
  return { path: STATIC_SITEMAP_PATH, xml, urls };
}

async function loadDynamicSitemap(targetApp: ReturnType<typeof createApp> = app): Promise<{ xml: string; urls: string[] }> {
  const res = await targetApp.request("/sitemap.xml");
  assert.equal(res.status, 200, "Dynamic /sitemap.xml route must return HTTP 200");
  const xml = await res.text();
  const urls = parseSitemap(xml);
  return { xml, urls };
}

describe("E2E SEO Hygiene Track — Tier 1: Core Feature Acceptance Criteria", () => {
  test("TC-T1-SM-01: Sitemap pruned footprint holds exact 135 Tier-1 URLs across dynamic and static files", async () => {
    const { urls: dynamicUrls } = await loadDynamicSitemap(app);
    const { urls: staticUrls } = loadStaticSitemap();

    assert.ok(
      staticUrls.length >= 130 && staticUrls.length <= 140,
      `Expected static sitemap.xml to contain 135 URLs (130-140), got ${staticUrls.length}`
    );
    assert.equal(staticUrls.length, 135, `Expected exact 135 URLs in static sitemap.xml, got ${staticUrls.length}`);
    assert.ok(
      dynamicUrls.length >= 130 && dynamicUrls.length <= 140,
      `Expected dynamic /sitemap.xml to contain 135 URLs (130-140), got ${dynamicUrls.length}`
    );
    assert.equal(dynamicUrls.length, 135, `Expected exact 135 URLs in dynamic /sitemap.xml, got ${dynamicUrls.length}`);
  });

  test("TC-T1-SM-02: Core commercial, policy, /tools/:slug and hub pages present (and noindex /download excluded) in sitemap", async () => {
    const { urls: dynamicUrls } = await loadDynamicSitemap(app);
    const { urls: staticUrls } = loadStaticSitemap();

    const hubs = [
      "/",
      "/pricing",
      "/clean",
      "/tools",
      "/bloat-watch",
      "/safe-to-delete",
      "/state-of-windows-storage",
      "/privacy",
      "/terms",
      "/refund",
      "/support",
      "/tools/discord-cache-cleaner",
      "/tools/steam-cache-cleaner",
      "/tools/logitech-ghub-cleaner",
      "/tools/elgato-streamdeck-cleaner",
      "/tools/valorant-logs-cleaner",
      "/tools/nvidia-shader-cleaner",
      "/tools/adobe-media-cache-cleaner",
      "/tools/jetbrains-gradle-cleaner",
      "/tools/windows-24h2-update-cleaner",
      "/tools/ai-model-cache-cleaner",
    ];
    for (const [sourceName, urls] of [
      ["dynamic /sitemap.xml", dynamicUrls],
      ["static public/sitemap.xml", staticUrls],
    ] as const) {
      assert.equal(
        urls.some((u) => {
          try {
            return new URL(u).pathname === "/download";
          } catch {
            return u.endsWith("/download");
          }
        }),
        false,
        `${sourceName} must NOT include noindexed /download`
      );
      for (const h of hubs) {
        const match = urls.some((u) => {
          try {
            const path = new URL(u).pathname;
            return path === h || (h === "/" && path === "");
          } catch {
            return u.endsWith(h);
          }
        });
        assert.ok(match, `${sourceName} must contain Tier-1 route: ${h}`);
      }
    }
  });

  test("TC-T1-SM-03: All 20 switcher pages present in sitemap (both dynamic and static)", async () => {
    const { urls: dynamicUrls } = await loadDynamicSitemap(app);
    const { urls: staticUrls } = loadStaticSitemap();

    const expectedSwitchers = [
      "/vs/ccleaner",
      "/vs/cleanmymac",
      "/vs/bleachbit",
      "/vs/daisydisk",
      "/vs/pearcleaner",
      "/vs/onyx",
      "/alternatives/ccleaner",
      "/alternatives/cleanmymac",
      "/alternatives/bleachbit",
    ];
    for (const [sourceName, urls] of [
      ["dynamic /sitemap.xml", dynamicUrls],
      ["static public/sitemap.xml", staticUrls],
    ] as const) {
      for (const s of expectedSwitchers) {
        assert.ok(urls.some((u) => u.includes(s)), `${sourceName} missing switcher page: ${s}`);
      }
    }
  });

  test("TC-T1-SM-04: Tier-1 high-volume clean guides present in sitemap (both dynamic and static)", async () => {
    const { urls: dynamicUrls } = await loadDynamicSitemap(app);
    const { urls: staticUrls } = loadStaticSitemap();

    const highVolumeSlugs = [
      "steam-depotcache",
      "winsxs",
      "windows-old",
      "hiberfil-sys",
      "nvidia-dxcache",
      "amd-shader-cache",
      "discord-cache",
      "spotify-cache",
      "riot-client-logs",
      "genshin-impact-update-cache",
      "medal-tv-cache",
      "stremio-desktop-cache",
      "docker-desktop-ext4-disk",
    ];
    for (const [sourceName, urls] of [
      ["dynamic /sitemap.xml", dynamicUrls],
      ["static public/sitemap.xml", staticUrls],
    ] as const) {
      for (const slug of highVolumeSlugs) {
        assert.ok(
          urls.some((u) => u.includes(slug)),
          `${sourceName} missing high-volume guide: ${slug}`
        );
      }
    }
  });

  test("TC-T1-SM-05: Zero pruned long-tail guides appear in sitemap (both dynamic /sitemap.xml and static public/sitemap.xml)", async () => {
    const { urls: dynamicUrls } = await loadDynamicSitemap(app);
    const { urls: staticUrls } = loadStaticSitemap();
    const dynamicSet = new Set(dynamicUrls);
    const staticSet = new Set(staticUrls);

    const items = getCleanItems();
    const prunedItems = items.filter((i) => i.noindex);
    assert.ok(prunedItems.length > 0, "Expected pruned long-tail items in clean-items.json");

    for (const item of prunedItems) {
      const url = `https://sweeprcleaner.com/clean/${item.category}/${item.slug}`;
      assert.equal(
        dynamicSet.has(url),
        false,
        `Pruned item ${url} must NOT appear in dynamic /sitemap.xml`
      );
      assert.equal(
        staticSet.has(url),
        false,
        `Pruned item ${url} must NOT appear in static server/public/sitemap.xml`
      );
    }
  });

  test("TC-T1-SM-06: Zero localized /de, /fr, /es routes in sitemap (both dynamic and static)", async () => {
    const { urls: dynamicUrls } = await loadDynamicSitemap(app);
    const { urls: staticUrls } = loadStaticSitemap();

    for (const [sourceName, urls] of [
      ["dynamic /sitemap.xml", dynamicUrls],
      ["static public/sitemap.xml", staticUrls],
    ] as const) {
      for (const loc of ["de", "fr", "es"]) {
        const hasLoc = urls.some((u) => {
          try {
            const path = new URL(u).pathname;
            return path === `/${loc}` || path.startsWith(`/${loc}/`);
          } catch {
            return u.includes(`/${loc}/`) || u.endsWith(`/${loc}`);
          }
        });
        assert.equal(hasLoc, false, `${sourceName} must not contain localized ${loc} routes`);
      }
    }
  });

  test("TC-T1-LOC-01 & 02: Localized routes align X-Robots-Tag + HTML meta noindex and drop conflicting hreflang tags", async () => {
    for (const rootPath of ["/", "/pricing"]) {
      const rootRes = await app.request(rootPath);
      assert.equal(rootRes.status, 200, `${rootPath} must return HTTP 200`);
      const rootHtml = await rootRes.text();
      for (const loc of ["de", "fr", "es"] as const) {
        assert.equal(
          new RegExp(`hreflang="${loc}"`, "i").test(rootHtml),
          false,
          `${rootPath} must not emit hreflang="${loc}" pointing to noindexed routes`
        );
      }
    }

    for (const loc of ["de", "fr", "es"] as const) {
      const homeRes = await app.request(`/${loc}`);
      assert.equal(homeRes.status, 200, `/${loc} must return HTTP 200`);
      assert.equal(
        homeRes.headers.get("x-robots-tag"),
        "noindex, follow",
        `/${loc} must serve X-Robots-Tag: noindex, follow`
      );
      const homeParsed = parseHtml(await homeRes.text());
      assert.equal(homeParsed.metaRobots, "noindex, follow", `/${loc} HTML meta robots must match noindex, follow`);
      assert.equal(homeParsed.hreflangCount, 0, `/${loc} must omit hreflang tags while noindexed`);

      const pricingRes = await app.request(`/${loc}/pricing`);
      assert.equal(pricingRes.status, 200, `/${loc}/pricing must return HTTP 200`);
      assert.equal(
        pricingRes.headers.get("x-robots-tag"),
        "noindex, follow",
        `/${loc}/pricing must serve X-Robots-Tag: noindex, follow`
      );
      const pricingParsed = parseHtml(await pricingRes.text());
      assert.equal(pricingParsed.metaRobots, "noindex, follow", `/${loc}/pricing HTML meta robots must match noindex, follow`);
      assert.equal(pricingParsed.hreflangCount, 0, `/${loc}/pricing must omit hreflang tags while noindexed`);
    }
  });

  test("TC-T1-PHANTOM-01: Phantom 404 routes return HTTP 301 redirect to /pricing", async () => {
    const phantomPaths = ["/month", "/mo", "/year", "/yr"];
    for (const p of phantomPaths) {
      const res = await app.request(p);
      assert.equal(res.status, 301, `${p} must return 301`);
      assert.equal(res.headers.get("location"), "/pricing", `${p} must redirect to /pricing`);
    }
  });

  test("TC-T1-NOINDEX-01 & 02: Pruned guides return HTTP 200 with meta + header noindex, follow", async () => {
    const items = getCleanItems();
    const pruned = items.filter((i) => i.noindex);
    assert.ok(pruned.length > 0, "Catalog must have pruned items");

    // Sample top 5 pruned guides
    for (const item of pruned.slice(0, 5)) {
      const res = await app.request(`/clean/${item.category}/${item.slug}`);
      assert.equal(res.status, 200, `Pruned guide ${item.slug} must return HTTP 200`);
      assert.equal(
        res.headers.get("x-robots-tag"),
        "noindex, follow",
        `Pruned guide ${item.slug} must serve X-Robots-Tag: noindex, follow`
      );
      const html = await res.text();
      const parsed = parseHtml(html);
      assert.equal(
        parsed.metaRobots,
        "noindex, follow",
        `Pruned guide ${item.slug} must contain <meta name="robots" content="noindex, follow">`
      );
    }
  });

  test("TC-T1-EAT-01: Top 25 guides in clean-items.json have populated bespoke subLocations", () => {
    const items = getCleanItems();
    const top25Slugs = [
      "steam-depotcache",
      "winsxs",
      "windows-old",
      "hiberfil-sys",
      "nvidia-dxcache",
      "amd-shader-cache",
      "discord-cache",
      "spotify-cache",
      "riot-client-logs",
      "genshin-impact-update-cache",
      "medal-tv-cache",
      "stremio-desktop-cache",
      "docker-desktop-ext4-disk",
      "logitech-ghub-installer-cache",
      "comfyui-temp-output-cache",
      "programdata-package-cache",
      "windows-livekernelreports",
      "elgato-streamdeck-cache",
      "logitech-options-plus-cache",
      "opera-gx-cache",
      "capcut-desktop-cache",
      "zen-browser-cache",
      "vivaldi-browser-cache",
      "jetbrains-intellij-cache",
      "localappdata-webview2-ebwebview-cache",
    ];

    for (const slug of top25Slugs) {
      const item = items.find((i) => i.slug === slug);
      assert.ok(item, `Guide item ${slug} must exist in catalog`);
      assert.ok(
        Array.isArray(item.subLocations) && item.subLocations.length >= 2,
        `Guide ${slug} must have bespoke subLocations array with >= 2 entries`
      );
      for (const sub of item.subLocations) {
        assert.ok(sub.subPath && sub.subPath.length > 0, `${slug} subLocation missing subPath`);
        assert.ok(sub.role && sub.role.length > 0, `${slug} subLocation missing role`);
        assert.ok(sub.avgSpace && sub.avgSpace.length > 0, `${slug} subLocation missing avgSpace`);
        assert.ok(sub.safe && sub.safe.length > 0, `${slug} subLocation missing safe status`);
      }
    }
  });

  test("TC-T1-EAT-02: Verified engineering attribution badge renders in guide HTML", async () => {
    const res = await app.request("/clean/app/steam-depotcache");
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(
      html.includes("Tested on Windows 11 24H2 · Verified Microsoft Authenticode Publisher: Benjamin Cook"),
      "Guide must render verified publisher attribution badge verbatim"
    );
  });

  test("TC-T1-EAT-03: Organization JSON-LD schema with sameAs links renders in guide HTML", async () => {
    const res = await app.request("/clean/app/steam-depotcache");
    assert.equal(res.status, 200);
    const html = await res.text();

    const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i);
    assert.ok(jsonLdMatch, "Guide must include JSON-LD script tag");

    const graph = JSON.parse(jsonLdMatch[1]);
    const nodes = graph["@graph"] || [graph];
    const org = nodes.find((n: any) => n["@type"] === "Organization");
    assert.ok(org, "JSON-LD graph must include Organization node");
    assert.ok(
      Array.isArray(org.sameAs) && org.sameAs.length >= 3,
      "Organization sameAs must include at least 3 profile URLs"
    );
  });
});

describe("E2E SEO Hygiene Track — Tier 2: Boundary & Corner Cases", () => {
  test("TC-T2-TITLE-01: Locked title slugs remain verbatim across all 13 CTR targets", async () => {
    const ctrTargets = [
      {
        path: "/clean/app/steam-depotcache",
        expectedTitle: "Can I Delete Steam depotcache? YES — Safe Cleanup Guide (Reclaim 2–25 GB)",
      },
      {
        path: "/clean/app/riot-client-logs",
        expectedTitle: "Can I Delete Riot Client Logs? YES — Safe Cleanup Guide (Reclaim 1.5–8 GB)",
      },
      {
        path: "/clean/app/logitech-ghub-installer-cache",
        expectedTitle: "Can I Delete LGHUB Depots Cache? YES — Safe Cleanup Guide (Reclaim 1.5–8 GB)",
      },
      {
        path: "/clean/app/stremio-desktop-cache",
        expectedTitle: "Can I Delete Stremio Cache? YES — Safe Cleanup Guide (Reclaim 1.5–9.5 GB)",
      },
      {
        path: "/clean/app/amd-shader-cache",
        expectedTitle: "Can I Delete AMD DxCache? YES — Safe Cleanup Guide (Reclaim 2–12 GB)",
      },
      {
        path: "/clean/app/comfyui-temp-output-cache",
        expectedTitle: "Can I Delete ComfyUI Temp Cache? YES — Safe Cleanup Guide (Reclaim 2–18 GB)",
      },
      {
        path: "/clean/app/genshin-impact-update-cache",
        expectedTitle: "Can I Delete Genshin Impact Temp? YES — Safe Cleanup Guide (Reclaim 3–22 GB)",
      },
      {
        path: "/clean/folder/winsxs",
        expectedTitle: "Can I Delete C:\\Windows\\WinSxS? YES — Safe Cleanup Guide (Reclaim 6–20 GB)",
      },
      {
        path: "/clean/folder/programdata-package-cache",
        expectedTitle: "Can I Delete ProgramData Package Cache? YES — Safe Cleanup Guide (Reclaim 3.5–22 GB)",
      },
      {
        path: "/clean/app/elgato-streamdeck-cache",
        expectedTitle: "Can I Delete %APPDATA%\\Elgato\\StreamDeck? YES — Safe Cleanup Guide (Reclaim 1–4 GB)",
      },
      {
        path: "/clean/folder/windows-livekernelreports",
        expectedTitle: "Can I Delete LiveKernelReports? YES — Safe Cleanup Guide (Reclaim 1.5–10 GB)",
      },
      {
        path: "/clean/app/vivaldi-browser-cache",
        expectedTitle: "Can I Delete Vivaldi Browser Cache? YES — Safe Cleanup Guide (Reclaim 1–5 GB)",
      },
      {
        path: "/clean/app/jetbrains-intellij-cache",
        expectedTitle: "Can I Delete IntelliJ IDEA Cache? YES — Safe Cleanup Guide (Reclaim 1.5–9.5 GB)",
      },
    ];

    for (const target of ctrTargets) {
      const res = await app.request(target.path);
      assert.equal(res.status, 200, `${target.path} must return 200`);
      const html = await res.text();
      const parsed = parseHtml(html);
      assert.equal(
        parsed.title,
        target.expectedTitle,
        `Locked title for ${target.path} must match verbatim`
      );
    }
  });

  test("TC-T2-TITLE-02: Description assertions for locked CTR targets", async () => {
    const targets = [
      "/clean/app/steam-depotcache",
      "/clean/app/riot-client-logs",
      "/clean/folder/winsxs",
      "/clean/app/nvidia-dxcache",
    ];

    for (const p of targets) {
      const res = await app.request(p);
      assert.equal(res.status, 200);
      const html = await res.text();
      const parsed = parseHtml(html);
      const desc = parsed.metaDescription ?? "";

      assert.ok(
        desc.length >= 70 && desc.length <= 160,
        `${p} description length (${desc.length}) must be between 70 and 160 characters`
      );
      assert.ok(
        desc.includes("Zero save files or active logins lost") && desc.includes("6.5 MB Sweepr scan"),
        `${p} description must contain reassuring micro-copy and Sweepr scan CTA`
      );
    }
  });

  test("TC-T2-LOC-03: Trailing slash redirects on localized paths", async () => {
    for (const loc of ["de", "fr", "es"] as const) {
      const trailingHome = await app.request(`/${loc}/`);
      assert.equal(trailingHome.status, 301);
      assert.equal(trailingHome.headers.get("location"), `/${loc}`);

      const trailingPricing = await app.request(`/${loc}/pricing/`);
      assert.equal(trailingPricing.status, 301);
      assert.equal(trailingPricing.headers.get("location"), `/${loc}/pricing`);
    }
  });

  test("TC-T2-LOC-04: English core routes remain indexable (no noindex header)", async () => {
    const enRoutes = ["/", "/pricing"];
    for (const r of enRoutes) {
      const res = await app.request(r);
      const header = res.headers.get("x-robots-tag") || "";
      assert.ok(
        !header.includes("noindex"),
        `English route ${r} must not serve noindex header, got: ${header}`
      );
    }
  });

  test("TC-T2-PHANTOM-02: Query parameter preservation on phantom redirects", async () => {
    const res = await app.request("/month?gclid=test1234&utm_source=google");
    assert.equal(res.status, 301);
    assert.equal(res.headers.get("location"), "/pricing");
  });

  test("TC-T2-SM-07: Sitemap XML well-formedness and schema validation (both dynamic and static)", async () => {
    const { xml: dynamicXml } = await loadDynamicSitemap(app);
    const { xml: staticXml } = loadStaticSitemap();

    for (const [sourceName, xml] of [
      ["dynamic /sitemap.xml", dynamicXml],
      ["static public/sitemap.xml", staticXml],
    ] as const) {
      assert.ok(
        xml.startsWith("<?xml") || xml.includes("<urlset"),
        `${sourceName} must begin with XML declaration or urlset`
      );
      assert.ok(
        xml.includes('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"'),
        `${sourceName} must use valid sitemap 0.9 schema`
      );
      assert.ok(xml.includes("</urlset>"), `${sourceName} must contain closing urlset tag`);

      const locMatches = xml.match(/<loc>([^<]+)<\/loc>/g) || [];
      assert.ok(locMatches.length >= 70, `${sourceName} must contain at least 70 loc elements`);
      for (const locTag of locMatches) {
        const url = locTag.replace(/<\/?loc>/g, "");
        assert.ok(url.startsWith("https://") || url.startsWith("http://"), `Invalid loc URL in ${sourceName}: ${url}`);
      }
    }
  });

  test("TC-T1-SM-CLEANUP-01: Temporary /sitemap-cleanup.xml has >=1360 unique non-Tier-1 URLs, /download, zero 404s, and zero 301->noindex chains", async () => {
    const botHeaders = {
      "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    };
    const cleanupRes = await app.request("/sitemap-cleanup.xml", { headers: botHeaders });
    assert.equal(cleanupRes.status, 200, "Dynamic /sitemap-cleanup.xml must return HTTP 200");
    assert.equal(
      cleanupRes.headers.get("x-robots-tag"),
      "noindex",
      "/sitemap-cleanup.xml must serve X-Robots-Tag: noindex"
    );

    const cleanupXml = await cleanupRes.text();
    const cleanupUrls = parseSitemap(cleanupXml);
    const cleanupSet = new Set(cleanupUrls);
    assert.equal(cleanupUrls.length, cleanupSet.size, "/sitemap-cleanup.xml URLs must be unique");
    assert.ok(
      cleanupUrls.length >= 1360,
      `Expected >= 1360 URLs in /sitemap-cleanup.xml, got ${cleanupUrls.length}`
    );
    assert.ok(
      cleanupSet.has("https://sweeprcleaner.com/download"),
      "/sitemap-cleanup.xml must include https://sweeprcleaner.com/download for noindex recrawl"
    );

    const { urls: tier1Urls } = await loadDynamicSitemap(app);
    const tier1Set = new Set(tier1Urls);
    for (const u of cleanupUrls) {
      assert.equal(tier1Set.has(u), false, `Tier-1 URL must NOT appear in /sitemap-cleanup.xml: ${u}`);
    }

    for (const u of cleanupUrls) {
      const path = new URL(u).pathname;
      const res = await app.request(path, { headers: botHeaders });
      if (res.status === 301) {
        const loc = res.headers.get("location") || "";
        assert.ok(loc.length > 0, `Cleanup URL ${path} returned 301 without Location header`);
        const destPath = loc.startsWith("http") ? new URL(loc).pathname : loc;
        const destRes = await app.request(destPath, { headers: botHeaders });
        assert.equal(
          destRes.status,
          200,
          `Cleanup 301 target ${destPath} (from ${path}) returned HTTP ${destRes.status} instead of 200`
        );
        const destXRobots = destRes.headers.get("x-robots-tag") || "";
        assert.equal(
          destXRobots.includes("noindex"),
          false,
          `Cleanup 301 target ${destPath} (from ${path}) must NOT serve X-Robots-Tag noindex (got: ${destXRobots})`
        );
        const destParsed = parseHtml(await destRes.text());
        assert.equal(
          (destParsed.metaRobots || "").includes("noindex"),
          false,
          `Cleanup 301 target ${destPath} (from ${path}) must NOT serve meta noindex (got: ${destParsed.metaRobots})`
        );
        continue;
      }
      assert.equal(
        res.status,
        200,
        `Cleanup URL ${path} returned unexpected HTTP ${res.status} (must be 301 or 200 noindex)`
      );
      const xRobots = res.headers.get("x-robots-tag") || "";
      assert.ok(
        xRobots.includes("noindex"),
        `Cleanup 200 URL ${path} must serve X-Robots-Tag noindex (got: ${xRobots})`
      );
      const parsed = parseHtml(await res.text());
      assert.ok(
        (parsed.metaRobots || "").includes("noindex"),
        `Cleanup 200 URL ${path} must have <meta name="robots" content="noindex..."> (got: ${parsed.metaRobots})`
      );
    }
  });

  test("TC-T1-INTERNAL-LINKS-01: /clean directory, ItemList JSON-LD, and guide cross-links emit zero noindex guide links", async () => {
    const items = getCleanItems();
    const noindexSlugs = new Set(items.filter((i) => i.noindex).map((i) => i.slug.toLowerCase()));

    for (const route of ["/clean", "/clean/app/steam-depotcache"]) {
      const res = await app.request(route);
      assert.equal(res.status, 200, `${route} must return HTTP 200`);
      const html = await res.text();
      const hrefMatches = [...html.matchAll(/href="(\/clean\/(?:app|folder)\/([a-z0-9-]+))"/gi)];
      for (const m of hrefMatches) {
        const linkedSlug = m[2].toLowerCase();
        assert.equal(
          noindexSlugs.has(linkedSlug),
          false,
          `Route ${route} leaked internal anchor to noindexed guide ${m[1]}`
        );
      }
      if (route === "/clean") {
        const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i);
        assert.ok(jsonLdMatch, "/clean must include JSON-LD");
        const graph = JSON.parse(jsonLdMatch[1]);
        const nodes = graph["@graph"] || [graph];
        const itemLists = nodes.filter((n: any) => n["@type"] === "ItemList");
        assert.ok(itemLists.length >= 1, "/clean must emit ItemList JSON-LD");
        for (const list of itemLists) {
          for (const el of list.itemListElement || []) {
            const url = String(el.url || el.item?.["@id"] || "");
            const m = url.match(/\/clean\/(?:app|folder)\/([a-z0-9-]+)/i);
            if (m) {
              assert.equal(
                noindexSlugs.has(m[1].toLowerCase()),
                false,
                `/clean ItemList JSON-LD leaked noindexed guide URL: ${url}`
              );
            }
          }
        }
      }
    }
  });
});

describe("E2E SEO Hygiene Track — Tier 3: Cross-Feature Interactions & Parity", () => {
  test("TC-T3-SYNC-01: clean-items.json ↔ sitemap bidirectional sync consistency across dynamic and static files", async () => {
    const { urls: dynamicUrls } = await loadDynamicSitemap(app);
    const { urls: staticUrls } = loadStaticSitemap();
    const items = getCleanItems();

    // 1. Strict dynamic vs static 1:1 parity check
    assert.equal(
      dynamicUrls.length,
      staticUrls.length,
      `Dynamic sitemap count (${dynamicUrls.length}) must exactly match static sitemap count (${staticUrls.length})`
    );
    const dynamicSet = new Set(dynamicUrls);
    const staticSet = new Set(staticUrls);
    for (const u of dynamicUrls) {
      assert.ok(staticSet.has(u), `Static sitemap is missing URL found in dynamic sitemap: ${u}`);
    }
    for (const u of staticUrls) {
      assert.ok(dynamicSet.has(u), `Dynamic sitemap is missing URL found in static sitemap: ${u}`);
    }

    // 2. Both dynamic and static sitemaps must exclude all pruned items (exact URL check to avoid substring traps like gradle-wrapper-cache vs caches)
    const prunedItems = items.filter((i) => i.noindex);
    for (const [sourceName, sitemapSet] of [
      ["dynamic /sitemap.xml", dynamicSet],
      ["static public/sitemap.xml", staticSet],
    ] as const) {
      for (const item of prunedItems) {
        const url = `https://sweeprcleaner.com/clean/${item.category}/${item.slug}`;
        assert.equal(sitemapSet.has(url), false, `Pruned guide ${url} must not be in ${sourceName}`);
      }
    }

    // 3. Every active guide in clean-items.json must be present in both sitemaps
    const activeGuides = items.filter((i) => !i.noindex);
    for (const [sourceName, sitemapSet] of [
      ["dynamic /sitemap.xml", dynamicSet],
      ["static public/sitemap.xml", staticSet],
    ] as const) {
      for (const item of activeGuides) {
        const url = `https://sweeprcleaner.com/clean/${item.category}/${item.slug}`;
        assert.ok(sitemapSet.has(url), `Active guide ${url} must appear in ${sourceName}`);
      }
    }

    // 4. Every clean guide URL appearing in sitemaps must exist and have noindex !== true
    for (const [sourceName, sitemapUrls] of [
      ["dynamic /sitemap.xml", dynamicUrls],
      ["static public/sitemap.xml", staticUrls],
    ] as const) {
      for (const u of sitemapUrls) {
        const m = u.match(/\/clean\/[^/]+\/([a-z0-9-]+)$/i);
        if (m) {
          const slug = m[1];
          const item = items.find((i) => i.slug === slug);
          assert.ok(item, `Sitemap URL ${u} in ${sourceName} references unknown guide slug ${slug}`);
          assert.notEqual(item.noindex, true, `Item ${slug} in ${sourceName} has noindex: true in catalog`);
        }
      }
    }
  });

  test("TC-T3-JSONLD-01: Multi-entity JSON-LD graph integrity (TechArticle, BreadcrumbList, Organization)", async () => {
    const res = await app.request("/clean/app/steam-depotcache");
    const html = await res.text();

    const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i);
    assert.ok(jsonLdMatch);
    const graph = JSON.parse(jsonLdMatch[1]);
    const nodes = graph["@graph"] || [graph];
    const types = nodes.map((n: any) => n["@type"]);

    assert.ok(types.includes("Organization"), "JSON-LD must contain Organization");
    assert.ok(types.includes("BreadcrumbList"), "JSON-LD must contain BreadcrumbList");
    assert.ok(types.includes("TechArticle"), "JSON-LD must contain TechArticle");
    assert.equal(types.includes("HowTo"), false, "JSON-LD must not emit deprecated HowTo");
    assert.equal(types.includes("FAQPage"), false, "JSON-LD must not emit deprecated FAQPage");
  });
});

describe("E2E SEO Hygiene Track — Tier 4: Real-World Crawl Simulation", () => {
  test("TC-T4-CRAWL-01: Full sitemap crawl simulation (100% 200 OK, zero broken hops, zero indexable noindexes)", async () => {
    const res = await app.request("/sitemap.xml");
    const xml = await res.text();
    const urls = parseSitemap(xml);

    assert.ok(urls.length >= 70, "Must have active sitemap URLs to crawl");

    for (const u of urls) {
      let path: string;
      try {
        path = new URL(u).pathname;
      } catch {
        path = u.replace(/^https?:\/\/[^/]+/, "");
      }

      const pageRes = await app.request(path);
      assert.equal(
        pageRes.status,
        200,
        `Sitemap URL ${path} returned HTTP ${pageRes.status} instead of 200`
      );

      // Verify that URLs in sitemap do NOT have noindex in meta or header
      const xRobots = pageRes.headers.get("x-robots-tag") || "";
      assert.ok(
        !xRobots.includes("noindex"),
        `Sitemap URL ${path} serves x-robots-tag noindex`
      );

      const html = await pageRes.text();
      const parsed = parseHtml(html);
      assert.notEqual(
        parsed.metaRobots,
        "noindex, follow",
        `Sitemap URL ${path} has meta name="robots" content="noindex"`
      );
    }
  });

  test("TC-T4-BOT-01: Googlebot user-agent simulation for localized & clean routes", async () => {
    const googleBotHeaders = {
      "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    };

    const resLoc = await app.request("/de", { headers: googleBotHeaders });
    assert.equal(resLoc.status, 200);
    assert.equal(resLoc.headers.get("x-robots-tag"), "noindex, follow");

    const resGuide = await app.request("/clean/app/steam-depotcache", { headers: googleBotHeaders });
    assert.equal(resGuide.status, 200);
    const html = await resGuide.text();
    assert.ok(html.includes("Tested on Windows 11 24H2 · Verified Microsoft Authenticode Publisher: Benjamin Cook"));
  });
});
