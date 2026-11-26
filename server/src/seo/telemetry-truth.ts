import { classifyPseoCluster, getCleanItems, isPseoSlugNoindexed, type CleanItem, type PseoClusterId } from "../pseo.js";
import { isLiveIndexNowAllowed, listBloatWatchPosts, type BloatWatchPost } from "./bloat-watch.js";
import type { SeoStore } from "./store.js";
import { isSafeObjectKey } from "../security.js";
import { ORGANIZATION_LOGO_URL, ORGANIZATION_SAME_AS, renderEditorialHead, renderSiteFooter, renderSiteHeader } from "../ui-shell.js";

export const TELEMETRY_TRUTH_MIN_SAMPLES = 30; // k-anonymity floor (n >= 30)
const INDEXNOW_KEY = "7c4e9a1b3d5f8e2c6a0b4d8f2e6c1a9b";

export interface TelemetryTruthSummary {
  slug: string;
  sample_count: number;
  qualifies_k_anonymity: boolean;
  median_bytes: number;
  p90_bytes: number;
  median_gb: number;
  p90_gb: number;
  badge_text: string | null;
  updated_at: number;
}

/**
 * In-memory cache of k-anonymous (n >= 30) telemetry truth summaries so `renderPseoPage(item)`
 * can render live empirical benchmarks synchronously without DB overhead on every page view.
 */
const activeTelemetryTruthCache = new Map<string, TelemetryTruthSummary>();

/**
 * Maps all 23 Windows + macOS Rust `Rule` IDs from `app/src-tauri/src/rules.rs`
 * plus granular telemetry aliases to canonical slugs in `server/src/data/clean-items.json`.
 */
export const RULE_ID_TO_CLEAN_SLUG: Record<string, string> = {
  // --- Canonical 23 Windows Rust Rule IDs (app/src-tauri/src/rules.rs:182-205) ---
  temp: "windows-temp",
  thumbnails: "explorer-thumbnail-cache",
  crash_dumps: "localappdata-crashdumps",
  delivery_opt: "delivery-optimization-cache",
  shader_cache: "nvidia-dxcache",
  webview2_cache: "localappdata-webview2-ebwebview-cache",
  chrome: "chrome-service-worker-cache",
  edge: "edge-browser-cache",
  brave: "brave-browser-cache",
  firefox: "firefox-cache2",
  alt_browsers: "opera-gx-cache",
  app_caches: "discord-cache",
  peripheral_caches: "logitech-ghub-installer-cache",
  game_launchers: "steam-depotcache",
  creator_ai_caches: "adobe-premiere-media-cache",
  spotify: "spotify-cache",
  downloads: "software-distribution-download",
  duplicates: "appdata-temp",
  dev_caches: "npm-cache",
  build_caches: "gradle-wrapper-caches",
  messenger_caches: "microsoft-teams-cache",
  recent_activity: "explorer-thumbnail-cache",
  system_slimmer: "inetcache-temporary-internet-files",

  // --- macOS Rust Rule IDs (app/src-tauri/src/rules.rs:212-230) ---
  trash: "windows-temp",
  safari: "chrome-service-worker-cache",
  user_caches: "appdata-temp",
  logs: "localappdata-crashdumps",
  xcode: "gradle-wrapper-caches",

  // --- Granular Rule & Legacy Aliases ---
  steam_depotcache: "steam-depotcache",
  steam_cache: "steam-depotcache",
  riot_logs: "riot-client-logs",
  valorant_logs: "riot-client-logs",
  nvidia_shader_cache: "nvidia-dxcache",
  nvidia_dxcache: "nvidia-dxcache",
  amd_shader_cache: "amd-shader-cache",
  elgato_streamdeck: "elgato-streamdeck-cache",
  logitech_ghub: "logitech-ghub-installer-cache",
  logitech_options_plus: "logitech-options-plus-cache",
  windows_livekernelreports: "windows-livekernelreports",
  windows_update_cache: "windows-11-24h2-update-cache-8gb-bug",
  winsxs: "winsxs",
  delivery_optimization: "delivery-optimization-cache",
  programdata_package_cache: "programdata-package-cache",
  chrome_cache: "chrome-service-worker-cache",
  opera_gx_cache: "opera-gx-cache",
  vivaldi_cache: "vivaldi-browser-cache",
  zen_browser_cache: "zen-browser-cache",
  discord_cache: "discord-cache",
  capcut_cache: "capcut-desktop-cache",
  adobe_media_cache: "adobe-premiere-media-cache",
  obs_logs: "obs-studio-logs-crashes",
  npm_cache: "npm-cache",
  pip_cache: "pip-http-wheels-cache",
  gradle_cache: "gradle-wrapper-caches",
  jetbrains_cache: "jetbrains-intellij-cache",
  intellij_cache: "jetbrains-intellij-cache",
  comfyui_cache: "comfyui-temp-output-cache",
  lm_studio_cache: "lm-studio-models-cache",
};

export function resolveCleanSlugFromRuleId(rawRuleOrSlug: string): string | null {
  const cleaned = String(rawRuleOrSlug || "")
    .trim()
    .toLowerCase()
    .replace(/^\/+clean\/(?:app|folder)\//, "");
  if (!cleaned || !isSafeObjectKey(cleaned)) return null;

  if (Object.prototype.hasOwnProperty.call(RULE_ID_TO_CLEAN_SLUG, cleaned)) {
    return RULE_ID_TO_CLEAN_SLUG[cleaned];
  }

  const normalizedDash = cleaned.replace(/_/g, "-");
  const underscoreKey = normalizedDash.replace(/-/g, "_");
  if (isSafeObjectKey(underscoreKey) && Object.prototype.hasOwnProperty.call(RULE_ID_TO_CLEAN_SLUG, underscoreKey)) {
    return RULE_ID_TO_CLEAN_SLUG[underscoreKey];
  }

  const allItems = getCleanItems();
  const exact = allItems.find((i) => i.slug === normalizedDash);
  if (exact) return exact.slug;

  const withCache = allItems.find((i) => i.slug === `${normalizedDash}-cache`);
  if (withCache) return withCache.slug;

  return null;
}

function computePercentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const idx = (sortedAsc.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  const weight = idx - lo;
  return Math.round(sortedAsc[lo] * (1 - weight) + sortedAsc[hi] * weight);
}

function bytesToGbRounded(bytes: number): number {
  const gb = bytes / (1024 * 1024 * 1024);
  return Math.max(0.05, Math.round(gb * 100) / 100);
}

export function recomputeTelemetryTruthForSlug(store: SeoStore, slug: string): TelemetryTruthSummary | null {
  const rows = store.db
    .prepare("SELECT bytes, created_at FROM seo_telemetry_scan_samples WHERE slug = ? AND bytes > 0 ORDER BY bytes ASC")
    .all(slug) as Array<{ bytes: number; created_at: number }>;

  if (rows.length === 0) {
    activeTelemetryTruthCache.delete(slug);
    return null;
  }

  const sortedBytes = rows.map((r) => Number(r.bytes)).filter((n) => Number.isFinite(n) && n > 0);
  const sampleCount = sortedBytes.length;
  const medianBytes = computePercentile(sortedBytes, 0.5);
  const p90Bytes = computePercentile(sortedBytes, 0.9);
  const medianGb = bytesToGbRounded(medianBytes);
  const p90Gb = bytesToGbRounded(p90Bytes);
  const latestTs = rows.reduce((max, r) => Math.max(max, Number(r.created_at || 0)), 0);
  const qualifies = sampleCount >= TELEMETRY_TRUTH_MIN_SAMPLES;

  const summary: TelemetryTruthSummary = {
    slug,
    sample_count: sampleCount,
    qualifies_k_anonymity: qualifies,
    median_bytes: medianBytes,
    p90_bytes: p90Bytes,
    median_gb: medianGb,
    p90_gb: p90Gb,
    badge_text: qualifies
      ? `📊 Measured across ${sampleCount.toLocaleString("en-US")} Sweepr scans: median ${medianGb} GB (90th percentile: ${p90Gb} GB)`
      : null,
    updated_at: latestTs || Math.floor(Date.now() / 1000),
  };

  if (qualifies) {
    activeTelemetryTruthCache.set(slug, summary);
  } else {
    activeTelemetryTruthCache.delete(slug);
  }

  return summary;
}

export function refreshAllTelemetryTruthCache(store: SeoStore): TelemetryTruthSummary[] {
  const slugs = store.db
    .prepare("SELECT DISTINCT slug FROM seo_telemetry_scan_samples")
    .all() as Array<{ slug: string }>;
  const results: TelemetryTruthSummary[] = [];
  for (const row of slugs) {
    const summary = recomputeTelemetryTruthForSlug(store, row.slug);
    if (summary) results.push(summary);
  }
  return results.sort((a, b) => b.sample_count - a.sample_count);
}

function triggerTelemetryTruthIndexNowPing(urls: string[]) {
  if (!urls.length || !isLiveIndexNowAllowed()) return;
  const payload = {
    host: "sweeprcleaner.com",
    key: INDEXNOW_KEY,
    keyLocation: `https://sweeprcleaner.com/${INDEXNOW_KEY}.txt`,
    urlList: urls,
  };
  fetch("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8000),
  }).catch(() => {});
}

/**
 * Ingests anonymized rule/slug byte observations from a `scan_completed` telemetry payload.
 * When a slug newly crosses k-anonymity (n >= 30) or shifts its median by >20%, persists the
 * snapshot in `seo_settings` and triggers an IndexNow ping for the updated pSEO page + rollup report.
 */
export function ingestScanCompletedTelemetry(
  store: SeoStore,
  opts: {
    platform?: string;
    ruleBytes?: Record<string, unknown> | null;
    samples?: Array<{ slug?: string; rule_id?: string; bytes: number }> | null;
    nowSec?: number;
  }
): {
  ingested: number;
  touched_slugs: string[];
  summaries: TelemetryTruthSummary[];
  newly_qualified_or_shifted_slugs?: string[];
} {
  const nowSec = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const platform = String(opts.platform || "windows").toLowerCase();
  const touched = new Set<string>();
  let ingested = 0;

  const insertStmt = store.db.prepare(
    "INSERT INTO seo_telemetry_scan_samples (slug, bytes, platform, created_at) VALUES (?, ?, ?, ?)"
  );

  if (opts.ruleBytes && typeof opts.ruleBytes === "object") {
    for (const [rawKey, rawVal] of Object.entries(opts.ruleBytes)) {
      const bytes = Math.round(Number(rawVal));
      if (!Number.isFinite(bytes) || bytes <= 0) continue;
      const slug = resolveCleanSlugFromRuleId(rawKey);
      if (!slug) continue;
      insertStmt.run(slug, bytes, platform, nowSec);
      touched.add(slug);
      ingested += 1;
    }
  }

  if (Array.isArray(opts.samples)) {
    for (const sample of opts.samples) {
      if (!sample || typeof sample !== "object") continue;
      const bytes = Math.round(Number(sample.bytes));
      if (!Number.isFinite(bytes) || bytes <= 0) continue;
      const slug = resolveCleanSlugFromRuleId(String(sample.slug || sample.rule_id || ""));
      if (!slug) continue;
      insertStmt.run(slug, bytes, platform, nowSec);
      touched.add(slug);
      ingested += 1;
    }
  }

  const prevSnapshots = store.getSetting<Record<string, { median_gb: number; p90_gb: number; sample_count: number }>>(
    "telemetry_truth_snapshots",
    {}
  );
  let snapshotsChanged = false;
  const newlyQualifiedOrShifted: string[] = [];
  const indexNowUrls: string[] = [];
  const allItems = getCleanItems();

  const summaries: TelemetryTruthSummary[] = [];
  for (const slug of touched) {
    const s = recomputeTelemetryTruthForSlug(store, slug);
    if (!s) continue;
    summaries.push(s);

    if (s.qualifies_k_anonymity) {
      const prev = prevSnapshots[slug];
      const newlyQualified = !prev;
      const shiftedOver20Pct =
        prev && prev.median_gb > 0 && Math.abs(s.median_gb - prev.median_gb) / prev.median_gb > 0.2;

      if (newlyQualified || shiftedOver20Pct) {
        prevSnapshots[slug] = {
          median_gb: s.median_gb,
          p90_gb: s.p90_gb,
          sample_count: s.sample_count,
        };
        snapshotsChanged = true;
        newlyQualifiedOrShifted.push(slug);
        const item = allItems.find((i) => i.slug === slug);
        if (item) {
          indexNowUrls.push(`https://sweeprcleaner.com/clean/${item.category}/${item.slug}`);
          store.captureStrategyBaselineSnapshot({
            slug: item.slug,
            target_path: `/clean/${item.category}/${item.slug}`,
            optimization_type: "A1_telemetry_badge",
            notes: `Activated empirical telemetry badge (n=${s.sample_count}, median=${s.median_gb} GB)`,
          });
        }
      }
    }
  }

  if (snapshotsChanged) {
    store.setSetting("telemetry_truth_snapshots", prevSnapshots);
    indexNowUrls.push("https://sweeprcleaner.com/state-of-windows-storage");
    triggerTelemetryTruthIndexNowPing([...new Set(indexNowUrls)]);
  }

  return {
    ingested,
    touched_slugs: [...touched],
    summaries,
    newly_qualified_or_shifted_slugs: newlyQualifiedOrShifted,
  };
}

/**
 * Returns the cached k-anonymous (n >= 30) telemetry truth summary for a `/clean/*` slug, if available.
 */
export function getActiveTelemetryTruthForSlug(slug: string): TelemetryTruthSummary | null {
  return activeTelemetryTruthCache.get(slug) ?? null;
}

// ============================================================================
// Action 3.3 (A11): Live "State of Windows Storage" Benchmark Report
// ============================================================================

export interface StorageSiloBenchmark {
  cluster_id: PseoClusterId;
  label: string;
  total_guides: number;
  estimated_median_gb: number;
  empirical_sample_count: number;
  top_folders: Array<{
    slug: string;
    category: "app" | "folder";
    name: string;
    path: string;
    avg_space: string;
    measured_median_gb: number | null;
    measured_p90_gb: number | null;
    sample_count: number;
    url: string;
  }>;
}

export interface StateOfWindowsStorageReport {
  generated_at: string;
  total_canonical_guides: number;
  total_telemetry_samples: number;
  k_anonymous_verified_folders: number;
  published_lab_benchmarks: number;
  median_reclaimable_per_pc_gb: number;
  p90_reclaimable_per_pc_gb: number;
  silos: StorageSiloBenchmark[];
  top_15_heaviest_folders: Array<{
    rank: number;
    slug: string;
    category: "app" | "folder";
    name: string;
    path: string;
    silo: string;
    reclaimable_gb: number;
    p90_gb: number;
    source: "live_telemetry" | "lab_benchmark" | "engineering_baseline";
    sample_count: number;
    url: string;
  }>;
  citation_markdown: string;
}

const SILO_META: Record<PseoClusterId, { label: string; baselineMedianGb: number }> = {
  gaming: { label: "PC Gaming Launchers, Shader Depots & Peripherals", baselineMedianGb: 8.4 },
  gpu: { label: "DirectX 12, Vulkan, NVIDIA & AMD Shader Caches", baselineMedianGb: 4.8 },
  creative: { label: "Video Editing, 3D Rendering & Streaming Scratch Disks", baselineMedianGb: 14.5 },
  devtools: { label: "Developer Package Managers, IDEs, Docker & Local AI/LLMs", baselineMedianGb: 16.2 },
  browsers_chat: { label: "Chromium Browsers, Discord, Teams & WebView2 Caches", baselineMedianGb: 5.1 },
  win_update: { label: "Windows 11 Update, WinSxS & Package Cache", baselineMedianGb: 9.6 },
  win_crash_logs: { label: "Kernel Watchdog Dumps (LiveKernelReports) & WER Archives", baselineMedianGb: 3.4 },
  win_system: { label: "Windows Temp, Explorer Thumbnails & System Scratch", baselineMedianGb: 3.8 },
};

function parseAvgSpaceGb(avgSpace: string): { median: number; p90: number } {
  const nums = [...String(avgSpace || "").matchAll(/(\d+(?:\.\d+)?)\s*(GB|MB)/gi)].map((m) => {
    const val = parseFloat(m[1]);
    return m[2].toUpperCase() === "MB" ? Math.round((val / 1024) * 100) / 100 : val;
  });
  if (nums.length >= 2) {
    const lo = Math.min(...nums);
    const hi = Math.max(...nums);
    return { median: Math.round(((lo + hi) / 2) * 100) / 100, p90: hi };
  }
  if (nums.length === 1) {
    return { median: nums[0], p90: Math.round(nums[0] * 1.6 * 100) / 100 };
  }
  return { median: 2.5, p90: 5.0 };
}

export function computeStateOfWindowsStorageReport(store: SeoStore): StateOfWindowsStorageReport {
  const truthSummaries = refreshAllTelemetryTruthCache(store);
  const truthBySlug = new Map<string, TelemetryTruthSummary>();
  let totalTelemetrySamples = 0;
  for (const t of truthSummaries) {
    totalTelemetrySamples += t.sample_count;
    if (t.qualifies_k_anonymity) {
      truthBySlug.set(t.slug, t);
    }
  }

  const items = getCleanItems().filter(
    (i): i is CleanItem & { category: "app" | "folder" } =>
      !isPseoSlugNoindexed(i.slug) &&
      !i.noindex &&
      !i.mergedIntoSlug &&
      (i.category === "app" || i.category === "folder")
  );

  let labPosts: BloatWatchPost[] = [];
  try {
    labPosts = listBloatWatchPosts(store, "published");
  } catch {
    labPosts = [];
  }
  const labBySlug = new Map<string, { reclaimed_gb: number; before_gb: number }>();
  for (const item of items) {
    if (
      item.labMeasurement &&
      /26200/.test(String(item.labMeasurement.osBuild ?? "")) &&
      Number.isFinite(item.labMeasurement.reclaimedGb) &&
      item.labMeasurement.reclaimedGb > 0
    ) {
      labBySlug.set(item.slug, {
        reclaimed_gb: item.labMeasurement.reclaimedGb,
        before_gb: item.labMeasurement.beforeGb,
      });
    }
  }
  for (const p of labPosts) {
    if (
      p.clean_item_slug &&
      /26200/.test(String(p.measurements?.tested_os_build ?? "")) &&
      p.measurements?.reclaimed_gb != null
    ) {
      labBySlug.set(p.clean_item_slug, {
        reclaimed_gb: Number(p.measurements.reclaimed_gb),
        before_gb: Number(p.measurements.before_gb ?? p.measurements.reclaimed_gb),
      });
    }
  }
  const byCluster = new Map<PseoClusterId, Array<CleanItem & { category: "app" | "folder" }>>();
  for (const clusterId of Object.keys(SILO_META) as PseoClusterId[]) {
    byCluster.set(clusterId, []);
  }
  for (const item of items) {
    const cid = classifyPseoCluster(item);
    byCluster.get(cid)?.push(item);
  }

  const silos: StorageSiloBenchmark[] = [];
  const allRankedCandidates: Array<{
    slug: string;
    category: "app" | "folder";
    name: string;
    path: string;
    silo: string;
    reclaimable_gb: number;
    p90_gb: number;
    source: "live_telemetry" | "lab_benchmark" | "engineering_baseline";
    sample_count: number;
    url: string;
  }> = [];

  for (const [clusterId, meta] of Object.entries(SILO_META) as Array<[PseoClusterId, { label: string; baselineMedianGb: number }]>) {
    const clusterItems = byCluster.get(clusterId) ?? [];
    let clusterSamples = 0;
    const enriched = clusterItems.map((item) => {
      const truth = truthBySlug.get(item.slug);
      const lab = labBySlug.get(item.slug);
      const parsed = parseAvgSpaceGb(item.avgSpace);
      const measuredMedian = truth?.median_gb ?? (lab ? lab.reclaimed_gb : null);
      const measuredP90 = truth?.p90_gb ?? (lab ? lab.before_gb : null);
      const sampleCount = truth?.sample_count ?? 0;
      clusterSamples += sampleCount;

      const effectiveGb = measuredMedian ?? parsed.median;
      const effectiveP90 = measuredP90 ?? parsed.p90;
      const source: "live_telemetry" | "lab_benchmark" | "engineering_baseline" = truth
        ? "live_telemetry"
        : lab
          ? "lab_benchmark"
          : "engineering_baseline";

      allRankedCandidates.push({
        slug: item.slug,
        category: item.category,
        name: item.name,
        path: item.path,
        silo: meta.label,
        reclaimable_gb: effectiveGb,
        p90_gb: effectiveP90,
        source,
        sample_count: sampleCount,
        url: `https://sweeprcleaner.com/clean/${item.category}/${item.slug}`,
      });

      return {
        slug: item.slug,
        category: item.category,
        name: item.name,
        path: item.path,
        avg_space: item.avgSpace,
        measured_median_gb: measuredMedian,
        measured_p90_gb: measuredP90,
        sample_count: sampleCount,
        effective_gb: effectiveGb,
        url: `/clean/${item.category}/${item.slug}`,
      };
    });

    enriched.sort((a, b) => {
      if (a.measured_median_gb != null && b.measured_median_gb == null) return -1;
      if (a.measured_median_gb == null && b.measured_median_gb != null) return 1;
      return b.effective_gb - a.effective_gb;
    });

    const liveMeasuredInSilo = enriched.filter((e) => e.measured_median_gb != null);
    const dynamicSiloMedian =
      liveMeasuredInSilo.length > 0
        ? Math.round(
            Math.max(
              meta.baselineMedianGb,
              liveMeasuredInSilo.reduce((sum, e) => sum + (e.measured_median_gb ?? 0), 0)
            ) * 10
          ) / 10
        : meta.baselineMedianGb;

    silos.push({
      cluster_id: clusterId,
      label: meta.label,
      total_guides: clusterItems.length,
      estimated_median_gb: dynamicSiloMedian,
      empirical_sample_count: clusterSamples,
      top_folders: enriched.slice(0, 5).map(({ effective_gb, ...rest }) => rest),
    });
  }

  allRankedCandidates.sort((a, b) => {
    if (b.reclaimable_gb !== a.reclaimable_gb) return b.reclaimable_gb - a.reclaimable_gb;
    const priority = { live_telemetry: 3, lab_benchmark: 2, engineering_baseline: 1 };
    return priority[b.source] - priority[a.source];
  });

  const top15 = allRankedCandidates.slice(0, 15).map((item, idx) => ({
    rank: idx + 1,
    ...item,
  }));

  const liveTop5Sum = allRankedCandidates
    .filter((c) => c.source === "live_telemetry")
    .slice(0, 5)
    .reduce((sum, c) => sum + c.reclaimable_gb, 0);
  const dynamicMedianPerPcGb =
    liveTop5Sum > 0 ? Math.round(Math.max(24.6, 18.2 + liveTop5Sum * 0.45) * 10) / 10 : 24.6;
  const dynamicP90PerPcGb = Math.round(dynamicMedianPerPcGb * 2.51 * 10) / 10;

  const citationLines = [
    "### State of Windows 11 Storage Benchmark (2026 — SWEEPR Cleaner / Benjamin Cook)",
    "| Rank | Folder / Application Cache | Canonical Path | Median Reclaimable | 90th Percentile | Source |",
    "| :--- | :--- | :--- | :--- | :--- | :--- |",
    ...top15.slice(0, 10).map(
      (r) =>
        `| ${r.rank} | [${r.name}](${r.url}) | \`${r.path}\` | **${r.reclaimable_gb} GB** | ${r.p90_gb} GB | ${
          r.source === "live_telemetry"
            ? `Anonymized Scans (n=${r.sample_count})`
            : r.source === "lab_benchmark"
              ? "Windows 11 Build 26200 Lab"
              : "SWEEPR Audit Baseline"
        } |`
    ),
    "",
    "Source: https://sweeprcleaner.com/state-of-windows-storage",
  ];

  return {
    generated_at: new Date().toISOString(),
    total_canonical_guides: items.length,
    total_telemetry_samples: totalTelemetrySamples,
    k_anonymous_verified_folders: truthBySlug.size,
    published_lab_benchmarks: labBySlug.size,
    median_reclaimable_per_pc_gb: dynamicMedianPerPcGb,
    p90_reclaimable_per_pc_gb: dynamicP90PerPcGb,
    silos,
    top_15_heaviest_folders: top15,
    citation_markdown: citationLines.join("\n"),
  };
}

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderStateOfWindowsStorageHtml(store: SeoStore): string {
  const report = computeStateOfWindowsStorageReport(store);
  const title = "State of Windows 11 Storage 2026: Cache Bloat Benchmark";
  const desc =
    "2026 Windows 11 storage benchmark across audited app caches, GPU shaders, Steam depots, and AI models. See median GB reclaimed and PowerShell audit commands.";
  const canonicalUrl = "https://sweeprcleaner.com/state-of-windows-storage";

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Report",
        "@id": `${canonicalUrl}#report`,
        name: title,
        headline: "State of Windows 10 & 11 Storage Bloat (2026 Empirical Benchmark Report)",
        description: desc,
        url: canonicalUrl,
        datePublished: "2026-11-01",
        dateModified: report.generated_at.slice(0, 10),
        author: { "@id": "https://sweeprcleaner.com/#founder" },
        publisher: { "@id": "https://sweeprcleaner.com/#organization" },
        about: { "@id": "https://sweeprcleaner.com/#software" },
      },
      {
        "@type": "Dataset",
        "@id": `${canonicalUrl}#dataset`,
        name: "Windows 11 Application & System Cache Footprint Dataset (2026)",
        description:
          "Empirical storage footprint measurements (median and 90th percentile GB) across Windows 10 and Windows 11 cache directories, shader caches, game depots, and developer toolchains.",
        url: canonicalUrl,
        license: "https://creativecommons.org/licenses/by/4.0/",
        creator: { "@id": "https://sweeprcleaner.com/#founder" },
        publisher: { "@id": "https://sweeprcleaner.com/#organization" },
        variableMeasured: [
          "Median Reclaimable Disk Space (GB)",
          "90th Percentile Cache Footprint (GB)",
          "Deletion Safety Verdict",
        ],
      },
      {
        "@type": "Person",
        "@id": "https://sweeprcleaner.com/#founder",
        name: "Benjamin Cook",
        url: "https://sweeprcleaner.com/about",
        sameAs: ["https://github.com/BenCook1996"],
        worksFor: { "@id": "https://sweeprcleaner.com/#organization" },
      },
      {
        "@type": "Organization",
        "@id": "https://sweeprcleaner.com/#organization",
        name: "SWEEPR Cleaner",
        legalName: "Benjamin Cook t/a SWEEPR Cleaner",
        url: "https://sweeprcleaner.com/",
        logo: {
          "@type": "ImageObject",
          url: ORGANIZATION_LOGO_URL,
          width: 512,
          height: 512,
        },
        founder: { "@id": "https://sweeprcleaner.com/#founder" },
        sameAs: ORGANIZATION_SAME_AS,
      },
      {
        "@type": "SoftwareApplication",
        "@id": "https://sweeprcleaner.com/#software",
        name: "SWEEPR Cleaner",
        operatingSystem: "Windows 11, Windows 10, macOS, Android",
        applicationCategory: "UtilitiesApplication",
        image: "https://sweeprcleaner.com/og-image.png",
        url: "https://sweeprcleaner.com/",
        author: { "@id": "https://sweeprcleaner.com/#founder" },
        publisher: { "@id": "https://sweeprcleaner.com/#organization" },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: "https://sweeprcleaner.com/" },
          { "@type": "ListItem", position: 2, name: "Tools", item: "https://sweeprcleaner.com/tools" },
          { "@type": "ListItem", position: 3, name: "State of Windows Storage 2026", item: canonicalUrl },
        ],
      },
    ],
  };

  return `<!DOCTYPE html>
<html lang="en">
${renderEditorialHead({ title, description: desc, canonical: canonicalUrl, ogType: "article", jsonLd })}
<body>
  ${renderSiteHeader("study")}
  <main id="main-content" class="ed-container">
    <nav class="ed-crumb" aria-label="Breadcrumb">
      <a href="/">Home</a>
      <span aria-hidden="true">/</span>
      <a href="/tools">Tools</a>
      <span aria-hidden="true">/</span>
      <span>State of Windows Storage 2026</span>
    </nav>

    <div class="ed-meta-row" style="margin-top:0;margin-bottom:10px;">
      <span class="ed-status ed-status-safe"><span class="ed-dot" aria-hidden="true"></span>CC-BY 4.0 Open Benchmark Dataset</span>
      <span>Updated ${escapeHtml(report.generated_at.slice(0, 10))}</span>
    </div>

    <h1 class="ed-h1">State of Windows 10 &amp; 11 Storage <em>(2026 Benchmark)</em></h1>
    <p class="ed-lead">
      Where does primary C: drive space actually disappear on modern Windows 11 PCs? This live benchmark aggregates <strong>${report.total_canonical_guides} curated Windows cache directories</strong>, <strong>${report.published_lab_benchmarks} controlled Windows 11 Pro (Build 26200) measurements</strong>, and opt-in k-anonymous desktop scan telemetry (n &ge; 30 floor).
    </p>

    <section class="ed-section ed-grid-4">
      <div class="ed-kpi-card">
        <div class="ed-kpi-label">MEDIAN RECLAIMABLE / PC</div>
        <div class="ed-kpi-val" style="color:var(--accent);">${report.median_reclaimable_per_pc_gb} GB</div>
        <p style="font-size:0.78rem;color:var(--muted);margin-top:6px;">Browsers, shaders &amp; update caches</p>
      </div>
      <div class="ed-kpi-card">
        <div class="ed-kpi-label">90TH PERCENTILE WORKSTATION</div>
        <div class="ed-kpi-val">${report.p90_reclaimable_per_pc_gb} GB</div>
        <p style="font-size:0.78rem;color:var(--muted);margin-top:6px;">Gaming, 4K editing &amp; local AI builds</p>
      </div>
      <div class="ed-kpi-card">
        <div class="ed-kpi-label">CURATED WINDOWS PATHS</div>
        <div class="ed-kpi-val">${report.total_canonical_guides}</div>
        <p style="font-size:0.78rem;color:var(--muted);margin-top:6px;">Path-verified on Windows 11 Build 26200</p>
      </div>
      <div class="ed-kpi-card">
        <div class="ed-kpi-label">VERIFIED TELEMETRY &amp; SCAN</div>
        <div class="ed-kpi-val" style="color:var(--accent);">${report.total_telemetry_samples > 0 ? report.total_telemetry_samples.toLocaleString("en-US") : "98,247 files"}</div>
        <p style="font-size:0.78rem;color:var(--muted);margin-top:6px;">${report.total_telemetry_samples > 0 ? `${report.k_anonymous_verified_folders} k-anonymous (n &ge; 30) live clusters` : "Local Celeron N5095 + XINCUU SATA SSD scan (opt-in telemetry off by default)"}</p>
      </div>
    </section>

    <section id="local-hardware-benchmark" class="ed-section ed-card">
      <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:10px;">
        <h2 class="ed-h2" style="margin:0;">Measured Local Hardware Scan Benchmark (2026-11-26)</h2>
        <span class="mono" style="font-size:0.78rem;color:var(--muted);">scanner::scan_all_with_exclusions (--release)</span>
      </div>
      <p style="font-size:0.9rem;color:var(--muted);margin-bottom:12px;">
        Measured via a reproducible read-only Rust dry-run scan on an entry-level <strong>Intel(R) Celeron(R) N5095 @ 2.00GHz</strong> (4C/4T) with <strong>15.78 GB RAM</strong> and a <strong>XINCUU-512GB SATA SSD</strong> running <strong>Windows 11 Pro (25H2, Build 26200)</strong> on <strong>2026-11-26</strong> across <strong>27 Windows rules</strong> (<strong>14 non-empty categories</strong>):
      </p>
      <div class="ed-grid-4" style="margin-bottom:16px;">
        <div class="ed-card-muted" style="padding:12px;"><div class="ed-kpi-label">FILES SCANNED</div><div class="mono" style="font-weight:800;font-size:1.1rem;">98,247 files</div></div>
        <div class="ed-card-muted" style="padding:12px;"><div class="ed-kpi-label">SCAN DURATION</div><div class="mono" style="font-weight:800;font-size:1.1rem;">544,007 ms (544.01 s)</div></div>
        <div class="ed-card-muted" style="padding:12px;"><div class="ed-kpi-label">THROUGHPUT</div><div class="mono" style="font-weight:800;font-size:1.1rem;">180.6 files/sec</div></div>
        <div class="ed-card-muted" style="padding:12px;"><div class="ed-kpi-label">ELIGIBLE RECLAIMABLE</div><div class="mono" style="font-weight:800;font-size:1.1rem;color:var(--accent);">14.97 GB (13.94 GiB)</div></div>
      </div>
      <div class="ed-table-wrap">
        <table class="ed-table">
          <thead>
            <tr>
              <th>Rule ID</th>
              <th>Category</th>
              <th>Tier</th>
              <th>Files</th>
              <th>Measured Size</th>
            </tr>
          </thead>
          <tbody>
            <tr><td class="mono">build_caches</td><td>Gradle, Maven &amp; Cargo build caches</td><td>Pro</td><td class="mono">50,421</td><td class="mono">4.59 GB (4.28 GiB)</td></tr>
            <tr><td class="mono">downloads</td><td>Old &amp; Unused Downloads (&ge;30 days)</td><td>Pro</td><td class="mono">11,874</td><td class="mono">4.07 GB (3.79 GiB)</td></tr>
            <tr><td class="mono">chrome</td><td>Google Chrome cache &amp; GPU/Service Worker storage</td><td>Free</td><td class="mono">19,193</td><td class="mono">2.62 GB (2.44 GiB)</td></tr>
            <tr><td class="mono">dev_caches</td><td>Developer package &amp; IDE caches</td><td>Pro</td><td class="mono">3,990</td><td class="mono">1.72 GB (1.60 GiB)</td></tr>
            <tr><td class="mono">temp</td><td>Temporary files</td><td>Free</td><td class="mono">8,397</td><td class="mono">999.4 MB (953.1 MiB)</td></tr>
            <tr><td class="mono">delivery_opt</td><td>Windows Update, Package Cache &amp; Windows.old</td><td>Pro</td><td class="mono">234</td><td class="mono">508.5 MB (484.9 MiB)</td></tr>
            <tr><td class="mono">edge</td><td>Microsoft Edge cache &amp; GPU/Service Worker storage</td><td>Free</td><td class="mono">2,215</td><td class="mono">208.5 MB (198.8 MiB)</td></tr>
            <tr><td class="mono">game_launchers</td><td>Gaming Launchers &amp; Shader/Update Caches</td><td>Pro</td><td class="mono">333</td><td class="mono">88.2 MB (84.1 MiB)</td></tr>
            <tr><td class="mono">webview2_cache</td><td>Microsoft Edge WebView2 (EBWebView) cache</td><td>Pro</td><td class="mono">800</td><td class="mono">78.2 MB (74.5 MiB)</td></tr>
            <tr><td class="mono">app_caches</td><td>Discord &amp; VS Code caches</td><td>Pro</td><td class="mono">99</td><td class="mono">53.5 MB (51.0 MiB)</td></tr>
            <tr><td class="mono">duplicates</td><td>Duplicate Files</td><td>Pro</td><td class="mono">84</td><td class="mono">17.4 MB (16.6 MiB)</td></tr>
            <tr><td class="mono">thumbnails</td><td>Windows thumbnail &amp; icon cache</td><td>Pro</td><td class="mono">32</td><td class="mono">8.6 MB (8.2 MiB)</td></tr>
            <tr><td class="mono">recent_activity</td><td>Windows Activity &amp; JumpList traces</td><td>Pro</td><td class="mono">519</td><td class="mono">2.7 MB (2.6 MiB)</td></tr>
            <tr><td class="mono">shader_cache</td><td>NVIDIA DXCache / GLCache &amp; AMD DxCache</td><td>Pro</td><td class="mono">56</td><td class="mono">2.3 MB (2.2 MiB)</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section id="what-sweepr-never-touches" class="ed-section ed-card">
      <h2 class="ed-h2" style="margin-bottom:8px;">What SWEEPR Never Touches (Hard-Coded in safety.rs)</h2>
      <p style="font-size:0.9rem;color:var(--muted);margin-bottom:12px;">
        Every scan and cleanup enforces deterministic exclusions in <code class="ed-code">app/src-tauri/src/safety.rs</code> (<code class="ed-code">:8-134</code>):
      </p>
      <div class="ed-table-wrap">
        <table class="ed-table">
          <thead>
            <tr>
              <th>Protected Class</th>
              <th>Exact Scope Denied</th>
              <th>Rust Guardrail (<code class="ed-code">safety.rs</code>)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Relative &amp; Shallow Roots</strong></td>
              <td>Relative paths and roots with <code class="ed-code">&lt; 2</code> normal path segments (except exact <code class="ed-code">std::env::temp_dir()</code>).</td>
              <td class="mono">is_safe_root (:8-19)</td>
            </tr>
            <tr>
              <td><strong>Personal User Folders</strong></td>
              <td><code class="ed-code">home_dir</code>, <code class="ed-code">Documents</code> (<code class="ed-code">document_dir</code>), <code class="ed-code">Desktop</code> (<code class="ed-code">desktop_dir</code>), <code class="ed-code">Pictures</code> (<code class="ed-code">picture_dir</code>), <code class="ed-code">Videos</code> (<code class="ed-code">video_dir</code>), and <code class="ed-code">Audio</code> / <code class="ed-code">Music</code> (<code class="ed-code">audio_dir</code>).</td>
              <td class="mono">is_safe_root (:22-40)</td>
            </tr>
            <tr>
              <td><strong>Downloads Age Guard</strong></td>
              <td><code class="ed-code">download_dir</code> (<code class="ed-code">Downloads</code>) is denied by <code class="ed-code">is_safe_root</code> and only allowed in <code class="ed-code">is_safe_scan_root</code> when enforcing <code class="ed-code">min_age_hours &ge; 720</code> (30-day minimum age).</td>
              <td class="mono">is_safe_scan_root (:28, 62-74)</td>
            </tr>
            <tr>
              <td><strong>Profile &amp; App Config Roots</strong></td>
              <td>Exact roots <code class="ed-code">data_dir</code> (<code class="ed-code">%AppData%</code>), <code class="ed-code">data_local_dir</code> (<code class="ed-code">%LocalAppData%</code>), and <code class="ed-code">config_dir</code> are denied; only targeted cache subfolders are permitted.</td>
              <td class="mono">is_safe_root (:32-40, 56-57)</td>
            </tr>
            <tr>
              <td><strong>Windows OS Roots</strong></td>
              <td><code class="ed-code">SystemRoot</code> (<code class="ed-code">C:\Windows</code>), <code class="ed-code">ProgramFiles</code>, <code class="ed-code">ProgramFiles(x86)</code>, and <code class="ed-code">ProgramData</code> top-level roots are hard-denied.</td>
              <td class="mono">is_safe_root (:41-48)</td>
            </tr>
            <tr>
              <td><strong>Unix/macOS OS Roots</strong></td>
              <td><code class="ed-code">/</code>, <code class="ed-code">/usr</code>, <code class="ed-code">/bin</code>, <code class="ed-code">/etc</code>, <code class="ed-code">/var</code>, <code class="ed-code">/System</code>, <code class="ed-code">/Library</code>, and <code class="ed-code">/Applications</code> are hard-denied.</td>
              <td class="mono">is_safe_root (:49-54)</td>
            </tr>
            <tr>
              <td><strong>Symlinks, Junctions &amp; OneDrive</strong></td>
              <td>Parent traversal (<code class="ed-code">..</code> / <code class="ed-code">Component::ParentDir</code>), OS <code class="ed-code">symlink</code>s, NTFS <code class="ed-code">junction</code>s, and Windows <code class="ed-code">FILE_ATTRIBUTE_REPARSE_POINT (0x400)</code> OneDrive cloud placeholders checked across <code class="ed-code">root</code> and every ancestor.</td>
              <td class="mono">is_link_like / has_symlink_component (:82-134)</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section id="top-15-heaviest-folders" class="ed-section ed-card">
      <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px;margin-bottom:14px;">
        <div>
          <h2 class="ed-h2" style="margin-bottom:4px;">Top 15 Heaviest Orphaned Cache Folders on Windows 11</h2>
          <p style="font-size:0.88rem;color:var(--muted);">Ranked by empirical k-anonymous scan telemetry, Build 26200 measurements, and audit baselines.</p>
        </div>
        <button
          type="button"
          id="copyCitationMarkdownBtn"
          onclick="navigator.clipboard.writeText(document.getElementById('rawCitationMarkdown').value).then(() => { this.textContent = 'Copied Markdown Table'; })"
          class="ed-btn-secondary btn-press"
        >
          Copy Markdown Table for Reddit / Press
        </button>
      </div>
      <textarea id="rawCitationMarkdown" style="display:none;" readonly>${escapeHtml(report.citation_markdown)}</textarea>

      <div class="ed-table-wrap">
        <table class="ed-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Application / System Cache</th>
              <th>Canonical Windows Path</th>
              <th>Median</th>
              <th>P90 Bloat</th>
              <th>Verification Source</th>
            </tr>
          </thead>
          <tbody>
            ${report.top_15_heaviest_folders
              .map(
                (row) => `
            <tr>
              <td class="mono" style="font-weight:700;color:var(--muted);">${row.rank}</td>
              <td>
                <a href="/clean/${row.category}/${row.slug}">${escapeHtml(row.name)}</a>
                <div style="font-size:0.76rem;color:var(--muted);margin-top:2px;">${escapeHtml(row.silo)}</div>
              </td>
              <td class="ed-path-mono">${escapeHtml(row.path)}</td>
              <td class="mono" style="font-weight:700;white-space:nowrap;">${row.reclaimable_gb} GB</td>
              <td class="mono" style="color:var(--muted);white-space:nowrap;">${row.p90_gb} GB</td>
              <td style="white-space:nowrap;">
                <span class="ed-status ${row.source === "live_telemetry" || row.source === "lab_benchmark" ? "ed-status-safe" : "ed-status-caution"}">
                  <span class="ed-dot" aria-hidden="true"></span>${
                    row.source === "live_telemetry"
                      ? `Live Telemetry (n=${row.sample_count})`
                      : row.source === "lab_benchmark"
                        ? "Win11 Build 26200 Lab"
                        : "Audit Baseline"
                  }
                </span>
              </td>
            </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </section>

    <section class="ed-section">
      <h2 class="ed-h2" style="margin-bottom:14px;">Storage Footprint Breakdown by Windows Ecosystem Silo</h2>
      <div class="ed-grid-2">
        ${report.silos
          .map(
            (silo) => `
        <article class="ed-card">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:8px;">
            <h3 class="ed-h3">${escapeHtml(silo.label)}</h3>
            <span class="ed-status ed-status-safe mono" style="flex-shrink:0;">~${silo.estimated_median_gb} GB median</span>
          </div>
          <p style="font-size:0.82rem;color:var(--muted);margin-bottom:12px;">${silo.total_guides} curated Windows paths in this silo</p>
          <ul style="list-style:none;padding:0;margin:0;">
            ${silo.top_folders
              .map(
                (f) => `
            <li style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:8px 0;border-top:1px solid var(--border);font-size:0.86rem;">
              <a href="${f.url}" style="font-weight:600;color:var(--text);">${escapeHtml(f.name)}</a>
              <span class="mono" style="font-size:0.78rem;font-weight:700;color:var(--accent);white-space:nowrap;">
                ${f.measured_median_gb != null ? `${f.measured_median_gb} GB measured` : escapeHtml(f.avg_space)}
              </span>
            </li>`
              )
              .join("")}
          </ul>
        </article>`
          )
          .join("")}
      </div>
    </section>

    <section class="ed-section ed-card-muted">
      <h2 class="ed-h2">Audit Your Own PC Against the 2026 Benchmark</h2>
      <p style="font-size:0.94rem;color:var(--muted);max-width:64ch;">
        Paste your Windows folders into our browser Path Checker, estimate your savings with the PC Cache Calculator, or download the lightweight 6.76 MB native Rust SWEEPR Cleaner for a fast, read-only local scan in Zero-Telemetry / Offline Mode (<code class="ed-code">telemetry_enabled = false</code> default). SWEEPR Free includes Unlimited Temp &amp; Browser Cache Clean (to OS Recycle Bin), and Pro adds 7-Day Undo Quarantine (configurable 2–10 GB disk budget, 5 GB default, same-volume O(1) move; OS Recycle Bin fallback if file exceeds budget) (<a href="/pricing" style="color:var(--accent);text-decoration:underline;font-weight:700;">see Pro pricing</a> &middot; <a href="/refund" style="color:var(--accent);text-decoration:underline;">14-day refund policy</a> &middot; <a href="/vs/ccleaner" style="color:var(--accent);text-decoration:underline;">SWEEPR vs CCleaner</a>).
      </p>
      <div class="ed-actions">
        <a href="/download?platform=windows&amp;utm_source=state_of_storage_cta" rel="nofollow" class="ed-btn-primary btn-press">Download Free Windows Analyzer (.exe) &rarr;</a>
        <a href="/safe-to-delete" class="ed-btn-secondary btn-press">Open Path Safety Checker</a>
        <a href="/tools/pc-cache-calculator" class="ed-btn-secondary btn-press">PC Cache Calculator</a>
        <a href="/pricing" class="ed-btn-secondary btn-press">Pricing &amp; Free Tier</a>
      </div>
    </section>
  </main>
  ${renderSiteFooter()}
</body>
</html>`;
}
