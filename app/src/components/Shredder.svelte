<script lang="ts">
  import {
    api,
    errorMessage,
    isPaymentRequired,
    requestActivation,
    type DriveMediaInfo,
    type LicenseStatus,
  } from "../lib/api";
  import { formatBytes } from "../lib/format";
  import { addLifetimeStats } from "../lib/store";

  let { license }: { license: LicenseStatus | null } = $props();
  let filePath = $state("");
  let passes = $state<number>(1);
  let mediaInfo = $state<DriveMediaInfo | null>(null);
  let lastDetectedPrefix = $state("");
  let shredding = $state(false);
  let statusMessage = $state("");
  let isError = $state(false);
  let needsPro = $state(false);
  let dragOver = $state(false);

  async function detectMedia(pathToCheck: string) {
    const target = pathToCheck.trim() || "C:\\";
    try {
      const info = await api.detectDriveMediaType(target);
      mediaInfo = info;
      passes = info.recommended_passes;
    } catch {
      // Ignore detection errors
    }
  }

  async function browseFileToShred() {
    try {
      const picked = await api.pickFile("Select file to securely shred");
      if (picked && picked.trim()) {
        filePath = picked.trim();
        await detectMedia(filePath);
      }
    } catch {
      // Ignore cancel or dialog error
    }
  }

  $effect(() => {
    const trimmed = filePath.trim();
    const prefix = trimmed.length >= 2 ? trimmed.slice(0, 3).toUpperCase() : "C:\\";
    if (prefix !== lastDetectedPrefix) {
      lastDetectedPrefix = prefix;
      detectMedia(trimmed || "C:\\");
    }
  });

  function onDropFile(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    const f = e.dataTransfer?.files?.[0] as (File & { path?: string }) | undefined;
    if (f?.path) {
      filePath = f.path;
      detectMedia(f.path);
      return;
    }
    const text = e.dataTransfer?.getData("text/plain");
    if (text) {
      filePath = text.trim().replace(/^"+|"+$/g, "");
      detectMedia(filePath);
    }
  }

  async function handleShred() {
    if (!filePath.trim()) {
      statusMessage = "Please enter or drop a file path to shred.";
      isError = true;
      return;
    }

    const passDesc =
      passes === 1
        ? "overwritten with a 1-pass zero-fill (SSD-safe)"
        : "overwritten 3 times (zeros, ones, then a fixed 0x55 pattern)";

    if (
      !confirm(
        `This is IRREVERSIBLE.\n\n"${filePath}" will be ${passDesc} and then permanently deleted.\n\nProceed?`
      )
    ) {
      return;
    }

    shredding = true;
    needsPro = false;
    statusMessage =
      passes === 1
        ? "Overwriting file (1-pass SSD-safe zero-fill)…"
        : "Overwriting file (pass 1: 0x00, pass 2: 0xFF, pass 3: 0x55)…";
    isError = false;

    try {
      const bytes = await api.shredFile(filePath.trim(), passes);
      addLifetimeStats(bytes, 1, ["shredder"], `${passes}-Pass Shredder`);
      statusMessage = `Overwrote ${formatBytes(bytes)} (${passes}-pass) and permanently deleted the file.`;
      filePath = "";
    } catch (e) {
      if (isPaymentRequired(e)) {
        needsPro = true;
        statusMessage = "The file shredder is a Pro feature. Activate your SWEEPR Cleaner licence to use it.";
        requestActivation();
      } else {
        statusMessage = `Shredding failed: ${errorMessage(e)}`;
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
  aria-label="Secure File Shredder"
>
  <div class="card-top-row">
    <div class="title-with-icon">
      <div class="shred-icon-bubble">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      </div>
      <div>
        <div class="row" style="gap: 8px;">
          <strong class="card-title">Secure File Shredder</strong>
          {#if mediaInfo}
            <span class="badge" class:free={mediaInfo.is_ssd} class:pro={!mediaInfo.is_ssd}>
              {mediaInfo.is_ssd ? "SSD Safe (1-Pass Recommended)" : "HDD Detected (3-Pass)"}
            </span>
          {/if}
        </div>
        <div class="muted small">Overwrite sensitive files in place before unlinking them from disk (system folders are protected)</div>
      </div>
    </div>

    <div class="pass-selector" role="radiogroup" aria-label="Overwrite passes">
      <button
        type="button"
        class="pass-btn"
        class:active={passes === 1}
        onclick={() => (passes = 1)}
      >
        1-Pass (SSD Safe)
      </button>
      <button
        type="button"
        class="pass-btn"
        class:active={passes === 3}
        onclick={() => (passes = 3)}
      >
        3-Pass (Deep Overwrite)
      </button>
    </div>
  </div>

  <div class="input-row">
    <input
      type="text"
      bind:value={filePath}
      onblur={() => detectMedia(filePath)}
      placeholder="Drop a file here, browse, or paste full file path (e.g. C:\Users\Username\Documents\confidential.pdf)"
      class="file-input"
      aria-label="File path to shred"
    />
    <button type="button" class="ghost" onclick={browseFileToShred} disabled={shredding}>
      Browse File…
    </button>
    <button class="primary shred-btn" onclick={handleShred} disabled={shredding || !filePath.trim()}>
      {#if shredding}
        <span>Shredding…</span>
      {:else}
        <span>Shred File ({passes}-Pass)</span>
      {/if}
    </button>
  </div>

  {#if statusMessage}
    <div class="status-box" class:error={isError} class:success={!isError}>
      <span>{statusMessage}</span>
      {#if needsPro && !license?.active}
        <button class="primary" style="padding: 5px 14px; font-size: 12px;" onclick={requestActivation}>Activate</button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .shred-card {
    padding: 24px 26px;
    display: flex;
    flex-direction: column;
    gap: 16px;
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
    gap: 12px;
  }
  .card-title {
    font-size: 16px;
  }
  .shred-icon-bubble {
    width: 40px;
    height: 40px;
    border-radius: 11px;
    background: rgba(16, 185, 129, 0.14);
    color: var(--accent);
    display: grid;
    place-items: center;
    flex-shrink: 0;
  }
  .pass-selector {
    display: flex;
    gap: 4px;
    background: var(--panel-2);
    padding: 3px;
    border-radius: 9999px;
    border: 1px solid var(--border);
  }
  .pass-btn {
    background: transparent;
    border: none;
    padding: 6px 14px;
    border-radius: 9999px;
    font-size: 12px;
    font-weight: 600;
    color: var(--muted);
    cursor: pointer;
    box-shadow: none;
  }
  .pass-btn.active {
    background: var(--panel-solid);
    color: var(--accent);
    box-shadow: 0 1px 4px rgba(15, 23, 42, 0.06);
  }
  .input-row {
    display: flex;
    gap: 12px;
    align-items: center;
    flex-wrap: wrap;
  }
  .file-input {
    flex: 1;
    min-width: 240px;
    padding: 11px 16px;
    border-radius: 9999px;
    border: 1.5px solid var(--border);
    background: var(--panel-solid);
    font-size: 13.5px;
    color: var(--text);
    outline: none;
  }
  .file-input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.15);
  }
  .shred-btn {
    padding: 11px 24px;
    border-radius: 9999px;
    font-weight: 700;
    white-space: nowrap;
  }
  .status-box {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 11px 16px;
    border-radius: 12px;
    font-size: 13px;
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
