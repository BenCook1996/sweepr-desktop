<script lang="ts" module>
  import type {
    BrowserMemoryReport,
    MemoryOverview,
    StartupItem,
    TabSessionSnapshot,
  } from "../lib/api";

  let cachedMem: MemoryOverview | null = null;
  let cachedBrowserReport: BrowserMemoryReport | null = null;
  let cachedTabSessions: TabSessionSnapshot[] = [];
  let cachedStartup: StartupItem[] = [];
</script>

<script lang="ts">
  import BatteryCare from "./BatteryCare.svelte";
  import {
    api,
    errorMessage,
    isPaymentRequired,
    requestActivation,
    type AppInfo,
    type LicenseStatus,
  } from "../lib/api";
  import { formatBytes } from "../lib/format";

  let {
    license = null,
    info = null,
    viewMode = $bindable<"pc" | "battery">("pc"),
  }: {
    license?: LicenseStatus | null;
    info?: AppInfo | null;
    viewMode?: "pc" | "battery";
  } = $props();

  const osType = $derived(
    info?.os?.toLowerCase() ||
      (typeof navigator !== "undefined" && /Mac/i.test(navigator.platform)
        ? "macos"
        : typeof navigator !== "undefined" && /Linux/i.test(navigator.platform)
          ? "linux"
          : "windows")
  );
  const deviceLabel = $derived(osType === "macos" ? "Mac" : osType === "linux" ? "System" : "PC");

  let mem = $state<MemoryOverview | null>(cachedMem);
  let browserReport = $state<BrowserMemoryReport | null>(cachedBrowserReport);
  let tabSessions = $state<TabSessionSnapshot[]>(cachedTabSessions);
  let startup = $state<StartupItem[]>(cachedStartup);

  let boosting = $state(false);
  let boostNotice = $state<string | null>(null);
  let toggling = $state<string | null>(null);
  let killingProc = $state<string | null>(null);
  let confirmKillProc = $state<string | null>(null);
  let restoringSession = $state<string | null>(null);
  let confirmRestoreId = $state<string | null>(null);
  let showSavedTabs = $state(false);
  let listInteracting = $state(false);
  let error = $state<string | null>(null);

  function formatSnapshotTime(ts: number): string {
    if (!ts) return "Just now";
    const d = new Date(ts * 1000);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  async function load() {
    try {
      const [m, b, ts, s] = await Promise.all([
        api.memory(),
        api.browserMemoryReport().catch(() => null),
        api.listTabSessions().catch(() => []),
        api.startupItems(),
      ]);
      mem = m;
      browserReport = b;
      tabSessions = ts;
      startup = s;
      cachedMem = m;
      cachedBrowserReport = b;
      cachedTabSessions = ts;
      cachedStartup = s;
    } catch (e) {
      error = errorMessage(e);
    }
  }

  async function runOneClickSpeedBoost() {
    error = null;
    boostNotice = null;
    boosting = true;
    try {
      const boostRes = await api.boostGamingMode();
      let totalFreed = boostRes.bytes_freed;
      let tabsSlept = 0;

      if (license?.active && browserReport && browserReport.total_browser_bytes > 0) {
        try {
          const tameRes = await api.tameBrowserMemory(null, true);
          totalFreed += tameRes.bytes_freed;
          tabsSlept = tameRes.tabs_tamed;
        } catch {
          // Ignore optional browser tame error if no browsers open
        }
      }

      const [m, b, ts] = await Promise.all([
        api.memory(),
        api.browserMemoryReport().catch(() => browserReport),
        api.listTabSessions().catch(() => tabSessions),
      ]);
      mem = m;
      browserReport = b;
      tabSessions = ts;
      cachedMem = m;
      cachedBrowserReport = b;
      cachedTabSessions = ts;

      const parts: string[] = [];
      if (totalFreed > 0) parts.push(`freed ${formatBytes(totalFreed)} of memory`);
      if (tabsSlept > 0) parts.push(`put ${tabsSlept} inactive browser tab(s) to sleep`);
      if (boostRes.processes_closed > 0) parts.push(`paused ${boostRes.processes_closed} idle background helper(s)`);
      boostNotice =
        parts.length > 0
          ? `Speed Boost complete: ${parts.join(" and ")}.`
          : "Your PC memory and browser tabs are already running smoothly!";
    } catch (e) {
      if (isPaymentRequired(e)) {
        requestActivation();
      } else {
        error = errorMessage(e);
      }
    } finally {
      boosting = false;
    }
  }

  async function toggleStartupApp(item: StartupItem) {
    if (!license?.active) {
      requestActivation();
      return;
    }
    error = null;
    toggling = item.name;
    try {
      const nextEnabled = !(item.enabled ?? true);
      startup = await api.toggleStartupItem(item.name, item.scope, nextEnabled);
      cachedStartup = startup;
    } catch (e) {
      if (isPaymentRequired(e)) {
        requestActivation();
      } else {
        error = errorMessage(e);
      }
    } finally {
      toggling = null;
    }
  }

  async function closeHeavyApp(name: string) {
    if (confirmKillProc !== name) {
      confirmKillProc = name;
      return;
    }
    confirmKillProc = null;
    error = null;
    boostNotice = null;
    killingProc = name;
    try {
      await api.killProcess(name);
      boostNotice = `Closed ${name} and freed up its memory.`;
      mem = await api.memory();
      cachedMem = mem;
    } catch (e) {
      if (isPaymentRequired(e)) {
        requestActivation();
      } else {
        error = errorMessage(e);
      }
    } finally {
      killingProc = null;
    }
  }

  async function restoreSession(snap: TabSessionSnapshot) {
    if (!license?.active) {
      requestActivation();
      return;
    }
    if (confirmRestoreId !== snap.id) {
      confirmRestoreId = snap.id;
      return;
    }
    confirmRestoreId = null;
    error = null;
    restoringSession = snap.id;
    try {
      await api.restoreTabSession(snap.id);
      boostNotice = `Restored your saved browser tabs. Open your browser to view them.`;
    } catch (e) {
      if (isPaymentRequired(e)) requestActivation();
      else error = errorMessage(e);
    } finally {
      restoringSession = null;
    }
  }

  $effect(() => {
    load();
    const timer = setInterval(() => {
      if (listInteracting || viewMode === "battery") return;
      Promise.all([
        api.memory(),
        api.browserMemoryReport().catch(() => browserReport),
      ])
        .then(([m, b]) => {
          mem = m;
          cachedMem = m;
          if (b) {
            browserReport = b;
            cachedBrowserReport = b;
          }
        })
        .catch(() => {});
    }, 4000);
    return () => clearInterval(timer);
  });

  const usedPct = $derived(mem ? Math.round((mem.used_bytes / mem.total_bytes) * 100) : 0);
  const topFiveApps = $derived(mem ? mem.top_apps.slice(0, 5) : []);
  const maxApp = $derived(topFiveApps[0]?.bytes ?? 1);
  const toggleableStartup = $derived(
    startup.filter((s) => s.scope === "Current user" || s.scope.includes("HKCU"))
  );
</script>

<div class="speed-layout">
  <div class="header-row">
    <div>
      <h1 class="page-title">Speed Up Your {deviceLabel}</h1>
      <p class="muted small" style="margin: 4px 0 0 0;">
        Free up memory in one click, stop slow startup apps, and extend laptop battery life.
      </p>
    </div>

    <div class="mode-pills" role="tablist">
      <button
        class="mode-btn"
        class:active={viewMode === "pc"}
        onclick={() => (viewMode = "pc")}
        role="tab"
        aria-selected={viewMode === "pc"}
      >
        {deviceLabel} Speed &amp; Startup
      </button>
      <button
        class="mode-btn"
        class:active={viewMode === "battery"}
        onclick={() => (viewMode = "battery")}
        role="tab"
        aria-selected={viewMode === "battery"}
      >
        Laptop Battery Care
      </button>
    </div>
  </div>

  {#if viewMode === "battery"}
    <BatteryCare {license} />
  {:else}
    {#if error}<div class="card error-banner">{error}</div>{/if}
    {#if boostNotice}
      <div class="card emerald-banner">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        <span>{boostNotice}</span>
      </div>
    {/if}

    <!-- 1. One-Click Speed Boost Hero Card -->
    <section class="card boost-hero-card">
      <div class="gauge-wrap" role="img" aria-label={mem ? `${usedPct}% memory in use` : "Checking memory"}>
        <div class="gauge" class:busy={usedPct > 80} style="--pct: {Math.round(usedPct * 0.75)}%"></div>
        <div class="gauge-lbl">
          <strong>{mem ? `${usedPct}%` : "—"}</strong>
          <small>memory in use</small>
        </div>
      </div>
      <div class="boost-hero-left">
        <span class="eyebrow">1-Click Speed Boost</span>
        <h2>
          {!mem
            ? "Checking how busy your PC is…"
            : usedPct > 80
              ? "Your PC is very busy right now"
              : usedPct > 55
                ? "Your PC is a little busy"
                : "Your PC is running smoothly"}
        </h2>
        <p class="muted">
          Frees up memory from idle background apps and puts inactive browser tabs to sleep without closing your open tabs or losing your work.
        </p>

        <div class="live-metrics-row">
          <div class="metric-box">
            <span class="metric-label">PC Memory in Use</span>
            <strong class="metric-value">
              {mem ? `${usedPct}%` : "—"}
              <span class="muted small" style="font-weight: 500;">
                {mem ? `(${formatBytes(mem.used_bytes)} of ${formatBytes(mem.total_bytes)})` : ""}
              </span>
            </strong>
          </div>

          <div class="metric-box">
            <span class="metric-label">Open Browser Memory</span>
            <strong class="metric-value">
              {browserReport && browserReport.total_browser_bytes > 0
                ? formatBytes(browserReport.total_browser_bytes)
                : "Low / Clean"}
              {#if browserReport && browserReport.estimated_reclaimable_bytes > 0}
                <span class="muted small" style="font-weight: 500;">
                  (~{formatBytes(browserReport.estimated_reclaimable_bytes)} can be freed)
                </span>
              {/if}
            </strong>
          </div>
        </div>
      </div>

      <div class="boost-hero-right">
        <button class="primary boost-cta-btn" disabled={boosting} onclick={runOneClickSpeedBoost}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
          <span>{boosting ? "Boosting Speed…" : "Boost Speed Now"}</span>
        </button>
        {#if !boosting && browserReport && browserReport.estimated_reclaimable_bytes > 0}
          <span class="muted small" style="text-align: center;">
            Can free about <strong style="color: var(--accent);">{formatBytes(browserReport.estimated_reclaimable_bytes)}</strong> without closing your work
          </span>
        {/if}
        {#if tabSessions.length > 0}
          <button class="ghost small-btn" onclick={() => (showSavedTabs = !showSavedTabs)}>
            {showSavedTabs ? "Hide Saved Tab Backups" : `Saved Tab Backups (${tabSessions.length})`}
          </button>
        {/if}
      </div>
    </section>

    {#if showSavedTabs && tabSessions.length > 0}
      <div class="card" style="padding: 18px 22px;">
        <div class="row" style="margin-bottom: 10px;">
          <div>
            <strong>Saved Browser Tab Backups</strong>
            <div class="muted small">SWEEPR automatically backs up your open browser tabs so you can restore them anytime.</div>
          </div>
        </div>
        <div style="display: flex; flex-direction: column; gap: 8px;">
          {#each tabSessions as snap (snap.id)}
            <div class="row sub-row">
              <div style="flex: 1;">
                <strong class="small">{snap.browsers.join(", ")} (~{snap.estimated_tabs} tabs)</strong>
                <div class="muted small">{formatSnapshotTime(snap.created_at)}</div>
              </div>
              <button
                class={confirmRestoreId === snap.id ? "primary small-btn" : "ghost small-btn"}
                disabled={restoringSession === snap.id}
                onclick={() => restoreSession(snap)}
              >
                {restoringSession === snap.id
                  ? "Restoring…"
                  : confirmRestoreId === snap.id
                    ? "Confirm Restore"
                    : "Restore Tabs"}
              </button>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- 2. Two-Column Layout: Startup Apps + Heavy Running Apps -->
    <div
      class="two-col-grid"
      role="region"
      aria-label="Startup and running apps"
      onmouseenter={() => (listInteracting = true)}
      onmouseleave={() => (listInteracting = false)}
    >
      <!-- Left Card: Startup Apps -->
      <section class="card section-card">
        <div class="section-head">
          <div>
            <h3>Apps That Start With Windows</h3>
            <p class="muted small">Turn off apps you don't need right away so your PC starts up faster.</p>
          </div>
          <span class="badge free">{toggleableStartup.filter((s) => s.enabled !== false).length} On</span>
        </div>

        {#if toggleableStartup.length === 0}
          <div class="muted small empty-box">No extra startup apps found.</div>
        {:else}
          <div class="item-list">
            {#each toggleableStartup as s (s.name + s.scope)}
              {@const isEnabled = s.enabled ?? true}
              {@const impact = s.impact ?? "Low"}
              <div class="row item-row" class:dimmed={!isEnabled}>
                <div style="flex: 1; min-width: 0;">
                  <div class="row" style="gap: 8px; flex-wrap: wrap;">
                    <strong class="app-title">{s.name}</strong>
                    <span class="badge free" style="font-size: 10px; padding: 2px 7px;">Safe to Turn Off</span>
                  </div>
                  <div class="muted small">
                    {impact === "High"
                      ? "Slows down startup noticeably"
                      : impact === "Medium"
                        ? "Moderate startup slowdown"
                        : "Light startup impact"}
                  </div>
                </div>
                {#if !license?.active}
                  <span class="badge pro">Pro</span>
                {/if}
                <button
                  class={isEnabled ? "ghost small-btn" : "primary small-btn"}
                  disabled={toggling === s.name}
                  onclick={() => toggleStartupApp(s)}
                >
                  {toggling === s.name ? "…" : isEnabled ? "Turn Off" : "Turn On"}
                </button>
              </div>
            {/each}
          </div>
        {/if}
      </section>

      <!-- Right Card: Heavy Running Apps -->
      <section class="card section-card">
        <div class="section-head">
          <div>
            <h3>Apps Using the Most Memory Right Now</h3>
            <p class="muted small">Close heavy apps you aren't currently using to free up memory immediately.</p>
          </div>
        </div>

        {#if topFiveApps.length === 0}
          <div class="muted small empty-box">Checking running apps…</div>
        {:else}
          <div class="item-list">
            {#each topFiveApps as a (a.name)}
              <div class="row item-row">
                <div style="flex: 1; min-width: 0;">
                  <div class="row" style="justify-content: space-between; margin-bottom: 4px;">
                    <strong class="app-title">{a.name}</strong>
                    <strong class="small" style="color: var(--accent);">{formatBytes(a.bytes)}</strong>
                  </div>
                  <div class="mini-bar">
                    <div class="mini-bar-fill" style="width: {(a.bytes / maxApp) * 100}%"></div>
                  </div>
                </div>
                <button
                  class={confirmKillProc === a.name ? "primary small-btn" : "ghost small-btn"}
                  style={confirmKillProc === a.name ? "background: var(--danger);" : ""}
                  disabled={killingProc === a.name}
                  onclick={() => closeHeavyApp(a.name)}
                >
                  {killingProc === a.name
                    ? "Closing…"
                    : confirmKillProc === a.name
                      ? "Confirm Close"
                      : "Close App"}
                </button>
              </div>
            {/each}
          </div>
        {/if}
      </section>
    </div>
  {/if}
</div>

<style>
  .speed-layout {
    max-width: 1120px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 20px;
    padding-bottom: 36px;
  }
  .header-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    flex-wrap: wrap;
    gap: 12px;
  }
  .page-title {
    font-size: 26px;
    font-weight: 800;
    letter-spacing: -0.5px;
    margin: 0;
  }

  .mode-pills {
    display: flex;
    background: var(--panel-2);
    padding: 4px;
    border-radius: 9999px;
    border: 1px solid var(--border);
  }
  .mode-btn {
    background: transparent;
    border: none;
    padding: 7px 16px;
    border-radius: 9999px;
    font-size: 13px;
    font-weight: 600;
    color: var(--muted);
    cursor: pointer;
    box-shadow: none;
  }
  .mode-btn.active {
    background: var(--panel-solid);
    color: var(--accent);
    box-shadow: 0 2px 6px rgba(15, 23, 42, 0.08);
  }

  .boost-hero-card {
    padding: 28px 32px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 28px;
    flex-wrap: wrap;
  }
  .boost-hero-left {
    flex: 1 1 400px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .eyebrow {
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--accent);
  }
  .boost-hero-left h2 {
    margin: 0;
    font-size: 23px;
    font-weight: 800;
    letter-spacing: -0.4px;
  }
  .boost-hero-left p {
    margin: 0;
    font-size: 14px;
    line-height: 1.5;
    max-width: 62ch;
  }
  .live-metrics-row {
    display: flex;
    gap: 14px;
    flex-wrap: wrap;
    margin-top: 8px;
  }
  .metric-box {
    background: var(--panel-2);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 10px 16px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .metric-label {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    color: var(--muted);
  }
  .metric-value {
    font-size: 16px;
    font-weight: 800;
  }

  .boost-hero-right {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
  }
  .boost-cta-btn {
    padding: 14px 28px;
    border-radius: 9999px;
    font-size: 15px;
    font-weight: 800;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    box-shadow: 0 8px 22px rgba(16, 185, 129, 0.32);
  }

  .two-col-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 18px;
    align-items: start;
  }
  @media (max-width: 920px) {
    .two-col-grid {
      grid-template-columns: 1fr;
    }
  }
  .section-card {
    padding: 22px 24px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .section-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
  }
  .section-head h3 {
    margin: 0;
    font-size: 16.5px;
    font-weight: 800;
  }
  .section-head p {
    margin: 4px 0 0 0;
  }
  .item-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: 360px;
    overflow-y: auto;
  }
  .item-row {
    padding: 10px 14px;
    border-radius: 10px;
    background: var(--panel-2);
    border: 1px solid var(--border);
    gap: 12px;
  }
  .item-row.dimmed {
    opacity: 0.65;
  }
  .app-title {
    font-size: 13.5px;
    display: block;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .mini-bar {
    height: 6px;
    border-radius: 9999px;
    background: var(--border);
    overflow: hidden;
  }
  .mini-bar-fill {
    height: 100%;
    background: linear-gradient(90deg, #10b981, #059669);
    border-radius: 9999px;
  }
  .sub-row {
    padding: 8px 12px;
    border-radius: 8px;
    background: var(--panel-2);
    border: 1px solid var(--border);
  }
  .empty-box {
    padding: 18px;
    text-align: center;
    background: var(--panel-2);
    border-radius: 10px;
  }
  .small-btn {
    padding: 6px 14px;
    font-size: 12.5px;
    border-radius: 9999px;
  }
  .error-banner {
    padding: 12px 16px;
    border-left: 4px solid var(--danger);
    background: rgba(239, 68, 68, 0.12);
    color: var(--danger);
    font-size: 13.5px;
  }
  .gauge-wrap {
    position: relative;
    width: 150px;
    height: 150px;
    flex-shrink: 0;
  }
  .gauge {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: conic-gradient(
      from 225deg,
      #10b981 0 var(--pct),
      rgba(148, 163, 184, 0.22) var(--pct) 75%,
      transparent 75%
    );
    -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 12px), #000 calc(100% - 11px));
    mask: radial-gradient(farthest-side, transparent calc(100% - 12px), #000 calc(100% - 11px));
    filter: drop-shadow(0 0 10px rgba(16, 185, 129, 0.35));
    transition: background 0.4s ease;
  }
  .gauge.busy {
    background: conic-gradient(
      from 225deg,
      #f59e0b 0 var(--pct),
      rgba(148, 163, 184, 0.22) var(--pct) 75%,
      transparent 75%
    );
  }
  .gauge-lbl {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }
  .gauge-lbl strong {
    font-size: 30px;
    font-weight: 800;
    letter-spacing: -0.5px;
  }
  .gauge-lbl small {
    font-size: 11px;
    color: var(--muted);
  }
  .emerald-banner {
    padding: 12px 16px;
    border-left: 4px solid var(--accent);
    background: var(--accent-light);
    color: var(--text);
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13.5px;
    font-weight: 600;
  }
</style>
