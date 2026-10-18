//! Honest memory insights: who is using RAM, and what launches at startup.
//! We deliberately do NOT "purge" RAM. Emptying working sets/file caches
//! usually makes modern OSes slower.

use crate::error::{AppError, AppResult};
use serde::Serialize;
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

    if let Ok(output) = std::process::Command::new("wevtutil")
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
fn query_windows_battery() -> (Option<u8>, Option<String>) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let Ok(output) = std::process::Command::new("powershell")
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
    }
}

