<script lang="ts" module>
  import type { DuplicateGroup, LargeFilesReport } from "../lib/api";

  let cachedSourceTab: "pc" | "cloud" = "pc";
  let cachedMode: "duplicates" | "large" = "duplicates";
  let cachedGroups: DuplicateGroup[] = [];
  let cachedSelectedFiles: Record<string, boolean> = {};
  let cachedLargeReport: LargeFilesReport | null = null;
  let cachedScanned = false;
  let cachedSelectedDir = "Downloads";
</script>

<script lang="ts">
  import CloudClean from "./CloudClean.svelte";
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
  let sourceTab = $state<"pc" | "cloud">(cachedSourceTab);
  let mode = $state<"duplicates" | "large">(cachedMode);
  let groups = $state<DuplicateGroup[]>(cachedGroups);
  let selectedFiles = $state<Record<string, boolean>>(cachedSelectedFiles);
  let largeReport = $state<LargeFilesReport | null>(cachedLargeReport);
  let minSizeMb = $state(25);
  let loading = $state(false);
  let cleaning = $state(false);
  let error = $state("");
  let statusMessage = $state("");
  let needsPro = $state(false);
  let scanned = $state(cachedScanned);
  let selectedDir = $state(cachedSelectedDir);
  let movingFile = $state<string | null>(null);

  $effect(() => {
    cachedSourceTab = sourceTab;
    cachedMode = mode;
    cachedGroups = groups;
    cachedSelectedFiles = selectedFiles;
    cachedLargeReport = largeReport;
    cachedScanned = scanned;
    cachedSelectedDir = selectedDir;
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

  function pickQuickFolder(folder: string) {
    selectedDir = folder;
    scan();
  }

  async function browseScanFolder() {
    try {
      const picked = await api.pickFolder("Choose a folder to scan");
      if (picked && picked.trim()) {
        selectedDir = picked.trim();
        await scan();
      }
    } catch {
      // Ignore cancel
    }
  }

  async function scan() {
    if (!selectedDir.trim()) {
      selectedDir = "Downloads";
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
      const rep = await api.deleteDuplicates(selectedDir.trim(), selectedList, true);
      addLifetimeStats(rep.bytes_freed, rep.files_removed, ["duplicates"], "Recycle Bin");
      statusMessage = `Moved ${rep.files_removed} extra duplicate file(s) (${formatBytes(rep.bytes_freed)}) to the Recycle Bin.`;
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
      statusMessage = `Moved file (${formatBytes(freed)}) to the Recycle Bin.`;
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
    let destDir = "";
    try {
      const picked = await api.pickFolder("Choose a folder (or USB drive) to move this file into");
      if (!picked || !picked.trim()) return;
      destDir = picked.trim();
    } catch {
      return;
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

  function fileNameOf(path: string): string {
    return path.split(/[\\/]/).pop() || path;
  }
</script>

<div class="space-layout">
  <div class="header-row">
    <div>
      <h1 class="page-title">Space &amp; Cloud Cleaner</h1>
      <p class="muted small" style="margin: 4px 0 0 0;">
        Find duplicate files and large space-hogging videos on this PC or across your cloud folders.
      </p>
    </div>

    <div class="source-toggle" role="tablist">
      <button
        class="source-btn"
        class:active={sourceTab === "pc"}
        onclick={() => (sourceTab = "pc")}
        role="tab"
        aria-selected={sourceTab === "pc"}
      >
        This PC
      </button>
      <button
        class="source-btn"
        class:active={sourceTab === "cloud"}
        onclick={() => (sourceTab = "cloud")}
        role="tab"
        aria-selected={sourceTab === "cloud"}
      >
        Cloud Drives (OneDrive, Google, Dropbox, iCloud)
      </button>
    </div>
  </div>

  {#if sourceTab === "cloud"}
    <CloudClean {license} />
  {:else}
    <!-- Simple Folder Picker & Mode Card (No Raw Path Input!) -->
    <div class="card scan-bar-card">
      <div class="row" style="justify-content: space-between; flex-wrap: wrap; gap: 12px;">
        <div class="quick-folders-row">
          <span class="field-label">FOLDER TO CHECK:</span>
          {#each QUICK_FOLDERS as folder}
            <button
              type="button"
              class="folder-chip"
              class:active={selectedDir.trim().toLowerCase() === folder.toLowerCase()}
              onclick={() => pickQuickFolder(folder)}
            >
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
              <span>{folder}</span>
            </button>
          {/each}
          <button
            type="button"
            class="folder-chip"
            class:active={!QUICK_FOLDERS.some((f) => f.toLowerCase() === selectedDir.trim().toLowerCase())}
            onclick={browseScanFolder}
            disabled={loading || cleaning}
          >
            <span>+ Choose Another Folder…</span>
          </button>
        </div>

        <span class="badge free" title={selectedDir}>
          Folder: {shortenPath(selectedDir, 42)}
        </span>
      </div>

      <div class="divider"></div>

      <div class="row" style="justify-content: space-between; flex-wrap: wrap; gap: 12px;">
        <div class="subtab-toggle" role="tablist">
          <button
            class="subtab-btn"
            class:active={mode === "duplicates"}
            onclick={() => {
              mode = "duplicates";
              scan();
            }}
            role="tab"
            aria-selected={mode === "duplicates"}
          >
            Duplicate Files
          </button>
          <button
            class="subtab-btn"
            class:active={mode === "large"}
            onclick={() => {
              mode = "large";
              scan();
            }}
            role="tab"
            aria-selected={mode === "large"}
          >
            Largest Files
          </button>
        </div>

        <div class="row" style="gap: 10px;">
          {#if mode === "large"}
            <label class="row small" style="gap: 6px;">
              <span class="muted">Show files over:</span>
              <select bind:value={minSizeMb} onchange={scan} aria-label="Minimum file size" class="size-select">
                <option value={10}>10 MB</option>
                <option value={25}>25 MB</option>
                <option value={50}>50 MB</option>
                <option value={100}>100 MB</option>
                <option value={500}>500 MB</option>
              </select>
            </label>
          {/if}
          <button class="primary scan-btn" onclick={scan} disabled={loading || cleaning}>
            {loading
              ? "Scanning…"
              : mode === "duplicates"
                ? `Scan ${shortenPath(selectedDir, 24)} for Duplicates`
                : `Find Largest Files in ${shortenPath(selectedDir, 24)}`}
          </button>
        </div>
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
            ? `Looking for identical duplicate files in ${selectedDir}…`
            : `Looking for the largest files in ${selectedDir}…`}
        </p>
      </div>
    {:else if needsPro && !license?.active}
      <div class="card banner pro-banner">
        <span>Cleaning duplicate and large files requires SWEEPR Cleaner Pro.</span>
        <div class="spacer"></div>
        <button class="primary small-btn" onclick={requestActivation}>Upgrade to Pro</button>
      </div>
    {:else if error}
      <div class="card banner error-banner">
        {error}
      </div>
    {:else if mode === "duplicates"}
      {#if !scanned}
        <div class="card center-state">
          <strong>Ready to check {selectedDir} for duplicate files</strong>
          <p class="muted small" style="margin: 6px 0 14px 0;">
            Click the button below to find identical copies of photos, documents, and downloads. We always keep one copy safe.
          </p>
          <button class="primary scan-btn" onclick={scan}>Scan {selectedDir} Now</button>
        </div>
      {:else if groups.length === 0}
        <div class="card center-state">
          <strong>No duplicate files found in {selectedDir}</strong>
          <p class="muted small" style="margin-top: 4px;">Every file in this folder is unique! Try choosing another folder above.</p>
        </div>
      {:else}
        <div class="card toolbar-card">
          <div>
            <strong>Found {groups.length} sets of duplicate files</strong>
            <div class="muted small">We automatically keep the first copy safe and select the extra copies for you.</div>
          </div>
          <div class="spacer"></div>
          <button class="ghost small-btn" onclick={smartSelectExtras}>
            Select All Extra Copies
          </button>
          <button class="primary small-btn" disabled={!selectedList.length || cleaning} onclick={cleanSelected}>
            {cleaning ? "Moving to Recycle Bin…" : `Move ${selectedList.length} Extra Copy(s) to Recycle Bin (${formatBytes(selectedBytes)})`}
          </button>
        </div>

        <div class="grid">
          {#each groups as g (g.hash)}
            <div class="card item">
              <div class="row" style="margin-bottom: 6px;">
                <strong style="font-size: 14.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                  {fileNameOf(g.files[0])}
                </strong>
                <div class="spacer"></div>
                <span class="badge free">{g.files.length} copies</span>
              </div>
              <div class="cluster-size">
                {formatBytes(g.size)} <span class="muted small" style="font-weight: 500;">each</span>
              </div>
              <div class="files">
                {#each g.files as f, idx}
                  <label class="row file-path" class:kept={idx === 0} title={f}>
                    {#if idx === 0}
                      <span class="badge free" style="font-size: 10px; padding: 2px 6px;">✓ Original Kept Safe</span>
                    {:else}
                      <input type="checkbox" bind:checked={selectedFiles[f]} />
                    {/if}
                    <span class="muted small" style="flex: 1; overflow: hidden; text-overflow: ellipsis;">
                      {shortenPath(f, 52)}
                    </span>
                    {#if idx > 0 && selectedFiles[f]}
                      <span class="badge remove-badge">Remove</span>
                    {/if}
                  </label>
                {/each}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    {:else if mode === "large"}
      {#if !largeReport}
        <div class="card center-state">
          <strong>Ready to find the largest files in {selectedDir}</strong>
          <p class="muted small" style="margin: 6px 0 14px 0;">
            Quickly see which big videos, backups, or downloads are taking up the most space on your hard drive.
          </p>
          <button class="primary scan-btn" onclick={scan}>Find Largest Files Now</button>
        </div>
      {:else}
        <div class="card" style="padding: 20px 24px;">
          <div class="row" style="margin-bottom: 14px; flex-wrap: wrap; gap: 12px;">
            <div>
              <strong>Largest Files in {shortenPath(selectedDir, 40)} ({largeReport.top_files.length})</strong>
              <div class="muted small">
                Checked {formatCount(largeReport.total_scanned_files)} files ({formatBytes(largeReport.total_scanned_bytes)} total)
              </div>
            </div>
          </div>

          {#if largeReport.top_files.length === 0}
            <div class="muted small">No files larger than {minSizeMb} MB were found in this folder.</div>
          {:else}
            <div class="large-list">
              {#each largeReport.top_files as lf (lf.path)}
                <div class="row large-file-row">
                  <div style="flex: 1; min-width: 0;">
                    <strong style="font-size: 14px; display: block;">{lf.name}</strong>
                    <div
                      class="muted small"
                      style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
                      title={lf.path}
                    >
                      {shortenPath(lf.path, 76)}
                    </div>
                  </div>
                  <strong style="color: var(--accent); font-size: 15px;">{formatBytes(lf.size)}</strong>
                  <button
                    class="ghost small-btn"
                    disabled={movingFile === lf.path}
                    onclick={() => moveLargeFileToFolder(lf.path)}
                  >
                    {movingFile === lf.path ? "Moving…" : "Move to Folder…"}
                  </button>
                  <button class="ghost small-btn" onclick={() => trashLargeFile(lf.path)}>
                    Move to Recycle Bin
                  </button>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    {/if}
  {/if}
</div>

<style>
  .space-layout {
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
  .source-toggle,
  .subtab-toggle {
    display: flex;
    background: var(--panel-2);
    padding: 4px;
    border-radius: 9999px;
    border: 1px solid var(--border);
  }
  .source-btn,
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
  .source-btn.active,
  .subtab-btn.active {
    background: var(--panel-solid);
    color: var(--accent);
    box-shadow: 0 2px 6px rgba(15, 23, 42, 0.08);
  }
  .scan-bar-card {
    padding: 18px 22px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .divider {
    height: 1px;
    background: var(--border);
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
    padding: 6px 14px;
    border-radius: 9999px;
    font-size: 12.5px;
    font-weight: 600;
    background: var(--panel-2);
    border: 1px solid var(--border);
    color: var(--text-secondary);
    box-shadow: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
  }
  .folder-chip.active {
    background: var(--accent-light);
    color: var(--accent);
    border-color: rgba(16, 185, 129, 0.4);
  }
  .size-select {
    padding: 7px 12px;
    border-radius: 9999px;
    border: 1px solid var(--border);
    background: var(--panel-solid);
    color: var(--text);
    font-size: 12.5px;
  }
  .scan-btn {
    padding: 10px 22px;
    border-radius: 9999px;
    font-weight: 700;
  }
  .toolbar-card {
    padding: 16px 22px;
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .banner {
    padding: 12px 18px;
    font-size: 13.5px;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .success-banner {
    border-left: 4px solid var(--accent);
    background: var(--accent-light);
    font-weight: 600;
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
    max-width: 520px;
    margin: 26px auto;
    padding: 34px;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 16px;
  }
  .item {
    padding: 18px;
    display: flex;
    flex-direction: column;
  }
  .cluster-size {
    font-size: 22px;
    font-weight: 800;
    color: var(--accent);
    margin: 2px 0 10px 0;
  }
  .large-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: 400px;
    overflow-y: auto;
  }
  .large-file-row {
    padding: 12px 16px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: var(--panel-2);
    gap: 12px;
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
  .file-path.kept {
    background: rgba(16, 185, 129, 0.08);
    border-radius: 8px;
    padding-left: 6px;
    padding-right: 6px;
  }
  .remove-badge {
    font-size: 10px;
    padding: 2px 6px;
    background: rgba(244, 63, 94, 0.12);
    color: #e11d48;
    border: 1px solid rgba(244, 63, 94, 0.3);
  }
  .small-btn {
    padding: 7px 15px;
    font-size: 12.5px;
    border-radius: 9999px;
  }
</style>
