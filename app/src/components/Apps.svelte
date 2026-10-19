<script lang="ts">
  import {
    api,
    errorMessage,
    isPaymentRequired,
    requestActivation,
    type AppRemnant,
    type BrokenItem,
    type InstalledApp,
    type LicenseStatus,
    type OutdatedApp,
    type RegistryBackupEntry,
    type RegistryIssue,
  } from "../lib/api";
  import { formatBytes, formatCount, shortenPath } from "../lib/format";
  import { addLifetimeStats } from "../lib/store";

  let { license }: { license: LicenseStatus | null } = $props();
  let mode = $state<"apps" | "updater" | "orphans">("apps");

  // Installed Apps
  let apps = $state<InstalledApp[]>([]);
  let loading = $state(true);
  let searchQuery = $state("");
  let dragActive = $state(false);
  let resolvingTarget = $state(false);
  let resolvedHint = $state<string | null>(null);

  // Software Updater
  let outdated = $state<OutdatedApp[]>([]);
  let updaterLoading = $state(false);
  let updaterLoaded = $state(false);
  let upgradingId = $state<string | null>(null);

  // Unified Orphans & Registry Sweep
  let remnants = $state<AppRemnant[]>([]);
  let brokenItems = $state<BrokenItem[]>([]);
  let regIssues = $state<RegistryIssue[]>([]);
  let regBackups = $state<RegistryBackupEntry[]>([]);
  let showBackups = $state(false);
  let orphansLoading = $state(false);
  let orphansLoaded = $state(false);
  let cleaningOrphans = $state(false);

  // Feedback banners
  let statusNotice = $state<string | null>(null);
  let proNotice = $state<string | null>(null);
  let error = $state<string | null>(null);

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
    api
      .fetchApps()
      .then((a) => {
        apps = a;
        loading = false;
      })
      .catch(() => {
        loading = false;
      });
  });

  $effect(() => {
    if (mode === "updater" && !updaterLoaded && !updaterLoading) {
      loadOutdated();
    }
    if (mode === "orphans" && !orphansLoaded && !orphansLoading) {
      scanAllOrphans();
    }
  });

  function handleError(e: unknown, feature: string) {
    if (isPaymentRequired(e)) {
      proNotice = `${feature} is a Pro feature. Activate your SWEEPR Cleaner licence to use it.`;
      requestActivation();
    } else {
      error = errorMessage(e);
    }
  }

  async function resolveShortcutPath(rawPath: string) {
    const trimmed = rawPath.trim().replace(/^"+|"+$/g, "");
    if (!trimmed) return;
    resolvingTarget = true;
    error = null;
    try {
      const resolved = await api.resolveShortcutOrExe(trimmed);
      searchQuery = resolved;
      resolvedHint = `Filtered by "${resolved}"`;
    } catch {
      const fileName = trimmed.split(/[\\/]/).pop() ?? trimmed;
      const stem = fileName.replace(/\.(lnk|exe|msi|url)$/i, "");
      searchQuery = stem;
      resolvedHint = `Filtered by "${stem}"`;
    } finally {
      resolvingTarget = false;
    }
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    dragActive = false;
    const file = e.dataTransfer?.files?.[0] as (File & { path?: string }) | undefined;
    if (file?.path) {
      resolveShortcutPath(file.path);
      return;
    }
    if (file?.name) {
      resolveShortcutPath(file.name);
      return;
    }
    const textData = e.dataTransfer?.getData("text/plain");
    if (textData) {
      resolveShortcutPath(textData);
    }
  }

  async function uninstall(app: InstalledApp) {
    if (!license?.active) {
      handleError({ kind: "payment_required" }, "App uninstaller");
      return;
    }
    if (!confirm(`Are you sure you want to uninstall ${app.name}?`)) return;
    error = null;
    proNotice = null;
    try {
      await api.uninstallApp(app.id);
      apps = apps.filter((a) => a.id !== app.id);
      statusNotice = `Launched uninstaller for ${app.name}.`;
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
      handleError({ kind: "payment_required" }, "Software updater");
      return;
    }
    error = null;
    proNotice = null;
    statusNotice = null;
    upgradingId = pkg.id;
    try {
      const msg = await api.upgradeSoftware(pkg.id);
      statusNotice = msg;
      outdated = outdated.filter((o) => o.id !== pkg.id);
    } catch (e) {
      handleError(e, "Software updater");
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

  async function cleanAllOrphans() {
    if (!license?.active) {
      handleError({ kind: "payment_required" }, "Orphans & Registry cleanup");
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
      for (const issue of [...regIssues]) {
        await api.fixRegistryIssue(issue.key);
        cleanedCount += 1;
        regIssues = regIssues.filter((i) => i.key !== issue.key);
      }
      regBackups = await api.listRegistryBackups().catch(() => regBackups);
      if (freedBytes > 0 || cleanedCount > 0) {
        addLifetimeStats(freedBytes, cleanedCount);
      }
      statusNotice = `Cleaned ${cleanedCount} orphaned item(s)${freedBytes > 0 ? ` and freed ${formatBytes(freedBytes)}` : ""}.`;
    } catch (e) {
      handleError(e, "Orphans & Registry cleanup");
    } finally {
      cleaningOrphans = false;
    }
  }

  async function removeSingleRemnant(rem: AppRemnant) {
    if (!license?.active) {
      handleError({ kind: "payment_required" }, "AppData remnant cleanup");
      return;
    }
    error = null;
    try {
      await api.cleanAppRemnant(rem.path);
      addLifetimeStats(rem.bytes, rem.files);
      remnants = remnants.filter((r) => r.path !== rem.path);
      statusNotice = `Moved ${rem.name} (${formatBytes(rem.bytes)}) to Recycle Bin.`;
    } catch (e) {
      handleError(e, "AppData remnant cleanup");
    }
  }

  async function removeSingleBroken(item: BrokenItem) {
    if (!license?.active) {
      handleError({ kind: "payment_required" }, "Shortcut & folder cleanup");
      return;
    }
    error = null;
    try {
      await api.cleanBrokenItems([item.path]);
      addLifetimeStats(0, 1);
      brokenItems = brokenItems.filter((b) => b.path !== item.path);
      statusNotice = `Removed ${item.name}.`;
    } catch (e) {
      handleError(e, "Shortcut & folder cleanup");
    }
  }

  async function fixSingleRegistry(issue: RegistryIssue) {
    if (!license?.active) {
      handleError({ kind: "payment_required" }, "Registry repair");
      return;
    }
    error = null;
    try {
      await api.fixRegistryIssue(issue.key);
      regIssues = regIssues.filter((i) => i.key !== issue.key);
      regBackups = await api.listRegistryBackups().catch(() => regBackups);
      statusNotice = `Cleaned registry entry "${issue.name}" (backup saved).`;
    } catch (e) {
      handleError(e, "Registry repair");
    }
  }

  async function restoreBackup(backup: RegistryBackupEntry) {
    if (!license?.active) {
      handleError({ kind: "payment_required" }, "Registry backup restore");
      return;
    }
    error = null;
    try {
      await api.restoreRegistryBackup(backup.id);
      regBackups = regBackups.filter((b) => b.id !== backup.id);
      regIssues = await api.scanRegistry().catch(() => regIssues);
      statusNotice = `Restored registry key ${backup.key}.`;
    } catch (e) {
      handleError(e, "Registry backup restore");
    }
  }
</script>

<div class="apps-layout">
  <div class="header-row">
    <div>
      <h1 class="page-title">Apps, Updates & Orphans</h1>
      <p class="muted small" style="margin: 4px 0 0 0;">
        Uninstall bloated programs, update outdated software, and sweep leftover AppData folders, dead shortcuts, and registry orphans in one place.
      </p>
    </div>

    <div class="mode-toggle" role="tablist">
      <button
        class="mode-btn"
        class:active={mode === "apps"}
        onclick={() => (mode = "apps")}
        role="tab"
        aria-selected={mode === "apps"}
      >
        Installed Apps ({apps.length})
      </button>
      <button
        class="mode-btn"
        class:active={mode === "updater"}
        onclick={() => (mode = "updater")}
        role="tab"
        aria-selected={mode === "updater"}
      >
        Software Updates {updaterLoaded ? `(${outdated.length})` : ""}
      </button>
      <button
        class="mode-btn"
        class:active={mode === "orphans"}
        onclick={() => (mode = "orphans")}
        role="tab"
        aria-selected={mode === "orphans"}
      >
        Orphans & Registry {orphansLoaded ? `(${totalOrphanCount})` : ""}
      </button>
    </div>
  </div>

  {#if proNotice && !license?.active}
    <div class="card notice pro-notice">
      <span>{proNotice}</span>
      <div class="spacer"></div>
      <button class="primary small-btn" onclick={requestActivation}>Activate</button>
    </div>
  {/if}
  {#if error}
    <div class="card notice error-notice">{error}</div>
  {/if}
  {#if statusNotice}
    <div class="card notice success-notice">{statusNotice}</div>
  {/if}

  {#if mode === "apps"}
    <!-- Search & Drag-and-Drop Bar -->
    <div
      class="card drop-filter-bar"
      class:drag-over={dragActive}
      ondragover={(e) => {
        e.preventDefault();
        dragActive = true;
      }}
      ondragleave={() => (dragActive = false)}
      ondrop={handleDrop}
      role="region"
      aria-label="Search installed apps or drop a shortcut to uninstall"
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--accent); flex-shrink: 0;">
        <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
      </svg>
      <input
        type="text"
        bind:value={searchQuery}
        placeholder="Search apps by name or publisher, or drop a desktop shortcut (.lnk / .exe) here…"
        class="filter-input"
        onkeydown={(e) => {
          if (e.key === "Enter" && /[\\/]|\.(lnk|exe)$/i.test(searchQuery)) {
            resolveShortcutPath(searchQuery);
          }
        }}
      />
      {#if /[\\/]|\.(lnk|exe)$/i.test(searchQuery.trim())}
        <button
          class="primary small-btn"
          disabled={resolvingTarget}
          onclick={() => resolveShortcutPath(searchQuery)}
        >
          {resolvingTarget ? "Resolving…" : "Find App"}
        </button>
      {/if}
      {#if searchQuery}
        <button
          class="ghost small-btn"
          onclick={() => {
            searchQuery = "";
            resolvedHint = null;
          }}
        >
          Clear
        </button>
      {:else}
        <span class="badge free">Sorted by Size</span>
      {/if}
    </div>

    {#if resolvedHint}
      <div class="card notice success-notice" style="padding: 10px 16px;">
        <span>{resolvedHint}</span>
      </div>
    {/if}

    {#if loading}
      <div class="card center-state">
        <div class="spinner"></div>
        <p class="muted" style="margin-top: 14px;">Reading installed programs…</p>
      </div>
    {:else if filteredApps.length === 0}
      <div class="card center-state">
        <strong>No matching applications found</strong>
        <p class="muted small" style="margin-top: 6px;">Try clearing the search filter or switch to Orphans & Registry to check for leftover files.</p>
      </div>
    {:else}
      <div class="card app-table">
        {#each filteredApps as app (app.id)}
          <div class="row app-row">
            <div class="app-main">
              <strong class="app-name">{app.name}</strong>
              <span class="muted small">{app.publisher || "Installed Program"}{app.version ? ` · v${app.version}` : ""}</span>
            </div>
            <div class="spacer"></div>
            <strong class="app-size">{formatBytes(app.estimated_size)}</strong>
            {#if !license?.active}<span class="badge pro">Pro</span>{/if}
            <button class="ghost small-btn" onclick={() => uninstall(app)}>Uninstall</button>
          </div>
        {/each}
      </div>
    {/if}

  {:else if mode === "updater"}
    {#if updaterLoading}
      <div class="card center-state">
        <div class="spinner"></div>
        <p class="muted" style="margin-top: 14px;">Checking Windows Package Manager (winget) for outdated apps…</p>
      </div>
    {:else if outdated.length === 0}
      <div class="card center-state">
        <div class="status-icon-bubble green">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        <h3 style="margin: 12px 0 6px 0;">All Installed Software is Up to Date</h3>
        <p class="muted small">No pending updates were reported by Windows Package Manager.</p>
        <button class="ghost small-btn" style="margin-top: 14px;" onclick={loadOutdated}>Check Again</button>
      </div>
    {:else}
      <div class="card toolbar-card">
        <span class="small"><strong>{outdated.length}</strong> software update(s) available</span>
        <div class="spacer"></div>
        <button class="ghost small-btn" onclick={loadOutdated}>Refresh</button>
      </div>
      <div class="card app-table">
        {#each outdated as pkg (pkg.id)}
          <div class="row app-row">
            <div class="app-main">
              <strong class="app-name">{pkg.name}</strong>
              <span class="muted small mono">{pkg.current_version} → <strong style="color: var(--accent);">{pkg.available_version}</strong></span>
            </div>
            <div class="spacer"></div>
            <span class="badge free">{pkg.source}</span>
            <button
              class="primary small-btn"
              disabled={upgradingId === pkg.id}
              onclick={() => upgradePkg(pkg)}
            >
              {upgradingId === pkg.id ? "Updating…" : "Update"}
            </button>
          </div>
        {/each}
      </div>
    {/if}

  {:else if mode === "orphans"}
    {#if orphansLoading}
      <div class="card center-state">
        <div class="spinner"></div>
        <p class="muted" style="margin-top: 14px;">Scanning AppData folders, shortcuts, and Windows Registry for orphans…</p>
      </div>
    {:else}
      <div class="card toolbar-card">
        <div>
          <strong>
            {totalOrphanCount === 0
              ? "System is clean — 0 orphaned items found"
              : `${totalOrphanCount} orphaned item(s) found${totalRemnantBytes > 0 ? ` (${formatBytes(totalRemnantBytes)} in leftover folders)` : ""}`}
          </strong>
          <div class="muted small">
            Combines leftover AppData folders ({remnants.length}), broken shortcuts &amp; empty folders ({brokenItems.length}), and broken registry paths ({regIssues.length})
          </div>
        </div>
        <div class="spacer"></div>
        {#if regBackups.length > 0}
          <button class="ghost small-btn" onclick={() => (showBackups = !showBackups)}>
            Registry Backups ({regBackups.length})
          </button>
        {/if}
        <button class="ghost small-btn" onclick={scanAllOrphans}>Rescan</button>
        {#if totalOrphanCount > 0}
          <button class="primary small-btn" disabled={cleaningOrphans} onclick={cleanAllOrphans}>
            {cleaningOrphans ? "Cleaning…" : `Clean All (${totalOrphanCount})`}
          </button>
        {/if}
      </div>

      {#if showBackups && regBackups.length > 0}
        <div class="card" style="padding: 16px 20px;">
          <div class="row" style="margin-bottom: 10px;">
            <strong class="small">Automatic Registry Backups ({regBackups.length})</strong>
            <div class="spacer"></div>
            <span class="muted small">One-click restore for any previously cleaned registry key</span>
          </div>
          <div style="display: flex; flex-direction: column; gap: 6px; max-height: 180px; overflow-y: auto;">
            {#each regBackups as b (b.id)}
              <div class="row" style="background: var(--panel-2); padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border);">
                <div style="flex: 1; min-width: 0;">
                  <strong class="small">{b.key}</strong>
                  <div class="muted small mono" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{b.value}</div>
                </div>
                <button class="ghost small-btn" onclick={() => restoreBackup(b)}>Restore</button>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      {#if totalOrphanCount === 0}
        <div class="card center-state">
          <div class="status-icon-bubble green">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <h3 style="margin: 12px 0 6px 0;">No Orphans or Broken Registry Keys Found</h3>
          <p class="muted small">Your AppData directories, shortcuts, and registry references are clean.</p>
        </div>
      {:else}
        <div class="card app-table">
          {#each remnants as rem (rem.path)}
            <div class="row app-row">
              <span class="badge pro">AppData Remnant</span>
              <div class="app-main">
                <strong class="app-name">{rem.name}</strong>
                <span class="muted small mono" title={rem.path}>{shortenPath(rem.path, 72)} ({formatCount(rem.files)} files)</span>
              </div>
              <div class="spacer"></div>
              <strong class="app-size">{formatBytes(rem.bytes)}</strong>
              <button class="ghost small-btn" onclick={() => removeSingleRemnant(rem)}>Clean</button>
            </div>
          {/each}

          {#each brokenItems as item (item.path)}
            <div class="row app-row">
              <span class="badge">{item.kind === "broken_shortcut" ? "Broken Shortcut" : "Empty Folder"}</span>
              <div class="app-main">
                <strong class="app-name">{item.name}</strong>
                <span class="muted small mono" title={item.path}>{shortenPath(item.path, 72)} · {item.detail}</span>
              </div>
              <div class="spacer"></div>
              <button class="ghost small-btn" onclick={() => removeSingleBroken(item)}>Remove</button>
            </div>
          {/each}

          {#each regIssues as issue (issue.key)}
            <div class="row app-row">
              <span class="badge free">Registry · {issue.issue_type}</span>
              <div class="app-main">
                <strong class="app-name">{issue.name}</strong>
                <span class="muted small mono" title={issue.details}>{shortenPath(issue.details, 72)}</span>
              </div>
              <div class="spacer"></div>
              <button class="ghost small-btn" onclick={() => fixSingleRegistry(issue)}>Fix Key</button>
            </div>
          {/each}
        </div>
      {/if}
    {/if}
  {/if}
</div>

<style>
  .apps-layout {
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
    flex-wrap: wrap;
    gap: 12px;
  }
  .page-title {
    font-size: 24px;
    font-weight: 800;
    letter-spacing: -0.5px;
    margin: 0;
  }
  .notice {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    font-size: 13px;
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
  }
  .drop-filter-bar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 11px 18px;
    border: 1.5px solid var(--border);
    transition: border-color 0.2s ease, background 0.2s ease;
  }
  .drop-filter-bar.drag-over {
    border-color: var(--accent);
    background: var(--accent-light);
  }
  .filter-input {
    flex: 1;
    border: none;
    background: transparent !important;
    font-size: 13.5px;
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
    font-size: 12.5px;
    font-weight: 600;
    color: var(--muted);
    cursor: pointer;
    box-shadow: none;
  }
  .mode-btn:hover {
    color: var(--text);
    background: transparent;
  }
  .mode-btn.active {
    background: var(--panel-solid);
    color: var(--accent);
    box-shadow: 0 2px 6px rgba(15, 23, 42, 0.08);
  }
  .toolbar-card {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 20px;
    flex-wrap: wrap;
  }
  .app-table {
    padding: 4px 0;
    display: flex;
    flex-direction: column;
  }
  .app-row {
    padding: 11px 18px;
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
    font-size: 12px;
    padding: 5px 14px;
    border-radius: 9999px;
  }
  .center-state {
    max-width: 520px;
    margin: 30px auto;
    padding: 34px;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .status-icon-bubble {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    display: grid;
    place-items: center;
  }
  .status-icon-bubble.green {
    background: var(--accent-light);
    color: var(--accent);
  }
</style>
