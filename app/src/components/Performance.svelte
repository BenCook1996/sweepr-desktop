<script lang="ts" module>
  import type {
    BatteryDiagnostics,
    BrowserMemoryReport,
    ContextMenuItem,
    MemoryOverview,
    StartupItem,
    TabSessionSnapshot,
  } from "../lib/api";

  let cachedMem: MemoryOverview | null = null;
  let cachedBrowserReport: BrowserMemoryReport | null = null;
  let cachedTabSessions: TabSessionSnapshot[] = [];
  let cachedStartup: StartupItem[] = [];
  let cachedContextMenu: ContextMenuItem[] = [];
  let cachedBattery: BatteryDiagnostics | null = null;
</script>

<script lang="ts">
  import {
    api,
    errorMessage,
    isPaymentRequired,
    requestActivation,
    type AppInfo,
    type LicenseStatus,
  } from "../lib/api";
  import { formatBytes } from "../lib/format";
  import { lang, t } from "../lib/i18n";

  let {
    license = null,
    info = null,
    viewMode = $bindable<"pc" | "battery">("pc"),
  }: {
    license?: LicenseStatus | null;
    info?: AppInfo | null;
    viewMode?: "pc" | "battery";
  } = $props();

  let mem = $state<MemoryOverview | null>(cachedMem);
  let browserReport = $state<BrowserMemoryReport | null>(cachedBrowserReport);
  let tabSessions = $state<TabSessionSnapshot[]>(cachedTabSessions);
  let startup = $state<StartupItem[]>(cachedStartup);
  let contextMenuItems = $state<ContextMenuItem[]>(cachedContextMenu);
  let diag = $state<BatteryDiagnostics | null>(cachedBattery);

  let boosting = $state(false);
  let boostNotice = $state<string | null>(null);
  let toggling = $state<string | null>(null);
  let busyAutopilot = $state<string | null>(null);
  let killingProc = $state<string | null>(null);
  let confirmKillProc = $state<string | null>(null);
  let restoringSession = $state<string | null>(null);
  let savingTabs = $state(false);
  let deletingSession = $state<string | null>(null);
  let error = $state<string | null>(null);

  const isPro = $derived(!!license && (license.dev_unlock || license.active));
  const hasBatteryCareAddon = $derived(
    Boolean(
      license?.dev_unlock ||
        license?.addons?.some((a) => a.toLowerCase() === "battery_care")
    )
  );
  const usedPct = $derived(mem ? Math.round((mem.used_bytes / mem.total_bytes) * 100) : 0);
  const topFiveApps = $derived(mem ? mem.top_apps.slice(0, 5) : []);
  const toggleableStartup = $derived(
    startup.filter((s) => s.scope === "Current user" || s.scope.includes("HKCU"))
  );

  async function unlockBatteryAddon() {
    error = null;
    if (isPro) {
      try {
        await api.startAddonCheckout("battery_care");
      } catch {
        requestActivation();
      }
    } else {
      requestActivation();
    }
  }

  async function load() {
    try {
      const [m, b, ts, s, cm, bat] = await Promise.all([
        api.memory(),
        api.browserMemoryReport().catch(() => null),
        api.listTabSessions().catch(() => []),
        api.startupItems(),
        api.listContextMenuItems().catch(() => []),
        api.batteryDiagnostics().catch(() => null),
      ]);
      mem = m;
      browserReport = b;
      tabSessions = ts;
      startup = s;
      contextMenuItems = cm;
      diag = bat;
      cachedMem = m;
      cachedBrowserReport = b;
      cachedTabSessions = ts;
      cachedStartup = s;
      cachedContextMenu = cm;
      cachedBattery = bat;
    } catch (e) {
      error = errorMessage(e);
    }
  }

  async function toggleContextMenu(item: ContextMenuItem, evt?: Event) {
    const input = evt?.currentTarget as HTMLInputElement | undefined;
    if (!isPro) {
      if (input) input.checked = item.enabled;
      requestActivation();
      return;
    }
    error = null;
    try {
      contextMenuItems = await api.toggleContextMenuItem(item.id, !item.enabled);
      cachedContextMenu = contextMenuItems;
    } catch (e) {
      if (input) input.checked = item.enabled;
      if (isPaymentRequired(e)) requestActivation();
      else error = errorMessage(e);
    }
  }

  async function runOneClickSpeedBoost() {
    error = null;
    boostNotice = null;
    boosting = true;
    try {
      const boostRes = await api.boostGamingMode();
      let totalFreed = boostRes.bytes_freed;

      if (isPro && browserReport && browserReport.total_browser_bytes > 0) {
        try {
          const tameRes = await api.tameBrowserMemory(null, true);
          totalFreed += tameRes.bytes_freed;
        } catch {
          // Ignore optional browser tame error
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

      boostNotice =
        totalFreed > 0
          ? `Freed ${formatBytes(totalFreed)} of memory`
          : "Memory sped up";
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

  async function toggleChargeLimit(enabled: boolean, evt?: Event) {
    const input = evt?.currentTarget as HTMLInputElement | undefined;
    const prev = diag?.config.charge_limit_enabled ?? false;
    if (enabled && !hasBatteryCareAddon) {
      if (input) input.checked = prev;
      await unlockBatteryAddon();
      return;
    }
    busyAutopilot = "limit";
    error = null;
    try {
      const cfg = await api.setBatteryChargeLimit(enabled, 80);
      if (diag) {
        diag.config = cfg;
        cachedBattery = diag;
      }
    } catch (e) {
      if (input) input.checked = prev;
      if (isPaymentRequired(e)) await unlockBatteryAddon();
      else error = errorMessage(e);
    } finally {
      busyAutopilot = null;
    }
  }

  async function toggleThermal(enabled: boolean, evt?: Event) {
    const input = evt?.currentTarget as HTMLInputElement | undefined;
    const prev = diag?.config.thermal_throttling_enabled ?? false;
    if (enabled && !hasBatteryCareAddon) {
      if (input) input.checked = prev;
      await unlockBatteryAddon();
      return;
    }
    busyAutopilot = "thermal";
    error = null;
    try {
      const r = await api.setBatteryThermalThrottling(enabled);
      if (diag) {
        diag.config.thermal_throttling_enabled = r.enabled;
        cachedBattery = diag;
      }
    } catch (e) {
      if (input) input.checked = prev;
      if (isPaymentRequired(e)) await unlockBatteryAddon();
      else error = errorMessage(e);
    } finally {
      busyAutopilot = null;
    }
  }

  async function toggleSleepTabs(enabled: boolean, evt?: Event) {
    const input = evt?.currentTarget as HTMLInputElement | undefined;
    const prev = diag?.config.auto_hibernate_tabs ?? false;
    if (enabled && !hasBatteryCareAddon) {
      if (input) input.checked = prev;
      await unlockBatteryAddon();
      return;
    }
    busyAutopilot = "tabs";
    error = null;
    try {
      const r = await api.hibernateBrowserTabs(enabled);
      if (diag) {
        diag.config.auto_hibernate_tabs = r.auto_enabled;
        cachedBattery = diag;
      }
      if (r.bytes_freed > 0) {
        boostNotice = `Freed ${formatBytes(r.bytes_freed)}`;
      }
    } catch (e) {
      if (input) input.checked = prev;
      if (isPaymentRequired(e)) await unlockBatteryAddon();
      else error = errorMessage(e);
    } finally {
      busyAutopilot = null;
    }
  }

  async function toggleStartupApp(item: StartupItem, evt?: Event) {
    const input = evt?.currentTarget as HTMLInputElement | undefined;
    const prev = item.enabled ?? true;
    if (!isPro) {
      if (input) input.checked = prev;
      requestActivation();
      return;
    }
    error = null;
    toggling = item.name;
    try {
      const nextEnabled = !prev;
      startup = await api.toggleStartupItem(item.name, item.scope, nextEnabled);
      cachedStartup = startup;
    } catch (e) {
      if (input) input.checked = prev;
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
    killingProc = name;
    try {
      await api.killProcess(name);
      mem = await api.memory();
      cachedMem = mem;
    } catch (e) {
      if (isPaymentRequired(e)) requestActivation();
      else error = errorMessage(e);
    } finally {
      killingProc = null;
    }
  }

  async function restoreSession(snap: TabSessionSnapshot) {
    if (!isPro) {
      requestActivation();
      return;
    }
    error = null;
    restoringSession = snap.id;
    try {
      await api.restoreTabSession(snap.id);
      boostNotice = "Tabs restored";
    } catch (e) {
      if (isPaymentRequired(e)) requestActivation();
      else error = errorMessage(e);
    } finally {
      restoringSession = null;
    }
  }

  async function saveTabsNow() {
    if (!isPro) {
      requestActivation();
      return;
    }
    error = null;
    savingTabs = true;
    try {
      const saved = await api.backupTabSessions();
      tabSessions = await api.listTabSessions().catch(() => saved);
      cachedTabSessions = tabSessions;
      boostNotice = saved.length > 0 ? `Saved ${saved.length} browser tab session(s)` : "No open browser tab sessions found";
    } catch (e) {
      if (isPaymentRequired(e)) requestActivation();
      else error = errorMessage(e);
    } finally {
      savingTabs = false;
    }
  }

  async function removeTabSession(id: string) {
    error = null;
    deletingSession = id;
    try {
      await api.deleteTabSession(id);
      tabSessions = tabSessions.filter((s) => s.id !== id);
      cachedTabSessions = tabSessions;
    } catch (e) {
      error = errorMessage(e);
    } finally {
      deletingSession = null;
    }
  }

  $effect(() => {
    load();
    const timer = setInterval(() => {
      api
        .memory()
        .then((m) => {
          mem = m;
          cachedMem = m;
        })
        .catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  });
</script>

<div class="speed-shell">
  <div class="speed-header">
    <div>
      <h1 class="speed-title">{t("speed.title", $lang)}</h1>
      <span class="speed-sub">
        {mem ? `${usedPct}% memory in use` : "Checking memory…"}
        {#if diag?.has_battery && diag.charge_percent != null}
          · {diag.charge_percent}% Battery
        {/if}
      </span>
    </div>

    <button class="primary boost-btn" disabled={boosting} onclick={runOneClickSpeedBoost}>
      {boosting ? "Speeding up…" : t("speed.boostRam", $lang)}
    </button>
  </div>

  {#if error}
    <div class="error-banner">{error}</div>
  {/if}
  {#if boostNotice}
    <div class="notice-banner">{boostNotice}</div>
  {/if}

  <!-- Section 1: Autopilot -->
  <section class="group-section" class:battery-highlight={viewMode === "battery"}>
    <div class="group-label" style="display: flex; justify-content: space-between; align-items: center;">
      <span>{viewMode === "battery" ? "Battery Health Saver" : "Automatic Battery & Speed Care"}</span>
      <div style="display: flex; gap: 6px; align-items: center;">
        {#if !hasBatteryCareAddon}
          <button
            type="button"
            class="primary mini-btn"
            onclick={unlockBatteryAddon}
          >
            Unlock Battery Saver (+£9.99/yr)
          </button>
        {/if}
        <button
          type="button"
          class="ghost mini-btn"
          style={viewMode === "pc" ? "color: var(--accent); font-weight: 800;" : ""}
          onclick={() => (viewMode = "pc")}
        >
          Speed &amp; Memory
        </button>
        <button
          type="button"
          class="ghost mini-btn"
          style={viewMode === "battery" ? "color: var(--accent); font-weight: 800;" : ""}
          onclick={() => (viewMode = "battery")}
        >
          Battery Care
        </button>
      </div>
    </div>
    <div class="row-list">
      <label class="line-row">
        <div>
          <span class="row-name">80% Charge Alert (Protects Battery Lifespan)</span>
          <div style="font-size: 11.5px; color: var(--muted); margin-top: 2px;">Reminds you to unplug at 80% so your laptop battery lasts years longer</div>
        </div>
        <input
          type="checkbox"
          class="toggle-switch"
          checked={diag?.config.charge_limit_enabled ?? false}
          disabled={busyAutopilot === "limit" || (diag != null && !diag.has_battery)}
          onchange={(e) => toggleChargeLimit((e.currentTarget as HTMLInputElement).checked, e)}
        />
      </label>

      <label class="line-row">
        <div>
          <span class="row-name">Pause Unused Browser Tabs</span>
          <div style="font-size: 11.5px; color: var(--muted); margin-top: 2px;">Puts background browser tabs to sleep so they stop draining battery and memory</div>
        </div>
        <input
          type="checkbox"
          class="toggle-switch"
          checked={diag?.config.auto_hibernate_tabs ?? false}
          disabled={busyAutopilot === "tabs"}
          onchange={(e) => toggleSleepTabs((e.currentTarget as HTMLInputElement).checked, e)}
        />
      </label>

      <label class="line-row">
        <div>
          <span class="row-name">Cool &amp; Quiet Laptop Mode</span>
          <div style="font-size: 11.5px; color: var(--muted); margin-top: 2px;">Slows down heavy background apps when your laptop gets hot or noisy</div>
        </div>
        <input
          type="checkbox"
          class="toggle-switch"
          checked={diag?.config.thermal_throttling_enabled ?? false}
          disabled={busyAutopilot === "thermal"}
          onchange={(e) => toggleThermal((e.currentTarget as HTMLInputElement).checked, e)}
        />
      </label>
    </div>
  </section>

  <!-- Section 2: Startup Apps -->
  <section class="group-section">
    <div class="group-label">{t("speed.startupApps", $lang)}</div>
    {#if toggleableStartup.length === 0}
      <div class="empty-line">No startup apps found</div>
    {:else}
      <div class="row-list">
        {#each toggleableStartup as s (s.name + s.scope)}
          {@const isEnabled = s.enabled ?? true}
          <label class="line-row">
            <span class="row-name">{s.name}</span>
            <input
              type="checkbox"
              class="toggle-switch"
              checked={isEnabled}
              disabled={toggling === s.name}
              onchange={(e) => toggleStartupApp(s, e)}
            />
          </label>
        {/each}
      </div>
    {/if}
  </section>

  <!-- Optional Demoted Drawer: Running Memory Hogs & Tab Backups -->
  <details class="extra-drawer">
    <summary>Running Apps ({topFiveApps.length}) &amp; Saved Tabs ({tabSessions.length})</summary>
    <div class="row-list" style="margin-top: 8px;">
      <div class="line-row">
        <span class="row-name">Browser Tab Session Backup</span>
        <button
          class="ghost mini-btn"
          disabled={savingTabs}
          onclick={saveTabsNow}
        >
          {savingTabs ? "Saving…" : "Save Current Tabs"}
        </button>
      </div>
      {#each topFiveApps as a (a.name)}
        <div class="line-row">
          <span class="row-name">{a.name}</span>
          <div class="row-right">
            <span class="row-meta">{formatBytes(a.bytes)}</span>
            <button
              class="ghost mini-btn"
              disabled={killingProc === a.name}
              onclick={() => closeHeavyApp(a.name)}
            >
              {killingProc === a.name ? "…" : confirmKillProc === a.name ? "Confirm" : "Close"}
            </button>
          </div>
        </div>
      {/each}

      {#each tabSessions as snap (snap.id)}
        <div class="line-row">
          <span class="row-name">{snap.browser} — Saved Tabs ({snap.estimated_tabs})</span>
          <div class="row-right">
            <button
              class="ghost mini-btn"
              disabled={restoringSession === snap.id}
              onclick={() => restoreSession(snap)}
            >
              {restoringSession === snap.id ? "…" : t("action.restore", $lang)}
            </button>
            <button
              class="ghost mini-btn"
              disabled={deletingSession === snap.id}
              onclick={() => removeTabSession(snap.id)}
              title="Delete saved tab session"
            >
              {deletingSession === snap.id ? "…" : "×"}
            </button>
          </div>
        </div>
      {/each}
    </div>
  </details>

  {#if contextMenuItems.length > 0}
    <details class="extra-drawer">
      <summary>Right-Click Context Menu ({contextMenuItems.length})</summary>
      <div class="row-list" style="margin-top: 8px;">
        {#each contextMenuItems as cm (cm.id)}
          <label class="line-row">
            <span class="row-name">{cm.name}</span>
            <input
              type="checkbox"
              class="toggle-switch"
              checked={cm.enabled}
              onchange={(e) => toggleContextMenu(cm, e)}
            />
          </label>
        {/each}
      </div>
    </details>
  {/if}
</div>

<style>
  .speed-shell {
    max-width: 640px;
    margin: 0 auto;
    padding: 8px 0 32px;
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  .speed-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }
  .speed-title {
    margin: 0;
    font-size: 22px;
    font-weight: 800;
    letter-spacing: -0.4px;
  }
  .speed-sub {
    display: block;
    margin-top: 2px;
    font-size: 12.5px;
    color: var(--muted);
  }
  .boost-btn {
    padding: 10px 22px;
    border-radius: 9999px;
    font-size: 13.5px;
    font-weight: 800;
  }

  .group-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .group-label {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
    padding: 0 4px;
  }

  .row-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .line-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 16px;
    border-radius: 12px;
    background: var(--panel);
    border: 1px solid var(--border);
    cursor: pointer;
    transition: border-color 0.15s ease;
  }
  .line-row:hover {
    border-color: rgba(16, 185, 129, 0.35);
  }
  .row-name {
    font-size: 13.5px;
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .row-right {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .row-meta {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--muted);
  }

  .toggle-switch {
    appearance: none;
    width: 38px;
    height: 22px;
    border-radius: 9999px;
    background: rgba(148, 163, 184, 0.35);
    position: relative;
    cursor: pointer;
    transition: background 0.18s ease;
    flex-shrink: 0;
  }
  .toggle-switch::after {
    content: "";
    position: absolute;
    top: 3px;
    left: 3px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #fff;
    transition: transform 0.18s ease;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
  }
  .toggle-switch:checked {
    background: var(--accent);
  }
  .toggle-switch:checked::after {
    transform: translateX(16px);
  }

  .empty-line {
    padding: 14px 16px;
    border-radius: 12px;
    background: var(--panel);
    border: 1px solid var(--border);
    font-size: 13px;
    color: var(--muted);
  }

  .extra-drawer {
    font-size: 12.5px;
    color: var(--muted);
  }
  .extra-drawer summary {
    cursor: pointer;
    font-weight: 600;
    padding: 4px;
    user-select: none;
  }
  .mini-btn {
    padding: 5px 12px;
    font-size: 12px;
    border-radius: 9999px;
  }

  .error-banner {
    padding: 10px 14px;
    border-radius: 10px;
    background: rgba(239, 68, 68, 0.12);
    color: var(--danger);
    font-size: 13px;
  }
  .notice-banner {
    padding: 10px 14px;
    border-radius: 10px;
    background: rgba(16, 185, 129, 0.12);
    color: var(--accent);
    font-size: 13px;
    font-weight: 600;
  }
</style>
