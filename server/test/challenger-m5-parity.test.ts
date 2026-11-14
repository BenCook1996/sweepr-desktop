import test, { before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import vm from "node:vm";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { syncSeoChangelogToCentralCrm } from "../src/crm-sync.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOCAL_DB_PATH = path.resolve(__dirname, "../data/sweepr.db");
const CENTRAL_DB_PATH = path.resolve("c:/Users/Benjamin/Downloads/sweepr_crm/data/sweepr-crm.db");
const LOCAL_HTML_PATH = path.resolve(__dirname, "../public/crm/index.html");
const CENTRAL_HTML_PATH = path.resolve("c:/Users/Benjamin/Downloads/sweepr_crm/public/crm/index.html");

const EXPECTED_PROJECTS = ["cleaner", "vpn", "deepblock", "shopsafe", "clipper"];
const EXPECTED_CATEGORIES = [
  "technical_seo",
  "routing",
  "content_information_gain",
  "distribution_backlinks",
  "sitemap_pruning",
  "gsc_indexing",
];

// Warm up undici dispatcher so cold-start socket initialization doesn't skew latency assertions
before(async () => {
  try {
    await fetch("http://127.0.0.1:58941", { signal: AbortSignal.timeout(100) });
  } catch {}
});

const skipMissingCrossRepo = (filePath: string) =>
  Boolean(process.env.GITHUB_ACTIONS) && !fs.existsSync(filePath);

// ---------------- 1. Database Schema Parity ----------------
test("1.1 Table `seo_changelog` exists in both databases", {
  skip: skipMissingCrossRepo(LOCAL_DB_PATH) || skipMissingCrossRepo(CENTRAL_DB_PATH),
}, () => {
  assert.ok(fs.existsSync(LOCAL_DB_PATH), `Local DB missing at ${LOCAL_DB_PATH}`);
  assert.ok(fs.existsSync(CENTRAL_DB_PATH), `Central DB missing at ${CENTRAL_DB_PATH}`);

  const localDb = new DatabaseSync(LOCAL_DB_PATH, { readOnly: true });
  const centralDb = new DatabaseSync(CENTRAL_DB_PATH, { readOnly: true });

  const localTable = localDb
    .prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name='seo_changelog'")
    .get() as { name: string; sql: string } | undefined;
  const centralTable = centralDb
    .prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name='seo_changelog'")
    .get() as { name: string; sql: string } | undefined;

  assert.ok(localTable, "seo_changelog table missing from local DB");
  assert.ok(centralTable, "seo_changelog table missing from central DB");
});

test("1.2 Column definitions, types, and primary keys match across both databases", {
  skip: skipMissingCrossRepo(LOCAL_DB_PATH) || skipMissingCrossRepo(CENTRAL_DB_PATH),
}, () => {
  const localDb = new DatabaseSync(LOCAL_DB_PATH, { readOnly: true });
  const centralDb = new DatabaseSync(CENTRAL_DB_PATH, { readOnly: true });

  interface PragmaCol {
    cid: number;
    name: string;
    type: string;
    notnull: number;
    dflt_value: string | null;
    pk: number;
  }

  const localCols = localDb.prepare("PRAGMA table_info(seo_changelog)").all() as unknown as PragmaCol[];
  const centralCols = centralDb.prepare("PRAGMA table_info(seo_changelog)").all() as unknown as PragmaCol[];

  const localMap = new Map(localCols.map((c) => [c.name, c]));
  const centralMap = new Map(centralCols.map((c) => [c.name, c]));

  const requiredCols = [
    "id",
    "project_id",
    "date",
    "category",
    "title",
    "description",
    "impact",
    "impact_area",
    "author",
    "diff_or_details",
    "status",
    "target_urls",
    "metadata_json",
    "created_at",
    "updated_at",
  ];

  for (const colName of requiredCols) {
    const lCol = localMap.get(colName);
    const cCol = centralMap.get(colName);
    assert.ok(lCol, `Column '${colName}' missing in local DB`);
    assert.ok(cCol, `Column '${colName}' missing in central DB`);

    // Verify types match
    assert.equal(
      lCol.type.toUpperCase(),
      cCol.type.toUpperCase(),
      `Column '${colName}' type mismatch: local=${lCol.type}, central=${cCol.type}`
    );

    // Verify primary key
    assert.equal(
      lCol.pk,
      cCol.pk,
      `Column '${colName}' PK mismatch: local=${lCol.pk}, central=${cCol.pk}`
    );
  }
});

test("1.3 Indexes match across both databases", {
  skip: skipMissingCrossRepo(LOCAL_DB_PATH) || skipMissingCrossRepo(CENTRAL_DB_PATH),
}, () => {
  const localDb = new DatabaseSync(LOCAL_DB_PATH, { readOnly: true });
  const centralDb = new DatabaseSync(CENTRAL_DB_PATH, { readOnly: true });

  const localIndexes = localDb
    .prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='seo_changelog'")
    .all() as Array<{ name: string; sql: string }>;
  const centralIndexes = centralDb
    .prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='seo_changelog'")
    .all() as Array<{ name: string; sql: string }>;

  const localIdxNames = new Set(localIndexes.map((i) => i.name));
  const centralIdxNames = new Set(centralIndexes.map((i) => i.name));

  assert.ok(localIdxNames.has("idx_seo_changelog_proj_date"), "Missing idx_seo_changelog_proj_date in local DB");
  assert.ok(centralIdxNames.has("idx_seo_changelog_proj_date"), "Missing idx_seo_changelog_proj_date in central DB");
  assert.ok(localIdxNames.has("idx_seo_changelog_category"), "Missing idx_seo_changelog_category in local DB");
  assert.ok(centralIdxNames.has("idx_seo_changelog_category"), "Missing idx_seo_changelog_category in central DB");
});

// ---------------- 2. Cross-Project Seed Completeness ----------------
test("2.1 All 5 registered projects exist in both databases with non-zero entries", {
  skip: skipMissingCrossRepo(LOCAL_DB_PATH) || skipMissingCrossRepo(CENTRAL_DB_PATH),
}, () => {
  const localDb = new DatabaseSync(LOCAL_DB_PATH, { readOnly: true });
  const centralDb = new DatabaseSync(CENTRAL_DB_PATH, { readOnly: true });

  const localProjects = (
    localDb.prepare("SELECT DISTINCT project_id FROM seo_changelog").all() as Array<{ project_id: string }>
  ).map((r) => r.project_id);

  const centralProjects = (
    centralDb.prepare("SELECT DISTINCT project_id FROM seo_changelog").all() as Array<{ project_id: string }>
  ).map((r) => r.project_id);

  for (const proj of EXPECTED_PROJECTS) {
    assert.ok(
      localProjects.includes(proj),
      `Project '${proj}' missing in local DB (found: ${localProjects.join(", ")})`
    );
    assert.ok(
      centralProjects.includes(proj),
      `Project '${proj}' missing in central DB (found: ${centralProjects.join(", ")})`
    );
  }
});

test("2.2 All 6 standardized categories are populated in both databases", {
  skip: skipMissingCrossRepo(LOCAL_DB_PATH) || skipMissingCrossRepo(CENTRAL_DB_PATH),
}, () => {
  const localDb = new DatabaseSync(LOCAL_DB_PATH, { readOnly: true });
  const centralDb = new DatabaseSync(CENTRAL_DB_PATH, { readOnly: true });

  const localCategories = (
    localDb.prepare("SELECT DISTINCT category FROM seo_changelog").all() as Array<{ category: string }>
  ).map((r) => r.category);

  const centralCategories = (
    centralDb.prepare("SELECT DISTINCT category FROM seo_changelog").all() as Array<{ category: string }>
  ).map((r) => r.category);

  for (const cat of EXPECTED_CATEGORIES) {
    assert.ok(
      localCategories.includes(cat),
      `Category '${cat}' missing in local DB (found: ${localCategories.join(", ")})`
    );
    assert.ok(
      centralCategories.includes(cat),
      `Category '${cat}' missing in central DB (found: ${centralCategories.join(", ")})`
    );
  }
});

test("2.3 Seed rows count and project distribution match", {
  skip: skipMissingCrossRepo(LOCAL_DB_PATH) || skipMissingCrossRepo(CENTRAL_DB_PATH),
}, () => {
  const localDb = new DatabaseSync(LOCAL_DB_PATH, { readOnly: true });
  const centralDb = new DatabaseSync(CENTRAL_DB_PATH, { readOnly: true });

  const localCount = (localDb.prepare("SELECT COUNT(*) as c FROM seo_changelog").get() as { c: number }).c;
  const centralCount = (centralDb.prepare("SELECT COUNT(*) as c FROM seo_changelog").get() as { c: number }).c;

  assert.ok(localCount >= 18, `Expected at least 18 rows in local DB, got ${localCount}`);
  assert.ok(centralCount >= 18, `Expected at least 18 rows in central DB, got ${centralCount}`);
  assert.equal(localCount, centralCount, `Row count mismatch: local=${localCount}, central=${centralCount}`);

  const localDist = localDb
    .prepare("SELECT project_id, count(*) as count FROM seo_changelog GROUP BY project_id ORDER BY project_id")
    .all() as Array<{ project_id: string; count: number }>;
  const centralDist = centralDb
    .prepare("SELECT project_id, count(*) as count FROM seo_changelog GROUP BY project_id ORDER BY project_id")
    .all() as Array<{ project_id: string; count: number }>;

  assert.deepEqual(localDist, centralDist, "Project distribution counts differ between local and central DB");
});

// ---------------- 3. Sync Bridge Resilience Testing ----------------
test("3.1 syncSeoChangelogToCentralCrm handles unconfigured CRM gracefully", () => {
  const origUrl = process.env.SWEEPR_CRM_URL;
  delete process.env.SWEEPR_CRM_URL;
  delete process.env.RAILWAY_SERVICE_SWEEPR_CRM_URL;

  assert.doesNotThrow(() => {
    syncSeoChangelogToCentralCrm({
      project_id: "cleaner",
      date: "2026-11-12",
      category: "technical_seo",
      title: "Resilience Test Unconfigured",
      description: "Testing unconfigured CRM URL",
      impact: "Zero impact",
    });
  });

  if (origUrl) process.env.SWEEPR_CRM_URL = origUrl;
});

test("3.2 syncSeoChangelogToCentralCrm handles offline CRM (ECONNREFUSED) without crashing or hanging", async () => {
  // Point to a guaranteed dead local port
  const DEAD_PORT = 58941;
  process.env.SWEEPR_CRM_URL = `http://127.0.0.1:${DEAD_PORT}`;

  // Warm up undici fetch dispatcher to avoid Windows cold-start socket-pool jitter (<150ms on cold run)
  await fetch(`http://127.0.0.1:${DEAD_PORT}`).catch(() => {});

  const start = Date.now();
  assert.doesNotThrow(() => {
    syncSeoChangelogToCentralCrm({
      project_id: "cleaner",
      date: "2026-11-12",
      category: "technical_seo",
      title: "Resilience Test Offline Server",
      description: "Testing connection refused error handling",
      impact: "Zero impact",
    });
  });
  const elapsed = Date.now() - start;

  // Fire-and-forget: must return without waiting for network timeout (8000ms), well under 250ms
  assert.ok(elapsed < 250, `syncSeoChangelogToCentralCrm blocked for ${elapsed}ms instead of returning immediately`);

  // Wait a short tick to ensure background fetch promise rejection is caught and does not throw unhandledRejection
  await new Promise((r) => setTimeout(r, 100));
});

test("3.3 syncSeoChangelogToCentralCrm handles hanging/slow CRM without blocking the caller", async () => {
  // Spin up a slow mock server that never replies
  const server = http.createServer((_req, _res) => {
    // Deliberately hold connection open
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as any).port;
  process.env.SWEEPR_CRM_URL = `http://127.0.0.1:${port}`;

  try {
    const start = Date.now();
    assert.doesNotThrow(() => {
      syncSeoChangelogToCentralCrm({
        project_id: "cleaner",
        date: "2026-11-12",
        category: "technical_seo",
        title: "Resilience Test Hanging Server",
        description: "Testing hanging server timeout handling",
        impact: "Zero impact",
      });
    });
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 50, `syncSeoChangelogToCentralCrm blocked for ${elapsed}ms on hanging server`);
  } finally {
    server.close();
  }
});

test("3.4 syncSeoChangelogToCentralCrm handles HTTP 500 error from CRM without crashing", async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Internal Server Error" }));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as any).port;
  process.env.SWEEPR_CRM_URL = `http://127.0.0.1:${port}`;

  try {
    const start = Date.now();
    assert.doesNotThrow(() => {
      syncSeoChangelogToCentralCrm({
        project_id: "cleaner",
        date: "2026-11-12",
        category: "technical_seo",
        title: "Resilience Test 500 Error",
        description: "Testing HTTP 500 handling",
        impact: "Zero impact",
      });
    });
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 250, `syncSeoChangelogToCentralCrm blocked for ${elapsed}ms on 500 server`);
    await new Promise((r) => setTimeout(r, 100));
  } finally {
    server.close();
  }
});

// ---------------- 4. UI Integration in Both CRM HTML Files ----------------
test("4.1 Local CRM index.html contains SEO changelog subnav, table structure, and quick-add controls", () => {
  assert.ok(fs.existsSync(LOCAL_HTML_PATH), `Local HTML missing at ${LOCAL_HTML_PATH}`);
  const html = fs.readFileSync(LOCAL_HTML_PATH, "utf8");

  // Sub-tab button
  assert.ok(
    html.includes("seoShow('changelog')") || html.includes('data-seotab="changelog"') || html.includes("SEO Changelog"),
    "Local index.html missing SEO Changelog subnav button"
  );

  // Table headers
  assert.ok(html.includes("seoChangelog"), "Local index.html missing seoChangelog() function");
  assert.ok(html.includes("Project"), "Local index.html table missing Project column");
  assert.ok(html.includes("Category"), "Local index.html table missing Category column");
  assert.ok(html.includes("Impact"), "Local index.html table missing Impact column");

  // Project badges
  for (const proj of EXPECTED_PROJECTS) {
    assert.ok(
      html.toLowerCase().includes(proj),
      `Local index.html missing project reference for '${proj}'`
    );
  }

  // Quick-add controls
  assert.ok(
    html.includes("Log SEO Change") || html.includes("changelog-submit") || html.includes("changelog-toggle-form"),
    "Local index.html missing quick-add controls or form toggles"
  );
});

test("4.2 Central CRM index.html contains SEO changelog subnav, table structure, and quick-add controls", {
  skip: skipMissingCrossRepo(CENTRAL_HTML_PATH),
}, () => {
  assert.ok(fs.existsSync(CENTRAL_HTML_PATH), `Central HTML missing at ${CENTRAL_HTML_PATH}`);
  const html = fs.readFileSync(CENTRAL_HTML_PATH, "utf8");

  // Sub-tab button
  assert.ok(
    html.includes("seoShow('changelog')") || html.includes('data-seotab="changelog"') || html.includes("SEO Changelog"),
    "Central index.html missing SEO Changelog subnav button"
  );

  // Table headers
  assert.ok(html.includes("seoChangelog"), "Central index.html missing seoChangelog() function");
  assert.ok(html.includes("Project"), "Central index.html table missing Project column");
  assert.ok(html.includes("Category"), "Central index.html table missing Category column");
  assert.ok(html.includes("Impact"), "Central index.html table missing Impact column");

  // Project badges
  for (const proj of EXPECTED_PROJECTS) {
    assert.ok(
      html.toLowerCase().includes(proj),
      `Central index.html missing project reference for '${proj}'`
    );
  }

  // Quick-add controls
  assert.ok(
    html.includes("Log SEO Change") || html.includes("changelog-submit") || html.includes("changelog-toggle-form"),
    "Central index.html missing quick-add controls or form toggles"
  );
});

test("4.3 JavaScript syntax in both index.html files is valid (no SyntaxErrors)", () => {
  // Extract script tags from both HTML files and verify parsing via vm.Script
  const htmlTargets: Array<[string, string]> = [["Local", LOCAL_HTML_PATH]];
  if (!skipMissingCrossRepo(CENTRAL_HTML_PATH)) {
    htmlTargets.push(["Central", CENTRAL_HTML_PATH]);
  }
  for (const [name, filePath] of htmlTargets) {
    const html = fs.readFileSync(filePath, "utf8");
    const scriptRegex = /<script(?:\s+type="text\/javascript"|\s+defer|\s+async|\s*)*>([\s\S]*?)<\/script>/gi;
    let match: RegExpExecArray | null;
    let scriptCount = 0;
    while ((match = scriptRegex.exec(html)) !== null) {
      const scriptBody = match[1];
      if (!scriptBody.trim()) continue;
      scriptCount++;
      try {
        new vm.Script(scriptBody, { filename: `${name}_script_${scriptCount}.js` });
      } catch (err: any) {
        assert.fail(`Syntax error in ${name} index.html script block ${scriptCount}: ${err.message}`);
      }
    }
    assert.ok(scriptCount > 0, `No inline scripts found in ${name} index.html`);
  }
});
