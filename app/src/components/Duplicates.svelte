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
    type AppInfo,
    type LicenseStatus,
  } from "../lib/api";
  import { formatBytes, formatCount, shortenPath } from "../lib/format";
  import { addLifetimeStats } from "../lib/store";
  import { lang, t } from "../lib/i18n";

  let { license, info = null }: { license: LicenseStatus | null; info?: AppInfo | null } = $props();
  const osType = $derived(
    info?.platform?.toLowerCase() ||
      (typeof navigator !== "undefined" && /Mac/i.test(navigator.platform)
        ? "macos"
        : typeof navigator !== "undefined" && /Linux/i.test(navigator.platform)
          ? "linux"
          : "windows")
  );
  const trashLabel = $derived(osType === "windows" ? "Recycle Bin" : "Trash");
  const deviceLabel = $derived(osType === "macos" ? "Mac" : osType === "linux" ? "System" : "PC");
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
  let dragOver = $state(false);
  let lastClickedFile = $state<string | null>(null);

  const flatExtraFiles = $derived(groups.flatMap((g) => g.files.slice(1)));

  function handleDuplicateCheckClick(file: string, e: MouseEvent) {
    const nextState = !selectedFiles[file];
    if (e.shiftKey && lastClickedFile) {
      const i1 = flatExtraFiles.indexOf(lastClickedFile);
      const i2 = flatExtraFiles.indexOf(file);
      if (i1 !== -1 && i2 !== -1) {
        const [start, end] = i1 < i2 ? [i1, i2] : [i2, i1];
        const next = { ...selectedFiles };
        for (let i = start; i <= end; i++) {
          next[flatExtraFiles[i]] = nextState;
        }
        selectedFiles = next;
        lastClickedFile = file;
        return;
      }
    }
    selectedFiles = { ...selectedFiles, [file]: nextState };
    lastClickedFile = file;
  }

  function onDropFolder(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    const f = e.dataTransfer?.files?.[0] as (File & { path?: string }) | undefined;
    if (f?.path) {
      selectedDir = f.path;
      scan();
      return;
    }
    const text = e.dataTransfer?.getData("text/plain");
    if (text) {
      selectedDir = text.trim().replace(/^"+|"+$/g, "");
      scan();
    }
  }

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
        const COPY_RE = /\(\d+\)| - copy|_copy/i;
        const raw = await api.findDuplicates(selectedDir.trim());
        groups = raw.map((g) => ({
          ...g,
          files: [...g.files].sort((a, b) => {
            const aCopy = COPY_RE.test(a) ? 1 : 0;
            const bCopy = COPY_RE.test(b) ? 1 : 0;
            if (aCopy !== bCopy) return aCopy - bCopy;
            return a.length - b.length;
          }),
        }));
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

<div
  class="space-layout"
  ondragover={(e) => {
    e.preventDefault();
    dragOver = true;
  }}
  ondragleave={() => (dragOver = false)}
  ondrop={onDropFolder}
  role="region"
  aria-label="Space and Cloud Cleaner"
>
  <div class="header-row">
    <h1 class="page-title">{t("nav.space", $lang)}</h1>

    <div class="source-toggle" role="tablist">
      <button
        class="source-btn"
        class:active={sourceTab === "pc"}
        onclick={() => (sourceTab = "pc")}
        role="tab"
        aria-selected={sourceTab === "pc"}
      >
        This {deviceLabel}
      </button>
      <button
        class="source-btn"
        class:active={sourceTab === "cloud"}
        onclick={() => (sourceTab = "cloud")}
        role="tab"
        aria-selected={sourceTab === "cloud"}
      >
        Cloud
      </button>
    </div>
  </div>

  {#if sourceTab === "cloud"}
    <CloudClean {license} />
  {:else}
    <!-- Simple Folder Picker & Mode Card (Supports Drag & Drop!) -->
    <div class="card scan-bar-card" style={dragOver ? "border-color: var(--accent); background: var(--accent-light);" : ""}>
      <div class="row" style="justify-content: space-between; flex-wrap: wrap; gap: 12px;">
        <div class="quick-folders-row">
          {#each QUICK_FOLDERS as folder}
            <button
              type="button"
              class="folder-chip"
              class:active={selectedDir.trim().toLowerCase() === folder.toLowerCase()}
              onclick={() => pickQuickFolder(folder)}
            >
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
            <span>+ Folder</span>
          </button>
        </div>

        <span class="badge free" title={selectedDir}>
          {shortenPath(selectedDir, 36)}
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
            Duplicates
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
            Large Files
          </button>
        </div>

        <div class="row" style="gap: 10px;">
          {#if mode === "large"}
            <label class="row small" style="gap: 6px;">
              <select bind:value={minSizeMb} onchange={scan} aria-label="Minimum file size" class="size-select">
                <option value={10}>&gt; 10 MB</option>
                <option value={25}>&gt; 25 MB</option>
                <option value={50}>&gt; 50 MB</option>
                <option value={100}>&gt; 100 MB</option>
                <option value={500}>&gt; 500 MB</option>
              </select>
            </label>
          {/if}
          <button class="primary scan-btn" onclick={scan} disabled={loading || cleaning}>
            {loading ? "Scanning…" : "Scan"}
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
          <strong>{selectedDir}</strong>
          <button class="primary scan-btn" style="margin-top: 12px;" onclick={scan}>Scan</button>
        </div>
      {:else if groups.length === 0}
        <div class="card center-state">
          <strong>No duplicates in {selectedDir}</strong>
        </div>
      {:else}
        <div class="card toolbar-card">
          <strong>{groups.length} duplicate sets</strong>
          <div class="spacer"></div>
          <button class="ghost small-btn" onclick={smartSelectExtras}>
            Select Extras
          </button>
          <button class="primary small-btn" disabled={!selectedList.length || cleaning} onclick={cleanSelected}>
            {cleaning ? "Cleaning…" : `Clean (${formatBytes(selectedBytes)})`}
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
                <span class="badge free">{g.files.length}×</span>
              </div>
              <div class="cluster-size">
                {formatBytes(g.size)}
              </div>
              <div class="files">
                {#each g.files as f, idx}
                  <label class="row file-path" class:kept={idx === 0} title={f}>
                    {#if idx === 0}
                      <span class="badge free" style="font-size: 10px; padding: 2px 6px;">Kept</span>
                    {:else}
                      <input
                        type="checkbox"
                        checked={!!selectedFiles[f]}
                        onclick={(e) => {
                          handleDuplicateCheckClick(f, e);
                          (e.currentTarget as HTMLInputElement).checked = !!selectedFiles[f];
                        }}
                      />
                    {/if}
                    <span class="muted small path" style="flex: 1; overflow: hidden; text-overflow: ellipsis;">
                      {shortenPath(f, 52)}
                    </span>
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
          <strong>{selectedDir}</strong>
          <button class="primary scan-btn" style="margin-top: 12px;" onclick={scan}>Scan</button>
        </div>
      {:else}
        <div class="card" style="padding: 20px 24px;">
          <div class="row" style="margin-bottom: 14px; flex-wrap: wrap; gap: 12px;">
            <strong>Largest Files ({largeReport.top_files.length})</strong>
          </div>

          {#if largeReport.top_files.length === 0}
            <div class="muted small">None over {minSizeMb} MB.</div>
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
                    onclick={() => void api.revealInFolder(lf.path)}
                    title="Show in Folder"
                  >
                    Reveal
                  </button>
                  <button
                    class="ghost small-btn"
                    disabled={movingFile === lf.path}
                    onclick={() => moveLargeFileToFolder(lf.path)}
                  >
                    {movingFile === lf.path ? "…" : "Move"}
                  </button>
                  <button class="ghost small-btn" onclick={() => trashLargeFile(lf.path)}>
                    Trash
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
