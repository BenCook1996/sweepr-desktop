use crate::commands::AppState;
use crate::error::{AppError, AppResult};
use serde::Serialize;
use tauri::State;

/// Installed application as shown in the UI. The uninstall command itself is
/// never sent to the frontend: `uninstall_app` looks it up again by `id`.
#[derive(Serialize, Clone)]
pub struct AppInfo {
    /// Unique per hive: `HKLM64:<subkey>`, `HKLM32:<subkey>` or `HKCU:<subkey>`.
    pub id: String,
    pub name: String,
    pub publisher: String,
    pub version: String,
    pub install_date: String,
    pub estimated_size: u64,
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
                    });
                }
            }
        }
    }

    // Stable sort keeps hive order (HKLM64, HKLM32, HKCU) among same-named apps,
    // and dedup keeps the first entry of each name.
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
        // Bare name such as MsiExec.exe or RunDll32: only resolve from System32.
        let sys = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
        let base = Path::new(&sys).join("System32");
        path = base.join(&prog);
        if !path.is_file() && Path::new(&prog).extension().is_none() {
            path = base.join(format!("{prog}.exe"));
        }
    }
    if !path.is_absolute() || !path.is_file() {
        return Err(AppError::Other(format!("Uninstaller not found: {}", path.display())));
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

/// Run the uninstaller without a shell. Falls back to an elevated launch when
/// Windows reports that the uninstaller requires administrator rights.
#[cfg(target_os = "windows")]
fn launch(program: &std::path::Path, args: &str) -> AppResult<()> {
    use base64::Engine;
    use std::os::windows::process::CommandExt;

    let mut cmd = std::process::Command::new(program);
    if !args.is_empty() {
        cmd.raw_arg(args);
    }
    match cmd.spawn() {
        Ok(_) => Ok(()),
        Err(e) if e.raw_os_error() == Some(740) => {
            // ERROR_ELEVATION_REQUIRED: elevate via ProcessStartInfo with Verb='runas'
            // so `Arguments` is passed verbatim to ShellExecuteExW without Start-Process
            // re-tokenizing or stripping quotes.
            let q = |s: &str| format!("'{}'", s.replace('\'', "''"));
            let script = format!(
                "$psi = New-Object System.Diagnostics.ProcessStartInfo; $psi.FileName = {}; $psi.Arguments = {}; $psi.Verb = 'runas'; $psi.UseShellExecute = $true; [System.Diagnostics.Process]::Start($psi) | Out-Null",
                q(&program.to_string_lossy()),
                q(args)
            );
            let utf16: Vec<u8> = script.encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
            let encoded = base64::engine::general_purpose::STANDARD.encode(utf16);
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            std::process::Command::new("powershell.exe")
                .args(["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", &encoded])
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
                .map(|_| ())
                .map_err(|e| AppError::Other(format!("Could not start uninstaller: {e}")))
        }
        Err(e) => Err(AppError::Other(format!("Could not start uninstaller: {e}"))),
    }
}

/// Pro feature: requires an active licence. Takes only the app id; the
/// uninstall command is read from the registry here, never from the UI.
#[tauri::command]
pub async fn uninstall_app(state: State<'_, AppState>, id: String) -> AppResult<()> {
    parse_app_id(&id)?;
    state.licensing.require_active().await?;

    #[cfg(target_os = "windows")]
    {
        tauri::async_runtime::spawn_blocking(move || {
            let s = lookup_uninstall_string(&id)?;
            let (program, args) = resolve_program(&s)?;
            launch(&program, &args)
        })
        .await
        .map_err(|e| AppError::Other(format!("background task failed: {e}")))?
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err(AppError::Other("Not supported on this OS".into()))
    }
}

#[derive(Serialize, Clone)]
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

fn find_remnants_blocking(exclusions: &[std::path::PathBuf]) -> Vec<AppRemnant> {
    let installed = get_installed_apps();
    let mut known_tokens: Vec<String> = Vec::new();
    for app in &installed {
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
            if w.len() >= 4 && !matches!(w.as_str(), "corp" | "corporation" | "inc" | "ltd" | "gmbh" | "software" | "technologies" | "studio" | "client" | "desktop" | "windows") {
                known_tokens.push(w);
            }
        }
    }

    let cutoff = std::time::SystemTime::now()
        .checked_sub(std::time::Duration::from_secs(7 * 24 * 3600))
        .unwrap_or(std::time::SystemTime::UNIX_EPOCH);

    let mut roots: Vec<(&str, std::path::PathBuf)> = Vec::new();
    if let Some(roaming) = dirs::data_dir() {
        roots.push(("AppData\\Roaming", roaming));
    }
    if let Some(local) = dirs::data_local_dir() {
        roots.push(("AppData\\Local", local));
    }

    let mut remnants = Vec::new();
    for (label, root) in roots {
        let Ok(rd) = std::fs::read_dir(&root) else { continue };
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
            if PROTECTED_APPDATA_FOLDERS.iter().any(|p| p.eq_ignore_ascii_case(&lower)) {
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
                location: label.to_string(),
                bytes,
                files,
            });
        }
    }

    remnants.sort_by(|a, b| b.bytes.cmp(&a.bytes));
    remnants
}

fn is_valid_remnant_dir(target: &std::path::Path) -> bool {
    if !target.is_absolute() {
        return false;
    }
    let Some(parent) = target.parent() else { return false };
    let allowed_parents = [dirs::data_dir(), dirs::data_local_dir()];
    let is_direct_child = allowed_parents.into_iter().flatten().any(|root| {
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
    !PROTECTED_APPDATA_FOLDERS.iter().any(|p| p.eq_ignore_ascii_case(name))
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
fn check_outdated_blocking() -> Vec<OutdatedApp> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let Ok(output) = std::process::Command::new("winget")
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
            let output = std::process::Command::new("winget")
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
}
