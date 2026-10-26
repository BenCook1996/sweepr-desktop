import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { revealItemInDir } from "@tauri-apps/plugin-opener";

/**
 * Wrapper around Tauri's `invoke` that automatically opens the subscription
 * activation modal whenever the Rust backend rejects a command with
 * `AppError::PaymentRequired`.
 */
async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await tauriInvoke<T>(cmd, args);
  } catch (e) {
    if (isPaymentRequired(e)) {
      requestActivation();
    }
    throw e;
  }
}

export type Group = "system" | "browsers" | "apps" | "developer";

export interface FileEntry { path: string; size: number }
export interface CategoryResult {
  id: string; name: string; description: string; group: Group; free: boolean;
  bytes: number; files: number; roots: string[]; top_files: FileEntry[];
}
export interface ScanReport { categories: CategoryResult[]; total_bytes: number; total_files: number; duration_ms: number }
export interface ScanProgress { done: number; total: number; category_id: string; category_name: string; bytes_so_far: number }
export interface CleanReport { category_id: string; bytes_freed: number; files_removed: number; files_skipped: number; moved_to_trash: boolean }
export interface LicenseStatus { active: boolean; status: string; plan: string | null; expires_at: number | null; offline: boolean; dev_unlock: boolean; addons?: string[] }
export interface QrChallengeResponse { challenge_id: string; poll_secret: string; approve_url: string; qr_svg: string; expires_at: number; ttl_seconds: number }
export interface QrPollResult { status: string; license: LicenseStatus | null }
export interface QrCreateTokenResponse { token: string; pair_url: string; qr_svg: string; expires_at: number; ttl_seconds: number; devices_used: number; devices_max: number }

export interface BatteryCareConfig {
  charge_limit_enabled: boolean;
  charge_limit_percent: number;
  charge_limit_hardware_applied: boolean;
  charge_limit_method: string;
  charge_limit_message: string;
  thermal_throttling_enabled: boolean;
  auto_hibernate_tabs: boolean;
}
export interface RunawayApp {
  name: string; pid: number; processes: number; cpu_percent: number;
  memory_bytes: number; blocks_sleep: boolean; drain_share_percent: number;
}
export interface BatteryDiagnostics {
  has_battery: boolean;
  platform: string;
  health_percent: number | null;
  degradation_multiplier: number | null;
  design_capacity_mwh: number | null;
  full_charge_capacity_mwh: number | null;
  cycle_count: number | null;
  charge_percent: number | null;
  ac_connected: boolean;
  charging: boolean;
  power_draw_watts: number | null;
  temperature_c: number | null;
  estimated_replacement_cost_usd: number;
  sleep_drain_percent: number;
  hook_headline: string;
  runaway_apps: RunawayApp[];
  inactive_browser_tabs_count: number;
  config: BatteryCareConfig;
}
export interface ThermalThrottleResult {
  enabled: boolean; processes_throttled: number; throttled_apps: string[]; turbo_capped: boolean; message: string;
}
export interface HibernateTabsResult {
  tabs_hibernated: number; bytes_freed: number; browsers: string[];
  memory_saver_policy_applied: boolean; estimated_extra_minutes: number; auto_enabled: boolean;
}
export interface UnplugAlert {
  charge_percent: number;
  limit_percent: number;
  hardware_applied: boolean;
  title: string;
  message: string;
  timestamp: number;
}
export interface AppMemory { name: string; bytes: number; processes: number }
export interface MemoryOverview { total_bytes: number; used_bytes: number; available_bytes: number; top_apps: AppMemory[] }
export interface StartupItem { name: string; command: string; scope: string; enabled?: boolean; impact?: string }
export interface UiPreferences {
  theme: "light" | "dark";
  language: string;
  sidebar_collapsed: boolean;
}
export interface AppInfo {
  version: string;
  platform: string;
  api_url: string;
  installer_mode?: boolean;
  preferences?: UiPreferences;
}
export interface AppError { kind: "payment_required" | "network" | "license" | "not_found" | "other"; message: string }

export interface LargeFileEntry { path: string; name: string; ext: string; size: number; modified_at: number }
export interface DiskBreakdownItem { label: string; bytes: number; files: number }
export interface LargeFilesReport {
  total_scanned_bytes: number;
  total_scanned_files: number;
  top_files: LargeFileEntry[];
  by_extension: DiskBreakdownItem[];
  by_folder: DiskBreakdownItem[];
}

export interface OutdatedApp {
  name: string;
  id: string;
  current_version: string;
  available_version: string;
  source: string;
}

export interface QuarantineEntry {
  id: string;
  original_path: string;
  file_name: string;
  size: number;
  category_id: string;
  deleted_at: number;
}

export interface CleanHistoryEntry {
  id?: string;
  timestamp: number;
  bytes_freed: number;
  files_removed: number;
  categories?: string[];
  mode?: string;
}

export interface BrowserPrivacyItem {
  id?: string;
  browser: string;
  name?: string;
  cache_bytes: number;
  cookies_bytes: number;
  history_bytes: number;
  total_bytes?: number;
  installed?: boolean;
}

export interface AppUpdateInfo {
  update_available: boolean;
  latest_version: string;
  current_version: string;
  notes: string;
  url: string;
  source?: string;
  sha256?: string | null;
}

export const isAppError = (e: unknown): e is AppError =>
  typeof e === "object" && e !== null && "kind" in e && "message" in e;

export const errorMessage = (e: unknown) => (isAppError(e) ? e.message : String(e));

export const isPaymentRequired = (e: unknown) => isAppError(e) && e.kind === "payment_required";

/** Ask the app shell to open the activation (checkout) modal. */
export const ACTIVATE_EVENT = "sweepr-open-activate";
export const requestActivation = () => window.dispatchEvent(new CustomEvent(ACTIVATE_EVENT));

/** Ask the Home screen to open its "Recently Cleaned / Undo" drawer (used by the quick rail). */
export const OPEN_UNDO_EVENT = "sweepr-open-undo";

export const api = {
  fetchApps: () => invoke<InstalledApp[]>("fetch_apps"),
  /** Only the app id is sent; Rust looks up the uninstaller in the registry. */
  uninstallApp: (id: string) => invoke<void>("uninstall_app", { id }),
  scanAppRemnants: () => invoke<AppRemnant[]>("scan_app_remnants"),
  cleanAppRemnant: (path: string) => invoke<void>("clean_app_remnant", { path }),
  checkOutdatedSoftware: () => invoke<OutdatedApp[]>("check_outdated_software"),
  upgradeSoftware: (id: string) => invoke<string>("upgrade_software", { id }),
  findDuplicates: (dir: string) => invoke<DuplicateGroup[]>("find_duplicates", { dir }),
  deleteDuplicates: (dir: string, files: string[], useTrash = true) =>
    invoke<DuplicateCleanReport>("delete_duplicates", { dir, files, useTrash }),
  scanLargeFiles: (dir: string, minBytes = 50 * 1024 * 1024) =>
    invoke<LargeFilesReport>("scan_large_files", { dir, minBytes }),
  deleteLargeFile: (dir: string, file: string, useTrash = true) =>
    invoke<number>("delete_large_file", { dir, file, useTrash, path: file }),
  scan: () => invoke<ScanReport>("scan_start"),
  onScanProgress: (cb: (p: ScanProgress) => void): Promise<UnlistenFn> =>
    listen<ScanProgress>("scan://progress", (e) => cb(e.payload)),
  clean: (ids: string[], useTrash: boolean) => invoke<CleanReport[]>("clean_categories", { ids, useTrash }),
  listQuarantine: () => invoke<QuarantineEntry[]>("list_quarantine"),
  restoreQuarantineItem: (id: string) => invoke<string>("restore_quarantine_item", { id }),
  getCleaningHistory: () => invoke<CleanHistoryEntry[]>("get_cleaning_history"),
  recordCleaningHistory: (bytesFreed: number, filesRemoved: number, categories: string[] = [], mode = "Manual") =>
    invoke<CleanHistoryEntry[]>("record_cleaning_history", { bytesFreed, filesRemoved, categories, mode }),
  listExclusions: () => invoke<string[]>("list_exclusions"),
  addExclusion: (path: string) => invoke<string[]>("add_exclusion", { path }),
  removeExclusion: (path: string) => invoke<string[]>("remove_exclusion", { path }),
  checkRunningApps: (categoryIds: string[]) => invoke<RunningAppConflict[]>("check_running_apps", { categoryIds }),
  licenseStatus: (force = false) => invoke<LicenseStatus>("license_status", { force }),
  startCheckout: (email?: string, plan: "monthly" | "six_month" | "annual" = "monthly") =>
    invoke<boolean>("start_checkout", { email: email ?? null, plan }),
  startAddonCheckout: (addon: string, email?: string, plan: "monthly" | "six_month" | "annual" = "annual") =>
    invoke<boolean>("start_addon_checkout", { addon, email: email ?? null, plan }),
  batteryDiagnostics: () => invoke<BatteryDiagnostics>("battery_diagnostics"),
  setBatteryChargeLimit: (enabled: boolean, limitPercent: number) =>
    invoke<BatteryCareConfig>("set_battery_charge_limit", { enabled, limitPercent }),
  setBatteryThermalThrottling: (enabled: boolean) =>
    invoke<ThermalThrottleResult>("set_battery_thermal_throttling", { enabled }),
  hibernateBrowserTabs: (autoEnabled: boolean | null = null) =>
    invoke<HibernateTabsResult>("hibernate_browser_tabs", { autoEnabled }),
  onUnplugAlert: (cb: (alert: UnplugAlert) => void): Promise<UnlistenFn> =>
    listen<UnplugAlert>("battery://unplug-alert", (e) => cb(e.payload)),
  onTrayNavigate: (cb: (target: string) => void): Promise<UnlistenFn> =>
    listen<string>("tray://navigate", (e) => cb(e.payload)),
  requestLoginOtp: (email: string) => invoke<void>("request_login_otp", { email }),
  verifyLoginOtp: (email: string, code: string) => invoke<LicenseStatus>("verify_login_otp", { email, code }),
  startQrChallenge: () => invoke<QrChallengeResponse>("start_qr_challenge"),
  pollQrChallenge: (challengeId: string, pollSecret: string) =>
    invoke<QrPollResult>("poll_qr_challenge", { challengeId, pollSecret }),
  createQrLinkToken: () => invoke<QrCreateTokenResponse>("create_qr_link_token"),
  memory: () => invoke<MemoryOverview>("memory_overview"),
  startupItems: () => invoke<StartupItem[]>("startup_items"),
  toggleStartupItem: (name: string, scope: string, enabled: boolean) =>
    invoke<StartupItem[]>("toggle_startup_item", { name, scope, enabled }),
  getAutostart: () => invoke<boolean>("get_autostart"),
  setAutostart: (enabled: boolean) => invoke<boolean>("set_autostart", { enabled }),
  getScheduleSettings: () => invoke<string>("get_schedule_settings"),
  setScheduleSettings: (schedule: string) => invoke<string>("set_schedule_settings", { schedule }),
  listRuleDefinitions: () => invoke<RuleDefinitionInfo[]>("list_rule_definitions"),
  getScheduleConfig: () => invoke<ScheduleConfig>("get_schedule_config"),
  saveScheduleConfig: (config: ScheduleConfig) => invoke<ScheduleConfig>("save_schedule_config", { config }),
  runScheduledCleanNow: () => invoke<ScheduleConfig>("run_scheduled_clean_now"),
  systemOverview: () => invoke<SystemOverview>("system_overview"),
  openBreachCheck: () => invoke<void>("open_breach_check"),
  scanBrowserPrivacy: () => invoke<BrowserPrivacyItem[]>("scan_browser_privacy"),
  cleanBrowserPrivacy: (
    browsers: string[],
    clearCache: boolean,
    clearCookies: boolean,
    clearHistory: boolean
  ) => invoke<number>("clean_browser_privacy", { browsers, clearCache, clearCookies, clearHistory }),
  checkPasswordBreach: (password: string) => invoke<number>("check_password_breach", { password }),
  checkAppUpdate: () => invoke<AppUpdateInfo>("check_app_update"),
  installAppUpdate: () => invoke<string>("install_app_update"),
  sendSupportReport: (email: string, subject: string, message: string) =>
    invoke<void>("send_support_report", { email, subject, message }),
  shredFile: (path: string, passes?: number) => invoke<number>("shred_file", { path, passes: passes ?? null }),
  killProcess: (name: string) => invoke<number>("kill_process", { name }),
  boostGamingMode: () => invoke<GamingBoostResult>("boost_gaming_mode"),
  systemHealthDetails: () => invoke<SystemHealthDetails>("system_health_details"),
  listContextMenuItems: () => invoke<ContextMenuItem[]>("list_context_menu_items"),
  toggleContextMenuItem: (id: string, enabled: boolean) => invoke<ContextMenuItem[]>("toggle_context_menu_item", { id, enabled }),
  browserMemoryReport: () => invoke<BrowserMemoryReport>("browser_memory_report"),
  tameBrowserMemory: (targetBrowser?: string | null, enablePersistentSaver = false) =>
    invoke<BrowserTameResult>("tame_browser_memory", {
      targetBrowser: targetBrowser ?? null,
      enablePersistentSaver,
    }),
  setBrowserMemoryPolicy: (browserId: string, enabled: boolean) =>
    invoke<boolean>("set_browser_memory_policy", { browserId, enabled }),
  listTabSessions: () => invoke<TabSessionSnapshot[]>("list_tab_sessions"),
  backupTabSessions: (label?: string) =>
    invoke<TabSessionSnapshot>("backup_tab_sessions", { label: label ?? null }),
  restoreTabSession: (snapshotId: string) =>
    invoke<number>("restore_tab_session", { snapshotId }),
  deleteTabSession: (snapshotId: string) =>
    invoke<TabSessionSnapshot[]>("delete_tab_session", { snapshotId }),
  moveLargeFile: (dir: string, file: string, targetDir: string) => invoke<string>("move_large_file", { dir, file, targetDir }),
  resolveShortcutOrExe: (path: string) => invoke<string>("resolve_shortcut_or_exe", { path }),
  scanBrokenItems: () => invoke<BrokenItem[]>("scan_broken_items"),
  cleanBrokenItems: (paths: string[]) => invoke<number>("clean_broken_items", { paths }),
  getCookieAllowlist: () => invoke<string[]>("get_cookie_allowlist"),
  setCookieAllowlist: (domains: string[]) => invoke<string[]>("set_cookie_allowlist", { domains }),
  compactBrowserDatabases: () => invoke<number>("compact_browser_databases"),
  listBrowserExtensions: () => invoke<BrowserExtensionItem[]>("list_browser_extensions"),
  generateStrongPassword: (length = 20, includeSymbols = true) => invoke<string>("generate_strong_password", { length, includeSymbols }),
  recycleBinInfo: () => invoke<RecycleBinInfo>("recycle_bin_info"),
  emptyRecycleBin: () => invoke<number>("empty_recycle_bin"),
  pickFolder: (title?: string) => invoke<string | null>("pick_folder", { title: title ?? null }),
  pickFile: (title?: string) => invoke<string | null>("pick_file", { title: title ?? null }),
  detectDriveMediaType: (path: string) => invoke<DriveMediaInfo>("detect_drive_media_type", { path }),
  scanRegistry: () => invoke<RegistryIssue[]>("scan_registry"),
  fixRegistryIssue: (key_path: string) => invoke<void>("fix_registry_issue", { keyPath: key_path }),
  listRegistryBackups: () => invoke<RegistryBackupEntry[]>("list_registry_backups"),
  restoreRegistryBackup: (backupId: string) => invoke<void>("restore_registry_backup", { backupId }),
  appInfo: () => invoke<AppInfo>("app_info"),
  getUiPreferences: () => invoke<UiPreferences>("get_ui_preferences"),
  saveUiPreferences: (prefs: { theme?: "light" | "dark"; language?: string; sidebarCollapsed?: boolean }) =>
    invoke<UiPreferences>("save_ui_preferences", {
      theme: prefs.theme ?? null,
      language: prefs.language ?? null,
      sidebarCollapsed: prefs.sidebarCollapsed ?? null,
    }),
  quitApp: () => invoke<void>("quit_app"),
  completeInstallation: (
    desktopShortcut: boolean,
    startMenuShortcut: boolean,
    launchOnStartup: boolean
  ) =>
    invoke<void>("complete_installation", {
      desktopShortcut,
      startMenuShortcut,
      launchOnStartup,
    }),
  uninstallSelf: (removeAppData = false) =>
    invoke<void>("uninstall_self", { removeAppData }),
  revealInFolder: (path: string) =>
    invoke<void>("reveal_in_folder", { path }).catch(() => revealItemInDir(path).catch(() => {})),
};

export interface RuleDefinitionInfo { id: string; name: string; description: string; free: boolean; }
export interface ScheduleConfig {
  enabled: boolean;
  frequency: "daily" | "weekly" | "monthly" | string;
  time: string;
  day_of_week: string;
  day_of_month: number;
  action: "scan_and_clean" | "scan_only" | string;
  categories: string[];
  sync_cloud_backups?: boolean;
  os_task_registered: boolean;
  last_run_at: number | null;
  last_bytes_found: number | null;
  last_bytes_freed: number | null;
  last_files_removed: number | null;
  last_cloud_files_synced?: number | null;
  last_cloud_bytes_synced?: number | null;
}
export interface InstalledApp { id: string; name: string; publisher: string; version: string; install_date: string; estimated_size: number; }
export interface AppRemnant { name: string; path: string; location: string; bytes: number; files: number; }
export interface DuplicateGroup { hash: string; size: number; files: string[]; }
export interface DuplicateCleanReport { files_removed: number; bytes_freed: number; files_skipped: number; }
export interface RegistryIssue { key: string; name: string; issue_type: string; details: string; }
export interface RegistryBackupEntry { id: string; key: string; name: string; issue_type: string; value: string; backed_up_at: number; }
export interface RunningAppConflict { category_id: string; app_name: string; process_count: number; }
export interface SystemOverview { disk_mount: string; disk_total_bytes: number; disk_available_bytes: number; memory_total_bytes: number; memory_used_bytes: number; cpu_usage_percent: number; }
export interface GamingBoostResult { processes_closed: number; bytes_freed: number; closed_apps: string[]; }
export interface SystemHealthDetails { uptime_seconds: number; last_boot_seconds: number | null; battery_percent: number | null; battery_status: string | null; is_ssd: boolean; }
export interface ContextMenuItem { id: string; name: string; command: string; scope: string; enabled: boolean; }
export interface BrokenItem { path: string; name: string; kind: "broken_shortcut" | "empty_folder" | string; detail: string; }
export interface BrowserExtensionItem { id: string; browser: string; name: string; version: string; description: string; permissions_count: number; path: string; }
export interface RecycleBinInfo { bytes: number; items: number; }
export interface DriveMediaInfo { is_ssd: boolean; media_label: string; recommended_passes: number; }

export interface BrowserAppRam {
  id: string;
  name: string;
  total_bytes: number;
  process_count: number;
  tab_processes: number;
  tab_bytes: number;
  extension_processes: number;
  extension_bytes: number;
  gpu_utility_bytes: number;
  heavy_tabs_count: number;
  reclaimable_bytes: number;
  memory_saver_policy: boolean;
}

export interface BrowserMemoryReport {
  total_browser_bytes: number;
  total_system_bytes: number;
  total_tab_processes: number;
  total_extension_processes: number;
  total_extension_bytes: number;
  heavy_tabs_count: number;
  estimated_reclaimable_bytes: number;
  slowdown_percent: number;
  browsers: BrowserAppRam[];
}

export interface BrowserTameResult {
  tabs_tamed: number;
  bytes_freed: number;
  browsers_optimized: string[];
  policy_applied: boolean;
}

export interface TabSessionSnapshot {
  id: string;
  label: string;
  created_at: number;
  browsers: string[];
  estimated_tabs: number;
  bytes: number;
}

// ---------------------------------------------------------------------------
// CloudClean · Photo & Document Vault · Cloud Backup Sync
// ---------------------------------------------------------------------------

export type CloudProviderId = "onedrive" | "google_drive" | "dropbox" | "icloud";

export interface CloudRoot { provider_id: CloudProviderId; label: string; path: string; streamed: boolean; }
export interface CloudFile { path: string; name: string; size: number; modified_at: number; provider_id: CloudProviderId; online_only: boolean; }
export interface CloudDuplicateGroup {
  key: string;
  size: number;
  confidence: "verified" | "likely";
  cross_cloud: boolean;
  files: CloudFile[];
}
export interface ProviderUsage {
  provider_id: CloudProviderId;
  label: string;
  roots: string[];
  used_bytes: number;
  files: number;
  online_only_bytes: number;
  reclaimable_bytes: number;
  offloadable_bytes: number;
}
export interface CloudScanReport {
  roots: CloudRoot[];
  providers: ProviderUsage[];
  duplicates: CloudDuplicateGroup[];
  screenshots: CloudFile[];
  large_videos: CloudFile[];
  installers: CloudFile[];
  old_large_files: CloudFile[];
  email_attachments: CloudFile[];
  total_bytes: number;
  total_files: number;
  online_only_bytes: number;
  reclaimable_bytes: number;
  truncated: boolean;
  duration_ms: number;
}
export interface CloudActionReport { files_processed: number; bytes: number; skipped: string[]; }
export interface VaultEntry { vault_path: string; original_name: string; size: number; modified_at: number; }
export interface VaultReport { processed: VaultEntry[]; originals_removed: number; bytes: number; skipped: string[]; }
export interface SyncPair {
  id: string;
  source: string;
  destination: string;
  last_run_at: number | null;
  last_copied: number;
  last_bytes: number;
  last_error: string | null;
}
export interface SyncRunReport {
  pair_id: string;
  files_copied: number;
  files_up_to_date: number;
  bytes_copied: number;
  online_only_skipped: number;
  errors: string[];
}

export const cloudApi = {
  detectRoots: () => invoke<CloudRoot[]>("cloud_detect_roots"),
  scan: (extraRoots: { provider_id: CloudProviderId; path: string }[] = []) =>
    invoke<CloudScanReport>("cloud_scan", { extraRoots }),
  deleteFiles: (paths: string[]) => invoke<CloudActionReport>("cloud_delete_files", { paths }),
  offloadFiles: (paths: string[], targetDir: string) =>
    invoke<CloudActionReport>("cloud_offload_files", { paths, targetDir }),
  vaultEncrypt: (paths: string[], password: string, destDir: string | null, removeOriginals: boolean) =>
    invoke<VaultReport>("vault_encrypt", { paths, password, destDir, removeOriginals }),
  vaultDecrypt: (paths: string[], password: string, destDir: string | null, removeVaultFiles: boolean) =>
    invoke<VaultReport>("vault_decrypt", { paths, password, destDir, removeVaultFiles }),
  vaultList: (dir: string, password?: string) =>
    invoke<VaultEntry[]>("vault_list", { dir, password: password ?? null }),
  syncList: () => invoke<SyncPair[]>("cloud_sync_list"),
  syncAdd: (source: string, destination: string) => invoke<SyncPair[]>("cloud_sync_add", { source, destination }),
  syncRemove: (id: string) => invoke<SyncPair[]>("cloud_sync_remove", { id }),
  syncRun: (id?: string, includeOnlineOnly = false) =>
    invoke<SyncRunReport[]>("cloud_sync_run", { id: id ?? null, includeOnlineOnly }),
};
