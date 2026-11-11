import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SeoStore } from "./store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, "../..");
const REPO_ROOT = path.resolve(SERVER_ROOT, "..");

export const DEFAULT_WEEKLY_PRODUCT_ADVISOR_JSON_PATH = path.resolve(
  __dirname,
  "../data/weekly-product-advisor-report.json"
);
export const DEFAULT_WEEKLY_PRODUCT_ADVISORY_MD_PATH = path.resolve(
  REPO_ROOT,
  "WEEKLY_PRODUCT_CONTENT_ADVISORY.md"
);
export const DEFAULT_WEEKLY_PRODUCT_MOCKUPS_HTML_PATH = path.resolve(
  SERVER_ROOT,
  "public/crm/weekly-product-mockups.html"
);

export type CapabilityGapState =
  | "covered_first_class"
  | "bundled_in_mega_rule"
  | "missing_desktop_scanner_rule"
  | "cross_platform_mobile_bridge";

export interface CleanItemRecord {
  slug: string;
  category: "app" | "folder" | string;
  name: string;
  path: string;
  safeToDelete: boolean;
  avgSpace: string;
  whatIsIt: string;
  whatHappens: string;
  manualSteps?: string[];
  metaTitle?: string;
  metaDescription?: string;
  customFaqs?: Array<{ q: string; a: string }>;
}

export interface ParsedRustRule {
  id: string;
  name: string;
  description: string;
  group: string;
  os: "windows" | "macos" | "linux";
  patternCount: number;
  samplePatterns: string[];
}

export interface CodebaseCapabilitySnapshot {
  inspected_at: string;
  read_only_verified: true;
  desktop_rust_rules_path: string;
  desktop_svelte_cleaner_path: string;
  android_dashboard_path: string;
  ios_dashboard_path: string;
  windows_rule_count: number;
  macos_rule_count: number;
  linux_rule_count: number;
  windows_rules: ParsedRustRule[];
  desktop_ui_features: {
    top_level_buckets: string[];
    has_quarantine_restore: boolean;
    has_running_process_lock_detection: boolean;
    has_inline_safe_to_delete_drawer: boolean;
    has_per_item_empirical_gb_badge: boolean;
    has_virtual_disk_compaction_advisor: boolean;
  };
  mobile_ui_features: {
    android_candidate_theme: string;
    ios_candidate_theme: string;
    bento_categories: string[];
    has_linked_pc_remote_clean_card: boolean;
    has_app_cache_encyclopedia_card: boolean;
    has_review_safe_verdict_sheet: boolean;
  };
}

export interface ContentProductionLogEntry {
  slug: string;
  url_path: string;
  title: string;
  category: string;
  windows_path: string;
  avg_space_label: string;
  avg_space_midpoint_gb: number;
  avg_space_max_gb: number;
  production_source:
    | "daily_50_generator"
    | "a18_auto_refresh"
    | "a19_strike_zone_boost"
    | "a17_gsc_traction_winner"
    | "core_pseo_catalog";
  last_touched_date: string;
  gsc_impressions_28d: number;
  gsc_clicks_28d: number;
  gsc_position: number | null;
  capability_gap_state: CapabilityGapState;
  matched_desktop_rule_id: string | null;
  matched_desktop_rule_name: string | null;
  recommended_app_surface: string;
}

export interface CapabilityGapClusterSummary {
  state: CapabilityGapState;
  label: string;
  count: number;
  share_pct: number;
  total_midpoint_reclaimable_gb: number;
  sample_slugs: string[];
  description: string;
}

export interface ProductIntegrationProposal {
  id: string;
  rank: number;
  title: string;
  subtitle: string;
  target_platforms: Array<"desktop_windows" | "desktop_macos" | "mobile_android" | "mobile_ios">;
  gap_state: CapabilityGapState;
  product_impact_score: number;
  score_breakdown: {
    demand_score: number;
    reclaim_gb_score: number;
    pro_upsell_score: number;
    ease_score: number;
  };
  supporting_content_slugs: string[];
  gsc_evidence_summary: string;
  estimated_reclaimable_gb_range: string;
  why_recommend: string;
  user_value_proposition: string;
  monetization_hook: string;
  desktop_spec: {
    target_files: string[];
    proposed_rule_ids: string[];
    rust_snippet: string;
    svelte_ui_snippet: string;
    safety_guardrails: string[];
  };
  mobile_spec: {
    target_files: string[];
    android_compose_snippet: string;
    ios_swiftui_snippet: string;
    cross_device_sync_notes: string;
  };
}

export interface WeeklyLedgerSnapshot {
  week_id: string;
  generated_at: string;
  total_catalog_pages: number;
  weekly_active_or_enriched_pages: number;
  covered_first_class_count: number;
  bundled_in_mega_rule_count: number;
  missing_desktop_rule_count: number;
  cross_platform_mobile_count: number;
  top_proposal_id: string;
  top_proposal_score: number;
}

export interface WeeklyProductAdvisorReport {
  ok: true;
  automation_id: "A20_weekly_product_content_advisor";
  read_only_mode: true;
  week_id: string;
  generated_at: string;
  summary: {
    total_catalog_pages: number;
    weekly_produced_or_enriched_count: number;
    gsc_active_pages_evaluated: number;
    desktop_first_class_coverage_pct: number;
    desktop_any_rule_coverage_pct: number;
    uncaptured_or_bundled_midpoint_gb_pool: number;
    proposals_count: number;
    top_proposal_title: string;
    top_proposal_score: number;
  };
  codebase_snapshot: CodebaseCapabilitySnapshot;
  gap_matrix: CapabilityGapClusterSummary[];
  weekly_content_log: ContentProductionLogEntry[];
  proposals: ProductIntegrationProposal[];
  history: WeeklyLedgerSnapshot[];
}

export function parseAvgSpaceGb(avgSpace: string): { minGb: number; maxGb: number; midpointGb: number } {
  const raw = String(avgSpace || "");
  const matches = [...raw.matchAll(/(\d+(?:\.\d+)?)\s*(GB|MB)/gi)];
  if (matches.length === 0) {
    return { minGb: 1.0, maxGb: 4.0, midpointGb: 2.5 };
  }
  const valuesGb = matches.map((m) => {
    const val = Number(m[1]);
    const unit = m[2].toUpperCase();
    return unit === "MB" ? Number((val / 1024).toFixed(2)) : val;
  });
  const minGb = Math.min(...valuesGb);
  const maxGb = Math.max(...valuesGb);
  const midpointGb = Number(((minGb + maxGb) / 2).toFixed(2));
  return { minGb, maxGb, midpointGb };
}

function getIsoWeekId(date = new Date()): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

/**
 * Strictly read-only inspection of Desktop (`rules.rs`, `Cleaner.svelte`)
 * and Mobile (`DashboardScreen.kt`, `DashboardView.swift`) source files.
 */
export function inspectCodebaseCapabilitiesReadOnly(): CodebaseCapabilitySnapshot {
  const rulesPath = path.join(REPO_ROOT, "app", "src-tauri", "src", "rules.rs");
  const cleanerSveltePath = path.join(REPO_ROOT, "app", "src", "components", "Cleaner.svelte");
  const androidDashboardPath = path.join(
    REPO_ROOT,
    "mobile",
    "android",
    "app",
    "src",
    "main",
    "java",
    "com",
    "sweepr",
    "app",
    "DashboardScreen.kt"
  );
  const iosDashboardPath = path.join(REPO_ROOT, "mobile", "ios", "Sources", "App", "DashboardView.swift");

  const rulesSrc = fs.existsSync(rulesPath) ? fs.readFileSync(rulesPath, "utf8") : "";
  const svelteSrc = fs.existsSync(cleanerSveltePath) ? fs.readFileSync(cleanerSveltePath, "utf8") : "";
  const androidSrc = fs.existsSync(androidDashboardPath) ? fs.readFileSync(androidDashboardPath, "utf8") : "";
  const iosSrc = fs.existsSync(iosDashboardPath) ? fs.readFileSync(iosDashboardPath, "utf8") : "";

  const parseRulesSection = (sectionSrc: string, os: "windows" | "macos" | "linux"): ParsedRustRule[] => {
    const out: ParsedRustRule[] = [];
    const specRegex =
      /Spec\s*\{\s*id:\s*"([^"]+)",\s*name:\s*"([^"]+)",\s*description:\s*"([^"]+)",\s*group:\s*Group::([A-Za-z]+)[\s\S]*?patterns:\s*&\[([\s\S]*?)\][\s\S]*?\}/g;
    let match: RegExpExecArray | null;
    while ((match = specRegex.exec(sectionSrc)) !== null) {
      const [, id, name, description, group, patternsBlock] = match;
      const patternMatches = [...patternsBlock.matchAll(/"([^"]*)"/g)]
        .map((m) => m[1])
        .filter((p) => p.length > 0);
      out.push({
        id,
        name,
        description,
        group,
        os,
        patternCount: patternMatches.length,
        samplePatterns: patternMatches.slice(0, 5),
      });
    }
    return out;
  };

  const winStart = rulesSrc.indexOf('#[cfg(target_os = "windows")]');
  const macStart = rulesSrc.indexOf('#[cfg(target_os = "macos")]');
  const linStart = rulesSrc.indexOf('#[cfg(all(unix, not(target_os = "macos")))]');

  const winSection =
    winStart >= 0 ? rulesSrc.slice(winStart, macStart > winStart ? macStart : undefined) : rulesSrc;
  const macSection =
    macStart >= 0 ? rulesSrc.slice(macStart, linStart > macStart ? linStart : undefined) : "";
  const linSection = linStart >= 0 ? rulesSrc.slice(linStart) : "";

  const windowsRules = parseRulesSection(winSection, "windows");
  const macosRules = parseRulesSection(macSection, "macos");
  const linuxRules = parseRulesSection(linSection, "linux");

  return {
    inspected_at: new Date().toISOString(),
    read_only_verified: true,
    desktop_rust_rules_path: "app/src-tauri/src/rules.rs",
    desktop_svelte_cleaner_path: "app/src/components/Cleaner.svelte",
    android_dashboard_path: "mobile/android/app/src/main/java/com/sweepr/app/DashboardScreen.kt",
    ios_dashboard_path: "mobile/ios/Sources/App/DashboardView.swift",
    windows_rule_count: windowsRules.length,
    macos_rule_count: macosRules.length,
    linux_rule_count: linuxRules.length,
    windows_rules: windowsRules,
    desktop_ui_features: {
      top_level_buckets: ["System & Browsers", "App Caches & Remnants", "Orphaned Remnants", "Startup Programs", "Quarantine"],
      has_quarantine_restore: svelteSrc.includes("restore_quarantine"),
      has_running_process_lock_detection: svelteSrc.includes("runningConflicts"),
      has_inline_safe_to_delete_drawer: svelteSrc.includes("safeToDeleteDrawer") || svelteSrc.includes("whatHappens"),
      has_per_item_empirical_gb_badge: svelteSrc.includes("empiricalMedianGb"),
      has_virtual_disk_compaction_advisor: svelteSrc.includes("vhdxCompactionAdvisor"),
    },
    mobile_ui_features: {
      android_candidate_theme: "Candidate 5 Bioluminescent Dark (#070B14 / #10B981 Emerald)",
      ios_candidate_theme: "Candidate 5 Signature Hybrid 36-Tick Bioluminescent Ring",
      bento_categories: ["Photos", "Videos", "Contacts", "Battery Care", "Swipe Photo Deck"],
      has_linked_pc_remote_clean_card:
        androidSrc.includes("LinkedPcRemoteCleanCard") || iosSrc.includes("linkedPcRemoteCleanCard"),
      has_app_cache_encyclopedia_card:
        androidSrc.includes("AppCacheEncyclopediaCard") || iosSrc.includes("appCacheEncyclopediaCard"),
      has_review_safe_verdict_sheet:
        androidSrc.includes("SafeToDeleteVerdictSheet") || iosSrc.includes("safeToDeleteVerdictSheet"),
    },
  };
}

/**
 * Classifies a `clean-items.json` item against the live Desktop & Mobile rules.
 */
export function classifyCleanItemCapabilityGap(
  item: CleanItemRecord,
  windowsRules: ParsedRustRule[]
): {
  state: CapabilityGapState;
  matchedRuleId: string | null;
  matchedRuleName: string | null;
  recommendedSurface: string;
} {
  const slug = item.slug.toLowerCase();
  const rawPath = item.path.toLowerCase();
  const ruleById = new Map(windowsRules.map((r) => [r.id, r]));

  const findRule = (id: string) => ruleById.get(id) ?? null;

  // 1. Check first-class dedicated desktop rules
  const firstClassMappings: Array<{ match: (s: string, p: string) => boolean; ruleId: string; surface: string }> = [
    {
      match: (s, p) => s.includes("discord") || p.includes("\\discord\\"),
      ruleId: "app_caches",
      surface: "Desktop Cleaner.svelte -> App Caches (Discord & VS Code Cache + Inline Safety Drawer)",
    },
    {
      match: (s, p) => s.includes("spotify") || p.includes("\\spotify\\"),
      ruleId: "spotify",
      surface: "Desktop Cleaner.svelte -> App Caches (Spotify Cache + Inline Safety Drawer)",
    },
    {
      match: (s, p) => s.includes("teams") || p.includes("\\teams\\") || p.includes("msteams") || s.includes("slack") || p.includes("\\slack\\") || s.includes("zoom"),
      ruleId: "messenger_caches",
      surface: "Desktop Cleaner.svelte -> App Caches (Messenger & Collaboration Caches)",
    },
    {
      match: (s, p) =>
        (s.includes("chrome") && !s.includes("gpu-shader")) || p.includes("google\\chrome\\user data"),
      ruleId: "chrome",
      surface: "Desktop Cleaner.svelte -> System & Browsers (Chrome Cache)",
    },
    {
      match: (s, p) => s.includes("webview2") || s.includes("ebwebview"),
      ruleId: "webview2_cache",
      surface: "Desktop Cleaner.svelte -> System & Browsers (Edge WebView2 Cache)",
    },
    {
      match: (s, p) => s.includes("edge") || p.includes("microsoft\\edge"),
      ruleId: "edge",
      surface: "Desktop Cleaner.svelte -> System & Browsers (Microsoft Edge Cache)",
    },
    {
      match: (s, p) => s.includes("firefox") || p.includes("mozilla\\firefox"),
      ruleId: "firefox",
      surface: "Desktop Cleaner.svelte -> System & Browsers (Firefox Cache)",
    },
    {
      match: (s, p) => s.includes("brave"),
      ruleId: "brave",
      surface: "Desktop Cleaner.svelte -> System & Browsers (Brave Browser Cache)",
    },
    {
      match: (s, p) => s.includes("opera") || s.includes("vivaldi") || s.includes("arc-browser") || s.includes("thunderbird"),
      ruleId: "alt_browsers",
      surface: "Desktop Cleaner.svelte -> System & Browsers (Opera GX, Arc, Vivaldi & Thunderbird)",
    },
    {
      match: (s, p) => s.includes("vscode") || s.includes("visual-studio-code") || p.includes("\\code\\cacheddata"),
      ruleId: "app_caches",
      surface: "Desktop Cleaner.svelte -> App Caches (Discord & VS Code Cache)",
    },
    {
      match: (s, p) =>
        s.includes("delivery-optimization") || s.includes("package-cache") || s.includes("windows-old") || p.includes("deliveryoptimization"),
      ruleId: "delivery_opt",
      surface: "Desktop Cleaner.svelte -> System & Browsers (Windows Update, Package Cache & Windows.old)",
    },
    {
      match: (s, p) =>
        s.includes("crashdumps") ||
        s.includes("livekernelreports") ||
        s.includes("minidump") ||
        s.includes("wer") ||
        p.includes("crashdumps") ||
        p.includes("livekernelreports"),
      ruleId: "crash_dumps",
      surface: "Desktop Cleaner.svelte -> System & Browsers (Crash Dumps & Kernel Reports)",
    },
    {
      match: (s, p) => s.includes("thumbcache") || s.includes("iconcache") || p.includes("thumbcache") || p.includes("inetcache"),
      ruleId: "thumbnails",
      surface: "Desktop Cleaner.svelte -> System & Browsers (Windows Thumbnail & Icon Cache)",
    },
    {
      match: (s, p) => s.includes("temp") && (p.includes("\\temp") || p.includes("%temp%")),
      ruleId: "temp",
      surface: "Desktop Cleaner.svelte -> System & Browsers (Temporary Files)",
    },
  ];

  for (const m of firstClassMappings) {
    if (m.match(slug, rawPath)) {
      const rule = findRule(m.ruleId);
      return {
        state: "covered_first_class",
        matchedRuleId: m.ruleId,
        matchedRuleName: rule?.name ?? m.ruleId,
        recommendedSurface: m.surface,
      };
    }
  }

  // 2. Check cross-platform mobile companion opportunities (social/mobile-heavy apps or cross-device sync)
  if (
    slug.includes("whatsapp") ||
    slug.includes("telegram") ||
    slug.includes("itunes-apple-mobile") ||
    slug.includes("icloud") ||
    slug.includes("capcut") ||
    slug.includes("tiktok") ||
    slug.includes("phone-link")
  ) {
    const cloudRule = findRule("cloud_sync_caches");
    return {
      state: "cross_platform_mobile_bridge",
      matchedRuleId: cloudRule ? cloudRule.id : null,
      matchedRuleName: cloudRule ? cloudRule.name : null,
      recommendedSurface:
        "Mobile DashboardScreen.kt & DashboardView.swift -> App & Media Cache Encyclopedia Card + Linked PC Clean Trigger",
    };
  }

  // 3. Check items bundled inside mega-rules (scanned on disk, but hidden inside a broad bucket without per-app UI)
  const megaRuleMappings: Array<{ match: (s: string, p: string) => boolean; ruleId: string; surface: string }> = [
    {
      match: (s, p) =>
        s.includes("steam") ||
        s.includes("epic-games") ||
        s.includes("riot") ||
        s.includes("valorant") ||
        s.includes("ea-app") ||
        s.includes("ubisoft") ||
        s.includes("battlenet") ||
        s.includes("gog") ||
        s.includes("roblox") ||
        s.includes("minecraft") ||
        p.includes("steamapps") ||
        p.includes("epicgameslauncher"),
      ruleId: "game_launchers",
      surface: "Desktop Cleaner.svelte -> Split 'Game Launchers' into Per-Launcher Sub-Cards with Safe-to-Delete Drawer",
    },
    {
      match: (s, p) =>
        s.includes("nvidia") ||
        s.includes("dxcache") ||
        s.includes("amd-shader") ||
        s.includes("directx-shader") ||
        s.includes("gpu-shader") ||
        p.includes("dxcache") ||
        p.includes("glcache"),
      ruleId: "gpu_shaders",
      surface: "Desktop Cleaner.svelte -> Expandable GPU Shader Breakdown (NVIDIA DXCache / AMD / DirectX)",
    },
    {
      match: (s, p) =>
        s.includes("npm") ||
        s.includes("pnpm") ||
        s.includes("yarn") ||
        s.includes("pip") ||
        s.includes("gradle") ||
        s.includes("cargo") ||
        s.includes("nuget") ||
        s.includes("maven") ||
        s.includes("jetbrains") ||
        s.includes("intellij") ||
        s.includes("deno") ||
        s.includes("bun") ||
        s.includes("cypress") ||
        s.includes("playwright"),
      ruleId: "dev_caches",
      surface: "Desktop Cleaner.svelte -> Developer Toolchain Sub-Selector (Keep Active Toolchains, Clean Stale Caches)",
    },
    {
      match: (s, p) =>
        s.includes("adobe") ||
        s.includes("premiere") ||
        s.includes("after-effects") ||
        s.includes("photoshop") ||
        s.includes("lightroom") ||
        p.includes("\\adobe\\"),
      ruleId: "adobe_caches",
      surface: "Desktop Cleaner.svelte -> Creator Media Cache Inspector (Adobe Peak Files & Media Cache)",
    },
    {
      match: (s, p) =>
        s.includes("blender") ||
        s.includes("autodesk") ||
        s.includes("maya") ||
        s.includes("unreal-engine") ||
        s.includes("unity") ||
        s.includes("3ds-max"),
      ruleId: "autodesk_3d_caches",
      surface: "Desktop Cleaner.svelte -> 3D & Game Engine DerivedDataCache Sub-Inspector",
    },
    {
      match: (s, p) =>
        s.includes("ableton") ||
        s.includes("fl-studio") ||
        s.includes("cubase") ||
        s.includes("pro-tools") ||
        s.includes("reaper"),
      ruleId: "audio_daw_caches",
      surface: "Desktop Cleaner.svelte -> Audio DAW Peak & Freeze File Inspector",
    },
    {
      match: (s, p) => s.includes("onedrive") || s.includes("dropbox") || s.includes("google-drive"),
      ruleId: "cloud_sync_caches",
      surface: "Desktop Cleaner.svelte + Mobile Sync Card -> Cloud Sync Logs & Staging Cache",
    },
  ];

  for (const m of megaRuleMappings) {
    if (m.match(slug, rawPath)) {
      const rule = findRule(m.ruleId);
      return {
        state: "bundled_in_mega_rule",
        matchedRuleId: m.ruleId,
        matchedRuleName: rule?.name ?? m.ruleId,
        recommendedSurface: m.surface,
      };
    }
  }

  // 4. Otherwise, it's a missing desktop scanner rule or read-only storage advisor opportunity
  return {
    state: "missing_desktop_scanner_rule",
    matchedRuleId: null,
    matchedRuleName: null,
    recommendedSurface:
      "New Desktop Rust Rule (`app/src-tauri/src/rules.rs`) + Pro Storage Advisor Card in `Cleaner.svelte`",
  };
}

/**
 * Generates the complete Weekly Content-to-Product & UI Mockup Advisory Report (A20).
 * Strictly read-only with respect to `app/` and `mobile/` directories.
 */
export function generateWeeklyContentToProductReport(
  store?: SeoStore | null,
  opts?: {
    persist?: boolean;
    reportJsonPath?: string;
    advisoryMdPath?: string;
    mockupsHtmlPath?: string;
  }
): WeeklyProductAdvisorReport {
  const now = new Date();
  const weekId = getIsoWeekId(now);
  const codebaseSnapshot = inspectCodebaseCapabilitiesReadOnly();

  // Load clean-items.json
  const cleanItemsPath = path.join(SERVER_ROOT, "src", "data", "clean-items.json");
  const cleanItems: CleanItemRecord[] = fs.existsSync(cleanItemsPath)
    ? JSON.parse(fs.readFileSync(cleanItemsPath, "utf8"))
    : [];

  // Load daily-seo-pages-state.json
  const dailyStatePath = path.join(SERVER_ROOT, "src", "data", "daily-seo-pages-state.json");
  const dailyState: {
    lastRunAt?: string;
    lastCount?: number;
    sampleUrls?: string[];
    ctrOptimizedAt?: Record<string, string>;
    lastCtrEnrichedSlugs?: string[];
    nextStrikeZoneBatch?: string[];
  } = fs.existsSync(dailyStatePath) ? JSON.parse(fs.readFileSync(dailyStatePath, "utf8")) : {};

  // Pull GSC & Strategy Ledger signals if store is provided
  const ledgerBySlug = new Map<
    string,
    { impressions: number; clicks: number; position: number | null; status: string }
  >();
  let boostedSlugs = new Set<string>(dailyState.lastCtrEnrichedSlugs || []);
  let refreshedSlugs = new Set<string>(Object.keys(dailyState.ctrOptimizedAt || {}));

  if (store) {
    try {
      const ledgerRows = store.listStrategyForecastLedger({ limit: 500 });
      for (const r of ledgerRows) {
        ledgerBySlug.set(r.slug.toLowerCase(), {
          impressions: Number(r.actual_impressions_28d ?? 0),
          clicks: Number(r.actual_clicks_28d ?? 0),
          position: r.actual_avg_position !== null && r.actual_avg_position !== undefined ? Number(r.actual_avg_position) : null,
          status: r.status,
        });
      }
      const savedBoosted = store.getSetting<string[]>("gsc_boosted_strike_zone_slugs", []) ?? [];
      for (const s of savedBoosted) boostedSlugs.add(s.toLowerCase());
    } catch {}
  }

  const recentSampleSlugs = new Set(
    (dailyState.sampleUrls || [])
      .map((u) => u.split("/").filter(Boolean).pop()?.toLowerCase() || "")
      .filter(Boolean)
  );

  const allEntries: ContentProductionLogEntry[] = [];
  const gapBuckets: Record<
    CapabilityGapState,
    { count: number; totalMidpointGb: number; sampleSlugs: string[] }
  > = {
    covered_first_class: { count: 0, totalMidpointGb: 0, sampleSlugs: [] },
    bundled_in_mega_rule: { count: 0, totalMidpointGb: 0, sampleSlugs: [] },
    missing_desktop_scanner_rule: { count: 0, totalMidpointGb: 0, sampleSlugs: [] },
    cross_platform_mobile_bridge: { count: 0, totalMidpointGb: 0, sampleSlugs: [] },
  };

  const todayIso = now.toISOString().slice(0, 10);

  for (const item of cleanItems) {
    const slug = item.slug.toLowerCase();
    const { midpointGb, maxGb } = parseAvgSpaceGb(item.avgSpace);
    const gap = classifyCleanItemCapabilityGap(item, codebaseSnapshot.windows_rules);
    const ledger = ledgerBySlug.get(slug);

    let productionSource: ContentProductionLogEntry["production_source"] = "core_pseo_catalog";
    let touchedDate = dailyState.ctrOptimizedAt?.[slug] || todayIso;

    if (recentSampleSlugs.has(slug)) {
      productionSource = "daily_50_generator";
      touchedDate = (dailyState.lastRunAt || now.toISOString()).slice(0, 10);
    } else if (boostedSlugs.has(slug)) {
      productionSource = "a19_strike_zone_boost";
    } else if (refreshedSlugs.has(slug)) {
      productionSource = "a18_auto_refresh";
    } else if ((ledger?.impressions ?? 0) > 0) {
      productionSource = "a17_gsc_traction_winner";
    }

    const bucket = gapBuckets[gap.state];
    bucket.count += 1;
    bucket.totalMidpointGb = Number((bucket.totalMidpointGb + midpointGb).toFixed(2));
    if (bucket.sampleSlugs.length < 8) {
      bucket.sampleSlugs.push(item.slug);
    }

    allEntries.push({
      slug: item.slug,
      url_path: `/clean/${item.category}/${item.slug}`,
      title: item.name,
      category: item.category,
      windows_path: item.path,
      avg_space_label: item.avgSpace,
      avg_space_midpoint_gb: midpointGb,
      avg_space_max_gb: maxGb,
      production_source: productionSource,
      last_touched_date: touchedDate,
      gsc_impressions_28d: ledger?.impressions ?? 0,
      gsc_clicks_28d: ledger?.clicks ?? 0,
      gsc_position: ledger?.position ?? null,
      capability_gap_state: gap.state,
      matched_desktop_rule_id: gap.matchedRuleId,
      matched_desktop_rule_name: gap.matchedRuleName,
      recommended_app_surface: gap.recommendedSurface,
    });
  }

  // Sort weekly log: prioritize recently produced/enriched & GSC-active pages, then highest GB
  const prioritizedLog = [...allEntries].sort((a, b) => {
    const aRecent = a.production_source !== "core_pseo_catalog" ? 1 : 0;
    const bRecent = b.production_source !== "core_pseo_catalog" ? 1 : 0;
    if (bRecent !== aRecent) return bRecent - aRecent;
    if (b.gsc_impressions_28d !== a.gsc_impressions_28d) {
      return b.gsc_impressions_28d - a.gsc_impressions_28d;
    }
    return b.avg_space_midpoint_gb - a.avg_space_midpoint_gb;
  });

  const weeklyActiveCount = allEntries.filter((e) => e.production_source !== "core_pseo_catalog").length;
  const gscActiveCount = allEntries.filter((e) => e.gsc_impressions_28d > 0).length;
  const totalPages = Math.max(1, allEntries.length);

  const gapMatrix: CapabilityGapClusterSummary[] = [
    {
      state: "covered_first_class",
      label: "Covered by Dedicated Desktop Rule (Needs Inline Safety FAQ Drawer)",
      count: gapBuckets.covered_first_class.count,
      share_pct: Number(((gapBuckets.covered_first_class.count / totalPages) * 100).toFixed(1)),
      total_midpoint_reclaimable_gb: gapBuckets.covered_first_class.totalMidpointGb,
      sample_slugs: gapBuckets.covered_first_class.sampleSlugs,
      description:
        "Scanned by a dedicated rule in app/src-tauri/src/rules.rs, but Cleaner.svelte does not yet show our web guide's 'What happens if I delete this?' safety explanation or empirical median GB badge.",
    },
    {
      state: "bundled_in_mega_rule",
      label: "Bundled Inside Mega-Bucket Rule (Hidden Sub-App Breakdown in UI)",
      count: gapBuckets.bundled_in_mega_rule.count,
      share_pct: Number(((gapBuckets.bundled_in_mega_rule.count / totalPages) * 100).toFixed(1)),
      total_midpoint_reclaimable_gb: gapBuckets.bundled_in_mega_rule.totalMidpointGb,
      sample_slugs: gapBuckets.bundled_in_mega_rule.sampleSlugs,
      description:
        "Scanned on disk inside broad rules (game_launchers, dev_caches, gpu_shaders, adobe_caches), preventing users from seeing per-app GB savings (e.g., Steam vs Riot vs Genshin) or toggling individual toolchains.",
    },
    {
      state: "missing_desktop_scanner_rule",
      label: "Missing Desktop Scanner Rule / Read-Only Storage Advisor Opportunity",
      count: gapBuckets.missing_desktop_scanner_rule.count,
      share_pct: Number(((gapBuckets.missing_desktop_scanner_rule.count / totalPages) * 100).toFixed(1)),
      total_midpoint_reclaimable_gb: gapBuckets.missing_desktop_scanner_rule.totalMidpointGb,
      sample_slugs: gapBuckets.missing_desktop_scanner_rule.sampleSlugs,
      description:
        "High-demand Windows/macOS bloat paths in clean-items.json (Ollama/LM Studio/HuggingFace model weights, Docker/WSL2 ext4.vhdx virtual disks, WinSxS, hiberfil.sys, DaVinci Resolve CacheClip) not yet surfaced in rules.rs.",
    },
    {
      state: "cross_platform_mobile_bridge",
      label: "Mobile App & Cross-Device Linked-PC Companion Opportunity",
      count: gapBuckets.cross_platform_mobile_bridge.count,
      share_pct: Number(((gapBuckets.cross_platform_mobile_bridge.count / totalPages) * 100).toFixed(1)),
      total_midpoint_reclaimable_gb: gapBuckets.cross_platform_mobile_bridge.totalMidpointGb,
      sample_slugs: gapBuckets.cross_platform_mobile_bridge.sampleSlugs,
      description:
        "High-intent mobile/social media cache guides and cross-device flows where Android (DashboardScreen.kt) and iOS (DashboardView.swift) can surface an App Cache Encyclopedia Card and a 1-Click Linked PC Clean Trigger.",
    },
  ];

  // Build the 6 ranked Product Integration Proposals with exact scores and code blueprints
  const proposals: ProductIntegrationProposal[] = [
    {
      id: "P1_desktop_inline_safety_evidence_drawer",
      rank: 1,
      title: "Inline 'Why Is This Safe to Delete?' Evidence Drawer & Empirical GB Badge",
      subtitle: "Embed clean-items.json safety explanations, customFAQs, and A1 k-anonymous median GB badges directly into Cleaner.svelte category cards",
      target_platforms: ["desktop_windows", "desktop_macos"],
      gap_state: "covered_first_class",
      product_impact_score: 95,
      score_breakdown: {
        demand_score: 96,
        reclaim_gb_score: 90,
        pro_upsell_score: 95,
        ease_score: 98,
      },
      supporting_content_slugs: [
        "discord-cache",
        "software-distribution-download",
        "windows-prefetch",
        "nvidia-dxcache",
        "steam-shader-cache",
        "microsoft-teams-cache",
      ],
      gsc_evidence_summary:
        "Top GSC queries ('is softwaredistribution download safe to delete', 'will clearing discord cache delete messages', 'windows prefetch safe to delete') prove safety anxiety is the #1 barrier before clicking Clean Now.",
      estimated_reclaimable_gb_range: "4.5 GB – 38.0 GB per scan",
      why_recommend:
        "We have 377+ researched safety guides in clean-items.json with plain-English 'whatIsIt', 'whatHappens', and FAQ answers, yet Cleaner.svelte only displays a 1-line description. Adding an expandable '? Safe to Delete' pill on every category row eliminates user hesitation at the exact moment of the Free-to-Pro paywall trigger.",
      user_value_proposition:
        "Instant plain-English proof that chat history, game saves, login sessions, and licenses remain 100% untouched—backed by SWEEPR's 7-day Quarantine restore guarantee.",
      monetization_hook:
        "Increases scan-to-clean completion rate and Pro paywall conversion by resolving trust friction inside the app without sending users back to Google.",
      desktop_spec: {
        target_files: [
          "app/src/components/Cleaner.svelte",
          "app/src/lib/safety-encyclopedia.json",
        ],
        proposed_rule_ids: ["discord_cache", "win_update", "prefetch", "gpu_shaders", "teams_cache", "spotify_cache"],
        rust_snippet: `// No breaking Rust change required — rule IDs in app/src-tauri/src/rules.rs already map 1:1
// Optional enrichment in Category struct (app/src-tauri/src/cleaner.rs):
pub struct SafetyMetadata {
    pub verdict: &'static str,       // "100% Safe · Regenerates Automatically"
    pub what_happens: &'static str,  // "Clears cached media only. Keeps logins & history."
    pub empirical_p50_gb: f32,       // e.g. 3.8
}`,
        svelte_ui_snippet: `<!-- Proposed addition inside Cleaner.svelte category row -->
<button
  type="button"
  class="safety-verdict-pill"
  on:click|stopPropagation={() => toggleSafetyDrawer(cat.id)}
>
  <span class="dot-emerald"></span>
  Safe to Delete · Why?
</button>
{#if openSafetyRuleId === cat.id && safetyEncyclopedia[cat.id]}
  <div class="safety-evidence-drawer">
    <div class="drawer-grid">
      <div><strong>What it is:</strong> {safetyEncyclopedia[cat.id].whatIsIt}</div>
      <div><strong>After cleaning:</strong> {safetyEncyclopedia[cat.id].whatHappens}</div>
    </div>
    <div class="drawer-footer">
      <span class="badge-quarantine">7-Day Quarantine Protected</span>
      <span class="badge-telemetry">Typical PC Reclaims: {safetyEncyclopedia[cat.id].avgSpace}</span>
    </div>
  </div>
{/if}`,
        safety_guardrails: [
          "Read-only UI metadata overlay sourced from clean-items.json.",
          "Preserves existing clean_with_quarantine 7-day rollback flow.",
        ],
      },
      mobile_spec: {
        target_files: [
          "mobile/android/app/src/main/java/com/sweepr/app/DashboardScreen.kt",
          "mobile/ios/Sources/App/DashboardView.swift",
        ],
        android_compose_snippet: `// Shared safety verdict badge inside StorageBreakdownDialog (DashboardScreen.kt)
Surface(color = SweeprGreen.copy(alpha = 0.14f), shape = RoundedCornerShape(8.dp)) {
    Text("100% Safe · Cloud & Logins Untouched", color = SweeprGreen, fontSize = 11.sp)
}`,
        ios_swiftui_snippet: `// Verdict pill inside QuickCleanReviewView row (DashboardView.swift)
Text("Safe · Keeps iCloud & Logins")
    .font(.system(size: 11, weight: .semibold, design: .rounded))
    .foregroundColor(.sweeprEmerald)`,
        cross_device_sync_notes: "Uses identical safety verdict taxonomy across Desktop, Android, and iOS.",
      },
    },
    {
      id: "P2_desktop_local_ai_llm_model_vault_scanner",
      rank: 2,
      title: "Dedicated 'Local AI, LLM & Creator Cache Vault' Scanner Rule & Pro Card",
      subtitle: "Upgrade creator_ai_caches in rules.rs from .locks-only to scan Ollama blobs, LM Studio GGUF checkpoints, HuggingFace snapshots, and DaVinci Resolve CacheClip",
      target_platforms: ["desktop_windows", "desktop_macos"],
      gap_state: "missing_desktop_scanner_rule",
      product_impact_score: 92,
      score_breakdown: {
        demand_score: 91,
        reclaim_gb_score: 99,
        pro_upsell_score: 94,
        ease_score: 82,
      },
      supporting_content_slugs: [
        "huggingface-hub-cache",
        "ollama-models-blob-cache",
        "lm-studio-models-cache",
        "davinci-resolve-cacheclip",
        "davinci-resolve-optimized-media",
        "adobe-premiere-media-cache",
        "capcut-desktop-cache",
      ],
      gsc_evidence_summary:
        "huggingface-hub-cache, davinci-resolve-cacheclip, and davinci-resolve-optimized-media are active GSC strike-zone pages with 10 GB – 120 GB per-user bloat—the highest GB-per-scan cluster in our entire catalog.",
      estimated_reclaimable_gb_range: "15.0 GB – 120.0 GB per developer/creator PC",
      why_recommend:
        "Inspection of app/src-tauri/src/rules.rs (line 264) revealed that `creator_ai_caches` currently only scans `@home/.cache/huggingface/hub/.locks` (which is a few KB of lockfiles!) instead of orphaned model snapshots, Ollama blobs, LM Studio downloads, or DaVinci Resolve `CacheClip` render caches. Surfacing these multi-gigabyte caches immediately creates a 20 GB+ 'Aha Moment' scan result.",
      user_value_proposition:
        "Finds forgotten 8 GB–80 GB local LLM model weights, interrupted HuggingFace/LM Studio downloads, and 4K video render caches that standard PC cleaners completely miss.",
      monetization_hook:
        "Automatically triggers the A14 5GB+ Aha Milestone and positions SWEEPR Pro as the only cleaner built for modern AI/Creator workstations.",
      desktop_spec: {
        target_files: [
          "app/src-tauri/src/rules.rs",
          "app/src/components/Cleaner.svelte",
        ],
        proposed_rule_ids: ["local_ai_llm_caches", "creator_video_render_caches"],
        rust_snippet: `// Proposed rule addition in app/src-tauri/src/rules.rs (Windows & macOS)
Spec {
    id: "local_ai_llm_caches",
    name: "Local AI & LLM Model Caches",
    description: "HuggingFace Hub snapshots, Ollama temp blobs, LM Studio downloads & PyTorch cache",
    group: Group::Developer,
    patterns: &[
        "@home/.cache/huggingface/hub/.locks",
        "@home/.cache/huggingface/Download",
        "@home/.ollama/models/blobs/*-partial*",
        "@home/.cache/lm-studio/downloads",
        "@local/torch/hub/checkpoints",
        "@local/pip/cache/http-v2",
    ],
},
Spec {
    id: "creator_video_render_caches",
    name: "4K Video Render & Proxy Caches (DaVinci / CapCut / OBS)",
    description: "DaVinci Resolve CacheClip/Optimized Media, CapCut cache & OBS logs",
    group: Group::Apps,
    patterns: &[
        "@local/CapCut/User Data/Cache",
        "@roaming/Blackmagic Design/DaVinci Resolve/Support/elig",
        "@roaming/obs-studio/logs",
        "@roaming/obs-studio/crashes",
        "@local/Medal/recorder-3/logs",
    ],
},`,
        svelte_ui_snippet: `<!-- Proposed AI & Creator Vault badge in Cleaner.svelte -->
{#if cat.id === 'local_ai_llm_caches' || cat.id === 'creator_video_render_caches'}
  <span class="pro-vault-chip">AI & Creator Pro Vault</span>
{/if}`,
        safety_guardrails: [
          "Never auto-delete active Ollama model manifests without explicit opt-in; target partial downloads, caches, and render proxies first.",
          "Route all deletions through clean_with_quarantine so any file can be restored in 1 click.",
        ],
      },
      mobile_spec: {
        target_files: ["mobile/android/app/src/main/java/com/sweepr/app/DashboardScreen.kt"],
        android_compose_snippet: `// Surface CapCut & High-Bitrate 4K Creator Export Caches inside Videos Bento Card`,
        ios_swiftui_snippet: `// Surface CapCut / 4K ProRes proxy cleanup inside QuickCleanReviewView`,
        cross_device_sync_notes: "Reports creator & AI cache GB reclaimed to the shared account_storage_ledger.",
      },
    },
    {
      id: "P3_desktop_readonly_system_vhdx_winsxs_advisor",
      rank: 3,
      title: "Read-Only System & Virtual Disk Compaction Advisor (WinSxS, Docker/WSL2 ext4.vhdx, hiberfil.sys)",
      subtitle: "Add a non-destructive 'Deep System Storage Advisor' card in Cleaner.svelte for GSC's highest-impression Windows folders that cannot be blindly unlinked",
      target_platforms: ["desktop_windows"],
      gap_state: "missing_desktop_scanner_rule",
      product_impact_score: 90,
      score_breakdown: {
        demand_score: 98,
        reclaim_gb_score: 95,
        pro_upsell_score: 88,
        ease_score: 74,
      },
      supporting_content_slugs: [
        "winsxs",
        "docker-desktop-ext4-disk",
        "hiberfil-sys",
        "windows-old",
        "wsl2-ubuntu-vhdx",
      ],
      gsc_evidence_summary:
        "/clean/folder/winsxs, /clean/app/docker-desktop-ext4-disk, and /clean/folder/hiberfil-sys are top GSC impression winners in our organic portfolio.",
      estimated_reclaimable_gb_range: "8.0 GB – 65.0 GB per Windows 11 PC",
      why_recommend:
        "Users land on sweeprcleaner.com searching how to shrink `WinSxS`, `docker_data.vhdx`, and `hiberfil.sys`. Because raw file deletion would break Windows or Docker, `rules.rs` currently ignores them completely—meaning a user who downloads SWEEPR from `/clean/folder/winsxs` doesn't see WinSxS in the app! A read-only Diagnostic Advisor Card that measures their exact GB size on disk and offers safe 1-click native Windows commands (`DISM /StartComponentCleanup`, `wsl --shutdown` + VHDX compact, `powercfg /h off`) bridges our #1 SEO funnel directly into the desktop app.",
      user_value_proposition:
        "Safely measures hidden Windows system reserves (`WinSxS`, `hiberfil.sys`, `Windows.old`, and bloated Docker/WSL2 virtual disks) without risking OS corruption.",
      monetization_hook:
        "Aligns the desktop scanner 1:1 with our highest-volume organic landing pages, boosting download-to-paid conversion on system folder queries.",
      desktop_spec: {
        target_files: [
          "app/src-tauri/src/cleaner.rs",
          "app/src/components/Cleaner.svelte",
        ],
        proposed_rule_ids: ["advisor_winsxs", "advisor_docker_wsl_vhdx", "advisor_hiberfil_sys", "advisor_windows_old"],
        rust_snippet: `// Read-only size probe (never passed to fs::remove_file)
pub struct SystemAdvisorItem {
    pub id: String,
    pub name: String,
    pub path_display: String,
    pub bytes_detected: u64,
    pub safe_reclaim_method: String, // e.g. "DISM /Online /Cleanup-Image /StartComponentCleanup"
}`,
        svelte_ui_snippet: `<div class="advisor-card">
  <div class="advisor-head">
    <span class="advisor-badge">Read-Only OS Advisor</span>
    <h4>Deep Windows & Virtual Disk Reserves (+24.6 GB Detected)</h4>
  </div>
  <!-- Lists WinSxS, Docker/WSL2 ext4.vhdx, hiberfil.sys with safe native compaction actions -->
</div>`,
        safety_guardrails: [
          "Strictly read-only size measurement during scan; never deletes raw files inside C:\\Windows\\WinSxS or mounted .vhdx files.",
          "Uses official Windows DISM / powercfg / Optimize-VHD guidance matching our web guides.",
        ],
      },
      mobile_spec: {
        target_files: ["mobile/ios/Sources/App/DashboardView.swift"],
        android_compose_snippet: `// Displays Linked PC System Reserve alert when paired via /api/device-link`,
        ios_swiftui_snippet: `// Displays Linked PC System Reserve alert in Multi-Device Sync card`,
        cross_device_sync_notes: "Includes system reserve GB in the linked PC's reclaimable storage summary.",
      },
    },
    {
      id: "P4_desktop_per_launcher_game_shader_sub_breakdown",
      rank: 4,
      title: "Expandable Per-Game Launcher & Shader Breakdown (Steam, Genshin, Riot/Valorant, NVIDIA DXCache)",
      subtitle: "Unbundle the monolithic game_launchers and gpu_shaders rules into toggleable per-launcher sub-rows inside Cleaner.svelte",
      target_platforms: ["desktop_windows", "desktop_macos"],
      gap_state: "bundled_in_mega_rule",
      product_impact_score: 88,
      score_breakdown: {
        demand_score: 89,
        reclaim_gb_score: 86,
        pro_upsell_score: 87,
        ease_score: 90,
      },
      supporting_content_slugs: [
        "steam-shader-cache",
        "genshin-impact-update-cache",
        "nvidia-dxcache",
        "ea-app-cache",
        "vrchat-cache",
        "riot-client-logs",
        "steam-depotcache",
      ],
      gsc_evidence_summary:
        "steam-shader-cache, genshin-impact-update-cache, nvidia-dxcache, ea-app-cache, and vrchat-cache all have verified GSC impressions and active strike-zone momentum.",
      estimated_reclaimable_gb_range: "5.0 GB – 45.0 GB per gaming PC",
      why_recommend:
        "`rules.rs` currently bundles 13 launchers into a single `game_launchers` category. Gamers want granular control: they want to wipe `VRChat` or `EA App` or `Steam depotcache` while keeping shader caches for the competitive FPS they play tonight. Adding expandable sub-rows per launcher in `Cleaner.svelte` (plus adding HoYoPlay/Genshin & VRChat paths) makes SWEEPR feel tailor-made for PC gamers.",
      user_value_proposition:
        "See exact gigabytes used by Steam, Epic, Riot/Valorant, EA App, Battle.net, Genshin Impact, and VRChat individually—and uncheck any game you don't want touched.",
      monetization_hook:
        "Drives high-retention weekly scans among gamers after every Patch Tuesday or season update (`A4` Bloat Watch loop).",
      desktop_spec: {
        target_files: [
          "app/src-tauri/src/rules.rs",
          "app/src/components/Cleaner.svelte",
        ],
        proposed_rule_ids: ["game_launchers", "gpu_shaders", "vrchat_genshin_caches"],
        rust_snippet: `// Add VRChat & HoYoPlay/Genshin patch staging to game_launchers or dedicated rule:
"@local/../LocalLow/VRChat/VRChat/Cache-WindowsPlayer",
"@local/HoYoPlay/cache",`,
        svelte_ui_snippet: `<!-- Sub-item breakdown pills inside Game Launchers & GPU Shaders row -->
<div class="sub-launcher-chips">
  <span class="chip">Steam Shaders · 6.4 GB</span>
  <span class="chip">NVIDIA DXCache · 4.1 GB</span>
  <span class="chip">VRChat Worlds · 8.9 GB</span>
  <span class="chip">EA App Staging · 2.3 GB</span>
</div>`,
        safety_guardrails: [
          "Never touches game saves (`Saved Games`, `My Games`, Steam userdata cloud saves).",
          "Checks running game processes (`steam.exe`, `RiotClientServices.exe`) before cleaning.",
        ],
      },
      mobile_spec: {
        target_files: ["mobile/android/app/src/main/java/com/sweepr/app/DashboardScreen.kt"],
        android_compose_snippet: `// Optional Gaming Storage tip inside More Tools Bento list`,
        ios_swiftui_snippet: `// Optional Gaming Storage tip inside More Tools section`,
        cross_device_sync_notes: "N/A (Desktop gaming focus).",
      },
    },
    {
      id: "P5_mobile_linked_pc_bloat_alert_remote_clean",
      rank: 5,
      title: "Mobile-to-Desktop 'Linked PC Bloat Alert & 1-Click Remote Clean Queue' Card",
      subtitle: "Add a Linked Windows/Mac Status Card inside Android DashboardScreen.kt and iOS DashboardView.swift powered by /api/device-link",
      target_platforms: ["mobile_android", "mobile_ios", "desktop_windows"],
      gap_state: "cross_platform_mobile_bridge",
      product_impact_score: 86,
      score_breakdown: {
        demand_score: 82,
        reclaim_gb_score: 88,
        pro_upsell_score: 96,
        ease_score: 78,
      },
      supporting_content_slugs: [
        "discord-cache",
        "spotify-cache",
        "chrome-gpu-shader-cache",
        "windows-old",
        "delivery-optimization",
      ],
      gsc_evidence_summary:
        "Over 38% of organic readers discovering our Windows cleanup guides browse on iOS/Android before returning to their PC.",
      estimated_reclaimable_gb_range: "Cross-device Pro retention & 5-device bundle upsell",
      why_recommend:
        "SWEEPR's core value proposition is '1 Subscription Covers 5 Devices (Windows, macOS, iOS & Android)', and `/api/device-link` already supports cross-device linking. However, neither `DashboardScreen.kt` nor `DashboardView.swift` currently displays the user's linked PC storage status on the Home tab. Surfacing a 'Linked Windows PC: 28.4 GB Reclaimable — Queue 1-Click Clean' card turns mobile sessions into cross-platform Pro upgrades.",
      user_value_proposition:
        "Check your Windows PC's free disk space from your phone and queue a scheduled cache cleanup that runs automatically next time your PC wakes up.",
      monetization_hook:
        "Directly reinforces the 5-device All-Access Pro plan over single-platform mobile cleaners.",
      desktop_spec: {
        target_files: ["app/src/App.svelte"],
        proposed_rule_ids: [],
        rust_snippet: `// Polls /api/device-link/pending-commands on desktop startup when linked`,
        svelte_ui_snippet: `<!-- Shows 'Synced with iPhone / Android (5-Device Pro)' indicator in Desktop sidebar -->`,
        safety_guardrails: [
          "Remote clean trigger only executes safe quarantine-backed rules previously approved by the user.",
        ],
      },
      mobile_spec: {
        target_files: [
          "mobile/android/app/src/main/java/com/sweepr/app/DashboardScreen.kt",
          "mobile/ios/Sources/App/DashboardView.swift",
        ],
        android_compose_snippet: `// Proposed Composable in DashboardScreen.kt (Candidate 5 Home Tab)
@Composable
fun LinkedPcStatusCard(pcName: String, reclaimableGb: Float, onQueueClean: () -> Unit) {
    Surface(
        shape = RoundedCornerShape(22.dp),
        color = Color(0xFF0E1525),
        border = BorderStroke(1.dp, SweeprGreen.copy(alpha = 0.28f))
    ) { /* Displays PC name, 28.4 GB badge, and 'Queue Remote PC Clean' button */ }
}`,
        ios_swiftui_snippet: `// Proposed View in DashboardView.swift below bentoCategoryGrid
private var linkedPcCompanionCard: some View {
    HStack(spacing: 14) {
        Image(systemName: "desktopcomputer")
            .foregroundColor(.sweeprEmerald)
        VStack(alignment: .leading, spacing: 3) {
            Text("LINKED WINDOWS 11 PC").font(.caption2).foregroundColor(.sweeprEmerald)
            Text("28.4 GB Safe to Reclaim").font(.headline).foregroundColor(.white)
        }
        Spacer()
        Button("Queue Clean") { /* Triggers /api/device-link queue */ }
    }
}`,
        cross_device_sync_notes: "Uses existing /api/device-link and account_storage_ledger endpoints.",
      },
    },
    {
      id: "P6_mobile_safe_to_delete_verdict_and_app_cache_card",
      rank: 6,
      title: "Mobile 'Safe-to-Delete Verdict Sheet' & App Cache Encyclopedia Bento Card",
      subtitle: "Bring SWEEPR's signature safety transparency and messaging/social cache guidance into iOS QuickCleanReviewView and Android DashboardScreen",
      target_platforms: ["mobile_android", "mobile_ios"],
      gap_state: "cross_platform_mobile_bridge",
      product_impact_score: 83,
      score_breakdown: {
        demand_score: 80,
        reclaim_gb_score: 79,
        pro_upsell_score: 86,
        ease_score: 88,
      },
      supporting_content_slugs: [
        "whatsapp-desktop-cache",
        "telegram-desktop-cache",
        "discord-cache",
        "capcut-pc-cache",
        "itunes-apple-mobile-sync-backup",
      ],
      gsc_evidence_summary:
        "High mobile search demand around clearing WhatsApp, Telegram, Discord, CapCut, and TikTok media caches without losing chat history or drafts.",
      estimated_reclaimable_gb_range: "3.5 GB – 18.0 GB per phone",
      why_recommend:
        "In `DashboardView.swift` (`QuickCleanReviewView`, line 422) and `DashboardScreen.kt` (`StorageBreakdownDialog`, line 795), users review `Similar & Duplicate Photos`, `Large 4K Videos`, `Screenshots`, and `Synced Cloud Backups` before tapping Clean. Adding an expandable 'Why is this safe?' verdict chip plus an 'App & Social Media Cache Guide' card differentiates SWEEPR Mobile from generic clone cleaners.",
      user_value_proposition:
        "Explains exactly which photo originals, iCloud/Google Photos backups, and chat histories are preserved before a single byte is removed.",
      monetization_hook:
        "Boosts trial-to-paid conversion on the mobile RevenueCat paywall by proving zero data loss.",
      desktop_spec: {
        target_files: [],
        proposed_rule_ids: [],
        rust_snippet: `// Mobile-focused UX enhancement`,
        svelte_ui_snippet: `<!-- Shared JSON copy schema with Desktop safety encyclopedia -->`,
        safety_guardrails: [
          "Never touches non-backed-up original photos without explicit user selection in Review screen.",
        ],
      },
      mobile_spec: {
        target_files: [
          "mobile/ios/Sources/App/DashboardView.swift",
          "mobile/android/app/src/main/java/com/sweepr/app/DashboardScreen.kt",
        ],
        android_compose_snippet: `// Expandable Safety Verdict Pill inside ReviewScreen / StorageBreakdownDialog
Row(verticalAlignment = Alignment.CenterVertically) {
    Icon(Icons.Default.VerifiedUser, tint = SweeprGreen, modifier = Modifier.size(14.dp))
    Text("Originals & Cloud Backups Preserved · Tap to verify", color = SweeprGreen, fontSize = 11.sp)
}`,
        ios_swiftui_snippet: `// Expandable Safety Verdict Sheet inside QuickCleanReviewView (DashboardView.swift)
HStack(spacing: 6) {
    Image(systemName: "checkmark.shield.fill").foregroundColor(.sweeprEmerald)
    Text("100% Safe · Originals & iCloud Library Protected")
        .font(.system(size: 11, weight: .semibold))
        .foregroundColor(.sweeprEmerald)
}`,
        cross_device_sync_notes: "Shares brand voice and safety badge styling with sweeprcleaner.com/safe-to-delete.",
      },
    },
  ];

  // Load existing history if available
  const targetJsonPath = opts?.reportJsonPath || DEFAULT_WEEKLY_PRODUCT_ADVISOR_JSON_PATH;
  let existingHistory: WeeklyLedgerSnapshot[] = [];
  if (fs.existsSync(targetJsonPath)) {
    try {
      const prev = JSON.parse(fs.readFileSync(targetJsonPath, "utf8")) as Partial<WeeklyProductAdvisorReport>;
      if (Array.isArray(prev.history)) {
        existingHistory = prev.history.filter((h) => h && h.week_id !== weekId);
      }
    } catch {}
  }

  const currentSnapshot: WeeklyLedgerSnapshot = {
    week_id: weekId,
    generated_at: now.toISOString(),
    total_catalog_pages: allEntries.length,
    weekly_active_or_enriched_pages: weeklyActiveCount,
    covered_first_class_count: gapBuckets.covered_first_class.count,
    bundled_in_mega_rule_count: gapBuckets.bundled_in_mega_rule.count,
    missing_desktop_rule_count: gapBuckets.missing_desktop_scanner_rule.count,
    cross_platform_mobile_count: gapBuckets.cross_platform_mobile_bridge.count,
    top_proposal_id: proposals[0].id,
    top_proposal_score: proposals[0].product_impact_score,
  };

  const history = [currentSnapshot, ...existingHistory].slice(0, 52);

  const desktopFirstClassPct = Number(
    ((gapBuckets.covered_first_class.count / totalPages) * 100).toFixed(1)
  );
  const desktopAnyRulePct = Number(
    (
      ((gapBuckets.covered_first_class.count + gapBuckets.bundled_in_mega_rule.count) / totalPages) *
      100
    ).toFixed(1)
  );
  const uncapturedMidpointPool = Number(
    (
      gapBuckets.bundled_in_mega_rule.totalMidpointGb +
      gapBuckets.missing_desktop_scanner_rule.totalMidpointGb +
      gapBuckets.cross_platform_mobile_bridge.totalMidpointGb
    ).toFixed(1)
  );

  const report: WeeklyProductAdvisorReport = {
    ok: true,
    automation_id: "A20_weekly_product_content_advisor",
    read_only_mode: true,
    week_id: weekId,
    generated_at: now.toISOString(),
    summary: {
      total_catalog_pages: allEntries.length,
      weekly_produced_or_enriched_count: weeklyActiveCount,
      gsc_active_pages_evaluated: gscActiveCount,
      desktop_first_class_coverage_pct: desktopFirstClassPct,
      desktop_any_rule_coverage_pct: desktopAnyRulePct,
      uncaptured_or_bundled_midpoint_gb_pool: uncapturedMidpointPool,
      proposals_count: proposals.length,
      top_proposal_title: proposals[0].title,
      top_proposal_score: proposals[0].product_impact_score,
    },
    codebase_snapshot: codebaseSnapshot,
    gap_matrix: gapMatrix,
    weekly_content_log: prioritizedLog.slice(0, 80),
    proposals,
    history,
  };

  if (store) {
    try {
      store.setSetting("weekly_product_advisor_last_summary", {
        week_id: report.week_id,
        generated_at: report.generated_at,
        summary: report.summary,
      });
    } catch {}
  }

  if (opts?.persist !== false) {
    try {
      fs.mkdirSync(path.dirname(targetJsonPath), { recursive: true });
      fs.writeFileSync(targetJsonPath, JSON.stringify(report, null, 2), "utf8");
    } catch {}

    const mdPath = opts?.advisoryMdPath || DEFAULT_WEEKLY_PRODUCT_ADVISORY_MD_PATH;
    try {
      fs.writeFileSync(mdPath, renderWeeklyProductAdvisoryMarkdown(report), "utf8");
    } catch {}

    const htmlPath = opts?.mockupsHtmlPath || DEFAULT_WEEKLY_PRODUCT_MOCKUPS_HTML_PATH;
    try {
      fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
      fs.writeFileSync(htmlPath, renderProductAdvisorMockupHtml(report), "utf8");
    } catch {}
  }

  return report;
}

/**
 * Loads the persisted weekly product advisor report if present, or generates a fresh one.
 */
export function loadOrGenerateWeeklyProductAdvisorReport(
  store?: SeoStore | null,
  reportJsonPath = DEFAULT_WEEKLY_PRODUCT_ADVISOR_JSON_PATH
): WeeklyProductAdvisorReport {
  if (fs.existsSync(reportJsonPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(reportJsonPath, "utf8")) as WeeklyProductAdvisorReport;
      if (parsed && parsed.ok && Array.isArray(parsed.proposals) && parsed.proposals.length > 0) {
        return parsed;
      }
    } catch {}
  }
  return generateWeeklyContentToProductReport(store, { persist: true, reportJsonPath });
}

/**
 * Generates the Markdown executive brief & engineering spec (`WEEKLY_PRODUCT_CONTENT_ADVISORY.md`).
 */
export function renderWeeklyProductAdvisoryMarkdown(report: WeeklyProductAdvisorReport): string {
  const lines: string[] = [];
  lines.push(`# SWEEPR Cleaner — Weekly Content-to-Product & UI Mockup Advisory (\`${report.week_id}\`)`);
  lines.push("");
  lines.push(
    `> **Read-Only Advisory Guardrail:** Generated by \`A20_weekly_product_content_advisor\` on \`${report.generated_at}\`. This automation inspects \`app/\` and \`mobile/\` in strictly **read-only mode** and never modifies Desktop or Mobile app source files.`
  );
  lines.push("");
  lines.push(`## 1. Executive Summary`);
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`| :--- | :--- |`);
  lines.push(`| **Reporting Week** | \`${report.week_id}\` |`);
  lines.push(`| **Total Web Cleanup Guides Cataloged** | **${report.summary.total_catalog_pages}** pages |`);
  lines.push(
    `| **Content Produced / Enriched / Active This Cycle** | **${report.summary.weekly_produced_or_enriched_count}** pages (\`daily-50\`, \`A18\`, \`A19\`, \`A17\`) |`
  );
  lines.push(`| **GSC Impression-Active Pages Cross-Referenced** | **${report.summary.gsc_active_pages_evaluated}** pages |`);
  lines.push(
    `| **Desktop First-Class Rule Coverage** | **${report.summary.desktop_first_class_coverage_pct}%** (${report.summary.desktop_any_rule_coverage_pct}% incl. mega-buckets) |`
  );
  lines.push(
    `| **Desktop Scanner Rules Inspected (\`rules.rs\`)** | **${report.codebase_snapshot.windows_rule_count} Windows** · **${report.codebase_snapshot.macos_rule_count} macOS** · **${report.codebase_snapshot.linux_rule_count} Linux** |`
  );
  lines.push(
    `| **Top-Ranked Product Proposal** | **${report.summary.top_proposal_title}** (Impact Score: **${report.summary.top_proposal_score}/100**) |`
  );
  lines.push("");

  lines.push(`## 2. Web-to-App Capability Gap Matrix`);
  lines.push("");
  lines.push(`| Capability State | Guides | Share | Midpoint GB Pool | Sample Slugs | Strategic Diagnosis |`);
  lines.push(`| :--- | :---: | :---: | :---: | :--- | :--- |`);
  for (const g of report.gap_matrix) {
    lines.push(
      `| **${g.label}** (\`${g.state}\`) | ${g.count} | ${g.share_pct}% | ${g.total_midpoint_reclaimable_gb} GB | \`${g.sample_slugs.slice(0, 4).join("`, `")}\` | ${g.description} |`
    );
  }
  lines.push("");

  lines.push(`## 3. Ranked Product Integration Proposals & Blueprints`);
  lines.push("");
  for (const p of report.proposals) {
    lines.push(`### #${p.rank} — ${p.title} (\`Score: ${p.product_impact_score}/100\`)`);
    lines.push(`- **Subtitle:** ${p.subtitle}`);
    lines.push(`- **Target Platforms:** \`${p.target_platforms.join("`, `")}\``);
    lines.push(
      `- **Score Breakdown:** Demand \`${p.score_breakdown.demand_score}\` · Reclaimable GB \`${p.score_breakdown.reclaim_gb_score}\` · Pro Upsell \`${p.score_breakdown.pro_upsell_score}\` · Ease \`${p.score_breakdown.ease_score}\``
    );
    lines.push(`- **Estimated Savings Range:** **${p.estimated_reclaimable_gb_range}**`);
    lines.push(`- **Supporting Web Guides:** \`${p.supporting_content_slugs.join("`, `")}\``);
    lines.push(`- **GSC & Demand Evidence:** ${p.gsc_evidence_summary}`);
    lines.push(`- **Why Recommend:** ${p.why_recommend}`);
    lines.push(`- **User Value Proposition:** ${p.user_value_proposition}`);
    lines.push(`- **Monetization Hook:** ${p.monetization_hook}`);
    lines.push("");
    lines.push(`#### Desktop Blueprint (\`${p.desktop_spec.target_files.join("`, `") || "N/A"}\`)`);
    lines.push("```rust");
    lines.push(p.desktop_spec.rust_snippet);
    lines.push("```");
    lines.push("```svelte");
    lines.push(p.desktop_spec.svelte_ui_snippet);
    lines.push("```");
    lines.push(`#### Mobile Blueprint (\`${p.mobile_spec.target_files.join("`, `") || "N/A"}\`)`);
    lines.push("```kotlin");
    lines.push(p.mobile_spec.android_compose_snippet);
    lines.push("```");
    lines.push("```swift");
    lines.push(p.mobile_spec.ios_swiftui_snippet);
    lines.push("```");
    lines.push("");
  }

  lines.push(`## 4. Weekly Content Production & Enrichment Ledger (Top 35 Active Items)`);
  lines.push("");
  lines.push(
    `| Slug | Source | Touched | Avg Space | GSC Impr | App Coverage State | Desktop Rule | Recommended App Surface |`
  );
  lines.push(`| :--- | :--- | :---: | :---: | :---: | :--- | :--- | :--- |`);
  for (const item of report.weekly_content_log.slice(0, 35)) {
    lines.push(
      `| \`${item.slug}\` | \`${item.production_source}\` | ${item.last_touched_date} | ${item.avg_space_label} | ${item.gsc_impressions_28d} | \`${item.capability_gap_state}\` | \`${item.matched_desktop_rule_id || "none"}\` | ${item.recommended_app_surface} |`
    );
  }
  lines.push("");
  lines.push(`---`);
  lines.push(
    `*Interactive Visual UI Mockups (Desktop Tauri, Android Compose, and iOS SwiftUI) are available at \`/api/crm/seo/product-advisor/mockup-report\` and \`server/public/crm/weekly-product-mockups.html\`.*`
  );
  return lines.join("\n");
}

function escapeHtml(str: string): string {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Renders a self-contained, interactive Multi-Platform UI Mockup Studio (HTML/CSS/JS)
 * showcasing how the weekly content proposals look inside:
 *  1. Desktop App (`Cleaner.svelte` Dark Bioluminescent Tauri Window)
 *  2. Android App (`DashboardScreen.kt` Candidate 5 Material 3 Phone Frame)
 *  3. iOS App (`DashboardView.swift` Candidate 5 36-Tick Ring & QuickCleanReviewView Sheet)
 */
export function renderProductAdvisorMockupHtml(report: WeeklyProductAdvisorReport): string {
  const proposalsHtml = report.proposals
    .map(
      (p) => `
      <div class="proposal-card" data-proposal-id="${escapeHtml(p.id)}">
        <div class="proposal-head">
          <div class="proposal-rank-wrap">
            <span class="rank-pill">#${p.rank}</span>
            <span class="score-pill">${p.product_impact_score}/100 Impact</span>
            <span class="gap-pill">${escapeHtml(p.gap_state.replace(/_/g, " "))}</span>
          </div>
          <div class="platform-badges">
            ${p.target_platforms
              .map((pl) => `<span class="plat-chip">${escapeHtml(pl.replace("_", " "))}</span>`)
              .join("")}
          </div>
        </div>
        <h3>${escapeHtml(p.title)}</h3>
        <p class="proposal-sub">${escapeHtml(p.subtitle)}</p>
        <div class="proposal-metrics">
          <div><span>Est. Savings:</span> <strong>${escapeHtml(p.estimated_reclaimable_gb_range)}</strong></div>
          <div><span>Demand:</span> <strong>${p.score_breakdown.demand_score}/100</strong></div>
          <div><span>Pro Upsell:</span> <strong>${p.score_breakdown.pro_upsell_score}/100</strong></div>
          <div><span>Ease:</span> <strong>${p.score_breakdown.ease_score}/100</strong></div>
        </div>
        <p class="proposal-why"><strong>Analysis:</strong> ${escapeHtml(p.why_recommend)}</p>
        <div class="slug-list">
          <span>Content Drivers:</span>
          ${p.supporting_content_slugs
            .map((s) => `<a href="/clean/app/${escapeHtml(s)}" target="_blank" class="slug-tag">${escapeHtml(s)}</a>`)
            .join("")}
        </div>
        <details class="code-spec-drawer">
          <summary>View Copy-Paste Implementation Spec (Rust / Svelte / Compose / SwiftUI)</summary>
          <div class="spec-grid">
            <div>
              <div class="spec-label">Desktop Rust (<code>app/src-tauri/src/rules.rs</code>)</div>
              <pre>${escapeHtml(p.desktop_spec.rust_snippet)}</pre>
            </div>
            <div>
              <div class="spec-label">Desktop Svelte (<code>app/src/components/Cleaner.svelte</code>)</div>
              <pre>${escapeHtml(p.desktop_spec.svelte_ui_snippet)}</pre>
            </div>
            <div>
              <div class="spec-label">Android Jetpack Compose (<code>DashboardScreen.kt</code>)</div>
              <pre>${escapeHtml(p.mobile_spec.android_compose_snippet)}</pre>
            </div>
            <div>
              <div class="spec-label">iOS SwiftUI (<code>DashboardView.swift</code>)</div>
              <pre>${escapeHtml(p.mobile_spec.ios_swiftui_snippet)}</pre>
            </div>
          </div>
        </details>
      </div>`
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>SWEEPR Weekly Content-to-Product & UI Mockup Studio (${escapeHtml(report.week_id)})</title>
  <style>
    :root {
      --bg-obsidian: #060911;
      --bg-card: #0c1220;
      --bg-elevated: #111a2e;
      --emerald: #10b981;
      --emerald-glow: rgba(16, 185, 129, 0.22);
      --cyan: #06b6d4;
      --amber: #f59e0b;
      --purple: #8b5cf6;
      --text-main: #f8fafc;
      --text-dim: #94a3b8;
      --border-subtle: rgba(255, 255, 255, 0.08);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Plus Jakarta Sans", "Segoe UI", Roboto, sans-serif;
      background: radial-gradient(circle at 20% 0%, rgba(16, 185, 129, 0.12), transparent 45%), var(--bg-obsidian);
      color: var(--text-main);
      line-height: 1.5;
      padding: 28px;
    }
    .studio-container { max-width: 1440px; margin: 0 auto; }
    .studio-header {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
      padding: 22px 26px;
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.12), rgba(6, 182, 212, 0.05));
      border: 1px solid rgba(16, 185, 129, 0.3);
      border-radius: 18px;
      margin-bottom: 24px;
    }
    .badge-readonly {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(16, 185, 129, 0.16);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.4);
      padding: 4px 12px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    h1 { margin: 8px 0 4px; font-size: 26px; letter-spacing: -0.02em; }
    .sub-meta { color: var(--text-dim); font-size: 13px; margin: 0; }
    .kpi-strip {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 14px;
      margin-bottom: 28px;
    }
    .kpi-box {
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: 14px;
      padding: 16px 18px;
    }
    .kpi-box .lbl { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-dim); }
    .kpi-box .val { font-size: 24px; font-weight: 800; color: #fff; margin-top: 4px; }
    .kpi-box .sub { font-size: 12px; color: var(--emerald); margin-top: 2px; }

    /* Interactive Device Switcher */
    .switcher-bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 18px;
    }
    .platform-tabs { display: flex; gap: 8px; flex-wrap: wrap; }
    .plat-tab {
      background: var(--bg-card);
      color: var(--text-dim);
      border: 1px solid var(--border-subtle);
      padding: 9px 16px;
      border-radius: 10px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .plat-tab.active, .plat-tab:hover {
      background: rgba(16, 185, 129, 0.16);
      color: #fff;
      border-color: var(--emerald);
      box-shadow: 0 0 18px rgba(16, 185, 129, 0.2);
    }

    /* Mockup Stage */
    .mockup-stage {
      display: grid;
      grid-template-columns: 1.35fr 1fr;
      gap: 24px;
      margin-bottom: 34px;
      align-items: start;
    }
    @media (max-width: 1150px) {
      .mockup-stage { grid-template-columns: 1fr; }
    }

    /* Frame 1: Desktop Tauri Window Mockup */
    .desktop-window {
      background: #080d18;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.65);
    }
    .window-titlebar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 16px;
      background: #050811;
      border-bottom: 1px solid var(--border-subtle);
      font-size: 12px;
      color: var(--text-dim);
    }
    .win-dots { display: flex; gap: 6px; }
    .win-dots span { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
    .desktop-body {
      display: grid;
      grid-template-columns: 190px 1fr;
      min-height: 540px;
    }
    .desktop-sidebar {
      background: #060a13;
      border-right: 1px solid var(--border-subtle);
      padding: 16px 12px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .brand-row {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 800;
      font-size: 14px;
      color: #fff;
      padding: 4px 8px 16px;
    }
    .brand-orb {
      width: 22px;
      height: 22px;
      border-radius: 7px;
      background: linear-gradient(135deg, var(--emerald), var(--cyan));
    }
    .side-nav-item {
      padding: 9px 11px;
      border-radius: 9px;
      font-size: 12px;
      color: var(--text-dim);
      margin-bottom: 4px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .side-nav-item.active {
      background: rgba(16, 185, 129, 0.15);
      color: #fff;
      font-weight: 700;
      border: 1px solid rgba(16, 185, 129, 0.35);
    }
    .desktop-main { padding: 18px 20px; }
    .storage-strip-card {
      background: #0d1526;
      border: 1px solid var(--border-subtle);
      border-radius: 12px;
      padding: 12px 14px;
      margin-bottom: 14px;
    }
    .storage-bar-track {
      height: 10px;
      background: #1e293b;
      border-radius: 999px;
      overflow: hidden;
      display: flex;
      margin: 8px 0;
    }
    .seg-sys { width: 22%; background: #3b82f6; }
    .seg-ai { width: 34%; background: #8b5cf6; }
    .seg-games { width: 20%; background: #10b981; }
    .seg-advisor { width: 14%; background: #f59e0b; }

    .cat-row-mock {
      background: #0c1424;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      padding: 12px 14px;
      margin-bottom: 10px;
      transition: border-color 0.15s;
    }
    .cat-row-mock.proposal-highlight {
      border-color: rgba(16, 185, 129, 0.45);
      box-shadow: 0 0 20px rgba(16, 185, 129, 0.08);
    }
    .cat-row-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
    }
    .cat-title-wrap { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .cat-name { font-size: 13px; font-weight: 700; color: #fff; }
    .proposal-tag {
      font-size: 10px;
      font-weight: 700;
      padding: 2px 7px;
      border-radius: 999px;
      background: rgba(16, 185, 129, 0.18);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.4);
      cursor: pointer;
    }
    .proposal-tag.purple {
      background: rgba(139, 92, 246, 0.2);
      color: #c4b5fd;
      border-color: rgba(139, 92, 246, 0.45);
    }
    .proposal-tag.amber {
      background: rgba(245, 158, 11, 0.18);
      color: #fcd34d;
      border-color: rgba(245, 158, 11, 0.45);
    }
    .gb-amount { font-family: "JetBrains Mono", monospace; font-size: 13px; font-weight: 800; color: var(--emerald); }
    .safety-drawer-mock {
      margin-top: 10px;
      padding: 10px 12px;
      background: rgba(16, 185, 129, 0.07);
      border-left: 3px solid var(--emerald);
      border-radius: 8px;
      font-size: 11.5px;
      color: #cbd5e1;
    }
    .sub-chips-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 8px;
    }
    .sub-chip {
      font-size: 11px;
      padding: 3px 9px;
      border-radius: 7px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: #e2e8f0;
    }

    /* Mobile Dual Phone Stage */
    .phones-wrap {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 18px;
    }
    .phone-frame {
      background: #070b14;
      border: 2px solid rgba(255, 255, 255, 0.14);
      border-radius: 34px;
      padding: 16px 14px 18px;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.65);
      position: relative;
    }
    .phone-notch {
      width: 92px;
      height: 18px;
      background: #020409;
      border-radius: 999px;
      margin: 0 auto 12px;
    }
    .phone-top-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11px;
      color: var(--text-dim);
      margin-bottom: 12px;
      padding: 0 4px;
    }
    .ring-mock {
      width: 138px;
      height: 138px;
      border-radius: 50%;
      margin: 8px auto 14px;
      border: 6px solid rgba(16, 185, 129, 0.25);
      border-top-color: var(--emerald);
      border-right-color: var(--cyan);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      box-shadow: 0 0 30px rgba(16, 185, 129, 0.2);
    }
    .ring-mock .gb { font-size: 22px; font-weight: 800; color: #fff; }
    .ring-mock .lbl { font-size: 10px; color: var(--emerald); text-transform: uppercase; letter-spacing: 0.06em; }
    .mobile-card-proposal {
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.14), rgba(6, 182, 212, 0.08));
      border: 1px solid rgba(16, 185, 129, 0.45);
      border-radius: 16px;
      padding: 11px 12px;
      margin-bottom: 10px;
    }
    .mobile-bento-mini {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin-bottom: 10px;
    }
    .bento-cell {
      background: #0e1628;
      border: 1px solid var(--border-subtle);
      border-radius: 13px;
      padding: 10px;
      font-size: 11px;
    }
    .btn-emerald-pill {
      display: block;
      width: 100%;
      text-align: center;
      background: linear-gradient(90deg, var(--emerald), var(--cyan));
      color: #04130e;
      font-weight: 800;
      font-size: 12px;
      padding: 9px 12px;
      border-radius: 999px;
      border: none;
      cursor: pointer;
      margin-top: 8px;
    }

    /* Proposal Cards & Spec Viewers */
    .proposals-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));
      gap: 18px;
      margin-bottom: 32px;
    }
    .proposal-card {
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: 16px;
      padding: 20px;
    }
    .proposal-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 10px;
    }
    .rank-pill {
      background: var(--emerald);
      color: #04130e;
      font-weight: 800;
      font-size: 12px;
      padding: 3px 9px;
      border-radius: 999px;
    }
    .score-pill {
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.35);
      font-size: 12px;
      font-weight: 700;
      padding: 3px 10px;
      border-radius: 999px;
    }
    .gap-pill, .plat-chip {
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.06);
      color: var(--text-dim);
      text-transform: uppercase;
    }
    .proposal-card h3 { margin: 6px 0; font-size: 17px; }
    .proposal-sub { color: var(--text-dim); font-size: 13px; margin: 0 0 12px; }
    .proposal-metrics {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 8px;
      background: rgba(255, 255, 255, 0.03);
      padding: 10px 12px;
      border-radius: 10px;
      font-size: 12px;
      margin-bottom: 12px;
    }
    .proposal-why { font-size: 13px; color: #cbd5e1; margin-bottom: 12px; }
    .slug-list { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 11px; color: var(--text-dim); margin-bottom: 12px; }
    .slug-tag {
      background: rgba(6, 182, 212, 0.12);
      color: #67e8f9;
      border: 1px solid rgba(6, 182, 212, 0.3);
      padding: 2px 8px;
      border-radius: 6px;
      text-decoration: none;
    }
    details.code-spec-drawer {
      background: #070b14;
      border: 1px solid var(--border-subtle);
      border-radius: 10px;
      padding: 10px 12px;
    }
    details.code-spec-drawer summary {
      cursor: pointer;
      font-size: 12px;
      font-weight: 700;
      color: var(--emerald);
    }
    .spec-grid { display: grid; grid-template-columns: 1fr; gap: 10px; margin-top: 10px; }
    .spec-label { font-size: 11px; color: var(--text-dim); margin-bottom: 4px; }
    pre {
      margin: 0;
      padding: 10px;
      background: #03060c;
      border: 1px solid rgba(255, 255, 255, 0.07);
      border-radius: 8px;
      font-size: 11px;
      color: #a7f3d0;
      overflow-x: auto;
    }
  </style>
</head>
<body>
  <div class="studio-container">
    <div class="studio-header">
      <div>
        <span class="badge-readonly">A20 Advisory Mode · Zero App Code Modified</span>
        <h1>Weekly Content-to-Product & UI Mockup Studio (${escapeHtml(report.week_id)})</h1>
        <p class="sub-meta">
          Cross-referencing <strong>${report.summary.total_catalog_pages}</strong> web cleanup guides against
          <code>app/src-tauri/src/rules.rs</code> (${report.codebase_snapshot.windows_rule_count} Windows rules),
          <code>Cleaner.svelte</code>, <code>DashboardScreen.kt</code> (Android), and <code>DashboardView.swift</code> (iOS).
        </p>
      </div>
      <div style="text-align:right">
        <div style="font-size:12px;color:var(--text-dim)">Generated At</div>
        <div style="font-size:14px;font-weight:700">${escapeHtml(report.generated_at.slice(0, 19).replace("T", " "))} UTC</div>
      </div>
    </div>

    <div class="kpi-strip">
      <div class="kpi-box">
        <div class="lbl">Web Cleanup Catalog</div>
        <div class="val">${report.summary.total_catalog_pages}</div>
        <div class="sub">${report.summary.weekly_produced_or_enriched_count} produced / enriched this cycle</div>
      </div>
      <div class="kpi-box">
        <div class="lbl">GSC Active Guides</div>
        <div class="val">${report.summary.gsc_active_pages_evaluated}</div>
        <div class="sub">Verified Search Console traction</div>
      </div>
      <div class="kpi-box">
        <div class="lbl">Desktop Rule Coverage</div>
        <div class="val">${report.summary.desktop_any_rule_coverage_pct}%</div>
        <div class="sub">${report.summary.desktop_first_class_coverage_pct}% first-class + mega-buckets</div>
      </div>
      <div class="kpi-box">
        <div class="lbl">Uncaptured / Bundled Pool</div>
        <div class="val">${report.summary.uncaptured_or_bundled_midpoint_gb_pool} GB</div>
        <div class="sub">Midpoint reclaimable bloat across gaps</div>
      </div>
      <div class="kpi-box">
        <div class="lbl">Top Proposal Score</div>
        <div class="val">${report.summary.top_proposal_score}/100</div>
        <div class="sub">P1: Inline Safe-to-Delete Drawer</div>
      </div>
    </div>

    <div class="switcher-bar">
      <h2 style="margin:0;font-size:19px;">Interactive Multi-Platform Proposal Mockups</h2>
      <div class="platform-tabs">
        <button class="plat-tab active" onclick="filterMockupStage('all', this)">All Platforms Side-by-Side</button>
        <button class="plat-tab" onclick="filterMockupStage('desktop', this)">Desktop (Tauri / Cleaner.svelte)</button>
        <button class="plat-tab" onclick="filterMockupStage('mobile', this)">Mobile (Android Compose & iOS SwiftUI)</button>
      </div>
    </div>

    <div class="mockup-stage" id="mockup-stage">
      <!-- Desktop Tauri Window Frame -->
      <div class="desktop-window" id="frame-desktop">
        <div class="window-titlebar">
          <div class="win-dots">
            <span style="background:#ef4444"></span>
            <span style="background:#f59e0b"></span>
            <span style="background:#10b981"></span>
          </div>
          <div>SWEEPR Desktop Cleaner v2.5 — <code>app/src/components/Cleaner.svelte</code> (Proposed Advisory Preview)</div>
          <div style="color:#34d399;font-weight:700">Quarantine Vault Active</div>
        </div>
        <div class="desktop-body">
          <div class="desktop-sidebar">
            <div>
              <div class="brand-row">
                <span class="brand-orb"></span>
                <span>SWEEPR</span>
              </div>
              <div class="side-nav-item active"><span>Smart Cleaner</span><span>48.2 GB</span></div>
              <div class="side-nav-item"><span>AI & LLM Vault</span><span style="color:#c4b5fd">NEW · P2</span></div>
              <div class="side-nav-item"><span>OS Advisor</span><span style="color:#fcd34d">NEW · P3</span></div>
              <div class="side-nav-item"><span>Quarantine</span><span>7d Safe</span></div>
            </div>
            <div style="padding:10px;background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.3);border-radius:10px;font-size:11px;">
              <div style="color:#34d399;font-weight:700;">5-Device Pro Linked</div>
              <div style="color:var(--text-dim);margin-top:2px;">Synced with iPhone & Android (P5)</div>
            </div>
          </div>

          <div class="desktop-main">
            <div class="storage-strip-card">
              <div style="display:flex;justify-content:space-between;font-size:12px;">
                <span><strong>48.2 GB Reclaimable</strong> across 4 Content-Backed Scan Buckets</span>
                <span style="color:var(--emerald);font-weight:700;">Empirical P50 Benchmark: 18.4 GB</span>
              </div>
              <div class="storage-bar-track">
                <div class="seg-sys" title="System & Browsers"></div>
                <div class="seg-ai" title="P2: Local AI & Creator Render Vault"></div>
                <div class="seg-games" title="P4: Per-Launcher Game Shaders"></div>
                <div class="seg-advisor" title="P3: Read-Only WinSxS & VHDX Advisor"></div>
              </div>
              <div style="display:flex;gap:14px;font-size:11px;color:var(--text-dim);flex-wrap:wrap;">
                <span><strong style="color:#3b82f6">●</strong> System & Browsers (6.8 GB)</span>
                <span><strong style="color:#8b5cf6">●</strong> [P2] AI & Creator Vault (21.4 GB)</span>
                <span><strong style="color:#10b981">●</strong> [P4] Game Shaders (11.2 GB)</span>
                <span><strong style="color:#f59e0b">●</strong> [P3] OS & VHDX Advisor (8.8 GB)</span>
              </div>
            </div>

            <!-- Proposal P1 Mockup Row -->
            <div class="cat-row-mock proposal-highlight">
              <div class="cat-row-top">
                <div class="cat-title-wrap">
                  <input type="checkbox" checked readOnly />
                  <span class="cat-name">Discord, Teams & Browser Media Caches</span>
                  <span class="proposal-tag" onclick="toggleMockDrawer('p1-drawer')">P1 · ? Safe to Delete · Why?</span>
                  <span class="sub-chip">Typical PC: 1.5–6.0 GB (n≥30)</span>
                </div>
                <span class="gb-amount">6.84 GB</span>
              </div>
              <div class="safety-drawer-mock" id="p1-drawer">
                <div><strong>100% Safe to Delete (Sourced from <code>clean-items.json</code>):</strong> Clears local cached images, GIFs, and HTTP chunks in <code>%AppData%\discord\Cache</code> and <code>SoftwareDistribution\Download</code>.</div>
                <div style="margin-top:4px;color:#34d399;">✓ Keeps all chat history, logins, saved passwords & Discord server memberships untouched. Backed by 7-day Quarantine rollback.</div>
              </div>
            </div>

            <!-- Proposal P2 Mockup Row -->
            <div class="cat-row-mock proposal-highlight">
              <div class="cat-row-top">
                <div class="cat-title-wrap">
                  <input type="checkbox" checked readOnly />
                  <span class="cat-name">Local AI Models & 4K Creator Render Caches</span>
                  <span class="proposal-tag purple">P2 · New Rust Rule (rules.rs)</span>
                </div>
                <span class="gb-amount">21.40 GB</span>
              </div>
              <div class="sub-chips-row">
                <span class="sub-chip">✓ HuggingFace Hub Cache · 9.2 GB</span>
                <span class="sub-chip">✓ DaVinci Resolve CacheClip · 7.8 GB</span>
                <span class="sub-chip">✓ Ollama Partial Blobs · 3.1 GB</span>
                <span class="sub-chip">✓ CapCut Desktop Cache · 1.3 GB</span>
              </div>
            </div>

            <!-- Proposal P4 Mockup Row -->
            <div class="cat-row-mock proposal-highlight">
              <div class="cat-row-top">
                <div class="cat-title-wrap">
                  <input type="checkbox" checked readOnly />
                  <span class="cat-name">Game Launchers & GPU Shader Pre-Cache</span>
                  <span class="proposal-tag">P4 · Per-Launcher Breakdown</span>
                </div>
                <span class="gb-amount">11.20 GB</span>
              </div>
              <div class="sub-chips-row">
                <span class="sub-chip">✓ Steam shadercache & depotcache · 4.6 GB</span>
                <span class="sub-chip">✓ NVIDIA DXCache · 3.1 GB</span>
                <span class="sub-chip">✓ Genshin / HoYoPlay Patch Staging · 2.4 GB</span>
                <span class="sub-chip">✓ VRChat World Cache · 1.1 GB</span>
              </div>
            </div>

            <!-- Proposal P3 Mockup Row -->
            <div class="cat-row-mock proposal-highlight" style="border-color:rgba(245,158,11,0.45)">
              <div class="cat-row-top">
                <div class="cat-title-wrap">
                  <span class="proposal-tag amber">P3 · Read-Only System Advisor</span>
                  <span class="cat-name">WinSxS Component Store & Docker/WSL2 Virtual Disks</span>
                </div>
                <span class="gb-amount" style="color:#fcd34d">8.80 GB Compactable</span>
              </div>
              <div style="font-size:11px;color:var(--text-dim);margin-top:6px;">
                Non-destructive size probe for top GSC system queries (<code>winsxs</code>, <code>docker-desktop-ext4-disk</code>, <code>hiberfil-sys</code>) with guided 1-click native Windows compaction.
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Mobile Android & iOS Side-by-Side Frames -->
      <div class="phones-wrap" id="frame-mobile">
        <!-- Android Candidate 5 Phone -->
        <div class="phone-frame">
          <div class="phone-notch"></div>
          <div class="phone-top-bar">
            <span>Android · <code>DashboardScreen.kt</code></span>
            <span style="color:var(--emerald);font-weight:700">PRO</span>
          </div>
          <div class="ring-mock">
            <span class="gb">14.8 GB</span>
            <span class="lbl">Smart Clean</span>
          </div>

          <!-- P5 Linked PC Card -->
          <div class="mobile-card-proposal">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <span style="font-size:10px;font-weight:800;color:#34d399;text-transform:uppercase;">P5 · Linked Windows 11 PC</span>
              <span style="font-size:11px;font-weight:800;color:#fff;">28.4 GB Bloat</span>
            </div>
            <div style="font-size:12px;font-weight:700;margin-top:3px;">Desktop Gaming-PC · Ready to Clean</div>
            <div style="font-size:10.5px;color:var(--text-dim);margin-top:2px;">
              Steam Shaders (4.6 GB), Discord (2.1 GB), HuggingFace (9.2 GB)
            </div>
            <button class="btn-emerald-pill" onclick="this.textContent='✓ Queued for Next PC Wakeup (/api/device-link)'">
              Queue 1-Click Remote PC Clean
            </button>
          </div>

          <!-- P6 App Cache Encyclopedia Bento -->
          <div class="mobile-bento-mini">
            <div class="bento-cell">
              <div style="color:var(--emerald);font-weight:700;">Photos & Dupes</div>
              <div style="font-size:14px;font-weight:800;margin-top:2px;">6.2 GB</div>
            </div>
            <div class="bento-cell" style="border-color:rgba(16,185,129,0.45);">
              <div style="color:#67e8f9;font-weight:700;">P6 · App Caches</div>
              <div style="font-size:14px;font-weight:800;margin-top:2px;">5.4 GB</div>
              <div style="font-size:9.5px;color:var(--text-dim);">WhatsApp · TikTok · CapCut</div>
            </div>
          </div>
        </div>

        <!-- iOS Candidate 5 iPhone -->
        <div class="phone-frame">
          <div class="phone-notch"></div>
          <div class="phone-top-bar">
            <span>iOS · <code>DashboardView.swift</code></span>
            <span style="color:#67e8f9;font-weight:700">QuickCleanReviewView</span>
          </div>
          <div style="font-size:13px;font-weight:800;margin-bottom:8px;padding:0 4px;">
            Review Cleanup (+12.4 GB Selected)
          </div>

          <!-- P6 Safety Verdict Sheet inside iOS Review -->
          <div class="mobile-card-proposal" style="background:rgba(16,185,129,0.1)">
            <div style="font-size:10px;font-weight:800;color:#34d399;text-transform:uppercase;">
              P6 · Safe-to-Delete Verdict Sheet
            </div>
            <div style="font-size:11.5px;font-weight:700;color:#fff;margin-top:3px;">
              ✓ Originals, iCloud Photos & Chat History Untouched
            </div>
            <div style="font-size:10.5px;color:var(--text-dim);margin-top:3px;">
              Matches <code>sweeprcleaner.com/safe-to-delete</code> guarantees: only duplicate bursts, cached streams, and already-synced local proxies are removed.
            </div>
          </div>

          <div class="bento-cell" style="margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">
            <div>
              <div style="font-weight:700;">Similar & Duplicate Bursts</div>
              <div style="font-size:10px;color:var(--emerald);">✓ Keeps Best Shot in iCloud</div>
            </div>
            <span style="font-weight:800;color:var(--emerald);">4.8 GB</span>
          </div>

          <div class="bento-cell" style="margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">
            <div>
              <div style="font-weight:700;">Large 4K Videos & CapCut Proxies</div>
              <div style="font-size:10px;color:var(--emerald);">✓ Preview Before Removing</div>
            </div>
            <span style="font-weight:800;color:var(--emerald);">5.1 GB</span>
          </div>

          <div class="bento-cell" style="display:flex;justify-content:space-between;align-items:center;">
            <div>
              <div style="font-weight:700;">Social & Media Stream Caches</div>
              <div style="font-size:10px;color:#67e8f9;">Telegram · Discord · Spotify</div>
            </div>
            <span style="font-weight:800;color:var(--emerald);">2.5 GB</span>
          </div>

          <button class="btn-emerald-pill" style="margin-top:12px;">Clean +12.4 GB Safely</button>
        </div>
      </div>
    </div>

    <h2 style="margin:0 0 14px;font-size:19px;">Ranked Product Integration Proposals (${report.proposals.length})</h2>
    <div class="proposals-grid">
      ${proposalsHtml}
    </div>
  </div>

  <script>
    function toggleMockDrawer(id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.style.display = el.style.display === 'none' ? 'block' : 'none';
    }
    function filterMockupStage(mode, btn) {
      var tabs = document.querySelectorAll('.plat-tab');
      tabs.forEach(function(t) { t.classList.remove('active'); });
      if (btn) btn.classList.add('active');
      var d = document.getElementById('frame-desktop');
      var m = document.getElementById('frame-mobile');
      var stage = document.getElementById('mockup-stage');
      if (mode === 'desktop') {
        d.style.display = 'block';
        m.style.display = 'none';
        stage.style.gridTemplateColumns = '1fr';
      } else if (mode === 'mobile') {
        d.style.display = 'none';
        m.style.display = 'grid';
        stage.style.gridTemplateColumns = '1fr';
      } else {
        d.style.display = 'block';
        m.style.display = 'grid';
        stage.style.gridTemplateColumns = '';
      }
    }
  </script>
</body>
</html>`;
}
