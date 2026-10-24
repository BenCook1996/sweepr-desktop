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
  const isMac =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);
  const modKeyLabel = isMac ? "⌘" : "Ctrl+";

  function detectInitialTheme(): "light" | "dark" {
    if (typeof localStorage !== "undefined") {
      const saved = localStorage.getItem("sweepr_theme");
      if (saved === "light" || saved === "dark") return saved;
    }
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
      return "dark";
    }
    return "dark";
  }

  let theme = $state<"light" | "dark">(detectInitialTheme());
  let sidebarCollapsed = $state<boolean>(
    typeof localStorage !== "undefined" && localStorage.getItem("sweepr_sidebar_collapsed") === "1"
  );
  let showCommandPalette = $state(false);
  let cmdQuery = $state("");
  let cmdSelectedIndex = $state(0);
  let cmdInputEl = $state<HTMLInputElement | null>(null);

  function toggleSidebar() {
    sidebarCollapsed = !sidebarCollapsed;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("sweepr_sidebar_collapsed", sidebarCollapsed ? "1" : "0");
    }
  }

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
        } else if (target === "scan") {
          tab = "cleaner";
          setTimeout(() => window.dispatchEvent(new CustomEvent("sweepr-trigger-scan")), 0);
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

  type CommandAction = {
    id: string;
    label: string;
    group: string;
    shortcut?: string;
    run: () => void;
  };

  const commandActions: CommandAction[] = [
    {
      id: "cmd-scan",
      label: "Run Smart Scan Now",
      group: "Quick Actions",
      shortcut: `${modKeyLabel}R`,
      run: () => {
        tab = "cleaner";
        setTimeout(() => window.dispatchEvent(new CustomEvent("sweepr-trigger-scan")), 0);
      },
    },
    {
      id: "cmd-undo",
      label: "Open 7-Day Safety Undo & Recycle Bin",
      group: "Quick Actions",
      shortcut: `${modKeyLabel}Z`,
      run: () => openUndoDrawer(),
    },
    {
      id: "cmd-speed",
      label: "PC Speed Boost & Startup Manager",
      group: "Navigation",
      shortcut: `${modKeyLabel}2`,
      run: () => {
        speedMode = "pc";
        tab = "speed";
      },
    },
    {
      id: "cmd-battery",
      label: "80% Charge Guard & Laptop Battery Care",
      group: "Navigation",
      shortcut: `${modKeyLabel}3`,
      run: () => {
        speedMode = "battery";
        tab = "speed";
      },
    },
    {
      id: "cmd-duplicates",
      label: "Find Duplicate & Large Files (Space & Cloud)",
      group: "Navigation",
      shortcut: `${modKeyLabel}4`,
      run: () => {
        tab = "space";
      },
    },
    {
      id: "cmd-apps",
      label: "Uninstall Apps, Updates & Leftovers",
      group: "Navigation",
      shortcut: `${modKeyLabel}5`,
      run: () => {
        tab = "apps";
      },
    },
    {
      id: "cmd-privacy",
      label: "Browser Privacy, Private Vault & File Shredder",
      group: "Navigation",
      shortcut: `${modKeyLabel}6`,
      run: () => {
        tab = "privacy";
      },
    },
    {
      id: "cmd-schedule",
      label: "Auto-Clean Background Schedule",
      group: "Navigation",
      shortcut: `${modKeyLabel}7`,
      run: () => {
        accountSection = "schedule";
        tab = "account";
      },
    },
    {
      id: "cmd-account",
      label: "Account, Subscription & Updates",
      group: "Preferences",
      shortcut: `${modKeyLabel},`,
      run: () => {
        accountSection = "account";
        tab = "account";
      },
    },
    {
      id: "cmd-theme",
      label: "Toggle Dark / Light Theme",
      group: "Preferences",
      run: () => toggleTheme(),
    },
    {
      id: "cmd-sidebar",
      label: "Collapse / Expand Left Sidebar",
      group: "Preferences",
      shortcut: `${modKeyLabel}B`,
      run: () => toggleSidebar(),
    },
  ];

  const filteredCommands = $derived.by(() => {
    const q = cmdQuery.trim().toLowerCase();
    if (!q) return commandActions;
    return commandActions.filter(
      (c) => c.label.toLowerCase().includes(q) || c.group.toLowerCase().includes(q)
    );
  });

  function openCommandPalette() {
    cmdQuery = "";
    cmdSelectedIndex = 0;
    showCommandPalette = true;
    setTimeout(() => cmdInputEl?.focus(), 10);
  }

  function executeCommand(cmd: CommandAction) {
    showCommandPalette = false;
    cmd.run();
  }

  $effect(() => {
    const onDocClick = () => {
      if (showSettingsMenu) showSettingsMenu = false;
    };
    const onResize = () => {
      if (typeof window !== "undefined" && window.innerWidth < 820 && !sidebarCollapsed) {
        sidebarCollapsed = true;
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showCommandPalette) {
          showCommandPalette = false;
          return;
        }
        if (showSettingsMenu) showSettingsMenu = false;
      }
      const mod = e.ctrlKey || e.metaKey;
      const target = e.target as HTMLElement | null;
      const inInput =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);

      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (showCommandPalette) showCommandPalette = false;
        else openCommandPalette();
        return;
      }
      if (mod && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleSidebar();
        return;
      }
      if (mod && e.key === ",") {
        e.preventDefault();
        accountSection = "account";
        tab = "account";
        return;
      }
      if (!inInput && mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        openUndoDrawer();
        return;
      }
      if (!inInput && mod && e.key.toLowerCase() === "r") {
        e.preventDefault();
        tab = "cleaner";
        setTimeout(() => window.dispatchEvent(new CustomEvent("sweepr-trigger-scan")), 0);
        return;
      }
      if (mod && !e.shiftKey && !e.altKey) {
        if (e.key === "1") {
          e.preventDefault();
          tab = "cleaner";
        } else if (e.key === "2") {
          e.preventDefault();
          speedMode = "pc";
          tab = "speed";
        } else if (e.key === "3") {
          e.preventDefault();
          speedMode = "battery";
          tab = "speed";
        } else if (e.key === "4") {
          e.preventDefault();
          tab = "space";
        } else if (e.key === "5") {
          e.preventDefault();
          tab = "apps";
        } else if (e.key === "6") {
          e.preventDefault();
          tab = "privacy";
        } else if (e.key === "7") {
          e.preventDefault();
          accountSection = "schedule";
          tab = "account";
        }
      }
    };
    window.addEventListener("click", onDocClick);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("click", onDocClick);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onResize);
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
    <!-- Grouped left sidebar (collapsible via Ctrl/Cmd+B) -->
    <aside class="side-nav" class:collapsed={sidebarCollapsed}>
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
        {#if !sidebarCollapsed}
          <div class="brand-text">
            <span class="brand-name">SWEEPR <span class="brand-accent">Cleaner</span></span>
          </div>
        {/if}
        <button
          class="ghost collapse-btn"
          onclick={toggleSidebar}
          title={sidebarCollapsed ? `Expand sidebar (${modKeyLabel}B)` : `Collapse sidebar (${modKeyLabel}B)`}
          aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {sidebarCollapsed ? "»" : "«"}
        </button>
      </div>

      {#if !sidebarCollapsed}
        <button class="cmd-trigger-btn" onclick={openCommandPalette} title={`Command Palette (${modKeyLabel}K)`}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <span>Quick Jump…</span>
          <kbd>{modKeyLabel}K</kbd>
        </button>
      {/if}

      <nav class="side-groups" aria-label="Main navigation">
        <button
          class="nav-tab"
          class:active={homeItem.isActive()}
          aria-current={homeItem.isActive() ? "page" : undefined}
          title={`${t(homeItem.key, $lang)} (${modKeyLabel}1)`}
          onclick={homeItem.go}
        >
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d={homeItem.icon} />
          </svg>
          {#if !sidebarCollapsed}
            <span>{t(homeItem.key, $lang)}</span>
          {/if}
        </button>

        {#each navGroups as group (group.key)}
          {#if !sidebarCollapsed}
            <div class="side-group-label">{t(group.key, $lang)}</div>
          {:else}
            <div class="side-group-divider"></div>
          {/if}
          {#each group.items as item (item.id)}
            <button
              class="nav-tab"
              class:active={item.isActive()}
              aria-current={item.isActive() ? "page" : undefined}
              title={t(item.key, $lang)}
              onclick={item.go}
            >
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d={item.icon} />
              </svg>
              {#if !sidebarCollapsed}
                <span>{t(item.key, $lang)}</span>
              {/if}
            </button>
          {/each}
        {/each}
      </nav>

      <div class="sidebar-footer">
        <button
          class="nav-tab"
          title={`7-Day Safety Undo (${modKeyLabel}Z)`}
          onclick={openUndoDrawer}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-15-6.7L3 13" />
          </svg>
          {#if !sidebarCollapsed}
            <span>7-Day Undo</span>
          {/if}
        </button>

        <div class="footer-row">
          <button
            class="nav-tab account-pill"
            class:active={tab === "account" && accountSection === "account"}
            title={t("nav.accountOnly", $lang)}
            onclick={() => {
              accountSection = "account";
              tab = "account";
            }}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="12" cy="8" r="4" />
              <path d="M20 21a8 8 0 1 0-16 0" />
            </svg>
            {#if !sidebarCollapsed}
              <span>{t("nav.accountOnly", $lang)}</span>
            {/if}
          </button>

          <button
            class="ghost theme-icon-btn"
            onclick={toggleTheme}
            title={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
            aria-label="Toggle color theme"
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
        </div>

        {#if !sidebarCollapsed}
          {#if license?.active}
            <span class="tier-badge pro">
              ✓ {license.dev_unlock ? "Dev unlock" : license.status === "trialing" ? t("tier.activated", $lang) : `${t("tier.pro", $lang)} Active`}
            </span>
          {:else}
            <button class="tier-badge free clickable" onclick={() => (showActivateModal = true)}>
              {t("tier.free", $lang)} · Upgrade
            </button>
          {/if}
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
          {info}
          onLicenseChange={refreshLicense}
          onOpenTool={(tool) => {
            if (tool === "memory") {
              speedMode = "pc";
              tab = "speed";
            } else if (tool === "battery") {
              speedMode = "battery";
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
        <Performance {license} {info} bind:viewMode={speedMode} />
      {:else if tab === "space"}
        <Duplicates {license} {info} />
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

    <!-- Native Desktop Status Bar -->
    <footer class="desktop-status-bar" aria-label="Status bar">
      <div class="status-left">
        <span class="status-dot"></span>
        <span>7-Day Quarantine Protection Active</span>
        {#if info?.version}
          <span class="status-sep">·</span>
          <span>v{info.version}</span>
        {/if}
      </div>
      <div class="status-right">
        <button class="status-link" onclick={openCommandPalette}>
          <span>Command Palette</span>
          <kbd>{modKeyLabel}K</kbd>
        </button>
        <span class="status-sep">·</span>
        <button class="status-link" onclick={openUndoDrawer}>
          <span>Undo</span>
          <kbd>{modKeyLabel}Z</kbd>
        </button>
      </div>
    </footer>
    </div>

    {#if showCommandPalette}
      <div class="cmd-backdrop" onclick={() => (showCommandPalette = false)} role="presentation">
        <div
          class="cmd-modal card"
          onclick={(e) => e.stopPropagation()}
          onkeydown={(e) => e.key === "Escape" && (showCommandPalette = false)}
          role="dialog"
          aria-modal="true"
          aria-label="Command Palette"
          tabindex="-1"
        >
          <div class="cmd-input-row">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--accent);"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input
              bind:this={cmdInputEl}
              type="text"
              bind:value={cmdQuery}
              placeholder="Type a command or tool name (e.g. Scan, Battery, Vault, Shredder, Undo)…"
              class="cmd-input"
              onkeydown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  cmdSelectedIndex = Math.min(filteredCommands.length - 1, cmdSelectedIndex + 1);
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  cmdSelectedIndex = Math.max(0, cmdSelectedIndex - 1);
                } else if (e.key === "Enter" && filteredCommands[cmdSelectedIndex]) {
                  e.preventDefault();
                  executeCommand(filteredCommands[cmdSelectedIndex]);
                }
              }}
            />
            <kbd class="cmd-esc">Esc</kbd>
          </div>
          <div class="cmd-list" role="listbox">
            {#each filteredCommands as cmd, idx (cmd.id)}
              <button
                class="cmd-item"
                class:selected={idx === cmdSelectedIndex}
                onmouseenter={() => (cmdSelectedIndex = idx)}
                onclick={() => executeCommand(cmd)}
                role="option"
                aria-selected={idx === cmdSelectedIndex}
              >
                <span class="cmd-group-pill">{cmd.group}</span>
                <span class="cmd-label">{cmd.label}</span>
                {#if cmd.shortcut}
                  <kbd>{cmd.shortcut}</kbd>
                {/if}
              </button>
            {:else}
              <div class="cmd-empty muted small">No matching commands found.</div>
            {/each}
          </div>
        </div>
      </div>
    {/if}

    <ActivateModal bind:open={showActivateModal} onActivated={refreshLicense} />
  </div>
{/if}

<style>
  .app-layout {
    display: flex;
    flex-direction: row;
    height: 100vh;
    background-color: var(--bg);
    color: var(--text);
    overflow: hidden;
    position: relative;
    transition: background-color 0.15s ease, color 0.15s ease;
  }

  .side-nav {
    width: 214px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 10px 0 10px 10px;
    padding: 12px 10px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-top: 1px solid var(--border-highlight);
    border-radius: 14px;
    box-shadow: 0 2px 12px rgba(15, 23, 42, 0.04);
    z-index: 50;
    overflow-y: auto;
    overflow-x: hidden;
    transition: width 0.16s ease, padding 0.16s ease;
  }
  .side-nav.collapsed {
    width: 58px;
    padding: 12px 7px;
    align-items: center;
  }
  .side-nav .brand {
    padding: 2px 4px 10px 4px;
    justify-content: space-between;
    width: 100%;
  }
  .side-nav.collapsed .brand {
    flex-direction: column;
    gap: 6px;
    padding: 2px 0 8px 0;
  }
  .collapse-btn {
    padding: 2px 7px;
    font-size: 13px;
    font-weight: 800;
    border-radius: 6px;
    margin-left: auto;
  }
  .side-nav.collapsed .collapse-btn {
    margin-left: 0;
  }
  .cmd-trigger-btn {
    width: 100%;
    justify-content: flex-start;
    padding: 6px 10px;
    margin-bottom: 6px;
    border-radius: 8px;
    background: var(--panel-2);
    border: 1px solid var(--border);
    color: var(--muted);
    font-size: 12px;
    font-weight: 600;
  }
  .cmd-trigger-btn kbd {
    margin-left: auto;
    font-family: ui-monospace, "Cascadia Mono", "SF Mono", Consolas, monospace;
    font-size: 10.5px;
    padding: 1px 5px;
    border-radius: 4px;
    background: var(--panel-solid);
    border: 1px solid var(--border);
    color: var(--text-secondary);
  }
  .side-groups {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
  }
  .side-group-label {
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
    opacity: 0.8;
    margin: 11px 8px 3px 8px;
  }
  .side-group-divider {
    height: 1px;
    background: var(--border);
    margin: 6px 4px;
  }
  .sidebar-footer {
    margin-top: auto;
    padding-top: 10px;
    border-top: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
    width: 100%;
  }
  .footer-row {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .side-nav.collapsed .footer-row {
    flex-direction: column;
  }
  .theme-icon-btn {
    padding: 6px 8px;
    border-radius: 8px;
    font-size: 13px;
    flex-shrink: 0;
  }
  .sidebar-footer .tier-badge {
    align-self: flex-start;
    margin-left: 6px;
  }

  .content-col {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }
  .logo {
    width: 28px;
    height: 28px;
    border-radius: 7px;
    display: grid;
    place-items: center;
    box-shadow: 0 2px 6px rgba(16, 185, 129, 0.3);
    overflow: hidden;
    flex-shrink: 0;
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
    min-width: 0;
  }
  .brand-name {
    font-weight: 800;
    font-size: 14.5px;
    letter-spacing: -0.3px;
    color: var(--text);
    white-space: nowrap;
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
    padding: 7px 10px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 9px;
    font-weight: 600;
    font-size: 12.5px;
    transition: background-color 0.12s ease, color 0.12s ease;
    box-shadow: none;
    white-space: nowrap;
    cursor: pointer;
    width: 100%;
    text-align: left;
  }
  .side-nav.collapsed button.nav-tab {
    justify-content: center;
    padding: 8px;
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
    background: rgba(15, 23, 42, 0.92);
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
    border-radius: 6px;
    letter-spacing: 0.4px;
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
    margin: 10px 20px 0 20px;
    padding: 7px 14px;
    border-radius: 10px;
    background: rgba(16, 185, 129, 0.14);
    border: 1px solid rgba(16, 185, 129, 0.35);
    color: var(--text);
    font-size: 12px;
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
    font-size: 11.5px;
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
    border-radius: 6px;
    padding: 4px 12px;
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
    padding: 16px 20px 24px 20px;
  }

  /* Native Desktop Status Bar */
  .desktop-status-bar {
    height: 26px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    background: var(--panel);
    border-top: 1px solid var(--border);
    font-size: 11px;
    color: var(--muted);
  }
  .status-left,
  .status-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #10b981;
  }
  .status-sep {
    opacity: 0.45;
  }
  button.status-link {
    background: transparent;
    border: none;
    box-shadow: none;
    padding: 1px 4px;
    font-size: 11px;
    color: var(--muted);
    gap: 4px;
    border-radius: 4px;
  }
  button.status-link:hover {
    color: var(--text);
    background: var(--panel-2);
  }
  button.status-link kbd {
    font-family: ui-monospace, "Cascadia Mono", "SF Mono", Consolas, monospace;
    font-size: 10px;
    padding: 0 4px;
    border-radius: 3px;
    border: 1px solid var(--border);
    background: var(--panel-2);
  }

  /* Command Palette Modal */
  .cmd-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.45);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 10vh;
    z-index: 300;
  }
  .cmd-modal {
    width: 100%;
    max-width: 540px;
    padding: 0;
    overflow: hidden;
    background: var(--panel-solid);
    border: 1px solid var(--border);
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.35);
  }
  .cmd-input-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
  }
  .cmd-input {
    flex: 1;
    border: none;
    background: transparent !important;
    color: var(--text);
    font-size: 13.5px;
    outline: none;
  }
  .cmd-esc {
    font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
    font-size: 10.5px;
    padding: 2px 6px;
    border-radius: 4px;
    border: 1px solid var(--border);
    color: var(--muted);
  }
  .cmd-list {
    max-height: 320px;
    overflow-y: auto;
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  button.cmd-item {
    width: 100%;
    justify-content: flex-start;
    padding: 8px 10px;
    border: none;
    border-radius: 7px;
    background: transparent;
    box-shadow: none;
    font-size: 13px;
    gap: 10px;
  }
  button.cmd-item.selected,
  button.cmd-item:hover {
    background: rgba(16, 185, 129, 0.14);
    color: var(--accent);
  }
  .cmd-group-pill {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    padding: 2px 6px;
    border-radius: 4px;
    background: var(--panel-2);
    color: var(--muted);
    min-width: 78px;
    text-align: center;
  }
  .cmd-label {
    flex: 1;
    text-align: left;
  }
  button.cmd-item kbd {
    font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
    font-size: 10.5px;
    padding: 1px 6px;
    border-radius: 4px;
    border: 1px solid var(--border);
    background: var(--panel-2);
    color: var(--muted);
  }
  .cmd-empty {
    padding: 18px;
    text-align: center;
  }
</style>
