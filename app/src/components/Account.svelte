<script lang="ts" module>
  let cachedLinkEmail = "";
  let cachedOtpSent = false;
</script>

<script lang="ts">
  import {
    api,
    errorMessage,
    type AppInfo,
    type AppUpdateInfo,
    type LicenseStatus,
  } from "../lib/api";

  let {
    license,
    info,
    onRefresh,
  }: {
    license: LicenseStatus | null;
    info: AppInfo | null;
    onRefresh: () => Promise<void>;
  } = $props();
  let error = $state<string | null>(null);
  let busy = $state(false);
  let linkEmail = $state(cachedLinkEmail);
  let otpCode = $state("");
  let otpSent = $state(cachedOtpSent);
  let linkSuccess = $state<string | null>(null);

  // Help & Diagnostic Support
  let showSupportForm = $state(false);
  let supportEmail = $state(cachedLinkEmail);
  let supportSubject = $state("Diagnostic & Support Request");
  let supportMessage = $state("");
  let sendingSupport = $state(false);
  let supportSentNotice = $state<string | null>(null);

  // Uninstall SWEEPR Cleaner
  let removeAppData = $state(false);
  let confirmUninstall = $state(false);
  let uninstalling = $state(false);

  // App Update Checker
  let updateInfo = $state<AppUpdateInfo | null>(null);
  let checkingUpdate = $state(false);
  let installingUpdate = $state(false);

  $effect(() => {
    cachedLinkEmail = linkEmail;
    cachedOtpSent = otpSent;
  });

  $effect(() => {
    api.checkAppUpdate().then((u) => (updateInfo = u)).catch(() => {});
  });

  async function submitSupportReport() {
    error = null;
    supportSentNotice = null;
    if (!supportEmail.trim() || !supportEmail.includes("@")) {
      error = "Please enter your email address so our support team can reply.";
      return;
    }
    if (!supportMessage.trim()) {
      error = "Please describe the issue or question before sending.";
      return;
    }
    sendingSupport = true;
    try {
      const msg = await api.sendSupportReport(
        supportEmail.trim(),
        supportSubject.trim() || "Diagnostic & Support Request",
        supportMessage.trim()
      );
      supportSentNotice = msg || "Diagnostic report sent! We will reply to your email shortly.";
      supportMessage = "";
      showSupportForm = false;
    } catch (e) {
      error = errorMessage(e);
    } finally {
      sendingSupport = false;
    }
  }

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

  const expiry = $derived(
    license?.expires_at ? new Date(license.expires_at * 1000).toLocaleString("en-GB") : null
  );
</script>

<div class="account-layout">
  <div class="header-row">
    <div>
      <h1 class="page-title">Account &amp; Settings</h1>
      <p class="muted small" style="margin: 4px 0 0 0;">
        Manage your SWEEPR Cleaner subscription, check for software updates, send diagnostic support reports, or uninstall the application.
      </p>
    </div>
  </div>

  {#if error}<div class="card box error-banner">{error}</div>{/if}
  {#if linkSuccess}<div class="card box" style="border-color: var(--accent); color: var(--accent);">{linkSuccess}</div>{/if}
  {#if supportSentNotice}<div class="card box" style="border-color: var(--accent); color: var(--accent);">{supportSentNotice}</div>{/if}

  <!-- 1. Subscription & Licence Status (Full Width) -->
  <div class="card box">
    {#if license?.active}
      <div class="row">
        <strong>Subscription Status</strong>
        <span class="badge free">{license.status}</span>
        {#if license.plan}<span class="badge pro">{license.plan}</span>{/if}
        {#if license.offline}<span class="badge">offline</span>{/if}
        <div class="spacer"></div>
        <button class="ghost" disabled={busy} onclick={refresh}>Refresh Status</button>
      </div>
      {#if expiry}
        <div class="muted small">Licence check valid until {expiry}. Renews automatically while online.</div>
      {/if}
    {:else}
      <div class="row" style="justify-content: space-between; flex-wrap: wrap;">
        <div>
          <strong style="font-size: 15.5px;">Free Plan</strong>
          <p class="muted small" style="margin: 4px 0 0 0;">
            System scanning and diagnostics are free. Activate SWEEPR Cleaner Pro to unlock cleanup, scheduled maintenance, and all optimization tools.
          </p>
        </div>
        <div class="row" style="gap: 8px; flex-wrap: wrap;">
          <button class="primary" disabled={busy} onclick={startPlanCheckout}>
            View Plans &amp; Upgrade
          </button>
          <button class="ghost" disabled={busy} onclick={refresh}>Refresh Status</button>
        </div>
      </div>

      <hr style="border: none; border-top: 1px solid var(--border, #e2e8f0); width: 100%; margin: 4px 0;" />
      <div class="row"><strong>Already subscribed? Activate with your Email &amp; Subscription Key</strong></div>
      {#if !otpSent}
        <div class="row" style="gap: 8px; flex-wrap: wrap;">
          <input
            type="email"
            bind:value={linkEmail}
            placeholder="Enter checkout email address"
            style="flex: 1; min-width: 220px; padding: 9px 14px; border-radius: 9999px; border: 1px solid var(--border);"
          />
          <button
            class="primary"
            disabled={busy}
            onclick={() => {
              error = null;
              if (!linkEmail.trim() || !linkEmail.includes("@")) {
                error = "Please enter the email address used at checkout.";
                return;
              }
              otpSent = true;
            }}
          >
            Enter 6-Digit Key
          </button>
          <button class="ghost" disabled={busy} onclick={sendOtp}>Email me a new key</button>
        </div>
      {:else}
        <p class="muted small" style="margin: 0;">Enter the 6-digit Subscription Key sent to <strong>{linkEmail}</strong>:</p>
        <div class="row" style="gap: 8px; flex-wrap: wrap;">
          <input
            type="text"
            maxlength="6"
            bind:value={otpCode}
            placeholder="6-digit key"
            style="width: 150px; padding: 9px 14px; border-radius: 9999px; border: 1px solid var(--border); letter-spacing: 2px;"
          />
          <button class="primary" disabled={busy} onclick={verifyOtp}>Verify &amp; Activate</button>
          <button class="ghost" disabled={busy} onclick={sendOtp}>Resend key</button>
          <button class="ghost" disabled={busy} onclick={() => { otpSent = false; otpCode = ""; }}>Change email</button>
        </div>
      {/if}
    {/if}
  </div>

  <!-- 2. Software Updates, Help & Diagnostic Support, and Uninstall -->
  <div class="account-grid">
    <!-- Software Update Checker -->
    <div class="card box">
      <div class="row">
        <strong>Software Updates</strong>
        <div class="spacer"></div>
        {#if info}<span class="badge free">v{info.version}</span>{/if}
      </div>
      <p class="muted small" style="margin: 0;">
        Checks the SWEEPR update service over HTTPS with cryptographic signature verification.
      </p>
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

    <!-- Help & Diagnostic Support (WCAG 3.2.6 Consistent Help) -->
    <div class="card box">
      <div class="row">
        <strong>Help &amp; Diagnostic Support</strong>
        <div class="spacer"></div>
        <span class="badge free">Support</span>
      </div>
      <p class="muted small" style="margin: 0;">
        Need help with a scan, licence activation, or system cleanup? Send a diagnostic report with anonymous app telemetry to our support team.
      </p>
      {#if !showSupportForm}
        <div class="row" style="margin-top: auto;">
          <button class="ghost" onclick={() => (showSupportForm = true)}>
            Contact Support / Send Diagnostics…
          </button>
        </div>
      {:else}
        <div style="display: flex; flex-direction: column; gap: 8px;">
          <input
            type="email"
            bind:value={supportEmail}
            placeholder="Your email address for reply"
            aria-label="Your email address for reply"
            style="padding: 8px 14px; border-radius: 9999px; border: 1px solid var(--border); font-size: 13px;"
          />
          <input
            type="text"
            bind:value={supportSubject}
            placeholder="Subject"
            aria-label="Support subject"
            style="padding: 8px 14px; border-radius: 9999px; border: 1px solid var(--border); font-size: 13px;"
          />
          <textarea
            rows="3"
            bind:value={supportMessage}
            placeholder="Describe what happened or what you need help with…"
            aria-label="Support message"
            style="padding: 10px 14px; border-radius: 12px; border: 1px solid var(--border); font-family: inherit; font-size: 13px; resize: vertical;"
          ></textarea>
          <div class="row" style="gap: 8px;">
            <button class="primary" disabled={sendingSupport} onclick={submitSupportReport}>
              {sendingSupport ? "Sending…" : "Send Diagnostic Report"}
            </button>
            <button class="ghost" disabled={sendingSupport} onclick={() => (showSupportForm = false)}>
              Cancel
            </button>
          </div>
        </div>
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
        Cleanly remove SWEEPR Cleaner from this PC, including its Windows sign-in entry, scheduled tasks, and shortcuts.
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
        <div class="row" style="margin-top: auto;">
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
  </div>

  {#if info}
    <p class="muted small selectable">SWEEPR Cleaner v{info.version} · {info.platform} · licence server {info.api_url}</p>
  {/if}
</div>

<style>
  .account-layout {
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
  .account-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(380px, 1fr));
    gap: 18px;
  }
  .box {
    padding: 22px 24px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .uninstall-confirm {
    padding: 12px;
    border-radius: 10px;
    background: var(--danger-soft, rgba(239, 68, 68, 0.1));
    border: 1px solid rgba(239, 68, 68, 0.35);
    color: var(--text);
  }
  .danger-outline {
    background: transparent;
    color: var(--danger, #ef4444);
    border: 1px solid rgba(239, 68, 68, 0.45);
    padding: 8px 16px;
    border-radius: 9999px;
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
    padding: 8px 16px;
    border-radius: 9999px;
    font-weight: 600;
    cursor: pointer;
  }
  .danger-btn:hover:not(:disabled) {
    filter: brightness(0.95);
  }
  .update-box {
    padding: 10px 12px;
    border-radius: 10px;
    background: var(--panel-2);
    border: 1px solid var(--border);
  }
  .error-banner {
    border-left: 4px solid var(--danger);
    color: var(--danger);
  }
</style>
