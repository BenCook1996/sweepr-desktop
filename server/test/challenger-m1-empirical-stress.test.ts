import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
import { openDb } from "../src/db.js";
import { createApp } from "../src/app.js";
import { parseHtml, parseSitemap } from "../src/seo/html.js";
import { getCleanItems } from "../src/pseo.js";

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
  const get = (p: string) => app.request(p, { headers: auth });
  return { repo, app, get };
}

describe("Empirical Challenger 2 — Milestone 1 Stress & Boundary Suite", () => {
  // -------------------------------------------------------------
  // Test Suite 1: Clean Items Catalog Structure & Counts
  // -------------------------------------------------------------
  test("CH-CAT-01: Catalog parsing, total item count, and exact indexed/noindexed split", () => {
    const items = getCleanItems();
    assert.equal(items.length, 377, `Expected exactly 377 items, found ${items.length}`);

    const indexed = items.filter((i) => !i.noindex);
    const noindexed = items.filter((i) => i.noindex);

    assert.equal(indexed.length, 48, `Expected exactly 48 indexed items, found ${indexed.length}`);
    assert.equal(noindexed.length, 329, `Expected exactly 329 noindexed items, found ${noindexed.length}`);
    assert.equal(indexed.length + noindexed.length, 377, "Sum of indexed + noindexed must equal 377");

    // Slug uniqueness check
    const slugs = items.map((i) => i.slug);
    const uniqueSlugs = new Set(slugs);
    assert.equal(uniqueSlugs.size, slugs.length, "All clean item slugs must be strictly unique");

    // Field integrity check
    for (const item of items) {
      assert.ok(item.slug && typeof item.slug === "string" && item.slug.trim().length > 0, "Item slug must be valid string");
      assert.ok(item.category === "app" || item.category === "folder", `Item ${item.slug} category must be app or folder`);
      assert.ok(item.name && typeof item.name === "string", `Item ${item.slug} name must be string`);
      assert.ok(item.avgSpace && typeof item.avgSpace === "string", `Item ${item.slug} avgSpace must be string`);
    }
  });

  // -------------------------------------------------------------
  // Test Suite 2: Exhaustive Verification of All 48 Indexed Guides
  // -------------------------------------------------------------
  test("CH-IDX-01: Exhaustive check of ALL 48 indexed items: HTTP 200, index robots, in sitemap", async () => {
    const { app } = setup();
    const items = getCleanItems();
    const indexed = items.filter((i) => !i.noindex);

    // Read static sitemap and dynamic sitemap
    const staticXml = readFileSync("public/sitemap.xml", "utf-8");
    const staticUrls = parseSitemap(staticXml);

    const sitemapRes = await app.request("/sitemap.xml");
    assert.equal(sitemapRes.status, 200);
    const dynamicXml = await sitemapRes.text();
    const dynamicUrls = parseSitemap(dynamicXml);

    for (const item of indexed) {
      const path = `/clean/${item.category}/${item.slug}`;
      const res = await app.request(path);
      assert.equal(res.status, 200, `Indexed item ${path} returned status ${res.status}`);

      // X-Robots-Tag header must NOT be noindex
      const xRobots = res.headers.get("x-robots-tag");
      assert.ok(
        !xRobots || !xRobots.includes("noindex"),
        `Indexed item ${path} must NOT have noindex in X-Robots-Tag: ${xRobots}`
      );

      // Meta robots must indicate index, follow
      const html = await res.text();
      const parsed = parseHtml(html);
      assert.ok(
        parsed.metaRobots && parsed.metaRobots.includes("index") && !parsed.metaRobots.includes("noindex"),
        `Indexed item ${path} meta robots must be index, follow. Got: ${parsed.metaRobots}`
      );

      // Must be present in static sitemap
      const expectedUrl = `https://sweeprcleaner.com${path}`;
      assert.ok(
        staticUrls.includes(expectedUrl),
        `Indexed item ${expectedUrl} must be present in static public/sitemap.xml`
      );

      // Must be present in dynamic sitemap
      assert.ok(
        dynamicUrls.includes(expectedUrl),
        `Indexed item ${expectedUrl} must be present in dynamic /sitemap.xml`
      );
    }
  });

  // -------------------------------------------------------------
  // Test Suite 3: Sampling & Boundary Verification of 329 Pruned Items
  // -------------------------------------------------------------
  test("CH-PRUNE-01: Random sampling of 50 pruned items: HTTP 200, meta noindex, follow", async () => {
    const { app } = setup();
    const items = getCleanItems();
    const noindexed = items.filter((i) => i.noindex);

    // Deterministic pseudo-random sample of 50 items (spread across array)
    const step = Math.floor(noindexed.length / 50);
    const sample = [];
    for (let i = 0; i < noindexed.length; i += step) {
      sample.push(noindexed[i]);
      if (sample.length >= 50) break;
    }

    assert.equal(sample.length, 50, "Sample size must be 50");

    for (const item of sample) {
      const path = `/clean/${item.category}/${item.slug}`;
      const res = await app.request(path);
      assert.equal(res.status, 200, `Pruned item ${path} returned status ${res.status}`);

      const html = await res.text();
      const parsed = parseHtml(html);
      assert.equal(
        parsed.metaRobots,
        "noindex, follow",
        `Pruned item ${path} must have meta robots="noindex, follow", got: ${parsed.metaRobots}`
      );
    }
  });

  test("CH-PRUNE-02: Strict exclusion of ALL 329 pruned items from sitemaps", async () => {
    const { app } = setup();
    const items = getCleanItems();
    const noindexed = items.filter((i) => i.noindex);

    const staticXml = readFileSync("public/sitemap.xml", "utf-8");
    const staticUrls = parseSitemap(staticXml);

    const sitemapRes = await app.request("/sitemap.xml");
    const dynamicXml = await sitemapRes.text();
    const dynamicUrls = parseSitemap(dynamicXml);

    for (const item of noindexed) {
      const expectedUrl = `https://sweeprcleaner.com/clean/${item.category}/${item.slug}`;
      assert.equal(
        staticUrls.includes(expectedUrl),
        false,
        `Pruned item ${expectedUrl} MUST NOT appear in static public/sitemap.xml`
      );
      assert.equal(
        dynamicUrls.includes(expectedUrl),
        false,
        `Pruned item ${expectedUrl} MUST NOT appear in dynamic /sitemap.xml`
      );
    }
  });

  // -------------------------------------------------------------
  // Test Suite 4: Strict XML Structure & Well-Formedness
  // -------------------------------------------------------------
  test("CH-XML-01: Strict XML syntax, namespace, structure, and tag balancing for sitemap.xml", () => {
    const xml = readFileSync("public/sitemap.xml", "utf-8");

    // XML Declaration
    assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), "Must start with XML declaration");

    // Root element and namespace
    assert.ok(
      xml.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'),
      "Must contain valid urlset with sitemaps.org namespace"
    );
    assert.ok(xml.trim().endsWith("</urlset>"), "Must cleanly terminate with </urlset>");

    // Count open and close tags for exact balancing
    const openUrls = (xml.match(/<url>/g) || []).length;
    const closeUrls = (xml.match(/<\/url>/g) || []).length;
    assert.equal(openUrls, closeUrls, `Unbalanced <url> tags: open=${openUrls}, close=${closeUrls}`);

    const openLocs = (xml.match(/<loc>/g) || []).length;
    const closeLocs = (xml.match(/<\/loc>/g) || []).length;
    assert.equal(openLocs, closeLocs, `Unbalanced <loc> tags: open=${openLocs}, close=${closeLocs}`);

    const openMod = (xml.match(/<lastmod>/g) || []).length;
    const closeMod = (xml.match(/<\/lastmod>/g) || []).length;
    assert.equal(openMod, closeMod, `Unbalanced <lastmod> tags: open=${openMod}, close=${closeMod}`);

    const openFreq = (xml.match(/<changefreq>/g) || []).length;
    const closeFreq = (xml.match(/<\/changefreq>/g) || []).length;
    assert.equal(openFreq, closeFreq, `Unbalanced <changefreq> tags: open=${openFreq}, close=${closeFreq}`);

    const openPri = (xml.match(/<priority>/g) || []).length;
    const closePri = (xml.match(/<\/priority>/g) || []).length;
    assert.equal(openPri, closePri, `Unbalanced <priority> tags: open=${openPri}, close=${closePri}`);

    // Every URL must have loc, lastmod, changefreq, priority
    assert.equal(openUrls, openLocs, "Every <url> must have exactly one <loc>");
    assert.equal(openUrls, openMod, "Every <url> must have exactly one <lastmod>");
    assert.equal(openUrls, openFreq, "Every <url> must have exactly one <changefreq>");
    assert.equal(openUrls, openPri, "Every <url> must have exactly one <priority>");

    // Total count between 70 and 80
    assert.ok(openUrls >= 70 && openUrls <= 80, `Expected ~75 URLs (70-80), got ${openUrls}`);
    assert.equal(openUrls, 76, `Expected exactly 76 URLs, got ${openUrls}`);

    // Check duplicate URLs
    const locs = parseSitemap(xml);
    assert.equal(locs.length, openUrls, "All locs must parse cleanly");
    const uniqueLocs = new Set(locs);
    assert.equal(uniqueLocs.size, locs.length, "Zero duplicate URLs allowed in sitemap");

    // Validate URL formats and values
    for (const u of locs) {
      assert.ok(u.startsWith("https://sweeprcleaner.com"), `URL must use https://sweeprcleaner.com: ${u}`);
      assert.doesNotThrow(() => new URL(u), `URL must be RFC valid: ${u}`);
      assert.ok(!/[<>"'`\\]/.test(u), `URL contains unescaped invalid character: ${u}`);
      assert.ok(!/\/(?:de|fr|es)(?:\/|$)/.test(new URL(u).pathname), `Sitemap must not contain localized URL: ${u}`);
    }

    // Check lastmod format (YYYY-MM-DD)
    const lastmods = [...xml.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1]);
    for (const lm of lastmods) {
      assert.match(lm, /^\d{4}-\d{2}-\d{2}$/, `Invalid lastmod format: ${lm}`);
    }

    // Check changefreq values
    const allowedFreqs = new Set(["always", "hourly", "daily", "weekly", "monthly", "yearly", "never"]);
    const freqs = [...xml.matchAll(/<changefreq>([^<]+)<\/changefreq>/g)].map((m) => m[1]);
    for (const f of freqs) {
      assert.ok(allowedFreqs.has(f), `Invalid changefreq: ${f}`);
    }

    // Check priority values (0.0 to 1.0)
    const priorities = [...xml.matchAll(/<priority>([^<]+)<\/priority>/g)].map((m) => Number(m[1]));
    for (const p of priorities) {
      assert.ok(!isNaN(p) && p >= 0.0 && p <= 1.0, `Invalid priority value: ${p}`);
    }
  });

  test("CH-XML-02: Dynamic /sitemap.xml route content-type and payload parity", async () => {
    const { app } = setup();
    const res = await app.request("/sitemap.xml");
    assert.equal(res.status, 200);
    assert.equal(
      res.headers.get("content-type"),
      "application/xml; charset=utf-8",
      "Dynamic /sitemap.xml must serve application/xml; charset=utf-8"
    );

    const xml = await res.text();
    const urls = parseSitemap(xml);
    assert.equal(urls.length, 76, "Dynamic sitemap must contain exactly 76 URLs");

    const staticXml = readFileSync("public/sitemap.xml", "utf-8");
    const staticUrls = parseSitemap(staticXml);
    assert.deepEqual(urls, staticUrls, "Dynamic sitemap URLs must match static sitemap.xml verbatim");
  });

  // -------------------------------------------------------------
  // Test Suite 5: Routing Hygiene & Edge Boundaries
  // -------------------------------------------------------------
  test("CH-ROUTE-01: Localized routes serve X-Robots-Tag: noindex, follow without clobbering /order", async () => {
    const { app } = setup();
    const locales = ["de", "fr", "es"] as const;

    for (const loc of locales) {
      // Home (mounted)
      const rHome = await app.request(`/${loc}`);
      assert.equal(rHome.status, 200);
      assert.equal(rHome.headers.get("x-robots-tag"), "noindex, follow");

      // Pricing (mounted)
      const rPricing = await app.request(`/${loc}/pricing`);
      assert.equal(rPricing.status, 200);
      assert.equal(rPricing.headers.get("x-robots-tag"), "noindex, follow");

      // Order route MUST preserve noindex, nofollow
      const rOrder = await app.request(`/${loc}/order`);
      assert.equal(rOrder.status, 200);
      assert.equal(
        rOrder.headers.get("x-robots-tag"),
        "noindex, nofollow",
        `Localized order /${loc}/order must maintain noindex, nofollow`
      );

      // Unmounted localized route (e.g. /${loc}/other) should also serve X-Robots-Tag: noindex, follow via middleware
      const rOther = await app.request(`/${loc}/some-unmounted-page`);
      assert.equal(
        rOther.headers.get("x-robots-tag"),
        "noindex, follow",
        `Unmounted /${loc}/some-unmounted-page must still serve X-Robots-Tag: noindex, follow via middleware`
      );
    }
  });

  test("CH-ROUTE-02: Phantom 404 paths return HTTP 301 to /pricing (with query params)", async () => {
    const { app } = setup();
    const phantoms = ["/month", "/mo", "/year", "/yr"];

    for (const p of phantoms) {
      const res = await app.request(p);
      assert.equal(res.status, 301, `${p} must return 301`);
      assert.equal(res.headers.get("location"), "/pricing", `${p} must redirect to /pricing`);

      // Query params test
      const resWithQuery = await app.request(`${p}?ref=google&promo=save10`);
      assert.equal(resWithQuery.status, 301, `${p}?query must return 301`);
      assert.equal(resWithQuery.headers.get("location"), "/pricing");
    }
  });

  test("CH-ROUTE-03: /pad.xml serves X-Robots-Tag: noindex, follow", async () => {
    const { app } = setup();
    const res = await app.request("/pad.xml");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-robots-tag"), "noindex, follow");
  });

  test("CH-ROUTE-04: Nonexistent clean item returns 404 and cross-category canonical redirects", async () => {
    const { app } = setup();

    // Completely nonexistent item
    const r404 = await app.request("/clean/app/nonexistent-dummy-cache-slug-404");
    assert.equal(r404.status, 404, "Nonexistent item must return 404");

    // Cross-category lookup: steam-depotcache is category 'app'. Requesting under 'folder' should redirect
    const rCross = await app.request("/clean/folder/steam-depotcache");
    assert.equal(rCross.status, 301, "Cross-category request must 301 redirect");
    assert.equal(rCross.headers.get("location"), "/clean/app/steam-depotcache");
  });

  // -------------------------------------------------------------
  // Test Suite 6: Concurrency & Stress Harness
  // -------------------------------------------------------------
  test("CH-STRESS-01: High concurrency burst (100 parallel requests) with header isolation check", async () => {
    const { app } = setup();

    const targets = [
      { path: "/sitemap.xml", expectedStatus: 200, contentType: "application/xml" },
      { path: "/de/pricing", expectedStatus: 200, xRobots: "noindex, follow" },
      { path: "/clean/app/steam-depotcache", expectedStatus: 200, expectNoRobotsHeader: true },
      { path: "/clean/folder/windows-temp", expectedStatus: 200, isPruned: true },
    ];

    // Build 100 concurrent requests (25 of each target)
    const requestTasks: Array<{ target: (typeof targets)[0]; index: number; promise: Promise<Response> }> = [];

    const startTime = Date.now();

    for (let i = 0; i < 100; i++) {
      const target = targets[i % targets.length];
      const promise = app.request(target.path);
      requestTasks.push({ target, index: i, promise });
    }

    const responses = await Promise.all(requestTasks.map((t) => t.promise));
    const duration = Date.now() - startTime;

    assert.equal(responses.length, 100, "All 100 requests must complete");

    for (let i = 0; i < 100; i++) {
      const res = responses[i];
      const { target } = requestTasks[i];

      assert.equal(
        res.status,
        target.expectedStatus,
        `Request ${i} (${target.path}) returned status ${res.status}`
      );

      if (target.contentType) {
        assert.ok(
          res.headers.get("content-type")?.includes(target.contentType),
          `Request ${i} (${target.path}) expected content-type ${target.contentType}`
        );
      }

      if (target.xRobots) {
        assert.equal(
          res.headers.get("x-robots-tag"),
          target.xRobots,
          `Request ${i} (${target.path}) expected X-Robots-Tag: ${target.xRobots}`
        );
      }

      if (target.expectNoRobotsHeader) {
        // Must NOT bleed X-Robots-Tag: noindex from /de requests
        const xr = res.headers.get("x-robots-tag");
        assert.ok(
          !xr || !xr.includes("noindex"),
          `Request ${i} (${target.path}) leaked noindex X-Robots-Tag: ${xr}`
        );
      }

      if (target.isPruned) {
        const html = await res.text();
        const parsed = parseHtml(html);
        assert.equal(
          parsed.metaRobots,
          "noindex, follow",
          `Request ${i} (${target.path}) pruned item must have meta noindex, follow`
        );
      }
    }

    assert.ok(duration < 10000, `100 concurrent requests must complete in <10s, took ${duration}ms`);
  });
});
