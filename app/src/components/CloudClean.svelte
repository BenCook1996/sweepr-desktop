<script lang="ts" module>
  import type { CloudScanReport } from "../lib/api";
  let cachedReport: CloudScanReport | null = null;
  let cachedSelected: Record<string, boolean> = {};
</script>

<script lang="ts">
  import {
    api,
    cloudApi,
    errorMessage,
    isPaymentRequired,
    requestActivation,
    type CloudFile,
    type CloudProviderId,
    type CloudRoot,
    type LicenseStatus,
  } from "../lib/api";
  import { formatBytes, formatCount, shortenPath } from "../lib/format";
  import { addLifetimeStats } from "../lib/store";

  let { license }: { license: LicenseStatus | null } = $props();

  type Cat =
    | "duplicates"
    | "screenshots"
    | "email_attachments"
    | "installers"
    | "large_videos"
    | "old_large_files";

  const CATS: { id: Cat; label: string; hint: string; action: "delete" | "offload" }[] = [
    {
      id: "duplicates",
      label: "Duplicate Files",
      hint: "Extra copies of the exact same photo or file. We always keep one copy safe.",
      action: "delete",
    },
    {
      id: "screenshots",
      label: "Old Screenshots",
      hint: "Screenshots synced from your phone or PC that you probably don't need anymore.",
      action: "delete",
    },
    {
      id: "email_attachments",
      label: "Email Attachments",
      hint: "Saved email messages and heavy attachment downloads taking up space.",
      action: "delete",
    },
    {
      id: "installers",
      label: "Old Setup Files",
      hint: "Program installers (.exe, .zip) you already installed and don't need to keep.",
      action: "delete",
    },
    {
      id: "large_videos",
      label: "Large Videos",
      hint: "Videos over 200 MB. Move them to this PC or a USB drive to free up cloud space without losing them.",
      action: "offload",
    },
    {
      id: "old_large_files",
      label: "Old Large Files",
      hint: "Big files over 100 MB untouched for 2+ years. Move them to this PC or a USB drive.",
      action: "offload",
    },
  ];

  const PROVIDER_COLORS: Record<CloudProviderId, string> = {
    onedrive: "#0078d4",
    google_drive: "#34a853",
    dropbox: "#0061ff",
    icloud: "#64748b",
  };

  let roots = $state<CloudRoot[]>([]);
  let report = $state<CloudScanReport | null>(cachedReport);
  let selected = $state<Record<string, boolean>>(cachedSelected);
  let cat = $state<Cat>("duplicates");
  let scanning = $state(false);
  let working = $state(false);
  let error = $state("");
  let status = $state("");
  let extraRoots = $state<{ provider_id: CloudProviderId; path: string }[]>([]);
  let addProvider = $state<CloudProviderId>("google_drive");

  $effect(() => {
    cachedReport = report;
    cachedSelected = selected;
  });

  $effect(() => {
    cloudApi
      .detectRoots()
      .then((r) => (roots = r))
      .catch(() => (roots = []));
  });

  const offloadableTotal = $derived(
    report ? report.providers.reduce((s, p) => s + p.offloadable_bytes, 0) : 0
  );

  function itemsFor(c: Cat): CloudFile[] {
    if (!report) return [];
    if (c === "duplicates") return report.duplicates.flatMap((g) => g.files.slice(1));
    return report[c];
  }
  function catBytes(c: Cat): number {
    return itemsFor(c).reduce((s, f) => s + f.size, 0);
  }
  const current = $derived(CATS.find((c) => c.id === cat)!);
  const selectedPaths = $derived(
    itemsFor(cat)
      .filter((f) => selected[f.path])
      .map((f) => f.path)
  );
  const selectedBytes = $derived(
    itemsFor(cat)
      .filter((f) => selected[f.path])
      .reduce((s, f) => s + f.size, 0)
  );

  function autoSelect() {
    if (!report) return;
    const next: Record<string, boolean> = {};
    for (const g of report.duplicates) {
      if (g.confidence === "verified") {
        g.files.slice(1).forEach((f) => (next[f.path] = true));
      }
    }
    selected = next;
  }

  async function scan() {
    scanning = true;
    error = "";
    status = "";
    try {
      report = await cloudApi.scan(extraRoots);
      autoSelect();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      scanning = false;
    }
  }

  async function addFolder() {
    const picked = await api.pickFolder("Choose a cloud folder on your PC").catch(() => null);
    if (picked?.trim()) {
      extraRoots = [...extraRoots, { provider_id: addProvider, path: picked.trim() }];
    }
  }

  function toggleAll(on: boolean) {
    const next = { ...selected };
    itemsFor(cat).forEach((f) => (next[f.path] = on));
    selected = next;
  }

  function removeFromReport(paths: string[]) {
    if (!report) return;
    const gone = new Set(paths);
    const keep = (f: CloudFile) => !gone.has(f.path);
    report = {
      ...report,
      duplicates: report.duplicates
        .map((g) => ({ ...g, files: g.files.filter(keep) }))
        .filter((g) => g.files.length > 1),
      screenshots: report.screenshots.filter(keep),
      email_attachments: report.email_attachments.filter(keep),
      installers: report.installers.filter(keep),
      large_videos: report.large_videos.filter(keep),
      old_large_files: report.old_large_files.filter(keep),
    };
  }

  async function runAction() {
    if (!selectedPaths.length || working) return;
    const isOffload = current.action === "offload";
    let target = "";
    if (isOffload) {
      const picked = await api
        .pickFolder("Choose a folder on this PC or an external drive to move these files into")
        .catch(() => null);
      if (!picked?.trim()) return;
      target = picked.trim();
    }
    working = true;
    error = "";
    status = "";
    try {
      const paths = [...selectedPaths];
      const rep = isOffload
        ? await cloudApi.offloadFiles(paths, target)
        : await cloudApi.deleteFiles(paths);
      addLifetimeStats(
        rep.bytes,
        rep.files_processed,
        ["cloud_" + cat],
        isOffload ? "Cloud Move" : "CloudClean"
      );
      const done = new Set(
        paths.filter((p) => !rep.skipped.some((s) => s.startsWith(p + ":")))
      );
      removeFromReport([...done]);
      status =
        `${isOffload ? "Moved" : "Cleaned"} ${rep.files_processed} file(s) and freed ${formatBytes(rep.bytes)} of cloud space.` +
        (rep.skipped.length ? ` (${rep.skipped.length} skipped)` : "");
    } catch (e) {
      if (isPaymentRequired(e)) {
        error = "Cleaning cloud drives is part of SWEEPR Pro. Scanning is always free.";
        requestActivation();
      } else {
        error = errorMessage(e);
      }
    } finally {
      working = false;
    }
  }

  const fmtDate = (s: number) =>
    s ? new Date(s * 1000).toLocaleDateString("en-GB") : "—";
  const providerLabel = (id: string) =>
    report?.providers.find((p) => p.provider_id === id)?.label ?? id;
</script>

<section class="cloud-clean" aria-label="Cloud storage cleaner">
  <div class="card hero">
    <div class="hero-text">
      <span class="eyebrow">Cloud Storage Cleaner</span>
      {#if report && report.total_files > 0}
        <h2>
          You can free up <span class="accent">{formatBytes(report.reclaimable_bytes)}</span> in your cloud folders
        </h2>
        <p class="muted">
          Checked {formatCount(report.total_files)} files across your synced cloud folders. Everything stays private on your PC.
        </p>
      {:else}
        <h2>Free up space in OneDrive, Google Drive, Dropbox &amp; iCloud</h2>
        <p class="muted">
          Finds duplicate photos, old screenshots, large videos, and heavy email attachments saved in your cloud folders. No sign-in required.
        </p>
      {/if}
      <div class="chips" aria-label="Detected cloud folders">
        {#each roots as r}
          <span class="chip" title={r.path}>
            <span class="dot" style={`background:${PROVIDER_COLORS[r.provider_id]}`}></span>
            {r.label}
          </span>
        {/each}
        {#each extraRoots as r}
          <span class="chip" title={r.path}>
            <span class="dot" style={`background:${PROVIDER_COLORS[r.provider_id]}`}></span>
            {shortenPath(r.path, 36)}
          </span>
        {/each}
        {#if roots.length === 0 && extraRoots.length === 0}
          <span class="muted small">No cloud folders detected automatically — choose one on the right.</span>
        {/if}
      </div>
    </div>

    <div class="hero-actions">
      <button
        class="primary big"
        onclick={scan}
        disabled={scanning || (roots.length === 0 && extraRoots.length === 0)}
        aria-busy={scanning}
      >
        {#if scanning}
          <span class="spinner" aria-hidden="true"></span> Scanning Cloud Folders…
        {:else}
          {report ? "Scan Again" : "Scan My Cloud Folders"}
        {/if}
      </button>
      <div class="add-row">
        <label class="sr-only" for="cc-provider">Cloud service</label>
        <select id="cc-provider" bind:value={addProvider}>
          <option value="google_drive">Google Drive</option>
          <option value="onedrive">OneDrive</option>
          <option value="dropbox">Dropbox</option>
          <option value="icloud">iCloud</option>
        </select>
        <button class="ghost" onclick={addFolder}>+ Add Folder…</button>
      </div>
    </div>
  </div>

  {#if error}<div class="card error-banner" role="alert">{error}</div>{/if}
  {#if status}<div class="card status-box" role="status">{status}</div>{/if}

  {#if report && (report.providers.length || report.email_attachments.length)}
    <div class="stats">
      <div class="card stat highlight">
        <span class="muted small">Easy to Clean</span>
        <strong>{formatBytes(report.reclaimable_bytes)}</strong>
        <span class="muted small">Duplicates, screenshots, attachments &amp; old setup files</span>
      </div>
      <div class="card stat">
        <span class="muted small">Large Videos &amp; Old Files</span>
        <strong>{formatBytes(offloadableTotal)}</strong>
        <span class="muted small">Move to this PC or a USB drive to save cloud space</span>
      </div>
      <div class="card stat">
        <span class="muted small">Cloud Drives Checked</span>
        <div class="provider-summary-list">
          {#each report.providers as p}
            <div class="row small" style="justify-content: space-between;">
              <span>
                <span class="dot" style={`background:${PROVIDER_COLORS[p.provider_id]}`}></span>
                <strong>{p.label}</strong>
              </span>
              <span class="accent" style="font-weight: 700;">
                {formatBytes(p.reclaimable_bytes)} to clean
              </span>
            </div>
          {:else}
            <span class="muted small">Email attachments checked</span>
          {/each}
        </div>
      </div>
    </div>

    <div class="card">
      <div class="cat-tabs" role="tablist" aria-label="Cloud cleanup categories">
        {#each CATS as c}
          <button
            role="tab"
            class="cat-tab"
            class:active={cat === c.id}
            aria-selected={cat === c.id}
            onclick={() => (cat = c.id)}
          >
            {c.label} <span class="count">{formatBytes(catBytes(c.id))}</span>
          </button>
        {/each}
      </div>
      <p class="muted small" style="margin: 10px 0;">{current.hint}</p>

      {#if cat === "duplicates" && report.duplicates.length}
        <ul class="groups">
          {#each report.duplicates as g (g.key)}
            <li class="group">
              <div class="row small">
                <strong>{g.files[0].name}</strong>
                <span class="badge" class:free={g.confidence === "verified"}>
                  {g.confidence === "verified" ? "Exact Copy" : "Same Name & Size"}
                </span>
                {#if g.cross_cloud}<span class="badge pro">In Multiple Clouds</span>{/if}
                <span class="spacer"></span>
                <span class="muted">{formatBytes(g.size * (g.files.length - 1))} extra</span>
              </div>
              {#each g.files as f, i}
                <label class="file-row" class:keep={i === 0}>
                  {#if i === 0}
                    <span class="keep-tag">Keep</span>
                  {:else}
                    <input
                      type="checkbox"
                      bind:checked={selected[f.path]}
                      aria-label={`Select ${f.path}`}
                    />
                  {/if}
                  <span
                    class="dot"
                    style={`background:${PROVIDER_COLORS[f.provider_id]}`}
                    title={providerLabel(f.provider_id)}
                  ></span>
                  <span class="path small" title={f.path}>{shortenPath(f.path, 85)}</span>
                </label>
              {/each}
            </li>
          {/each}
        </ul>
      {:else if cat !== "duplicates" && itemsFor(cat).length}
        <ul class="flat">
          {#each itemsFor(cat) as f (f.path)}
            <label class="file-row">
              <input
                type="checkbox"
                bind:checked={selected[f.path]}
                aria-label={`Select ${f.path}`}
              />
              <span
                class="dot"
                style={`background:${PROVIDER_COLORS[f.provider_id]}`}
                title={providerLabel(f.provider_id)}
              ></span>
              <span class="path small" title={f.path}>{shortenPath(f.path, 78)}</span>
              <span class="spacer"></span>
              <span class="muted small">{fmtDate(f.modified_at)}</span>
              <strong class="size">{formatBytes(f.size)}</strong>
            </label>
          {/each}
        </ul>
      {:else}
        <div class="empty muted">Nothing to clean in this category.</div>
      {/if}

      <div class="action-bar">
        <button class="ghost small-btn" onclick={() => toggleAll(true)}>Select All</button>
        <button class="ghost small-btn" onclick={() => toggleAll(false)}>Clear Selection</button>
        <span class="spacer"></span>
        {#if !license?.active}<span class="badge pro">Pro</span>{/if}
        <button
          class="primary"
          onclick={runAction}
          disabled={!selectedPaths.length || working}
          aria-busy={working}
        >
          {#if working}<span class="spinner" aria-hidden="true"></span>{/if}
          {current.action === "offload"
            ? `Move ${selectedPaths.length} File(s) to PC (${formatBytes(selectedBytes)})`
            : `Move ${selectedPaths.length} File(s) to Recycle Bin (${formatBytes(selectedBytes)})`}
        </button>
      </div>
    </div>
  {:else if report}
    <div class="card empty muted">Your cloud folders look clean — no extra clutter found!</div>
  {/if}
</section>

<style>
  .cloud-clean {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  .hero {
    padding: 26px 30px;
    display: flex;
    gap: 24px;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
  }
  .hero-text {
    flex: 1 1 440px;
    min-width: 0;
  }
  .hero h2 {
    margin: 6px 0 8px;
    font-size: 22px;
    line-height: 1.3;
  }
  .hero p {
    margin: 0 0 12px;
    line-height: 1.55;
    max-width: 65ch;
  }
  .eyebrow {
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    color: var(--accent);
  }
  .accent {
    color: var(--accent);
  }
  .hero-actions {
    display: flex;
    flex-direction: column;
    gap: 10px;
    align-items: stretch;
  }
  .add-row {
    display: flex;
    gap: 6px;
    justify-content: center;
  }
  .add-row select {
    border-radius: 9999px;
    border: 1px solid var(--border);
    padding: 6px 12px;
    background: var(--panel-solid);
    color: var(--text);
    min-height: 36px;
    font-size: 12.5px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 9999px;
    background: var(--panel-2);
    border: 1px solid var(--border);
    font-size: 12px;
    font-weight: 600;
  }
  .dot {
    display: inline-block;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    flex: none;
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 14px;
  }
  @media (max-width: 860px) {
    .stats {
      grid-template-columns: 1fr;
    }
  }
  .stat {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 20px 22px;
  }
  .stat strong {
    font-size: 24px;
    font-weight: 800;
  }
  .stat.highlight {
    border-color: var(--accent);
    background: var(--accent-light);
  }
  .provider-summary-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 4px;
  }
  .cat-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    background: var(--panel-2);
    padding: 4px;
    border-radius: 9999px;
    border: 1px solid var(--border);
    width: fit-content;
    max-width: 100%;
  }
  .cat-tab {
    border: none;
    background: transparent;
    box-shadow: none;
    padding: 7px 14px;
    border-radius: 9999px;
    font-weight: 600;
    font-size: 13px;
    color: var(--muted);
    cursor: pointer;
  }
  .cat-tab.active {
    background: var(--panel-solid);
    color: var(--accent);
    box-shadow: 0 2px 8px rgba(15, 23, 42, 0.08);
  }
  .cat-tab .count {
    font-weight: 500;
    opacity: 0.85;
    font-size: 12px;
    margin-left: 4px;
  }
  .groups,
  .flat {
    list-style: none;
    margin: 8px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: 400px;
    overflow: auto;
  }
  .group {
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .file-row {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 32px;
    padding: 4px 6px;
    border-radius: 8px;
    cursor: pointer;
  }
  .file-row:hover {
    background: var(--panel-2);
  }
  .file-row input {
    width: 16px;
    height: 16px;
    accent-color: var(--accent);
  }
  .file-row.keep {
    cursor: default;
  }
  .keep-tag {
    font-size: 10px;
    font-weight: 800;
    color: var(--accent);
    text-transform: uppercase;
    width: 38px;
  }
  .path {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .size {
    min-width: 72px;
    text-align: right;
  }
  .empty {
    padding: 24px;
    text-align: center;
  }
  .action-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 14px;
    padding-top: 14px;
    border-top: 1px solid var(--border);
    flex-wrap: wrap;
  }
  .small-btn {
    padding: 6px 14px;
    font-size: 12.5px;
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
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
</style>
