<script lang="ts">
  import {
    api,
    errorMessage,
    type AppInfo,
    type AppUpdateInfo,
    type CleanHistoryEntry,
    type LicenseStatus,
  } from "../lib/api";
  import { getLifetimeStats, type LifetimeStats } from "../lib/store";
  import { formatBytes, formatCount, PRICING } from "../lib/format";
  import Installer from "./Installer.svelte";

  let { license, info, onRefresh }: { license: LicenseStatus | null; info: AppInfo | null; onRefresh: () => Promise<void> } = $props();
  let error = $state<string | null>(null);
  let busy = $state(false);
  let showInstaller = $state(false);
  let selectedPlan = $state<"monthly" | "annual">("monthly");
  let linkEmail = $state("");
  let otpCode = $state("");
  let otpSent = $state(false);
  let linkSuccess = $state<string | null>(null);
  let stats = $state<LifetimeStats>({ bytesFreed: 0, filesRemoved: 0 });

  // Scheduled Auto-Clean & Autostart (#9)
  let autostart = $state(false);
  let schedule = $state("off");
  let scheduleSaved = $state<string | null>(null);

  // Cleaning History (#13)
  let history = $state<CleanHistoryEntry[]>([]);

  // App Update Checker
  let updateInfo = $state<AppUpdateInfo | null>(null);
  let checkingUpdate = $state(false);

  // Support Report Form (#6)
  let supportEmail = $state("");
  let supportSubject = $state("");
  let supportMessage = $state("");
  let sendingSupport = $state(false);
  let supportSuccess = $state<string | null>(null);

  $effect(() => {
    stats = getLifetimeStats();
    const cb = () => (stats = getLifetimeStats());
    window.addEventListener("sweepr-stats-update", cb);
    return () => window.removeEventListener("sweepr-stats-update", cb);
  });

  $effect(() => {
    api.getAutostart().then((v) => (autostart = v)).catch(() => {});
    api.getScheduleSettings().then((s) => (schedule = s || "off")).catch(() => {});
    api.getCleaningHistory().then((h) => (history = h)).catch(() => {});
  });

  async function portal() {
    error = null;
    try {
      await api.openBillingPortal();
    } catch (e) {
      error = errorMessage(e);
    }
  }

  async function startPlanCheckout() {
    error = null;
    busy = true;
    try {
      await api.startCheckout(linkEmail.trim() || undefined, selectedPlan);
    } catch (e) {
      error = errorMessage(e);
    } finally {
      busy = false;
    }
  }

  async function refresh() {
    busy = true;
    error = null;
    await onRefresh();
    busy = false;
  }

  async function sendOtp() {
    error = null;
    linkSuccess = null;
    if (!linkEmail.trim() || !linkEmail.includes("@")) {
      error = "Please enter the email address used at checkout.";
      return;
    }
    busy = true;
    try {
      await api.requestLoginOtp(linkEmail.trim());
      otpSent = true;
    } catch (e) {
      error = errorMessage(e);
    } finally {
      busy = false;
    }
  }

  async function verifyOtp() {
    error = null;
    linkSuccess = null;
    busy = true;
    try {
      await api.verifyLoginOtp(linkEmail.trim(), otpCode.trim());
      otpSent = false;
      otpCode = "";
      linkSuccess = "Device successfully linked to your subscription.";
      await onRefresh();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      busy = false;
    }
  }

  async function toggleAutostart(next: boolean) {
    error = null;
    try {
      autostart = await api.setAutostart(next);
      scheduleSaved = autostart ? "Windows Autostart enabled." : "Windows Autostart disabled.";
    } catch (e) {
      error = errorMessage(e);
    }
  }

  async function updateSchedule(next: string) {
    error = null;
    try {
      schedule = await api.setScheduleSettings(next);
      scheduleSaved = `Auto-clean schedule set to ${schedule}.`;
    } catch (e) {
      error = errorMessage(e);
    }
  }

  async function checkUpdates() {
    error = null;
    checkingUpdate = true;
    try {
      updateInfo = await api.checkAppUpdate();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      checkingUpdate = false;
    }
  }

  async function submitSupportReport() {
    error = null;
    supportSuccess = null;
    if (!supportEmail.trim() || !supportMessage.trim()) {
      error = "Please enter your email and a description of the issue.";
      return;
    }
    sendingSupport = true;
    try {
      await api.sendSupportReport(
        supportEmail.trim(),
        supportSubject.trim() || "SWEEPR Cleaner Desktop Support Report",
        supportMessage.trim()
      );
      supportMessage = "";
      supportSubject = "";
      supportSuccess = "Support report sent with system diagnostic summary.";
    } catch (e) {
      error = errorMessage(e);
    } finally {
      sendingSupport = false;
    }
  }

  const expiry = $derived(license?.expires_at ? new Date(license.expires_at * 1000).toLocaleString("en-GB") : null);
</script>

<h1>Account & Settings</h1>

{#if error}<div class="card box error-banner">{error}</div>{/if}
{#if linkSuccess}<div class="card box" style="border-color: var(--accent); color: var(--accent);">{linkSuccess}</div>{/if}

<div class="account-grid">
  <div class="card box">
    {#if license?.active}
      <div class="row">
        <strong>Status:</strong>
        <span class="badge free">{license.status}</span>
        {#if license.plan}<span class="badge pro">{license.plan}</span>{/if}
        {#if license.offline}<span class="badge">offline</span>{/if}
      </div>
      {#if expiry}<div class="muted small">Licence check valid until {expiry}. It renews automatically while you're online.</div>{/if}
      <div class="row">
        <button onclick={portal}>Manage or cancel subscription</button>
        <button class="ghost" disabled={busy} onclick={refresh}>Refresh status</button>
      </div>
    {:else}
      <div class="row"><strong>Choose a SWEEPR Cleaner Pro Plan</strong></div>
      <p class="muted small" style="margin: 0;">Scanning, file review, memory insights and temporary file cleaning are free forever. Upgrade to unlock all Pro tools:</p>

      <div class="plan-cards" role="radiogroup" aria-label="Select billing plan">
        <button
          type="button"
          class="plan-card"
          class:selected={selectedPlan === "monthly"}
          onclick={() => (selectedPlan = "monthly")}
          aria-pressed={selectedPlan === "monthly"}
        >
          <div class="row" style="justify-content: space-between; width: 100%;">
            <strong>Monthly</strong>
            <span class="badge free">30d Trial</span>
          </div>
          <div class="plan-price">{PRICING.activation} today</div>
          <div class="muted small">then {PRICING.monthly}/mo</div>
        </button>

        <button
          type="button"
          class="plan-card"
          class:selected={selectedPlan === "annual"}
          onclick={() => (selectedPlan = "annual")}
          aria-pressed={selectedPlan === "annual"}
        >
          <div class="row" style="justify-content: space-between; width: 100%;">
            <strong>Annual</strong>
            <span class="badge pro">{PRICING.annualSave}</span>
          </div>
          <div class="plan-price">{PRICING.annual}/yr</div>
          <div class="muted small">{PRICING.annualSave} — no free trial</div>
        </button>
      </div>

      <div class="row" style="gap: 8px; flex-wrap: wrap;">
        <button class="primary" disabled={busy} onclick={startPlanCheckout}>
          {selectedPlan === "annual" ? `Subscribe Annual (${PRICING.annual}/yr)` : `Start Trial (${PRICING.activation} today)`}
        </button>
        <button class="ghost" disabled={busy} onclick={refresh}>I've already paid: refresh</button>
      </div>

      <hr style="border: none; border-top: 1px solid var(--border, #e2e8f0); width: 100%; margin: 4px 0;" />
      <div class="row"><strong>Purchased on the website? Link your email</strong></div>
      {#if !otpSent}
        <div class="row" style="gap: 8px; flex-wrap: wrap;">
          <input type="email" bind:value={linkEmail} placeholder="Enter checkout email" style="flex: 1; min-width: 200px; padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border);" />
          <button class="primary" disabled={busy} onclick={sendOtp}>Send verification code</button>
        </div>
      {:else}
        <p class="muted small" style="margin: 0;">Enter the 6-digit code sent to <strong>{linkEmail}</strong>:</p>
        <div class="row" style="gap: 8px; flex-wrap: wrap;">
          <input type="text" maxlength="6" bind:value={otpCode} placeholder="6-digit code" style="width: 140px; padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border); letter-spacing: 2px;" />
          <button class="primary" disabled={busy} onclick={verifyOtp}>Verify & Activate</button>
          <button class="ghost" disabled={busy} onclick={() => { otpSent = false; otpCode = ""; }}>Change email</button>
        </div>
      {/if}
    {/if}
  </div>

  <!-- Scheduled Auto-Clean & Windows Autostart (#9) -->
  <div class="card box">
    <div class="row">
      <strong>Scheduled Auto-Clean & Startup</strong>
      <div class="spacer"></div>
      <span class="badge free">Automation</span>
    </div>
    <p class="muted small" style="margin: 0;">Configure SWEEPR Cleaner to launch quietly with Windows and run scheduled background maintenance.</p>

    <label class="row" style="justify-content: space-between; cursor: pointer; padding: 6px 0;">
      <span>Launch SWEEPR Cleaner at Windows sign-in (Autostart)</span>
      <input
        type="checkbox"
        checked={autostart}
        onchange={(e) => toggleAutostart((e.currentTarget as HTMLInputElement).checked)}
        aria-label="Launch SWEEPR Cleaner at Windows sign-in"
      />
    </label>

    <div class="row" style="justify-content: space-between;">
      <span class="small">Auto-Clean Schedule:</span>
      <select
        value={schedule}
        onchange={(e) => updateSchedule((e.currentTarget as HTMLSelectElement).value)}
        aria-label="Auto-Clean Schedule"
        style="padding: 6px 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--panel-solid);"
      >
        <option value="off">Manual only (Off)</option>
        <option value="daily">Daily</option>
        <option value="weekly">Weekly</option>
        <option value="monthly">Monthly</option>
      </select>
    </div>

    {#if scheduleSaved}
      <div class="muted small" style="color: var(--accent);">{scheduleSaved}</div>
    {/if}
  </div>

  <!-- Lifetime Stats & Cleaning History (#13) -->
  <div class="card box">
    <div class="row">
      <strong>Lifetime Stats & Cleaning History</strong>
      <div class="spacer"></div>
      <button class="ghost small" onclick={() => api.getCleaningHistory().then((h) => (history = h)).catch(() => {})}>Refresh</button>
    </div>
    <p class="muted" style="margin: 0">
      SWEEPR Cleaner has saved you <strong>{formatBytes(stats.bytesFreed)}</strong> by removing <strong>{formatCount(stats.filesRemoved)}</strong> junk files so far.
    </p>

    {#if history.length > 0}
      <div class="history-list">
        {#each history.slice(0, 8) as entry}
          <div class="row history-item">
            <span class="mono small">{new Date(entry.timestamp * 1000).toLocaleDateString("en-GB")}</span>
            <span class="muted small" style="flex: 1;">{formatCount(entry.files_removed)} files removed</span>
            <strong style="color: var(--accent); font-size: 12.5px;">{formatBytes(entry.bytes_freed)}</strong>
          </div>
        {/each}
      </div>
    {:else}
      <div class="muted small">No recent cleaning sessions logged yet.</div>
    {/if}
  </div>

  <!-- Software Update Checker -->
  <div class="card box">
    <div class="row">
      <strong>Software Updates</strong>
      <div class="spacer"></div>
      {#if info}<span class="badge free">v{info.version}</span>{/if}
    </div>
    <p class="muted small" style="margin: 0;">Check for the latest SWEEPR Cleaner release and cleaning rules definition updates.</p>
    <div class="row">
      <button class="primary" disabled={checkingUpdate} onclick={checkUpdates}>
        {checkingUpdate ? "Checking…" : "Check for Updates"}
      </button>
      <button class="ghost" onclick={() => (showInstaller = true)}>Installer Preview</button>
    </div>
    {#if updateInfo}
      <div class="update-box small">
        {#if updateInfo.update_available}
          <strong style="color: var(--accent);">New version available: v{updateInfo.latest_version}</strong>
          <div class="muted">{updateInfo.notes}</div>
        {:else}
          <strong>You are running the latest version (v{updateInfo.current_version}).</strong>
        {/if}
      </div>
    {/if}
  </div>

  <!-- Support & Diagnostic Report (#6) -->
  <div class="card box" style="grid-column: 1 / -1;">
    <div class="row">
      <strong>Send Support & Diagnostic Report</strong>
      <div class="spacer"></div>
      <span class="muted small">Support team response within 24h</span>
    </div>
    <div class="row" style="gap: 10px; flex-wrap: wrap;">
      <input
        type="email"
        bind:value={supportEmail}
        placeholder="Your email address"
        aria-label="Support email address"
        style="flex: 1; min-width: 200px; padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border);"
      />
      <input
        type="text"
        bind:value={supportSubject}
        placeholder="Subject (optional)"
        aria-label="Support subject"
        style="flex: 1; min-width: 200px; padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border);"
      />
    </div>
    <textarea
      bind:value={supportMessage}
      rows="3"
      placeholder="Describe your question or issue…"
      aria-label="Support message"
      style="width: 100%; padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border); font-family: inherit; resize: vertical;"
    ></textarea>
    <div class="row">
      <button class="primary" disabled={sendingSupport} onclick={submitSupportReport}>
        {sendingSupport ? "Sending…" : "Send Support Report"}
      </button>
      {#if supportSuccess}
        <span class="small" style="color: var(--accent);">{supportSuccess}</span>
      {/if}
    </div>
  </div>
</div>

{#if showInstaller}
  <div class="installer-modal-overlay">
    <Installer onClose={() => (showInstaller = false)} onComplete={() => (showInstaller = false)} />
  </div>
{/if}

{#if info}
  <p class="muted small">SWEEPR Cleaner v{info.version} · {info.platform} · licence server {info.api_url}</p>
{/if}

<style>
  h1 { margin: 0 0 16px; font-size: 24px; }
  .account-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(420px, 1fr));
    gap: 16px;
    margin-bottom: 16px;
  }
  .box { padding: 18px; display: flex; flex-direction: column; gap: 12px; }
  .plan-cards {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .plan-card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    text-align: left;
    gap: 3px;
    padding: 12px 14px;
    border-radius: 12px;
    border: 1.5px solid var(--border);
    background: var(--panel-2);
    cursor: pointer;
    box-shadow: none;
    white-space: normal;
  }
  .plan-card.selected {
    border-color: var(--accent);
    background: var(--accent-light);
  }
  .plan-price {
    font-size: 18px;
    font-weight: 800;
    color: var(--accent);
  }
  .history-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 150px;
    overflow-y: auto;
    border-top: 1px solid var(--border);
    padding-top: 8px;
  }
  .history-item {
    padding: 4px 8px;
    border-radius: 6px;
    background: var(--panel-2);
  }
  .update-box {
    padding: 10px 12px;
    border-radius: 8px;
    background: var(--panel-2);
    border: 1px solid var(--border);
  }
  .error-banner {
    border-left: 4px solid var(--danger);
    color: var(--danger);
    margin-bottom: 16px;
  }
  .installer-modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.65);
    backdrop-filter: blur(8px);
    display: grid;
    place-items: center;
    z-index: 1000;
    padding: 20px;
  }
</style>
