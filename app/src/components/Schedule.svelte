<script lang="ts">
  import { onMount } from "svelte";
  import {
    api,
    errorMessage,
    isPaymentRequired,
    requestActivation,
    type LicenseStatus,
    type RuleDefinitionInfo,
    type ScheduleConfig,
  } from "../lib/api";
  import { formatBytes, formatCount } from "../lib/format";
  import { addLifetimeStats } from "../lib/store";

  let { license }: { license: LicenseStatus | null } = $props();

  let loading = $state(true);
  let saving = $state(false);
  let runningNow = $state(false);
  let autostart = $state(false);
  let showCustomCategories = $state(false);
  let error = $state<string | null>(null);
  let notice = $state<string | null>(null);
  let rules = $state<RuleDefinitionInfo[]>([]);

  let config = $state<ScheduleConfig>({
    enabled: false,
    frequency: "daily",
    time: "12:00",
    day_of_week: "MON",
    day_of_month: 1,
    action: "scan_and_clean",
    categories: [],
    sync_cloud_backups: false,
    os_task_registered: false,
    last_run_at: null,
    last_bytes_found: null,
    last_bytes_freed: null,
    last_files_removed: null,
    last_cloud_files_synced: null,
    last_cloud_bytes_synced: null,
  });

  const DAYS_OF_WEEK = [
    { code: "MON", label: "Monday" },
    { code: "TUE", label: "Tuesday" },
    { code: "WED", label: "Wednesday" },
    { code: "THU", label: "Thursday" },
    { code: "FRI", label: "Friday" },
    { code: "SAT", label: "Saturday" },
    { code: "SUN", label: "Sunday" },
  ];

  onMount(async () => {
    try {
      const [loadedRules, loadedCfg, auto] = await Promise.all([
        api.listRuleDefinitions(),
        api.getScheduleConfig(),
        api.getAutostart().catch(() => false),
      ]);
      rules = loadedRules;
      if (loadedCfg.categories.length === 0 && loadedRules.length > 0) {
        loadedCfg.categories = loadedRules.map((r) => r.id);
      }
      config = loadedCfg;
      autostart = auto;
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  });

  async function toggleAutostart(next: boolean, inputEl?: HTMLInputElement) {
    if (!license?.active) {
      if (inputEl) inputEl.checked = autostart;
      requestActivation();
      return;
    }
    error = null;
    try {
      autostart = await api.setAutostart(next);
      notice = autostart
        ? "SWEEPR will now start automatically when you sign in to Windows."
        : "Automatic startup at Windows sign-in turned off.";
    } catch (e) {
      if (inputEl) inputEl.checked = autostart;
      if (isPaymentRequired(e)) requestActivation();
      else error = errorMessage(e);
    }
  }

  type SimpleGroupId = "system" | "browsers" | "apps" | "recycle";

  const SIMPLE_GROUPS: {
    id: SimpleGroupId;
    title: string;
    description: string;
    match: (r: RuleDefinitionInfo) => boolean;
  }[] = [
    {
      id: "system",
      title: "Windows & System Temp Files",
      description: "Old update leftovers, crash logs, and Windows temporary files",
      match: (r) =>
        /temp|log|crash|update|prefetch|thumb|font|dns|shader|memory_dump|windows/i.test(r.id) &&
        !/recycle|download/i.test(r.id),
    },
    {
      id: "browsers",
      title: "Web Browser Caches",
      description: "Temporary web files from Chrome, Edge, Brave, and Firefox (keeps your passwords & history)",
      match: (r) => /chrome|edge|brave|firefox|opera|vivaldi|safari|browser/i.test(r.id),
    },
    {
      id: "apps",
      title: "App & Game Temporary Files",
      description: "Leftover caches from Discord, Teams, Steam, Spotify, and everyday apps",
      match: (r) =>
        !/temp|log|crash|update|prefetch|thumb|font|dns|shader|memory_dump|windows|chrome|edge|brave|firefox|opera|vivaldi|safari|browser|recycle|download/i.test(
          r.id
        ),
    },
    {
      id: "recycle",
      title: "Recycle Bin & Old Downloads",
      description: "Empties the Recycle Bin and clears leftover installer files",
      match: (r) => /recycle|download|installer/i.test(r.id),
    },
  ];

  function groupRuleIds(group: (typeof SIMPLE_GROUPS)[number]): string[] {
    const matched = rules.filter(group.match).map((r) => r.id);
    return matched;
  }

  function isGroupSelected(group: (typeof SIMPLE_GROUPS)[number]): boolean {
    const ids = groupRuleIds(group);
    if (ids.length === 0) return false;
    return ids.some((id) => config.categories.includes(id));
  }

  function toggleGroup(group: (typeof SIMPLE_GROUPS)[number]) {
    const ids = groupRuleIds(group);
    if (isGroupSelected(group)) {
      config.categories = config.categories.filter((id) => !ids.includes(id));
    } else {
      const set = new Set([...config.categories, ...ids]);
      config.categories = Array.from(set);
    }
  }

  async function saveSchedule() {
    if (!license?.active) {
      requestActivation();
      return;
    }
    saving = true;
    error = null;
    notice = null;
    try {
      const updated = await api.saveScheduleConfig(config);
      config = updated;
      if (updated.enabled) {
        notice = "Auto-Clean schedule saved! Your PC will be cleaned automatically in the background.";
      } else {
        notice = "Auto-Clean schedule turned off.";
      }
    } catch (e) {
      error = errorMessage(e);
    } finally {
      saving = false;
    }
  }

  async function triggerNow() {
    if (!license?.active) {
      requestActivation();
      return;
    }
    runningNow = true;
    error = null;
    notice = null;
    try {
      config = await api.saveScheduleConfig(config);
      const updated = await api.runScheduledCleanNow();
      config = updated;
      if ((updated.last_bytes_freed ?? 0) > 0 || (updated.last_files_removed ?? 0) > 0) {
        addLifetimeStats(
          updated.last_bytes_freed ?? 0,
          updated.last_files_removed ?? 0,
          updated.categories,
          "Auto-Clean"
        );
      }
      notice = `Auto-Clean finished: ${formatBytes(updated.last_bytes_freed ?? 0)} freed (${formatCount(updated.last_files_removed ?? 0)} files removed).`;
    } catch (e) {
      error = errorMessage(e);
    } finally {
      runningNow = false;
    }
  }

  function formatTimestamp(ts: number | null): string {
    if (!ts) return "Never";
    return new Date(ts * 1000).toLocaleString();
  }
</script>

<div class="schedule-container">
  {#if error}
    <div class="card banner error-banner">
      <span>{error}</span>
    </div>
  {/if}

  {#if notice}
    <div class="card banner success-banner">
      <span>{notice}</span>
    </div>
  {/if}

  <div class="card config-card">
    <div class="row" style="justify-content: space-between; align-items: center;">
      <div>
        <h2 style="margin: 0; font-size: 19px;">Automatic Background Cleaning</h2>
        <p class="muted small" style="margin: 4px 0 0 0;">
          Let SWEEPR keep your PC clean and backed up automatically without you lifting a finger.
        </p>
      </div>
      {#if config.enabled && config.os_task_registered && license?.active}
        <span class="badge free">Auto-Clean On</span>
      {:else}
        <span class="badge muted-badge">Auto-Clean Off</span>
      {/if}
    </div>

    <div class="divider"></div>

    <!-- 1. Clean automatically -->
    <div class="row enable-row">
      <div>
        <strong style="font-size: 14.5px;">Clean my PC automatically in the background</strong>
        <div class="muted small" style="margin-top: 2px;">
          Safely clears unneeded temporary files and caches on your schedule, even when SWEEPR is closed
        </div>
      </div>
      <label class="switch">
        <input
          type="checkbox"
          checked={config.enabled && !!license?.active}
          onchange={(e) => {
            const target = e.currentTarget as HTMLInputElement;
            if (!license?.active) {
              target.checked = false;
              config.enabled = false;
              requestActivation();
              return;
            }
            config.enabled = target.checked;
          }}
        />
        <span class="slider"></span>
      </label>
    </div>

    <!-- 2. Start with Windows -->
    <div class="row enable-row">
      <div>
        <strong style="font-size: 14.5px;">Open SWEEPR when I sign in to Windows</strong>
        <div class="muted small" style="margin-top: 2px;">
          Starts SWEEPR automatically whenever you turn on your PC
        </div>
      </div>
      <label class="switch">
        <input
          type="checkbox"
          checked={autostart && !!license?.active}
          onchange={(e) => {
            const target = e.currentTarget as HTMLInputElement;
            toggleAutostart(target.checked, target);
          }}
        />
        <span class="slider"></span>
      </label>
    </div>

    <!-- 3. Automatic Cloud Backup -->
    <div class="row enable-row">
      <div>
        <strong style="font-size: 14.5px;">Back up my protected cloud folders automatically</strong>
        <div class="muted small" style="margin-top: 2px;">
          Copies new files in your Cloud Backup folders whenever this schedule runs
        </div>
      </div>
      <label class="switch">
        <input
          type="checkbox"
          checked={Boolean(config.sync_cloud_backups) &&
            Boolean(license?.dev_unlock || (license?.active && license?.addons?.includes("cloud_vault")))}
          onchange={(e) => {
            const target = e.currentTarget as HTMLInputElement;
            const hasCloudAddon = Boolean(
              license?.dev_unlock || (license?.active && license?.addons?.includes("cloud_vault"))
            );
            if (!hasCloudAddon) {
              target.checked = false;
              config.sync_cloud_backups = false;
              if (license?.active) {
                api.startAddonCheckout("cloud_vault").catch(() => requestActivation());
              } else {
                requestActivation();
              }
              return;
            }
            config.sync_cloud_backups = target.checked;
          }}
        />
        <span class="slider"></span>
      </label>
    </div>

    <div class="divider"></div>

    <!-- Frequency & Time -->
    <div class="row time-row">
      <div class="field-group" style="flex: 1.4;">
        <span class="field-label">HOW OFTEN?</span>
        <div class="segmented-pills">
          <button
            type="button"
            class="pill-btn"
            class:active={config.frequency === "daily"}
            onclick={() => (config.frequency = "daily")}
          >
            Every Day
          </button>
          <button
            type="button"
            class="pill-btn"
            class:active={config.frequency === "weekly"}
            onclick={() => (config.frequency = "weekly")}
          >
            Every Week
          </button>
          <button
            type="button"
            class="pill-btn"
            class:active={config.frequency === "monthly"}
            onclick={() => (config.frequency = "monthly")}
          >
            Every Month
          </button>
        </div>
      </div>

      <div class="field-group" style="flex: 0.8;">
        <label class="field-label" for="sched-time">TIME OF DAY</label>
        <input id="sched-time" type="time" class="input-control" bind:value={config.time} />
      </div>

      {#if config.frequency === "weekly"}
        <div class="field-group" style="flex: 0.8;">
          <label class="field-label" for="sched-dow">DAY OF WEEK</label>
          <select id="sched-dow" class="input-control" bind:value={config.day_of_week}>
            {#each DAYS_OF_WEEK as d}
              <option value={d.code}>{d.label}</option>
            {/each}
          </select>
        </div>
      {:else if config.frequency === "monthly"}
        <div class="field-group" style="flex: 0.8;">
          <label class="field-label" for="sched-dom">DAY OF MONTH (1–28)</label>
          <input
            id="sched-dom"
            type="number"
            min="1"
            max="28"
            class="input-control"
            bind:value={config.day_of_month}
          />
        </div>
      {/if}
    </div>

    <div class="row cta-row">
      <button class="primary save-btn" disabled={saving || loading} onclick={saveSchedule}>
        {saving ? "Saving…" : "Save Auto-Clean Settings"}
      </button>
      <button class="ghost run-now-btn" disabled={runningNow || loading} onclick={triggerNow}>
        {runningNow ? "Cleaning Now…" : "Run Auto-Clean Right Now"}
      </button>
      <div class="spacer"></div>
      <button
        type="button"
        class="ghost small-btn"
        onclick={() => (showCustomCategories = !showCustomCategories)}
      >
        {showCustomCategories
          ? "Hide cleanup areas"
          : `Customize what gets cleaned (${config.categories.length} areas)`}
      </button>
    </div>

    {#if showCustomCategories}
      <div class="custom-cats-box">
        <div class="row" style="justify-content: space-between; margin-bottom: 8px;">
          <strong class="small">Choose what Auto-Clean should clean</strong>
          <div class="row" style="gap: 6px;">
            <button
              type="button"
              class="ghost small-btn"
              onclick={() => (config.categories = rules.map((r) => r.id))}
            >
              Select All
            </button>
            <button
              type="button"
              class="ghost small-btn"
              onclick={() => (config.categories = [])}
            >
              Clear All
            </button>
          </div>
        </div>
        <div class="cat-grid">
          {#each SIMPLE_GROUPS as g (g.id)}
            <label class="cat-row">
              <input
                type="checkbox"
                checked={isGroupSelected(g)}
                onchange={() => toggleGroup(g)}
              />
              <div>
                <strong class="small">{g.title}</strong>
                <div class="muted small" style="font-size: 11.5px;">{g.description}</div>
              </div>
            </label>
          {/each}
        </div>
      </div>
    {/if}

    {#if config.last_run_at}
      <div class="last-run-box">
        <div class="field-label">LAST AUTOMATIC CLEAN</div>
        <div class="row" style="justify-content: space-between; margin-top: 4px; flex-wrap: wrap;">
          <span class="small">{formatTimestamp(config.last_run_at)}</span>
          <span class="small">
            Cleaned: <strong style="color: var(--accent);">{formatBytes(config.last_bytes_freed ?? 0)}</strong>
            {#if (config.last_cloud_files_synced ?? 0) > 0}
              · Cloud files backed up: <strong>{formatCount(config.last_cloud_files_synced ?? 0)} ({formatBytes(config.last_cloud_bytes_synced ?? 0)})</strong>
            {/if}
          </span>
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .schedule-container {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .muted-badge {
    background: var(--panel-2);
    color: var(--muted);
    border: 1px solid var(--border);
  }
  .banner {
    padding: 12px 18px;
    font-size: 13.5px;
    font-weight: 600;
  }
  .error-banner {
    border-left: 4px solid var(--danger);
    background: rgba(239, 68, 68, 0.12);
    color: var(--danger);
  }
  .success-banner {
    border-left: 4px solid var(--accent);
    background: var(--accent-light);
    color: var(--text);
  }
  .config-card {
    padding: 24px 28px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .enable-row {
    justify-content: space-between;
    align-items: center;
    gap: 16px;
  }
  .divider {
    height: 1px;
    background: var(--border);
  }
  .field-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .field-label {
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.6px;
    color: var(--muted);
  }
  .segmented-pills {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
    background: var(--panel-2);
    padding: 4px;
    border-radius: 12px;
    border: 1px solid var(--border);
  }
  .pill-btn {
    border: none;
    background: transparent;
    padding: 8px 12px;
    border-radius: 9px;
    font-weight: 600;
    font-size: 13px;
    color: var(--muted);
    cursor: pointer;
    box-shadow: none;
  }
  .pill-btn.active {
    background: var(--panel-solid);
    color: var(--accent);
    box-shadow: 0 2px 8px rgba(15, 23, 42, 0.08);
  }
  .time-row {
    gap: 16px;
    align-items: flex-end;
    flex-wrap: wrap;
  }
  .input-control {
    padding: 9px 14px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: var(--panel-solid);
    color: var(--text);
    font-size: 13.5px;
    font-weight: 600;
  }
  .cta-row {
    gap: 10px;
    margin-top: 4px;
    flex-wrap: wrap;
  }
  .save-btn {
    padding: 11px 24px;
    border-radius: 9999px;
    font-size: 14px;
    font-weight: 700;
  }
  .run-now-btn {
    padding: 11px 20px;
    border-radius: 9999px;
    font-size: 13.5px;
  }
  .small-btn {
    padding: 6px 14px;
    border-radius: 9999px;
    font-size: 12.5px;
  }
  .custom-cats-box {
    padding: 16px;
    border-radius: 12px;
    background: var(--panel-2);
    border: 1px solid var(--border);
  }
  .cat-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 8px;
    max-height: 260px;
    overflow-y: auto;
  }
  .cat-row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 9px 12px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: var(--panel-solid);
    cursor: pointer;
  }
  .last-run-box {
    padding: 12px 16px;
    border-radius: 10px;
    background: var(--panel-2);
    border: 1px solid var(--border);
  }
  .switch {
    position: relative;
    display: inline-block;
    width: 44px;
    height: 24px;
    flex-shrink: 0;
  }
  .switch input {
    opacity: 0;
    width: 0;
    height: 0;
  }
  .slider {
    position: absolute;
    cursor: pointer;
    inset: 0;
    background-color: #cbd5e1;
    transition: 0.2s;
    border-radius: 9999px;
  }
  .slider:before {
    position: absolute;
    content: "";
    height: 18px;
    width: 18px;
    left: 3px;
    bottom: 3px;
    background-color: white;
    transition: 0.2s;
    border-radius: 50%;
  }
  input:checked + .slider {
    background-color: var(--accent);
  }
  input:checked + .slider:before {
    transform: translateX(20px);
  }
</style>
