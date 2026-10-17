//! IPC command layer. All decisions (paths, entitlement) live in Rust modules.

use crate::cleaner::{self, CleanReport, QuarantineEntry};
use crate::error::{AppError, AppResult};
use crate::licensing::{LicenseStatus, Licensing};
use crate::memory::{self, MemoryOverview, RunningAppConflict, StartupItem, SystemOverview};
use crate::rules;
use crate::safety;
use crate::scanner::{self, ScanReport};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_opener::OpenerExt;

pub struct AppState {
    pub data_dir: PathBuf,
    pub licensing: Licensing,
}

fn join_err(e: impl std::fmt::Display) -> AppError {
    AppError::Other(format!("background task failed: {e}"))
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CleanHistoryEntry {
    pub id: String,
    pub timestamp: u64,
    pub bytes_freed: u64,
    pub files_removed: u64,
    pub categories: Vec<String>,
    pub mode: String,
}

fn load_cleaning_history(data_dir: &Path) -> Vec<CleanHistoryEntry> {
    let path = data_dir.join("cleaning_history.json");
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn append_cleaning_history(data_dir: &Path, entry: CleanHistoryEntry) -> std::io::Result<()> {
    let mut list = load_cleaning_history(data_dir);
    list.insert(0, entry);
    if list.len() > 100 {
        list.truncate(100);
    }
    let json = serde_json::to_string_pretty(&list)?;
    std::fs::write(data_dir.join("cleaning_history.json"), json)
}

#[tauri::command]
pub async fn scan_start(app: AppHandle, state: State<'_, AppState>) -> AppResult<ScanReport> {
    let exclusions = safety::load_exclusions(&state.data_dir);
    tauri::async_runtime::spawn_blocking(move || {
        let rules = rules::all();
        scanner::scan_all_with_exclusions(&rules, &exclusions, |p| {
            let _ = app.emit("scan://progress", p);
        })
    })
    .await
    .map_err(join_err)
}

#[tauri::command]
pub async fn clean_categories(
    state: State<'_, AppState>,
    ids: Vec<String>,
    use_trash: bool,
) -> AppResult<Vec<CleanReport>> {
    let mut selected = Vec::new();
    for id in &ids {
        let rule = rules::find(id).ok_or_else(|| AppError::NotFound(id.clone()))?;
        selected.push(rule);
    }
    // Entitlement is enforced here in Rust
    if selected.iter().any(|r| !r.free) {
        state.licensing.require_active().await?;
    }
    let exclusions = safety::load_exclusions(&state.data_dir);
    let data_dir_clone = state.data_dir.clone();
    let reports = tauri::async_runtime::spawn_blocking(move || {
        selected
            .iter()
            .map(|r| cleaner::clean_with_exclusions_and_quarantine(r, use_trash, &exclusions, Some(&data_dir_clone)))
            .collect::<Vec<CleanReport>>()
    })
    .await
    .map_err(join_err)?;

    let total_freed: u64 = reports.iter().map(|r| r.bytes_freed).sum();
    let total_removed: u64 = reports.iter().map(|r| r.files_removed).sum();
    if total_freed > 0 || total_removed > 0 {
        let entry = CleanHistoryEntry {
            id: format!("h_{}", now_secs()),
            timestamp: now_secs(),
            bytes_freed: total_freed,
            files_removed: total_removed,
            categories: ids,
            mode: if use_trash { "Recycle Bin".into() } else { "Sweepr Quarantine (7d undo)".into() },
        };
        let _ = append_cleaning_history(&state.data_dir, entry);
    }

    Ok(reports)
}

#[tauri::command]
pub fn list_quarantine(state: State<'_, AppState>) -> Vec<QuarantineEntry> {
    cleaner::list_quarantine_entries(&state.data_dir)
}

#[tauri::command]
pub fn restore_quarantine_item(state: State<'_, AppState>, id: String) -> AppResult<String> {
    cleaner::restore_quarantine_entry(&state.data_dir, &id)
}

#[tauri::command]
pub fn get_cleaning_history(state: State<'_, AppState>) -> Vec<CleanHistoryEntry> {
    load_cleaning_history(&state.data_dir)
}

#[tauri::command]
pub fn list_exclusions(state: State<'_, AppState>) -> Vec<String> {
    safety::load_exclusions(&state.data_dir)
        .into_iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect()
}

#[tauri::command]
pub fn add_exclusion(state: State<'_, AppState>, path: String) -> AppResult<Vec<String>> {
    let trimmed = path.trim();
    let candidate = PathBuf::from(trimmed);
    if !candidate.is_absolute() {
        return Err(AppError::Other("Exclusion path must be an absolute path.".into()));
    }
    let mut list = safety::load_exclusions(&state.data_dir);
    if !safety::is_excluded(&candidate, &list) {
        list.push(candidate);
        safety::save_exclusions(&state.data_dir, &list)
            .map_err(|e| AppError::Other(format!("Could not save exclusion list: {e}")))?;
    }
    Ok(list.into_iter().map(|p| p.to_string_lossy().into_owned()).collect())
}

#[tauri::command]
pub fn remove_exclusion(state: State<'_, AppState>, path: String) -> AppResult<Vec<String>> {
    let target = PathBuf::from(path.trim());
    let mut list = safety::load_exclusions(&state.data_dir);
    list.retain(|p| p != &target && !p.to_string_lossy().eq_ignore_ascii_case(path.trim()));
    safety::save_exclusions(&state.data_dir, &list)
        .map_err(|e| AppError::Other(format!("Could not save exclusion list: {e}")))?;
    Ok(list.into_iter().map(|p| p.to_string_lossy().into_owned()).collect())
}

#[tauri::command]
pub async fn check_running_apps(category_ids: Vec<String>) -> AppResult<Vec<RunningAppConflict>> {
    tauri::async_runtime::spawn_blocking(move || memory::detect_running_conflicts(&category_ids))
        .await
        .map_err(join_err)
}

#[tauri::command]
pub async fn license_status(state: State<'_, AppState>, force: bool) -> AppResult<LicenseStatus> {
    state.licensing.status(force).await
}

#[tauri::command]
pub async fn start_checkout(
    app: AppHandle,
    state: State<'_, AppState>,
    email: Option<String>,
    plan: Option<String>,
) -> AppResult<()> {
    let url = state.licensing.checkout_url(email.as_deref(), plan.as_deref()).await?;
    app.opener().open_url(url, None::<&str>).map_err(|e| AppError::Other(e.to_string()))
}

#[tauri::command]
pub async fn request_login_otp(state: State<'_, AppState>, email: String) -> AppResult<()> {
    state.licensing.request_email_otp(&email).await
}

#[tauri::command]
pub async fn verify_login_otp(state: State<'_, AppState>, email: String, code: String) -> AppResult<LicenseStatus> {
    state.licensing.verify_email_otp(&email, &code).await
}

#[tauri::command]
pub async fn memory_overview() -> AppResult<MemoryOverview> {
    tauri::async_runtime::spawn_blocking(memory::overview).await.map_err(join_err)
}

#[tauri::command]
pub async fn startup_items() -> AppResult<Vec<StartupItem>> {
    tauri::async_runtime::spawn_blocking(memory::startup_items).await.map_err(join_err)
}

#[tauri::command]
pub async fn toggle_startup_item(name: String, scope: String, enabled: bool) -> AppResult<Vec<StartupItem>> {
    tauri::async_runtime::spawn_blocking(move || memory::toggle_startup_item(&name, &scope, enabled))
        .await
        .map_err(join_err)?
}

#[tauri::command]
pub fn get_autostart() -> AppResult<bool> {
    memory::get_autostart_enabled()
}

#[tauri::command]
pub fn set_autostart(enabled: bool) -> AppResult<bool> {
    memory::set_autostart_enabled(enabled)
}

#[tauri::command]
pub fn get_schedule_settings(state: State<'_, AppState>) -> String {
    let path = state.data_dir.join("schedule.txt");
    std::fs::read_to_string(path).map(|s| s.trim().to_string()).unwrap_or_else(|_| "off".into())
}

#[tauri::command]
pub fn set_schedule_settings(state: State<'_, AppState>, schedule: String) -> AppResult<String> {
    let val = match schedule.trim().to_ascii_lowercase().as_str() {
        "daily" => "daily",
        "weekly" => "weekly",
        _ => "off",
    };
    let path = state.data_dir.join("schedule.txt");
    std::fs::write(path, val).map_err(|e| AppError::Other(format!("Could not save schedule: {e}")))?;
    Ok(val.into())
}

#[tauri::command]
pub async fn system_overview() -> AppResult<SystemOverview> {
    tauri::async_runtime::spawn_blocking(memory::system_overview).await.map_err(join_err)
}

#[tauri::command]
pub fn open_breach_check(app: AppHandle) -> AppResult<()> {
    app.opener()
        .open_url("https://haveibeenpwned.com/", None::<&str>)
        .map_err(|e| AppError::Other(e.to_string()))
}

// ---------------------------------------------------------------------------
// Browser Privacy Scanner & Cleaner (#11)
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone, Debug)]
pub struct BrowserPrivacyItem {
    pub id: String,
    pub browser: String,
    pub name: String,
    pub cache_bytes: u64,
    pub cookies_bytes: u64,
    pub history_bytes: u64,
    pub total_bytes: u64,
    pub installed: bool,
}

fn dir_size(dir: &Path) -> u64 {
    let mut total = 0u64;
    if let Ok(entries) = std::fs::read_dir(dir) {
        for e in entries.flatten() {
            let p = e.path();
            if let Ok(md) = e.metadata() {
                if md.is_file() {
                    total += md.len();
                } else if md.is_dir() {
                    total += dir_size(&p);
                }
            }
        }
    }
    total
}

fn file_size(p: &Path) -> u64 {
    std::fs::metadata(p).map(|m| m.len()).unwrap_or(0)
}

fn scan_chromium_browser(name: &str, id: &str, relative_path: &str) -> BrowserPrivacyItem {
    let mut item = BrowserPrivacyItem {
        id: id.into(),
        browser: id.into(),
        name: name.into(),
        cache_bytes: 0,
        cookies_bytes: 0,
        history_bytes: 0,
        total_bytes: 0,
        installed: false,
    };

    if let Some(local_app_data) = dirs::data_local_dir() {
        let user_data = local_app_data.join(relative_path).join("User Data");
        if user_data.exists() {
            item.installed = true;
            let default_profile = user_data.join("Default");
            if default_profile.exists() {
                item.cache_bytes += dir_size(&default_profile.join("Cache"));
                item.cache_bytes += dir_size(&default_profile.join("Code Cache"));
                item.cache_bytes += dir_size(&default_profile.join("GPUCache"));
                item.cookies_bytes += file_size(&default_profile.join("Network").join("Cookies"));
                item.cookies_bytes += file_size(&default_profile.join("Cookies"));
                item.history_bytes += file_size(&default_profile.join("History"));
                item.history_bytes += file_size(&default_profile.join("History-journal"));
            }
        }
    }
    item.total_bytes = item.cache_bytes + item.cookies_bytes + item.history_bytes;
    item
}

fn scan_firefox_browser() -> BrowserPrivacyItem {
    let mut item = BrowserPrivacyItem {
        id: "firefox".into(),
        browser: "firefox".into(),
        name: "Mozilla Firefox".into(),
        cache_bytes: 0,
        cookies_bytes: 0,
        history_bytes: 0,
        total_bytes: 0,
        installed: false,
    };

    if let Some(roaming) = dirs::data_dir() {
        let profiles = roaming.join("Mozilla").join("Firefox").join("Profiles");
        if profiles.exists() {
            item.installed = true;
            if let Ok(entries) = std::fs::read_dir(&profiles) {
                for e in entries.flatten() {
                    let p = e.path();
                    if p.is_dir() {
                        item.cookies_bytes += file_size(&p.join("cookies.sqlite"));
                        item.history_bytes += file_size(&p.join("places.sqlite"));
                    }
                }
            }
        }
    }

    if let Some(local) = dirs::data_local_dir() {
        let cache_profiles = local.join("Mozilla").join("Firefox").join("Profiles");
        if cache_profiles.exists() {
            if let Ok(entries) = std::fs::read_dir(&cache_profiles) {
                for e in entries.flatten() {
                    let p = e.path();
                    if p.is_dir() {
                        item.cache_bytes += dir_size(&p.join("cache2"));
                    }
                }
            }
        }
    }

    item.total_bytes = item.cache_bytes + item.cookies_bytes + item.history_bytes;
    item
}

#[tauri::command]
pub async fn scan_browser_privacy() -> AppResult<Vec<BrowserPrivacyItem>> {
    tauri::async_runtime::spawn_blocking(|| {
        vec![
            scan_chromium_browser("Google Chrome", "chrome", "Google/Chrome"),
            scan_chromium_browser("Microsoft Edge", "edge", "Microsoft/Edge"),
            scan_chromium_browser("Brave Browser", "brave", "BraveSoftware/Brave-Browser"),
            scan_firefox_browser(),
        ]
    })
    .await
    .map_err(join_err)
}

fn clean_file_or_dir(p: &Path) -> u64 {
    if !p.exists() {
        return 0;
    }
    if let Ok(md) = p.metadata() {
        if md.is_file() {
            let len = md.len();
            if std::fs::remove_file(p).is_ok() {
                return len;
            }
        } else if md.is_dir() {
            let size = dir_size(p);
            if std::fs::remove_dir_all(p).is_ok() {
                return size;
            }
        }
    }
    0
}

#[tauri::command]
pub async fn clean_browser_privacy(
    state: State<'_, AppState>,
    browsers: Vec<String>,
    clear_cache: bool,
    clear_cookies: bool,
    clear_history: bool,
) -> AppResult<u64> {
    state.licensing.require_active().await?;

    tauri::async_runtime::spawn_blocking(move || {
        let mut total_freed = 0u64;

        for b in &browsers {
            match b.as_str() {
                "chrome" | "edge" | "brave" => {
                    let rel = match b.as_str() {
                        "chrome" => "Google/Chrome",
                        "edge" => "Microsoft/Edge",
                        _ => "BraveSoftware/Brave-Browser",
                    };
                    if let Some(local_app_data) = dirs::data_local_dir() {
                        let default_profile = local_app_data.join(rel).join("User Data").join("Default");
                        if default_profile.exists() {
                            if clear_cache {
                                total_freed += clean_file_or_dir(&default_profile.join("Cache"));
                                total_freed += clean_file_or_dir(&default_profile.join("Code Cache"));
                                total_freed += clean_file_or_dir(&default_profile.join("GPUCache"));
                            }
                            if clear_cookies {
                                total_freed += clean_file_or_dir(&default_profile.join("Network").join("Cookies"));
                                total_freed += clean_file_or_dir(&default_profile.join("Cookies"));
                            }
                            if clear_history {
                                total_freed += clean_file_or_dir(&default_profile.join("History"));
                                total_freed += clean_file_or_dir(&default_profile.join("History-journal"));
                            }
                        }
                    }
                }
                "firefox" => {
                    if let Some(roaming) = dirs::data_dir() {
                        let profiles = roaming.join("Mozilla").join("Firefox").join("Profiles");
                        if let Ok(entries) = std::fs::read_dir(&profiles) {
                            for e in entries.flatten() {
                                let p = e.path();
                                if p.is_dir() {
                                    if clear_cookies {
                                        total_freed += clean_file_or_dir(&p.join("cookies.sqlite"));
                                    }
                                    if clear_history {
                                        total_freed += clean_file_or_dir(&p.join("places.sqlite"));
                                    }
                                }
                            }
                        }
                    }
                    if clear_cache {
                        if let Some(local) = dirs::data_local_dir() {
                            let cache_profiles = local.join("Mozilla").join("Firefox").join("Profiles");
                            if let Ok(entries) = std::fs::read_dir(&cache_profiles) {
                                for e in entries.flatten() {
                                    let p = e.path();
                                    if p.is_dir() {
                                        total_freed += clean_file_or_dir(&p.join("cache2"));
                                    }
                                }
                            }
                        }
                    }
                }
                _ => {}
            }
        }

        Ok(total_freed)
    })
    .await
    .map_err(join_err)?
}

// ---------------------------------------------------------------------------
// k-Anonymity Password Breach Check (#12)
// ---------------------------------------------------------------------------

fn sha1_digest(data: &[u8]) -> [u8; 20] {
    let mut h: [u32; 5] = [0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0];
    let bit_len = (data.len() as u64) * 8;
    let mut msg = data.to_vec();
    msg.push(0x80);
    while (msg.len() % 64) != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bit_len.to_be_bytes());

    for chunk in msg.chunks_exact(64) {
        let mut w = [0u32; 80];
        for i in 0..16 {
            w[i] = u32::from_be_bytes([chunk[i * 4], chunk[i * 4 + 1], chunk[i * 4 + 2], chunk[i * 4 + 3]]);
        }
        for i in 16..80 {
            w[i] = (w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]).rotate_left(1);
        }
        let (mut a, mut b, mut c, mut d, mut e) = (h[0], h[1], h[2], h[3], h[4]);
        for (i, &wi) in w.iter().enumerate() {
            let (f, k) = match i {
                0..=19 => ((b & c) | (!b & d), 0x5A827999),
                20..=39 => (b ^ c ^ d, 0x6ED9EBA1),
                40..=59 => ((b & c) | (b & d) | (c & d), 0x8F1BBCDC),
                _ => (b ^ c ^ d, 0xCA62C1D6),
            };
            let temp = a.rotate_left(5).wrapping_add(f).wrapping_add(e).wrapping_add(k).wrapping_add(wi);
            e = d;
            d = c;
            c = b.rotate_left(30);
            b = a;
            a = temp;
        }
        h[0] = h[0].wrapping_add(a);
        h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(d);
        h[4] = h[4].wrapping_add(e);
    }
    let mut out = [0u8; 20];
    for (i, &val) in h.iter().enumerate() {
        out[i * 4..i * 4 + 4].copy_from_slice(&val.to_be_bytes());
    }
    out
}

#[tauri::command]
pub async fn check_password_breach(password: String) -> AppResult<u64> {
    if password.is_empty() {
        return Ok(0);
    }
    let digest = sha1_digest(password.as_bytes());
    let hex_hash = digest.iter().map(|b| format!("{b:02X}")).collect::<String>();
    let prefix = &hex_hash[0..5];
    let suffix = &hex_hash[5..];

    let url = format!("https://api.pwnedpasswords.com/range/{prefix}");
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(6))
        .build()
        .map_err(|e| AppError::Other(e.to_string()))?;

    let res = client.get(&url).header("Add-Padding", "true").send().await;
    let Ok(resp) = res else {
        return Ok(0);
    };
    let Ok(body) = resp.text().await else {
        return Ok(0);
    };

    for line in body.lines() {
        let parts: Vec<&str> = line.trim().split(':').collect();
        if parts.len() == 2 && parts[0].eq_ignore_ascii_case(suffix) {
            let count: u64 = parts[1].trim().parse().unwrap_or(0);
            return Ok(count);
        }
    }

    Ok(0)
}

// ---------------------------------------------------------------------------
// App Update Checker (#2) & Support Reporter (#6)
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone, Debug)]
pub struct AppUpdateInfo {
    pub update_available: bool,
    pub latest_version: String,
    pub current_version: String,
    pub notes: String,
    pub url: String,
}

#[tauri::command]
pub async fn check_app_update(app: AppHandle, state: State<'_, AppState>) -> AppResult<AppUpdateInfo> {
    let current = app.package_info().version.to_string();
    let api_url = state.licensing.api_url();
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| AppError::Other(e.to_string()))?;

    let res = client.get(format!("{api_url}/v1/updates/latest.json")).send().await;
    if let Ok(resp) = res {
        if resp.status().is_success() {
            if let Ok(info) = resp.json::<serde_json::Value>().await {
                let latest = info.get("version").and_then(|v| v.as_str()).unwrap_or(&current).to_string();
                let notes = info.get("notes").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let url = info.get("url").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let update_available = latest != current && !latest.is_empty();
                return Ok(AppUpdateInfo {
                    update_available,
                    latest_version: latest,
                    current_version: current,
                    notes,
                    url,
                });
            }
        }
    }

    Ok(AppUpdateInfo {
        update_available: false,
        latest_version: current.clone(),
        current_version: current,
        notes: "Sweepr is up to date.".into(),
        url: String::new(),
    })
}

#[tauri::command]
pub async fn send_support_report(
    state: State<'_, AppState>,
    email: String,
    subject: String,
    message: String,
) -> AppResult<()> {
    let email = email.trim();
    if email.is_empty() || !email.contains('@') {
        return Err(AppError::Other("Please provide a valid email address".into()));
    }
    let crash_log = std::fs::read_to_string(state.data_dir.join("crash.log")).unwrap_or_default();
    let body = serde_json::json!({
        "email": email,
        "subject": subject.trim(),
        "message": message.trim(),
        "platform": std::env::consts::OS,
        "logs": if crash_log.is_empty() { None } else { Some(crash_log) },
    });
    let api_url = state.licensing.api_url();
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| AppError::Other(e.to_string()))?;

    client
        .post(format!("{api_url}/v1/support"))
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Other(format!("Failed to send report: {e}")))?
        .error_for_status()
        .map_err(|e| AppError::Other(format!("Server returned error: {e}")))?;

    Ok(())
}

#[derive(Serialize)]
pub struct AppInfo {
    pub version: String,
    pub platform: String,
    pub api_url: String,
    pub installer_mode: bool,
}

#[tauri::command]
pub fn app_info(app: AppHandle, state: State<'_, AppState>) -> AppInfo {
    let installer_mode = std::env::args().any(|a| a == "--installer");
    AppInfo {
        version: app.package_info().version.to_string(),
        platform: std::env::consts::OS.to_string(),
        api_url: state.licensing.api_url().to_string(),
        installer_mode,
    }
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}

