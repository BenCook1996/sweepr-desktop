import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
process.chdir(path.resolve(__dirname, ".."));

import { openDb } from "../src/db.js";
import { createApp } from "../src/app.js";

const { privateKey } = generateKeyPairSync("ed25519");
const ADMIN_PASS = "adversarial-crm-pass-9921";
const AUTH_HEADER = "Basic " + Buffer.from(`admin:${ADMIN_PASS}`).toString("base64");

describe("Milestone 5 Adversarial API, Injection & Concurrency Challenge Suite", () => {
  let tmpDir: string;
  let dbPath: string;
  let repo: ReturnType<typeof openDb>;
  let app: ReturnType<typeof createApp>;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sweepr-crm-adv-"));
    dbPath = path.join(tmpDir, "sweepr-adv.db");
    repo = openDb(dbPath);
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
      repo.db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  // ==========================================
  // Section 1: Authentication Boundaries
  // ==========================================
  describe("1. Authentication Boundaries & Bypass Defenses", () => {
    test("AUTH-01: Rejects unauthenticated GET /api/crm/seo/changelog with HTTP 401", async () => {
      const res = await app.request("/api/crm/seo/changelog");
      assert.equal(res.status, 401, "Unauthenticated GET must be 401");
    });

    test("AUTH-02: Rejects unauthenticated POST /api/crm/seo/changelog with HTTP 401", async () => {
      const res = await app.request("/api/crm/seo/changelog", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ category: "technical_seo", title: "Unauth", description: "Test" }),
      });
      assert.equal(res.status, 401, "Unauthenticated POST must be 401");
    });

    test("AUTH-03: Rejects unauthenticated GET /api/crm/seo/changelog/summary with HTTP 401", async () => {
      const res = await app.request("/api/crm/seo/changelog/summary");
      assert.equal(res.status, 401, "Unauthenticated summary GET must be 401");
    });

    test("AUTH-04: Rejects unauthenticated DELETE /api/crm/seo/changelog/1 with HTTP 401", async () => {
      const res = await app.request("/api/crm/seo/changelog/1", { method: "DELETE" });
      assert.equal(res.status, 401, "Unauthenticated DELETE must be 401");
    });

    test("AUTH-05: Rejects invalid or forged credentials with HTTP 401", async () => {
      const badHeaders = [
        "Basic " + Buffer.from("admin:wrongpassword").toString("base64"),
        "Basic " + Buffer.from("wronguser:" + ADMIN_PASS).toString("base64"),
        "Basic not_even_base64!!!",
        "Bearer some_bearer_token",
        "Digest username=\"admin\"",
        "",
      ];

      for (const h of badHeaders) {
        const res = await app.request("/api/crm/seo/changelog", {
          headers: h ? { authorization: h } : {},
        });
        assert.equal(res.status, 401, `Expected 401 for header: ${h}`);
      }
    });

    test("AUTH-06: Header spoofing attempts (X-Forwarded-User, etc.) fail to bypass auth", async () => {
      const res = await app.request("/api/crm/seo/changelog", {
        headers: {
          "x-forwarded-user": "admin",
          "x-remote-user": "admin",
          "x-authenticated-user": "admin",
        },
      });
      assert.equal(res.status, 401, "Spoofed headers must not bypass Basic Auth");
    });
  });

  // ==========================================
  // Section 2: Parameter Boundaries & Validation
  // ==========================================
  describe("2. Parameter Boundary & Validation Robustness", () => {
    test("VAL-01: Rejects adversarial category enums with HTTP 400", async () => {
      const adversarialCategories = [
        "blackhat_seo",
        "crypto_spam",
        "",
        "   ",
        "TECHNICAL_SEO", // Case sensitive test
        "technical seo",
        "routing; DROP TABLE seo_changelog; --",
        "gsc_indexing\0",
        null,
        undefined,
        12345,
        true,
        {},
        [],
      ];

      for (const cat of adversarialCategories) {
        const res = await app.request("/api/crm/seo/changelog", {
          method: "POST",
          headers: { authorization: AUTH_HEADER, "content-type": "application/json" },
          body: JSON.stringify({
            category: cat,
            title: "Valid Title",
            description: "Valid Description",
          }),
        });
        assert.equal(res.status, 400, `Expected 400 for category: ${JSON.stringify(cat)}`);
        const json = (await res.json()) as any;
        assert.equal(json.ok, false);
        assert.equal(json.error, "invalid_category");
      }
    });

    test("VAL-02: Rejects missing, empty, or whitespace-only title with HTTP 400", async () => {
      const badTitles = ["", "   ", "\t\n  \r", null, undefined, 12345, {}];

      for (const title of badTitles) {
        const res = await app.request("/api/crm/seo/changelog", {
          method: "POST",
          headers: { authorization: AUTH_HEADER, "content-type": "application/json" },
          body: JSON.stringify({
            category: "technical_seo",
            title,
            description: "Valid Description",
          }),
        });
        assert.equal(res.status, 400, `Expected 400 for title: ${JSON.stringify(title)}`);
        const json = (await res.json()) as any;
        assert.equal(json.ok, false);
        assert.equal(json.error, "title_required");
      }
    });

    test("VAL-03: Rejects missing, empty, or whitespace-only description with HTTP 400", async () => {
      const badDescriptions = ["", "   ", "\t\n  \r", null, undefined, 9999, {}];

      for (const desc of badDescriptions) {
        const res = await app.request("/api/crm/seo/changelog", {
          method: "POST",
          headers: { authorization: AUTH_HEADER, "content-type": "application/json" },
          body: JSON.stringify({
            category: "technical_seo",
            title: "Valid Title",
            description: desc,
          }),
        });
        assert.equal(res.status, 400, `Expected 400 for description: ${JSON.stringify(desc)}`);
        const json = (await res.json()) as any;
        assert.equal(json.ok, false);
        assert.equal(json.error, "description_required");
      }
    });

    test("VAL-04: Malformed JSON syntax gracefully rejected", async () => {
      const syntaxErrors = [
        "not json at all",
        "{ 'title': 'bad single quotes' }",
        "{\"category\": \"technical_seo\", \"title\": \"unclosed json",
        "",
      ];

      for (const raw of syntaxErrors) {
        const res = await app.request("/api/crm/seo/changelog", {
          method: "POST",
          headers: { authorization: AUTH_HEADER, "content-type": "application/json" },
          body: raw,
        });
        assert.equal(res.status, 400, `Expected 400 for malformed body: ${raw}`);
        const json = (await res.json()) as any;
        assert.equal(json.ok, false);
      }
    });

    test("VAL-05: Non-object JSON literals (null, number, array, string) rejected with HTTP 400", async () => {
      const nonObjectBodies = ["null", "12345", "\"raw string\"", "[1, 2, 3]"];
      for (const raw of nonObjectBodies) {
        const res = await app.request("/api/crm/seo/changelog", {
          method: "POST",
          headers: { authorization: AUTH_HEADER, "content-type": "application/json" },
          body: raw,
        });
        assert.equal(res.status, 400, `Expected 400 for non-object body: ${raw}`);
        const json = (await res.json()) as any;
        assert.equal(json.ok, false);
      }
    });
  });

  // ==========================================
  // Section 3: SQL Injection Resistance
  // ==========================================
  describe("3. SQL Injection Resistance & Neutralization", () => {
    test("SQLI-01: Neutralizes SQL injection payloads in title, description, impact, and diff fields", async () => {
      const injections = [
        "'; DROP TABLE seo_changelog; --",
        "' OR 1=1 --",
        "admin' /*",
        "'; UPDATE seo_changelog SET title='pwned' WHERE 1=1; --",
        "1; ATTACH DATABASE 'pwn.db' AS pwn; --",
        "' UNION SELECT id, null, null, null, null, null, null, null, null, null, null, null, null, null FROM seo_changelog --",
      ];

      for (let i = 0; i < injections.length; i++) {
        const sqli = injections[i];
        const res = await app.request("/api/crm/seo/changelog", {
          method: "POST",
          headers: { authorization: AUTH_HEADER, "content-type": "application/json" },
          body: JSON.stringify({
            category: "technical_seo",
            title: `Safe Title ${i}: ${sqli}`,
            description: `Safe Desc ${i}: ${sqli}`,
            impact: sqli,
            impact_area: sqli,
            diff_or_details: sqli,
          }),
        });

        assert.equal(res.status, 200, `Insert must succeed safely for sqli payload: ${sqli}`);
        const json = (await res.json()) as any;
        assert.ok(json.id > 0);
      }

      // Check table is NOT dropped and retains all rows
      const countRow = repo.db.prepare("SELECT count(*) as count FROM seo_changelog").get() as { count: number };
      assert.ok(countRow.count >= injections.length, "Table must remain intact with all inserted rows");
    });

    test("SQLI-02: Neutralizes SQL injection in query parameters (GET & DELETE)", async () => {
      const queryInjections = [
        "'; DROP TABLE seo_changelog; --",
        "' OR '1'='1",
        "cleaner' UNION SELECT null, null, null --",
      ];

      for (const q of queryInjections) {
        // Query param project
        const resProj = await app.request(`/api/crm/seo/changelog?project=${encodeURIComponent(q)}`, {
          headers: { authorization: AUTH_HEADER },
        });
        assert.equal(resProj.status, 200);
        const jsonProj = (await resProj.json()) as any;
        assert.equal(jsonProj.ok, true);

        // Query param category
        const resCat = await app.request(`/api/crm/seo/changelog?category=${encodeURIComponent(q)}`, {
          headers: { authorization: AUTH_HEADER },
        });
        assert.equal(resCat.status, 200);

        // Query param status
        const resStatus = await app.request(`/api/crm/seo/changelog?status=${encodeURIComponent(q)}`, {
          headers: { authorization: AUTH_HEADER },
        });
        assert.equal(resStatus.status, 200);

        // Summary endpoint
        const resSummary = await app.request(`/api/crm/seo/changelog/summary?project=${encodeURIComponent(q)}`, {
          headers: { authorization: AUTH_HEADER },
        });
        assert.equal(resSummary.status, 200);
      }

      // Ensure table is still intact
      const countRow = repo.db.prepare("SELECT count(*) as count FROM seo_changelog").get() as { count: number };
      assert.ok(countRow.count > 0, "seo_changelog must still exist");
    });
  });

  // ==========================================
  // Section 4: Extreme Sizes & Unicode Encoding
  // ==========================================
  describe("4. Extreme Input Sizes & Unicode Robustness", () => {
    test("SIZE-01: Accepts and stores 50KB Markdown diff without truncation or error", async () => {
      const largeMarkdown = "# Technical Audit Log\n" + "## Heading\n- Detailed item bullet\n```ts\nconst x = 1;\n```\n".repeat(1000);
      assert.ok(largeMarkdown.length >= 50000, `Payload must be at least 50KB (actual: ${largeMarkdown.length})`);

      const res = await app.request("/api/crm/seo/changelog", {
        method: "POST",
        headers: { authorization: AUTH_HEADER, "content-type": "application/json" },
        body: JSON.stringify({
          category: "technical_seo",
          title: "Large 50KB Payload Audit",
          description: "Testing maximum markdown diff capacity",
          diff_or_details: largeMarkdown,
        }),
      });

      assert.equal(res.status, 200);
      const json = (await res.json()) as any;
      const readRow = repo.db.prepare("SELECT * FROM seo_changelog WHERE id = ?").get(json.id) as any;
      assert.equal(readRow.diff_or_details, largeMarkdown.trim(), "50KB markdown must be stored intact");
    });

    test("SIZE-02: Accepts complex emojis, ZWJ sequences, and international Unicode characters", async () => {
      const unicodeTitle = "🧹 Cleaner v2.4 · 👩‍💻 🚀 ⚡ 💾 🌍 · 日本語 · العربية · 简体中文 · Русский";
      const unicodeDesc = "Testing ZWJ emojis 👨‍👩‍👧‍👦, flags 🏳️‍🌈 🇬🇧, math symbols ∑∏∫≈≠≤≥, and right-to-left متن فارسی";

      const res = await app.request("/api/crm/seo/changelog", {
        method: "POST",
        headers: { authorization: AUTH_HEADER, "content-type": "application/json" },
        body: JSON.stringify({
          category: "routing",
          title: unicodeTitle,
          description: unicodeDesc,
          impact: "Multi-language locale routing audit: /de, /fr, /es, /ja, /ar",
        }),
      });

      assert.equal(res.status, 200);
      const json = (await res.json()) as any;
      const readRow = repo.db.prepare("SELECT * FROM seo_changelog WHERE id = ?").get(json.id) as any;
      assert.equal(readRow.title, unicodeTitle);
      assert.equal(readRow.description, unicodeDesc);
    });
  });

  // ==========================================
  // Section 5: Concurrency & WAL Mode Lock Stress
  // ==========================================
  describe("5. High-Concurrency & SQLite WAL Mode Lock Stress", () => {
    test("CONC-01: 20 concurrent inserts succeed without SQLITE_BUSY lock errors", async () => {
      const initialCount = (repo.db.prepare("SELECT count(*) as count FROM seo_changelog").get() as any).count;
      const concurrency = 20;

      const requests = Array.from({ length: concurrency }).map((_, i) =>
        app.request("/api/crm/seo/changelog", {
          method: "POST",
          headers: { authorization: AUTH_HEADER, "content-type": "application/json" },
          body: JSON.stringify({
            category: "gsc_indexing",
            title: `Concurrent WAL Stress Item #${i + 1}`,
            description: `Stress-testing concurrent SQLite write operations #${i + 1}`,
            project_id: i % 2 === 0 ? "cleaner" : "vpn",
          }),
        })
      );

      const responses = await Promise.all(requests);

      // Verify every request succeeded with HTTP 200
      for (let i = 0; i < responses.length; i++) {
        const r = responses[i];
        assert.equal(r.status, 200, `Concurrent write request #${i + 1} must return HTTP 200`);
        const json = (await r.json()) as any;
        assert.equal(json.ok, true);
        assert.ok(json.id > 0);
      }

      // Verify exact count increment
      const finalCount = (repo.db.prepare("SELECT count(*) as count FROM seo_changelog").get() as any).count;
      assert.equal(finalCount, initialCount + concurrency, `Expected exactly ${concurrency} new rows`);
    });

    test("CONC-02: Mixed concurrent read and write load (15 writes + 15 reads) executes cleanly", async () => {
      const mixedOps: Array<Promise<Response>> = [];

      // 15 writes
      for (let i = 0; i < 15; i++) {
        mixedOps.push(
          app.request("/api/crm/seo/changelog", {
            method: "POST",
            headers: { authorization: AUTH_HEADER, "content-type": "application/json" },
            body: JSON.stringify({
              category: "content_information_gain",
              title: `Mixed Load Write #${i + 1}`,
              description: `Mixed Load write description #${i + 1}`,
            }),
          })
        );
      }

      // 15 reads (list + summary)
      for (let i = 0; i < 15; i++) {
        mixedOps.push(
          app.request(i % 2 === 0 ? "/api/crm/seo/changelog?limit=50" : "/api/crm/seo/changelog/summary", {
            headers: { authorization: AUTH_HEADER },
          })
        );
      }

      const results = await Promise.all(mixedOps);
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        assert.equal(r.status, 200, `Mixed operation #${i + 1} must return HTTP 200`);
      }
    });
  });

  // ==========================================
  // Section 6: Central CRM Hub Parity Stress
  // ==========================================
  describe("6. Central CRM Hub Parity Stress-Testing", () => {
    test("CENTRAL-01: Central CRM rejects invalid categories and neutralizes injections", async () => {
      const centralRouterPath = path.resolve("c:/Users/Benjamin/Downloads/sweepr_crm/src/seo/router.ts");
      const centralStorePath = path.resolve("c:/Users/Benjamin/Downloads/sweepr_crm/src/seo/store.ts");
      assert.ok(fs.existsSync(centralRouterPath), "Central router must exist");
      assert.ok(fs.existsSync(centralStorePath), "Central store must exist");

      const { createSeoRouter: createCentralRouter } = await import(pathToFileURL(centralRouterPath).href);
      const { SeoStore: CentralStore } = await import(pathToFileURL(centralStorePath).href);

      const centralDb = new DatabaseSync(":memory:");
      const store = new CentralStore(centralDb);
      const router = createCentralRouter({
        store,
        providers: { siteUrl: "https://sweeprcleaner.com" },
        localFetcher: async () => new Response("ok"),
        seedPaths: ["/"],
      });

      // 1. Invalid category
      const resBadCat = await router.request("/changelog", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          category: "crypto_spam",
          title: "Central Bad Category",
          description: "Test",
        }),
      });
      assert.equal(resBadCat.status, 400);

      // 2. SQL injection
      const sqliPayload = "'; DROP TABLE seo_changelog; --";
      const resSqli = await router.request("/changelog", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          category: "technical_seo",
          title: sqliPayload,
          description: sqliPayload,
        }),
      });
      assert.equal(resSqli.status, 200);

      // Check central table is still intact
      const count = centralDb.prepare("SELECT count(*) as count FROM seo_changelog").get() as any;
      assert.equal(count.count, 1, "Central table must remain intact");

      centralDb.close();
    });
  });
});
