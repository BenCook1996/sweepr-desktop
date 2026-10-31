<script module lang="ts">
  let cachedVaultPassword = "";
</script>

<script lang="ts">
  import {
    api,
    cloudApi,
    errorMessage,
    isPaymentRequired,
    requestActivation,
    type CloudRoot,
    type LicenseStatus,
    type SyncPair,
    type VaultEntry,
  } from "../lib/api";
  import { formatBytes, shortenPath } from "../lib/format";

  let { license }: { license: LicenseStatus | null } = $props();

  let roots = $state<CloudRoot[]>([]);
  let error = $state("");
  let status = $state("");
  let scheduleSync = $state(false);
  let scheduleFreq = $state("daily");
  const hasCloudBundle = $derived(
    Boolean(
      license?.dev_unlock ||
        license?.addons?.some((a) => a.toLowerCase() === "cloud_vault")
    )
  );

  $effect(() => {
    cloudApi
      .detectRoots()
      .then((r) => {
        roots = r;
        if (!vaultDir && r.length > 0) {
          const sep = r[0].path.includes("\\") ? "\\" : "/";
          vaultDir = `${r[0].path}${sep}SWEEPR Private Vault`;
        }
        refreshVault();
      })
      .catch(() => {
        roots = [];
        refreshVault();
      });
    api
      .getScheduleConfig()
      .then((cfg) => {
        scheduleSync = Boolean(cfg.sync_cloud_backups);
        scheduleFreq = cfg.frequency || "daily";
      })
      .catch(() => {});
  });

  async function unlockBundle() {
    error = "";
    if (license?.active) {
      try {
        await api.startAddonCheckout("cloud_vault");
      } catch {
        requestActivation();
      }
    } else {
      requestActivation();
    }
  }

  async function toggleScheduleSync(enabled: boolean, inputEl?: HTMLInputElement) {
    if (!hasCloudBundle) {
      if (inputEl) inputEl.checked = scheduleSync;
      await unlockBundle();
      return;
    }
    try {
      const cfg = await api.getScheduleConfig();
      const updated = await api.saveScheduleConfig({
        ...cfg,
        enabled: enabled ? true : cfg.enabled,
        sync_cloud_backups: enabled,
      });
      scheduleSync = Boolean(updated.sync_cloud_backups);
      scheduleFreq = updated.frequency || "daily";
      status = scheduleSync
        ? `Automatic Cloud Backup turned on (${scheduleFreq} at ${updated.time}).`
        : "Automatic Cloud Backup turned off.";
    } catch (e) {
      if (inputEl) inputEl.checked = scheduleSync;
      handle(e, "Automatic Cloud Backup");
    }
  }

  function handle(e: unknown, _feature: string) {
    if (isPaymentRequired(e)) {
      unlockBundle();
    } else {
      error = errorMessage(e);
    }
  }

  // ---- vault ----
  let vaultDir = $state("");
  let password = $state(cachedVaultPassword);
  let confirmPassword = $state(cachedVaultPassword);
  let showPassword = $state(false);
  let removeOriginals = $state(true);
  let pendingFiles = $state<string[]>([]);
  let entries = $state<VaultEntry[]>([]);
  let unlocked = $state(false);
  let vaultBusy = $state(false);
  let vaultDragOver = $state(false);

  const pwTooShort = $derived(password.length > 0 && password.length < 8);
  const needsConfirmPassword = $derived(entries.length === 0 && !unlocked);
  const pwMismatch = $derived(
    needsConfirmPassword && confirmPassword.length > 0 && confirmPassword !== password
  );

  function handleVaultDrop(e: DragEvent) {
    e.preventDefault();
    vaultDragOver = false;
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    const next = [...pendingFiles];
    for (let i = 0; i < files.length; i++) {
      const f = files[i] as File & { path?: string };
      const p = f.path?.trim();
      if (p && !next.includes(p)) {
        next.push(p);
      }
    }
    pendingFiles = next;
  }

  async function pickVaultDir() {
    const picked = await api
      .pickFolder("Choose a folder for your locked vault (for example, inside OneDrive or Google Drive)")
      .catch(() => null);
    if (picked?.trim()) {
      vaultDir = picked.trim();
      unlocked = false;
      await refreshVault();
    }
  }

  async function refreshVault(withPassword = false) {
    try {
      const pwToUse = withPassword || password.length >= 8 ? password : undefined;
      entries = await cloudApi.vaultList(vaultDir, pwToUse);
      unlocked = Boolean(pwToUse && entries.some((e) => e.original_name));
      if (unlocked) {
        cachedVaultPassword = password;
      }
    } catch (e) {
      error = errorMessage(e);
    }
  }

  async function addFile() {
    const picked = await api.pickFile("Choose a photo or document to lock with a password").catch(() => null);
    if (picked?.trim() && !pendingFiles.includes(picked.trim())) {
      pendingFiles = [...pendingFiles, picked.trim()];
    }
  }

  async function encrypt() {
    error = "";
    status = "";
    if (password.length < 8) return void (error = "Please use a password of at least 8 characters.");
    if (needsConfirmPassword && password !== confirmPassword) return void (error = "Your passwords don't match.");
    cachedVaultPassword = password;
    vaultBusy = true;
    try {
      const rep = await cloudApi.vaultEncrypt(pendingFiles, password, vaultDir || null, removeOriginals);
      if (!vaultDir && rep.processed.length > 0) {
        const vp = rep.processed[0].vault_path;
        const idx = Math.max(vp.lastIndexOf("\\"), vp.lastIndexOf("/"));
        if (idx > 0) vaultDir = vp.slice(0, idx);
      }
      status =
        `Locked ${rep.processed.length} file(s) (${formatBytes(rep.bytes)}) with your password.` +
        (removeOriginals ? ` ${rep.originals_removed} unlocked original(s) removed.` : "") +
        (rep.skipped.length ? ` Skipped: ${rep.skipped.join("; ")}` : "");
      pendingFiles = [];
      await refreshVault(true);
    } catch (e) {
      handle(e, "Private File Vault");
    } finally {
      vaultBusy = false;
    }
  }

  async function restore(entry: VaultEntry) {
    error = "";
    status = "";
    if (!password) return void (error = "Please enter your vault password first.");
    const dest = await api.pickFolder("Choose a folder to unlock this file into").catch(() => null);
    if (!dest?.trim()) return;
    vaultBusy = true;
    try {
      const rep = await cloudApi.vaultDecrypt([entry.vault_path], password, dest.trim(), false);
      status = rep.processed.length
        ? `Unlocked "${rep.processed[0].original_name}" into ${dest.trim()}.`
        : `Could not unlock: ${rep.skipped.join("; ")}`;
    } catch (e) {
      handle(e, "Private File Vault");
    } finally {
      vaultBusy = false;
    }
  }

  // ---- backup sync ----
  let pairs = $state<SyncPair[]>([]);
  let syncSource = $state("");
  let syncDest = $state("");
  let syncBusy = $state<string | null>(null);
  $effect(() => {
    cloudApi
      .syncList()
      .then((p) => (pairs = p))
      .catch(() => (pairs = []));
  });

  async function pick(kind: "src" | "dst") {
    const picked = await api
      .pickFolder(
        kind === "src"
          ? "Choose the folder you want to protect (e.g. OneDrive\\Documents)"
          : "Choose where to save the backup copy (e.g. Google Drive\\Backups)"
      )
      .catch(() => null);
    if (!picked?.trim()) return;
    if (kind === "src") syncSource = picked.trim();
    else syncDest = picked.trim();
  }

  async function addPair() {
    error = "";
    try {
      pairs = await cloudApi.syncAdd(syncSource, syncDest);
      syncSource = "";
      syncDest = "";
    } catch (e) {
      handle(e, "Cloud Backup");
    }
  }

  async function runPair(id?: string) {
    error = "";
    status = "";
    syncBusy = id ?? "all";
    try {
      const reps = await cloudApi.syncRun(id);
      const copied = reps.reduce((s, r) => s + r.files_copied, 0);
      const bytes = reps.reduce((s, r) => s + r.bytes_copied, 0);
      status = `Backup complete: ${copied} new or updated file(s) copied (${formatBytes(bytes)}).`;
      pairs = await cloudApi.syncList();
    } catch (e) {
      handle(e, "Cloud Backup");
    } finally {
      syncBusy = null;
    }
  }

  async function removePair(id: string) {
    pairs = await cloudApi.syncRemove(id).catch(() => pairs);
  }

  const providerOf = (path: string) =>
    roots.find((r) => path.toLowerCase().startsWith(r.path.toLowerCase()))?.label ?? "Folder";
  const fmtTime = (s: number | null) =>
    s ? new Date(s * 1000).toLocaleString("en-GB") : "Never";
</script>

<section class="protect" aria-label="Private File Lockbox and Automatic Cloud Backup">
  {#if error}<div class="card error-banner" role="alert">{error}</div>{/if}
  {#if status}<div class="card status-box" role="status">{status}</div>{/if}

  {#if !hasCloudBundle}
    <div class="card bundle-head">
      <div>
        <div class="eyebrow">Optional Add-On · £9.99/yr</div>
        <h3>Private File Lockbox &amp; Automatic Folder Backup</h3>
        <p class="small muted">Lock personal photos and documents with your own password, and back up important folders automatically.</p>
      </div>
      <button class="primary" onclick={unlockBundle}>
        Unlock Cloud Protection (+£9.99/yr)
      </button>
    </div>
  {/if}

  <div class="grid">
    <!-- 1. Private File Lockbox -->
    <div
      class="card"
      style={vaultDragOver ? "border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent);" : ""}
      ondragover={(e) => {
        e.preventDefault();
        vaultDragOver = true;
      }}
      ondragleave={() => (vaultDragOver = false)}
      ondrop={handleVaultDrop}
      role="region"
      aria-label="Private File Lockbox"
    >
      <div class="row">
        <div>
          <strong>Private File Lockbox</strong>
          <div class="small muted">Password-locks your private photos and documents so nobody else can open them</div>
        </div>
        <span class="spacer"></span>
        <button class="ghost small-btn" onclick={addFile}>+ Add File</button>
      </div>

      <div class="field">
        <div class="row">
          <input
            id="vault-pw"
            class="grow"
            type={showPassword ? "text" : "password"}
            placeholder="Vault password (8+ chars)"
            bind:value={password}
            oninput={() => {
              cachedVaultPassword = password;
              if (password.length >= 8 && entries.length > 0) {
                refreshVault(true);
              }
            }}
            autocomplete="new-password"
            aria-invalid={pwTooShort}
          />
          <button
            class="ghost small-btn"
            onclick={() => (showPassword = !showPassword)}
            aria-pressed={showPassword}
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>
        {#if pwTooShort}<span class="hint warn">8+ characters required</span>{/if}
        {#if needsConfirmPassword}
          <input
            id="vault-pw2"
            type={showPassword ? "text" : "password"}
            placeholder="Confirm password"
            bind:value={confirmPassword}
            autocomplete="new-password"
            aria-invalid={pwMismatch}
          />
          {#if pwMismatch}<span class="hint warn">Passwords don't match</span>{/if}
        {/if}
      </div>

      {#if pendingFiles.length > 0}
        <div class="field">
          {#each pendingFiles as f}
            <div class="row sub-box small">
              <span class="path grow" title={f}>{shortenPath(f, 52)}</span>
              <button
                class="ghost small-btn"
                onclick={() => (pendingFiles = pendingFiles.filter((x) => x !== f))}
              >
                ×
              </button>
            </div>
          {/each}
          <label class="check">
            <input type="checkbox" bind:checked={removeOriginals} />
            <span>Remove original file</span>
          </label>
        </div>
      {/if}

      <button
        class="primary"
        onclick={encrypt}
        disabled={vaultBusy || !pendingFiles.length}
        aria-busy={vaultBusy}
      >
        {vaultBusy ? "Locking…" : "Lock Files"}
      </button>

      <div class="row small muted" style="justify-content: space-between; align-items: center;">
        <span class="path" title={vaultDir || "SWEEPR Private Vault"}>
          {vaultDir ? shortenPath(vaultDir, 38) : "SWEEPR Private Vault"}
        </span>
        <button class="ghost small-btn" onclick={pickVaultDir}>Folder…</button>
      </div>

      <div class="vault-list">
        {#each entries as e (e.vault_path)}
          <div class="row small sub-box">
            <span class="grow">{unlocked && e.original_name ? e.original_name : "Locked File"}</span>
            <span class="muted">{formatBytes(e.size)}</span>
            <button class="ghost small-btn" onclick={() => restore(e)} disabled={vaultBusy}>
              Unlock
            </button>
          </div>
        {:else}
          <span class="muted small">No locked files</span>
        {/each}
      </div>
    </div>

    <!-- 2. Automatic Cloud Backup -->
    <div class="card">
      <div class="row">
        <div>
          <strong>Automatic Folder Backup</strong>
          <div class="small muted">Automatically copies important folders to OneDrive, Google Drive, Dropbox, or iCloud</div>
        </div>
      </div>

      <div class="field">
        <div class="row sub-box">
          <span class="path small grow" title={syncSource}>
            {syncSource ? shortenPath(syncSource, 44) : "Source folder"}
          </span>
          <button class="ghost small-btn" onclick={() => pick("src")}>Choose</button>
        </div>

        <div class="row sub-box">
          <span class="path small grow" title={syncDest}>
            {syncDest ? shortenPath(syncDest, 44) : "Backup folder"}
          </span>
          <button class="ghost small-btn" onclick={() => pick("dst")}>Choose</button>
        </div>

        <button class="primary" onclick={addPair} disabled={!syncSource || !syncDest}>
          Save Rule
        </button>
      </div>

      <ul class="pairs">
        {#each pairs as p (p.id)}
          <li class="pair">
            <div class="small">
              <span class="badge">{providerOf(p.source)}</span>
              <span title={p.source}>{shortenPath(p.source, 36)}</span>
              <span class="arrow">→</span>
              <span class="badge">{providerOf(p.destination)}</span>
            </div>
            <div class="row small muted" style="margin-top: 4px;">
              <span>{fmtTime(p.last_run_at)}</span>
              <span class="spacer"></span>
              <button class="ghost small-btn" onclick={() => removePair(p.id)}>Remove</button>
              <button
                class="primary small-btn"
                onclick={() => runPair(p.id)}
                disabled={syncBusy !== null}
                aria-busy={syncBusy === p.id}
              >
                {syncBusy === p.id ? "…" : "Back Up"}
              </button>
            </div>
            {#if p.last_error}<div class="hint warn">{p.last_error}</div>{/if}
          </li>
        {/each}
      </ul>

      <label class="check" style="margin-top: auto; padding-top: 8px;">
        <input
          type="checkbox"
          checked={scheduleSync && hasCloudBundle}
          onchange={(e) => {
            const target = e.currentTarget as HTMLInputElement;
            toggleScheduleSync(target.checked, target);
          }}
        />
        <span>Auto-sync on schedule</span>
      </label>
    </div>
  </div>
</section>

<style>
  .protect {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .bundle-head {
    padding: 20px 24px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
  }
  .bundle-head h3 {
    margin: 4px 0 0;
    font-size: 18px;
  }
  .eyebrow {
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    color: var(--accent);
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }
  @media (max-width: 920px) {
    .grid {
      grid-template-columns: 1fr;
    }
  }
  .grid .card {
    padding: 22px 24px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .label {
    font-size: 12.5px;
    font-weight: 700;
    color: var(--text);
  }
  .sub-box {
    background: var(--panel-2);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 8px 12px;
  }
  .grow {
    flex: 1;
    min-width: 0;
  }
  .path {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  input:not([type="checkbox"]) {
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 8px 12px;
    min-height: 38px;
    background: var(--panel-solid);
    color: var(--text);
    font: inherit;
    font-size: 13.5px;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    cursor: pointer;
  }
  .check input {
    width: 16px;
    height: 16px;
    accent-color: var(--accent);
  }
  .hint {
    font-size: 12px;
    color: var(--muted);
  }
  .hint.warn {
    color: var(--warn);
  }
  .vault-list {
    border-top: 1px solid var(--border);
    padding-top: 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 220px;
    overflow: auto;
  }
  .pairs {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .pair {
    border: 1px solid var(--border);
    background: var(--panel-2);
    border-radius: 12px;
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .arrow {
    color: var(--accent);
    font-weight: 700;
    padding-left: 8px;
  }
  .small-btn {
    padding: 6px 14px;
    font-size: 12px;
    border-radius: 9999px;
  }
  .error-banner {
    padding: 12px 16px;
    border-left: 4px solid var(--danger);
    background: rgba(239, 68, 68, 0.12);
    color: var(--danger);
    font-size: 13.5px;
  }
  .status-box {
    padding: 12px 16px;
    border-left: 4px solid var(--accent);
    background: var(--accent-light);
    font-size: 13.5px;
    font-weight: 600;
  }
  p {
    margin: 0;
    line-height: 1.5;
  }
</style>
