//! Thin IPC layer. All decisions (paths, entitlement) live in Rust modules.

use crate::cleaner::{self, CleanReport};
use crate::error::{AppError, AppResult};
use crate::licensing::{LicenseStatus, Licensing};
use crate::memory::{self, MemoryOverview, StartupItem};
use crate::rules;
use crate::scanner::{self, ScanReport};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_opener::OpenerExt;

pub struct AppState {
    pub licensing: Licensing,
}

fn join_err(e: impl std::fmt::Display) -> AppError {
    AppError::Other(format!("background task failed: {e}"))
}

#[tauri::command]
pub async fn scan_start(app: AppHandle) -> AppResult<ScanReport> {
    tauri::async_runtime::spawn_blocking(move || {
        let rules = rules::all();
        scanner::scan_all(&rules, |p| {
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
    // Entitlement is enforced here, in Rust, never in the UI.
    if selected.iter().any(|r| !r.free) {
        state.licensing.require_active().await?;
    }
    tauri::async_runtime::spawn_blocking(move || {
        selected.iter().map(|r| cleaner::clean(r, use_trash)).collect()
    })
    .await
    .map_err(join_err)
}

#[tauri::command]
pub async fn license_status(state: State<'_, AppState>, force: bool) -> AppResult<LicenseStatus> {
    state.licensing.status(force).await
}

#[tauri::command]
pub async fn start_checkout(app: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    let url = state.licensing.checkout_url().await?;
    app.opener().open_url(url, None::<&str>).map_err(|e| AppError::Other(e.to_string()))
}

#[tauri::command]
pub async fn open_billing_portal(app: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    let url = state.licensing.portal_url().await?;
    app.opener().open_url(url, None::<&str>).map_err(|e| AppError::Other(e.to_string()))
}

#[tauri::command]
pub async fn memory_overview() -> AppResult<MemoryOverview> {
    tauri::async_runtime::spawn_blocking(memory::overview).await.map_err(join_err)
}

#[tauri::command]
pub async fn startup_items() -> AppResult<Vec<StartupItem>> {
    tauri::async_runtime::spawn_blocking(memory::startup_items).await.map_err(join_err)
}

#[derive(Serialize)]
pub struct AppInfo {
    pub version: String,
    pub platform: String,
    pub api_url: String,
}

#[tauri::command]
pub fn app_info(app: AppHandle, state: State<'_, AppState>) -> AppInfo {
    AppInfo {
        version: app.package_info().version.to_string(),
        platform: std::env::consts::OS.to_string(),
        api_url: state.licensing.api_url().to_string(),
    }
}
