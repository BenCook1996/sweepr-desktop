<script lang="ts">
  import { api, errorMessage, isPaymentRequired, requestActivation, type LicenseStatus } from "../lib/api";
  import { formatBytes } from "../lib/format";

  let { license } = $props<{ license: LicenseStatus | null }>();
  let filePath = $state("");
  let shredding = $state(false);
  let statusMessage = $state("");
  let isError = $state(false);
  let needsPro = $state(false);

  async function handleShred() {
    if (!filePath.trim()) {
      statusMessage = "Please enter the full path to a file.";
      isError = true;
      return;
    }

    if (!confirm(`This is IRREVERSIBLE.\n\n"${filePath}" will be overwritten 3 times (zeros, ones, then a fixed 0x55 pattern) and then deleted.\n\nProceed?`)) {
      return;
    }

    shredding = true;
    needsPro = false;
    statusMessage = "Overwriting file (pass 1: 0x00, pass 2: 0xFF, pass 3: 0x55)…";
    isError = false;

    try {
      const bytes = await api.shredFile(filePath.trim());
      statusMessage = `Overwrote ${formatBytes(bytes)} three times and deleted the file.`;
      filePath = "";
    } catch (e) {
      if (isPaymentRequired(e)) {
        needsPro = true;
        statusMessage = "The file shredder is a Pro feature. Activate your Sweepr licence to use it.";
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
  <h1 style="font-size: 26px; font-weight: 800; letter-spacing: -0.5px;">Secure File Shredder</h1>
  <p class="muted small" style="margin-top: 4px;">Overwrites a single file three times before deleting it.</p>
</div>

<div class="card shred-card">
  <div class="shred-badge-row">
    <span class="muted small">3-pass overwrite</span>
  </div>

  <div class="shred-info-box">
    <div class="shred-icon-bubble">
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
    </div>
    <div>
      <strong>How it works, and its limits</strong>
      <p class="muted small" style="margin: 4px 0 0 0;">Unlike normal deletion or emptying the Recycle Bin, the file's contents are overwritten in place (zeros, ones, then a 0x55 pattern) before it is deleted. This is best-effort: on SSDs and flash drives, and in cloud-synced folders (OneDrive, Dropbox…), backups or shadow copies, earlier copies of the data may survive. System and program folders are protected and can't be shredded.</p>
    </div>
  </div>

  <div class="input-row">
    <input type="text" bind:value={filePath} placeholder="Enter full path (e.g. C:\Users\Username\Documents\confidential.pdf)" class="file-input" />
    <button class="primary shred-btn" onclick={handleShred} disabled={shredding}>
      {#if shredding}
        <span>Shredding…</span>
      {:else}
        <span>SHRED FILE NOW</span>
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
  .header { margin-bottom: 24px; }
  .shred-card {
    padding: 28px;
    max-width: 860px;
  }
  .shred-badge-row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 16px;
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
  }
  .file-input {
    flex: 1;
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
