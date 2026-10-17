<script lang="ts">
  import {
    api,
    errorMessage,
    isPaymentRequired,
    requestActivation,
    type AppRemnant,
    type InstalledApp,
    type LicenseStatus,
    type OutdatedApp,
    type RegistryBackupEntry,
    type RegistryIssue,
  } from "../lib/api";
  import { formatBytes, formatCount } from "../lib/format";
  import { addLifetimeStats } from "../lib/store";

  let { license } = $props<{ license: LicenseStatus | null }>();
  let mode = $state<"apps" | "updater" | "remnants" | "registry">("apps");
  let apps = $state<InstalledApp[]>([]);
  let outdated = $state<OutdatedApp[]>([]);
  let remnants = $state<AppRemnant[]>([]);
  let regIssues = $state<RegistryIssue[]>([]);
  let regBackups = $state<RegistryBackupEntry[]>([]);
  let loading = $state(true);
  let updaterLoading = $state(false);
  let upgradingId = $state<string | null>(null);
  let updaterMessage = $state<string | null>(null);
  let remnantsLoading = $state(false);
  let regLoading = $state(false);
  let proNotice = $state<string | null>(null);
  let error = $state<string | null>(null);

  $effect(() => {
    api.fetchApps().then((a) => { apps = a; loading = false; }).catch(() => { loading = false; });
  });

  async function loadOutdated() {
    updaterLoading = true;
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
    try {
      regIssues = await api.scanRegistry();
      regBackups = await api.listRegistryBackups();
    } catch {
      regIssues = [];
    } finally {
      regLoading = false;
    }
  }

  $effect(() => {
    if (mode === "updater" && !outdated.length && !updaterLoading) {
      loadOutdated();
    }
    if (mode === "remnants" && !remnants.length) {
      loadRemnants();
    }
    if (mode === "registry" && !regIssues.length && !regBackups.length) {
      loadRegistry();
    }
  });

  function handleError(e: unknown, feature: string) {
    if (isPaymentRequired(e)) {
      proNotice = `${feature} is a Pro feature. Activate your Sweepr licence to use it.`;
      requestActivation();
    } else {
      error = errorMessage(e);
    }
  }

  async function uninstall(app: InstalledApp) {
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
    error = null;
    try {
      await api.restoreRegistryBackup(backup.id);
      regBackups = regBackups.filter((b) => b.id !== backup.id);
      regIssues = await api.scanRegistry();
    } catch (e) {
      error = errorMessage(e);
    }
  }
</script>

<div class="header">
  <div class="row" style="justify-content: space-between; align-items: flex-end; flex-wrap: wrap; gap: 12px;">
    <div>
      <h1 style="font-size: 26px; font-weight: 800; letter-spacing: -0.5px;">Software, Updates & Registry Repair</h1>
      <p class="muted small" style="margin-top: 4px;">Uninstall software cleanly, update outdated apps via Winget, remove orphaned AppData folders, and repair broken Registry entries.</p>
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
  {#if loading}
    <div class="hero card" style="max-width: 480px; margin: 60px auto; padding: 40px; text-align: center;">
      <div class="spinner"></div>
      <p class="muted" style="margin-top: 16px;">Scanning Windows Registry for installed applications…</p>
    </div>
  {:else}
    <div class="grid">
      {#each apps.filter((a) => a.estimated_size > 0).sort((a, b) => b.estimated_size - a.estimated_size) as app}
        <div class="card item">
          <div class="row" style="align-items: flex-start;">
            <div class="grow">
              <strong style="font-size: 15px; color: var(--text);">{app.name}</strong>
              <div class="muted small" style="margin-top: 4px;">{app.publisher || "Verified Publisher"} · v{app.version}</div>
            </div>
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
  .pro-notice { background: #fffbeb; border: 1px solid rgba(245, 158, 11, 0.35); color: #92400e; }
  .error-notice { background: #fef2f2; border: 1px solid rgba(239, 68, 68, 0.3); color: #991b1b; }
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
  .mode-btn.active {
    background: var(--panel-solid);
    color: var(--accent);
    box-shadow: 0 2px 6px rgba(15, 23, 42, 0.05);
  }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 18px; padding-bottom: 40px; }
  .item { padding: 20px 22px; display: flex; flex-direction: column; justify-content: space-between; }
  .grow { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .small-btn { font-size: 12px; padding: 5px 14px; border-radius: 9999px; }
  .spinner { width: 36px; height: 36px; border: 3.5px solid #e2e8f0; border-top-color: var(--accent); border-radius: 50%; animation: spin 0.9s linear infinite; margin: 0 auto; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .status-icon-bubble { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; font-size: 20px; font-weight: 800; }
  .status-icon-bubble.green { background: #dcfce7; color: #059669; }
</style>
