<script lang="ts">
  import { api, errorMessage, type AppInfo, type LicenseStatus } from "../lib/api";
  import { getLifetimeStats, type LifetimeStats } from "../lib/store";
  import { formatBytes, formatCount } from "../lib/format";
  import { PRICING } from "../lib/format";
  import Installer from "./Installer.svelte";

  let { license, info, onRefresh }: { license: LicenseStatus | null; info: AppInfo | null; onRefresh: () => Promise<void> } = $props();
  let error = $state<string | null>(null);
  let busy = $state(false);
  let showInstaller = $state(false);
  let stats = $state<LifetimeStats>({bytesFreed: 0, filesRemoved: 0});
  $effect(() => {
    stats = getLifetimeStats();
    const cb = () => stats = getLifetimeStats();
    window.addEventListener('sweepr-stats-update', cb);
    return () => window.removeEventListener('sweepr-stats-update', cb);
  });

  async function portal() {
    error = null;
    try { await api.openBillingPortal(); } catch (e) { error = errorMessage(e); }
  }
  async function refresh() {
    busy = true;
    await onRefresh();
    busy = false;
  }
  const expiry = $derived(license?.expires_at ? new Date(license.expires_at * 1000).toLocaleString("en-GB") : null);
</script>

<h1>Account</h1>

{#if error}<div class="error-banner">{error}</div>{/if}

<div class="card box">
  {#if license?.active}
    <div class="row"><strong>Status:</strong> <span class="badge free">{license.status}</span>{#if license.offline}<span class="badge">offline</span>{/if}</div>
    {#if expiry}<div class="muted small">Licence check valid until {expiry}. It renews automatically while you're online.</div>{/if}
    <div class="row">
      <button onclick={portal}>Manage or cancel subscription</button>
      <button class="ghost" disabled={busy} onclick={refresh}>Refresh status</button>
    </div>
  {:else}
    <div class="row"><strong>Free plan</strong></div>
    <p class="muted">Scanning, file review, memory insights and temporary file cleaning are free forever. Activate to clean every category: {PRICING.activation} for {PRICING.trialDays} days, then {PRICING.monthly}/month.</p>
    <div class="row">
      <button class="ghost" disabled={busy} onclick={refresh}>I've already paid: refresh</button>
    </div>
  {/if}
</div>

<div class="card box">
  <div class="row"><strong>Lifetime Stats</strong></div>
  <p class="muted" style="margin: 0">Sweepr has saved you <strong>{formatBytes(stats.bytesFreed)}</strong> by removing <strong>{formatCount(stats.filesRemoved)}</strong> junk files so far.</p>
</div>

<div class="card box">
  <div class="row"><strong>Installer & First Run Experience</strong></div>
  <p class="muted small" style="margin: 0">Preview the custom frameless installer inspired by TotalCleaner with Sweepr branding and mascot.</p>
  <div class="row" style="margin-top: 8px;">
    <button class="primary" onclick={() => showInstaller = true}>Launch Installer Preview</button>
  </div>
</div>

{#if showInstaller}
  <div class="installer-modal-overlay">
    <Installer onClose={() => showInstaller = false} onComplete={() => showInstaller = false} />
  </div>
{/if}

{#if info}
  <p class="muted small">Sweepr v{info.version} · {info.platform} · licence server {info.api_url}</p>
{/if}

<style>
  h1 { margin: 0 0 16px; font-size: 24px; }
  .box { padding: 18px; display: flex; flex-direction: column; gap: 12px; max-width: 560px; margin-bottom: 16px; }
  .installer-modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.65);
    backdrop-filter: blur(8px);
    display: grid;
    place-items: center;
    z-index: 1000;
    padding: 20px;
  }
</style>
