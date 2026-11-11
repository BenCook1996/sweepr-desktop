<script lang="ts" module>
  import type { AppRemnant, FreeAllowanceStatus, ScanReport, StartupItem } from "../lib/api";
  const FREE_STARTER_LIMIT_BYTES = 500 * 1024 * 1024;
  let cachedReport: ScanReport | null = null;
  let cachedSelected: Record<string, boolean> = {};
  let cachedRemnants: AppRemnant[] = [];
  let cachedStartups: StartupItem[] = [];
  let cachedIncludeRemnants = true;
  let cachedFreeAllowance: FreeAllowanceStatus = {
    used_bytes: 0,
    limit_bytes: FREE_STARTER_LIMIT_BYTES,
    remaining_bytes: FREE_STARTER_LIMIT_BYTES,
    files_cleaned: 0,
    exhausted: false,
    updated_at: 0,
  };
</script>

<script lang="ts">
  import { onMount, tick } from "svelte";
  import { fade, fly, scale } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import {
    api,
    errorMessage,
    isPaymentRequired,
    OPEN_UNDO_EVENT,
    requestActivation,
    trackAppEvent,
    type AppInfo,
    type CategoryResult,
    type CleanReport,
    type LicenseStatus,
    type QuarantineEntry,
    type RunningAppConflict,
    type ScanProgress,
  } from "../lib/api";
  import { formatBytes } from "../lib/format";
  import { addLifetimeStats, syncLifetimeStatsFromBackend } from "../lib/store";
  import { lang, t } from "../lib/i18n";
  import {
    CACHE_INTELLIGENCE,
    resolveFilePathSafetyIntelligence,
    resolveRuleSafetyIntelligence,
  } from "../lib/cache-intelligence";

  let {
    license,
    info = null,
    onLicenseChange,
    onOpenTool,
  }: {
    license: LicenseStatus | null;
    info?: AppInfo | null;
    onLicenseChange: (force?: boolean) => Promise<void>;
    onOpenTool?: (tool: "memory" | "battery" | "apps" | "storage" | "privacy" | "shredder" | "schedule" | "cloud") => void;
  } = $props();

  type Phase = "idle" | "scanning" | "cleaning" | "done";
  let phase = $state<Phase>("idle");
  const isBusy = $derived(phase === "scanning" || phase === "cleaning");
  let progress = $state<ScanProgress | null>(null);
  let report = $state<ScanReport | null>(cachedReport);
  let selected = $state<Record<string, boolean>>(cachedSelected);
  let remnants = $state<AppRemnant[]>(cachedRemnants);
  let startups = $state<StartupItem[]>(cachedStartups);
  let includeRemnants = $state<boolean>(cachedIncludeRemnants);
  let expandedGroup = $state<string | null>(null);
  const expandedIds = $derived(new Set(expandedGroup ? [expandedGroup] : []));
  let error = $state<string | null>(null);
  let results = $state<CleanReport[]>([]);
  let freedTotal = $state(0);
  let removedTotal = $state(0);

  let quarantine = $state<QuarantineEntry[]>([]);
  let showQuarantine = $state(false);
  let undoSearch = $state("");
  let restoringAll = $state(false);
  let restoreNotice = $state<string | null>(null);
  let runningConflicts = $state<RunningAppConflict[]>([]);
  let pendingCleanAfterAuth = $state(false);
  let freeAllowance = $state<FreeAllowanceStatus>(cachedFreeAllowance);

  async function refreshFreeAllowance(): Promise<FreeAllowanceStatus> {
    try {
      const fa = await api.getFreeAllowance();
      freeAllowance = fa;
      cachedFreeAllowance = fa;
      return fa;
    } catch {
      return freeAllowance;
    }
  }

  // Viral "I Just Reclaimed X.X GB with SWEEPR" Shareable Benchmark Card State
  let showShareWinModal = $state(false);
  let shareCanvasEl = $state<HTMLCanvasElement | null>(null);
  let shareActionToast = $state<string | null>(null);

  // 1-Time Peak Delight Review Capture Card (>= 500 MB freed with 0 errors, throttled via localStorage)
  const REVIEW_DELIGHT_STORAGE_KEY = "sweepr_review_delight_shown_v1";
  let showReviewDelightCard = $state(false);
  function dismissReviewDelightCard() {
    showReviewDelightCard = false;
    try {
      localStorage.setItem(REVIEW_DELIGHT_STORAGE_KEY, "1");
    } catch {}
  }

  const referralCode = $derived.by(() => {
    try {
      const saved = localStorage.getItem("sweepr_referral_code");
      if (saved && saved.trim()) return saved.trim().toUpperCase();
    } catch {}
    const seed = (info?.device_id || info?.machine_id || "PRO2026")
      .replace(/[^A-Za-z0-9]/g, "")
      .slice(0, 8)
      .toUpperCase();
    return `SWP-${seed || "PRO2026"}`;
  });

  const shareReclaimedBytes = $derived(
    freedTotal > 0 ? freedTotal : targetHeroBytes > 0 ? targetHeroBytes : 6.4 * 1024 * 1024 * 1024
  );
  const shareReclaimedLabel = $derived(formatBytes(shareReclaimedBytes));
  const shareScanDurationMs = $derived(Math.max(38, report?.duration_ms ?? 312));
  const shareTopCulprit = $derived.by(() => {
    const cats = report?.categories ? [...report.categories].filter((c) => c.bytes > 0) : [];
    cats.sort((a, b) => b.bytes - a.bytes);
    if (cats.length >= 2) {
      return `${cats[0].name} / ${cats[1].name}`;
    }
    if (cats.length === 1) {
      return `${cats[0].name} / Shader Cache`;
    }
    return isMacOs ? "Xcode DerivedData / ComfyUI / Safari Cache" : "NVIDIA DXCache / ComfyUI / Xcode";
  });
  const shareReferralShortDisplay = $derived(`sweeprcleaner.com/r/${referralCode}`);
  const shareWinPublicUrl = $derived(
    `https://sweeprcleaner.com/share/win?gb=${encodeURIComponent(shareReclaimedLabel)}&culprit=${encodeURIComponent(shareTopCulprit)}&ms=${encodeURIComponent(String(shareScanDurationMs))}&code=${encodeURIComponent(referralCode)}`
  );

  function renderShareWinCanvas() {
    const canvas = shareCanvasEl;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = 1200;
    const H = 630;
    canvas.width = W;
    canvas.height = H;

    // 1. Sleek Dark-Emerald Background Gradient
    const bgGrad = ctx.createLinearGradient(0, 0, W, H);
    bgGrad.addColorStop(0, "#03110c");
    bgGrad.addColorStop(0.52, "#062319");
    bgGrad.addColorStop(1, "#041610");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    // Subtle Bioluminescent Radial Glow
    const glow = ctx.createRadialGradient(W * 0.78, H * 0.28, 30, W * 0.78, H * 0.28, 440);
    glow.addColorStop(0, "rgba(16, 185, 129, 0.26)");
    glow.addColorStop(0.6, "rgba(6, 182, 212, 0.08)");
    glow.addColorStop(1, "rgba(4, 22, 16, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    // Subtle Precision Grid Overlay
    ctx.strokeStyle = "rgba(16, 185, 129, 0.07)";
    ctx.lineWidth = 1;
    for (let x = 60; x < W; x += 60) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    for (let y = 60; y < H; y += 60) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    // Card Frame Border
    ctx.strokeStyle = "rgba(16, 185, 129, 0.45)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(28, 28, W - 56, H - 56, 28);
    ctx.stroke();

    // Top Header Pill + Brand Wordmark
    ctx.fillStyle = "#10b981";
    ctx.font = "800 22px system-ui, -apple-system, Segoe UI, sans-serif";
    ctx.fillText("⚡ SWEEPR CLEANER · STORAGE BENCHMARK", 72, 92);

    ctx.fillStyle = "rgba(16, 185, 129, 0.18)";
    ctx.beginPath();
    ctx.roundRect(W - 360, 62, 288, 44, 22);
    ctx.fill();
    ctx.strokeStyle = "rgba(16, 185, 129, 0.55)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = "#6ee7b7";
    ctx.font = "800 17px system-ui, -apple-system, Segoe UI, sans-serif";
    ctx.fillText("+30 DAYS FREE PRO PASS", W - 332, 90);

    // Main Viral Headline
    ctx.fillStyle = "#ecfdf5";
    ctx.font = "900 62px system-ui, -apple-system, Segoe UI, sans-serif";
    ctx.fillText(`I Just Reclaimed ${shareReclaimedLabel}`, 72, 195);

    ctx.fillStyle = "#34d399";
    ctx.font = "800 36px system-ui, -apple-system, Segoe UI, sans-serif";
    ctx.fillText(`with SWEEPR Cleaner (${osDiskLabel})`, 72, 248);

    // 3 Telemetry Metric Boxes (GB Reclaimed, Top Culprit, Scan Duration in ms)
    const boxY = 292;
    const boxH = 172;
    const boxes = [
      {
        x: 72,
        w: 310,
        kicker: "STORAGE RECLAIMED",
        value: shareReclaimedLabel,
        sub: `${removedTotal || report?.total_files || 1240} junk files purged`,
        accent: "#34d399",
      },
      {
        x: 404,
        w: 472,
        kicker: "TOP CULPRIT",
        value: shareTopCulprit.length > 26 ? `${shareTopCulprit.slice(0, 25)}…` : shareTopCulprit,
        sub: "100% Safe Automated Rule · 7-Day Undo",
        accent: "#38bdf8",
      },
      {
        x: 898,
        w: 230,
        kicker: "SCAN SPEED",
        value: `${shareScanDurationMs} ms`,
        sub: "Native Rust Engine",
        accent: "#fbbf24",
      },
    ];

    for (const b of boxes) {
      ctx.fillStyle = "rgba(7, 38, 27, 0.86)";
      ctx.beginPath();
      ctx.roundRect(b.x, boxY, b.w, boxH, 20);
      ctx.fill();
      ctx.strokeStyle = "rgba(16, 185, 129, 0.32)";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = "#9ca3af";
      ctx.font = "800 15px ui-monospace, SFMono-Regular, Consolas, monospace";
      ctx.fillText(b.kicker, b.x + 24, boxY + 42);

      ctx.fillStyle = b.accent;
      ctx.font = b.w > 400 ? "800 28px system-ui, -apple-system, sans-serif" : "900 40px system-ui, -apple-system, sans-serif";
      ctx.fillText(b.value, b.x + 24, boxY + 102);

      ctx.fillStyle = "#d1fae5";
      ctx.font = "600 16px system-ui, -apple-system, sans-serif";
      ctx.fillText(b.sub, b.x + 24, boxY + 142);
    }

    // Bottom Referral Footer Bar
    ctx.fillStyle = "rgba(16, 185, 129, 0.14)";
    ctx.beginPath();
    ctx.roundRect(72, 496, W - 144, 74, 18);
    ctx.fill();
    ctx.strokeStyle = "rgba(52, 211, 153, 0.45)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = "#a7f3d0";
    ctx.font = "700 20px system-ui, -apple-system, sans-serif";
    ctx.fillText("Claim +30 Days Free SWEEPR Pro:", 98, 541);

    ctx.fillStyle = "#ffffff";
    ctx.font = "800 23px ui-monospace, SFMono-Regular, Consolas, monospace";
    ctx.fillText(shareReferralShortDisplay, 430, 541);
  }

  function openShareWinModal() {
    showShareWinModal = true;
    shareActionToast = null;
    trackAppEvent("referral_aha_clicked", {
      bytes_cleaned: shareReclaimedBytes,
      top_culprit: shareTopCulprit,
      duration_ms: shareScanDurationMs,
      referral_code: referralCode,
    });
    setTimeout(() => renderShareWinCanvas(), 20);
  }

  async function copyShareWinCardImage() {
    renderShareWinCanvas();
    const canvas = shareCanvasEl;
    if (!canvas) return;
    try {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (blob && typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        shareActionToast = "Copied benchmark card image to clipboard! Paste anywhere (Ctrl+V / ⌘V).";
        return;
      }
    } catch {}
    try {
      await navigator.clipboard.writeText(
        `I just reclaimed ${shareReclaimedLabel} in ${shareScanDurationMs}ms with SWEEPR Cleaner (Top culprit: ${shareTopCulprit})! Claim +30 days Free Pro: ${shareWinPublicUrl}`
      );
      shareActionToast = "Copied share link & benchmark summary to clipboard!";
    } catch {
      shareActionToast = `Share URL: ${shareReferralShortDisplay}`;
    }
  }

  async function shareWinOnSocial(network: "x" | "reddit" | "discord") {
    const shareText = `I just reclaimed ${shareReclaimedLabel} in ${shareScanDurationMs}ms with @SWEEPRCleaner! Top culprit: ${shareTopCulprit}. Claim +30 days Free Pro:`;
    trackAppEvent("referral_aha_clicked", {
      network,
      bytes_cleaned: shareReclaimedBytes,
      top_culprit: shareTopCulprit,
      duration_ms: shareScanDurationMs,
      referral_code: referralCode,
    });
    if (network === "x") {
      const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareWinPublicUrl)}`;
      window.open(url, "_blank", "noopener,noreferrer");
    } else if (network === "reddit") {
      const title = `I just reclaimed ${shareReclaimedLabel} with SWEEPR Cleaner in ${shareScanDurationMs}ms (Top culprit: ${shareTopCulprit})`;
      const url = `https://www.reddit.com/submit?url=${encodeURIComponent(shareWinPublicUrl)}&title=${encodeURIComponent(title)}`;
      window.open(url, "_blank", "noopener,noreferrer");
    } else if (network === "discord") {
      await copyShareWinCardImage();
      try {
        await navigator.clipboard.writeText(`${shareText} ${shareWinPublicUrl}`);
      } catch {}
      shareActionToast = "Copied rich Discord share link (unfurls storage card) — paste into any Discord channel!";
      window.open("https://discord.com/app", "_blank", "noopener,noreferrer");
    }
  }

  // 377-Item Plain-English Cache Safety Intelligence State
  let expandedRuleIntel = $state<Record<string, boolean>>({});
  let expandedFileIntel = $state<Record<string, boolean>>({});
  let safetyCheckPath = $state("");
  let safetySearchInputEl = $state<HTMLInputElement | null>(null);
  const safetyCheckResult = $derived(
    safetyCheckPath.trim() ? resolveFilePathSafetyIntelligence(safetyCheckPath) : null
  );

  const SAMPLE_SAFETY_PATHS = [
    "%AppData%\\discord\\Cache",
    "Steam\\steamapps\\shadercache",
    "Chrome\\User Data\\Default\\Service Worker\\CacheStorage",
    "C:\\Windows\\SoftwareDistribution\\Download",
  ];

  function toggleRuleIntel(ruleId: string) {
    expandedRuleIntel = {
      ...expandedRuleIntel,
      [ruleId]: !expandedRuleIntel[ruleId],
    };
  }

  function toggleFileIntel(fileKey: string) {
    expandedFileIntel = {
      ...expandedFileIntel,
      [fileKey]: !expandedFileIntel[fileKey],
    };
  }

  // Dynamic OS Disk Label & Localized Add-on Price (D3 Architecture)
  let osDiskLabel = $state("Local Disk (C:) · NVMe");
  let localizedAddonPrice = $state("£9.99/yr");
  let isMacOs = $state(false);
  let hasMacosFda = $state(true);

  const nonEmpty = $derived(report?.categories.filter((c) => c.bytes > 0) ?? []);

  const SYS_BROWSER_RE =
    /temp|log|crash|update|prefetch|thumb|font|dns|shader|memory_dump|windows|chrome|edge|brave|firefox|opera|vivaldi|safari|browser|delivery_opt|recent_activity|system_slimmer|webview2|trash/i;

  const sysBrowserCats = $derived(nonEmpty.filter((c) => SYS_BROWSER_RE.test(c.id)));
  const appCacheCats = $derived(nonEmpty.filter((c) => !SYS_BROWSER_RE.test(c.id)));

  const sysBrowserBytes = $derived(sysBrowserCats.reduce((s, c) => s + c.bytes, 0));
  const appCacheBytes = $derived(appCacheCats.reduce((s, c) => s + c.bytes, 0));
  const remnantsBytes = $derived(remnants.reduce((s, r) => s + r.bytes, 0));
  const appAndRemnantsBytes = $derived(appCacheBytes + remnantsBytes);
  const enabledStartups = $derived(startups.filter((s) => s.enabled));

  const sysBrowserChecked = $derived(
    sysBrowserCats.length > 0 && sysBrowserCats.some((c) => selected[c.id])
  );
  const appCacheChecked = $derived(
    (appCacheCats.length > 0 && appCacheCats.some((c) => selected[c.id])) ||
      (remnants.length > 0 && includeRemnants)
  );

  const selectedCats = $derived(nonEmpty.filter((c) => selected[c.id]));
  const freeEligibleCats = $derived(nonEmpty.filter((c) => c.free));
  const freeEligibleBytes = $derived(freeEligibleCats.reduce((s, c) => s + c.bytes, 0));
  const starterCleanableNowBytes = $derived(Math.min(freeEligibleBytes, freeAllowance.remaining_bytes));
  const freeSelectedCats = $derived(selectedCats.filter((c) => c.free));
  const proSelectedCats = $derived(selectedCats.filter((c) => !c.free));
  const starterSelectedBytes = $derived(freeSelectedCats.reduce((s, c) => s + c.bytes, 0));
  const hasProSelection = $derived(
    proSelectedCats.length > 0 || (includeRemnants && remnants.length > 0)
  );
  const selectedBytes = $derived(
    selectedCats.reduce((s, c) => s + c.bytes, 0) + (includeRemnants ? remnantsBytes : 0)
  );
  const totalFoundBytes = $derived((report?.total_bytes ?? 0) + remnantsBytes);
  const isStarterSelectionOnly = $derived(
    !license?.active &&
      !freeAllowance.exhausted &&
      freeSelectedCats.length > 0 &&
      !hasProSelection
  );
  const targetHeroBytes = $derived(
    isStarterSelectionOnly
      ? totalFoundBytes
      : selectedBytes > 0
        ? selectedBytes
        : totalFoundBytes
  );
  const freedStarterOrSessionBytes = $derived(Math.max(freedTotal, freeAllowance.used_bytes));
  const remainingUncleanedBytes = $derived.by(() => {
    if (totalFoundBytes > 0) return totalFoundBytes;
    try {
      const last = Number(localStorage.getItem("sweepr_last_scan_bytes") || "0") || 0;
      return Math.max(0, last - freedStarterOrSessionBytes);
    } catch {
      return 0;
    }
  });
  let displayedHeroBytes = $state(0);
  let depletingBytes = $state(0);

  const GAMING_SHADER_IDS = new Set([
    "shader_cache",
    "steam_cache",
    "game_launchers",
    "riot_valorant_logs",
    "genshin_hoyoplay_cache",
  ]);
  const AI_DEV_CACHE_IDS = new Set([
    "creator_ai_caches",
    "dev_caches",
    "build_caches",
    "xcode",
  ]);

  const gamingShaderBytes = $derived(
    nonEmpty.filter((c) => GAMING_SHADER_IDS.has(c.id)).reduce((s, c) => s + c.bytes, 0)
  );
  const aiDevCacheBytes = $derived(
    nonEmpty.filter((c) => AI_DEV_CACHE_IDS.has(c.id)).reduce((s, c) => s + c.bytes, 0)
  );

  function getCategoryProFeatureLabel(c: CategoryResult): string {
    if (GAMING_SHADER_IDS.has(c.id)) return "Gaming Shaders";
    if (AI_DEV_CACHE_IDS.has(c.id)) return "AI / Dev Caches";
    if (c.id === "duplicates") return "Duplicates";
    if (c.group === "browsers" || c.id === "webview2_cache") return "Browser Caches";
    return c.name;
  }

  function buildContextualUpgradeCopy(
    overrideFreedBytes?: number,
    overrideRemainingBytes?: number
  ): string {
    const freedB = overrideFreedBytes ?? freedStarterOrSessionBytes;
    const remB = overrideRemainingBytes ?? remainingUncleanedBytes;
    if (freedB > 0 && remB > 0) {
      return `You just freed ${formatBytes(freedB)}! Unlock SWEEPR Pro to clean the remaining ${formatBytes(remB)} across all 5 devices.`;
    }
    if (freedB > 0) {
      return `You just freed ${formatBytes(freedB)}! Unlock SWEEPR Pro for unlimited Gaming Shaders, AI/Dev Caches, Duplicates & Scheduled Clean across all 5 devices.`;
    }
    if (remB > 0) {
      return starterCleanableNowBytes > 0
        ? `Unlock SWEEPR Pro to clean all ${formatBytes(remB)} across all 5 devices — or run your free ${formatBytes(starterCleanableNowBytes)} Starter Clean on Basic Temp first!`
        : `Unlock SWEEPR Pro to clean the remaining ${formatBytes(remB)} across all 5 devices.`;
    }
    return "Unlock SWEEPR Pro for unlimited Gaming Shaders, AI/Dev Caches, App Remnants, Duplicates & Scheduled Clean across all 5 devices.";
  }

  function openProUpgradeModal(
    feature?: string,
    overrideFreedBytes?: number,
    overrideRemainingBytes?: number
  ) {
    const freedB = overrideFreedBytes ?? freedStarterOrSessionBytes;
    const remB = overrideRemainingBytes ?? remainingUncleanedBytes;
    requestActivation({
      message: buildContextualUpgradeCopy(freedB, remB),
      feature,
      freedBytes: freedB,
      remainingBytes: remB,
    });
  }

  // Segmented Native Storage Bar Fractions
  const sysSegmentPct = $derived(
    totalFoundBytes > 0
      ? Math.min(34, Math.max(8, Math.round((sysBrowserBytes / Math.max(1, totalFoundBytes)) * 38)))
      : 14
  );
  const appSegmentPct = $derived(
    totalFoundBytes > 0
      ? Math.min(28, Math.max(6, Math.round((appAndRemnantsBytes / Math.max(1, totalFoundBytes)) * 32)))
      : 10
  );
  const dupSegmentPct = $derived(8);

  $effect(() => {
    const target = targetHeroBytes;
    const from = displayedHeroBytes;
    if (from === target) return;
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      displayedHeroBytes = target;
      return;
    }
    const start = performance.now();
    const duration = 160;
    let rafId = 0;
    function tick(now: number) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 4);
      displayedHeroBytes = Math.round(from + (target - from) * eased);
      if (t < 1) rafId = requestAnimationFrame(tick);
    }
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  });

  const filteredQuarantine = $derived.by(() => {
    const q = undoSearch.trim().toLowerCase();
    if (!q) return quarantine;
    return quarantine.filter(
      (item) =>
        item.file_name.toLowerCase().includes(q) ||
        item.original_path.toLowerCase().includes(q)
    );
  });

  function toggleRuleSelection(c: CategoryResult, checked: boolean) {
    const next = { ...selected, [c.id]: checked };
    selected = next;
    cachedSelected = next;
    if (checked && !c.free && !license?.active) {
      pendingCleanAfterAuth = true;
      openProUpgradeModal(getCategoryProFeatureLabel(c));
    }
  }

  function toggleGroup(cats: CategoryResult[], checked: boolean) {
    const next = { ...selected };
    for (const c of cats) {
      next[c.id] = checked;
    }
    selected = next;
    cachedSelected = next;
    if (checked && !license?.active && cats.some((c) => !c.free)) {
      pendingCleanAfterAuth = true;
      openProUpgradeModal("Browser & Gaming Shader Caches");
    }
  }

  function toggleAppAndRemnants(checked: boolean) {
    const next = { ...selected };
    for (const c of appCacheCats) {
      next[c.id] = checked;
    }
    selected = next;
    cachedSelected = next;
    if (remnants.length > 0) {
      includeRemnants = checked;
      cachedIncludeRemnants = checked;
    }
    if (checked && !license?.active) {
      pendingCleanAfterAuth = true;
      openProUpgradeModal("App Remnants & AI/Gaming Caches");
    }
  }

  function selectAllRemainingForPro() {
    if (!report) return;
    const next: Record<string, boolean> = {};
    for (const c of report.categories) {
      next[c.id] = c.bytes > 0;
    }
    selected = next;
    cachedSelected = next;
    includeRemnants = remnants.length > 0;
    cachedIncludeRemnants = includeRemnants;
  }

  function handleProQuickCategory(
    kind: "starter" | "shaders" | "ai_dev" | "remnants" | "duplicates" | "schedule"
  ) {
    if (kind === "starter") {
      if (freeAllowance.exhausted) {
        selectAllRemainingForPro();
        pendingCleanAfterAuth = true;
        openProUpgradeModal("500 MB Free Starter Clean Used");
        return;
      }
      if (freeEligibleCats.length > 0) {
        const next: Record<string, boolean> = {};
        for (const c of nonEmpty) {
          next[c.id] = c.free && c.bytes > 0;
        }
        selected = next;
        cachedSelected = next;
        includeRemnants = false;
        cachedIncludeRemnants = false;
        requestClean();
      } else {
        scan();
      }
      return;
    }

    if (kind === "duplicates") {
      if (!license?.active) {
        openProUpgradeModal("Duplicates");
        return;
      }
      onOpenTool?.("storage");
      return;
    }

    if (kind === "schedule") {
      if (!license?.active) {
        openProUpgradeModal("Scheduled Clean");
        return;
      }
      onOpenTool?.("schedule");
      return;
    }

    if (kind === "shaders") {
      const targets = nonEmpty.filter((c) => GAMING_SHADER_IDS.has(c.id));
      if (!license?.active) {
        if (targets.length > 0) {
          const next = { ...selected };
          for (const t of targets) next[t.id] = true;
          selected = next;
          cachedSelected = next;
        }
        pendingCleanAfterAuth = true;
        openProUpgradeModal("Gaming Shaders");
        return;
      }
      if (targets.length > 0) {
        cleanSpecificCategoryGroup(targets, false);
      } else {
        expandedGroup = "app";
      }
      return;
    }

    if (kind === "ai_dev") {
      const targets = nonEmpty.filter((c) => AI_DEV_CACHE_IDS.has(c.id));
      if (!license?.active) {
        if (targets.length > 0) {
          const next = { ...selected };
          for (const t of targets) next[t.id] = true;
          selected = next;
          cachedSelected = next;
        }
        pendingCleanAfterAuth = true;
        openProUpgradeModal("AI/Dev Caches");
        return;
      }
      if (targets.length > 0) {
        cleanSpecificCategoryGroup(targets, false);
      } else {
        expandedGroup = "app";
      }
      return;
    }

    if (kind === "remnants") {
      if (!license?.active) {
        if (remnants.length > 0) {
          includeRemnants = true;
          cachedIncludeRemnants = true;
        }
        for (const c of appCacheCats) {
          selected[c.id] = true;
        }
        cachedSelected = { ...selected };
        pendingCleanAfterAuth = true;
        openProUpgradeModal("App Remnants");
        return;
      }
      if (appAndRemnantsBytes > 0) {
        cleanSpecificCategoryGroup(appCacheCats, remnants.length > 0);
      } else {
        onOpenTool?.("apps");
      }
    }
  }

  async function scan() {
    if (phase === "scanning" || phase === "cleaning") return;
    error = null;
    phase = "scanning";
    progress = null;
    trackAppEvent("scan_started");
    const unlisten = await api.onScanProgress((p) => (progress = p));
    try {
      const [scanRes, remRes, startRes, faRes] = await Promise.allSettled([
        api.scan(),
        api.scanAppRemnants(),
        api.startupItems(),
        refreshFreeAllowance(),
      ]);

      const currentAllowance = faRes.status === "fulfilled" ? faRes.value : freeAllowance;
      const loadedRemnants = remRes.status === "fulfilled" ? remRes.value : remnants;

      if (remRes.status === "fulfilled") {
        remnants = loadedRemnants;
        cachedRemnants = loadedRemnants;
      }
      if (startRes.status === "fulfilled") {
        startups = startRes.value;
        cachedStartups = startRes.value;
      }

      if (scanRes.status === "fulfilled") {
        const r = scanRes.value;
        report = r;
        cachedReport = r;
        const hasFreeStarterTargets =
          !license?.active &&
          !currentAllowance.exhausted &&
          r.categories.some((c) => c.free && c.bytes > 0);

        const sel = Object.fromEntries(
          r.categories.map((c) => [
            c.id,
            hasFreeStarterTargets ? c.free && c.bytes > 0 : c.bytes > 0,
          ])
        );
        selected = sel;
        cachedSelected = sel;
        includeRemnants = hasFreeStarterTargets ? false : loadedRemnants.length > 0;
        cachedIncludeRemnants = includeRemnants;

        const activeCats = r.categories.filter((c) => c.bytes > 0);
        const activeIds = activeCats.map((c) => c.id);
        const ruleBytes: Record<string, number> = {};
        for (const c of activeCats) {
          ruleBytes[c.id] = c.bytes;
        }
        trackAppEvent("scan_completed", {
          total_bytes: r.total_bytes,
          total_files: r.total_files,
          duration_ms: r.duration_ms,
          item_count: activeCats.length,
          rule_bytes: ruleBytes,
        });
        api
          .checkRunningApps(activeIds)
          .then((conflicts) => (runningConflicts = conflicts))
          .catch(() => (runningConflicts = []));
      } else {
        throw scanRes.reason;
      }
    } catch (e) {
      error = errorMessage(e);
    } finally {
      unlisten();
      phase = "idle";
    }
  }

  function requestClean() {
    if (!report || totalFoundBytes === 0) {
      scan();
      return;
    }
    if (selectedBytes === 0) {
      if (!license?.active && totalFoundBytes > 0) {
        selectAllRemainingForPro();
        pendingCleanAfterAuth = true;
        openProUpgradeModal("Full Deep Cleanup");
      }
      return;
    }
    if (!license?.active) {
      const canRunFreeStarter =
        freeSelectedCats.length > 0 &&
        starterSelectedBytes > 0 &&
        !freeAllowance.exhausted &&
        freeAllowance.remaining_bytes > 0;
      if (!canRunFreeStarter) {
        pendingCleanAfterAuth = true;
        openProUpgradeModal(
          freeAllowance.exhausted ? "500 MB Free Starter Clean Used" : "Pro Deep Cleanup"
        );
        return;
      }
    }
    void executeClean();
  }

  function cleanSpecificCategoryGroup(cats: CategoryResult[], withRemnants = false) {
    const next: Record<string, boolean> = {};
    for (const c of nonEmpty) {
      next[c.id] = cats.some((target) => target.id === c.id);
    }
    selected = next;
    cachedSelected = next;
    includeRemnants = withRemnants;
    cachedIncludeRemnants = withRemnants;
    requestClean();
  }

  async function executeClean(forcePro = false) {
    const isProActive = Boolean(license?.active || forcePro);
    if (!isProActive) {
      const freeCatsToClean = selectedCats.filter((c) => c.free && c.bytes > 0);
      const hadProSelected = hasProSelection;
      if (
        freeCatsToClean.length === 0 ||
        freeAllowance.exhausted ||
        freeAllowance.remaining_bytes <= 0
      ) {
        pendingCleanAfterAuth = true;
        openProUpgradeModal(
          freeAllowance.exhausted ? "500 MB Free Starter Clean Used" : "Pro Deep Cleanup"
        );
        return;
      }

      error = null;
      const initialDeplete = Math.min(
        freeCatsToClean.reduce((s, c) => s + c.bytes, 0),
        freeAllowance.remaining_bytes
      );
      depletingBytes = initialDeplete;
      phase = "cleaning";
      if (
        typeof window !== "undefined" &&
        !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
      ) {
        const start = performance.now();
        const duration = 180;
        const tickDeplete = (now: number) => {
          const t = Math.min(1, (now - start) / duration);
          const eased = 1 - Math.pow(1 - t, 4);
          depletingBytes = Math.max(0, Math.round(initialDeplete * (1 - eased)));
          if (t < 1 && phase === "cleaning") requestAnimationFrame(tickDeplete);
        };
        requestAnimationFrame(tickDeplete);
      } else {
        depletingBytes = 0;
      }

      try {
        const freeIds = freeCatsToClean.map((c) => c.id);
        const cleanedReports = await api.clean(freeIds, false);
        const updatedAllowance = await refreshFreeAllowance();

        results = cleanedReports;
        const catFreed = cleanedReports.reduce((s, r) => s + r.bytes_freed, 0);
        const catRemoved = cleanedReports.reduce((s, r) => s + r.files_removed, 0);
        freedTotal = catFreed;
        removedTotal = catRemoved;

        let remainingAfterStarter = 0;
        if (report) {
          const freedMap = new Map(cleanedReports.map((r) => [r.category_id, r.bytes_freed]));
          const updatedCategories = report.categories.map((c) => {
            const deducted = freedMap.get(c.id) ?? 0;
            if (!deducted) return c;
            return {
              ...c,
              bytes: Math.max(0, c.bytes - deducted),
            };
          });
          const updatedTotal = updatedCategories.reduce((s, c) => s + c.bytes, 0);
          report = {
            ...report,
            categories: updatedCategories,
            total_bytes: updatedTotal,
          };
          cachedReport = report;
          remainingAfterStarter = updatedTotal + remnantsBytes;

          const nextSel: Record<string, boolean> = {};
          for (const c of updatedCategories) {
            nextSel[c.id] = !updatedAllowance.exhausted ? c.free && c.bytes > 0 : c.bytes > 0;
          }
          selected = nextSel;
          cachedSelected = nextSel;
        }

        addLifetimeStats(
          freedTotal,
          removedTotal,
          freeIds,
          "Recently Cleaned (7-day undo)",
          false
        );
        trackAppEvent("free_starter_clean_completed", {
          cleaned_bytes: freedTotal,
          files_removed: removedTotal,
          allowance_used_bytes: updatedAllowance.used_bytes,
          allowance_remaining_bytes: updatedAllowance.remaining_bytes,
          remaining_pro_bytes: remainingAfterStarter,
        });
        await syncLifetimeStatsFromBackend().catch(() => {});
        api.listQuarantine().then((q) => (quarantine = q)).catch(() => {});
        phase = "done";

        const contextualFreed = Math.max(freedTotal, updatedAllowance.used_bytes);
        if (
          remainingAfterStarter > 0 &&
          (hadProSelected || updatedAllowance.exhausted)
        ) {
          selectAllRemainingForPro();
          pendingCleanAfterAuth = true;
          setTimeout(() => {
            openProUpgradeModal(
              updatedAllowance.exhausted
                ? "500 MB Free Starter Clean Complete"
                : "Unlock Full Cleanup",
              contextualFreed,
              remainingAfterStarter
            );
          }, 360);
        }
      } catch (e: any) {
        phase = "idle";
        const latestAllowance = await refreshFreeAllowance();
        if (isPaymentRequired(e)) {
          selectAllRemainingForPro();
          pendingCleanAfterAuth = true;
          openProUpgradeModal(
            latestAllowance.exhausted ? "500 MB Free Starter Clean Used" : "Pro Deep Cleanup",
            Math.max(freedTotal, latestAllowance.used_bytes),
            remainingUncleanedBytes
          );
        } else {
          error = errorMessage(e);
        }
      }
      return;
    }

    pendingCleanAfterAuth = false;
    error = null;
    const initialDeplete = selectedBytes > 0 ? selectedBytes : totalFoundBytes;
    depletingBytes = initialDeplete;
    phase = "cleaning";
    if (typeof window !== "undefined" && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      const start = performance.now();
      const duration = 180;
      const tickDeplete = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - t, 4);
        depletingBytes = Math.max(0, Math.round(initialDeplete * (1 - eased)));
        if (t < 1 && phase === "cleaning") requestAnimationFrame(tickDeplete);
      };
      requestAnimationFrame(tickDeplete);
    } else {
      depletingBytes = 0;
    }
    try {
      const catIds = selectedCats.map((c) => c.id);
      let cleanedReports: CleanReport[] = [];
      if (catIds.length > 0) {
        cleanedReports = await api.clean(catIds, false);
      }
      let remBytesFreed = 0;
      let remFilesRemoved = 0;
      if (includeRemnants && remnants.length > 0) {
        for (const r of remnants) {
          try {
            await api.cleanAppRemnant(r.path);
            remBytesFreed += r.bytes;
            remFilesRemoved += r.files || 1;
          } catch {
            // Skip locked remnants
          }
        }
        remnants = [];
        cachedRemnants = [];
      }

      results = cleanedReports;
      const catFreed = cleanedReports.reduce((s, r) => s + r.bytes_freed, 0);
      const catRemoved = cleanedReports.reduce((s, r) => s + r.files_removed, 0);
      freedTotal = catFreed + remBytesFreed;
      removedTotal = catRemoved + remFilesRemoved;

      addLifetimeStats(
        freedTotal,
        removedTotal,
        catIds,
        "Recently Cleaned (7-day undo)",
        false
      );
      trackAppEvent("clean_completed", {
        cleaned_bytes: freedTotal,
        files_removed: removedTotal,
        categories: catIds,
      });
      await syncLifetimeStatsFromBackend().catch(() => {});
      api.listQuarantine().then((q) => (quarantine = q)).catch(() => {});
      phase = "done";
      if (freedTotal >= 500 * 1024 * 1024 && !error) {
        try {
          if (localStorage.getItem(REVIEW_DELIGHT_STORAGE_KEY) !== "1") {
            localStorage.setItem(REVIEW_DELIGHT_STORAGE_KEY, "1");
            showReviewDelightCard = true;
          }
        } catch {}
      }
    } catch (e: any) {
      phase = "idle";
      if (isPaymentRequired(e)) {
        pendingCleanAfterAuth = true;
        openProUpgradeModal("Pro Deep Cleanup");
      } else {
        error = errorMessage(e);
      }
    }
  }

  async function openUndoModal() {
    showQuarantine = true;
    restoreNotice = null;
    quarantine = await api.listQuarantine().catch(() => []);
  }

  async function restoreQuarantined(item: QuarantineEntry) {
    error = null;
    restoreNotice = null;
    try {
      await api.restoreQuarantineItem(item.id);
      quarantine = quarantine.filter((q) => q.id !== item.id);
      restoreNotice = `Restored ${item.file_name}`;
    } catch (e) {
      error = errorMessage(e);
    }
  }

  async function restoreAllQuarantined() {
    if (!quarantine.length || restoringAll) return;
    restoringAll = true;
    error = null;
    restoreNotice = null;
    try {
      const items = [...quarantine];
      await Promise.allSettled(items.map((item) => api.restoreQuarantineItem(item.id)));
      quarantine = await api.listQuarantine().catch(() => []);
      restoreNotice = "Restored all files";
    } catch (e) {
      error = errorMessage(e);
    } finally {
      restoringAll = false;
    }
  }

  function onWindowKeydown(e: KeyboardEvent) {
    const target = e.target as HTMLElement | null;
    const inInput =
      target &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable);

    if (e.key === "Escape" && showQuarantine) {
      e.preventDefault();
      showQuarantine = false;
      return;
    }
    if (!inInput && e.key === "Enter" && !showQuarantine) {
      if (phase === "done") {
        phase = "idle";
        scan();
      } else if (phase === "idle") {
        requestClean();
      }
    }
  }

  onMount(() => {
    // Detect host OS for D3 Native Storage Bar
    try {
      const ua = (navigator.userAgent || "").toLowerCase();
      if (ua.includes("mac")) {
        osDiskLabel = "Mac Hard Drive";
        isMacOs = true;
        api
          .checkMacosFullDiskAccess()
          .then((granted) => {
            hasMacosFda = granted;
          })
          .catch(() => {});
      } else if (ua.includes("linux")) {
        osDiskLabel = "Computer Storage";
      } else {
        osDiskLabel = "Windows Hard Drive (C:)";
      }

      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
      if (tz.startsWith("America/")) {
        localizedAddonPrice = "$9.99/yr";
      } else if (tz.startsWith("Europe/") && !tz.includes("London") && !tz.includes("Belfast")) {
        localizedAddonPrice = "€9.99/yr";
      }
    } catch {}

    // Fetch live localized pricing from server
    let clientTz = "";
    try { clientTz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch {}
    api
      .appInfo()
      .then((inf) => {
        const base = (inf.api_url || "https://sweeprcleaner.com").replace(/\/+$/, "");
        const qs = clientTz ? `?tz=${encodeURIComponent(clientTz)}` : "";
        return fetch(`${base}/api/pricing${qs}`);
      })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const p = d?.pricing;
        if (p?.batteryCareAnnualFormatted) {
          localizedAddonPrice = `${p.batteryCareAnnualFormatted}/yr`;
        }
      })
      .catch(() => {});

    void refreshFreeAllowance();
    api.listQuarantine().then((q) => (quarantine = q)).catch(() => {});
    try {
      if (!localStorage.getItem("sweepr_installed_telemetry_v1")) {
        localStorage.setItem("sweepr_installed_telemetry_v1", "1");
        trackAppEvent("app_installed", { source: "first_launch" });
      }
    } catch {}
    if (!cachedReport) {
      scan();
    }
    const onOpenUndo = () => {
      void openUndoModal();
    };
    const onTriggerScan = (e: Event) => {
      const detail = (e as CustomEvent<{ expand?: string }> | undefined)?.detail;
      if (detail?.expand) {
        expandedGroup = detail.expand;
      }
      scan();
    };
    const onActivated = async () => {
      await onLicenseChange(true);
      await tick();
      if (pendingCleanAfterAuth) {
        if (selectedBytes === 0 && totalFoundBytes > 0) {
          selectAllRemainingForPro();
        }
        const live = license?.active || (await api.licenseStatus(false).catch(() => null))?.active;
        if (live) {
          void executeClean(true);
        }
      }
    };
    const onSafetyCheck = (e: Event) => {
      const detail = (e as CustomEvent<{ query?: string }> | undefined)?.detail;
      if (detail?.query) {
        safetyCheckPath = detail.query;
      }
      setTimeout(() => {
        safetySearchInputEl?.focus();
        safetySearchInputEl?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 40);
    };
    window.addEventListener(OPEN_UNDO_EVENT, onOpenUndo);
    window.addEventListener("sweepr-trigger-scan", onTriggerScan);
    window.addEventListener("sweepr-license-activated", onActivated);
    window.addEventListener("sweepr-safety-check", onSafetyCheck);
    return () => {
      window.removeEventListener(OPEN_UNDO_EVENT, onOpenUndo);
      window.removeEventListener("sweepr-trigger-scan", onTriggerScan);
      window.removeEventListener("sweepr-license-activated", onActivated);
      window.removeEventListener("sweepr-safety-check", onSafetyCheck);
    };
  });
</script>

<svelte:window onkeydown={onWindowKeydown} />

<div class="d3-shell">
  {#if error}
    <div
      class="error-banner toast"
      role="alert"
      transition:fly={{ y: -6, duration: 180, easing: cubicOut }}
    >
      {error}
    </div>
  {/if}

  {#if (isMacOs || info?.platform === "macos") && !hasMacosFda}
    <section
      class="macos-fda-banner"
      aria-label="macOS Full Disk Access Setup"
      style="display:flex;align-items:center;justify-content:space-between;gap:14px;padding:14px 18px;border-radius:14px;background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.32);margin-bottom:12px;"
    >
      <div style="display:flex;flex-direction:column;gap:4px;">
        <strong style="font-size:13.5px;color:var(--text);">
          Grant Full Disk Access to scan Safari, Mail &amp; System Trash
        </strong>
        <span style="font-size:12px;color:var(--muted);">
          Step 1: Click <strong>Open System Settings</strong> below · Step 2: Toggle <strong>SWEEPR Cleaner</strong> on under Privacy &amp; Security → Full Disk Access, then re-scan.
        </span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
        <button
          type="button"
          class="primary small-btn"
          onclick={async () => {
            await api.openMacosFdaSettings().catch(() => {});
          }}
        >
          Open System Settings
        </button>
        <button
          type="button"
          class="ghost small-btn"
          onclick={async () => {
            hasMacosFda = await api.checkMacosFullDiskAccess().catch(() => false);
            if (hasMacosFda) scan();
          }}
        >
          Re-check
        </button>
      </div>
    </section>
  {/if}

  <!-- 1. D3 Top Native OS Storage Bar & Primary Fitts's Law Action -->
  <header class="d3-storage-card" class:is-busy={isBusy}>
    <div class="d3-storage-top">
      <div class="d3-disk-meta">
        <div class="d3-disk-kicker">
          <span class="d3-os-pill">{osDiskLabel}</span>
          {#if !license?.active}
            <span class="d3-starter-pill" class:exhausted={freeAllowance.exhausted}>
              {#if freeAllowance.exhausted}
                500 MB Free Starter Clean Used
              {:else}
                Free Starter Clean · {formatBytes(freeAllowance.remaining_bytes)} of 500 MB left
              {/if}
            </span>
          {/if}
          {#if phase === "scanning"}
            <span class="d3-status-text is-active" role="status" aria-live="polite">
              <span class="d3-live-spinner" aria-hidden="true"></span>
              <span>Scanning: {progress ? progress.category_name : "System paths…"}</span>
              {#if progress && progress.total > 0}
                <span class="d3-scan-pct">{Math.max(4, Math.min(99, Math.round((progress.done / progress.total) * 100)))}%</span>
              {/if}
            </span>
          {:else if phase === "cleaning"}
            <span class="d3-status-text is-active" role="status" aria-live="polite">
              <span class="d3-live-spinner" aria-hidden="true"></span>
              <span>Reclaiming space safely…</span>
            </span>
          {:else if phase === "done"}
            <span class="d3-status-text">Cleaned {formatBytes(freedTotal)} ({removedTotal} files) into 7-Day Quarantine</span>
          {:else}
            <span class="d3-status-text">Personal files &amp; active logins untouched</span>
          {/if}
        </div>

        <div class="d3-hero-row">
          {#if phase === "scanning"}
            <span class="d3-hero-metric is-scanning">{progress ? formatBytes(progress.bytes_so_far) : "Scanning…"}</span>
            <span class="d3-hero-unit d3-scanning-pulse">analyzing storage…</span>
          {:else if phase === "cleaning"}
            <span class="d3-hero-metric is-scanning">{formatBytes(depletingBytes)}</span>
            <span class="d3-hero-unit d3-scanning-pulse">moving to 7-day safety undo…</span>
          {:else if phase === "done"}
            <span class="d3-hero-metric">{formatBytes(freedTotal)} Freed</span>
          {:else if report && totalFoundBytes > 0}
            <span class="d3-hero-metric">{formatBytes(displayedHeroBytes)}</span>
            {#if isStarterSelectionOnly}
              <span class="d3-hero-unit">
                reclaimable junk found · <strong>{formatBytes(starterCleanableNowBytes)} Free Starter Clean</strong> ready
              </span>
            {:else}
              <span class="d3-hero-unit">reclaimable junk selected</span>
            {/if}
          {:else}
            <span class="d3-hero-metric">Ready to Scan</span>
          {/if}
        </div>

        {#if runningConflicts.length > 0}
          <div class="d3-conflict-note">
            Active apps ({runningConflicts.map((rc) => rc.app_name).join(", ")}) will be safely skipped.
          </div>
        {/if}
      </div>

      <div class="d3-header-actions">
        <button
          type="button"
          class="d3-rescan-btn c1-btn-ghost"
          disabled={isBusy}
          onclick={scan}
        >
          {t("action.rescan", $lang)}
        </button>

        {#if phase === "scanning"}
          <button type="button" class="d3-primary-btn c1-btn-primary is-loading" disabled aria-busy="true">
            <span class="d3-btn-spinner btn-spinner" aria-hidden="true"></span>
            <span>Scanning…</span>
          </button>
        {:else if phase === "cleaning"}
          <button type="button" class="d3-primary-btn c1-btn-primary is-loading" disabled aria-busy="true">
            <span class="d3-btn-spinner btn-spinner" aria-hidden="true"></span>
            <span>Cleaning…</span>
          </button>
        {:else if phase === "done" && !license?.active && remainingUncleanedBytes > 0}
          <button
            type="button"
            class="d3-primary-btn c1-btn-primary"
            onclick={() => {
              selectAllRemainingForPro();
              pendingCleanAfterAuth = true;
              openProUpgradeModal("Unlock Full Cleanup");
            }}
          >
            Unlock Pro · Clean {formatBytes(remainingUncleanedBytes)}
          </button>
        {:else if phase === "done"}
          <button type="button" class="d3-primary-btn c1-btn-primary" onclick={scan}>
            {t("action.scan", $lang)}
          </button>
        {:else if report && selectedBytes > 0}
          <button
            type="button"
            class="d3-primary-btn c1-btn-primary"
            onclick={requestClean}
          >
            {#if isStarterSelectionOnly}
              Free Starter Clean ({formatBytes(Math.min(starterSelectedBytes, freeAllowance.remaining_bytes))})
            {:else}
              {t("action.clean", $lang)} {formatBytes(selectedBytes)}
            {/if}
          </button>
        {:else}
          <button
            type="button"
            class="d3-primary-btn c1-btn-primary"
            onclick={scan}
          >
            {t("action.scan", $lang)}
          </button>
        {/if}
      </div>
    </div>

    <!-- Segmented OS Storage Bar -->
    <div class="d3-bar-track" class:is-busy={isBusy} class:storage-bar-Scanning={isBusy} aria-label="Storage allocation breakdown">
      <div class="d3-seg d3-seg-used" class:storage-seg-busy={isBusy} style="width: 38%;" title="Protected OS & Personal Files"></div>
      <div class="d3-seg d3-seg-green" class:storage-seg-busy={isBusy} style={`width: ${sysSegmentPct}%;`} title="Safe Temp & Browser Cache"></div>
      <div class="d3-seg d3-seg-cobalt" class:storage-seg-busy={isBusy} style={`width: ${appSegmentPct}%;`} title="App Cache & Leftovers"></div>
      <div class="d3-seg d3-seg-amber" class:storage-seg-busy={isBusy} style={`width: ${dupSegmentPct}%;`} title="Duplicates & Startup"></div>
    </div>

    <div class="d3-bar-legend">
      <span class="d3-legend-item"><i class="d3-dot d3-dot-used"></i>Your Personal Files (Safe)</span>
      <span class="d3-legend-item"><i class="d3-dot d3-dot-green"></i>Temp &amp; Browser ({formatBytes(sysBrowserBytes)})</span>
      <span class="d3-legend-item"><i class="d3-dot d3-dot-cobalt"></i>App Junk &amp; Leftovers ({formatBytes(appAndRemnantsBytes)})</span>
      <span class="d3-legend-item"><i class="d3-dot d3-dot-amber"></i>Duplicates &amp; Startup ({enabledStartups.length})</span>
    </div>

    <div class="d3-quick-tier-strip" role="group" aria-label="Cleanup tiers and automation">
      <button
        type="button"
        class="d3-quick-tier-btn is-starter"
        disabled={isBusy}
        onclick={() => handleProQuickCategory("starter")}
      >
        <span class="d3-tier-tag is-free">FREE</span>
        <span>
          Basic Temp
          {#if !license?.active}
            ({freeAllowance.exhausted ? "500 MB used" : `${formatBytes(starterCleanableNowBytes > 0 ? starterCleanableNowBytes : freeAllowance.remaining_bytes)} free`})
          {:else if freeEligibleBytes > 0}
            ({formatBytes(freeEligibleBytes)})
          {/if}
        </span>
      </button>

      <button
        type="button"
        class="d3-quick-tier-btn"
        disabled={isBusy}
        onclick={() => handleProQuickCategory("shaders")}
      >
        {#if !license?.active}<span class="d3-tier-tag is-pro">PRO</span>{/if}
        <span>Gaming Shaders{gamingShaderBytes > 0 ? ` (${formatBytes(gamingShaderBytes)})` : ""}</span>
      </button>

      <button
        type="button"
        class="d3-quick-tier-btn"
        disabled={isBusy}
        onclick={() => handleProQuickCategory("ai_dev")}
      >
        {#if !license?.active}<span class="d3-tier-tag is-pro">PRO</span>{/if}
        <span>AI/Dev Caches{aiDevCacheBytes > 0 ? ` (${formatBytes(aiDevCacheBytes)})` : ""}</span>
      </button>

      <button
        type="button"
        class="d3-quick-tier-btn"
        disabled={isBusy}
        onclick={() => handleProQuickCategory("remnants")}
      >
        {#if !license?.active}<span class="d3-tier-tag is-pro">PRO</span>{/if}
        <span>App Remnants{remnantsBytes > 0 ? ` (${formatBytes(remnantsBytes)})` : ""}</span>
      </button>

      <button
        type="button"
        class="d3-quick-tier-btn"
        disabled={isBusy}
        onclick={() => handleProQuickCategory("duplicates")}
      >
        {#if !license?.active}<span class="d3-tier-tag is-pro">PRO</span>{/if}
        <span>Duplicates</span>
      </button>

      <button
        type="button"
        class="d3-quick-tier-btn"
        disabled={isBusy}
        onclick={() => handleProQuickCategory("schedule")}
      >
        {#if !license?.active}<span class="d3-tier-tag is-pro">PRO</span>{/if}
        <span>Scheduled Clean</span>
      </button>
    </div>
  </header>

  {#if !license?.active && phase === "done" && freedStarterOrSessionBytes > 0 && remainingUncleanedBytes > 0}
    <div class="d3-starter-upsell-banner" role="region" aria-label="Unlock SWEEPR Pro for remaining storage">
      <div class="d3-starter-upsell-copy">
        <span class="a14-referral-badge">500 MB Starter Clean</span>
        <span>{buildContextualUpgradeCopy()}</span>
      </div>
      <button
        type="button"
        class="a14-share-win-btn"
        onclick={() => {
          selectAllRemainingForPro();
          pendingCleanAfterAuth = true;
          openProUpgradeModal("Unlock Full Cleanup");
        }}
      >
        Unlock SWEEPR Pro →
      </button>
    </div>
  {/if}

  {#if phase === "done" && freedTotal > 0}
    <div class="a14-referral-banner" role="region" aria-label="Storage milestone reward">
      <div class="a14-referral-left">
        <span class="a14-referral-badge">Aha! Storage Win</span>
        <span class="a14-referral-copy">
          You reclaimed <strong>{formatBytes(freedTotal)}</strong> in <strong>{shareScanDurationMs}ms</strong> (Top culprit: <strong>{shareTopCulprit}</strong>)! Share your storage win to earn <strong>+30 days of Pro free</strong>.
        </span>
      </div>
      <div class="a14-referral-actions">
        <button
          type="button"
          class="a14-share-win-btn"
          onclick={openShareWinModal}
        >
          Share My Storage Win (+30 Days Free Pro)
        </button>
        <a
          href={shareWinPublicUrl}
          target="_blank"
          rel="noopener noreferrer"
          class="a14-referral-link"
          onclick={() => trackAppEvent("referral_aha_clicked", { bytes_cleaned: freedTotal })}
        >
          {shareReferralShortDisplay} →
        </a>
      </div>
    </div>
  {/if}

  {#if phase === "done" && showReviewDelightCard && freedTotal >= 500 * 1024 * 1024 && !error}
    <div class="a14-referral-banner" role="region" aria-label="Review SWEEPR on Trustpilot or AlternativeTo">
      <div class="a14-referral-left">
        <span class="a14-referral-badge">★ Peak Delight</span>
        <span class="a14-referral-copy">
          Did Sweepr save your drive today? Leave a 30-second review on <strong>Trustpilot / AlternativeTo</strong> to help independent users find us.
        </span>
      </div>
      <div class="a14-referral-actions">
        <a
          href="https://www.trustpilot.com/evaluate/sweeprcleaner.com"
          target="_blank"
          rel="noopener noreferrer"
          class="a14-share-win-btn"
          style="text-decoration:none;"
          onclick={dismissReviewDelightCard}
        >
          ★ Review on Trustpilot
        </a>
        <a
          href="https://alternativeto.net/software/sweepr-cleaner/about/"
          target="_blank"
          rel="noopener noreferrer"
          class="a14-referral-link"
          onclick={dismissReviewDelightCard}
        >
          AlternativeTo →
        </a>
        <button
          type="button"
          class="d3-safety-clear"
          onclick={dismissReviewDelightCard}
          aria-label="Dismiss review card"
        >
          Dismiss
        </button>
      </div>
    </div>
  {/if}

  <!-- 1.5. Paste Any Folder Path -> Instant Safety Check (377-Item Knowledge Base) -->
  <section class="d3-safety-search-card" aria-label="Paste Any Folder Path Instant Safety Check">
    <div class="d3-safety-search-head">
      <div class="d3-safety-title-wrap">
        <span class="d3-safety-kicker">INSTANT SAFETY CHECK · {CACHE_INTELLIGENCE.length} VERIFIED RULES</span>
        <span class="d3-safety-sub">Paste any folder path or cache name for a plain-English safety verdict</span>
      </div>
      <div class="d3-safety-chips">
        {#each SAMPLE_SAFETY_PATHS as sample}
          <button
            type="button"
            class="d3-safety-chip"
            class:active={safetyCheckPath === sample}
            onclick={() => (safetyCheckPath = safetyCheckPath === sample ? "" : sample)}
          >
            {sample.split("\\").slice(-2).join("\\")}
          </button>
        {/each}
      </div>
    </div>

    <div class="d3-safety-input-row">
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true" class="d3-safety-icon">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
      </svg>
      <input
        bind:this={safetySearchInputEl}
        type="text"
        bind:value={safetyCheckPath}
        placeholder="Paste any folder path -> Instant Safety Check (e.g. %AppData%\discord\Cache or C:\Windows\WinSxS)…"
        class="d3-safety-input"
        aria-label="Paste any folder path for instant safety check"
      />
      {#if safetyCheckPath}
        <button
          type="button"
          class="d3-safety-clear"
          onclick={() => (safetyCheckPath = "")}
          aria-label="Clear folder path"
        >
          Clear
        </button>
      {/if}
    </div>

    {#if safetyCheckResult}
      <div class="d3-safety-result-drawer" role="region" aria-live="polite">
        <div class="d3-safety-result-top">
          <span
            class="d3-safety-badge"
            class:is-safe={safetyCheckResult.safetyBadge === "100% Safe Automated"}
            class:is-review={safetyCheckResult.safetyBadge !== "100% Safe Automated"}
          >
            {safetyCheckResult.safetyBadge}
          </span>
          <span class="d3-safety-owner">Owner: <strong>{safetyCheckResult.owner}</strong></span>
          {#if safetyCheckResult.avgSpace}
            <span class="d3-safety-avg">Typical size: {safetyCheckResult.avgSpace}</span>
          {/if}
          <code class="d3-safety-code-path">{safetyCheckResult.path}</code>
        </div>
        <div class="d3-safety-grid">
          <div class="d3-safety-col">
            <span class="d3-safety-label">What it is</span>
            <p class="d3-safety-copy">{safetyCheckResult.whatItIs}</p>
          </div>
          <div class="d3-safety-col">
            <span class="d3-safety-label">What happens if deleted</span>
            <p class="d3-safety-copy">{safetyCheckResult.whatHappensIfDeleted}</p>
          </div>
        </div>
        <div class="d3-safety-foot">
          <span class="d3-safety-rebuild"><strong>Rebuild behavior:</strong> {safetyCheckResult.rebuildCost}</span>
          {#if safetyCheckResult.warning}
            <span class="d3-safety-warn">Note: {safetyCheckResult.warning}</span>
          {/if}
        </div>
      </div>
    {/if}
  </section>

  <!-- 2. D3 4 Semantic Pastel-Tinted Category Tiles (Every figure sits inside the card that explains it) -->
  <div class="d3-tiles-grid">
    <!-- Tile 1: Safe Temp & Browser Cache (Green Tint) -->
    <article class="d3-tile d3-tile-green bento-card" style="--stagger-i: 0;">
      <div>
        <div class="d3-tile-head">
          <label class="d3-tile-check">
            <input
              type="checkbox"
              class="checkbox"
              class:checked={sysBrowserChecked}
              checked={sysBrowserChecked}
              disabled={sysBrowserCats.length === 0}
              onchange={(e) =>
                toggleGroup(sysBrowserCats, (e.currentTarget as HTMLInputElement).checked)}
            />
            <span class="d3-tile-kicker">TEMP FILES &amp; BROWSER CLUTTER</span>
          </label>
          {#if sysBrowserCats.length > 0}
            <button
              type="button"
              class="d3-inspect-btn inspect-btn pill-toggle"
              class:open={expandedIds.has("sys")}
              onclick={() => (expandedGroup = expandedGroup === "sys" ? null : "sys")}
              aria-expanded={expandedIds.has("sys")}
            >
              <span>{expandedGroup === "sys" ? "Hide Details" : `Details (${sysBrowserCats.length})`}</span>
              <svg class="inspect-chevron" class:open={expandedIds.has("sys")} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          {/if}
        </div>

        <div class="d3-tile-metric">{formatBytes(sysBrowserBytes)}</div>
        <h3 class="d3-tile-title">Temporary Files &amp; Browser Clutter</h3>
        <p class="d3-tile-desc">
          Old temporary files and leftover web browser clutter from Chrome, Edge, Brave &amp; Safari. Your saved passwords and logins stay safe.
        </p>

        {#if sysBrowserCats.length > 0}
          <div
            class="file-accordion-wrap"
            class:open={expandedIds.has("sys")}
            aria-hidden={!expandedIds.has("sys")}
          >
            <div class="file-accordion-inner">
              <div class="d3-path-drawer">
                {#each sysBrowserCats as c (c.id)}
                  {@const intel = resolveRuleSafetyIntelligence(c)}
                  {@const isRuleOpen = !!expandedRuleIntel[c.id]}
                  <div class="d3-rule-block">
                    <div class="d3-path-item">
                      <label class="d3-path-check-label">
                        <input
                          type="checkbox"
                          class="checkbox"
                          class:checked={!!selected[c.id]}
                          checked={!!selected[c.id]}
                          onchange={(e) =>
                            toggleRuleSelection(c, (e.currentTarget as HTMLInputElement).checked)}
                          tabindex={expandedIds.has("sys") ? 0 : -1}
                        />
                        <span class="d3-path-name">{c.name}</span>
                        {#if !license?.active}
                          <span class="d3-tier-tag" class:is-free={c.free} class:is-pro={!c.free}>
                            {c.free ? "FREE" : "PRO"}
                          </span>
                        {/if}
                      </label>
                      <button
                        type="button"
                        class="d3-why-safe-btn"
                        class:open={isRuleOpen}
                        onclick={() => toggleRuleIntel(c.id)}
                        aria-expanded={isRuleOpen}
                      >
                        Why is this safe to delete?
                      </button>
                      <span class="d3-path-size">{formatBytes(c.bytes)}</span>
                    </div>

                    {#if isRuleOpen}
                      <div class="d3-intel-drawer">
                        <div class="d3-intel-badges">
                          <span
                            class="d3-safety-badge"
                            class:is-safe={intel.safetyBadge === "100% Safe Automated"}
                            class:is-review={intel.safetyBadge !== "100% Safe Automated"}
                          >
                            {intel.safetyBadge}
                          </span>
                          <span class="d3-intel-owner">App Owner: <strong>{intel.owner}</strong></span>
                        </div>
                        <div class="d3-intel-path-row">
                          <span class="d3-intel-label">Exact Path:</span>
                          <code class="d3-intel-code">{c.roots?.[0] || intel.path}</code>
                        </div>
                        <p class="d3-intel-text"><strong>What it is:</strong> {intel.whatItIs}</p>
                        <p class="d3-intel-text"><strong>If deleted:</strong> {intel.whatHappensIfDeleted}</p>
                        <p class="d3-intel-rebuild"><strong>Rebuild behavior:</strong> {intel.rebuildCost}</p>

                        {#if c.top_files && c.top_files.length > 0}
                          <div class="d3-top-files-section">
                            <div class="d3-top-files-title">
                              Top {Math.min(50, c.top_files.length)} Scanned Files in {c.name}
                            </div>
                            <div class="d3-top-files-list">
                              {#each c.top_files.slice(0, 50) as file, fIdx (`${c.id}-${fIdx}`)}
                                {@const fileKey = `${c.id}::${file.path}`}
                                {@const fileOpen = !!expandedFileIntel[fileKey]}
                                {@const fileIntel = fileOpen ? resolveFilePathSafetyIntelligence(file.path, c) : intel}
                                <div class="d3-top-file-row">
                                  <div class="d3-top-file-main">
                                    <code class="d3-top-file-path" title={file.path}>{file.path}</code>
                                    <button
                                      type="button"
                                      class="d3-file-why-btn"
                                      onclick={() => toggleFileIntel(fileKey)}
                                      aria-expanded={fileOpen}
                                    >
                                      {fileOpen ? "Hide safety" : "Why safe?"}
                                    </button>
                                    <span class="d3-top-file-size">{formatBytes(file.size)}</span>
                                  </div>
                                  {#if fileOpen}
                                    <div class="d3-file-intel-sub">
                                      <span><strong>Rating:</strong> {fileIntel.safetyBadge}</span>
                                      <span><strong>Owner:</strong> {fileIntel.owner}</span>
                                      <span><strong>Path:</strong> <code>{file.path}</code></span>
                                      <span><strong>Rebuild:</strong> {fileIntel.whatHappensIfDeleted} ({fileIntel.rebuildCost})</span>
                                    </div>
                                  {/if}
                                </div>
                              {/each}
                            </div>
                          </div>
                        {/if}
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>
            </div>
          </div>
        {/if}
      </div>

      <button
        type="button"
        class="d3-tile-action"
        disabled={sysBrowserBytes === 0 || isBusy}
        onclick={() => cleanSpecificCategoryGroup(sysBrowserCats, false)}
      >
        <span>{sysBrowserBytes > 0 ? `Clean ${formatBytes(sysBrowserBytes)}` : "All Clean"}</span>
        <span>→</span>
      </button>
    </article>

    <!-- Tile 2: App Cache & Uninstalled Leftovers (Cobalt Tint) -->
    <article class="d3-tile d3-tile-cobalt bento-card" style="--stagger-i: 1;">
      <div>
        <div class="d3-tile-head">
          <label class="d3-tile-check">
            <input
              type="checkbox"
              class="checkbox"
              class:checked={appCacheChecked}
              checked={appCacheChecked}
              disabled={appCacheCats.length === 0 && remnants.length === 0}
              onchange={(e) =>
                toggleAppAndRemnants((e.currentTarget as HTMLInputElement).checked)}
            />
            <span class="d3-tile-kicker">APP JUNK &amp; LEFTOVERS</span>
          </label>
          {#if appCacheCats.length > 0}
            <button
              type="button"
              class="d3-inspect-btn inspect-btn pill-toggle"
              class:open={expandedIds.has("app")}
              onclick={() => (expandedGroup = expandedGroup === "app" ? null : "app")}
              aria-expanded={expandedIds.has("app")}
            >
              <span>{expandedGroup === "app" ? "Hide Details" : `Details (${appCacheCats.length})`}</span>
              <svg class="inspect-chevron" class:open={expandedIds.has("app")} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          {/if}
        </div>

        <div class="d3-tile-metric">{formatBytes(appAndRemnantsBytes)}</div>
        <h3 class="d3-tile-title">App Junk, Trash &amp; Leftovers</h3>
        <p class="d3-tile-desc">
          Leftover files from deleted apps ({remnants.length} folder{remnants.length === 1 ? "" : "s"}), Recycle Bin clutter, and old temporary files from Discord, Spotify &amp; Steam.
        </p>

        {#if appCacheCats.length > 0}
          <div
            class="file-accordion-wrap"
            class:open={expandedIds.has("app")}
            aria-hidden={!expandedIds.has("app")}
          >
            <div class="file-accordion-inner">
              <div class="d3-path-drawer">
                {#each appCacheCats as c (c.id)}
                  {@const intel = resolveRuleSafetyIntelligence(c)}
                  {@const isRuleOpen = !!expandedRuleIntel[c.id]}
                  <div class="d3-rule-block">
                    <div class="d3-path-item">
                      <label class="d3-path-check-label">
                        <input
                          type="checkbox"
                          class="checkbox"
                          class:checked={!!selected[c.id]}
                          checked={!!selected[c.id]}
                          onchange={(e) =>
                            toggleRuleSelection(c, (e.currentTarget as HTMLInputElement).checked)}
                          tabindex={expandedIds.has("app") ? 0 : -1}
                        />
                        <span class="d3-path-name">{c.name}</span>
                        {#if !license?.active}
                          <span class="d3-tier-tag" class:is-free={c.free} class:is-pro={!c.free}>
                            {c.free ? "FREE" : "PRO"}
                          </span>
                        {/if}
                      </label>
                      <button
                        type="button"
                        class="d3-why-safe-btn"
                        class:open={isRuleOpen}
                        onclick={() => toggleRuleIntel(c.id)}
                        aria-expanded={isRuleOpen}
                      >
                        Why is this safe to delete?
                      </button>
                      <span class="d3-path-size">{formatBytes(c.bytes)}</span>
                    </div>

                    {#if isRuleOpen}
                      <div class="d3-intel-drawer">
                        <div class="d3-intel-badges">
                          <span
                            class="d3-safety-badge"
                            class:is-safe={intel.safetyBadge === "100% Safe Automated"}
                            class:is-review={intel.safetyBadge !== "100% Safe Automated"}
                          >
                            {intel.safetyBadge}
                          </span>
                          <span class="d3-intel-owner">App Owner: <strong>{intel.owner}</strong></span>
                        </div>
                        <div class="d3-intel-path-row">
                          <span class="d3-intel-label">Exact Path:</span>
                          <code class="d3-intel-code">{c.roots?.[0] || intel.path}</code>
                        </div>
                        <p class="d3-intel-text"><strong>What it is:</strong> {intel.whatItIs}</p>
                        <p class="d3-intel-text"><strong>If deleted:</strong> {intel.whatHappensIfDeleted}</p>
                        <p class="d3-intel-rebuild"><strong>Rebuild behavior:</strong> {intel.rebuildCost}</p>

                        {#if c.top_files && c.top_files.length > 0}
                          <div class="d3-top-files-section">
                            <div class="d3-top-files-title">
                              Top {Math.min(50, c.top_files.length)} Scanned Files in {c.name}
                            </div>
                            <div class="d3-top-files-list">
                              {#each c.top_files.slice(0, 50) as file, fIdx (`${c.id}-${fIdx}`)}
                                {@const fileKey = `${c.id}::${file.path}`}
                                {@const fileOpen = !!expandedFileIntel[fileKey]}
                                {@const fileIntel = fileOpen ? resolveFilePathSafetyIntelligence(file.path, c) : intel}
                                <div class="d3-top-file-row">
                                  <div class="d3-top-file-main">
                                    <code class="d3-top-file-path" title={file.path}>{file.path}</code>
                                    <button
                                      type="button"
                                      class="d3-file-why-btn"
                                      onclick={() => toggleFileIntel(fileKey)}
                                      aria-expanded={fileOpen}
                                    >
                                      {fileOpen ? "Hide safety" : "Why safe?"}
                                    </button>
                                    <span class="d3-top-file-size">{formatBytes(file.size)}</span>
                                  </div>
                                  {#if fileOpen}
                                    <div class="d3-file-intel-sub">
                                      <span><strong>Rating:</strong> {fileIntel.safetyBadge}</span>
                                      <span><strong>Owner:</strong> {fileIntel.owner}</span>
                                      <span><strong>Path:</strong> <code>{file.path}</code></span>
                                      <span><strong>Rebuild:</strong> {fileIntel.whatHappensIfDeleted} ({fileIntel.rebuildCost})</span>
                                    </div>
                                  {/if}
                                </div>
                              {/each}
                            </div>
                          </div>
                        {/if}
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>
            </div>
          </div>
        {/if}
      </div>

      <button
        type="button"
        class="d3-tile-action"
        disabled={isBusy}
        onclick={() => {
          if (appAndRemnantsBytes > 0) {
            cleanSpecificCategoryGroup(appCacheCats, remnants.length > 0);
          } else {
            onOpenTool?.("apps");
          }
        }}
      >
        <span>{appAndRemnantsBytes > 0 ? `Clean ${formatBytes(appAndRemnantsBytes)}` : "Open App Uninstaller"}</span>
        <span>→</span>
      </button>
    </article>

    <!-- Tile 3: Duplicates & Startup Launchers (Amber Tint) -->
    <article class="d3-tile d3-tile-amber bento-card" style="--stagger-i: 2;">
      <div>
        <div class="d3-tile-head">
          <span class="d3-tile-kicker">DUPLICATES &amp; SCHEDULED CLEAN</span>
          <button
            type="button"
            class="d3-inspect-btn inspect-btn"
            onclick={() => handleProQuickCategory("schedule")}
          >
            Scheduled Clean{!license?.active ? " · PRO" : ""}
          </button>
        </div>

        <div class="d3-tile-metric">Duplicates · {enabledStartups.length} Startup</div>
        <h3 class="d3-tile-title">Duplicates, Startup &amp; Auto-Clean</h3>
        <p class="d3-tile-desc">
          Finds identical copies of photos and documents (always keeps your original safe), speeds up startup, and runs set-and-forget Scheduled Auto-Clean.
        </p>
      </div>

      <div class="d3-dual-actions">
        <button
          type="button"
          class="d3-tile-action"
          onclick={() => handleProQuickCategory("duplicates")}
        >
          <span>Find Duplicates{!license?.active ? " (Pro)" : ""}</span>
          <span>→</span>
        </button>
        <button
          type="button"
          class="d3-tile-action"
          onclick={() => onOpenTool?.("memory")}
        >
          <span>Startup ({enabledStartups.length})</span>
          <span>→</span>
        </button>
      </div>
    </article>

    <!-- Tile 4: Battery Care (80% Saver) & Private Lockbox (Plum Tint) -->
    <article class="d3-tile d3-tile-plum bento-card" style="--stagger-i: 3;">
      <div>
        <div class="d3-tile-head">
          <span class="d3-tile-kicker">BATTERY &amp; FILE PROTECTION</span>
          <span class="d3-inspect-btn">{license?.addons?.length ? "ADD-ON ACTIVE" : `+${localizedAddonPrice}`}</span>
        </div>

        <div class="d3-tile-metric">80% Battery Saver</div>
        <h3 class="d3-tile-title">Battery Saver &amp; Private Lockbox</h3>
        <p class="d3-tile-desc">
          Alerts you at 80% charge so your laptop battery lasts years longer, cools down hot apps, and password-locks private files ({localizedAddonPrice}).
        </p>
      </div>

      <div class="d3-dual-actions">
        <button
          type="button"
          class="d3-tile-action"
          onclick={() => onOpenTool?.("battery")}
        >
          <span>Battery Saver</span>
          <span>→</span>
        </button>
        <button
          type="button"
          class="d3-tile-action"
          onclick={() => onOpenTool?.("cloud")}
        >
          <span>Private Lockbox</span>
          <span>→</span>
        </button>
      </div>
    </article>
  </div>

  <!-- 3. Persistent D3 Undo Recovery Toast Bar (role="status") -->
  <footer class="d3-undo-bar" role="status" aria-live="polite">
    <div class="d3-undo-left">
      <span class="d3-undo-badge">7-Day Undo</span>
      <span class="d3-undo-text">
        {#if quarantine.length > 0}
          {quarantine.length} recently cleaned file{quarantine.length === 1 ? "" : "s"} can be put right back where they were in 1 click.
        {:else}
          All cleaned files are kept safely for 7 days so you can put any file back in 1 click.
        {/if}
      </span>
    </div>

    <button type="button" class="d3-undo-btn" onclick={openUndoModal}>
      Restore Files ({quarantine.length})
    </button>
  </footer>
</div>

<!-- 7-Day Safety Undo Modal (Always 100% Free) -->
{#if showQuarantine}
  <div
    class="undo-backdrop"
    onclick={() => (showQuarantine = false)}
    role="presentation"
    transition:fade={{ duration: 160 }}
  >
    <div
      class="undo-modal card"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
      aria-label="Recently Cleaned Files (7-Day Undo)"
      tabindex="-1"
      transition:scale={{ duration: 200, start: 0.96, opacity: 0, easing: cubicOut }}
    >
      <div class="undo-head">
        <h3 class="undo-title">Recently Cleaned Files (7-Day Undo)</h3>
        <button type="button" class="close-x" onclick={() => (showQuarantine = false)}>✕</button>
      </div>

      {#if restoreNotice}
        <div
          class="restore-toast toast"
          transition:fly={{ y: -4, duration: 180, easing: cubicOut }}
        >
          {restoreNotice}
        </div>
      {/if}

      {#if quarantine.length > 0}
        <input
          type="text"
          bind:value={undoSearch}
          placeholder="Search recently cleaned files…"
          class="undo-search"
        />

        <div class="undo-rows">
          {#each filteredQuarantine as q (q.id)}
            <div class="undo-item">
              <div class="undo-item-info">
                <span class="undo-name">{q.file_name}</span>
                <span class="undo-size">{formatBytes(q.size)}</span>
              </div>
              <button
                type="button"
                class="restore-link"
                onclick={() => restoreQuarantined(q)}
              >
                Restore
              </button>
            </div>
          {/each}
        </div>

        <button
          type="button"
          class="primary restore-all-btn"
          disabled={restoringAll}
          onclick={restoreAllQuarantined}
        >
          {restoringAll ? "Restoring…" : "Restore All"}
        </button>
      {:else}
        <div class="undo-empty">No files currently in 7-day undo quarantine.</div>
      {/if}
    </div>
  </div>
{/if}

{#if showShareWinModal}
  <div
    class="undo-backdrop"
    onclick={() => (showShareWinModal = false)}
    role="presentation"
    transition:fade={{ duration: 160 }}
  >
    <div
      class="undo-modal share-win-modal card"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
      aria-label="Share My Storage Win (+30 Days Free Pro)"
      tabindex="-1"
      transition:scale={{ duration: 200, start: 0.96, opacity: 0, easing: cubicOut }}
    >
      <div class="undo-head">
        <div>
          <h3 class="undo-title">I Just Reclaimed {shareReclaimedLabel} with SWEEPR</h3>
          <span style="font-size:11.5px;color:var(--muted);">
            Every friend who claims your link gets +30 days of SWEEPR Pro free — and so do you!
          </span>
        </div>
        <button type="button" class="close-x" onclick={() => (showShareWinModal = false)}>✕</button>
      </div>

      <div class="share-win-canvas-wrap">
        <canvas
          bind:this={shareCanvasEl}
          width="1200"
          height="630"
          class="share-win-canvas"
        ></canvas>
      </div>

      {#if shareActionToast}
        <div class="restore-toast toast" role="status">
          {shareActionToast}
        </div>
      {/if}

      <div class="share-win-actions-row">
        <button type="button" class="share-win-primary-btn" onclick={copyShareWinCardImage}>
          📋 Copy Image to Clipboard
        </button>
        <button type="button" class="share-win-social-btn" onclick={() => shareWinOnSocial("x")}>
          Share on X
        </button>
        <button type="button" class="share-win-social-btn" onclick={() => shareWinOnSocial("reddit")}>
          Reddit
        </button>
        <button type="button" class="share-win-social-btn" onclick={() => shareWinOnSocial("discord")}>
          Discord
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  /* D3 Pastel-Consumer Tokens (Light + Dark Adaptive) */
  .d3-shell {
    --d3-green-bg: #e1f3ec;
    --d3-green-ink: #073825;
    --d3-green-border: #b7e2d1;
    --d3-cobalt-bg: #e2edff;
    --d3-cobalt-ink: #0a2870;
    --d3-cobalt-border: #bdd4ff;
    --d3-amber-bg: #f7ebd2;
    --d3-amber-ink: #5e3704;
    --d3-amber-border: #ebd19e;
    --d3-plum-bg: #eee4fa;
    --d3-plum-ink: #3c1766;
    --d3-plum-border: #d7bef5;

    min-height: calc(100vh - 48px);
    max-width: 1040px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 4px 2px 10px 2px;
  }

  :global(body[data-theme="dark"]) .d3-shell,
  :global(.dark) .d3-shell {
    --d3-green-bg: rgba(16, 185, 129, 0.14);
    --d3-green-ink: #bbf7d0;
    --d3-green-border: rgba(16, 185, 129, 0.34);
    --d3-cobalt-bg: rgba(59, 130, 246, 0.15);
    --d3-cobalt-ink: #bfdbfe;
    --d3-cobalt-border: rgba(59, 130, 246, 0.34);
    --d3-amber-bg: rgba(245, 158, 11, 0.15);
    --d3-amber-ink: #fde68a;
    --d3-amber-border: rgba(245, 158, 11, 0.34);
    --d3-plum-bg: rgba(168, 85, 247, 0.15);
    --d3-plum-ink: #e9d5ff;
    --d3-plum-border: rgba(168, 85, 247, 0.34);
  }

  /* 1. Top Native OS Storage Bar Card */
  .d3-storage-card {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .d3-storage-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
  }

  .d3-disk-meta {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .d3-disk-kicker {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .d3-os-pill {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 11px;
    font-weight: 700;
    padding: 3px 9px;
    border-radius: 999px;
    background: var(--d3-green-bg);
    color: var(--d3-green-ink);
    border: 1px solid var(--d3-green-border);
  }

  .d3-starter-pill {
    font-size: 11px;
    font-weight: 800;
    padding: 3px 9px;
    border-radius: 999px;
    background: rgba(16, 185, 129, 0.14);
    color: #059669;
    border: 1px solid rgba(16, 185, 129, 0.36);
    font-variant-numeric: tabular-nums;
  }
  :global(.dark) .d3-starter-pill {
    color: #34d399;
  }
  .d3-starter-pill.exhausted {
    background: rgba(245, 158, 11, 0.14);
    color: #d97706;
    border-color: rgba(245, 158, 11, 0.36);
  }
  :global(.dark) .d3-starter-pill.exhausted {
    color: #fbbf24;
  }

  .d3-quick-tier-strip {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    padding-top: 8px;
    border-top: 1px solid var(--border);
  }

  .d3-quick-tier-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 5px 10px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--panel-2);
    color: var(--text);
    font-size: 11.5px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
    transition:
      transform 120ms var(--ease-out),
      border-color 140ms var(--ease-out),
      background-color 140ms var(--ease-out);
  }
  .d3-quick-tier-btn:hover:not(:disabled) {
    border-color: rgba(16, 185, 129, 0.55);
  }
  .d3-quick-tier-btn:active:not(:disabled) {
    transform: scale(0.97);
  }
  .d3-quick-tier-btn.is-starter {
    background: rgba(16, 185, 129, 0.1);
    border-color: rgba(16, 185, 129, 0.34);
  }

  .d3-tier-tag {
    display: inline-flex;
    align-items: center;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 9.5px;
    font-weight: 800;
    letter-spacing: 0.04em;
    padding: 1px 6px;
    border-radius: 999px;
    flex-shrink: 0;
  }
  .d3-tier-tag.is-free {
    background: #10b981;
    color: #ffffff;
  }
  .d3-tier-tag.is-pro {
    background: rgba(15, 23, 42, 0.12);
    color: inherit;
    border: 1px solid rgba(100, 116, 139, 0.35);
  }
  :global(.dark) .d3-tier-tag.is-pro {
    background: rgba(255, 255, 255, 0.12);
    border-color: rgba(255, 255, 255, 0.24);
  }

  .d3-starter-upsell-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 10px;
    padding: 11px 15px;
    border-radius: 13px;
    border: 1px solid rgba(16, 185, 129, 0.42);
    background: rgba(16, 185, 129, 0.1);
    font-size: 12.5px;
    font-weight: 600;
    color: var(--text);
  }
  .d3-starter-upsell-copy {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    font-variant-numeric: tabular-nums;
  }

  .d3-status-text {
    font-size: 12px;
    color: var(--muted);
    font-weight: 500;
  }

  .d3-hero-row {
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
  }

  .d3-hero-metric {
    font-size: 32px;
    font-weight: 800;
    letter-spacing: -0.03em;
    line-height: 1.05;
    color: var(--text);
    font-variant-numeric: tabular-nums;
  }

  .d3-hero-unit {
    font-size: 13px;
    font-weight: 600;
    color: var(--muted);
  }

  .d3-conflict-note {
    font-size: 11.5px;
    color: #f59e0b;
    font-weight: 600;
  }

  .d3-header-actions {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .d3-rescan-btn,
  .c1-btn-ghost {
    min-height: 44px;
    padding: 8px 14px;
    border-radius: 11px;
    border: 1px solid var(--border);
    background: var(--panel-2);
    color: var(--text);
    font-size: 12.5px;
    font-weight: 700;
    cursor: pointer;
    transition:
      transform 140ms var(--ease-out),
      opacity 140ms var(--ease-out),
      background-color 140ms var(--ease-out),
      border-color 140ms var(--ease-out),
      color 140ms var(--ease-out),
      box-shadow 140ms var(--ease-out);
  }
  .d3-rescan-btn:active:not(:disabled),
  .c1-btn-ghost:active:not(:disabled) {
    transform: scale(0.97);
    transition-duration: 80ms;
  }

  .d3-primary-btn,
  .c1-btn-primary {
    min-height: 46px;
    padding: 10px 22px;
    border-radius: 12px;
    border: none;
    background: #0a7c52;
    color: #ffffff;
    font-size: 13.5px;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
    transition:
      transform 140ms var(--ease-out),
      opacity 140ms var(--ease-out),
      background-color 140ms var(--ease-out),
      border-color 140ms var(--ease-out),
      color 140ms var(--ease-out),
      box-shadow 140ms var(--ease-out);
  }
  .d3-primary-btn:hover:not(:disabled),
  .c1-btn-primary:hover:not(:disabled) {
    background: #086341;
  }
  .d3-primary-btn:active:not(:disabled),
  .c1-btn-primary:active:not(:disabled) {
    transform: scale(0.97);
    transition-duration: 80ms;
  }

  /* Segmented Bar */
  .d3-bar-track {
    width: 100%;
    height: 14px;
    border-radius: 999px;
    background: var(--panel-2);
    border: 1px solid var(--border);
    overflow: hidden;
    display: flex;
    gap: 2px;
    padding: 2px;
  }
  .d3-seg {
    height: 100%;
    border-radius: 999px;
    transition: width 220ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  .d3-seg-used { background: #64748b; }
  .d3-seg-green { background: #0a7c52; }
  .d3-seg-cobalt { background: #1e4fd6; }
  .d3-seg-amber { background: #d97706; }

  .d3-bar-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    font-size: 11.5px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .d3-legend-item {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .d3-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    display: inline-block;
  }
  .d3-dot-used { background: #64748b; }
  .d3-dot-green { background: #0a7c52; }
  .d3-dot-cobalt { background: #1e4fd6; }
  .d3-dot-amber { background: #d97706; }

  /* Subtle Scan / Clean Loading Animations */
  .d3-status-text.is-active {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    color: var(--text);
    font-weight: 600;
  }

  .d3-live-spinner {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 2px solid rgba(10, 124, 82, 0.22);
    border-top-color: #0a7c52;
    display: inline-block;
    flex-shrink: 0;
    animation: d3Spin 720ms linear infinite;
  }
  :global(body[data-theme="dark"]) .d3-live-spinner,
  :global(.dark) .d3-live-spinner {
    border-color: rgba(52, 211, 153, 0.24);
    border-top-color: #34d399;
  }

  .d3-scan-pct {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 10.5px;
    font-weight: 700;
    padding: 1px 6px;
    border-radius: 999px;
    background: var(--d3-green-bg);
    color: var(--d3-green-ink);
    font-variant-numeric: tabular-nums;
  }

  .d3-scanning-pulse {
    animation: d3PulseOpacity 1.4s ease-in-out infinite;
  }

  .d3-primary-btn.is-loading {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    opacity: 0.92;
    cursor: progress;
  }

  .d3-btn-spinner {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 2px solid rgba(255, 255, 255, 0.32);
    border-top-color: #ffffff;
    display: inline-block;
    flex-shrink: 0;
    animation: d3Spin 720ms linear infinite;
  }

  .d3-bar-track {
    position: relative;
  }

  .d3-bar-track.is-busy::after {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(
      90deg,
      transparent 0%,
      rgba(255, 255, 255, 0.42) 48%,
      rgba(16, 185, 129, 0.28) 54%,
      transparent 100%
    );
    transform: translateX(-100%);
    animation: d3BarShimmer 1.35s cubic-bezier(0.4, 0, 0.2, 1) infinite;
    pointer-events: none;
    border-radius: inherit;
  }

  @keyframes d3Spin {
    to {
      transform: rotate(360deg);
    }
  }

  @keyframes d3BarShimmer {
    0% {
      transform: translateX(-100%);
    }
    100% {
      transform: translateX(100%);
    }
  }

  @keyframes d3PulseOpacity {
    0%, 100% {
      opacity: 0.95;
    }
    50% {
      opacity: 0.45;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .d3-live-spinner,
    .d3-btn-spinner,
    .d3-scanning-pulse,
    .d3-bar-track.is-busy::after {
      animation: none;
    }
  }

  @keyframes tile-enter {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  /* 2. 4 Semantic Pastel-Tinted Category Tiles */
  .d3-tiles-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    flex: 1;
  }

  .d3-tile,
  .bento-card {
    border-radius: 16px;
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 12px;
    border: 1px solid transparent;
    animation: tile-enter 220ms var(--ease-out) both;
    animation-delay: calc(var(--stagger-i, 0) * 28ms);
    transition:
      transform 150ms var(--ease-out),
      opacity 150ms var(--ease-out),
      background-color 150ms var(--ease-out),
      border-color 150ms var(--ease-out),
      color 150ms var(--ease-out),
      box-shadow 150ms var(--ease-out);
  }
  .d3-tile:active:not(:disabled),
  .bento-card:active:not(:disabled) {
    transform: scale(0.992);
    transition-duration: 80ms;
  }

  .d3-tile-green {
    background: var(--d3-green-bg);
    color: var(--d3-green-ink);
    border-color: var(--d3-green-border);
  }
  .d3-tile-cobalt {
    background: var(--d3-cobalt-bg);
    color: var(--d3-cobalt-ink);
    border-color: var(--d3-cobalt-border);
  }
  .d3-tile-amber {
    background: var(--d3-amber-bg);
    color: var(--d3-amber-ink);
    border-color: var(--d3-amber-border);
  }
  .d3-tile-plum {
    background: var(--d3-plum-bg);
    color: var(--d3-plum-ink);
    border-color: var(--d3-plum-border);
  }

  .d3-tile-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 6px;
  }

  .d3-tile-check {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
  }

  .checkbox {
    transition:
      transform 120ms var(--ease-out),
      opacity 140ms var(--ease-out),
      background-color 140ms var(--ease-out),
      border-color 140ms var(--ease-out),
      color 140ms var(--ease-out),
      box-shadow 140ms var(--ease-out);
  }
  .checkbox.checked {
    animation: checkbox-pop 200ms var(--spring);
  }

  .d3-tile-kicker {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 10.5px;
    font-weight: 800;
    letter-spacing: 0.05em;
  }

  .d3-inspect-btn,
  .inspect-btn,
  .pill-toggle {
    background: rgba(255, 255, 255, 0.55);
    color: inherit;
    border: 1px solid currentColor;
    border-radius: 999px;
    padding: 3px 9px;
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    transition:
      transform 140ms var(--ease-out),
      opacity 140ms var(--ease-out),
      background-color 140ms var(--ease-out),
      border-color 140ms var(--ease-out),
      color 140ms var(--ease-out),
      box-shadow 140ms var(--ease-out);
  }
  .d3-inspect-btn:active:not(:disabled),
  .inspect-btn:active:not(:disabled),
  .pill-toggle:active:not(:disabled) {
    transform: scale(0.97);
    transition-duration: 80ms;
  }
  :global(body[data-theme="dark"]) .d3-inspect-btn,
  :global(.dark) .d3-inspect-btn {
    background: rgba(15, 23, 42, 0.45);
  }

  .inspect-chevron {
    transition: transform 200ms var(--ease-out);
    flex-shrink: 0;
  }
  .inspect-chevron.open {
    transform: rotate(180deg);
  }

  .file-accordion-wrap {
    display: grid;
    grid-template-rows: 0fr;
    opacity: 0;
    transition:
      grid-template-rows 220ms var(--ease-out),
      opacity 180ms var(--ease-out);
  }
  .file-accordion-wrap.open {
    grid-template-rows: 1fr;
    opacity: 1;
  }
  .file-accordion-inner {
    overflow: hidden;
    min-height: 0;
  }

  .d3-tile-metric {
    font-size: 26px;
    font-weight: 800;
    letter-spacing: -0.03em;
    line-height: 1.05;
    font-variant-numeric: tabular-nums;
  }

  .d3-tile-title {
    margin: 4px 0 4px 0;
    font-size: 15px;
    font-weight: 800;
  }

  .d3-tile-desc {
    margin: 0;
    font-size: 12px;
    line-height: 1.45;
    opacity: 0.9;
  }

  .d3-path-drawer {
    margin-top: 10px;
    padding-top: 8px;
    border-top: 1px solid currentColor;
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 290px;
    overflow-y: auto;
  }

  .d3-rule-block {
    display: flex;
    flex-direction: column;
    gap: 6px;
    border-bottom: 1px solid var(--border);
    padding-bottom: 5px;
  }
  .d3-rule-block:last-child {
    border-bottom: none;
    padding-bottom: 0;
  }

  .d3-path-item {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11.5px;
    padding: 3px 0;
  }
  .d3-path-check-label {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
    cursor: pointer;
  }
  .d3-path-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .d3-path-size {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }

  .d3-why-safe-btn {
    background: rgba(255, 255, 255, 0.55);
    border: 1px solid currentColor;
    color: inherit;
    font-size: 10px;
    font-weight: 700;
    padding: 2px 7px;
    border-radius: 999px;
    cursor: pointer;
    flex-shrink: 0;
    white-space: nowrap;
    transition: opacity 120ms ease, background-color 120ms ease;
  }
  :global(body[data-theme="dark"]) .d3-why-safe-btn,
  :global(.dark) .d3-why-safe-btn {
    background: rgba(15, 23, 42, 0.45);
  }
  .d3-why-safe-btn.open {
    background: currentColor;
    color: var(--panel-solid, #ffffff);
  }

  .d3-intel-drawer {
    background: rgba(255, 255, 255, 0.72);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 9px 11px;
    font-size: 11.5px;
    line-height: 1.45;
    display: flex;
    flex-direction: column;
    gap: 5px;
    color: var(--text);
  }
  :global(body[data-theme="dark"]) .d3-intel-drawer,
  :global(.dark) .d3-intel-drawer {
    background: rgba(15, 23, 42, 0.68);
  }

  .d3-intel-badges {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .d3-safety-badge {
    display: inline-flex;
    align-items: center;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.02em;
    padding: 2px 8px;
    border-radius: 999px;
    text-transform: uppercase;
  }
  .d3-safety-badge.is-safe {
    background: #10b981;
    color: #ffffff;
  }
  .d3-safety-badge.is-review {
    background: #f59e0b;
    color: #111827;
  }

  .d3-intel-owner {
    font-size: 11px;
    color: var(--muted);
  }

  .d3-intel-path-row {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    font-size: 11px;
  }
  .d3-intel-label {
    font-weight: 700;
    color: var(--muted);
  }
  .d3-intel-code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 10.5px;
    background: var(--panel-2);
    padding: 1px 6px;
    border-radius: 5px;
    word-break: break-all;
  }
  .d3-intel-text,
  .d3-intel-rebuild {
    margin: 0;
    font-size: 11px;
    color: var(--text);
  }

  .d3-top-files-section {
    margin-top: 4px;
    padding-top: 6px;
    border-top: 1px dashed var(--border);
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .d3-top-files-title {
    font-size: 10.5px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--muted);
  }
  .d3-top-files-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 150px;
    overflow-y: auto;
  }
  .d3-top-file-row {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 4px 6px;
    border-radius: 6px;
    background: var(--panel-2);
  }
  .d3-top-file-main {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .d3-top-file-path {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 10.5px;
  }
  .d3-file-why-btn {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text);
    font-size: 9.5px;
    font-weight: 700;
    padding: 1px 6px;
    border-radius: 999px;
    cursor: pointer;
    flex-shrink: 0;
  }
  .d3-top-file-size {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 10.5px;
    font-weight: 700;
    flex-shrink: 0;
  }
  .d3-file-intel-sub {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 10.5px;
    color: var(--muted);
    padding-top: 3px;
    border-top: 1px solid var(--border);
  }

  /* 1.5. Paste Any Folder Path -> Instant Safety Check Card */
  .d3-safety-search-card {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 12px 15px;
    display: flex;
    flex-direction: column;
    gap: 9px;
  }
  .d3-safety-search-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
  }
  .d3-safety-title-wrap {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .d3-safety-kicker {
    font-size: 10.5px;
    font-weight: 800;
    letter-spacing: 0.04em;
    color: #059669;
    background: rgba(16, 185, 129, 0.12);
    padding: 2px 8px;
    border-radius: 999px;
  }
  .d3-safety-sub {
    font-size: 11.5px;
    color: var(--muted);
  }
  .d3-safety-chips {
    display: flex;
    align-items: center;
    gap: 5px;
    flex-wrap: wrap;
  }
  .d3-safety-chip {
    background: var(--panel-2);
    border: 1px solid var(--border);
    color: var(--text);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 10.5px;
    padding: 3px 8px;
    border-radius: 7px;
    cursor: pointer;
  }
  .d3-safety-chip.active {
    border-color: #10b981;
    background: rgba(16, 185, 129, 0.14);
  }
  .d3-safety-input-row {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--panel-2);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 7px 11px;
  }
  .d3-safety-icon {
    color: #10b981;
    flex-shrink: 0;
  }
  .d3-safety-input {
    flex: 1;
    border: none;
    background: transparent;
    color: var(--text);
    font-size: 12.5px;
    outline: none;
    min-width: 0;
  }
  .d3-safety-clear {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--muted);
    font-size: 11px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 6px;
    cursor: pointer;
  }
  .d3-safety-result-drawer {
    background: var(--panel-2);
    border: 1px solid var(--border);
    border-radius: 11px;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .d3-safety-result-top {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    font-size: 11.5px;
  }
  .d3-safety-owner,
  .d3-safety-avg {
    color: var(--muted);
  }
  .d3-safety-code-path {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 11px;
    background: var(--panel);
    padding: 2px 7px;
    border-radius: 6px;
    word-break: break-all;
  }
  .d3-safety-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .d3-safety-col {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .d3-safety-label {
    font-size: 10.5px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--muted);
  }
  .d3-safety-copy {
    margin: 0;
    font-size: 12px;
    line-height: 1.45;
    color: var(--text);
  }
  .d3-safety-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
    font-size: 11.5px;
    padding-top: 6px;
    border-top: 1px solid var(--border);
  }
  .d3-safety-warn {
    color: #d97706;
    font-weight: 600;
  }

  .d3-dual-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .d3-tile-action {
    width: 100%;
    min-height: 44px;
    padding: 9px 14px;
    border-radius: 11px;
    border: 1px solid currentColor;
    background: rgba(255, 255, 255, 0.68);
    color: inherit;
    font-size: 12.5px;
    font-weight: 800;
    display: flex;
    align-items: center;
    justify-content: space-between;
    cursor: pointer;
    transition:
      transform 140ms var(--ease-out),
      opacity 140ms var(--ease-out),
      background-color 140ms var(--ease-out),
      border-color 140ms var(--ease-out),
      color 140ms var(--ease-out),
      box-shadow 140ms var(--ease-out);
  }
  :global(body[data-theme="dark"]) .d3-tile-action,
  :global(.dark) .d3-tile-action {
    background: rgba(15, 23, 42, 0.55);
  }
  .d3-tile-action:active:not(:disabled) {
    transform: scale(0.97);
    transition-duration: 80ms;
  }
  .d3-tile-action:disabled {
    opacity: 0.55;
    cursor: default;
  }

  /* 3. Persistent Bottom Undo Recovery Toast Bar */
  .d3-undo-bar {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 10px 14px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }

  .d3-undo-left {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .d3-undo-badge {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 11px;
    font-weight: 700;
    padding: 3px 8px;
    border-radius: 7px;
    background: var(--d3-green-bg);
    color: var(--d3-green-ink);
  }

  .d3-undo-text {
    font-size: 12px;
    color: var(--muted);
  }

  .d3-undo-btn {
    min-height: 38px;
    padding: 6px 12px;
    border-radius: 9px;
    border: 1px solid var(--border);
    background: var(--panel-2);
    color: var(--text);
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    transition:
      transform 140ms var(--ease-out),
      opacity 140ms var(--ease-out),
      background-color 140ms var(--ease-out),
      border-color 140ms var(--ease-out),
      color 140ms var(--ease-out),
      box-shadow 140ms var(--ease-out);
  }
  .d3-undo-btn:active:not(:disabled) {
    transform: scale(0.97);
    transition-duration: 80ms;
  }

  /* 7-Day Undo Modal */
  .undo-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(7, 10, 13, 0.76);
    display: grid;
    place-items: center;
    z-index: 220;
    padding: 20px;
  }
  .undo-modal {
    width: 100%;
    max-width: 440px;
    padding: 20px 22px;
    border-radius: 18px;
    background: var(--panel-solid);
    border: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .undo-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .undo-title {
    margin: 0;
    font-size: 15px;
    font-weight: 700;
  }
  .close-x {
    background: transparent;
    border: none;
    color: var(--muted);
    padding: 4px 8px;
    cursor: pointer;
  }
  .undo-search {
    width: 100%;
    padding: 9px 12px;
    border-radius: 10px;
    background: var(--panel-2);
    border: 1px solid var(--border);
    font-size: 12.5px;
    color: var(--text);
  }
  .undo-rows {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 220px;
    overflow-y: auto;
  }
  .undo-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 9px 12px;
    border-radius: 10px;
    background: var(--panel-2);
    font-size: 12px;
  }
  .undo-item-info {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex: 1;
  }
  .undo-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text);
    font-weight: 500;
  }
  .undo-size {
    color: var(--muted);
    font-size: 11px;
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
  }
  .restore-link {
    background: transparent;
    border: none;
    color: #10b981;
    font-weight: 700;
    font-size: 12px;
    padding: 2px 6px;
    cursor: pointer;
  }
  .restore-all-btn {
    width: 100%;
    padding: 10px;
    border-radius: 10px;
    font-size: 12.5px;
    font-weight: 700;
    background: #0a7c52;
    color: #ffffff;
    border: none;
  }
  .undo-empty {
    padding: 16px 0;
    text-align: center;
    font-size: 12.5px;
    color: var(--muted);
  }
  .restore-toast {
    font-size: 12px;
    color: #10b981;
    font-weight: 600;
  }
  .error-banner {
    padding: 10px 14px;
    border-radius: 10px;
    background: rgba(239, 68, 68, 0.14);
    border: 1px solid rgba(239, 68, 68, 0.3);
    color: var(--danger);
    font-size: 12.5px;
  }

  .a14-referral-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 10px;
    padding: 10px 14px;
    border-radius: 12px;
    border: 1px solid rgba(16, 185, 129, 0.32);
    background: rgba(16, 185, 129, 0.08);
    font-size: 12.5px;
    color: var(--text);
  }
  .a14-referral-left {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .a14-referral-badge {
    background: #10b981;
    color: #ffffff;
    font-size: 10.5px;
    font-weight: 800;
    padding: 2px 7px;
    border-radius: 999px;
    letter-spacing: 0.02em;
  }
  .a14-referral-link {
    font-size: 12px;
    font-weight: 700;
    color: #059669;
    text-decoration: none;
    white-space: nowrap;
  }
  .a14-referral-link:hover {
    text-decoration: underline;
  }
  .a14-referral-actions {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .a14-share-win-btn {
    background: linear-gradient(135deg, #10b981, #059669);
    color: #ffffff;
    border: none;
    border-radius: 999px;
    padding: 6px 13px;
    font-size: 12px;
    font-weight: 800;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(16, 185, 129, 0.25);
  }
  .share-win-modal {
    max-width: 640px;
  }
  .share-win-canvas-wrap {
    width: 100%;
    border-radius: 14px;
    overflow: hidden;
    border: 1px solid rgba(16, 185, 129, 0.35);
    background: #041610;
  }
  .share-win-canvas {
    display: block;
    width: 100%;
    height: auto;
  }
  .share-win-actions-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .share-win-primary-btn {
    flex: 1.4;
    min-width: 190px;
    padding: 10px 14px;
    border-radius: 10px;
    border: none;
    background: linear-gradient(135deg, #10b981, #059669);
    color: #ffffff;
    font-size: 12.5px;
    font-weight: 800;
    cursor: pointer;
  }
  .share-win-social-btn {
    flex: 1;
    min-width: 92px;
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: var(--panel-2);
    color: var(--text);
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
  }

  @media (prefers-reduced-motion: reduce) {
    .d3-tile,
    .bento-card,
    .checkbox.checked {
      animation: none !important;
      transform: none !important;
    }
    .file-accordion-wrap,
    .inspect-chevron {
      transition-duration: 0.01ms !important;
    }
  }

  @media (max-width: 720px) {
    .d3-tiles-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
