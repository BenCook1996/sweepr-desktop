<script lang="ts">
  import {
    api,
    errorMessage,
    isPaymentRequired,
    requestActivation,
    type LicenseStatus,
  } from "../lib/api";
  import { formatBytes, shortenPath } from "../lib/format";
  import { addLifetimeStats } from "../lib/store";

  let { license }: { license: LicenseStatus | null } = $props();
  let filePath = $state("");
  let passes = $state<number>(1);
  let shredding = $state(false);
  let statusMessage = $state("");
  let isError = $state(false);
  let needsPro = $state(false);
  let dragOver = $state(false);

  async function detectMedia(pathToCheck: string) {
    const target = pathToCheck.trim() || "C:\\";
    try {
      const info = await api.detectDriveMediaType(target);
      passes = info.recommended_passes;
    } catch {
      passes = 1;
    }
  }

  async function browseFileToShred() {
    try {
      const picked = await api.pickFile("Choose a sensitive file to permanently erase");
      if (picked && picked.trim()) {
        filePath = picked.trim();
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

    const fileName = filePath.split(/[\\/]/).pop() || filePath;
    if (
      !confirm(
        `Permanently erase "${fileName}" forever?\n\nThis file will be securely wiped and will NOT go to the Recycle Bin. It can never be recovered.`
      )
    ) {
      return;
    }

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
    <div class="title-with-icon">
      <div class="shred-icon-bubble">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
      </div>
      <div>
        <strong class="card-title">Permanent File Eraser</strong>
        <div class="muted small">
          Permanently wipe sensitive files (like tax documents, ID scans, or bank statements) so nobody can ever recover them.
        </div>
      </div>
    </div>
    {#if !license?.active}
      <span class="badge pro">Pro</span>
    {/if}
  </div>

  <div class="dropzone-box">
    {#if !filePath}
      <p class="muted" style="margin: 0 0 12px 0;">
        Drag and drop a sensitive file here, or click the button below to choose a file from your PC.
      </p>
      <button type="button" class="primary choose-btn" onclick={browseFileToShred} disabled={shredding}>
        Choose File to Erase…
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
          Change File…
        </button>
        <button type="button" class="ghost small-btn" onclick={() => (filePath = "")} disabled={shredding}>
          Cancel
        </button>
      </div>

      <button class="danger-cta-btn" onclick={handleShred} disabled={shredding}>
        {shredding ? "Erasing File Forever…" : "Erase File Forever"}
      </button>
    {/if}
  </div>

  {#if statusMessage}
    <div class="status-box" class:error={isError} class:success={!isError}>
      <span>{statusMessage}</span>
      {#if needsPro && !license?.active}
        <button class="primary small-btn" onclick={requestActivation}>Upgrade to Pro</button>
      {/if}
    </div>
  {/if}
</div>

<style>
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
</style>
