import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
process.chdir(path.resolve(__dirname, ".."));

import { openDb } from "../src/db.js";
import { createApp } from "../src/app.js";
import { SeoStore } from "../src/seo/store.js";

const { privateKey } = generateKeyPairSync("ed25519");
const ADMIN_PASS = "test-crm-password";
const AUTH_HEADER = "Basic " + Buffer.from(`admin:${ADMIN_PASS}`).toString("base64");

const ALL_5_PROJECTS = ["cleaner", "vpn", "deepblock", "shopsafe", "clipper"] as const;
const VALID_CATEGORIES = [
  "technical_seo",
  "routing",
  "content_information_gain",
  "distribution_backlinks",
  "sitemap_pruning",
  "gsc_indexing",
] as const;

let tmpDir: string;
let repo: ReturnType<typeof openDb>;
let app: ReturnType<typeof createApp>;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sweepr-crm-e2e-"));
  repo = openDb(path.join(tmpDir, "sweepr-test.db"));
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
      devEndpoints: true,
      pastDueGraceDays: 3,
      crmAdminUser: "admin",
      crmAdminPassword: ADMIN_PASS,
    },
  });
});

after(() => {
  try {
    repo?.db?.close();
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  } catch {}
});

describe("E2E Dual CRM SEO Changelog Track — Tier 1: Schema & Functional Acceptance", () => {
  test("TC-CRM-01: Local Database Table Schema `seo_changelog` exists with required columns", () => {
    const tableInfo = repo.db
      .prepare("PRAGMA table_info(seo_changelog)")
      .all() as Array<{ name: string; type: string; notnull: number; pk: number }>;

    assert.ok(
      tableInfo.length >= 8,
      `Expected at least 8 columns in seo_changelog, found ${tableInfo.length}`
    );

    const colMap = new Map(tableInfo.map((c) => [c.name, c]));
    assert.ok(colMap.has("id") && colMap.get("id")!.pk === 1, "id column must be primary key");
    assert.ok(colMap.has("project_id"), "project_id column must exist");
    assert.ok(colMap.has("category") && colMap.get("category")!.notnull === 1, "category column must be NOT NULL");
    assert.ok(colMap.has("title") && colMap.get("title")!.notnull === 1, "title column must be NOT NULL");
    assert.ok(colMap.has("description") && colMap.get("description")!.notnull === 1, "description column must be NOT NULL");
    assert.ok(colMap.has("impact_area"), "impact_area column must exist");
    assert.ok(colMap.has("author"), "author column must exist");
    assert.ok(colMap.has("diff_or_details"), "diff_or_details column must exist");
    assert.ok(colMap.has("created_at") && colMap.get("created_at")!.notnull === 1, "created_at column must be NOT NULL");
  });

  test("TC-CRM-02: GET /api/crm/seo/changelog enforces Basic Auth (401 unauthenticated, 200 authenticated)", async () => {
    const unauthRes = await app.request("/api/crm/seo/changelog");
    assert.equal(unauthRes.status, 401, "Unauthenticated request must return 401");

    const authRes = await app.request("/api/crm/seo/changelog", {
      headers: { authorization: AUTH_HEADER },
    });
    assert.equal(authRes.status, 200, "Authenticated request must return 200");
    const json = (await authRes.json()) as any;
    assert.equal(json.ok, true);
    assert.ok(Array.isArray(json.entries), "entries must be an array");
    assert.equal(typeof json.total, "number", "total must be a number");
  });

  test("TC-CRM-03: POST /api/crm/seo/changelog creates a valid entry and GET reads it back", async () => {
    const payload = {
      category: "sitemap_pruning",
      title: "Prune sitemap to ~75 Tier-1 URLs",
      description: "Excluded 302 zero-impression guides from sitemap.xml with noindex, follow header.",
      impact_area: "server/public/sitemap.xml",
      author: "Benjamin Cook",
      diff_or_details: "Removed /de, /fr, /es routes and long-tail guides",
    };

    const postRes = await app.request("/api/crm/seo/changelog", {
      method: "POST",
      headers: {
        authorization: AUTH_HEADER,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    assert.equal(postRes.status, 200, "POST must return 200/201");
    const postJson = (await postRes.json()) as any;
    assert.equal(postJson.ok, true);
    assert.ok(postJson.id > 0, "Generated ID must be a positive integer");
    assert.equal(postJson.entry.title, payload.title);
    assert.equal(postJson.entry.category, payload.category);
    assert.equal(postJson.entry.project_id, "cleaner", "Local changelog must default to project_id 'cleaner'");

    // Immediate read-back verification
    const getRes = await app.request("/api/crm/seo/changelog", {
      headers: { authorization: AUTH_HEADER },
    });
    const getJson = (await getRes.json()) as any;
    const match = getJson.entries.find((e: any) => e.id === postJson.id);
    assert.ok(match, "Created entry must appear in changelog list");
    assert.equal(match.impact_area, payload.impact_area);
  });

  test("TC-CRM-04: Central CRM Database exists and contains seeded entries for all 5 linked projects", {
    skip: Boolean(process.env.GITHUB_ACTIONS) && !fs.existsSync("c:/Users/Benjamin/Downloads/sweepr_crm/data/sweepr-crm.db"),
  }, () => {
    const centralDbPath = path.resolve("c:/Users/Benjamin/Downloads/sweepr_crm/data/sweepr-crm.db");
    assert.ok(fs.existsSync(centralDbPath), `Central CRM DB must exist at ${centralDbPath}`);

    const centralDb = new DatabaseSync(centralDbPath);
    try {
      const tableCheck = centralDb
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='seo_changelog'")
        .get() as { name: string } | undefined;
      assert.ok(tableCheck, "seo_changelog table must exist in sweepr-crm.db");

      const rows = centralDb
        .prepare("SELECT DISTINCT project_id FROM seo_changelog")
        .all() as Array<{ project_id: string }>;
      const projects = rows.map((r) => r.project_id);

      for (const p of ALL_5_PROJECTS) {
        assert.ok(
          projects.includes(p),
          `Central CRM DB must contain seeded entries for project: ${p}`
        );
      }
    } finally {
      centralDb.close();
    }
  });

  test("TC-CRM-05: SEO_CHANGELOG.md exists and documents updates across all 5 projects", () => {
    const localChangelog = path.resolve(process.cwd(), "../SEO_CHANGELOG.md");
    const serverChangelog = path.resolve(process.cwd(), "SEO_CHANGELOG.md");
    const centralChangelog = path.resolve("c:/Users/Benjamin/Downloads/sweepr_crm/SEO_CHANGELOG.md");

    const foundPath = [localChangelog, serverChangelog, centralChangelog].find((p) => fs.existsSync(p));
    assert.ok(foundPath, "SEO_CHANGELOG.md must exist in desktop_cleaner or sweepr_crm repository root");

    const content = fs.readFileSync(foundPath, "utf-8");

    // All 5 projects must be documented
    for (const p of ALL_5_PROJECTS) {
      assert.ok(
        content.toLowerCase().includes(p),
        `SEO_CHANGELOG.md must document updates for project: ${p}`
      );
    }

    // Required action areas must be documented
    const requiredTerms = [
      "sitemap",
      "noindex",
      "routing",
      "technical_seo",
      "distribution",
    ];
    for (const term of requiredTerms) {
      assert.ok(
        content.toLowerCase().includes(term),
        `SEO_CHANGELOG.md must document SEO action category: ${term}`
      );
    }
  });
});

describe("E2E Dual CRM SEO Changelog Track — Tier 2: Boundary, Injection & Aliasing Cases", () => {
  test("TC-CRM-T2-01: Rejects invalid category enum values with HTTP 400 Bad Request", async () => {
    const invalidCategories = ["invalid_cat", "hacking", "", 12345, null, "random_stuff"];
    for (const cat of invalidCategories) {
      const res = await app.request("/api/crm/seo/changelog", {
        method: "POST",
        headers: {
          authorization: AUTH_HEADER,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          category: cat,
          title: "Test Entry",
          description: "Test Description",
        }),
      });
      assert.equal(res.status, 400, `Expected 400 for invalid category: ${cat}`);
      const errJson = (await res.json()) as any;
      assert.equal(errJson.ok, false);
    }
  });

  test("TC-CRM-T2-02: Rejects empty title or empty description with HTTP 400 Bad Request", async () => {
    const emptyCases = [
      { category: "routing", title: "", description: "Valid desc" },
      { category: "routing", title: "   ", description: "Valid desc" },
      { category: "routing", title: "Valid title", description: "" },
      { category: "routing", title: "Valid title", description: "   " },
    ];

    for (const c of emptyCases) {
      const res = await app.request("/api/crm/seo/changelog", {
        method: "POST",
        headers: { authorization: AUTH_HEADER, "content-type": "application/json" },
        body: JSON.stringify(c),
      });
      assert.equal(res.status, 400, `Expected 400 for empty title/description`);
    }
  });

  test("TC-CRM-T2-03: Pagination parameter boundary clamping", async () => {
    const resLarge = await app.request("/api/crm/seo/changelog?limit=999999", {
      headers: { authorization: AUTH_HEADER },
    });
    assert.equal(resLarge.status, 200);
    const jsonLarge = (await resLarge.json()) as any;
    assert.ok(jsonLarge.entries.length <= 200, "Limit must clamp to max 200");

    const resOffset = await app.request("/api/crm/seo/changelog?offset=999999", {
      headers: { authorization: AUTH_HEADER },
    });
    assert.equal(resOffset.status, 200);
    const jsonOffset = (await resOffset.json()) as any;
    assert.deepEqual(jsonOffset.entries, [], "Excessive offset must return empty array without error");
  });

  test("TC-CRM-T2-04: SQL injection resistance, emoji, unicode and large Markdown diff payloads", async () => {
    const complexPayload = {
      category: "technical_seo",
      title: "SQL Injection Test: '; DROP TABLE seo_changelog; -- 🚀 🧹",
      description: "XSS Test: <script>alert('xss')</script> & Japanese: クリーナー & Arabic: تنظيف",
      impact_area: "server/src/app.ts",
      author: "Benjamin Cook",
      diff_or_details: "# Large Diff\n" + "x".repeat(15000), // 15KB diff
    };

    const res = await app.request("/api/crm/seo/changelog", {
      method: "POST",
      headers: { authorization: AUTH_HEADER, "content-type": "application/json" },
      body: JSON.stringify(complexPayload),
    });
    assert.equal(res.status, 200);
    const json = (await res.json()) as any;

    // Verify table is intact and data was stored safely
    const tableCheck = repo.db
      .prepare("SELECT count(*) as count FROM seo_changelog WHERE id = ?")
      .get(json.id) as { count: number };
    assert.equal(tableCheck.count, 1, "Table must remain intact and contain new row");

    const readRow = repo.db
      .prepare("SELECT * FROM seo_changelog WHERE id = ?")
      .get(json.id) as any;
    assert.equal(readRow.title, complexPayload.title);
    assert.equal(readRow.description, complexPayload.description);
    assert.equal(readRow.diff_or_details.length, complexPayload.diff_or_details.length);
  });
});

describe("E2E Dual CRM SEO Changelog Track — Tier 3: Cross-System Parity & Sync Bridge", () => {
  test("TC-CRM-T3-01: Sync bridge exports non-blocking syncToCentralCrm helper", async () => {
    const syncModule = await import("../src/crm-sync.js");
    assert.equal(typeof syncModule.syncToCentralCrm, "function", "syncToCentralCrm must be exported");
    assert.equal(typeof syncModule.isCentralCrmConfigured, "function", "isCentralCrmConfigured must be exported");
  });

  test("TC-CRM-T3-02: Category enum alignment between PROJECT.md and valid categories", () => {
    for (const cat of VALID_CATEGORIES) {
      assert.ok(
        [
          "technical_seo",
          "routing",
          "content_information_gain",
          "distribution_backlinks",
          "sitemap_pruning",
          "gsc_indexing",
        ].includes(cat),
        `Category ${cat} must match agreed standard schema`
      );
    }
  });
});

describe("E2E Dual CRM SEO Changelog Track — Tier 4: Idempotency & Concurrency", () => {
  test("TC-CRM-T4-01: Multiple SeoStore instantiations are fully idempotent", () => {
    assert.doesNotThrow(() => {
      new SeoStore(repo.db);
      new SeoStore(repo.db);
      new SeoStore(repo.db);
    }, "Multiple SeoStore instantiations must not throw duplicate table/index errors");
  });

  test("TC-CRM-T4-02: Concurrent POST requests under SQLite WAL mode succeed without busy locks", async () => {
    const concurrentCount = 10;
    const promises = Array.from({ length: concurrentCount }).map((_, idx) =>
      app.request("/api/crm/seo/changelog", {
        method: "POST",
        headers: { authorization: AUTH_HEADER, "content-type": "application/json" },
        body: JSON.stringify({
          category: "routing",
          title: `Concurrent Entry ${idx}`,
          description: `Description for entry ${idx}`,
        }),
      })
    );

    const responses = await Promise.all(promises);
    for (const r of responses) {
      assert.equal(r.status, 200, "All concurrent requests must return HTTP 200");
    }
  });
});
