<script lang="ts">
  import Cleaner from "./components/Cleaner.svelte";
  import Performance from "./components/Performance.svelte";
  import Duplicates from "./components/Duplicates.svelte";
  import Apps from "./components/Apps.svelte";
  import Privacy from "./components/Privacy.svelte";
  import Account from "./components/Account.svelte";
  import ActivateModal from "./components/ActivateModal.svelte";
  import Installer from "./components/Installer.svelte";
  import {
    api,
    ACTIVATE_EVENT,
    OPEN_UNDO_EVENT,
    type LicenseStatus,
    type AppInfo,
    type AppUpdateInfo,
    type UnplugAlert,
  } from "./lib/api";
  import { lang, setLang, LANGUAGES, t, type Lang } from "./lib/i18n";

  type Tab = "cleaner" | "speed" | "space" | "apps" | "privacy" | "account";
  let tab = $state<Tab>("cleaner");
  let speedMode = $state<"pc" | "battery">("pc");
  let accountSection = $state<"schedule" | "account">("account");
  let license = $state<LicenseStatus | null>(null);
  let info = $state<AppInfo | null>(null);
  let showActivateModal = $state(false);
  let appReady = $state(false);
  let autoUpdateInfo = $state<AppUpdateInfo | null>(null);
  let installingUpdate = $state(false);
  let updateDismissed = $state(false);
  let unplugAlert = $state<UnplugAlert | null>(null);
  let showStartupInstaller = $state(false);
  let theme = $state<"light" | "dark">(
    (typeof localStorage !== "undefined" &&
      (localStorage.getItem("sweepr_theme") as "light" | "dark")) ||
      "light"
  );

  let startupInitialized = false;
  let installerCompleted = false;

  async function runAutoUpdateCheck() {
    try {
      const u = await api.checkAppUpdate();
      if (u && u.update_available) {
        autoUpdateInfo = u;
      }
    } catch {
      // Ignore background update check errors
    }
  }

  async function installUpdateNow() {
    if (!autoUpdateInfo || installingUpdate) return;
    installingUpdate = true;
    try {
      await api.installAppUpdate();
    } catch {
      installingUpdate = false;
    }
  }

  function completeStartupInstaller() {
    installerCompleted = true;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("sweepr_installed_v1", "1");
      localStorage.setItem("sweepr_first_open", "1");
    }
    showStartupInstaller = false;
  }

  function applyThemeToDom(current: "light" | "dark") {
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = current;
      document.documentElement.classList.toggle("dark", current === "dark");
      if (document.body) {
        document.body.dataset.theme = current;
        document.body.classList.toggle("dark", current === "dark");
      }
    }
  }

  function toggleTheme() {
    theme = theme === "dark" ? "light" : "dark";
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("sweepr_theme", theme);
    }
    applyThemeToDom(theme);
  }

  $effect(() => {
    applyThemeToDom(theme);
  });

  async function refreshLicense(force = false) {
    try {
      license = await api.licenseStatus(force);
    } catch {
      license = null;
    }
  }

  $effect(() => {
    if (startupInitialized) return;
    startupInitialized = true;
    refreshLicense();
    runAutoUpdateCheck();
    const updateTimer = setInterval(runAutoUpdateCheck, 4 * 60 * 60 * 1000);
    const onWindowFocus = () => {
      refreshLicense();
    };
    window.addEventListener("focus", onWindowFocus);
    api
      .appInfo()
      .then((i) => {
        info = i;
        if (i.installer_mode && !installerCompleted) {
          showStartupInstaller = true;
        }
        appReady = true;
      })
      .catch(() => {
        appReady = true;
      });
    return () => {
      clearInterval(updateTimer);
      window.removeEventListener("focus", onWindowFocus);
    };
  });

  $effect(() => {
    const open = () => (showActivateModal = true);
    window.addEventListener(ACTIVATE_EVENT, open);
    let unlistenNav: (() => void) | null = null;
    let unlistenAlert: (() => void) | null = null;
    api
      .onTrayNavigate((target) => {
        if (target === "battery") {
          speedMode = "battery";
          tab = "speed";
        }
      })
      .then((fn) => (unlistenNav = fn))
      .catch(() => {});
    api
      .onUnplugAlert((alert) => {
        unplugAlert = alert;
      })
      .then((fn) => (unlistenAlert = fn))
      .catch(() => {});
    return () => {
      window.removeEventListener(ACTIVATE_EVENT, open);
      unlistenNav?.();
      unlistenAlert?.();
    };
  });

  let showSettingsMenu = $state(false);

  $effect(() => {
    const onDocClick = () => {
      if (showSettingsMenu) showSettingsMenu = false;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && showSettingsMenu) showSettingsMenu = false;
    };
    window.addEventListener("click", onDocClick);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("click", onDocClick);
      window.removeEventListener("keydown", onKeyDown);
    };
  });

  type NavItem = {
    id: string;
    key: string;
    icon: string;
    isActive: () => boolean;
    go: () => void;
  };

  const ICONS = {
    scan: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM12 7v5l3 2",
    speed: "M13 2L3 14h9l-1 8 10-12h-9l1-8z",
    battery: "M3 7h15a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1zM22 11v2M6 10v4M10 10v4",
    space: "M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z",
    apps: "M4 4h6v6H4zM14 4h6v6h-6zM14 14h6v6h-6zM4 14h6v6H4z",
    privacy: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
    schedule: "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z",
  };

  const homeItem: NavItem = {
    id: "cleaner",
    key: "nav.smartScan",
    icon: ICONS.scan,
    isActive: () => tab === "cleaner",
    go: () => (tab = "cleaner"),
  };

  const navGroups: { key: string; items: NavItem[] }[] = [
    {
      key: "nav.group.speed",
      items: [
        {
          id: "speed-pc",
          key: "nav.speed",
          icon: ICONS.speed,
          isActive: () => tab === "speed" && speedMode === "pc",
          go: () => {
            speedMode = "pc";
            tab = "speed";
          },
        },
        {
          id: "speed-battery",
          key: "nav.battery",
          icon: ICONS.battery,
          isActive: () => tab === "speed" && speedMode === "battery",
          go: () => {
            speedMode = "battery";
            tab = "speed";
          },
        },
      ],
    },
    {
      key: "nav.group.storage",
      items: [
        {
          id: "space",
          key: "nav.space",
          icon: ICONS.space,
          isActive: () => tab === "space",
          go: () => (tab = "space"),
        },
        {
          id: "apps",
          key: "nav.apps",
          icon: ICONS.apps,
          isActive: () => tab === "apps",
          go: () => (tab = "apps"),
        },
      ],
    },
    {
      key: "nav.group.protect",
      items: [
        {
          id: "privacy",
          key: "nav.privacy",
          icon: ICONS.privacy,
          isActive: () => tab === "privacy",
          go: () => (tab = "privacy"),
        },
        {
          id: "schedule",
          key: "nav.schedule",
          icon: ICONS.schedule,
          isActive: () => tab === "account" && accountSection === "schedule",
          go: () => {
            accountSection = "schedule";
            tab = "account";
          },
        },
      ],
    },
  ];

  /** Quick rail: always-visible shortcuts (All tools / My savings / Undo). */
  function openUndoDrawer() {
    tab = "cleaner";
    // Cleaner listens for this and opens its "Recently Cleaned / Undo" drawer.
    setTimeout(() => window.dispatchEvent(new CustomEvent(OPEN_UNDO_EVENT)), 0);
  }
</script>

{#if !appReady}
  <div style="width: 100vw; height: 100vh; background: var(--bg);"></div>
{:else if showStartupInstaller}
  <Installer
    fullScreen={true}
    onComplete={completeStartupInstaller}
    onClose={() => api.quitApp()}
  />
{:else}
  <div class="app-layout">
    <!-- Grouped left sidebar (Smart Scan / Speed / Storage / Protect) -->
    <aside class="side-nav">
      <div class="brand">
        <div class="logo" aria-label="SWEEPR Cleaner">
          <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" class="logo-svg">
            <defs>
              <linearGradient id="appEmeraldBg" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#10b981" />
                <stop offset="100%" stop-color="#047857" />
              </linearGradient>
              <linearGradient id="appMintBg" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#ecfdf5" />
                <stop offset="100%" stop-color="#d1fae5" />
              </linearGradient>
            </defs>
            <rect class="logo-bg-rect" x="2" y="2" width="96" height="96" rx="24" stroke-width="2" />
            <line class="logo-handle" x1="76" y1="24" x2="53" y2="47" stroke-width="8" stroke-linecap="round" />
            <path class="logo-primary" d="M 42 40 L 60 58 L 55 64 L 36 45 Z" />
            <path class="logo-primary" d="M 34 48 L 52 66 L 38 82 C 30 78, 22 70, 18 62 Z" />
            <line class="logo-slit" x1="34" y1="76" x2="43" y2="63" stroke-width="3" stroke-linecap="round" />
            <line class="logo-slit" x1="27" y1="69" x2="36" y2="56" stroke-width="3" stroke-linecap="round" />
            <path class="logo-sparkle" d="M 74 56 Q 74 65 83 65 Q 74 65 74 74 Q 74 65 65 65 Q 74 65 74 56 Z" />
            <circle class="logo-dot" cx="62" cy="79" r="3.5" />
          </svg>
        </div>
        <div class="brand-text">
          <span class="brand-name">SWEEPR <span class="brand-accent">Cleaner</span></span>
        </div>
      </div>

      <nav class="side-groups" aria-label="Main navigation">
        <button
          class="nav-tab"
          class:active={homeItem.isActive()}
          aria-current={homeItem.isActive() ? "page" : undefined}
          onclick={homeItem.go}
        >
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d={homeItem.icon} />
          </svg>
          <span>{t(homeItem.key, $lang)}</span>
        </button>

        {#each navGroups as group (group.key)}
          <div class="side-group-label">{t(group.key, $lang)}</div>
          {#each group.items as item (item.id)}
            <button
              class="nav-tab"
              class:active={item.isActive()}
              aria-current={item.isActive() ? "page" : undefined}
              onclick={item.go}
            >
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d={item.icon} />
              </svg>
              <span>{t(item.key, $lang)}</span>
            </button>
          {/each}
        {/each}
      </nav>

      <div class="sidebar-footer">
        <button
          class="nav-tab account-pill"
          class:active={tab === "account" && accountSection === "account"}
          onclick={() => {
            accountSection = "account";
            tab = "account";
          }}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="8" r="4" />
            <path d="M20 21a8 8 0 1 0-16 0" />
          </svg>
          <span>{t("nav.accountOnly", $lang)}</span>
        </button>

        {#if license?.active}
          <span class="tier-badge pro">
            ✓ {license.dev_unlock ? "Dev unlock" : license.status === "trialing" ? t("tier.activated", $lang) : `${t("tier.pro", $lang)} Active`}
          </span>
        {:else}
          <button class="tier-badge free clickable" onclick={() => (showActivateModal = true)}>
            {t("tier.free", $lang)} · Upgrade
          </button>
        {/if}
      </div>
    </aside>

    <div class="content-col">
    {#if autoUpdateInfo?.update_available && !updateDismissed}
      <div class="auto-update-banner" role="status">
        <div class="auto-update-text">
          <strong>Update Available: SWEEPR Cleaner v{autoUpdateInfo.latest_version}</strong>
          {#if autoUpdateInfo.notes}
            <span class="auto-update-notes">— {autoUpdateInfo.notes}</span>
          {/if}
        </div>
        <div class="auto-update-actions">
          <button class="auto-update-btn" disabled={installingUpdate} onclick={installUpdateNow}>
            {installingUpdate ? "Updating…" : "Update & Restart Now"}
          </button>
          <button
            class="auto-update-dismiss"
            onclick={() => (updateDismissed = true)}
            aria-label="Dismiss update notification"
          >
            ✕
          </button>
        </div>
      </div>
    {/if}

    {#if unplugAlert}
      <div
        class="auto-update-banner"
        style="background: rgba(245, 158, 11, 0.14); border-color: rgba(245, 158, 11, 0.45);"
        role="alert"
      >
        <div class="auto-update-text">
          <strong>{unplugAlert.title}</strong>
          <span class="auto-update-notes">— {unplugAlert.message}</span>
        </div>
        <div class="auto-update-actions">
          <button
            class="auto-update-btn"
            onclick={() => {
              speedMode = "battery";
              tab = "speed";
            }}
          >
            Open Battery Care
          </button>
          <button
            class="auto-update-dismiss"
            onclick={() => (unplugAlert = null)}
            aria-label="Dismiss unplug alert"
          >
            ✕
          </button>
        </div>
      </div>
    {/if}

    <main class="main-content">
      {#if tab === "cleaner"}
        <Cleaner
          {license}
          onLicenseChange={refreshLicense}
          onOpenTool={(tool) => {
            if (tool === "memory") {
              speedMode = "pc";
              tab = "speed";
            } else if (tool === "storage") {
              tab = "space";
            } else if (tool === "apps") {
              tab = "apps";
            } else if (tool === "privacy" || tool === "shredder") {
              tab = "privacy";
            } else if (tool === "schedule") {
              accountSection = "schedule";
              tab = "account";
            }
          }}
        />
      {:else if tab === "speed"}
        <Performance {license} bind:viewMode={speedMode} />
      {:else if tab === "space"}
        <Duplicates {license} />
      {:else if tab === "apps"}
        <Apps {license} />
      {:else if tab === "privacy"}
        <Privacy {license} />
      {:else if tab === "account"}
        <Account
          {license}
          {info}
          {theme}
          onToggleTheme={toggleTheme}
          onRefresh={() => refreshLicense(true)}
          bind:section={accountSection}
        />
      {/if}
    </main>
    </div>

    <!-- Right-edge quick rail: always one click from tools, savings and undo -->
    <div class="quick-rail" aria-label="Quick shortcuts">
      <button class="rail-btn" title="All tools (Home)" aria-label="All tools" onclick={() => (tab = "cleaner")}>
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={ICONS.apps} /></svg>
      </button>
      <button
        class="rail-btn"
        title="Auto-Clean & savings history"
        aria-label="Auto-Clean and savings"
        onclick={() => {
          accountSection = "schedule";
          tab = "account";
        }}
      >
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v18h18M7 15v3M12 10v8M17 6v12" /></svg>
      </button>
      <button class="rail-btn" title="Undo — put back recently cleaned files" aria-label="Undo recently cleaned files" onclick={openUndoDrawer}>
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-15-6.7L3 13" /></svg>
      </button>
    </div>

    <ActivateModal bind:open={showActivateModal} onActivated={refreshLicense} />
  </div>
{/if}

<style>
  .app-layout {
    display: flex;
    flex-direction: row;
    height: 100vh;
    background-color: var(--bg);
    background-image: url("./assets/topography.svg");
    background-size: 900px 900px;
    background-repeat: repeat;
    background-attachment: fixed;
    color: var(--text);
    overflow: hidden;
    position: relative;
    transition: background-color 0.2s ease, color 0.2s ease;
  }

  .side-nav {
    width: 222px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 14px 0 14px 14px;
    padding: 16px 12px;
    background: var(--panel);
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    border: 1px solid var(--border);
    border-top: 1px solid var(--border-highlight);
    border-radius: 20px;
    box-shadow: 0 4px 18px rgba(15, 23, 42, 0.05);
    z-index: 50;
    overflow-y: auto;
  }
  .side-nav .brand {
    padding: 2px 6px 14px 6px;
  }
  .side-groups {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .side-group-label {
    font-size: 10.5px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
    opacity: 0.8;
    margin: 14px 10px 4px 10px;
  }
  .sidebar-footer {
    margin-top: auto;
    padding-top: 12px;
    border-top: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }
  .sidebar-footer .tier-badge {
    align-self: flex-start;
    margin-left: 8px;
  }

  .content-col {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .quick-rail {
    position: absolute;
    right: 0;
    top: 96px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    z-index: 60;
  }
  button.rail-btn {
    width: 42px;
    height: 42px;
    padding: 0;
    border-radius: 14px 0 0 14px;
    border: 1px solid var(--border);
    border-right: none;
    background: var(--panel-solid);
    color: var(--muted);
    box-shadow: 0 4px 14px rgba(15, 23, 42, 0.08);
  }
  button.rail-btn:hover:not(:disabled) {
    color: var(--accent);
    transform: translateX(-2px);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
  }
  .logo {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    display: grid;
    place-items: center;
    box-shadow: 0 3px 8px rgba(16, 185, 129, 0.35);
    overflow: hidden;
  }
  .logo-svg {
    width: 100%;
    height: 100%;
    display: block;
  }
  .logo-bg-rect {
    fill: url(#appEmeraldBg);
    stroke: rgba(255, 255, 255, 0.22);
  }
  .logo-primary {
    fill: #ffffff;
  }
  .logo-handle {
    stroke: #a7f3d0;
  }
  .logo-slit {
    stroke: #047857;
  }
  .logo-sparkle {
    fill: #ffffff;
  }
  .logo-dot {
    fill: #a7f3d0;
  }

  @media (prefers-color-scheme: dark) {
    .logo-bg-rect {
      fill: url(#appMintBg);
      stroke: rgba(5, 150, 105, 0.25);
    }
    .logo-primary {
      fill: #059669;
    }
    .logo-handle {
      stroke: #10b981;
    }
    .logo-slit {
      stroke: #d1fae5;
    }
    .logo-sparkle {
      fill: #047857;
    }
    .logo-dot {
      fill: #10b981;
    }
  }
  :global(.dark) .logo-bg-rect {
    fill: url(#appMintBg);
    stroke: rgba(5, 150, 105, 0.25);
  }
  :global(.dark) .logo-primary {
    fill: #059669;
  }
  :global(.dark) .logo-handle {
    stroke: #10b981;
  }
  :global(.dark) .logo-slit {
    stroke: #d1fae5;
  }
  :global(.dark) .logo-sparkle {
    fill: #047857;
  }
  :global(.dark) .logo-dot {
    fill: #10b981;
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
  .brand-accent {
    color: #059669;
    font-weight: 800;
  }
  :global(.dark) .brand-accent {
    color: #34d399;
  }

  button.nav-tab {
    background: transparent;
    border: none;
    color: var(--text-secondary);
    padding: 9px 12px;
    border-radius: 11px;
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 10px;
    font-weight: 600;
    font-size: 13px;
    transition: all 0.15s ease-in-out;
    box-shadow: none;
    white-space: nowrap;
    cursor: pointer;
    width: 100%;
    text-align: left;
  }
  button.nav-tab svg {
    color: var(--muted);
    flex-shrink: 0;
  }
  button.nav-tab:hover:not(:disabled) {
    color: var(--text);
    background: var(--panel-2);
    transform: none;
    box-shadow: none;
  }
  button.nav-tab.active {
    background: rgba(16, 185, 129, 0.14);
    color: var(--accent);
    font-weight: 700;
    box-shadow: inset 3px 0 0 #10b981;
  }
  button.nav-tab.active svg {
    stroke: var(--accent);
    color: var(--accent);
  }

  :global(:root[data-theme="dark"]) .side-nav {
    background: rgba(15, 23, 42, 0.88);
  }
  :global(:root[data-theme="dark"]) .tier-badge.free {
    color: #fbbf24;
  }

  .tier-badge.clickable {
    cursor: pointer;
    border: none;
    font-family: inherit;
    box-shadow: none;
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
    background: rgba(245, 158, 11, 0.14);
    color: #b45309;
    border: 1px solid rgba(245, 158, 11, 0.3);
  }
  .tier-badge.pro {
    background: rgba(16, 185, 129, 0.15);
    color: var(--accent);
    border: 1px solid rgba(16, 185, 129, 0.3);
  }

  .auto-update-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin: 10px 28px 0 28px;
    padding: 8px 14px;
    border-radius: 12px;
    background: rgba(16, 185, 129, 0.14);
    border: 1px solid rgba(16, 185, 129, 0.35);
    color: var(--text);
    font-size: 12.5px;
    flex-shrink: 0;
  }
  .auto-update-text {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .auto-update-notes {
    color: var(--muted);
    font-size: 12px;
  }
  .auto-update-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }
  .auto-update-btn {
    background: #10b981;
    color: #ffffff;
    border: none;
    border-radius: 9999px;
    padding: 5px 14px;
    font-size: 11.5px;
    font-weight: 700;
    cursor: pointer;
  }
  .auto-update-dismiss {
    background: transparent;
    border: none;
    color: var(--muted);
    padding: 2px 6px;
    font-size: 12px;
    cursor: pointer;
    box-shadow: none;
  }

  .main-content {
    flex: 1;
    overflow-y: auto;
    padding: 22px 62px 48px 24px;
  }
</style>
