<script lang="ts">
  import {
    api,
    errorMessage,
    isPaymentRequired,
    requestActivation,
    type BrowserPrivacyItem,
    type LicenseStatus,
  } from "../lib/api";
  import { formatBytes, formatCount } from "../lib/format";
  import { addLifetimeStats } from "../lib/store";

  let { license } = $props<{ license: LicenseStatus | null }>();
  let error = $state<string | null>(null);

  // Browser Privacy Cleaner (#11)
  let browsers = $state<BrowserPrivacyItem[]>([]);
  let selectedBrowsers = $state<Record<string, boolean>>({});
  let clearCache = $state(true);
  let clearCookies = $state(false);
  let clearHistory = $state(false);
  let scanningBrowsers = $state(false);
  let cleaningBrowsers = $state(false);
  let browserStatus = $state<string | null>(null);

  // k-Anonymity Password Breach Check (#12)
  let passwordInput = $state("");
  let checkingPassword = $state(false);
  let breachCount = $state<number | null>(null);

  async function scanBrowsers() {
    error = null;
    browserStatus = null;
    scanningBrowsers = true;
    try {
      browsers = await api.scanBrowserPrivacy();
      const sel: Record<string, boolean> = {};
      for (const b of browsers) {
        const key = b.id || b.browser;
        sel[key] = true;
      }
      selectedBrowsers = sel;
    } catch (e) {
      error = errorMessage(e);
    } finally {
      scanningBrowsers = false;
    }
  }

  async function cleanBrowsers() {
    const chosen = Object.keys(selectedBrowsers).filter((k) => selectedBrowsers[k]);
    if (!chosen.length) return;
    error = null;
    browserStatus = null;
    cleaningBrowsers = true;
    try {
      const freed = await api.cleanBrowserPrivacy(chosen, clearCache, clearCookies, clearHistory);
      addLifetimeStats(freed, chosen.length);
      browserStatus = `Cleaned ${formatBytes(freed)} of browser privacy traces across ${chosen.length} browser(s).`;
      browsers = await api.scanBrowserPrivacy();
    } catch (e) {
      if (isPaymentRequired(e)) {
        requestActivation();
      } else {
        error = errorMessage(e);
      }
    } finally {
      cleaningBrowsers = false;
    }
  }

  async function checkPassword() {
    if (!passwordInput) return;
    error = null;
    breachCount = null;
    checkingPassword = true;
    try {
      breachCount = await api.checkPasswordBreach(passwordInput);
    } catch (e) {
      error = errorMessage(e);
    } finally {
      checkingPassword = false;
    }
  }

  async function openBreachCheck() {
    error = null;
    try {
      await api.openBreachCheck();
    } catch (e) {
      error = errorMessage(e);
    }
  }

  $effect(() => {
    scanBrowsers();
  });
</script>

<div class="header">
  <h1 style="font-size: 26px; font-weight: 800; letter-spacing: -0.5px;">Privacy & Breach Protection</h1>
  <p class="muted small" style="margin-top: 4px;">
    Sweep browser tracking cookies, history, and caches, or verify passwords locally using k-Anonymity.
  </p>
</div>

{#if error}
  <div class="breach-alert card" style="margin-bottom: 18px; background: #fef2f2; border: 1px solid #fecaca; color: #991b1b;">
    <span class="small">{error}</span>
  </div>
{/if}

<div class="grid">
  <!-- 1. Browser Privacy Cleaner (#11) -->
  <div class="card item" style="grid-column: 1 / -1;">
    <div class="row" style="margin-bottom: 12px;">
      <div class="icon-bubble emerald">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
      </div>
      <div>
        <strong style="font-size: 16px;">Browser Privacy Cleaner</strong>
        <div class="muted small">Clear web caches, tracking cookies, and browsing history across installed browsers.</div>
      </div>
      <div class="spacer"></div>
      <button class="ghost" onclick={scanBrowsers} disabled={scanningBrowsers}>
        {scanningBrowsers ? "Scanning…" : "Rescan Browsers"}
      </button>
    </div>

    <div class="row" style="gap: 18px; margin-bottom: 14px; flex-wrap: wrap;">
      <label class="row small" style="gap: 6px; cursor: pointer;">
        <input type="checkbox" bind:checked={clearCache} />
        <span>Clear Cache</span>
      </label>
      <label class="row small" style="gap: 6px; cursor: pointer;">
        <input type="checkbox" bind:checked={clearCookies} />
        <span>Clear Tracking Cookies (Pro)</span>
      </label>
      <label class="row small" style="gap: 6px; cursor: pointer;">
        <input type="checkbox" bind:checked={clearHistory} />
        <span>Clear Browsing History (Pro)</span>
      </label>
    </div>

    {#if browsers.length === 0}
      <p class="muted small">No supported browser profiles detected or all browser caches are already clean.</p>
    {:else}
      <div class="browser-list">
        {#each browsers as b}
          {@const key = b.id || b.browser}
          <label class="row browser-row" style="cursor: pointer;">
            <input type="checkbox" bind:checked={selectedBrowsers[key]} />
            <strong style="min-width: 140px;">{b.name || b.browser}</strong>
            <span class="muted small">Cache: {formatBytes(b.cache_bytes)}</span>
            <span class="muted small">Cookies: {formatBytes(b.cookies_bytes)}</span>
            <span class="muted small">History: {formatBytes(b.history_bytes)}</span>
            <div class="spacer"></div>
            <strong style="color: var(--accent);">
              {formatBytes(b.total_bytes ?? b.cache_bytes + b.cookies_bytes + b.history_bytes)}
            </strong>
          </label>
        {/each}
      </div>
    {/if}

    {#if browserStatus}
      <div class="muted small" style="color: var(--accent); margin-top: 10px;">{browserStatus}</div>
    {/if}

    <div class="row" style="margin-top: 14px;">
      <button
        class="primary"
        disabled={cleaningBrowsers || (!clearCache && !clearCookies && !clearHistory)}
        onclick={cleanBrowsers}
      >
        {cleaningBrowsers ? "Cleaning Browser Data…" : "Clean Selected Browser Data"}
      </button>
    </div>
  </div>

  <!-- 2. k-Anonymity Password Breach Check (#12) -->
  <div class="card item">
    <div class="row" style="margin-bottom: 12px;">
      <div class="icon-bubble emerald">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
      </div>
      <div>
        <strong style="font-size: 16px;">k-Anonymity Password Check</strong>
        <div class="muted small">Zero-knowledge SHA-1 prefix lookup</div>
      </div>
    </div>

    <p class="muted small" style="margin: 0 0 14px 0; line-height: 1.5;">
      Your password is hashed locally on your PC. Only the first 5 characters of its SHA-1 hash are sent to the Pwned Passwords API—your actual password never leaves your device.
    </p>

    <div class="row" style="gap: 8px;">
      <input
        type="password"
        bind:value={passwordInput}
        placeholder="Enter password to test…"
        aria-label="Password to test for breaches"
        style="flex: 1; padding: 9px 14px; border-radius: 9999px; border: 1px solid var(--border); background: var(--panel-solid);"
      />
      <button class="primary" disabled={checkingPassword || !passwordInput} onclick={checkPassword}>
        {checkingPassword ? "Checking…" : "Check Password"}
      </button>
    </div>

    {#if breachCount !== null}
      {#if breachCount === 0}
        <div class="breach-alert" style="margin-top: 14px; background: rgba(16, 185, 129, 0.12); color: var(--accent);">
          <strong>Good news!</strong> This password was not found in any known public data breaches.
        </div>
      {:else}
        <div class="breach-alert" style="margin-top: 14px; background: #fef2f2; color: #b91c1c; border: 1px solid rgba(239, 68, 68, 0.25);">
          <strong>Warning:</strong> This password has appeared <strong>{formatCount(breachCount)}</strong> times in known data breaches. Avoid using it.
        </div>
      {/if}
    {/if}
  </div>

  <!-- 3. Email Breach Check Card -->
  <div class="card item">
    <div class="row" style="margin-bottom: 12px;">
      <div class="icon-bubble amber">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
      </div>
      <div>
        <strong style="font-size: 16px;">Have I Been Pwned Email Lookup</strong>
        <div class="muted small">Check your email directly on haveibeenpwned.com</div>
      </div>
    </div>

    <p class="muted small" style="margin: 0 0 16px 0; line-height: 1.5;">
      SWEEPR Cleaner does not collect, store, or transmit your email address for breach checks. Clicking below opens <strong>haveibeenpwned.com</strong> in your default browser.
    </p>

    <div class="row">
      <button class="primary" style="padding: 10px 24px; border-radius: 9999px;" onclick={openBreachCheck}>
        Check on Have I Been Pwned ↗
      </button>
    </div>
  </div>
</div>

<style>
  .header { margin-bottom: 24px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 20px; padding-bottom: 40px; }
  .item { padding: 22px 24px; }
  .icon-bubble { width: 40px; height: 40px; border-radius: 10px; display: grid; place-items: center; margin-right: 12px; flex-shrink: 0; }
  .icon-bubble.amber { background: rgba(245, 158, 11, 0.15); color: #d97706; }
  .icon-bubble.emerald { background: rgba(16, 185, 129, 0.15); color: #059669; }
  .browser-list { display: flex; flex-direction: column; gap: 8px; }
  .browser-row { padding: 10px 14px; border-radius: 10px; border: 1px solid var(--border); background: var(--panel-2); flex-wrap: wrap; }
  .breach-alert { padding: 12px 16px; border-radius: 12px; font-size: 13px; }
</style>
