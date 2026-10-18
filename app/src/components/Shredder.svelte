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

  let { license } = $props<{ license: LicenseStatus | null }>();
  let filePath = $state("");
  let passes = $state<number>(1);
  let mediaInfo = $state<DriveMediaInfo | null>(null);
  let lastDetectedPrefix = $state("");
  let shredding = $state(false);
  let statusMessage = $state("");
  let isError = $state(false);
  let needsPro = $state(false);

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

  $effect(() => {
    const trimmed = filePath.trim();
    const prefix = trimmed.length >= 2 ? trimmed.slice(0, 3).toUpperCase() : "C:\\";
    if (prefix !== lastDetectedPrefix) {
      lastDetectedPrefix = prefix;
      detectMedia(trimmed || "C:\\");
    }
  });

  async function handleShred() {
    if (!filePath.trim()) {
      statusMessage = "Please enter the full path to a file.";
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

<div class="header">
  <h2 style="font-size: 22px; font-weight: 800; letter-spacing: -0.4px; margin: 0;">Secure File Shredder</h2>
  <p class="muted small" style="margin-top: 4px;">
    Permanently overwrite sensitive files in place before unlinking them from the filesystem.
  </p>
</div>

<div class="card shred-card">
  <div class="shred-badge-row">
    {#if mediaInfo}
      <span class="badge" class:free={mediaInfo.is_ssd} class:pro={!mediaInfo.is_ssd}>
        {mediaInfo.is_ssd
          ? "SSD Detected — 1-Pass Zero-Fill Recommended to protect NAND lifespan"
          : "HDD Detected — 3-Pass Overwrite Recommended"}
      </span>
    {:else}
      <span class="badge free">Smart SSD / HDD Overwrite Protection</span>
    {/if}

    <div class="spacer"></div>

    <div class="pass-selector" role="radiogroup" aria-label="Overwrite passes">
      <button
        type="button"
        class="pass-btn"
        class:active={passes === 1}
        onclick={() => (passes = 1)}
      >
        1-Pass (Fast / SSD Safe)
      </button>
      <button
        type="button"
        class="pass-btn"
        class:active={passes === 3}
        onclick={() => (passes = 3)}
      >
        3-Pass (HDD Deep Overwrite)
      </button>
    </div>
  </div>

  <div class="shred-info-box">
    <div class="shred-icon-bubble">
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
    </div>
    <div>
      <strong>How it works, and its limits</strong>
      <p class="muted small" style="margin: 4px 0 0 0;">Unlike normal deletion or emptying the Recycle Bin, the file's contents are overwritten in place before it is deleted. On modern SSDs/NVMe drives, 1-pass zero-fill prevents unnecessary NAND flash wear while clearing file blocks. System and program folders are protected and can't be shredded.</p>
    </div>
  </div>

  <div class="input-row">
    <input
      type="text"
      bind:value={filePath}
      onblur={() => detectMedia(filePath)}
      placeholder="Enter full path (e.g. C:\Users\Username\Documents\confidential.pdf)"
      class="file-input"
    />
    <button class="primary shred-btn" onclick={handleShred} disabled={shredding}>
      {#if shredding}
        <span>Shredding…</span>
      {:else}
        <span>SHRED FILE ({passes}-PASS)</span>
      {/if}
    </button>
  </div>

  {#if statusMessage}
    <div class="status-box" class:error={isError} class:success={!isError}>
      {statusMessage}
      {#if needsPro && !license?.active}
        <button class="primary" style="margin-left: 10px;" onclick={requestActivation}>Activate</button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .header { margin-bottom: 16px; }
  .shred-card {
    padding: 24px 28px;
  }
  .shred-badge-row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 16px;
    flex-wrap: wrap;
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
    padding: 5px 12px;
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
  .shred-info-box {
    display: flex;
    align-items: flex-start;
    gap: 16px;
    padding: 16px 18px;
    background: rgba(241, 245, 249, 0.7);
    border: 1px solid var(--border);
    border-radius: 14px;
    margin-bottom: 20px;
  }
  .shred-icon-bubble {
    width: 44px;
    height: 44px;
    border-radius: 12px;
    background: rgba(16, 185, 129, 0.15);
    color: #059669;
    display: grid;
    place-items: center;
    flex-shrink: 0;
  }
  .input-row {
    display: flex;
    gap: 14px;
    align-items: center;
    flex-wrap: wrap;
  }
  .file-input {
    flex: 1;
    min-width: 240px;
    padding: 12px 18px;
    border-radius: 9999px;
    border: 1.5px solid var(--border);
    background: #ffffff;
    font-size: 13.5px;
    color: var(--text);
    outline: none;
  }
  .file-input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.15);
  }
  .shred-btn {
    padding: 12px 28px;
    border-radius: 9999px;
    font-weight: 700;
    white-space: nowrap;
  }
  .status-box {
    margin-top: 18px;
    padding: 12px 16px;
    border-radius: 12px;
    font-size: 13.5px;
  }
  .status-box.success {
    background: #ecfdf5;
    color: #065f46;
    border: 1px solid rgba(16, 185, 129, 0.3);
  }
  .status-box.error {
    background: #fef2f2;
    color: #991b1b;
    border: 1px solid rgba(239, 68, 68, 0.3);
  }
</style>
