#!/usr/bin/env node
/**
 * Wave 2 Weekly Distribution, Package-PR & Read-Only GEO/Community Citation Radar
 *
 * Pure read-only ($0.00 DataForSEO spend, zero automated forum/social posting):
 *  1. Checks Winget PR #480164 state/reviews & SHA-256 parity with release-manifest.json
 *  2. Checks Chocolatey OData & Scoop BenCook1996/scoop-sweepr manifest parity
 *  3. Gathers a 14-day digest of high-intent community discussions for human outreach
 *  4. Optionally logs a deduplicated changelog note in Central CRM if drift/reviews need attention
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const CENTRAL_CRM_URL = "https://sweepr-crm-production.up.railway.app";

const RADAR_TOPICS = [
  { query: "CCleaner alternative", guide: "https://sweeprcleaner.com/alternatives/ccleaner" },
  { query: "Windows.old", guide: "https://sweeprcleaner.com/clean/folder/windows-old" },
  { query: "NVIDIA DXCache", guide: "https://sweeprcleaner.com/clean/app/nvidia-dxcache" },
  { query: "SoftwareDistribution Download", guide: "https://sweeprcleaner.com/clean/folder/software-distribution-download" },
  { query: "clean Windows 11 disk space", guide: "https://sweeprcleaner.com/tools/pc-cache-calculator" },
];

function appendSummary(md) {
  const p = process.env.GITHUB_STEP_SUMMARY;
  if (!p) return;
  try {
    fs.appendFileSync(p, md + "\n", "utf8");
  } catch {}
}

function githubHeaders() {
  const h = {
    Accept: "application/vnd.github+json",
    "User-Agent": "Sweepr-Wave2-Authority-Radar",
  };
  const tok = (process.env.GITHUB_TOKEN || "").trim();
  if (tok) h.Authorization = `Bearer ${tok}`;
  return h;
}

async function fetchJsonSafe(url, opts = {}) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000), ...opts });
    if (!res.ok) return { ok: false, status: res.status, data: null };
    return { ok: true, status: res.status, data: await res.json() };
  } catch (err) {
    return { ok: false, status: 0, error: String(err?.message || err), data: null };
  }
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "server/public/release-manifest.json"), "utf8"));
  const expectedVer = String(manifest.version || "0.1.0");
  const expectedExeSha = String(manifest.exe?.sha256 || "").toUpperCase();
  const expectedMsiSha = String(manifest.msi?.sha256 || "").toUpperCase();
  const actionableIssues = [];

  // 1. Winget PR #480164 status + SHA-256 parity
  const wingetPrRes = await fetchJsonSafe("https://api.github.com/repos/microsoft/winget-pkgs/pulls/480164", {
    headers: githubHeaders(),
  });
  let wingetSummary = "Unavailable";
  if (wingetPrRes.ok && wingetPrRes.data) {
    const pr = wingetPrRes.data;
    let installerText = "";
    const filesRes = await fetchJsonSafe("https://api.github.com/repos/microsoft/winget-pkgs/pulls/480164/files", {
      headers: githubHeaders(),
    });
    if (filesRes.ok && Array.isArray(filesRes.data)) {
      for (const f of filesRes.data) {
        if (String(f.filename || "").endsWith(".installer.yaml")) {
          if (f.raw_url) {
            try {
              const rawRes = await fetch(f.raw_url, { headers: { "User-Agent": "Sweepr-Wave2-Authority-Radar" }, signal: AbortSignal.timeout(15_000) });
              if (rawRes.ok) installerText = await rawRes.text();
            } catch {}
          }
          if (!installerText && f.patch) installerText = f.patch;
        }
      }
    }
    const exeMatch = expectedExeSha ? installerText.toUpperCase().includes(expectedExeSha) : false;
    const msiMatch = expectedMsiSha ? installerText.toUpperCase().includes(expectedMsiSha) : false;
    wingetSummary = `state=${pr.state}, merged=${Boolean(pr.merged)}, comments=${pr.comments ?? 0}, review_comments=${pr.review_comments ?? 0}, updated_at=${pr.updated_at}, sha256_parity(exe=${exeMatch}, msi=${msiMatch})`;
    if (!pr.merged && pr.state === "open" && installerText && (!exeMatch || !msiMatch)) {
      actionableIssues.push(`Winget PR #480164 installer SHA-256 drifted from release-manifest.json (exeMatch=${exeMatch}, msiMatch=${msiMatch})`);
    }
    if (pr.state === "closed" && !pr.merged) {
      actionableIssues.push("Winget PR #480164 was closed without merging — needs resubmission");
    }
  } else {
    wingetSummary = `HTTP ${wingetPrRes.status}`;
  }

  // 2. Chocolatey status
  let chocoSummary = "Pending / Not found";
  try {
    const chRes = await fetch(
      `https://community.chocolatey.org/api/v2/Packages(Id='sweepr-cleaner',Version='${encodeURIComponent(expectedVer)}')`,
      { headers: { Accept: "*/*", "User-Agent": "Sweepr-Wave2-Authority-Radar" }, signal: AbortSignal.timeout(15_000) }
    );
    if (chRes.ok) {
      chocoSummary = `HTTP 200 — sweepr-cleaner v${expectedVer} live in OData catalog`;
    } else {
      chocoSummary = `HTTP ${chRes.status}`;
    }
  } catch (err) {
    chocoSummary = `Fetch error: ${err?.message || err}`;
  }

  // 3. Scoop manifest SHA-256 parity (BenCook1996/scoop-sweepr)
  let scoopSummary = "Unavailable";
  const scoopContents = await fetchJsonSafe("https://api.github.com/repos/BenCook1996/scoop-sweepr/contents", {
    headers: githubHeaders(),
  });
  if (scoopContents.ok && Array.isArray(scoopContents.data)) {
    const jsonFiles = scoopContents.data.filter((f) => String(f.name || "").endsWith(".json"));
    const checked = [];
    for (const jf of jsonFiles) {
      if (!jf.download_url) continue;
      const bodyRes = await fetchJsonSafe(jf.download_url, { headers: { "User-Agent": "Sweepr-Wave2-Authority-Radar" } });
      if (bodyRes.ok && bodyRes.data) {
        const raw = JSON.stringify(bodyRes.data).toUpperCase();
        const exeOk = expectedExeSha ? raw.includes(expectedExeSha) : false;
        checked.push(`${jf.name}(ver=${bodyRes.data.version ?? "?"}, exeShaMatch=${exeOk})`);
        if (!exeOk) {
          actionableIssues.push(`Scoop manifest ${jf.name} in BenCook1996/scoop-sweepr does not match latest EXE SHA-256 ${expectedExeSha.slice(0, 12)}...`);
        }
      }
    }
    scoopSummary = checked.length > 0 ? checked.join(", ") : `HTTP 200 (${scoopContents.data.length} files, no .json manifests found)`;
  } else {
    scoopSummary = `HTTP ${scoopContents.status}`;
  }

  // 4. Read-only 14-day Community / GEO Citation Opportunity Digest
  const cutoffSec = Math.floor(Date.now() / 1000) - 14 * 86400;
  const cutoffDate = new Date(cutoffSec * 1000).toISOString().slice(0, 10);
  const digestRows = [];

  for (const topic of RADAR_TOPICS) {
    // Hacker News Algolia
    const hnUrl = `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(topic.query)}&hitsPerPage=3&numericFilters=created_at_i>${cutoffSec}`;
    const hnRes = await fetchJsonSafe(hnUrl);
    if (hnRes.ok && Array.isArray(hnRes.data?.hits)) {
      for (const hit of hnRes.data.hits.slice(0, 2)) {
        const title = hit.title || hit.story_title || "(comment)";
        const link = hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`;
        digestRows.push({ source: "Hacker News", topic: topic.query, title, url: link, guide: topic.guide });
      }
    }

    // GitHub Issues/Discussions
    const ghUrl = `https://api.github.com/search/issues?q=${encodeURIComponent(`${topic.query} created:>=${cutoffDate}`)}&per_page=3`;
    const ghRes = await fetchJsonSafe(ghUrl, { headers: githubHeaders() });
    if (ghRes.ok && Array.isArray(ghRes.data?.items)) {
      for (const item of ghRes.data.items.slice(0, 2)) {
        digestRows.push({ source: "GitHub", topic: topic.query, title: item.title, url: item.html_url, guide: topic.guide });
      }
    }

    // Polite optional Reddit search fallback
    const redditUrl = `https://www.reddit.com/search.json?q=${encodeURIComponent(topic.query)}&t=month&sort=new&limit=3`;
    const redditRes = await fetchJsonSafe(redditUrl, {
      headers: { "User-Agent": "SweeprCleanerRadar/1.0 (+https://sweeprcleaner.com)" },
    });
    if (redditRes.ok && Array.isArray(redditRes.data?.data?.children)) {
      for (const c of redditRes.data.data.children.slice(0, 2)) {
        if (!c?.data?.title || !c?.data?.permalink) continue;
        digestRows.push({
          source: `Reddit (r/${c.data.subreddit})`,
          topic: topic.query,
          title: c.data.title,
          url: `https://www.reddit.com${c.data.permalink}`,
          guide: topic.guide,
        });
      }
    }
  }

  const lines = [
    `## Wave 2 Authority & GEO Radar (${new Date().toISOString().slice(0, 10)})`,
    "### 1. Package-Manager PR & Checksum Drift",
    `- **Winget PR #480164:** ${wingetSummary}`,
    `- **Chocolatey (\`sweepr-cleaner\` v${expectedVer}):** ${chocoSummary}`,
    `- **Scoop (\`BenCook1996/scoop-sweepr\`):** ${scoopSummary}`,
    "",
    "### 2. Actionable Package Items",
    ...(actionableIssues.length > 0 ? actionableIssues.map((i) => `- **ACTION:** ${i}`) : ["- None (or awaiting external PR merge)"]),
    "",
    `### 3. 14-Day Read-Only GEO / Community Outreach Digest (${digestRows.length} threads)`,
  ];
  if (digestRows.length > 0) {
    lines.push(
      "| Source | Topic | Thread | Target Guide |",
      "| :--- | :--- | :--- | :--- |",
      ...digestRows.slice(0, 20).map((r) => {
        const cleanTitle = String(r.title).replace(/\|/g, " ").replace(/\s+/g, " ").slice(0, 80);
        return `| ${r.source} | ${r.topic} | [${cleanTitle}](${r.url}) | ${r.guide} |`;
      })
    );
  } else {
    lines.push("- No matching public discussions fetched in this window.");
  }

  const reportText = lines.join("\n");
  console.log(reportText);
  appendSummary(reportText);

  // 5. Optional deduplicated Central CRM changelog notice when actionable package drift exists
  const crmPass = (process.env.CRM_ADMIN_PASSWORD || "").trim();
  const crmUser = (process.env.CRM_ADMIN_USER || "admin").trim();
  if (actionableIssues.length > 0 && crmPass) {
    const today = new Date().toISOString().slice(0, 10);
    const title = "Weekly Wave 2 Radar: Package Checksum/PR Action Needed";
    const authHeader = `Basic ${Buffer.from(`${crmUser}:${crmPass}`).toString("base64")}`;
    try {
      const existing = await fetchJsonSafe(`${CENTRAL_CRM_URL}/api/crm/seo/changelog?project=cleaner&limit=25`, {
        headers: { Authorization: authHeader },
      });
      const dup = Array.isArray(existing.data?.entries)
        ? existing.data.entries.some((e) => e.date === today && e.title === title)
        : false;
      if (!dup) {
        const postRes = await fetch(`${CENTRAL_CRM_URL}/api/crm/seo/changelog`, {
          method: "POST",
          headers: {
            Authorization: authHeader,
            Origin: CENTRAL_CRM_URL,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            project_id: "cleaner",
            date: today,
            category: "distribution_backlinks",
            title,
            description: actionableIssues.join("; "),
            impact: "Highlights package manager SHA-256 drift or open Winget PR comments",
            status: "in_progress",
          }),
          signal: AbortSignal.timeout(15_000),
        });
        console.log(`Central CRM radar changelog note HTTP ${postRes.status}`);
      }
    } catch (err) {
      console.warn(`Central CRM radar changelog warning: ${err?.message || err}`);
    }
  }
}

main().catch((err) => {
  console.error("[wave2-authority-radar] Fatal error:", err);
  process.exit(1);
});
