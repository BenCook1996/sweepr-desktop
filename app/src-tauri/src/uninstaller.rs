use crate::commands::AppState;
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, State};

/// Installed application as shown in the UI. The uninstall command itself is
/// never sent to the frontend: `uninstall_app` looks it up again by `id`.
#[derive(Serialize, Clone, Debug)]
pub struct AppInfo {
    /// Unique per scope: `HKLM64:<subkey>`, `HKLM32:<subkey>`, `HKCU:<subkey>`, `UWP:<PackageFullName>`,
    /// `MACSYS:<bundle>`, `MACUSR:<bundle>`, or Linux `DESK*`/`FLATPAK`/`SNAP`.
    pub id: String,
    pub name: String,
    pub publisher: String,
    pub version: String,
    pub install_date: String,
    pub estimated_size: u64,
    pub kind: String, // "win32" | "uwp" | "macos" | "linux"
    pub can_force_remove: bool,
}

const UNINSTALL_64: &str = "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall";
const UNINSTALL_32: &str = "SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall";

/// Hive prefix → (is HKLM, uninstall key path).
fn hive_for(prefix: &str) -> Option<(bool, &'static str)> {
    match prefix {
        "HKLM64" => Some((true, UNINSTALL_64)),
        "HKLM32" => Some((true, UNINSTALL_32)),
        "HKCU" => Some((false, UNINSTALL_64)),
        _ => None,
    }
}

/// Parse and validate an app id into (prefix, subkey).
pub fn parse_app_id(id: &str) -> AppResult<(&str, &str)> {
    let invalid = || AppError::Other("Invalid application id".into());
    let (prefix, subkey) = id.split_once(':').ok_or_else(invalid)?;
    hive_for(prefix).ok_or_else(invalid)?;
    if subkey.is_empty() || subkey.len() > 255 || subkey.contains(['\\', '/', '\0']) {
        return Err(invalid());
    }
    Ok((prefix, subkey))
}

/// Parse and validate a Windows Store / UWP app id (`UWP:<PackageFullName>`).
pub fn parse_uwp_app_id(id: &str) -> AppResult<&str> {
    let invalid = || AppError::Other("Invalid UWP application id".into());
    let full_name = id.strip_prefix("UWP:").ok_or_else(invalid)?;
    if full_name.is_empty()
        || full_name.len() > 255
        || !full_name.contains('_')
        || full_name.contains("..")
        || !full_name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | '+'))
    {
        return Err(invalid());
    }
    Ok(full_name)
}

#[derive(Deserialize, Clone, Debug, Default, PartialEq, Eq)]
pub struct AppxPackageRecord {
    #[serde(rename = "Name", default)]
    pub name: String,
    #[serde(rename = "PackageFullName", default)]
    pub package_full_name: String,
    #[serde(rename = "Publisher", default)]
    pub publisher: String,
    #[serde(rename = "Version", default)]
    pub version: String,
    #[serde(rename = "InstallLocation", default)]
    pub install_location: String,
    #[serde(rename = "IsFramework", default)]
    pub is_framework: bool,
    #[serde(rename = "IsResourcePackage", default)]
    pub is_resource_package: bool,
    #[serde(rename = "NonRemovable", default)]
    pub non_removable: bool,
    #[serde(rename = "SignatureKind", default)]
    pub signature_kind: String,
}

pub fn parse_appx_packages_json(raw: &str) -> Vec<AppxPackageRecord> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }
    let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) else {
        return Vec::new();
    };
    if val.is_array() {
        serde_json::from_value::<Vec<AppxPackageRecord>>(val).unwrap_or_default()
    } else if val.is_object() {
        serde_json::from_value::<AppxPackageRecord>(val)
            .into_iter()
            .collect()
    } else {
        Vec::new()
    }
}

pub fn is_safe_removable_appx(pkg: &AppxPackageRecord) -> bool {
    if pkg.is_framework || pkg.is_resource_package || pkg.non_removable {
        return false;
    }
    if pkg.signature_kind.eq_ignore_ascii_case("System") {
        return false;
    }
    let name = pkg.name.trim();
    let full = pkg.package_full_name.trim();
    if name.is_empty() || full.is_empty() {
        return false;
    }
    let lower_name = name.to_ascii_lowercase();
    let lower_full = full.to_ascii_lowercase();
    if lower_name.contains("sweepr") || lower_full.contains("sweepr") {
        return false;
    }

    const BLOCKED_EXACT: &[&str] = &[
        "microsoft.windowsstore",
        "microsoft.storepurchaseapp",
        "microsoft.desktopappinstaller",
        "microsoft.services.store.engagement",
        "microsoft.microsoftedge",
        "microsoft.microsoftedgedevtoolsclient",
        "microsoft.edge",
        "microsoft.webview2",
        "microsoft.win32webviewhost",
        "microsoft.accountscontrol",
        "microsoft.asynctextservice",
        "microsoft.bioenrollment",
        "microsoft.creddialoghost",
        "microsoft.ecapp",
        "microsoft.lockapp",
        "microsoft.xboxgamecallableui",
        "ncsiuwpapp",
        "1527c705-839a-4832-9118-54d4bd6a0c89",
        "c5e2524a-ea46-4f67-841f-6a9465d9d515",
        "e2a4f912-2574-4a75-9bb0-0d023378592b",
        "f46d4000-fd22-4db4-ac8e-4e1ddde828fe",
    ];
    if BLOCKED_EXACT.iter().any(|b| lower_name == *b) {
        return false;
    }

    const BLOCKED_PREFIXES: &[&str] = &[
        "microsoft.windows.",
        "windows.",
        "microsoft.vclibs.",
        "microsoft.net.",
        "microsoft.ui.xaml.",
        "microsoft.windowsappruntime.",
        "microsoft.directx.",
        "microsoft.aad.",
    ];
    if BLOCKED_PREFIXES.iter().any(|p| lower_name.starts_with(p)) {
        return false;
    }

    true
}

#[cfg(target_os = "windows")]
fn clean_appx_publisher(raw: &str) -> String {
    let trimmed = raw.trim();
    for part in trimmed.split(',') {
        let p = part.trim();
        if let Some(cn) = p.strip_prefix("CN=") {
            let v = cn.trim().trim_matches('"');
            if !v.is_empty() {
                return v.to_string();
            }
        }
    }
    trimmed.to_string()
}

#[cfg(target_os = "windows")]
fn query_appx_packages(filter_full_name: Option<&str>) -> Vec<AppxPackageRecord> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let mut cmd = std::process::Command::new(crate::safety::system_powershell_path());
    let script = if let Some(full_name) = filter_full_name {
        cmd.env("SWEEPR_APPX_FULLNAME", full_name);
        "Get-AppxPackage | Where-Object { $_.PackageFullName -eq $env:SWEEPR_APPX_FULLNAME } | Select-Object Name, PackageFullName, Publisher, Version, InstallLocation, IsFramework, IsResourcePackage, NonRemovable, SignatureKind | ConvertTo-Json -Compress"
    } else {
        "Get-AppxPackage | Select-Object Name, PackageFullName, Publisher, Version, InstallLocation, IsFramework, IsResourcePackage, NonRemovable, SignatureKind | ConvertTo-Json -Compress"
    };
    let Ok(out) = cmd
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-Command",
            script,
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
    else {
        return Vec::new();
    };
    if !out.status.success() {
        return Vec::new();
    }
    parse_appx_packages_json(&String::from_utf8_lossy(&out.stdout))
}

#[cfg(target_os = "windows")]
pub fn get_installed_apps() -> Vec<AppInfo> {
    use winreg::enums::*;
    use winreg::RegKey;

    let mut apps = Vec::new();
    for prefix in ["HKLM64", "HKLM32", "HKCU"] {
        let (is_hklm, subkey) = hive_for(prefix).expect("known prefix");
        let root = RegKey::predef(if is_hklm { HKEY_LOCAL_MACHINE } else { HKEY_CURRENT_USER });
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
                    let id = format!("{prefix}:{name}");
                    if parse_app_id(&id).is_err() {
                        continue;
                    }

                    let publisher: String = app_key.get_value("Publisher").unwrap_or_default();
                    let version: String = app_key.get_value("DisplayVersion").unwrap_or_default();
                    let install_date: String = app_key.get_value("InstallDate").unwrap_or_default();
                    let estimated_size: u32 = app_key.get_value("EstimatedSize").unwrap_or(0);

                    apps.push(AppInfo {
                        id,
                        name: display_name,
                        publisher,
                        version,
                        install_date,
                        estimated_size: (estimated_size as u64) * 1024,
                        kind: "win32".into(),
                        can_force_remove: true,
                    });
                }
            }
        }
    }

    // Add safe removable Microsoft Store (UWP/Appx) apps
    for pkg in query_appx_packages(None) {
        if !is_safe_removable_appx(&pkg) {
            continue;
        }
        let id = format!("UWP:{}", pkg.package_full_name.trim());
        if parse_uwp_app_id(&id).is_err() {
            continue;
        }
        let estimated_size = if !pkg.install_location.trim().is_empty() {
            let loc = std::path::Path::new(pkg.install_location.trim());
            if let Ok(md) = std::fs::symlink_metadata(loc) {
                if md.is_dir() && !crate::safety::metadata_is_link_like(&md) {
                    dir_size_and_files(loc, 250).0
                } else {
                    0
                }
            } else {
                0
            }
        } else {
            0
        };
        let publisher = clean_appx_publisher(&pkg.publisher);
        apps.push(AppInfo {
            id,
            name: pkg.name.trim().to_string(),
            publisher,
            version: pkg.version.trim().to_string(),
            install_date: String::new(),
            estimated_size,
            kind: "uwp".into(),
            can_force_remove: false,
        });
    }

    // Stable sort keeps hive order (HKLM64, HKLM32, HKCU, UWP) among same-named apps,
    // and dedup keeps the first entry of each name.
    apps.sort_by(|a, b| a.name.cmp(&b.name));
    apps.dedup_by(|a, b| a.name == b.name);
    apps
}

#[cfg(target_os = "macos")]
fn extract_plist_key_str(xml: &str, key: &str) -> String {
    let needle = format!("<key>{key}</key>");
    let Some(idx) = xml.find(&needle) else {
        return String::new();
    };
    let rest = &xml[idx + needle.len()..];
    let Some(s_start) = rest.find("<string>") else {
        return String::new();
    };
    let after_s = &rest[s_start + 8..];
    let Some(s_end) = after_s.find("</string>") else {
        return String::new();
    };
    after_s[..s_end].trim().to_string()
}

#[cfg(target_os = "macos")]
pub fn get_installed_apps() -> Vec<AppInfo> {
    let mut apps = Vec::new();
    let mut roots = vec![("MACSYS", std::path::PathBuf::from("/Applications"))];
    if let Some(home) = dirs::home_dir() {
        roots.push(("MACUSR", home.join("Applications")));
    }

    for (prefix, root) in roots {
        let Ok(entries) = std::fs::read_dir(&root) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let file_name = entry.file_name().to_string_lossy().into_owned();
            if !file_name.ends_with(".app") || !path.is_dir() {
                continue;
            }
            if file_name.to_ascii_lowercase().contains("sweepr") {
                continue;
            }
            let display_name = file_name.trim_end_matches(".app").to_string();
            let plist_path = path.join("Contents/Info.plist");
            let plist_xml = std::fs::read_to_string(&plist_path).unwrap_or_default();
            let version = {
                let v = extract_plist_key_str(&plist_xml, "CFBundleShortVersionString");
                if v.is_empty() {
                    extract_plist_key_str(&plist_xml, "CFBundleVersion")
                } else {
                    v
                }
            };
            let bundle_id = extract_plist_key_str(&plist_xml, "CFBundleIdentifier");
            let (bytes, _) = dir_size_and_files(&path, 400);

            apps.push(AppInfo {
                id: format!("{prefix}:{file_name}"),
                name: display_name,
                publisher: bundle_id,
                version,
                install_date: String::new(),
                estimated_size: bytes,
                kind: "macos".into(),
                can_force_remove: false,
            });
        }
    }

    apps.sort_by(|a, b| a.name.to_ascii_lowercase().cmp(&b.name.to_ascii_lowercase()));
    apps.dedup_by(|a, b| a.name == b.name);
    apps
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(not(all(unix, not(target_os = "macos"))), allow(dead_code))]
pub enum LinuxAppKind {
    DeskSys,
    DeskLoc,
    DeskUsr,
    Flatpak,
    Snap,
}

#[cfg_attr(not(all(unix, not(target_os = "macos"))), allow(dead_code))]
pub fn parse_linux_app_id(id: &str) -> AppResult<(LinuxAppKind, &str)> {
    let invalid = || AppError::Other("Invalid Linux application id".into());
    let (prefix, key) = id.split_once(':').ok_or_else(invalid)?;
    let kind = match prefix {
        "DESKSYS" => LinuxAppKind::DeskSys,
        "DESKLOC" => LinuxAppKind::DeskLoc,
        "DESKUSR" => LinuxAppKind::DeskUsr,
        "FLATPAK" => LinuxAppKind::Flatpak,
        "SNAP" => LinuxAppKind::Snap,
        _ => return Err(invalid()),
    };
    if key.is_empty()
        || key.len() > 255
        || key.contains(['/', '\\', '\0'])
        || key.contains("..")
        || key.chars().any(|c| {
            c.is_whitespace() || matches!(c, '"' | '\'' | ';' | '&' | '|' | '$' | '`' | '(' | ')' | '<' | '>')
        })
    {
        return Err(invalid());
    }
    match kind {
        LinuxAppKind::DeskSys | LinuxAppKind::DeskLoc | LinuxAppKind::DeskUsr => {
            if key.starts_with('.') || !key.ends_with(".desktop") {
                return Err(invalid());
            }
        }
        LinuxAppKind::Flatpak => {
            if key.starts_with('.')
                || key.ends_with('.')
                || !key.contains('.')
                || !key
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
            {
                return Err(invalid());
            }
        }
        LinuxAppKind::Snap => {
            if key.starts_with('-')
                || key.ends_with('-')
                || !key
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
            {
                return Err(invalid());
            }
        }
    }
    Ok((kind, key))
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(not(all(unix, not(target_os = "macos"))), allow(dead_code))]
pub struct DesktopEntry {
    pub name: String,
    pub exec: String,
    pub try_exec: String,
    pub icon: String,
    pub comment: String,
    pub categories: String,
    pub x_flatpak: String,
    pub x_snap: String,
}

#[cfg_attr(not(all(unix, not(target_os = "macos"))), allow(dead_code))]
pub fn parse_desktop_entry(raw: &str) -> Option<DesktopEntry> {
    let mut in_desktop_entry = false;
    let mut entry_type = String::new();
    let mut name = String::new();
    let mut exec = String::new();
    let mut try_exec = String::new();
    let mut icon = String::new();
    let mut comment = String::new();
    let mut categories = String::new();
    let mut x_flatpak = String::new();
    let mut x_snap = String::new();
    let mut no_display = false;
    let mut hidden = false;

    for raw_line in raw.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if line.starts_with('[') && line.ends_with(']') {
            if line == "[Desktop Entry]" {
                in_desktop_entry = true;
                continue;
            }
            if in_desktop_entry {
                break;
            }
            continue;
        }
        if !in_desktop_entry {
            continue;
        }
        let Some((k, v)) = line.split_once('=') else {
            continue;
        };
        let key = k.trim();
        let val = v.trim();
        match key {
            "Type" => entry_type = val.to_string(),
            "Name" => name = val.to_string(),
            "Exec" => exec = val.to_string(),
            "TryExec" => try_exec = val.to_string(),
            "Icon" => icon = val.to_string(),
            "Comment" => comment = val.to_string(),
            "Categories" => categories = val.to_string(),
            "X-Flatpak" => x_flatpak = val.to_string(),
            "X-SnapInstanceName" => x_snap = val.to_string(),
            "NoDisplay" => no_display = val.eq_ignore_ascii_case("true"),
            "Hidden" => hidden = val.eq_ignore_ascii_case("true"),
            _ => {}
        }
    }

    if no_display || hidden {
        return None;
    }
    if !entry_type.is_empty() && entry_type != "Application" {
        return None;
    }
    if name.trim().is_empty() || name.to_ascii_lowercase().contains("sweepr") {
        return None;
    }
    Some(DesktopEntry {
        name,
        exec,
        try_exec,
        icon,
        comment,
        categories,
        x_flatpak,
        x_snap,
    })
}

#[cfg_attr(not(all(unix, not(target_os = "macos"))), allow(dead_code))]
fn split_desktop_exec_tokens(exec: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut cur = String::new();
    let mut quote: Option<char> = None;
    let mut escape = false;
    for ch in exec.trim().chars() {
        if escape {
            cur.push(ch);
            escape = false;
            continue;
        }
        if ch == '\\' && quote != Some('\'') {
            escape = true;
            continue;
        }
        if let Some(q) = quote {
            if ch == q {
                quote = None;
            } else {
                cur.push(ch);
            }
        } else if ch == '"' || ch == '\'' {
            quote = Some(ch);
        } else if ch.is_whitespace() {
            if !cur.is_empty() {
                tokens.push(std::mem::take(&mut cur));
            }
        } else {
            cur.push(ch);
        }
    }
    if !cur.is_empty() {
        tokens.push(cur);
    }
    tokens
}

#[cfg_attr(not(all(unix, not(target_os = "macos"))), allow(dead_code))]
pub fn extract_exec_binary(exec: &str) -> Option<String> {
    let tokens = split_desktop_exec_tokens(exec);
    let mut idx = 0usize;
    while idx < tokens.len() {
        let tok = tokens[idx].trim();
        if tok.is_empty() {
            idx += 1;
            continue;
        }
        if tok == "env" || tok == "/usr/bin/env" {
            idx += 1;
            continue;
        }
        if tok.contains('=') && !tok.starts_with('/') && !tok.starts_with('.') {
            idx += 1;
            continue;
        }
        if tok.starts_with('%') && tok.len() == 2 {
            idx += 1;
            continue;
        }
        return Some(tok.to_string());
    }
    None
}

#[cfg_attr(not(all(unix, not(target_os = "macos"))), allow(dead_code))]
pub fn is_appimage_path(exec_bin: &str) -> bool {
    exec_bin.trim().to_ascii_lowercase().ends_with(".appimage")
}

#[cfg_attr(not(all(unix, not(target_os = "macos"))), allow(dead_code))]
fn measure_exec_target_bytes(exec_bin: &str, resolve_system_path: bool) -> u64 {
    let p = std::path::Path::new(exec_bin);
    if p.is_absolute() {
        if is_appimage_path(exec_bin) {
            return std::fs::metadata(p).map(|m| m.len()).unwrap_or(0);
        }
        if let Ok(rel) = p.strip_prefix("/opt") {
            if let Some(first) = rel.components().next() {
                let opt_dir = std::path::Path::new("/opt").join(first.as_os_str());
                if opt_dir.is_dir() {
                    let (bytes, _) = dir_size_and_files(&opt_dir, 400);
                    if bytes > 0 {
                        return bytes;
                    }
                }
            }
        }
        if let Ok(md) = std::fs::metadata(p) {
            if md.is_file() {
                return md.len();
            }
            if md.is_dir() {
                return dir_size_and_files(p, 400).0;
            }
        }
        return 0;
    }
    if resolve_system_path && !exec_bin.contains(['/', '\\']) {
        for dir in ["/usr/bin", "/usr/local/bin", "/bin"] {
            let candidate = std::path::Path::new(dir).join(exec_bin);
            if let Ok(md) = std::fs::metadata(&candidate) {
                if md.is_file() {
                    return md.len();
                }
            }
        }
    }
    0
}

#[cfg_attr(not(all(unix, not(target_os = "macos"))), allow(dead_code))]
pub fn scan_desktop_dir_into(
    prefix: &str,
    dir: &std::path::Path,
    apps: &mut Vec<AppInfo>,
    resolve_system_path: bool,
) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let file_name = entry.file_name().to_string_lossy().into_owned();
        if !file_name.ends_with(".desktop") || file_name.starts_with('.') {
            continue;
        }
        let path = entry.path();
        let Ok(md) = std::fs::symlink_metadata(&path) else {
            continue;
        };
        if !md.is_file() || crate::safety::metadata_is_link_like(&md) {
            continue;
        }
        let id = format!("{prefix}:{file_name}");
        if parse_linux_app_id(&id).is_err() {
            continue;
        }
        let Ok(raw) = std::fs::read_to_string(&path) else {
            continue;
        };
        let Some(parsed) = parse_desktop_entry(&raw) else {
            continue;
        };
        if !parsed.x_flatpak.is_empty() || !parsed.x_snap.is_empty() {
            continue;
        }
        let exec_bin = extract_exec_binary(&parsed.exec)
            .or_else(|| extract_exec_binary(&parsed.try_exec))
            .unwrap_or_default();
        if matches!(
            exec_bin.rsplit('/').next().unwrap_or(exec_bin.as_str()),
            "flatpak" | "snap"
        ) && (parsed.exec.contains(" run ") || parsed.exec.starts_with("snap "))
        {
            continue;
        }
        let estimated_size = if exec_bin.is_empty() {
            0
        } else {
            measure_exec_target_bytes(&exec_bin, resolve_system_path)
        };
        let publisher = if is_appimage_path(&exec_bin) {
            "AppImage".to_string()
        } else if !parsed.categories.is_empty() {
            parsed
                .categories
                .split(';')
                .find(|c| !c.trim().is_empty())
                .unwrap_or("Desktop App")
                .trim()
                .to_string()
        } else {
            "Desktop App".to_string()
        };
        apps.push(AppInfo {
            id,
            name: parsed.name,
            publisher,
            version: String::new(),
            install_date: String::new(),
            estimated_size,
            kind: "linux".into(),
            can_force_remove: false,
        });
    }
}

#[cfg_attr(not(all(unix, not(target_os = "macos"))), allow(dead_code))]
pub fn parse_flatpak_list(raw: &str) -> Vec<AppInfo> {
    let mut apps = Vec::new();
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let cols: Vec<&str> = if trimmed.contains('\t') {
            trimmed.split('\t').map(str::trim).collect()
        } else {
            trimmed.split_whitespace().collect()
        };
        if cols.is_empty() {
            continue;
        }
        let app_id = cols[0];
        let id = format!("FLATPAK:{app_id}");
        if parse_linux_app_id(&id).is_err() {
            continue;
        }
        let name = cols
            .get(1)
            .copied()
            .filter(|s| !s.is_empty())
            .unwrap_or(app_id)
            .to_string();
        if name.to_ascii_lowercase().contains("sweepr") {
            continue;
        }
        let version = cols.get(2).copied().unwrap_or_default().to_string();
        apps.push(AppInfo {
            id,
            name,
            publisher: format!("Flatpak ({app_id})"),
            version,
            install_date: String::new(),
            estimated_size: 0,
            kind: "linux".into(),
            can_force_remove: false,
        });
    }
    apps
}

#[cfg_attr(not(all(unix, not(target_os = "macos"))), allow(dead_code))]
pub fn parse_snap_list(raw: &str) -> Vec<AppInfo> {
    let mut apps = Vec::new();
    for (idx, line) in raw.lines().enumerate() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let cols: Vec<&str> = trimmed.split_whitespace().collect();
        if cols.len() < 2 {
            continue;
        }
        if idx == 0 && cols[0].eq_ignore_ascii_case("Name") {
            continue;
        }
        let snap_name = cols[0];
        if matches!(snap_name, "bare" | "snapd")
            || snap_name.starts_with("core")
            || snap_name.starts_with("gtk-common-themes")
        {
            continue;
        }
        let id = format!("SNAP:{snap_name}");
        if parse_linux_app_id(&id).is_err() {
            continue;
        }
        if snap_name.to_ascii_lowercase().contains("sweepr") {
            continue;
        }
        let version = cols[1].to_string();
        let publisher = cols
            .get(4)
            .copied()
            .filter(|p| *p != "-")
            .unwrap_or("Snap")
            .to_string();
        apps.push(AppInfo {
            id,
            name: snap_name.to_string(),
            publisher,
            version,
            install_date: String::new(),
            estimated_size: 0,
            kind: "linux".into(),
            can_force_remove: false,
        });
    }
    apps
}

#[cfg_attr(not(all(unix, not(target_os = "macos"))), allow(dead_code))]
pub fn parse_snap_yaml(raw: &str) -> Option<(String, String, String)> {
    let mut name = String::new();
    let mut version = String::new();
    let mut summary = String::new();
    for line in raw.lines() {
        if line.starts_with(' ') || line.starts_with('\t') || line.trim().is_empty() {
            continue;
        }
        if let Some((k, v)) = line.split_once(':') {
            let key = k.trim();
            let val = v.trim().trim_matches(|c| c == '\'' || c == '"');
            match key {
                "name" => name = val.to_string(),
                "version" => version = val.to_string(),
                "summary" => summary = val.to_string(),
                _ => {}
            }
        }
    }
    if name.is_empty() {
        None
    } else {
        Some((name, version, summary))
    }
}

#[cfg_attr(not(all(unix, not(target_os = "macos"))), allow(dead_code))]
pub fn validate_linux_package_name(pkg: &str) -> AppResult<&str> {
    let trimmed = pkg.trim();
    if trimmed.is_empty()
        || trimmed.len() > 128
        || trimmed.starts_with('-')
        || !trimmed
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '+' | '_' | '-'))
    {
        return Err(AppError::Other("Invalid Linux package name".into()));
    }
    Ok(trimmed)
}

#[cfg_attr(not(all(unix, not(target_os = "macos"))), allow(dead_code))]
pub fn parse_package_owner_output(manager: &str, raw: &str) -> Option<String> {
    let first_line = raw.lines().find(|l| !l.trim().is_empty())?.trim();
    let pkg = match manager {
        "dpkg" => {
            let left = first_line.split(':').next()?.trim();
            left.split(',').next()?.trim()
        }
        "rpm" => first_line,
        "pacman" => {
            let marker = " is owned by ";
            let idx = first_line.find(marker)?;
            first_line[idx + marker.len()..].split_whitespace().next()?
        }
        _ => return None,
    };
    validate_linux_package_name(pkg).ok().map(str::to_string)
}

#[cfg(all(unix, not(target_os = "macos")))]
fn flatpak_app_size(app_id: &str) -> u64 {
    let mut candidates = vec![std::path::PathBuf::from("/var/lib/flatpak/app").join(app_id)];
    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join(".local/share/flatpak/app").join(app_id));
    }
    for dir in candidates {
        if dir.is_dir() {
            let (bytes, _) = dir_size_and_files(&dir, 400);
            if bytes > 0 {
                return bytes;
            }
        }
    }
    0
}

#[cfg(all(unix, not(target_os = "macos")))]
fn snap_app_size(snap_name: &str) -> u64 {
    let snaps_dir = std::path::Path::new("/var/lib/snapd/snaps");
    if let Ok(rd) = std::fs::read_dir(snaps_dir) {
        let prefix = format!("{snap_name}_");
        for e in rd.flatten() {
            let fname = e.file_name().to_string_lossy().into_owned();
            if fname.starts_with(&prefix) && fname.ends_with(".snap") {
                if let Ok(md) = e.metadata() {
                    if md.len() > 0 {
                        return md.len();
                    }
                }
            }
        }
    }
    let current = std::path::PathBuf::from("/snap").join(snap_name).join("current");
    if current.is_dir() {
        return dir_size_and_files(&current, 400).0;
    }
    0
}

#[cfg(all(unix, not(target_os = "macos")))]
pub fn get_installed_apps() -> Vec<AppInfo> {
    let mut apps = Vec::new();

    if let Ok(out) = std::process::Command::new("flatpak")
        .args(["list", "--app", "--columns=application,name,version"])
        .output()
    {
        if out.status.success() {
            let stdout = String::from_utf8_lossy(&out.stdout);
            for mut app in parse_flatpak_list(&stdout) {
                if let Some((_, app_id)) = app.id.split_once(':') {
                    app.estimated_size = flatpak_app_size(app_id);
                }
                apps.push(app);
            }
        }
    }

    let mut snap_found = false;
    if let Ok(out) = std::process::Command::new("snap").arg("list").output() {
        if out.status.success() {
            let stdout = String::from_utf8_lossy(&out.stdout);
            for mut app in parse_snap_list(&stdout) {
                app.estimated_size = snap_app_size(&app.name);
                apps.push(app);
            }
            snap_found = true;
        }
    }
    if !snap_found {
        if let Ok(rd) = std::fs::read_dir("/snap") {
            for e in rd.flatten() {
                let yaml_path = e.path().join("current/meta/snap.yaml");
                if let Ok(raw) = std::fs::read_to_string(yaml_path) {
                    if let Some((name, version, summary)) = parse_snap_yaml(&raw) {
                        let id = format!("SNAP:{name}");
                        if parse_linux_app_id(&id).is_ok()
                            && !name.to_ascii_lowercase().contains("sweepr")
                            && !matches!(name.as_str(), "bare" | "snapd")
                            && !name.starts_with("core")
                        {
                            apps.push(AppInfo {
                                id,
                                estimated_size: snap_app_size(&name),
                                name,
                                publisher: if summary.is_empty() { "Snap".into() } else { summary },
                                version,
                                install_date: String::new(),
                                kind: "linux".into(),
                                can_force_remove: false,
                            });
                        }
                    }
                }
            }
        }
    }

    if let Some(home) = dirs::home_dir() {
        scan_desktop_dir_into("DESKUSR", &home.join(".local/share/applications"), &mut apps, true);
    }
    scan_desktop_dir_into("DESKLOC", std::path::Path::new("/usr/local/share/applications"), &mut apps, true);
    scan_desktop_dir_into("DESKSYS", std::path::Path::new("/usr/share/applications"), &mut apps, true);

    apps.sort_by(|a, b| a.name.to_ascii_lowercase().cmp(&b.name.to_ascii_lowercase()));
    apps.dedup_by(|a, b| a.name.eq_ignore_ascii_case(&b.name));
    apps
}

#[cfg(all(not(target_os = "windows"), not(target_os = "macos"), not(unix)))]
pub fn get_installed_apps() -> Vec<AppInfo> {
    Vec::new()
}

#[tauri::command]
pub fn fetch_apps() -> Vec<AppInfo> {
    get_installed_apps()
}

#[cfg(target_os = "windows")]
fn lookup_uninstall_string(id: &str) -> AppResult<String> {
    use winreg::enums::*;
    use winreg::RegKey;

    let (prefix, subkey) = parse_app_id(id)?;
    let (is_hklm, base) = hive_for(prefix).ok_or_else(|| AppError::Other("Invalid application id".into()))?;
    let root = RegKey::predef(if is_hklm { HKEY_LOCAL_MACHINE } else { HKEY_CURRENT_USER });
    let key = root
        .open_subkey_with_flags(format!("{base}\\{subkey}"), KEY_READ)
        .map_err(|_| AppError::NotFound("application is no longer installed".into()))?;
    let s: String = key
        .get_value("UninstallString")
        .map_err(|_| AppError::NotFound("application has no uninstaller".into()))?;
    if s.trim().is_empty() {
        return Err(AppError::NotFound("application has no uninstaller".into()));
    }
    Ok(s)
}

/// Resolve the registry command into an existing executable + raw arguments.
#[cfg(target_os = "windows")]
fn resolve_program(uninstall_string: &str) -> AppResult<(std::path::PathBuf, String)> {
    use crate::cmdline::{expand_env, split_command};
    use std::path::{Path, PathBuf};

    let (prog, args) = split_command(&expand_env(uninstall_string));
    let mut path = PathBuf::from(&prog);
    if !prog.contains(['\\', '/']) {
        // Bare name: only allow msiexec / msiexec.exe to resolve from System32.
        if !prog.eq_ignore_ascii_case("msiexec") && !prog.eq_ignore_ascii_case("msiexec.exe") {
            return Err(AppError::Other(format!(
                "Refusing to resolve bare uninstaller binary: {prog}"
            )));
        }
        let sys = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
        let base = Path::new(&sys).join("System32");
        path = base.join("msiexec.exe");
    }
    let file_name_check = path
        .file_name()
        .map(|f| f.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    if file_name_check == "msiexec.exe" {
        let lower_args = args.to_ascii_lowercase();
        if lower_args.contains("http://")
            || lower_args.contains("https://")
            || lower_args.contains("\\\\")
            || !args.contains('{')
            || !args.contains('}')
        {
            return Err(AppError::Other(
                "Refusing to run msiexec without a valid local product GUID or with a remote/UNC target.".into(),
            ));
        }
    }
    if !path.is_absolute() || !path.is_file() {
        return Err(AppError::Other(format!("Uninstaller not found: {}", path.display())));
    }
    let file_name_lower = path
        .file_name()
        .map(|f| f.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    if matches!(
        file_name_lower.as_str(),
        "cmd.exe"
            | "powershell.exe"
            | "pwsh.exe"
            | "mshta.exe"
            | "wscript.exe"
            | "cscript.exe"
            | "rundll32.exe"
            | "regsvr32.exe"
    ) {
        return Err(AppError::Other(format!(
            "Refusing to execute scripting host as uninstaller: {file_name_lower}"
        )));
    }
    let is_exe = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("exe"))
        .unwrap_or(false);
    if !is_exe {
        return Err(AppError::Other("Refusing to run non-.exe uninstaller target".into()));
    }
    if let Ok(md) = std::fs::symlink_metadata(&path) {
        if crate::safety::metadata_is_link_like(&md) {
            return Err(AppError::Other("Refusing to run symlink or reparse-point uninstaller".into()));
        }
    }
    Ok((path, args))
}

#[cfg(target_os = "windows")]
fn system_powershell_path() -> std::path::PathBuf {
    crate::safety::system_powershell_path()
}

/// Run the uninstaller without a shell. Falls back to an elevated launch when
/// Windows reports that the uninstaller requires administrator rights.
#[cfg(target_os = "windows")]
fn launch(program: &std::path::Path, args: &str) -> AppResult<()> {
    use std::os::windows::process::CommandExt;

    let mut cmd = std::process::Command::new(program);
    if !args.is_empty() {
        cmd.raw_arg(args);
    }
    match cmd.spawn() {
        Ok(_) => Ok(()),
        Err(e) if e.raw_os_error() == Some(740) => {
            // ERROR_ELEVATION_REQUIRED: elevate via ProcessStartInfo with Verb='runas'
            // passing FileName and Arguments via environment variables so untrusted strings
            // are never interpolated into PowerShell source code.
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            let script = "$psi = New-Object System.Diagnostics.ProcessStartInfo; $psi.FileName = $env:SWEEPR_PS_TARGET; $psi.Arguments = $env:SWEEPR_PS_ARGS; $psi.Verb = 'runas'; $psi.UseShellExecute = $true; [System.Diagnostics.Process]::Start($psi) | Out-Null";
            std::process::Command::new(system_powershell_path())
                .env("SWEEPR_PS_TARGET", program.as_os_str())
                .env("SWEEPR_PS_ARGS", args)
                .args([
                    "-NoProfile",
                    "-NonInteractive",
                    "-WindowStyle",
                    "Hidden",
                    "-Command",
                    script,
                ])
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
                .map(|_| ())
                .map_err(|e| AppError::Other(format!("Could not start uninstaller: {e}")))
        }
        Err(e) => Err(AppError::Other(format!("Could not start uninstaller: {e}"))),
    }
}

#[cfg(target_os = "windows")]
fn uninstall_uwp_blocking(id: &str) -> AppResult<()> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let full_name = parse_uwp_app_id(id)?;
    let matches = query_appx_packages(Some(full_name));
    let pkg = matches
        .into_iter()
        .find(|p| p.package_full_name.eq_ignore_ascii_case(full_name))
        .ok_or_else(|| AppError::NotFound("Microsoft Store app is no longer installed".into()))?;
    if !is_safe_removable_appx(&pkg) {
        return Err(AppError::Other(
            "Refusing to remove protected Windows system or runtime Store package.".into(),
        ));
    }

    let out = std::process::Command::new(system_powershell_path())
        .env("SWEEPR_APPX_FULLNAME", &pkg.package_full_name)
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-Command",
            "Remove-AppxPackage -Package $env:SWEEPR_APPX_FULLNAME -ErrorAction Stop",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| AppError::Other(format!("Could not invoke Remove-AppxPackage: {e}")))?;

    if out.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
        let detail = if !stderr.is_empty() { stderr } else { stdout };
        Err(AppError::Other(if detail.is_empty() {
            "Microsoft Store app removal failed.".into()
        } else {
            detail
        }))
    }
}

#[cfg(target_os = "windows")]
fn lookup_win32_display_name(id: &str) -> String {
    use winreg::enums::*;
    use winreg::RegKey;
    let Ok((prefix, subkey)) = parse_app_id(id) else {
        return id.to_string();
    };
    let Some((is_hklm, base)) = hive_for(prefix) else {
        return id.to_string();
    };
    let root = RegKey::predef(if is_hklm { HKEY_LOCAL_MACHINE } else { HKEY_CURRENT_USER });
    root.open_subkey_with_flags(format!("{base}\\{subkey}"), KEY_READ)
        .ok()
        .and_then(|k| k.get_value::<String, _>("DisplayName").ok())
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| subkey.to_string())
}

#[cfg(target_os = "windows")]
fn launch_and_wait_for_batch(program: &std::path::Path, args: &str) -> AppResult<&'static str> {
    use std::os::windows::process::CommandExt;

    let is_msi = program
        .file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.eq_ignore_ascii_case("msiexec.exe"))
        .unwrap_or(false);

    let mut cmd = std::process::Command::new(program);
    if !args.is_empty() {
        cmd.raw_arg(args);
    }

    let check_exit = |code: Option<i32>| -> AppResult<&'static str> {
        match code {
            Some(0) | Some(3010) => Ok("removed"),
            Some(1602) | Some(1223) => Err(AppError::Other("Cancelled by user.".into())),
            Some(1618) => Err(AppError::Other("Another Windows Installer operation is already in progress.".into())),
            Some(c) if is_msi => Err(AppError::Other(format!("Windows Installer exited with code {c}."))),
            Some(_) => Ok("launched"),
            None => Ok("launched"),
        }
    };

    match cmd.status() {
        Ok(st) => check_exit(st.code()),
        Err(e) if e.raw_os_error() == Some(740) => {
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            let script = r#"
try {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $env:SWEEPR_PS_TARGET
  $psi.Arguments = $env:SWEEPR_PS_ARGS
  $psi.Verb = 'runas'
  $psi.UseShellExecute = $true
  $p = [System.Diagnostics.Process]::Start($psi)
  if ($null -eq $p) { exit 1 }
  $p.WaitForExit()
  exit $p.ExitCode
} catch [System.ComponentModel.Win32Exception] {
  if ($_.Exception.NativeErrorCode -eq 1223) { exit 1223 }
  Write-Error $_.Exception.Message
  exit 1
}
"#;
            let out = std::process::Command::new(system_powershell_path())
                .env("SWEEPR_PS_TARGET", program.as_os_str())
                .env("SWEEPR_PS_ARGS", args)
                .args([
                    "-NoProfile",
                    "-NonInteractive",
                    "-WindowStyle",
                    "Hidden",
                    "-Command",
                    script,
                ])
                .creation_flags(CREATE_NO_WINDOW)
                .output()
                .map_err(|e| AppError::Other(format!("Could not start elevated uninstaller: {e}")))?;
            check_exit(out.status.code())
        }
        Err(e) => Err(AppError::Other(format!("Could not start uninstaller: {e}"))),
    }
}

/// Pro feature: requires an active licence. Takes only the app id; the
/// uninstall command is read from the registry (or verified UWP package) here, never from the UI.
#[tauri::command]
pub async fn uninstall_app(state: State<'_, AppState>, id: String) -> AppResult<()> {
    #[cfg(target_os = "windows")]
    {
        if id.starts_with("UWP:") {
            parse_uwp_app_id(&id)?;
        } else {
            parse_app_id(&id)?;
        }
    }
    state.licensing.require_active().await?;

    #[cfg(target_os = "windows")]
    {
        tauri::async_runtime::spawn_blocking(move || {
            if id.starts_with("UWP:") {
                uninstall_uwp_blocking(&id)
            } else {
                let s = lookup_uninstall_string(&id)?;
                let (program, args) = resolve_program(&s)?;
                launch(&program, &args)
            }
        })
        .await
        .map_err(|e| AppError::Other(format!("background task failed: {e}")))?
    }

    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(move || {
            let (prefix, bundle_name) = id
                .split_once(':')
                .ok_or_else(|| AppError::Other("Invalid application id".into()))?;
            if !bundle_name.ends_with(".app")
                || bundle_name.contains(['/', '\\', '\0'])
                || bundle_name.starts_with('.')
            {
                return Err(AppError::Other("Invalid macOS application bundle".into()));
            }
            let base = match prefix {
                "MACSYS" => std::path::PathBuf::from("/Applications"),
                "MACUSR" => dirs::home_dir()
                    .ok_or_else(|| AppError::Other("Home directory not found".into()))?
                    .join("Applications"),
                _ => return Err(AppError::Other("Invalid application scope".into())),
            };
            let app_path = base.join(bundle_name);
            let md = std::fs::symlink_metadata(&app_path)
                .map_err(|_| AppError::NotFound("Application bundle is no longer installed".into()))?;
            if crate::safety::metadata_is_link_like(&md) || !md.is_dir() {
                return Err(AppError::Other(
                    "Refusing to uninstall symlink or non-directory bundle".into(),
                ));
            }
            trash::delete(&app_path)
                .map_err(|e| AppError::Other(format!("Could not move app to Trash: {e}")))
        })
        .await
        .map_err(|e| AppError::Other(format!("background task failed: {e}")))?
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let (kind, key) = parse_linux_app_id(&id)?;
        let key_owned = key.to_string();
        tauri::async_runtime::spawn_blocking(move || uninstall_linux_blocking(kind, &key_owned))
            .await
            .map_err(|e| AppError::Other(format!("background task failed: {e}")))?
    }

    #[cfg(all(not(target_os = "windows"), not(target_os = "macos"), not(unix)))]
    {
        let _ = id;
        Err(AppError::Other("Not supported on this OS".into()))
    }
}

pub const MAX_BATCH_UNINSTALL: usize = 50;

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct BatchUninstallItemResult {
    pub id: String,
    pub name: String,
    pub ok: bool,
    pub status: String, // "removed" | "launched" | "failed"
    pub message: String,
}

#[derive(Serialize, Clone, Debug, Default, PartialEq, Eq)]
pub struct BatchUninstallReport {
    pub total: usize,
    pub succeeded: usize,
    pub failed: usize,
    pub results: Vec<BatchUninstallItemResult>,
}

#[derive(Serialize, Clone, Debug)]
struct BatchUninstallProgress {
    done: usize,
    total: usize,
    id: String,
    name: String,
    status: String,
}

pub fn dedup_and_cap_batch_ids(ids: Vec<String>) -> Vec<String> {
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for raw in ids {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        if seen.insert(trimmed.to_string()) {
            out.push(trimmed.to_string());
            if out.len() >= MAX_BATCH_UNINSTALL {
                break;
            }
        }
    }
    out
}

fn display_name_for_batch_id(id: &str) -> String {
    #[cfg(target_os = "windows")]
    {
        if id.starts_with("UWP:") {
            return parse_uwp_app_id(id)
                .ok()
                .and_then(|full| full.split('_').next())
                .unwrap_or(id)
                .to_string();
        }
        return lookup_win32_display_name(id);
    }

    #[cfg(target_os = "macos")]
    {
        return id
            .split_once(':')
            .map(|(_, b)| b.trim_end_matches(".app").to_string())
            .unwrap_or_else(|| id.to_string());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        return id
            .split_once(':')
            .map(|(_, k)| k.to_string())
            .unwrap_or_else(|| id.to_string());
    }

    #[cfg(all(not(target_os = "windows"), not(target_os = "macos"), not(unix)))]
    {
        id.to_string()
    }
}

fn uninstall_single_for_batch_blocking(id: &str) -> (String, Result<(&'static str, String), String>) {
    #[cfg(target_os = "windows")]
    {
        if id.starts_with("UWP:") {
            let name = parse_uwp_app_id(id)
                .ok()
                .and_then(|full| full.split('_').next())
                .unwrap_or(id)
                .to_string();
            return match uninstall_uwp_blocking(id) {
                Ok(()) => (name, Ok(("removed", "Removed Microsoft Store app.".into()))),
                Err(e) => (name, Err(e.to_string())),
            };
        }
        let name = lookup_win32_display_name(id);
        let res = (|| -> AppResult<(&'static str, String)> {
            parse_app_id(id)?;
            let s = lookup_uninstall_string(id)?;
            let (program, args) = resolve_program(&s)?;
            let status = launch_and_wait_for_batch(&program, &args)?;
            let msg = if status == "removed" {
                "Uninstaller completed.".to_string()
            } else {
                "Uninstaller finished or launched.".to_string()
            };
            Ok((status, msg))
        })();
        return (name, res.map_err(|e| e.to_string()));
    }

    #[cfg(target_os = "macos")]
    {
        let name = id
            .split_once(':')
            .map(|(_, b)| b.trim_end_matches(".app").to_string())
            .unwrap_or_else(|| id.to_string());
        let res = (|| -> AppResult<(&'static str, String)> {
            let (prefix, bundle_name) = id
                .split_once(':')
                .ok_or_else(|| AppError::Other("Invalid application id".into()))?;
            if !bundle_name.ends_with(".app")
                || bundle_name.contains(['/', '\\', '\0'])
                || bundle_name.starts_with('.')
            {
                return Err(AppError::Other("Invalid macOS application bundle".into()));
            }
            let base = match prefix {
                "MACSYS" => std::path::PathBuf::from("/Applications"),
                "MACUSR" => dirs::home_dir()
                    .ok_or_else(|| AppError::Other("Home directory not found".into()))?
                    .join("Applications"),
                _ => return Err(AppError::Other("Invalid application scope".into())),
            };
            let app_path = base.join(bundle_name);
            let md = std::fs::symlink_metadata(&app_path)
                .map_err(|_| AppError::NotFound("Application bundle is no longer installed".into()))?;
            if crate::safety::metadata_is_link_like(&md) || !md.is_dir() {
                return Err(AppError::Other(
                    "Refusing to uninstall symlink or non-directory bundle".into(),
                ));
            }
            trash::delete(&app_path)
                .map_err(|e| AppError::Other(format!("Could not move app to Trash: {e}")))?;
            Ok(("removed", "Moved application bundle to Trash.".into()))
        })();
        return (name, res.map_err(|e| e.to_string()));
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let name = id
            .split_once(':')
            .map(|(_, k)| k.to_string())
            .unwrap_or_else(|| id.to_string());
        let res = (|| -> AppResult<(&'static str, String)> {
            let (kind, key) = parse_linux_app_id(id)?;
            uninstall_linux_blocking(kind, key)?;
            Ok(("removed", "Application removed.".into()))
        })();
        return (name, res.map_err(|e| e.to_string()));
    }

    #[cfg(all(not(target_os = "windows"), not(target_os = "macos"), not(unix)))]
    {
        (id.to_string(), Err("Not supported on this OS".into()))
    }
}

/// Pro feature: sequentially uninstall multiple apps (preventing MSI 1618 collisions)
/// and emit per-item progress on `"uninstaller://batch-progress"`.
#[tauri::command]
pub async fn uninstall_apps_batch(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    ids: Vec<String>,
) -> AppResult<BatchUninstallReport> {
    state.licensing.require_active().await?;
    let batch_ids = dedup_and_cap_batch_ids(ids);
    if batch_ids.is_empty() {
        return Ok(BatchUninstallReport::default());
    }

    tauri::async_runtime::spawn_blocking(move || {
        let total = batch_ids.len();
        let mut results = Vec::with_capacity(total);
        let mut succeeded = 0usize;
        let mut failed = 0usize;

        for (idx, id) in batch_ids.into_iter().enumerate() {
            let starting_name = display_name_for_batch_id(&id);
            let _ = app.emit(
                "uninstaller://batch-progress",
                BatchUninstallProgress {
                    done: idx,
                    total,
                    id: id.clone(),
                    name: starting_name,
                    status: "running".to_string(),
                },
            );
            let (name, outcome) = uninstall_single_for_batch_blocking(&id);
            let item = match outcome {
                Ok((status, message)) => {
                    succeeded += 1;
                    BatchUninstallItemResult {
                        id: id.clone(),
                        name: name.clone(),
                        ok: true,
                        status: status.to_string(),
                        message,
                    }
                }
                Err(err_msg) => {
                    failed += 1;
                    BatchUninstallItemResult {
                        id: id.clone(),
                        name: name.clone(),
                        ok: false,
                        status: "failed".to_string(),
                        message: err_msg,
                    }
                }
            };
            let _ = app.emit(
                "uninstaller://batch-progress",
                BatchUninstallProgress {
                    done: idx + 1,
                    total,
                    id,
                    name,
                    status: item.status.clone(),
                },
            );
            results.push(item);
        }

        BatchUninstallReport {
            total,
            succeeded,
            failed,
            results,
        }
    })
    .await
    .map_err(|e| AppError::Other(format!("background task failed: {e}")))
}

// ---------------------------------------------------------------------------
// #16 "Force Remove Leftovers" (Preview + Safe Removal)
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone, Debug)]
pub struct ForceRemovePreview {
    pub id: String,
    pub app_name: String,
    pub registry_key: String,
    pub install_dir: Option<String>,
    pub install_dir_bytes: u64,
    pub remnant_dirs: Vec<AppRemnant>,
    pub total_bytes: u64,
    pub requires_elevation_for_registry: bool,
    pub warnings: Vec<String>,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct ForceRemoveReport {
    pub id: String,
    pub app_name: String,
    pub registry_removed: bool,
    pub paths_trashed: Vec<String>,
    pub bytes_freed: u64,
    pub warnings: Vec<String>,
}

fn is_generic_app_token(tok: &str) -> bool {
    matches!(
        tok,
        "corp"
            | "corporation"
            | "inc"
            | "ltd"
            | "llc"
            | "gmbh"
            | "software"
            | "technologies"
            | "technology"
            | "studio"
            | "studios"
            | "client"
            | "desktop"
            | "windows"
            | "apps"
            | "app"
            | "tools"
            | "tool"
            | "setup"
            | "installer"
            | "microsoft"
            | "program"
            | "programs"
            | "common"
            | "files"
    )
}

fn extract_meaningful_app_tokens(app_name: &str, publisher: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let full_name = normalise_token(app_name);
    if full_name.len() >= 4 && !is_generic_app_token(&full_name) {
        tokens.push(full_name);
    }
    for word in app_name.split(|c: char| !c.is_ascii_alphanumeric()) {
        let w = normalise_token(word);
        if w.len() >= 4 && !is_generic_app_token(&w) && !tokens.contains(&w) {
            tokens.push(w);
        }
    }
    let full_pub = normalise_token(publisher);
    if full_pub.len() >= 4 && !is_generic_app_token(&full_pub) && !tokens.contains(&full_pub) {
        tokens.push(full_pub);
    }
    tokens
}

fn normalise_force_remove_compare_path(p: &std::path::Path) -> String {
    let resolved = crate::safety::resolve_path_lexically_and_canonically(p)
        .unwrap_or_else(|| p.to_path_buf());
    let raw = resolved.to_string_lossy();
    let stripped = if let Some(rest) = raw.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else if let Some(rest) = raw.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        raw.into_owned()
    };
    stripped
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_ascii_lowercase()
}

fn force_remove_paths_equal(a: &std::path::Path, b: &std::path::Path) -> bool {
    let na = normalise_force_remove_compare_path(a);
    let nb = normalise_force_remove_compare_path(b);
    !na.is_empty() && na == nb
}

fn has_path_prefix_marker(norm: &str, marker: &str) -> bool {
    norm.ends_with(marker) || norm.contains(&format!(r"{marker}\"))
}

/// Dedicated Force-Remove protection guard. Unlike `duplicates::is_protected_system_path`,
/// this permits legitimate app-specific subdirectories inside `%ProgramFiles%`,
/// `%ProgramFiles(x86)%`, and `%ProgramData%` (e.g. `C:\Program Files\<AppName>`),
/// while strictly blocking OS directories, shared Windows components, SWEEPR's own
/// directories, Startup folders, and exact container/drive roots.
pub fn is_protected_force_remove_path(path: &std::path::Path) -> bool {
    if !path.is_absolute() {
        return true;
    }

    let normal_comps: Vec<String> = path
        .components()
        .filter_map(|c| match c {
            std::path::Component::Normal(s) => Some(s.to_string_lossy().to_ascii_lowercase()),
            _ => None,
        })
        .collect();
    if normal_comps.is_empty() {
        return true;
    }

    let norm = normalise_force_remove_compare_path(path);

    if norm.contains(r"\microsoft\windows\start menu\programs\startup")
        || norm.contains(r"\com.sweepr.cleaner")
        || norm.contains(r"\com.sweepr.app")
        || has_path_prefix_marker(&norm, r"\portable_data")
        || has_path_prefix_marker(&norm, r"\appdata\roaming\sweepr")
        || has_path_prefix_marker(&norm, r"\appdata\local\sweepr")
    {
        return true;
    }

    // Block any AppData\*\SWEEPR* folder (Local, Roaming, LocalLow, etc.)
    for win in normal_comps.windows(3) {
        if win[0] == "appdata"
            && matches!(win[1].as_str(), "local" | "roaming" | "locallow")
            && win[2].starts_with("sweepr")
        {
            return true;
        }
    }

    for base in [dirs::data_dir(), dirs::data_local_dir(), dirs::config_dir()]
        .into_iter()
        .flatten()
    {
        for sub in [
            "com.sweepr.cleaner",
            "com.sweepr.app",
            "sweepr",
            r"Microsoft\Windows\Start Menu\Programs\Startup",
        ] {
            if crate::safety::is_within(path, &base.join(sub)) {
                return true;
            }
        }
    }

    #[cfg(windows)]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            let startup =
                std::path::Path::new(&appdata).join(r"Microsoft\Windows\Start Menu\Programs\Startup");
            if crate::safety::is_within(path, &startup) {
                return true;
            }
            if force_remove_paths_equal(path, std::path::Path::new(&appdata)) {
                return true;
            }
        }
        if let Ok(local_appdata) = std::env::var("LOCALAPPDATA") {
            if force_remove_paths_equal(path, std::path::Path::new(&local_appdata)) {
                return true;
            }
        }
        if let Ok(user_profile) = std::env::var("USERPROFILE") {
            let up = std::path::Path::new(&user_profile);
            if force_remove_paths_equal(path, up)
                || force_remove_paths_equal(path, &up.join("AppData"))
                || force_remove_paths_equal(path, &up.join(r"AppData\LocalLow"))
            {
                return true;
            }
            if let Some(users_root) = up.parent() {
                if force_remove_paths_equal(path, users_root) {
                    return true;
                }
            }
        }
        if let Ok(progdata) = std::env::var("ProgramData") {
            let pd = std::path::Path::new(&progdata);
            if force_remove_paths_equal(path, pd) {
                return true;
            }
            if crate::safety::is_within(path, &pd.join("Microsoft")) {
                return true;
            }
            let startup = pd.join(r"Microsoft\Windows\Start Menu\Programs\StartUp");
            if crate::safety::is_within(path, &startup) {
                return true;
            }
        }
        for var in ["SystemRoot", "windir"] {
            if let Ok(v) = std::env::var(var) {
                if !v.trim().is_empty() && crate::safety::is_within(path, std::path::Path::new(&v)) {
                    return true;
                }
            }
        }
        const PROTECTED_PF_SUBS: &[&str] = &[
            "WindowsApps",
            "Common Files",
            "Windows Defender",
            "Windows NT",
            "Windows Mail",
            "Windows Media Player",
            "Windows Photo Viewer",
            "Windows Security",
            "Internet Explorer",
            "Reference Assemblies",
            "ModifiableWindowsApps",
        ];
        for var in ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"] {
            if let Ok(v) = std::env::var(var) {
                if v.trim().is_empty() {
                    continue;
                }
                let pf = std::path::Path::new(&v);
                if force_remove_paths_equal(path, pf) {
                    return true;
                }
                for sub in PROTECTED_PF_SUBS {
                    if crate::safety::is_within(path, &pf.join(sub)) {
                        return true;
                    }
                }
            }
        }

        // Normalized path guards for non-default drives or container roots
        for exact_root in [
            r"\program files",
            r"\program files (x86)",
            r"\programdata",
            r"\appdata",
            r"\users",
        ] {
            if norm.ends_with(exact_root) && normal_comps.len() <= 2 {
                if exact_root != r"\appdata" || normal_comps.len() <= 3 {
                    return true;
                }
            }
        }
        for seg in [
            r"\program files\windowsapps",
            r"\program files (x86)\windowsapps",
            r"\program files\common files",
            r"\program files (x86)\common files",
            r"\program files\windows defender",
            r"\program files\windows nt",
            r"\program files\windows mail",
            r"\program files\windows media player",
            r"\program files\windows photo viewer",
            r"\program files\windows security",
            r"\program files\internet explorer",
            r"\programdata\microsoft",
        ] {
            if has_path_prefix_marker(&norm, seg) {
                return true;
            }
        }
    }

    #[cfg(unix)]
    {
        for p in [
            "/System",
            "/usr",
            "/bin",
            "/sbin",
            "/etc",
            "/boot",
            "/lib",
            "/lib64",
            "/Library",
            "/Applications",
            "/private/etc",
        ] {
            if crate::safety::is_within(path, std::path::Path::new(p)) {
                return true;
            }
        }
    }

    false
}

const FORCE_REMOVE_BLOCKED_LEAF_NAMES: &[&str] = &[
    "program files",
    "program files (x86)",
    "programdata",
    "common files",
    "windowsapps",
    "reference assemblies",
    "microsoft",
    "windows",
    "sweepr",
    "internet explorer",
    "windows defender",
    "windows nt",
    "windows mail",
    "windows media player",
    "windows photo viewer",
    "windows security",
    "system32",
    "syswow64",
    "appdata",
    "local",
    "roaming",
    "locallow",
    "programs",
    "users",
];

/// Pure path-shape, depth, protection, and ownership check for Force Remove install dirs.
pub fn validate_force_remove_path_shape(
    path: &std::path::Path,
    app_name: &str,
    publisher: &str,
    uninstall_exe: Option<&std::path::Path>,
) -> Result<(), String> {
    if !path.is_absolute()
        || path
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err("Install folder path must be absolute without '..' traversal.".into());
    }
    if !crate::safety::is_safe_root(path) || is_protected_force_remove_path(path) {
        return Err("Refusing to remove a protected system or user root directory.".into());
    }

    let raw_str = path.to_string_lossy();
    let norm_str = raw_str
        .strip_prefix(r"\\?\")
        .unwrap_or(&raw_str)
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_ascii_lowercase();

    let normal_comps: Vec<String> = path
        .components()
        .filter_map(|c| match c {
            std::path::Component::Normal(s) => Some(s.to_string_lossy().to_ascii_lowercase()),
            _ => None,
        })
        .collect();

    if normal_comps.len() < 2 {
        return Err("Refusing to remove shallow top-level drive directory.".into());
    }

    let last_name = normal_comps.last().map(String::as_str).unwrap_or("");
    if FORCE_REMOVE_BLOCKED_LEAF_NAMES.contains(&last_name) {
        return Err("Refusing to remove shared system or program container directory.".into());
    }

    if (norm_str.contains(r"\program files\")
        || norm_str.contains(r"\program files (x86)\")
        || norm_str.contains(r"\programdata\"))
        && normal_comps.len() < 2
    {
        return Err("Install directory must be an app-specific subfolder.".into());
    }
    if norm_str.contains(r"\appdata\local\programs") && normal_comps.len() < 5 {
        return Err("Install directory must be an app-specific subfolder under Programs.".into());
    }

    // Ownership sanity check: either uninstall_exe is inside path, or folder/parent token matches app/publisher
    let exe_inside = uninstall_exe
        .map(|exe| crate::safety::is_within(exe, path))
        .unwrap_or(false);

    if !exe_inside {
        let leaf_tok = normalise_token(last_name);
        let leaf_valid = leaf_tok.len() >= 4 && !is_generic_app_token(&leaf_tok);
        let parent_raw = normal_comps
            .len()
            .checked_sub(2)
            .and_then(|idx| normal_comps.get(idx))
            .map(String::as_str)
            .unwrap_or("");
        let parent_tok = normalise_token(parent_raw);
        let parent_valid = parent_tok.len() >= 4
            && !is_generic_app_token(&parent_tok)
            && !FORCE_REMOVE_BLOCKED_LEAF_NAMES.contains(&parent_raw);
        let app_tokens = extract_meaningful_app_tokens(app_name, publisher);
        let matches_token = app_tokens.iter().any(|t| {
            (leaf_valid && (leaf_tok == *t || leaf_tok.contains(t) || t.contains(&leaf_tok)))
                || (parent_valid
                    && (parent_tok == *t || parent_tok.contains(t) || t.contains(&parent_tok)))
        });
        if !matches_token {
            return Err("Install directory name does not match application or uninstaller path; skipping for safety.".into());
        }
    }

    Ok(())
}

pub fn validate_force_remove_install_dir(
    candidate: &std::path::Path,
    app_name: &str,
    publisher: &str,
    uninstall_exe: Option<&std::path::Path>,
    exclusions: &[std::path::PathBuf],
) -> Result<std::path::PathBuf, String> {
    validate_force_remove_path_shape(candidate, app_name, publisher, uninstall_exe)?;

    let md = std::fs::symlink_metadata(candidate)
        .map_err(|_| "Install directory no longer exists on disk.".to_string())?;
    if !md.is_dir() || crate::safety::metadata_is_link_like(&md) {
        return Err("Refusing to remove symlink, junction, or non-directory install path.".into());
    }
    let root_anchor: std::path::PathBuf = candidate
        .components()
        .take(2)
        .collect();
    if crate::safety::has_symlink_component(&root_anchor, candidate) {
        return Err("Refusing to traverse a symlink or junction ancestor in install path.".into());
    }

    let canon = std::fs::canonicalize(candidate)
        .map_err(|e| format!("Cannot resolve install directory: {e}"))?;
    if crate::safety::is_excluded(&canon, exclusions) {
        return Err("Install directory is protected or excluded from cleanup.".into());
    }
    validate_force_remove_path_shape(&canon, app_name, publisher, uninstall_exe)?;

    Ok(canon)
}

pub fn find_app_specific_remnants_in_roots(
    roots: &[(&str, std::path::PathBuf)],
    app_name: &str,
    publisher: &str,
    other_installed_tokens: &[String],
    exclusions: &[std::path::PathBuf],
) -> Vec<AppRemnant> {
    let target_tokens = extract_meaningful_app_tokens(app_name, publisher);
    if target_tokens.is_empty() {
        return Vec::new();
    }

    let mut out = Vec::new();
    for (label, root) in roots {
        let Ok(rd) = std::fs::read_dir(root) else { continue };
        for entry in rd.flatten() {
            let path = entry.path();
            let Ok(md) = std::fs::symlink_metadata(&path) else { continue };
            if !md.is_dir() || crate::safety::metadata_is_link_like(&md) {
                continue;
            }
            if crate::safety::is_excluded(&path, exclusions) {
                continue;
            }
            let folder_name = entry.file_name().to_string_lossy().into_owned();
            if folder_name.starts_with('.') {
                continue;
            }
            let lower = folder_name.to_ascii_lowercase();
            if PROTECTED_APPDATA_FOLDERS
                .iter()
                .any(|p| p.eq_ignore_ascii_case(&lower))
            {
                continue;
            }
            let norm = normalise_token(&folder_name);
            if norm.len() < 4 || is_generic_app_token(&norm) {
                continue;
            }
            let matches_target = target_tokens
                .iter()
                .any(|t| norm == *t || norm.contains(t.as_str()) || t.contains(norm.as_str()));
            if !matches_target {
                continue;
            }
            // Do not wipe a shared vendor/sibling folder used by another still-installed app
            let matches_other = other_installed_tokens
                .iter()
                .any(|t| norm == *t || (t.len() >= 4 && (norm.contains(t.as_str()) || t.contains(norm.as_str()))));
            if matches_other {
                continue;
            }

            let (bytes, files) = dir_size_and_files(&path, 3_000);
            out.push(AppRemnant {
                name: folder_name,
                path: path.to_string_lossy().into_owned(),
                location: (*label).to_string(),
                bytes,
                files,
            });
        }
    }
    out.sort_by(|a, b| b.bytes.cmp(&a.bytes));
    out
}

#[cfg(target_os = "windows")]
struct Win32ForceRemoveTarget {
    prefix: String,
    subkey: String,
    full_registry_key: String,
    app_name: String,
    publisher: String,
    uninstall_string: String,
    validated_install_dir: Option<std::path::PathBuf>,
    install_dir_bytes: u64,
    remnant_dirs: Vec<AppRemnant>,
    requires_elevation_for_registry: bool,
    warnings: Vec<String>,
}

#[cfg(target_os = "windows")]
fn open_win32_uninstall_parent(prefix: &str, flags: u32) -> Result<winreg::RegKey, std::io::Error> {
    use winreg::enums::*;
    use winreg::RegKey;
    let (is_hklm, base) = hive_for(prefix).ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "invalid hive prefix")
    })?;
    let root = RegKey::predef(if is_hklm { HKEY_LOCAL_MACHINE } else { HKEY_CURRENT_USER });
    let wow_flag = match prefix {
        "HKLM64" => KEY_WOW64_64KEY,
        "HKLM32" => KEY_WOW64_32KEY,
        _ => 0,
    };
    root.open_subkey_with_flags(base, flags | wow_flag)
}

#[cfg(target_os = "windows")]
fn inspect_win32_force_remove_target(
    id: &str,
    exclusions: &[std::path::PathBuf],
) -> AppResult<Win32ForceRemoveTarget> {
    use winreg::enums::*;

    let (prefix, subkey) = parse_app_id(id)?;
    let (_, base) = hive_for(prefix).ok_or_else(|| AppError::Other("Invalid application id".into()))?;
    let parent = open_win32_uninstall_parent(prefix, KEY_READ)
        .map_err(|_| AppError::NotFound("Registry uninstall key no longer exists".into()))?;
    let app_key = parent
        .open_subkey_with_flags(subkey, KEY_READ)
        .map_err(|_| AppError::NotFound("Application entry is no longer installed".into()))?;

    let app_name: String = app_key
        .get_value("DisplayName")
        .unwrap_or_else(|_| subkey.to_string());
    let publisher: String = app_key.get_value("Publisher").unwrap_or_default();
    let install_location: String = app_key.get_value("InstallLocation").unwrap_or_default();
    let uninstall_string: String = app_key.get_value("UninstallString").unwrap_or_default();
    let display_icon: String = app_key.get_value("DisplayIcon").unwrap_or_default();

    let mut warnings = Vec::new();
    let uninstall_exe = if !uninstall_string.trim().is_empty() {
        let expanded = crate::cmdline::expand_env(&uninstall_string);
        let (prog, _) = crate::cmdline::split_command(&expanded);
        let p = std::path::PathBuf::from(prog.trim());
        if p.is_absolute() && !p.to_string_lossy().to_ascii_lowercase().contains(r"\windows\installer\") && !p.to_string_lossy().to_ascii_lowercase().contains(r"\windows\system32\") {
            Some(p)
        } else {
            None
        }
    } else {
        None
    };

    let mut candidate_dir: Option<std::path::PathBuf> = None;
    let loc_trimmed = install_location.trim().trim_matches('"');
    if !loc_trimmed.is_empty() {
        candidate_dir = Some(std::path::PathBuf::from(crate::cmdline::expand_env(loc_trimmed)));
    } else if let Some(ref exe_p) = uninstall_exe {
        if let Some(p) = exe_p.parent() {
            candidate_dir = Some(p.to_path_buf());
        }
    } else if !display_icon.trim().is_empty() {
        let icon_clean = crate::cmdline::expand_env(
            display_icon
                .split(',')
                .next()
                .unwrap_or("")
                .trim()
                .trim_matches('"'),
        );
        let icon_p = std::path::Path::new(&icon_clean);
        if icon_p.is_absolute() {
            if let Some(p) = icon_p.parent() {
                candidate_dir = Some(p.to_path_buf());
            }
        }
    }

    let mut validated_install_dir = None;
    let mut install_dir_bytes = 0u64;
    if let Some(cand) = candidate_dir {
        match validate_force_remove_install_dir(
            &cand,
            &app_name,
            &publisher,
            uninstall_exe.as_deref(),
            exclusions,
        ) {
            Ok(valid) => {
                install_dir_bytes = dir_size_and_files(&valid, 3_000).0;
                validated_install_dir = Some(valid);
            }
            Err(reason) => warnings.push(reason),
        }
    }

    // Build tokens of OTHER installed apps so shared vendor folders aren't wiped
    let other_apps: Vec<AppInfo> = get_installed_apps()
        .into_iter()
        .filter(|a| a.id != id && !a.name.eq_ignore_ascii_case(&app_name))
        .collect();
    let other_tokens = build_known_app_tokens(&other_apps);

    let mut appdata_roots: Vec<(&str, std::path::PathBuf)> = Vec::new();
    if let Some(roaming) = dirs::data_dir() {
        appdata_roots.push(("AppData\\Roaming", roaming));
    }
    if let Some(local) = dirs::data_local_dir() {
        appdata_roots.push(("AppData\\Local", local));
    }
    if let Some(home) = dirs::home_dir() {
        let locallow = home.join(r"AppData\LocalLow");
        if locallow.is_dir() {
            appdata_roots.push(("AppData\\LocalLow", locallow));
        }
    }

    let remnant_dirs = find_app_specific_remnants_in_roots(
        &appdata_roots,
        &app_name,
        &publisher,
        &other_tokens,
        exclusions,
    );

    let full_registry_key = match prefix {
        "HKCU" => format!("HKCU\\{base}\\{subkey}"),
        _ => format!("HKLM\\{base}\\{subkey}"),
    };

    Ok(Win32ForceRemoveTarget {
        prefix: prefix.to_string(),
        subkey: subkey.to_string(),
        full_registry_key,
        app_name,
        publisher,
        uninstall_string,
        validated_install_dir,
        install_dir_bytes,
        remnant_dirs,
        requires_elevation_for_registry: prefix != "HKCU",
        warnings,
    })
}

#[cfg(target_os = "windows")]
fn delete_uninstall_registry_key(prefix: &str, subkey: &str) -> Result<bool, String> {
    use std::os::windows::process::CommandExt;
    use winreg::enums::*;

    match open_win32_uninstall_parent(prefix, KEY_READ | KEY_WRITE) {
        Ok(parent) => match parent.delete_subkey_all(subkey) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
                // Fall through to elevated reg.exe delete
                let base = hive_for(prefix).map(|(_, b)| b).unwrap_or(UNINSTALL_64);
                let full_reg = format!("HKLM\\{base}\\{subkey}");
                let reg_view_flag = if prefix == "HKLM32" { "/reg:32" } else { "/reg:64" };
                let script = r#"
try {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $env:SWEEPR_REG_EXE
  $psi.Arguments = "delete `"$($env:SWEEPR_REG_KEY)`" /f $($env:SWEEPR_REG_VIEW)"
  $psi.Verb = 'runas'
  $psi.UseShellExecute = $true
  $psi.WindowStyle = 'Hidden'
  $p = [System.Diagnostics.Process]::Start($psi)
  if ($null -eq $p) { exit 1 }
  $p.WaitForExit()
  exit $p.ExitCode
} catch [System.ComponentModel.Win32Exception] {
  if ($_.Exception.NativeErrorCode -eq 1223) { exit 1223 }
  exit 1
}
"#;
                const CREATE_NO_WINDOW: u32 = 0x0800_0000;
                let out = std::process::Command::new(system_powershell_path())
                    .env("SWEEPR_REG_EXE", crate::safety::system32_binary("reg").as_os_str())
                    .env("SWEEPR_REG_KEY", &full_reg)
                    .env("SWEEPR_REG_VIEW", reg_view_flag)
                    .args(["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script])
                    .creation_flags(CREATE_NO_WINDOW)
                    .output()
                    .map_err(|err| format!("Could not elevate registry removal: {err}"))?;
                if out.status.code() == Some(1223) {
                    return Err("Administrator permission was cancelled for registry key removal.".into());
                }
                if !out.status.success() {
                    return Err(format!("Elevated reg delete exited with {:?}.", out.status.code()));
                }
            }
            Err(e) => return Err(format!("Could not remove uninstall registry key: {e}")),
        },
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
            let base = hive_for(prefix).map(|(_, b)| b).unwrap_or(UNINSTALL_64);
            let full_reg = format!("HKLM\\{base}\\{subkey}");
            let reg_view_flag = if prefix == "HKLM32" { "/reg:32" } else { "/reg:64" };
            let script = r#"
try {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $env:SWEEPR_REG_EXE
  $psi.Arguments = "delete `"$($env:SWEEPR_REG_KEY)`" /f $($env:SWEEPR_REG_VIEW)"
  $psi.Verb = 'runas'
  $psi.UseShellExecute = $true
  $psi.WindowStyle = 'Hidden'
  $p = [System.Diagnostics.Process]::Start($psi)
  if ($null -eq $p) { exit 1 }
  $p.WaitForExit()
  exit $p.ExitCode
} catch [System.ComponentModel.Win32Exception] {
  if ($_.Exception.NativeErrorCode -eq 1223) { exit 1223 }
  exit 1
}
"#;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            let out = std::process::Command::new(system_powershell_path())
                .env("SWEEPR_REG_EXE", crate::safety::system32_binary("reg").as_os_str())
                .env("SWEEPR_REG_KEY", &full_reg)
                .env("SWEEPR_REG_VIEW", reg_view_flag)
                .args(["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script])
                .creation_flags(CREATE_NO_WINDOW)
                .output()
                .map_err(|err| format!("Could not elevate registry removal: {err}"))?;
            if out.status.code() == Some(1223) {
                return Err("Administrator permission was cancelled for registry key removal.".into());
            }
            if !out.status.success() {
                return Err(format!("Elevated reg delete exited with {:?}.", out.status.code()));
            }
        }
        Err(e) => return Err(format!("Could not open uninstall registry hive: {e}")),
    }

    // Re-check key absence before claiming registry_removed = true
    let still_exists = open_win32_uninstall_parent(prefix, KEY_READ)
        .and_then(|p| p.open_subkey_with_flags(subkey, KEY_READ))
        .is_ok();
    Ok(!still_exists)
}

#[tauri::command]
pub async fn preview_force_remove_app(
    state: State<'_, AppState>,
    id: String,
) -> AppResult<ForceRemovePreview> {
    parse_app_id(&id)?;
    let exclusions = crate::safety::load_exclusions(&state.data_dir);

    #[cfg(target_os = "windows")]
    {
        tauri::async_runtime::spawn_blocking(move || {
            let t = inspect_win32_force_remove_target(&id, &exclusions)?;
            let remnant_bytes: u64 = t.remnant_dirs.iter().map(|r| r.bytes).sum();
            Ok(ForceRemovePreview {
                id,
                app_name: t.app_name,
                registry_key: t.full_registry_key,
                install_dir: t.validated_install_dir.map(|p| p.to_string_lossy().into_owned()),
                install_dir_bytes: t.install_dir_bytes,
                remnant_dirs: t.remnant_dirs,
                total_bytes: t.install_dir_bytes.saturating_add(remnant_bytes),
                requires_elevation_for_registry: t.requires_elevation_for_registry,
                warnings: t.warnings,
            })
        })
        .await
        .map_err(|e| AppError::Other(format!("background task failed: {e}")))?
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = exclusions;
        Err(AppError::Other(
            "Force Remove Leftovers is only supported for Windows Win32 registry apps.".into(),
        ))
    }
}

#[tauri::command]
pub async fn force_remove_app(
    state: State<'_, AppState>,
    id: String,
) -> AppResult<ForceRemoveReport> {
    parse_app_id(&id)?;
    state.licensing.require_active().await?;
    let data_dir = state.data_dir.clone();
    let exclusions = crate::safety::load_exclusions(&data_dir);

    #[cfg(target_os = "windows")]
    {
        tauri::async_runtime::spawn_blocking(move || {
            let t = inspect_win32_force_remove_target(&id, &exclusions)?;
            let mut report = ForceRemoveReport {
                id: id.clone(),
                app_name: t.app_name.clone(),
                registry_removed: false,
                paths_trashed: Vec::new(),
                bytes_freed: 0,
                warnings: t.warnings,
            };

            if let Some(install_dir) = t.validated_install_dir {
                match trash::delete(&install_dir) {
                    Ok(()) => {
                        report.paths_trashed.push(install_dir.to_string_lossy().into_owned());
                        report.bytes_freed = report.bytes_freed.saturating_add(t.install_dir_bytes);
                    }
                    Err(e) => report.warnings.push(format!(
                        "Could not move install folder {} to Recycle Bin: {e}",
                        install_dir.display()
                    )),
                }
            }

            for rem in t.remnant_dirs {
                let rem_path = std::path::PathBuf::from(&rem.path);
                if let Ok(md) = std::fs::symlink_metadata(&rem_path) {
                    if md.is_dir() && !crate::safety::metadata_is_link_like(&md) {
                        match trash::delete(&rem_path) {
                            Ok(()) => {
                                report.paths_trashed.push(rem.path);
                                report.bytes_freed = report.bytes_freed.saturating_add(rem.bytes);
                            }
                            Err(e) => report.warnings.push(format!(
                                "Could not move AppData folder {} to Recycle Bin: {e}",
                                rem.path
                            )),
                        }
                    }
                }
            }

            let backup_payload = serde_json::json!({
                "display_name": t.app_name,
                "publisher": t.publisher,
                "uninstall_string": t.uninstall_string,
            })
            .to_string();

            match delete_uninstall_registry_key(&t.prefix, &t.subkey) {
                Ok(removed) => {
                    report.registry_removed = removed;
                    if removed {
                        if let Err(e) = crate::registry_cleaner::record_backup(
                            &data_dir,
                            &t.full_registry_key,
                            &t.subkey,
                            "Force Uninstall Entry",
                            &backup_payload,
                        ) {
                            report.warnings.push(format!(
                                "Could not save uninstall audit snapshot: {e}"
                            ));
                        }
                    } else {
                        report.warnings.push(
                            "Registry uninstall entry still exists after removal attempt.".into(),
                        );
                    }
                }
                Err(msg) => {
                    report.warnings.push(msg);
                }
            }

            Ok(report)
        })
        .await
        .map_err(|e| AppError::Other(format!("background task failed: {e}")))?
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (data_dir, exclusions);
        Err(AppError::Other(
            "Force Remove Leftovers is only supported for Windows Win32 registry apps.".into(),
        ))
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
fn uninstall_linux_blocking(kind: LinuxAppKind, key: &str) -> AppResult<()> {
    match kind {
        LinuxAppKind::Flatpak => {
            let out = std::process::Command::new("flatpak")
                .args(["uninstall", "-y", "--noninteractive", key])
                .output()
                .map_err(|e| AppError::Other(format!("Could not run flatpak: {e}")))?;
            if out.status.success() {
                Ok(())
            } else {
                let err = String::from_utf8_lossy(&out.stderr);
                Err(AppError::Other(format!("Flatpak uninstall failed: {}", err.trim())))
            }
        }
        LinuxAppKind::Snap => {
            let out = std::process::Command::new("snap")
                .args(["remove", key])
                .output()
                .map_err(|e| AppError::Other(format!("Could not run snap: {e}")))?;
            if out.status.success() {
                return Ok(());
            }
            let err_text = String::from_utf8_lossy(&out.stderr).to_ascii_lowercase();
            if err_text.contains("access denied")
                || err_text.contains("permission")
                || err_text.contains("authentication")
            {
                let pk = std::process::Command::new("pkexec")
                    .args(["snap", "remove", key])
                    .output()
                    .map_err(|e| AppError::Other(format!("Could not launch pkexec for snap: {e}")))?;
                if pk.status.success() {
                    return Ok(());
                }
                let pk_err = String::from_utf8_lossy(&pk.stderr);
                return Err(AppError::Other(format!(
                    "Snap uninstall failed or was cancelled: {}",
                    pk_err.trim()
                )));
            }
            Err(AppError::Other(format!(
                "Snap uninstall failed: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            )))
        }
        LinuxAppKind::DeskUsr => {
            let home = dirs::home_dir()
                .ok_or_else(|| AppError::Other("Home directory not found".into()))?;
            let desktop_path = home.join(".local/share/applications").join(key);
            let md = std::fs::symlink_metadata(&desktop_path)
                .map_err(|_| AppError::NotFound("Application launcher is no longer installed".into()))?;
            if crate::safety::metadata_is_link_like(&md) || !md.is_file() {
                return Err(AppError::Other(
                    "Refusing to remove symlink or non-regular desktop file".into(),
                ));
            }
            if let Ok(raw) = std::fs::read_to_string(&desktop_path) {
                if let Some(parsed) = parse_desktop_entry(&raw) {
                    if let Some(bin) = extract_exec_binary(&parsed.exec) {
                        if is_appimage_path(&bin) {
                            let appimage = std::path::PathBuf::from(&bin);
                            if appimage.is_absolute() && crate::safety::is_within(&appimage, &home) {
                                if let Ok(amd) = std::fs::symlink_metadata(&appimage) {
                                    if amd.is_file() && !crate::safety::metadata_is_link_like(&amd) {
                                        let _ = trash::delete(&appimage);
                                    }
                                }
                            }
                        }
                    }
                }
            }
            trash::delete(&desktop_path)
                .map_err(|e| AppError::Other(format!("Could not move launcher to Trash: {e}")))
        }
        LinuxAppKind::DeskSys | LinuxAppKind::DeskLoc => {
            let base = match kind {
                LinuxAppKind::DeskSys => std::path::Path::new("/usr/share/applications"),
                LinuxAppKind::DeskLoc => std::path::Path::new("/usr/local/share/applications"),
                _ => unreachable!(),
            };
            let desktop_path = base.join(key);
            if !desktop_path.exists() {
                return Err(AppError::NotFound("Application launcher is no longer installed".into()));
            }
            let path_str = desktop_path.to_string_lossy().into_owned();
            let candidates: [(&str, &[&str], &str, &[&str]); 3] = [
                ("dpkg", &["-S"], "apt-get", &["remove", "-y"]),
                ("rpm", &["-qf", "--queryformat", "%{NAME}\n"], "dnf", &["remove", "-y"]),
                ("pacman", &["-Qo"], "pacman", &["-Rns", "--noconfirm"]),
            ];
            for (query_bin, query_args, rm_bin, rm_args) in candidates {
                if let Ok(q_out) = std::process::Command::new(query_bin)
                    .args(query_args)
                    .arg(&path_str)
                    .output()
                {
                    if q_out.status.success() {
                        let stdout = String::from_utf8_lossy(&q_out.stdout);
                        if let Some(pkg) = parse_package_owner_output(query_bin, &stdout) {
                            let valid_pkg = validate_linux_package_name(&pkg)?;
                            let pk = std::process::Command::new("pkexec")
                                .arg(rm_bin)
                                .args(rm_args)
                                .arg(valid_pkg)
                                .output()
                                .map_err(|e| {
                                    AppError::Other(format!(
                                        "Could not launch pkexec to remove '{valid_pkg}': {e}"
                                    ))
                                })?;
                            if pk.status.success() {
                                return Ok(());
                            }
                            let pk_err = String::from_utf8_lossy(&pk.stderr);
                            return Err(AppError::Other(format!(
                                "Package removal failed or was cancelled: {}",
                                pk_err.trim()
                            )));
                        }
                    }
                }
            }
            Err(AppError::Other(
                "Could not determine owning system package (dpkg/rpm/pacman) for this desktop entry."
                    .into(),
            ))
        }
    }
}

#[derive(Serialize, Clone, Debug)]
pub struct AppRemnant {
    pub name: String,
    pub path: String,
    pub location: String,
    pub bytes: u64,
    pub files: u64,
}

const PROTECTED_APPDATA_FOLDERS: &[&str] = &[
    "microsoft",
    "windows",
    "packages",
    "temp",
    "connecteddevicesplatform",
    "d3dscache",
    "crashdumps",
    "google",
    "mozilla",
    "bravesoftware",
    "apple",
    "apple computer",
    "sweepr",
    "npm",
    "npm-cache",
    "pnpm",
    "pip",
    "yarn",
    "nuget",
    "composer",
    "programs",
    "virtualstore",
    "comms",
    "publishers",
    " peerdistrepub",
    "placeholderTileLogoFolder",
    "nvidia",
    "nvidia corporation",
    "amd",
    "intel",
    "realtek",
    "valve",
    "steam",
    "discord",
    "slack",
    "spotify",
    "code",
    "github desktop",
    "docker",
    "jetbrains",
    "obs-studio",
    "1password",
    "bitwarden",
];

#[cfg_attr(not(all(unix, not(target_os = "macos"))), allow(dead_code))]
const PROTECTED_LINUX_FOLDERS: &[&str] = &[
    "applications",
    "icons",
    "themes",
    "trash",
    "flatpak",
    "keyrings",
    "systemd",
    "dbus-1",
    "pulse",
    "pipewire",
    "dconf",
    "gtk-3.0",
    "gtk-4.0",
    "fontconfig",
    "mime",
    "glib-2.0",
    "gvfs-metadata",
    "gnupg",
    "ssh",
    "pki",
    "vulkan",
    "wayland",
    "kded5",
    "kde.org",
    "plasma",
    "autostart",
    "xorg",
    "x11",
    "xdg-desktop-portal",
    "gvfs",
    "desktop-directories",
    "sounds",
    "pixmaps",
    "bash-completion",
    "zsh",
    "fish",
    "nvim",
    "vim",
    "git",
    "go",
    "cargo",
    "rustup",
    "local",
    "cache",
    "state",
    "config",
    "com.sweepr.cleaner",
    "com.sweepr.app",
];

fn normalise_token(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect::<String>()
        .to_ascii_lowercase()
}

fn dir_size_and_files(dir: &std::path::Path, max_entries: usize) -> (u64, u64) {
    let mut bytes = 0u64;
    let mut files = 0u64;
    for (idx, entry) in walkdir::WalkDir::new(dir)
        .follow_links(false)
        .max_depth(4)
        .into_iter()
        .filter_entry(|e| !crate::safety::is_link_like(e))
        .flatten()
        .enumerate()
    {
        if idx > max_entries {
            break;
        }
        if entry.file_type().is_file() {
            if let Ok(md) = entry.metadata() {
                bytes += md.len();
                files += 1;
            }
        }
    }
    (bytes, files)
}

#[cfg_attr(not(all(unix, not(target_os = "macos"))), allow(dead_code))]
pub fn linux_remnant_roots_from(
    home: Option<&std::path::Path>,
    config: Option<&std::path::Path>,
    data: Option<&std::path::Path>,
) -> Vec<(&'static str, std::path::PathBuf)> {
    let mut roots: Vec<(&'static str, std::path::PathBuf)> = Vec::new();
    let mut push_unique = |label: &'static str, candidate: std::path::PathBuf| {
        if !roots.iter().any(|(_, existing)| existing == &candidate) {
            roots.push((label, candidate));
        }
    };
    if let Some(cfg) = config {
        push_unique("~/.config", cfg.to_path_buf());
    } else if let Some(h) = home {
        push_unique("~/.config", h.join(".config"));
    }
    if let Some(d) = data {
        push_unique("~/.local/share", d.to_path_buf());
    } else if let Some(h) = home {
        push_unique("~/.local/share", h.join(".local/share"));
    }
    if let Some(h) = home {
        push_unique("~/.var/app", h.join(".var/app"));
    }
    roots
}

fn build_known_app_tokens(installed: &[AppInfo]) -> Vec<String> {
    let mut known_tokens: Vec<String> = Vec::new();
    for app in installed {
        let n = normalise_token(&app.name);
        if n.len() >= 3 {
            known_tokens.push(n);
        }
        let p = normalise_token(&app.publisher);
        if p.len() >= 3 {
            known_tokens.push(p);
        }
        for word in app.name.split_whitespace().chain(app.publisher.split_whitespace()) {
            let w = normalise_token(word);
            if w.len() >= 4
                && !matches!(
                    w.as_str(),
                    "corp"
                        | "corporation"
                        | "inc"
                        | "ltd"
                        | "gmbh"
                        | "software"
                        | "technologies"
                        | "studio"
                        | "client"
                        | "desktop"
                        | "windows"
                )
            {
                known_tokens.push(w);
            }
        }
    }
    known_tokens
}

pub fn find_remnants_in_roots_with_cutoff(
    roots: &[(&str, std::path::PathBuf)],
    known_tokens: &[String],
    exclusions: &[std::path::PathBuf],
    protected: &[&str],
    cutoff: std::time::SystemTime,
) -> Vec<AppRemnant> {
    let mut remnants = Vec::new();
    for (label, root) in roots {
        let Ok(rd) = std::fs::read_dir(root) else { continue };
        for entry in rd.flatten() {
            let path = entry.path();
            let Ok(md) = std::fs::symlink_metadata(&path) else { continue };
            if !md.is_dir() || crate::safety::metadata_is_link_like(&md) {
                continue;
            }
            if crate::safety::is_excluded(&path, exclusions) {
                continue;
            }
            if let Ok(modified) = md.modified() {
                if modified > cutoff {
                    continue;
                }
            }
            let folder_name = entry.file_name().to_string_lossy().into_owned();
            if folder_name.starts_with('.') {
                continue;
            }
            let lower = folder_name.to_ascii_lowercase();
            if protected.iter().any(|p| p.eq_ignore_ascii_case(&lower)) {
                continue;
            }
            let norm = normalise_token(&folder_name);
            if norm.len() < 3 {
                continue;
            }
            let matches_installed = known_tokens.iter().any(|t| {
                norm == *t || norm.contains(t.as_str()) || t.contains(norm.as_str())
            });
            if matches_installed {
                continue;
            }
            let (bytes, files) = dir_size_and_files(&path, 3_000);
            if bytes < 64 * 1024 || files == 0 {
                continue;
            }
            remnants.push(AppRemnant {
                name: folder_name,
                path: path.to_string_lossy().into_owned(),
                location: (*label).to_string(),
                bytes,
                files,
            });
        }
    }

    remnants.sort_by(|a, b| b.bytes.cmp(&a.bytes));
    remnants
}

pub fn is_valid_remnant_in_roots(
    target: &std::path::Path,
    allowed_roots: &[std::path::PathBuf],
    protected: &[&str],
) -> bool {
    if !target.is_absolute() {
        return false;
    }
    let Some(parent) = target.parent() else { return false };
    let is_direct_child = allowed_roots.iter().any(|root| {
        #[cfg(windows)]
        {
            parent
                .to_string_lossy()
                .trim_end_matches('\\')
                .eq_ignore_ascii_case(root.to_string_lossy().trim_end_matches('\\'))
        }
        #[cfg(not(windows))]
        {
            parent == root
        }
    });
    if !is_direct_child {
        return false;
    }
    let Some(name) = target.file_name().and_then(|n| n.to_str()) else { return false };
    !protected.iter().any(|p| p.eq_ignore_ascii_case(name))
}

fn find_remnants_blocking(exclusions: &[std::path::PathBuf]) -> Vec<AppRemnant> {
    let installed = get_installed_apps();
    let known_tokens = build_known_app_tokens(&installed);
    let cutoff = std::time::SystemTime::now()
        .checked_sub(std::time::Duration::from_secs(7 * 24 * 3600))
        .unwrap_or(std::time::SystemTime::UNIX_EPOCH);

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let roots = linux_remnant_roots_from(
            dirs::home_dir().as_deref(),
            dirs::config_dir().as_deref(),
            dirs::data_dir().as_deref(),
        );
        let mut protected: Vec<&str> = PROTECTED_APPDATA_FOLDERS.to_vec();
        protected.extend_from_slice(PROTECTED_LINUX_FOLDERS);
        return find_remnants_in_roots_with_cutoff(
            &roots,
            &known_tokens,
            exclusions,
            &protected,
            cutoff,
        );
    }

    #[cfg(not(all(unix, not(target_os = "macos"))))]
    {
        let mut roots: Vec<(&str, std::path::PathBuf)> = Vec::new();
        if let Some(roaming) = dirs::data_dir() {
            roots.push(("AppData\\Roaming", roaming));
        }
        if let Some(local) = dirs::data_local_dir() {
            roots.push(("AppData\\Local", local));
        }
        find_remnants_in_roots_with_cutoff(
            &roots,
            &known_tokens,
            exclusions,
            PROTECTED_APPDATA_FOLDERS,
            cutoff,
        )
    }
}

fn is_valid_remnant_dir(target: &std::path::Path) -> bool {
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let roots: Vec<std::path::PathBuf> = linux_remnant_roots_from(
            dirs::home_dir().as_deref(),
            dirs::config_dir().as_deref(),
            dirs::data_dir().as_deref(),
        )
        .into_iter()
        .map(|(_, p)| p)
        .collect();
        let mut protected: Vec<&str> = PROTECTED_APPDATA_FOLDERS.to_vec();
        protected.extend_from_slice(PROTECTED_LINUX_FOLDERS);
        return is_valid_remnant_in_roots(target, &roots, &protected);
    }

    #[cfg(not(all(unix, not(target_os = "macos"))))]
    {
        let allowed_parents: Vec<std::path::PathBuf> = [dirs::data_dir(), dirs::data_local_dir()]
            .into_iter()
            .flatten()
            .collect();
        is_valid_remnant_in_roots(target, &allowed_parents, PROTECTED_APPDATA_FOLDERS)
    }
}

#[tauri::command]
pub async fn scan_app_remnants(state: State<'_, AppState>) -> AppResult<Vec<AppRemnant>> {
    let exclusions = crate::safety::load_exclusions(&state.data_dir);
    tauri::async_runtime::spawn_blocking(move || find_remnants_blocking(&exclusions))
        .await
        .map_err(|e| AppError::Other(format!("background task failed: {e}")))
}

/// Pro feature: moves an orphaned AppData directory to the system Recycle Bin / Trash.
#[tauri::command]
pub async fn clean_app_remnant(state: State<'_, AppState>, path: String) -> AppResult<()> {
    state.licensing.require_active().await?;
    let target = std::path::PathBuf::from(path.trim());
    if !is_valid_remnant_dir(&target) {
        return Err(AppError::Other("Refusing to remove folder outside AppData top-level directories".into()));
    }
    let md = std::fs::symlink_metadata(&target)
        .map_err(|_| AppError::NotFound("Folder no longer exists".into()))?;
    if !md.is_dir() || crate::safety::metadata_is_link_like(&md) {
        return Err(AppError::Other("Refusing to remove symlink or non-directory".into()));
    }
    tauri::async_runtime::spawn_blocking(move || {
        trash::delete(&target).map_err(|e| AppError::Other(format!("Could not move folder to Recycle Bin: {e}")))
    })
    .await
    .map_err(|e| AppError::Other(format!("background task failed: {e}")))?
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct OutdatedApp {
    pub name: String,
    pub id: String,
    pub current_version: String,
    pub available_version: String,
    pub source: String,
}

pub fn validate_winget_id(id: &str) -> AppResult<&str> {
    let trimmed = id.trim();
    if trimmed.is_empty()
        || trimmed.len() > 160
        || !trimmed
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | '+'))
    {
        return Err(AppError::Other("Invalid package identifier".into()));
    }
    Ok(trimmed)
}

pub fn parse_winget_upgrade_output(raw: &str) -> Vec<OutdatedApp> {
    let mut out = Vec::new();
    let mut past_divider = false;

    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if !past_divider {
            if trimmed.chars().all(|c| c == '-') && trimmed.len() >= 20 {
                past_divider = true;
            }
            continue;
        }
        if trimmed.ends_with("upgrades available.") || trimmed.starts_with("The following packages") {
            break;
        }
        let tokens: Vec<&str> = trimmed.split_whitespace().collect();
        if tokens.len() < 4 {
            continue;
        }
        let has_source = tokens.last().map(|s| *s == "winget" || *s == "msstore").unwrap_or(false);
        let (source, ver_idx, cur_idx, id_idx) = if has_source && tokens.len() >= 5 {
            (tokens[tokens.len() - 1], tokens.len() - 2, tokens.len() - 3, tokens.len() - 4)
        } else {
            ("winget", tokens.len() - 1, tokens.len() - 2, tokens.len() - 3)
        };
        if id_idx == 0 {
            continue;
        }
        let id = tokens[id_idx];
        if validate_winget_id(id).is_err() || !id.contains('.') {
            continue;
        }
        let name = tokens[..id_idx].join(" ");
        out.push(OutdatedApp {
            name,
            id: id.to_string(),
            current_version: tokens[cur_idx].to_string(),
            available_version: tokens[ver_idx].to_string(),
            source: source.to_string(),
        });
    }
    out
}

#[cfg(target_os = "windows")]
fn winget_binary() -> std::path::PathBuf {
    if let Some(local) = dirs::data_local_dir() {
        let candidate = local.join(r"Microsoft\WindowsApps\winget.exe");
        if candidate.exists() {
            return candidate;
        }
    }
    crate::safety::system32_binary("winget")
}

#[cfg(target_os = "windows")]
fn check_outdated_blocking() -> Vec<OutdatedApp> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let Ok(output) = std::process::Command::new(winget_binary())
        .args(["upgrade", "--accept-source-agreements"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
    else {
        return Vec::new();
    };
    let stdout = String::from_utf8_lossy(&output.stdout);
    parse_winget_upgrade_output(&stdout)
}

#[cfg(not(target_os = "windows"))]
fn check_outdated_blocking() -> Vec<OutdatedApp> {
    Vec::new()
}

#[tauri::command]
pub async fn check_outdated_software() -> AppResult<Vec<OutdatedApp>> {
    tauri::async_runtime::spawn_blocking(check_outdated_blocking)
        .await
        .map_err(|e| AppError::Other(format!("background task failed: {e}")))
}

#[tauri::command]
pub async fn upgrade_software(state: State<'_, AppState>, id: String) -> AppResult<String> {
    let valid_id = validate_winget_id(&id)?.to_string();
    state.licensing.require_active().await?;

    #[cfg(target_os = "windows")]
    {
        tauri::async_runtime::spawn_blocking(move || {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            let output = std::process::Command::new(winget_binary())
                .args([
                    "upgrade",
                    "--id",
                    &valid_id,
                    "--exact",
                    "--silent",
                    "--accept-package-agreements",
                    "--accept-source-agreements",
                ])
                .creation_flags(CREATE_NO_WINDOW)
                .output()
                .map_err(|e| AppError::Other(format!("Could not run winget: {e}")))?;
            if output.status.success() {
                Ok(format!("Successfully updated {valid_id}."))
            } else {
                let stderr = String::from_utf8_lossy(&output.stdout);
                Err(AppError::Other(format!(
                    "Update exited with status {}: {}",
                    output.status,
                    stderr.lines().last().unwrap_or("check installer window")
                )))
            }
        })
        .await
        .map_err(|e| AppError::Other(format!("background task failed: {e}")))?
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = valid_id;
        Err(AppError::Other("Software updater requires Windows winget".into()))
    }
}

pub fn clean_query_from_path_or_name(input: &str) -> String {
    let trimmed = input.trim().trim_matches('"');
    if trimmed.is_empty() {
        return String::new();
    }
    let normalized = trimmed.replace('/', "\\");
    let file_part = normalized.rsplit('\\').next().unwrap_or(trimmed).trim();

    let mut stem = file_part.to_string();
    for ext in [".lnk", ".exe", ".msi", ".url", ".appref-ms", ".bat", ".cmd"] {
        if stem.len() > ext.len() && stem[stem.len() - ext.len()..].eq_ignore_ascii_case(ext) {
            stem.truncate(stem.len() - ext.len());
            break;
        }
    }

    let noise_words = [
        "setup",
        "installer",
        "install",
        "uninstall",
        "unins000",
        "x64",
        "x86",
        "win64",
        "win32",
        "amd64",
        "arm64",
        "shortcut",
        "launcher",
    ];

    let spaced = stem.replace(['_', '-', '.', '(', ')', '[', ']'], " ");
    let filtered: Vec<&str> = spaced
        .split_whitespace()
        .filter(|w| {
            let lower = w.to_ascii_lowercase();
            if noise_words.contains(&lower.as_str()) {
                return false;
            }
            // Strip pure version tokens like "1", "24", "v2"
            let without_v = lower.strip_prefix('v').unwrap_or(&lower);
            if !without_v.is_empty() && without_v.chars().all(|c| c.is_ascii_digit()) {
                return false;
            }
            true
        })
        .collect();

    if filtered.is_empty() {
        stem.trim().to_string()
    } else {
        filtered.join(" ")
    }
}

#[tauri::command]
pub async fn resolve_shortcut_or_exe(path: String) -> AppResult<String> {
    Ok(clean_query_from_path_or_name(&path))
}

#[derive(Serialize, Clone, Debug)]
pub struct BrokenItem {
    pub path: String,
    pub name: String,
    pub kind: String, // "broken_shortcut" | "empty_folder"
    pub detail: String,
}

fn find_exe_paths_in_str(s: &str, out: &mut Vec<String>) {
    let bytes = s.as_bytes();
    let mut i = 0usize;
    while i + 6 < bytes.len() {
        let Some(rest) = s.get(i..) else {
            i += 1;
            continue;
        };
        let mut chars = rest.chars();
        let Some(first) = chars.next() else {
            break;
        };
        let prev_char = s.get(..i).and_then(|prefix| prefix.chars().next_back());
        let is_drive = first.is_ascii_alphabetic()
            && rest.as_bytes().get(1) == Some(&b':')
            && rest.as_bytes().get(2) == Some(&b'\\')
            && !prev_char.map(|ch| ch.is_alphanumeric()).unwrap_or(false);
        if is_drive {
            let mut end = i + 3;
            if let Some(after_drive) = s.get(end..) {
                for ch in after_drive.chars() {
                    if ch < ' '
                        || ch == '\u{7f}'
                        || ch.is_control()
                        || matches!(ch, '"' | '<' | '>' | '|' | '?' | '*')
                    {
                        break;
                    }
                    end += ch.len_utf8();
                }
            }
            if let Some(candidate) = s.get(i..end) {
                let lower_cand = candidate.to_ascii_lowercase();
                if let Some(pos) = lower_cand.find(".exe") {
                    if let Some(raw_exe) = candidate.get(..pos + 4) {
                        let exe_path = raw_exe.trim().to_string();
                        let lower = exe_path.to_lowercase();
                        if exe_path.len() > 7
                            && !exe_path.contains('%')
                            && !lower.contains("\\windows\\installer\\")
                            && !lower.contains("\\windows\\system32\\")
                            && !out.iter().any(|p| p.to_lowercase() == lower)
                        {
                            out.push(exe_path);
                        }
                    }
                }
            }
            i = end;
        } else {
            i += first.len_utf8();
        }
    }
}

fn extract_lnk_exe_targets(bytes: &[u8]) -> Vec<String> {
    let mut out = Vec::new();
    // 1. Scan ASCII/ANSI segments
    let ascii: String = bytes
        .iter()
        .map(|&b| if (0x20..0x7F).contains(&b) { b as char } else { '\0' })
        .collect();
    find_exe_paths_in_str(&ascii, &mut out);

    // 2. Scan UTF-16LE wide-string segments (aligned and 1-byte offset), supporting Unicode paths (e.g. C:\Users\Jürgen\...)
    for offset in [0usize, 1usize] {
        if bytes.len() > offset + 2 {
            let u16s: Vec<u16> = bytes[offset..]
                .chunks_exact(2)
                .map(|c| u16::from_le_bytes([c[0], c[1]]))
                .collect();
            let utf16_str: String = std::char::decode_utf16(u16s.into_iter())
                .map(|r| match r {
                    Ok(ch) if ch >= ' ' && ch != '\u{7f}' && !ch.is_control() => ch,
                    _ => '\0',
                })
                .collect();
            find_exe_paths_in_str(&utf16_str, &mut out);
        }
    }
    out
}

pub fn scan_broken_items_in_roots(
    folder_roots: &[std::path::PathBuf],
    shortcut_roots: &[std::path::PathBuf],
) -> Vec<BrokenItem> {
    let mut items = Vec::new();
    let mut seen_paths = std::collections::HashSet::new();

    for root in folder_roots {
        if !root.is_dir() {
            continue;
        }
        for entry in walkdir::WalkDir::new(root)
            .follow_links(false)
            .min_depth(1)
            .max_depth(3)
            .into_iter()
            .filter_entry(|e| !crate::safety::is_link_like(e))
            .flatten()
        {
            let p = entry.path();
            if entry.file_type().is_dir() {
                let name = entry.file_name().to_string_lossy().into_owned();
                if name.starts_with('.') {
                    continue;
                }
                let is_empty = std::fs::read_dir(p)
                    .map(|mut rd| rd.next().is_none())
                    .unwrap_or(false);
                if is_empty {
                    let key = p.to_string_lossy().to_ascii_lowercase();
                    if seen_paths.insert(key) {
                        items.push(BrokenItem {
                            path: p.to_string_lossy().into_owned(),
                            name,
                            kind: "empty_folder".into(),
                            detail: "Empty directory (0 files)".into(),
                        });
                    }
                }
            }
        }
    }

    for root in shortcut_roots {
        if !root.is_dir() {
            continue;
        }
        for entry in walkdir::WalkDir::new(root)
            .follow_links(false)
            .min_depth(1)
            .max_depth(3)
            .into_iter()
            .filter_entry(|e| !crate::safety::is_link_like(e))
            .flatten()
        {
            if !entry.file_type().is_file() {
                continue;
            }
            let p = entry.path();
            let is_lnk = p
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.eq_ignore_ascii_case("lnk"))
                .unwrap_or(false);
            if !is_lnk {
                continue;
            }
            let Ok(md) = entry.metadata() else { continue };
            let name = entry.file_name().to_string_lossy().into_owned();
            if md.len() == 0 {
                let key = p.to_string_lossy().to_ascii_lowercase();
                if seen_paths.insert(key) {
                    items.push(BrokenItem {
                        path: p.to_string_lossy().into_owned(),
                        name,
                        kind: "broken_shortcut".into(),
                        detail: "Corrupted 0-byte shortcut".into(),
                    });
                }
                continue;
            }
            if md.len() > 256 * 1024 {
                continue;
            }
            let Ok(bytes) = std::fs::read(p) else { continue };
            let targets = extract_lnk_exe_targets(&bytes);
            if !targets.is_empty() && targets.iter().all(|t| !std::path::Path::new(t).exists()) {
                let key = p.to_string_lossy().to_ascii_lowercase();
                if seen_paths.insert(key) {
                    items.push(BrokenItem {
                        path: p.to_string_lossy().into_owned(),
                        name,
                        kind: "broken_shortcut".into(),
                        detail: format!("Missing target: {}", targets[0]),
                    });
                }
            }
        }
    }

    items
}

#[tauri::command]
pub async fn scan_broken_items() -> AppResult<Vec<BrokenItem>> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut folder_roots = Vec::new();
        for d in [dirs::desktop_dir(), dirs::download_dir(), dirs::document_dir()]
            .into_iter()
            .flatten()
        {
            if d.is_dir() && !folder_roots.contains(&d) {
                folder_roots.push(d);
            }
        }
        let mut shortcut_roots = folder_roots.clone();
        if let Some(roaming) = dirs::data_dir() {
            let start_menu = roaming.join("Microsoft\\Windows\\Start Menu\\Programs");
            if start_menu.is_dir() {
                shortcut_roots.push(start_menu);
            }
        }
        scan_broken_items_in_roots(&folder_roots, &shortcut_roots)
    })
    .await
    .map_err(|e| AppError::Other(format!("background task failed: {e}")))
}

fn is_broken_lnk(p: &std::path::Path) -> bool {
    let Ok(md) = std::fs::symlink_metadata(p) else {
        return false;
    };
    if !md.is_file() || crate::safety::metadata_is_link_like(&md) {
        return false;
    }
    if md.len() == 0 {
        return true;
    }
    if md.len() > 256 * 1024 {
        return false;
    }
    let Ok(bytes) = std::fs::read(p) else {
        return false;
    };
    let targets = extract_lnk_exe_targets(&bytes);
    !targets.is_empty() && targets.iter().all(|t| !std::path::Path::new(t).exists())
}

pub fn clean_broken_items_in_roots(
    paths: &[String],
    allowed_roots: &[std::path::PathBuf],
) -> AppResult<u32> {
    let mut removed = 0u32;
    for raw in paths {
        let p = std::path::PathBuf::from(raw.trim());
        if !p.is_absolute() {
            continue;
        }
        let Ok(md) = std::fs::symlink_metadata(&p) else {
            continue;
        };
        if crate::safety::metadata_is_link_like(&md) {
            continue;
        }
        let Ok(canon) = std::fs::canonicalize(&p) else {
            continue;
        };
        if !allowed_roots.iter().any(|r| crate::safety::is_within(&canon, r)) {
            continue;
        }
        if md.is_dir() {
            if std::fs::remove_dir(&canon).is_ok() {
                removed += 1;
            }
        } else if md.is_file() {
            let is_lnk = canon
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.eq_ignore_ascii_case("lnk"))
                .unwrap_or(false);
            if is_lnk && is_broken_lnk(&canon) && std::fs::remove_file(&canon).is_ok() {
                removed += 1;
            }
        }
    }
    Ok(removed)
}

#[tauri::command]
pub async fn clean_broken_items(
    state: State<'_, AppState>,
    paths: Vec<String>,
) -> AppResult<u32> {
    state.licensing.require_active().await?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut allowed_roots = Vec::new();
        for d in [
            dirs::desktop_dir(),
            dirs::download_dir(),
            dirs::document_dir(),
        ]
        .into_iter()
        .flatten()
        {
            if d.is_dir() && !allowed_roots.contains(&d) {
                allowed_roots.push(d);
            }
        }
        if let Some(roaming) = dirs::data_dir() {
            let start_menu = roaming.join("Microsoft\\Windows\\Start Menu\\Programs");
            if start_menu.is_dir() {
                allowed_roots.push(start_menu);
            }
        }
        clean_broken_items_in_roots(&paths, &allowed_roots)
    })
    .await
    .map_err(|e| AppError::Other(format!("background task failed: {e}")))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_id_validation() {
        assert!(parse_app_id("HKLM64:{ABC-123}").is_ok());
        assert!(parse_app_id("HKCU:Some App").is_ok());
        assert!(parse_app_id("HKLM32:..\\..\\Run").is_err());
        assert!(parse_app_id("HKLM64:").is_err());
        assert!(parse_app_id("HKEY_CLASSES_ROOT:x").is_err());
        assert!(parse_app_id("no-prefix").is_err());
        assert!(parse_app_id("\"C:\\evil.exe\" & calc").is_err());
        #[cfg(target_os = "windows")]
        {
            assert!(resolve_program("MsiExec.exe /X{1234}").is_ok());
            assert!(resolve_program("powershell.exe -Command calc").is_err());
            assert!(resolve_program("cmd.exe /c calc").is_err());
            assert!(resolve_program(r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -c calc").is_err());
            assert!(resolve_program(r"C:\Windows\System32\rundll32.exe evil.dll,Entry").is_err());
        }
    }

    #[test]
    fn remnant_dir_validation() {
        if let Some(roaming) = dirs::data_dir() {
            assert!(is_valid_remnant_dir(&roaming.join("OldUninstalledGame")));
            assert!(!is_valid_remnant_dir(&roaming.join("Microsoft")));
            assert!(!is_valid_remnant_dir(&roaming.join("sweepr")));
            assert!(!is_valid_remnant_dir(&roaming));
            assert!(!is_valid_remnant_dir(&roaming.join("Sub").join("Deep")));
        }
    }

    #[test]
    fn winget_parser_and_id_validation() {
        let sample = "\
Name               Id                  Version   Available Source
-----------------------------------------------------------------
Mozilla Firefox    Mozilla.Firefox     122.0     124.0.1   winget
7-Zip 23.01 (x64)  7zip.7zip           23.01     24.01     winget
2 upgrades available.";
        let parsed = parse_winget_upgrade_output(sample);
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].id, "Mozilla.Firefox");
        assert_eq!(parsed[0].current_version, "122.0");
        assert_eq!(parsed[0].available_version, "124.0.1");
        assert_eq!(parsed[1].name, "7-Zip 23.01 (x64)");
        assert!(validate_winget_id("Mozilla.Firefox").is_ok());
        assert!(validate_winget_id("foo & calc.exe").is_err());
    }

    #[test]
    fn shortcut_and_broken_item_helpers() {
        assert_eq!(
            clean_query_from_path_or_name(r"C:\Users\Public\Desktop\Discord.lnk"),
            "Discord"
        );
        assert_eq!(clean_query_from_path_or_name("Spotify_Setup_x64.exe"), "Spotify");

        let dir = std::env::temp_dir().join(format!("sweepr-broken-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let empty_sub = dir.join("EmptySubFolder");
        std::fs::create_dir_all(&empty_sub).unwrap();
        let bad_lnk = dir.join("OldGame.lnk");
        std::fs::write(&bad_lnk, b"L\x00\x00\x00C:\\NonExistentFolder12345\\OldGame.exe\x00").unwrap();

        let existing_exe = dir.join("ExistingApp.exe");
        std::fs::write(&existing_exe, b"MZ").unwrap();
        let good_lnk = dir.join("GoodApp.lnk");
        let mut good_lnk_bytes = b"L\x00\x00\x00".to_vec();
        good_lnk_bytes.extend_from_slice(existing_exe.to_string_lossy().as_bytes());
        good_lnk_bytes.push(0);
        std::fs::write(&good_lnk, &good_lnk_bytes).unwrap();

        // Verify UTF-16LE wide string extraction with non-ASCII Windows username (e.g. C:\Users\Jürgen\...)
        let unicode_sub = dir.join("Jürgen");
        std::fs::create_dir_all(&unicode_sub).unwrap();
        let unicode_exe = unicode_sub.join("UnicodeApp.exe");
        std::fs::write(&unicode_exe, b"MZ").unwrap();
        let unicode_lnk = dir.join("UnicodeApp.lnk");
        let mut unicode_lnk_bytes = vec![0x4C, 0x00, 0x00, 0x00, 0x00]; // 1-byte unaligned offset before UTF-16LE
        for u in unicode_exe.to_string_lossy().encode_utf16() {
            unicode_lnk_bytes.extend_from_slice(&u.to_le_bytes());
        }
        unicode_lnk_bytes.extend_from_slice(&[0x00, 0x00]);
        std::fs::write(&unicode_lnk, &unicode_lnk_bytes).unwrap();
        let sample_unicode_target = if cfg!(windows) {
            unicode_exe.to_string_lossy().into_owned()
        } else {
            r"C:\Users\Jürgen\AppData\Local\UnicodeApp.exe".to_string()
        };
        let mut sample_utf16_lnk = vec![0x4C, 0x00, 0x00, 0x00, 0x00];
        for u in sample_unicode_target.encode_utf16() {
            sample_utf16_lnk.extend_from_slice(&u.to_le_bytes());
        }
        sample_utf16_lnk.extend_from_slice(&[0x00, 0x00]);
        let extracted_unicode = extract_lnk_exe_targets(&sample_utf16_lnk);
        assert!(
            extracted_unicode.iter().any(|p| p.contains("Jürgen") && p.ends_with("UnicodeApp.exe")),
            "expected UTF-16LE target with Jürgen, got: {:?}",
            extracted_unicode
        );

        let found = scan_broken_items_in_roots(std::slice::from_ref(&dir), std::slice::from_ref(&dir));
        assert_eq!(found.len(), 2);

        let mut paths: Vec<String> = found.iter().map(|i| i.path.clone()).collect();
        paths.push(good_lnk.to_string_lossy().into_owned());
        paths.push(unicode_lnk.to_string_lossy().into_owned());
        let cleaned = clean_broken_items_in_roots(&paths, std::slice::from_ref(&dir)).unwrap();
        assert_eq!(cleaned, 2);
        assert!(!empty_sub.exists());
        assert!(!bad_lnk.exists());
        assert!(good_lnk.exists(), "valid .lnk must not be deleted");
        assert!(unicode_lnk.exists(), "valid UTF-16LE Unicode .lnk must not be deleted");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn linux_app_id_validation() {
        assert_eq!(
            parse_linux_app_id("DESKSYS:firefox.desktop").unwrap(),
            (LinuxAppKind::DeskSys, "firefox.desktop")
        );
        assert_eq!(
            parse_linux_app_id("DESKLOC:custom-app.desktop").unwrap(),
            (LinuxAppKind::DeskLoc, "custom-app.desktop")
        );
        assert_eq!(
            parse_linux_app_id("DESKUSR:obsidian.desktop").unwrap(),
            (LinuxAppKind::DeskUsr, "obsidian.desktop")
        );
        assert_eq!(
            parse_linux_app_id("FLATPAK:org.gimp.GIMP").unwrap(),
            (LinuxAppKind::Flatpak, "org.gimp.GIMP")
        );
        assert_eq!(
            parse_linux_app_id("SNAP:vlc").unwrap(),
            (LinuxAppKind::Snap, "vlc")
        );

        assert!(parse_linux_app_id("DESKSYS:.hidden.desktop").is_err());
        assert!(parse_linux_app_id("DESKSYS:not_a_desktop_file").is_err());
        assert!(parse_linux_app_id("DESKUSR:../evil.desktop").is_err());
        assert!(parse_linux_app_id("DESKUSR:foo\0bar.desktop").is_err());
        assert!(parse_linux_app_id("FLATPAK:nodots").is_err());
        assert!(parse_linux_app_id("FLATPAK:org.evil;rm").is_err());
        assert!(parse_linux_app_id("SNAP:BadUpper").is_err());
        assert!(parse_linux_app_id("SNAP:-leading").is_err());
        assert!(parse_linux_app_id("UNKNOWN:foo").is_err());
    }

    #[test]
    fn linux_desktop_entry_parsing_and_exec_extraction() {
        let raw = r#"
[Desktop Entry]
Type=Application
Name=Cool Player
Comment=Plays media
Exec=env QT_QPA_PLATFORM=wayland "/opt/cool-player/cool-player" --flag %U
Categories=AudioVideo;Player;

[Desktop Action NewWindow]
Name=Open New Window
Exec=/usr/bin/should-be-ignored --new-window
"#;
        let parsed = parse_desktop_entry(raw).expect("valid desktop entry");
        assert_eq!(parsed.name, "Cool Player");
        assert_eq!(
            extract_exec_binary(&parsed.exec).as_deref(),
            Some("/opt/cool-player/cool-player")
        );
        assert!(is_appimage_path("/home/alice/Applications/Obsidian-1.5.AppImage"));
        assert!(!is_appimage_path("/usr/bin/vlc"));

        // Hidden / NoDisplay / non-Application / Sweepr itself are skipped
        assert!(parse_desktop_entry("[Desktop Entry]\nType=Application\nName=Hidden\nNoDisplay=true").is_none());
        assert!(parse_desktop_entry("[Desktop Entry]\nType=Application\nName=Hidden\nHidden=true").is_none());
        assert!(parse_desktop_entry("[Desktop Entry]\nType=Link\nName=Docs").is_none());
        assert!(parse_desktop_entry("[Desktop Entry]\nType=Application\nName=SWEEPR Cleaner").is_none());

        // Mock-directory .desktop discovery with real AppImage file size
        let dir = std::env::temp_dir().join(format!("sweepr-linux-desktop-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let appimage = dir.join("Obsidian.AppImage");
        std::fs::write(&appimage, vec![b'A'; 4096]).unwrap();
        std::fs::write(
            dir.join("obsidian.desktop"),
            format!(
                "[Desktop Entry]\nType=Application\nName=Obsidian\nExec=\"{}\" %U\nCategories=Office;\n",
                appimage.to_string_lossy().replace('\\', "\\\\")
            ),
        )
        .unwrap();
        std::fs::write(
            dir.join("flatpak-dup.desktop"),
            "[Desktop Entry]\nType=Application\nName=GIMP\nExec=flatpak run org.gimp.GIMP\nX-Flatpak=org.gimp.GIMP\n",
        )
        .unwrap();

        let mut discovered = Vec::new();
        scan_desktop_dir_into("DESKUSR", &dir, &mut discovered, false);
        assert_eq!(discovered.len(), 1);
        assert_eq!(discovered[0].id, "DESKUSR:obsidian.desktop");
        assert_eq!(discovered[0].name, "Obsidian");
        assert_eq!(discovered[0].publisher, "AppImage");
        assert_eq!(discovered[0].estimated_size, 4096);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn linux_flatpak_and_snap_parsers() {
        let fp_out = "org.gimp.GIMP\tGNU Image Manipulation Program\t2.10.36\ncom.sweepr.Cleaner\tSWEEPR\t1.0\n";
        let fp = parse_flatpak_list(fp_out);
        assert_eq!(fp.len(), 1);
        assert_eq!(fp[0].id, "FLATPAK:org.gimp.GIMP");
        assert_eq!(fp[0].name, "GNU Image Manipulation Program");
        assert_eq!(fp[0].version, "2.10.36");

        let snap_out = "\
Name               Version    Rev    Tracking       Publisher     Notes
core22             20240111   1122   latest/stable  canonical*    base
firefox            124.0.2-1  4033   latest/stable  mozilla*      -
vlc                3.0.20     3777   latest/stable  videolan*     -
";
        let snaps = parse_snap_list(snap_out);
        assert_eq!(snaps.len(), 2);
        assert_eq!(snaps[0].id, "SNAP:firefox");
        assert_eq!(snaps[0].publisher, "mozilla*");
        assert_eq!(snaps[1].id, "SNAP:vlc");

        let yaml = "name: obsidian\nversion: '1.5.12'\nsummary: Knowledge base\napps:\n  obsidian:\n    command: obsidian\n";
        assert_eq!(
            parse_snap_yaml(yaml),
            Some(("obsidian".into(), "1.5.12".into(), "Knowledge base".into()))
        );

        assert_eq!(
            parse_package_owner_output("dpkg", "firefox: /usr/share/applications/firefox.desktop").as_deref(),
            Some("firefox")
        );
        assert_eq!(
            parse_package_owner_output("rpm", "gimp\n").as_deref(),
            Some("gimp")
        );
        assert_eq!(
            parse_package_owner_output("pacman", "/usr/share/applications/vlc.desktop is owned by vlc 3.0.20-1").as_deref(),
            Some("vlc")
        );
        assert!(validate_linux_package_name("bad;cmd").is_err());
    }

    #[test]
    fn linux_remnant_roots_and_validation() {
        let dir = std::env::temp_dir().join(format!("sweepr-linux-remnants-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let home = dir.join("home");
        let cfg = home.join(".config");
        let share = home.join(".local/share");
        let var_app = home.join(".var/app");
        let old_cfg = cfg.join("OldDeletedApp");
        let protected_cfg = cfg.join("pulse");
        let installed_share = share.join("Firefox");
        let old_flatpak = var_app.join("org.old.Leftover");
        for p in [&old_cfg, &protected_cfg, &installed_share, &old_flatpak] {
            std::fs::create_dir_all(p).unwrap();
        }
        std::fs::write(old_cfg.join("cache.bin"), vec![b'x'; 80 * 1024]).unwrap();
        std::fs::write(protected_cfg.join("cookie"), vec![b'y'; 80 * 1024]).unwrap();
        std::fs::write(installed_share.join("data.bin"), vec![b'z'; 80 * 1024]).unwrap();
        std::fs::write(old_flatpak.join("state.bin"), vec![b'f'; 80 * 1024]).unwrap();

        let roots = linux_remnant_roots_from(Some(&home), Some(&cfg), Some(&share));
        assert_eq!(roots.len(), 3);
        assert_eq!(roots[0], ("~/.config", cfg.clone()));
        assert_eq!(roots[1], ("~/.local/share", share.clone()));
        assert_eq!(roots[2], ("~/.var/app", var_app.clone()));

        // Deduplicates if data == config
        let deduped = linux_remnant_roots_from(Some(&home), Some(&share), Some(&share));
        assert_eq!(deduped.len(), 2);

        let known_tokens = build_known_app_tokens(&[AppInfo {
            id: "DESKSYS:firefox.desktop".into(),
            name: "Firefox".into(),
            publisher: "Mozilla".into(),
            version: "124".into(),
            install_date: String::new(),
            estimated_size: 1024,
            kind: "linux".into(),
            can_force_remove: false,
        }]);
        let mut protected: Vec<&str> = PROTECTED_APPDATA_FOLDERS.to_vec();
        protected.extend_from_slice(PROTECTED_LINUX_FOLDERS);

        let future_cutoff = std::time::SystemTime::now() + std::time::Duration::from_secs(60);
        let found = find_remnants_in_roots_with_cutoff(
            &roots,
            &known_tokens,
            &[],
            &protected,
            future_cutoff,
        );
        assert_eq!(found.len(), 2);
        assert!(found.iter().any(|r| r.name == "OldDeletedApp" && r.location == "~/.config"));
        assert!(found.iter().any(|r| r.name == "org.old.Leftover" && r.location == "~/.var/app"));
        assert!(found.iter().all(|r| r.name != "pulse" && r.name != "Firefox"));

        let allowed_roots: Vec<std::path::PathBuf> = roots.iter().map(|(_, p)| p.clone()).collect();
        assert!(is_valid_remnant_in_roots(&old_cfg, &allowed_roots, &protected));
        assert!(is_valid_remnant_in_roots(&old_flatpak, &allowed_roots, &protected));
        assert!(!is_valid_remnant_in_roots(&protected_cfg, &allowed_roots, &protected));
        assert!(!is_valid_remnant_in_roots(&cfg, &allowed_roots, &protected));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn uwp_appx_parser_and_safety_filter() {
        assert_eq!(
            parse_uwp_app_id("UWP:SpotifyAB.SpotifyMusic_1.23.0.0_x64__zpdnekdrzrea0").unwrap(),
            "SpotifyAB.SpotifyMusic_1.23.0.0_x64__zpdnekdrzrea0"
        );
        assert!(parse_uwp_app_id("HKLM64:Foo").is_err());
        assert!(parse_uwp_app_id("UWP:").is_err());
        assert!(parse_uwp_app_id("UWP:foo;calc.exe").is_err());
        assert!(parse_uwp_app_id("UWP:../bad_pkg").is_err());

        // Single object JSON (PowerShell ConvertTo-Json 1-element quirk)
        let single_json = r#"{
            "Name": "SpotifyAB.SpotifyMusic",
            "PackageFullName": "SpotifyAB.SpotifyMusic_1.2.3.0_x64__zpdnekdrzrea0",
            "Publisher": "CN=Spotify AB",
            "Version": "1.2.3.0",
            "InstallLocation": "C:\\Program Files\\WindowsApps\\Spotify",
            "IsFramework": false,
            "IsResourcePackage": false,
            "NonRemovable": false,
            "SignatureKind": "Store"
        }"#;
        let single = parse_appx_packages_json(single_json);
        assert_eq!(single.len(), 1);
        assert!(is_safe_removable_appx(&single[0]));

        // Array JSON filtering protected system/framework/store/edge/sweepr packages
        let arr_json = r#"[
            {"Name": "Microsoft.WindowsStore", "PackageFullName": "Microsoft.WindowsStore_1_x64__8wekyb3d8bbwe", "IsFramework": false, "IsResourcePackage": false, "NonRemovable": false, "SignatureKind": "Store"},
            {"Name": "Microsoft.VCLibs.140.00", "PackageFullName": "Microsoft.VCLibs.140.00_1_x64__8wekyb3d8bbwe", "IsFramework": true, "IsResourcePackage": false, "NonRemovable": false, "SignatureKind": "Store"},
            {"Name": "Microsoft.MicrosoftEdge", "PackageFullName": "Microsoft.MicrosoftEdge_1_neutral__8wekyb3d8bbwe", "IsFramework": false, "IsResourcePackage": false, "NonRemovable": false, "SignatureKind": "System"},
            {"Name": "Microsoft.Windows.ShellExperienceHost", "PackageFullName": "Microsoft.Windows.ShellExperienceHost_1_neutral__cw5n1h2txyewy", "IsFramework": false, "IsResourcePackage": false, "NonRemovable": true, "SignatureKind": "System"},
            {"Name": "BenjaminCook.SWEEPRCleaner", "PackageFullName": "BenjaminCook.SWEEPRCleaner_1_x64__abc", "IsFramework": false, "IsResourcePackage": false, "NonRemovable": false, "SignatureKind": "Developer"},
            {"Name": "CanonicalGroupLimited.Ubuntu", "PackageFullName": "CanonicalGroupLimited.Ubuntu_2404.1_x64__79rhkp1fndgsc", "IsFramework": false, "IsResourcePackage": false, "NonRemovable": false, "SignatureKind": "Store"}
        ]"#;
        let parsed = parse_appx_packages_json(arr_json);
        let safe: Vec<_> = parsed.iter().filter(|p| is_safe_removable_appx(p)).collect();
        assert_eq!(safe.len(), 1);
        assert_eq!(safe[0].name, "CanonicalGroupLimited.Ubuntu");
    }

    #[test]
    fn force_remove_install_dir_and_remnants_safety_and_batch_dedup() {
        let dir = std::env::temp_dir().join(format!("sweepr-force-rm-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let prog_files = dir.join("Program Files");
        let old_app_dir = prog_files.join("OldBrokenApp");
        let roaming = dir.join("AppData").join("Roaming");
        let app_remnant = roaming.join("OldBrokenApp");
        let protected_remnant = roaming.join("Microsoft");
        let other_vendor_remnant = roaming.join("OtherStillInstalled");
        for p in [&old_app_dir, &app_remnant, &protected_remnant, &other_vendor_remnant] {
            std::fs::create_dir_all(p).unwrap();
        }
        std::fs::write(old_app_dir.join("app.exe"), b"MZ").unwrap();
        std::fs::write(app_remnant.join("cache.dat"), vec![b'a'; 1024]).unwrap();
        std::fs::write(protected_remnant.join("sys.dat"), vec![b'b'; 1024]).unwrap();
        std::fs::write(other_vendor_remnant.join("other.dat"), vec![b'c'; 1024]).unwrap();

        // Valid app install dir passes
        assert!(validate_force_remove_install_dir(
            &old_app_dir,
            "OldBrokenApp",
            "OldVendor",
            None,
            &[]
        )
        .is_ok());

        // Container directory ("Program Files") and unrelated directory MUST fail
        assert!(validate_force_remove_install_dir(&prog_files, "OldBrokenApp", "", None, &[]).is_err());
        assert!(validate_force_remove_install_dir(&roaming, "Roaming", "", None, &[]).is_err());
        assert!(validate_force_remove_install_dir(
            &other_vendor_remnant,
            "OldBrokenApp",
            "OldVendor",
            None,
            &[]
        )
        .is_err());

        // App-specific remnant finder picks only OldBrokenApp, skipping Microsoft and still-installed apps
        let other_tokens = vec![normalise_token("OtherStillInstalled")];
        let found = find_app_specific_remnants_in_roots(
            &[("AppData\\Roaming", roaming.clone())],
            "OldBrokenApp",
            "OldVendor",
            &other_tokens,
            &[],
        );
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].name, "OldBrokenApp");

        // Batch dedup & cap
        let mut raw_ids = vec!["HKCU:A".into(), "HKCU:A".into(), "".into(), "HKCU:B".into()];
        for i in 0..60 {
            raw_ids.push(format!("HKCU:App_{i}"));
        }
        let capped = dedup_and_cap_batch_ids(raw_ids);
        assert_eq!(capped.len(), MAX_BATCH_UNINSTALL);
        assert_eq!(capped[0], "HKCU:A");
        assert_eq!(capped[1], "HKCU:B");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn force_remove_real_program_files_and_protected_path_guards() {
        // Generic short leaf like "bin" must NOT substring-match "Combining Tool"
        let dir = std::env::temp_dir().join(format!("sweepr-force-tok-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let generic_bin = dir.join("Tools").join("bin");
        std::fs::create_dir_all(&generic_bin).unwrap();
        assert!(validate_force_remove_install_dir(
            &generic_bin,
            "Combining Tool",
            "Generic Corp",
            None,
            &[]
        )
        .is_err());
        let _ = std::fs::remove_dir_all(&dir);

        #[cfg(windows)]
        {
            if let Ok(pf) = std::env::var("ProgramFiles") {
                let pf_path = std::path::Path::new(&pf);
                let legit_app = pf_path.join("ExampleWidgetApp");
                let legit_vendor_app = pf_path.join("ExampleVendor").join("ExampleWidgetApp");
                assert!(!is_protected_force_remove_path(&legit_app));
                assert!(validate_force_remove_path_shape(
                    &legit_app,
                    "ExampleWidgetApp",
                    "ExampleVendor",
                    None
                )
                .is_ok());
                assert!(validate_force_remove_path_shape(
                    &legit_vendor_app,
                    "ExampleWidgetApp",
                    "ExampleVendor",
                    None
                )
                .is_ok());

                // Container roots and OS components under real %ProgramFiles% MUST be rejected
                assert!(is_protected_force_remove_path(pf_path));
                assert!(validate_force_remove_path_shape(
                    pf_path,
                    "Program Files",
                    "",
                    None
                )
                .is_err());
                if pf_path.is_dir() {
                    assert!(validate_force_remove_install_dir(
                        pf_path,
                        "ExampleWidgetApp",
                        "",
                        None,
                        &[]
                    )
                    .is_err());
                }

                let common_files = pf_path.join("Common Files");
                assert!(is_protected_force_remove_path(&common_files));
                assert!(validate_force_remove_path_shape(
                    &common_files,
                    "Common Files",
                    "",
                    None
                )
                .is_err());
                if common_files.is_dir() {
                    assert!(validate_force_remove_install_dir(
                        &common_files,
                        "Common Files",
                        "",
                        None,
                        &[]
                    )
                    .is_err());
                }

                let windows_apps_foo = pf_path.join("WindowsApps").join("Foo");
                assert!(is_protected_force_remove_path(&windows_apps_foo));
                assert!(validate_force_remove_path_shape(
                    &windows_apps_foo,
                    "Foo",
                    "",
                    None
                )
                .is_err());

                let defender = pf_path.join("Windows Defender");
                assert!(is_protected_force_remove_path(&defender));
            }

            if let Ok(pf86) = std::env::var("ProgramFiles(x86)") {
                let pf86_path = std::path::Path::new(&pf86);
                let app86 = pf86_path.join("LegacyTool32");
                assert!(!is_protected_force_remove_path(&app86));
                assert!(validate_force_remove_path_shape(
                    &app86,
                    "LegacyTool32",
                    "",
                    None
                )
                .is_ok());
                assert!(is_protected_force_remove_path(pf86_path));
                assert!(is_protected_force_remove_path(&pf86_path.join("Common Files")));
            }

            if let Ok(pd) = std::env::var("ProgramData") {
                let pd_path = std::path::Path::new(&pd);
                let pd_app = pd_path.join("ExampleServiceApp");
                assert!(!is_protected_force_remove_path(&pd_app));
                assert!(validate_force_remove_path_shape(
                    &pd_app,
                    "ExampleServiceApp",
                    "",
                    None
                )
                .is_ok());
                assert!(is_protected_force_remove_path(pd_path));
                assert!(is_protected_force_remove_path(&pd_path.join("Microsoft")));
            }

            if let Ok(sysroot) = std::env::var("SystemRoot") {
                let sys_path = std::path::Path::new(&sysroot);
                assert!(is_protected_force_remove_path(sys_path));
                assert!(is_protected_force_remove_path(&sys_path.join("System32")));
                if sys_path.is_dir() {
                    assert!(validate_force_remove_install_dir(
                        sys_path,
                        "Windows",
                        "Microsoft",
                        None,
                        &[]
                    )
                    .is_err());
                }
            }

            assert!(is_protected_force_remove_path(std::path::Path::new(
                r"C:\Users\TestUser\AppData\Local\SWEEPRCleaner"
            )));
            assert!(is_protected_force_remove_path(std::path::Path::new(
                r"C:\Users\TestUser\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup"
            )));
        }
    }
}

