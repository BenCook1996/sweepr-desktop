<script lang="ts">
  import { api, errorMessage, type MemoryOverview, type StartupItem } from "../lib/api";
  import { formatBytes } from "../lib/format";

  let mem = $state<MemoryOverview | null>(null);
  let startup = $state<StartupItem[]>([]);
  let error = $state<string | null>(null);

  async function load() {
    try {
      [mem, startup] = await Promise.all([api.memory(), api.startupItems()]);
    } catch (e) {
      error = errorMessage(e);
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

<h1>Memory insights</h1>
<p class="muted">See what's using your RAM and what starts with your computer. We don't "purge" memory: modern systems use free RAM as cache, and clearing it usually makes things slower.</p>

{#if error}<div class="error-banner">{error}</div>{/if}

{#if mem}
  <div class="grid">
    <div class="card stat">
      <div class="muted small">In use</div>
      <div class="value">{formatBytes(mem.used_bytes)} <span class="muted small">of {formatBytes(mem.total_bytes)}</span></div>
      <div class="bar"><div class:hot={usedPct > 85} style="width:{usedPct}%"></div></div>
      <div class="muted small">{usedPct}% used · {formatBytes(mem.available_bytes)} available</div>
    </div>
    <div class="card stat">
      <div class="muted small">Tip</div>
      <div>{usedPct > 85 ? "Memory is under pressure. Closing the top apps below will help most." : "Memory looks healthy. No action needed."}</div>
    </div>
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
<p class="muted small">Apps that launch when you sign in. Fewer startup apps means faster boot and more free memory. You can disable them in your OS settings (Task Manager → Startup apps on Windows).</p>
<div class="card table">
  {#each startup as s}
    <div class="row line">
      <span class="name">{s.name}</span>
      <span class="badge">{s.scope}</span>
      <span class="mono cmd" title={s.command}>{s.command}</span>
    </div>
  {:else}
    <div class="muted line">No startup items found.</div>
  {/each}
</div>

<style>
  h1 { margin: 0 0 6px; font-size: 24px; }
  h3 { margin: 26px 0 10px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 18px; }
  .stat { padding: 16px; display: flex; flex-direction: column; gap: 8px; }
  .value { font-size: 22px; font-weight: 700; }
  .bar { height: 8px; background: var(--panel-2); border-radius: 99px; overflow: hidden; }
  .bar > div { height: 100%; background: var(--accent); }
  .bar > div.hot { background: var(--warn); }
  .table { padding: 6px 0; }
  .line { padding: 8px 16px; border-bottom: 1px solid var(--border); }
  .line:last-child { border-bottom: none; }
  .name { width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mini { flex: 1; height: 6px; background: var(--panel-2); border-radius: 99px; overflow: hidden; }
  .mini > div { height: 100%; background: #2a9df4; }
  .cmd { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); }
</style>
