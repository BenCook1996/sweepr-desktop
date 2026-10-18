<script lang="ts">
  import {
    api,
    errorMessage,
    isPaymentRequired,
    requestActivation,
    type ContextMenuItem,
    type GamingBoostResult,
    type LicenseStatus,
    type MemoryOverview,
    type StartupItem,
    type SystemHealthDetails,
  } from "../lib/api";
  import { formatBytes } from "../lib/format";

  let { license = null }: { license?: LicenseStatus | null } = $props();
  let mem = $state<MemoryOverview | null>(null);
  let health = $state<SystemHealthDetails | null>(null);
  let startup = $state<StartupItem[]>([]);
  let contextItems = $state<ContextMenuItem[]>([]);
  let bottomTab = $state<"startup" | "context">("startup");
  let toggling = $state<string | null>(null);
  let killingProc = $state<string | null>(null);
  let procNotice = $state<string | null>(null);
  let boosting = $state(false);
  let boostResult = $state<GamingBoostResult | null>(null);
  let error = $state<string | null>(null);

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
    error = null;
    procNotice = null;
    killingProc = name;
    try {
      const killed = await api.killProcess(name);
      procNotice = `Ended ${killed} process instance(s) for ${name}.`;
      mem = await api.memory();
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
    const t = setInterval(() => api.memory().then((m) => (mem = m)).catch(() => {}), 3000);
    return () => clearInterval(t);
  });

  const usedPct = $derived(mem ? Math.round((mem.used_bytes / mem.total_bytes) * 100) : 0);
  const maxApp = $derived(mem?.top_apps[0]?.bytes ?? 1);
</script>

<h1>RAM, Processes & Boot Performance</h1>
<p class="muted">Monitor live RAM consumption, boost gaming & focus sessions by suspending background updaters, and control Windows sign-in & right-click shell extensions.</p>

{#if error}<div class="card error-banner">{error}</div>{/if}
{#if procNotice}<div class="card emerald-banner">{procNotice}</div>{/if}
{#if boostResult}
  <div class="card emerald-banner">
    <strong>Gaming & Focus Boost Complete:</strong> Closed {boostResult.processes_closed} background processes · Freed {formatBytes(boostResult.bytes_freed)}
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
        <div class="muted small">RAM In Use</div>
        {#if usedPct > 85}
          <span class="badge pro">High Pressure</span>
        {:else}
          <span class="badge free">Healthy</span>
        {/if}
      </div>
      <div class="value">{formatBytes(mem.used_bytes)} <span class="muted small">of {formatBytes(mem.total_bytes)}</span></div>
      <div class="bar"><div class:hot={usedPct > 85} style="width:{usedPct}%"></div></div>
      <div class="muted small">{usedPct}% used · {formatBytes(mem.available_bytes)} available</div>
    </div>

    <!-- 2. Boot & System Uptime -->
    <div class="card stat">
      <div class="row" style="justify-content: space-between;">
        <div class="muted small">Boot & System Uptime</div>
        <div class="row" style="gap: 6px;">
          {#if health?.battery_percent !== null && health?.battery_percent !== undefined}
            <span class="badge free" title="Laptop Battery Status">
              🔋 {health.battery_percent}% {health.battery_status ? `· ${health.battery_status}` : ""}
            </span>
          {/if}
          <span class="badge free">{health?.is_ssd !== false ? "SSD / NVMe" : "HDD Drive"}</span>
        </div>
      </div>
      <div class="value">
        {#if health?.last_boot_seconds}
          {health.last_boot_seconds.toFixed(1)}s <span class="muted small">last boot</span>
        {:else}
          {health ? formatUptime(health.uptime_seconds) : "—"} <span class="muted small">uptime</span>
        {/if}
      </div>
      <div class="muted small">
        {#if health}
          System uptime: <strong>{formatUptime(health.uptime_seconds)}</strong> · {startup.filter((s) => s.enabled !== false).length} active startup apps
        {:else}
          Analyzing boot telemetry…
        {/if}
      </div>
    </div>

    <!-- 3. Gaming & Focus Boost -->
    <div class="card stat boost-card">
      <div class="row" style="justify-content: space-between;">
        <div class="muted small">Gaming & Focus Boost</div>
        <span class="badge free">1-Click Optimizer</span>
      </div>
      <div class="muted small" style="line-height: 1.4;">
        Safely closes background updaters, telemetry helpers, and idle tray widgets to free RAM before gaming or deep work.
      </div>
      <div style="margin-top: auto; padding-top: 6px;">
        <button class="primary boost-btn" disabled={boosting} onclick={runGamingBoost}>
          {boosting ? "Boosting RAM…" : "⚡ Boost RAM & Gaming Mode"}
        </button>
      </div>
    </div>
  </div>

  <h3>Top apps by memory</h3>
  <div class="card table">
    {#each mem.top_apps as a}
      <div class="row line">
        <span class="name" title={a.name}><strong>{a.name}</strong></span>
        <span class="muted small" style="min-width: 58px;">{a.processes} proc</span>
        <div class="mini"><div style="width:{(a.bytes / maxApp) * 100}%"></div></div>
        <span class="mono" style="min-width: 78px; text-align: right;">{formatBytes(a.bytes)}</span>
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
  </div>
{/if}

<div class="bottom-header">
  <div class="pill-bar" role="tablist">
    <button
      class="pill-btn"
      class:active={bottomTab === "startup"}
      onclick={() => (bottomTab = "startup")}
      role="tab"
      aria-selected={bottomTab === "startup"}
    >
      Startup Apps ({startup.length})
    </button>
    <button
      class="pill-btn"
      class:active={bottomTab === "context"}
      onclick={() => (bottomTab = "context")}
      role="tab"
      aria-selected={bottomTab === "context"}
    >
      Right-Click Context Menu ({contextItems.length})
    </button>
  </div>
</div>

{#if bottomTab === "startup"}
  <p class="muted small" style="margin: 0 0 10px 0;">
    Apps that launch when you sign in. Toggle HKCU (Current user) startup apps on or off with automatic Registry backup.
  </p>
  <div class="card table">
    {#each startup as s}
      {@const isEnabled = s.enabled ?? true}
      {@const impact = s.impact ?? "Low"}
      {@const canToggle = s.scope === "Current user" || s.scope.includes("HKCU")}
      <div class="row line" class:disabled-row={!isEnabled}>
        <span class="name" title={s.name}><strong>{s.name}</strong></span>
        <span class="badge">{s.scope}</span>
        <span
          class="badge"
          class:pro={impact === "High" || impact === "Medium"}
          class:free={impact === "Low"}
          title="Estimated boot impact"
        >
          {impact} Impact
        </span>
        <span class="mono cmd" title={s.command}>{s.command}</span>
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
          <span class="muted small">System (HKLM)</span>
        {/if}
      </div>
    {:else}
      <div class="muted line">No startup items found.</div>
    {/each}
  </div>
{:else}
  <p class="muted small" style="margin: 0 0 10px 0;">
    Manage third-party shell extensions added to the Windows Explorer right-click menu.
  </p>
  <div class="card table">
    {#each contextItems as item}
      <div class="row line" class:disabled-row={!item.enabled}>
        <span class="name" title={item.name}><strong>{item.name}</strong></span>
        <span class="badge">{item.scope}</span>
        <span class="mono cmd" title={item.command}>{item.command}</span>
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
      <div class="muted line">No custom right-click context menu extensions detected.</div>
    {/each}
  </div>
{/if}

<style>
  h1 { margin: 0 0 6px; font-size: 24px; color: var(--text); }
  h3 { margin: 24px 0 10px; color: var(--text); }
  .top-stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 14px;
    margin-top: 18px;
  }
  .stat { padding: 16px 18px; display: flex; flex-direction: column; gap: 8px; }
  .boost-card { background: linear-gradient(180deg, var(--panel-solid) 0%, var(--accent-light) 100%); border-color: rgba(16, 185, 129, 0.28); }
  .boost-btn { width: 100%; padding: 8px 14px; font-size: 13px; border-radius: 9999px; }
  .value { font-size: 22px; font-weight: 700; color: var(--text); }
  .bar { height: 8px; background: var(--panel-2); border-radius: 99px; overflow: hidden; }
  .bar > div { height: 100%; background: var(--accent); }
  .bar > div.hot { background: var(--warn); }
  .table { padding: 6px 0; }
  .line { padding: 8px 16px; border-bottom: 1px solid var(--border); gap: 12px; }
  .line:last-child { border-bottom: none; }
  .disabled-row { opacity: 0.6; }
  .name { width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); }
  .mini { flex: 1; height: 6px; background: var(--panel-2); border-radius: 99px; overflow: hidden; }
  .mini > div { height: 100%; background: #2a9df4; }
  .cmd { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); }
  .small-btn { padding: 4px 12px; font-size: 12px; border-radius: 9999px; }
  .error-banner { padding: 10px 14px; border-left: 4px solid var(--danger); color: var(--danger); margin-bottom: 12px; }
  .emerald-banner { padding: 11px 16px; border-left: 4px solid var(--accent); background: var(--accent-light); color: var(--text); margin-bottom: 12px; font-size: 13.5px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .bottom-header { margin: 26px 0 10px; display: flex; align-items: center; }
  .pill-bar { display: flex; gap: 4px; background: var(--panel-2); padding: 4px; border-radius: 9999px; border: 1px solid var(--border); }
  .pill-btn { background: transparent; border: none; padding: 6px 16px; border-radius: 9999px; font-size: 12.5px; font-weight: 600; color: var(--muted); cursor: pointer; box-shadow: none; }
  .pill-btn:hover { color: var(--text); background: transparent; }
  .pill-btn.active { background: var(--panel-solid); color: var(--accent); box-shadow: 0 2px 6px rgba(15, 23, 42, 0.08); }
</style>
