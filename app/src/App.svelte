<script lang="ts">
  import Cleaner from "./components/Cleaner.svelte";
  import Schedule from "./components/Schedule.svelte";
  import Optimization from "./components/Optimization.svelte";
  import Account from "./components/Account.svelte";
  import ActivateModal from "./components/ActivateModal.svelte";
  import Installer from "./components/Installer.svelte";
  import { api, ACTIVATE_EVENT, type LicenseStatus, type AppInfo, type AppUpdateInfo } from "./lib/api";
  import { lang, setLang, LANGUAGES, t, type Lang } from "./lib/i18n";

  type Tab = "cleaner" | "schedule" | "optimization" | "account";
  let tab = $state<Tab>("cleaner");
  let license = $state<LicenseStatus | null>(null);
  let info = $state<AppInfo | null>(null);
  let showActivateModal = $state(false);
  let appReady = $state(false);
  let autoUpdateInfo = $state<AppUpdateInfo | null>(null);
  let installingUpdate = $state(false);
  let updateDismissed = $state(false);
  let showStartupInstaller = $state(
    typeof localStorage !== "undefined" && !localStorage.getItem("sweepr_installed_v1")
  );
  let theme = $state<"light" | "dark">(
    (typeof localStorage !== "undefined" && (localStorage.getItem("sweepr_theme") as "light" | "dark")) || "light"
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
      await api.installAppUpdate(autoUpdateInfo.url || undefined);
    } catch {
      installingUpdate = false;
    }
  }

  async function detectDesktopGeoLanguage() {
    try {
      const res = await fetch("https://api.country.is/", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const country = String(data?.country || "").trim().toUpperCase();
      if (!/^[A-Z]{2}$/.test(country)) return;
      const prevCountry = localStorage.getItem("sweepr_detected_country");
      if (prevCountry !== country) {
        localStorage.setItem("sweepr_detected_country", country);
        const map: Record<string, Lang> = {
          DE: "de", AT: "de", CH: "de", LI: "de",
          FR: "fr", MC: "fr", BE: "fr", LU: "fr",
          ES: "es", MX: "es", AR: "es", CO: "es", CL: "es", PE: "es",
          IT: "it", SM: "it",
          PT: "pt", BR: "pt",
          NL: "nl",
          JP: "ja",
        };
        setLang(map[country] || "en");
      }
    } catch {
      // Ignore offline or blocked GeoIP
    }
  }

  function completeStartupInstaller() {
    installerCompleted = true;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("sweepr_installed_v1", "1");
      localStorage.setItem("sweepr_first_open", "1");
    }
    showStartupInstaller = false;
    setTimeout(() => {
      if (!license?.active) showActivateModal = true;
    }, 450);
  }

  function toggleTheme() {
    theme = theme === "dark" ? "light" : "dark";
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("sweepr_theme", theme);
    }
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = theme;
      document.documentElement.classList.toggle("dark", theme === "dark");
    }
  }

  $effect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = theme;
      document.documentElement.classList.toggle("dark", theme === "dark");
    }
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
    detectDesktopGeoLanguage();
    runAutoUpdateCheck();
    const updateTimer = setInterval(runAutoUpdateCheck, 4 * 60 * 60 * 1000);
    api
      .appInfo()
      .then((i) => {
        info = i;
        if (i.installer_mode && !installerCompleted) {
          showStartupInstaller = true;
        }
        appReady = true;
        if (!showStartupInstaller && !localStorage.getItem("sweepr_first_open")) {
          localStorage.setItem("sweepr_first_open", "1");
          setTimeout(() => {
            if (!showStartupInstaller && !license?.active) showActivateModal = true;
          }, 400);
        }
      })
      .catch(() => {
        appReady = true;
      });
    return () => clearInterval(updateTimer);
  });

  // Pro features ask for activation when the backend answers `payment_required`.
  $effect(() => {
    const open = () => (showActivateModal = true);
    window.addEventListener(ACTIVATE_EVENT, open);
    return () => window.removeEventListener(ACTIVATE_EVENT, open);
  });

  let showSettingsMenu = $state(false);

  // Close settings dropdown on outside click or Escape
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

  const tabs: { id: Tab; key: string; icon: string }[] = [
    { id: "cleaner", key: "nav.cleaner", icon: "M4 6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6zM14 6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2V6zM4 16a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2zM14 16a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v-2z" },
    { id: "schedule", key: "nav.schedule", icon: "M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 5v5l3.5 2" },
    { id: "optimization", key: "nav.optimization", icon: "M13 2L3 14h9l-1 8 10-12h-9l1-8z" },
  ];
</script>

{#if !appReady}
  <div style="width: 100vw; height: 100vh; background: #f8fafc;"></div>
{:else if showStartupInstaller}
  <Installer
    fullScreen={true}
    onComplete={completeStartupInstaller}
    onClose={() => api.quitApp()}
  />
{:else}
<div class="app-layout">
  <!-- Clean Modern Navigation Header (Concept 5) -->
  <header class="top-nav">
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

    <nav class="nav-tabs" aria-label="Main navigation">
      {#each tabs as item}
        <button
          class="nav-tab"
          class:active={tab === item.id}
          aria-current={tab === item.id ? "page" : undefined}
          aria-label={t(item.key, $lang)}
          onclick={() => (tab = item.id)}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={item.icon} /></svg>
          <span>{t(item.key, $lang)}</span>
        </button>
      {/each}
    </nav>

    <div class="header-right sidebar-footer">
      <select
        class="lang-picker"
        aria-label="Select language"
        value={$lang}
        onchange={(e) => setLang((e.currentTarget as HTMLSelectElement).value as Lang)}
      >
        {#each LANGUAGES as l}
          <option value={l.code}>{l.region} - {l.code.toUpperCase()}</option>
        {/each}
      </select>

      {#if license?.active}
        <span class="tier-badge pro">{license.dev_unlock ? "Dev unlock" : license.status === "trialing" ? t("tier.activated", $lang) : t("tier.pro", $lang)}</span>
      {:else}
        <button class="tier-badge free clickable" onclick={() => (showActivateModal = true)}>{t("tier.free", $lang)}</button>
      {/if}

      <div class="settings-menu-wrap" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="presentation">
        <button
          class="gear-icon-btn"
          class:active={showSettingsMenu || tab === "account"}
          onclick={() => (showSettingsMenu = !showSettingsMenu)}
          title="Settings & Account"
          aria-label="Settings & Account"
          aria-expanded={showSettingsMenu}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>

        {#if showSettingsMenu}
          <div class="settings-dropdown" role="menu">
            <button
              class="dropdown-item"
              class:active={tab === "account"}
              role="menuitem"
              onclick={() => {
                tab = "account";
                showSettingsMenu = false;
              }}
            >
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              <span>{t("nav.account", $lang)}</span>
            </button>

            <div class="dropdown-row">
              <span class="dropdown-row-label">Theme</span>
              <button
                class="theme-icon-switch"
                onclick={toggleTheme}
                aria-label={`Switch to ${theme === "dark" ? "Light" : "Dark"} mode`}
                title={`Switch to ${theme === "dark" ? "Light" : "Dark"} mode`}
              >
                <span class="theme-icon-pill" class:active={theme === "light"} aria-hidden="true">
                  <!-- Sun icon -->
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="5" />
                    <line x1="12" y1="1" x2="12" y2="3" />
                    <line x1="12" y1="21" x2="12" y2="23" />
                    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                    <line x1="1" y1="12" x2="3" y2="12" />
                    <line x1="21" y1="12" x2="23" y2="12" />
                    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                  </svg>
                </span>
                <span class="theme-icon-pill" class:active={theme === "dark"} aria-hidden="true">
                  <!-- Moon icon -->
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                  </svg>
                </span>
              </button>
            </div>

            {#if !license?.active}
              <div class="dropdown-divider"></div>
              <button
                class="dropdown-item activate-item"
                role="menuitem"
                onclick={() => {
                  showActivateModal = true;
                  showSettingsMenu = false;
                }}
              >
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M21 2l-2 2m-1.5 1.5L14 9l-1.5-1.5L11 9l-1.5-1.5L8 9l-1.5-1.5L5 9a7 7 0 1 0 10 10l2-2m-2-2l2-2m-2-2l2-2" />
                </svg>
                <span>{t("action.activate", $lang)}</span>
              </button>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  </header>

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
          {installingUpdate ? "Downloading & Updating…" : "Update & Restart Now"}
        </button>
        <button class="auto-update-dismiss" onclick={() => (updateDismissed = true)} aria-label="Dismiss update notification">✕</button>
      </div>
    </div>
  {/if}

  <main class="main-content">
    {#if tab === "cleaner"}
      <Cleaner {license} onLicenseChange={refreshLicense} />
    {:else if tab === "schedule"}
      <Schedule {license} />
    {:else if tab === "optimization"}
      <Optimization {license} />
    {:else if tab === "account"}
      <Account {license} {info} onRefresh={() => refreshLicense(true)} />
    {/if}
  </main>

  <ActivateModal bind:open={showActivateModal} onActivated={refreshLicense} />
</div>
{/if}

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
  .logo-bg-rect { fill: url(#appEmeraldBg); stroke: rgba(255, 255, 255, 0.22); }
  .logo-primary { fill: #ffffff; }
  .logo-handle { stroke: #a7f3d0; }
  .logo-slit { stroke: #047857; }
  .logo-sparkle { fill: #ffffff; }
  .logo-dot { fill: #a7f3d0; }

  @media (prefers-color-scheme: dark) {
    .logo-bg-rect { fill: url(#appMintBg); stroke: rgba(5, 150, 105, 0.25); }
    .logo-primary { fill: #059669; }
    .logo-handle { stroke: #10b981; }
    .logo-slit { stroke: #d1fae5; }
    .logo-sparkle { fill: #047857; }
    .logo-dot { fill: #10b981; }
  }
  :global(.dark) .logo-bg-rect { fill: url(#appMintBg); stroke: rgba(5, 150, 105, 0.25); }
  :global(.dark) .logo-primary { fill: #059669; }
  :global(.dark) .logo-handle { stroke: #10b981; }
  :global(.dark) .logo-slit { stroke: #d1fae5; }
  :global(.dark) .logo-sparkle { fill: #047857; }
  :global(.dark) .logo-dot { fill: #10b981; }
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

  /* Clean, seamlessly integrated tab buttons */
  .nav-tabs {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 1;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .nav-tabs::-webkit-scrollbar {
    display: none;
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

  .lang-picker {
    font-size: 11.5px;
    font-weight: 600;
    padding: 4px 10px;
    border-radius: 9999px;
    border: 1px solid var(--border);
    background: var(--panel-2);
    color: var(--text);
    cursor: pointer;
    outline: none;
  }

  .settings-menu-wrap {
    position: relative;
    display: flex;
    align-items: center;
  }

  .gear-icon-btn {
    background: var(--panel-2);
    border: 1px solid var(--border);
    color: var(--text);
    width: 30px;
    height: 30px;
    padding: 0;
    border-radius: 50%;
    display: grid;
    place-items: center;
    cursor: pointer;
    box-shadow: none;
    transition: all 0.15s ease-in-out;
  }
  .gear-icon-btn:hover,
  .gear-icon-btn.active {
    color: #047857;
    border-color: rgba(16, 185, 129, 0.45);
    background: rgba(16, 185, 129, 0.12);
    transform: none;
  }

  .settings-dropdown {
    position: absolute;
    top: calc(100% + 10px);
    right: 0;
    min-width: 220px;
    background: var(--panel-solid, #ffffff);
    border: 1px solid var(--border);
    border-radius: 14px;
    box-shadow: 0 12px 28px rgba(15, 23, 42, 0.14);
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    z-index: 120;
  }

  .dropdown-item {
    width: 100%;
    background: transparent;
    border: none;
    color: var(--text);
    padding: 8px 11px;
    border-radius: 9px;
    display: flex;
    align-items: center;
    gap: 9px;
    font-size: 12.5px;
    font-weight: 600;
    text-align: left;
    cursor: pointer;
    box-shadow: none;
    transition: background 0.15s ease, color 0.15s ease;
  }
  .dropdown-item:hover {
    background: var(--panel-2);
    transform: none;
  }
  .dropdown-item.active {
    background: rgba(16, 185, 129, 0.12);
    color: #047857;
  }
  .dropdown-item.activate-item {
    color: #047857;
    background: rgba(16, 185, 129, 0.1);
  }
  .dropdown-item.activate-item:hover {
    background: rgba(16, 185, 129, 0.18);
  }

  .dropdown-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 11px;
    border-radius: 9px;
  }
  .dropdown-row-label {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--text);
  }

  .theme-icon-switch {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 3px;
    border-radius: 9999px;
    border: 1px solid var(--border);
    background: var(--panel-2);
    cursor: pointer;
    box-shadow: none;
  }
  .theme-icon-switch:hover {
    border-color: rgba(16, 185, 129, 0.45);
    transform: none;
  }
  .theme-icon-pill {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    color: var(--muted);
    transition: all 0.15s ease;
  }
  .theme-icon-pill.active {
    background: #10b981;
    color: #ffffff;
    box-shadow: 0 2px 6px rgba(16, 185, 129, 0.3);
  }

  .dropdown-divider {
    height: 1px;
    background: var(--border);
    margin: 2px 4px;
  }

  :global(:root[data-theme="dark"]) .top-nav {
    background: rgba(30, 41, 59, 0.94);
  }
  :global(:root[data-theme="dark"]) button.nav-tab.active {
    color: #34d399;
  }
  :global(:root[data-theme="dark"]) button.nav-tab.active svg {
    stroke: #34d399;
  }
  :global(:root[data-theme="dark"]) .gear-icon-btn:hover,
  :global(:root[data-theme="dark"]) .gear-icon-btn.active,
  :global(:root[data-theme="dark"]) .dropdown-item.active,
  :global(:root[data-theme="dark"]) .dropdown-item.activate-item {
    color: #34d399;
  }
  :global(:root[data-theme="dark"]) .settings-dropdown {
    background: #1e293b;
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
    box-shadow: 0 2px 6px rgba(16, 185, 129, 0.25);
  }
  .auto-update-btn:hover {
    background: #059669;
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
    padding: 22px 28px 48px 28px;
  }
</style>
