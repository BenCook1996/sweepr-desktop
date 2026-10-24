<script lang="ts" module>
  let cachedLinkEmail = "";
  let cachedOtpSent = false;
</script>

<script lang="ts">
  import Schedule from "./Schedule.svelte";
  import {
    api,
    errorMessage,
    type AppInfo,
    type AppUpdateInfo,
    type LicenseStatus,
  } from "../lib/api";
  import { lang, setLang, LANGUAGES, type Lang } from "../lib/i18n";

  let {
    license,
    info,
    theme = "light",
    onToggleTheme,
    onRefresh,
    section = $bindable<"schedule" | "account">("account"),
  }: {
    license: LicenseStatus | null;
    info: AppInfo | null;
    theme?: "light" | "dark";
    onToggleTheme?: () => void;
    onRefresh: () => Promise<void>;
    section?: "schedule" | "account";
  } = $props();

  let error = $state<string | null>(null);
  let busy = $state(false);
  let linkEmail = $state(cachedLinkEmail);
  let otpCode = $state("");
  let otpSent = $state(cachedOtpSent);
  let linkSuccess = $state<string | null>(null);

  // Help & Support
  let showSupportForm = $state(false);
  let supportEmail = $state(cachedLinkEmail);
  let supportSubject = $state("Question / Help Request");
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
    api
      .checkAppUpdate()
      .then((u) => (updateInfo = u))
      .catch(() => {});
  });

  async function submitSupportReport() {
    error = null;
    supportSentNotice = null;
    if (!supportEmail.trim() || !supportEmail.includes("@")) {
      error = "Please enter your email address so our support team can reply.";
      return;
    }
    if (!supportMessage.trim()) {
      error = "Please describe what you need help with before sending.";
      return;
    }
    sendingSupport = true;
    try {
      await api.sendSupportReport(
        supportEmail.trim(),
        supportSubject.trim() || "Question / Help Request",
        supportMessage.trim()
      );
      supportSentNotice = "Message sent! Our support team will reply to your email shortly.";
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
        linkSuccess = "Your PC is now activated with your subscription!";
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
      error = "Please enter the email address you used when subscribing.";
      return;
    }
    busy = true;
    try {
      await api.requestLoginOtp(linkEmail.trim());
      otpSent = true;
      linkSuccess = `We emailed a 6-digit activation code to ${linkEmail.trim()}. Enter it below to unlock Pro.`;
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
      error = "Please enter the email address you used when subscribing.";
      return;
    }
    busy = true;
    try {
      await api.verifyLoginOtp(linkEmail.trim(), otpCode.trim());
      otpSent = false;
      otpCode = "";
      linkSuccess = "Your PC is now activated with SWEEPR Pro!";
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
    license?.expires_at
      ? new Date(license.expires_at * 1000).toLocaleDateString("en-GB")
      : null
  );
</script>

<div class="account-layout">
  <div class="header-row">
    <div>
      <h1 class="page-title">Account &amp; Auto-Clean</h1>
      <p class="muted small" style="margin: 4px 0 0 0;">
        Set up automatic background cleaning, manage your subscription, or contact our support team.
      </p>
    </div>

    <div class="mode-toggle" role="tablist">
      <button
        class="mode-btn"
        class:active={section === "schedule"}
        onclick={() => (section = "schedule")}
        role="tab"
        aria-selected={section === "schedule"}
      >
        Auto-Clean Schedule
      </button>
      <button
        class="mode-btn"
        class:active={section === "account"}
        onclick={() => (section = "account")}
        role="tab"
        aria-selected={section === "account"}
      >
        My Account, Updates &amp; Help
      </button>
    </div>
  </div>

  {#if section === "schedule"}
    <Schedule {license} />
  {:else}
    {#if error}<div class="card box error-banner">{error}</div>{/if}
    {#if linkSuccess}<div class="card box success-banner">{linkSuccess}</div>{/if}
    {#if supportSentNotice}<div class="card box success-banner">{supportSentNotice}</div>{/if}

    <!-- 1. Subscription Status -->
    <div class="card box">
      {#if license?.active}
        <div class="row">
          <strong>Your Subscription</strong>
          <span class="badge free">SWEEPR Pro Active</span>
          {#if license.plan}<span class="badge pro">{license.plan}</span>{/if}
          <div class="spacer"></div>
          <button class="ghost small-btn" disabled={busy} onclick={refresh}>Refresh Status</button>
        </div>
        {#if expiry}
          <div class="muted small">Active and renews automatically (checked until {expiry}).</div>
        {/if}
      {:else}
        <div class="row" style="justify-content: space-between; flex-wrap: wrap; gap: 12px;">
          <div>
            <strong style="font-size: 16px;">You are on the Free Plan</strong>
            <p class="muted small" style="margin: 4px 0 0 0;">
              Scanning your PC is always free. Upgrade to SWEEPR Pro to unlock 1-click cleaning, speed boost, duplicate removal, and automatic cleaning.
            </p>
          </div>
          <div class="row" style="gap: 8px; flex-wrap: wrap;">
            <button class="primary small-btn" disabled={busy} onclick={startPlanCheckout}>
              View Plans &amp; Upgrade to Pro
            </button>
            <button class="ghost small-btn" disabled={busy} onclick={refresh}>Refresh</button>
          </div>
        </div>

        <hr style="border: none; border-top: 1px solid var(--border); width: 100%; margin: 6px 0;" />
        <div class="row"><strong>Already bought SWEEPR Pro? Activate this PC with your email</strong></div>
        {#if !otpSent}
          <div class="row" style="gap: 8px; flex-wrap: wrap;">
            <input
              type="email"
              bind:value={linkEmail}
              placeholder="Enter the email address you used at checkout"
              style="flex: 1; min-width: 240px; padding: 9px 14px; border-radius: 9999px; border: 1px solid var(--border);"
            />
            <button class="primary small-btn" disabled={busy} onclick={sendOtp}>
              Email Me an Activation Code
            </button>
            <button
              class="ghost small-btn"
              disabled={busy}
              onclick={() => {
                error = null;
                if (!linkEmail.trim() || !linkEmail.includes("@")) {
                  error = "Please enter the email address you used at checkout.";
                  return;
                }
                otpSent = true;
              }}
            >
              I already have a 6-digit code
            </button>
          </div>
        {:else}
          <p class="muted small" style="margin: 0;">
            Enter the 6-digit code sent to <strong>{linkEmail}</strong>:
          </p>
          <div class="row" style="gap: 8px; flex-wrap: wrap;">
            <input
              type="text"
              maxlength="6"
              bind:value={otpCode}
              placeholder="6-digit code"
              style="width: 150px; padding: 9px 14px; border-radius: 9999px; border: 1px solid var(--border); letter-spacing: 2px;"
            />
            <button class="primary small-btn" disabled={busy} onclick={verifyOtp}>
              Activate Pro
            </button>
            <button class="ghost small-btn" disabled={busy} onclick={sendOtp}>Resend code</button>
            <button
              class="ghost small-btn"
              disabled={busy}
              onclick={() => {
                otpSent = false;
                otpCode = "";
              }}
            >
              Change email
            </button>
          </div>
        {/if}
      {/if}
    </div>

    <!-- 2. App Updates, Help & Support, and Uninstall -->
    <div class="account-grid">
      <!-- App Updates -->
      <div class="card box">
        <div class="row">
          <strong>App Updates</strong>
          <div class="spacer"></div>
          {#if info}<span class="badge free">v{info.version}</span>{/if}
        </div>
        <p class="muted small" style="margin: 0;">
          Check if a newer version of SWEEPR Cleaner is available.
        </p>
        <div class="row" style="gap: 8px; flex-wrap: wrap;">
          <button
            class="ghost small-btn"
            disabled={checkingUpdate || installingUpdate}
            onclick={checkUpdates}
          >
            {checkingUpdate ? "Checking…" : "Check for Updates"}
          </button>
          {#if updateInfo?.update_available}
            <button class="primary small-btn" disabled={installingUpdate} onclick={installUpdate}>
              {installingUpdate
                ? "Updating…"
                : `Update to v${updateInfo.latest_version} & Restart`}
            </button>
          {/if}
        </div>
        {#if updateInfo}
          <div class="update-box small">
            {#if updateInfo.update_available}
              <strong style="color: var(--accent);">
                New version available: v{updateInfo.latest_version}
              </strong>
              <div class="muted">{updateInfo.notes}</div>
            {:else}
              <strong>You have the latest version (v{updateInfo.current_version}).</strong>
            {/if}
          </div>
        {/if}
      </div>

      <!-- Get Help / Contact Support -->
      <div class="card box">
        <div class="row">
          <strong>Get Help &amp; Support</strong>
          <div class="spacer"></div>
          <span class="badge free">We're Here to Help</span>
        </div>
        <p class="muted small" style="margin: 0;">
          Have a question about cleaning your PC or activating your subscription? Send us a message and we'll reply by email.
        </p>
        {#if !showSupportForm}
          <div class="row" style="margin-top: auto;">
            <button class="ghost small-btn" onclick={() => (showSupportForm = true)}>
              Contact Support…
            </button>
          </div>
        {:else}
          <div style="display: flex; flex-direction: column; gap: 8px;">
            <input
              type="email"
              bind:value={supportEmail}
              placeholder="Your email address"
              aria-label="Your email address"
              style="padding: 8px 14px; border-radius: 9999px; border: 1px solid var(--border); font-size: 13px;"
            />
            <textarea
              rows="3"
              bind:value={supportMessage}
              placeholder="How can we help you?"
              aria-label="Support message"
              style="padding: 10px 14px; border-radius: 12px; border: 1px solid var(--border); font-family: inherit; font-size: 13px; resize: vertical;"
            ></textarea>
            <div class="row" style="gap: 8px;">
              <button class="primary small-btn" disabled={sendingSupport} onclick={submitSupportReport}>
                {sendingSupport ? "Sending…" : "Send Message"}
              </button>
              <button
                class="ghost small-btn"
                disabled={sendingSupport}
                onclick={() => (showSupportForm = false)}
              >
                Cancel
              </button>
            </div>
          </div>
        {/if}
      </div>

      <!-- Appearance & Language -->
      <div class="card box">
        <div class="row">
          <strong>Appearance &amp; Language</strong>
          <div class="spacer"></div>
        </div>
        <div class="row" style="justify-content: space-between;">
          <span class="small">App Theme</span>
          <button class="ghost small-btn" onclick={() => onToggleTheme?.()}>
            {theme === "dark" ? "🌙 Dark Mode (Switch to Light)" : "☀️ Light Mode (Switch to Dark)"}
          </button>
        </div>
        <div class="row" style="justify-content: space-between;">
          <span class="small">Language</span>
          <select
            class="small-btn"
            style="border: 1px solid var(--border); background: var(--panel-2); color: var(--text);"
            aria-label="Select language"
            value={$lang}
            onchange={(e) => setLang((e.currentTarget as HTMLSelectElement).value as Lang)}
          >
            {#each LANGUAGES as l}
              <option value={l.code}>{l.region} - {l.label}</option>
            {/each}
          </select>
        </div>
      </div>
    </div>

    <!-- Advanced & Troubleshooting Disclosure (Uninstall tucked inside) -->
    <details class="card" style="padding: 14px 18px;">
      <summary class="small muted" style="cursor: pointer; font-weight: 600; user-select: none;">
        Advanced &amp; Troubleshooting
      </summary>
      <div style="margin-top: 14px; display: flex; flex-direction: column; gap: 10px;">
        <div class="row">
          <strong class="small">Uninstall SWEEPR Cleaner</strong>
          <div class="spacer"></div>
        </div>
        <p class="muted small" style="margin: 0;">
          Remove SWEEPR Cleaner and its shortcuts from this PC.
        </p>

        <label class="row" style="justify-content: space-between; cursor: pointer; padding: 4px 0;">
          <span class="small">Also remove my saved settings and 7-day undo files</span>
          <input type="checkbox" bind:checked={removeAppData} />
        </label>

        {#if !confirmUninstall}
          <div class="row">
            <button
              class="danger-outline"
              disabled={uninstalling}
              onclick={() => (confirmUninstall = true)}
            >
              Uninstall SWEEPR Cleaner…
            </button>
          </div>
        {:else}
          <div class="uninstall-confirm small">
            <strong>Are you sure you want to uninstall SWEEPR Cleaner?</strong>
            <div class="row" style="gap: 8px; margin-top: 8px; flex-wrap: wrap;">
              <button class="danger-btn" disabled={uninstalling} onclick={runUninstallSelf}>
                {uninstalling ? "Uninstalling…" : "Yes, Uninstall Now"}
              </button>
              <button
                class="ghost small-btn"
                disabled={uninstalling}
                onclick={() => (confirmUninstall = false)}
              >
                Cancel
              </button>
            </div>
          </div>
        {/if}
      </div>
    </details>

    {#if info}
      <p class="muted small">SWEEPR Cleaner v{info.version}</p>
    {/if}
  {/if}
</div>

<style>
  .account-layout {
    max-width: 1120px;
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
    flex-wrap: wrap;
    gap: 12px;
  }
  .page-title {
    margin: 0;
    font-size: 26px;
    font-weight: 800;
    letter-spacing: -0.5px;
  }
  .mode-toggle {
    display: flex;
    background: var(--panel-2);
    padding: 4px;
    border-radius: 9999px;
    border: 1px solid var(--border);
  }
  .mode-btn {
    background: transparent;
    border: none;
    padding: 7px 16px;
    border-radius: 9999px;
    font-size: 13px;
    font-weight: 600;
    color: var(--muted);
    cursor: pointer;
    box-shadow: none;
  }
  .mode-btn.active {
    background: var(--panel-solid);
    color: var(--accent);
    box-shadow: 0 2px 6px rgba(15, 23, 42, 0.08);
  }
  .account-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 18px;
  }
  .box {
    padding: 22px 24px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .small-btn {
    padding: 7px 15px;
    font-size: 12.5px;
    border-radius: 9999px;
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
    padding: 7px 16px;
    border-radius: 9999px;
    font-size: 12.5px;
    font-weight: 600;
    cursor: pointer;
  }
  .danger-btn {
    background: var(--danger, #ef4444);
    color: #ffffff;
    border: none;
    padding: 7px 16px;
    border-radius: 9999px;
    font-size: 12.5px;
    font-weight: 600;
    cursor: pointer;
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
  .success-banner {
    border-left: 4px solid var(--accent);
    background: var(--accent-light);
    font-weight: 600;
  }
</style>
