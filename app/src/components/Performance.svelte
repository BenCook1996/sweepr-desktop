<script lang="ts" module>
  import type {
    ContextMenuItem,
    MemoryOverview,
    StartupItem,
    SystemHealthDetails,
  } from "../lib/api";

  let cachedMem: MemoryOverview | null = null;
  let cachedHealth: SystemHealthDetails | null = null;
  let cachedStartup: StartupItem[] = [];
  let cachedContextItems: ContextMenuItem[] = [];
  let cachedActiveTab: "startup" | "processes" | "context" = "startup";
</script>

<script lang="ts">
  import {
    api,
    errorMessage,
    isPaymentRequired,
    requestActivation,
    type GamingBoostResult,
    type LicenseStatus,
  } from "../lib/api";
  import { formatBytes } from "../lib/format";

  let { license = null }: { license?: LicenseStatus | null } = $props();
  let mem = $state<MemoryOverview | null>(cachedMem);
  let health = $state<SystemHealthDetails | null>(cachedHealth);
  let startup = $state<StartupItem[]>(cachedStartup);
  let contextItems = $state<ContextMenuItem[]>(cachedContextItems);
  let activeTab = $state<"startup" | "processes" | "context">(cachedActiveTab);
  let listInteracting = $state(false);
  let toggling = $state<string | null>(null);
  let killingProc = $state<string | null>(null);
  let procNotice = $state<string | null>(null);
  let boosting = $state(false);
  let boostResult = $state<GamingBoostResult | null>(null);
  let error = $state<string | null>(null);

  $effect(() => {
    cachedActiveTab = activeTab;
  });

  function formatUptime(sec: number): string {
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m`;
    return `${Math.max(1, m)}m`;
  }

  async function load() {
    try {
      const [m, s, h, c] = await Promise.all([
        api.memory(),
        api.startupItems(),
        api.systemHealthDetails().catch(() => null),
        api.listContextMenuItems().catch(() => []),
      ]);
      mem = m;
      startup = s;
      health = h;
      contextItems = c;
      cachedMem = m;
      cachedStartup = s;
      cachedHealth = h;
      cachedContextItems = c;
    } catch (e) {
      error = errorMessage(e);
    }
  }

  async function runGamingBoost() {
    error = null;
    boosting = true;
    try {
      boostResult = await api.boostGamingMode();
      mem = await api.memory();
      cachedMem = mem;
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

  async function killProc(name: string) {
    if (
      !confirm(
        `End all running instances of "${name}"?\n\nAny unsaved work in ${name} may be lost.`
      )
    ) {
      return;
    }
    error = null;
    procNotice = null;
    killingProc = name;
    try {
      const killed = await api.killProcess(name);
      procNotice = `Ended ${killed} process instance(s) for ${name}.`;
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

  async function toggleItem(item: StartupItem) {
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

  async function toggleContext(item: ContextMenuItem) {
    if (!license?.active) {
      requestActivation();
      return;
    }
    error = null;
    toggling = item.id;
    try {
      contextItems = await api.toggleContextMenuItem(item.id, !item.enabled);
      cachedContextItems = contextItems;
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

  $effect(() => {
    load();
    const timer = setInterval(() => {
      if (activeTab === "processes" && listInteracting) {
        return;
      }
      api
        .memory()
        .then((m) => {
          mem = m;
          cachedMem = m;
        })
        .catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  });

  const usedPct = $derived(mem ? Math.round((mem.used_bytes / mem.total_bytes) * 100) : 0);
  const maxApp = $derived(mem?.top_apps[0]?.bytes ?? 1);
</script>

<div class="perf-layout">
  <div class="header-row">
    <div>
      <h1 class="page-title">Speed, Startup & Processes</h1>
      <p class="muted small" style="margin: 4px 0 0 0;">
        Free up active memory in one click, manage apps that launch when Windows starts, and close heavy background tasks.
      </p>
    </div>
  </div>

  {#if error}<div class="card error-banner">{error}</div>{/if}
  {#if procNotice}<div class="card emerald-banner">{procNotice}</div>{/if}
  {#if boostResult}
    <div class="card emerald-banner">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
      <strong>Speed Boost Complete:</strong>
      <span>Closed {boostResult.processes_closed} background process(es) · Freed {formatBytes(boostResult.bytes_freed)}</span>
      {#if boostResult.closed_apps.length > 0}
        <span class="muted small">({boostResult.closed_apps.join(", ")})</span>
      {/if}
    </div>
  {/if}

  {#if mem}
    <div class="top-stats-grid">
      <!-- 1. RAM In Use -->
      <div class="card stat">
        <div class="row" style="justify-content: space-between;">
          <span class="field-label">LIVE MEMORY</span>
          {#if usedPct > 85}
            <span class="badge pro">High Load ({usedPct}%)</span>
          {:else}
            <span class="badge free">Healthy ({usedPct}%)</span>
          {/if}
        </div>
        <div class="value">
          {formatBytes(mem.used_bytes)}
          <span class="muted small" style="font-weight: 500;">/ {formatBytes(mem.total_bytes)}</span>
        </div>
        <div class="bar"><div class:hot={usedPct > 85} style="width:{usedPct}%"></div></div>
        <div class="muted small">{formatBytes(mem.available_bytes)} available right now</div>
      </div>

      <!-- 2. Boot & System Uptime -->
      <div class="card stat">
        <div class="row" style="justify-content: space-between;">
          <span class="field-label">BOOT & SYSTEM HEALTH</span>
          <div class="row" style="gap: 6px;">
            {#if health?.battery_percent !== null && health?.battery_percent !== undefined}
              <span class="badge free" title="Laptop Battery Status">
                {health.battery_percent}% {health.battery_status ? `· ${health.battery_status}` : ""}
              </span>
            {/if}
            <span class="badge free">{health?.is_ssd !== false ? "SSD / NVMe" : "HDD"}</span>
          </div>
        </div>
        <div class="value">
          {#if health?.last_boot_seconds}
            {health.last_boot_seconds.toFixed(1)}s <span class="muted small" style="font-weight: 500;">boot time</span>
          {:else}
            {health ? formatUptime(health.uptime_seconds) : "—"} <span class="muted small" style="font-weight: 500;">uptime</span>
          {/if}
        </div>
        <div class="muted small">
          {#if health}
            Uptime: <strong>{formatUptime(health.uptime_seconds)}</strong> · {startup.filter((s) => s.enabled !== false).length} active startup apps
          {:else}
            Reading system telemetry…
          {/if}
        </div>
      </div>

      <!-- 3. 1-Click Speed & Gaming Boost -->
      <div class="card stat boost-card">
        <div class="row" style="justify-content: space-between;">
          <span class="field-label">1-CLICK RAM OPTIMIZER</span>
          <span class="badge free">Instant</span>
        </div>
        <div class="muted small" style="line-height: 1.45;">
          Suspends idle background updaters, tray helpers, and telemetry services to free memory immediately.
        </div>
        <div style="margin-top: auto; padding-top: 6px;">
          <button class="primary boost-btn" disabled={boosting} onclick={runGamingBoost}>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
            <span>{boosting ? "Boosting Memory…" : "Boost RAM & Gaming Mode"}</span>
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Unified Segmented Workspace -->
  <div class="card workspace-card">
    <div class="workspace-header">
      <div class="pill-bar" role="tablist">
        <button
          class="pill-btn"
          class:active={activeTab === "startup"}
          onclick={() => (activeTab = "startup")}
          role="tab"
          aria-selected={activeTab === "startup"}
        >
          Startup Apps ({startup.length})
        </button>
        <button
          class="pill-btn"
          class:active={activeTab === "processes"}
          onclick={() => (activeTab = "processes")}
          role="tab"
          aria-selected={activeTab === "processes"}
        >
          Active Memory Processes ({mem?.top_apps.length ?? 0})
        </button>
        <button
          class="pill-btn"
          class:active={activeTab === "context"}
          onclick={() => (activeTab = "context")}
          role="tab"
          aria-selected={activeTab === "context"}
        >
          Right-Click Menu ({contextItems.length})
        </button>
      </div>

      <span class="muted small">
        {#if activeTab === "startup"}
          Apps that launch automatically at Windows sign-in
        {:else if activeTab === "processes"}
          Top applications currently using RAM ({listInteracting ? "paused while hovering" : "refreshes every 3s"})
        {:else}
          Third-party items added to the Windows Explorer right-click menu
        {/if}
      </span>
    </div>

    <div
      class="table-body"
      role="region"
      aria-label="Optimization items list"
      onmouseenter={() => (listInteracting = true)}
      onmouseleave={() => (listInteracting = false)}
      onfocusin={() => (listInteracting = true)}
      onfocusout={() => (listInteracting = false)}
    >
      {#if activeTab === "startup"}
        {#each startup as s (s.name + s.scope)}
          {@const isEnabled = s.enabled ?? true}
          {@const impact = s.impact ?? "Low"}
          {@const canToggle = s.scope === "Current user" || s.scope.includes("HKCU")}
          <div class="row line" class:disabled-row={!isEnabled}>
            <div class="item-primary">
              <strong class="item-name" title={s.name}>{s.name}</strong>
              <span class="mono muted small cmd" title={s.command}>{s.command}</span>
            </div>
            <span class="badge">{s.scope}</span>
            <span
              class="badge"
              class:pro={impact === "High" || impact === "Medium"}
              class:free={impact === "Low"}
              title="Estimated boot impact"
            >
              {impact} Impact
            </span>
            {#if canToggle}
              {#if !license?.active}
                <span class="badge pro">Pro</span>
              {/if}
              <button
                class={isEnabled ? "ghost small-btn" : "primary small-btn"}
                disabled={toggling === s.name}
                onclick={() => toggleItem(s)}
                aria-label={`${isEnabled ? "Disable" : "Enable"} ${s.name} at startup`}
              >
                {toggling === s.name ? "…" : isEnabled ? "Disable" : "Enable"}
              </button>
            {:else}
              <span class="muted small" style="min-width: 74px; text-align: right;">System</span>
            {/if}
          </div>
        {:else}
          <div class="muted empty-row">No startup items found.</div>
        {/each}

      {:else if activeTab === "processes"}
        {#if mem && mem.top_apps.length > 0}
          {#each mem.top_apps as a (a.name)}
            <div class="row line">
              <span class="proc-name" title={a.name}><strong>{a.name}</strong></span>
              <span class="muted small" style="min-width: 64px;">{a.processes} {a.processes === 1 ? "process" : "processes"}</span>
              <div class="mini"><div style="width:{(a.bytes / maxApp) * 100}%"></div></div>
              <strong class="mono" style="min-width: 84px; text-align: right; color: var(--accent);">{formatBytes(a.bytes)}</strong>
              <button
                class="ghost small-btn"
                disabled={killingProc === a.name}
                onclick={() => killProc(a.name)}
                title={`End ${a.name}`}
              >
                {killingProc === a.name ? "Ending…" : "End Task"}
              </button>
            </div>
          {/each}
        {:else}
          <div class="muted empty-row">Loading active processes…</div>
        {/if}

      {:else}
        {#each contextItems as item (item.id)}
          <div class="row line" class:disabled-row={!item.enabled}>
            <div class="item-primary">
              <strong class="item-name" title={item.name}>{item.name}</strong>
              <span class="mono muted small cmd" title={item.command}>{item.command}</span>
            </div>
            <span class="badge">{item.scope}</span>
            {#if !license?.active}
              <span class="badge pro">Pro</span>
            {/if}
            <button
              class={item.enabled ? "ghost small-btn" : "primary small-btn"}
              disabled={toggling === item.id}
              onclick={() => toggleContext(item)}
            >
              {toggling === item.id ? "…" : item.enabled ? "Disable" : "Enable"}
            </button>
          </div>
        {:else}
          <div class="muted empty-row">No custom right-click context menu extensions detected.</div>
        {/each}
      {/if}
    </div>
  </div>
</div>

<style>
  .perf-layout {
    max-width: 1240px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 18px;
    padding-bottom: 36px;
  }
  .header-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
  }
  .page-title {
    margin: 0;
    font-size: 24px;
    font-weight: 800;
    letter-spacing: -0.5px;
  }
  .field-label {
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.6px;
    color: var(--muted);
  }
  .top-stats-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16px;
  }
  @media (max-width: 960px) {
    .top-stats-grid {
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    }
  }
  .stat {
    padding: 18px 20px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .boost-card {
    background: linear-gradient(180deg, var(--panel-solid) 0%, var(--accent-light) 100%);
    border-color: rgba(16, 185, 129, 0.28);
  }
  .boost-btn {
    width: 100%;
    padding: 9px 14px;
    font-size: 13px;
    border-radius: 9999px;
  }
  .value {
    font-size: 24px;
    font-weight: 800;
    color: var(--text);
    letter-spacing: -0.5px;
  }
  .bar {
    height: 8px;
    background: var(--panel-2);
    border-radius: 99px;
    overflow: hidden;
  }
  .bar > div {
    height: 100%;
    background: var(--accent);
  }
  .bar > div.hot {
    background: var(--warn);
  }
  .workspace-card {
    padding: 0;
    overflow: hidden;
  }
  .workspace-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border);
    background: var(--panel-2);
  }
  .pill-bar {
    display: flex;
    gap: 4px;
    background: var(--panel-solid);
    padding: 4px;
    border-radius: 9999px;
    border: 1px solid var(--border);
  }
  .pill-btn {
    background: transparent;
    border: none;
    padding: 6px 16px;
    border-radius: 9999px;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--muted);
    cursor: pointer;
    box-shadow: none;
  }
  .pill-btn:hover {
    color: var(--text);
    background: transparent;
  }
  .pill-btn.active {
    background: var(--accent-light);
    color: var(--accent);
    font-weight: 700;
  }
  .table-body {
    display: flex;
    flex-direction: column;
  }
  .line {
    padding: 11px 20px;
    border-bottom: 1px solid var(--border);
    gap: 14px;
  }
  .line:last-child {
    border-bottom: none;
  }
  .disabled-row {
    opacity: 0.6;
  }
  .item-primary {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .item-name {
    font-size: 14px;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .proc-name {
    width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text);
  }
  .mini {
    flex: 1;
    height: 6px;
    background: var(--panel-2);
    border-radius: 99px;
    overflow: hidden;
  }
  .mini > div {
    height: 100%;
    background: var(--accent);
  }
  .cmd {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .empty-row {
    padding: 28px 20px;
    text-align: center;
  }
  .small-btn {
    padding: 5px 14px;
    font-size: 12px;
    border-radius: 9999px;
  }
  .error-banner {
    padding: 10px 14px;
    border-left: 4px solid var(--danger);
    color: var(--danger);
  }
  .emerald-banner {
    padding: 11px 16px;
    border-left: 4px solid var(--accent);
    background: var(--accent-light);
    color: var(--text);
    font-size: 13px;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
</style>
