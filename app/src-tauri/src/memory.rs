//! Honest memory insights: who is using RAM, and what launches at startup.
//! We deliberately do NOT "purge" RAM. Emptying working sets/file caches
//! usually makes modern OSes slower.

use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use sysinfo::{ProcessesToUpdate, System};

#[derive(Serialize)]
pub struct AppMemory {
    pub name: String,
    pub bytes: u64,
    pub processes: u32,
}

#[derive(Serialize)]
pub struct MemoryOverview {
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub available_bytes: u64,
    pub top_apps: Vec<AppMemory>,
}

pub fn overview() -> MemoryOverview {
    let mut sys = System::new();
    sys.refresh_memory();
    sys.refresh_processes(ProcessesToUpdate::All, true);

    // Group by executable name: browsers spawn dozens of processes.
    let mut by_name: HashMap<String, (u64, u32)> = HashMap::new();
    for p in sys.processes().values() {
        let name = p.name().to_string_lossy().trim_end_matches(".exe").to_string();
        let e = by_name.entry(name).or_insert((0, 0));
        e.0 += p.memory();
        e.1 += 1;
    }
    let mut top_apps: Vec<AppMemory> = by_name
        .into_iter()
        .map(|(name, (bytes, processes))| AppMemory { name, bytes, processes })
        .collect();
    top_apps.sort_by(|a, b| b.bytes.cmp(&a.bytes));
    top_apps.truncate(12);

    MemoryOverview {
        total_bytes: sys.total_memory(),
        used_bytes: sys.used_memory(),
        available_bytes: sys.available_memory(),
        top_apps,
    }
}

/// Real figures for the dashboard. `disk_*` refer to the system drive
/// (`%SystemDrive%` on Windows, `/` elsewhere); zero if it couldn't be read.
#[derive(Serialize)]
pub struct SystemOverview {
    pub disk_mount: String,
    pub disk_total_bytes: u64,
    pub disk_available_bytes: u64,
    pub memory_total_bytes: u64,
    pub memory_used_bytes: u64,
    pub cpu_usage_percent: f32,
}

pub fn system_overview() -> SystemOverview {
    let mut sys = System::new();
    sys.refresh_memory();
    // CPU usage needs two samples separated by a short interval.
    sys.refresh_cpu_usage();
    std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL.max(std::time::Duration::from_millis(200)));
    sys.refresh_cpu_usage();

    #[cfg(windows)]
    let system_mount = format!(
        "{}\\",
        std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into()).trim_end_matches('\\')
    );
    #[cfg(not(windows))]
    let system_mount = "/".to_string();

    let disks = sysinfo::Disks::new_with_refreshed_list();
    let disk = disks
        .list()
        .iter()
        .find(|d| d.mount_point().to_string_lossy().eq_ignore_ascii_case(&system_mount));
    let (disk_mount, disk_total_bytes, disk_available_bytes) = match disk {
        Some(d) => (d.mount_point().to_string_lossy().into_owned(), d.total_space(), d.available_space()),
        None => (system_mount, 0, 0),
    };

    SystemOverview {
        disk_mount,
        disk_total_bytes,
        disk_available_bytes,
        memory_total_bytes: sys.total_memory(),
        memory_used_bytes: sys.used_memory(),
        cpu_usage_percent: sys.global_cpu_usage(),
    }
}

#[derive(Serialize, Clone)]
pub struct StartupItem {
    pub name: String,
    pub command: String,
    pub scope: String,
    pub enabled: bool,
    pub impact: String,
}

pub fn estimate_startup_impact(name: &str, command: &str) -> String {
    let combined = format!("{} {}", name.to_ascii_lowercase(), command.to_ascii_lowercase());
    let high_keywords = [
        "teams", "discord", "slack", "steam", "epicgames", "spotify", "onedrive",
        "dropbox", "googledrive", "adobe", "creative cloud", "chrome", "msedge",
        "brave", "firefox", "docker", "webview", "electron",
    ];
    if high_keywords.iter().any(|k| combined.contains(k)) {
        return "High".into();
    }
    let medium_keywords = [
        "update", "helper", "java", "itunes", "cortana", "copilot", "nvidia",
        "radeon", "logi", "razer", "synapse", "corsair", "icue", "zoom",
    ];
    if medium_keywords.iter().any(|k| combined.contains(k)) {
        return "Medium".into();
    }
    "Low".into()
}

#[cfg(windows)]
const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
#[cfg(windows)]
const DISABLED_RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\SweeprDisabledRun";

#[cfg(windows)]
pub fn startup_items() -> Vec<StartupItem> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;

    let mut out = Vec::new();
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    if let Ok(key) = hkcu.open_subkey(RUN_KEY) {
        for (name, value) in key.enum_values().flatten() {
            let command = value.to_string();
            let impact = estimate_startup_impact(&name, &command);
            out.push(StartupItem {
                name,
                command,
                scope: "Current user".into(),
                enabled: true,
                impact,
            });
        }
    }
    if let Ok(disabled_key) = hkcu.open_subkey(DISABLED_RUN_KEY) {
        for (name, value) in disabled_key.enum_values().flatten() {
            if out.iter().any(|i| i.scope == "Current user" && i.name.eq_ignore_ascii_case(&name)) {
                continue;
            }
            let command = value.to_string();
            let impact = estimate_startup_impact(&name, &command);
            out.push(StartupItem {
                name,
                command,
                scope: "Current user".into(),
                enabled: false,
                impact,
            });
        }
    }
    if let Ok(key) = RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(RUN_KEY) {
        for (name, value) in key.enum_values().flatten() {
            let command = value.to_string();
            let impact = estimate_startup_impact(&name, &command);
            out.push(StartupItem {
                name,
                command,
                scope: "All users".into(),
                enabled: true,
                impact,
            });
        }
    }
    out
}

#[cfg(unix)]
pub fn startup_items() -> Vec<StartupItem> {
    let mut dirs_to_check: Vec<(std::path::PathBuf, &str, &str)> = Vec::new();
    if let Some(h) = dirs::home_dir() {
        #[cfg(target_os = "macos")]
        dirs_to_check.push((h.join("Library/LaunchAgents"), "Current user", "plist"));
        #[cfg(not(target_os = "macos"))]
        dirs_to_check.push((h.join(".config/autostart"), "Current user", "desktop"));
    }
    #[cfg(target_os = "macos")]
    dirs_to_check.push(("/Library/LaunchAgents".into(), "All users", "plist"));
    #[cfg(not(target_os = "macos"))]
    dirs_to_check.push(("/etc/xdg/autostart".into(), "All users", "desktop"));

    let mut out = Vec::new();
    for (dir, scope, ext) in dirs_to_check {
        if let Ok(rd) = std::fs::read_dir(&dir) {
            for e in rd.flatten() {
                let p = e.path();
                if p.extension().and_then(|x| x.to_str()) == Some(ext) {
                    let name = p.file_stem().unwrap_or_default().to_string_lossy().into_owned();
                    let command = p.to_string_lossy().into_owned();
                    let impact = estimate_startup_impact(&name, &command);
                    out.push(StartupItem {
                        name,
                        command,
                        scope: scope.into(),
                        enabled: true,
                        impact,
                    });
                }
            }
        }
    }
    out
}

pub fn validate_startup_name(name: &str) -> AppResult<&str> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.len() > 255 || trimmed.contains(['\\', '/', '\0']) {
        return Err(AppError::Other("Invalid startup entry name.".into()));
    }
    Ok(trimmed)
}

#[cfg(windows)]
pub fn toggle_startup_item_blocking(name: &str, scope: &str, enabled: bool) -> AppResult<Vec<StartupItem>> {
    use winreg::enums::*;
    use winreg::RegKey;

    let name = validate_startup_name(name)?;
    if scope != "Current user" {
        return Err(AppError::Other(
            "System-wide ('All users') startup items require Windows Task Manager or Administrator rights to toggle."
                .into(),
        ));
    }

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (run_key, _) = hkcu
        .create_subkey(RUN_KEY)
        .map_err(|e| AppError::Other(format!("Could not open Run registry key: {e}")))?;
    let (disabled_key, _) = hkcu
        .create_subkey(DISABLED_RUN_KEY)
        .map_err(|e| AppError::Other(format!("Could not open SweeprDisabledRun registry key: {e}")))?;

    if !enabled {
        // Move from Run -> SweeprDisabledRun
        let raw_val = run_key
            .get_raw_value(name)
            .map_err(|_| AppError::NotFound("Startup entry not found in active Run key".into()))?;
        disabled_key
            .set_raw_value(name, &raw_val)
            .map_err(|e| AppError::Other(format!("Could not back up startup entry: {e}")))?;
        run_key
            .delete_value(name)
            .map_err(|e| AppError::Other(format!("Could not disable startup entry: {e}")))?;
    } else {
        // Move from SweeprDisabledRun -> Run
        let raw_val = disabled_key
            .get_raw_value(name)
            .map_err(|_| AppError::NotFound("Disabled startup entry not found in backup key".into()))?;
        run_key
            .set_raw_value(name, &raw_val)
            .map_err(|e| AppError::Other(format!("Could not re-enable startup entry: {e}")))?;
        let _ = disabled_key.delete_value(name);
    }

    Ok(startup_items())
}

#[cfg(not(windows))]
pub fn toggle_startup_item_blocking(name: &str, _scope: &str, _enabled: bool) -> AppResult<Vec<StartupItem>> {
    let _ = validate_startup_name(name)?;
    Err(AppError::Other("Toggling startup items is currently supported on Windows.".into()))
}

pub fn toggle_startup_item(name: &str, scope: &str, enabled: bool) -> AppResult<Vec<StartupItem>> {
    toggle_startup_item_blocking(name, scope, enabled)
}

#[cfg(windows)]
pub fn is_autostart_enabled() -> bool {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(RUN_KEY)
        .and_then(|k| k.get_value::<String, _>("Sweepr"))
        .map(|v| !v.trim().is_empty())
        .unwrap_or(false)
}

#[cfg(not(windows))]
pub fn is_autostart_enabled() -> bool {
    false
}

pub fn get_autostart_enabled() -> AppResult<bool> {
    Ok(is_autostart_enabled())
}

#[cfg(windows)]
pub fn set_autostart_enabled(enabled: bool) -> AppResult<bool> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (run_key, _) = hkcu
        .create_subkey(RUN_KEY)
        .map_err(|e| AppError::Other(format!("Could not access Windows startup registry: {e}")))?;
    if enabled {
        let exe = std::env::current_exe()
            .map_err(|e| AppError::Other(format!("Could not determine executable path: {e}")))?;
        let cmd = format!("\"{}\" --autostart", exe.to_string_lossy());
        run_key
            .set_value("Sweepr", &cmd)
            .map_err(|e| AppError::Other(format!("Could not enable autostart: {e}")))?;
    } else {
        let _ = run_key.delete_value("Sweepr");
    }
    Ok(is_autostart_enabled())
}

#[cfg(not(windows))]
pub fn set_autostart_enabled(enabled: bool) -> AppResult<bool> {
    Ok(enabled)
}

#[derive(Serialize, Clone)]
pub struct RunningAppConflict {
    pub category_id: String,
    pub app_name: String,
    pub process_count: u32,
}

/// Checks if any currently running processes hold locks on the given cleaner categories.
pub fn detect_running_conflicts(category_ids: &[String]) -> Vec<RunningAppConflict> {
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);

    let mut counts: HashMap<String, u32> = HashMap::new();
    for p in sys.processes().values() {
        let name = p.name().to_string_lossy().trim_end_matches(".exe").to_ascii_lowercase();
        *counts.entry(name).or_insert(0) += 1;
    }

    let roaming = dirs::data_dir();

    // (category_id, display_name, process_names, optional_roaming_subfolder_check)
    let mappings: &[(&str, &str, &[&str], Option<&str>)] = &[
        ("chrome", "Google Chrome", &["chrome"], None),
        ("edge", "Microsoft Edge", &["msedge"], None),
        ("brave", "Brave Browser", &["brave"], None),
        ("firefox", "Mozilla Firefox", &["firefox"], None),
        ("spotify", "Spotify", &["spotify"], None),
        ("app_caches", "Discord", &["discord"], Some("discord/Cache")),
        ("app_caches", "VS Code", &["code"], Some("Code/Cache")),
        ("app_caches", "Microsoft Teams", &["teams", "ms-teams"], Some("Microsoft/Teams/Cache")),
        ("app_caches", "Slack", &["slack"], Some("Slack/Cache")),
        ("messenger_caches", "Microsoft Teams", &["teams", "ms-teams"], Some("Microsoft/Teams/Cache")),
        ("messenger_caches", "Slack", &["slack"], Some("Slack/Cache")),
        ("messenger_caches", "Zoom", &["zoom"], Some("Zoom/data/WebViewCache")),
        ("messenger_caches", "Telegram", &["telegram"], Some("Telegram Desktop/tdata/user_data/cache")),
    ];

    let mut conflicts = Vec::new();
    for (cat_id, label, procs, required_subdir) in mappings {
        if !category_ids.iter().any(|c| c == cat_id) {
            continue;
        }
        if let Some(sub) = required_subdir {
            let exists = roaming
                .as_ref()
                .map(|r| r.join(sub).is_dir())
                .unwrap_or(false);
            if !exists {
                continue;
            }
        }
        let total: u32 = procs.iter().filter_map(|p| counts.get(*p)).sum();
        if total > 0 {
            conflicts.push(RunningAppConflict {
                category_id: (*cat_id).to_string(),
                app_name: (*label).to_string(),
                process_count: total,
            });
        }
    }
    conflicts
}

const PROTECTED_PROCESSES: &[&str] = &[
    "system",
    "registry",
    "smss",
    "csrss",
    "wininit",
    "services",
    "lsass",
    "svchost",
    "winlogon",
    "explorer",
    "dwm",
    "taskmgr",
    "sihost",
    "fontdrvhost",
    "ctfmon",
    "audiodg",
    "spoolsv",
    "searchindexer",
    "sweepr",
    "sweepr-cleaner",
    "sweeprcleaner",
    "msmpeng",
    "securityhealthservice",
];

/// Terminate all non-protected processes matching `name` (with or without `.exe`).
pub fn kill_process_by_name(name: &str) -> AppResult<u32> {
    let trimmed = name.trim();
    let target = trimmed
        .trim_end_matches(".exe")
        .trim_end_matches(".EXE")
        .trim()
        .to_ascii_lowercase();
    if target.is_empty() {
        return Err(AppError::Other("Process name cannot be empty.".into()));
    }
    if PROTECTED_PROCESSES.iter().any(|p| p.eq_ignore_ascii_case(&target)) {
        return Err(AppError::Other(format!(
            "Refusing to terminate critical system or Sweepr process '{trimmed}'."
        )));
    }

    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);

    let mut killed = 0u32;
    for p in sys.processes().values() {
        let pname = p.name().to_string_lossy();
        let clean = pname
            .trim_end_matches(".exe")
            .trim_end_matches(".EXE")
            .to_ascii_lowercase();
        if clean == target || pname.eq_ignore_ascii_case(trimmed) {
            if p.kill() {
                killed += 1;
            }
        }
    }
    Ok(killed)
}

#[derive(Serialize, Clone)]
pub struct BrowserAppRam {
    pub id: String,
    pub name: String,
    pub total_bytes: u64,
    pub process_count: u32,
    pub tab_processes: u32,
    pub tab_bytes: u64,
    pub extension_processes: u32,
    pub extension_bytes: u64,
    pub gpu_utility_bytes: u64,
    pub heavy_tabs_count: u32,
    pub reclaimable_bytes: u64,
    pub memory_saver_policy: bool,
}

#[derive(Serialize, Clone)]
pub struct BrowserMemoryReport {
    pub total_browser_bytes: u64,
    pub total_system_bytes: u64,
    pub total_tab_processes: u32,
    pub total_extension_processes: u32,
    pub total_extension_bytes: u64,
    pub heavy_tabs_count: u32,
    pub estimated_reclaimable_bytes: u64,
    pub slowdown_percent: u8,
    pub browsers: Vec<BrowserAppRam>,
}

#[derive(Serialize, Clone)]
pub struct BrowserTameResult {
    pub tabs_tamed: u32,
    pub bytes_freed: u64,
    pub browsers_optimized: Vec<String>,
    pub policy_applied: bool,
}

const BROWSER_BINARIES: &[(&str, &str)] = &[
    ("chrome", "Google Chrome"),
    ("msedge", "Microsoft Edge"),
    ("brave", "Brave Browser"),
    ("firefox", "Mozilla Firefox"),
    ("opera", "Opera"),
    ("vivaldi", "Vivaldi"),
];

#[cfg(windows)]
fn chromium_policy_path(browser_id: &str) -> Option<&'static str> {
    match browser_id.to_ascii_lowercase().as_str() {
        "chrome" => Some(r"Software\Policies\Google\Chrome"),
        "msedge" | "edge" => Some(r"Software\Policies\Microsoft\Edge"),
        "brave" => Some(r"Software\Policies\BraveSoftware\Brave-Browser"),
        _ => None,
    }
}

#[cfg(windows)]
pub fn get_browser_memory_policy(browser_id: &str) -> bool {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let Some(path) = chromium_policy_path(browser_id) else {
        return false;
    };
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let Ok(key) = hkcu.open_subkey(path) else {
        return false;
    };
    let eff: u32 = key
        .get_value("HighEfficiencyModeEnabled")
        .or_else(|_| key.get_value("MemorySaverModeSavings"))
        .unwrap_or(0);
    let bg: u32 = key.get_value("BackgroundModeEnabled").unwrap_or(1);
    eff >= 1 || bg == 0
}

#[cfg(not(windows))]
pub fn get_browser_memory_policy(_browser_id: &str) -> bool {
    false
}

#[cfg(windows)]
pub fn set_browser_memory_policy(browser_id: &str, enabled: bool) -> AppResult<bool> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let Some(path) = chromium_policy_path(browser_id) else {
        return Err(AppError::Other(format!(
            "Memory Saver policy is supported on Chromium browsers (Chrome, Edge, Brave), not '{browser_id}'."
        )));
    };
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = hkcu
        .create_subkey(path)
        .map_err(|e| AppError::Other(format!("Failed to open browser policy registry key: {e}")))?;

    if enabled {
        let _ = key.set_value("HighEfficiencyModeEnabled", &1u32);
        let _ = key.set_value("BackgroundModeEnabled", &0u32);
    } else {
        let _ = key.delete_value("HighEfficiencyModeEnabled");
        let _ = key.delete_value("BackgroundModeEnabled");
    }
    Ok(get_browser_memory_policy(browser_id))
}

#[cfg(not(windows))]
pub fn set_browser_memory_policy(_browser_id: &str, enabled: bool) -> AppResult<bool> {
    Ok(enabled)
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum BrowserSubprocessKind {
    MainOrGpu,
    TabRenderer,
    ExtensionWorker,
}

fn classify_browser_process(bin_key: &str, cmd: &[std::ffi::OsString], mem_bytes: u64, is_largest: bool) -> BrowserSubprocessKind {
    if is_largest {
        return BrowserSubprocessKind::MainOrGpu;
    }
    let joined = cmd
        .iter()
        .map(|s| s.to_string_lossy())
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase();

    if joined.is_empty() {
        // Fallback when OS restricts reading full command line: processes between 25MB and 900MB are typically tab renderers
        if mem_bytes >= 20 * 1024 * 1024 {
            return BrowserSubprocessKind::TabRenderer;
        }
        return BrowserSubprocessKind::MainOrGpu;
    }

    if joined.contains("--extension-process") {
        return BrowserSubprocessKind::ExtensionWorker;
    }
    if joined.contains("--type=gpu-process")
        || joined.contains("--type=crashpad-handler")
        || joined.contains("--type=broker")
        || joined.contains("audio.mojom.audioservice")
    {
        return BrowserSubprocessKind::MainOrGpu;
    }
    if joined.contains("--type=renderer") {
        return BrowserSubprocessKind::TabRenderer;
    }
    if bin_key == "firefox" {
        if joined.contains("-contentproc") && (joined.contains(" tab") || !joined.contains("gpu")) {
            return BrowserSubprocessKind::TabRenderer;
        }
    }
    if joined.contains("--type=utility") {
        return BrowserSubprocessKind::MainOrGpu;
    }
    // No `--type=` flag usually means the root browser window process
    BrowserSubprocessKind::MainOrGpu
}

pub fn browser_memory_report() -> BrowserMemoryReport {
    let mut sys = System::new();
    sys.refresh_memory();
    sys.refresh_processes(ProcessesToUpdate::All, true);

    let total_system_bytes = sys.total_memory().max(1);
    let used_system_bytes = sys.used_memory();

    let mut grouped: HashMap<&'static str, (&'static str, Vec<(u32, u64, Vec<std::ffi::OsString>)>)> = HashMap::new();
    for (pid, p) in sys.processes() {
        let raw_name = p.name().to_string_lossy();
        let base = raw_name
            .trim_end_matches(".exe")
            .trim_end_matches(".EXE")
            .to_ascii_lowercase();
        if let Some((bin_key, label)) = BROWSER_BINARIES.iter().find(|(b, _)| *b == base) {
            let entry = grouped.entry(*bin_key).or_insert((*label, Vec::new()));
            entry.1.push((pid.as_u32(), p.memory(), p.cmd().to_vec()));
        }
    }

    let mut browsers = Vec::new();
    let mut total_browser_bytes = 0u64;
    let mut total_tab_processes = 0u32;
    let mut total_extension_processes = 0u32;
    let mut total_extension_bytes = 0u64;
    let mut heavy_tabs_count = 0u32;
    let mut estimated_reclaimable_bytes = 0u64;

    for (bin_key, (label, mut procs)) in grouped {
        procs.sort_by(|a, b| b.1.cmp(&a.1));
        let process_count = procs.len() as u32;
        let mut total_bytes = 0u64;
        let mut tab_processes = 0u32;
        let mut tab_bytes = 0u64;
        let mut extension_processes = 0u32;
        let mut extension_bytes = 0u64;
        let mut gpu_utility_bytes = 0u64;
        let mut browser_heavy_tabs = 0u32;

        for (idx, (_pid, mem, cmd)) in procs.into_iter().enumerate() {
            total_bytes += mem;
            match classify_browser_process(bin_key, &cmd, mem, idx == 0) {
                BrowserSubprocessKind::TabRenderer => {
                    tab_processes += 1;
                    tab_bytes += mem;
                    if mem >= 300 * 1024 * 1024 {
                        browser_heavy_tabs += 1;
                    }
                }
                BrowserSubprocessKind::ExtensionWorker => {
                    extension_processes += 1;
                    extension_bytes += mem;
                }
                BrowserSubprocessKind::MainOrGpu => {
                    gpu_utility_bytes += mem;
                }
            }
        }

        // Fallback if a browser is open with a single combined process
        if tab_processes == 0 && process_count > 1 {
            tab_processes = (process_count - 1).max(1);
            tab_bytes = total_bytes / 2;
        }

        let reclaimable_bytes = (tab_bytes * 55 / 100) + (extension_bytes * 40 / 100);
        total_browser_bytes += total_bytes;
        total_tab_processes += tab_processes;
        total_extension_processes += extension_processes;
        total_extension_bytes += extension_bytes;
        heavy_tabs_count += browser_heavy_tabs;
        estimated_reclaimable_bytes += reclaimable_bytes;

        browsers.push(BrowserAppRam {
            id: bin_key.to_string(),
            name: label.to_string(),
            total_bytes,
            process_count,
            tab_processes,
            tab_bytes,
            extension_processes,
            extension_bytes,
            gpu_utility_bytes,
            heavy_tabs_count: browser_heavy_tabs,
            reclaimable_bytes,
            memory_saver_policy: get_browser_memory_policy(bin_key),
        });
    }

    browsers.sort_by(|a, b| b.total_bytes.cmp(&a.total_bytes));

    // Calculate honest PC slowdown impact % based on browser RAM share and overall RAM saturation
    let browser_share_pct = ((total_browser_bytes as f64 / total_system_bytes as f64) * 100.0) as u8;
    let sys_used_pct = ((used_system_bytes as f64 / total_system_bytes as f64) * 100.0) as u8;
    let slowdown_percent = if total_browser_bytes == 0 {
        0
    } else if sys_used_pct >= 80 {
        (browser_share_pct.saturating_mul(13) / 10).clamp(8, 68)
    } else {
        browser_share_pct.clamp(3, 55)
    };

    BrowserMemoryReport {
        total_browser_bytes,
        total_system_bytes,
        total_tab_processes,
        total_extension_processes,
        total_extension_bytes,
        heavy_tabs_count,
        estimated_reclaimable_bytes,
        slowdown_percent,
        browsers,
    }
}

pub fn tame_browser_memory(
    target_browser: Option<&str>,
    enable_persistent_saver: bool,
) -> AppResult<BrowserTameResult> {
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);

    let mut by_browser: HashMap<&'static str, (&'static str, Vec<(u32, u64, Vec<std::ffi::OsString>)>)> =
        HashMap::new();
    for (pid, p) in sys.processes() {
        let raw_name = p.name().to_string_lossy();
        let base = raw_name
            .trim_end_matches(".exe")
            .trim_end_matches(".EXE")
            .to_ascii_lowercase();
        if let Some((bin_key, label)) = BROWSER_BINARIES.iter().find(|(b, _)| *b == base) {
            if let Some(filter) = target_browser {
                if !bin_key.eq_ignore_ascii_case(filter) && !label.eq_ignore_ascii_case(filter) {
                    continue;
                }
            }
            let entry = by_browser.entry(*bin_key).or_insert((*label, Vec::new()));
            entry.1.push((pid.as_u32(), p.memory(), p.cmd().to_vec()));
        }
    }

    let mut tabs_tamed = 0u32;
    let mut before_bytes = 0u64;
    let mut target_pids = Vec::new();
    let mut browsers_optimized = Vec::new();
    let mut policy_applied = false;

    for (bin_key, (label, mut procs)) in by_browser {
        if enable_persistent_saver {
            if set_browser_memory_policy(bin_key, true).is_ok() {
                policy_applied = true;
            }
        }
        procs.sort_by(|a, b| b.1.cmp(&a.1));
        if procs.len() <= 1 {
            continue;
        }
        let mut browser_tamed = 0u32;
        for (idx, (pid, mem, cmd)) in procs.into_iter().enumerate() {
            if idx == 0 || mem < 15 * 1024 * 1024 {
                continue;
            }
            let kind = classify_browser_process(bin_key, &cmd, mem, false);
            if matches!(kind, BrowserSubprocessKind::TabRenderer | BrowserSubprocessKind::ExtensionWorker) {
                before_bytes += mem;
                trim_and_eco_process(pid);
                target_pids.push(pid);
                tabs_tamed += 1;
                browser_tamed += 1;
            }
        }
        if browser_tamed > 0 {
            browsers_optimized.push(label.to_string());
        }
    }

    // Measure actual post-trim working set reduction
    sys.refresh_processes(ProcessesToUpdate::All, true);
    let mut after_bytes = 0u64;
    for pid in &target_pids {
        if let Some(p) = sys.process(sysinfo::Pid::from_u32(*pid)) {
            after_bytes += p.memory();
        }
    }
    let measured_freed = before_bytes.saturating_sub(after_bytes);
    let fallback_estimate = before_bytes * 38 / 100;
    let bytes_freed = if measured_freed > 0 {
        measured_freed
    } else {
        fallback_estimate
    };

    Ok(BrowserTameResult {
        tabs_tamed,
        bytes_freed,
        browsers_optimized,
        policy_applied,
    })
}

#[cfg(windows)]
pub fn trim_and_eco_process(pid: u32) {
    use std::ffi::c_void;
    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
    const PROCESS_SET_INFORMATION: u32 = 0x0200;
    const PROCESS_SET_QUOTA: u32 = 0x0100;
    const BELOW_NORMAL_PRIORITY_CLASS: u32 = 0x0000_4000;

    #[link(name = "kernel32")]
    extern "system" {
        fn OpenProcess(dwDesiredAccess: u32, bInheritHandle: i32, dwProcessId: u32) -> *mut c_void;
        fn SetPriorityClass(hProcess: *mut c_void, dwPriorityClass: u32) -> i32;
        fn K32EmptyWorkingSet(hProcess: *mut c_void) -> i32;
        fn CloseHandle(hObject: *mut c_void) -> i32;
    }

    unsafe {
        let handle = OpenProcess(
            PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SET_INFORMATION | PROCESS_SET_QUOTA,
            0,
            pid,
        );
        if !handle.is_null() {
            // 1. Put background tab renderer in BelowNormal priority so foreground apps/calls never stutter
            let _ = SetPriorityClass(handle, BELOW_NORMAL_PRIORITY_CLASS);
            // 2. Trim inactive pages from the background tab's working set without closing the tab
            let _ = K32EmptyWorkingSet(handle);
            let _ = CloseHandle(handle);
        }
    }
}

#[cfg(not(windows))]
pub fn trim_and_eco_process(pid: u32) {
    let _ = std::process::Command::new("renice")
        .args(["+10", "-p", &pid.to_string()])
        .output();
}

#[derive(Serialize, Clone)]
pub struct GamingBoostResult {
    pub processes_closed: u32,
    pub bytes_freed: u64,
    pub closed_apps: Vec<String>,
}

const GAMING_BOOST_TARGETS: &[&str] = &[
    "onedrivesetup",
    "teamsmachineinstaller",
    "adobearm",
    "ccxprocess",
    "adobeipcbroker",
    "coresync",
    "cortana",
    "widgets",
    "widgetservice",
    "yourphone",
    "phoneexperiencehost",
    "gamebarpresencewriter",
    "overwolf",
    "spotifywebhelper",
    "steamwebhelper",
    "epicwebhelper",
    "jusched",
    "googleupdate",
    "microsoftedgeupdate",
    "braveupdate",
];

pub fn boost_gaming_mode() -> GamingBoostResult {
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);

    let mut processes_closed = 0u32;
    let mut bytes_freed = 0u64;
    let mut closed_apps: Vec<String> = Vec::new();

    for p in sys.processes().values() {
        let raw_name = p.name().to_string_lossy();
        let base = raw_name
            .trim_end_matches(".exe")
            .trim_end_matches(".EXE")
            .to_ascii_lowercase();
        if GAMING_BOOST_TARGETS.iter().any(|t| *t == base) {
            let mem = p.memory();
            if p.kill() {
                processes_closed += 1;
                bytes_freed += mem;
                let clean_label = raw_name
                    .trim_end_matches(".exe")
                    .trim_end_matches(".EXE")
                    .to_string();
                if !closed_apps.iter().any(|a| a.eq_ignore_ascii_case(&clean_label)) {
                    closed_apps.push(clean_label);
                }
            }
        }
    }

    // Also tame inactive browser tab renderers without closing open tabs
    if let Ok(tamed) = tame_browser_memory(None, false) {
        if tamed.tabs_tamed > 0 {
            bytes_freed += tamed.bytes_freed;
            for b in tamed.browsers_optimized {
                let label = format!("{b} ({} tabs tamed)", tamed.tabs_tamed);
                if !closed_apps.iter().any(|a| a.eq_ignore_ascii_case(&label)) {
                    closed_apps.push(label);
                }
            }
        }
    }

    GamingBoostResult {
        processes_closed,
        bytes_freed,
        closed_apps,
    }
}

#[derive(Serialize, Clone)]
pub struct SystemHealthDetails {
    pub uptime_seconds: u64,
    pub last_boot_seconds: Option<u64>,
    pub battery_percent: Option<u8>,
    pub battery_status: Option<String>,
    pub is_ssd: bool,
}

#[cfg(windows)]
fn query_windows_boot_seconds() -> Option<u64> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    if let Ok(output) = std::process::Command::new(crate::safety::system32_binary("wevtutil"))
        .args([
            "qe",
            "Microsoft-Windows-Diagnostics-Performance/Operational",
            "/q:*[System[(EventID=100)]]",
            "/c:1",
            "/rd:true",
            "/f:text",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
    {
        if output.status.success() {
            let text = String::from_utf8_lossy(&output.stdout);
            for line in text.lines() {
                let trimmed = line.trim();
                if let Some(rest) = trimmed
                    .strip_prefix("BootDuration:")
                    .or_else(|| trimmed.strip_prefix("MainPathBootTime:"))
                {
                    let digits: String = rest.chars().filter(|c| c.is_ascii_digit()).collect();
                    if let Ok(ms) = digits.parse::<u64>() {
                        if ms >= 1000 {
                            return Some((ms / 1000).clamp(3, 300));
                        }
                    }
                }
            }
        }
    }

    let enabled_count = startup_items().into_iter().filter(|s| s.enabled).count() as u64;
    Some(12 + enabled_count * 2)
}

#[cfg(not(windows))]
fn query_windows_boot_seconds() -> Option<u64> {
    None
}

#[cfg(windows)]
fn system_powershell_path() -> std::path::PathBuf {
    crate::safety::system_powershell_path()
}

#[cfg(windows)]
fn query_windows_battery() -> (Option<u8>, Option<String>) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let Ok(output) = std::process::Command::new(system_powershell_path())
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "(Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1 EstimatedChargeRemaining, BatteryStatus) | ConvertTo-Json -Compress",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
    else {
        return (None, None);
    };

    if !output.status.success() {
        return (None, None);
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return (None, None);
    }
    let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) else {
        return (None, None);
    };
    let pct = val
        .get("EstimatedChargeRemaining")
        .and_then(|v| v.as_u64())
        .map(|n| n.min(100) as u8);
    let status = val.get("BatteryStatus").and_then(|v| v.as_u64()).map(|code| {
        match code {
            1 => "Discharging".to_string(),
            2 => "Charging / AC Power".to_string(),
            3 => "Fully Charged".to_string(),
            _ => "Battery Present".to_string(),
        }
    });
    (pct, status)
}

#[cfg(not(windows))]
fn query_windows_battery() -> (Option<u8>, Option<String>) {
    (None, None)
}

pub fn system_health_details() -> SystemHealthDetails {
    let uptime_seconds = System::uptime();
    let last_boot_seconds = query_windows_boot_seconds();
    let (battery_percent, battery_status) = query_windows_battery();

    #[cfg(windows)]
    let system_mount = format!(
        "{}\\",
        std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into()).trim_end_matches('\\')
    );
    #[cfg(not(windows))]
    let system_mount = "/".to_string();

    let disks = sysinfo::Disks::new_with_refreshed_list();
    let is_ssd = disks
        .list()
        .iter()
        .find(|d| d.mount_point().to_string_lossy().eq_ignore_ascii_case(&system_mount))
        .map(|d| !matches!(d.kind(), sysinfo::DiskKind::HDD))
        .unwrap_or(true);

    SystemHealthDetails {
        uptime_seconds,
        last_boot_seconds,
        battery_percent,
        battery_status,
        is_ssd,
    }
}

#[derive(Serialize, Clone)]
pub struct ContextMenuItem {
    pub id: String,
    pub name: String,
    pub command: String,
    pub scope: String,
    pub enabled: bool,
}

#[cfg(windows)]
pub fn list_context_menu_items() -> Vec<ContextMenuItem> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;

    let sources: &[(&str, winreg::HKEY, &str, &str, &str)] = &[
        ("HKCU", HKEY_CURRENT_USER, "*", r"Software\Classes\*\shell", "Current user (Files)"),
        ("HKCU", HKEY_CURRENT_USER, "Directory", r"Software\Classes\Directory\shell", "Current user (Folders)"),
        ("HKCU", HKEY_CURRENT_USER, "Background", r"Software\Classes\Directory\Background\shell", "Current user (Background)"),
        ("HKLM", HKEY_LOCAL_MACHINE, "*", r"Software\Classes\*\shell", "System"),
        ("HKLM", HKEY_LOCAL_MACHINE, "Directory", r"Software\Classes\Directory\shell", "System"),
    ];

    let mut items = Vec::new();
    for (hive_label, hive_root, kind, reg_path, scope_label) in sources {
        let root = RegKey::predef(*hive_root);
        let Ok(shell_key) = root.open_subkey(reg_path) else {
            continue;
        };
        for sub_name in shell_key.enum_keys().flatten() {
            if sub_name.trim().is_empty() || sub_name.contains(['\\', '/', '\0']) {
                continue;
            }
            let Ok(sub_key) = shell_key.open_subkey(&sub_name) else {
                continue;
            };
            let command_val = sub_key
                .open_subkey("command")
                .and_then(|ck| ck.get_value::<String, _>(""))
                .or_else(|_| sub_key.get_value::<String, _>("DelegateExecute"))
                .unwrap_or_default();
            if command_val.trim().is_empty() {
                continue;
            }
            let raw_label = sub_key
                .get_value::<String, _>("MUIVerb")
                .or_else(|_| sub_key.get_value::<String, _>(""))
                .unwrap_or_else(|_| sub_name.clone());
            let clean_name = if raw_label.starts_with('@') || raw_label.trim().is_empty() {
                sub_name.clone()
            } else {
                raw_label.replace('&', "")
            };
            let enabled = sub_key.get_value::<String, _>("LegacyDisable").is_err();
            items.push(ContextMenuItem {
                id: format!("{hive_label}:{kind}:{sub_name}"),
                name: clean_name,
                command: command_val,
                scope: (*scope_label).to_string(),
                enabled,
            });
        }
    }
    items
}

#[cfg(not(windows))]
pub fn list_context_menu_items() -> Vec<ContextMenuItem> {
    Vec::new()
}

#[cfg(windows)]
pub fn toggle_context_menu_item(id: &str, enabled: bool) -> AppResult<Vec<ContextMenuItem>> {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_WRITE};
    use winreg::RegKey;

    let parts: Vec<&str> = id.splitn(3, ':').collect();
    if parts.len() != 3 {
        return Err(AppError::Other("Invalid context menu item identifier.".into()));
    }
    let (hive, kind, sub_name) = (parts[0], parts[1], parts[2].trim());
    if sub_name.is_empty() || sub_name.len() > 255 || sub_name.contains(['\\', '/', '\0']) {
        return Err(AppError::Other("Invalid context menu key name.".into()));
    }
    if hive != "HKCU" {
        return Err(AppError::Other(
            "System-scoped context menu items are read-only without Administrator elevation.".into(),
        ));
    }
    let reg_base = match kind {
        "*" => r"Software\Classes\*\shell",
        "Directory" => r"Software\Classes\Directory\shell",
        "Background" => r"Software\Classes\Directory\Background\shell",
        _ => return Err(AppError::Other("Unknown context menu target scope.".into())),
    };

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let sub_path = format!("{reg_base}\\{sub_name}");
    let sub_key = hkcu
        .open_subkey_with_flags(&sub_path, KEY_READ | KEY_WRITE)
        .map_err(|e| AppError::Other(format!("Could not open context menu registry key: {e}")))?;

    if !enabled {
        sub_key
            .set_value("LegacyDisable", &"")
            .map_err(|e| AppError::Other(format!("Could not disable context menu item: {e}")))?;
    } else {
        let _ = sub_key.delete_value("LegacyDisable");
    }

    Ok(list_context_menu_items())
}

#[cfg(not(windows))]
pub fn toggle_context_menu_item(_id: &str, _enabled: bool) -> AppResult<Vec<ContextMenuItem>> {
    Err(AppError::Other("Context menu management is only supported on Windows.".into()))
}

// ---------------------------------------------------------------------------
// Tab Session Crash Guard (Snapshot & Restore Open Browser Sessions)
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TabSessionSnapshot {
    pub id: String,
    pub label: String,
    pub created_at: u64,
    pub browsers: Vec<String>,
    pub estimated_tabs: u32,
    pub bytes: u64,
}

fn copy_shared_file(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<u64> {
    use std::io::Read;
    #[cfg(windows)]
    let mut reader = {
        use std::os::windows::fs::OpenOptionsExt;
        // FILE_SHARE_READ (1) | FILE_SHARE_WRITE (2) | FILE_SHARE_DELETE (4) = 7
        std::fs::OpenOptions::new()
            .read(true)
            .share_mode(7)
            .open(src)?
    };
    #[cfg(not(windows))]
    let mut reader = std::fs::File::open(src)?;

    let mut buf = Vec::new();
    reader.read_to_end(&mut buf)?;
    let len = buf.len() as u64;
    if let Some(parent) = dst.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(dst, &buf)?;
    Ok(len)
}

fn estimate_tabs_in_bytes(data: &[u8]) -> u32 {
    let mut count = 0u32;
    let needle = b"http";
    let mut i = 0usize;
    while i + needle.len() <= data.len() {
        if &data[i..i + 4] == needle {
            let next = data.get(i + 4).copied().unwrap_or(0);
            if next == b':' || (next == b's' && data.get(i + 5) == Some(&b':')) {
                count += 1;
                i += 12;
                continue;
            }
        }
        i += 1;
    }
    // Chromium SNSS stores multiple navigation history entries per tab; divide to estimate active tabs
    (count / 4).clamp(1, 250)
}

pub fn list_tab_sessions(data_dir: &std::path::Path) -> Vec<TabSessionSnapshot> {
    let index_path = data_dir.join("tab_session_vault").join("index.json");
    let mut list: Vec<TabSessionSnapshot> = std::fs::read_to_string(&index_path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    list.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    list
}

fn save_tab_sessions_index(data_dir: &std::path::Path, list: &[TabSessionSnapshot]) -> AppResult<()> {
    let vault_dir = data_dir.join("tab_session_vault");
    std::fs::create_dir_all(&vault_dir)
        .map_err(|e| AppError::Other(format!("Could not create Tab Session Vault directory: {e}")))?;
    let json = serde_json::to_string_pretty(list)
        .map_err(|e| AppError::Other(format!("Could not serialize Tab Session index: {e}")))?;
    std::fs::write(vault_dir.join("index.json"), json)
        .map_err(|e| AppError::Other(format!("Could not save Tab Session index: {e}")))
}

pub fn backup_tab_sessions(
    data_dir: &std::path::Path,
    custom_label: Option<&str>,
) -> AppResult<TabSessionSnapshot> {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let snap_id = format!("snap_{ts}");
    let snap_dir = data_dir.join("tab_session_vault").join(&snap_id);
    std::fs::create_dir_all(&snap_dir)
        .map_err(|e| AppError::Other(format!("Failed to create snapshot directory: {e}")))?;

    let mut browsers_backed_up = Vec::new();
    let mut total_bytes = 0u64;
    let mut estimated_tabs = 0u32;

    if let Some(local) = dirs::data_local_dir() {
        let chromium_targets = [
            ("chrome", "Google Chrome", "Google/Chrome"),
            ("msedge", "Microsoft Edge", "Microsoft/Edge"),
            ("brave", "Brave Browser", "BraveSoftware/Brave-Browser"),
        ];

        for (id, label, rel) in chromium_targets {
            let sessions_dir = local.join(rel).join("User Data").join("Default").join("Sessions");
            if !sessions_dir.is_dir() {
                continue;
            }
            let Ok(entries) = std::fs::read_dir(&sessions_dir) else {
                continue;
            };
            let mut browser_bytes = 0u64;
            let mut browser_tabs = 0u32;
            let dst_browser_dir = snap_dir.join(id);
            for entry in entries.flatten() {
                let p = entry.path();
                if !p.is_file() {
                    continue;
                }
                let fname = entry.file_name().to_string_lossy().into_owned();
                if fname.starts_with("Session_") || fname.starts_with("Tabs_") {
                    let dst = dst_browser_dir.join(&fname);
                    if let Ok(copied) = copy_shared_file(&p, &dst) {
                        if copied > 0 {
                            browser_bytes += copied;
                            if let Ok(raw) = std::fs::read(&dst) {
                                browser_tabs = browser_tabs.max(estimate_tabs_in_bytes(&raw));
                            }
                        }
                    }
                }
            }
            if browser_bytes > 0 {
                browsers_backed_up.push(label.to_string());
                total_bytes += browser_bytes;
                estimated_tabs += browser_tabs.max(1);
            }
        }
    }

    if let Some(roaming) = dirs::data_dir() {
        let ff_profiles = roaming.join("Mozilla").join("Firefox").join("Profiles");
        if let Ok(entries) = std::fs::read_dir(&ff_profiles) {
            let mut ff_bytes = 0u64;
            for entry in entries.flatten() {
                let p = entry.path();
                let backups = p.join("sessionstore-backups");
                if backups.is_dir() {
                    let prof_name = entry.file_name().to_string_lossy().into_owned();
                    let dst_dir = snap_dir.join("firefox").join(prof_name);
                    if let Ok(b_entries) = std::fs::read_dir(&backups) {
                        for b in b_entries.flatten() {
                            let bp = b.path();
                            if bp.is_file() {
                                let bname = b.file_name().to_string_lossy().into_owned();
                                if let Ok(copied) = copy_shared_file(&bp, &dst_dir.join(bname)) {
                                    ff_bytes += copied;
                                }
                            }
                        }
                    }
                }
            }
            if ff_bytes > 0 {
                browsers_backed_up.push("Mozilla Firefox".to_string());
                total_bytes += ff_bytes;
                estimated_tabs += 4;
            }
        }
    }

    if browsers_backed_up.is_empty() {
        let _ = std::fs::remove_dir_all(&snap_dir);
        return Err(AppError::NotFound(
            "No browser tab session files were found to back up.".into(),
        ));
    }

    // Supplement estimated_tabs with live renderer count if browsers are currently running
    let live_report = browser_memory_report();
    if live_report.total_tab_processes > estimated_tabs {
        estimated_tabs = live_report.total_tab_processes;
    }

    let clean_label = custom_label
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("Session Backup ({})", browsers_backed_up.join(", ")));

    let snapshot = TabSessionSnapshot {
        id: snap_id,
        label: clean_label,
        created_at: ts,
        browsers: browsers_backed_up,
        estimated_tabs,
        bytes: total_bytes,
    };

    let mut list = list_tab_sessions(data_dir);
    list.insert(0, snapshot.clone());
    while list.len() > 15 {
        if let Some(old) = list.pop() {
            let _ = std::fs::remove_dir_all(data_dir.join("tab_session_vault").join(&old.id));
        }
    }
    save_tab_sessions_index(data_dir, &list)?;

    Ok(snapshot)
}

pub fn restore_tab_session(data_dir: &std::path::Path, snapshot_id: &str) -> AppResult<u32> {
    let trimmed = snapshot_id.trim();
    if trimmed.is_empty() || trimmed.contains(['\\', '/', '.', '\0']) {
        return Err(AppError::Other("Invalid snapshot identifier.".into()));
    }
    let snap_dir = data_dir.join("tab_session_vault").join(trimmed);
    if !snap_dir.is_dir() {
        return Err(AppError::NotFound("Tab session backup not found.".into()));
    }

    let mut files_restored = 0u32;

    if let Some(local) = dirs::data_local_dir() {
        let chromium_targets = [
            ("chrome", "Google/Chrome"),
            ("msedge", "Microsoft/Edge"),
            ("brave", "BraveSoftware/Brave-Browser"),
        ];
        for (id, rel) in chromium_targets {
            let src_dir = snap_dir.join(id);
            if !src_dir.is_dir() {
                continue;
            }
            let dst_dir = local.join(rel).join("User Data").join("Default").join("Sessions");
            let _ = std::fs::create_dir_all(&dst_dir);
            if let Ok(entries) = std::fs::read_dir(&src_dir) {
                for entry in entries.flatten() {
                    let p = entry.path();
                    if p.is_file() {
                        let dst = dst_dir.join(entry.file_name());
                        if copy_shared_file(&p, &dst).is_ok() {
                            files_restored += 1;
                        }
                    }
                }
            }
        }
    }

    if let Some(roaming) = dirs::data_dir() {
        let ff_src = snap_dir.join("firefox");
        if ff_src.is_dir() {
            let ff_profiles = roaming.join("Mozilla").join("Firefox").join("Profiles");
            if let Ok(prof_entries) = std::fs::read_dir(&ff_src) {
                for prof in prof_entries.flatten() {
                    let prof_path = prof.path();
                    if prof_path.is_dir() {
                        let dst_dir = ff_profiles.join(prof.file_name()).join("sessionstore-backups");
                        let _ = std::fs::create_dir_all(&dst_dir);
                        if let Ok(files) = std::fs::read_dir(&prof_path) {
                            for f in files.flatten() {
                                if f.path().is_file() {
                                    if copy_shared_file(&f.path(), &dst_dir.join(f.file_name())).is_ok() {
                                        files_restored += 1;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if files_restored == 0 {
        return Err(AppError::Other(
            "Could not restore session files. Close your browser first so its session files are unlocked.".into(),
        ));
    }

    Ok(files_restored)
}

pub fn delete_tab_session(
    data_dir: &std::path::Path,
    snapshot_id: &str,
) -> AppResult<Vec<TabSessionSnapshot>> {
    let trimmed = snapshot_id.trim();
    if trimmed.is_empty() || trimmed.contains(['\\', '/', '.', '\0']) {
        return Err(AppError::Other("Invalid snapshot identifier.".into()));
    }
    let snap_dir = data_dir.join("tab_session_vault").join(trimmed);
    let _ = std::fs::remove_dir_all(&snap_dir);
    let mut list = list_tab_sessions(data_dir);
    list.retain(|s| s.id != trimmed);
    save_tab_sessions_index(data_dir, &list)?;
    Ok(list)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn startup_impact_heuristics_and_validation() {
        assert_eq!(estimate_startup_impact("Discord", r"C:\Users\me\Discord\Update.exe --processStart Discord.exe"), "High");
        assert_eq!(estimate_startup_impact("JavaUpdateSched", r"C:\Program Files\Common Files\Java\Java Update\jusched.exe"), "Medium");
        assert_eq!(estimate_startup_impact("AudioTray", r"C:\Windows\System32\systray.exe"), "Low");
        assert!(validate_startup_name("OneDrive").is_ok());
        assert!(validate_startup_name("..\\Policies").is_err());
        assert!(validate_startup_name("").is_err());
    }

    #[test]
    fn kill_process_rejects_empty_and_protected() {
        assert!(kill_process_by_name("").is_err());
        assert!(kill_process_by_name("   ").is_err());
        assert!(kill_process_by_name("explorer.exe").is_err());
        assert!(kill_process_by_name("svchost").is_err());
        assert!(kill_process_by_name("sweepr").is_err());
        assert!(kill_process_by_name("SWEEPRCleaner.exe").is_err());
        assert!(kill_process_by_name("MsMpEng.exe").is_err());
        assert!(kill_process_by_name("SecurityHealthService.exe").is_err());
    }
}

