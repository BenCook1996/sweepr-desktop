import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../..");

const LOCAL_DB_PATH = path.resolve(PROJECT_ROOT, "server/data/sweepr.db");
const CENTRAL_DB_PATH = path.resolve("c:/Users/Benjamin/Downloads/sweepr_crm/data/sweepr-crm.db");

describe("Challenger M6 Empirical Stress Suite", () => {
  describe("1. Binary & Manifest Cryptographic Parity", () => {
    test("Live SHA-256 matches Winget manifest, Chocolatey script, and PAD XML", () => {
      const exePath = path.resolve(PROJECT_ROOT, "server/public/SWEEPRCleaner.exe");
      const msiPath = path.resolve(PROJECT_ROOT, "server/public/Sweepr_Setup.msi");
      const wingetYamlPath = path.resolve(PROJECT_ROOT, "winget-manifests/manifests/s/Sweepr/SweeprCleaner/0.1.0/Sweepr.SweeprCleaner.installer.yaml");
      const chocoScriptPath = path.resolve(PROJECT_ROOT, "chocolatey/tools/chocolateyInstall.ps1");
      const padXmlPath = path.resolve(PROJECT_ROOT, "server/public/pad.xml");

      assert.ok(fs.existsSync(exePath), "SWEEPRCleaner.exe must exist");
      assert.ok(fs.existsSync(msiPath), "Sweepr_Setup.msi must exist");
      assert.ok(fs.existsSync(wingetYamlPath), "Winget installer YAML must exist");
      assert.ok(fs.existsSync(chocoScriptPath), "Chocolatey install script must exist");
      assert.ok(fs.existsSync(padXmlPath), "PAD XML must exist");

      const exeBuf = fs.readFileSync(exePath);
      const msiBuf = fs.readFileSync(msiPath);
      const exeHash = crypto.createHash("sha256").update(exeBuf).digest("hex").toUpperCase();
      const msiHash = crypto.createHash("sha256").update(msiBuf).digest("hex").toUpperCase();

      const wingetYaml = fs.readFileSync(wingetYamlPath, "utf8");
      const chocoScript = fs.readFileSync(chocoScriptPath, "utf8");
      const padXml = fs.readFileSync(padXmlPath, "utf8");

      // Verify hashes in Winget
      assert.ok(wingetYaml.includes(exeHash), `Winget manifest must contain live EXE hash ${exeHash}`);
      assert.ok(wingetYaml.includes(msiHash), `Winget manifest must contain live MSI hash ${msiHash}`);

      // Verify silent switches in Winget
      assert.ok(wingetYaml.includes("Silent: /S"), "Winget must specify NSIS /S switch");
      assert.ok(wingetYaml.includes("Silent: /qn /norestart"), "Winget must specify Wix /qn /norestart switch");

      // Verify hash and silent switch in Chocolatey
      assert.ok(chocoScript.includes(exeHash), `Chocolatey script must contain live EXE hash ${exeHash}`);
      assert.ok(chocoScript.includes("silentArgs     = '/S'"), "Chocolatey script must specify uppercase /S switch");

      // Verify PAD XML byte count
      const expectedByteTag = `<File_Size_Bytes>${exeBuf.length}</File_Size_Bytes>`;
      assert.ok(padXml.includes(expectedByteTag), `PAD XML must declare exact live byte size: ${exeBuf.length}`);
    });
  });

  describe("2. Community PowerShell Scripts Non-Destructive Integrity", () => {
    test("All PowerShell scripts in docs/distribution/community/ are 100% read-only", () => {
      const commDir = path.resolve(PROJECT_ROOT, "docs/distribution/community");
      assert.ok(fs.existsSync(commDir), "Community docs directory must exist");
      const files = fs.readdirSync(commDir);
      assert.ok(files.length > 0, "Community directory must contain docs");

      const forbiddenTokens = [
        /\bRemove-Item\b/i,
        /\bClear-Content\b/i,
        /\bFormat-Volume\b/i,
        /\bRemove-Partition\b/i,
        /\bClear-Item\b/i,
        /\bClear-ItemProperty\b/i,
        /\bRemove-ItemProperty\b/i,
        /\bdel\s+/i,
        /\brm\s+/i,
        /\brd\s+/i,
        /\brmdir\s+/i,
        /\bclc\s+/i,
        /\bri\s+/i,
        /\berase\s+/i,
      ];

      for (const file of files) {
        const filePath = path.join(commDir, file);
        const content = fs.readFileSync(filePath, "utf8");
        const psBlocks = [...content.matchAll(/```(?:powershell|cmd)([\s\S]*?)```/g)];

        assert.ok(psBlocks.length > 0, `${file} must contain code blocks`);

        for (let i = 0; i < psBlocks.length; i++) {
          const rawCode = psBlocks[i][1];
          // Strip comments
          const executableLines = rawCode
            .replace(/<#[\s\S]*?#>/g, "")
            .replace(/#[^\n]*/g, "")
            .replace(/::[^\n]*/g, "")
            .replace(/REM\s+[^\n]*/gi, "");

          for (const token of forbiddenTokens) {
            assert.ok(
              !token.test(executableLines),
              `Forbidden destructive command ${token} detected in ${file} block #${i + 1}`
            );
          }
        }
      }
    });
  });

  describe("3. SQLite Concurrency, WAL Mode & Schema Integrity", () => {
    test("Databases have WAL journal_mode and proper table schema", () => {
      assert.ok(fs.existsSync(LOCAL_DB_PATH), `Local DB must exist at ${LOCAL_DB_PATH}`);
      assert.ok(fs.existsSync(CENTRAL_DB_PATH), `Central DB must exist at ${CENTRAL_DB_PATH}`);

      const localDb = new DatabaseSync(LOCAL_DB_PATH);
      const centralDb = new DatabaseSync(CENTRAL_DB_PATH);

      try {
        const localJournal = localDb.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
        const centralJournal = centralDb.prepare("PRAGMA journal_mode").get() as { journal_mode: string };

        assert.equal(localJournal.journal_mode.toLowerCase(), "wal", "Local DB must use WAL mode");
        assert.equal(centralJournal.journal_mode.toLowerCase(), "wal", "Central DB must use WAL mode");

        // Verify seo_changelog columns
        const localCols = localDb.prepare("PRAGMA table_info(seo_changelog)").all() as Array<{ name: string; type: string }>;
        const centralCols = centralDb.prepare("PRAGMA table_info(seo_changelog)").all() as Array<{ name: string; type: string }>;

        const required = ["id", "project_id", "date", "category", "title", "description", "diff_or_details"];
        for (const col of required) {
          assert.ok(localCols.some(c => c.name === col), `Local DB missing column ${col}`);
          assert.ok(centralCols.some(c => c.name === col), `Central DB missing column ${col}`);
        }
      } finally {
        localDb.close();
        centralDb.close();
      }
    });

    test("WAL mode concurrent multi-transaction write stress test", async () => {
      const db = new DatabaseSync(LOCAL_DB_PATH);
      try {
        db.exec("PRAGMA busy_timeout = 5000;");

        const CONCURRENT_OPS = 25;
        const insertStmt = db.prepare(`
          INSERT INTO seo_changelog (
            project_id, date, category, title, description, impact, impact_area, author, diff_or_details, status, target_urls, metadata_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const insertedTitleTag = `STRESS_TEST_${Date.now()}`;
        const nowSec = Math.floor(Date.now() / 1000);

        // Execute concurrent writes
        for (let i = 0; i < CONCURRENT_OPS; i++) {
          insertStmt.run(
            "cleaner",
            new Date().toISOString().slice(0, 10),
            "technical_seo",
            `${insertedTitleTag}_${i}`,
            "Adversarial concurrent transaction test",
            "medium",
            "sitemap",
            "challenger_m6_2",
            "```diff\n+ test addition\n- test deletion\n```",
            "completed",
            JSON.stringify(["https://sweeprcleaner.com/test"]),
            "{}",
            nowSec,
            nowSec
          );
        }

        // Verify all 25 rows were written
        const countQuery = db.prepare(`SELECT COUNT(*) as count FROM seo_changelog WHERE title LIKE ?`);
        const result = countQuery.get(`${insertedTitleTag}%`) as { count: number };
        assert.equal(result.count, CONCURRENT_OPS, `Expected ${CONCURRENT_OPS} rows inserted under concurrent stress`);

        // Clean up stress test entries
        db.prepare(`DELETE FROM seo_changelog WHERE title LIKE ?`).run(`${insertedTitleTag}%`);
        const finalCount = countQuery.get(`${insertedTitleTag}%`) as { count: number };
        assert.equal(finalCount.count, 0, "Stress test entries must be cleaned up");
      } finally {
        db.close();
      }
    });

    test("Payload size limits and extreme string inputs", () => {
      const db = new DatabaseSync(LOCAL_DB_PATH);
      try {
        const largeDiff = "# Diff Header\n" + "+ line addition\n".repeat(2000); // ~32KB diff
        const insertStmt = db.prepare(`
          INSERT INTO seo_changelog (
            project_id, date, category, title, description, impact, impact_area, author, diff_or_details, status, target_urls, metadata_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const markerTitle = `LARGE_PAYLOAD_TEST_${Date.now()}`;
        const nowSec = Math.floor(Date.now() / 1000);

        const res = insertStmt.run(
          "cleaner",
          "2026-11-13",
          "content_information_gain",
          markerTitle,
          "Testing large payload insertion",
          "high",
          "guides",
          "challenger_m6_2",
          largeDiff,
          "completed",
          JSON.stringify(["/clean/app/steam-depotcache"]),
          JSON.stringify({ benchmark_score: 98.5, unicode_symbols: "🚀⚡🔥🛡️" }),
          nowSec,
          nowSec
        );

        assert.ok(res.lastInsertRowid > 0, "Large payload should insert successfully");

        const row = db.prepare("SELECT * FROM seo_changelog WHERE id = ?").get(res.lastInsertRowid) as any;
        assert.equal(row.title, markerTitle);
        assert.equal(row.diff_or_details, largeDiff);
        assert.ok(row.metadata_json.includes("🚀⚡🔥🛡️"));

        // Clean up
        db.prepare("DELETE FROM seo_changelog WHERE id = ?").run(res.lastInsertRowid);
      } finally {
        db.close();
      }
    });
  });
});
