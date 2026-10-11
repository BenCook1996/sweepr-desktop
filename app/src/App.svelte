<script lang="ts">
  import Cleaner from "./components/Cleaner.svelte";
  import Optimization from "./components/Optimization.svelte";
  import Utilities from "./components/Utilities.svelte";
  import Account from "./components/Account.svelte";
  import ActivateModal from "./components/ActivateModal.svelte";
  import { api, type LicenseStatus, type AppInfo } from "./lib/api";

  type Tab = "cleaner" | "optimization" | "utilities" | "account";
  let tab = $state<Tab>("cleaner");
  let license = $state<LicenseStatus | null>(null);
  let info = $state<AppInfo | null>(null);
  let showActivateModal = $state(false);

  async function refreshLicense(force = false) {
    try {
      license = await api.licenseStatus(force);
    } catch {
      license = null;
    }
  }

  $effect(() => {
    refreshLicense();
    api.appInfo().then((i) => (info = i)).catch(() => {});
    // Auto-pop activation modal on first launch if not activated
    if (!localStorage.getItem("sweepr_first_open")) {
      localStorage.setItem("sweepr_first_open", "1");
      setTimeout(() => {
        if (!license?.active) showActivateModal = true;
      }, 400);
    }
  });

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: "cleaner", label: "Dashboard", icon: "M4 6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6zM14 6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2V6zM4 16a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2zM14 16a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v-2z" },
    { id: "optimization", label: "Optimization", icon: "M13 2L3 14h9l-1 8 10-12h-9l1-8z" },
    { id: "utilities", label: "Utilities & Privacy", icon: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" },
    { id: "account", label: "Account", icon: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" },
  ];
</script>

<div class="app-layout">
  <!-- Clean Modern Navigation Header (Concept 5) -->
  <header class="top-nav">
    <div class="brand">
      <div class="logo">S</div>
      <div class="brand-text">
        <span class="brand-name">Sweepr</span>
      </div>
    </div>

    <nav class="nav-tabs">
      {#each tabs as t}
        <button class="nav-tab" class:active={tab === t.id} onclick={() => (tab = t.id)}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d={t.icon} /></svg>
          <span>{t.label}</span>
        </button>
      {/each}
    </nav>

    <div class="header-right">
      <div class="status-indicator">
        <span class="pulse-dot"></span>
        <span>Protected</span>
      </div>
      {#if license?.active}
        <span class="tier-badge pro">{license.dev_unlock ? "Dev unlock" : license.status === "trialing" ? "Activated" : "Pro"}</span>
      {:else}
        <button class="key-icon-btn" onclick={() => (showActivateModal = true)} title="Activate Sweepr License">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2l-2 2m-1.5 1.5L14 9l-1.5-1.5L11 9l-1.5-1.5L8 9l-1.5-1.5L5 9a7 7 0 1 0 10 10l2-2m-2-2l2-2m-2-2l2-2"/></svg>
        </button>
        <button class="tier-badge free clickable" onclick={() => (showActivateModal = true)}>Free Tier</button>
      {/if}
    </div>
  </header>

  <main class="main-content">
    {#if tab === "cleaner"}
      <Cleaner {license} onLicenseChange={refreshLicense} />
    {:else if tab === "optimization"}
      <Optimization {license} />
    {:else if tab === "utilities"}
      <Utilities {license} />
    {:else if tab === "account"}
      <Account {license} onLicenseChange={refreshLicense} />
    {/if}
  </main>

  <ActivateModal bind:open={showActivateModal} onActivated={refreshLicense} />
</div>

<style>
  .app-layout {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: transparent;
    color: var(--text);
    overflow: hidden;
  }

  /* Clean floating header dock */
  .top-nav {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: 14px 24px 0 24px;
    padding: 6px 18px;
    height: 54px;
    background: rgba(255, 255, 255, 0.94);
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    border: 1px solid var(--border);
    border-top: 1px solid var(--border-highlight);
    border-radius: 9999px;
    box-shadow: 0 4px 18px rgba(15, 23, 42, 0.05);
    z-index: 50;
    flex-shrink: 0;
    gap: 12px;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
  }
  .logo {
    width: 30px;
    height: 30px;
    background: linear-gradient(135deg, #059669 0%, #10b981 100%);
    color: #fff;
    border-radius: 8px;
    display: grid;
    place-items: center;
    font-weight: 800;
    font-size: 16px;
    box-shadow: 0 3px 8px rgba(16, 185, 129, 0.35);
  }
  .brand-text {
    display: flex;
    align-items: center;
  }
  .brand-name {
    font-weight: 800;
    font-size: 16px;
    letter-spacing: -0.4px;
    color: var(--text);
  }

  /* Clean, seamlessly integrated tab buttons */
  .nav-tabs {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 1;
    overflow-x: auto;
  }

  button.nav-tab {
    background: transparent;
    border: none;
    color: var(--muted);
    padding: 6px 12px;
    border-radius: 9999px;
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
    font-size: 12px;
    transition: all 0.15s ease-in-out;
    box-shadow: none;
    white-space: nowrap;
    cursor: pointer;
  }
  button.nav-tab:hover {
    color: var(--text);
    background: rgba(241, 245, 249, 0.8);
    transform: none;
  }
  button.nav-tab.active {
    background: rgba(16, 185, 129, 0.12);
    color: #047857;
    font-weight: 700;
  }
  button.nav-tab.active svg {
    stroke: #047857;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
    white-space: nowrap;
  }

  .status-indicator {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 11.5px;
    font-weight: 600;
    color: #047857;
    background: rgba(16, 185, 129, 0.1);
    border: 1px solid rgba(16, 185, 129, 0.25);
    padding: 4px 10px;
    border-radius: 9999px;
    white-space: nowrap;
  }
  .pulse-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
  }

  .key-icon-btn {
    background: rgba(241, 245, 249, 0.8);
    border: 1px solid var(--border);
    color: #475569;
    padding: 5px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    cursor: pointer;
    box-shadow: none;
    transition: all 0.2s;
  }
  .key-icon-btn:hover {
    background: #ffffff;
    color: var(--accent);
    border-color: var(--accent);
    transform: scale(1.05);
  }
  .tier-badge.clickable {
    cursor: pointer;
    border: none;
    font-family: inherit;
    box-shadow: none;
  }
  .tier-badge.clickable:hover {
    background: rgba(245, 158, 11, 0.2);
  }
  .tier-badge {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    padding: 3px 8px;
    border-radius: 9999px;
    letter-spacing: 0.5px;
    white-space: nowrap;
  }
  .tier-badge.free {
    background: rgba(245, 158, 11, 0.12);
    color: #b45309;
    border: 1px solid rgba(245, 158, 11, 0.25);
  }
  .tier-badge.pro {
    background: rgba(16, 185, 129, 0.15);
    color: #047857;
    border: 1px solid rgba(16, 185, 129, 0.3);
  }

  .main-content {
    flex: 1;
    overflow-y: auto;
    padding: 22px 28px 48px 28px;
  }
</style>
