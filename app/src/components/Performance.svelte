<script lang="ts">
  import {
    api,
    errorMessage,
    isPaymentRequired,
    requestActivation,
    type LicenseStatus,
    type MemoryOverview,
    type StartupItem,
  } from "../lib/api";
  import { formatBytes } from "../lib/format";

  let { license = null }: { license?: LicenseStatus | null } = $props();
  let mem = $state<MemoryOverview | null>(null);
  let startup = $state<StartupItem[]>([]);
  let toggling = $state<string | null>(null);
  let error = $state<string | null>(null);

  async function load() {
    try {
      [mem, startup] = await Promise.all([api.memory(), api.startupItems()]);
    } catch (e) {
      error = errorMessage(e);
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

  $effect(() => {
    load();
    const t = setInterval(() => api.memory().then((m) => (mem = m)).catch(() => {}), 3000);
    return () => clearInterval(t);
  });

  const usedPct = $derived(mem ? Math.round((mem.used_bytes / mem.total_bytes) * 100) : 0);
  const maxApp = $derived(mem?.top_apps[0]?.bytes ?? 1);
</script>

<h1>Memory & Startup Performance</h1>
<p class="muted">See what's using your RAM and manage apps that launch at Windows sign-in. We don't "purge" memory: modern systems use free RAM as cache, and clearing it usually makes things slower.</p>

{#if error}<div class="card error-banner">{error}</div>{/if}

{#if mem}
  <div class="grid" class:has-tip={usedPct > 85}>
    <div class="card stat">
      <div class="muted small">In use</div>
      <div class="value">{formatBytes(mem.used_bytes)} <span class="muted small">of {formatBytes(mem.total_bytes)}</span></div>
      <div class="bar"><div class:hot={usedPct > 85} style="width:{usedPct}%"></div></div>
      <div class="muted small">{usedPct}% used · {formatBytes(mem.available_bytes)} available</div>
    </div>
    {#if usedPct > 85}
      <div class="card stat">
        <div class="muted small">Tip</div>
        <div>Memory is under pressure. Closing the top apps below will help most.</div>
      </div>
    {/if}
  </div>

  <h3>Top apps by memory</h3>
  <div class="card table">
    {#each mem.top_apps as a}
      <div class="row line">
        <span class="name">{a.name}</span>
        <span class="muted small">{a.processes} proc</span>
        <div class="mini"><div style="width:{(a.bytes / maxApp) * 100}%"></div></div>
        <span class="mono">{formatBytes(a.bytes)}</span>
      </div>
    {/each}
  </div>
{/if}

<h3>Startup items <span class="muted small">({startup.length})</span></h3>
<p class="muted small">Apps that launch when you sign in. Toggle HKCU (Current user) startup apps on or off with automatic Registry backup.</p>
<div class="card table">
  {#each startup as s}
    {@const isEnabled = s.enabled ?? true}
    {@const impact = s.impact ?? "Low"}
    {@const canToggle = s.scope === "Current user" || s.scope.includes("HKCU")}
    <div class="row line" class:disabled-row={!isEnabled}>
      <span class="name"><strong>{s.name}</strong></span>
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

<style>
  h1 { margin: 0 0 6px; font-size: 24px; }
  h3 { margin: 26px 0 10px; }
  .grid { display: grid; grid-template-columns: 1fr; gap: 12px; margin-top: 18px; }
  .grid.has-tip { grid-template-columns: 1fr 1fr; }
  .stat { padding: 16px; display: flex; flex-direction: column; gap: 8px; }
  .value { font-size: 22px; font-weight: 700; }
  .bar { height: 8px; background: var(--panel-2); border-radius: 99px; overflow: hidden; }
  .bar > div { height: 100%; background: var(--accent); }
  .bar > div.hot { background: var(--warn); }
  .table { padding: 6px 0; }
  .line { padding: 8px 16px; border-bottom: 1px solid var(--border); }
  .line:last-child { border-bottom: none; }
  .disabled-row { opacity: 0.6; }
  .name { width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mini { flex: 1; height: 6px; background: var(--panel-2); border-radius: 99px; overflow: hidden; }
  .mini > div { height: 100%; background: #2a9df4; }
  .cmd { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); }
  .small-btn { padding: 4px 12px; font-size: 12px; }
  .error-banner { padding: 10px 14px; border-left: 4px solid var(--danger); color: var(--danger); margin-bottom: 12px; }
</style>
