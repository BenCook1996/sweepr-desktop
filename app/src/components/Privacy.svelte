<script lang="ts">
  import {
    api,
    errorMessage,
    isPaymentRequired,
    requestActivation,
    type BrowserExtensionItem,
    type BrowserPrivacyItem,
    type LicenseStatus,
  } from "../lib/api";
  import { formatBytes, formatCount } from "../lib/format";
  import { addLifetimeStats } from "../lib/store";
  import Shredder from "./Shredder.svelte";

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
  let compactingDbs = $state(false);
  let browserStatus = $state<string | null>(null);

  // Smart Cookie Allowlist & Browser Extension Inspector
  let showCookieAllowlist = $state(false);
  let cookieAllowlist = $state<string[]>([]);
  let newDomain = $state("");
  let showExtensions = $state(false);
  let extensions = $state<BrowserExtensionItem[]>([]);
  let loadingExtensions = $state(false);

  // k-Anonymity Password Breach Check (#12) & Cryptographic Generator
  let passwordInput = $state("");
  let checkingPassword = $state(false);
  let breachCount = $state<number | null>(null);
  let genLength = $state(20);
  let genSymbols = $state(true);
  let generatedPassword = $state("");
  let generatingPassword = $state(false);
  let copiedPassword = $state(false);

  async function scanBrowsers() {
    error = null;
    browserStatus = null;
    scanningBrowsers = true;
    try {
      const [bList, allow] = await Promise.all([
        api.scanBrowserPrivacy(),
        api.getCookieAllowlist().catch(() => []),
      ]);
      browsers = bList;
      cookieAllowlist = allow;
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

  async function compactDatabases() {
    error = null;
    browserStatus = null;
    compactingDbs = true;
    try {
      const saved = await api.compactBrowserDatabases();
      addLifetimeStats(saved, 1);
      browserStatus = `Optimized & vacuumed browser SQLite databases (${formatBytes(saved)} reclaimed with zero data loss).`;
      browsers = await api.scanBrowserPrivacy();
    } catch (e) {
      if (isPaymentRequired(e)) {
        requestActivation();
      } else {
        error = errorMessage(e);
      }
    } finally {
      compactingDbs = false;
    }
  }

  async function addAllowedDomain() {
    const d = newDomain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!d) return;
    if (cookieAllowlist.includes(d)) {
      newDomain = "";
      return;
    }
    try {
      cookieAllowlist = await api.setCookieAllowlist([...cookieAllowlist, d]);
      newDomain = "";
    } catch (e) {
      error = errorMessage(e);
    }
  }

  async function removeAllowedDomain(domain: string) {
    try {
      cookieAllowlist = await api.setCookieAllowlist(cookieAllowlist.filter((d) => d !== domain));
    } catch (e) {
      error = errorMessage(e);
    }
  }

  async function toggleExtensionsDrawer() {
    showExtensions = !showExtensions;
    if (showExtensions && extensions.length === 0 && !loadingExtensions) {
      loadingExtensions = true;
      try {
        extensions = await api.listBrowserExtensions();
      } catch (e) {
        error = errorMessage(e);
      } finally {
        loadingExtensions = false;
      }
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

  async function generatePassword() {
    error = null;
    generatingPassword = true;
    copiedPassword = false;
    try {
      generatedPassword = await api.generateStrongPassword(genLength, genSymbols);
    } catch (e) {
      error = errorMessage(e);
    } finally {
      generatingPassword = false;
    }
  }

  async function copyGeneratedPassword() {
    if (!generatedPassword) return;
    try {
      await navigator.clipboard.writeText(generatedPassword);
      copiedPassword = true;
      setTimeout(() => (copiedPassword = false), 2000);
    } catch {
      // Ignore clipboard failure
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
  <h1 style="font-size: 26px; font-weight: 800; letter-spacing: -0.5px;">Privacy, Browser & Shredder</h1>
  <p class="muted small" style="margin-top: 4px;">
    Sweep browser tracking cookies, compact SQLite databases, audit browser extensions, check passwords with k-Anonymity, and shred sensitive files.
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
    <div class="row" style="margin-bottom: 12px; flex-wrap: wrap; gap: 10px;">
      <div class="icon-bubble emerald">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
      </div>
      <div>
        <strong style="font-size: 16px;">Browser Privacy Cleaner & Optimizer</strong>
        <div class="muted small">Clear web caches, tracking cookies, and browsing history across installed browsers.</div>
      </div>
      <div class="spacer"></div>
      <button class="ghost small-pill" onclick={() => (showCookieAllowlist = !showCookieAllowlist)}>
        🍪 Smart Cookie Allowlist ({cookieAllowlist.length})
      </button>
      <button class="ghost small-pill" onclick={toggleExtensionsDrawer}>
        🧩 Extension Inspector {extensions.length ? `(${extensions.length})` : ""}
      </button>
      <button class="ghost small-pill" onclick={scanBrowsers} disabled={scanningBrowsers}>
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

    {#if showCookieAllowlist}
      <div class="sub-panel">
        <div class="row" style="justify-content: space-between; margin-bottom: 8px; flex-wrap: wrap; gap: 8px;">
          <div>
            <strong class="small">Smart Cookie Allowlist (Keep Logged In)</strong>
            <div class="muted small">Domains preserved when cleaning browser cookies so you stay signed in to your favorite accounts.</div>
          </div>
          <div class="row" style="gap: 6px;">
            <input
              type="text"
              bind:value={newDomain}
              placeholder="e.g. github.com"
              class="mini-input"
              onkeydown={(e) => e.key === "Enter" && addAllowedDomain()}
            />
            <button class="primary small-pill" onclick={addAllowedDomain}>Add Domain</button>
          </div>
        </div>
        <div class="domain-pills">
          {#each cookieAllowlist as dom}
            <span class="domain-chip">
              <span>{dom}</span>
              <button
                type="button"
                class="chip-remove"
                onclick={() => removeAllowedDomain(dom)}
                aria-label={`Remove ${dom} from cookie allowlist`}
              >
                ×
              </button>
            </span>
          {:else}
            <span class="muted small">No domains in allowlist.</span>
          {/each}
        </div>
      </div>
    {/if}

    {#if showExtensions}
      <div class="sub-panel">
        <div class="row" style="justify-content: space-between; margin-bottom: 8px;">
          <div>
            <strong class="small">Browser Extension Inspector ({extensions.length})</strong>
            <div class="muted small">Installed Chromium (Chrome, Edge, Brave) extensions and their requested permission count.</div>
          </div>
        </div>
        {#if loadingExtensions}
          <div class="muted small">Scanning installed browser extensions…</div>
        {:else if extensions.length === 0}
          <div class="muted small">No third-party browser extensions found.</div>
        {:else}
          <div class="ext-list">
            {#each extensions as ext}
              <div class="row ext-row">
                <span class="badge free">{ext.browser}</span>
                <div style="flex: 1; min-width: 0;">
                  <strong class="small">{ext.name}</strong>
                  <span class="muted small mono">v{ext.version}</span>
                  {#if ext.description}
                    <div class="muted small" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{ext.description}</div>
                  {/if}
                </div>
                <span class="badge" class:pro={ext.permissions_count >= 5} class:free={ext.permissions_count < 5}>
                  {ext.permissions_count} permissions
                </span>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

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

    <div class="row" style="margin-top: 14px; gap: 10px; flex-wrap: wrap;">
      <button
        class="primary"
        disabled={cleaningBrowsers || (!clearCache && !clearCookies && !clearHistory)}
        onclick={cleanBrowsers}
      >
        {cleaningBrowsers ? "Cleaning Browser Data…" : "Clean Selected Browser Data"}
      </button>
      <button
        class="ghost"
        disabled={compactingDbs}
        onclick={compactDatabases}
      >
        {compactingDbs ? "Compacting SQLite DBs…" : "Optimize & Compact SQLite DBs (No Data Loss)"}
      </button>
    </div>
  </div>

  <!-- 2. k-Anonymity Password Breach Check (#12) + Cryptographic Generator -->
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

    <div class="gen-divider"></div>

    <div class="row" style="justify-content: space-between; margin-bottom: 10px; flex-wrap: wrap; gap: 8px;">
      <strong class="small">Cryptographic Password Generator</strong>
      <div class="row" style="gap: 10px;">
        <label class="row small" style="gap: 4px;">
          <span class="muted">Length:</span>
          <select bind:value={genLength} class="mini-select" aria-label="Password length">
            <option value={16}>16</option>
            <option value={20}>20</option>
            <option value={24}>24</option>
            <option value={32}>32</option>
          </select>
        </label>
        <label class="row small" style="gap: 4px; cursor: pointer;">
          <input type="checkbox" bind:checked={genSymbols} />
          <span>Symbols</span>
        </label>
      </div>
    </div>

    <div class="row" style="gap: 8px; flex-wrap: wrap;">
      <button class="ghost small-pill" disabled={generatingPassword} onclick={generatePassword}>
        {generatingPassword ? "Generating…" : "Generate Strong Password"}
      </button>
      {#if generatedPassword}
        <code class="gen-output">{generatedPassword}</code>
        <button class="primary small-pill" onclick={copyGeneratedPassword}>
          {copiedPassword ? "Copied ✓" : "Copy"}
        </button>
      {/if}
    </div>
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

<!-- 4. Embedded Secure File Shredder -->
<div class="shredder-section">
  <Shredder {license} />
</div>

<style>
  .header { margin-bottom: 24px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 20px; margin-bottom: 28px; }
  .item { padding: 22px 24px; }
  .icon-bubble { width: 40px; height: 40px; border-radius: 10px; display: grid; place-items: center; margin-right: 12px; flex-shrink: 0; }
  .icon-bubble.amber { background: rgba(245, 158, 11, 0.15); color: #d97706; }
  .icon-bubble.emerald { background: rgba(16, 185, 129, 0.15); color: #059669; }
  .browser-list { display: flex; flex-direction: column; gap: 8px; }
  .browser-row { padding: 10px 14px; border-radius: 10px; border: 1px solid var(--border); background: var(--panel-2); flex-wrap: wrap; }
  .breach-alert { padding: 12px 16px; border-radius: 12px; font-size: 13px; }
  .small-pill { padding: 6px 12px; font-size: 12px; border-radius: 9999px; }
  .sub-panel {
    background: var(--panel-2);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 14px 16px;
    margin-bottom: 14px;
  }
  .mini-input {
    padding: 6px 12px;
    border-radius: 9999px;
    border: 1px solid var(--border);
    background: var(--panel-solid);
    font-size: 12.5px;
    outline: none;
  }
  .mini-select {
    padding: 4px 8px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--panel-solid);
    font-size: 12px;
  }
  .domain-pills {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .domain-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 9999px;
    background: #ffffff;
    border: 1px solid var(--border);
    font-size: 12px;
    font-weight: 600;
  }
  .chip-remove {
    background: transparent;
    border: none;
    padding: 0 2px;
    font-size: 14px;
    line-height: 1;
    color: var(--muted);
    cursor: pointer;
    box-shadow: none;
  }
  .chip-remove:hover { color: var(--danger); }
  .ext-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 200px;
    overflow-y: auto;
  }
  .ext-row {
    background: #ffffff;
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid var(--border);
    gap: 10px;
  }
  .gen-divider {
    height: 1px;
    background: var(--border);
    margin: 18px 0 14px;
  }
  .gen-output {
    flex: 1;
    min-width: 140px;
    padding: 6px 12px;
    border-radius: 8px;
    background: var(--panel-2);
    border: 1px solid var(--border);
    font-size: 12.5px;
    word-break: break-all;
  }
  .shredder-section {
    padding-bottom: 40px;
  }
</style>
