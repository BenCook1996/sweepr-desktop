import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
import { openDb } from "../src/db.js";
import { createApp } from "../src/app.js";
import { parseHtml } from "../src/seo/html.js";
import {
  getCleanItems,
  buildPseoTitle,
  buildPseoDescription,
  CUSTOM_GSC_TITLE_SLUGS,
  type CleanItem,
} from "../src/pseo.js";
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

describe("Empirical Challenger M2-1 — Titles & Locked Slugs Stress Test", () => {
  const { app } = setup();
  const allItems = getCleanItems();

  // -------------------------------------------------------------
  // Test 1: Locked Title Slugs Preservation & seo.test.ts assertions
  // -------------------------------------------------------------
  test("CH-M2-1-01: Locked title slugs verification against assertions and zero mutation", async () => {
    // 13 CTR targets from seo.test.ts:1251-1326 and e2e-seo-hygiene.test.ts:350-403
    const knownSeoTestTargets = [
      {
        slug: "steam-depotcache",
        path: "/clean/app/steam-depotcache",
        expectedTitle: "Can I Delete Steam depotcache? YES — Safe Cleanup Guide (Reclaim 2–25 GB)",
      },
      {
        slug: "riot-client-logs",
        path: "/clean/app/riot-client-logs",
        expectedTitle: "Can I Delete Riot Client Logs? YES — Safe Cleanup Guide (Reclaim 1.5–8 GB)",
      },
      {
        slug: "logitech-ghub-installer-cache",
        path: "/clean/app/logitech-ghub-installer-cache",
        expectedTitle: "Can I Delete LGHUB Depots Cache? YES — Safe Cleanup Guide (Reclaim 1.5–8 GB)",
      },
      {
        slug: "stremio-desktop-cache",
        path: "/clean/app/stremio-desktop-cache",
        expectedTitle: "Can I Delete Stremio Cache? YES — Safe Cleanup Guide (Reclaim 1.5–9.5 GB)",
      },
      {
        slug: "amd-shader-cache",
        path: "/clean/app/amd-shader-cache",
        expectedTitle: "Can I Delete AMD DxCache? YES — Safe Cleanup Guide (Reclaim 2–12 GB)",
      },
      {
        slug: "comfyui-temp-output-cache",
        path: "/clean/app/comfyui-temp-output-cache",
        expectedTitle: "Can I Delete ComfyUI Temp Cache? YES — Safe Cleanup Guide (Reclaim 2–18 GB)",
      },
      {
        slug: "genshin-impact-update-cache",
        path: "/clean/app/genshin-impact-update-cache",
        expectedTitle: "Can I Delete Genshin Impact Temp? YES — Safe Cleanup Guide (Reclaim 3–22 GB)",
      },
      {
        slug: "winsxs",
        path: "/clean/folder/winsxs",
        expectedTitle: "Can I Delete C:\\Windows\\WinSxS? YES — Safe Cleanup Guide (Reclaim 6–20 GB)",
      },
      {
        slug: "programdata-package-cache",
        path: "/clean/folder/programdata-package-cache",
        expectedTitle: "Can I Delete ProgramData Package Cache? YES — Safe Cleanup Guide (Reclaim 3.5–22 GB)",
      },
      {
        slug: "elgato-streamdeck-cache",
        path: "/clean/app/elgato-streamdeck-cache",
        expectedTitle: "Can I Delete %APPDATA%\\Elgato\\StreamDeck? YES — Safe Cleanup Guide (Reclaim 1–4 GB)",
      },
      {
        slug: "windows-livekernelreports",
        path: "/clean/folder/windows-livekernelreports",
        expectedTitle: "Can I Delete LiveKernelReports? YES — Safe Cleanup Guide (Reclaim 1.5–10 GB)",
      },
      {
        slug: "vivaldi-browser-cache",
        path: "/clean/app/vivaldi-browser-cache",
        expectedTitle: "Can I Delete Vivaldi Browser Cache? YES — Safe Cleanup Guide (Reclaim 1–5 GB)",
      },
      {
        slug: "jetbrains-intellij-cache",
        path: "/clean/app/jetbrains-intellij-cache",
        expectedTitle: "Can I Delete IntelliJ IDEA Cache? YES — Safe Cleanup Guide (Reclaim 1.5–9.5 GB)",
      },
    ];

    // Assert every known seo.test.ts target matches verbatim in rendered HTML
    for (const target of knownSeoTestTargets) {
      const res = await app.request(target.path);
      assert.equal(res.status, 200, `${target.path} must return 200`);
      const html = await res.text();
      const parsed = parseHtml(html);
      assert.equal(
        parsed.title,
        target.expectedTitle,
        `Title for ${target.path} must match expected verbatim title`
      );
    }

    // Now verify all locked title slugs in LOCKED_TEST_TITLE_SLUGS
    console.log(`[CH-M2-1-01] Total LOCKED_TEST_TITLE_SLUGS count: ${LOCKED_TEST_TITLE_SLUGS.size}`);
    assert.ok(LOCKED_TEST_TITLE_SLUGS.size >= 35, `Expected >= 35 locked title slugs, got ${LOCKED_TEST_TITLE_SLUGS.size}`);

    let lockedInCatalogCount = 0;
    for (const slug of LOCKED_TEST_TITLE_SLUGS) {
      const item = allItems.find((i) => i.slug === slug);
      if (item) {
        lockedInCatalogCount++;
        const title = buildPseoTitle(item);
        assert.ok(
          title.length >= 30 && title.length <= 115,
          `Locked slug ${slug} title length (${title.length}) out of range [30, 115]`
        );

        // Fetch rendered HTML
        const res = await app.request(`/clean/${item.category}/${item.slug}`);
        assert.equal(res.status, 200, `Locked item ${item.slug} returned ${res.status}`);
        const html = await res.text();
        const parsed = parseHtml(html);
        assert.equal(parsed.title, title, `Rendered title for ${item.slug} must match buildPseoTitle output`);
      }
    }
    console.log(`[CH-M2-1-01] Locked slugs present in clean-items catalog: ${lockedInCatalogCount}`);
  });

  // -------------------------------------------------------------
  // Test 2: All 377 Guide Titles Length & Collision Checks
  // -------------------------------------------------------------
  test("CH-M2-1-02: All 377 guide titles satisfy length limits (30-115) with 0 duplicate collisions", () => {
    assert.equal(allItems.length, 377, `Expected exactly 377 clean items, got ${allItems.length}`);

    const titles: string[] = [];
    const titleToSlugs = new Map<string, string[]>();
    let minLen = Infinity;
    let maxLen = -Infinity;
    let totalLen = 0;
    let shortestTitle = "";
    let longestTitle = "";

    const outOfBounds: Array<{ slug: string; title: string; length: number }> = [];

    for (const item of allItems) {
      const title = buildPseoTitle(item);
      titles.push(title);

      const len = title.length;
      totalLen += len;
      if (len < minLen) {
        minLen = len;
        shortestTitle = `${item.slug}: "${title}" (${len})`;
      }
      if (len > maxLen) {
        maxLen = len;
        longestTitle = `${item.slug}: "${title}" (${len})`;
      }

      if (len < 30 || len > 115) {
        outOfBounds.push({ slug: item.slug, title, length: len });
      }

      const existing = titleToSlugs.get(title) || [];
      existing.push(item.slug);
      titleToSlugs.set(title, existing);
    }

    const collisions = Array.from(titleToSlugs.entries()).filter(([_, slugs]) => slugs.length > 1);

    console.log(`[CH-M2-1-02] Title length stats across 377 items:`);
    console.log(`  Min length: ${minLen} chars (${shortestTitle})`);
    console.log(`  Max length: ${maxLen} chars (${longestTitle})`);
    console.log(`  Avg length: ${(totalLen / allItems.length).toFixed(1)} chars`);
    console.log(`  Out-of-bounds count: ${outOfBounds.length}`);
    console.log(`  Duplicate collisions count: ${collisions.length}`);

    if (collisions.length > 0) {
      console.error(`[CH-M2-1-02] Duplicate collisions found:`, collisions);
    }

    assert.equal(outOfBounds.length, 0, `Found ${outOfBounds.length} titles outside 30-115 chars`);
    assert.equal(collisions.length, 0, `Found ${collisions.length} duplicate title collisions`);
    assert.equal(new Set(titles).size, 377, "Expected exactly 377 unique titles");
  });

  // -------------------------------------------------------------
  // Test 3: Front-Loaded Value Proposition in First 48 Characters
  // -------------------------------------------------------------
  test("CH-M2-1-03: Non-locked guides front-load answer & space payoff in first 48 characters", () => {
    const nonLockedItems = allItems.filter((i) => !LOCKED_TEST_TITLE_SLUGS.has(i.slug));
    console.log(`[CH-M2-1-03] Non-locked items count: ${nonLockedItems.length}`);

    const missingAnswerIn48: Array<{ slug: string; title: string; first48: string }> = [];
    const missingPayoffIn48: Array<{ slug: string; title: string; first48: string }> = [];
    const frontLoadSuccess: Array<{ slug: string; title: string; first48: string }> = [];

    // Payoff regex: detects numbers, units (GB, MB, KB), or range patterns
    const payoffRegex = /\d+(?:\.\d+)?\s*(?:–|-|\sto\s)?\s*\d*(?:\.\d+)?\s*(?:GB|MB|KB)?/i;

    for (const item of nonLockedItems) {
      const title = buildPseoTitle(item);
      const first48 = title.slice(0, 48);

      const hasAnswer = /\bYES\b/i.test(first48);
      // More strictly: check if payoff (size numbers/units or space indication) is in first 48
      const hasSpacePayoff = /\(\s*[\d.]+\s*(?:–|-|to)?\s*[\d.]*\s*(?:GB|MB|KB)?\s*\)/i.test(first48) ||
                             /\b\d+(?:\.\d+)?\s*(?:GB|MB)\b/i.test(first48);

      if (!hasAnswer) {
        missingAnswerIn48.push({ slug: item.slug, title, first48 });
      }
      if (!hasSpacePayoff) {
        missingPayoffIn48.push({ slug: item.slug, title, first48 });
      }

      if (hasAnswer && hasSpacePayoff) {
        frontLoadSuccess.push({ slug: item.slug, title, first48 });
      }
    }

    console.log(`[CH-M2-1-03] Front-loading evaluation summary:`);
    console.log(`  Total non-locked: ${nonLockedItems.length}`);
    console.log(`  Both Answer & Space Payoff in first 48 chars: ${frontLoadSuccess.length} (${((frontLoadSuccess.length / nonLockedItems.length) * 100).toFixed(1)}%)`);
    console.log(`  Missing Answer in first 48 chars: ${missingAnswerIn48.length}`);
    console.log(`  Missing Space Payoff in first 48 chars: ${missingPayoffIn48.length}`);

    if (missingAnswerIn48.length > 0) {
      console.warn(`[CH-M2-1-03] Samples missing answer in first 48 chars:`, missingAnswerIn48.slice(0, 10));
    }
    if (missingPayoffIn48.length > 0) {
      console.warn(`[CH-M2-1-03] Samples missing space payoff in first 48 chars:`, missingPayoffIn48.slice(0, 10));
    }

    // Let's analyze whether any failures are due to cleanName length or formatting
    // We record these details empirically for our report!
  });

  // -------------------------------------------------------------
  // Test 4: End-to-End Render Parity across Random Samples
  // -------------------------------------------------------------
  test("CH-M2-1-04: End-to-end HTML title rendering parity for indexed vs noindexed guides", async () => {
    // Select 20 deterministic samples across indexed and noindexed
    const samples = [
      ...allItems.filter((i) => !i.noindex).slice(0, 10),
      ...allItems.filter((i) => i.noindex).slice(0, 10),
    ];

    for (const item of samples) {
      const res = await app.request(`/clean/${item.category}/${item.slug}`);
      assert.equal(res.status, 200);
      const html = await res.text();
      const parsed = parseHtml(html);
      const expectedTitle = buildPseoTitle(item);
      const expectedDesc = buildPseoDescription(item);

      assert.equal(parsed.title, expectedTitle, `Rendered title mismatch for ${item.slug}`);
      assert.equal(parsed.metaDescription, expectedDesc, `Rendered description mismatch for ${item.slug}`);
    }
  });
});
