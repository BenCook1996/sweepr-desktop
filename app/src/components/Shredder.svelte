<script lang="ts">
  import { onMount } from "svelte";
  import {
    api,
    errorMessage,
    isPaymentRequired,
    requestActivation,
    type DriveMediaInfo,
    type DriveSummary,
    type LicenseStatus,
    type WipeProgress,
  } from "../lib/api";
  import { formatBytes, shortenPath } from "../lib/format";
  import { addLifetimeStats } from "../lib/store";

  let { license }: { license: LicenseStatus | null } = $props();
  let filePath = $state("");
  let passes = $state<number>(1);
  let fileMediaInfo = $state<DriveMediaInfo | null>(null);
  let shredding = $state(false);
  let statusMessage = $state("");
  let isError = $state(false);
  let needsPro = $state(false);
  let dragOver = $state(false);
  let confirmingShred = $state(false);

  // HDD-only Free-Space Zeroing state (#14)
  let drives = $state<DriveSummary[]>([]);
  let loadingDrives = $state(false);
  let selectedMount = $state("");
  let customWipeFolder = $state("");
  let wipeTargetInfo = $state<DriveMediaInfo | null>(null);
  let confirmingWipe = $state(false);
  let wiping = $state(false);
  let cancellingWipe = $state(false);
  let wipeProgress = $state<WipeProgress | null>(null);
  let wipeStatusMessage = $state("");
  let wipeIsError = $state(false);
  let wipeNeedsPro = $state(false);

  const wipeTargetPath = $derived(customWipeFolder.trim() || selectedMount.trim());
  const freeSpaceWipeAllowed = $derived(Boolean(wipeTargetInfo?.free_space_wipe_allowed));

  async function detectMedia(pathToCheck: string) {
    const target =
      pathToCheck.trim() ||
      (typeof navigator !== "undefined" && /Win/i.test(navigator.platform) ? "C:\\" : "/");
    try {
      const info = await api.detectDriveMediaType(target);
      passes = info.recommended_passes;
      fileMediaInfo = info;
    } catch {
      passes = 1;
      fileMediaInfo = null;
    }
  }

  async function inspectWipeTarget(targetPath: string) {
    if (!targetPath.trim()) {
      wipeTargetInfo = null;
      return;
    }
    try {
      wipeTargetInfo = await api.detectDriveMediaType(targetPath.trim());
    } catch (e) {
      wipeTargetInfo = {
        is_ssd: true,
        media_label: "Unknown Drive Type",
        recommended_passes: 1,
        kind: "unknown",
        is_removable: false,
        mount_point: "",
        available_bytes: 0,
        total_bytes: 0,
        free_space_wipe_allowed: false,
        block_reason: errorMessage(e),
      };
    }
  }

  async function loadWipeableDrives() {
    loadingDrives = true;
    try {
      const list = await api.listWipeableDrives();
      drives = list;
      if (!selectedMount && list.length > 0) {
        const preferredHdd = list.find((d) => d.free_space_wipe_allowed);
        selectedMount = (preferredHdd ?? list[0]).mount_point;
      }
      if (wipeTargetPath) {
        await inspectWipeTarget(wipeTargetPath);
      }
    } catch (e) {
      wipeStatusMessage = `Could not enumerate drives: ${errorMessage(e)}`;
      wipeIsError = true;
    } finally {
      loadingDrives = false;
    }
  }

  onMount(() => {
    void loadWipeableDrives();
  });

  async function onDriveSelectionChange(mount: string) {
    selectedMount = mount;
    customWipeFolder = "";
    confirmingWipe = false;
    wipeStatusMessage = "";
    wipeIsError = false;
    await inspectWipeTarget(mount);
  }

  async function browseWipeFolder() {
    try {
      const picked = await api.pickFolder("Choose a folder on a fixed HDD to zero free space");
      if (picked && picked.trim()) {
        customWipeFolder = picked.trim();
        confirmingWipe = false;
        wipeStatusMessage = "";
        wipeIsError = false;
        await inspectWipeTarget(customWipeFolder);
      }
    } catch {
      // Ignore cancel
    }
  }

  async function handleWipeFreeSpace() {
    if (!wipeTargetPath) {
      wipeStatusMessage = "Select a fixed mechanical HDD drive first.";
      wipeIsError = true;
      return;
    }
    if (!freeSpaceWipeAllowed) {
      wipeStatusMessage =
        wipeTargetInfo?.block_reason ||
        "Free-space zeroing is blocked on SSD, NVMe, removable, and unverified drives.";
      wipeIsError = true;
      return;
    }
    if (!confirmingWipe) {
      confirmingWipe = true;
      return;
    }
    confirmingWipe = false;
    wiping = true;
    cancellingWipe = false;
    wipeNeedsPro = false;
    wipeIsError = false;
    wipeProgress = {
      bytes_written: 0,
      total_bytes: wipeTargetInfo?.available_bytes ?? 0,
      percent: 0,
      status: "Starting HDD free-space zeroing…",
    };
    wipeStatusMessage = "";

    const unlisten = await api.onWipeFreeSpaceProgress((p) => {
      wipeProgress = p;
    });
    try {
      const rep = await api.wipeFreeSpace(wipeTargetPath);
      if (rep.cancelled) {
        wipeStatusMessage = `Cancelled after zeroing ${formatBytes(rep.bytes_zeroed)}. Temporary wipe file removed.`;
      } else {
        wipeStatusMessage = `Zeroed ${formatBytes(rep.bytes_zeroed)} of unallocated space on ${rep.mount_point} in ${(rep.duration_ms / 1000).toFixed(1)}s. Temporary file removed.`;
      }
      await loadWipeableDrives();
    } catch (e) {
      if (isPaymentRequired(e)) {
        wipeNeedsPro = true;
        wipeStatusMessage =
          "HDD Free-Space Zeroing is a Pro feature. Upgrade to SWEEPR Pro to unlock it.";
        requestActivation({ feature: "HDD Free-Space Zeroing" });
      } else {
        wipeStatusMessage = errorMessage(e);
      }
      wipeIsError = true;
    } finally {
      unlisten();
      wiping = false;
      cancellingWipe = false;
    }
  }

  async function handleCancelWipe() {
    cancellingWipe = true;
    try {
      await api.cancelWipeFreeSpace();
    } catch {
      // Ignore cancel IPC error
    }
  }

  async function browseFileToShred() {
    try {
      const picked = await api.pickFile("Choose a sensitive file to permanently erase");
      if (picked && picked.trim()) {
        filePath = picked.trim();
        confirmingShred = false;
        statusMessage = "";
        isError = false;
        await detectMedia(filePath);
      }
    } catch {
      // Ignore cancel
    }
  }

  function onDropFile(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    confirmingShred = false;
    const f = e.dataTransfer?.files?.[0] as (File & { path?: string }) | undefined;
    if (f?.path) {
      filePath = f.path;
      statusMessage = "";
      isError = false;
      detectMedia(f.path);
      return;
    }
    const text = e.dataTransfer?.getData("text/plain");
    if (text) {
      filePath = text.trim().replace(/^"+|"+$/g, "");
      statusMessage = "";
      isError = false;
      detectMedia(filePath);
    }
  }

  async function handleShred() {
    if (!filePath.trim()) {
      statusMessage = "Please choose a file to erase first.";
      isError = true;
      return;
    }

    if (!confirmingShred) {
      confirmingShred = true;
      return;
    }
    confirmingShred = false;

    const fileName = filePath.split(/[\\/]/).pop() || filePath;
    shredding = true;
    needsPro = false;
    statusMessage = "Securely erasing file so it can never be recovered…";
    isError = false;

    try {
      const bytes = await api.shredFile(filePath.trim(), passes);
      addLifetimeStats(bytes, 1, ["shredder"], "Permanent File Eraser");
      statusMessage = `Permanently erased "${fileName}" (${formatBytes(bytes)}).`;
      filePath = "";
    } catch (e) {
      if (isPaymentRequired(e)) {
        needsPro = true;
        statusMessage = "Permanent File Eraser is a Pro feature. Upgrade to SWEEPR Pro to unlock it.";
        requestActivation();
      } else {
        statusMessage = `Could not erase file: ${errorMessage(e)}`;
      }
      isError = true;
    } finally {
      shredding = false;
    }
  }
</script>

<div class="shredder-stack">
<div
  class="card shred-card"
  class:drag-over={dragOver}
  ondragover={(e) => {
    e.preventDefault();
    dragOver = true;
  }}
  ondragleave={() => (dragOver = false)}
  ondrop={onDropFile}
  role="region"
  aria-label="Permanent File Eraser"
>
  <div class="card-top-row">
    <strong class="card-title">File Shredder</strong>
    {#if fileMediaInfo}
      <span class="media-badge" class:is-hdd={!fileMediaInfo.is_ssd} class:is-ssd={fileMediaInfo.is_ssd}>
        {fileMediaInfo.media_label} · {passes}-pass overwrite
      </span>
    {/if}
  </div>

  <div class="dropzone-box">
    {#if !filePath}
      <p class="muted" style="margin: 0 0 12px 0;">
        Drop a file here to erase it permanently.
      </p>
      <button type="button" class="primary choose-btn" onclick={browseFileToShred} disabled={shredding}>
        Choose File
      </button>
    {:else}
      <div class="selected-file-pill">
        <div style="flex: 1; min-width: 0; text-align: left;">
          <strong style="display: block; font-size: 14.5px;">
            {filePath.split(/[\\/]/).pop() || filePath}
          </strong>
          <span class="muted small" title={filePath}>{shortenPath(filePath, 75)}</span>
        </div>
        <button type="button" class="ghost small-btn" onclick={browseFileToShred} disabled={shredding}>
          Change
        </button>
        <button type="button" class="ghost small-btn" onclick={() => { filePath = ""; fileMediaInfo = null; }} disabled={shredding}>
          Cancel
        </button>
      </div>

      <button class="danger-cta-btn" onclick={handleShred} disabled={shredding}>
        {shredding
          ? "Shredding…"
          : confirmingShred
            ? "Confirm Shred"
            : "Shred Forever"}
      </button>
    {/if}
  </div>

  {#if statusMessage}
    <div class="status-box" class:error={isError} class:success={!isError}>
      <span>{statusMessage}</span>
      {#if needsPro && !license?.active}
        <button class="primary small-btn" onclick={() => requestActivation({ feature: "File Shredder" })}>Upgrade to Pro</button>
      {/if}
    </div>
  {/if}
</div>

<div class="card shred-card" role="region" aria-label="Free-Space Zeroing (HDD Only)">
  <div class="card-top-row">
    <div>
      <strong class="card-title">Free-Space Zeroing (HDD Only)</strong>
      <p class="muted small" style="margin: 4px 0 0 0;">
        Overwrites unallocated free space with zeros on fixed mechanical hard drives (HDD) so deleted files cannot be carved back.
      </p>
    </div>
    {#if !license?.active}
      <span class="pro-pill">PRO</span>
    {/if}
  </div>

  <div class="wipe-controls-row">
    <select
      class="wipe-select"
      aria-label="Select drive for free-space zeroing"
      value={selectedMount}
      disabled={wiping || loadingDrives}
      onchange={(e) => void onDriveSelectionChange((e.currentTarget as HTMLSelectElement).value)}
    >
      {#if drives.length === 0}
        <option value="">No mounted drives detected</option>
      {:else}
        {#each drives as d (d.mount_point)}
          <option value={d.mount_point}>
            {d.name} — {formatBytes(d.available_bytes)} free [{d.free_space_wipe_allowed ? "HDD" : d.kind.toUpperCase() + " · Blocked"}]
          </option>
        {/each}
      {/if}
    </select>

    <button
      type="button"
      class="ghost small-btn"
      disabled={wiping}
      onclick={browseWipeFolder}
    >
      Choose Folder…
    </button>
    <button
      type="button"
      class="ghost small-btn"
      disabled={wiping || loadingDrives}
      onclick={() => void loadWipeableDrives()}
    >
      {loadingDrives ? "Refreshing…" : "Refresh"}
    </button>
  </div>

  {#if customWipeFolder}
    <div class="muted small">
      Selected target folder: <code>{shortenPath(customWipeFolder, 80)}</code>
    </div>
  {/if}

  {#if wipeTargetInfo}
    <div class="wipe-media-banner" class:allowed={freeSpaceWipeAllowed} class:blocked={!freeSpaceWipeAllowed}>
      <div class="wipe-media-head">
        <span class="media-badge" class:is-hdd={freeSpaceWipeAllowed} class:is-ssd={!freeSpaceWipeAllowed}>
          {wipeTargetInfo.media_label}
        </span>
        {#if wipeTargetInfo.mount_point}
          <span class="muted small">
            Volume {wipeTargetInfo.mount_point} · {formatBytes(wipeTargetInfo.available_bytes)} free of {formatBytes(wipeTargetInfo.total_bytes)}
          </span>
        {/if}
      </div>
      {#if !freeSpaceWipeAllowed}
        <p class="wipe-block-copy">
          {wipeTargetInfo.block_reason || "Free-space zeroing is blocked on SSD, NVMe, removable flash, and unknown drives to prevent flash wear-leveling damage."}
        </p>
      {:else}
        <p class="wipe-allow-copy">
          Verified fixed mechanical HDD. Leaves 32 MiB OS safety headroom and automatically removes its temporary zero-fill file on completion, cancellation, or error.
        </p>
      {/if}
    </div>
  {/if}

  {#if wiping && wipeProgress}
    <div class="wipe-progress-box" role="status" aria-live="polite">
      <div class="wipe-progress-top">
        <span>{wipeProgress.status}</span>
        <span>{formatBytes(wipeProgress.bytes_written)} / {formatBytes(wipeProgress.total_bytes)} ({wipeProgress.percent}%)</span>
      </div>
      <div class="wipe-progress-track">
        <div class="wipe-progress-fill" style={`width: ${wipeProgress.percent}%;`}></div>
      </div>
    </div>
  {/if}

  <div class="wipe-action-row">
    <button
      type="button"
      class="danger-cta-btn"
      disabled={!freeSpaceWipeAllowed || wiping || !wipeTargetPath}
      onclick={handleWipeFreeSpace}
    >
      {wiping
        ? "Zeroing Free Space…"
        : confirmingWipe
          ? "Confirm Zero Free Space"
          : "Zero HDD Free Space"}
    </button>

    {#if wiping}
      <button
        type="button"
        class="ghost small-btn"
        disabled={cancellingWipe}
        onclick={handleCancelWipe}
      >
        {cancellingWipe ? "Cancelling…" : "Cancel"}
      </button>
    {:else if confirmingWipe}
      <button
        type="button"
        class="ghost small-btn"
        onclick={() => (confirmingWipe = false)}
      >
        Cancel
      </button>
    {/if}
  </div>

  {#if wipeStatusMessage}
    <div class="status-box" class:error={wipeIsError} class:success={!wipeIsError}>
      <span>{wipeStatusMessage}</span>
      {#if wipeNeedsPro && !license?.active}
        <button class="primary small-btn" onclick={() => requestActivation({ feature: "HDD Free-Space Zeroing" })}>Upgrade to Pro</button>
      {/if}
    </div>
  {/if}
</div>
</div>

<style>
  .shredder-stack {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  .shred-card {
    padding: 26px 30px;
    display: flex;
    flex-direction: column;
    gap: 18px;
    transition: border-color 0.2s ease, background 0.2s ease;
  }
  .shred-card.drag-over {
    border-color: var(--accent);
    background: var(--accent-light);
  }
  .card-top-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
  }
  .title-with-icon {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .card-title {
    font-size: 17px;
  }
  .shred-icon-bubble {
    width: 44px;
    height: 44px;
    border-radius: 12px;
    background: rgba(16, 185, 129, 0.14);
    color: var(--accent);
    display: grid;
    place-items: center;
    flex-shrink: 0;
  }
  .dropzone-box {
    border: 2px dashed var(--border);
    background: var(--panel-2);
    border-radius: 14px;
    padding: 28px 24px;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
  }
  .choose-btn {
    padding: 11px 24px;
    border-radius: 9999px;
    font-weight: 700;
  }
  .selected-file-pill {
    width: 100%;
    max-width: 680px;
    background: var(--panel-solid);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 12px 16px;
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .danger-cta-btn {
    background: #ef4444;
    color: #ffffff;
    border: none;
    padding: 12px 28px;
    border-radius: 9999px;
    font-size: 14.5px;
    font-weight: 800;
    cursor: pointer;
    box-shadow: 0 6px 16px rgba(239, 68, 68, 0.28);
  }
  .danger-cta-btn:hover:not(:disabled) {
    background: #dc2626;
  }
  .small-btn {
    padding: 6px 14px;
    font-size: 12.5px;
    border-radius: 9999px;
  }
  .status-box {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 16px;
    border-radius: 12px;
    font-size: 13.5px;
    font-weight: 600;
  }
  .status-box.success {
    background: var(--accent-light);
    color: var(--text);
    border: 1px solid rgba(16, 185, 129, 0.3);
  }
  .status-box.error {
    background: rgba(239, 68, 68, 0.14);
    color: var(--danger);
    border: 1px solid rgba(239, 68, 68, 0.3);
  }
  .pro-pill {
    font-size: 11px;
    font-weight: 800;
    padding: 3px 9px;
    border-radius: 9999px;
    background: rgba(245, 158, 11, 0.16);
    color: #d97706;
    border: 1px solid rgba(245, 158, 11, 0.35);
  }
  .media-badge {
    display: inline-flex;
    align-items: center;
    font-size: 12px;
    font-weight: 700;
    padding: 4px 10px;
    border-radius: 9999px;
  }
  .media-badge.is-hdd {
    background: rgba(16, 185, 129, 0.14);
    color: #059669;
    border: 1px solid rgba(16, 185, 129, 0.35);
  }
  .media-badge.is-ssd {
    background: rgba(245, 158, 11, 0.14);
    color: #d97706;
    border: 1px solid rgba(245, 158, 11, 0.35);
  }
  .wipe-controls-row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .wipe-select {
    flex: 1;
    min-width: 240px;
    padding: 9px 12px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: var(--panel-2);
    color: var(--text);
    font-size: 13.5px;
  }
  .wipe-media-banner {
    border-radius: 12px;
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .wipe-media-banner.allowed {
    background: rgba(16, 185, 129, 0.08);
    border: 1px solid rgba(16, 185, 129, 0.3);
  }
  .wipe-media-banner.blocked {
    background: rgba(245, 158, 11, 0.1);
    border: 1px solid rgba(245, 158, 11, 0.38);
  }
  .wipe-media-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
  }
  .wipe-block-copy,
  .wipe-allow-copy {
    margin: 0;
    font-size: 13px;
    line-height: 1.45;
  }
  .wipe-progress-box {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 14px;
    border-radius: 12px;
    background: var(--panel-2);
    border: 1px solid var(--border);
  }
  .wipe-progress-top {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    font-size: 12.5px;
    font-weight: 600;
  }
  .wipe-progress-track {
    width: 100%;
    height: 8px;
    border-radius: 9999px;
    background: var(--border);
    overflow: hidden;
  }
  .wipe-progress-fill {
    height: 100%;
    background: var(--accent);
    transition: width 0.2s ease;
  }
  .wipe-action-row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .danger-cta-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
    box-shadow: none;
  }
</style>
