<script lang="ts">
  import {
    api,
    errorMessage,
    isPaymentRequired,
    requestActivation,
    type DuplicateGroup,
    type LargeFilesReport,
    type LicenseStatus,
  } from "../lib/api";
  import { formatBytes, formatCount, shortenPath } from "../lib/format";
  import { addLifetimeStats } from "../lib/store";

  let { license } = $props<{ license: LicenseStatus | null }>();
  let mode = $state<"duplicates" | "large">("duplicates");
  let groups = $state<DuplicateGroup[]>([]);
  let selectedFiles = $state<Record<string, boolean>>({});
  let largeReport = $state<LargeFilesReport | null>(null);
  let minSizeMb = $state(25);
  let useTrash = $state(true);
  let loading = $state(false);
  let cleaning = $state(false);
  let error = $state("");
  let statusMessage = $state("");
  let needsPro = $state(false);
  let scanned = $state(false);
  let selectedDir = $state("");

  const selectedList = $derived(Object.keys(selectedFiles).filter((k) => selectedFiles[k]));
  const selectedBytes = $derived(
    groups.reduce((sum, g) => {
      const count = g.files.filter((f) => selectedFiles[f]).length;
      return sum + count * g.size;
    }, 0)
  );

  function smartSelectExtras() {
    const next: Record<string, boolean> = {};
    for (const g of groups) {
      g.files.slice(1).forEach((f) => {
        next[f] = true;
      });
    }
    selectedFiles = next;
  }

  async function scan() {
    if (!selectedDir.trim()) {
      error = "Please enter a directory path to scan.";
      return;
    }
    loading = true;
    error = "";
    statusMessage = "";
    needsPro = false;
    try {
      if (mode === "duplicates") {
        groups = await api.findDuplicates(selectedDir.trim());
        smartSelectExtras();
        scanned = true;
      } else {
        largeReport = await api.scanLargeFiles(selectedDir.trim(), minSizeMb * 1024 * 1024);
      }
    } catch (e) {
      if (isPaymentRequired(e)) {
        needsPro = true;
        requestActivation();
      } else {
        error = errorMessage(e);
      }
    } finally {
      loading = false;
    }
  }

  async function cleanSelected() {
    if (!selectedList.length) return;
    cleaning = true;
    error = "";
    statusMessage = "";
    try {
      const rep = await api.deleteDuplicates(selectedDir.trim(), selectedList, useTrash);
      addLifetimeStats(rep.bytes_freed, rep.files_removed);
      statusMessage = `Removed ${rep.files_removed} duplicate copies (${formatBytes(rep.bytes_freed)} freed)${useTrash ? " to Recycle Bin" : ""}.`;
      groups = await api.findDuplicates(selectedDir.trim());
      smartSelectExtras();
    } catch (e) {
      if (isPaymentRequired(e)) {
        needsPro = true;
        requestActivation();
      } else {
        error = errorMessage(e);
      }
    } finally {
      cleaning = false;
    }
  }

  async function trashLargeFile(filePath: string) {
    error = "";
    statusMessage = "";
    try {
      const freed = await api.deleteLargeFile(selectedDir.trim(), filePath, true);
      addLifetimeStats(freed, 1);
      statusMessage = `Moved file (${formatBytes(freed)}) to Recycle Bin.`;
      if (largeReport) {
        largeReport.top_files = largeReport.top_files.filter((f) => f.path !== filePath);
      }
    } catch (e) {
      if (isPaymentRequired(e)) {
        needsPro = true;
        requestActivation();
      } else {
        error = errorMessage(e);
      }
    }
  }
</script>

<div class="header">
  <div class="row" style="justify-content: space-between; align-items: flex-end; flex-wrap: wrap; gap: 12px;">
    <div>
      <h1 style="font-size: 26px; font-weight: 800; letter-spacing: -0.5px; margin: 0;">Duplicate & Disk Analyzer</h1>
      <p class="muted small" style="margin-top: 4px;">
        Isolate byte-for-byte duplicate files or map folder space by extension and largest files.
      </p>
    </div>

    <div class="subtab-toggle" role="tablist">
      <button
        class="subtab-btn"
        class:active={mode === "duplicates"}
        onclick={() => (mode = "duplicates")}
        role="tab"
        aria-selected={mode === "duplicates"}
      >
        Exact Duplicates
      </button>
      <button
        class="subtab-btn"
        class:active={mode === "large"}
        onclick={() => (mode = "large")}
        role="tab"
        aria-selected={mode === "large"}
      >
        Large Files & Disk Map
      </button>
    </div>
  </div>
</div>

<div class="card" style="padding: 16px 20px; margin-bottom: 24px; display: flex; gap: 14px; align-items: center; flex-wrap: wrap;">
  <input
    type="text"
    bind:value={selectedDir}
    placeholder="e.g. C:\Users\Benjamin\Pictures or C:\Users\Benjamin\Downloads"
    aria-label="Folder path to scan"
    style="flex: 1; min-width: 240px; padding: 10px 16px; border-radius: 9999px; border: 1.5px solid var(--border); background: var(--panel-solid); color: var(--text); outline: none; font-size: 13.5px;"
  />
  {#if mode === "large"}
    <label class="row small" style="gap: 6px;">
      <span class="muted">Min size:</span>
      <select
        bind:value={minSizeMb}
        aria-label="Minimum file size"
        style="padding: 8px 12px; border-radius: 9999px; border: 1px solid var(--border); background: var(--panel-solid);"
      >
        <option value={10}>10 MB+</option>
        <option value={25}>25 MB+</option>
        <option value={50}>50 MB+</option>
        <option value={100}>100 MB+</option>
        <option value={500}>500 MB+</option>
      </select>
    </label>
  {/if}
  <button class="primary" onclick={scan} disabled={loading || cleaning} style="padding: 10px 22px;">
    {mode === "duplicates" ? "Find Duplicates" : "Analyze Disk Space"}
  </button>
</div>

{#if statusMessage}
  <div class="card" style="padding: 14px 18px; border-left: 4px solid var(--accent); margin-bottom: 20px;">
    {statusMessage}
  </div>
{/if}

{#if loading}
  <div class="hero card" style="max-width: 500px; margin: 60px auto; padding: 40px; text-align: center;">
    <div class="spinner"></div>
    <p class="muted" style="margin-top: 16px;">
      {mode === "duplicates"
        ? "Hashing file byte sequences… this may take a few moments for deep folders."
        : "Mapping folder structure, extensions, and largest files…"}
    </p>
  </div>
{:else if needsPro && !license?.active}
  <div class="card" style="padding: 14px 18px; border-left: 4px solid #f59e0b; margin-bottom: 20px; display: flex; align-items: center; gap: 12px;">
    <span>This feature requires SWEEPR Cleaner Pro. Activate your licence to continue.</span>
    <div class="spacer"></div>
    <button class="primary" onclick={requestActivation}>Activate</button>
  </div>
{:else if error}
  <div class="card" style="padding: 14px 18px; border-left: 4px solid var(--danger); color: var(--danger); margin-bottom: 20px;">
    {error}
  </div>
{:else if mode === "duplicates"}
  {#if scanned && groups.length === 0}
    <div class="card" style="padding: 14px 18px; margin-bottom: 20px;">No duplicate files found in this folder.</div>
  {:else if groups.length > 0}
    <div class="card" style="padding: 14px 20px; margin-bottom: 20px; display: flex; align-items: center; gap: 14px; flex-wrap: wrap;">
      <button class="ghost" style="padding: 7px 14px; font-size: 12.5px;" onclick={smartSelectExtras}>
        Smart Select Extras (Keep 1st Copy)
      </button>
      <label class="row small" style="gap: 6px; cursor: pointer;">
        <input type="checkbox" bind:checked={useTrash} />
        <span>Move to Recycle Bin</span>
      </label>
      <div class="spacer"></div>
      <span class="muted small">{selectedList.length} files ({formatBytes(selectedBytes)}) selected</span>
      <button class="primary" disabled={!selectedList.length || cleaning} onclick={cleanSelected} style="padding: 8px 18px;">
        {cleaning ? "Cleaning…" : `Remove ${formatBytes(selectedBytes)}`}
      </button>
    </div>

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
            {#each g.files as f, idx}
              <label class="row file-path" style="gap: 8px; cursor: pointer;" title={f}>
                <input type="checkbox" bind:checked={selectedFiles[f]} />
                <span class="muted small" style="flex: 1; overflow: hidden; text-overflow: ellipsis;">{shortenPath(f, 52)}</span>
                {#if idx === 0}
                  <span class="badge free" style="font-size: 10px; padding: 2px 6px;">Keep</span>
                {/if}
              </label>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  {/if}
{:else if mode === "large" && largeReport}
  <div class="card" style="padding: 16px 22px; margin-bottom: 18px;">
    <div class="row">
      <strong>Scanned {formatBytes(largeReport.total_scanned_bytes)} across {formatCount(largeReport.total_scanned_files)} files</strong>
      <div class="spacer"></div>
      <span class="badge free">{largeReport.top_files.length} large files ≥ {minSizeMb} MB</span>
    </div>
  </div>

  <div class="breakdown-grid">
    <div class="card item">
      <strong style="margin-bottom: 12px;">Disk Map by File Extension</strong>
      {#each largeReport.by_extension as ext}
        {@const pct = largeReport.total_scanned_bytes > 0 ? Math.max(2, Math.round((ext.bytes / largeReport.total_scanned_bytes) * 100)) : 0}
        <div class="bar-row">
          <div class="row small" style="justify-content: space-between;">
            <span class="mono"><strong>{ext.label}</strong> ({formatCount(ext.files)} files)</span>
            <strong>{formatBytes(ext.bytes)} ({pct}%)</strong>
          </div>
          <div class="bar-track"><div class="bar-fill" style="width: {pct}%"></div></div>
        </div>
      {/each}
    </div>

    <div class="card item">
      <strong style="margin-bottom: 12px;">Disk Map by Top Subfolder</strong>
      {#each largeReport.by_folder as folder}
        {@const pct = largeReport.total_scanned_bytes > 0 ? Math.max(2, Math.round((folder.bytes / largeReport.total_scanned_bytes) * 100)) : 0}
        <div class="bar-row">
          <div class="row small" style="justify-content: space-between;">
            <span><strong>{folder.label}</strong> ({formatCount(folder.files)} files)</span>
            <strong>{formatBytes(folder.bytes)} ({pct}%)</strong>
          </div>
          <div class="bar-track"><div class="bar-fill" style="width: {pct}%"></div></div>
        </div>
      {/each}
    </div>
  </div>

  <div class="card" style="padding: 20px 24px; margin-top: 18px;">
    <div class="row" style="margin-bottom: 12px;">
      <strong>Largest Files ({largeReport.top_files.length})</strong>
      <div class="spacer"></div>
      <span class="muted small">Files deleted here go safely to your Recycle Bin</span>
    </div>
    {#if largeReport.top_files.length === 0}
      <div class="muted small">No files larger than {minSizeMb} MB found in this folder.</div>
    {:else}
      <div class="large-list">
        {#each largeReport.top_files as lf}
          <div class="row large-file-row">
            <span class="badge free mono">{lf.ext}</span>
            <div style="flex: 1; min-width: 0;">
              <strong style="font-size: 13.5px; display: block;">{lf.name}</strong>
              <div class="muted small mono" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title={lf.path}>
                {shortenPath(lf.path, 76)}
              </div>
            </div>
            <strong style="color: var(--accent); font-size: 15px;">{formatBytes(lf.size)}</strong>
            <button class="ghost" style="padding: 5px 12px; font-size: 12px;" onclick={() => trashLargeFile(lf.path)}>
              Move to Trash
            </button>
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .header { margin-bottom: 24px; }
  .subtab-toggle {
    display: flex;
    background: var(--panel-2);
    padding: 4px;
    border-radius: 9999px;
    border: 1px solid var(--border);
  }
  .subtab-btn {
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
  .subtab-btn.active {
    background: var(--panel-solid);
    color: var(--accent);
    box-shadow: 0 2px 6px rgba(15, 23, 42, 0.05);
  }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 18px; padding-bottom: 40px; }
  .breakdown-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 18px; }
  .item { padding: 18px; display: flex; flex-direction: column; }
  .bar-row { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
  .bar-track { height: 7px; border-radius: 9999px; background: var(--panel-2); overflow: hidden; }
  .bar-fill { height: 100%; background: linear-gradient(90deg, #10b981, #059669); border-radius: 9999px; }
  .large-list { display: flex; flex-direction: column; gap: 8px; max-height: 360px; overflow-y: auto; }
  .large-file-row { padding: 10px 14px; border-radius: 10px; border: 1px solid var(--border); background: var(--panel-2); }
  .files { background: var(--panel-2); border: 1px solid var(--border); padding: 10px 12px; border-radius: 12px; max-height: 180px; overflow-y: auto; }
  .file-path { padding: 5px 0; border-bottom: 1px solid var(--border); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .file-path:last-child { border-bottom: none; }
  .spinner { width: 36px; height: 36px; border: 3.5px solid #e2e8f0; border-top-color: var(--accent); border-radius: 50%; animation: spin 0.9s linear infinite; margin: 0 auto; }
  @keyframes spin { to { transform: rotate(360deg); } }
  input:focus { border-color: var(--accent) !important; box-shadow: 0 0 0 3px rgba(16,185,129,0.15); }
</style>
