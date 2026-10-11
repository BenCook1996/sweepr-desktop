<script lang="ts">
  import { api, type InstalledApp, type RegistryIssue, type LicenseStatus } from "../lib/api";
  import { formatBytes } from "../lib/format";
  
  let { license } = $props<{ license: LicenseStatus | null }>();
  let mode = $state<"apps" | "registry">("apps");
  let apps = $state<InstalledApp[]>([]);
  let regIssues = $state<RegistryIssue[]>([]);
  let loading = $state(true);
  let regLoading = $state(false);
  
  $effect(() => {
    api.fetchApps().then(a => { apps = a; loading = false; }).catch(() => { loading = false; });
  });

  async function loadRegistry() {
    regLoading = true;
    try {
      regIssues = await api.scanRegistry();
    } catch {
      regIssues = [];
    } finally {
      regLoading = false;
    }
  }

  $effect(() => {
    if (mode === "registry" && !regIssues.length) {
      loadRegistry();
    }
  });
  
  async function uninstall(app: InstalledApp) {
    if (!confirm(`Are you sure you want to uninstall ${app.name}?`)) return;
    try {
      await api.uninstallApp(app.uninstall_string);
      apps = apps.filter(a => a.id !== app.id);
    } catch (e) {
      alert("Failed to uninstall: " + e);
    }
  }

  async function fixIssue(issue: RegistryIssue) {
    try {
      await api.fixRegistryIssue(issue.key);
      regIssues = regIssues.filter(i => i.key !== issue.key);
    } catch (e) {
      alert("Failed to clean registry issue: " + e);
    }
  }
</script>

<div class="header">
  <div class="row" style="justify-content: space-between; align-items: flex-end;">
    <div>
      <h1 style="font-size: 26px; font-weight: 800; letter-spacing: -0.5px;">Software Uninstall & Registry Repair</h1>
      <p class="muted small" style="margin-top: 4px;">Uninstall software cleanly and repair broken Windows Registry paths and orphaned entries.</p>
    </div>
    
    <div class="mode-toggle">
      <button class="mode-btn" class:active={mode === "apps"} onclick={() => (mode = "apps")}>
        Installed Apps ({apps.length})
      </button>
      <button class="mode-btn" class:active={mode === "registry"} onclick={() => (mode = "registry")}>
        Registry Repair ({regIssues.length})
      </button>
    </div>
  </div>
</div>

{#if mode === "apps"}
  {#if loading}
    <div class="hero card" style="max-width: 480px; margin: 60px auto; padding: 40px; text-align: center;">
      <div class="spinner"></div>
      <p class="muted" style="margin-top: 16px;">Scanning Windows Registry for installed applications…</p>
    </div>
  {:else}
    <div class="grid">
      {#each apps.filter(a => a.estimated_size > 0).sort((a,b) => b.estimated_size - a.estimated_size) as app}
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
            <button class="primary small-btn" onclick={() => fixIssue(issue)}>Clean Registry</button>
          </div>
        </div>
      {/each}
    </div>
  {/if}
{/if}

<style>
  .header { margin-bottom: 24px; }
  .mode-toggle {
    display: flex;
    background: rgba(241, 245, 249, 0.8);
    padding: 4px;
    border-radius: 9999px;
    border: 1px solid var(--border);
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
    background: #ffffff;
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
