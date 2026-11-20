#!/usr/bin/env node
/**
 * CI Technical SEO, Template & Mobile Lighthouse CWV Gate
 *
 * Boots an ephemeral in-process Sweepr server on 127.0.0.1:0, verifies zero SEO audit
 * errors, <=60-char titles, <main> landmarks, and async Google Fonts loading, and
 * optionally runs headless Mobile Lighthouse on 4 key templates (--lighthouse).
 */
import { execFile } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
import { serve } from "@hono/node-server";
import { createApp } from "../src/app.js";
import { openDb } from "../src/db.js";
import { AUDIT_USER_AGENT, runSiteAudit } from "../src/seo/audit.js";
import { parseHtml } from "../src/seo/html.js";
import { SeoStore } from "../src/seo/store.js";
import { TRANSACTIONAL_TOOLS } from "../src/transactional-tools.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, "..");
process.chdir(SERVER_ROOT);

const RUN_LIGHTHOUSE = process.argv.includes("--lighthouse");
const LANDMARK_ROUTES = [
  "/",
  "/pricing",
  "/tools",
  "/clean",
  "/alternatives/ccleaner",
  "/vs/ccleaner",
  "/clean/folder/windows-old",
];
const ASYNC_FONT_ROUTES = ["/", "/pricing"];
const LIGHTHOUSE_ROUTES = [
  "/",
  "/clean/folder/windows-old",
  "/alternatives/ccleaner",
  "/tools",
];

function findBlockingGoogleFontsLinks(html: string): string[] {
  const withoutNoscript = html.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, "");
  const matches = withoutNoscript.match(/<link\b[^>]*>/gi) ?? [];
  const blocking: string[] = [];
  for (const tag of matches) {
    if (!/fonts\.googleapis\.com\/css2/i.test(tag)) continue;
    if (!/rel=["'][^"']*stylesheet[^"']*["']/i.test(tag)) continue;
    if (!/media=["']print["']/i.test(tag)) {
      blocking.push(tag);
    }
  }
  return blocking;
}

function resolveLighthouseRunner(): { cmd: string; prefixArgs: string[]; shell: boolean } {
  const pathEnv = process.env.PATH || "";
  const binNames = process.platform === "win32" ? ["lighthouse.cmd", "lighthouse"] : ["lighthouse"];
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    for (const name of binNames) {
      if (fs.existsSync(path.join(dir, name))) {
        return { cmd: path.join(dir, name), prefixArgs: [], shell: process.platform === "win32" };
      }
    }
  }
  return {
    cmd: process.platform === "win32" ? "npx.cmd" : "npx",
    prefixArgs: ["--yes", "lighthouse@12"],
    shell: process.platform === "win32",
  };
}

function appendSummary(markdown: string): void {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  try {
    fs.appendFileSync(summaryPath, markdown + "\n", "utf8");
  } catch {}
}

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
      crmAdminPassword: "ci-gate-password",
    },
  });

  const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" });
  const failures: string[] = [];

  try {
    await new Promise<void>((resolve) => {
      if (server.listening) return resolve();
      server.once("listening", () => resolve());
    });
    const addr = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${addr.port}`;
    console.log(`[ci-seo-cwv-gate] Ephemeral server listening at ${baseUrl}`);

    // 1. Deterministic Crawl & Audit Gate
    const store = new SeoStore(repo.db);
    const seedPaths = [
      "/",
      "/pricing",
      "/tools",
      "/clean",
      "/safe-to-delete",
      "/bloat-watch",
      "/state-of-windows-storage",
      "/alternatives/ccleaner",
      "/vs/ccleaner",
      "/clean/folder/windows-old",
      ...TRANSACTIONAL_TOOLS.map((t) => `/tools/${t.slug}`),
    ];

    const auditRes = await runSiteAudit(store, {
      siteUrl: "https://sweeprcleaner.com",
      baseLabel: "ci-gate",
      source: "local",
      concurrency: 4,
      maxPages: 500,
      seedPaths,
      fetcher: async (p) => app.request(p, { headers: { "user-agent": AUDIT_USER_AGENT } }),
    });

    const run = store.latestAuditRun();
    const auditedPages = run ? store.pageAudits(run.id) : [];
    const issueCounts: Record<string, number> = {};
    for (const p of auditedPages) {
      for (const iss of JSON.parse(p.issues_json || "[]") as Array<{ code: string }>) {
        issueCounts[iss.code] = (issueCounts[iss.code] || 0) + 1;
      }
    }

    const titleLongCount = issueCounts.title_long || 0;
    const notInSitemapCount = issueCounts.not_in_sitemap || 0;
    console.log(
      `[1/4] Audit Gate: health=${auditRes.health_score}/100, pages=${auditedPages.length}, errors=${auditRes.errors}, title_long=${titleLongCount}, not_in_sitemap=${notInSitemapCount}`
    );
    if (auditRes.errors > 0) failures.push(`Site audit reported ${auditRes.errors} errors`);
    if (titleLongCount > 0) failures.push(`Site audit found ${titleLongCount} over-length titles`);
    if (notInSitemapCount > 0) failures.push(`Site audit found ${notInSitemapCount} indexable pages missing from sitemap`);

    // 2. Landmark & Async Font Gate
    for (const route of LANDMARK_ROUTES) {
      const res = await app.request(route);
      if (res.status !== 200) {
        failures.push(`Route ${route} returned HTTP ${res.status} (expected 200)`);
        continue;
      }
      const html = await res.text();
      if (!/<main(?:\s|>)/i.test(html)) {
        failures.push(`Route ${route} is missing a <main> landmark`);
      }
      if (ASYNC_FONT_ROUTES.includes(route)) {
        const blockingFonts = findBlockingGoogleFontsLinks(html);
        if (blockingFonts.length > 0) {
          failures.push(`Route ${route} has render-blocking Google Fonts stylesheet(s): ${blockingFonts.join(", ")}`);
        }
      }
    }
    console.log(`[2/4] Landmark & Async Font Gate: checked ${LANDMARK_ROUTES.length} routes`);

    // 3. Static Switcher & Comparison HTML Gate
    let switcherChecked = 0;
    for (const subDir of ["vs", "alternatives"]) {
      const absDir = path.join(SERVER_ROOT, "public", subDir);
      if (!fs.existsSync(absDir)) continue;
      for (const fileName of fs.readdirSync(absDir)) {
        if (!fileName.endsWith(".html")) continue;
        switcherChecked++;
        const html = fs.readFileSync(path.join(absDir, fileName), "utf8");
        const decodedTitle = (parseHtml(html).title || "").trim();
        if (decodedTitle.length === 0 || decodedTitle.length > 60) {
          failures.push(`/${subDir}/${fileName} decoded title length is ${decodedTitle.length} (expected 1-60)`);
        }
        if (!/<main(?:\s|>)/i.test(html)) {
          failures.push(`/${subDir}/${fileName} is missing a <main> landmark`);
        }
      }
    }
    console.log(`[3/4] Comparison/Switcher HTML Gate: checked ${switcherChecked} files`);

    // 4. Headless Mobile Lighthouse Gate
    const lhRows: Array<{ route: string; cls: number; perf: number; a11y: number; bp: number; seo: number; ok: boolean }> = [];
    if (RUN_LIGHTHOUSE) {
      const runner = resolveLighthouseRunner();
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sweepr-lh-"));
      try {
        for (const route of LIGHTHOUSE_ROUTES) {
          const outFile = path.join(tmpDir, `${route.replace(/[^a-z0-9]+/gi, "_") || "home"}.json`);
          const targetUrl = `${baseUrl}${route}`;
          const { stdout, stderr } = await execFileAsync(
            runner.cmd,
            [
              ...runner.prefixArgs,
              targetUrl,
              "--output=json",
              `--output-path=${outFile}`,
              "--quiet",
              "--only-categories=performance,accessibility,best-practices,seo",
              "--chrome-flags=--headless=new --no-sandbox --disable-dev-shm-usage --disable-gpu",
            ],
            { shell: runner.shell, timeout: 120_000, maxBuffer: 10 * 1024 * 1024 }
          );
          if (stdout) process.stdout.write(stdout);
          if (stderr) process.stderr.write(stderr);
          const lhr = JSON.parse(fs.readFileSync(outFile, "utf8")) as any;
          const cats = lhr.categories || {};
          const perf = Math.round((cats.performance?.score ?? 0) * 100);
          const a11y = Math.round((cats.accessibility?.score ?? 0) * 100);
          const bp = Math.round((cats["best-practices"]?.score ?? 0) * 100);
          const seo = Math.round((cats.seo?.score ?? 0) * 100);
          const cls = Number(lhr.audits?.["cumulative-layout-shift"]?.numericValue ?? 1);
          const routeFailures: string[] = [];
          if (cls > 0.05) routeFailures.push(`CLS ${cls.toFixed(3)} > 0.05`);
          if (a11y < 95) routeFailures.push(`Accessibility ${a11y} < 95`);
          if (seo < 95) routeFailures.push(`SEO ${seo} < 95`);
          if (bp < 90) routeFailures.push(`Best Practices ${bp} < 90`);
          for (const rf of routeFailures) {
            failures.push(`Mobile Lighthouse ${route}: ${rf}`);
          }
          lhRows.push({ route, cls, perf, a11y, bp, seo, ok: routeFailures.length === 0 });
          console.log(
            `[4/4] Lighthouse ${route}: Perf=${perf} A11y=${a11y} BP=${bp} SEO=${seo} CLS=${cls.toFixed(3)} ${routeFailures.length === 0 ? "PASS" : "FAIL"}`
          );
        }
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    } else {
      console.log("[4/4] Mobile Lighthouse skipped (pass --lighthouse to run headless Chromium checks)");
    }

    const summaryLines = [
      "## SEO & Mobile Lighthouse CWV Gate",
      `- Site Audit: **${auditRes.health_score}/100** (${auditedPages.length} pages, ${auditRes.errors} errors, \`title_long\`: ${titleLongCount}, \`not_in_sitemap\`: ${notInSitemapCount})`,
      `- Landmark & Async Font Check: ${LANDMARK_ROUTES.length} routes checked`,
      `- Comparison/Switcher HTML Check: ${switcherChecked} files checked`,
    ];
    if (lhRows.length > 0) {
      summaryLines.push(
        "",
        "| Route | Perf | A11y | Best Practices | SEO | CLS | Status |",
        "| :--- | ---: | ---: | ---: | ---: | ---: | :---: |",
        ...lhRows.map(
          (r) => `| \`${r.route}\` | ${r.perf} | ${r.a11y} | ${r.bp} | ${r.seo} | ${r.cls.toFixed(3)} | ${r.ok ? "PASS" : "FAIL"} |`
        )
      );
    }
    if (failures.length > 0) {
      summaryLines.push("", "### Failures", ...failures.map((f) => `- ${f}`));
    }
    appendSummary(summaryLines.join("\n"));

    if (failures.length > 0) {
      console.error("\nSEO/CWV Gate FAILED:\n" + failures.map((f) => `  - ${f}`).join("\n"));
      process.exitCode = 1;
    } else {
      console.log("\nSEO/CWV Gate PASSED cleanly.");
    }
  } finally {
    (server as any).closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    repo.db.close();
  }
}

main().catch((err) => {
  console.error("[ci-seo-cwv-gate] Fatal error:", err);
  process.exit(1);
});
