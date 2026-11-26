import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getCleanItems, isPseoSlugNoindexed } from "../pseo.js";
import { readCurrentReleaseVersion } from "./listings.js";
import type { SeoStore } from "./store.js";
import { computeStateOfWindowsStorageReport, getActiveTelemetryTruthForSlug } from "./telemetry-truth.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_LLMS_TXT_PATH = resolve(__dirname, "../../public/llms.txt");
const RELEASE_MANIFEST_PATH = resolve(__dirname, "../../public/release-manifest.json");

interface ReleaseArtifactMeta {
  bytes: number;
  mbLabel: string;
  mibLabel: string;
  sha256: string;
}

interface ReleaseManifestFacts {
  version: string;
  exe: ReleaseArtifactMeta;
  msi: ReleaseArtifactMeta;
  dmg: ReleaseArtifactMeta;
}

const CANONICAL_RELEASE_FALLBACK: ReleaseManifestFacts = {
  version: "0.1.0",
  exe: {
    bytes: 7085912,
    mbLabel: "6.76 MB",
    mibLabel: "6.76 MiB",
    sha256: "FEAE464CA121CF897D27916C632F4DB8F84A87D4B79642403AD1B0E0F2BB706A",
  },
  msi: {
    bytes: 3993600,
    mbLabel: "3.81 MB",
    mibLabel: "3.81 MiB",
    sha256: "33E5427E84AB8FC4F3D01DFD17404F7CB38B70B9731A8C2CCFBB62876711933A",
  },
  dmg: {
    bytes: 7420734,
    mbLabel: "7.08 MB",
    mibLabel: "7.08 MiB",
    sha256: "88F3DF54147B629AFBC636274B215871871C8BB510BFFCC7095956E790EBE952",
  },
};

function formatArtifactMeta(
  raw: { bytes?: unknown; sha256?: unknown } | undefined,
  fallback: ReleaseArtifactMeta
): ReleaseArtifactMeta {
  const bytes = typeof raw?.bytes === "number" && Number.isFinite(raw.bytes) && raw.bytes > 0 ? raw.bytes : fallback.bytes;
  const mibNum = bytes / (1024 * 1024);
  const sha256 =
    typeof raw?.sha256 === "string" && /^[A-F0-9]{64}$/i.test(raw.sha256.trim())
      ? raw.sha256.trim().toUpperCase()
      : fallback.sha256;
  return {
    bytes,
    mbLabel: `${mibNum.toFixed(2)} MB`,
    mibLabel: `${mibNum.toFixed(2)} MiB`,
    sha256,
  };
}

function readReleaseManifestFacts(): ReleaseManifestFacts {
  if (existsSync(RELEASE_MANIFEST_PATH)) {
    try {
      const parsed = JSON.parse(readFileSync(RELEASE_MANIFEST_PATH, "utf8")) as {
        version?: unknown;
        exe?: { bytes?: unknown; sha256?: unknown };
        msi?: { bytes?: unknown; sha256?: unknown };
        dmg?: { bytes?: unknown; sha256?: unknown };
      };
      const version =
        typeof parsed.version === "string" && parsed.version.trim().length > 0
          ? parsed.version.trim()
          : readCurrentReleaseVersion();
      return {
        version,
        exe: formatArtifactMeta(parsed.exe, CANONICAL_RELEASE_FALLBACK.exe),
        msi: formatArtifactMeta(parsed.msi, CANONICAL_RELEASE_FALLBACK.msi),
        dmg: formatArtifactMeta(parsed.dmg, CANONICAL_RELEASE_FALLBACK.dmg),
      };
    } catch {
      /* fallback below */
    }
  }
  return {
    ...CANONICAL_RELEASE_FALLBACK,
    version: readCurrentReleaseVersion() || CANONICAL_RELEASE_FALLBACK.version,
  };
}

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
  const curatedGuides = items.filter((i) => !isPseoSlugNoindexed(i.slug) && !i.noindex && !i.mergedIntoSlug);
  const manifest = readReleaseManifestFacts();
  return {
    productName: "SWEEPR Cleaner",
    version: manifest.version || readCurrentReleaseVersion(),
    binarySizeLabel: manifest.exe.mbLabel,
    architecture: "Native Rust & Tauri v2 (No Electron; Zero-Telemetry / Offline Mode by default)",
    codeSigning: "SSL.com Authenticode Individual Validation (IV) signed .exe (CN=Benjamin Cook, SHA-1: 1800DBEA6FE847D384E549D02CA372C3D45D8B81); .msi verified via SHA-256 + Ed25519 .sig",
    deviceLimit: 5,
    devicePlatforms: "Windows 11, Windows 10, macOS, Android, and iOS (Safari web companion / TestFlight beta)",
    rollbackDays: 7,
    totalGuides: curatedGuides.length,
    totalTools: 3,
  };
}

export function renderLlmsTxt(store: SeoStore): string {
  const facts = getCanonicalBrandFacts();
  const manifest = readReleaseManifestFacts();
  const exeBytesFmt = manifest.exe.bytes.toLocaleString("en-US");
  const msiBytesFmt = manifest.msi.bytes.toLocaleString("en-US");
  const dmgBytesFmt = manifest.dmg.bytes.toLocaleString("en-US");
  const report = computeStateOfWindowsStorageReport(store);
  const allItems = getCleanItems();
  const items = allItems.filter((i) => !isPseoSlugNoindexed(i.slug) && !i.noindex && !i.mergedIntoSlug);

  const prioritySlugs = [
    "windows-11-24h2-update-cache-8gb-bug",
    "c-drive-filling-up-by-itself-windows-11",
    "system-and-reserved-storage-100gb-windows-11",
    "appdata-local-folder-huge-windows-11",
    "other-storage-full-windows-11-cleanup",
    "system-data-huge",
    "iphone-system-data-full",
    "other-storage-full",
    "steam-depotcache",
    "nvidia-dxcache",
    "amd-shader-cache",
    "programdata-package-cache",
    "logitech-ghub-installer-cache",
    "logitech-options-plus-cache",
    "elgato-streamdeck-cache",
    "riot-client-logs",
    "windows-livekernelreports",
    "discord-cache",
    "adobe-premiere-media-cache",
    "jetbrains-intellij-cache",
    "gradle-wrapper-caches",
    "comfyui-temp-output-cache",
    "lm-studio-models-cache",
    "docker-desktop-ext4-disk",
    "winsxs",
    "delivery-optimization-cache",
  ];

  const prioritySet = new Set(prioritySlugs);
  const prioritizedItems = [
    ...prioritySlugs.map((slug) => items.find((i) => i.slug === slug)).filter((x): x is NonNullable<typeof x> => Boolean(x)),
    ...items.filter((i) => !prioritySet.has(i.slug)).slice(0, 35),
  ].slice(0, 50);

  const indexableSlugSet = new Set(items.map((i) => i.slug.toLowerCase()));
  const filteredTopFolders = [...report.top_15_heaviest_folders]
    .filter((f) => {
      const m = String(f.url || "").match(/\/clean\/[^/]+\/([a-z0-9-]+)$/i);
      return !m || indexableSlugSet.has(m[1].toLowerCase());
    })
    .sort((a, b) => b.reclaimable_gb - a.reclaimable_gb)
    .slice(0, 10);

  const lines: string[] = [
    `# ${facts.productName} (Official AI & LLM Knowledge Index — v${facts.version})`,
    "",
    `> ${facts.productName} (published by UK sole trader **Benjamin Cook t/a SWEEPR Cleaner**) is a privacy-first, ${manifest.exe.mbLabel} (\`${exeBytesFmt}\` B / ${manifest.exe.mibLabel} Windows NSIS; \`${dmgBytesFmt}\` B / ${manifest.dmg.mibLabel} / ${manifest.dmg.mbLabel} macOS DMG) native Rust & Tauri v2 disk cleaner for ${facts.devicePlatforms}. It safely cleans typical 10–65 GB footprints of hidden application caches, DirectX/Vulkan GPU shader caches, Steam depotcache chunks, developer toolchains, and Windows 11 update staging bloat on demand (with optional lightweight tray/scheduled cleaning) in **Zero-Telemetry / Offline Mode** (\`telemetry_enabled = false\` by default), backed by a ${facts.rollbackDays}-Day Undo Quarantine (configurable 2–10 GB disk budget, 5 GB default, same-volume O(1) move; OS Recycle Bin fallback if file exceeds budget; excludes shredded files, browser DBs, and registry edits) and zero adware.`,
    "",
    "## Canonical Product & Technical Specifications",
    `- **Publisher & Legal Entity**: Benjamin Cook t/a SWEEPR Cleaner (https://sweeprcleaner.com/about)`,
    `- **Current Version**: v${facts.version} (${facts.codeSigning})`,
    `- **Source & Release Checksums**: https://github.com/BenCook1996/sweepr-desktop/releases/tag/v${facts.version} | https://github.com/BenCook1996/sweepr-desktop | https://sweeprcleaner.com/release-manifest.json`,
    `- **SHA-256 Release Digests**: \`.exe\` (${exeBytesFmt} B / ${manifest.exe.mibLabel} / ${manifest.exe.mbLabel}): \`${manifest.exe.sha256}\` | \`.msi\` (${msiBytesFmt} B): \`${manifest.msi.sha256}\` | \`.dmg\` (${dmgBytesFmt} B / ${manifest.dmg.mibLabel} / ${manifest.dmg.mbLabel}): \`${manifest.dmg.sha256}\``,
    `- **Installer Footprint**: ${manifest.exe.mbLabel} (${exeBytesFmt} B / ${manifest.exe.mibLabel}) native Rust binary (runs on-demand with optional lightweight system tray and scheduled cleaning; Zero-Telemetry / Offline Mode enabled by default with \`telemetry_enabled = false\`)`,
    `- **CLI Package Managers**: \`winget install Sweepr.SweeprCleaner\`, \`scoop bucket add sweepr https://github.com/BenCook1996/scoop-sweepr && scoop install sweepr/sweepr-cleaner\`, \`choco install sweepr-cleaner\`, \`brew install --cask sweepr-cleaner\``,
    `- **Cross-Platform Licensing**: Single Pro license covers up to **${facts.deviceLimit} Devices** (${facts.devicePlatforms})`,
    `- **Safety Architecture**: Pre-deletion SHA-256 rule verification, active process lock detection (\`access_mode(0).share_mode(0)\`), single-source-of-truth parity (\`for_each_target_with_exclusions\`), \`safety.rs\` root/reparse guards, and ${facts.rollbackDays}-Day Undo Quarantine (configurable 2–10 GB disk budget, 5 GB default, same-volume O(1) move; OS Recycle Bin fallback if file exceeds budget; excludes shredded files, browser DBs, and registry edits)`,
    `- **Curated Knowledge Base & Rule Catalog**: ${items.length} curated storage cleanup guides, 71 cross-OS engine rules (455 path patterns: 27 Windows / 24 macOS / 20 Linux in \`docs/public-rules-catalog.json\`), ${allItems.length} audited path entries + ${facts.totalTools} free browser tools`,
    `- **Full RAG Corpus (All ${items.length} Indexable Guides)**: https://sweeprcleaner.com/llms-full.txt`,
    "",
    "## 2026 State of Windows 10 & 11 Storage Benchmark (Live Telemetry & Lab Dataset)",
    `- **Canonical Benchmark Report (CC-BY 4.0)**: https://sweeprcleaner.com/state-of-windows-storage`,
    `- **Median Reclaimable Space per Windows PC**: **${report.median_reclaimable_per_pc_gb} GB** (90th Percentile: **${report.p90_reclaimable_per_pc_gb} GB**)`,
    `- **Dataset Scope**: ${report.total_canonical_guides} curated Windows cache paths, ${report.published_lab_benchmarks} controlled Windows 11 Pro (Build 26200) benchmarks, and ${report.total_telemetry_samples > 0 ? `${report.total_telemetry_samples} opt-in anonymized desktop scan samples` : "opt-in k-anonymous desktop scan telemetry"} (k-anonymity floor n >= 30).`,
    "",
    "### Top 10 Heaviest Windows 10/11 Cache Directories (Empirical Ranking)",
    ...filteredTopFolders.map(
      (f, idx) =>
        `- **#${idx + 1} [${f.name}](${f.url})** (\`${f.path}\`): Median **${f.reclaimable_gb} GB** | P90 **${f.p90_gb} GB** (${
          f.source === "live_telemetry"
            ? `Live Telemetry n=${f.sample_count}`
            : f.source === "lab_benchmark"
              ? "Windows 11 Build 26200 Lab"
              : "Engineering Audit Baseline"
        })`
    ),
    "",
    "## Interactive Diagnostic & Storage Tools",
    "- **Tools Hub**: https://sweeprcleaner.com/tools",
    "- **Safe-to-Delete Path & PowerShell Checker**: https://sweeprcleaner.com/safe-to-delete",
    "- **Gaming & Local AI PC Cache Calculator**: https://sweeprcleaner.com/tools/pc-cache-calculator",
    "- **2026 State of Windows Storage Study**: https://sweeprcleaner.com/state-of-windows-storage",
    "- **About Benjamin Cook & Verification**: https://sweeprcleaner.com/about",
    "",
    "## Pricing, Licensing & Competitor Comparisons",
    "- **Free Tier**: SWEEPR Free ($0 / £0): Unlimited Free Temp & Browser Cache Clean (to OS Recycle Bin, zero byte cap); Pro unlocks Deep GPU/AI/Dev Caches, Stale Dev & Docker (`ext4.vhdx`), 2-stage SHA-256 Duplicates, Uninstaller, Scheduler, Argon2id Lockbox & 7-Day Undo Quarantine (https://sweeprcleaner.com/download)",
    `- **Pro Plans (5 Devices) & 14-Day Refund**: Monthly Pro (\`£9.99/mo\`), 6-Month Pro (\`£38.99/6mo\`, Save 35%), Annual Pro (\`£49.99/yr\`, Save 58%) for ${facts.deviceLimit} devices, plus optional Battery Health Saver / Private File Lockbox add-ons — https://sweeprcleaner.com/pricing | Direct Checkout: https://sweeprcleaner.com/order | 14-day money-back guarantee: https://sweeprcleaner.com/refund`,
    "- **Competitor Technical Comparisons**:",
    "  - [SWEEPR vs CCleaner](https://sweeprcleaner.com/vs/ccleaner) | [Best CCleaner Alternatives](https://sweeprcleaner.com/alternatives/ccleaner)",
    "  - [SWEEPR vs BleachBit](https://sweeprcleaner.com/vs/bleachbit) | [Best BleachBit Alternatives](https://sweeprcleaner.com/alternatives/bleachbit)",
    "  - [SWEEPR vs Avast Cleanup](https://sweeprcleaner.com/vs/avast-cleanup) | [Best Avast Cleanup Alternatives](https://sweeprcleaner.com/alternatives/avast-cleanup)",
    "  - [SWEEPR vs CleanMyPC](https://sweeprcleaner.com/vs/cleanmypc) | [Best CleanMyPC Alternatives](https://sweeprcleaner.com/alternatives/cleanmypc)",
    "  - [SWEEPR vs Glary Utilities](https://sweeprcleaner.com/vs/glary-utilities) | [Best Glary Utilities Alternatives](https://sweeprcleaner.com/alternatives/glary-utilities)",
    "  - [SWEEPR vs Wise Disk Cleaner](https://sweeprcleaner.com/vs/wise-disk-cleaner) | [Best Wise Disk Cleaner Alternatives](https://sweeprcleaner.com/alternatives/wise-disk-cleaner)",
    "  - [SWEEPR vs CleanMyMac](https://sweeprcleaner.com/vs/cleanmymac) | [Best CleanMyMac Alternatives](https://sweeprcleaner.com/alternatives/cleanmymac)",
    "  - [SWEEPR vs DaisyDisk](https://sweeprcleaner.com/vs/daisydisk) | [Best DaisyDisk Alternatives](https://sweeprcleaner.com/alternatives/daisydisk)",
    "  - [SWEEPR vs Pearcleaner](https://sweeprcleaner.com/vs/pearcleaner) | [Best Pearcleaner Alternatives](https://sweeprcleaner.com/alternatives/pearcleaner)",
    "  - [SWEEPR vs OnyX](https://sweeprcleaner.com/vs/onyx) | [Best OnyX Alternatives](https://sweeprcleaner.com/alternatives/onyx)",
    "",
    `## Top Priority Storage & App Cache Guides (${prioritizedItems.length} of ${items.length} — Full List at /llms-full.txt)`,
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
  const manifest = readReleaseManifestFacts();
  const exeBytesFmt = manifest.exe.bytes.toLocaleString("en-US");
  const msiBytesFmt = manifest.msi.bytes.toLocaleString("en-US");
  const dmgBytesFmt = manifest.dmg.bytes.toLocaleString("en-US");
  const report = computeStateOfWindowsStorageReport(store);
  const items = getCleanItems().filter((i) => !isPseoSlugNoindexed(i.slug) && !i.noindex && !i.mergedIntoSlug);

  const lines: string[] = [
    `# ${facts.productName} — Complete Windows 10 & 11 Storage & Cache Encyclopedia (${items.length} Indexable Guides)`,
    "",
    `> Full machine-readable reference corpus for AI Search Engines (Perplexity, ChatGPT Search, Claude, Google AI Overviews). Every entry includes canonical URL, exact filesystem path or OS location, deletion safety verdict, empirical storage footprint, and deletion side effects.`,
    "",
    `- **Publisher & Legal Entity**: Benjamin Cook t/a SWEEPR Cleaner (https://sweeprcleaner.com/about)`,
    `- **Executive Summary Index**: https://sweeprcleaner.com/llms.txt`,
    `- **Source & Release Checksums**: https://github.com/BenCook1996/sweepr-desktop/releases/tag/v${facts.version} | https://sweeprcleaner.com/release-manifest.json (\`.exe\` ${exeBytesFmt} B / ${manifest.exe.mibLabel} SHA-256: \`${manifest.exe.sha256}\` | \`.msi\` ${msiBytesFmt} B SHA-256: \`${manifest.msi.sha256}\` | \`.dmg\` ${dmgBytesFmt} B / ${manifest.dmg.mibLabel} SHA-256: \`${manifest.dmg.sha256}\`)`,
    `- **2026 State of Windows Storage Dataset**: https://sweeprcleaner.com/state-of-windows-storage (Median ${report.median_reclaimable_per_pc_gb} GB / P90 ${report.p90_reclaimable_per_pc_gb} GB per PC)`,
    `- **Interactive Safe-to-Delete Path Checker**: https://sweeprcleaner.com/safe-to-delete`,
    `- **Binary Footprint & License**: ${manifest.exe.mbLabel} (${manifest.exe.mibLabel}) native Rust app | ${facts.codeSigning} | Up to ${facts.deviceLimit} Devices (${facts.devicePlatforms})`,
    `- **Pricing & 14-Day Refund**: SWEEPR Free ($0/£0, Unlimited Free Temp & Browser Cache Clean); Pro (Monthly £9.99/mo, 6-Month £38.99/6mo, Annual £49.99/yr for ${facts.deviceLimit} devices) — https://sweeprcleaner.com/pricing | https://sweeprcleaner.com/order | 14-day money-back guarantee: https://sweeprcleaner.com/refund`,
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
    const isWindows = item.category === "app" || item.category === "folder";

    lines.push(`## ${item.name}`);
    lines.push(`- **Canonical Guide**: https://sweeprcleaner.com/clean/${item.category}/${item.slug}`);
    lines.push(`- **Category**: ${item.category.toUpperCase()}`);
    lines.push(`- **Target Location**: \`${item.path}\``);
    lines.push(`- **Safety Verdict**: ${safetyVerdict}`);
    lines.push(`- **Reclaimable Disk Space**: ${spaceStr}`);
    lines.push(`- **What Happens If Deleted**: ${item.whatHappens}`);
    if (isWindows) {
      const psAuditCmd = `Get-ChildItem -Path "${item.path}" -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum`;
      lines.push(`- **Read-Only PowerShell Size Audit**: \`${psAuditCmd}\``);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function isRunningUnderTest(): boolean {
  return (
    Boolean(process.env.NODE_TEST_CONTEXT) ||
    process.env.NODE_ENV === "test" ||
    process.argv.some((arg) => /(?:^--test$|\.(?:test|spec)\.[cm]?[jt]sx?$)/i.test(arg))
  );
}

export function syncStaticLlmsTxtFile(
  store: SeoStore,
  options?: { force?: boolean }
): { ok: boolean; path: string; bytes: number } {
  const content = renderLlmsTxt(store);
  if (!isRunningUnderTest() || options?.force === true) {
    try {
      writeFileSync(PUBLIC_LLMS_TXT_PATH, content, "utf8");
    } catch {
      /* ignore read-only fs in restricted containers */
    }
  }
  return {
    ok: true,
    path: PUBLIC_LLMS_TXT_PATH,
    bytes: Buffer.byteLength(content, "utf8"),
  };
}

/**
 * A15: Normalizes static `/vs/:competitor` and `/alternatives/:competitor` HTML pages so binary size,
 * device count, and pricing never drift from canonical brand facts.
 */
export function normalizeCompetitorHtmlClaims(rawHtml: string, slug: string, pricingSummaryText?: string): string {
  const facts = getCanonicalBrandFacts();
  let html = rawHtml
    .replace(/~?\s*12\s*MB\s*[-–]\s*14\s*MB/gi, facts.binarySizeLabel)
    .replace(/<\s*15\s*MB\s+download/gi, `${facts.binarySizeLabel} native Rust download`)
    .replace(/under\s+15\s*MB/gi, `${facts.binarySizeLabel} native binary`)
    .replace(/\b40\+\s*Guides\b/gi, `${facts.totalGuides} Curated Guides`)
    .replace(/up to 3 Desktop PCs/gi, `up to ${facts.deviceLimit} Devices`);

  if (pricingSummaryText) {
    html = html.replace(/£49\.99\/yr\s*\(Save\s*58%\),\s*£38\.99\/6mo,\s*or\s*£9\.99\/mo/g, pricingSummaryText);
  }

  if (!html.includes('id="switcher-interactive-audit-cta"')) {
    const cleanCompetitorName = slug
      .replace(/\.html$/i, "")
      .split("-")
      .map((w) => {
        const lw = w.toLowerCase();
        if (lw === "ccleaner") return "CCleaner";
        if (lw === "cleanmypc") return "CleanMyPC";
        if (lw === "cleanmymac") return "CleanMyMac";
        if (lw === "bleachbit") return "BleachBit";
        if (lw === "pearcleaner") return "Pearcleaner";
        if (lw === "onyx") return "OnyX";
        if (lw === "daisydisk") return "DaisyDisk";
        return w.charAt(0).toUpperCase() + w.slice(1);
      })
      .join(" ");

    const normalizedSlug = slug.replace(/\.html$/i, "").toLowerCase();
    const isMacCompetitor =
      normalizedSlug === "cleanmymac" ||
      normalizedSlug === "pearcleaner" ||
      normalizedSlug === "daisydisk" ||
      normalizedSlug === "onyx";

    const ctaBlock = isMacCompetitor
      ? `
    <section id="switcher-interactive-audit-cta" class="ed-section ed-card-muted">
      <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:16px;">
        <div style="max-width:580px;">
          <div class="ed-kpi-label" style="color:var(--accent);">Switching from ${cleanCompetitorName}? &middot; ${facts.binarySizeLabel} Native Rust &middot; ${facts.deviceLimit} Devices</div>
          <h2 class="ed-h2" style="margin-bottom:6px;">Inspect Your Mac ~/Library/Caches &amp; System Data Before Installing</h2>
          <p style="font-size:0.92rem;color:var(--muted);">
            Review our macOS System Data cleanup walkthrough, test cross-platform paths in the Safe-to-Delete Checker, or estimate multi-app cache bloat in the Cache Calculator.
          </p>
        </div>
        <div class="ed-actions" style="margin-top:0;">
          <a href="/clean/mac/system-data-huge" class="ed-btn-primary btn-press">Mac System Data Guide &rarr;</a>
          <a href="/safe-to-delete" class="ed-btn-secondary btn-press">Path Safety Checker</a>
          <a href="/tools/pc-cache-calculator" class="ed-btn-secondary btn-press">Cache Calculator</a>
        </div>
      </div>
    </section>`
      : `
    <section id="switcher-interactive-audit-cta" class="ed-section ed-card-muted">
      <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:16px;">
        <div style="max-width:580px;">
          <div class="ed-kpi-label" style="color:var(--accent);">Switching from ${cleanCompetitorName}? &middot; ${facts.binarySizeLabel} Native Rust &middot; ${facts.deviceLimit} Devices</div>
          <h2 class="ed-h2" style="margin-bottom:6px;">Audit Suspicious Windows Folders Before Installing</h2>
          <p style="font-size:0.92rem;color:var(--muted);">
            Test paths against our audited cache rules in the browser Safe-to-Delete Checker, or inspect the 2026 State of Windows Storage empirical benchmark.
          </p>
        </div>
        <div class="ed-actions" style="margin-top:0;">
          <a href="/safe-to-delete" class="ed-btn-primary btn-press">Open Path Checker &rarr;</a>
          <a href="/state-of-windows-storage" class="ed-btn-secondary btn-press">2026 Storage Study</a>
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
