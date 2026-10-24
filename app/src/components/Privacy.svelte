<script lang="ts" module>
  import type { BrowserPrivacyItem } from "../lib/api";

  let cachedSubView: "browser" | "vault" | "eraser" = "browser";
  let cachedBrowsers: BrowserPrivacyItem[] = [];
  let cachedSelectedBrowsers: Record<string, boolean> = {};
  let cachedAllowlist: string[] = [];
</script>

<script lang="ts">
  import CloudProtection from "./CloudProtection.svelte";
  import Shredder from "./Shredder.svelte";
  import {
    api,
    errorMessage,
    isPaymentRequired,
    requestActivation,
    type LicenseStatus,
  } from "../lib/api";
  import { formatBytes } from "../lib/format";
  import { addLifetimeStats } from "../lib/store";

  let { license }: { license: LicenseStatus | null } = $props();
  let subView = $state<"browser" | "vault" | "eraser">(cachedSubView);
  let error = $state<string | null>(null);

  // Browser Privacy Cleaner
  let browsers = $state<BrowserPrivacyItem[]>(cachedBrowsers);
  let selectedBrowsers = $state<Record<string, boolean>>(cachedSelectedBrowsers);
  let clearCache = $state(true);
  let clearCookies = $state(false);
  let clearHistory = $state(false);
  let scanningBrowsers = $state(false);
  let cleaningBrowsers = $state(false);
  let browserStatus = $state<string | null>(null);

  // Websites to Keep Signed In
  let showKeepSignedIn = $state(false);
  let cookieAllowlist = $state<string[]>(cachedAllowlist);
  let newDomain = $state("");

  $effect(() => {
    cachedSubView = subView;
  });

  const selectedBrowserKeys = $derived(
    Object.keys(selectedBrowsers).filter((k) => selectedBrowsers[k])
  );

  const totalBrowserBytes = $derived(
    browsers.reduce((sum, b) => {
      const key = b.id || b.browser;
      if (!selectedBrowsers[key]) return sum;
      let bytes = 0;
      if (clearCache) bytes += b.cache_bytes;
      if (clearCookies) bytes += b.cookies_bytes;
      if (clearHistory) bytes += b.history_bytes;
      return sum + bytes;
    }, 0)
  );

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
      cachedBrowsers = bList;
      cachedAllowlist = allow;
      const sel: Record<string, boolean> = {};
      for (const b of browsers) {
        const key = b.id || b.browser;
        sel[key] = true;
      }
      selectedBrowsers = sel;
      cachedSelectedBrowsers = sel;
    } catch (e) {
      error = errorMessage(e);
    } finally {
      scanningBrowsers = false;
    }
  }

  async function cleanBrowsers() {
    if (!selectedBrowserKeys.length) return;
    error = null;
    browserStatus = null;
    cleaningBrowsers = true;
    try {
      const freed = await api.cleanBrowserPrivacy(
        selectedBrowserKeys,
        clearCache,
        clearCookies,
        clearHistory
      );
      const compacted = await api.compactBrowserDatabases().catch(() => 0);
      const totalFreed = freed + compacted;
      addLifetimeStats(totalFreed, selectedBrowserKeys.length, ["browsers"], "Browser Privacy Clean");
      browserStatus = `Cleaned ${formatBytes(totalFreed)} across ${selectedBrowserKeys.length} browser(s).`;
      browsers = await api.scanBrowserPrivacy();
      cachedBrowsers = browsers;
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

  async function addAllowedDomain() {
    const d = newDomain
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "");
    if (!d) return;
    if (cookieAllowlist.includes(d)) {
      newDomain = "";
      return;
    }
    try {
      cookieAllowlist = await api.setCookieAllowlist([...cookieAllowlist, d]);
      cachedAllowlist = cookieAllowlist;
      newDomain = "";
    } catch (e) {
      error = errorMessage(e);
    }
  }

  async function removeAllowedDomain(domain: string) {
    try {
      cookieAllowlist = await api.setCookieAllowlist(
        cookieAllowlist.filter((d) => d !== domain)
      );
      cachedAllowlist = cookieAllowlist;
    } catch (e) {
      error = errorMessage(e);
    }
  }

  $effect(() => {
    if (cachedBrowsers.length === 0) {
      scanBrowsers();
    }
  });
</script>

<div class="privacy-layout">
  <div class="section-header">
    <div>
      <h1 class="page-title">Privacy &amp; Safety</h1>
      <p class="muted small" style="margin: 4px 0 0 0;">
        Clear browser tracking, lock private files with a password, or permanently erase sensitive documents.
      </p>
    </div>

    <div class="mode-toggle" role="tablist">
      <button
        class="mode-btn"
        class:active={subView === "browser"}
        onclick={() => (subView = "browser")}
        role="tab"
        aria-selected={subView === "browser"}
      >
        Browser Privacy
      </button>
      <button
        class="mode-btn"
        class:active={subView === "vault"}
        onclick={() => (subView = "vault")}
        role="tab"
        aria-selected={subView === "vault"}
      >
        Private Vault &amp; Backup
      </button>
      <button
        class="mode-btn"
        class:active={subView === "eraser"}
        onclick={() => (subView = "eraser")}
        role="tab"
        aria-selected={subView === "eraser"}
      >
        Permanent File Eraser
      </button>
    </div>
  </div>

  {#if subView === "vault"}
    <CloudProtection {license} />
  {:else if subView === "eraser"}
    <Shredder {license} />
  {:else}
    {#if error}
      <div class="card alert-banner error">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <span>{error}</span>
      </div>
    {/if}

    {#if browserStatus}
      <div class="card alert-banner success">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        <span>{browserStatus}</span>
      </div>
    {/if}

    <div class="card browser-card">
      <div class="card-top-row">
        <div class="title-with-icon">
          <div class="icon-bubble emerald">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
          </div>
          <div>
            <strong class="card-title">Clear Browser Tracking &amp; Clutter</strong>
            <div class="muted small">
              Clear temporary web files, tracking cookies, and browsing history while keeping your favorite websites signed in.
            </div>
          </div>
        </div>

        <div class="toolbar-actions">
          <button
            class="ghost small-pill"
            class:active-pill={showKeepSignedIn}
            onclick={() => (showKeepSignedIn = !showKeepSignedIn)}
          >
            <span>Websites to Keep Signed In ({cookieAllowlist.length})</span>
          </button>
          <button class="ghost small-pill" onclick={scanBrowsers} disabled={scanningBrowsers}>
            <span>{scanningBrowsers ? "Checking…" : "Check Again"}</span>
          </button>
        </div>
      </div>

      {#if showKeepSignedIn}
        <div class="sub-panel">
          <div class="row" style="justify-content: space-between; margin-bottom: 10px; flex-wrap: wrap; gap: 10px;">
            <div>
              <strong class="small">Websites to Keep Signed In</strong>
              <div class="muted small">These websites will stay signed in even when you clear tracking cookies.</div>
            </div>
            <div class="row" style="gap: 6px;">
              <input
                type="text"
                bind:value={newDomain}
                placeholder="Add website (e.g. google.com)"
                class="mini-input"
                onkeydown={(e) => e.key === "Enter" && addAllowedDomain()}
              />
              <button class="primary small-pill" onclick={addAllowedDomain}>Add Website</button>
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
                  aria-label={`Remove ${dom}`}
                >
                  ×
                </button>
              </span>
            {:else}
              <span class="muted small">No websites added yet.</span>
            {/each}
          </div>
        </div>
      {/if}

      <!-- What to Clear -->
      <div class="data-type-bar">
        <span class="field-label">WHAT TO CLEAR:</span>
        <label class="type-chip" class:checked={clearCache}>
          <input type="checkbox" bind:checked={clearCache} />
          <span>Temporary Web Files (Cache)</span>
        </label>
        <label class="type-chip" class:checked={clearCookies}>
          <input type="checkbox" bind:checked={clearCookies} />
          <span>Tracking Cookies</span>
          {#if !license?.active}<span class="badge pro">Pro</span>{/if}
        </label>
        <label class="type-chip" class:checked={clearHistory}>
          <input type="checkbox" bind:checked={clearHistory} />
          <span>Browsing History</span>
          {#if !license?.active}<span class="badge pro">Pro</span>{/if}
        </label>
      </div>

      {#if browsers.length === 0}
        <div class="empty-state">
          <span class="muted small">All your browsers are already clean!</span>
        </div>
      {:else}
        <div class="browser-list">
          {#each browsers as b}
            {@const key = b.id || b.browser}
            <label class="row browser-row">
              <input type="checkbox" bind:checked={selectedBrowsers[key]} />
              <strong class="browser-name">{b.name || b.browser}</strong>
              <div class="browser-metrics">
                <span class="metric-pill">Temp files: <strong>{formatBytes(b.cache_bytes)}</strong></span>
                <span class="metric-pill">Cookies: <strong>{formatBytes(b.cookies_bytes)}</strong></span>
                <span class="metric-pill">History: <strong>{formatBytes(b.history_bytes)}</strong></span>
              </div>
              <div class="spacer"></div>
              <strong class="browser-total">
                {formatBytes(b.total_bytes ?? b.cache_bytes + b.cookies_bytes + b.history_bytes)}
              </strong>
            </label>
          {/each}
        </div>
      {/if}

      <div class="card-footer-row">
        <button
          class="primary clean-btn"
          disabled={cleaningBrowsers || !selectedBrowserKeys.length || (!clearCache && !clearCookies && !clearHistory)}
          onclick={cleanBrowsers}
        >
          {cleaningBrowsers
            ? "Clearing Browser Data…"
            : totalBrowserBytes > 0
              ? `Clear Selected Browser Data (${formatBytes(totalBrowserBytes)})`
              : "Clear Selected Browser Data"}
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  .privacy-layout {
    max-width: 1120px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 18px;
    padding-bottom: 36px;
  }
  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    flex-wrap: wrap;
    gap: 12px;
  }
  .page-title {
    font-size: 26px;
    font-weight: 800;
    letter-spacing: -0.5px;
    margin: 0;
  }
  .mode-toggle {
    display: flex;
    background: var(--panel-2);
    padding: 4px;
    border-radius: 9999px;
    border: 1px solid var(--border);
    flex-wrap: wrap;
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
  .alert-banner {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    font-size: 13.5px;
    font-weight: 600;
  }
  .alert-banner.error {
    border-left: 4px solid var(--danger);
    background: rgba(239, 68, 68, 0.12);
    color: var(--danger);
  }
  .alert-banner.success {
    border-left: 4px solid var(--accent);
    background: var(--accent-light);
    color: var(--text);
  }
  .browser-card {
    padding: 24px 28px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .card-top-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
  }
  .title-with-icon {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .card-title {
    font-size: 17px;
  }
  .icon-bubble {
    width: 42px;
    height: 42px;
    border-radius: 12px;
    display: grid;
    place-items: center;
    flex-shrink: 0;
  }
  .icon-bubble.emerald {
    background: rgba(16, 185, 129, 0.14);
    color: var(--accent);
  }
  .toolbar-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .small-pill {
    padding: 6px 14px;
    font-size: 12.5px;
    border-radius: 9999px;
  }
  .active-pill {
    background: var(--accent-light) !important;
    color: var(--accent) !important;
    border-color: rgba(16, 185, 129, 0.35) !important;
  }
  .data-type-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    padding: 12px 16px;
    background: var(--panel-2);
    border-radius: 12px;
    border: 1px solid var(--border);
  }
  .field-label {
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.6px;
    color: var(--muted);
    margin-right: 4px;
  }
  .type-chip {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 6px 14px;
    border-radius: 9999px;
    background: var(--panel-solid);
    border: 1px solid var(--border);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }
  .type-chip.checked {
    border-color: rgba(16, 185, 129, 0.45);
  }
  .browser-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .browser-row {
    padding: 12px 16px;
    border-radius: 12px;
    border: 1px solid var(--border);
    background: var(--panel-2);
    cursor: pointer;
    flex-wrap: wrap;
  }
  .browser-name {
    min-width: 140px;
    font-size: 14.5px;
  }
  .browser-metrics {
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
  }
  .metric-pill {
    font-size: 12.5px;
    color: var(--muted);
  }
  .metric-pill strong {
    color: var(--text);
  }
  .browser-total {
    color: var(--accent);
    font-size: 15px;
  }
  .empty-state {
    padding: 18px;
    text-align: center;
    background: var(--panel-2);
    border-radius: 12px;
    border: 1px solid var(--border);
  }
  .card-footer-row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    padding-top: 4px;
  }
  .clean-btn {
    padding: 11px 24px;
    border-radius: 9999px;
    font-weight: 700;
  }
  .sub-panel {
    background: var(--panel-2);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 14px 16px;
  }
  .mini-input {
    padding: 7px 14px;
    border-radius: 9999px;
    border: 1px solid var(--border);
    background: var(--panel-solid);
    color: var(--text);
    font-size: 13px;
    outline: none;
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
    background: var(--panel-solid);
    border: 1px solid var(--border);
    font-size: 12.5px;
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
</style>
