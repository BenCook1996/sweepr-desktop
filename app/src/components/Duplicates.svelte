<script lang="ts" module>
  import type { DuplicateGroup, LargeFilesReport } from "../lib/api";

  let cachedMode: "duplicates" | "large" = "duplicates";
  let cachedGroups: DuplicateGroup[] = [];
  let cachedSelectedFiles: Record<string, boolean> = {};
  let cachedLargeReport: LargeFilesReport | null = null;
  let cachedScanned = false;
  let cachedSelectedDir = "Downloads";
  let cachedTargetMoveDir = "";
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
  let mode = $state<"duplicates" | "large">(cachedMode);
  let groups = $state<DuplicateGroup[]>(cachedGroups);
  let selectedFiles = $state<Record<string, boolean>>(cachedSelectedFiles);
  let largeReport = $state<LargeFilesReport | null>(cachedLargeReport);
  let minSizeMb = $state(25);
  let useTrash = $state(true);
  let loading = $state(false);
  let cleaning = $state(false);
  let error = $state("");
  let statusMessage = $state("");
  let needsPro = $state(false);
  let scanned = $state(cachedScanned);
  let selectedDir = $state(cachedSelectedDir);
  let targetMoveDir = $state(cachedTargetMoveDir);
  let movingFile = $state<string | null>(null);

  $effect(() => {
    cachedMode = mode;
    cachedGroups = groups;
    cachedSelectedFiles = selectedFiles;
    cachedLargeReport = largeReport;
    cachedScanned = scanned;
    cachedSelectedDir = selectedDir;
    cachedTargetMoveDir = targetMoveDir;
  });

  const QUICK_FOLDERS = ["Downloads", "Documents", "Pictures", "Desktop", "Videos"];

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

  function pickFolder(folder: string) {
    selectedDir = folder;
    scan();
  }

  async function browseScanFolder() {
    try {
      const picked = await api.pickFolder("Select folder to scan");
      if (picked && picked.trim()) {
        selectedDir = picked.trim();
        await scan();
      }
    } catch {
      // Ignore cancel or dialog error
    }
  }

  async function browseMoveDestination() {
    try {
      const picked = await api.pickFolder("Select destination folder to move large files");
      if (picked && picked.trim()) {
        targetMoveDir = picked.trim();
      }
    } catch {
      // Ignore cancel or dialog error
    }
  }

  async function scan() {
    if (!selectedDir.trim()) {
      error = "Please select a folder or enter a directory path to scan.";
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
      addLifetimeStats(rep.bytes_freed, rep.files_removed, ["duplicates"], useTrash ? "Recycle Bin" : "Duplicates");
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
      addLifetimeStats(freed, 1, ["large_files"], "Recycle Bin");
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

  async function moveLargeFileToFolder(filePath: string) {
    let destDir = targetMoveDir.trim();
    if (!destDir) {
      try {
        const picked = await api.pickFolder("Select destination folder to move this file");
        if (!picked || !picked.trim()) return;
        destDir = picked.trim();
        targetMoveDir = destDir;
      } catch {
        return;
      }
    }
    error = "";
    statusMessage = "";
    movingFile = filePath;
    try {
      const newPath = await api.moveLargeFile(selectedDir.trim(), filePath, destDir);
      statusMessage = `Moved file to ${newPath}.`;
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
    } finally {
      movingFile = null;
    }
  }
</script>

<div class="duplicates-layout">
  <div class="header-row">
    <div>
      <h1 class="page-title">Duplicates & Large Files</h1>
      <p class="muted small" style="margin: 4px 0 0 0;">
        Find byte-for-byte duplicate files or inspect your largest files and folder breakdowns.
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

  <!-- Folder Picker & Scan Bar -->
  <div class="card scan-bar-card">
    <div class="quick-folders-row">
      <span class="field-label">QUICK FOLDERS:</span>
      {#each QUICK_FOLDERS as folder}
        <button
          type="button"
          class="folder-chip"
          class:active={selectedDir.trim().toLowerCase() === folder.toLowerCase()}
          onclick={() => pickFolder(folder)}
        >
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          <span>{folder}</span>
        </button>
      {/each}
    </div>

    <div class="row input-scan-row">
      <input
        type="text"
        bind:value={selectedDir}
        placeholder="Select a quick folder above or enter a custom path (e.g. C:\Users\Name\Downloads)"
        aria-label="Folder path to scan"
        class="folder-input"
        onkeydown={(e) => e.key === "Enter" && scan()}
      />
      <button type="button" class="ghost small-btn" onclick={browseScanFolder} disabled={loading || cleaning}>
        Browse Folder…
      </button>
      {#if mode === "large"}
        <label class="row small" style="gap: 6px;">
          <span class="muted">Min size:</span>
          <select
            bind:value={minSizeMb}
            aria-label="Minimum file size"
            class="size-select"
          >
            <option value={10}>10 MB+</option>
            <option value={25}>25 MB+</option>
            <option value={50}>50 MB+</option>
            <option value={100}>100 MB+</option>
            <option value={500}>500 MB+</option>
          </select>
        </label>
      {/if}
      <button class="primary scan-btn" onclick={scan} disabled={loading || cleaning}>
        {mode === "duplicates" ? "Scan for Duplicates" : "Analyze Disk Space"}
      </button>
    </div>
  </div>

  {#if statusMessage}
    <div class="card banner success-banner">
      {statusMessage}
    </div>
  {/if}

  {#if loading}
    <div class="card center-state">
      <div class="spinner"></div>
      <p class="muted" style="margin-top: 14px;">
        {mode === "duplicates"
          ? "Comparing file sizes and SHA-256 hashes…"
          : "Mapping folder structure, extensions, and largest files…"}
      </p>
    </div>
  {:else if needsPro && !license?.active}
    <div class="card banner pro-banner">
      <span>Scanning and cleaning duplicates &amp; large files requires SWEEPR Cleaner Pro.</span>
      <div class="spacer"></div>
      <button class="primary" style="padding: 6px 16px; font-size: 12.5px;" onclick={requestActivation}>Activate</button>
    </div>
  {:else if error}
    <div class="card banner error-banner">
      {error}
    </div>
  {:else if mode === "duplicates"}
    {#if scanned && groups.length === 0}
      <div class="card center-state">
        <strong>No duplicate files found in {selectedDir}</strong>
        <p class="muted small" style="margin-top: 4px;">Every file in this folder is unique.</p>
      </div>
    {:else if groups.length > 0}
      <div class="card toolbar-card">
        <button class="ghost small-btn" onclick={smartSelectExtras}>
          Auto-Select Extra Copies (Keep 1st)
        </button>
        <label class="row small" style="gap: 6px; cursor: pointer;">
          <input type="checkbox" bind:checked={useTrash} />
          <span>Move to Recycle Bin</span>
        </label>
        <div class="spacer"></div>
        <span class="muted small">{selectedList.length} files ({formatBytes(selectedBytes)}) selected</span>
        <button class="primary small-btn" disabled={!selectedList.length || cleaning} onclick={cleanSelected}>
          {cleaning ? "Cleaning…" : `Remove ${formatBytes(selectedBytes)}`}
        </button>
      </div>

      <div class="grid">
        {#each groups as g (g.hash)}
          <div class="card item">
            <div class="row" style="margin-bottom: 8px;">
              <strong style="font-size: 14.5px;">Duplicate Cluster</strong>
              <div class="spacer"></div>
              <span class="badge free">{g.files.length} copies</span>
            </div>
            <div class="cluster-size">
              {formatBytes(g.size)} <span class="muted small" style="font-weight: 500;">each</span>
            </div>
            <div class="files">
              {#each g.files as f, idx}
                <label class="row file-path" title={f}>
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
    <div class="card toolbar-card">
      <strong>Scanned {formatBytes(largeReport.total_scanned_bytes)} across {formatCount(largeReport.total_scanned_files)} files</strong>
      <div class="spacer"></div>
      <span class="badge free">{largeReport.top_files.length} files ≥ {minSizeMb} MB</span>
    </div>

    <div class="breakdown-grid">
      <div class="card item">
        <strong style="margin-bottom: 12px;">Space by File Extension</strong>
        {#each largeReport.by_extension as ext}
          {@const pct = largeReport.total_scanned_bytes > 0 ? Math.max(2, Math.round((ext.bytes / largeReport.total_scanned_bytes) * 100)) : 0}
          <div class="bar-row">
            <div class="row small" style="justify-content: space-between;">
              <span class="mono"><strong>{ext.label}</strong> ({formatCount(ext.files)})</span>
              <strong>{formatBytes(ext.bytes)} ({pct}%)</strong>
            </div>
            <div class="bar-track"><div class="bar-fill" style="width: {pct}%"></div></div>
          </div>
        {/each}
      </div>

      <div class="card item">
        <strong style="margin-bottom: 12px;">Space by Subfolder</strong>
        {#each largeReport.by_folder as folder}
          {@const pct = largeReport.total_scanned_bytes > 0 ? Math.max(2, Math.round((folder.bytes / largeReport.total_scanned_bytes) * 100)) : 0}
          <div class="bar-row">
            <div class="row small" style="justify-content: space-between;">
              <span><strong>{folder.label}</strong> ({formatCount(folder.files)})</span>
              <strong>{formatBytes(folder.bytes)} ({pct}%)</strong>
            </div>
            <div class="bar-track"><div class="bar-fill" style="width: {pct}%"></div></div>
          </div>
        {/each}
      </div>
    </div>

    <div class="card" style="padding: 20px 24px;">
      <div class="row" style="margin-bottom: 12px; flex-wrap: wrap; gap: 12px;">
        <strong>Largest Files ({largeReport.top_files.length})</strong>
        <div class="spacer"></div>
        <input
          type="text"
          bind:value={targetMoveDir}
          placeholder="Optional move destination (e.g. D:\Archive)…"
          aria-label="Destination folder to move large files"
          class="move-dest-input"
        />
        <button type="button" class="ghost small-btn" onclick={browseMoveDestination}>
          Browse…
        </button>
      </div>
      {#if largeReport.top_files.length === 0}
        <div class="muted small">No files larger than {minSizeMb} MB found in this folder.</div>
      {:else}
        <div class="large-list">
          {#each largeReport.top_files as lf (lf.path)}
            <div class="row large-file-row">
              <span class="badge free mono">{lf.ext}</span>
              <div style="flex: 1; min-width: 0;">
                <strong style="font-size: 13.5px; display: block;">{lf.name}</strong>
                <div class="muted small mono" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title={lf.path}>
                  {shortenPath(lf.path, 76)}
                </div>
              </div>
              <strong style="color: var(--accent); font-size: 14.5px;">{formatBytes(lf.size)}</strong>
              <button
                class="ghost small-btn"
                disabled={movingFile === lf.path}
                onclick={() => moveLargeFileToFolder(lf.path)}
              >
                {movingFile === lf.path ? "Moving…" : "Move…"}
              </button>
              <button class="ghost small-btn" onclick={() => trashLargeFile(lf.path)}>
                Recycle Bin
              </button>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .duplicates-layout {
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
    font-size: 12.5px;
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
  .scan-bar-card {
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .quick-folders-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .field-label {
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.6px;
    color: var(--muted);
    margin-right: 4px;
  }
  .folder-chip {
    padding: 5px 12px;
    border-radius: 9999px;
    font-size: 12px;
    font-weight: 600;
    background: var(--panel-2);
    border: 1px solid var(--border);
    color: var(--text-secondary);
    box-shadow: none;
  }
  .folder-chip.active {
    background: var(--accent-light);
    color: var(--accent);
    border-color: rgba(16, 185, 129, 0.4);
  }
  .input-scan-row {
    gap: 12px;
    flex-wrap: wrap;
  }
  .folder-input {
    flex: 1;
    min-width: 240px;
    padding: 10px 16px;
    border-radius: 9999px;
    border: 1.5px solid var(--border);
    background: var(--panel-solid);
    color: var(--text);
    outline: none;
    font-size: 13.5px;
  }
  .size-select {
    padding: 8px 12px;
    border-radius: 9999px;
    border: 1px solid var(--border);
    background: var(--panel-solid);
    font-size: 12.5px;
  }
  .scan-btn {
    padding: 10px 22px;
  }
  .toolbar-card {
    padding: 14px 20px;
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .banner {
    padding: 12px 18px;
    font-size: 13px;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .success-banner {
    border-left: 4px solid var(--accent);
    background: var(--accent-light);
  }
  .pro-banner {
    border-left: 4px solid var(--warn);
    background: rgba(245, 158, 11, 0.14);
  }
  .error-banner {
    border-left: 4px solid var(--danger);
    color: var(--danger);
    background: rgba(239, 68, 68, 0.12);
  }
  .center-state {
    max-width: 500px;
    margin: 30px auto;
    padding: 34px;
    text-align: center;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 18px;
  }
  .breakdown-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 18px;
  }
  .item {
    padding: 18px;
    display: flex;
    flex-direction: column;
  }
  .cluster-size {
    font-size: 24px;
    font-weight: 800;
    color: var(--accent);
    margin: 4px 0 10px 0;
  }
  .bar-row {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 10px;
  }
  .bar-track {
    height: 7px;
    border-radius: 9999px;
    background: var(--panel-2);
    overflow: hidden;
  }
  .bar-fill {
    height: 100%;
    background: linear-gradient(90deg, #10b981, #059669);
    border-radius: 9999px;
  }
  .large-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: 360px;
    overflow-y: auto;
  }
  .large-file-row {
    padding: 10px 14px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: var(--panel-2);
  }
  .move-dest-input {
    min-width: 250px;
    padding: 6px 14px;
    border-radius: 9999px;
    border: 1px solid var(--border);
    background: var(--panel-solid);
    font-size: 12.5px;
    outline: none;
  }
  .files {
    background: var(--panel-2);
    border: 1px solid var(--border);
    padding: 8px 12px;
    border-radius: 12px;
    max-height: 180px;
    overflow-y: auto;
  }
  .file-path {
    padding: 5px 0;
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    gap: 8px;
    cursor: pointer;
  }
  .file-path:last-child {
    border-bottom: none;
  }
  .small-btn {
    padding: 6px 14px;
    font-size: 12px;
    border-radius: 9999px;
  }
  input:focus {
    border-color: var(--accent) !important;
    box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.15);
  }
</style>
