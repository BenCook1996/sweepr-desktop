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
  import { formatBytes, formatCount } from "../lib/format";
  import { addLifetimeStats } from "../lib/store";

  let { license } = $props<{ license: LicenseStatus | null }>();
  let mode = $state<"apps" | "updater" | "remnants" | "registry" | "broken">("apps");
  let apps = $state<InstalledApp[]>([]);
  let outdated = $state<OutdatedApp[]>([]);
  let remnants = $state<AppRemnant[]>([]);
  let regIssues = $state<RegistryIssue[]>([]);
  let regBackups = $state<RegistryBackupEntry[]>([]);
  let brokenItems = $state<BrokenItem[]>([]);
  let selectedBroken = $state<Record<string, boolean>>({});
  let loading = $state(true);
  let updaterLoading = $state(false);
  let updaterLoaded = $state(false);
  let upgradingId = $state<string | null>(null);
  let updaterMessage = $state<string | null>(null);
  let remnantsLoading = $state(false);
  let remnantsLoaded = $state(false);
  let regLoading = $state(false);
  let regLoaded = $state(false);
  let brokenLoading = $state(false);
  let brokenLoaded = $state(false);
  let brokenCleaning = $state(false);
  let proNotice = $state<string | null>(null);
  let error = $state<string | null>(null);

  // Search & Drag-and-Drop Uninstaller filter state
  let searchQuery = $state("");
  let dragActive = $state(false);
  let resolvingTarget = $state(false);
  let resolvedHint = $state<string | null>(null);

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

  const matchingRemnants = $derived.by(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return remnants.filter(
      (r) => r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q)
    );
  });

  const selectedBrokenPaths = $derived(
    Object.keys(selectedBroken).filter((p) => selectedBroken[p])
  );

  $effect(() => {
    api.fetchApps().then((a) => { apps = a; loading = false; }).catch(() => { loading = false; });
  });

  async function resolveShortcutPath(rawPath: string) {
    const trimmed = rawPath.trim().replace(/^"+|"+$/g, "");
    if (!trimmed) return;
    resolvingTarget = true;
    error = null;
    try {
      const resolved = await api.resolveShortcutOrExe(trimmed);
      searchQuery = resolved;
      resolvedHint = `Isolated target "${resolved}" from ${trimmed.split(/[\\/]/).pop() || trimmed}`;
      if (!remnantsLoaded && !remnantsLoading) {
        loadRemnants();
      }
    } catch (e) {
      // Fallback: extract filename stem if backend couldn't resolve path
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
      handleError({ kind: "payment_required" }, "The software updater");
      return;
    }
    error = null;
    proNotice = null;
    updaterMessage = null;
    upgradingId = pkg.id;
    try {
      const msg = await api.upgradeSoftware(pkg.id);
      updaterMessage = msg;
      outdated = outdated.filter((o) => o.id !== pkg.id);
    } catch (e) {
      handleError(e, "The software updater");
    } finally {
      upgradingId = null;
    }
  }

  async function loadRemnants() {
    remnantsLoading = true;
    remnantsLoaded = true;
    try {
      remnants = await api.scanAppRemnants();
    } catch {
      remnants = [];
    } finally {
      remnantsLoading = false;
    }
  }

  async function loadRegistry() {
    regLoading = true;
    regLoaded = true;
    try {
      regIssues = await api.scanRegistry();
      regBackups = await api.listRegistryBackups();
    } catch {
      regIssues = [];
    } finally {
      regLoading = false;
    }
  }

  async function loadBroken() {
    brokenLoading = true;
    brokenLoaded = true;
    error = null;
    try {
      brokenItems = await api.scanBrokenItems();
      selectedBroken = Object.fromEntries(brokenItems.map((i) => [i.path, true]));
    } catch (e) {
      error = errorMessage(e);
      brokenItems = [];
    } finally {
      brokenLoading = false;
    }
  }

  async function cleanBrokenSelected() {
    if (!selectedBrokenPaths.length) return;
    if (!license?.active) {
      handleError({ kind: "payment_required" }, "Broken shortcut & empty folder cleanup");
      return;
    }
    error = null;
    proNotice = null;
    updaterMessage = null;
    brokenCleaning = true;
    try {
      const removed = await api.cleanBrokenItems(selectedBrokenPaths);
      addLifetimeStats(0, removed);
      updaterMessage = `Removed ${removed} broken shortcut(s) and empty folder(s).`;
      const removedSet = new Set(selectedBrokenPaths);
      brokenItems = brokenItems.filter((i) => !removedSet.has(i.path));
      selectedBroken = Object.fromEntries(brokenItems.map((i) => [i.path, true]));
    } catch (e) {
      handleError(e, "Broken shortcut & empty folder cleanup");
    } finally {
      brokenCleaning = false;
    }
  }

  $effect(() => {
    if (mode === "updater" && !updaterLoaded && !updaterLoading) {
      loadOutdated();
    }
    if (mode === "remnants" && !remnantsLoaded && !remnantsLoading) {
      loadRemnants();
    }
    if (mode === "registry" && !regLoaded && !regLoading) {
      loadRegistry();
    }
    if (mode === "broken" && !brokenLoaded && !brokenLoading) {
      loadBroken();
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

  async function uninstall(app: InstalledApp) {
    if (!license?.active) {
      handleError({ kind: "payment_required" }, "The uninstaller");
      return;
    }
    if (!confirm(`Are you sure you want to uninstall ${app.name}?`)) return;
    error = null;
    proNotice = null;
    try {
      await api.uninstallApp(app.id);
      apps = apps.filter((a) => a.id !== app.id);
    } catch (e) {
      handleError(e, "The uninstaller");
    }
  }

  async function removeRemnant(remnant: AppRemnant) {
    if (!license?.active) {
      handleError({ kind: "payment_required" }, "Leftover remnant cleanup");
      return;
    }
    error = null;
    proNotice = null;
    try {
      await api.cleanAppRemnant(remnant.path);
      addLifetimeStats(remnant.bytes, remnant.files);
      remnants = remnants.filter((r) => r.path !== remnant.path);
    } catch (e) {
      handleError(e, "Leftover remnant cleanup");
    }
  }

  async function fixIssue(issue: RegistryIssue) {
    if (!license?.active) {
      handleError({ kind: "payment_required" }, "Registry repair");
      return;
    }
    error = null;
    proNotice = null;
    try {
      await api.fixRegistryIssue(issue.key);
      regIssues = regIssues.filter((i) => i.key !== issue.key);
      regBackups = await api.listRegistryBackups();
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
      regIssues = await api.scanRegistry();
    } catch (e) {
      handleError(e, "Registry backup restore");
    }
  }
</script>

<div class="header">
  <div class="row" style="justify-content: space-between; align-items: flex-end; flex-wrap: wrap; gap: 12px;">
    <div>
      <h1 style="font-size: 26px; font-weight: 800; letter-spacing: -0.5px;">Software, Updates & Registry Repair</h1>
      <p class="muted small" style="margin-top: 4px;">Uninstall software cleanly, update outdated apps via Winget, remove orphaned AppData folders, and clean broken shortcuts.</p>
    </div>

    <div class="mode-toggle" role="tablist">
      <button class="mode-btn" class:active={mode === "apps"} onclick={() => (mode = "apps")} role="tab" aria-selected={mode === "apps"}>
        Installed Apps ({apps.length})
      </button>
      <button class="mode-btn" class:active={mode === "updater"} onclick={() => (mode = "updater")} role="tab" aria-selected={mode === "updater"}>
        App Updater (Winget) ({outdated.length})
      </button>
      <button class="mode-btn" class:active={mode === "remnants"} onclick={() => (mode = "remnants")} role="tab" aria-selected={mode === "remnants"}>
        Leftover Remnants ({remnants.length})
      </button>
      <button class="mode-btn" class:active={mode === "broken"} onclick={() => (mode = "broken")} role="tab" aria-selected={mode === "broken"}>
        Broken Shortcuts & Folders ({brokenItems.length})
      </button>
      <button class="mode-btn" class:active={mode === "registry"} onclick={() => (mode = "registry")} role="tab" aria-selected={mode === "registry"}>
        Registry Repair ({regIssues.length})
      </button>
    </div>
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
{#if updaterMessage}
  <div class="card notice" style="border-left: 4px solid var(--accent);">{updaterMessage}</div>
{/if}

{#if mode === "apps"}
  <!-- Search & Drag-and-Drop Uninstaller Bar -->
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
      placeholder="Search apps by name/publisher, or paste/drop a .lnk shortcut or .exe path to isolate…"
      class="filter-input"
      onkeydown={(e) => {
        if (e.key === "Enter" && (/[\\/]|\.(lnk|exe)$/i.test(searchQuery))) {
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
        {resolvingTarget ? "Resolving…" : "Resolve Target"}
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
      <span class="badge free">Drop .lnk / .exe Here</span>
    {/if}
  </div>

  {#if resolvedHint}
    <div class="card notice" style="border-left: 4px solid var(--accent); padding: 10px 16px;">
      <span>🎯 {resolvedHint}</span>
      {#if matchingRemnants.length > 0}
        <span class="badge pro">{matchingRemnants.length} matching AppData remnant(s) found</span>
      {/if}
    </div>
  {/if}

  {#if loading}
    <div class="hero card" style="max-width: 480px; margin: 60px auto; padding: 40px; text-align: center;">
      <div class="spinner"></div>
      <p class="muted" style="margin-top: 16px;">Scanning Windows Registry for installed applications…</p>
    </div>
  {:else if filteredApps.length === 0}
    <div class="card" style="padding: 28px; text-align: center; max-width: 520px; margin: 30px auto;">
      <strong>No matching installed applications found</strong>
      <p class="muted small" style="margin-top: 6px;">Try clearing the search filter or check Leftover Remnants for orphaned folders.</p>
    </div>
  {:else}
    <div class="grid">
      {#each filteredApps as app}
        <div class="card item">
          <div class="row" style="align-items: flex-start;">
            <div class="grow">
              <strong style="font-size: 15px; color: var(--text);">{app.name}</strong>
              <div class="muted small" style="margin-top: 4px;">{app.publisher || "Verified Publisher"} · v{app.version}</div>
            </div>
            {#if !license?.active}<span class="badge pro">Pro</span>{/if}
          </div>
          <div class="row" style="margin-top: 18px; padding-top: 12px; border-top: 1px solid var(--border);">
            <strong style="color: var(--accent); font-size: 18px; font-weight: 800;">{formatBytes(app.estimated_size)}</strong>
            <div class="spacer"></div>
            <button class="ghost small-btn" onclick={() => uninstall(app)}>Uninstall App</button>
          </div>
        </div>
      {/each}
    </div>
  {/if}

{:else if mode === "updater"}
  {#if updaterLoading}
    <div class="hero card" style="max-width: 480px; margin: 60px auto; padding: 40px; text-align: center;">
      <div class="spinner"></div>
      <p class="muted" style="margin-top: 16px;">Querying Windows Package Manager (winget) for outdated software…</p>
    </div>
  {:else if outdated.length === 0}
    <div class="card" style="padding: 32px; text-align: center; max-width: 560px; margin: 40px auto;">
      <div class="status-icon-bubble green" style="margin: 0 auto 16px auto;">✓</div>
      <h3 style="margin: 0 0 6px 0;">All Installed Software is Up to Date</h3>
      <p class="muted small">Winget reported no pending security or version updates for your installed packages.</p>
      <button class="ghost small-btn" style="margin-top: 14px;" onclick={loadOutdated}>Check Again</button>
    </div>
  {:else}
    <div class="row" style="margin-bottom: 16px;">
      <span class="muted small">{outdated.length} package updates available via Windows Package Manager</span>
      <div class="spacer"></div>
      <button class="ghost small-btn" onclick={loadOutdated}>Refresh List</button>
    </div>
    <div class="grid">
      {#each outdated as pkg}
        <div class="card item">
          <div>
            <div class="row" style="margin-bottom: 6px;">
              <span class="badge free">{pkg.source}</span>
              <div class="spacer"></div>
              <span class="mono muted small">{pkg.id}</span>
            </div>
            <strong style="font-size: 15px; display: block; margin-bottom: 6px;">{pkg.name}</strong>
            <div class="muted small">
              Current: <span class="mono">{pkg.current_version}</span> → Latest: <strong style="color: var(--accent);" class="mono">{pkg.available_version}</strong>
            </div>
          </div>
          <div class="row" style="margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--border);">
            <span class="badge pro">Security & Stability</span>
            <div class="spacer"></div>
            <button
              class="primary small-btn"
              disabled={upgradingId === pkg.id}
              onclick={() => upgradePkg(pkg)}
            >
              {upgradingId === pkg.id ? "Updating…" : "Update Now"}
            </button>
          </div>
        </div>
      {/each}
    </div>
  {/if}

{:else if mode === "remnants"}
  {#if remnantsLoading}
    <div class="hero card" style="max-width: 480px; margin: 60px auto; padding: 40px; text-align: center;">
      <div class="spinner"></div>
      <p class="muted" style="margin-top: 16px;">Scanning AppData for leftover folders from uninstalled software…</p>
    </div>
  {:else if remnants.length === 0}
    <div class="card" style="padding: 32px; text-align: center; max-width: 560px; margin: 40px auto;">
      <div class="status-icon-bubble green" style="margin: 0 auto 16px auto;">✓</div>
      <h3 style="margin: 0 0 6px 0;">No Orphaned AppData Remnants Found</h3>
      <p class="muted small">All top-level AppData folders match your installed software or protected system components.</p>
      <button class="ghost small-btn" style="margin-top: 14px;" onclick={loadRemnants}>Rescan AppData</button>
    </div>
  {:else}
    <div class="grid">
      {#each remnants as rem}
        <div class="card item">
          <div>
            <div class="row" style="margin-bottom: 6px;">
              <span class="badge pro">{rem.location}</span>
              <div class="spacer"></div>
              <span class="muted small">{formatCount(rem.files)} files</span>
            </div>
            <strong style="font-size: 15px; display: block; margin-bottom: 4px;">{rem.name}</strong>
            <div class="muted small mono" style="word-break: break-all;">{rem.path}</div>
          </div>
          <div class="row" style="margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--border);">
            <strong style="color: var(--accent); font-size: 17px; font-weight: 800;">{formatBytes(rem.bytes)}</strong>
            <div class="spacer"></div>
            <button class="primary small-btn" onclick={() => removeRemnant(rem)}>Move to Recycle Bin</button>
          </div>
        </div>
      {/each}
    </div>
  {/if}

{:else if mode === "broken"}
  {#if brokenLoading}
    <div class="hero card" style="max-width: 480px; margin: 60px auto; padding: 40px; text-align: center;">
      <div class="spinner"></div>
      <p class="muted" style="margin-top: 16px;">Scanning Desktop, Start Menu, and AppData for dead shortcuts & empty folders…</p>
    </div>
  {:else if brokenItems.length === 0}
    <div class="card" style="padding: 32px; text-align: center; max-width: 560px; margin: 40px auto;">
      <div class="status-icon-bubble green" style="margin: 0 auto 16px auto;">✓</div>
      <h3 style="margin: 0 0 6px 0;">No Broken Shortcuts or Empty Folders Found</h3>
      <p class="muted small">All Desktop and Start Menu shortcuts point to valid targets and no empty AppData directories were detected.</p>
      <button class="ghost small-btn" style="margin-top: 14px;" onclick={loadBroken}>Rescan Shortcuts & Folders</button>
    </div>
  {:else}
    <div class="card" style="padding: 14px 20px; margin-bottom: 18px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
      <span class="muted small">{selectedBrokenPaths.length} of {brokenItems.length} items selected</span>
      <button
        class="ghost small-btn"
        onclick={() => {
          const allSelected = selectedBrokenPaths.length === brokenItems.length;
          selectedBroken = Object.fromEntries(brokenItems.map((i) => [i.path, !allSelected]));
        }}
      >
        {selectedBrokenPaths.length === brokenItems.length ? "Deselect All" : "Select All"}
      </button>
      <div class="spacer"></div>
      <button class="ghost small-btn" onclick={loadBroken}>Rescan</button>
      <button
        class="primary small-btn"
        disabled={!selectedBrokenPaths.length || brokenCleaning}
        onclick={cleanBrokenSelected}
      >
        {brokenCleaning ? "Cleaning…" : `Clean Selected (${selectedBrokenPaths.length})`}
      </button>
    </div>

    <div class="grid">
      {#each brokenItems as item}
        <label class="card item" style="cursor: pointer;">
          <div>
            <div class="row" style="margin-bottom: 8px;">
              <input type="checkbox" bind:checked={selectedBroken[item.path]} />
              <span class="badge" class:pro={item.kind === "broken_shortcut"} class:free={item.kind !== "broken_shortcut"}>
                {item.kind === "broken_shortcut" ? "Broken Shortcut (.lnk)" : "Empty Folder"}
              </span>
              <div class="spacer"></div>
            </div>
            <strong style="font-size: 14.5px; display: block; margin-bottom: 4px;">{item.name}</strong>
            <div class="muted small" style="margin-bottom: 6px;">{item.detail}</div>
            <div class="muted small mono" style="word-break: break-all;">{item.path}</div>
          </div>
        </label>
      {/each}
    </div>
  {/if}

{:else if mode === "registry"}
  {#if regLoading}
    <div class="hero card" style="max-width: 480px; margin: 60px auto; padding: 40px; text-align: center;">
      <div class="spinner"></div>
      <p class="muted" style="margin-top: 16px;">Scanning Windows Registry for broken paths and orphans…</p>
    </div>
  {:else if regIssues.length === 0}
    <div class="card" style="padding: 32px; text-align: center; max-width: 560px; margin: 40px auto;">
      <div class="status-icon-bubble green" style="margin: 0 auto 16px auto;">✓</div>
      <h3 style="margin: 0 0 6px 0;">Registry is Clean & Optimized</h3>
      <p class="muted small">No broken App Paths or orphaned startup keys found in the registry.</p>
      <button class="ghost small-btn" style="margin-top: 14px;" onclick={loadRegistry}>Rescan Registry</button>
    </div>
  {:else}
    <div class="grid">
      {#each regIssues as issue}
        <div class="card item">
          <div>
            <div class="row" style="margin-bottom: 6px;">
              <span class="badge pro">{issue.issue_type}</span>
              <div class="spacer"></div>
              <strong style="font-size: 14px;">{issue.name}</strong>
            </div>
            <div class="muted small" style="word-break: break-all;">{issue.details}</div>
          </div>
          <div class="row" style="margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--border);">
            <span class="muted small mono">{issue.key}</span>
            <div class="spacer"></div>
            <button class="primary small-btn" onclick={() => fixIssue(issue)}>Clean (Auto-Backup)</button>
          </div>
        </div>
      {/each}
    </div>
  {/if}

  {#if regBackups.length > 0}
    <div class="card" style="padding: 20px 24px; margin-top: 24px;">
      <div class="row" style="margin-bottom: 12px;">
        <strong>Automatic Registry Backups ({regBackups.length})</strong>
        <div class="spacer"></div>
        <span class="muted small">One-click restore for any previously cleaned registry entry</span>
      </div>
      <div style="display: flex; flex-direction: column; gap: 8px; max-height: 220px; overflow-y: auto;">
        {#each regBackups as b}
          <div class="row" style="background: var(--panel-2); padding: 10px 14px; border-radius: 10px; border: 1px solid var(--border); gap: 12px;">
            <div style="flex: 1; min-width: 0;">
              <div class="row" style="gap: 8px;">
                <strong style="font-size: 13px;">{b.key}</strong>
                <span class="muted small">({b.issue_type})</span>
              </div>
              <div class="muted small mono" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">{b.value}</div>
            </div>
            <button class="ghost small-btn" onclick={() => restoreBackup(b)}>Restore</button>
          </div>
        {/each}
      </div>
    </div>
  {/if}
{/if}

<style>
  .header { margin-bottom: 24px; }
  .notice { display: flex; align-items: center; gap: 12px; padding: 12px 18px; margin-bottom: 18px; font-size: 13.5px; }
  .pro-notice { background: rgba(245, 158, 11, 0.14); border: 1px solid rgba(245, 158, 11, 0.35); color: var(--text); }
  .error-notice { background: rgba(239, 68, 68, 0.14); border: 1px solid rgba(239, 68, 68, 0.3); color: var(--danger); }
  .drop-filter-bar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 18px;
    margin-bottom: 18px;
    border: 1.5px dashed var(--border);
    transition: all 0.2s;
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
    padding: 7px 14px;
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
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 18px; padding-bottom: 40px; }
  .item { padding: 20px 22px; display: flex; flex-direction: column; justify-content: space-between; }
  .grow { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .small-btn { font-size: 12px; padding: 5px 14px; border-radius: 9999px; }
  .spinner { width: 36px; height: 36px; border: 3.5px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.9s linear infinite; margin: 0 auto; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .status-icon-bubble { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; font-size: 20px; font-weight: 800; }
  .status-icon-bubble.green { background: var(--accent-light); color: var(--accent); }
</style>
