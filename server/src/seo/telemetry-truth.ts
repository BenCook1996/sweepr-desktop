import { getCleanItems } from "../pseo.js";
import type { SeoStore } from "./store.js";

export const TELEMETRY_TRUTH_MIN_SAMPLES = 30; // k-anonymity floor (n >= 30)

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

const RULE_ID_TO_CLEAN_SLUG: Record<string, string> = {
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
  windows_update_cache: "windows-update-cleanup",
  winsxs: "winsxs",
  delivery_optimization: "delivery-optimization",
  programdata_package_cache: "programdata-package-cache",
  crash_dumps: "localappdata-crashdumps",
  webview2_cache: "localappdata-webview2-ebwebview-cache",
  chrome_cache: "chrome-gpu-shader-cache",
  opera_gx_cache: "opera-gx-cache",
  vivaldi_cache: "vivaldi-browser-cache",
  zen_browser_cache: "zen-browser-cache",
  discord_cache: "discord-cache",
  capcut_cache: "capcut-desktop-cache",
  adobe_media_cache: "adobe-media-cache",
  obs_logs: "obs-studio-logs-crashes",
  npm_cache: "npm-cache",
  pip_cache: "pip-cache",
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
  if (!cleaned) return null;

  if (RULE_ID_TO_CLEAN_SLUG[cleaned]) {
    return RULE_ID_TO_CLEAN_SLUG[cleaned];
  }

  const normalizedDash = cleaned.replace(/_/g, "-");
  if (RULE_ID_TO_CLEAN_SLUG[normalizedDash.replace(/-/g, "_")]) {
    return RULE_ID_TO_CLEAN_SLUG[normalizedDash.replace(/-/g, "_")];
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

/**
 * Ingests anonymized rule/slug byte observations from a `scan_completed` telemetry payload.
 */
export function ingestScanCompletedTelemetry(
  store: SeoStore,
  opts: {
    platform?: string;
    ruleBytes?: Record<string, unknown> | null;
    samples?: Array<{ slug?: string; rule_id?: string; bytes: number }> | null;
    nowSec?: number;
  }
): { ingested: number; touched_slugs: string[]; summaries: TelemetryTruthSummary[] } {
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

  const summaries: TelemetryTruthSummary[] = [];
  for (const slug of touched) {
    const s = recomputeTelemetryTruthForSlug(store, slug);
    if (s) summaries.push(s);
  }

  return {
    ingested,
    touched_slugs: [...touched],
    summaries,
  };
}

/**
 * Returns the cached k-anonymous (n >= 30) telemetry truth summary for a `/clean/*` slug, if available.
 */
export function getActiveTelemetryTruthForSlug(slug: string): TelemetryTruthSummary | null {
  return activeTelemetryTruthCache.get(slug) ?? null;
}
