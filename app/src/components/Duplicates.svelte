<script lang="ts" module>
  import type {
    DuplicateGroup,
    LargeFilesReport,
    StaleDevArtifactsReport,
  } from "../lib/api";

  let cachedSourceTab: "pc" | "cloud" = "pc";
  let cachedMode: "duplicates" | "large" | "stale_dev" = "duplicates";
  let cachedGroups: DuplicateGroup[] = [];
  let cachedSelectedFiles: Record<string, boolean> = {};
  let cachedLargeReport: LargeFilesReport | null = null;
  let cachedStaleReport: StaleDevArtifactsReport | null = null;
  let cachedStaleMinDays = 30;
  let cachedStaleRoots: string[] = [];
  let cachedScanned = false;
  let cachedSelectedDir = "Downloads";
</script>

<script lang="ts">
  import CloudClean from "./CloudClean.svelte";
  import DiskSpaceMap from "./DiskSpaceMap.svelte";
  import PreCleanConfirmDrawer, {
    type ConfirmCleanCategoryItem,
  } from "./PreCleanConfirmDrawer.svelte";
  import {
    api,
    errorMessage,
    isPaymentRequired,
    requestActivation,
    type AppInfo,
    type LicenseStatus,
    type MacosApfsSpaceInfo,
  } from "../lib/api";
  import { formatBytes, formatCount, shortenPath } from "../lib/format";
  import { addLifetimeStats } from "../lib/store";
  import { lang, t } from "../lib/i18n";

  let {
    license,
    info = null,
    initialScanDir = null,
    onInitialScanConsumed,
  }: {
    license: LicenseStatus | null;
    info?: AppInfo | null;
    initialScanDir?: string | null;
    onInitialScanConsumed?: () => void;
  } = $props();
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
  let mode = $state<"duplicates" | "large" | "stale_dev">(cachedMode);
  let groups = $state<DuplicateGroup[]>(cachedGroups);
  let selectedFiles = $state<Record<string, boolean>>(cachedSelectedFiles);
  let largeReport = $state<LargeFilesReport | null>(cachedLargeReport);
  let staleReport = $state<StaleDevArtifactsReport | null>(cachedStaleReport);
  let staleMinDays = $state(cachedStaleMinDays);
  let staleCustomRoots = $state<string[]>(cachedStaleRoots);
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
  let showDupConfirm = $state(false);
  let pendingLargeFileTrash = $state<{ path: string; name: string; size: number } | null>(null);
  let explorerMenuEnabled = $state(false);
  let explorerMenuBusy = $state(false);
  let apfsInfo = $state<MacosApfsSpaceInfo | null>(null);
  let scanSeq = 0;

  function isAbsoluteFolderPath(p: string): boolean {
    if (!p || /[\r\n]/.test(p) || p.split(/[\\/]/).some((seg) => seg === "..")) return false;
    if (osType === "windows") {
      return /^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/.test(p);
    }
    return /^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+|\/)/.test(p);
  }

  function switchMode(nextMode: "duplicates" | "large" | "stale_dev") {
    if (loading || cleaning) return;
    mode = nextMode;
    error = "";
    statusMessage = "";
    needsPro = false;
    void scan();
  }

  function revealPath(path: string) {
    void api.revealInFolder(path).catch((e) => {
      error = errorMessage(e);
    });
  }

  $effect(() => {
    if (osType === "windows") {
      api
        .getExplorerContextMenuEnabled()
        .then((v) => (explorerMenuEnabled = v))
        .catch(() => {});
    } else if (osType === "macos") {
      api
        .macosApfsSpaceInfo()
        .then((res) => (apfsInfo = res))
        .catch(() => {});
    }
  });

  $effect(() => {
    if (initialScanDir && initialScanDir.trim()) {
      sourceTab = "pc";
      mode = "large";
      selectedDir = initialScanDir.trim();
      onInitialScanConsumed?.();
      void scan();
    }
  });

  async function toggleExplorerContextMenu(nextEnabled: boolean) {
    explorerMenuBusy = true;
    error = "";
    try {
      explorerMenuEnabled = await api.setExplorerContextMenuEnabled(nextEnabled);
      statusMessage = explorerMenuEnabled
        ? 'Added "Scan with SWEEPR" to Windows File Explorer folder right-click menu.'
        : 'Removed "Scan with SWEEPR" from Windows File Explorer folder right-click menu.';
    } catch (e) {
      error = errorMessage(e);
    } finally {
      explorerMenuBusy = false;
    }
  }

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
    if (loading || cleaning) return;
    const item = e.dataTransfer?.items?.[0];
    const entry = item?.webkitGetAsEntry?.();
    const f = e.dataTransfer?.files?.[0] as (File & { path?: string }) | undefined;
    if (entry ? !entry.isDirectory : Boolean(f && (f.type !== "" || f.size > 0))) {
      error =
        mode === "stale_dev"
          ? "Please drop a folder, not a file, to scan for stale dev artifacts."
          : "Please drop a folder, not a file, to scan.";
      return;
    }
    const filePath = f?.path?.trim();
    const textPath =
      !filePath && Boolean(f || entry?.isDirectory)
        ? e.dataTransfer?.getData("text/plain")?.trim().replace(/^"+|"+$/g, "")
        : "";
    const p = filePath || textPath;
    if (!p) {
      if (e.dataTransfer?.getData("text/plain")?.trim()) {
        error =
          mode === "stale_dev"
            ? "Please drop a folder, not text or a file, to scan for stale dev artifacts."
            : "Please drop a folder, not text or a file, to scan.";
      }
      return;
    }
    if (!isAbsoluteFolderPath(p)) {
      error =
        mode === "stale_dev"
          ? "Please drop an absolute folder path to scan for stale dev artifacts."
          : "Please drop an absolute folder path to scan.";
      return;
    }
    if (mode === "stale_dev") {
      void scanWithTarget({ staleCustomRoots: [p] });
    } else {
      void scanWithTarget({ selectedDir: p });
    }
  }

  $effect(() => {
    cachedSourceTab = sourceTab;
    cachedMode = mode;
    cachedGroups = groups;
    cachedSelectedFiles = selectedFiles;
    cachedLargeReport = largeReport;
    cachedStaleReport = staleReport;
    cachedStaleMinDays = staleMinDays;
    cachedStaleRoots = staleCustomRoots;
    cachedScanned = scanned;
    cachedSelectedDir = selectedDir;
  });

  const QUICK_FOLDERS = ["Downloads", "Documents", "Pictures", "Desktop", "Videos"];

  const selectedList = $derived(Object.keys(selectedFiles).filter((k) => selectedFiles[k]));
  const selectedBytes = $derived(
    groups.reduce((sum, g) => {
      if (g.photo_details && g.photo_details.length > 0) {
        return (
          sum +
          g.photo_details
            .filter((pd) => selectedFiles[pd.path])
            .reduce((acc, pd) => acc + pd.size, 0)
        );
      }
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
      const picked = await api.pickFolder(
        mode === "stale_dev" ? "Choose a developer workspace folder to scan" : "Choose a folder to scan"
      );
      if (picked && picked.trim()) {
        const trimmed = picked.trim();
        await scanWithTarget(
          mode === "stale_dev" ? { staleCustomRoots: [trimmed] } : { selectedDir: trimmed }
        );
      }
    } catch {
      // Ignore cancel
    }
  }

  async function scan() {
    return scanWithTarget();
  }

  async function scanWithTarget(override?: {
    selectedDir?: string;
    staleCustomRoots?: string[];
  }) {
    const activeMode = mode;
    if (activeMode !== "stale_dev" && override?.selectedDir === undefined && !selectedDir.trim()) {
      selectedDir = "Downloads";
    }
    const seq = ++scanSeq;
    const targetDir = (override?.selectedDir ?? selectedDir).trim();
    const targetRoots = override?.staleCustomRoots ?? [...staleCustomRoots];
    const targetMinDays = staleMinDays;
    const targetMinSizeMb = minSizeMb;

    loading = true;
    error = "";
    statusMessage = "";
    needsPro = false;
    try {
      if (activeMode === "duplicates") {
        const COPY_RE = /\(\d+\)| - copy|_copy/i;
        const raw = await api.findDuplicates(targetDir);
        if (seq !== scanSeq) return;
        if (override?.selectedDir !== undefined) {
          selectedDir = override.selectedDir;
        }
        groups = raw.map((g) => {
          if (g.kind === "similar_photo") {
            return g;
          }
          return {
            ...g,
            files: [...g.files].sort((a, b) => {
              const aCopy = COPY_RE.test(a) ? 1 : 0;
              const bCopy = COPY_RE.test(b) ? 1 : 0;
              if (aCopy !== bCopy) return aCopy - bCopy;
              return a.length - b.length;
            }),
          };
        });
        smartSelectExtras();
        scanned = true;
      } else if (activeMode === "large") {
        const rep = await api.scanLargeFiles(targetDir, targetMinSizeMb * 1024 * 1024);
        if (seq !== scanSeq) return;
        if (override?.selectedDir !== undefined) {
          selectedDir = override.selectedDir;
        }
        largeReport = rep;
      } else {
        const rep = await api.scanStaleDevArtifacts(targetRoots, targetMinDays);
        if (seq !== scanSeq) return;
        if (override?.staleCustomRoots !== undefined) {
          staleCustomRoots = override.staleCustomRoots;
        }
        staleReport = rep;
      }
    } catch (e) {
      if (seq !== scanSeq) return;
      if (isPaymentRequired(e)) {
        needsPro = true;
        requestActivation();
      } else {
        error = errorMessage(e);
      }
    } finally {
      if (seq === scanSeq) {
        loading = false;
      }
    }
  }

  const dupConfirmCategories = $derived.by<ConfirmCleanCategoryItem[]>(() => {
    if (pendingLargeFileTrash) {
      return [
        {
          id: "large_file",
          name: pendingLargeFileTrash.name,
          bytes: pendingLargeFileTrash.size,
          files: 1,
          note: shortenPath(pendingLargeFileTrash.path, 52),
        },
      ];
    }
    let exactFiles = 0;
    let exactBytes = 0;
    let similarFiles = 0;
    let similarBytes = 0;
    for (const g of groups) {
      if (g.kind === "similar_photo") {
        if (g.photo_details && g.photo_details.length > 0) {
          for (const pd of g.photo_details) {
            if (selectedFiles[pd.path]) {
              similarFiles += 1;
              similarBytes += pd.size;
            }
          }
        } else {
          const c = g.files.filter((f) => selectedFiles[f]).length;
          similarFiles += c;
          similarBytes += c * g.size;
        }
      } else {
        const c = g.files.filter((f) => selectedFiles[f]).length;
        exactFiles += c;
        exactBytes += c * g.size;
      }
    }
    const items: ConfirmCleanCategoryItem[] = [];
    if (exactFiles > 0) {
      items.push({
        id: "exact_duplicates",
        name: "Exact Duplicate Copies",
        bytes: exactBytes,
        files: exactFiles,
        note: `1 original kept safe per set · ${shortenPath(selectedDir, 32)}`,
      });
    }
    if (similarFiles > 0) {
      items.push({
        id: "similar_photos",
        name: "Similar Burst Photo Copies",
        bytes: similarBytes,
        files: similarFiles,
        note: "Sharpest best shot kept protected per burst",
      });
    }
    return items;
  });

  const dupConfirmTotalBytes = $derived(
    pendingLargeFileTrash ? pendingLargeFileTrash.size : selectedBytes
  );
  const dupConfirmTotalFiles = $derived(
    pendingLargeFileTrash ? 1 : selectedList.length
  );

  function requestCleanSelected() {
    if (!selectedList.length) return;
    pendingLargeFileTrash = null;
    showDupConfirm = true;
  }

  function requestTrashLargeFile(lf: { path: string; name: string; size: number }) {
    pendingLargeFileTrash = lf;
    showDupConfirm = true;
  }

  function confirmDupDrawerAction() {
    const lf = pendingLargeFileTrash;
    showDupConfirm = false;
    pendingLargeFileTrash = null;
    if (lf) {
      void trashLargeFile(lf.path);
    } else {
      void cleanSelected();
    }
  }

  async function cleanSelected() {
    if (!selectedList.length) return;
    cleaning = true;
    error = "";
    statusMessage = "";
    try {
      const rep = await api.deleteDuplicates(selectedDir.trim(), selectedList, true);
      addLifetimeStats(rep.bytes_freed, rep.files_removed, ["duplicates"], trashLabel);
      statusMessage = `Moved ${rep.files_removed} extra duplicate file(s) (${formatBytes(rep.bytes_freed)}) to the ${trashLabel}.`;
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
      addLifetimeStats(freed, 1, ["large_files"], trashLabel);
      statusMessage = `Moved file (${formatBytes(freed)}) to the ${trashLabel}.`;
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
          {#if mode === "stale_dev"}
            <button
              type="button"
              class="folder-chip"
              class:active={staleCustomRoots.length === 0}
              onclick={() => {
                staleCustomRoots = [];
                void scan();
              }}
              disabled={loading || cleaning}
            >
              <span>Auto Dev Roots</span>
            </button>
            <button
              type="button"
              class="folder-chip"
              class:active={staleCustomRoots.length > 0}
              onclick={browseScanFolder}
              disabled={loading || cleaning}
            >
              <span>+ Folder</span>
            </button>
          {:else}
            {#each QUICK_FOLDERS as folder}
              <button
                type="button"
                class="folder-chip"
                class:active={selectedDir.trim().toLowerCase() === folder.toLowerCase()}
                onclick={() => pickQuickFolder(folder)}
                disabled={loading || cleaning}
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
          {/if}
        </div>

        <span
          class="badge free"
          title={mode === "stale_dev" ? (staleCustomRoots[0] || "Default developer workspace folders") : selectedDir}
        >
          {mode === "stale_dev"
            ? (staleCustomRoots.length > 0 ? shortenPath(staleCustomRoots[0], 36) : "Auto Dev Roots")
            : shortenPath(selectedDir, 36)}
        </span>
      </div>

      <div class="divider"></div>

      <div class="row" style="justify-content: space-between; flex-wrap: wrap; gap: 12px;">
        <div class="subtab-toggle" role="tablist">
          <button
            class="subtab-btn"
            class:active={mode === "duplicates"}
            onclick={() => switchMode("duplicates")}
            disabled={loading || cleaning}
            role="tab"
            aria-selected={mode === "duplicates"}
          >
            Duplicates
          </button>
          <button
            class="subtab-btn"
            class:active={mode === "large"}
            onclick={() => switchMode("large")}
            disabled={loading || cleaning}
            role="tab"
            aria-selected={mode === "large"}
          >
            Large Files
          </button>
          <button
            class="subtab-btn"
            class:active={mode === "stale_dev"}
            onclick={() => switchMode("stale_dev")}
            disabled={loading || cleaning}
            role="tab"
            aria-selected={mode === "stale_dev"}
          >
            Stale Dev &amp; Docker
          </button>
        </div>

        <div class="row" style="gap: 10px;">
          {#if mode === "large"}
            <label class="row small" style="gap: 6px;">
              <select
                bind:value={minSizeMb}
                onchange={scan}
                disabled={loading || cleaning}
                aria-label="Minimum file size"
                class="size-select"
              >
                <option value={10}>&gt; 10 MB</option>
                <option value={25}>&gt; 25 MB</option>
                <option value={50}>&gt; 50 MB</option>
                <option value={100}>&gt; 100 MB</option>
                <option value={500}>&gt; 500 MB</option>
              </select>
            </label>
          {:else if mode === "stale_dev"}
            <label class="row small" style="gap: 6px;">
              <select
                bind:value={staleMinDays}
                onchange={scan}
                disabled={loading || cleaning}
                aria-label="Minimum project inactivity days"
                class="size-select"
              >
                <option value={14}>Inactive 14+ days</option>
                <option value={30}>Inactive 30+ days</option>
                <option value={60}>Inactive 60+ days</option>
                <option value={90}>Inactive 90+ days</option>
              </select>
            </label>
          {/if}
          <button class="primary scan-btn" onclick={scan} disabled={loading || cleaning}>
            {loading ? "Scanning…" : "Scan"}
          </button>
        </div>
      </div>

      {#if osType === "windows"}
        <div class="divider"></div>
        <label class="row small" style="justify-content: space-between; gap: 10px; cursor: pointer;">
          <span class="muted">
            <strong>Explorer Right-Click: Scan with SWEEPR</strong>
            <span> — Adds a per-user folder context menu entry launching SWEEPR straight into Disk Space Map.</span>
          </span>
          <input
            type="checkbox"
            checked={explorerMenuEnabled}
            disabled={explorerMenuBusy}
            onchange={(e) => toggleExplorerContextMenu((e.currentTarget as HTMLInputElement).checked)}
          />
        </label>
      {/if}
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
            : mode === "large"
              ? `Looking for the largest files in ${selectedDir}…`
              : "Scanning stale build artifacts and Docker virtual disks…"}
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
          <button class="primary small-btn" disabled={!selectedList.length || cleaning} onclick={requestCleanSelected}>
            {cleaning ? "Cleaning…" : `Clean (${formatBytes(selectedBytes)})`}
          </button>
        </div>

        <div class="grid">
          {#each groups as g, i (g.hash)}
            <div class="card item" style={`--stagger-i: ${Math.min(i, 7)};`}>
              <div class="row" style="margin-bottom: 6px; gap: 6px;">
                <strong style="font-size: 14.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                  {fileNameOf(g.files[0])}
                </strong>
                <div class="spacer"></div>
                {#if g.kind === "similar_photo"}
                  <span class="badge free" style="background: rgba(16, 185, 129, 0.14); color: var(--accent);">
                    Best-Shot Burst
                  </span>
                {/if}
                <span class="badge free">{g.files.length}×</span>
              </div>
              <div class="cluster-size">
                {formatBytes(g.size)}
              </div>
              <div class="files">
                {#each g.files as f, idx}
                  {@const pd = g.photo_details?.find((p) => p.path === f)}
                  <label class="row file-path" class:kept={idx === 0} title={f}>
                    {#if idx === 0}
                      <span class="badge free" style="font-size: 10px; padding: 2px 6px;">
                        {g.kind === "similar_photo" ? "Best Shot (Keep — Protected)" : "Kept"}
                      </span>
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
                      {shortenPath(f, 44)}
                      {#if pd}
                        <span style="display: block; font-size: 10.5px; opacity: 0.85;">
                          {pd.width}×{pd.height} · Sharpness {pd.sharpness.toFixed(1)}
                          {#if !pd.is_best_shot}
                            · {pd.badge} (Δ{pd.hamming_distance})
                          {/if}
                        </span>
                      {/if}
                    </span>
                  </label>
                {/each}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    {:else if mode === "large"}
      {#if osType === "macos" && apfsInfo?.supported}
        <div class="card" style="padding: 16px 20px;">
          <div class="row" style="justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap;">
            <div>
              <strong style="font-size: 14.5px;">APFS Purgeable Space &amp; Local Snapshots</strong>
              <div class="muted small" style="margin-top: 2px;">{apfsInfo.note}</div>
            </div>
            <div class="row" style="gap: 8px;">
              <span class="badge free">Purgeable: {formatBytes(apfsInfo.purgeable_bytes)}</span>
              <span class="badge free">
                Local Snapshots: {apfsInfo.snapshot_count}
              </span>
            </div>
          </div>
        </div>
      {/if}

      {#if !largeReport}
        <div class="card center-state">
          <strong>{selectedDir}</strong>
          <button class="primary scan-btn" style="margin-top: 12px;" onclick={scan}>Scan</button>
        </div>
      {:else}
        <DiskSpaceMap
          report={largeReport}
          onDrillScan={(p) => {
            selectedDir = p;
            void scan();
          }}
        />

        <div class="card" style="padding: 20px 24px;">
          <div class="row" style="margin-bottom: 14px; flex-wrap: wrap; gap: 12px;">
            <strong>Largest Files ({largeReport.top_files.length})</strong>
            <div class="spacer"></div>
            <span class="muted small">
              Total scanned: {formatBytes(largeReport.total_scanned_bytes)} across {formatCount(largeReport.total_scanned_files)} files
            </span>
          </div>

          {#if largeReport.top_files.length === 0}
            <div class="muted small">None over {minSizeMb} MB.</div>
          {:else}
            <div class="large-list">
              {#each largeReport.top_files as lf, i (lf.path)}
                <div class="row large-file-row" style={`--stagger-i: ${Math.min(i, 7)};`}>
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
                    onclick={() => revealPath(lf.path)}
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
                  <button class="ghost small-btn" onclick={() => requestTrashLargeFile(lf)}>
                    Trash
                  </button>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    {:else if mode === "stale_dev"}
      {#if !staleReport}
        <div class="card center-state">
          <strong>{staleCustomRoots.length > 0 ? staleCustomRoots[0] : "Auto Dev Roots & Docker"}</strong>
          <p class="muted small" style="margin-top: 6px;">
            Inspect inactive project caches (node_modules, target, .next, .gradle, .venv) and Docker virtual disks.
          </p>
          <button class="primary scan-btn" style="margin-top: 12px;" onclick={scan}>Scan</button>
        </div>
      {:else}
        <div class="card toolbar-card">
          <strong>
            {staleReport.artifacts.length} stale dev artifact folder{staleReport.artifacts.length === 1 ? "" : "s"}
          </strong>
          <span class="muted small">
            · {formatCount(staleReport.total_artifact_files)} files · {staleReport.duration_ms} ms
          </span>
          <div class="spacer"></div>
          <strong style="color: var(--accent);">{formatBytes(staleReport.total_artifact_bytes)}</strong>
        </div>

        <div class="card" style="padding: 18px 22px;">
          <div class="row" style="margin-bottom: 10px; flex-wrap: wrap; gap: 10px;">
            <strong>Docker Virtual Disks &amp; BuildKit Cache</strong>
            <div class="spacer"></div>
            <span class="badge free">
              Disks: {formatBytes(staleReport.docker.total_vhdx_bytes)}
            </span>
            <span class="badge free">
              BuildKit: {formatBytes(staleReport.docker.buildkit_reclaimable_bytes)}
            </span>
          </div>
          {#if staleReport.docker.vhdx_files.length === 0 && staleReport.docker.buildkit_reclaimable_bytes === 0}
            <div class="muted small">
              No Docker Desktop virtual disks (.vhdx / Docker.raw) or BuildKit caches detected on this device.
            </div>
          {:else}
            {#if staleReport.docker.vhdx_files.length > 0}
              <div class="large-list">
                {#each staleReport.docker.vhdx_files as vhdx, i (vhdx.path)}
                  <div class="row large-file-row" style={`--stagger-i: ${Math.min(i, 7)};`}>
                    <div style="flex: 1; min-width: 0;">
                      <strong style="font-size: 14px; display: block;">{fileNameOf(vhdx.path)}</strong>
                      <div
                        class="muted small path"
                        style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
                        title={vhdx.path}
                      >
                        {shortenPath(vhdx.path, 68)}
                      </div>
                    </div>
                    <strong style="color: var(--accent); font-size: 15px;">{formatBytes(vhdx.size)}</strong>
                    <button
                      class="ghost small-btn"
                      onclick={() => revealPath(vhdx.path)}
                      title="Show Docker disk in folder"
                    >
                      Reveal
                    </button>
                  </div>
                {/each}
              </div>
            {/if}
            {#if staleReport.docker.buildkit_reclaimable_bytes > 0}
              <div class="muted small" style="margin-top: 10px;">
                BuildKit / Buildx cache detected ({formatBytes(staleReport.docker.buildkit_reclaimable_bytes)}). Run
                <code>docker builder prune</code> to compact safely.
              </div>
            {/if}
          {/if}
        </div>

        <div class="card" style="padding: 20px 24px;">
          <div class="row" style="margin-bottom: 14px; flex-wrap: wrap; gap: 12px;">
            <strong>Stale Build &amp; Dependency Folders ({staleReport.artifacts.length})</strong>
            <div class="spacer"></div>
            <span class="muted small">Threshold: {staleMinDays}+ days inactive</span>
          </div>

          {#if staleReport.artifacts.length === 0}
            <div class="muted small">
              No stale dev artifacts inactive for {staleMinDays}+ days in the selected roots.
            </div>
          {:else}
            <div class="large-list" style="max-height: 460px;">
              {#each staleReport.artifacts as entry, i (entry.artifact_path)}
                <div class="row large-file-row" style={`--stagger-i: ${Math.min(i, 7)};`}>
                  <span class="badge pro">{entry.artifact_kind}</span>
                  <div style="flex: 1; min-width: 0;">
                    <strong style="font-size: 14px; display: block;">{fileNameOf(entry.project_root)}</strong>
                    <div
                      class="muted small path"
                      style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
                      title={entry.artifact_path}
                    >
                      {shortenPath(entry.project_root, 56)} · {entry.inactive_days}d inactive · {formatCount(entry.files_count)} files
                    </div>
                  </div>
                  <strong style="color: var(--accent); font-size: 15px;">{formatBytes(entry.size_bytes)}</strong>
                  <button
                    class="ghost small-btn"
                    onclick={() => revealPath(entry.artifact_path)}
                    title="Show artifact folder in Explorer"
                  >
                    Reveal
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

<PreCleanConfirmDrawer
  open={showDupConfirm}
  title={pendingLargeFileTrash
    ? `Move "${pendingLargeFileTrash.name}" to ${trashLabel}?`
    : `Confirm Duplicate Cleanup — ${formatBytes(dupConfirmTotalBytes)}`}
  rollback="recycle_bin"
  rollbackDetail={`Extra copies are moved to your ${trashLabel} so you can restore anything anytime.`}
  categories={dupConfirmCategories}
  totalBytes={dupConfirmTotalBytes}
  totalFiles={dupConfirmTotalFiles}
  confirmLabel={pendingLargeFileTrash
    ? `Move to ${trashLabel}`
    : `Clean ${formatBytes(dupConfirmTotalBytes)}`}
  busy={cleaning}
  onConfirm={confirmDupDrawerAction}
  onCancel={() => {
    showDupConfirm = false;
    pendingLargeFileTrash = null;
  }}
/>

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
    transition:
      transform 140ms var(--ease-out),
      opacity 140ms var(--ease-out),
      background-color 140ms var(--ease-out),
      color 140ms var(--ease-out),
      box-shadow 140ms var(--ease-out);
  }
  .source-btn:active:not(:disabled),
  .subtab-btn:active:not(:disabled) {
    transform: scale(0.97);
    transition-duration: 80ms;
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
    transition:
      transform 140ms var(--ease-out),
      opacity 140ms var(--ease-out),
      background-color 140ms var(--ease-out),
      border-color 140ms var(--ease-out),
      color 140ms var(--ease-out);
  }
  .folder-chip:active:not(:disabled) {
    transform: scale(0.97);
    transition-duration: 80ms;
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
    transition:
      transform 140ms var(--ease-out),
      opacity 140ms var(--ease-out),
      background-color 140ms var(--ease-out),
      box-shadow 140ms var(--ease-out);
  }
  .scan-btn:active:not(:disabled) {
    transform: scale(0.97);
    transition-duration: 80ms;
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
  @keyframes dup-stagger-enter {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
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
    animation: dup-stagger-enter 200ms var(--ease-out) both;
    animation-delay: calc(var(--stagger-i, 0) * 28ms);
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
    animation: dup-stagger-enter 200ms var(--ease-out) both;
    animation-delay: calc(var(--stagger-i, 0) * 28ms);
    transition:
      background-color 140ms var(--ease-out),
      border-color 140ms var(--ease-out);
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
    transition:
      transform 140ms var(--ease-out),
      opacity 140ms var(--ease-out),
      background-color 140ms var(--ease-out),
      border-color 140ms var(--ease-out),
      color 140ms var(--ease-out);
  }
  .small-btn:active:not(:disabled) {
    transform: scale(0.97);
    transition-duration: 80ms;
  }
  @media (prefers-reduced-motion: reduce) {
    .item,
    .large-file-row {
      animation: none !important;
      transform: none !important;
    }
  }
</style>
