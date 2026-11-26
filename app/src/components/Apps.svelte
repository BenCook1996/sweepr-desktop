<script lang="ts" module>
  import type {
    AppRemnant,
    BatchUninstallReport,
    BrokenItem,
    ForceRemovePreview,
    ForceRemoveReport,
    InstalledApp,
    OutdatedApp,
    RegistryBackupEntry,
    RegistryIssue,
  } from "../lib/api";

  let cachedMode: "apps" | "maintenance" = "apps";
  let cachedApps: InstalledApp[] = [];
  let cachedAppsLoaded = false;
  let cachedSearchQuery = "";
  let cachedAppFilter: "all" | "desktop" | "uwp" = "all";
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
    type BatchUninstallProgress,
    type LicenseStatus,
  } from "../lib/api";
  import { formatBytes, formatCount, shortenPath } from "../lib/format";
  import { addLifetimeStats } from "../lib/store";
  import { lang, t } from "../lib/i18n";
  import PreCleanConfirmDrawer, {
    type ConfirmCleanCategoryItem,
    type RollbackDestination,
  } from "./PreCleanConfirmDrawer.svelte";

  let { license }: { license: LicenseStatus | null } = $props();
  let mode = $state<"apps" | "maintenance">(cachedMode);

  // Installed Apps
  let apps = $state<InstalledApp[]>(cachedApps);
  let loading = $state(!cachedAppsLoaded);
  let searchQuery = $state(cachedSearchQuery);
  let appKindFilter = $state<"all" | "desktop" | "uwp">(cachedAppFilter);

  // Multi-Select Batch Uninstall & Force Remove (#16)
  let selectedAppIds = $state<Record<string, boolean>>({});
  let batchRunning = $state(false);
  let batchProgress = $state<BatchUninstallProgress | null>(null);
  let confirmBatch = $state(false);
  let batchReport = $state<BatchUninstallReport | null>(null);
  let forcePreview = $state<ForceRemovePreview | null>(null);
  let forcePreviewLoading = $state<string | null>(null);
  let forceRemoving = $state(false);
  let forceReport = $state<ForceRemoveReport | null>(null);

  // Software Updater
  let outdated = $state<OutdatedApp[]>(cachedOutdated);
  let updaterLoading = $state(false);
  let updaterLoaded = $state(cachedUpdaterLoaded);
  let upgradingId = $state<string | null>(null);

  // Leftovers from uninstalled apps
  let remnants = $state<AppRemnant[]>(cachedRemnants);
  let brokenItems = $state<BrokenItem[]>(cachedBrokenItems);
  let skippedBrokenPaths = $state<Record<string, boolean>>({});
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
  let showOrphansConfirm = $state(false);
  let pendingSingleRegIssue = $state<RegistryIssue | null>(null);

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
    cachedAppFilter = appKindFilter;
    cachedApps = apps;
    cachedOutdated = outdated;
    cachedUpdaterLoaded = updaterLoaded;
    cachedRemnants = remnants;
    cachedBrokenItems = brokenItems;
    cachedRegIssues = regIssues;
    cachedRegBackups = regBackups;
    cachedOrphansLoaded = orphansLoaded;
  });

  const uwpCount = $derived(apps.filter((a) => a.kind === "uwp").length);
  const desktopCount = $derived(apps.filter((a) => a.kind !== "uwp").length);

  const filteredApps = $derived.by(() => {
    const q = searchQuery.trim().toLowerCase();
    const byKind =
      appKindFilter === "uwp"
        ? apps.filter((a) => a.kind === "uwp")
        : appKindFilter === "desktop"
          ? apps.filter((a) => a.kind !== "uwp")
          : apps;
    const base = q
      ? byKind.filter(
          (a) =>
            a.name.toLowerCase().includes(q) ||
            (a.publisher && a.publisher.toLowerCase().includes(q))
        )
      : byKind.filter((a) => a.estimated_size > 0 || a.kind === "uwp");
    return [...base].sort((a, b) => b.estimated_size - a.estimated_size);
  });

  const selectedAppList = $derived(
    filteredApps.filter((a) => selectedAppIds[a.id])
  );

  const activeBrokenItems = $derived(
    brokenItems.filter((b) => !skippedBrokenPaths[b.path])
  );
  const activeBrokenShortcuts = $derived(
    activeBrokenItems.filter((b) => b.kind !== "empty_folder")
  );
  const activeEmptyFolders = $derived(
    activeBrokenItems.filter((b) => b.kind === "empty_folder")
  );

  const totalOrphanCount = $derived(
    remnants.length + activeBrokenItems.length + regIssues.length
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
    batchReport = null;
    try {
      await api.uninstallApp(app.id);
      apps = apps.filter((a) => a.id !== app.id);
      if (selectedAppIds[app.id]) {
        const next = { ...selectedAppIds };
        delete next[app.id];
        selectedAppIds = next;
      }
      statusNotice =
        app.kind === "uwp"
          ? `Removed Microsoft Store app ${app.name}.`
          : `Opened the uninstaller for ${app.name}.`;
    } catch (e) {
      handleError(e, "App uninstaller");
    }
  }

  function selectAllFilteredApps() {
    const next = { ...selectedAppIds };
    for (const a of filteredApps.slice(0, 50)) {
      next[a.id] = true;
    }
    selectedAppIds = next;
  }

  function clearAppSelection() {
    selectedAppIds = {};
    confirmBatch = false;
  }

  async function runBatchUninstall() {
    const ids = selectedAppList.map((a) => a.id);
    if (ids.length === 0) return;
    if (!license?.active) {
      handleError({ kind: "payment_required" }, "Batch uninstaller");
      return;
    }
    confirmBatch = false;
    batchRunning = true;
    batchReport = null;
    batchProgress = { done: 0, total: ids.length, id: ids[0], name: selectedAppList[0]?.name || "", status: "running" };
    error = null;
    proNotice = null;
    statusNotice = null;
    let unlisten: (() => void) | null = null;
    try {
      unlisten = await api.onBatchUninstallProgress((p) => {
        batchProgress = p;
      });
      const rep = await api.uninstallAppsBatch(ids);
      batchReport = rep;
      const okIds = new Set(rep.results.filter((r) => r.ok).map((r) => r.id));
      apps = apps.filter((a) => !okIds.has(a.id));
      const nextSel = { ...selectedAppIds };
      for (const id of okIds) {
        delete nextSel[id];
      }
      selectedAppIds = nextSel;
      statusNotice = `Batch uninstall finished: ${rep.succeeded} succeeded, ${rep.failed} failed.`;
    } catch (e) {
      handleError(e, "Batch uninstaller");
    } finally {
      unlisten?.();
      batchRunning = false;
      batchProgress = null;
    }
  }

  async function openForceRemovePreview(id: string) {
    error = null;
    forceReport = null;
    forcePreviewLoading = id;
    try {
      forcePreview = await api.previewForceRemoveApp(id);
    } catch (e) {
      handleError(e, "Force Remove Leftovers");
    } finally {
      forcePreviewLoading = null;
    }
  }

  async function executeForceRemove() {
    if (!forcePreview) return;
    if (!license?.active) {
      handleError({ kind: "payment_required" }, "Force Remove Leftovers");
      return;
    }
    const targetId = forcePreview.id;
    forceRemoving = true;
    error = null;
    try {
      const rep = await api.forceRemoveApp(targetId);
      forceReport = rep;
      forcePreview = null;
      if (rep.registry_removed) {
        apps = apps.filter((a) => a.id !== targetId);
        if (selectedAppIds[targetId]) {
          const next = { ...selectedAppIds };
          delete next[targetId];
          selectedAppIds = next;
        }
      }
      if (rep.bytes_freed > 0) {
        addLifetimeStats(rep.bytes_freed, rep.paths_trashed.length, ["force_remove"], "OS Recycle Bin");
      }
      regBackups = await api.listRegistryBackups().catch(() => regBackups);
      statusNotice = rep.registry_removed
        ? `Force-removed ${rep.app_name}${rep.bytes_freed > 0 ? ` (${formatBytes(rep.bytes_freed)} moved to Recycle Bin)` : ""}.`
        : `Cleaned ${rep.paths_trashed.length} leftover folder(s) for ${rep.app_name}; registry entry remains (see warnings).`;
    } catch (e) {
      handleError(e, "Force Remove Leftovers");
    } finally {
      forceRemoving = false;
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
      regIssues = await api.scanRegistry().catch(() => regIssues);
      statusNotice = `Restored registry key: ${backup.name}`;
    } catch (e) {
      handleError(e, "Registry repair");
    }
  }

  const appsConfirmCategories = $derived.by<ConfirmCleanCategoryItem[]>(() => {
    if (pendingSingleRegIssue) {
      return [
        {
          id: pendingSingleRegIssue.key,
          name: `Orphaned Registry Entry · ${pendingSingleRegIssue.name}`,
          bytes: 0,
          files: 1,
          fileUnit: "key",
          note: `${pendingSingleRegIssue.issue_type} · Snapshot saved to Registry Backups`,
        },
      ];
    }
    const items: ConfirmCleanCategoryItem[] = [];
    if (remnants.length > 0) {
      items.push({
        id: "app_remnant_folders",
        name: "Uninstalled App Leftover Folders",
        bytes: totalRemnantBytes,
        files: remnants.length,
        fileUnit: remnants.length === 1 ? "folder" : "folders",
        note: "Moved to OS Recycle Bin",
      });
    }
    if (activeBrokenShortcuts.length > 0) {
      items.push({
        id: "broken_shortcuts",
        name: "Broken App Shortcuts",
        bytes: 0,
        files: activeBrokenShortcuts.length,
        fileUnit: activeBrokenShortcuts.length === 1 ? "shortcut" : "shortcuts",
        note: "Dead .lnk shortcut links removed permanently",
      });
    }
    if (activeEmptyFolders.length > 0) {
      items.push({
        id: "empty_folders",
        name: "Empty Folders (Desktop / Downloads / Documents)",
        bytes: 0,
        files: activeEmptyFolders.length,
        fileUnit: activeEmptyFolders.length === 1 ? "folder" : "folders",
        note: "0-file directories removed permanently",
      });
    }
    if (regIssues.length > 0) {
      items.push({
        id: "registry_orphans",
        name: "Orphaned HKCU Registry Entries",
        bytes: 0,
        files: regIssues.length,
        fileUnit: regIssues.length === 1 ? "key" : "keys",
        note: "Snapshot saved to Registry Backups before delete",
      });
    }
    return items;
  });

  const appsConfirmRollback = $derived<RollbackDestination>(
    pendingSingleRegIssue
      ? "backup"
      : activeBrokenItems.length > 0
        ? "permanent"
        : regIssues.length > 0 && remnants.length === 0
          ? "backup"
          : "recycle_bin"
  );
  const appsConfirmSecondaryBadge = $derived(
    !pendingSingleRegIssue && activeBrokenItems.length > 0 && remnants.length > 0
      ? "OS Recycle Bin (App Folders)"
      : !pendingSingleRegIssue && regIssues.length > 0 && (remnants.length > 0 || activeBrokenItems.length > 0)
        ? "Registry Backups (1-Click Restore)"
        : undefined
  );
  const appsConfirmTotalBytes = $derived(pendingSingleRegIssue ? 0 : totalRemnantBytes);
  const appsConfirmTotalItems = $derived(pendingSingleRegIssue ? 1 : totalOrphanCount);

  function requestCleanAllOrphans() {
    if (totalOrphanCount === 0) return;
    pendingSingleRegIssue = null;
    showOrphansConfirm = true;
  }

  function requestFixRegistry(issue: RegistryIssue) {
    pendingSingleRegIssue = issue;
    showOrphansConfirm = true;
  }

  function confirmOrphansDrawerAction() {
    const singleReg = pendingSingleRegIssue;
    showOrphansConfirm = false;
    pendingSingleRegIssue = null;
    if (singleReg) {
      void fixRegistry(singleReg);
    } else {
      void cleanAllOrphans();
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
      if (activeBrokenItems.length > 0) {
        const paths = activeBrokenItems.map((b) => b.path);
        const removed = await api.cleanBrokenItems(paths);
        cleanedCount += removed;
        brokenItems = await api.scanBrokenItems().catch(() => []);
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
    <h1 class="page-title">{t("nav.apps", $lang)}</h1>

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
    <!-- Search, Kind Filter & Multi-Select Batch Toolbar -->
    <div class="card search-bar" style="flex-wrap: wrap;">
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
      {#if uwpCount > 0}
        <div class="pill-filter" role="tablist" aria-label="App kind filter">
          <button
            type="button"
            class="pill-filter-btn"
            class:active={appKindFilter === "all"}
            onclick={() => (appKindFilter = "all")}
          >
            All ({apps.length})
          </button>
          <button
            type="button"
            class="pill-filter-btn"
            class:active={appKindFilter === "desktop"}
            onclick={() => (appKindFilter = "desktop")}
          >
            Desktop Apps ({desktopCount})
          </button>
          <button
            type="button"
            class="pill-filter-btn"
            class:active={appKindFilter === "uwp"}
            onclick={() => (appKindFilter = "uwp")}
          >
            Microsoft Store (UWP) ({uwpCount})
          </button>
        </div>
      {/if}
      {#if searchQuery}
        <button class="ghost small-btn" onclick={() => (searchQuery = "")}>Clear</button>
      {:else}
        <span class="badge free">Largest First</span>
      {/if}
    </div>

    {#if filteredApps.length > 0}
      <div class="card notice" style="justify-content: space-between; flex-wrap: wrap; padding: 10px 16px;">
        <div class="row" style="gap: 8px; flex-wrap: wrap;">
          <button type="button" class="ghost small-btn" disabled={batchRunning} onclick={selectAllFilteredApps}>
            Select All{filteredApps.length > 50 ? " (Top 50)" : ""}
          </button>
          {#if selectedAppList.length > 0}
            <button type="button" class="ghost small-btn" disabled={batchRunning} onclick={clearAppSelection}>
              Clear ({selectedAppList.length})
            </button>
          {/if}
        </div>
        <div class="row" style="gap: 8px; flex-wrap: wrap;">
          {#if batchRunning && batchProgress}
            <span class="small" style="font-weight: 700; color: var(--accent);">
              {#if batchProgress.status === "running"}
                Uninstalling {Math.min(batchProgress.done + 1, batchProgress.total)} of {batchProgress.total}: {batchProgress.name}…
              {:else}
                Finished {batchProgress.done} of {batchProgress.total}: {batchProgress.name}
              {/if}
            </span>
          {:else if confirmBatch && selectedAppList.length > 0}
            <span class="small muted">Uninstall {selectedAppList.length} app(s) sequentially?</span>
            <button type="button" class="ghost small-btn" onclick={() => (confirmBatch = false)}>Cancel</button>
            <button
              type="button"
              class="primary small-btn"
              style="background: var(--danger);"
              onclick={runBatchUninstall}
            >
              Confirm Batch ({selectedAppList.length})
            </button>
          {:else}
            <button
              type="button"
              class="primary small-btn"
              disabled={selectedAppList.length === 0 || batchRunning}
              onclick={() => (confirmBatch = true)}
            >
              Uninstall Selected ({selectedAppList.length})
            </button>
          {/if}
        </div>
      </div>
    {/if}

    {#if batchReport}
      <div class="card" style="padding: 14px 18px; display: flex; flex-direction: column; gap: 8px;">
        <div class="row" style="justify-content: space-between;">
          <strong class="small">
            Batch Uninstall Summary: {batchReport.succeeded} succeeded · {batchReport.failed} failed
          </strong>
          <button type="button" class="ghost small-btn" onclick={() => (batchReport = null)}>Dismiss</button>
        </div>
        <div class="maint-list">
          {#each batchReport.results as res (res.id)}
            <div class="row maint-row">
              <span
                class="badge"
                style={res.ok
                  ? "background: var(--accent-light); color: var(--accent);"
                  : "background: rgba(239, 68, 68, 0.14); color: var(--danger);"}
              >
                {res.status}
              </span>
              <div class="app-main" style="flex: 1;">
                <strong class="app-name">{res.name}</strong>
                <span class="muted small">{res.message}</span>
              </div>
              {#if !res.ok && !res.id.startsWith("UWP:")}
                <button
                  type="button"
                  class="ghost small-btn"
                  disabled={forcePreviewLoading === res.id}
                  onclick={() => openForceRemovePreview(res.id)}
                >
                  {forcePreviewLoading === res.id ? "…" : "Force Remove Leftovers"}
                </button>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {/if}

    {#if forceReport && forceReport.warnings.length > 0}
      <div class="card" style="padding: 12px 16px;">
        <strong class="small">Force Remove Notes ({forceReport.app_name})</strong>
        {#each forceReport.warnings as w, idx (idx)}
          <div class="muted small" style="margin-top: 4px;">• {w}</div>
        {/each}
      </div>
    {/if}

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
            <input
              type="checkbox"
              aria-label={`Select ${app.name} for batch uninstall`}
              checked={!!selectedAppIds[app.id]}
              disabled={batchRunning}
              onchange={(e) => {
                selectedAppIds = {
                  ...selectedAppIds,
                  [app.id]: (e.currentTarget as HTMLInputElement).checked,
                };
              }}
            />
            <div class="app-main">
              <div class="row" style="gap: 6px; align-items: center;">
                <strong class="app-name">{app.name}</strong>
                {#if app.kind === "uwp"}
                  <span class="badge free" style="font-size: 10.5px;">Store (UWP)</span>
                {/if}
              </div>
              <span class="muted small">
                {app.publisher || "Installed Program"}{app.version ? ` · v${app.version}` : ""}
              </span>
            </div>
            <div class="spacer"></div>
            <strong class="app-size">
              {app.estimated_size > 0 ? formatBytes(app.estimated_size) : app.kind === "uwp" ? "Store App" : "—"}
            </strong>
            {#if !license?.active}<span class="badge pro">Pro</span>{/if}
            {#if app.can_force_remove}
              <button
                type="button"
                class="ghost small-btn"
                disabled={batchRunning || forcePreviewLoading === app.id}
                onclick={() => openForceRemovePreview(app.id)}
                title="Remove orphaned install directory, AppData leftovers, and Uninstall registry key"
              >
                {forcePreviewLoading === app.id ? "…" : "Force Remove"}
              </button>
            {/if}
            <button
              class={confirmUninstallId === app.id ? "primary small-btn" : "ghost small-btn"}
              style={confirmUninstallId === app.id ? "background: var(--danger);" : ""}
              disabled={batchRunning}
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

      <!-- Card 2: Leftover Files & Safe HKCU Registry Repair -->
      <section class="card maint-card">
        <div class="row" style="justify-content: space-between; align-items: center;">
          <h3>App Leftovers &amp; Safe Registry Repair</h3>
          <button class="ghost small-btn" disabled={orphansLoading} onclick={scanAllOrphans}>
            {orphansLoading ? "…" : "Scan"}
          </button>
        </div>

        <p class="muted small" style="line-height: 1.4;">
          No aggressive registry wiping — Microsoft advises against it. Optional safe HKCU repair for broken
          App Paths &amp; orphaned Run keys only, with automatic JSON backup and best-effort Windows restore point.
        </p>

        {#if orphansLoading}
          <div class="center-mini">
            <div class="spinner"></div>
          </div>
        {:else if totalOrphanCount === 0 && brokenItems.length === 0}
          <div class="clean-state-box">
            <strong>No leftovers found</strong>
          </div>
        {:else}
          <div class="leftover-summary-box">
            <strong style="font-size: 15px;">
              {totalOrphanCount} leftover(s) selected {totalRemnantBytes > 0 ? `(${formatBytes(totalRemnantBytes)})` : ""}
            </strong>
            <div class="row" style="gap: 8px; margin-top: 10px;">
              <button
                class="primary small-btn"
                disabled={cleaningOrphans || totalOrphanCount === 0}
                onclick={requestCleanAllOrphans}
              >
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
                  <div class="app-main" style="flex: 1;">
                    <div class="row" style="gap: 6px; align-items: center;">
                      <span class="badge free">AppData Folder</span>
                      <strong class="app-name">{rem.name}</strong>
                    </div>
                    <span class="muted small">{shortenPath(rem.path, 55)}</span>
                  </div>
                  <strong class="small" style="color: var(--accent);">{formatBytes(rem.bytes)}</strong>
                </div>
              {/each}
              {#each brokenItems as item (item.path)}
                {@const isSkipped = !!skippedBrokenPaths[item.path]}
                <div class="row maint-row" style={isSkipped ? "opacity: 0.55;" : ""}>
                  <input
                    type="checkbox"
                    aria-label={`Include ${item.name} in cleanup`}
                    checked={!isSkipped}
                    onchange={(e) => {
                      const include = (e.currentTarget as HTMLInputElement).checked;
                      skippedBrokenPaths = {
                        ...skippedBrokenPaths,
                        [item.path]: !include,
                      };
                    }}
                  />
                  <div class="app-main" style="flex: 1;">
                    <div class="row" style="gap: 6px; align-items: center;">
                      <span class="badge" style="background: rgba(245, 158, 11, 0.14); color: var(--warn);">
                        {item.kind === "empty_folder" ? "Empty Folder" : "Broken Shortcut"}
                      </span>
                      <strong class="app-name">{item.name}</strong>
                    </div>
                    <span class="muted small">{item.detail} · {shortenPath(item.path, 48)}</span>
                  </div>
                </div>
              {/each}
              {#each regIssues as reg (reg.key)}
                <div class="row maint-row">
                  <div class="app-main" style="flex: 1;">
                    <strong class="app-name">{reg.name}</strong>
                    <span class="muted small">{reg.issue_type} · {shortenPath(reg.key, 50)}</span>
                  </div>
                  <button class="ghost small-btn" onclick={() => requestFixRegistry(reg)}>Fix</button>
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
                  {#if bkp.issue_type === "Force Uninstall Entry"}
                    <span class="badge">Force Remove Snapshot</span>
                    <span class="badge free">Files in Recycle Bin</span>
                  {:else}
                    <button class="ghost small-btn" onclick={() => restoreRegBackup(bkp)}>Restore</button>
                  {/if}
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </section>
    </div>
  {/if}
</div>

{#if forcePreview}
  <div
    class="force-backdrop"
    role="presentation"
    onclick={() => {
      if (!forceRemoving) forcePreview = null;
    }}
  >
    <div
      class="force-modal card"
      role="dialog"
      aria-modal="true"
      aria-label="Force Remove Leftovers Preview"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => {
        if (e.key === "Escape" && !forceRemoving) forcePreview = null;
      }}
    >
      <div class="row" style="justify-content: space-between; align-items: center;">
        <strong style="font-size: 16.5px;">Force Remove Leftovers — {forcePreview.app_name}</strong>
        <button
          type="button"
          class="ghost small-btn"
          disabled={forceRemoving}
          onclick={() => (forcePreview = null)}
        >
          ✕
        </button>
      </div>
      <p class="muted small" style="margin: 0; line-height: 1.45;">
        Validated install &amp; AppData folders move to the OS Recycle Bin. A snapshot of the Uninstall registry entry
        is logged in Registry Backups after removal
        {forcePreview.requires_elevation_for_registry ? " (may prompt for Windows Administrator confirmation)." : "."}
      </p>
      <div class="sub-box">
        <div class="small"><strong>Registry Entry:</strong> <code>{forcePreview.registry_key}</code></div>
        {#if forcePreview.install_dir}
          <div class="small" style="margin-top: 6px;">
            <strong>Install Folder:</strong> {forcePreview.install_dir} ({formatBytes(forcePreview.install_dir_bytes)})
          </div>
        {/if}
        {#if forcePreview.remnant_dirs.length > 0}
          <div class="small" style="margin-top: 6px;">
            <strong>AppData Folders ({forcePreview.remnant_dirs.length}):</strong>
            {#each forcePreview.remnant_dirs as rem (rem.path)}
              <div class="muted small">• {rem.path} ({formatBytes(rem.bytes)})</div>
            {/each}
          </div>
        {/if}
        {#if forcePreview.warnings.length > 0}
          <div class="small" style="margin-top: 8px; color: var(--warn);">
            {#each forcePreview.warnings as w, idx (idx)}
              <div>⚠ {w}</div>
            {/each}
          </div>
        {/if}
      </div>
      <div class="row" style="justify-content: flex-end; gap: 8px;">
        <button type="button" class="ghost small-btn" disabled={forceRemoving} onclick={() => (forcePreview = null)}>
          Cancel
        </button>
        <button
          type="button"
          class="primary small-btn"
          style="background: var(--danger);"
          disabled={forceRemoving}
          onclick={executeForceRemove}
        >
          {forceRemoving
            ? "Removing…"
            : `Force Remove (${forcePreview.total_bytes > 0 ? formatBytes(forcePreview.total_bytes) : "Registry + Leftovers"})`}
        </button>
      </div>
    </div>
  </div>
{/if}

<PreCleanConfirmDrawer
  open={showOrphansConfirm}
  title={pendingSingleRegIssue
    ? `Confirm Registry Repair — ${pendingSingleRegIssue.name}`
    : `Confirm App Leftovers Cleanup (${appsConfirmTotalItems} ${appsConfirmTotalItems === 1 ? "item" : "items"})`}
  rollback={appsConfirmRollback}
  secondaryRollbackBadge={appsConfirmSecondaryBadge}
  rollbackDetail={pendingSingleRegIssue
    ? "A snapshot of this HKCU registry entry is saved in Registry Backups so you can restore it in 1 click anytime."
    : appsConfirmRollback === "permanent"
      ? "Broken .lnk shortcuts and selected empty folders are permanently removed; registry keys save a local snapshot in Registry Backups; leftover AppData folders move to OS Recycle Bin."
      : appsConfirmRollback === "backup"
        ? "Snapshots of HKCU registry entries are saved in Registry Backups so you can restore them in 1 click anytime."
        : "Leftover AppData folders from uninstalled apps are moved to your OS Recycle Bin."}
  categories={appsConfirmCategories}
  totalBytes={appsConfirmTotalBytes}
  totalFiles={appsConfirmTotalItems}
  totalFilesUnit={appsConfirmTotalItems === 1 ? "item" : "items"}
  confirmLabel={pendingSingleRegIssue ? "Fix Registry Key" : "Clean Leftovers"}
  busy={cleaningOrphans}
  onConfirm={confirmOrphansDrawerAction}
  onCancel={() => {
    showOrphansConfirm = false;
    pendingSingleRegIssue = null;
  }}
/>

<style>
  .pill-filter {
    display: inline-flex;
    background: var(--panel-2);
    padding: 3px;
    border-radius: 9999px;
    border: 1px solid var(--border);
    gap: 2px;
  }
  .pill-filter-btn {
    background: transparent;
    border: none;
    padding: 4px 10px;
    border-radius: 9999px;
    font-size: 12px;
    font-weight: 600;
    color: var(--muted);
    cursor: pointer;
    box-shadow: none;
  }
  .pill-filter-btn.active {
    background: var(--panel-solid);
    color: var(--accent);
  }
  .force-backdrop {
    position: fixed;
    inset: 0;
    z-index: 960;
    background: rgba(15, 18, 16, 0.48);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 18px;
  }
  .force-modal {
    width: 100%;
    max-width: 560px;
    padding: 20px 22px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .sub-box {
    padding: 12px 14px;
    border-radius: 10px;
    background: var(--panel-2);
    border: 1px solid var(--border);
    max-height: 260px;
    overflow-y: auto;
  }
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
