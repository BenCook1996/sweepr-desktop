<script lang="ts" module>
  import type { ScanReport } from "../lib/api";
  let cachedReport: ScanReport | null = null;
  let cachedSelected: Record<string, boolean> = {};
</script>

<script lang="ts">
  import { onMount } from "svelte";
  import {
    api,
    errorMessage,
    isPaymentRequired,
    OPEN_UNDO_EVENT,
    requestActivation,
    type CategoryResult,
    type CleanReport,
    type LicenseStatus,
    type QuarantineEntry,
    type RecycleBinInfo,
    type RuleDefinitionInfo,
    type RunningAppConflict,
    type ScanProgress,
    type SystemOverview,
  } from "../lib/api";
  import { formatBytes, formatCount, shortenPath } from "../lib/format";
  import {
    addLifetimeStats,
    getLifetimeStats,
    getLocalCleaningHistory,
    syncLifetimeStatsFromBackend,
  } from "../lib/store";

  let {
    license,
    onLicenseChange,
    onOpenTool,
  }: {
    license: LicenseStatus | null;
    onLicenseChange: (force?: boolean) => Promise<void>;
    onOpenTool?: (tool: "memory" | "apps" | "storage" | "privacy" | "shredder" | "schedule") => void;
  } = $props();

  type Phase = "idle" | "scanning" | "results" | "cleaning" | "done";
  let phase = $state<Phase>("idle");
  let initialScanning = $state(false);
  let progress = $state<ScanProgress | null>(null);
  let report = $state<ScanReport | null>(cachedReport);
  let selected = $state<Record<string, boolean>>(cachedSelected);
  let expanded = $state<string | null>(null);
  let error = $state<string | null>(null);
  let results = $state<CleanReport[]>([]);
  let exclusions = $state<string[]>([]);
  let showExclusions = $state(false);
  let quarantine = $state<QuarantineEntry[]>([]);
  let recycleBin = $state<RecycleBinInfo | null>(null);
  let emptyingRecycleBin = $state(false);
  let showQuarantine = $state(false);
  let restoreNotice = $state<string | null>(null);
  let runningConflicts = $state<RunningAppConflict[]>([]);
  let sysOverview = $state<SystemOverview | null>(null);
  let lifetimeStats = $state(getLifetimeStats());

  // ---- v2 Home: first-run welcome, Smart/Custom mode, last scan & weekly savings ----
  const LS_WELCOME = "sweepr_welcome_seen_v2";
  const LS_LAST_SCAN = "sweepr_last_scan_at";
  const LS_SCAN_MODE = "sweepr_scan_mode";
  const ls = typeof localStorage !== "undefined" ? localStorage : null;

  // Only brand-new users (no saved report, no cleaning history) see the first-run welcome.
  let showWelcome = $state(
    !cachedReport && !ls?.getItem(LS_WELCOME) && getLocalCleaningHistory().length === 0
  );
  let scanMode = $state<"smart" | "custom">(ls?.getItem(LS_SCAN_MODE) === "custom" ? "custom" : "smart");
  let showModeTip = $state(false);
  let lastScanAt = $state<number | null>(Number(ls?.getItem(LS_LAST_SCAN)) || null);
  let history = $state(getLocalCleaningHistory());
  let rules = $state<RuleDefinitionInfo[]>([]);

  function dismissWelcome(startScan: boolean) {
    ls?.setItem(LS_WELCOME, "1");
    showWelcome = false;
    if (startScan) scan();
    else if (!cachedReport) runDashboardScan();
  }

  function setScanMode(mode: "smart" | "custom") {
    scanMode = mode;
    ls?.setItem(LS_SCAN_MODE, mode);
    if (mode === "smart" && report) {
      const sel = Object.fromEntries(report.categories.map((c) => [c.id, c.bytes > 0]));
      selected = sel;
      cachedSelected = sel;
    }
  }

  /** Smart mode selects every area with junk; Custom mode keeps the user's own ticks. */
  function selectionFor(r: ScanReport): Record<string, boolean> {
    return Object.fromEntries(
      r.categories.map((c) => [c.id, c.bytes > 0 && (scanMode === "smart" || (selected[c.id] ?? true))])
    );
  }

  function markScanned() {
    lastScanAt = Math.floor(Date.now() / 1000);
    ls?.setItem(LS_LAST_SCAN, String(lastScanAt));
  }

  function relativeTime(ts: number | null): string {
    if (!ts) return "Never";
    const diff = Math.max(0, Math.floor(Date.now() / 1000) - ts);
    if (diff < 90) return "Just now";
    if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
    if (diff < 86400) return `${Math.round(diff / 3600)} hour${Math.round(diff / 3600) === 1 ? "" : "s"} ago`;
    const days = Math.round(diff / 86400);
    return `${days} day${days === 1 ? "" : "s"} ago`;
  }

  const DAY_LABELS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  /** Bytes cleaned per day over the last 7 days (oldest → today). */
  const weekly = $derived.by(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000;
    const days = Array.from({ length: 7 }, (_, i) => {
      const start = startOfToday - (6 - i) * 86400;
      const d = new Date(start * 1000);
      return { label: DAY_LABELS[d.getDay()], start, bytes: 0, today: i === 6 };
    });
    for (const h of history) {
      for (const d of days) {
        if (h.timestamp >= d.start && h.timestamp < d.start + 86400) d.bytes += h.bytes_freed;
      }
    }
    return days;
  });
  const weeklyTotal = $derived(weekly.reduce((s, d) => s + d.bytes, 0));
  const weeklyMax = $derived(Math.max(1, ...weekly.map((d) => d.bytes)));
  const lastClean = $derived(history[0] ?? null);

  /** Things SWEEPR never touches — shown greyed out so people know they're safe. */
  const NEVER_TOUCHED = ["Saved passwords", "Bookmarks", "Your documents & photos"];

  const nonEmpty = $derived(report?.categories.filter((c) => c.bytes > 0) ?? []);
  const empty = $derived(report?.categories.filter((c) => c.bytes === 0) ?? []);
  const selectedCats = $derived(nonEmpty.filter((c) => selected[c.id]));
  const selectedBytes = $derived(selectedCats.reduce((s, c) => s + c.bytes, 0));
  const freed = $derived(results.reduce((s, r) => s + r.bytes_freed, 0));
  const skipped = $derived(results.reduce((s, r) => s + r.files_skipped, 0));
  const removed = $derived(results.reduce((s, r) => s + r.files_removed, 0));

  const winTempBytes = $derived(
    nonEmpty
      .filter((c) => /temp|log|crash|update|prefetch|thumb|font|dns|shader|memory_dump|windows/i.test(c.id))
      .reduce((s, c) => s + c.bytes, 0)
  );
  const browserBytes = $derived(
    nonEmpty
      .filter(
        (c) =>
          !/temp|log|crash|update|prefetch|thumb|font|dns|shader|memory_dump|windows/i.test(c.id) &&
          /chrome|edge|brave|firefox|opera|vivaldi|safari|browser/i.test(c.id)
      )
      .reduce((s, c) => s + c.bytes, 0)
  );
  const appClutterBytes = $derived(
    Math.max(0, (report?.total_bytes ?? 0) - winTempBytes - browserBytes)
  );

  const diskUsedBytes = $derived(
    sysOverview ? Math.max(0, sysOverview.disk_total_bytes - sysOverview.disk_available_bytes) : 0
  );
  const diskUsedPct = $derived(
    sysOverview && sysOverview.disk_total_bytes > 0
      ? Math.round((diskUsedBytes / sysOverview.disk_total_bytes) * 100)
      : 0
  );
  const memUsedPct = $derived(
    sysOverview && sysOverview.memory_total_bytes > 0
      ? Math.round((sysOverview.memory_used_bytes / sysOverview.memory_total_bytes) * 100)
      : 0
  );

  async function runDashboardScan() {
    if (initialScanning) return;
    initialScanning = true;
    progress = null;
    const unlisten = await api.onScanProgress((p) => (progress = p));
    try {
      const r = await api.scan();
      report = r;
      cachedReport = r;
      const sel = selectionFor(r);
      markScanned();
      selected = sel;
      cachedSelected = sel;
    } catch (e) {
      error = errorMessage(e);
    } finally {
      unlisten();
      initialScanning = false;
    }
  }

  onMount(() => {
    api.listExclusions().then((list) => (exclusions = list)).catch(() => {});
    api.listQuarantine().then((q) => (quarantine = q)).catch(() => {});
    api.systemOverview().then((o) => (sysOverview = o)).catch(() => {});
    syncLifetimeStatsFromBackend().then((s) => (lifetimeStats = s)).catch(() => {});
    api.listRuleDefinitions().then((r) => (rules = r)).catch(() => {});
    if (!cachedReport && !showWelcome) {
      runDashboardScan();
    }
    const openUndo = () => {
      phase = "idle";
      if (!showQuarantine) toggleQuarantineDrawer();
    };
    const onStats = () => (history = getLocalCleaningHistory());
    window.addEventListener(OPEN_UNDO_EVENT, openUndo);
    window.addEventListener("sweepr-stats-update", onStats);
    return () => {
      window.removeEventListener(OPEN_UNDO_EVENT, openUndo);
      window.removeEventListener("sweepr-stats-update", onStats);
    };
  });

  async function toggleQuarantineDrawer() {
    showQuarantine = !showQuarantine;
    if (showQuarantine) {
      const [q, rb] = await Promise.all([
        api.listQuarantine().catch(() => []),
        api.recycleBinInfo().catch(() => null),
      ]);
      quarantine = q;
      recycleBin = rb;
    }
  }

  async function emptyWindowsRecycleBin() {
    const countLabel = recycleBin
      ? `${formatCount(recycleBin.items)} item(s) (${formatBytes(recycleBin.bytes)})`
      : "all items";
    if (!confirm(`Permanently empty ${countLabel} from your Windows Recycle Bin?\n\nThis cannot be undone.`)) {
      return;
    }
    error = null;
    restoreNotice = null;
    emptyingRecycleBin = true;
    try {
      const freedBytes = await api.emptyRecycleBin();
      addLifetimeStats(freedBytes, recycleBin?.items ?? 0, ["recycle_bin"], "Empty Recycle Bin");
      lifetimeStats = getLifetimeStats();
      recycleBin = { bytes: 0, items: 0 };
      restoreNotice = `Emptied Recycle Bin (${formatBytes(freedBytes)} freed).`;
    } catch (e) {
      if (isPaymentRequired(e)) requestActivation();
      else error = errorMessage(e);
    } finally {
      emptyingRecycleBin = false;
    }
  }

  async function restoreQuarantined(item: QuarantineEntry) {
    if (!license?.active) {
      requestActivation();
      return;
    }
    error = null;
    restoreNotice = null;
    try {
      const restoredPath = await api.restoreQuarantineItem(item.id);
      quarantine = quarantine.filter((q) => q.id !== item.id);
      restoreNotice = `Put "${item.file_name}" back in ${restoredPath}`;
    } catch (e) {
      if (isPaymentRequired(e)) requestActivation();
      else error = errorMessage(e);
    }
  }

  $effect(() => {
    if (phase === "results") {
      const ids = selectedCats.map((c) => c.id);
      if (ids.length > 0) {
        api.checkRunningApps(ids).then((c) => (runningConflicts = c)).catch(() => (runningConflicts = []));
      } else {
        runningConflicts = [];
      }
    }
  });

  async function refreshConflicts() {
    const ids = selectedCats.map((c) => c.id);
    runningConflicts = ids.length ? await api.checkRunningApps(ids).catch(() => []) : [];
  }

  async function excludePath(path: string) {
    if (!license?.active) {
      requestActivation();
      return;
    }
    try {
      exclusions = await api.addExclusion(path);
      if (phase === "results") {
        await scan();
      } else {
        await runDashboardScan();
      }
    } catch (e) {
      if (isPaymentRequired(e)) requestActivation();
      else error = errorMessage(e);
    }
  }

  async function pickAndAddProtectedFolder() {
    if (!license?.active) {
      requestActivation();
      return;
    }
    try {
      const picked = await api.pickFolder("Choose a folder that SWEEPR should never touch");
      if (picked && picked.trim()) {
        exclusions = await api.addExclusion(picked.trim());
        if (phase === "results") await scan();
        else await runDashboardScan();
      }
    } catch (e) {
      if (isPaymentRequired(e)) requestActivation();
      else error = errorMessage(e);
    }
  }

  async function removeExcludedPath(path: string) {
    if (!license?.active) {
      requestActivation();
      return;
    }
    try {
      exclusions = await api.removeExclusion(path);
      if (phase === "results") await scan();
      else await runDashboardScan();
    } catch (e) {
      if (isPaymentRequired(e)) requestActivation();
      else error = errorMessage(e);
    }
  }

  async function scan() {
    error = null;
    phase = "scanning";
    progress = null;
    const unlisten = await api.onScanProgress((p) => (progress = p));
    try {
      const r = await api.scan();
      report = r;
      cachedReport = r;
      const sel = selectionFor(r);
      markScanned();
      selected = sel;
      cachedSelected = sel;
      phase = "results";
    } catch (e) {
      error = errorMessage(e);
      phase = "idle";
    } finally {
      unlisten();
    }
  }

  function backToDashboard() {
    phase = "idle";
    api.systemOverview().then((o) => (sysOverview = o)).catch(() => {});
    runDashboardScan();
  }

  function requestClean() {
    if (!report) {
      scan();
      return;
    }
    if (!license?.active) {
      requestActivation();
      return;
    }
    runClean(selectedCats);
  }

  async function runClean(cats: CategoryResult[]) {
    if (!cats.length) return;
    if (!license?.active) {
      requestActivation();
      return;
    }
    error = null;
    phase = "cleaning";
    try {
      results = await api.clean(cats.map((c) => c.id), false);

      const totalFreed = results.reduce((s, r) => s + r.bytes_freed, 0);
      const totalRemoved = results.reduce((s, r) => s + r.files_removed, 0);
      addLifetimeStats(totalFreed, totalRemoved, cats.map((c) => c.id), "Recently Cleaned (7-day undo)", false);
      lifetimeStats = await syncLifetimeStatsFromBackend();
      api.listQuarantine().then((q) => (quarantine = q)).catch(() => {});

      phase = "done";
    } catch (e: any) {
      phase = "results";
      if (isPaymentRequired(e)) requestActivation();
      else error = errorMessage(e);
    }
  }
</script>

{#if error}
  <div class="card error-banner">
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
    <span>{error}</span>
  </div>
{/if}

{#if showQuarantine}
  <div class="card drawer-card">
    <div class="row" style="margin-bottom: 12px;">
      <div>
        <strong>Recently Cleaned Files &amp; Recycle Bin</strong>
        <div class="muted small">Files cleaned by SWEEPR are kept safely for 7 days so you can put them back with one click.</div>
      </div>
      <div class="spacer"></div>
      <button class="ghost small-btn" onclick={() => (showQuarantine = false)}>Close</button>
    </div>

    <div class="row sub-box" style="margin-bottom: 12px; gap: 12px;">
      <span class="badge free">Recycle Bin</span>
      <div style="flex: 1;">
        <strong class="small">
          {recycleBin ? `${formatBytes(recycleBin.bytes)} (${formatCount(recycleBin.items)} items)` : "Checking Recycle Bin…"}
        </strong>
        <div class="muted small">Deleted files sitting in your Windows Recycle Bin</div>
      </div>
      <button
        class="primary small-btn"
        disabled={emptyingRecycleBin || !recycleBin || (recycleBin.bytes === 0 && recycleBin.items === 0)}
        onclick={emptyWindowsRecycleBin}
      >
        {emptyingRecycleBin ? "Emptying…" : "Empty Recycle Bin"}
      </button>
    </div>

    {#if restoreNotice}
      <div class="small" style="color: var(--accent); margin-bottom: 8px; font-weight: 600;">{restoreNotice}</div>
    {/if}

    {#if quarantine.length === 0}
      <div class="muted small">No recently cleaned files waiting in the 7-day undo bin.</div>
    {:else}
      <div class="undo-list">
        {#each quarantine as q}
          <div class="row sub-box">
            <div style="flex: 1; min-width: 0;">
              <strong class="small">{q.file_name}</strong>
              <div class="muted small" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title={q.original_path}>
                {shortenPath(q.original_path, 70)}
              </div>
            </div>
            <span class="small" style="font-weight: 700;">{formatBytes(q.size)}</span>
            <button class="primary small-btn" onclick={() => restoreQuarantined(q)}>Put Back</button>
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}

{#if phase === "idle" && showWelcome}
  <!-- First-run welcome (one calm screen, one button) -->
  <section class="welcome-first-run">
    <svg class="welcome-logo" viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <linearGradient id="welcomeEmerald" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#10b981" />
          <stop offset="100%" stop-color="#047857" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="96" height="96" rx="24" fill="url(#welcomeEmerald)" />
      <line x1="76" y1="24" x2="53" y2="47" stroke="#a7f3d0" stroke-width="8" stroke-linecap="round" />
      <path d="M 42 40 L 60 58 L 55 64 L 36 45 Z" fill="#ffffff" />
      <path d="M 34 48 L 52 66 L 38 82 C 30 78, 22 70, 18 62 Z" fill="#ffffff" />
      <line x1="34" y1="76" x2="43" y2="63" stroke="#047857" stroke-width="3" stroke-linecap="round" />
      <line x1="27" y1="69" x2="36" y2="56" stroke="#047857" stroke-width="3" stroke-linecap="round" />
      <path d="M 74 56 Q 74 65 83 65 Q 74 65 74 74 Q 74 65 65 65 Q 74 65 74 56 Z" fill="#ffffff" />
      <circle cx="62" cy="79" r="3.5" fill="#a7f3d0" />
    </svg>
    <h1 class="welcome-first-title">Welcome to SWEEPR Cleaner</h1>
    <strong class="welcome-first-sub">Get ready for a faster, cleaner PC!</strong>
    <div class="welcome-gauge" aria-hidden="true"></div>
    <p class="muted welcome-first-copy">
      To start, we'll safely check your PC for hidden junk and slow startup apps. Nothing is deleted until you say so.
    </p>
    <button class="primary welcome-scan-btn" onclick={() => dismissWelcome(true)}>SCAN NOW</button>
    <button class="ghost welcome-skip" onclick={() => dismissWelcome(false)}>Skip for now</button>
  </section>

{:else if phase === "idle"}
  <div class="dashboard-container">
    <div class="home-grid">
      <!-- Left: headline + big glowing scan ring -->
      <section class="home-hero">
        <div class="hero-status-pill" class:scanning={initialScanning}>
          {#if initialScanning}
            <span class="pulse-dot"></span>
            <span>Checking your PC{progress ? `: ${progress.category_name}` : "…"}</span>
          {:else if report && report.total_bytes > 0}
            <span class="pulse-dot ready"></span>
            <span>Ready to clean · 🛡️ 7-Day Safety Undo enabled</span>
          {:else}
            <span class="pulse-dot clean"></span>
            <span>Your PC is clean · 🛡️ 7-Day Safety Undo enabled</span>
          {/if}
        </div>

        <h1 class="home-title">Welcome to<br /><span class="home-title-brand">SWEEPR Cleaner!</span></h1>
        <p class="muted home-sub">
          {#if initialScanning}
            Safely checking temporary folders, browser clutter and old logs. Your personal files are never touched.
          {:else if report && report.total_bytes > 0}
            We found <strong class="accent-text">{formatBytes(report.total_bytes)}</strong> of junk across {nonEmpty.length} areas. Your personal files are completely safe.
          {:else}
            One click checks your PC for junk, browser clutter and wasted space.
          {/if}
        </p>

        <button
          class="scan-ring"
          class:busy={initialScanning}
          disabled={initialScanning}
          onclick={() => (report && report.total_bytes > 0 ? requestClean() : scan())}
          aria-label={report && report.total_bytes > 0 ? `Clean ${formatBytes(selectedBytes)} now` : "Scan my PC"}
        >
          <span class="scan-ring-glow" aria-hidden="true"></span>
          <span class="scan-ring-ticks" aria-hidden="true"></span>
          <span class="scan-ring-arc" aria-hidden="true"></span>
          <span class="scan-ring-inner">
            {#if initialScanning}
              <b class="scan-ring-word small-word">CHECKING</b>
              <small>{progress ? `${formatBytes(progress.bytes_so_far)} found` : "Starting…"}</small>
            {:else if report && report.total_bytes > 0}
              <b class="scan-ring-word">CLEAN</b>
              <small>{formatBytes(selectedBytes)} selected</small>
            {:else}
              <b class="scan-ring-word">SCAN</b>
              <small>Takes about 20 seconds</small>
            {/if}
          </span>
        </button>

        <div class="last-scan muted">
          Last scan<br />
          <strong>
            {relativeTime(lastScanAt)}{lastClean ? ` · ${formatBytes(lastClean.bytes_freed)} cleaned` : ""}
          </strong>
        </div>

        {#if report && report.total_bytes > 0 && !initialScanning}
          <div class="hero-breakdown">
            <div class="hero-breakdown-track" aria-hidden="true">
              {#if winTempBytes > 0}
                <div class="seg seg-win" style="width: {Math.max(6, Math.round((winTempBytes / report.total_bytes) * 100))}%"></div>
              {/if}
              {#if browserBytes > 0}
                <div class="seg seg-browser" style="width: {Math.max(6, Math.round((browserBytes / report.total_bytes) * 100))}%"></div>
              {/if}
              {#if appClutterBytes > 0}
                <div class="seg seg-app" style="width: {Math.max(6, Math.round((appClutterBytes / report.total_bytes) * 100))}%"></div>
              {/if}
            </div>
            <div class="hero-breakdown-legend">
              {#if winTempBytes > 0}
                <span class="legend-item"><span class="legend-dot dot-win"></span>Windows &amp; System Temp ({formatBytes(winTempBytes)})</span>
              {/if}
              {#if browserBytes > 0}
                <span class="legend-item"><span class="legend-dot dot-browser"></span>Browser Caches ({formatBytes(browserBytes)})</span>
              {/if}
              {#if appClutterBytes > 0}
                <span class="legend-item"><span class="legend-dot dot-app"></span>App &amp; Other Clutter ({formatBytes(appClutterBytes)})</span>
              {/if}
            </div>
          </div>
          <div class="hero-actions-row">
            <button class="ghost hero-secondary-btn" onclick={() => (phase = "results")}>
              Review What Was Found ({nonEmpty.length})
            </button>
            <button class="ghost hero-secondary-btn" onclick={scan}>Scan Again</button>
          </div>
        {/if}

        <!-- Smart Mode vs Custom Mode -->
        <div class="mode-row">
          <div class="mode-toggle" role="tablist" aria-label="Scan mode">
            <button
              class="mode-opt"
              class:on={scanMode === "smart"}
              role="tab"
              aria-selected={scanMode === "smart"}
              onclick={() => setScanMode("smart")}
            >
              ✨ Smart Mode
            </button>
            <button
              class="mode-opt"
              class:on={scanMode === "custom"}
              role="tab"
              aria-selected={scanMode === "custom"}
              onclick={() => setScanMode("custom")}
            >
              Custom Mode
            </button>
          </div>
          <button
            class="ghost mode-help"
            aria-label="What do these modes mean?"
            aria-expanded={showModeTip}
            onclick={() => (showModeTip = !showModeTip)}
          >
            ?
          </button>
          {#if showModeTip}
            <div class="mode-tip" role="note">
              <strong class="accent-text">Smart Mode</strong> picks the safe areas for you, so you don't need to decide anything.
              Choose <strong>Custom</strong> only if you want to tick areas yourself.
            </div>
          {/if}
        </div>

        <div class="card areas-card">
          <div class="row areas-head">
            <strong class="small">{scanMode === "smart" ? "What Smart Mode will check" : "Choose what to clean"}</strong>
            <div class="spacer"></div>
            <span class="badge free">All safe · Personal files never touched</span>
          </div>
          <div class="areas-grid">
            {#if report}
              {#each report.categories as c (c.id)}
                <label class="area-chk" class:off={c.bytes === 0}>
                  <input
                    type="checkbox"
                    checked={c.bytes > 0 && !!selected[c.id]}
                    disabled={scanMode === "smart" || c.bytes === 0}
                    onchange={(e) => {
                      selected[c.id] = (e.currentTarget as HTMLInputElement).checked;
                      cachedSelected = selected;
                    }}
                  />
                  <span>{c.name}{c.bytes > 0 ? ` (${formatBytes(c.bytes)})` : ""}</span>
                </label>
              {/each}
            {:else}
              {#each rules as r (r.id)}
                <label class="area-chk">
                  <input type="checkbox" checked disabled />
                  <span>{r.name}</span>
                </label>
              {/each}
            {/if}
            {#each NEVER_TOUCHED as item}
              <label class="area-chk off" title="SWEEPR never touches this">
                <input type="checkbox" disabled />
                <span>{item} (never touched)</span>
              </label>
            {/each}
          </div>
        </div>
      </section>

      <!-- Right: weekly savings chart + tool tiles -->
      <aside class="home-side">
        <div class="card week-card">
          <div class="row" style="justify-content: space-between;">
            <strong class="small">Space Cleaned This Week</strong>
            <span class="badge free">{formatBytes(weeklyTotal)}</span>
          </div>
          <div class="week-bars" role="img" aria-label="Space cleaned per day over the last 7 days">
            {#each weekly as d}
              <div class="week-bar" class:today={d.today} title={`${d.label}: ${formatBytes(d.bytes)}`}>
                <i style="height: {d.bytes > 0 ? Math.max(8, Math.round((d.bytes / weeklyMax) * 100)) : 4}%"></i>
                <span>{d.label}</span>
              </div>
            {/each}
          </div>
          <div class="muted small" style="margin-top: 6px;">
            All-time: <strong style="color: var(--text);">{formatBytes(lifetimeStats.bytesFreed)}</strong> · {formatCount(lifetimeStats.filesRemoved)} files
          </div>
        </div>

        <div class="tile-grid">
          <button class="card tool-tile" onclick={() => onOpenTool?.("memory")}>
            <span class="tile-ic">⚡</span>
            <strong>Speed Up</strong>
            <span class="muted">
              {sysOverview ? `${memUsedPct}% memory in use` : "Free memory & stop slow startup apps"}
            </span>
          </button>
          <button class="card tool-tile" onclick={() => onOpenTool?.("storage")}>
            <span class="tile-ic">📑</span>
            <strong>Duplicates</strong>
            <span class="muted">
              {sysOverview ? `${formatBytes(sysOverview.disk_available_bytes)} free on ${sysOverview.disk_mount}` : "Remove extra copies, keep the original"}
            </span>
          </button>
          <button class="card tool-tile" onclick={() => onOpenTool?.("schedule")}>
            <span class="tile-ic">🗓️</span>
            <strong>Auto-Clean</strong>
            <span class="muted">Cleans for you in the background</span>
          </button>
          <button class="card tool-tile" onclick={toggleQuarantineDrawer}>
            <span class="tile-ic">↩️</span>
            <strong>Undo ({quarantine.length})</strong>
            <span class="muted">Put back anything within 7 days</span>
          </button>
        </div>

        <div class="card disk-mini">
          <div class="row" style="justify-content: space-between;">
            <strong class="small">Hard Drive {sysOverview ? sysOverview.disk_mount : ""}</strong>
            <span class="muted small">{sysOverview ? `${diskUsedPct}% used` : "—"}</span>
          </div>
          <div class="clean-bar"><div class="clean-bar-fill" class:amber={diskUsedPct > 90} style="width: {diskUsedPct}%"></div></div>
          <div class="muted small">
            {sysOverview ? `${formatBytes(sysOverview.disk_available_bytes)} free of ${formatBytes(sysOverview.disk_total_bytes)}` : ""}
          </div>
        </div>
      </aside>
    </div>
  </div>

{:else if phase === "scanning"}
  <section class="card scanning-modal">
    <div class="spinner" aria-hidden="true"></div>
    <h2 class="scanning-title">Checking your PC{progress ? `: ${progress.category_name}` : "…"}</h2>
    {#if progress}
      <div class="progress-bar-track">
        <div class="progress-bar-fill" style="width:{(progress.done / progress.total) * 100}%"></div>
      </div>
      <p class="big-number">{formatBytes(progress.bytes_so_far)}</p>
      <p class="muted small">{progress.done} of {progress.total} areas checked</p>
    {/if}
  </section>

{:else if phase === "results" && report}
  <header class="card results-summary-card">
    <div class="row summary-row">
      <div>
        <div class="summary-label">READY TO CLEAN</div>
        <div class="big-number">{formatBytes(report.total_bytes)}</div>
        <div class="muted small" style="margin-top: 2px;">
          {formatCount(report.total_files)} unneeded files found across {nonEmpty.length} areas · Your personal files are untouched
        </div>
      </div>
      <div class="spacer"></div>
      <button class="ghost rescan-btn" onclick={() => (phase = "idle")}>
        <span>← Back</span>
      </button>
      <button
        class="ghost rescan-btn"
        onclick={() => {
          const next = !(showExclusions || showQuarantine);
          showExclusions = next;
          if (next !== showQuarantine) {
            toggleQuarantineDrawer();
          }
        }}
      >
        <span>Safety &amp; History ({exclusions.length + quarantine.length})</span>
      </button>
      <button class="ghost rescan-btn" onclick={scan}>
        <span>Scan Again</span>
      </button>
    </div>
  </header>

  {#if showExclusions}
    <div class="card drawer-card">
      <div class="row" style="margin-bottom: 12px; flex-wrap: wrap; gap: 12px;">
        <div>
          <strong>Folders to Keep Safe</strong>
          <div class="muted small">SWEEPR will never scan or delete anything inside these folders.</div>
        </div>
        <div class="spacer"></div>
        <button type="button" class="primary small-btn" onclick={pickAndAddProtectedFolder}>
          + Choose Folder to Keep Safe…
        </button>
      </div>
      {#if exclusions.length === 0}
        <div class="muted small">No folders added yet. Click <strong>+ Choose Folder to Keep Safe…</strong> above or click <strong>Keep file</strong> next to any file below.</div>
      {:else}
        <div class="undo-list">
          {#each exclusions as ex}
            <div class="row sub-box">
              <span class="small grow" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title={ex}>{ex}</span>
              <button class="ghost small-btn" onclick={() => removeExcludedPath(ex)}>Remove</button>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  {#if runningConflicts.length > 0}
    <div class="card conflict-banner">
      <div style="flex: 1;">
        <strong style="color: var(--warn); font-size: 13.5px;">
          Please close these open apps first: {runningConflicts.map((c) => c.app_name).join(", ")}
        </strong>
        <div class="muted" style="font-size: 12.5px; margin-top: 2px;">
          Closing them lets SWEEPR clean 100% of their temporary files.
        </div>
      </div>
      <button class="ghost small-btn" onclick={refreshConflicts}>Check Again</button>
    </div>
  {/if}

  <!-- Results Review List (sorted by size, sticky "Selected" dock) -->
  <div class="review-list card">
    <div class="review-list-head">
      <span class="review-heading">SAFE TO CLEAN</span>
      <div class="spacer"></div>
      <button
        class="ghost review-btn"
        onclick={() => {
          const allOn = nonEmpty.every((c) => selected[c.id]);
          for (const c of nonEmpty) selected[c.id] = !allOn;
          cachedSelected = selected;
        }}
      >
        {nonEmpty.every((c) => selected[c.id]) ? "Untick all" : "Tick all"}
      </button>
    </div>
    {#each [...nonEmpty].sort((a, b) => b.bytes - a.bytes) as c (c.id)}
      <div class="review-row" class:expanded={expanded === c.id}>
        <div class="review-row-main">
          <input type="checkbox" bind:checked={selected[c.id]} aria-label="Select {c.name}" />
          <div class="review-row-text">
            <strong class="item-title">{c.name}</strong>
            <span class="muted small">{formatBytes(c.bytes)} • {formatCount(c.files)} items · {c.description}</span>
            <div class="cat-progress-bar" aria-hidden="true">
              <div
                class="cat-progress-fill"
                style="width: {Math.max(2, Math.round((c.bytes / Math.max(1, report.total_bytes)) * 100))}%"
              ></div>
            </div>
          </div>
          {#if !license?.active}
            <span class="badge pro">Pro</span>
          {/if}
          <span class="category-bytes">{formatBytes(c.bytes)}</span>
          <button
            class="ghost chevron-btn"
            aria-expanded={expanded === c.id}
            aria-label={expanded === c.id ? `Hide sample files for ${c.name}` : `Show sample files for ${c.name}`}
            onclick={() => (expanded = expanded === c.id ? null : c.id)}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="transform: rotate({expanded === c.id ? 180 : 0}deg); transition: transform 0.15s;"><polyline points="6 9 12 15 18 9" /></svg>
          </button>
        </div>
        {#if expanded === c.id}
          <div class="files-preview">
            <div class="muted small" style="margin-bottom: 6px;">Largest files in this group:</div>
            {#each c.top_files as f}
              <div class="row file-line" style="gap: 8px;">
                <span class="grow small" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title={f.path}>
                  {shortenPath(f.path, 65)}
                </span>
                <span class="small" style="font-weight: 600;">{formatBytes(f.size)}</span>
                <button class="ghost" style="padding: 2px 8px; font-size: 11px;" onclick={() => excludePath(f.path)}>
                  Keep file
                </button>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/each}
    {#if empty.length}
      <div class="review-empty muted small">Already clean: {empty.map((c) => c.name).join(", ")}</div>
    {/if}
  </div>

  <!-- Sticky Action Dock -->
  <footer class="card action-dock">
    <div>
      <div class="dock-label">SELECTED ({formatBytes(selectedBytes)})</div>
      <div class="muted small">🛡️ You can undo this for 7 days</div>
    </div>
    <div class="spacer"></div>
    <button class="primary clean-action-btn" disabled={!selectedCats.length} onclick={requestClean}>
      🧹 Finish Cleaning
    </button>
  </footer>

{:else if phase === "cleaning"}
  <section class="card cleaning-card">
    <div class="spinner" aria-hidden="true"></div>
    <h2 style="margin-top: 18px; font-size: 22px;">Cleaning your PC…</h2>
    <p class="muted">Any files currently open are skipped automatically so your work stays safe.</p>
  </section>

{:else if phase === "done"}
  <section class="card done-card">
    <div class="success-icon-container">
      <div class="check-circle">
        <svg class="check-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      </div>
    </div>
    <h1 class="done-title">{formatBytes(freed)} cleaned!</h1>
    <p class="muted" style="margin: 8px 0 18px 0;">
      Your PC is clean. {formatCount(removed)} unneeded files were removed{skipped ? ` (${formatCount(skipped)} open files were safely skipped)` : ""}.
    </p>
    <p class="note" style="margin-bottom: 20px;">
      Changed your mind? You can put cleaned files back anytime within 7 days using <strong>Recently Cleaned / Undo</strong>.
    </p>
    <button class="primary big" onclick={backToDashboard}>Back to Home</button>
  </section>
{/if}

<style>
  .dashboard-container {
    max-width: 1120px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 22px;
  }


  .drawer-card {
    max-width: 1120px;
    margin: 0 auto 18px auto;
    padding: 18px 22px;
  }
  .sub-box {
    background: var(--panel-2);
    padding: 9px 14px;
    border-radius: 10px;
    border: 1px solid var(--border);
  }
  .undo-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 200px;
    overflow-y: auto;
  }

  /* Hero Clean Card */
  .hero-status-pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    align-self: flex-start;
    padding: 5px 12px;
    border-radius: 9999px;
    background: var(--panel-2);
    border: 1px solid var(--border);
    font-size: 12.5px;
    font-weight: 700;
    color: var(--text);
  }
  .pulse-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #f59e0b;
  }
  .pulse-dot.ready {
    background: #10b981;
  }
  .pulse-dot.clean {
    background: #10b981;
  }
  .accent-text {
    color: var(--accent);
  }
  .hero-breakdown {
    display: flex;
    flex-direction: column;
    gap: 7px;
    max-width: 520px;
    margin-top: 2px;
  }
  .hero-breakdown-track {
    height: 10px;
    border-radius: 9999px;
    background: var(--panel-2);
    border: 1px solid var(--border);
    overflow: hidden;
    display: flex;
  }
  .hero-breakdown-track .seg {
    height: 100%;
    transition: width 0.3s ease;
  }
  .seg-win {
    background: #10b981;
  }
  .seg-browser {
    background: #0d9488;
  }
  .seg-app {
    background: #34d399;
  }
  .hero-breakdown-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    font-size: 11.5px;
    color: var(--muted);
    font-weight: 600;
  }
  .legend-item {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .legend-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    display: inline-block;
  }
  .dot-win {
    background: #10b981;
  }
  .dot-browser {
    background: #0d9488;
  }
  .dot-app {
    background: #34d399;
  }
  .hero-actions-row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    margin-top: 6px;
  }
  .hero-secondary-btn {
    padding: 12px 18px;
    border-radius: 9999px;
    font-size: 13.5px;
    font-weight: 600;
  }


  /* 3 Simple Summary Cards */
  @media (max-width: 920px) {
  }
  .clean-bar {
    height: 8px;
    border-radius: 9999px;
    background: var(--panel-2);
    overflow: hidden;
    border: 1px solid var(--border);
  }
  .clean-bar-fill {
    height: 100%;
    background: linear-gradient(90deg, #10b981, #059669);
    border-radius: 9999px;
  }
  .clean-bar-fill.amber {
    background: linear-gradient(90deg, #f59e0b, #d97706);
  }


  .small-btn {
    padding: 6px 14px;
    font-size: 12.5px;
    border-radius: 9999px;
  }

  /* Scanning, Results, Done Views */
  .scanning-modal,
  .cleaning-card,
  .done-card {
    max-width: 540px;
    margin: 48px auto;
    padding: 44px 36px;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .scanning-title {
    margin: 18px 0 12px 0;
    font-size: 20px;
  }
  .progress-bar-track {
    width: 100%;
    height: 8px;
    background: var(--panel-2);
    border-radius: 9999px;
    overflow: hidden;
    margin: 10px 0 16px 0;
  }
  .progress-bar-fill {
    height: 100%;
    background: linear-gradient(90deg, #10b981, #059669);
    transition: width 0.25s ease;
  }
  .big-number {
    font-size: 32px;
    font-weight: 800;
    color: var(--accent);
    letter-spacing: -1px;
    margin: 2px 0;
  }

  .results-summary-card {
    max-width: 1120px;
    margin: 0 auto 18px auto;
    padding: 20px 24px;
  }
  .summary-row {
    flex-wrap: wrap;
    gap: 10px;
  }
  .summary-label {
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.7px;
    color: var(--accent);
  }
  .rescan-btn {
    padding: 8px 14px;
    border-radius: 9999px;
    font-size: 12.5px;
    font-weight: 600;
  }

  .conflict-banner {
    max-width: 1120px;
    margin: 0 auto 18px auto;
    padding: 14px 18px;
    border-left: 4px solid #f59e0b;
    background: rgba(245, 158, 11, 0.14);
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .item-title {
    font-size: 15px;
  }
  .category-bytes {
    font-size: 18px;
    font-weight: 800;
    color: var(--accent);
  }
  .cat-progress-bar {
    height: 6px;
    border-radius: 9999px;
    background: var(--panel-2);
    border: 1px solid var(--border);
    overflow: hidden;
  }
  .cat-progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #10b981, #059669);
    border-radius: 9999px;
    transition: width 0.25s ease;
  }
  .review-btn {
    padding: 4px 10px;
    font-size: 12px;
    border-radius: 9999px;
  }
  .files-preview {
    margin-top: 8px;
    padding-top: 10px;
    border-top: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .file-line {
    padding: 4px 8px;
    background: var(--panel-2);
    border-radius: 8px;
  }

  .action-dock {
    position: sticky;
    bottom: 12px;
    max-width: 1120px;
    margin: 0 auto;
    padding: 14px 24px;
    display: flex;
    align-items: center;
    gap: 14px;
    box-shadow: 0 12px 32px rgba(15, 23, 42, 0.14);
  }
  .clean-action-btn {
    padding: 11px 26px;
    border-radius: 9999px;
    font-size: 14.5px;
    font-weight: 800;
  }

  .success-icon-container {
    margin-bottom: 14px;
  }
  .check-circle {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background: rgba(16, 185, 129, 0.16);
    color: var(--accent);
    display: grid;
    place-items: center;
  }
  .check-icon {
    width: 32px;
    height: 32px;
  }
  .done-title {
    font-size: 28px;
    font-weight: 800;
    margin: 0;
  }
  .note {
    font-size: 13px;
    color: var(--muted);
    max-width: 420px;
  }
  .error-banner {
    max-width: 1120px;
    margin: 0 auto 16px auto;
    padding: 12px 16px;
    display: flex;
    align-items: center;
    gap: 10px;
    border-left: 4px solid var(--danger);
    background: rgba(239, 68, 68, 0.12);
    color: var(--danger);
    font-size: 13px;
  }
  /* ---------- v2 Home (inspired by Telamon / Advanced SystemCare / AVG) ---------- */
  .home-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 320px;
    gap: 22px;
    align-items: start;
  }
  @media (max-width: 1020px) {
    .home-grid {
      grid-template-columns: 1fr;
    }
  }
  .home-hero {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 12px;
  }
  .home-hero .hero-status-pill {
    align-self: center;
  }
  .home-title {
    font-size: 34px;
    line-height: 1.12;
    letter-spacing: -1px;
    font-weight: 800;
    margin: 4px 0 0 0;
  }
  .home-title-brand {
    background: linear-gradient(90deg, #10b981, #0d9488);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
  .home-sub {
    margin: 0;
    font-size: 14px;
    line-height: 1.5;
    max-width: 56ch;
  }

  /* Big glowing scan ring */
  button.scan-ring {
    position: relative;
    width: 220px;
    height: 220px;
    margin: 18px 0 4px 0;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: transparent;
    box-shadow: none;
    cursor: pointer;
  }
  button.scan-ring:hover:not(:disabled) {
    background: transparent;
    box-shadow: none;
    transform: scale(1.03);
  }
  button.scan-ring:disabled {
    opacity: 1;
    cursor: progress;
  }
  .scan-ring-glow {
    position: absolute;
    inset: -18px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(16, 185, 129, 0.38), transparent 65%);
    filter: blur(10px);
  }
  .scan-ring-ticks {
    position: absolute;
    inset: 4px;
    border-radius: 50%;
    border: 2px dashed rgba(16, 185, 129, 0.22);
  }
  .scan-ring-arc {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: conic-gradient(from 210deg, #34d399, #10b981, #0d9488, #047857, transparent 78%, transparent);
    -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 12px), #000 calc(100% - 11px));
    mask: radial-gradient(farthest-side, transparent calc(100% - 12px), #000 calc(100% - 11px));
  }
  button.scan-ring.busy .scan-ring-arc {
    animation: ring-spin 1.4s linear infinite;
  }
  @keyframes ring-spin {
    to {
      transform: rotate(360deg);
    }
  }
  .scan-ring-inner {
    position: absolute;
    inset: 22px;
    border-radius: 50%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: radial-gradient(circle at 35% 30%, #ffffff, #ecfdf5);
    border: 1px solid rgba(16, 185, 129, 0.3);
    box-shadow: inset 0 0 40px rgba(16, 185, 129, 0.18);
    color: var(--text);
  }
  :global(:root[data-theme="dark"]) .scan-ring-inner {
    background: radial-gradient(circle at 35% 30%, #1d2b45, #0d1526);
  }
  .scan-ring-word {
    font-size: 30px;
    font-weight: 800;
    letter-spacing: 2px;
  }
  .scan-ring-word.small-word {
    font-size: 20px;
  }
  .scan-ring-inner small {
    font-size: 11.5px;
    color: var(--muted);
    margin-top: 4px;
  }
  .last-scan {
    font-size: 12px;
    line-height: 1.5;
  }
  .last-scan strong {
    color: var(--text);
    font-size: 14px;
  }
  .home-hero .hero-breakdown {
    width: 100%;
    max-width: 520px;
  }
  .home-hero .hero-breakdown-legend {
    justify-content: center;
  }
  .home-hero .hero-actions-row {
    justify-content: center;
  }

  /* Smart vs Custom */
  .mode-row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 10px;
  }
  .mode-toggle {
    display: inline-flex;
    background: var(--panel-2);
    border: 1px solid var(--border);
    border-radius: 9999px;
    padding: 4px;
  }
  button.mode-opt {
    border: none;
    background: transparent;
    box-shadow: none;
    padding: 7px 16px;
    font-size: 12.5px;
    font-weight: 700;
    color: var(--muted);
  }
  button.mode-opt.on {
    background: #10b981;
    color: #ffffff;
  }
  button.mode-opt:hover:not(:disabled):not(.on) {
    transform: none;
    color: var(--text);
  }
  button.mode-help {
    width: 26px;
    height: 26px;
    padding: 0;
    border-radius: 50%;
    border: 1px solid var(--border);
    font-weight: 800;
    font-size: 12px;
  }
  .mode-tip {
    position: absolute;
    top: calc(100% + 8px);
    left: 50%;
    transform: translateX(-50%);
    width: 280px;
    z-index: 20;
    text-align: left;
    background: var(--panel-solid);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 12px 14px;
    font-size: 12px;
    line-height: 1.5;
    box-shadow: 0 14px 30px -10px rgba(15, 23, 42, 0.35);
  }
  .areas-card {
    width: 100%;
    padding: 16px 20px;
    text-align: left;
  }
  .areas-head {
    margin-bottom: 12px;
    flex-wrap: wrap;
  }
  .areas-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
    gap: 9px 16px;
    max-height: 220px;
    overflow-y: auto;
  }
  .area-chk {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12.5px;
    cursor: pointer;
  }
  .area-chk input {
    flex-shrink: 0;
  }
  .area-chk input:disabled {
    cursor: default;
  }
  .area-chk.off {
    opacity: 0.5;
  }

  /* Right column */
  .home-side {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .week-card {
    padding: 16px 18px;
  }
  .week-bars {
    display: flex;
    align-items: flex-end;
    gap: 9px;
    height: 104px;
    padding-top: 10px;
  }
  .week-bar {
    flex: 1;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    align-items: center;
    gap: 6px;
    font-size: 10px;
    color: var(--muted);
  }
  .week-bar i {
    display: block;
    width: 100%;
    border-radius: 6px 6px 3px 3px;
    background: rgba(148, 163, 184, 0.28);
    max-height: calc(100% - 18px);
  }
  .week-bar.today i {
    background: linear-gradient(180deg, #34d399, #047857);
    box-shadow: 0 0 16px rgba(16, 185, 129, 0.45);
  }
  .week-bar.today {
    color: var(--text);
    font-weight: 800;
  }
  .tile-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  button.tool-tile {
    padding: 14px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: flex-start;
    gap: 6px;
    text-align: left;
    white-space: normal;
    border-radius: 16px;
  }
  button.tool-tile strong {
    font-size: 13.5px;
  }
  button.tool-tile .muted {
    font-size: 11.5px;
    line-height: 1.4;
    font-weight: 500;
  }
  .tile-ic {
    width: 38px;
    height: 38px;
    border-radius: 11px;
    display: grid;
    place-items: center;
    background: rgba(16, 185, 129, 0.12);
    border: 1px solid rgba(16, 185, 129, 0.28);
    font-size: 17px;
  }
  .disk-mini {
    padding: 14px 18px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  /* First-run welcome */
  .welcome-first-run {
    min-height: calc(100vh - 140px);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    gap: 10px;
  }
  .welcome-logo {
    width: 64px;
    height: 64px;
    filter: drop-shadow(0 8px 18px rgba(16, 185, 129, 0.35));
  }
  .welcome-first-title {
    margin: 8px 0 0 0;
    font-size: 30px;
    font-weight: 700;
    letter-spacing: -0.5px;
  }
  .welcome-first-sub {
    font-size: 15px;
  }
  .welcome-gauge {
    width: 110px;
    height: 110px;
    margin: 16px 0 6px 0;
    border-radius: 50%;
    background: conic-gradient(from 225deg, #10b981 0 62%, rgba(148, 163, 184, 0.25) 62% 75%, transparent 75%);
    -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 10px), #000 calc(100% - 9px));
    mask: radial-gradient(farthest-side, transparent calc(100% - 10px), #000 calc(100% - 9px));
  }
  .welcome-first-copy {
    margin: 0;
    max-width: 340px;
    font-size: 13.5px;
    line-height: 1.55;
  }
  button.welcome-scan-btn {
    margin-top: 14px;
    padding: 14px 46px;
    font-size: 15px;
    font-weight: 800;
    letter-spacing: 0.5px;
  }
  button.welcome-skip {
    color: var(--accent);
    font-size: 12.5px;
  }

  /* Results review list */
  .review-list {
    max-width: 1120px;
    margin: 0 auto;
    padding: 0;
    overflow: hidden;
  }
  .review-list-head {
    display: flex;
    align-items: center;
    padding: 12px 18px;
    border-bottom: 1px solid var(--border);
  }
  .review-heading {
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.08em;
    color: var(--muted);
  }
  .review-row {
    padding: 12px 18px;
    border-bottom: 1px solid var(--border);
  }
  .review-row:last-child {
    border-bottom: none;
  }
  .review-row-main {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .review-row-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .review-row-text .muted {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .review-row .cat-progress-bar {
    margin-top: 4px;
    max-width: 420px;
  }
  button.chevron-btn {
    width: 30px;
    height: 30px;
    padding: 0;
    border-radius: 50%;
  }
  .review-empty {
    padding: 12px 18px;
    text-align: center;
  }
  .dock-label {
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.08em;
    color: var(--accent);
  }
  .action-dock {
    margin-top: 16px;
  }
</style>
