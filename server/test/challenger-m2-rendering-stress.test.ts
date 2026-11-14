import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Switch to server directory for path resolutions
process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
import { openDb } from "../src/db.js";
import { createApp } from "../src/app.js";
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
  return { repo, app };
}

const TOP_25_SLUGS = [
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

const TOP_10_SLUGS = TOP_25_SLUGS.slice(0, 10);

describe("Challenger M2-2: Empirical Rendering, Schema, Proof & Attribution Stress Suite", () => {
  // --------------------------------------------------------------------------
  // Area 1: Rendered HTML & SubLocations Table Integrity
  // --------------------------------------------------------------------------
  test("CH-M2-01: #subfolders-breakdown-table renders with non-empty cells across all 25 top guides", async () => {
    const { app } = setup();
    const items = getCleanItems();

    for (const slug of TOP_25_SLUGS) {
      const item = items.find((i) => i.slug === slug);
      assert.ok(item, `Guide item ${slug} must exist in catalog`);

      const res = await app.request(`/clean/${item.category}/${slug}`);
      assert.equal(res.status, 200, `GET /clean/${item.category}/${slug} must return 200`);
      const html = await res.text();

      // 1. Table container presence
      assert.ok(
        html.includes('id="subfolders-breakdown-table"'),
        `Guide ${slug} rendered HTML must contain #subfolders-breakdown-table`
      );

      // 2. Table structure presence
      assert.ok(
        html.includes("<table"),
        `Guide ${slug} must contain a <table> element`
      );
      assert.ok(
        html.includes("<thead") && html.includes("<tbody"),
        `Guide ${slug} table must contain thead and tbody`
      );

      // 3. Header column verification
      assert.ok(html.includes("Sub-Folder / Cache Location"), `Guide ${slug} table missing Sub-Folder column header`);
      assert.ok(html.includes("Storage Role"), `Guide ${slug} table missing Storage Role column header`);
      assert.ok(html.includes("Typical Footprint"), `Guide ${slug} table missing Typical Footprint column header`);
      assert.ok(html.includes("Deletion Safety"), `Guide ${slug} table missing Deletion Safety column header`);

      // 4. Extract table rows from tbody
      const tableMatch = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
      assert.ok(tableMatch, `Guide ${slug} must have <tbody> section`);
      const tbodyHtml = tableMatch[1];
      const rows = tbodyHtml.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];

      assert.ok(
        rows.length >= (item.subLocations?.length || 2),
        `Guide ${slug} rendered ${rows.length} rows, expected at least ${item.subLocations?.length || 2}`
      );

      // 5. Verify every subLocation row has non-empty td cells
      for (const row of rows) {
        const cells = Array.from(row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((m) =>
          m[1].replace(/<[^>]+>/g, "").trim()
        );
        assert.ok(cells.length >= 4, `Guide ${slug} table row must have >= 4 cells, found: ${cells.length}`);
        for (let c = 0; c < 4; c++) {
          assert.ok(
            cells[c].length > 0,
            `Guide ${slug} table cell [${c}] in row must not be empty. Content: "${cells[c]}"`
          );
        }
      }
    }
  });

  test("CH-M2-02: Target file extensions appear in rendered table text across the top 25 guides", async () => {
    const { app } = setup();
    const items = getCleanItems();

    // Map each target extension to guides where it is expected to appear in the rendered table
    const extensionExpectations: Record<string, string[]> = {
      ".csd": ["steam-depotcache"],
      ".csm": ["steam-depotcache"],
      ".nvph": ["nvidia-dxcache"],
      ".dmp": [
        "discord-cache",
        "riot-client-logs",
        "windows-livekernelreports",
        "elgato-streamdeck-cache",
        "localappdata-webview2-ebwebview-cache",
      ],
      ".log": [
        "steam-depotcache",
        "riot-client-logs",
        "stremio-desktop-cache",
        "logitech-ghub-installer-cache",
        "elgato-streamdeck-cache",
        "logitech-options-plus-cache",
        "jetbrains-intellij-cache",
      ],
      ".cache": ["logitech-ghub-installer-cache"],
      // Note: .pak is declared in clean-items.json (windows-old row 2 extensions: [".exe", ".dll", ".pak"]),
      // but windows-old subPath is "C:\\Windows.old\\Program Files & Program Files (x86)" without (*.pak).
      // We assert its presence across all top 25 guides to empirically verify if .pak is rendered anywhere.
      ".pak": ["windows-old"],
    };

    const missingExtensions: Array<{ ext: string; slug: string }> = [];

    for (const [ext, expectedSlugs] of Object.entries(extensionExpectations)) {
      for (const slug of expectedSlugs) {
        const item = items.find((i) => i.slug === slug)!;
        const res = await app.request(`/clean/${item.category}/${slug}`);
        const html = await res.text();

        const tableMatch = html.match(/<div id="subfolders-breakdown-table"[\s\S]*?<\/div>\s*<\/div>/i);
        assert.ok(tableMatch, `Guide ${slug} must contain subfolders table`);
        const tableHtml = tableMatch[0];

        if (!tableHtml.toLowerCase().includes(ext.toLowerCase())) {
          missingExtensions.push({ ext, slug });
        }
      }
    }

    assert.equal(
      missingExtensions.length,
      0,
      `The following required extensions failed to appear in rendered table text: ${JSON.stringify(missingExtensions)}`
    );
  });

  // --------------------------------------------------------------------------
  // Area 2: JSON-LD Multi-Entity Graph Validation
  // --------------------------------------------------------------------------
  test("CH-M2-03: Multi-entity JSON-LD schema (@graph) validates across all 25 top guides", async () => {
    const { app } = setup();
    const items = getCleanItems();

    for (const slug of TOP_25_SLUGS) {
      const item = items.find((i) => i.slug === slug)!;
      const res = await app.request(`/clean/${item.category}/${slug}`);
      const html = await res.text();

      const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i);
      assert.ok(jsonLdMatch, `Guide ${slug} must contain a JSON-LD script tag`);

      let graphData: any;
      assert.doesNotThrow(() => {
        graphData = JSON.parse(jsonLdMatch[1]);
      }, `Guide ${slug} JSON-LD must parse cleanly without syntax errors`);

      assert.equal(graphData["@context"], "https://schema.org", `Guide ${slug} @context must be https://schema.org`);
      assert.ok(Array.isArray(graphData["@graph"]), `Guide ${slug} must contain an @graph array`);

      const nodes = graphData["@graph"];
      const types = nodes.map((n: any) => n["@type"]);

      // 1. Organization node
      const org = nodes.find((n: any) => n["@type"] === "Organization");
      assert.ok(org, `Guide ${slug} must contain Organization node in @graph`);
      assert.equal(org["@id"], "https://sweeprcleaner.com/#organization");
      assert.equal(org.name, "SWEEPR Cleaner");
      assert.equal(org.url, "https://sweeprcleaner.com");
      assert.ok(org.logo && org.logo.startsWith("https://"), `Guide ${slug} Organization missing valid logo URL`);

      // sameAs array validation
      assert.ok(
        Array.isArray(org.sameAs) && org.sameAs.length >= 3,
        `Guide ${slug} Organization must have sameAs array with >= 3 URLs, got: ${org.sameAs?.length}`
      );
      for (const url of org.sameAs) {
        assert.ok(typeof url === "string" && url.startsWith("https://"), `sameAs URL must be valid https URL: ${url}`);
      }

      // Check required profiles
      assert.ok(
        org.sameAs.some((u: string) => u.includes("github.com")),
        `sameAs must include GitHub link`
      );
      assert.ok(
        org.sameAs.some((u: string) => u.includes("winget-pkgs")),
        `sameAs must include Winget link`
      );

      // 2. BreadcrumbList node
      const breadcrumb = nodes.find((n: any) => n["@type"] === "BreadcrumbList");
      assert.ok(breadcrumb, `Guide ${slug} must contain BreadcrumbList node in @graph`);
      assert.ok(
        Array.isArray(breadcrumb.itemListElement) && breadcrumb.itemListElement.length >= 3,
        `Guide ${slug} BreadcrumbList must have >= 3 items`
      );

      // 3. HowTo or FAQPage node
      const hasHowTo = types.includes("HowTo");
      const hasFaq = types.includes("FAQPage");
      assert.ok(
        hasHowTo || hasFaq,
        `Guide ${slug} must contain HowTo or FAQPage node, found types: ${types.join(", ")}`
      );

      if (hasHowTo) {
        const howTo = nodes.find((n: any) => n["@type"] === "HowTo");
        assert.ok(Array.isArray(howTo.step) && howTo.step.length > 0, `Guide ${slug} HowTo must have steps`);
      }
      if (hasFaq) {
        const faq = nodes.find((n: any) => n["@type"] === "FAQPage");
        assert.ok(
          Array.isArray(faq.mainEntity) && faq.mainEntity.length > 0,
          `Guide ${slug} FAQPage must have mainEntity questions`
        );
      }
    }
  });

  // --------------------------------------------------------------------------
  // Area 3: Visual Proof Asset Verification
  // --------------------------------------------------------------------------
  test("CH-M2-04: Top 10 visual proof WebP files physically exist, are valid WebP binaries, and serve HTTP 200", async () => {
    const { app } = setup();
    const proofDir = resolve("public/img/proof");

    for (const slug of TOP_10_SLUGS) {
      const fileName = `${slug}-proof.webp`;
      const filePath = join(proofDir, fileName);

      // 1. Physical existence
      assert.ok(existsSync(filePath), `Proof image file must physically exist at ${filePath}`);

      // 2. Read binary header and validate WebP specification
      const buffer = readFileSync(filePath);
      assert.ok(buffer.length > 0, `Proof image file ${fileName} must be non-empty`);

      // RIFF header
      const riffHeader = buffer.toString("ascii", 0, 4);
      assert.equal(riffHeader, "RIFF", `Proof file ${fileName} must start with RIFF header`);

      // WEBP signature
      const webpSignature = buffer.toString("ascii", 8, 12);
      assert.equal(webpSignature, "WEBP", `Proof file ${fileName} must have WEBP signature at offset 8`);

      // Chunk format
      const chunkType = buffer.toString("ascii", 12, 16);
      assert.ok(
        chunkType === "VP8 " || chunkType === "VP8L" || chunkType === "VP8X",
        `Proof file ${fileName} must be valid VP8/VP8L/VP8X format, got '${chunkType}'`
      );

      // 3. HTTP GET verification via Hono static file route
      const res = await app.request(`/img/proof/${fileName}`);
      assert.equal(res.status, 200, `GET /img/proof/${fileName} must return HTTP 200`);
      assert.equal(
        res.headers.get("content-type"),
        "image/webp",
        `GET /img/proof/${fileName} must return Content-Type: image/webp`
      );
    }
  });

  test("CH-M2-05: Rendered HTML for top 10 guides includes visual proof <figure> and <img>", async () => {
    const { app } = setup();
    const items = getCleanItems();

    for (const slug of TOP_10_SLUGS) {
      const item = items.find((i) => i.slug === slug)!;
      const res = await app.request(`/clean/${item.category}/${slug}`);
      const html = await res.text();

      // 1. Visual proof container
      assert.ok(
        html.includes('id="verified-visual-proof"'),
        `Guide ${slug} rendered HTML must include #verified-visual-proof`
      );

      // 2. <figure> and <img>
      assert.ok(html.includes("<figure"), `Guide ${slug} must include <figure> tag`);
      assert.ok(
        html.includes(`src="/img/proof/${slug}-proof.webp"`),
        `Guide ${slug} must include <img src="/img/proof/${slug}-proof.webp">`
      );

      // 3. Informative alt and figcaption
      assert.ok(
        html.includes('alt="') && !html.includes('alt=""'),
        `Guide ${slug} proof image must have non-empty alt attribute`
      );
      assert.ok(html.includes("<figcaption"), `Guide ${slug} proof figure must include <figcaption>`);
    }

    // Negative check: Guides 11 through 25 must NOT render #verified-visual-proof
    for (const slug of TOP_25_SLUGS.slice(10)) {
      const item = items.find((i) => i.slug === slug)!;
      const res = await app.request(`/clean/${item.category}/${slug}`);
      const html = await res.text();
      assert.ok(
        !html.includes('id="verified-visual-proof"'),
        `Guide ${slug} (not in top 10) must not render #verified-visual-proof`
      );
    }
  });

  // --------------------------------------------------------------------------
  // Area 4: Attribution & Conversion Links
  // --------------------------------------------------------------------------
  test("CH-M2-06: Verified engineering attribution badge is present in 100% of rendered guide pages", async () => {
    const { app } = setup();
    const items = getCleanItems();
    const targetBadgeString = "Tested on Windows 11 24H2 · Verified Microsoft Authenticode Publisher: Benjamin Cook";

    // Test across all 25 top guides
    for (const slug of TOP_25_SLUGS) {
      const item = items.find((i) => i.slug === slug)!;
      const res = await app.request(`/clean/${item.category}/${slug}`);
      assert.equal(res.status, 200);
      const html = await res.text();

      assert.ok(
        html.includes(targetBadgeString),
        `Guide ${slug} must render verified attribution badge verbatim`
      );

      // Check styling/structure around badge
      assert.ok(
        html.includes("bg-emerald-50") && html.includes("text-emerald-800"),
        `Guide ${slug} attribution badge must have proper Tailwind emerald styling`
      );
    }

    // Also spot-check 10 randomly sampled guides from remainder of indexed catalog
    const remainingIndexed = items.filter((i) => !i.noindex && !TOP_25_SLUGS.includes(i.slug)).slice(0, 10);
    for (const item of remainingIndexed) {
      const res = await app.request(`/clean/${item.category}/${item.slug}`);
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.ok(
        html.includes(targetBadgeString),
        `Sampled indexed guide ${item.slug} must also render verified attribution badge`
      );
    }
  });

  test("CH-M2-07: All CTA anchors linking to /download and /order carry rel='nofollow'", async () => {
    const { app } = setup();
    const items = getCleanItems();

    for (const slug of TOP_25_SLUGS) {
      const item = items.find((i) => i.slug === slug)!;
      const res = await app.request(`/clean/${item.category}/${slug}`);
      const html = await res.text();

      // Find all anchor tags
      const anchorRegex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>/gi;
      let match: RegExpExecArray | null;

      let ctaCount = 0;
      while ((match = anchorRegex.exec(html)) !== null) {
        const fullTag = match[0];
        const href = match[1];

        if (href.startsWith("/download") || href.startsWith("/order")) {
          ctaCount++;
          assert.ok(
            fullTag.includes('rel="nofollow"') || fullTag.includes("rel='nofollow'"),
            `CTA anchor for '${href}' in guide ${slug} must include rel="nofollow". Tag: ${fullTag}`
          );
        }
      }

      // Each guide has top nav CTAs and bottom hero CTAs (at least 3-4 CTAs total)
      assert.ok(
        ctaCount >= 3,
        `Guide ${slug} expected at least 3 conversion CTA anchors with /download or /order, found: ${ctaCount}`
      );
    }
  });

  // --------------------------------------------------------------------------
  // Area 5: Adversarial Boundary & Googlebot Crawl Simulation
  // --------------------------------------------------------------------------
  test("CH-M2-08: Googlebot crawl receives identical E-E-A-T attribution, subLocations, and schema", async () => {
    const { app } = setup();
    const items = getCleanItems();
    const googlebotUA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

    for (const slug of ["steam-depotcache", "nvidia-dxcache", "windows-old"]) {
      const item = items.find((i) => i.slug === slug)!;
      const res = await app.request(`/clean/${item.category}/${slug}`, {
        headers: { "user-agent": googlebotUA },
      });
      const html = await res.text();

      assert.ok(
        html.includes("Tested on Windows 11 24H2 · Verified Microsoft Authenticode Publisher: Benjamin Cook"),
        `Googlebot must receive verified attribution badge on ${slug}`
      );
      assert.ok(
        html.includes('id="subfolders-breakdown-table"'),
        `Googlebot must receive subfolders breakdown table on ${slug}`
      );
      assert.ok(
        html.includes('"@type":"Organization"') || html.includes('"@type": "Organization"'),
        `Googlebot must receive Organization schema on ${slug}`
      );
    }
  });
});
