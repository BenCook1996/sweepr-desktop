//! Honest memory insights: who is using RAM, and what launches at startup.
//! We deliberately do NOT "purge" RAM. Emptying working sets/file caches
//! usually makes modern OSes slower.

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

#[derive(Serialize)]
pub struct StartupItem {
    pub name: String,
    pub command: String,
    pub scope: String,
}

#[cfg(windows)]
pub fn startup_items() -> Vec<StartupItem> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;
    const RUN: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";

    let mut out = Vec::new();
    for (hive, scope) in [(HKEY_CURRENT_USER, "Current user"), (HKEY_LOCAL_MACHINE, "All users")] {
        if let Ok(key) = RegKey::predef(hive).open_subkey(RUN) {
            for (name, value) in key.enum_values().flatten() {
                out.push(StartupItem { name, command: value.to_string(), scope: scope.into() });
            }
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
                    out.push(StartupItem {
                        name: p.file_stem().unwrap_or_default().to_string_lossy().into_owned(),
                        command: p.to_string_lossy().into_owned(),
                        scope: scope.into(),
                    });
                }
            }
        }
    }
    out
}
