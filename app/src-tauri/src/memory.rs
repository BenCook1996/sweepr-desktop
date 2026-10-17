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

    let mappings: &[(&str, &str, &[&str])] = &[
        ("chrome", "Google Chrome", &["chrome"]),
        ("edge", "Microsoft Edge", &["msedge"]),
        ("brave", "Brave Browser", &["brave"]),
        ("firefox", "Mozilla Firefox", &["firefox"]),
        ("spotify", "Spotify", &["spotify"]),
        ("app_caches", "Discord / VS Code / Teams / Slack", &["discord", "code", "teams", "ms-teams", "slack"]),
    ];

    let mut conflicts = Vec::new();
    for (cat_id, label, procs) in mappings {
        if !category_ids.iter().any(|c| c == cat_id) {
            continue;
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
}
