<script lang="ts" module>
  import type { BrowserPrivacyItem, OsSecurityHealthReport } from "../lib/api";

  let cachedSubView: "browser" | "vault" | "eraser" = "browser";
  let cachedBrowsers: BrowserPrivacyItem[] = [];
  let cachedSelectedBrowsers: Record<string, boolean> = {};
  let cachedAllowlist: string[] = [];
  let cachedSecurityHealth: OsSecurityHealthReport | null = null;
</script>

<script lang="ts">
  import CloudProtection from "./CloudProtection.svelte";
  import Shredder from "./Shredder.svelte";
  import PreCleanConfirmDrawer, {
    type ConfirmCleanCategoryItem,
  } from "./PreCleanConfirmDrawer.svelte";
  import {
    api,
    errorMessage,
    isPaymentRequired,
    requestActivation,
    type BrowserExtensionItem,
    type LicenseStatus,
  } from "../lib/api";
  import { formatBytes } from "../lib/format";
  import { addLifetimeStats } from "../lib/store";
  import { lang, t } from "../lib/i18n";

  let {
    license,
    initialSubView,
  }: {
    license: LicenseStatus | null;
    initialSubView?: "browser" | "vault" | "eraser";
  } = $props();
  let subView = $state<"browser" | "vault" | "eraser">(initialSubView ?? cachedSubView);
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
  let showPrivacyConfirm = $state(false);

  // Websites to Keep Signed In
  let showKeepSignedIn = $state(false);
  let cookieAllowlist = $state<string[]>(cachedAllowlist);
  let newDomain = $state("");

  // Browser Extensions & Password Security Audit
  let extensions = $state<BrowserExtensionItem[]>([]);
  let showExtensions = $state(false);
  let breachPassword = $state("");
  let breachCount = $state<number | null>(null);
  let checkingBreach = $state(false);
  let generatedPassword = $state("");

  // OS Security Health (#10, 100% local)
  let securityHealth = $state<OsSecurityHealthReport | null>(cachedSecurityHealth);
  let securityLoading = $state(false);
  let securityHealthAttempted = false;

  async function checkSecurityHealth() {
    securityLoading = true;
    try {
      const report = await api.osSecurityHealth();
      securityHealth = report;
      cachedSecurityHealth = report;
    } catch (e) {
      error = errorMessage(e);
    } finally {
      securityLoading = false;
    }
  }

  async function loadExtensions() {
    showExtensions = !showExtensions;
    if (showExtensions && extensions.length === 0) {
      extensions = await api.listBrowserExtensions().catch(() => []);
    }
  }

  async function runPasswordBreachCheck() {
    if (!breachPassword) return;
    checkingBreach = true;
    error = null;
    try {
      breachCount = await api.checkPasswordBreach(breachPassword);
    } catch (e) {
      error = errorMessage(e);
    } finally {
      checkingBreach = false;
    }
  }

  async function runGeneratePassword() {
    try {
      generatedPassword = await api.generateStrongPassword(20, true);
    } catch (e) {
      error = errorMessage(e);
    }
  }

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

  const selectedBrowserItems = $derived(
    browsers.filter((b) => selectedBrowsers[b.id || b.browser])
  );
  const selectedBrowserNamesLabel = $derived(
    selectedBrowserItems.map((b) => b.name || b.browser).join(", ")
  );
  const privacyConfirmCategories = $derived.by<ConfirmCleanCategoryItem[]>(() => {
    const items: ConfirmCleanCategoryItem[] = [];
    const count = selectedBrowserItems.length;
    const unit = count === 1 ? "browser" : "browsers";
    if (clearCache) {
      items.push({
        id: "privacy_cache",
        name: "Browser Cache & GPU Shader Storage",
        bytes: selectedBrowserItems.reduce((s, b) => s + b.cache_bytes, 0),
        files: count,
        fileUnit: unit,
        note: selectedBrowserNamesLabel || "Selected browsers",
      });
    }
    if (clearCookies) {
      items.push({
        id: "privacy_cookies",
        name: "Cookies & Active Site Sessions",
        bytes: selectedBrowserItems.reduce((s, b) => s + b.cookies_bytes, 0),
        files: count,
        fileUnit: unit,
        note:
          cookieAllowlist.length > 0
            ? `Keeping ${cookieAllowlist.length} allowlisted site(s) signed in`
            : "Signs out active websites on selected browsers",
      });
    }
    if (clearHistory) {
      items.push({
        id: "privacy_history",
        name: "Browsing & Download History",
        bytes: selectedBrowserItems.reduce((s, b) => s + b.history_bytes, 0),
        files: count,
        fileUnit: unit,
        note: selectedBrowserNamesLabel || "Selected browsers",
      });
    }
    return items;
  });

  function requestCleanBrowsers() {
    if (!selectedBrowserKeys.length || (!clearCache && !clearCookies && !clearHistory)) return;
    showPrivacyConfirm = true;
  }

  function confirmCleanBrowsers() {
    showPrivacyConfirm = false;
    void cleanBrowsers();
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
      if (isPaymentRequired(e)) {
        requestActivation();
        return;
      }
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
      if (isPaymentRequired(e)) {
        requestActivation();
        return;
      }
      error = errorMessage(e);
    }
  }

  $effect(() => {
    if (cachedBrowsers.length === 0) {
      scanBrowsers();
    }
    if (cachedSecurityHealth === null && !securityHealthAttempted) {
      securityHealthAttempted = true;
      void checkSecurityHealth();
    }
  });
</script>

<div class="privacy-layout">
  <div class="section-header">
    <h1 class="page-title">{t("nav.privacy", $lang)}</h1>

    <div class="mode-toggle" role="tablist">
      <button
        class="mode-btn"
        class:active={subView === "browser"}
        onclick={() => (subView = "browser")}
        role="tab"
        aria-selected={subView === "browser"}
      >
        Browsers
      </button>
      <button
        class="mode-btn"
        class:active={subView === "vault"}
        onclick={() => (subView = "vault")}
        role="tab"
        aria-selected={subView === "vault"}
      >
        Vault &amp; Backup
      </button>
      <button
        class="mode-btn"
        class:active={subView === "eraser"}
        onclick={() => (subView = "eraser")}
        role="tab"
        aria-selected={subView === "eraser"}
      >
        File Shredder
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
        <strong class="card-title">Browser Privacy</strong>

        <div class="toolbar-actions">
          <button
            class="ghost small-pill"
            class:active-pill={showKeepSignedIn}
            onclick={() => (showKeepSignedIn = !showKeepSignedIn)}
          >
            <span>Keep Signed In ({cookieAllowlist.length})</span>
          </button>
          <button class="ghost small-pill" onclick={scanBrowsers} disabled={scanningBrowsers}>
            <span>{scanningBrowsers ? "…" : "Rescan"}</span>
          </button>
        </div>
      </div>

      {#if showKeepSignedIn}
        <div class="sub-panel">
          <div class="row" style="justify-content: space-between; margin-bottom: 10px; flex-wrap: wrap; gap: 10px;">
            <strong class="small">Keep Signed In</strong>
            <div class="row" style="gap: 6px;">
              <input
                type="text"
                bind:value={newDomain}
                placeholder="google.com"
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
                  aria-label={`Remove ${dom}`}
                >
                  ×
                </button>
              </span>
            {:else}
              <span class="muted small">None</span>
            {/each}
          </div>
        </div>
      {/if}

      <!-- What to Clear -->
      <div class="data-type-bar">
        <label class="type-chip" class:checked={clearCache}>
          <input type="checkbox" bind:checked={clearCache} />
          <span>Cache</span>
        </label>
        <label class="type-chip" class:checked={clearCookies}>
          <input type="checkbox" bind:checked={clearCookies} />
          <span>Cookies</span>
        </label>
        <label class="type-chip" class:checked={clearHistory}>
          <input type="checkbox" bind:checked={clearHistory} />
          <span>History</span>
        </label>
      </div>

      {#if browsers.length === 0}
        <div class="empty-state">
          <span class="muted small">Clean</span>
        </div>
      {:else}
        <div class="browser-list">
          {#each browsers as b}
            {@const key = b.id || b.browser}
            <label class="row browser-row">
              <input type="checkbox" bind:checked={selectedBrowsers[key]} />
              <strong class="browser-name">{b.name || b.browser}</strong>
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
          onclick={requestCleanBrowsers}
        >
          {cleaningBrowsers
            ? "Cleaning…"
            : totalBrowserBytes > 0
              ? `Clean (${formatBytes(totalBrowserBytes)})`
              : "Clean"}
        </button>
      </div>
    </div>

    <div class="card browser-card">
      <div class="card-top-row">
        <strong class="card-title">Extensions &amp; Password Audit</strong>
        <div class="toolbar-actions">
          <button class="ghost small-pill" class:active-pill={showExtensions} onclick={loadExtensions}>
            <span>Browser Extensions {extensions.length ? `(${extensions.length})` : ""}</span>
          </button>
          <button class="ghost small-pill" onclick={runGeneratePassword}>
            <span>Generate Strong Password</span>
          </button>
        </div>
      </div>

      {#if generatedPassword}
        <div class="sub-panel" style="display: flex; justify-content: space-between; align-items: center; gap: 10px;">
          <code style="font-size: 13px; font-weight: 700; color: var(--accent);">{generatedPassword}</code>
          <button
            class="ghost small-pill"
            onclick={() => navigator.clipboard?.writeText(generatedPassword)}
          >
            Copy
          </button>
        </div>
      {/if}

      <div class="row" style="gap: 8px; flex-wrap: wrap;">
        <input
          type="password"
          bind:value={breachPassword}
          placeholder="Check password against k-anonymity breach database (SHA-1 prefix only)…"
          class="mini-input"
          style="flex: 1; min-width: 240px;"
          onkeydown={(e) => e.key === "Enter" && runPasswordBreachCheck()}
        />
        <button class="primary small-pill" disabled={checkingBreach || !breachPassword} onclick={runPasswordBreachCheck}>
          {checkingBreach ? "Checking…" : "Check Breach"}
        </button>
      </div>

      {#if breachCount !== null}
        <div class="small" style="font-weight: 700; color: {breachCount > 0 ? 'var(--danger)' : 'var(--accent)'};">
          {breachCount > 0
            ? `⚠ Found in ${breachCount.toLocaleString()} known data breaches — rotate immediately.`
            : "✓ Not found in any known data breaches."}
        </div>
      {/if}

      {#if showExtensions}
        <div class="browser-list">
          {#each extensions as ext (ext.browser + ext.id)}
            <div class="row browser-row">
              <div>
                <strong class="browser-name">{ext.name}</strong>
                <div class="muted small">{ext.browser} · v{ext.version} · {ext.permissions_count} permissions</div>
              </div>
              <div class="spacer"></div>
              <button class="ghost small-pill" onclick={() => api.revealInFolder(ext.path)}>
                Reveal
              </button>
            </div>
          {:else}
            <div class="muted small">No third-party browser extensions detected.</div>
          {/each}
        </div>
      {/if}
    </div>

    <!-- #10 OS Security Health (100% Local · Zero Network) -->
    <div class="card browser-card">
      <div class="card-top-row">
        <div class="row" style="gap: 10px; align-items: center; flex-wrap: wrap;">
          <strong class="card-title">OS Security Health</strong>
          <span class="badge free">100% Local · Zero Network</span>
          {#if securityHealth}
            <span
              class="badge"
              style={securityHealth.overall_status === "healthy"
                ? "background: var(--accent-light); color: var(--accent);"
                : securityHealth.overall_status === "warning"
                  ? "background: rgba(239, 68, 68, 0.14); color: var(--danger);"
                  : "background: rgba(245, 158, 11, 0.15); color: var(--warn);"}
            >
              {securityHealth.overall_status === "healthy"
                ? "Healthy"
                : securityHealth.overall_status === "warning"
                  ? "Action Recommended"
                  : "Needs Attention"}
            </span>
          {/if}
        </div>
        <button class="ghost small-pill" disabled={securityLoading} onclick={checkSecurityHealth}>
          <span>{securityLoading ? "Checking…" : "Recheck"}</span>
        </button>
      </div>

      {#if securityLoading && !securityHealth}
        <div class="empty-state">
          <span class="muted small">Inspecting local antivirus, firewall, and startup persistence…</span>
        </div>
      {:else if securityHealth}
        <div class="muted small">{securityHealth.summary}</div>

        <div class="browser-list">
          {#each securityHealth.checks as chk (chk.id)}
            <div class="row browser-row" style="cursor: default;">
              <div style="flex: 1; min-width: 0;">
                <strong class="browser-name">{chk.label}</strong>
                <div class="muted small">{chk.detail}</div>
              </div>
              <span
                class="badge"
                style={chk.status === "ok"
                  ? "background: var(--accent-light); color: var(--accent);"
                  : chk.status === "critical"
                    ? "background: rgba(239, 68, 68, 0.14); color: var(--danger);"
                    : chk.status === "warning"
                      ? "background: rgba(245, 158, 11, 0.15); color: var(--warn);"
                      : "background: var(--panel-solid); color: var(--muted);"}
              >
                {chk.status === "ok"
                  ? "Protected"
                  : chk.status === "critical"
                    ? "Off / Risk"
                    : chk.status === "warning"
                      ? "Warning"
                      : "Unavailable"}
              </span>
            </div>
          {/each}
        </div>

        {#if securityHealth.suspicious_entries.length > 0}
          <div class="sub-panel">
            <strong class="small" style="display: block; margin-bottom: 8px;">
              Flagged Startup Persistence Entries ({securityHealth.suspicious_entries.length})
            </strong>
            <div class="browser-list">
              {#each securityHealth.suspicious_entries as entry (entry.scope + entry.name + entry.command)}
                <div class="row browser-row" style="cursor: default;">
                  <div style="flex: 1; min-width: 0;">
                    <div class="row" style="gap: 8px;">
                      <strong class="small">{entry.name}</strong>
                      <span class="badge free">{entry.scope}</span>
                      <span
                        class="badge"
                        style={entry.severity === "high"
                          ? "background: rgba(239, 68, 68, 0.14); color: var(--danger);"
                          : "background: rgba(245, 158, 11, 0.15); color: var(--warn);"}
                      >
                        {entry.severity}
                      </span>
                    </div>
                    <div class="muted small" style="margin-top: 2px;">{entry.reason}</div>
                    <code class="small" style="display: block; margin-top: 2px; opacity: 0.8; word-break: break-all;">
                      {entry.command}
                    </code>
                  </div>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      {/if}
    </div>
  {/if}
</div>

<PreCleanConfirmDrawer
  open={showPrivacyConfirm}
  title={totalBrowserBytes > 0
    ? `Confirm Browser Privacy Cleanup — ${formatBytes(totalBrowserBytes)}`
    : "Confirm Browser Privacy Cleanup"}
  rollback="permanent"
  rollbackDetail="Selected browser caches, cookies, and history tables are erased permanently on disk and cannot be undone."
  categories={privacyConfirmCategories}
  totalBytes={totalBrowserBytes}
  totalFiles={selectedBrowserKeys.length}
  totalFilesUnit={selectedBrowserKeys.length === 1 ? "browser profile" : "browser profiles"}
  confirmLabel={totalBrowserBytes > 0
    ? `Permanently Clean ${formatBytes(totalBrowserBytes)}`
    : "Permanently Clean"}
  busy={cleaningBrowsers}
  onConfirm={confirmCleanBrowsers}
  onCancel={() => {
    showPrivacyConfirm = false;
  }}
/>

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
