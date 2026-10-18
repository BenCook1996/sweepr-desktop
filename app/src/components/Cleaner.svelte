<script lang="ts" module>
  import type { ScanReport } from "../lib/api";
  let cachedReport: ScanReport | null = null;
  let cachedSelected: Record<string, boolean> = {};
</script>

<script lang="ts">
  import { onMount } from "svelte";
  import { api, errorMessage, isPaymentRequired, requestActivation, type CategoryResult, type CleanReport, type LicenseStatus, type QuarantineEntry, type RecycleBinInfo, type RunningAppConflict, type ScanProgress, type SystemOverview } from "../lib/api";
  import { formatBytes, formatCount, shortenPath } from "../lib/format";
  import Paywall from "./Paywall.svelte";
  import { addLifetimeStats, getLifetimeStats } from "../lib/store";

  let { license, onLicenseChange }: { license: LicenseStatus | null; onLicenseChange: (force?: boolean) => Promise<void> } = $props();

  type Phase = "idle" | "scanning" | "results" | "cleaning" | "done";
  let phase = $state<Phase>("idle");
  let initialScanning = $state(false);
  let progress = $state<ScanProgress | null>(null);
  let report = $state<ScanReport | null>(cachedReport);
  let selected = $state<Record<string, boolean>>(cachedSelected);
  let expanded = $state<string | null>(null);
  let showPaywall = $state(false);
  let error = $state<string | null>(null);
  let results = $state<CleanReport[]>([]);
  let exclusions = $state<string[]>([]);
  let showExclusions = $state(false);
  let newExclusionPath = $state("");
  let quarantine = $state<QuarantineEntry[]>([]);
  let recycleBin = $state<RecycleBinInfo | null>(null);
  let emptyingRecycleBin = $state(false);
  let showQuarantine = $state(false);
  let restoreNotice = $state<string | null>(null);
  let runningConflicts = $state<RunningAppConflict[]>([]);
  let sysOverview = $state<SystemOverview | null>(null);
  let startupCount = $state<number | null>(null);
  let lifetimeStats = $state(getLifetimeStats());

  const SYSTEM_JUNK_IDS = ["thumbnails", "crash_dumps", "delivery_opt", "shader_cache", "logs", "trash"];

  const nonEmpty = $derived(report?.categories.filter((c) => c.bytes > 0) ?? []);
  const empty = $derived(report?.categories.filter((c) => c.bytes === 0) ?? []);
  const selectedCats = $derived(nonEmpty.filter((c) => selected[c.id]));
  const selectedBytes = $derived(selectedCats.reduce((s, c) => s + c.bytes, 0));
  const freed = $derived(results.reduce((s, r) => s + r.bytes_freed, 0));
  const skipped = $derived(results.reduce((s, r) => s + r.files_skipped, 0));
  const removed = $derived(results.reduce((s, r) => s + r.files_removed, 0));

  const systemJunkBytes = $derived(
    report?.categories
      .filter((c) => SYSTEM_JUNK_IDS.includes(c.id))
      .reduce((s, c) => s + c.bytes, 0) ?? 0
  );
  const tempFilesBytes = $derived(
    report?.categories
      .filter((c) => c.id === "temp")
      .reduce((s, c) => s + c.bytes, 0) ?? 0
  );
  const proCachesBytes = $derived(
    report?.categories
      .filter((c) => c.id !== "temp" && !SYSTEM_JUNK_IDS.includes(c.id))
      .reduce((s, c) => s + c.bytes, 0) ?? 0
  );
  const duplicateCat = $derived(
    report?.categories.find((c) => c.id === "duplicates") ?? null
  );

  const diskUsedBytes = $derived(
    sysOverview ? Math.max(0, sysOverview.disk_total_bytes - sysOverview.disk_available_bytes) : 0
  );
  const diskUsedPct = $derived(
    sysOverview && sysOverview.disk_total_bytes > 0
      ? Math.round((diskUsedBytes / sysOverview.disk_total_bytes) * 100)
      : 0
  );
  const reclaimablePct = $derived(
    sysOverview && sysOverview.disk_total_bytes > 0 && report
      ? Math.min(diskUsedPct, Math.max(1, Math.round((report.total_bytes / sysOverview.disk_total_bytes) * 100)))
      : 0
  );
  const diskFreePct = $derived(sysOverview ? Math.max(0, 100 - diskUsedPct) : 0);
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
      const sel = Object.fromEntries(r.categories.map((c) => [c.id, c.bytes > 0]));
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
    api.startupItems().then((items) => (startupCount = items.length)).catch(() => {});
    if (!cachedReport) {
      runDashboardScan();
    }
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
    error = null;
    restoreNotice = null;
    emptyingRecycleBin = true;
    try {
      const freedBytes = await api.emptyRecycleBin();
      addLifetimeStats(freedBytes, recycleBin?.items ?? 0);
      lifetimeStats = getLifetimeStats();
      recycleBin = { bytes: 0, items: 0 };
      restoreNotice = `Emptied Windows Recycle Bin (${formatBytes(freedBytes)} permanently freed).`;
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
      restoreNotice = `Restored ${item.file_name} to ${restoredPath}`;
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

  async function addCustomExclusion() {
    if (!newExclusionPath.trim()) return;
    if (!license?.active) {
      requestActivation();
      return;
    }
    try {
      exclusions = await api.addExclusion(newExclusionPath.trim());
      newExclusionPath = "";
      if (phase === "results") await scan();
      else await runDashboardScan();
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
      const sel = Object.fromEntries(r.categories.map((c) => [c.id, c.bytes > 0]));
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

  function reviewDuplicates() {
    if (report) {
      expanded = "duplicates";
      phase = "results";
    } else {
      scan();
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
    showPaywall = false;
    phase = "cleaning";
    try {
      results = await api.clean(cats.map((c) => c.id), false);
      
      const totalFreed = results.reduce((s, r) => s + r.bytes_freed, 0);
      const totalRemoved = results.reduce((s, r) => s + r.files_removed, 0);
      addLifetimeStats(totalFreed, totalRemoved);
      lifetimeStats = getLifetimeStats();
      api.listQuarantine().then((q) => (quarantine = q)).catch(() => {});

      phase = "done";
    } catch (e: any) {
      phase = "results";
      if (isPaymentRequired(e)) requestActivation();
      else error = errorMessage(e);
    }
  }

  async function onActivated() {
    await onLicenseChange(true);
    runClean(selectedCats);
  }
</script>

{#if error}
  <div class="card error-banner">
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
    <span>{error}</span>
  </div>
{/if}

{#if showQuarantine}
  <div class="card" style="padding: 18px 22px; margin-bottom: 18px;">
    <div class="row" style="margin-bottom: 12px;">
      <strong>Quarantine & Recycle Bin Vault</strong>
      <div class="spacer"></div>
      <span class="muted small">Items retained for 7 days in Quarantine for one-click recovery</span>
      <button class="ghost" style="padding: 4px 10px; font-size: 12px;" onclick={() => (showQuarantine = false)}>Close</button>
    </div>

    <!-- Windows Recycle Bin Summary Bar -->
    <div class="row" style="background: var(--panel-2); padding: 10px 14px; border-radius: 10px; border: 1px solid var(--border); margin-bottom: 12px; gap: 12px;">
      <span class="badge free">Windows Recycle Bin</span>
      <div style="flex: 1;">
        <strong class="small">
          {recycleBin ? `${formatBytes(recycleBin.bytes)} (${formatCount(recycleBin.items)} items)` : "Checking Recycle Bin…"}
        </strong>
        <div class="muted small">System-wide deleted files across local drives</div>
      </div>
      <button
        class="primary"
        style="padding: 5px 14px; font-size: 12px;"
        disabled={emptyingRecycleBin || !recycleBin || (recycleBin.bytes === 0 && recycleBin.items === 0)}
        onclick={emptyWindowsRecycleBin}
      >
        {emptyingRecycleBin ? "Emptying…" : "Empty Recycle Bin"}
      </button>
    </div>

    {#if restoreNotice}
      <div class="small" style="color: var(--accent); margin-bottom: 8px;">{restoreNotice}</div>
    {/if}
    <div class="muted small" style="margin-bottom: 6px; font-weight: 600;">SWEEPR 7-Day Quarantine ({quarantine.length})</div>
    {#if quarantine.length === 0}
      <div class="muted small">Quarantine vault is empty.</div>
    {:else}
      <div style="display: flex; flex-direction: column; gap: 6px; max-height: 200px; overflow-y: auto;">
        {#each quarantine as q}
          <div class="row" style="background: var(--panel-2); padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border);">
            <span class="badge free">{q.category_id}</span>
            <div style="flex: 1; min-width: 0;">
              <strong class="small">{q.file_name}</strong>
              <div class="mono muted small" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title={q.original_path}>{shortenPath(q.original_path, 70)}</div>
            </div>
            <span class="mono small">{formatBytes(q.size)}</span>
            <button class="primary" style="padding: 4px 12px; font-size: 11.5px;" onclick={() => restoreQuarantined(q)}>Restore</button>
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}

{#if phase === "idle"}
  <!-- Concept 5: Pixel-Perfect Technical Topography Bento Dashboard -->
  <div class="dashboard-container">
    <div class="welcome-bar">
      <div class="welcome-text">
        <h1 class="welcome-title">Welcome back!</h1>
        <div class="welcome-status">
          {#if initialScanning}
            <span class="status-badge">Scanning PC: <strong>{progress ? `${progress.done}/${progress.total}` : "Starting…"}</strong></span>
            <span class="dot-separator">•</span>
            <span class="muted small">{progress ? `Checking ${progress.category_name} (${formatBytes(progress.bytes_so_far)} found)` : "Analyzing storage & caches…"}</span>
          {:else if report}
            <span class="status-badge">PC Status: <strong>{report.total_bytes > 500 * 1024 * 1024 ? "Action Recommended" : "Good"}</strong></span>
            <span class="dot-separator">•</span>
            <span class="muted small">{formatBytes(report.total_bytes)} reclaimable across {formatCount(report.total_files)} files</span>
          {:else}
            <span class="status-badge">PC Status: <strong>Good</strong></span>
            <span class="dot-separator">•</span>
            <span class="muted small">Diagnostics & storage analysis ready</span>
          {/if}
        </div>
      </div>
      <button class="ghost" onclick={toggleQuarantineDrawer}>
        Quarantine / Undo ({quarantine.length})
      </button>
    </div>

    <!-- Main Dashboard Grid: 6 Cards in 3 perfectly aligned columns -->
    <div class="dashboard-grid">
      <!-- 1. Left Card: Cleanup Recommendations -->
      <div class="card bento-card recs-card">
        <div class="row" style="justify-content: space-between; align-items: center;">
          <div class="card-header-label">CLEANUP RECOMMENDATIONS</div>
          {#if report}
            <button class="ghost" style="padding: 2px 8px; font-size: 11px;" onclick={() => (phase = "results")}>Review →</button>
          {/if}
        </div>
        
        <div class="rec-items">
          <div class="rec-item">
            <div class="icon-bubble emerald">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </div>
            <div class="rec-details">
              <div class="rec-name">System Junk Files</div>
              <div class="muted small">Temp logs, crash dumps</div>
            </div>
            <div class="rec-stat">
              <div class="rec-size">{report ? formatBytes(systemJunkBytes) : initialScanning ? "…" : "0 B"}</div>
              {#if !license?.active}<span class="badge pro">Pro</span>{/if}
            </div>
          </div>

          <div class="rec-item">
            <div class="icon-bubble amber">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            </div>
            <div class="rec-details">
              <div class="rec-name">Temporary Files</div>
              <div class="muted small">24h+ app temporary files</div>
            </div>
            <div class="rec-stat">
              <div class="rec-size">{report ? formatBytes(tempFilesBytes) : initialScanning ? "…" : "0 B"}</div>
              {#if !license?.active}<span class="badge pro">Pro</span>{/if}
            </div>
          </div>

          <div class="rec-item">
            <div class="icon-bubble blue">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
            </div>
            <div class="rec-details">
              <div class="rec-name">Browsers, Caches & Duplicates</div>
              <div class="muted small">Browser caches, dev caches & duplicate files</div>
            </div>
            <div class="rec-stat">
              <div class="rec-size">{report ? formatBytes(proCachesBytes) : initialScanning ? "…" : "0 B"}</div>
              {#if !license?.active}<span class="badge pro">Pro</span>{/if}
            </div>
          </div>
        </div>

        {#if initialScanning}
          <button class="primary clean-cta-btn" disabled>
            SCANNING{progress ? ` (${formatBytes(progress.bytes_so_far)})` : "…"}
          </button>
        {:else if report && report.total_bytes > 0}
          <button class="primary clean-cta-btn" onclick={requestClean}>
            CLEAN {formatBytes(report.total_bytes)}
          </button>
        {:else}
          <button class="primary clean-cta-btn" onclick={scan}>
            SCAN FOR JUNK
          </button>
        {/if}
      </div>

      <!-- 2. Centerpiece Card: System Status Overview (Hero) -->
      <div class="card bento-card hero-status-card">
        <div class="card-header-label">SYSTEM DRIVE <span class="highlight">{sysOverview?.disk_mount || "Overview"}</span></div>
        
        <div class="gauge-container">
          <svg viewBox="0 0 200 120" class="gauge-svg">
            <path d="M 24 105 A 76 76 0 0 1 176 105" fill="none" stroke="#e2e8f0" stroke-width="14" stroke-linecap="round" />
            <path d="M 24 105 A 76 76 0 0 1 176 105" fill="none" stroke="url(#topography-gradient)" stroke-width="14" stroke-linecap="round" stroke-dasharray="238.76" stroke-dashoffset={sysOverview ? Math.round(238.76 * (1 - diskFreePct / 100)) : 60} />
            <defs>
              <linearGradient id="topography-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stop-color="#10b981" />
                <stop offset="100%" stop-color="#059669" />
              </linearGradient>
            </defs>
          </svg>
          <div class="gauge-center">
            <span class="gauge-number">{sysOverview ? `${diskFreePct}%` : "—"}</span>
            <span class="gauge-subtitle">Free Disk Space</span>
            <span class="gauge-badge">{sysOverview ? `${formatBytes(sysOverview.disk_available_bytes)} available` : "Ready to scan"}</span>
          </div>
        </div>

        <button class="primary scan-pill-btn" onclick={scan}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <span>QUICK SCAN NOW</span>
        </button>

        <div class="scan-footnote muted small">
          {#if report}
            {formatBytes(report.total_bytes)} reclaimable · scanned in {(report.duration_ms / 1000).toFixed(1)}s
          {:else}
            Fast, read-only scan · Safe & private
          {/if}
        </div>
      </div>

      <!-- 3. Right Card: Storage & Performance Overview -->
      <div class="card bento-card storage-perf-card">
        <!-- Storage Section -->
        <div class="subcard-section">
          <div class="row section-title-row">
            <div class="card-header-label">STORAGE</div>
            <div class="small-muted-label">
              {sysOverview ? `${sysOverview.disk_mount} · Total ${formatBytes(sysOverview.disk_total_bytes)}` : "Loading drive…"}
            </div>
          </div>
          
          <div class="storage-headline">
            <span class="storage-used-label">Used: <strong>{sysOverview ? formatBytes(diskUsedBytes) : "—"}</strong></span>
            <span class="storage-free-label muted small">{sysOverview ? `${formatBytes(sysOverview.disk_available_bytes)} Free` : ""}</span>
          </div>

          <div class="segmented-bar">
            <div class="bar-segment apps" style="width: {Math.max(0, diskUsedPct - reclaimablePct)}%;"></div>
            <div class="bar-segment files" style="width: {reclaimablePct}%;"></div>
            <div class="bar-segment system" style="width: {diskFreePct}%;"></div>
          </div>

          <div class="legend-row">
            <span class="legend-chip"><span class="chip-dot emerald"></span> Used ({diskUsedPct}%)</span>
            <span class="legend-chip"><span class="chip-dot amber"></span> Junk ({report ? formatBytes(report.total_bytes) : "…"})</span>
            <span class="legend-chip"><span class="chip-dot slate"></span> Free ({diskFreePct}%)</span>
          </div>
        </div>

        <div class="divider"></div>

        <!-- RAM & Performance Section -->
        <div class="subcard-section">
          <div class="row section-title-row">
            <div class="card-header-label">RAM & PERFORMANCE</div>
          </div>

          <div class="perf-metric-row">
            <div class="perf-col">
              <span class="muted small">Memory:</span>
              <strong class="perf-val">{sysOverview ? `${memUsedPct}% Used` : "—"}</strong>
            </div>
            <div class="perf-col">
              <span class="muted small">CPU:</span>
              <strong class="perf-val">{sysOverview ? `${Math.round(sysOverview.cpu_usage_percent)}%` : "—"}</strong>
            </div>
            <button class="ghost action-pill-btn" onclick={() => (report ? (phase = "results") : scan())}>
              {report ? "DETAILS" : "SCAN"}
            </button>
          </div>
        </div>
      </div>

      <!-- Row 2: 3 Compact Status Tiles -->
      <div class="card status-tile">
        <div class="tile-icon-box blue">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 7v14H3V7h5zm13 0v14h-5V7h5zM15 3v18H9V3h6z"/></svg>
        </div>
        <div class="tile-content">
          <div class="tile-label">DUPLICATE FILES</div>
          <div class="tile-value">
            {report ? formatBytes(duplicateCat?.bytes ?? 0) : initialScanning ? "Scanning…" : "0 B"}
            <span class="tile-sub">{report ? `(${formatCount(duplicateCat?.files ?? 0)} files)` : ""}</span>
          </div>
        </div>
        <button class="ghost tile-action-btn" onclick={reviewDuplicates}>REVIEW</button>
      </div>

      <div class="card status-tile">
        <div class="tile-icon-box emerald">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
        </div>
        <div class="tile-content">
          <div class="tile-label">STARTUP APPS</div>
          <div class="tile-value">{startupCount !== null ? startupCount : "—"} <span class="tile-sub">Registered at login</span></div>
        </div>
        <span class="badge free">DETECTED</span>
      </div>

      <div class="card status-tile">
        <div class="tile-icon-box green">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        <div class="tile-content">
          <div class="tile-label">LIFETIME CLEANED</div>
          <div class="tile-value">{formatBytes(lifetimeStats.bytesFreed)} <span class="tile-sub">({formatCount(lifetimeStats.filesRemoved)} files)</span></div>
        </div>
        <span class="badge free">TOTAL</span>
      </div>
    </div>
  </div>

{:else if phase === "scanning"}
  <section class="card scanning-modal">
    <div class="spinner" aria-hidden="true"></div>
    <h2 class="scanning-title">Scanning{progress ? `: ${progress.category_name}` : "…"}</h2>
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
        <div class="summary-label">SAFE TO CLEAN</div>
        <div class="big-number">{formatBytes(report.total_bytes)}</div>
        <div class="muted small" style="margin-top: 2px;">{formatCount(report.total_files)} files across {nonEmpty.length} areas · scanned in {(report.duration_ms / 1000).toFixed(1)}s</div>
      </div>
      <div class="spacer"></div>
      <button class="ghost rescan-btn" onclick={() => (phase = "idle")}>
        <span>← Overview</span>
      </button>
      <button class="ghost rescan-btn" onclick={toggleQuarantineDrawer}>
        <span>Quarantine / Undo ({quarantine.length})</span>
      </button>
      <button class="ghost rescan-btn" onclick={() => (showExclusions = !showExclusions)}>
        <span>Exclusions ({exclusions.length})</span>
      </button>
      <button class="ghost rescan-btn" onclick={scan}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
        <span>Rescan Drive</span>
      </button>
    </div>
  </header>

  {#if showExclusions}
    <div class="card" style="padding: 18px 22px; margin-bottom: 18px;">
      <div class="row" style="margin-bottom: 10px;">
        <strong>Excluded Paths & Folders (Allowlist)</strong>
        <div class="spacer"></div>
        <span class="muted small">SWEEPR Cleaner will never scan or delete anything inside these paths</span>
      </div>
      <div class="row" style="gap: 10px; margin-bottom: 12px;">
        <input
          type="text"
          bind:value={newExclusionPath}
          placeholder="Add full folder or file path to exclude (e.g. C:\Users\me\Downloads\Keep)"
          style="flex: 1; padding: 8px 14px; border-radius: 9999px; border: 1px solid var(--border); font-size: 13px;"
        />
        <button class="primary" style="padding: 8px 16px; font-size: 12.5px;" onclick={addCustomExclusion}>Add Exclusion</button>
      </div>
      {#if exclusions.length === 0}
        <div class="muted small">No excluded paths configured yet. You can also click "Ignore" next to any file below.</div>
      {:else}
        <div style="display: flex; flex-direction: column; gap: 6px; max-height: 150px; overflow-y: auto;">
          {#each exclusions as ex}
            <div class="row" style="background: #f8fafc; padding: 6px 12px; border-radius: 8px; border: 1px solid var(--border);">
              <span class="mono small grow" title={ex}>{ex}</span>
              <button class="ghost" style="padding: 3px 10px; font-size: 11.5px;" onclick={() => removeExcludedPath(ex)}>Remove</button>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  {#if runningConflicts.length > 0}
    <div class="card" style="padding: 14px 18px; margin-bottom: 18px; border-left: 4px solid #f59e0b; background: #fffbeb; display: flex; align-items: center; gap: 12px;">
      <div style="flex: 1;">
        <strong style="color: #92400e; font-size: 13.5px;">Apps currently running: {runningConflicts.map((c) => c.app_name).join(", ")}</strong>
        <div style="color: #b45309; font-size: 12.5px; margin-top: 2px;">
          Close these apps before cleaning so Windows releases locks on their cache files and SWEEPR Cleaner can reclaim 100% of their space.
        </div>
      </div>
      <button class="ghost" style="font-size: 12px; padding: 6px 12px;" onclick={refreshConflicts}>Recheck</button>
    </div>
  {/if}

  <!-- Results Bento Grid -->
  <div class="results-grid">
    {#each nonEmpty as c (c.id)}
      <div class="card result-item" class:expanded={expanded === c.id}>
        <div class="row result-item-head">
          <input type="checkbox" bind:checked={selected[c.id]} aria-label="Select {c.name}" />
          <strong class="item-title">{c.name}</strong>
          <div class="spacer"></div>
          {#if !license?.active}
            <span class="badge pro">Pro</span>
          {/if}
        </div>
        <div class="item-body">
          <div class="muted small item-desc">{c.description}</div>
          <div class="item-stats-box">
            <div class="category-bytes">{formatBytes(c.bytes)}</div>
            <div class="muted small">{formatCount(c.files)} files</div>
          </div>
        </div>
        <div class="row item-footer">
          <div class="spacer"></div>
          <button class="ghost review-btn" onclick={() => (expanded = expanded === c.id ? null : c.id)}>
            {expanded === c.id ? "Hide details" : "Review files →"}
          </button>
        </div>
        {#if expanded === c.id}
          <div class="files-preview">
            <div class="muted small">Locations: {c.roots.join(" · ")}</div>
            <div class="muted small" style="margin:8px 0 4px 0">Largest files:</div>
            {#each c.top_files as f}
              <div class="row file-line" style="gap: 8px;">
                <span class="mono grow" title={f.path}>{shortenPath(f.path, 70)}</span>
                <span class="mono">{formatBytes(f.size)}</span>
                <button class="ghost" style="padding: 2px 8px; font-size: 11px;" title="Add file to exclusion allowlist" onclick={() => excludePath(f.path)}>Ignore</button>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/each}
    {#if empty.length}
      <div class="card empty-notice">
        <span class="muted small">Already clean: {empty.map((c) => c.name).join(", ")}</span>
      </div>
    {/if}
  </div>

  <!-- Floating Action Dock -->
  <footer class="card action-dock">
    <span class="selected-count-label">{formatBytes(selectedBytes)} selected</span>
    <div class="spacer"></div>
    <button class="primary clean-action-btn" disabled={!selectedCats.length} onclick={requestClean}>
      Clean {formatBytes(selectedBytes)}
    </button>
  </footer>

{:else if phase === "cleaning"}
  <section class="card cleaning-card">
    <div class="spinner" aria-hidden="true"></div>
    <h2 style="margin-top: 18px; font-size: 22px;">Cleaning…</h2>
    <p class="muted">Files currently open or in use are skipped automatically for safety.</p>
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
    <p class="muted" style="margin: 8px 0 18px 0;">Your PC is optimized. {formatCount(removed)} files removed{skipped ? `, ${formatCount(skipped)} skipped (in use)` : ""}.</p>
    {#if results.some((r) => r.moved_to_trash)}
      <p class="note" style="margin-bottom: 20px;">Files are safely in your {navigator.userAgent.includes("Windows") ? "Recycle Bin" : "Trash"}. Empty it whenever you want to reclaim space permanently.</p>
    {/if}
    <button class="primary big" onclick={backToDashboard}>Back to Dashboard</button>
  </section>
{/if}

<Paywall
  open={showPaywall}
  bytes={selectedBytes}
  onClose={() => (showPaywall = false)}
  onActivated={onActivated}
/>

<style>
  /* Dashboard Container */
  .dashboard-container {
    max-width: 1240px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  .welcome-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 4px;
  }
  .welcome-title {
    font-size: 24px;
    font-weight: 800;
    margin: 0;
    letter-spacing: -0.5px;
    color: var(--text);
  }
  .welcome-status {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 4px;
  }
  .status-badge {
    font-size: 13.5px;
    color: var(--text-secondary);
  }
  .status-badge strong {
    color: var(--accent);
  }
  .dot-separator {
    color: #cbd5e1;
    font-size: 12px;
  }

  /* Unified Dashboard Bento Grid: 3 Exactly Identical Columns across both rows */
  .dashboard-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 24px;
    align-items: stretch;
  }
  .bento-card {
    padding: 26px 28px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }
  .card-header-label {
    font-size: 11.5px;
    font-weight: 800;
    letter-spacing: 0.8px;
    color: var(--muted);
    text-transform: uppercase;
  }
  .card-header-label .highlight {
    color: var(--accent);
    font-weight: 700;
    text-transform: none;
    margin-left: 4px;
  }

  /* 1. Recommendations Card */
  .rec-items {
    display: flex;
    flex-direction: column;
    gap: 14px;
    margin: 18px 0;
  }
  .rec-item {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .icon-bubble {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    display: grid;
    place-items: center;
    flex-shrink: 0;
  }
  .icon-bubble.emerald { background: rgba(16, 185, 129, 0.12); color: #059669; }
  .icon-bubble.amber { background: rgba(245, 158, 11, 0.12); color: #d97706; }
  .icon-bubble.blue { background: rgba(59, 130, 246, 0.12); color: #2563eb; }
  .rec-details {
    flex: 1;
    min-width: 0;
  }
  .rec-name {
    font-weight: 600;
    font-size: clamp(11.5px, 1.15vw, 13.5px);
    line-height: 1.25;
  }
  .rec-stat {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
  }
  .rec-size {
    font-size: 13.5px;
    font-weight: 700;
    color: var(--text);
    white-space: nowrap;
  }
  .clean-cta-btn {
    width: 100%;
    padding: 11px;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.5px;
    border-radius: 9999px;
  }

  /* 2. Hero Centerpiece Status Card */
  .hero-status-card {
    align-items: center;
    text-align: center;
    padding: 24px 24px;
  }
  .gauge-container {
    position: relative;
    width: 200px;
    height: 125px;
    margin: 10px 0 16px 0;
  }
  .gauge-svg {
    width: 100%;
    height: 100%;
  }
  .gauge-center {
    position: absolute;
    bottom: 8px;
    left: 0;
    right: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }
  .gauge-number {
    font-size: 38px;
    font-weight: 800;
    color: var(--accent);
    line-height: 1;
    letter-spacing: -1px;
  }
  .gauge-subtitle {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--text);
    margin-top: 4px;
  }
  .gauge-badge {
    font-size: 11px;
    color: var(--muted);
    font-weight: 500;
  }
  .scan-pill-btn {
    padding: 12px 34px;
    font-size: 14px;
    font-weight: 700;
    border-radius: 9999px;
    white-space: nowrap;
    letter-spacing: 0.5px;
    box-shadow: 0 4px 16px rgba(16, 185, 129, 0.35);
  }
  .scan-footnote {
    margin-top: 10px;
  }

  /* 3. Storage & Performance Card */
  .subcard-section {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .section-title-row {
    justify-content: space-between;
    align-items: center;
  }
  .small-muted-label {
    font-size: 11.5px;
    color: var(--muted);
  }
  .storage-headline {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  .storage-used-label {
    font-size: 15px;
    color: var(--text);
  }
  .storage-used-label strong {
    font-size: 18px;
    color: var(--accent);
  }
  .segmented-bar {
    height: 10px;
    border-radius: 9999px;
    background: #e2e8f0;
    display: flex;
    overflow: hidden;
  }
  .bar-segment.apps { background: #059669; }
  .bar-segment.files { background: #f59e0b; }
  .bar-segment.system { background: #cbd5e1; }
  .legend-row {
    display: flex;
    align-items: center;
    gap: 14px;
    font-size: 11.5px;
    color: var(--muted);
  }
  .legend-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
  }
  .chip-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
  }
  .chip-dot.emerald { background: #059669; }
  .chip-dot.amber { background: #f59e0b; }
  .chip-dot.slate { background: #cbd5e1; }
  .divider {
    height: 1px;
    background: var(--border);
    margin: 14px 0;
  }
  .perf-metric-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .perf-col {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .perf-val {
    font-size: 14px;
    color: var(--text);
  }
  .action-pill-btn {
    font-size: 11px;
    padding: 5px 14px;
    font-weight: 700;
    letter-spacing: 0.5px;
  }

  /* Bottom Row Tiles with dynamic text sizing (no truncation) */
  .status-tile {
    container-type: inline-size;
    padding: 16px 18px;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .tile-icon-box {
    width: 38px;
    height: 38px;
    border-radius: 11px;
    display: grid;
    place-items: center;
    flex-shrink: 0;
  }
  .tile-icon-box.blue { background: rgba(59, 130, 246, 0.1); color: #2563eb; }
  .tile-icon-box.emerald { background: rgba(16, 185, 129, 0.1); color: #059669; }
  .tile-icon-box.green { background: rgba(16, 185, 129, 0.1); color: #10b981; }
  .tile-content {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .tile-label {
    font-size: clamp(9.5px, 3.3cqw, 11px);
    font-weight: 800;
    letter-spacing: 0.5px;
    color: var(--muted);
    line-height: 1.2;
  }
  .tile-value {
    font-size: clamp(12px, 4.3cqw, 15px);
    font-weight: 800;
    color: var(--text);
    line-height: 1.25;
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    column-gap: 5px;
    row-gap: 1px;
  }
  .tile-sub {
    font-size: clamp(10.5px, 3.5cqw, 12px);
    font-weight: 500;
    color: var(--muted);
  }
  .tile-action-btn {
    font-size: clamp(10px, 3.3cqw, 11.5px);
    font-weight: 700;
    padding: 5px 12px;
    letter-spacing: 0.4px;
    flex-shrink: 0;
  }

  /* Results Phase Styles */
  .results-summary-card {
    padding: 22px 28px;
    margin-bottom: 22px;
  }
  .summary-row {
    align-items: center;
  }
  .summary-label {
    font-size: 11.5px;
    font-weight: 800;
    letter-spacing: 0.8px;
    color: var(--muted);
  }
  .rescan-btn {
    font-size: 13px;
    padding: 8px 18px;
  }
  .results-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(310px, 1fr));
    gap: 18px;
    padding-bottom: 90px;
  }
  .result-item {
    padding: 20px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }
  .result-item.expanded { grid-column: 1 / -1; }
  .result-item-head {
    align-items: center;
    gap: 10px;
  }
  .item-title {
    font-size: 15px;
  }
  .item-desc {
    margin-top: 8px;
    min-height: 36px;
  }
  .item-stats-box {
    margin-top: 14px;
  }
  .category-bytes {
    font-size: 26px;
    font-weight: 800;
    color: var(--accent);
    letter-spacing: -0.5px;
  }
  .item-footer {
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px solid var(--border);
  }
  .review-btn {
    font-size: 12px;
    padding: 4px 12px;
  }
  .files-preview {
    margin-top: 14px;
    padding-top: 14px;
    border-top: 1px solid var(--border);
    max-height: 260px;
    overflow-y: auto;
  }
  .file-line {
    padding: 4px 0;
    gap: 16px;
    font-size: 12px;
  }
  .empty-notice {
    grid-column: 1 / -1;
    padding: 14px 20px;
  }

  /* Floating Dock */
  .action-dock {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    width: min(880px, calc(100vw - 64px));
    padding: 12px 24px;
    border-radius: 9999px;
    background: rgba(255, 255, 255, 0.94);
    box-shadow: 0 10px 35px rgba(15, 23, 42, 0.1);
    z-index: 100;
  }
  .selected-count-label {
    font-weight: 600;
    color: var(--text-secondary);
    margin-right: 12px;
  }
  .clean-action-btn {
    padding: 10px 26px;
    font-size: 14px;
  }

  /* Modals / Centers */
  .scanning-modal, .cleaning-card, .done-card {
    max-width: 520px;
    margin: 60px auto;
    padding: 40px;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }
  .scanning-title { font-size: 20px; margin: 18px 0 12px 0; }
  .progress-bar-track {
    width: 320px;
    height: 8px;
    background: #e2e8f0;
    border-radius: 9999px;
    overflow: hidden;
    margin-bottom: 14px;
  }
  .progress-bar-fill {
    height: 100%;
    background: linear-gradient(90deg, #10b981, #059669);
    transition: width 0.3s;
  }
  .big-number {
    font-size: 44px;
    font-weight: 800;
    color: var(--accent);
    letter-spacing: -1.5px;
    margin: 0;
  }
  .spinner {
    width: 44px;
    height: 44px;
    border: 3.5px solid #e2e8f0;
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .done-title {
    font-size: 32px;
    font-weight: 800;
    letter-spacing: -0.8px;
    margin: 0;
  }
  .success-icon-container {
    margin-bottom: 20px;
  }
  .check-circle {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background: linear-gradient(135deg, #059669, #10b981);
    display: grid;
    place-items: center;
    box-shadow: 0 6px 20px rgba(16, 185, 129, 0.35);
  }
  .check-icon {
    width: 32px;
    height: 32px;
    color: #ffffff;
  }
  .error-banner {
    padding: 12px 18px;
    margin-bottom: 20px;
    border-left: 4px solid var(--danger);
    background: #fff5f5;
    color: var(--danger);
    display: flex;
    align-items: center;
    gap: 10px;
  }
</style>
