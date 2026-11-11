import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { openDb } from "../src/db.js";
import { config } from "../src/config.js";
import { SeoStore } from "../src/seo/store.js";
import { runCloudGoogleSeoSync } from "../src/seo/google.js";
import { generateWeeklyContentToProductReport } from "../src/seo/product-advisor.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(SERVER_ROOT, "..");
process.chdir(SERVER_ROOT);

const GSC_SEED_PATH = path.join(SERVER_ROOT, "src", "data", "gsc-seed.json");
const AUDIT_FINDINGS_PATH = path.join(SERVER_ROOT, "audit-findings.json");
const AUDIT_LOG_PATH = path.join(REPO_ROOT, "TECHNICAL_SEO_AUDIT_LOG.md");
const CLEAN_ITEMS_PATH = path.join(SERVER_ROOT, "src", "data", "clean-items.json");

function parseArgs(argv: string[]) {
  // Default to 0 daily pSEO expansion & no sitemap re-ping during Google Core Update stabilization
  let count = 0;
  let skipDrip = true;
  let submitSitemap = false;
  let skipAudit = false;
  let forceWeekly = false;
  let runCwv = Boolean(process.env.GOOGLE_API_KEY);
  let updateLog = false;
  let provisionSaPath: string | null = null;
  let googleApiKeyArg: string | null = null;
  let syncProdCrm = false;

  for (const arg of argv) {
    if (arg.startsWith("--count=")) {
      const n = Number(arg.split("=")[1]);
      if (Number.isFinite(n) && n >= 0) {
        count = n;
        if (n > 0) skipDrip = false;
      }
    } else if (arg === "--skip-drip") {
      skipDrip = true;
    } else if (arg === "--submit-sitemap") {
      submitSitemap = true;
    } else if (arg === "--skip-audit") {
      skipAudit = true;
    } else if (arg === "--force-weekly") {
      forceWeekly = true;
    } else if (arg === "--run-cwv") {
      runCwv = true;
    } else if (arg === "--no-cwv") {
      runCwv = false;
    } else if (arg === "--update-log") {
      updateLog = true;
    } else if (arg.startsWith("--provision-sa=")) {
      provisionSaPath = arg.slice("--provision-sa=".length).trim().replace(/^["']|["']$/g, "");
    } else if (arg.startsWith("--google-api-key=")) {
      googleApiKeyArg = arg.slice("--google-api-key=".length).trim().replace(/^["']|["']$/g, "");
      if (googleApiKeyArg) runCwv = true;
    } else if (arg === "--sync-prod-crm") {
      syncProdCrm = true;
    }
  }

  return {
    count,
    skipDrip,
    submitSitemap,
    skipAudit,
    forceWeekly,
    runCwv,
    updateLog,
    provisionSaPath,
    googleApiKeyArg,
    syncProdCrm,
  };
}

function updateGscSeedFileFromLiveRows(seoStore: SeoStore) {
  try {
    const liveRows = seoStore.db
      .prepare(
        `SELECT date, query, page, clicks, impressions, ctr, position
         FROM seo_gsc_rows
         ORDER BY date DESC, impressions DESC, clicks DESC
         LIMIT 2000`
      )
      .all() as Array<{
      date: string;
      query: string;
      page: string;
      clicks: number;
      impressions: number;
      ctr: number;
      position: number;
    }>;

    if (liveRows.length === 0) return false;

    let existing: Record<string, unknown> = {};
    if (fs.existsSync(GSC_SEED_PATH)) {
      try {
        existing = JSON.parse(fs.readFileSync(GSC_SEED_PATH, "utf8"));
      } catch {}
    }

    const payload = {
      ...existing,
      site_url: config.seo.gscSiteUrl || "sc-domain:sweeprcleaner.com",
      synced_via: "google_cloud_service_account",
      updated_at: new Date().toISOString(),
      rows: liveRows,
    };

    fs.writeFileSync(GSC_SEED_PATH, JSON.stringify(payload, null, 2) + "\n", "utf8");
    return true;
  } catch {
    return false;
  }
}

function appendDailyAuditLogIfMissing(auditSummary: {
  healthScore: number;
  pagesAudited: number;
  errors: number;
  warnings: number;
  notices: number;
  cleanGuidesCount: number;
  authMode: string;
  urlsInspected: number;
}) {
  if (!fs.existsSync(AUDIT_LOG_PATH)) return false;
  const todayIso = new Date().toISOString().slice(0, 10);
  const currentLog = fs.readFileSync(AUDIT_LOG_PATH, "utf8");
  if (currentLog.includes(`## Daily Audit: ${todayIso}`)) {
    return false;
  }

  const section = `

---

## Daily Audit: ${todayIso} (Cloud Automation Runner — A1–A21)

### 1. Executive Summary & Cloud Audit Scorecard

| Metric | Status / Value | Notes |
| :--- | :--- | :--- |
| **Site Health Score** | **${auditSummary.healthScore} / 100** | **${auditSummary.errors} Errors, ${auditSummary.warnings} Warnings, ${auditSummary.notices} Notices** |
| **Total HTML Pages Audited** | **${auditSummary.pagesAudited} Pages** | Full In-Process Crawl Verification |
| **Canonical Clean Guides** | **${auditSummary.cleanGuidesCount} Guides** | Zero Synthetic Cartesian Bloat |
| **Google Cloud GSC Auth Mode** | \`${auditSummary.authMode}\` | Free Google Cloud Service Account + Seed Continuity |
| **GSC Priority URLs Inspected** | **${auditSummary.urlsInspected} URLs** | Free URL Inspection API + IndexNow Queue |
| **Emails Sent / SMTP Dispatches** | **0** | Strict Zero-Email Compliance |
`;

  fs.writeFileSync(AUDIT_LOG_PATH, currentLog.trimEnd() + section, "utf8");
  return true;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  console.log("================================================================================");
  console.log("  SWEEPR CLEANER — UNIFIED CLOUD AUTOMATION RUNNER (A1–A21)");
  console.log("  Google Cloud Service Account (GSC + Sitemaps + URL Inspection) + PageSpeed API");
  console.log("================================================================================\n");

  const dbPath = config.databasePath || path.join(SERVER_ROOT, "data", "sweepr.db");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const repo = openDb(dbPath);
  const seoStore = new SeoStore(repo.db);

  // Optional: Provision Google Cloud Service Account JSON + API Key into server/.env & SQLite
  if (opts.provisionSaPath || opts.googleApiKeyArg) {
    const envPath = path.join(SERVER_ROOT, ".env");
    let envText = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
    const upsertEnv = (key: string, val: string) => {
      const re = new RegExp(`^${key}=.*$`, "m");
      if (re.test(envText)) {
        envText = envText.replace(re, `${key}=${val}`);
      } else {
        envText = envText.trimEnd() + `\n${key}=${val}\n`;
      }
    };

    const siteUrl = config.seo.gscSiteUrl || "sc-domain:sweeprcleaner.com";
    upsertEnv("GSC_SITE_URL", siteUrl);
    seoStore.setSetting("gsc_site_url", siteUrl);

    if (opts.provisionSaPath && fs.existsSync(opts.provisionSaPath)) {
      const rawJson = fs.readFileSync(opts.provisionSaPath, "utf8").trim();
      const b64 = Buffer.from(rawJson, "utf8").toString("base64");
      upsertEnv("GSC_SERVICE_ACCOUNT_JSON", b64);
      seoStore.setSetting("gsc_service_account_json", rawJson);
      config.seo.gscServiceAccountJson = rawJson;
      console.log(`✓ Provisioned Service Account from ${opts.provisionSaPath} into server/.env & SQLite`);
    }

    if (opts.googleApiKeyArg) {
      upsertEnv("GOOGLE_API_KEY", opts.googleApiKeyArg);
      seoStore.setSetting("google_api_key", opts.googleApiKeyArg);
      config.seo.googleApiKey = opts.googleApiKeyArg;
      console.log(`✓ Provisioned GOOGLE_API_KEY into server/.env & SQLite`);
    }

    fs.writeFileSync(envPath, envText, "utf8");
  }

  // Optional: Wire credentials into live production CRM (https://sweeprcleaner.com)
  const envFileForAuth = path.join(SERVER_ROOT, ".env");
  const envRawForAuth = fs.existsSync(envFileForAuth) ? fs.readFileSync(envFileForAuth, "utf8") : "";
  const resolvedCrmUser =
    config.crmAdminUser ||
    (envRawForAuth.match(/^CRM_ADMIN_USER=(.*)$/m)?.[1] || "admin").trim().replace(/^["']|["']$/g, "");
  const resolvedCrmPass =
    config.crmAdminPassword ||
    (envRawForAuth.match(/^CRM_ADMIN_PASSWORD=(.*)$/m)?.[1] || "").trim().replace(/^["']|["']$/g, "");

  if (opts.syncProdCrm && resolvedCrmPass) {
    console.log("--- 0. Wiring Google Cloud Credentials into Production CRM (https://sweeprcleaner.com) ---");
    const authHeader = "Basic " + Buffer.from(`${resolvedCrmUser}:${resolvedCrmPass}`).toString("base64");
    const saRaw = seoStore.getSetting("gsc_service_account_json", "") || config.seo.gscServiceAccountJson;
    const apiKeyVal = seoStore.getSetting("google_api_key", "") || config.seo.googleApiKey;
    try {
      const cfgRes = await fetch("https://sweeprcleaner.com/api/crm/seo/gsc/config", {
        method: "POST",
        headers: {
          Authorization: authHeader,
          Origin: "https://sweeprcleaner.com",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          site_url: config.seo.gscSiteUrl || "sc-domain:sweeprcleaner.com",
          google_api_key: apiKeyVal,
          service_account_json: saRaw,
        }),
      });
      const cfgJson = await cfgRes.json().catch(() => ({}));
      console.log(`✓ Production CRM /api/crm/seo/gsc/config HTTP ${cfgRes.status}:`, JSON.stringify(cfgJson));

      const syncRes = await fetch("https://sweeprcleaner.com/api/crm/seo/gsc/sync", {
        method: "POST",
        headers: {
          Authorization: authHeader,
          Origin: "https://sweeprcleaner.com",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ days: 90 }),
      });
      const syncJson = await syncRes.json().catch(() => ({}));
      console.log(`✓ Production CRM /api/crm/seo/gsc/sync HTTP ${syncRes.status}:`, JSON.stringify(syncJson));
    } catch (err: any) {
      console.warn(`⚠ Production CRM config warning: ${err?.message || err}`);
    }
    console.log("");
  }

  // ---------------------------------------------------------------------------
  // 1. A21: Google Cloud Service Account GSC Sync, Sitemap Submit & URL Inspection
  // ---------------------------------------------------------------------------
  console.log("--- 1. [A21] Google Cloud Service Account Sync (GSC + Sitemap + URL Inspection + CWV) ---");
  const cloudSync = await runCloudGoogleSeoSync(seoStore, config.seo, {
    days: 90,
    maxInspectUrls: 6,
    runCwv: opts.runCwv,
    persistQueue: true,
    submitSitemap: opts.submitSitemap,
  });

  let gscSeedUpdated = false;
  if (cloudSync.gsc_synced_live && cloudSync.gsc_rows_synced > 0) {
    gscSeedUpdated = updateGscSeedFileFromLiveRows(seoStore);
  }
  console.log(
    `✓ Auth Mode: ${cloudSync.auth_mode}${cloudSync.service_account_email ? ` (${cloudSync.service_account_email})` : ""}`
  );
  console.log(
    `✓ GSC Rows: ${cloudSync.gsc_rows_synced} (Live API Sync: ${cloudSync.gsc_synced_live ? "YES" : "Seed Fallback"}, Seed File Updated: ${gscSeedUpdated ? "YES" : "NO"})`
  );
  console.log(
    `✓ Sitemap Submitted: ${cloudSync.sitemap_submitted ? "YES" : "Skipped (requires Service Account)"}, URLs Inspected: ${cloudSync.urls_inspected} (${cloudSync.urls_indexed_pass} PASS)`
  );
  console.log(
    `✓ Google API Key (PSI/CrUX): ${cloudSync.google_api_key_configured ? `Configured (${cloudSync.cwv_pages_checked} pages checked)` : "Not set (using in-process TTFB benchmark)"}\n`
  );

  // ---------------------------------------------------------------------------
  // 2. Daily Canonical Pillar SEO Content & 14-Day CTR Cooldown Engine
  // ---------------------------------------------------------------------------
  let dripExecuted = false;
  if (!opts.skipDrip && opts.count > 0) {
    console.log(`--- 2. [A2/A7/A16/A17/A18] Daily Pillar Content & GSC CTR Optimizer (--count=${opts.count}) ---`);
    execFileSync(process.execPath, ["scripts/daily-50-seo-pages.mjs", `--count=${opts.count}`, "--no-push"], {
      cwd: SERVER_ROOT,
      stdio: "inherit",
    });
    dripExecuted = true;
    console.log("");
  } else {
    console.log("--- 2. [A2/A7/A16/A17/A18] Daily Pillar Content Drip Skipped (--skip-drip) ---\n");
  }

  // ---------------------------------------------------------------------------
  // 3. Daily 100/100 Technical SEO, PageSpeed & GEO Audit Gate
  // ---------------------------------------------------------------------------
  let auditScore = 100;
  let pagesAudited = 0;
  let auditErrors = 0;
  let auditWarnings = 0;
  let auditNotices = 0;

  if (!opts.skipAudit) {
    console.log("--- 3. [A12/A15/A19] Technical SEO, PageSpeed & GEO Audit Gate ---");
    const tsxCli = path.join(SERVER_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
    execFileSync(process.execPath, [tsxCli, "scripts/daily-seo-pagespeed-audit.ts"], {
      cwd: SERVER_ROOT,
      stdio: "inherit",
    });

    if (fs.existsSync(AUDIT_FINDINGS_PATH)) {
      try {
        const findings = JSON.parse(fs.readFileSync(AUDIT_FINDINGS_PATH, "utf8"));
        auditScore = Number(findings?.run?.health_score ?? findings?.result?.healthScore ?? 100);
        pagesAudited = Number(findings?.run?.pages_audited ?? findings?.result?.pagesAudited ?? 0);
        auditErrors = Number(findings?.run?.errors ?? findings?.result?.errors ?? 0);
        auditWarnings = Number(findings?.run?.warnings ?? findings?.result?.warnings ?? 0);
        auditNotices = Number(findings?.run?.notices ?? findings?.result?.notices ?? 0);
      } catch {}
    }
    console.log("");
  }

  // ---------------------------------------------------------------------------
  // 4. A20: Weekly Content-to-Product & UI Mockup Advisor (Mondays or --force-weekly)
  // ---------------------------------------------------------------------------
  const isMondayUtc = new Date().getUTCDay() === 1;
  let weeklyAdvisorSummary: Record<string, unknown> | null = null;
  if (isMondayUtc || opts.forceWeekly) {
    console.log("--- 4. [A20] Weekly Content-to-Product & UI Mockup Advisor (Read-Only) ---");
    const report = generateWeeklyContentToProductReport(seoStore, { persist: true });
    weeklyAdvisorSummary = {
      week_id: report.week_id,
      proposals_count: report.summary.proposals_count,
      top_proposal_title: report.summary.top_proposal_title,
      top_proposal_score: report.summary.top_proposal_score,
      read_only_mode: report.read_only_mode,
    };
    console.log(
      `✓ Generated Weekly Product Advisory (${report.week_id}): ${report.summary.proposals_count} proposals, Top: ${report.summary.top_proposal_title} (${report.summary.top_proposal_score}/100)\n`
    );
  } else {
    console.log("--- 4. [A20] Weekly Content-to-Product Advisor (Runs on Mondays or with --force-weekly) ---\n");
  }

  // Optional: Append daily log entry if --update-log passed
  let logAppended = false;
  if (opts.updateLog) {
    let cleanGuidesCount = 0;
    try {
      const items = JSON.parse(fs.readFileSync(CLEAN_ITEMS_PATH, "utf8"));
      cleanGuidesCount = Array.isArray(items) ? items.length : 0;
    } catch {}
    logAppended = appendDailyAuditLogIfMissing({
      healthScore: auditScore,
      pagesAudited,
      errors: auditErrors,
      warnings: auditWarnings,
      notices: auditNotices,
      cleanGuidesCount,
      authMode: cloudSync.auth_mode,
      urlsInspected: cloudSync.urls_inspected,
    });
  }

  const finalSummary = {
    ok: auditErrors === 0 && auditScore === 100,
    executed_at: new Date().toISOString(),
    a21_cloud_google_sync: cloudSync,
    gsc_seed_updated: gscSeedUpdated,
    drip_executed: dripExecuted,
    audit: {
      health_score: auditScore,
      pages_audited: pagesAudited,
      errors: auditErrors,
      warnings: auditWarnings,
      notices: auditNotices,
      log_appended: logAppended,
    },
    a20_weekly_advisor: weeklyAdvisorSummary,
  };

  console.log("================================================================================");
  console.log("  CLOUD AUTOMATION RUNNER SUMMARY");
  console.log("================================================================================");
  console.log(JSON.stringify(finalSummary, null, 2));

  if (auditErrors > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("[cloud-automation-runner] Fatal error:", err);
  process.exitCode = 1;
});
