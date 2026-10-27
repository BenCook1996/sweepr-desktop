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
  import { formatBytes, formatCount, shortenPath } from "../lib/format";
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

  const nonEmpty = $derived(report?.categories.filter((c) => c.bytes > 0) ?? []);

  const sysBrowserCats = $derived(
    nonEmpty.filter((c) =>
      /temp|log|crash|update|prefetch|thumb|font|dns|shader|memory_dump|windows|chrome|edge|brave|firefox|opera|vivaldi|safari|browser/i.test(
        c.id
      )
    )
  );
  const appCacheCats = $derived(
    nonEmpty.filter(
      (c) =>
        !/temp|log|crash|update|prefetch|thumb|font|dns|shader|memory_dump|windows|chrome|edge|brave|firefox|opera|vivaldi|safari|browser/i.test(
          c.id
        )
    )
  );

  const sysBrowserBytes = $derived(sysBrowserCats.reduce((s, c) => s + c.bytes, 0));
  const appCacheBytes = $derived(appCacheCats.reduce((s, c) => s + c.bytes, 0));
  const remnantsBytes = $derived(remnants.reduce((s, r) => s + r.bytes, 0));
  const enabledStartups = $derived(startups.filter((s) => s.enabled));

  const sysBrowserChecked = $derived(
    sysBrowserCats.length > 0 && sysBrowserCats.some((c) => selected[c.id])
  );
  const appCacheChecked = $derived(
    appCacheCats.length > 0 && appCacheCats.some((c) => selected[c.id])
  );

  const selectedCats = $derived(nonEmpty.filter((c) => selected[c.id]));
  const selectedBytes = $derived(
    selectedCats.reduce((s, c) => s + c.bytes, 0) + (includeRemnants ? remnantsBytes : 0)
  );
  const totalFoundBytes = $derived((report?.total_bytes ?? 0) + remnantsBytes);
  const targetHeroBytes = $derived(selectedBytes > 0 ? selectedBytes : totalFoundBytes);
  let displayedHeroBytes = $state(0);
  let depletingBytes = $state(0);

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
    api.listQuarantine().then((q) => (quarantine = q)).catch(() => {});
    if (!cachedReport) {
      scan();
    }
    const onOpenUndo = () => {
      void openUndoModal();
    };
    const onTriggerScan = () => {
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

<div class="clean-shell">
  {#if error}
    <div class="error-banner">{error}</div>
  {/if}

  <div class="clean-stage">
    {#if phase === "scanning"}
      <div class="center-state">
        <div class="spinner" aria-hidden="true"></div>
        <div class="hero-number">
          {progress ? formatBytes(progress.bytes_so_far) : "Scanning…"}
        </div>
        <p class="hero-sub">
          {progress ? progress.category_name : "Checking cache, leftovers, and startup apps"}
        </p>
      </div>
    {:else if phase === "cleaning"}
      <div class="center-state">
        <div class="spinner" aria-hidden="true"></div>
        <div class="hero-number">{formatBytes(depletingBytes)}</div>
        <p class="hero-sub">Reclaiming space • Open files skipped automatically</p>
      </div>
    {:else if phase === "done"}
      <div class="center-state">
        <div class="done-badge" aria-hidden="true">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
            <path class="done-check-path" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div class="hero-number">{formatBytes(freedTotal)} Cleaned</div>
        <p class="hero-sub undo-safety-pill">Protected by 7-Day Safety Undo</p>
      </div>
    {:else if report && totalFoundBytes > 0}
      <!-- Minimalist Results View (<30 Words on Screen) -->
      <div class="results-stage">
        <div class="hero-header">
          <div class="hero-number">
            {formatBytes(displayedHeroBytes)}
          </div>
          <p class="hero-sub">Personal files and logins stay untouched</p>
          {#if runningConflicts.length > 0}
            <div style="margin-top: 6px; font-size: 11.5px; color: var(--warn, #f59e0b); font-weight: 600;">
              Open apps detected ({runningConflicts.map((rc) => rc.app_name).join(", ")}) — active files will be safely skipped.
            </div>
          {/if}
        </div>

        <div class="rows-stack">
          {#if sysBrowserBytes > 0}
            <div class="clean-row-card">
              <div class="clean-row-main">
                <label class="row-check-label">
                  <input
                    type="checkbox"
                    checked={sysBrowserChecked}
                    onchange={(e) =>
                      toggleGroup(sysBrowserCats, (e.currentTarget as HTMLInputElement).checked)}
                  />
                  <span class="row-title">System &amp; Browser Cache</span>
                </label>
                <div class="row-right">
                  <span class="row-size">{formatBytes(sysBrowserBytes)}</span>
                  <button
                    type="button"
                    class="row-expand-btn"
                    onclick={() =>
                      (expandedGroup = expandedGroup === "sys" ? null : "sys")}
                    aria-label="Details"
                  >
                    <svg class="row-expand-chevron" class:open={expandedGroup === "sys"} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </div>
              </div>
              {#if expandedGroup === "sys"}
                <div class="row-details">
                  {#each sysBrowserCats as c (c.id)}
                    <label class="detail-item">
                      <input type="checkbox" bind:checked={selected[c.id]} />
                      <span class="detail-name">{c.name}</span>
                      <span class="detail-bytes">{formatBytes(c.bytes)}</span>
                    </label>
                  {/each}
                </div>
              {/if}
            </div>
          {/if}

          {#if appCacheBytes > 0}
            <div class="clean-row-card">
              <div class="clean-row-main">
                <label class="row-check-label">
                  <input
                    type="checkbox"
                    checked={appCacheChecked}
                    onchange={(e) =>
                      toggleGroup(appCacheCats, (e.currentTarget as HTMLInputElement).checked)}
                  />
                  <span class="row-title">App Cache &amp; Trash</span>
                </label>
                <div class="row-right">
                  <span class="row-size">{formatBytes(appCacheBytes)}</span>
                  <button
                    type="button"
                    class="row-expand-btn"
                    onclick={() =>
                      (expandedGroup = expandedGroup === "app" ? null : "app")}
                    aria-label="Details"
                  >
                    <svg class="row-expand-chevron" class:open={expandedGroup === "app"} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </div>
              </div>
              {#if expandedGroup === "app"}
                <div class="row-details">
                  {#each appCacheCats as c (c.id)}
                    <label class="detail-item">
                      <input type="checkbox" bind:checked={selected[c.id]} />
                      <span class="detail-name">{c.name}</span>
                      <span class="detail-bytes">{formatBytes(c.bytes)}</span>
                    </label>
                  {/each}
                </div>
              {/if}
            </div>
          {/if}

          {#if remnantsBytes > 0}
            <div class="clean-row-card">
              <div class="clean-row-main">
                <label class="row-check-label">
                  <input
                    type="checkbox"
                    bind:checked={includeRemnants}
                    onchange={() => (cachedIncludeRemnants = includeRemnants)}
                  />
                  <span class="row-title">App Leftovers</span>
                </label>
                <div class="row-right">
                  <span class="row-size">{formatBytes(remnantsBytes)}</span>
                </div>
              </div>
            </div>
          {/if}

          <div class="clean-row-card">
            <div class="clean-row-main">
              <button
                type="button"
                class="row-link-btn"
                onclick={() => onOpenTool?.("storage")}
              >
                <span class="row-title">Duplicate Files</span>
                <span class="row-muted">Scan folders →</span>
              </button>
            </div>
          </div>

          {#if enabledStartups.length > 0}
            <div class="clean-row-card">
              <div class="clean-row-main">
                <button
                  type="button"
                  class="row-link-btn"
                  onclick={() => onOpenTool?.("memory")}
                >
                  <span class="row-title">Startup Apps</span>
                  <span class="row-muted">{enabledStartups.length} apps →</span>
                </button>
              </div>
            </div>
          {/if}
        </div>
      </div>
    {:else}
      <!-- Minimalist Idle / All Clean State -->
      <div class="center-state">
        <div class="done-badge" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
          </svg>
        </div>
        <div class="hero-number">Ready to Scan</div>
        <p class="hero-sub">Checks cache, duplicates, leftovers, and startup apps</p>
      </div>
    {/if}
  </div>

  <!-- Anchored Bottom Fitts's Law Action Bar (0px Vertical Drift) -->
  <footer class="anchored-footer">
    <button
      type="button"
      class="ghost rescan-link"
      disabled={phase === "scanning" || phase === "cleaning"}
      onclick={scan}
    >
      {t("action.rescan", $lang)}
    </button>

    {#if phase === "done"}
      <button type="button" class="primary cta-btn" onclick={scan}>
        {t("action.scan", $lang)}
      </button>
    {:else if report && selectedBytes > 0}
      <button
        type="button"
        class="primary cta-btn"
        disabled={phase === "scanning" || phase === "cleaning"}
        onclick={requestClean}
      >
        {t("action.clean", $lang)} {formatBytes(selectedBytes)}
      </button>
    {:else}
      <button
        type="button"
        class="primary cta-btn"
        disabled={phase === "scanning" || phase === "cleaning"}
        onclick={scan}
      >
        {t("action.scan", $lang)}
      </button>
    {/if}
  </footer>
</div>

<!-- Minimalist 7-Day Safety Undo Modal (Always 100% Free) -->
{#if showQuarantine}
  <div class="undo-backdrop" onclick={() => (showQuarantine = false)} role="presentation">
    <div class="undo-modal card" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex="-1">
      <div class="undo-head">
        <h3 class="undo-title">7-Day Undo</h3>
        <button type="button" class="close-x" onclick={() => (showQuarantine = false)}>✕</button>
      </div>

      {#if restoreNotice}
        <div class="restore-toast">{restoreNotice}</div>
      {/if}

      {#if quarantine.length > 0}
        <input
          type="text"
          bind:value={undoSearch}
          placeholder="Search files…"
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
        <div class="undo-empty">No files in 7-day undo.</div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .clean-shell {
    height: calc(100vh - 48px);
    max-width: 680px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }

  .clean-stage {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    overflow-y: auto;
    padding: 12px 4px;
  }

  .center-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    gap: 8px;
    margin: auto 0;
  }

  .done-badge {
    width: 52px;
    height: 52px;
    border-radius: 16px;
    background: rgba(16, 185, 129, 0.14);
    border: 1px solid rgba(16, 185, 129, 0.3);
    color: var(--accent);
    display: grid;
    place-items: center;
    font-size: 22px;
    font-weight: 800;
    margin-bottom: 6px;
    animation: badgeLockIn 160ms cubic-bezier(0.16, 1, 0.3, 1) both;
  }

  .done-check-path {
    stroke-dasharray: 24;
    stroke-dashoffset: 24;
    animation: drawCheck 140ms cubic-bezier(0.16, 1, 0.3, 1) 40ms forwards;
  }

  .undo-safety-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 11px;
    border-radius: 999px;
    background: rgba(16, 185, 129, 0.12);
    border: 1px solid rgba(16, 185, 129, 0.32);
    color: #34d399;
    font-weight: 700;
    animation: badgeLockIn 160ms cubic-bezier(0.16, 1, 0.3, 1) 30ms both;
  }

  @keyframes badgeLockIn {
    from { opacity: 0; transform: scale(0.94) translateY(3px); }
    to   { opacity: 1; transform: scale(1) translateY(0); }
  }

  @keyframes drawCheck {
    to { stroke-dashoffset: 0; }
  }

  .results-stage {
    display: flex;
    flex-direction: column;
    gap: 28px;
    width: 100%;
    max-width: 480px;
    margin: auto;
  }

  .hero-header {
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .hero-number {
    font-size: 46px;
    font-weight: 800;
    letter-spacing: -1.5px;
    line-height: 1.05;
    color: var(--text);
    font-variant-numeric: tabular-nums;
    font-feature-settings: "tnum" 1;
  }

  .hero-sub {
    margin: 0;
    font-size: 12.5px;
    color: var(--muted);
  }

  .rows-stack {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
  }

  .clean-row-card {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 11px 15px;
    transition: border-color 140ms cubic-bezier(0.16, 1, 0.3, 1), transform 75ms cubic-bezier(0.16, 1, 0.3, 1);
    animation: rowCascadeIn 150ms cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  .clean-row-card:nth-child(2) { animation-delay: 20ms; }
  .clean-row-card:nth-child(3) { animation-delay: 40ms; }
  .clean-row-card:nth-child(4) { animation-delay: 60ms; }
  .clean-row-card:nth-child(5) { animation-delay: 80ms; }
  .clean-row-card:hover {
    border-color: rgba(16, 185, 129, 0.35);
  }

  @keyframes rowCascadeIn {
    from { opacity: 0; transform: translateY(4px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .clean-row-main {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .row-check-label {
    display: flex;
    align-items: center;
    gap: 11px;
    cursor: pointer;
    flex: 1;
    min-width: 0;
  }

  .row-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
  }

  .row-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .row-size {
    font-size: 13px;
    font-weight: 700;
    color: var(--accent);
    font-variant-numeric: tabular-nums;
  }

  .row-muted {
    font-size: 12px;
    color: var(--muted);
  }

  .row-expand-btn {
    background: transparent;
    border: none;
    box-shadow: none;
    color: var(--muted);
    padding: 4px 6px;
    font-size: 11px;
    cursor: pointer;
    display: inline-grid;
    place-items: center;
    transition: transform 75ms cubic-bezier(0.16, 1, 0.3, 1), color 140ms cubic-bezier(0.16, 1, 0.3, 1);
  }
  .row-expand-btn:active {
    transform: scale(0.94);
  }
  .row-expand-chevron {
    transition: transform 150ms cubic-bezier(0.16, 1, 0.3, 1);
  }
  .row-expand-chevron.open {
    transform: rotate(180deg);
  }

  .row-link-btn {
    width: 100%;
    background: transparent;
    border: none;
    box-shadow: none;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    cursor: pointer;
    color: var(--text);
  }

  .row-details {
    margin-top: 10px;
    padding-top: 8px;
    border-top: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 6px;
    animation: detailsReveal 150ms cubic-bezier(0.16, 1, 0.3, 1) both;
  }

  @keyframes detailsReveal {
    from { opacity: 0; transform: translateY(-4px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .detail-item {
    display: flex;
    align-items: center;
    gap: 9px;
    font-size: 12px;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .detail-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .detail-bytes {
    font-weight: 600;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  /* Anchored Bottom Fitts's Law Footer */
  .anchored-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 4px 4px 4px;
    border-top: 1px solid var(--border);
  }

  .rescan-link {
    background: transparent;
    border: none;
    box-shadow: none;
    color: var(--muted);
    font-size: 12.5px;
    font-weight: 600;
    padding: 8px 12px;
    cursor: pointer;
    transition: color 140ms cubic-bezier(0.16, 1, 0.3, 1), transform 75ms cubic-bezier(0.16, 1, 0.3, 1);
  }
  .rescan-link:hover:not(:disabled) {
    color: var(--text);
  }
  .rescan-link:active:not(:disabled) {
    transform: scale(0.985);
  }

  .cta-btn {
    padding: 11px 28px;
    border-radius: 12px;
    font-size: 13.5px;
    font-weight: 700;
    background: #10b981;
    color: #070a0d;
    border: none;
    box-shadow: 0 8px 26px rgba(16, 185, 129, 0.25);
    cursor: pointer;
    font-variant-numeric: tabular-nums;
    transition: transform 75ms cubic-bezier(0.16, 1, 0.3, 1), background-color 140ms cubic-bezier(0.16, 1, 0.3, 1), box-shadow 140ms cubic-bezier(0.16, 1, 0.3, 1);
    will-change: transform;
  }
  .cta-btn:hover:not(:disabled) {
    background: #34d399;
    transform: translateY(-1px);
  }
  .cta-btn:active:not(:disabled) {
    transform: scale(0.985);
  }

  /* Minimalist 7-Day Undo Modal */
  .undo-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(7, 10, 13, 0.76);
    backdrop-filter: blur(6px);
    display: grid;
    place-items: center;
    z-index: 220;
    padding: 20px;
  }
  .undo-modal {
    width: 100%;
    max-width: 420px;
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
    box-shadow: none;
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
    outline: none;
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
    box-shadow: none;
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
    background: #10b981;
    color: #070a0d;
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

  .spinner {
    width: 34px;
    height: 34px;
    border: 3px solid var(--border);
    border-top-color: #10b981;
    border-radius: 50%;
    animation: spin 0.9s linear infinite;
    margin-bottom: 8px;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .error-banner {
    padding: 10px 14px;
    border-radius: 10px;
    background: rgba(239, 68, 68, 0.14);
    border: 1px solid rgba(239, 68, 68, 0.3);
    color: var(--danger);
    font-size: 12.5px;
  }
</style>
