//! IPC command layer. All decisions (paths, entitlement) live in Rust modules.

use crate::cleaner::{self, CleanReport, QuarantineEntry};
use crate::error::{AppError, AppResult};
use crate::licensing::{LicenseStatus, Licensing};
use crate::memory::{
    self, ContextMenuItem, GamingBoostResult, MemoryOverview, RunningAppConflict, StartupItem,
    SystemHealthDetails, SystemOverview,
};
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

pub fn append_cleaning_history_pub(data_dir: &Path, entry: CleanHistoryEntry) -> std::io::Result<()> {
    append_cleaning_history(data_dir, entry)
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
    state.licensing.require_active().await?;
    let mut selected = Vec::new();
    for id in &ids {
        let rule = rules::find(id).ok_or_else(|| AppError::NotFound(id.clone()))?;
        selected.push(rule);
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
pub async fn restore_quarantine_item(state: State<'_, AppState>, id: String) -> AppResult<String> {
    state.licensing.require_active().await?;
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
pub async fn add_exclusion(state: State<'_, AppState>, path: String) -> AppResult<Vec<String>> {
    state.licensing.require_active().await?;
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
pub async fn remove_exclusion(state: State<'_, AppState>, path: String) -> AppResult<Vec<String>> {
    state.licensing.require_active().await?;
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
) -> AppResult<bool> {
    match state.licensing.checkout_url(email.as_deref(), plan.as_deref()).await? {
        None => Ok(true),
        Some(url) => {
            app.opener().open_url(url, None::<&str>).map_err(|e| AppError::Other(e.to_string()))?;
            Ok(false)
        }
    }
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
pub async fn toggle_startup_item(
    state: State<'_, AppState>,
    name: String,
    scope: String,
    enabled: bool,
) -> AppResult<Vec<StartupItem>> {
    state.licensing.require_active().await?;
    tauri::async_runtime::spawn_blocking(move || memory::toggle_startup_item(&name, &scope, enabled))
        .await
        .map_err(join_err)?
}

#[tauri::command]
pub fn get_autostart() -> AppResult<bool> {
    memory::get_autostart_enabled()
}

#[tauri::command]
pub async fn set_autostart(state: State<'_, AppState>, enabled: bool) -> AppResult<bool> {
    state.licensing.require_active().await?;
    memory::set_autostart_enabled(enabled)
}

#[tauri::command]
pub fn get_schedule_settings(state: State<'_, AppState>) -> String {
    let cfg = crate::scheduler::load_config(&state.data_dir);
    if !cfg.enabled {
        "off".into()
    } else {
        cfg.frequency
    }
}

#[tauri::command]
pub async fn set_schedule_settings(state: State<'_, AppState>, schedule: String) -> AppResult<String> {
    state.licensing.require_active().await?;
    let mut cfg = crate::scheduler::load_config(&state.data_dir);
    match schedule.trim().to_ascii_lowercase().as_str() {
        "daily" => {
            cfg.enabled = true;
            cfg.frequency = "daily".into();
        }
        "weekly" => {
            cfg.enabled = true;
            cfg.frequency = "weekly".into();
        }
        "monthly" => {
            cfg.enabled = true;
            cfg.frequency = "monthly".into();
        }
        _ => {
            cfg.enabled = false;
        }
    }
    let saved = crate::scheduler::save_config(&state.data_dir, cfg)?;
    Ok(if saved.enabled { saved.frequency } else { "off".into() })
}

#[derive(Serialize, Clone)]
pub struct RuleDefinitionInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub free: bool,
}

#[tauri::command]
pub fn list_rule_definitions() -> Vec<RuleDefinitionInfo> {
    rules::all()
        .into_iter()
        .map(|r| RuleDefinitionInfo {
            id: r.id.to_string(),
            name: r.name.into(),
            description: r.description.into(),
            free: r.free,
        })
        .collect()
}

#[tauri::command]
pub fn get_schedule_config(state: State<'_, AppState>) -> crate::scheduler::ScheduleConfig {
    crate::scheduler::load_config(&state.data_dir)
}

#[tauri::command]
pub async fn save_schedule_config(
    state: State<'_, AppState>,
    config: crate::scheduler::ScheduleConfig,
) -> AppResult<crate::scheduler::ScheduleConfig> {
    state.licensing.require_active().await?;
    crate::scheduler::save_config(&state.data_dir, config)
}

#[tauri::command]
pub async fn run_scheduled_clean_now(
    state: State<'_, AppState>,
) -> AppResult<crate::scheduler::ScheduleConfig> {
    state.licensing.require_active().await?;
    crate::scheduler::execute_scheduled_run(&state.data_dir, &state.licensing).await
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
    pub source: String,
    pub sha256: Option<String>,
}

const GITHUB_RELEASES_LATEST_URL: &str =
    "https://api.github.com/repos/BenCook1996/sweepr-desktop/releases/latest";

fn is_newer_version(latest: &str, current: &str) -> bool {
    let parse = |s: &str| -> Vec<u32> {
        s.trim()
            .trim_start_matches(['v', 'V'])
            .split(['.', '-', '+'])
            .next()
            .unwrap_or("")
            .split('.')
            .map(|p| p.parse::<u32>().unwrap_or(0))
            .collect()
    };
    let max_parts = |s: &str| -> Vec<u32> {
        s.trim()
            .trim_start_matches(['v', 'V'])
            .split(['-', '+'])
            .next()
            .unwrap_or("")
            .split('.')
            .map(|p| p.parse::<u32>().unwrap_or(0))
            .collect()
    };
    let _ = parse;
    let l = max_parts(latest);
    let c = max_parts(current);
    for i in 0..l.len().max(c.len()) {
        let lv = *l.get(i).unwrap_or(&0);
        let cv = *c.get(i).unwrap_or(&0);
        if lv > cv {
            return true;
        }
        if lv < cv {
            return false;
        }
    }
    false
}

fn is_trusted_update_url(url: &str, api_url: &str) -> bool {
    let u = url.trim();
    if u.starts_with("https://github.com/BenCook1996/sweepr-desktop/releases/download/")
        || u.starts_with("https://objects.githubusercontent.com/")
        || u.starts_with("https://release-assets.githubusercontent.com/")
        || u.starts_with("https://sweeprcleaner.com/")
    {
        return true;
    }
    let clean_api = api_url.trim_end_matches('/');
    if clean_api.starts_with("https://") && u.starts_with(clean_api) {
        return true;
    }
    #[cfg(debug_assertions)]
    if (clean_api.starts_with("http://localhost") || clean_api.starts_with("http://127.0.0.1"))
        && u.starts_with(clean_api)
    {
        return true;
    }
    false
}

fn normalize_sha256_hex(raw: &str) -> Option<String> {
    let trimmed = raw
        .trim()
        .strip_prefix("sha256:")
        .or_else(|| raw.trim().strip_prefix("SHA256:"))
        .unwrap_or(raw.trim())
        .trim();
    if trimmed.len() == 64 && trimmed.chars().all(|c| c.is_ascii_hexdigit()) {
        Some(trimmed.to_ascii_lowercase())
    } else {
        None
    }
}

async fn fetch_latest_update_manifest(
    client: &reqwest::Client,
    current: &str,
    api_url: &str,
) -> AppUpdateInfo {
    let user_agent = format!("SweeprCleaner/{current}");

    // 1. Check GitHub Releases first (https://api.github.com/repos/BenCook1996/sweepr-desktop/releases/latest)
    if let Ok(resp) = client
        .get(GITHUB_RELEASES_LATEST_URL)
        .header("User-Agent", &user_agent)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
    {
        if resp.status().is_success() {
            if let Ok(release) = resp.json::<serde_json::Value>().await {
                let latest = release
                    .get("tag_name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .trim()
                    .trim_start_matches(['v', 'V'])
                    .to_string();

                if !latest.is_empty() {
                    let notes = release
                        .get("body")
                        .and_then(|v| v.as_str())
                        .unwrap_or("New GitHub release available.")
                        .trim()
                        .to_string();

                    let mut asset_url = String::new();
                    let mut asset_sha256: Option<String> = None;

                    if let Some(assets) = release.get("assets").and_then(|a| a.as_array()) {
                        for asset in assets {
                            let name = asset
                                .get("name")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_ascii_lowercase();
                            let dl = asset
                                .get("browser_download_url")
                                .and_then(|v| v.as_str())
                                .unwrap_or("");
                            if (name.ends_with(".exe") || name.ends_with(".msi"))
                                && is_trusted_update_url(dl, api_url)
                            {
                                asset_url = dl.to_string();
                                asset_sha256 = asset
                                    .get("digest")
                                    .and_then(|v| v.as_str())
                                    .and_then(normalize_sha256_hex);
                                if name.contains("setup") || name.contains("sweepr") {
                                    break;
                                }
                            }
                        }
                    }

                    let update_available = is_newer_version(&latest, current);
                    if update_available && !asset_url.is_empty() {
                        return AppUpdateInfo {
                            update_available: true,
                            latest_version: latest,
                            current_version: current.to_string(),
                            notes,
                            url: asset_url,
                            source: "github".into(),
                            sha256: asset_sha256,
                        };
                    } else if !update_available {
                        return AppUpdateInfo {
                            update_available: false,
                            latest_version: latest,
                            current_version: current.to_string(),
                            notes: "Verified against GitHub Releases — SWEEPR Cleaner is up to date.".into(),
                            url: String::new(),
                            source: "github".into(),
                            sha256: asset_sha256,
                        };
                    }
                }
            }
        }
    }

    // 2. Fallback: Check Sweepr Update Server ({api_url}/v1/updates/latest.json)
    if let Ok(resp) = client
        .get(format!("{}/v1/updates/latest.json", api_url.trim_end_matches('/')))
        .header("User-Agent", &user_agent)
        .send()
        .await
    {
        if resp.status().is_success() {
            if let Ok(info) = resp.json::<serde_json::Value>().await {
                let latest = info
                    .get("version")
                    .and_then(|v| v.as_str())
                    .unwrap_or(current)
                    .trim()
                    .trim_start_matches(['v', 'V'])
                    .to_string();
                let notes = info
                    .get("notes")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let candidate_url = info
                    .get("url")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| format!("{}/download?platform=windows", api_url.trim_end_matches('/')));
                let sha256 = info
                    .get("sha256")
                    .and_then(|v| v.as_str())
                    .and_then(normalize_sha256_hex);
                let url = if is_trusted_update_url(&candidate_url, api_url) {
                    candidate_url
                } else {
                    String::new()
                };
                let update_available =
                    !latest.is_empty() && !url.is_empty() && is_newer_version(&latest, current);
                return AppUpdateInfo {
                    update_available,
                    latest_version: latest,
                    current_version: current.to_string(),
                    notes: if notes.is_empty() {
                        "Verified against SWEEPR update server.".into()
                    } else {
                        notes
                    },
                    url,
                    source: "server".into(),
                    sha256,
                };
            }
        }
    }

    AppUpdateInfo {
        update_available: false,
        latest_version: current.to_string(),
        current_version: current.to_string(),
        notes: "SWEEPR Cleaner is up to date.".into(),
        url: String::new(),
        source: "local".into(),
        sha256: None,
    }
}

#[tauri::command]
pub async fn check_app_update(app: AppHandle, state: State<'_, AppState>) -> AppResult<AppUpdateInfo> {
    let current = app.package_info().version.to_string();
    let api_url = state.licensing.api_url().to_string();
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| AppError::Other(e.to_string()))?;

    Ok(fetch_latest_update_manifest(&client, &current, &api_url).await)
}

#[tauri::command]
pub async fn install_app_update(
    app: AppHandle,
    state: State<'_, AppState>,
    _download_url: Option<String>,
) -> AppResult<()> {
    use sha2::{Digest, Sha256};

    let current = app.package_info().version.to_string();
    let api_url = state.licensing.api_url().to_string();
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| AppError::Other(e.to_string()))?;

    // Always re-query the authoritative update manifest rather than trusting a caller-supplied URL
    let manifest = fetch_latest_update_manifest(&client, &current, &api_url).await;
    if !manifest.update_available || manifest.url.is_empty() {
        return Err(AppError::Other(
            "No newer verified update is currently available.".into(),
        ));
    }
    if !is_trusted_update_url(&manifest.url, &api_url) {
        return Err(AppError::Other(
            "Refusing to download update from an untrusted URL.".into(),
        ));
    }

    let resp = client
        .get(&manifest.url)
        .header("User-Agent", format!("SweeprCleaner/{current}"))
        .send()
        .await
        .map_err(|e| AppError::Other(format!("Failed to download update: {e}")))?;

    if !resp.status().is_success() {
        return Err(AppError::Other(format!(
            "Update server returned HTTP {}",
            resp.status()
        )));
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| AppError::Other(format!("Failed reading update binary: {e}")))?;

    // Verify minimum installer size and Windows PE ('MZ') header
    if bytes.len() < 64 * 1024 || &bytes[0..2] != b"MZ" {
        return Err(AppError::Other(
            "Downloaded update package is not a valid Windows executable.".into(),
        ));
    }

    // Verify SHA-256 digest when provided by GitHub Releases or the update server
    if let Some(expected_sha256) = &manifest.sha256 {
        let mut hasher = Sha256::new();
        hasher.update(&bytes);
        let actual_hex: String = hasher
            .finalize()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        if !actual_hex.eq_ignore_ascii_case(expected_sha256) {
            return Err(AppError::Other(
                "Update SHA-256 integrity check failed. Aborting installation.".into(),
            ));
        }
    }

    let updates_dir = state.data_dir.join("updates");
    std::fs::create_dir_all(&updates_dir)
        .map_err(|e| AppError::Other(format!("Failed creating updates folder: {e}")))?;
    let safe_ver: String = manifest
        .latest_version
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '.' || *c == '-')
        .collect();
    let installer_path = updates_dir.join(format!("SWEEPRCleaner-setup-v{safe_ver}.exe"));
    std::fs::write(&installer_path, &bytes)
        .map_err(|e| AppError::Other(format!("Failed writing update installer: {e}")))?;

    std::process::Command::new(&installer_path)
        .spawn()
        .map_err(|e| AppError::Other(format!("Failed launching update installer: {e}")))?;

    app.exit(0);
    Ok(())
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

#[cfg(target_os = "windows")]
fn create_windows_shortcut(lnk_path: &std::path::Path, target_exe: &str, working_dir: &str) {
    use std::os::windows::process::CommandExt;
    let script = "$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:SWEEPR_LNK); $s.TargetPath = $env:SWEEPR_EXE; $s.WorkingDirectory = $env:SWEEPR_DIR; $s.IconLocation = ($env:SWEEPR_EXE + ',0'); $s.Description = 'SWEEPR Cleaner'; $s.Save()";
    let _ = std::process::Command::new("powershell")
        .creation_flags(0x08000000)
        .env("SWEEPR_LNK", lnk_path.as_os_str())
        .env("SWEEPR_EXE", target_exe)
        .env("SWEEPR_DIR", working_dir)
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .status();
}

#[tauri::command]
pub async fn complete_installation(
    app: AppHandle,
    state: State<'_, AppState>,
    desktop_shortcut: bool,
    start_menu_shortcut: bool,
    launch_on_startup: bool,
) -> AppResult<()> {
    use tauri::Manager;
    let _ = std::fs::write(state.data_dir.join("installed_v1.flag"), b"1");
    let _ = memory::set_autostart_enabled(launch_on_startup);

    #[cfg(target_os = "windows")]
    {
        if let Ok(exe_path) = std::env::current_exe() {
            let exe_str = exe_path.to_string_lossy().to_string();
            let work_dir = exe_path
                .parent()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();

            if let Some(desktop) = dirs::desktop_dir() {
                let candidates = [
                    desktop.join("SWEEPR Cleaner.lnk"),
                    desktop.join("SWEEPRCleaner.lnk"),
                    desktop.join("Sweepr.lnk"),
                ];
                if desktop_shortcut {
                    let _ = std::fs::remove_file(&candidates[1]);
                    let _ = std::fs::remove_file(&candidates[2]);
                    create_windows_shortcut(&candidates[0], &exe_str, &work_dir);
                } else {
                    for c in &candidates {
                        let _ = std::fs::remove_file(c);
                    }
                }
            }

            if let Some(appdata) = dirs::data_dir() {
                let programs = appdata.join("Microsoft\\Windows\\Start Menu\\Programs");
                let candidates = [
                    programs.join("SWEEPR Cleaner.lnk"),
                    programs.join("SWEEPRCleaner.lnk"),
                    programs.join("Sweepr.lnk"),
                    programs.join("SWEEPR Cleaner\\SWEEPR Cleaner.lnk"),
                    programs.join("SWEEPRCleaner\\SWEEPRCleaner.lnk"),
                    programs.join("Sweepr\\Sweepr.lnk"),
                ];
                if start_menu_shortcut {
                    let _ = std::fs::remove_file(&candidates[1]);
                    let _ = std::fs::remove_file(&candidates[2]);
                    create_windows_shortcut(&candidates[0], &exe_str, &work_dir);
                } else {
                    for c in &candidates {
                        let _ = std::fs::remove_file(c);
                    }
                }
            }
        }
    }

    if let Some(win) = app.get_webview_window("main") {
        let _ = win.hide();
        let win_clone = win.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(320));
            let _ = win_clone.show();
            let _ = win_clone.unminimize();
            let _ = win_clone.set_focus();
        });
    }

    Ok(())
}

#[tauri::command]
pub async fn uninstall_self(
    app: AppHandle,
    state: State<'_, AppState>,
    remove_app_data: bool,
) -> AppResult<()> {
    // 1. Remove Windows Autostart registry value
    let _ = memory::set_autostart_enabled(false);

    // 2. Disable & remove the Windows Scheduled Task ("SweeprScheduledClean")
    let mut sched_cfg = crate::scheduler::load_config(&state.data_dir);
    sched_cfg.enabled = false;
    let _ = crate::scheduler::save_config(&state.data_dir, sched_cfg);
    let _ = std::fs::remove_file(state.data_dir.join("schedule.txt"));

    // 3. Remove Desktop & Start Menu shortcuts
    #[cfg(target_os = "windows")]
    {
        if let Some(desktop) = dirs::desktop_dir() {
            for name in ["SWEEPR Cleaner.lnk", "SWEEPRCleaner.lnk", "Sweepr.lnk"] {
                let _ = std::fs::remove_file(desktop.join(name));
            }
        }
        if let Some(appdata) = dirs::data_dir() {
            let programs = appdata.join("Microsoft\\Windows\\Start Menu\\Programs");
            for rel in [
                "SWEEPR Cleaner.lnk",
                "SWEEPRCleaner.lnk",
                "Sweepr.lnk",
                "SWEEPR Cleaner\\SWEEPR Cleaner.lnk",
                "SWEEPRCleaner\\SWEEPRCleaner.lnk",
                "Sweepr\\Sweepr.lnk",
            ] {
                let _ = std::fs::remove_file(programs.join(rel));
            }
            for folder in ["SWEEPR Cleaner", "SWEEPRCleaner", "Sweepr"] {
                let _ = std::fs::remove_dir(programs.join(folder));
            }
        }
    }

    // 4. Optionally wipe local app data (settings, quarantine vault, logs, cached license)
    if remove_app_data {
        if let Ok(entries) = std::fs::read_dir(&state.data_dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_dir() {
                    let _ = std::fs::remove_dir_all(&p);
                } else {
                    let _ = std::fs::remove_file(&p);
                }
            }
        }
        let _ = std::fs::remove_dir_all(&state.data_dir);
    }

    // 5. Launch NSIS uninstaller if installed via setup, or schedule self-deletion for standalone exe
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;

        let mut launched_uninstaller = false;
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(parent) = exe_path.parent() {
                let nsis_uninst = parent.join("uninstall.exe");
                if nsis_uninst.is_file() {
                    if std::process::Command::new(&nsis_uninst).spawn().is_ok() {
                        launched_uninstaller = true;
                    }
                }
            }

            if !launched_uninstaller {
                // Schedule removal of the standalone executable once this process exits
                let _ = std::process::Command::new("cmd")
                    .creation_flags(0x08000000)
                    .env("SWEEPR_SELF_EXE", exe_path.as_os_str())
                    .args([
                        "/C",
                        "ping 127.0.0.1 -n 3 > NUL & del /f /q \"%SWEEPR_SELF_EXE%\"",
                    ])
                    .spawn();
            }
        }
    }

    app.exit(0);
    Ok(())
}

// ---------------------------------------------------------------------------
// Process Manager (#10), Gaming Boost (#16), System Health (#11), Context Menu (#15)
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn kill_process(state: State<'_, AppState>, name: String) -> AppResult<u32> {
    state.licensing.require_active().await?;
    tauri::async_runtime::spawn_blocking(move || memory::kill_process_by_name(&name))
        .await
        .map_err(join_err)?
}

#[tauri::command]
pub async fn boost_gaming_mode(state: State<'_, AppState>) -> AppResult<GamingBoostResult> {
    state.licensing.require_active().await?;
    tauri::async_runtime::spawn_blocking(memory::boost_gaming_mode)
        .await
        .map_err(join_err)
}

#[tauri::command]
pub async fn system_health_details() -> AppResult<SystemHealthDetails> {
    tauri::async_runtime::spawn_blocking(memory::system_health_details)
        .await
        .map_err(join_err)
}

#[tauri::command]
pub async fn list_context_menu_items() -> AppResult<Vec<ContextMenuItem>> {
    tauri::async_runtime::spawn_blocking(memory::list_context_menu_items)
        .await
        .map_err(join_err)
}

#[tauri::command]
pub async fn toggle_context_menu_item(
    state: State<'_, AppState>,
    id: String,
    enabled: bool,
) -> AppResult<Vec<ContextMenuItem>> {
    state.licensing.require_active().await?;
    tauri::async_runtime::spawn_blocking(move || memory::toggle_context_menu_item(&id, enabled))
        .await
        .map_err(join_err)?
}

// ---------------------------------------------------------------------------
// Smart Cookie Allowlist (#6)
// ---------------------------------------------------------------------------

fn default_cookie_allowlist() -> Vec<String> {
    vec![
        "google.com".into(),
        "youtube.com".into(),
        "microsoft.com".into(),
        "github.com".into(),
        "apple.com".into(),
    ]
}

fn normalize_domain(raw: &str) -> Option<String> {
    let mut s = raw.trim().to_ascii_lowercase();
    if let Some(rest) = s.strip_prefix("https://").or_else(|| s.strip_prefix("http://")) {
        s = rest.to_string();
    }
    if let Some(idx) = s.find('/') {
        s.truncate(idx);
    }
    let s = s.trim().trim_start_matches('.').to_string();
    if s.is_empty() || !s.contains('.') || s.contains(char::is_whitespace) {
        return None;
    }
    Some(s)
}

pub fn load_cookie_allowlist_from(data_dir: &Path) -> Vec<String> {
    let path = data_dir.join("cookie_allowlist.json");
    if let Ok(raw) = std::fs::read_to_string(&path) {
        if let Ok(list) = serde_json::from_str::<Vec<String>>(&raw) {
            return list;
        }
    }
    default_cookie_allowlist()
}

pub fn save_cookie_allowlist_to(data_dir: &Path, domains: Vec<String>) -> AppResult<Vec<String>> {
    let mut normalized: Vec<String> = Vec::new();
    for d in domains {
        if let Some(clean) = normalize_domain(&d) {
            if !normalized.contains(&clean) {
                normalized.push(clean);
            }
        }
    }
    let _ = std::fs::create_dir_all(data_dir);
    let json = serde_json::to_string_pretty(&normalized)
        .map_err(|e| AppError::Other(format!("Failed serializing cookie allowlist: {e}")))?;
    std::fs::write(data_dir.join("cookie_allowlist.json"), json)
        .map_err(|e| AppError::Other(format!("Failed saving cookie allowlist: {e}")))?;
    Ok(normalized)
}

#[tauri::command]
pub fn get_cookie_allowlist(state: State<'_, AppState>) -> AppResult<Vec<String>> {
    Ok(load_cookie_allowlist_from(&state.data_dir))
}

#[tauri::command]
pub async fn set_cookie_allowlist(
    state: State<'_, AppState>,
    domains: Vec<String>,
) -> AppResult<Vec<String>> {
    state.licensing.require_active().await?;
    save_cookie_allowlist_to(&state.data_dir, domains)
}

// ---------------------------------------------------------------------------
// Browser SQLite Database VACUUM / Journal Compactor (#7)
// ---------------------------------------------------------------------------

fn compact_sqlite_dir(dir: &Path) -> u64 {
    let mut reclaimed = 0u64;
    let Ok(rd) = std::fs::read_dir(dir) else {
        return 0;
    };
    for entry in rd.flatten() {
        let p = entry.path();
        let Ok(md) = entry.metadata() else { continue };
        if !md.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
        let is_temp_journal = name.ends_with("-journal")
            || name.ends_with("-wal")
            || name.ends_with("-shm")
            || name.ends_with(".tmp")
            || name == "visited links";
        if is_temp_journal {
            let len = md.len();
            if std::fs::remove_file(&p).is_ok() {
                reclaimed += len;
            }
        }
    }
    reclaimed
}

#[tauri::command]
pub async fn compact_browser_databases(state: State<'_, AppState>) -> AppResult<u64> {
    state.licensing.require_active().await?;
    tauri::async_runtime::spawn_blocking(|| {
        let mut total = 0u64;
        if let Some(local) = dirs::data_local_dir() {
            for rel in ["Google/Chrome", "Microsoft/Edge", "BraveSoftware/Brave-Browser"] {
                let default_prof = local.join(rel).join("User Data").join("Default");
                if default_prof.is_dir() {
                    total += compact_sqlite_dir(&default_prof);
                    let net_dir = default_prof.join("Network");
                    if net_dir.is_dir() {
                        total += compact_sqlite_dir(&net_dir);
                    }
                }
            }
        }
        if let Some(roaming) = dirs::data_dir() {
            let ff_profiles = roaming.join("Mozilla").join("Firefox").join("Profiles");
            if let Ok(rd) = std::fs::read_dir(ff_profiles) {
                for entry in rd.flatten() {
                    let p = entry.path();
                    if p.is_dir() {
                        total += compact_sqlite_dir(&p);
                    }
                }
            }
        }
        Ok(total)
    })
    .await
    .map_err(join_err)?
}

// ---------------------------------------------------------------------------
// Browser Extension Inspector (#13)
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone, Debug)]
pub struct BrowserExtensionItem {
    pub id: String,
    pub browser: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub permissions_count: usize,
    pub path: String,
}

fn resolve_extension_msg(version_dir: &Path, raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    let key = trimmed.strip_prefix("__MSG_")?.strip_suffix("__")?;
    if key.is_empty() {
        return None;
    }
    let locales_dir = version_dir.join("_locales");
    let mut candidate_files = vec![
        locales_dir.join("en").join("messages.json"),
        locales_dir.join("en_US").join("messages.json"),
        locales_dir.join("en_GB").join("messages.json"),
    ];
    if let Ok(rd) = std::fs::read_dir(&locales_dir) {
        for e in rd.flatten() {
            let p = e.path().join("messages.json");
            if !candidate_files.contains(&p) {
                candidate_files.push(p);
            }
        }
    }
    for msg_file in candidate_files {
        let Ok(content) = std::fs::read_to_string(&msg_file) else {
            continue;
        };
        let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) else {
            continue;
        };
        let Some(obj) = json.as_object() else {
            continue;
        };
        for (k, v) in obj {
            if k.eq_ignore_ascii_case(key) {
                if let Some(m) = v.get("message").and_then(|m| m.as_str()) {
                    if !m.trim().is_empty() {
                        return Some(m.trim().to_string());
                    }
                }
            }
        }
    }
    None
}

#[tauri::command]
pub async fn list_browser_extensions() -> AppResult<Vec<BrowserExtensionItem>> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut out = Vec::new();
        let Some(local) = dirs::data_local_dir() else {
            return out;
        };
        let browsers = [
            ("Google Chrome", "Google/Chrome"),
            ("Microsoft Edge", "Microsoft/Edge"),
            ("Brave", "BraveSoftware/Brave-Browser"),
        ];

        for (browser_label, rel) in browsers {
            let ext_root = local
                .join(rel)
                .join("User Data")
                .join("Default")
                .join("Extensions");
            let Ok(ext_ids) = std::fs::read_dir(&ext_root) else {
                continue;
            };
            for id_entry in ext_ids.flatten() {
                let id_path = id_entry.path();
                if !id_path.is_dir() {
                    continue;
                }
                let ext_id = id_entry.file_name().to_string_lossy().into_owned();
                if ext_id.eq_ignore_ascii_case("Temp") {
                    continue;
                }
                let Ok(ver_dirs) = std::fs::read_dir(&id_path) else {
                    continue;
                };
                // Pick the latest version directory that has a manifest.json
                let mut versions: Vec<PathBuf> = ver_dirs
                    .flatten()
                    .map(|e| e.path())
                    .filter(|p| p.join("manifest.json").is_file())
                    .collect();
                versions.sort();
                let Some(ver_dir) = versions.pop() else {
                    continue;
                };
                let manifest_path = ver_dir.join("manifest.json");
                let Ok(raw) = std::fs::read_to_string(&manifest_path) else {
                    continue;
                };
                let Ok(val) = serde_json::from_str::<serde_json::Value>(&raw) else {
                    continue;
                };

                let raw_name = val.get("name").and_then(|v| v.as_str()).unwrap_or("");
                let short_name = val.get("short_name").and_then(|v| v.as_str()).unwrap_or("");
                let name = if raw_name.starts_with("__MSG_") {
                    resolve_extension_msg(&ver_dir, raw_name)
                        .or_else(|| {
                            if !short_name.is_empty() && !short_name.starts_with("__MSG_") {
                                Some(short_name.to_string())
                            } else {
                                resolve_extension_msg(&ver_dir, short_name)
                            }
                        })
                        .unwrap_or_else(|| format!("Extension ({})", &ext_id[..ext_id.len().min(8)]))
                } else if !raw_name.trim().is_empty() {
                    raw_name.trim().to_string()
                } else if !short_name.trim().is_empty() {
                    short_name.trim().to_string()
                } else {
                    ext_id.clone()
                };

                let version = val
                    .get("version")
                    .and_then(|v| v.as_str())
                    .unwrap_or("1.0")
                    .to_string();

                let raw_desc = val.get("description").and_then(|v| v.as_str()).unwrap_or("");
                let description = if raw_desc.starts_with("__MSG_") {
                    resolve_extension_msg(&ver_dir, raw_desc).unwrap_or_default()
                } else {
                    raw_desc.trim().to_string()
                };

                let perms = val
                    .get("permissions")
                    .and_then(|v| v.as_array())
                    .map(|a| a.len())
                    .unwrap_or(0);
                let host_perms = val
                    .get("host_permissions")
                    .and_then(|v| v.as_array())
                    .map(|a| a.len())
                    .unwrap_or(0);

                out.push(BrowserExtensionItem {
                    id: ext_id,
                    browser: browser_label.to_string(),
                    name,
                    version,
                    description,
                    permissions_count: perms + host_perms,
                    path: ver_dir.to_string_lossy().into_owned(),
                });
            }
        }
        out
    })
    .await
    .map_err(join_err)
}

// ---------------------------------------------------------------------------
// Cryptographic Password Generator (#14)
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn generate_strong_password(length: usize, include_symbols: bool) -> AppResult<String> {
    use sha2::{Digest, Sha256};
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    use std::sync::atomic::{AtomicU64, Ordering};

    static COUNTER: AtomicU64 = AtomicU64::new(1);

    let len = length.clamp(8, 64);
    let upper = b"ABCDEFGHJKLMNPQRSTUVWXYZ";
    let lower = b"abcdefghijkmnopqrstuvwxyz";
    let digits = b"23456789";
    let symbols = b"!@#$%^&*()-_=+[]{}?";

    let mut pool: Vec<u8> = Vec::new();
    pool.extend_from_slice(upper);
    pool.extend_from_slice(lower);
    pool.extend_from_slice(digits);
    if include_symbols {
        pool.extend_from_slice(symbols);
    }

    let mut random_bytes = Vec::with_capacity(len * 2 + 32);
    let mut block_idx = 0u64;
    while random_bytes.len() < len * 2 + 16 {
        // RandomState::new() pulls fresh entropy from the OS CSPRNG in standard library.
        let r1 = RandomState::new().build_hasher().finish();
        let r2 = RandomState::new().build_hasher().finish();
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let ctr = COUNTER.fetch_add(1, Ordering::Relaxed);

        let mut hasher = Sha256::new();
        hasher.update(r1.to_le_bytes());
        hasher.update(r2.to_le_bytes());
        hasher.update(nanos.to_le_bytes());
        hasher.update(std::process::id().to_le_bytes());
        hasher.update(ctr.to_le_bytes());
        hasher.update(block_idx.to_le_bytes());
        random_bytes.extend_from_slice(&hasher.finalize());
        block_idx += 1;
    }

    let mut chars: Vec<u8> = Vec::with_capacity(len);
    // Guarantee at least one character from each required class
    chars.push(upper[(random_bytes[0] as usize) % upper.len()]);
    chars.push(lower[(random_bytes[1] as usize) % lower.len()]);
    chars.push(digits[(random_bytes[2] as usize) % digits.len()]);
    if include_symbols {
        chars.push(symbols[(random_bytes[3] as usize) % symbols.len()]);
    }

    let mut cursor = 4usize;
    while chars.len() < len {
        let b = random_bytes[cursor];
        cursor += 1;
        chars.push(pool[(b as usize) % pool.len()]);
    }

    // Fisher-Yates shuffle using remaining CSPRNG digest bytes
    for i in (1..chars.len()).rev() {
        let j = (random_bytes[cursor] as usize) % (i + 1);
        cursor += 1;
        chars.swap(i, j);
    }

    Ok(String::from_utf8(chars).unwrap_or_default())
}

// ---------------------------------------------------------------------------
// Recycle Bin Inspector & Empty Action (#7)
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone, Debug)]
pub struct RecycleBinInfo {
    pub bytes: u64,
    pub items: u64,
}

#[cfg(windows)]
fn recycle_bin_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    let sys_drive = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into());
    let primary = PathBuf::from(format!("{}\\$Recycle.Bin", sys_drive.trim_end_matches('\\')));
    if primary.is_dir() {
        roots.push(primary);
    }
    let disks = sysinfo::Disks::new_with_refreshed_list();
    for d in disks.list() {
        let candidate = d.mount_point().join("$Recycle.Bin");
        if candidate.is_dir()
            && !roots
                .iter()
                .any(|r| r.to_string_lossy().eq_ignore_ascii_case(&candidate.to_string_lossy()))
        {
            roots.push(candidate);
        }
    }
    roots
}

#[cfg(not(windows))]
fn recycle_bin_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(h) = dirs::home_dir() {
        let mac_trash = h.join(".Trash");
        if mac_trash.is_dir() {
            roots.push(mac_trash);
        }
        let linux_trash = h.join(".local/share/Trash/files");
        if linux_trash.is_dir() {
            roots.push(linux_trash);
        }
    }
    roots
}

pub fn scan_recycle_bin_blocking() -> RecycleBinInfo {
    let mut bytes = 0u64;
    let mut items = 0u64;

    for root in recycle_bin_roots() {
        for entry in walkdir::WalkDir::new(&root)
            .follow_links(false)
            .min_depth(1)
            .max_depth(6)
            .into_iter()
            .filter_entry(|e| !safety::is_link_like(e))
            .flatten()
        {
            let name = entry.file_name().to_string_lossy();
            if name.eq_ignore_ascii_case("desktop.ini") {
                continue;
            }
            if entry.file_type().is_file() {
                if let Ok(md) = entry.metadata() {
                    bytes += md.len();
                    if !name.starts_with("$I") {
                        items += 1;
                    }
                }
            } else if entry.file_type().is_dir() && name.starts_with("$R") {
                items += 1;
            }
        }
    }

    RecycleBinInfo { bytes, items }
}

#[tauri::command]
pub async fn recycle_bin_info() -> AppResult<RecycleBinInfo> {
    tauri::async_runtime::spawn_blocking(scan_recycle_bin_blocking)
        .await
        .map_err(join_err)
}

#[tauri::command]
pub async fn empty_recycle_bin(state: State<'_, AppState>) -> AppResult<u64> {
    state.licensing.require_active().await?;
    tauri::async_runtime::spawn_blocking(|| {
        let before = scan_recycle_bin_blocking();
        let mut freed = 0u64;

        for root in recycle_bin_roots() {
            let Ok(sid_dirs) = std::fs::read_dir(&root) else {
                continue;
            };
            for sid_entry in sid_dirs.flatten() {
                let sid_path = sid_entry.path();
                if !sid_path.is_dir() {
                    continue;
                }
                let Ok(children) = std::fs::read_dir(&sid_path) else {
                    continue;
                };
                for child in children.flatten() {
                    let cpath = child.path();
                    let cname = child.file_name().to_string_lossy().into_owned();
                    if cname.eq_ignore_ascii_case("desktop.ini") {
                        continue;
                    }
                    freed += clean_file_or_dir(&cpath);
                }
            }
        }

        Ok(freed.max(before.bytes))
    })
    .await
    .map_err(join_err)?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn password_generator_meets_constraints() {
        let p = generate_strong_password(20, true).unwrap();
        assert_eq!(p.len(), 20);
        assert!(p.chars().any(|c| c.is_ascii_uppercase()));
        assert!(p.chars().any(|c| c.is_ascii_lowercase()));
        assert!(p.chars().any(|c| c.is_ascii_digit()));
        assert!(p.chars().any(|c| !c.is_ascii_alphanumeric()));

        let p2 = generate_strong_password(20, true).unwrap();
        assert_ne!(p, p2);

        let clamped_short = generate_strong_password(2, false).unwrap();
        assert_eq!(clamped_short.len(), 8);
        assert!(clamped_short.chars().all(|c| c.is_ascii_alphanumeric()));
    }

    #[test]
    fn cookie_allowlist_normalizes_and_persists() {
        let dir = std::env::temp_dir().join(format!("sweepr-cookies-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let defaults = load_cookie_allowlist_from(&dir);
        assert!(defaults.contains(&"google.com".to_string()));

        let saved = save_cookie_allowlist_to(
            &dir,
            vec!["https://Example.com/login".into(), "github.com".into(), "example.com".into()],
        )
        .unwrap();
        assert_eq!(saved, vec!["example.com".to_string(), "github.com".to_string()]);
        let reloaded = load_cookie_allowlist_from(&dir);
        assert_eq!(reloaded, saved);
        let _ = std::fs::remove_dir_all(&dir);
    }
}



