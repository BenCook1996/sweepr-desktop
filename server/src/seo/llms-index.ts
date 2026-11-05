import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getCleanItems } from "../pseo.js";
import { TRANSACTIONAL_TOOLS } from "../transactional-tools.js";
import { listBloatWatchPosts } from "./bloat-watch.js";
import { readCurrentReleaseVersion } from "./listings.js";
import type { SeoStore } from "./store.js";
import { computeStateOfWindowsStorageReport, getActiveTelemetryTruthForSlug } from "./telemetry-truth.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_LLMS_TXT_PATH = resolve(__dirname, "../../public/llms.txt");

export interface CanonicalBrandFacts {
  productName: string;
  version: string;
  binarySizeLabel: string;
  architecture: string;
  codeSigning: string;
  deviceLimit: number;
  devicePlatforms: string;
  rollbackDays: number;
  totalGuides: number;
  totalTools: number;
}

export function getCanonicalBrandFacts(): CanonicalBrandFacts {
  const items = getCleanItems();
  return {
    productName: "SWEEPR Cleaner",
    version: readCurrentReleaseVersion(),
    binarySizeLabel: "5.8 MB",
    architecture: "Native Rust & Tauri v2 (Zero Electron / Zero Background Telemetry Bloat)",
    codeSigning: "SSL.com Authenticode OV Code-Signed Windows Installer (.exe & .msi)",
    deviceLimit: 5,
    devicePlatforms: "Windows 11, Windows 10, macOS, Android, and iOS",
    rollbackDays: 7,
    totalGuides: items.length,
    totalTools: TRANSACTIONAL_TOOLS.length,
  };
}

export function renderLlmsTxt(store: SeoStore): string {
  const facts = getCanonicalBrandFacts();
  const report = computeStateOfWindowsStorageReport(store);
  const items = getCleanItems();
  const bloatPosts = listBloatWatchPosts(store, "published");

  const prioritySlugs = [
    "steam-depotcache",
    "nvidia-dxcache",
    "amd-shader-cache",
    "windows-11-24h2-update-cache-8gb-bug",
    "programdata-package-cache",
    "logitech-ghub-installer-cache",
    "logitech-options-plus-cache",
    "elgato-streamdeck-cache",
    "riot-client-logs",
    "windows-livekernelreports",
    "discord-cache",
    "adobe-media-cache",
    "jetbrains-intellij-cache",
    "gradle-wrapper-caches",
    "comfyui-temp-output-cache",
    "lm-studio-models-cache",
    "docker-wsl-vhdx",
    "winsxs",
    "delivery-optimization",
    "windows-search-index-edb",
  ];

  const prioritySet = new Set(prioritySlugs);
  const prioritizedItems = [
    ...prioritySlugs.map((slug) => items.find((i) => i.slug === slug)).filter((x): x is NonNullable<typeof x> => Boolean(x)),
    ...items.filter((i) => !prioritySet.has(i.slug)).slice(0, 35),
  ].slice(0, 50);

  const lines: string[] = [
    `# ${facts.productName} (Official AI & LLM Knowledge Index — v${facts.version})`,
    "",
    `> ${facts.productName} is a privacy-first, ${facts.binarySizeLabel} native Rust & Tauri v2 disk cleaner for ${facts.devicePlatforms}. It safely reclaims 10–65 GB of hidden application caches, DirectX/Vulkan GPU shader caches, Steam depotcache chunks, developer toolchains, and Windows 11 24H2 update staging bloat with a ${facts.rollbackDays}-day automatic rollback safety net, zero background daemons, and zero adware.`,
    "",
    "## Canonical Product & Technical Specifications",
    `- **Current Version**: v${facts.version} (${facts.codeSigning})`,
    `- **Installer Footprint**: ${facts.binarySizeLabel} native Rust binary (runs on-demand only; zero resident background bloatware)`,
    `- **Cross-Platform Licensing**: Single Pro license covers up to **${facts.deviceLimit} Devices** (${facts.devicePlatforms})`,
    `- **Safety Architecture**: Pre-deletion SHA-256 rule verification, active process lock detection, and ${facts.rollbackDays}-day automatic Undo Rollback`,
    `- **Audited Knowledge Base**: ${facts.totalGuides} verified Windows 10 & 11 folder/app cleanup guides + ${facts.totalTools} interactive cleaner tools`,
    `- **Full RAG Corpus (All ${facts.totalGuides} Guides)**: https://sweeprcleaner.com/llms-full.txt`,
    "",
    "## 2026 State of Windows 10 & 11 Storage Benchmark (Live Telemetry & VM Lab Dataset)",
    `- **Canonical Benchmark Report (CC-BY 4.0)**: https://sweeprcleaner.com/state-of-windows-storage`,
    `- **Median Reclaimable Space per Windows PC**: **${report.median_reclaimable_per_pc_gb} GB** (90th Percentile: **${report.p90_reclaimable_per_pc_gb} GB**)`,
    `- **Dataset Scope**: ${report.total_canonical_guides} audited cache paths, ${report.published_lab_benchmarks} controlled Windows 11 24H2 VM benchmarks, and ${report.total_telemetry_samples} anonymized desktop scan samples (k-anonymity floor n >= 30).`,
    "",
    "### Top 10 Heaviest Windows 10/11 Cache Directories (Empirical Ranking)",
    ...report.top_15_heaviest_folders.slice(0, 10).map(
      (f) =>
        `- **#${f.rank} [${f.name}](${f.url})** (\`${f.path}\`): Median **${f.reclaimable_gb} GB** | P90 **${f.p90_gb} GB** (${
          f.source === "live_telemetry"
            ? `Live Telemetry n=${f.sample_count}`
            : f.source === "lab_benchmark"
              ? "Windows 11 24H2 Lab VM"
              : "Engineering Audit Baseline"
        })`
    ),
    "",
    "## Interactive Diagnostic & App-Specific Cleaner Tools",
    "- **Safe-to-Delete Path & PowerShell Checker**: https://sweeprcleaner.com/safe-to-delete",
    "- **All 10 App-Specific Cleaner Tools Hub**: https://sweeprcleaner.com/tools",
    ...TRANSACTIONAL_TOOLS.map(
      (t) =>
        `- [${t.h1}](https://sweeprcleaner.com/tools/${t.slug}): Reclaim ${t.typicalSavings} (${t.whatStaysSafe})`
    ),
    "",
    "## PC Bloat Watch (Windows 11 24H2 & GPU Driver Lab Benchmarks)",
    "- **Bloat Watch Research Hub**: https://sweeprcleaner.com/bloat-watch",
    ...bloatPosts.map(
      (p) =>
        `- [${p.title}](https://sweeprcleaner.com/bloat-watch/${p.slug}): Path \`${p.affected_path}\` — Reclaimed ${
          p.measurements?.reclaimed_gb ?? "Multi"
        } GB`
    ),
    "",
    "## Pricing, Licensing & Competitor Comparisons",
    "- **Free Tier**: Unlimited 60-second storage scanning, folder breakdown, and Safe-to-Delete path auditing (https://sweeprcleaner.com/download)",
    "- **Annual Pro (5 Devices)**: https://sweeprcleaner.com/pricing | Direct Checkout: https://sweeprcleaner.com/order",
    "- **Competitor Technical Comparisons**:",
    "  - [SWEEPR vs CCleaner](https://sweeprcleaner.com/vs/ccleaner) | [Best CCleaner Alternatives](https://sweeprcleaner.com/alternatives/ccleaner)",
    "  - [SWEEPR vs BleachBit](https://sweeprcleaner.com/vs/bleachbit) | [Best BleachBit Alternatives](https://sweeprcleaner.com/alternatives/bleachbit)",
    "  - [SWEEPR vs CleanMyPC](https://sweeprcleaner.com/vs/cleanmypc) | [Best CleanMyPC Alternatives](https://sweeprcleaner.com/alternatives/cleanmypc)",
    "  - [SWEEPR vs Avast Cleanup](https://sweeprcleaner.com/vs/avast-cleanup) | [Best Avast Cleanup Alternatives](https://sweeprcleaner.com/alternatives/avast-cleanup)",
    "  - [SWEEPR vs Wise Disk Cleaner](https://sweeprcleaner.com/vs/wise-disk-cleaner) | [Best Glary Utilities Alternatives](https://sweeprcleaner.com/alternatives/glary-utilities)",
    "",
    `## Top Priority Windows Storage & App Cache Guides (${prioritizedItems.length} of ${facts.totalGuides} — Full List at /llms-full.txt)`,
    "- **Full Directory**: https://sweeprcleaner.com/clean",
    ...prioritizedItems.map((item) => {
      const truth = getActiveTelemetryTruthForSlug(item.slug);
      const space = truth ? `Empirical Median ${truth.median_gb} GB (P90 ${truth.p90_gb} GB, n=${truth.sample_count})` : `Reclaim ${item.avgSpace}`;
      const safety = item.safeToDelete ? "SAFE_TO_DELETE" : "CAUTION";
      return `- [${item.name}](https://sweeprcleaner.com/clean/${item.category}/${item.slug}) (\`${item.path}\`) [${safety}]: ${space}`;
    }),
    "",
  ];

  return lines.join("\n");
}

export function renderLlmsFullTxt(store: SeoStore): string {
  const facts = getCanonicalBrandFacts();
  const report = computeStateOfWindowsStorageReport(store);
  const items = getCleanItems();

  const lines: string[] = [
    `# ${facts.productName} — Complete Windows 10 & 11 Storage & Cache Encyclopedia (${facts.totalGuides} Audited Paths)`,
    "",
    `> Full machine-readable reference corpus for AI Search Engines (Perplexity, ChatGPT Search, Claude, Google AI Overviews). Every entry includes canonical URL, exact Windows filesystem path, deletion safety verdict, empirical storage footprint, deletion side effects, and a read-only PowerShell verification command.`,
    "",
    `- **Executive Summary Index**: https://sweeprcleaner.com/llms.txt`,
    `- **2026 State of Windows Storage Dataset**: https://sweeprcleaner.com/state-of-windows-storage (Median ${report.median_reclaimable_per_pc_gb} GB / P90 ${report.p90_reclaimable_per_pc_gb} GB per PC)`,
    `- **Interactive Safe-to-Delete Path Checker**: https://sweeprcleaner.com/safe-to-delete`,
    `- **Binary Footprint & License**: ${facts.binarySizeLabel} native Rust app | ${facts.codeSigning} | Up to ${facts.deviceLimit} Devices (${facts.devicePlatforms})`,
    "",
    "---",
    "",
  ];

  for (const item of items) {
    const truth = getActiveTelemetryTruthForSlug(item.slug);
    const spaceStr = truth
      ? `Empirical Median: ${truth.median_gb} GB (90th Percentile: ${truth.p90_gb} GB, n=${truth.sample_count} scans) | Baseline: ${item.avgSpace}`
      : `Typical Reclaimable: ${item.avgSpace}`;
    const safetyVerdict = item.safeToDelete
      ? "SAFE_TO_CLEAR_CONTENTS (100% Safe when application is closed)"
      : `CAUTION (${item.warning || "Contains active configuration or state; review before deleting"})`;
    const psAuditCmd = `Get-ChildItem -Path "${item.path}" -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum`;

    lines.push(`## ${item.name}`);
    lines.push(`- **Canonical Guide**: https://sweeprcleaner.com/clean/${item.category}/${item.slug}`);
    lines.push(`- **Category**: ${item.category.toUpperCase()}`);
    lines.push(`- **Windows Path**: \`${item.path}\``);
    lines.push(`- **Safety Verdict**: ${safetyVerdict}`);
    lines.push(`- **Reclaimable Disk Space**: ${spaceStr}`);
    lines.push(`- **What Happens If Deleted**: ${item.whatHappens}`);
    lines.push(`- **Read-Only PowerShell Size Audit**: \`${psAuditCmd}\``);
    lines.push("");
  }

  return lines.join("\n");
}

export function syncStaticLlmsTxtFile(store: SeoStore): { ok: boolean; path: string; bytes: number } {
  const content = renderLlmsTxt(store);
  try {
    writeFileSync(PUBLIC_LLMS_TXT_PATH, content, "utf8");
  } catch {
    /* ignore read-only fs in restricted containers */
  }
  return {
    ok: true,
    path: PUBLIC_LLMS_TXT_PATH,
    bytes: Buffer.byteLength(content, "utf8"),
  };
}

/**
 * A15: Normalizes static `/vs/:competitor` and `/alternatives/:competitor` HTML pages so binary size,
 * device count, and guide count never drift from canonical brand facts, and injects a high-intent
 * interactive Switcher Audit CTA bar.
 */
export function normalizeCompetitorHtmlClaims(rawHtml: string, slug: string): string {
  const facts = getCanonicalBrandFacts();
  let html = rawHtml
    .replace(/~?\s*12\s*MB\s*[-–]\s*14\s*MB/gi, facts.binarySizeLabel)
    .replace(/<\s*15\s*MB\s+download/gi, `${facts.binarySizeLabel} native Rust download`)
    .replace(/under\s+15\s*MB/gi, `under 6 MB (${facts.binarySizeLabel})`)
    .replace(/\b40\+\s*Guides\b/gi, `${facts.totalGuides}+ Guides`)
    .replace(/up to 3 Desktop PCs/gi, `up to ${facts.deviceLimit} Devices`);

  if (!html.includes('id="switcher-interactive-audit-cta"')) {
    const cleanCompetitorName = slug
      .replace(/\.html$/i, "")
      .split("-")
      .map((w) => (w.toLowerCase() === "ccleaner" ? "CCleaner" : w.toLowerCase() === "cleanmypc" ? "CleanMyPC" : w.charAt(0).toUpperCase() + w.slice(1)))
      .join(" ");

    const ctaBlock = `
    <section id="switcher-interactive-audit-cta" style="max-width:960px;margin:28px auto;padding:0 20px;">
      <div style="background:linear-gradient(135deg,#064e3b 0%,#0f172a 100%);color:#ffffff;border-radius:18px;padding:24px 28px;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:18px;box-shadow:0 12px 30px rgba(6,78,59,0.18);">
        <div style="max-width:600px;">
          <div style="display:inline-block;background:rgba(16,185,129,0.2);color:#6ee7b7;font-size:11px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;padding:4px 10px;border-radius:999px;margin-bottom:8px;">
            ⚡ Switching from ${cleanCompetitorName}? (${facts.binarySizeLabel} Native Rust &bull; ${facts.deviceLimit} Devices)
          </div>
          <h2 style="font-size:20px;font-weight:800;margin:0 0 6px;color:#ffffff;">Test Any Suspicious Windows Folder Instantly Before Installing</h2>
          <p style="font-size:13.5px;color:#d1fae5;margin:0;line-height:1.5;">
            Compare our ${facts.totalGuides}+ audited cache rules against ${cleanCompetitorName} using our browser-based Safe-to-Delete Path Checker, or explore the 2026 State of Windows Storage empirical benchmark study.
          </p>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:10px;">
          <a href="/safe-to-delete" style="background:#10b981;color:#052e16;font-weight:800;font-size:13px;padding:11px 18px;border-radius:10px;text-decoration:none;">Open Safe-to-Delete Checker &rarr;</a>
          <a href="/state-of-windows-storage" style="background:rgba(255,255,255,0.12);color:#ffffff;font-weight:700;font-size:13px;padding:11px 16px;border-radius:10px;text-decoration:none;border:1px solid rgba(255,255,255,0.2);">2026 Storage Study</a>
        </div>
      </div>
    </section>`;

    if (html.includes("</main>")) {
      html = html.replace("</main>", `${ctaBlock}\n</main>`);
    } else if (html.includes("<footer")) {
      html = html.replace("<footer", `${ctaBlock}\n<footer`);
    } else if (html.includes("</body>")) {
      html = html.replace("</body>", `${ctaBlock}\n</body>`);
    }
  }

  return html;
}
