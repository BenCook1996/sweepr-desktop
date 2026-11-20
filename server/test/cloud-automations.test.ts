import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
import { openDb } from "../src/db.js";
import { createApp } from "../src/app.js";
import {
  extractVersionAndRatingFromHtml,
  isSubmissionOrRootListingUrl,
} from "../src/seo/listings.js";
import {
  getAutomationLastRunAt,
  hydrateAutomationRegistry,
  recordAutomationRunStatus,
} from "../src/crm.js";
import { SeoStore } from "../src/seo/store.js";

const { privateKey } = generateKeyPairSync("ed25519");
const ADMIN_PASSWORD = "test-admin-password";
const auth = {
  authorization: `Basic ${Buffer.from(`admin:${ADMIN_PASSWORD}`).toString("base64")}`,
};

function setupApp() {
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

test("Body limit allows >256KB payload on /api/crm/seo/gsc/ingest while rejecting >256KB on other /api/* routes", async () => {
  const { app } = setupApp();

  // Build ~320 KB valid GSC rows payload (simulating 558 KB gsc-seed.json without hitting 256 KB limit)
  const rows = Array.from({ length: 1800 }, (_, i) => ({
    date: "2026-11-15",
    query: `windows cache cleanup query ${String(i).padStart(4, "0")} ${"x".repeat(60)}`,
    page: `https://sweeprcleaner.com/clean/folder/sample-${i}`,
    clicks: i % 3,
    impressions: 20 + (i % 50),
    ctr: 0.05,
    position: 8.5,
  }));
  const largeIngestBody = JSON.stringify({ rows });
  assert.ok(Buffer.byteLength(largeIngestBody, "utf8") > 280 * 1024);

  const ingestRes = await app.request("/api/crm/seo/gsc/ingest", {
    method: "POST",
    headers: { ...auth, "content-type": "application/json", origin: "http://test" },
    body: largeIngestBody,
  });
  assert.equal(ingestRes.status, 200);
  const ingestJson = (await ingestRes.json()) as { ok: boolean; ingested: number };
  assert.equal(ingestJson.ok, true);
  assert.equal(ingestJson.ingested, 1800);

  // Another /api/* endpoint must still enforce the strict 256 KB guard
  const oversizeOtherBody = JSON.stringify({ keyword: "a".repeat(270 * 1024) });
  const rejectedRes = await app.request("/api/crm/seo/keywords", {
    method: "POST",
    headers: { ...auth, "content-type": "application/json", origin: "http://test" },
    body: oversizeOtherBody,
  });
  assert.equal(rejectedRes.status, 413);
});

test("A5 listing parser ignores unrelated Bootstrap/framework versions when HTML does not mention Sweepr", () => {
  const genericHtml = `<!doctype html><html><head><script src="bootstrap.min.js?ver=5.3.1"></script></head><body><h1>Software Directory Home v5.3.8</h1></body></html>`;
  const genericParsed = extractVersionAndRatingFromHtml(genericHtml);
  assert.equal(genericParsed.detected_version, null);

  const sweeprHtml = `<html><body><h1>SWEEPR Cleaner v0.0.9</h1></body></html>`;
  const sweeprParsed = extractVersionAndRatingFromHtml(sweeprHtml);
  assert.equal(sweeprParsed.detected_version, "0.0.9");

  const padXml = `<?xml version="1.0"?><XML_DIZ_INFO><Program_Info><Program_Version>0.1.0</Program_Version></Program_Info></XML_DIZ_INFO>`;
  assert.equal(extractVersionAndRatingFromHtml(padXml).detected_version, "0.1.0");
});

test("isSubmissionOrRootListingUrl separates submission/root URLs from live deep product listings", () => {
  assert.equal(isSubmissionOrRootListingUrl("https://www.majorgeeks.com"), true);
  assert.equal(isSubmissionOrRootListingUrl("https://www.soft112.com/submit-software.html"), true);
  assert.equal(isSubmissionOrRootListingUrl("https://www.apponic.com/submit/"), true);
  assert.equal(isSubmissionOrRootListingUrl("https://www.filehorse.com/contact/"), true);
  assert.equal(isSubmissionOrRootListingUrl("https://sourceforge.net/software/vendors/new"), true);
  assert.equal(isSubmissionOrRootListingUrl("https://www.downloadcrew.com/user/feedback"), true);
  assert.equal(isSubmissionOrRootListingUrl("https://form.asana.com/?k=abc&d=123"), true);

  assert.equal(isSubmissionOrRootListingUrl("https://sweeprcleaner.com/pad.xml"), false);
  assert.equal(isSubmissionOrRootListingUrl("https://github.com/microsoft/winget-pkgs/pull/480164"), false);
  assert.equal(isSubmissionOrRootListingUrl("https://community.chocolatey.org/packages/sweepr-cleaner/0.1.0"), false);
  assert.equal(isSubmissionOrRootListingUrl("https://github.com/BenCook1996/scoop-sweepr"), false);
  assert.equal(isSubmissionOrRootListingUrl("https://github.com/BenCook1996/sweepr-desktop/releases/tag/v0.1.0"), false);
});

test("getAutomationLastRunAt returns persisted last_run_at timestamp after recordAutomationRunStatus", () => {
  const repo = openDb(":memory:");
  const store = new SeoStore(repo.db);
  hydrateAutomationRegistry(store);

  const expectedTs = 1795154000;
  recordAutomationRunStatus("A5_directory_listings", {
    status: "ok",
    durationMs: 42,
    summary: { current_count: 5 },
    nowSec: expectedTs,
  });

  assert.equal(getAutomationLastRunAt("A5_directory_listings"), expectedTs);
  assert.equal(getAutomationLastRunAt("nonexistent_job_id"), null);
});
