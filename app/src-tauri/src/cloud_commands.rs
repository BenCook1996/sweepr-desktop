//! Tauri commands for CloudClean (diagnostic + cleanup), the Photo & Document
//! Vault, and Cloud Backup Sync.
//!
//! Pricing gates:
//! - Diagnostic scan: free (the "value before ask" hook).
//! - Delete / offload: SWEEPR Pro.
//! - Vault + Backup Sync: the Cloud Protection bundle (`cloud_vault` add-on).

use crate::cloud::{self, CloudActionReport, CloudRoot, CloudScanReport};
use crate::cloud_sync::{self, SyncPair, SyncRunReport};
use crate::commands::AppState;
use crate::error::{AppError, AppResult};
use crate::shredder;
use crate::vault::{self, VaultEntry, VaultReport};
use std::path::{Path, PathBuf};
use tauri::State;

pub const CLOUD_BUNDLE_ADDON: &str = "cloud_vault";

async fn require_cloud_bundle(state: &AppState) -> AppResult<()> {
    state.licensing.require_addon(CLOUD_BUNDLE_ADDON).await
}

fn join_err(e: impl std::fmt::Display) -> AppError {
    AppError::Other(format!("background task failed: {e}"))
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> AppResult<T> + Send + 'static) -> AppResult<T> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(join_err)?
}

// --- CloudClean --------------------------------------------------------------

#[tauri::command]
pub async fn cloud_detect_roots() -> AppResult<Vec<CloudRoot>> {
    blocking(|| Ok(cloud::detect_cloud_roots())).await
}

/// Free diagnostic. `extra_roots` lets users add a sync folder we did not detect.
#[tauri::command]
pub async fn cloud_scan(state: State<'_, AppState>, extra_roots: Option<Vec<ExtraRoot>>) -> AppResult<CloudScanReport> {
    let data_dir = state.data_dir.clone();
    blocking(move || {
        let mut roots = cloud::detect_cloud_roots();
        for extra in extra_roots.unwrap_or_default() {
            let p = PathBuf::from(extra.path.trim());
            if p.is_absolute() && p.is_dir() && !roots.iter().any(|r| Path::new(&r.path) == p) {
                if let Some(provider) = cloud::provider_from_id(&extra.provider_id) {
                    roots.push(CloudRoot {
                        provider,
                        provider_id: provider.id().into(),
                        label: provider.label().into(),
                        path: p.to_string_lossy().into(),
                        streamed: false,
                    });
                }
            }
        }
        let exclusions = crate::safety::load_exclusions(&data_dir);
        Ok(cloud::scan_cloud(roots, &exclusions))
    })
    .await
}

#[derive(serde::Deserialize)]
pub struct ExtraRoot {
    pub provider_id: String,
    pub path: String,
}

#[tauri::command]
pub async fn cloud_delete_files(state: State<'_, AppState>, paths: Vec<String>) -> AppResult<CloudActionReport> {
    state.licensing.require_active().await?;
    blocking(move || Ok(cloud::delete_cloud_files(&paths))).await
}

#[tauri::command]
pub async fn cloud_offload_files(state: State<'_, AppState>, paths: Vec<String>, target_dir: String) -> AppResult<CloudActionReport> {
    state.licensing.require_active().await?;
    blocking(move || cloud::offload_cloud_files(&paths, &target_dir)).await
}

// --- Vault ---------------------------------------------------------------------

fn remove_plaintext(src: &Path, data_dir: &Path) -> bool {
    let Ok(canon) = shredder::validate_target(&src.to_string_lossy(), data_dir) else {
        return false;
    };
    if shredder::overwrite_and_delete(&canon, 1).is_ok() {
        return true;
    }
    std::fs::remove_file(&canon).is_ok()
}

fn is_default_vault_dir(p: &Path) -> bool {
    for base in [dirs::document_dir(), dirs::home_dir()].into_iter().flatten() {
        let default_vault = base.join("Sweepr Vault");
        if crate::safety::is_within(p, &default_vault) {
            return true;
        }
    }
    false
}

fn is_disallowed_vault_path(p: &Path, data_dir: &Path) -> bool {
    if is_default_vault_dir(p) {
        return false;
    }
    crate::duplicates::is_protected_system_path(p)
        || p.starts_with(data_dir)
        || crate::safety::is_within(p, data_dir)
}

fn resolve_vault_dir(dest_dir: Option<&str>, data_dir: &Path) -> PathBuf {
    if let Some(d) = dest_dir.map(str::trim).filter(|s| !s.is_empty()) {
        let p = PathBuf::from(d);
        if p.is_absolute() && !is_disallowed_vault_path(&p, data_dir) {
            let _ = std::fs::create_dir_all(&p);
            if p.is_dir() && !is_disallowed_vault_path(&p, data_dir) {
                return p;
            }
        }
    }
    if let Some(root) = cloud::detect_cloud_roots().into_iter().next() {
        let dir = PathBuf::from(root.path).join("SWEEPR Private Vault");
        if !is_disallowed_vault_path(&dir, data_dir) {
            let _ = std::fs::create_dir_all(&dir);
            if dir.is_dir() {
                return dir;
            }
        }
    }
    let fallback = dirs::document_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(std::env::temp_dir)
        .join("Sweepr Vault");
    let _ = std::fs::create_dir_all(&fallback);
    fallback
}

#[tauri::command]
pub async fn vault_encrypt(
    state: State<'_, AppState>,
    paths: Vec<String>,
    password: String,
    dest_dir: Option<String>,
    remove_originals: bool,
) -> AppResult<VaultReport> {
    require_cloud_bundle(&state).await?;
    let data_dir = state.data_dir.clone();
    blocking(move || {
        if let Some(ref d) = dest_dir {
            let trimmed = d.trim();
            if !trimmed.is_empty() {
                let p = PathBuf::from(trimmed);
                if !p.is_absolute() || is_disallowed_vault_path(&p, &data_dir) {
                    return Err(AppError::Other(
                        "Refusing to write vault files to a protected or internal directory.".into(),
                    ));
                }
            }
        }
        let dest = resolve_vault_dir(dest_dir.as_deref(), &data_dir);
        let mut rep = VaultReport::default();
        for path in paths {
            let src = PathBuf::from(path.trim());
            if !src.is_absolute() || is_disallowed_vault_path(&src, &data_dir) {
                rep.skipped.push(format!("{path}: not allowed"));
                continue;
            }
            match vault::encrypt_file(&src, &password, Some(dest.as_path())) {
                Ok(entry) => {
                    rep.bytes += entry.size;
                    if remove_originals && remove_plaintext(&src, &data_dir) {
                        rep.originals_removed += 1;
                    }
                    rep.processed.push(entry);
                }
                Err(e) => rep.skipped.push(format!("{path}: {e}")),
            }
        }
        Ok(rep)
    })
    .await
}

#[tauri::command]
pub async fn vault_decrypt(
    state: State<'_, AppState>,
    paths: Vec<String>,
    password: String,
    dest_dir: Option<String>,
    remove_vault_files: bool,
) -> AppResult<VaultReport> {
    require_cloud_bundle(&state).await?;
    let data_dir = state.data_dir.clone();
    blocking(move || {
        let dest = if let Some(d) = dest_dir.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()) {
            let p = PathBuf::from(&d);
            if !p.is_absolute() || is_disallowed_vault_path(&p, &data_dir) || !p.is_dir() {
                return Err(AppError::Other(
                    "Invalid or protected destination directory for vault decryption.".into(),
                ));
            }
            Some(p)
        } else {
            None
        };
        let mut rep = VaultReport::default();
        for path in paths {
            let src = PathBuf::from(path.trim());
            if !src.is_absolute() || is_disallowed_vault_path(&src, &data_dir) {
                rep.skipped.push(format!("{path}: not allowed"));
                continue;
            }
            if dest.is_none() {
                if let Some(parent) = src.parent() {
                    if is_disallowed_vault_path(parent, &data_dir) {
                        rep.skipped.push(format!("{path}: destination not allowed"));
                        continue;
                    }
                }
            }
            match vault::decrypt_file(&src, &password, dest.as_deref()) {
                Ok(entry) => {
                    rep.bytes += entry.size;
                    if remove_vault_files && remove_plaintext(&src, &data_dir) {
                        rep.originals_removed += 1;
                    }
                    rep.processed.push(entry);
                }
                Err(e) => rep.skipped.push(format!("{path}: {e}")),
            }
        }
        Ok(rep)
    })
    .await
}

/// Listing is free so users can always see (and later unlock) their vault files.
#[tauri::command]
pub async fn vault_list(state: State<'_, AppState>, dir: String, password: Option<String>) -> AppResult<Vec<VaultEntry>> {
    let data_dir = state.data_dir.clone();
    blocking(move || {
        let target = resolve_vault_dir(Some(dir.trim()), &data_dir);
        vault::list_vault(&target, password.as_deref().filter(|p| !p.is_empty()))
    })
    .await
}

// --- Backup Sync ---------------------------------------------------------------

#[tauri::command]
pub fn cloud_sync_list(state: State<'_, AppState>) -> Vec<SyncPair> {
    cloud_sync::load_pairs(&state.data_dir)
}

#[tauri::command]
pub async fn cloud_sync_add(state: State<'_, AppState>, source: String, destination: String) -> AppResult<Vec<SyncPair>> {
    require_cloud_bundle(&state).await?;
    cloud_sync::add_pair(&state.data_dir, &source, &destination)
}

#[tauri::command]
pub async fn cloud_sync_remove(state: State<'_, AppState>, id: String) -> AppResult<Vec<SyncPair>> {
    require_cloud_bundle(&state).await?;
    cloud_sync::remove_pair(&state.data_dir, &id)
}

#[tauri::command]
pub async fn cloud_sync_run(
    state: State<'_, AppState>,
    id: Option<String>,
    include_online_only: Option<bool>,
) -> AppResult<Vec<SyncRunReport>> {
    require_cloud_bundle(&state).await?;
    let data_dir = state.data_dir.clone();
    blocking(move || cloud_sync::run_pairs(&data_dir, id.as_deref(), include_online_only.unwrap_or(false))).await
}
