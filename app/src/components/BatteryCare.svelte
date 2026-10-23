<script lang="ts">
  import {
    api,
    errorMessage,
    type BatteryDiagnostics,
    type LicenseStatus,
    type ThermalThrottleResult,
    type HibernateTabsResult,
  } from "../lib/api";
  import { formatBytes } from "../lib/format";

  let { license }: { license: LicenseStatus | null } = $props();

  let diag = $state<BatteryDiagnostics | null>(null);
  let loading = $state(true);
  let busy = $state<string | null>(null);
  let error = $state<string | null>(null);
  let notice = $state<string | null>(null);
  let limit = $state(80);
  let thermal = $state<ThermalThrottleResult | null>(null);
  let hibernate = $state<HibernateTabsResult | null>(null);
  let showUpgrade = $state(false);
  let upgradePlan = $state<"annual" | "monthly">("annual");
  let waiting = $state(false);
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  const unlocked = $derived(
    !!license && (license.dev_unlock || (license.active && (license.addons ?? []).includes("battery_care")))
  );
  const healthTone = $derived(
    diag?.health_percent == null
      ? "neutral"
      : diag.health_percent >= 85
        ? "good"
        : diag.health_percent >= 75
          ? "warn"
          : "bad"
  );

  async function load() {
    loading = true;
    error = null;
    try {
      diag = await api.batteryDiagnostics();
      limit = diag.config.charge_limit_percent || 80;
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  function gate(): boolean {
    if (unlocked) return true;
    showUpgrade = true;
    return false;
  }

  async function run<T>(key: string, fn: () => Promise<T>): Promise<T | null> {
    busy = key;
    error = null;
    notice = null;
    try {
      return await fn();
    } catch (e) {
      error = errorMessage(e);
      return null;
    } finally {
      busy = null;
    }
  }

  async function toggleChargeLimit(enabled: boolean) {
    if (enabled && !gate()) return;
    const cfg = await run("limit", () => api.setBatteryChargeLimit(enabled, limit));
    if (cfg && diag) {
      diag.config = cfg;
      notice = cfg.charge_limit_message || (enabled ? `Battery charge limit set to ${limit}%.` : "Charge limit turned off.");
    }
  }

  async function toggleThermal(enabled: boolean) {
    if (enabled && !gate()) return;
    const r = await run("thermal", () => api.setBatteryThermalThrottling(enabled));
    if (r && diag) {
      thermal = r;
      diag.config.thermal_throttling_enabled = r.enabled;
      notice = enabled
        ? "Cool & Quiet Mode is now on. Background apps won't overheat your laptop."
        : "Cool & Quiet Mode turned off.";
    }
  }

  async function hibernateNow(auto: boolean | null = null) {
    if (!gate()) return;
    const r = await run("tabs", () => api.hibernateBrowserTabs(auto));
    if (r && diag) {
      hibernate = r;
      diag.config.auto_hibernate_tabs = r.auto_enabled;
      notice =
        r.tabs_hibernated > 0
          ? `Put ${r.tabs_hibernated} idle tab${r.tabs_hibernated === 1 ? "" : "s"} to sleep and freed ${formatBytes(r.bytes_freed)}.`
          : "All background tabs are already asleep.";
    }
  }

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  async function startUpgrade() {
    error = null;
    busy = "checkout";
    try {
      const alreadyOwned = await api.startAddonCheckout("battery_care", undefined, upgradePlan);
      if (alreadyOwned) {
        showUpgrade = false;
        return;
      }
      waiting = true;
      let ticks = 0;
      stopPolling();
      pollTimer = setInterval(async () => {
        if (++ticks > 150) stopPolling();
        try {
          const s = await api.licenseStatus(true);
          if ((s.addons ?? []).includes("battery_care")) {
            stopPolling();
            license = s;
            waiting = false;
            showUpgrade = false;
            notice = "Battery Saver unlocked. Thank you!";
          }
        } catch {
          /* keep polling */
        }
      }, 4000);
    } catch (e) {
      error = errorMessage(e);
    } finally {
      busy = null;
    }
  }

  function closeUpgrade() {
    stopPolling();
    waiting = false;
    showUpgrade = false;
  }

  $effect(() => {
    load();
    let unlisten: (() => void) | null = null;
    api
      .onUnplugAlert((alert) => {
        notice = `${alert.title}: ${alert.message}`;
        load();
      })
      .then((fn) => (unlisten = fn))
      .catch(() => {});
    return () => {
      stopPolling();
      unlisten?.();
    };
  });
</script>

<div class="battery-view">
  <section class="hook card {healthTone}">
    <div class="hook-head">
      <div>
        <div class="eyebrow">Laptop Battery Care</div>
        <h2>Protect Your Battery &amp; Keep Your Laptop Cool</h2>
      </div>
      <button class="ghost small-btn" disabled={loading} onclick={load}>
        {loading ? "Checking…" : "Check Again"}
      </button>
    </div>

    {#if loading && !diag}
      <div class="spinner" aria-hidden="true"></div>
      <p class="muted center">Checking your battery health and background apps…</p>
    {:else if diag}
      <div class="stats">
        <div class="stat">
          <span class="label">Battery Health</span>
          <strong>
            {diag.health_percent != null
              ? `${diag.health_percent.toFixed(0)}%`
              : diag.has_battery
                ? "Good"
                : "Desktop PC (No Battery)"}
          </strong>
          <span class="sub">
            {diag.health_percent != null && diag.health_percent >= 85
              ? "Healthy capacity"
              : diag.has_battery
                ? "Maximum charge capacity"
                : "Plugged into wall power"}
          </span>
        </div>

        <div class="stat">
          <span class="label">Current Charge</span>
          <strong>{diag.charge_percent != null ? `${diag.charge_percent}%` : "—"}</strong>
          <span class="sub">
            {diag.charging ? "Charging now" : diag.ac_connected ? "Plugged in" : "Running on battery"}
          </span>
        </div>

        <div class="stat">
          <span class="label">Temperature</span>
          <strong>{diag.temperature_c != null ? `${diag.temperature_c} °C` : "Normal"}</strong>
          <span class="sub">
            {diag.config.thermal_throttling_enabled ? "Cool & Quiet Mode active" : "Standard cooling"}
          </span>
        </div>
      </div>

      {#if diag.has_battery}
        <p class="anchor">
          Tip: Stopping your battery at <strong>80% charge</strong> when plugged in all day can help it last twice as long.
        </p>
      {/if}
    {/if}
  </section>

  {#if error}<div class="error-banner">{error}</div>{/if}
  {#if notice}<div class="notice">{notice}</div>{/if}

  {#if diag && diag.has_battery && diag.config.charge_limit_enabled && diag.ac_connected && (diag.charge_percent ?? 0) >= diag.config.charge_limit_percent && (!diag.config.charge_limit_hardware_applied || diag.charging)}
    <div class="unplug-banner" role="alert">
      <strong>Battery reached {diag.charge_percent}% (Your target is {diag.config.charge_limit_percent}%)</strong>
      <span>Unplug your charger now to help protect your battery's long-term health.</span>
    </div>
  {/if}

  <div class="features">
    <!-- 1. 80% Charge Guard -->
    <section class="card feature">
      <div class="feat-head">
        <h3>{limit}% Charge Guard</h3>
        {#if !unlocked}<span class="pill lock">Add-on</span>{/if}
      </div>
      <p class="muted small">
        Protects your battery when plugged in all day so it doesn't wear out early.
      </p>
      <div class="row" style="gap: 6px; flex-wrap: wrap;">
        {#each [70, 75, 80, 85, 90] as preset}
          <button
            type="button"
            class="ghost small-btn"
            style={limit === preset ? "border-color: var(--accent); color: var(--accent); font-weight: 700;" : ""}
            disabled={!diag?.has_battery || busy === "limit"}
            onclick={() => {
              limit = preset;
              if (diag?.config.charge_limit_enabled) {
                toggleChargeLimit(true);
              }
            }}
          >
            {preset}%{preset === 80 ? " ★" : ""}
          </button>
        {/each}
      </div>
      <div class="slider-row">
        <input
          type="range"
          min="60"
          max="100"
          step="5"
          bind:value={limit}
          disabled={!diag?.has_battery}
          onchange={() => {
            if (diag?.config.charge_limit_enabled) {
              toggleChargeLimit(true);
            }
          }}
          aria-label="Maximum battery charge percentage"
        />
        <strong>{limit}%</strong>
      </div>
      <div class="row">
        {#if diag?.config.charge_limit_enabled}
          <button class="primary small-btn" disabled={busy === "limit"} onclick={() => toggleChargeLimit(true)}>
            Save {limit}% Limit
          </button>
          <button class="ghost small-btn" disabled={busy === "limit"} onclick={() => toggleChargeLimit(false)}>
            Turn Off
          </button>
        {:else}
          <button
            class="primary small-btn"
            disabled={busy === "limit" || !diag?.has_battery}
            onclick={() => toggleChargeLimit(true)}
          >
            {busy === "limit" ? "Saving…" : `Turn On ${limit}% Guard`}
          </button>
        {/if}
      </div>
      {#if diag && !diag.has_battery}
        <span class="muted small">No laptop battery detected on this PC.</span>
      {/if}
    </section>

    <!-- 2. Thermal Overheat Guard -->
    <section class="card feature">
      <div class="feat-head">
        <h3>Thermal Overheat Guard</h3>
        {#if !unlocked}<span class="pill lock">Add-on</span>{/if}
      </div>
      <p class="muted small">
        Calms down heavy background apps so your laptop stays cool, quiet, and uses less power.
      </p>
      <label class="switch">
        <input
          type="checkbox"
          checked={diag?.config.thermal_throttling_enabled ?? false}
          disabled={busy === "thermal"}
          onchange={(e) => toggleThermal((e.currentTarget as HTMLInputElement).checked)}
        />
        <span>{diag?.config.thermal_throttling_enabled ? "Turned On" : "Turned Off"}</span>
      </label>
      {#if thermal && thermal.throttled_apps.length > 0}
        <span class="muted small">Quieted: {thermal.throttled_apps.join(", ")}</span>
      {/if}
    </section>

    <!-- 3. Put Idle Browser Tabs to Sleep -->
    <section class="card feature">
      <div class="feat-head">
        <h3>Put Idle Browser Tabs to Sleep</h3>
        {#if !unlocked}<span class="pill lock">Add-on</span>{/if}
      </div>
      <p class="muted small">
        Pauses background tabs you aren't looking at so your battery lasts longer on the go.
      </p>
      <div class="row">
        <button class="primary small-btn" disabled={busy === "tabs"} onclick={() => hibernateNow(null)}>
          {busy === "tabs" ? "Putting Tabs to Sleep…" : "Sleep Idle Tabs Now"}
        </button>
      </div>
      <label class="switch">
        <input
          type="checkbox"
          checked={diag?.config.auto_hibernate_tabs ?? false}
          disabled={busy === "tabs"}
          onchange={(e) => hibernateNow((e.currentTarget as HTMLInputElement).checked)}
        />
        <span>Automatically sleep unused tabs</span>
      </label>
      {#if hibernate && hibernate.estimated_extra_minutes > 0}
        <span class="pill good">+{hibernate.estimated_extra_minutes} mins battery life</span>
      {/if}
    </section>
  </div>

  {#if diag && diag.runaway_apps.length > 0}
    <section class="card">
      <h3>Background Apps Draining Battery Right Now</h3>
      <p class="muted small">
        These apps are using power in the background even when you aren't using them.
      </p>
      <table>
        <thead>
          <tr>
            <th>App</th>
            <th>Memory Used</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {#each diag.runaway_apps as app (app.name)}
            <tr>
              <td><strong>{app.name}</strong></td>
              <td>{formatBytes(app.memory_bytes)}</td>
              <td>
                {#if app.blocks_sleep}
                  <span class="pill bad">Keeps PC awake</span>
                {:else}
                  <span class="muted small">Active in background</span>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </section>
  {/if}
</div>

{#if showUpgrade}
  <div class="backdrop" role="presentation" onclick={closeUpgrade}>
    <div
      class="sheet card"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.key === "Escape" && closeUpgrade()}
    >
      {#if !waiting}
        <h2>Unlock Battery Care</h2>
        <p class="muted">
          Protect your laptop battery's lifespan, keep your laptop cool, and save battery life on up to 3 devices.
        </p>
        <div class="plans">
          <button
            class="plan"
            class:selected={upgradePlan === "annual"}
            onclick={() => (upgradePlan = "annual")}
          >
            <strong>Annual</strong>
            <span class="price">£17.99<small>/yr</small></span>
            <span class="muted small">£1.49/mo · Best value</span>
          </button>
          <button
            class="plan"
            class:selected={upgradePlan === "monthly"}
            onclick={() => (upgradePlan = "monthly")}
          >
            <strong>Monthly</strong>
            <span class="price">£2.99<small>/mo</small></span>
            <span class="muted small">Cancel anytime</span>
          </button>
        </div>
        {#if !license?.active}
          <p class="muted small">Requires SWEEPR Cleaner Pro, so checkout will include both.</p>
        {/if}
        <button class="primary big" disabled={busy === "checkout"} onclick={startUpgrade}>
          {busy === "checkout" ? "Opening checkout…" : "Continue to Checkout"}
        </button>
        <button class="ghost" onclick={closeUpgrade}>Not now</button>
      {:else}
        <h2>Finish checkout in your browser</h2>
        <p class="muted">This unlocks automatically as soon as your payment is complete.</p>
        <div class="spinner" aria-hidden="true"></div>
        <button class="ghost" onclick={closeUpgrade}>Cancel</button>
      {/if}
    </div>
  </div>
{/if}

<style>
  .battery-view {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .card {
    padding: 20px 24px;
  }
  .hook {
    border-left: 4px solid var(--accent);
  }
  .hook.warn {
    border-left-color: #f59e0b;
  }
  .hook.bad {
    border-left-color: #ef4444;
  }
  .hook-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
    margin-bottom: 14px;
  }
  .eyebrow {
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--accent);
  }
  h2 {
    margin: 2px 0 0;
    font-size: 20px;
  }
  h3 {
    margin: 0;
    font-size: 15.5px;
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
  }
  .stat {
    background: var(--panel-2);
    border-radius: 12px;
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    border: 1px solid var(--border);
  }
  .stat .label {
    font-size: 11px;
    color: var(--muted);
    text-transform: uppercase;
    font-weight: 700;
  }
  .stat strong {
    font-size: 22px;
  }
  .stat .sub {
    font-size: 12px;
    color: var(--muted);
  }
  .anchor {
    font-size: 13px;
    color: var(--muted);
    margin: 14px 0 0;
  }
  .small {
    font-size: 13px;
  }
  .small-btn {
    padding: 8px 16px;
    font-size: 12.5px;
    border-radius: 9999px;
  }
  .center {
    text-align: center;
  }
  .notice {
    padding: 12px 16px;
    border-radius: 10px;
    background: rgba(16, 185, 129, 0.12);
    border: 1px solid rgba(16, 185, 129, 0.35);
    font-size: 13.5px;
  }
  .error-banner {
    padding: 12px 16px;
    border-radius: 10px;
    background: rgba(239, 68, 68, 0.12);
    border: 1px solid rgba(239, 68, 68, 0.35);
    color: var(--danger);
    font-size: 13.5px;
  }
  .unplug-banner {
    padding: 12px 16px;
    border-radius: 10px;
    background: rgba(245, 158, 11, 0.14);
    border: 1px solid rgba(245, 158, 11, 0.45);
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13.5px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13.5px;
    margin-top: 10px;
  }
  th,
  td {
    text-align: left;
    padding: 9px 10px;
    border-bottom: 1px solid var(--border);
  }
  th {
    font-size: 11px;
    text-transform: uppercase;
    color: var(--muted);
  }
  .features {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
  }
  .feature {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .feat-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
  }
  .slider-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .slider-row input {
    flex: 1;
    accent-color: var(--accent);
  }
  .row {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .switch {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13.5px;
    font-weight: 600;
    cursor: pointer;
  }
  .switch input {
    accent-color: var(--accent);
    width: 16px;
    height: 16px;
  }
  .pill {
    align-self: flex-start;
    font-size: 11px;
    font-weight: 800;
    text-transform: uppercase;
    padding: 3px 9px;
    border-radius: 999px;
  }
  .pill.good {
    background: rgba(16, 185, 129, 0.15);
    color: #059669;
  }
  .pill.bad {
    background: rgba(239, 68, 68, 0.15);
    color: #dc2626;
  }
  .pill.lock {
    background: rgba(245, 158, 11, 0.15);
    color: #b45309;
  }
  .backdrop {
    position: fixed;
    inset: 0;
    background: #0009;
    display: grid;
    place-items: center;
    z-index: 50;
    backdrop-filter: blur(3px);
  }
  .sheet {
    width: 460px;
    max-width: 94vw;
    padding: 26px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    text-align: center;
  }
  .plans {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 10px;
  }
  .plan {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    white-space: normal;
    width: 100%;
    min-width: 0;
    gap: 4px;
    padding: 12px;
    border-radius: 12px;
    border: 1.5px solid var(--border);
    background: var(--panel);
    color: inherit;
    cursor: pointer;
    text-align: left;
  }
  .plan.selected {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
    background: rgba(16, 185, 129, 0.08);
  }
  .plan .price {
    font-size: 20px;
    font-weight: 800;
  }
  .plan .price small {
    font-size: 12px;
    font-weight: 500;
    color: var(--muted);
  }
  .spinner {
    align-self: center;
    margin: 12px auto;
    width: 36px;
    height: 36px;
    border: 4px solid var(--panel-2);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (max-width: 960px) {
    .stats {
      grid-template-columns: 1fr;
    }
    .features {
      grid-template-columns: 1fr;
    }
  }
</style>
