import { openDb } from "../src/db.js";
import { createApp } from "../src/app.js";
import { SeoStore } from "../src/seo/store.js";
import { runSiteAudit, AUDIT_USER_AGENT } from "../src/seo/audit.js";
import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

async function main() {
  const { privateKey } = generateKeyPairSync("ed25519");
  const repo = openDb(":memory:");
  const app = createApp({
    repo,
    signingKey: privateKey,
    stripe: null,
    config: {
      publicUrl: "https://sweeprcleaner.com",
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
      crmAdminPassword: "password",
    },
  });

  const store = new SeoStore(repo.db);
  console.log("Starting in-process Technical SEO Audit...");
  const t0 = Date.now();
  const result = await runSiteAudit(store, {
    siteUrl: "https://sweeprcleaner.com",
    baseLabel: "in-process",
    source: "local",
    concurrency: 4,
    maxPages: 1200,
    fetcher: async (path) => app.request(path, { headers: { "user-agent": AUDIT_USER_AGENT } }),
  });
  const elapsed = Date.now() - t0;
  console.log(`Audit completed in ${elapsed}ms:`, JSON.stringify(result, null, 2));

  const run = store.latestAuditRun();
  console.log("Run Record:", JSON.stringify(run, null, 2));

  const pages = store.pageAudits(run!.id);
  const issuesSummary: Record<string, number> = {};
  const pagesWithIssues: Array<{ path: string; status: number; score: number; issues: any[] }> = [];

  for (const p of pages) {
    const issues = JSON.parse(p.issues_json || "[]");
    if (issues && issues.length > 0) {
      pagesWithIssues.push({
        path: p.path,
        status: p.http_status,
        score: p.score,
        issues: issues,
      });
      for (const iss of issues) {
        issuesSummary[iss.code] = (issuesSummary[iss.code] || 0) + 1;
      }
    }
  }

  console.log("\n=== ISSUE CODE BREAKDOWN ===");
  for (const [code, count] of Object.entries(issuesSummary).sort((a, b) => b[1] - a[1])) {
    console.log(`- ${code}: ${count}`);
  }

  console.log(`\nTotal Pages Audited: ${pages.length}`);
  console.log(`Pages with Issues: ${pagesWithIssues.length}`);
  console.log("\n=== DETAILED FINDINGS (First 15 pages with issues) ===");
  for (const p of pagesWithIssues.slice(0, 15)) {
    console.log(`\nPage: ${p.path} (HTTP ${p.status}, Score: ${p.score})`);
    for (const i of p.issues) {
      console.log(`  [${i.severity.toUpperCase()}] ${i.code}: ${i.finding}`);
      console.log(`    Evidence: ${i.evidence}`);
      console.log(`    Fix: ${i.fix}`);
    }
  }

  // Dump full report to json
  fs.writeFileSync(
    path.join(process.cwd(), "audit-findings.json"),
    JSON.stringify({ result, run, issuesSummary, pagesWithIssues }, null, 2),
    "utf8"
  );
  console.log("\nWrote full audit findings to audit-findings.json");
}

main().catch(console.error);
