<script lang="ts">
  import {
    api,
    errorMessage,
    isPaymentRequired,
    requestActivation,
    type AppInfo,
    type AppUpdateInfo,
    type LicenseStatus,
  } from "../lib/api";

  let { license, info, onRefresh }: { license: LicenseStatus | null; info: AppInfo | null; onRefresh: () => Promise<void> } = $props();
  let error = $state<string | null>(null);
  let busy = $state(false);
  let linkEmail = $state("");
  let otpCode = $state("");
  let otpSent = $state(false);
  let linkSuccess = $state<string | null>(null);

  // Scheduled Auto-Clean & Autostart (#9)
  let autostart = $state(false);
  let schedule = $state("off");
  let scheduleSaved = $state<string | null>(null);

  // Uninstall SWEEPR Cleaner
  let removeAppData = $state(false);
  let confirmUninstall = $state(false);
  let uninstalling = $state(false);

  // App Update Checker
  let updateInfo = $state<AppUpdateInfo | null>(null);
  let checkingUpdate = $state(false);
  let installingUpdate = $state(false);

  $effect(() => {
    api.getAutostart().then((v) => (autostart = v)).catch(() => {});
    api.getScheduleSettings().then((s) => (schedule = s || "off")).catch(() => {});
    api.checkAppUpdate().then((u) => (updateInfo = u)).catch(() => {});
  });

  async function startPlanCheckout() {
    error = null;
    busy = true;
    try {
      const activated = await api.startCheckout(linkEmail.trim() || undefined);
      if (activated) {
        linkSuccess = "Device activated with your existing subscription.";
        await onRefresh();
      }
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
      linkSuccess = `Sent a 6-digit Subscription Key to ${linkEmail.trim()}. Check your inbox (or enter any existing key below).`;
    } catch (e) {
      error = errorMessage(e);
    } finally {
      busy = false;
    }
  }

  async function verifyOtp() {
    error = null;
    linkSuccess = null;
    if (!linkEmail.trim() || !linkEmail.includes("@")) {
      error = "Please enter the email address used at checkout.";
      return;
    }
    busy = true;
    try {
      await api.verifyLoginOtp(linkEmail.trim(), otpCode.trim());
      otpSent = false;
      otpCode = "";
      linkSuccess = "Device successfully activated with your subscription.";
      await onRefresh();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      busy = false;
    }
  }

  async function toggleAutostart(next: boolean, inputEl?: HTMLInputElement) {
    if (!license?.active) {
      if (inputEl) inputEl.checked = autostart;
      requestActivation();
      return;
    }
    error = null;
    try {
      autostart = await api.setAutostart(next);
      scheduleSaved = autostart ? "Windows Autostart enabled." : "Windows Autostart disabled.";
    } catch (e) {
      if (inputEl) inputEl.checked = autostart;
      if (isPaymentRequired(e)) requestActivation();
      else error = errorMessage(e);
    }
  }

  async function updateSchedule(next: string, selectEl?: HTMLSelectElement) {
    if (!license?.active) {
      if (selectEl) selectEl.value = schedule;
      requestActivation();
      return;
    }
    error = null;
    try {
      schedule = await api.setScheduleSettings(next);
      scheduleSaved = `Auto-clean schedule set to ${schedule}.`;
    } catch (e) {
      if (selectEl) selectEl.value = schedule;
      if (isPaymentRequired(e)) requestActivation();
      else error = errorMessage(e);
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

  async function installUpdate() {
    if (!updateInfo || installingUpdate) return;
    error = null;
    installingUpdate = true;
    try {
      await api.installAppUpdate();
    } catch (e) {
      error = errorMessage(e);
      installingUpdate = false;
    }
  }

  async function runUninstallSelf() {
    if (uninstalling) return;
    error = null;
    uninstalling = true;
    try {
      await api.uninstallSelf(removeAppData);
    } catch (e) {
      error = errorMessage(e);
      uninstalling = false;
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
        <button class="ghost" disabled={busy} onclick={refresh}>Refresh status</button>
      </div>
    {:else}
      <div class="row"><strong>Free plan</strong></div>
      <p class="muted small" style="margin: 0;">System scanning and diagnostic insights are free. Activate SWEEPR Cleaner Pro to unlock cleaning, scheduled maintenance, and all optimization tools.</p>

      <div class="row" style="gap: 8px; flex-wrap: wrap;">
        <button class="primary" disabled={busy} onclick={startPlanCheckout}>
          View Plans &amp; Upgrade
        </button>
        <button class="ghost" disabled={busy} onclick={refresh}>I've already paid: refresh</button>
      </div>

      <hr style="border: none; border-top: 1px solid var(--border, #e2e8f0); width: 100%; margin: 4px 0;" />
      <div class="row"><strong>Purchased on the website? Activate with your Email &amp; Subscription Key</strong></div>
      {#if !otpSent}
        <div class="row" style="gap: 8px; flex-wrap: wrap;">
          <input type="email" bind:value={linkEmail} placeholder="Enter checkout email" style="flex: 1; min-width: 200px; padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border);" />
          <button class="primary" disabled={busy} onclick={() => {
            error = null;
            if (!linkEmail.trim() || !linkEmail.includes("@")) {
              error = "Please enter the email address used at checkout.";
              return;
            }
            otpSent = true;
          }}>Enter 6-Digit Key</button>
          <button class="ghost" disabled={busy} onclick={sendOtp}>Email me a new key</button>
        </div>
      {:else}
        <p class="muted small" style="margin: 0;">Enter the 6-digit Subscription Key sent to <strong>{linkEmail}</strong>:</p>
        <div class="row" style="gap: 8px; flex-wrap: wrap;">
          <input type="text" maxlength="6" bind:value={otpCode} placeholder="6-digit key" style="width: 140px; padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border); letter-spacing: 2px;" />
          <button class="primary" disabled={busy} onclick={verifyOtp}>Verify &amp; Activate</button>
          <button class="ghost" disabled={busy} onclick={sendOtp}>Resend key</button>
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
      {#if !license?.active}
        <span class="badge pro">Pro</span>
      {:else}
        <span class="badge free">Active</span>
      {/if}
    </div>
    <p class="muted small" style="margin: 0;">Configure SWEEPR Cleaner to launch quietly with Windows and run scheduled background maintenance.</p>

    <label class="row" style="justify-content: space-between; cursor: pointer; padding: 6px 0;">
      <span>Launch SWEEPR Cleaner at Windows sign-in (Autostart)</span>
      <input
        type="checkbox"
        checked={autostart && !!license?.active}
        onchange={(e) => toggleAutostart((e.currentTarget as HTMLInputElement).checked, e.currentTarget as HTMLInputElement)}
        aria-label="Launch SWEEPR Cleaner at Windows sign-in"
      />
    </label>

    <div class="row" style="justify-content: space-between;">
      <span class="small">Auto-Clean Schedule:</span>
      <select
        value={license?.active ? schedule : "off"}
        onchange={(e) => updateSchedule((e.currentTarget as HTMLSelectElement).value, e.currentTarget as HTMLSelectElement)}
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

  <!-- Uninstall SWEEPR Cleaner -->
  <div class="card box">
    <div class="row">
      <strong>Uninstall SWEEPR Cleaner</strong>
      <div class="spacer"></div>
      <span class="badge">Application</span>
    </div>
    <p class="muted small" style="margin: 0;">
      Cleanly remove SWEEPR Cleaner from this PC, including its Windows sign-in entry, scheduled background tasks, and Desktop/Start Menu shortcuts.
    </p>

    <label class="row" style="justify-content: space-between; cursor: pointer; padding: 4px 0;">
      <span class="small">Also remove local settings, quarantine vault &amp; logs</span>
      <input
        type="checkbox"
        bind:checked={removeAppData}
        aria-label="Also remove local settings, quarantine vault and logs"
      />
    </label>

    {#if !confirmUninstall}
      <div class="row">
        <button class="danger-outline" disabled={uninstalling} onclick={() => (confirmUninstall = true)}>
          Uninstall SWEEPR Cleaner…
        </button>
      </div>
    {:else}
      <div class="uninstall-confirm small">
        <strong>Are you sure you want to uninstall SWEEPR Cleaner from this PC?</strong>
        <div class="row" style="gap: 8px; margin-top: 8px; flex-wrap: wrap;">
          <button class="danger-btn" disabled={uninstalling} onclick={runUninstallSelf}>
            {uninstalling ? "Uninstalling…" : "Yes, Uninstall Now"}
          </button>
          <button class="ghost" disabled={uninstalling} onclick={() => (confirmUninstall = false)}>
            Cancel
          </button>
        </div>
      </div>
    {/if}
  </div>

  <!-- Software Update Checker -->
  <div class="card box">
    <div class="row">
      <strong>Software Updates</strong>
      <div class="spacer"></div>
      {#if info}<span class="badge free">v{info.version}</span>{/if}
    </div>
    <p class="muted small" style="margin: 0;">SWEEPR Cleaner securely checks GitHub Releases and the SWEEPR update server over HTTPS with SHA-256 integrity verification.</p>
    <div class="row" style="gap: 8px; flex-wrap: wrap;">
      <button class="ghost" disabled={checkingUpdate || installingUpdate} onclick={checkUpdates}>
        {checkingUpdate ? "Checking…" : "Check for Updates"}
      </button>
      {#if updateInfo?.update_available}
        <button class="primary" disabled={installingUpdate} onclick={installUpdate}>
          {installingUpdate ? "Downloading & Updating…" : `Update to v${updateInfo.latest_version} & Restart`}
        </button>
      {/if}
    </div>
    {#if updateInfo}
      <div class="update-box small">
        {#if updateInfo.update_available}
          <strong style="color: var(--accent);">New version available: v{updateInfo.latest_version}</strong>
          <div class="muted">{updateInfo.notes}</div>
        {:else}
          <strong>You are running the latest version (v{updateInfo.current_version}).</strong>
          {#if updateInfo.notes}
            <div class="muted" style="margin-top: 2px;">{updateInfo.notes}</div>
          {/if}
        {/if}
      </div>
    {/if}
  </div>
</div>

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
  .uninstall-confirm {
    padding: 12px;
    border-radius: 8px;
    background: var(--danger-soft, rgba(239, 68, 68, 0.1));
    border: 1px solid rgba(239, 68, 68, 0.35);
    color: var(--text);
  }
  .danger-outline {
    background: transparent;
    color: var(--danger, #ef4444);
    border: 1px solid rgba(239, 68, 68, 0.45);
    padding: 8px 14px;
    border-radius: 8px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease;
  }
  .danger-outline:hover:not(:disabled) {
    background: var(--danger-soft, rgba(239, 68, 68, 0.12));
    border-color: var(--danger, #ef4444);
  }
  .danger-btn {
    background: var(--danger, #ef4444);
    color: #ffffff;
    border: none;
    padding: 8px 14px;
    border-radius: 8px;
    font-weight: 600;
    cursor: pointer;
  }
  .danger-btn:hover:not(:disabled) {
    filter: brightness(0.95);
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
</style>
