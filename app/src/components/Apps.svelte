<script lang="ts" module>
  import type {
    AppRemnant,
    BrokenItem,
    InstalledApp,
    OutdatedApp,
    RegistryBackupEntry,
    RegistryIssue,
  } from "../lib/api";

  let cachedMode: "apps" | "maintenance" = "apps";
  let cachedApps: InstalledApp[] = [];
  let cachedAppsLoaded = false;
  let cachedSearchQuery = "";
  let cachedOutdated: OutdatedApp[] = [];
  let cachedUpdaterLoaded = false;
  let cachedRemnants: AppRemnant[] = [];
  let cachedBrokenItems: BrokenItem[] = [];
  let cachedRegIssues: RegistryIssue[] = [];
  let cachedRegBackups: RegistryBackupEntry[] = [];
  let cachedOrphansLoaded = false;
</script>

<script lang="ts">
  import {
    api,
    errorMessage,
    isPaymentRequired,
    requestActivation,
    type LicenseStatus,
  } from "../lib/api";
  import { formatBytes, formatCount, shortenPath } from "../lib/format";
  import { addLifetimeStats } from "../lib/store";

  let { license }: { license: LicenseStatus | null } = $props();
  let mode = $state<"apps" | "maintenance">(cachedMode);

  // Installed Apps
  let apps = $state<InstalledApp[]>(cachedApps);
  let loading = $state(!cachedAppsLoaded);
  let searchQuery = $state(cachedSearchQuery);

  // Software Updater
  let outdated = $state<OutdatedApp[]>(cachedOutdated);
  let updaterLoading = $state(false);
  let updaterLoaded = $state(cachedUpdaterLoaded);
  let upgradingId = $state<string | null>(null);

  // Leftovers from uninstalled apps
  let remnants = $state<AppRemnant[]>(cachedRemnants);
  let brokenItems = $state<BrokenItem[]>(cachedBrokenItems);
  let regIssues = $state<RegistryIssue[]>(cachedRegIssues);
  let regBackups = $state<RegistryBackupEntry[]>(cachedRegBackups);
  let showLeftoverDetails = $state(false);
  let orphansLoading = $state(false);
  let orphansLoaded = $state(cachedOrphansLoaded);
  let cleaningOrphans = $state(false);

  // Feedback banners
  let statusNotice = $state<string | null>(null);
  let proNotice = $state<string | null>(null);
  let error = $state<string | null>(null);
  let confirmUninstallId = $state<string | null>(null);
  let searchInputEl = $state<HTMLInputElement | null>(null);

  $effect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f" && mode === "apps") {
        e.preventDefault();
        searchInputEl?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  $effect(() => {
    cachedMode = mode;
    cachedSearchQuery = searchQuery;
    cachedApps = apps;
    cachedOutdated = outdated;
    cachedUpdaterLoaded = updaterLoaded;
    cachedRemnants = remnants;
    cachedBrokenItems = brokenItems;
    cachedRegIssues = regIssues;
    cachedRegBackups = regBackups;
    cachedOrphansLoaded = orphansLoaded;
  });

  const filteredApps = $derived.by(() => {
    const q = searchQuery.trim().toLowerCase();
    const base = q
      ? apps.filter(
          (a) =>
            a.name.toLowerCase().includes(q) ||
            (a.publisher && a.publisher.toLowerCase().includes(q))
        )
      : apps.filter((a) => a.estimated_size > 0);
    return [...base].sort((a, b) => b.estimated_size - a.estimated_size);
  });

  const totalOrphanCount = $derived(
    remnants.length + brokenItems.length + regIssues.length
  );

  const totalRemnantBytes = $derived(
    remnants.reduce((s, r) => s + r.bytes, 0)
  );

  $effect(() => {
    if (cachedAppsLoaded) return;
    api
      .fetchApps()
      .then((a) => {
        apps = a;
        cachedApps = a;
        cachedAppsLoaded = true;
        loading = false;
      })
      .catch(() => {
        loading = false;
      });
  });

  $effect(() => {
    if (mode === "maintenance") {
      if (!updaterLoaded && !updaterLoading) loadOutdated();
      if (!orphansLoaded && !orphansLoading) scanAllOrphans();
    }
  });

  function handleError(e: unknown, feature: string) {
    if (isPaymentRequired(e)) {
      proNotice = `${feature} is a Pro feature. Upgrade to SWEEPR Pro to unlock it.`;
      requestActivation();
    } else {
      error = errorMessage(e);
    }
  }

  async function uninstall(app: InstalledApp) {
    if (!license?.active) {
      handleError({ kind: "payment_required" }, "App uninstaller");
      return;
    }
    if (confirmUninstallId !== app.id) {
      confirmUninstallId = app.id;
      return;
    }
    confirmUninstallId = null;
    error = null;
    proNotice = null;
    try {
      await api.uninstallApp(app.id);
      apps = apps.filter((a) => a.id !== app.id);
      statusNotice = `Opened the uninstaller for ${app.name}.`;
    } catch (e) {
      handleError(e, "App uninstaller");
    }
  }

  async function loadOutdated() {
    updaterLoading = true;
    updaterLoaded = true;
    error = null;
    try {
      outdated = await api.checkOutdatedSoftware();
    } catch (e) {
      error = errorMessage(e);
      outdated = [];
    } finally {
      updaterLoading = false;
    }
  }

  async function upgradePkg(pkg: OutdatedApp) {
    if (!license?.active) {
      handleError({ kind: "payment_required" }, "App updater");
      return;
    }
    error = null;
    proNotice = null;
    statusNotice = null;
    upgradingId = pkg.id;
    try {
      const msg = await api.upgradeSoftware(pkg.id);
      statusNotice = msg || `Updated ${pkg.name}.`;
      outdated = outdated.filter((o) => o.id !== pkg.id);
    } catch (e) {
      handleError(e, "App updater");
    } finally {
      upgradingId = null;
    }
  }

  async function scanAllOrphans() {
    orphansLoading = true;
    orphansLoaded = true;
    error = null;
    try {
      const [rem, brk, reg, bkp] = await Promise.all([
        api.scanAppRemnants().catch(() => []),
        api.scanBrokenItems().catch(() => []),
        api.scanRegistry().catch(() => []),
        api.listRegistryBackups().catch(() => []),
      ]);
      remnants = rem;
      brokenItems = brk;
      regIssues = reg;
      regBackups = bkp;
    } catch (e) {
      error = errorMessage(e);
    } finally {
      orphansLoading = false;
    }
  }

  async function fixRegistry(issue: RegistryIssue) {
    if (!license?.active) {
      handleError({ kind: "payment_required" }, "Registry cleaner");
      return;
    }
    error = null;
    try {
      await api.fixRegistryIssue(issue.key);
      regIssues = regIssues.filter((r) => r.key !== issue.key);
      regBackups = await api.listRegistryBackups().catch(() => regBackups);
      statusNotice = `Backed up and fixed registry key: ${issue.name}`;
    } catch (e) {
      handleError(e, "Registry cleaner");
    }
  }

  async function restoreRegBackup(backup: RegistryBackupEntry) {
    error = null;
    try {
      await api.restoreRegistryBackup(backup.id);
      regBackups = regBackups.filter((b) => b.id !== backup.id);
      statusNotice = `Restored registry key: ${backup.name}`;
    } catch (e) {
      error = errorMessage(e);
    }
  }

  async function cleanAllOrphans() {
    if (!license?.active) {
      handleError({ kind: "payment_required" }, "Leftovers cleanup");
      return;
    }
    error = null;
    proNotice = null;
    statusNotice = null;
    cleaningOrphans = true;
    let cleanedCount = 0;
    let freedBytes = 0;
    try {
      for (const rem of [...remnants]) {
        await api.cleanAppRemnant(rem.path);
        freedBytes += rem.bytes;
        cleanedCount += 1;
        remnants = remnants.filter((r) => r.path !== rem.path);
      }
      if (brokenItems.length > 0) {
        const paths = brokenItems.map((b) => b.path);
        const removed = await api.cleanBrokenItems(paths);
        cleanedCount += removed;
        brokenItems = [];
      }
      for (const reg of [...regIssues]) {
        await api.fixRegistryIssue(reg.key);
        cleanedCount += 1;
        regIssues = regIssues.filter((r) => r.key !== reg.key);
      }
      regBackups = await api.listRegistryBackups().catch(() => regBackups);
      if (freedBytes > 0 || cleanedCount > 0) {
        addLifetimeStats(freedBytes, cleanedCount);
      }
      statusNotice = `Cleaned ${cleanedCount} leftover(s)${freedBytes > 0 ? ` (${formatBytes(freedBytes)})` : ""}`;
    } catch (e) {
      handleError(e, "Leftovers cleanup");
    } finally {
      cleaningOrphans = false;
    }
  }
</script>

<div class="apps-layout">
  <div class="header-row">
    <h1 class="page-title">Uninstaller</h1>

    <div class="mode-toggle" role="tablist">
      <button
        class="mode-btn"
        class:active={mode === "apps"}
        onclick={() => (mode = "apps")}
        role="tab"
        aria-selected={mode === "apps"}
      >
        Installed ({apps.length})
      </button>
      <button
        class="mode-btn"
        class:active={mode === "maintenance"}
        onclick={() => (mode = "maintenance")}
        role="tab"
        aria-selected={mode === "maintenance"}
      >
        Updates &amp; Leftovers
      </button>
    </div>
  </div>

  {#if proNotice && !license?.active}
    <div class="card notice pro-notice">
      <span>{proNotice}</span>
      <div class="spacer"></div>
      <button class="primary small-btn" onclick={requestActivation}>Upgrade to Pro</button>
    </div>
  {/if}
  {#if error}
    <div class="card notice error-notice">{error}</div>
  {/if}
  {#if statusNotice}
    <div class="card notice success-notice">{statusNotice}</div>
  {/if}

  {#if mode === "apps"}
    <!-- Simple Search Bar -->
    <div class="card search-bar">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--accent); flex-shrink: 0;">
        <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
      </svg>
      <input
        bind:this={searchInputEl}
        type="text"
        bind:value={searchQuery}
        placeholder="Search your installed apps (Ctrl/Cmd+F)…"
        class="filter-input"
      />
      {#if searchQuery}
        <button class="ghost small-btn" onclick={() => (searchQuery = "")}>Clear</button>
      {:else}
        <span class="badge free">Largest First</span>
      {/if}
    </div>

    {#if loading}
      <div class="card center-state">
        <div class="spinner"></div>
        <p class="muted" style="margin-top: 14px;">Loading your installed apps…</p>
      </div>
    {:else if filteredApps.length === 0}
      <div class="card center-state">
        <strong>No matching apps found</strong>
        <p class="muted small" style="margin-top: 6px;">Try clearing your search above.</p>
      </div>
    {:else}
      <div class="card app-table">
        {#each filteredApps as app (app.id)}
          <div class="row app-row">
            <div class="app-main">
              <strong class="app-name">{app.name}</strong>
              <span class="muted small">
                {app.publisher || "Installed Program"}{app.version ? ` · v${app.version}` : ""}
              </span>
            </div>
            <div class="spacer"></div>
            <strong class="app-size">{formatBytes(app.estimated_size)}</strong>
            {#if !license?.active}<span class="badge pro">Pro</span>{/if}
            <button
              class={confirmUninstallId === app.id ? "primary small-btn" : "ghost small-btn"}
              style={confirmUninstallId === app.id ? "background: var(--danger);" : ""}
              onclick={() => uninstall(app)}
            >
              {confirmUninstallId === app.id ? "Confirm Uninstall" : "Uninstall"}
            </button>
          </div>
        {/each}
      </div>
    {/if}

  {:else}
    <!-- Two Simple Cards: 1. App Updates, 2. Leftover Files from Old Apps -->
    <div class="maintenance-grid">
      <!-- Card 1: Outdated Apps -->
      <section class="card maint-card">
        <div class="row" style="justify-content: space-between; align-items: center;">
          <h3>App Updates</h3>
          <button class="ghost small-btn" disabled={updaterLoading} onclick={loadOutdated}>
            {updaterLoading ? "…" : "Check"}
          </button>
        </div>

        {#if updaterLoading}
          <div class="center-mini">
            <div class="spinner"></div>
          </div>
        {:else if outdated.length === 0}
          <div class="clean-state-box">
            <strong>All apps up to date</strong>
          </div>
        {:else}
          <div class="maint-list">
            {#each outdated as pkg (pkg.id)}
              <div class="row maint-row">
                <div class="app-main">
                  <strong class="app-name">{pkg.name}</strong>
                  <span class="muted small">
                    {pkg.current_version} → <strong style="color: var(--accent);">{pkg.available_version}</strong>
                  </span>
                </div>
                <div class="spacer"></div>
                <button
                  class="primary small-btn"
                  disabled={upgradingId === pkg.id}
                  onclick={() => upgradePkg(pkg)}
                >
                  {upgradingId === pkg.id ? "…" : "Update"}
                </button>
              </div>
            {/each}
          </div>
        {/if}
      </section>

      <!-- Card 2: Leftover Files from Uninstalled Apps -->
      <section class="card maint-card">
        <div class="row" style="justify-content: space-between; align-items: center;">
          <h3>App Leftovers</h3>
          <button class="ghost small-btn" disabled={orphansLoading} onclick={scanAllOrphans}>
            {orphansLoading ? "…" : "Scan"}
          </button>
        </div>

        {#if orphansLoading}
          <div class="center-mini">
            <div class="spinner"></div>
          </div>
        {:else if totalOrphanCount === 0}
          <div class="clean-state-box">
            <strong>No leftovers found</strong>
          </div>
        {:else}
          <div class="leftover-summary-box">
            <strong style="font-size: 15px;">
              {totalOrphanCount} leftover(s) {totalRemnantBytes > 0 ? `(${formatBytes(totalRemnantBytes)})` : ""}
            </strong>
            <div class="row" style="gap: 8px; margin-top: 10px;">
              <button class="primary small-btn" disabled={cleaningOrphans} onclick={cleanAllOrphans}>
                {cleaningOrphans ? "Cleaning…" : "Clean Leftovers"}
              </button>
              <button class="ghost small-btn" onclick={() => (showLeftoverDetails = !showLeftoverDetails)}>
                {showLeftoverDetails ? "Hide" : "Details"}
              </button>
            </div>
          </div>

          {#if showLeftoverDetails}
            <div class="maint-list">
              {#each remnants as rem (rem.path)}
                <div class="row maint-row">
                  <div class="app-main">
                    <strong class="app-name">{rem.name}</strong>
                    <span class="muted small">{shortenPath(rem.path, 55)}</span>
                  </div>
                  <div class="spacer"></div>
                  <strong class="small" style="color: var(--accent);">{formatBytes(rem.bytes)}</strong>
                </div>
              {/each}
              {#each brokenItems as item (item.path)}
                <div class="row maint-row">
                  <div class="app-main">
                    <strong class="app-name">{item.name}</strong>
                    <span class="muted small">{shortenPath(item.path, 55)}</span>
                  </div>
                </div>
              {/each}
              {#each regIssues as reg (reg.key)}
                <div class="row maint-row">
                  <div class="app-main">
                    <strong class="app-name">{reg.name}</strong>
                    <span class="muted small">{reg.issue_type} · {shortenPath(reg.key, 50)}</span>
                  </div>
                  <div class="spacer"></div>
                  <button class="ghost small-btn" onclick={() => fixRegistry(reg)}>Fix</button>
                </div>
              {/each}
            </div>
          {/if}
        {/if}

        {#if regBackups.length > 0}
          <div style="margin-top: 8px; padding-top: 10px; border-top: 1px solid var(--border);">
            <strong class="small muted">Registry Backups ({regBackups.length})</strong>
            <div class="maint-list" style="margin-top: 6px;">
              {#each regBackups as bkp (bkp.id)}
                <div class="row maint-row">
                  <div class="app-main">
                    <strong class="app-name">{bkp.name}</strong>
                    <span class="muted small">{shortenPath(bkp.key, 50)}</span>
                  </div>
                  <div class="spacer"></div>
                  <button class="ghost small-btn" onclick={() => restoreRegBackup(bkp)}>Restore</button>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </section>
    </div>
  {/if}
</div>

<style>
  .apps-layout {
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
    font-size: 26px;
    font-weight: 800;
    letter-spacing: -0.5px;
    margin: 0;
  }
  .notice {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    font-size: 13.5px;
  }
  .pro-notice {
    background: rgba(245, 158, 11, 0.14);
    border-left: 4px solid var(--warn);
    color: var(--text);
  }
  .error-notice {
    background: rgba(239, 68, 68, 0.14);
    border-left: 4px solid var(--danger);
    color: var(--danger);
  }
  .success-notice {
    background: var(--accent-light);
    border-left: 4px solid var(--accent);
    color: var(--text);
    font-weight: 600;
  }
  .search-bar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 18px;
    border: 1.5px solid var(--border);
  }
  .filter-input {
    flex: 1;
    border: none;
    background: transparent !important;
    font-size: 14px;
    color: var(--text);
    outline: none;
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
  .app-table {
    padding: 4px 0;
    display: flex;
    flex-direction: column;
  }
  .app-row {
    padding: 12px 20px;
    border-bottom: 1px solid var(--border);
    gap: 12px;
  }
  .app-row:last-child {
    border-bottom: none;
  }
  .app-main {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .app-name {
    font-size: 14px;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .app-size {
    color: var(--accent);
    font-size: 14.5px;
    font-weight: 800;
    white-space: nowrap;
  }
  .small-btn {
    font-size: 12.5px;
    padding: 6px 14px;
    border-radius: 9999px;
  }
  .center-state {
    max-width: 520px;
    margin: 26px auto;
    padding: 34px;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .maintenance-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 18px;
    align-items: start;
  }
  @media (max-width: 920px) {
    .maintenance-grid {
      grid-template-columns: 1fr;
    }
  }
  .maint-card {
    padding: 22px 24px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .maint-card h3 {
    margin: 0;
    font-size: 17px;
    font-weight: 800;
  }
  .maint-card p {
    margin: 4px 0 0 0;
  }
  .center-mini {
    padding: 24px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }
  .clean-state-box {
    padding: 18px;
    border-radius: 12px;
    background: var(--panel-2);
    border: 1px solid var(--border);
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .leftover-summary-box {
    padding: 16px 18px;
    border-radius: 12px;
    background: var(--panel-2);
    border: 1px solid var(--border);
  }
  .maint-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: 320px;
    overflow-y: auto;
  }
  .maint-row {
    padding: 10px 14px;
    border-radius: 10px;
    background: var(--panel-2);
    border: 1px solid var(--border);
    gap: 10px;
  }
  .status-icon-bubble {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    flex-shrink: 0;
  }
  .status-icon-bubble.green {
    background: var(--accent-light);
    color: var(--accent);
  }
</style>
