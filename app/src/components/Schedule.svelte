<script lang="ts">
  import { onMount } from "svelte";
  import {
    api,
    errorMessage,
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
    os_task_registered: false,
    last_run_at: null,
    last_bytes_found: null,
    last_bytes_freed: null,
    last_files_removed: null,
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
      const [loadedRules, loadedCfg] = await Promise.all([
        api.listRuleDefinitions(),
        api.getScheduleConfig(),
      ]);
      rules = loadedRules;
      config = loadedCfg;
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  });

  function isCatSelected(id: string): boolean {
    return config.categories.includes(id);
  }

  function toggleCategory(id: string) {
    if (config.categories.includes(id)) {
      config.categories = config.categories.filter((c) => c !== id);
    } else {
      config.categories = [...config.categories, id];
    }
  }

  function selectAllCategories() {
    config.categories = rules.map((r) => r.id);
  }

  function clearAllCategories() {
    config.categories = [];
  }

  async function saveSchedule() {
    if (!license?.active) {
      window.dispatchEvent(new CustomEvent("sweepr-open-activate"));
      return;
    }
    saving = true;
    error = null;
    notice = null;
    try {
      const updated = await api.saveScheduleConfig(config);
      config = updated;
      if (updated.enabled) {
        notice = "Schedule saved and registered with Windows Task Scheduler. It will run automatically in the background even when SWEEPR Cleaner is closed.";
      } else {
        notice = "Scheduled background runs have been disabled.";
      }
    } catch (e) {
      error = errorMessage(e);
    } finally {
      saving = false;
    }
  }

  async function triggerNow() {
    if (!license?.active) {
      window.dispatchEvent(new CustomEvent("sweepr-open-activate"));
      return;
    }
    runningNow = true;
    error = null;
    notice = null;
    try {
      // Save current settings first so the immediate run uses the latest selections
      config = await api.saveScheduleConfig(config);
      const updated = await api.runScheduledCleanNow();
      config = updated;
      if ((updated.last_bytes_freed ?? 0) > 0 || (updated.last_files_removed ?? 0) > 0) {
        addLifetimeStats(
          updated.last_bytes_freed ?? 0,
          updated.last_files_removed ?? 0,
          updated.categories,
          "Scheduled Auto-Clean"
        );
      }
      if (config.action === "scan_and_clean") {
        notice = `Scheduled scan & clean completed: ${formatBytes(updated.last_bytes_freed ?? 0)} cleaned (${formatCount(updated.last_files_removed ?? 0)} files removed).`;
      } else {
        notice = `Scheduled scan completed: ${formatBytes(updated.last_bytes_found ?? 0)} found across selected categories.`;
      }
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
  <div class="header-row">
    <div>
      <h1 class="page-title">Scheduled Scan & Auto-Clean</h1>
      <p class="muted small" style="margin: 4px 0 0 0;">
        Schedule automatic scans and cleanups that run silently in the background via Windows Task Scheduler—even when SWEEPR Cleaner is closed.
      </p>
    </div>
    <div class="status-pill-wrap" style="display: flex; align-items: center; gap: 8px;">
      {#if !license?.active}
        <span class="badge pro">Pro</span>
      {/if}
      {#if config.enabled && config.os_task_registered && license?.active}
        <span class="badge free">Active in Background</span>
      {:else if config.enabled && license?.active}
        <span class="badge pro">Pending Save</span>
      {:else}
        <span class="badge muted-badge">Schedule Off</span>
      {/if}
    </div>
  </div>

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

  <div class="schedule-grid">
    <!-- Left Column: Schedule Configuration -->
    <div class="card config-card">
      <div class="row enable-row">
        <div>
          <strong style="font-size: 15px;">Enable Scheduled Background Execution</strong>
          <div class="muted small" style="margin-top: 2px;">
            Runs automatically at your scheduled time without needing the app open
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
                window.dispatchEvent(new CustomEvent("sweepr-open-activate"));
                return;
              }
              config.enabled = target.checked;
            }}
          />
          <span class="slider"></span>
        </label>
      </div>

      <div class="divider"></div>

      <!-- Frequency & Time -->
      <div class="field-group">
        <span class="field-label">FREQUENCY</span>
        <div class="segmented-pills">
          <button
            type="button"
            class="pill-btn"
            class:active={config.frequency === "daily"}
            onclick={() => (config.frequency = "daily")}
          >
            Daily
          </button>
          <button
            type="button"
            class="pill-btn"
            class:active={config.frequency === "weekly"}
            onclick={() => (config.frequency = "weekly")}
          >
            Weekly
          </button>
          <button
            type="button"
            class="pill-btn"
            class:active={config.frequency === "monthly"}
            onclick={() => (config.frequency = "monthly")}
          >
            Monthly
          </button>
        </div>
      </div>

      <div class="row time-row">
        <div class="field-group" style="flex: 1;">
          <label class="field-label" for="sched-time">TIME OF DAY</label>
          <input
            id="sched-time"
            type="time"
            class="input-control"
            bind:value={config.time}
          />
        </div>

        {#if config.frequency === "weekly"}
          <div class="field-group" style="flex: 1;">
            <label class="field-label" for="sched-dow">DAY OF WEEK</label>
            <select id="sched-dow" class="input-control" bind:value={config.day_of_week}>
              {#each DAYS_OF_WEEK as d}
                <option value={d.code}>{d.label}</option>
              {/each}
            </select>
          </div>
        {:else if config.frequency === "monthly"}
          <div class="field-group" style="flex: 1;">
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

      <!-- Action Mode -->
      <div class="field-group">
        <span class="field-label">ACTION WHEN SCHEDULE RUNS</span>
        <div class="action-cards">
          <button
            type="button"
            class="action-card"
            class:selected={config.action === "scan_and_clean"}
            onclick={() => (config.action = "scan_and_clean")}
          >
            <div class="row" style="justify-content: space-between; width: 100%;">
              <strong>Scan & Automatically Clean</strong>
              <span class="badge free">Recommended</span>
            </div>
            <span class="muted small">
              Scans selected areas and automatically cleans junk files in the background (recoverable for 7 days in Quarantine).
            </span>
          </button>

          <button
            type="button"
            class="action-card"
            class:selected={config.action === "scan_only"}
            onclick={() => (config.action = "scan_only")}
          >
            <div class="row" style="justify-content: space-between; width: 100%;">
              <strong>Scan Only</strong>
            </div>
            <span class="muted small">
              Scans your device in the background and records how much space can be reclaimed without deleting files.
            </span>
          </button>
        </div>
      </div>

      <div class="row cta-row">
        <button class="primary save-btn" disabled={saving || loading} onclick={saveSchedule}>
          {saving ? "Saving Schedule…" : "Save Schedule"}
        </button>
        <button class="ghost run-now-btn" disabled={runningNow || loading} onclick={triggerNow}>
          {#if runningNow}
            <span class="spinner" style="width: 14px; height: 14px; border-width: 2px; display: inline-block; vertical-align: middle; margin-right: 6px;"></span>
            <span>Running…</span>
          {:else}
            <span>Run Scheduled Action Now</span>
          {/if}
        </button>
      </div>

      {#if config.last_run_at}
        <div class="last-run-box">
          <div class="field-label">LAST SCHEDULED EXECUTION</div>
          <div class="row" style="justify-content: space-between; margin-top: 4px;">
            <span class="small">{formatTimestamp(config.last_run_at)}</span>
            <span class="small">
              Found: <strong>{formatBytes(config.last_bytes_found ?? 0)}</strong>
              · Cleaned: <strong style="color: var(--accent);">{formatBytes(config.last_bytes_freed ?? 0)}</strong>
              ({formatCount(config.last_files_removed ?? 0)} files)
            </span>
          </div>
        </div>
      {/if}
    </div>

    <!-- Right Column: Categories to Include -->
    <div class="card categories-card">
      <div class="row" style="justify-content: space-between; margin-bottom: 10px;">
        <div>
          <div class="field-label">AREAS INCLUDED IN SCHEDULE</div>
          <div class="muted small">Choose which categories to scan and clean</div>
        </div>
        <div class="row" style="gap: 6px;">
          <button type="button" class="ghost mini-btn" onclick={selectAllCategories}>All</button>
          <button type="button" class="ghost mini-btn" onclick={clearAllCategories}>None</button>
        </div>
      </div>

      <div class="cat-list">
        {#each rules as r (r.id)}
          <label class="cat-row">
            <input
              type="checkbox"
              checked={isCatSelected(r.id)}
              onchange={() => toggleCategory(r.id)}
            />
            <div class="cat-info">
              <div class="row" style="gap: 8px;">
                <strong class="small">{r.name}</strong>
                {#if !license?.active}
                  <span class="badge pro">Pro</span>
                {/if}
              </div>
              <div class="muted small" style="font-size: 11.5px;">{r.description}</div>
            </div>
          </label>
        {/each}
      </div>
    </div>
  </div>
</div>

<style>
  .schedule-container {
    max-width: 1240px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .header-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
  }
  .page-title {
    font-size: 24px;
    font-weight: 800;
    margin: 0;
    letter-spacing: -0.5px;
  }
  .muted-badge {
    background: var(--panel-2);
    color: var(--muted);
    border: 1px solid var(--border);
  }
  .banner {
    padding: 12px 18px;
    font-size: 13px;
    font-weight: 500;
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
  .schedule-grid {
    display: grid;
    grid-template-columns: 1.15fr 0.85fr;
    gap: 22px;
    align-items: start;
  }
  .config-card,
  .categories-card {
    padding: 24px 26px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .enable-row {
    justify-content: space-between;
    align-items: center;
  }
  .divider {
    height: 1px;
    background: var(--border);
  }
  .field-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
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
    gap: 8px;
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
  .pill-btn:hover {
    color: var(--text);
    background: transparent;
  }
  .pill-btn.active {
    background: var(--panel-solid);
    color: var(--accent);
    box-shadow: 0 2px 8px rgba(15, 23, 42, 0.08);
  }
  .time-row {
    gap: 14px;
    align-items: flex-end;
  }
  .input-control {
    padding: 9px 14px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: var(--panel);
    color: var(--text);
    font-size: 13.5px;
    font-weight: 600;
  }
  .action-cards {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .action-card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    text-align: left;
    gap: 6px;
    padding: 14px 16px;
    border-radius: 12px;
    border: 1.5px solid var(--border);
    background: var(--panel);
    cursor: pointer;
    white-space: normal;
  }
  .action-card.selected {
    border-color: var(--accent);
    background: rgba(16, 185, 129, 0.06);
  }
  .cta-row {
    gap: 12px;
    margin-top: 4px;
  }
  .save-btn {
    padding: 10px 22px;
    font-size: 13.5px;
  }
  .run-now-btn {
    padding: 10px 18px;
    font-size: 13px;
  }
  .last-run-box {
    padding: 12px 16px;
    border-radius: 10px;
    background: var(--panel-2);
    border: 1px solid var(--border);
  }
  .cat-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: 430px;
    overflow-y: auto;
    padding-right: 4px;
  }
  .cat-row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: var(--panel-2);
    cursor: pointer;
  }
  .cat-row input[type="checkbox"] {
    margin-top: 2px;
  }
  .cat-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }
  .mini-btn {
    padding: 4px 10px;
    font-size: 11.5px;
  }
  .switch {
    position: relative;
    display: inline-block;
    width: 46px;
    height: 26px;
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
    height: 20px;
    width: 20px;
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
