<script lang="ts" module>
  import type { AppRemnant, ScanReport, StartupItem } from "../lib/api";
  let cachedReport: ScanReport | null = null;
  let cachedSelected: Record<string, boolean> = {};
  let cachedRemnants: AppRemnant[] = [];
  let cachedStartups: StartupItem[] = [];
  let cachedIncludeRemnants = true;
</script>

<script lang="ts">
  import { onMount } from "svelte";
  import {
    api,
    errorMessage,
    isPaymentRequired,
    OPEN_UNDO_EVENT,
    requestActivation,
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

  let {
    license,
    info = null,
    onLicenseChange,
    onOpenTool,
  }: {
    license: LicenseStatus | null;
    info?: AppInfo | null;
    onLicenseChange: (force?: boolean) => Promise<void>;
    onOpenTool?: (tool: "memory" | "battery" | "apps" | "storage" | "privacy" | "shredder" | "schedule") => void;
  } = $props();

  type Phase = "idle" | "scanning" | "cleaning" | "done";
  let phase = $state<Phase>("idle");
  let progress = $state<ScanProgress | null>(null);
  let report = $state<ScanReport | null>(cachedReport);
  let selected = $state<Record<string, boolean>>(cachedSelected);
  let remnants = $state<AppRemnant[]>(cachedRemnants);
  let startups = $state<StartupItem[]>(cachedStartups);
  let includeRemnants = $state<boolean>(cachedIncludeRemnants);
  let expandedGroup = $state<string | null>(null);
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

  // Dynamic OS Disk Label & Localized Add-on Price (D3 Architecture)
  let osDiskLabel = $state("Local Disk (C:) · NVMe");
  let localizedAddonPrice = $state("£9.99/yr");

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
  const selectedBytes = $derived(
    selectedCats.reduce((s, c) => s + c.bytes, 0) + (includeRemnants ? remnantsBytes : 0)
  );
  const totalFoundBytes = $derived((report?.total_bytes ?? 0) + remnantsBytes);
  const targetHeroBytes = $derived(selectedBytes > 0 ? selectedBytes : totalFoundBytes);
  let displayedHeroBytes = $state(0);
  let depletingBytes = $state(0);

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

  function toggleGroup(cats: CategoryResult[], checked: boolean) {
    const next = { ...selected };
    for (const c of cats) {
      next[c.id] = checked;
    }
    selected = next;
    cachedSelected = next;
  }

  function toggleAppAndRemnants(checked: boolean) {
    toggleGroup(appCacheCats, checked);
    if (remnants.length > 0) {
      includeRemnants = checked;
      cachedIncludeRemnants = checked;
    }
  }

  async function scan() {
    if (phase === "scanning" || phase === "cleaning") return;
    error = null;
    phase = "scanning";
    progress = null;
    const unlisten = await api.onScanProgress((p) => (progress = p));
    try {
      const [scanRes, remRes, startRes] = await Promise.allSettled([
        api.scan(),
        api.scanAppRemnants(),
        api.startupItems(),
      ]);

      if (scanRes.status === "fulfilled") {
        const r = scanRes.value;
        report = r;
        cachedReport = r;
        const sel = Object.fromEntries(r.categories.map((c) => [c.id, c.bytes > 0]));
        selected = sel;
        cachedSelected = sel;
        const activeIds = r.categories.filter((c) => c.bytes > 0).map((c) => c.id);
        api
          .checkRunningApps(activeIds)
          .then((conflicts) => (runningConflicts = conflicts))
          .catch(() => (runningConflicts = []));
      } else {
        throw scanRes.reason;
      }

      if (remRes.status === "fulfilled") {
        remnants = remRes.value;
        cachedRemnants = remRes.value;
        includeRemnants = remRes.value.length > 0;
        cachedIncludeRemnants = includeRemnants;
      }
      if (startRes.status === "fulfilled") {
        startups = startRes.value;
        cachedStartups = startRes.value;
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
    if (selectedBytes === 0) return;
    if (!license?.active) {
      pendingCleanAfterAuth = true;
      requestActivation();
      return;
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

  async function executeClean() {
    if (!license?.active) {
      pendingCleanAfterAuth = true;
      requestActivation();
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
      await syncLifetimeStatsFromBackend().catch(() => {});
      api.listQuarantine().then((q) => (quarantine = q)).catch(() => {});
      phase = "done";
    } catch (e: any) {
      phase = "idle";
      if (isPaymentRequired(e)) {
        pendingCleanAfterAuth = true;
        requestActivation();
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
      } else if (ua.includes("linux")) {
        osDiskLabel = "Computer Storage";
      } else {
        osDiskLabel = "Windows Hard Drive (C:)";
      }

      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
      const loc = navigator.language || "en-GB";
      if (tz.startsWith("America/") || loc === "en-US") {
        localizedAddonPrice = "$9.99/yr";
      } else if (tz.startsWith("Europe/") && !tz.includes("London") && !loc.endsWith("GB")) {
        localizedAddonPrice = "€9.99/yr";
      }
    } catch {}

    // Fetch live localized pricing from server
    api
      .appInfo()
      .then((inf) => {
        const base = (inf.api_url || "https://sweeprcleaner.com").replace(/\/+$/, "");
        return fetch(`${base}/api/pricing`);
      })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const p = d?.pricing;
        if (p?.batteryCareAnnualFormatted) {
          localizedAddonPrice = `${p.batteryCareAnnualFormatted}/yr`;
        }
      })
      .catch(() => {});

    api.listQuarantine().then((q) => (quarantine = q)).catch(() => {});
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
      if (pendingCleanAfterAuth) {
        void executeClean();
      }
    };
    window.addEventListener(OPEN_UNDO_EVENT, onOpenUndo);
    window.addEventListener("sweepr-trigger-scan", onTriggerScan);
    window.addEventListener("sweepr-license-activated", onActivated);
    return () => {
      window.removeEventListener(OPEN_UNDO_EVENT, onOpenUndo);
      window.removeEventListener("sweepr-trigger-scan", onTriggerScan);
      window.removeEventListener("sweepr-license-activated", onActivated);
    };
  });
</script>

<svelte:window onkeydown={onWindowKeydown} />

<div class="d3-shell">
  {#if error}
    <div class="error-banner" role="alert">{error}</div>
  {/if}

  <!-- 1. D3 Top Native OS Storage Bar & Primary Fitts's Law Action -->
  <header class="d3-storage-card">
    <div class="d3-storage-top">
      <div class="d3-disk-meta">
        <div class="d3-disk-kicker">
          <span class="d3-os-pill">{osDiskLabel}</span>
          {#if phase === "scanning"}
            <span class="d3-status-text">Scanning: {progress ? progress.category_name : "System paths…"}</span>
          {:else if phase === "cleaning"}
            <span class="d3-status-text">Reclaiming space safely…</span>
          {:else if phase === "done"}
            <span class="d3-status-text">Cleaned {formatBytes(freedTotal)} ({removedTotal} files)</span>
          {:else}
            <span class="d3-status-text">Personal files &amp; active logins untouched</span>
          {/if}
        </div>

        <div class="d3-hero-row">
          {#if phase === "scanning"}
            <span class="d3-hero-metric">{progress ? formatBytes(progress.bytes_so_far) : "Scanning…"}</span>
          {:else if phase === "cleaning"}
            <span class="d3-hero-metric">{formatBytes(depletingBytes)}</span>
          {:else if phase === "done"}
            <span class="d3-hero-metric">{formatBytes(freedTotal)} Freed</span>
          {:else if report && totalFoundBytes > 0}
            <span class="d3-hero-metric">{formatBytes(displayedHeroBytes)}</span>
            <span class="d3-hero-unit">reclaimable junk selected</span>
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
          class="d3-rescan-btn"
          disabled={phase === "scanning" || phase === "cleaning"}
          onclick={scan}
        >
          {t("action.rescan", $lang)}
        </button>

        {#if phase === "done"}
          <button type="button" class="d3-primary-btn" onclick={scan}>
            {t("action.scan", $lang)}
          </button>
        {:else if report && selectedBytes > 0}
          <button
            type="button"
            class="d3-primary-btn"
            disabled={phase === "scanning" || phase === "cleaning"}
            onclick={requestClean}
          >
            {t("action.clean", $lang)} {formatBytes(selectedBytes)}
          </button>
        {:else}
          <button
            type="button"
            class="d3-primary-btn"
            disabled={phase === "scanning" || phase === "cleaning"}
            onclick={scan}
          >
            {t("action.scan", $lang)}
          </button>
        {/if}
      </div>
    </div>

    <!-- Segmented OS Storage Bar -->
    <div class="d3-bar-track" aria-label="Storage allocation breakdown">
      <div class="d3-seg d3-seg-used" style="width: 38%;" title="Protected OS & Personal Files"></div>
      <div class="d3-seg d3-seg-green" style={`width: ${sysSegmentPct}%;`} title="Safe Temp & Browser Cache"></div>
      <div class="d3-seg d3-seg-cobalt" style={`width: ${appSegmentPct}%;`} title="App Cache & Leftovers"></div>
      <div class="d3-seg d3-seg-amber" style={`width: ${dupSegmentPct}%;`} title="Duplicates & Startup"></div>
    </div>

    <div class="d3-bar-legend">
      <span class="d3-legend-item"><i class="d3-dot d3-dot-used"></i>Your Personal Files (Safe)</span>
      <span class="d3-legend-item"><i class="d3-dot d3-dot-green"></i>Temp &amp; Browser ({formatBytes(sysBrowserBytes)})</span>
      <span class="d3-legend-item"><i class="d3-dot d3-dot-cobalt"></i>App Junk &amp; Leftovers ({formatBytes(appAndRemnantsBytes)})</span>
      <span class="d3-legend-item"><i class="d3-dot d3-dot-amber"></i>Duplicates &amp; Startup ({enabledStartups.length})</span>
    </div>
  </header>

  <!-- 2. D3 4 Semantic Pastel-Tinted Category Tiles (Every figure sits inside the card that explains it) -->
  <div class="d3-tiles-grid">
    <!-- Tile 1: Safe Temp & Browser Cache (Green Tint) -->
    <article class="d3-tile d3-tile-green">
      <div>
        <div class="d3-tile-head">
          <label class="d3-tile-check">
            <input
              type="checkbox"
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
              class="d3-inspect-btn"
              onclick={() => (expandedGroup = expandedGroup === "sys" ? null : "sys")}
            >
              {expandedGroup === "sys" ? "Hide Details" : `Details (${sysBrowserCats.length})`}
            </button>
          {/if}
        </div>

        <div class="d3-tile-metric">{formatBytes(sysBrowserBytes)}</div>
        <h3 class="d3-tile-title">Temporary Files &amp; Browser Clutter</h3>
        <p class="d3-tile-desc">
          Old temporary files and leftover web browser clutter from Chrome, Edge, Brave &amp; Safari. Your saved passwords and logins stay safe.
        </p>

        {#if expandedGroup === "sys" && sysBrowserCats.length > 0}
          <div class="d3-path-drawer">
            {#each sysBrowserCats as c (c.id)}
              <label class="d3-path-item">
                <input type="checkbox" bind:checked={selected[c.id]} />
                <span class="d3-path-name">{c.name}</span>
                <span class="d3-path-size">{formatBytes(c.bytes)}</span>
              </label>
            {/each}
          </div>
        {/if}
      </div>

      <button
        type="button"
        class="d3-tile-action"
        disabled={sysBrowserBytes === 0 || phase === "scanning" || phase === "cleaning"}
        onclick={() => cleanSpecificCategoryGroup(sysBrowserCats, false)}
      >
        <span>{sysBrowserBytes > 0 ? `Clean ${formatBytes(sysBrowserBytes)}` : "All Clean"}</span>
        <span>→</span>
      </button>
    </article>

    <!-- Tile 2: App Cache & Uninstalled Leftovers (Cobalt Tint) -->
    <article class="d3-tile d3-tile-cobalt">
      <div>
        <div class="d3-tile-head">
          <label class="d3-tile-check">
            <input
              type="checkbox"
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
              class="d3-inspect-btn"
              onclick={() => (expandedGroup = expandedGroup === "app" ? null : "app")}
            >
              {expandedGroup === "app" ? "Hide Details" : `Details (${appCacheCats.length})`}
            </button>
          {/if}
        </div>

        <div class="d3-tile-metric">{formatBytes(appAndRemnantsBytes)}</div>
        <h3 class="d3-tile-title">App Junk, Trash &amp; Leftovers</h3>
        <p class="d3-tile-desc">
          Leftover files from deleted apps ({remnants.length} folder{remnants.length === 1 ? "" : "s"}), Recycle Bin clutter, and old temporary files from Discord, Spotify &amp; Steam.
        </p>

        {#if expandedGroup === "app" && appCacheCats.length > 0}
          <div class="d3-path-drawer">
            {#each appCacheCats as c (c.id)}
              <label class="d3-path-item">
                <input type="checkbox" bind:checked={selected[c.id]} />
                <span class="d3-path-name">{c.name}</span>
                <span class="d3-path-size">{formatBytes(c.bytes)}</span>
              </label>
            {/each}
          </div>
        {/if}
      </div>

      <button
        type="button"
        class="d3-tile-action"
        disabled={phase === "scanning" || phase === "cleaning"}
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
    <article class="d3-tile d3-tile-amber">
      <div>
        <div class="d3-tile-head">
          <span class="d3-tile-kicker">DUPLICATES &amp; STARTUP SPEED</span>
          <button
            type="button"
            class="d3-inspect-btn"
            onclick={() => onOpenTool?.("memory")}
          >
            {enabledStartups.length} Startup Apps
          </button>
        </div>

        <div class="d3-tile-metric">Duplicates · {enabledStartups.length} Startup</div>
        <h3 class="d3-tile-title">Duplicate Files &amp; Startup Speed</h3>
        <p class="d3-tile-desc">
          Finds identical copies of photos and documents (always keeps your original safe) and stops unnecessary apps from slowing down startup.
        </p>
      </div>

      <div class="d3-dual-actions">
        <button
          type="button"
          class="d3-tile-action"
          onclick={() => onOpenTool?.("storage")}
        >
          <span>Find Duplicates</span>
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
    <article class="d3-tile d3-tile-plum">
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
  <div class="undo-backdrop" onclick={() => (showQuarantine = false)} role="presentation">
    <div
      class="undo-modal card"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
      aria-label="Recently Cleaned Files (7-Day Undo)"
      tabindex="-1"
    >
      <div class="undo-head">
        <h3 class="undo-title">Recently Cleaned Files (7-Day Undo)</h3>
        <button type="button" class="close-x" onclick={() => (showQuarantine = false)}>✕</button>
      </div>

      {#if restoreNotice}
        <div class="restore-toast">{restoreNotice}</div>
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

  .d3-rescan-btn {
    min-height: 44px;
    padding: 8px 14px;
    border-radius: 11px;
    border: 1px solid var(--border);
    background: var(--panel-2);
    color: var(--text);
    font-size: 12.5px;
    font-weight: 700;
    cursor: pointer;
    transition: transform 140ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  .d3-rescan-btn:active:not(:disabled) {
    transform: scale(0.97);
  }

  .d3-primary-btn {
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
    transition: transform 140ms cubic-bezier(0.22, 1, 0.36, 1), background-color 140ms ease;
  }
  .d3-primary-btn:hover:not(:disabled) {
    background: #086341;
  }
  .d3-primary-btn:active:not(:disabled) {
    transform: scale(0.97);
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

  /* 2. 4 Semantic Pastel-Tinted Category Tiles */
  .d3-tiles-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    flex: 1;
  }

  .d3-tile {
    border-radius: 16px;
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 12px;
    border: 1px solid transparent;
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

  .d3-tile-kicker {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 10.5px;
    font-weight: 800;
    letter-spacing: 0.05em;
  }

  .d3-inspect-btn {
    background: rgba(255, 255, 255, 0.55);
    color: inherit;
    border: 1px solid currentColor;
    border-radius: 999px;
    padding: 3px 9px;
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
  }
  :global(body[data-theme="dark"]) .d3-inspect-btn,
  :global(.dark) .d3-inspect-btn {
    background: rgba(15, 23, 42, 0.45);
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
    gap: 5px;
    max-height: 125px;
    overflow-y: auto;
  }

  .d3-path-item {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11.5px;
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
    transition: transform 140ms cubic-bezier(0.22, 1, 0.36, 1), background-color 140ms ease;
  }
  :global(body[data-theme="dark"]) .d3-tile-action,
  :global(.dark) .d3-tile-action {
    background: rgba(15, 23, 42, 0.55);
  }
  .d3-tile-action:active:not(:disabled) {
    transform: scale(0.97);
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

  @media (max-width: 720px) {
    .d3-tiles-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
