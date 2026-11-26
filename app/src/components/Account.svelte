<script lang="ts" module>
  let cachedLinkEmail = "";
  let cachedOtpSent = false;
</script>

<script lang="ts">
  import Schedule from "./Schedule.svelte";
  import {
    api,
    errorMessage,
    QUARANTINE_DEFAULT_BUDGET_BYTES,
    QUARANTINE_MAX_BUDGET_BYTES,
    QUARANTINE_MIN_BUDGET_BYTES,
    requestActivation,
    type AppInfo,
    type AppUpdateInfo,
    type LicenseStatus,
    type QuarantineStatus,
    type UiPreferences,
  } from "../lib/api";
  import { formatBytes } from "../lib/format";
  import { lang, setLang, LANGUAGES, t, type Lang } from "../lib/i18n";

  let {
    license,
    info,
    preferences = null,
    onPreferencesChange,
    theme = "light",
    onToggleTheme,
    onRefresh,
    section = $bindable<"schedule" | "account">("account"),
  }: {
    license: LicenseStatus | null;
    info: AppInfo | null;
    preferences?: UiPreferences | null;
    onPreferencesChange?: (prefs: UiPreferences) => void;
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

  // Scan Exclusions
  let exclusions = $state<string[]>([]);
  let newExclusionPath = $state("");

  // Privacy (Zero-Telemetry / Offline Mode) & 7-Day Quarantine Budget
  let telemetryEnabled = $state(false);
  const zeroTelemetryMode = $derived(!telemetryEnabled);
  let quarantineBudgetBytes = $state(QUARANTINE_DEFAULT_BUDGET_BYTES);
  const quarantineBudgetGb = $derived(
    Math.min(10, Math.max(2, Math.round(quarantineBudgetBytes / (1024 * 1024 * 1024))))
  );
  let quarantineStatus = $state<QuarantineStatus | null>(null);
  let savingPrefs = $state(false);
  let prefsInitialized = false;

  $effect(() => {
    if (preferences && !prefsInitialized) {
      telemetryEnabled = Boolean(preferences.telemetry_enabled);
      quarantineBudgetBytes =
        preferences.quarantine_budget_bytes || QUARANTINE_DEFAULT_BUDGET_BYTES;
    }
  });

  async function setZeroTelemetryMode(enableZeroTelemetry: boolean) {
    const nextTelemetryEnabled = !enableZeroTelemetry;
    const prev = telemetryEnabled;
    telemetryEnabled = nextTelemetryEnabled;
    savingPrefs = true;
    error = null;
    try {
      const saved = await api.saveUiPreferences({ telemetryEnabled: nextTelemetryEnabled });
      telemetryEnabled = Boolean(saved.telemetry_enabled);
      onPreferencesChange?.(saved);
    } catch (e) {
      telemetryEnabled = prev;
      error = errorMessage(e);
    } finally {
      savingPrefs = false;
    }
  }

  async function setQuarantineBudgetGb(gb: number) {
    const clampedGb = Math.min(10, Math.max(2, Math.round(gb)));
    const nextBytes = Math.min(
      QUARANTINE_MAX_BUDGET_BYTES,
      Math.max(QUARANTINE_MIN_BUDGET_BYTES, clampedGb * 1024 * 1024 * 1024)
    );
    const prev = quarantineBudgetBytes;
    quarantineBudgetBytes = nextBytes;
    savingPrefs = true;
    error = null;
    try {
      const saved = await api.saveUiPreferences({ quarantineBudgetBytes: nextBytes });
      quarantineBudgetBytes = saved.quarantine_budget_bytes;
      onPreferencesChange?.(saved);
      quarantineStatus = await api.getQuarantineStatus().catch(() => quarantineStatus);
    } catch (e) {
      quarantineBudgetBytes = prev;
      error = errorMessage(e);
    } finally {
      savingPrefs = false;
    }
  }

  async function addScanExclusion() {
    const p = newExclusionPath.trim();
    if (!p) return;
    error = null;
    try {
      exclusions = await api.addExclusion(p);
      newExclusionPath = "";
    } catch (e) {
      error = errorMessage(e);
    }
  }

  async function pickExclusionFolder() {
    error = null;
    try {
      const picked = await api.pickFolder();
      if (picked) {
        exclusions = await api.addExclusion(picked);
      }
    } catch (e) {
      error = errorMessage(e);
    }
  }

  async function removeScanExclusion(path: string) {
    error = null;
    try {
      exclusions = await api.removeExclusion(path);
    } catch (e) {
      error = errorMessage(e);
    }
  }

  // Bi-Directional QR Device Linking (Flow A & Flow B)
  let qrMode = $state<"none" | "challenge" | "token">("none");
  let qrSvg = $state<string | null>(null);
  let qrCountdown = $state(120);
  let qrDevicesUsed = $state(1);
  let qrDevicesMax = $state(5);
  let qrInterval: ReturnType<typeof setInterval> | null = null;

  function stopQrTimer() {
    if (qrInterval) clearInterval(qrInterval);
    qrInterval = null;
  }

  async function startDesktopQrChallenge() {
    error = null;
    linkSuccess = null;
    stopQrTimer();
    qrMode = "challenge";
    qrSvg = null;
    try {
      const ch = await api.startQrChallenge();
      qrSvg = ch.qr_svg;
      qrCountdown = ch.ttl_seconds || 120;
      qrInterval = setInterval(async () => {
        qrCountdown = Math.max(0, qrCountdown - 1);
        if (qrCountdown <= 0) {
          stopQrTimer();
          return;
        }
        if (qrCountdown % 2 === 0) {
          try {
            const res = await api.pollQrChallenge(ch.challenge_id, ch.poll_secret);
            if (res.status === "approved") {
              stopQrTimer();
              qrMode = "none";
              linkSuccess = "Your PC is now activated with SWEEPR Pro via QR Code!";
              await onRefresh();
            } else if (res.status === "expired") {
              qrCountdown = 0;
              stopQrTimer();
            }
          } catch {}
        }
      }, 1000);
    } catch (e) {
      error = errorMessage(e);
      qrMode = "none";
    }
  }

  async function showLinkAnotherDeviceQr() {
    error = null;
    linkSuccess = null;
    stopQrTimer();
    qrMode = "token";
    qrSvg = null;
    try {
      const tok = await api.createQrLinkToken();
      qrSvg = tok.qr_svg;
      qrCountdown = tok.ttl_seconds || 120;
      qrDevicesUsed = tok.devices_used || 1;
      qrDevicesMax = tok.devices_max || 5;
      qrInterval = setInterval(() => {
        qrCountdown = Math.max(0, qrCountdown - 1);
        if (qrCountdown <= 0) stopQrTimer();
      }, 1000);
    } catch (e) {
      error = errorMessage(e);
      qrMode = "none";
    }
  }

  $effect(() => {
    cachedLinkEmail = linkEmail;
    cachedOtpSent = otpSent;
  });

  $effect(() => {
    api
      .getUiPreferences()
      .then((prefs) => {
        prefsInitialized = true;
        telemetryEnabled = Boolean(prefs.telemetry_enabled);
        quarantineBudgetBytes =
          prefs.quarantine_budget_bytes || QUARANTINE_DEFAULT_BUDGET_BYTES;
        onPreferencesChange?.(prefs);
        if (prefs.telemetry_enabled) {
          api
            .checkAppUpdate()
            .then((u) => (updateInfo = u))
            .catch(() => {});
        }
      })
      .catch(() => {});
    api
      .getQuarantineStatus()
      .then((qs) => (quarantineStatus = qs))
      .catch(() => {});
    api
      .listExclusions()
      .then((ex) => (exclusions = ex))
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
    requestActivation();
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
    <h1 class="page-title">{t("nav.settings", $lang)}</h1>

    <div class="mode-toggle" role="tablist">
      <button
        class="mode-btn"
        class:active={section === "schedule"}
        onclick={() => (section = "schedule")}
        role="tab"
        aria-selected={section === "schedule"}
      >
        {t("nav.schedule", $lang)}
      </button>
      <button
        class="mode-btn"
        class:active={section === "account"}
        onclick={() => (section = "account")}
        role="tab"
        aria-selected={section === "account"}
      >
        {t("nav.account", $lang)}
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
          <strong>Subscription</strong>
          <span class="badge free">{t("tier.activated", $lang)}</span>
          {#if license.plan}<span class="badge pro">{license.plan}</span>{/if}
          <div class="spacer"></div>
          <button class="ghost small-btn" disabled={busy} onclick={showLinkAnotherDeviceQr}>
            Pair Another Device via QR
          </button>
          <button class="ghost small-btn" disabled={busy} onclick={refresh}>Refresh</button>
        </div>
        {#if expiry}
          <div class="muted small">Renews {expiry} · Clean up to 5 devices (log in at sweeprcleaner.com/dashboard to activate another device via QR code)</div>
        {/if}
      {:else}
        <div class="row" style="justify-content: space-between; flex-wrap: wrap; gap: 12px;">
          <strong>{t("tier.free", $lang)}</strong>
          <div class="row" style="gap: 8px; flex-wrap: wrap;">
            <button class="primary small-btn" disabled={busy} onclick={startPlanCheckout}>
              {t("tier.unlockPro", $lang)}
            </button>
            <button class="ghost small-btn" disabled={busy} onclick={startDesktopQrChallenge}>
              Sign In with QR Code
            </button>
            <button class="ghost small-btn" disabled={busy} onclick={refresh}>Refresh</button>
          </div>
        </div>

        <hr style="border: none; border-top: 1px solid var(--border); width: 100%; margin: 6px 0;" />
        {#if !otpSent}
          <div class="row" style="gap: 8px; flex-wrap: wrap;">
            <input
              type="email"
              bind:value={linkEmail}
              placeholder="Account email"
              style="flex: 1; min-width: 200px; padding: 9px 14px; border-radius: 9999px; border: 1px solid var(--border);"
            />
            <input
              type="text"
              maxlength="64"
              bind:value={otpCode}
              placeholder="Full activation code (optional)"
              style="flex: 1; min-width: 200px; padding: 9px 14px; border-radius: 9999px; border: 1px solid var(--border);"
            />
            {#if otpCode.trim().length > 0}
              <button class="primary small-btn" disabled={busy} onclick={verifyOtp}>
                Activate
              </button>
            {:else}
              <button class="primary small-btn" disabled={busy} onclick={sendOtp}>
                Send Email Code
              </button>
            {/if}
          </div>
        {:else}
          <div class="row" style="gap: 8px; flex-wrap: wrap;">
            <input
              type="text"
              maxlength="64"
              bind:value={otpCode}
              placeholder="Full activation code or 6-digit email code"
              style="min-width: 240px; padding: 9px 14px; border-radius: 9999px; border: 1px solid var(--border);"
            />
            <button class="primary small-btn" disabled={busy} onclick={verifyOtp}>
              Activate
            </button>
            <button class="ghost small-btn" disabled={busy} onclick={sendOtp}>Resend</button>
          </div>
        {/if}
      {/if}

      {#if qrMode !== "none"}
        <div style="margin-top: 8px; padding: 14px; border-radius: 14px; background: var(--panel-2); border: 1px solid var(--border); display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center;">
          <strong class="small">
            {qrMode === "token" ? `Scan with Another Device (${qrDevicesUsed}/${qrDevicesMax} devices used)` : "Scan with Signed-In App or Portal to Unlock PC"}
          </strong>
          {#if qrSvg}
            <div style="width: 168px; height: 168px; background: #fff; padding: 8px; border-radius: 12px;">
              <img
                src={`data:image/svg+xml;utf8,${encodeURIComponent(qrSvg)}`}
                alt="Activation QR Code"
                style="width:100%;height:100%;display:block;"
              />
            </div>
          {:else}
            <span class="muted small">Generating QR code…</span>
          {/if}
          <div class="row" style="gap: 10px; justify-content: center;">
            <span class="muted small">Expires in {qrCountdown}s</span>
            <button class="ghost small-btn" onclick={() => (qrMode === "token" ? showLinkAnotherDeviceQr() : startDesktopQrChallenge())}>Refresh QR</button>
            <button class="ghost small-btn" onclick={() => { stopQrTimer(); qrMode = "none"; }}>Close</button>
          </div>
        </div>
      {/if}
    </div>

    <!-- 2. App Updates, Help & Support, and Uninstall -->
    <div class="account-grid">
      <!-- App Updates -->
      <div class="card box">
        <div class="row">
          <strong>Updates</strong>
          <div class="spacer"></div>
          {#if info}<span class="badge free">v{info.version}</span>{/if}
        </div>
        <div class="row" style="gap: 8px; flex-wrap: wrap;">
          <button
            class="ghost small-btn"
            disabled={checkingUpdate || installingUpdate}
            onclick={checkUpdates}
          >
            {checkingUpdate ? "…" : "Check Updates"}
          </button>
          {#if updateInfo?.update_available}
            <button class="primary small-btn" disabled={installingUpdate} onclick={installUpdate}>
              {installingUpdate ? "Updating…" : `Install v${updateInfo.latest_version}`}
            </button>
          {/if}
        </div>
      </div>

      <!-- Get Help / Contact Support -->
      <div class="card box">
        <div class="row">
          <strong>Support</strong>
          <div class="spacer"></div>
          {#if !showSupportForm}
            <button class="ghost small-btn" onclick={() => (showSupportForm = true)}>
              Contact
            </button>
          {/if}
        </div>
        {#if showSupportForm}
          <div style="display: flex; flex-direction: column; gap: 8px;">
            <input
              type="email"
              bind:value={supportEmail}
              placeholder="Your email"
              aria-label="Your email address"
              style="padding: 8px 14px; border-radius: 9999px; border: 1px solid var(--border); font-size: 13px;"
            />
            <textarea
              rows="2"
              bind:value={supportMessage}
              placeholder="Message"
              aria-label="Support message"
              style="padding: 10px 14px; border-radius: 12px; border: 1px solid var(--border); font-family: inherit; font-size: 13px; resize: vertical;"
            ></textarea>
            <div class="row" style="gap: 8px;">
              <button class="primary small-btn" disabled={sendingSupport} onclick={submitSupportReport}>
                {sendingSupport ? "…" : "Send"}
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
        <div class="row" style="justify-content: space-between;">
          <strong>Theme</strong>
          <button class="ghost small-btn" onclick={() => onToggleTheme?.()}>
            {theme === "dark" ? t("theme.dark", $lang) : t("theme.light", $lang)}
          </button>
        </div>
        <div class="row" style="justify-content: space-between;">
          <strong>Language</strong>
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

      <!-- Zero-Telemetry / Offline Mode -->
      <div class="card box">
        <div class="row" style="justify-content: space-between; gap: 10px;">
          <div>
            <strong>Zero-Telemetry / Offline Mode</strong>
            <div class="muted small" style="margin-top: 2px;">
              {zeroTelemetryMode
                ? "Active · 0 background network requests"
                : "Diagnostics opted-in"}
            </div>
          </div>
          <input
            type="checkbox"
            aria-label="Zero-Telemetry / Offline Mode"
            checked={zeroTelemetryMode}
            disabled={savingPrefs}
            onchange={(e) =>
              void setZeroTelemetryMode((e.currentTarget as HTMLInputElement).checked)}
            style="width: 20px; height: 20px; accent-color: var(--accent); cursor: pointer;"
          />
        </div>
        <p class="muted small" style="margin: 0; line-height: 1.45;">
          ON by default. Blocks startup update pings, crash report uploads, passive pricing lookups, and usage telemetry. Explicit user actions (activating Pro, manual update checks, or sending a support message) only connect when you trigger them.
        </p>
      </div>

      <!-- 7-Day Undo Quarantine Storage Budget -->
      <div class="card box">
        <div class="row" style="justify-content: space-between; gap: 8px; flex-wrap: wrap;">
          <strong>7-Day Undo Quarantine Budget</strong>
          <span class="badge free">{quarantineBudgetGb} GB limit</span>
        </div>
        <div class="row" style="gap: 8px; align-items: center;">
          <input
            type="range"
            min="2"
            max="10"
            step="1"
            aria-label="7-Day Undo Quarantine disk budget in GB"
            value={quarantineBudgetGb}
            disabled={savingPrefs}
            onchange={(e) =>
              void setQuarantineBudgetGb(Number((e.currentTarget as HTMLInputElement).value))}
            style="flex: 1; accent-color: var(--accent);"
          />
          <div class="row" style="gap: 4px;">
            {#each [2, 5, 10] as presetGb}
              <button
                type="button"
                class={quarantineBudgetGb === presetGb ? "primary small-btn" : "ghost small-btn"}
                style="padding: 4px 10px; font-size: 11.5px;"
                disabled={savingPrefs}
                onclick={() => void setQuarantineBudgetGb(presetGb)}
              >
                {presetGb} GB
              </button>
            {/each}
          </div>
        </div>
        <div class="muted small">
          {#if quarantineStatus}
            Using {formatBytes(quarantineStatus.used_bytes)} of {formatBytes(quarantineStatus.budget_bytes)} ({quarantineStatus.item_count} file{quarantineStatus.item_count === 1 ? "" : "s"}).
          {:else}
            Default 5 GB rolling budget (configurable 2–10 GB).
          {/if}
        </div>
        <p class="muted small" style="margin: 0; line-height: 1.45;">
          7-Day Undo Quarantine (configurable 2–10 GB disk budget, 5 GB default, same-volume O(1) move; OS Recycle Bin fallback if file exceeds budget; excludes shredded files, browser DBs, and registry edits).
        </p>
      </div>

      <!-- Scan Exclusions -->
      <div class="card box">
        <div class="row" style="justify-content: space-between;">
          <strong>Scan Exclusions ({exclusions.length})</strong>
          <button class="ghost small-btn" onclick={pickExclusionFolder}>+ Browse Folder</button>
        </div>
        <div class="row" style="gap: 8px; flex-wrap: wrap;">
          <input
            type="text"
            bind:value={newExclusionPath}
            placeholder="Path or folder to skip during scans"
            style="flex: 1; min-width: 180px; padding: 7px 12px; border-radius: 9999px; border: 1px solid var(--border); font-size: 12.5px;"
            onkeydown={(e) => e.key === "Enter" && addScanExclusion()}
          />
          <button class="primary small-btn" onclick={addScanExclusion}>Add</button>
        </div>
        {#if exclusions.length > 0}
          <div style="display: flex; flex-direction: column; gap: 6px; max-height: 120px; overflow-y: auto;">
            {#each exclusions as ex (ex)}
              <div class="row" style="justify-content: space-between; padding: 4px 10px; border-radius: 8px; background: var(--panel-2); font-size: 12px;">
                <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{ex}</span>
                <button class="ghost small-btn" style="padding: 2px 8px;" onclick={() => removeScanExclusion(ex)}>×</button>
              </div>
            {/each}
          </div>
        {:else}
          <span class="muted small">No excluded folders or files configured.</span>
        {/if}
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
