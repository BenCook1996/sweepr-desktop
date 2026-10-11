use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct AppInfo {
    pub id: String,
    pub name: String,
    pub publisher: String,
    pub version: String,
    pub install_date: String,
    pub estimated_size: u64,
    pub uninstall_string: String,
}

#[cfg(target_os = "windows")]
pub fn get_installed_apps() -> Vec<AppInfo> {
    use winreg::enums::*;
    use winreg::RegKey;

    let mut apps = Vec::new();
    let keys = [
        (HKEY_LOCAL_MACHINE, "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall"),
        (HKEY_LOCAL_MACHINE, "SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall"),
        (HKEY_CURRENT_USER, "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall"),
    ];

    for (hkey, subkey) in keys {
        let root = RegKey::predef(hkey);
        if let Ok(uninstall_key) = root.open_subkey(subkey) {
            for name in uninstall_key.enum_keys().filter_map(Result::ok) {
                if let Ok(app_key) = uninstall_key.open_subkey(&name) {
                    let display_name: String = app_key.get_value("DisplayName").unwrap_or_default();
                    let uninstall_string: String = app_key.get_value("UninstallString").unwrap_or_default();
                    
                    if display_name.is_empty() || uninstall_string.is_empty() {
                        continue;
                    }
                    if display_name.starts_with("KB") {
                        continue;
                    }

                    let publisher: String = app_key.get_value("Publisher").unwrap_or_default();
                    let version: String = app_key.get_value("DisplayVersion").unwrap_or_default();
                    let install_date: String = app_key.get_value("InstallDate").unwrap_or_default();
                    let estimated_size: u32 = app_key.get_value("EstimatedSize").unwrap_or(0);

                    apps.push(AppInfo {
                        id: name,
                        name: display_name,
                        publisher,
                        version,
                        install_date,
                        estimated_size: (estimated_size as u64) * 1024,
                        uninstall_string,
                    });
                }
            }
        }
    }

    apps.sort_by(|a, b| a.name.cmp(&b.name));
    apps.dedup_by(|a, b| a.name == b.name);
    apps
}

#[cfg(not(target_os = "windows"))]
pub fn get_installed_apps() -> Vec<AppInfo> {
    Vec::new() // Not implemented for non-Windows
}

#[tauri::command]
pub fn fetch_apps() -> Vec<AppInfo> {
    get_installed_apps()
}

#[tauri::command]
pub fn uninstall_app(uninstall_string: String) -> Result<(), String> {
    let parts: Vec<&str> = uninstall_string.split_whitespace().collect();
    if parts.is_empty() {
        return Err("Invalid uninstall string".into());
    }

    #[cfg(target_os = "windows")]
    {
        // Many uninstall strings have quotes around the executable. cmd /c handles this well.
        std::process::Command::new("cmd")
            .args(["/c", &uninstall_string])
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    
    #[cfg(not(target_os = "windows"))]
    {
        Err("Not supported on this OS".into())
    }
}
