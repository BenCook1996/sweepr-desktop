<script lang="ts">
  import { api, type DuplicateGroup, type LicenseStatus } from "../lib/api";
  import { formatBytes, shortenPath } from "../lib/format";
  
  let { license } = $props<{ license: LicenseStatus | null }>();
  let groups = $state<DuplicateGroup[]>([]);
  let loading = $state(false);
  let error = $state("");
  let selectedDir = $state("");
  
  async function scan() {
    if (!selectedDir) {
       alert("Please enter a directory path to scan");
       return;
    }
    loading = true;
    error = "";
    try {
      groups = await api.findDuplicates(selectedDir);
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  }
</script>

<div class="header">
  <h1 style="font-size: 26px; font-weight: 800; letter-spacing: -0.5px;">Duplicate Finder</h1>
  <p class="muted small" style="margin-top: 4px;">Hash and isolate identical files, photos, and installers taking up duplicate disk space.</p>
</div>

<div class="card" style="padding: 16px 20px; margin-bottom: 24px; display: flex; gap: 14px; align-items: center;">
  <input type="text" bind:value={selectedDir} placeholder="e.g. C:\Users\Benjamin\Pictures or C:\Users\Benjamin\Downloads" style="flex: 1; padding: 10px 16px; border-radius: 9999px; border: 1.5px solid var(--border); background: #ffffff; color: var(--text); outline: none; font-size: 13.5px;" />
  <button class="primary" onclick={scan} disabled={loading} style="padding: 10px 22px;">
    Find Duplicates
  </button>
</div>

{#if loading}
  <div class="hero card" style="max-width: 500px; margin: 60px auto; padding: 40px; text-align: center;">
    <div class="spinner"></div>
    <p class="muted" style="margin-top: 16px;">Hashing file byte sequences… this may take a few moments for deep folders.</p>
  </div>
{:else if error}
  <div class="card" style="padding: 14px 18px; border-left: 4px solid var(--danger); color: var(--danger); margin-bottom: 20px;">
    {error}
  </div>
{:else if groups.length > 0}
  <div class="grid">
    {#each groups as g}
      <div class="card item">
        <div class="row" style="margin-bottom: 8px;">
          <strong style="font-size: 15px;">Duplicate Cluster</strong>
          <div class="spacer"></div>
          <span class="badge free">{g.files.length} copies</span>
        </div>
        <div style="font-size: 26px; font-weight: 800; color: var(--accent); margin: 6px 0 12px 0;">
          {formatBytes(g.size)} <span style="font-size:12px; font-weight:500; color:var(--muted)">per copy</span>
        </div>
        <div class="files">
          {#each g.files as f}
            <div class="muted small file-path" title={f}>{shortenPath(f, 60)}</div>
          {/each}
        </div>
      </div>
    {/each}
  </div>
{/if}

<style>
  .header { margin-bottom: 24px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 18px; padding-bottom: 40px; }
  .item { padding: 18px; display: flex; flex-direction: column; }
  .files { background: rgba(248, 250, 252, 0.8); border: 1px solid var(--border); padding: 10px 12px; border-radius: 12px; max-height: 160px; overflow-y: auto; }
  .file-path { padding: 5px 0; border-bottom: 1px solid rgba(226, 232, 240, 0.6); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;}
  .file-path:last-child { border-bottom: none; }
  .spinner { width: 36px; height: 36px; border: 3.5px solid #e2e8f0; border-top-color: var(--accent); border-radius: 50%; animation: spin 0.9s linear infinite; margin: 0 auto; }
  @keyframes spin { to { transform: rotate(360deg); } }
  input:focus { border-color: var(--accent) !important; box-shadow: 0 0 0 3px rgba(16,185,129,0.15); }
</style>
