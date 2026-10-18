//! Windows Registry Repair & Diagnostics module
use crate::commands::AppState;
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

#[derive(Serialize, Clone)]
pub struct RegistryIssue {
    pub key: String,
    pub name: String,
    pub issue_type: String,
    pub details: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct RegistryBackupEntry {
    pub id: String,
    pub key: String,
    pub name: String,
    pub issue_type: String,
    pub value: String,
    pub backed_up_at: u64,
}

fn backups_file(data_dir: &Path) -> PathBuf {
    data_dir.join("registry_backups.json")
}

pub fn load_backups(data_dir: &Path) -> Vec<RegistryBackupEntry> {
    let file = backups_file(data_dir);
    let Ok(raw) = std::fs::read_to_string(file) else {
        return Vec::new();
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

pub fn save_backups(data_dir: &Path, entries: &[RegistryBackupEntry]) -> std::io::Result<()> {
    std::fs::create_dir_all(data_dir)?;
    let json = serde_json::to_string_pretty(entries).unwrap_or_else(|_| "[]".into());
    std::fs::write(backups_file(data_dir), json)
}

pub fn record_backup(data_dir: &Path, key: &str, name: &str, issue_type: &str, value: &str) -> std::io::Result<RegistryBackupEntry> {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut entries = load_backups(data_dir);
    let id = format!("reg_{ts}_{}", entries.len() + 1);
    let entry = RegistryBackupEntry {
        id,
        key: key.to_string(),
        name: name.to_string(),
        issue_type: issue_type.to_string(),
        value: value.to_string(),
        backed_up_at: ts,
    };
    entries.insert(0, entry.clone());
    entries.truncate(200);
    save_backups(data_dir, &entries)?;
    Ok(entry)
}

#[cfg(target_os = "windows")]
const APP_PATHS: &str = "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths";
#[cfg(target_os = "windows")]
const RUN: &str = "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run";

/// An App Paths default value is broken if it names a file that doesn't exist.
/// Returns the target path when broken.
pub fn app_path_target_missing(default_val: &str) -> Option<String> {
    if default_val.is_empty() {
        return None;
    }
    let cleaned = crate::cmdline::expand_env(default_val.trim().trim_matches('"'));
    if cleaned.contains('%') || std::path::Path::new(&cleaned).exists() {
        None
    } else {
        Some(cleaned)
    }
}

fn is_abs_or_win_drive(p: &str) -> bool {
    let bytes = p.as_bytes();
    std::path::Path::new(p).is_absolute()
        || (bytes.len() >= 3
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && (bytes[2] == b'\\' || bytes[2] == b'/'))
}

/// A Run entry is orphaned if its executable doesn't exist. Commands with
/// unresolved environment variables or bare program names are never flagged.
pub fn run_entry_target_missing(cmd: &str) -> Option<String> {
    let (exe, _) = crate::cmdline::split_command(cmd);
    let exe = exe.trim();
    if exe.is_empty() || exe.contains('%') || !is_abs_or_win_drive(exe) {
        return None;
    }
    if std::path::Path::new(exe).exists() {
        None
    } else {
        Some(exe.to_string())
    }
}

#[cfg(target_os = "windows")]
pub fn scan_registry_issues() -> Vec<RegistryIssue> {
    use winreg::enums::*;
    use winreg::RegKey;

    let mut issues = Vec::new();

    // Check App Paths for missing executables
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    if let Ok(app_paths) = hkcu.open_subkey(APP_PATHS) {
        for subkey_name in app_paths.enum_keys().filter_map(Result::ok) {
            if subkey_name.contains('\\') {
                continue;
            }
            if let Ok(sub) = app_paths.open_subkey(&subkey_name) {
                let default_val: String = sub.get_value("").unwrap_or_default();
                if let Some(missing) = app_path_target_missing(&default_val) {
                    issues.push(RegistryIssue {
                        key: format!("App Paths\\{}", subkey_name),
                        name: subkey_name,
                        issue_type: "Broken App Path".into(),
                        details: format!("Target binary missing: {}", missing),
                    });
                }
            }
        }
    }

    // Check Run / Startup entries for missing targets
    if let Ok(run_key) = hkcu.open_subkey(RUN) {
        for (name, val) in run_key.enum_values().filter_map(Result::ok) {
            if name.is_empty() || name.contains('\\') {
                continue;
            }
            let cmd = val.to_string();
            if run_entry_target_missing(&cmd).is_some() {
                issues.push(RegistryIssue {
                    key: format!("Run\\{}", name),
                    name,
                    issue_type: "Orphaned Startup Registry".into(),
                    details: format!("Orphaned reference: {}", cmd),
                });
            }
        }
    }

    issues
}

#[cfg(not(target_os = "windows"))]
pub fn scan_registry_issues() -> Vec<RegistryIssue> {
    Vec::new()
}

#[tauri::command]
pub fn scan_registry() -> Vec<RegistryIssue> {
    scan_registry_issues()
}

/// Which issue a key path refers to, after validation.
#[derive(Debug, PartialEq)]
pub enum IssueRef<'a> {
    AppPath(&'a str),
    Run(&'a str),
}

pub fn parse_issue_key(key_path: &str) -> AppResult<IssueRef<'_>> {
    let valid = |s: &str| !s.is_empty() && s.len() <= 255 && !s.contains(['\\', '\0']);
    if let Some(sub) = key_path.strip_prefix("App Paths\\") {
        if valid(sub) {
            return Ok(IssueRef::AppPath(sub));
        }
    } else if let Some(name) = key_path.strip_prefix("Run\\") {
        if valid(name) {
            return Ok(IssueRef::Run(name));
        }
    }
    Err(AppError::Other("Invalid registry issue reference".into()))
}

#[cfg(target_os = "windows")]
fn try_create_restore_point() {
    use std::os::windows::process::CommandExt;
    use std::sync::atomic::{AtomicBool, Ordering};
    static ATTEMPTED: AtomicBool = AtomicBool::new(false);
    if ATTEMPTED.swap(true, Ordering::SeqCst) {
        return;
    }
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let _ = std::process::Command::new(crate::safety::system_powershell_path())
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-Command",
            "Checkpoint-Computer -Description 'Sweepr Registry Repair' -RestorePointType 'MODIFY_SETTINGS' -ErrorAction SilentlyContinue",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn();
}

#[cfg(target_os = "windows")]
fn fix_issue_blocking(data_dir: &Path, key_path: &str) -> AppResult<()> {
    use winreg::enums::*;
    use winreg::RegKey;

    try_create_restore_point();

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let gone = || AppError::NotFound("this registry entry no longer exists".into());
    let fixed = || AppError::Other("This entry is no longer broken (its target exists), so it was left untouched.".into());
    let failed = |e: std::io::Error| AppError::Other(format!("Could not update the registry: {e}"));

    match parse_issue_key(key_path)? {
        IssueRef::AppPath(sub) => {
            // Re-check the issue still exists before deleting anything.
            let parent = hkcu.open_subkey_with_flags(APP_PATHS, KEY_READ | KEY_WRITE).map_err(failed)?;
            let entry = parent.open_subkey_with_flags(sub, KEY_READ).map_err(|_| gone())?;
            let default_val: String = entry.get_value("").unwrap_or_default();
            drop(entry);
            if app_path_target_missing(&default_val).is_none() {
                return Err(fixed());
            }
            // Automatically back up the entry before removing it.
            let _ = record_backup(data_dir, key_path, sub, "Broken App Path", &default_val);
            parent.delete_subkey(sub).map_err(failed)
        }
        IssueRef::Run(name) => {
            let run = hkcu.open_subkey_with_flags(RUN, KEY_QUERY_VALUE | KEY_SET_VALUE).map_err(failed)?;
            let val = run.get_raw_value(name).map_err(|_| gone())?;
            let val_str = val.to_string();
            if run_entry_target_missing(&val_str).is_none() {
                return Err(fixed());
            }
            let _ = record_backup(data_dir, key_path, name, "Orphaned Startup Registry", &val_str);
            run.delete_value(name).map_err(failed)
        }
    }
}

#[cfg(target_os = "windows")]
fn restore_backup_blocking(data_dir: &Path, backup_id: &str) -> AppResult<()> {
    use winreg::RegKey;
    use winreg::enums::*;

    let mut backups = load_backups(data_dir);
    let idx = backups
        .iter()
        .position(|b| b.id == backup_id)
        .ok_or_else(|| AppError::NotFound("Registry backup entry not found".into()))?;
    let entry = backups[idx].clone();
    let failed = |e: std::io::Error| AppError::Other(format!("Could not restore registry entry: {e}"));

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    match parse_issue_key(&entry.key)? {
        IssueRef::AppPath(sub) => {
            let (parent, _) = hkcu.create_subkey(APP_PATHS).map_err(failed)?;
            let (subkey, _) = parent.create_subkey(sub).map_err(failed)?;
            subkey.set_value("", &entry.value).map_err(failed)?;
        }
        IssueRef::Run(name) => {
            let (run, _) = hkcu.create_subkey(RUN).map_err(failed)?;
            run.set_value(name, &entry.value).map_err(failed)?;
        }
    }

    backups.remove(idx);
    let _ = save_backups(data_dir, &backups);
    Ok(())
}

/// Pro feature: requires an active licence (checked here, in Rust).
#[tauri::command]
pub async fn fix_registry_issue(state: State<'_, AppState>, key_path: String) -> AppResult<()> {
    parse_issue_key(&key_path)?;
    state.licensing.require_active().await?;
    let data_dir = state.data_dir.clone();

    #[cfg(target_os = "windows")]
    {
        tauri::async_runtime::spawn_blocking(move || fix_issue_blocking(&data_dir, &key_path))
            .await
            .map_err(|e| AppError::Other(format!("background task failed: {e}")))?
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = data_dir;
        Err(AppError::Other("Not supported on this OS".into()))
    }
}

#[tauri::command]
pub fn list_registry_backups(state: State<'_, AppState>) -> Vec<RegistryBackupEntry> {
    load_backups(&state.data_dir)
}

#[tauri::command]
pub async fn restore_registry_backup(state: State<'_, AppState>, backup_id: String) -> AppResult<()> {
    state.licensing.require_active().await?;
    let data_dir = state.data_dir.clone();
    #[cfg(target_os = "windows")]
    {
        tauri::async_runtime::spawn_blocking(move || restore_backup_blocking(&data_dir, &backup_id))
            .await
            .map_err(|e| AppError::Other(format!("background task failed: {e}")))?
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (data_dir, backup_id);
        Err(AppError::Other("Not supported on this OS".into()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn issue_key_validation() {
        assert_eq!(parse_issue_key("App Paths\\foo.exe").unwrap(), IssueRef::AppPath("foo.exe"));
        assert_eq!(parse_issue_key("Run\\OneDrive").unwrap(), IssueRef::Run("OneDrive"));
        assert!(parse_issue_key("App Paths\\..\\..\\Policies").is_err());
        assert!(parse_issue_key("Run\\").is_err());
        assert!(parse_issue_key("Services\\foo").is_err());
    }

    #[test]
    fn run_entry_detection() {
        assert!(run_entry_target_missing(r#""C:\definitely\missing\app.exe" --start"#).is_some());
        assert!(run_entry_target_missing("%ProgramFiles%\\x.exe").is_none());
        assert!(run_entry_target_missing("bare.exe /x").is_none());
        #[cfg(windows)]
        if let Ok(root) = std::env::var("SystemRoot") {
            let cmd = format!("{root}\\System32\\cmd.exe /c echo");
            assert!(run_entry_target_missing(&cmd).is_none());
        }
    }

    #[test]
    fn backup_roundtrip() {
        let dir = std::env::temp_dir().join(format!("sweepr-reg-backup-test-{}", std::process::id()));
        let entry = record_backup(&dir, "Run\\TestApp", "TestApp", "Orphaned Startup Registry", "C:\\missing\\test.exe").unwrap();
        let loaded = load_backups(&dir);
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0], entry);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
