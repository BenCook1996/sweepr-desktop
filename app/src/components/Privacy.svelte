<script lang="ts" module>
  import type { BrowserExtensionItem, BrowserPrivacyItem } from "../lib/api";

  let cachedBrowsers: BrowserPrivacyItem[] = [];
  let cachedSelectedBrowsers: Record<string, boolean> = {};
  let cachedAllowlist: string[] = [];
  let cachedExtensions: BrowserExtensionItem[] = [];
</script>

<script lang="ts">
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
  let error = $state<string | null>(null);

  // Browser Privacy Cleaner
  let browsers = $state<BrowserPrivacyItem[]>(cachedBrowsers);
  let selectedBrowsers = $state<Record<string, boolean>>(cachedSelectedBrowsers);
  let clearCache = $state(true);
  let clearCookies = $state(false);
  let clearHistory = $state(false);
  let scanningBrowsers = $state(false);
  let cleaningBrowsers = $state(false);
  let compactingDbs = $state(false);
  let browserStatus = $state<string | null>(null);

  // Sub-drawers: Cookie Allowlist & Extension Inspector
  let activeDrawer = $state<"none" | "cookies" | "extensions">("none");
  let cookieAllowlist = $state<string[]>(cachedAllowlist);
  let newDomain = $state("");
  let extensions = $state<BrowserExtensionItem[]>(cachedExtensions);
  let loadingExtensions = $state(false);

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
    if (clearCookies || clearHistory) {
      const items: string[] = [];
      if (clearCache) items.push("web caches");
      if (clearCookies) items.push("tracking cookies (non-allowlisted logins)");
      if (clearHistory) items.push("browsing history");
      if (
        !confirm(
          `Permanently clear ${items.join(", ")} across ${selectedBrowserKeys.length} selected browser(s)?\n\nClose your browsers first for best results. This action cannot be undone.`
        )
      ) {
        return;
      }
    }
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
      addLifetimeStats(freed, selectedBrowserKeys.length, ["browsers"], "Browser Privacy Clean");
      browserStatus = `Cleaned ${formatBytes(freed)} across ${selectedBrowserKeys.length} browser(s).`;
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

  async function compactDatabases() {
    error = null;
    browserStatus = null;
    compactingDbs = true;
    try {
      const saved = await api.compactBrowserDatabases();
      addLifetimeStats(saved, 1, ["browsers"], "SQLite Database Compaction");
      browserStatus = `Compacted browser SQLite databases (${formatBytes(saved)} reclaimed with zero data loss).`;
      browsers = await api.scanBrowserPrivacy();
      cachedBrowsers = browsers;
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
      cachedAllowlist = cookieAllowlist;
      newDomain = "";
    } catch (e) {
      error = errorMessage(e);
    }
  }

  async function removeAllowedDomain(domain: string) {
    try {
      cookieAllowlist = await api.setCookieAllowlist(cookieAllowlist.filter((d) => d !== domain));
      cachedAllowlist = cookieAllowlist;
    } catch (e) {
      error = errorMessage(e);
    }
  }

  async function toggleDrawer(drawer: "cookies" | "extensions") {
    if (activeDrawer === drawer) {
      activeDrawer = "none";
      return;
    }
    activeDrawer = drawer;
    if (drawer === "extensions" && extensions.length === 0 && !loadingExtensions) {
      loadingExtensions = true;
      try {
        extensions = await api.listBrowserExtensions();
        cachedExtensions = extensions;
      } catch (e) {
        error = errorMessage(e);
      } finally {
        loadingExtensions = false;
      }
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
      <h1 class="page-title">Browser Privacy &amp; SQLite Optimizer</h1>
      <p class="muted small" style="margin: 4px 0 0 0;">
        Sweep browser caches, tracking cookies, and history while keeping your allowlisted logins intact.
      </p>
    </div>
  </div>

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

  <!-- 1. Browser Privacy & SQLite Optimizer -->
  <div class="card browser-card">
    <div class="card-top-row">
      <div class="title-with-icon">
        <div class="icon-bubble emerald">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
        </div>
        <div>
          <strong class="card-title">Browser Privacy Cleaner</strong>
          <div class="muted small">Clear web caches, tracking cookies, and browsing history across installed browsers</div>
        </div>
      </div>

      <div class="toolbar-actions">
        <button
          class="ghost small-pill"
          class:active-pill={activeDrawer === "cookies"}
          onclick={() => toggleDrawer("cookies")}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          <span>Cookie Allowlist ({cookieAllowlist.length})</span>
        </button>
        <button
          class="ghost small-pill"
          class:active-pill={activeDrawer === "extensions"}
          onclick={() => toggleDrawer("extensions")}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>
          <span>Extensions {extensions.length ? `(${extensions.length})` : ""}</span>
        </button>
        <button class="ghost small-pill" onclick={scanBrowsers} disabled={scanningBrowsers}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          <span>{scanningBrowsers ? "Scanning…" : "Rescan"}</span>
        </button>
      </div>
    </div>

    {#if activeDrawer === "cookies"}
      <div class="sub-panel">
        <div class="row" style="justify-content: space-between; margin-bottom: 10px; flex-wrap: wrap; gap: 10px;">
          <div>
            <strong class="small">Protected Login Domains (Cookie Allowlist)</strong>
            <div class="muted small">These sites stay signed in when you clean tracking cookies.</div>
          </div>
          <div class="row" style="gap: 6px;">
            <input
              type="text"
              bind:value={newDomain}
              placeholder="Add domain (e.g. github.com)"
              class="mini-input"
              onkeydown={(e) => e.key === "Enter" && addAllowedDomain()}
            />
            <button class="primary small-pill" onclick={addAllowedDomain}>Add</button>
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

    {#if activeDrawer === "extensions"}
      <div class="sub-panel">
        <div class="row" style="justify-content: space-between; margin-bottom: 8px;">
          <div>
            <strong class="small">Installed Browser Extensions ({extensions.length})</strong>
            <div class="muted small">Review third-party Chromium extensions and their permission footprint.</div>
          </div>
        </div>
        {#if loadingExtensions}
          <div class="muted small">Scanning installed browser extensions…</div>
        {:else if extensions.length === 0}
          <div class="muted small">No third-party browser extensions detected.</div>
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

    <!-- Clean Options Pills -->
    <div class="data-type-bar">
      <span class="field-label">DATA TO CLEAN:</span>
      <label class="type-chip" class:checked={clearCache}>
        <input type="checkbox" bind:checked={clearCache} />
        <span>Web Cache</span>
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
        <span class="muted small">No supported browser profiles detected or all browser caches are already clean.</span>
      </div>
    {:else}
      <div class="browser-list">
        {#each browsers as b}
          {@const key = b.id || b.browser}
          <label class="row browser-row">
            <input type="checkbox" bind:checked={selectedBrowsers[key]} />
            <strong class="browser-name">{b.name || b.browser}</strong>
            <div class="browser-metrics">
              <span class="metric-pill">Cache: <strong>{formatBytes(b.cache_bytes)}</strong></span>
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
        class="primary"
        disabled={cleaningBrowsers || !selectedBrowserKeys.length || (!clearCache && !clearCookies && !clearHistory)}
        onclick={cleanBrowsers}
      >
        {cleaningBrowsers
          ? "Cleaning Browser Data…"
          : totalBrowserBytes > 0
            ? `Clean Selected Browser Data (${formatBytes(totalBrowserBytes)})`
            : "Clean Selected Browser Data"}
      </button>
      <button
        class="ghost"
        disabled={compactingDbs}
        onclick={compactDatabases}
        title="Vacuum and defragment browser SQLite databases without signing you out or deleting history"
      >
        {compactingDbs ? "Compacting SQLite DBs…" : "Compact Databases (No Data Loss)"}
      </button>
    </div>
  </div>
</div>

<style>
  .privacy-layout {
    max-width: 1240px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 20px;
    padding-bottom: 36px;
  }
  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
  }
  .page-title {
    font-size: 24px;
    font-weight: 800;
    letter-spacing: -0.5px;
    margin: 0;
  }
  .alert-banner {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    font-size: 13px;
    font-weight: 500;
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
    padding: 24px 26px;
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
    font-size: 16px;
  }
  .icon-bubble {
    width: 40px;
    height: 40px;
    border-radius: 11px;
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
    padding: 6px 12px;
    font-size: 12px;
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
    padding: 10px 14px;
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
    padding: 5px 12px;
    border-radius: 9999px;
    background: var(--panel-solid);
    border: 1px solid var(--border);
    font-size: 12.5px;
    font-weight: 600;
    cursor: pointer;
    transition: border-color 0.15s ease;
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
    transition: border-color 0.15s ease;
  }
  .browser-row:hover {
    border-color: rgba(16, 185, 129, 0.4);
  }
  .browser-name {
    min-width: 140px;
    font-size: 14px;
  }
  .browser-metrics {
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
  }
  .metric-pill {
    font-size: 12px;
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
    padding: 16px;
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
  .sub-panel {
    background: var(--panel-2);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 14px 16px;
  }
  .mini-input {
    padding: 6px 12px;
    border-radius: 9999px;
    border: 1px solid var(--border);
    background: var(--panel-solid);
    font-size: 12.5px;
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
  .chip-remove:hover {
    color: var(--danger);
  }
  .ext-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 200px;
    overflow-y: auto;
  }
  .ext-row {
    background: var(--panel-solid);
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid var(--border);
    gap: 10px;
  }
</style>
