//! Windows Registry Repair & Diagnostics module
use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct RegistryIssue {
    pub key: String,
    pub name: String,
    pub issue_type: String,
    pub details: String,
}

#[cfg(target_os = "windows")]
pub fn scan_registry_issues() -> Vec<RegistryIssue> {
    use winreg::enums::*;
    use winreg::RegKey;
    use std::path::Path;

    let mut issues = Vec::new();

    // Check App Paths for missing executables
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    if let Ok(app_paths) = hkcu.open_subkey("SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths") {
        for subkey_name in app_paths.enum_keys().filter_map(Result::ok) {
            if let Ok(sub) = app_paths.open_subkey(&subkey_name) {
                let default_val: String = sub.get_value("").unwrap_or_default();
                if !default_val.is_empty() {
                    let cleaned_path = default_val.trim_matches('"');
                    if !Path::new(cleaned_path).exists() {
                        issues.push(RegistryIssue {
                            key: format!("App Paths\\{}", subkey_name),
                            name: subkey_name,
                            issue_type: "Broken App Path".into(),
                            details: format!("Target binary missing: {}", cleaned_path),
                        });
                    }
                }
            }
        }
    }

    // Check Run / Startup entries for missing targets
    if let Ok(run_key) = hkcu.open_subkey("SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run") {
        for (name, val) in run_key.enum_values().filter_map(Result::ok) {
            let cmd = val.to_string();
            let exe = cmd.split_whitespace().next().unwrap_or("").trim_matches('"');
            if !exe.is_empty() && !Path::new(exe).exists() && !exe.contains('%') {
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

#[tauri::command]
pub fn fix_registry_issue(key_path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        if key_path.starts_with("App Paths\\") {
            let sub = key_path.trim_start_matches("App Paths\\");
            if let Ok(mut parent) = hkcu.open_subkey_with_flags("SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths", KEY_ALL_ACCESS) {
                let _ = parent.delete_subkey(sub);
            }
        } else if key_path.starts_with("Run\\") {
            let name = key_path.trim_start_matches("Run\\");
            if let Ok(parent) = hkcu.open_subkey_with_flags("SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run", KEY_ALL_ACCESS) {
                let _ = parent.delete_value(name);
            }
        }
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(())
    }
}
