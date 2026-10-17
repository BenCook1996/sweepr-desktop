<script lang="ts">
  import Cleaner from "./components/Cleaner.svelte";
  import Optimization from "./components/Optimization.svelte";
  import Utilities from "./components/Utilities.svelte";
  import Account from "./components/Account.svelte";
  import ActivateModal from "./components/ActivateModal.svelte";
  import { api, ACTIVATE_EVENT, type LicenseStatus, type AppInfo } from "./lib/api";
  import { lang, setLang, LANGUAGES, t, type Lang } from "./lib/i18n";

  type Tab = "cleaner" | "optimization" | "utilities" | "account";
  let tab = $state<Tab>("cleaner");
  let license = $state<LicenseStatus | null>(null);
  let info = $state<AppInfo | null>(null);
  let showActivateModal = $state(false);
  let theme = $state<"light" | "dark">(
    (typeof localStorage !== "undefined" && (localStorage.getItem("sweepr_theme") as "light" | "dark")) || "light"
  );

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

  // Pro features (uninstaller, registry repair, duplicates, shredder) ask for
  // activation when the backend answers `payment_required`.
  $effect(() => {
    const open = () => (showActivateModal = true);
    window.addEventListener(ACTIVATE_EVENT, open);
    return () => window.removeEventListener(ACTIVATE_EVENT, open);
  });

  const tabs: { id: Tab; key: string; icon: string }[] = [
    { id: "cleaner", key: "nav.cleaner", icon: "M4 6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6zM14 6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2V6zM4 16a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2zM14 16a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v-2z" },
    { id: "optimization", key: "nav.optimization", icon: "M13 2L3 14h9l-1 8 10-12h-9l1-8z" },
    { id: "utilities", key: "nav.utilities", icon: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" },
    { id: "account", key: "nav.account", icon: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" },
  ];
</script>

<div class="app-layout">
  <!-- Clean Modern Navigation Header (Concept 5) -->
  <header class="top-nav">
    <div class="brand">
      <div class="logo" aria-label="Sweepr">
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
        <span class="brand-name">Sweepr</span>
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
          <option value={l.code}>{l.code.toUpperCase()} · {l.label}</option>
        {/each}
      </select>

      <button
        class="theme-toggle-btn"
        onclick={toggleTheme}
        aria-label={`Switch to ${theme === "dark" ? "Light" : "Dark"} mode`}
        title={`Theme: ${theme === "dark" ? "Dark" : "Light"}`}
      >
        {theme === "dark" ? t("theme.dark", $lang) : t("theme.light", $lang)}
      </button>

      {#if license?.active}
        <span class="tier-badge pro">{license.dev_unlock ? "Dev unlock" : license.status === "trialing" ? t("tier.activated", $lang) : t("tier.pro", $lang)}</span>
      {:else}
        <button class="key-icon-btn" onclick={() => (showActivateModal = true)} title="Activate Sweepr License" aria-label="Activate Sweepr License">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2l-2 2m-1.5 1.5L14 9l-1.5-1.5L11 9l-1.5-1.5L8 9l-1.5-1.5L5 9a7 7 0 1 0 10 10l2-2m-2-2l2-2m-2-2l2-2"/></svg>
        </button>
        <button class="tier-badge free clickable" onclick={() => (showActivateModal = true)}>{t("tier.free", $lang)}</button>
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
      <Account {license} {info} onRefresh={() => refreshLicense(true)} />
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

  .theme-toggle-btn {
    font-size: 11.5px;
    font-weight: 600;
    padding: 4px 12px;
    border-radius: 9999px;
    border: 1px solid var(--border);
    background: var(--panel-2);
    color: var(--text);
    box-shadow: none;
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
