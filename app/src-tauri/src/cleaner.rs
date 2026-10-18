//! Cleaning executor & Quarantine manager. Re-walks targets at clean time
//! (never trusts a path list from the UI). Files in use are skipped, not forced.

use crate::error::{AppError, AppResult};
use crate::rules::Rule;
use crate::scanner::for_each_target_with_exclusions;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use walkdir::WalkDir;

const TRASH_BATCH: usize = 256;
const QUARANTINE_RETENTION_SECS: u64 = 7 * 24 * 3600;
const QUARANTINE_MAX_FILE_BYTES: u64 = 50 * 1024 * 1024;
const QUARANTINE_MAX_ITEMS: usize = 300;

#[derive(Serialize, Clone, Default)]
pub struct CleanReport {
    pub category_id: String,
    pub bytes_freed: u64,
    pub files_removed: u64,
    pub files_skipped: u64,
    pub moved_to_trash: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct QuarantineEntry {
    pub id: String,
    pub original_path: String,
    pub file_name: String,
    pub size: u64,
    pub category_id: String,
    pub deleted_at: u64,
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn quarantine_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("quarantine")
}

fn quarantine_files_dir(data_dir: &Path) -> PathBuf {
    quarantine_dir(data_dir).join("files")
}

fn quarantine_manifest_path(data_dir: &Path) -> PathBuf {
    quarantine_dir(data_dir).join("manifest.json")
}

pub fn list_quarantine_entries(data_dir: &Path) -> Vec<QuarantineEntry> {
    let Ok(raw) = std::fs::read_to_string(quarantine_manifest_path(data_dir)) else {
        return Vec::new();
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

fn save_quarantine_entries(data_dir: &Path, entries: &[QuarantineEntry]) -> std::io::Result<()> {
    let dir = quarantine_dir(data_dir);
    std::fs::create_dir_all(&dir)?;
    let json = serde_json::to_string_pretty(entries).unwrap_or_else(|_| "[]".into());
    std::fs::write(quarantine_manifest_path(data_dir), json)
}

fn is_safe_quarantine_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 80
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        && Path::new(id).components().count() == 1
        && matches!(Path::new(id).components().next(), Some(std::path::Component::Normal(_)))
}

/// Purge quarantined items older than 7 days (`QUARANTINE_RETENTION_SECS`).
pub fn purge_expired_quarantine_in(data_dir: &Path) -> u64 {
    let now = now_secs();
    let entries = list_quarantine_entries(data_dir);
    if entries.is_empty() {
        return 0;
    }
    let files_dir = quarantine_files_dir(data_dir);
    let mut kept = Vec::new();
    let mut purged = 0u64;
    for entry in entries {
        if !is_safe_quarantine_id(&entry.id) {
            purged += 1;
            continue;
        }
        let qpath = files_dir.join(&entry.id);
        let expired = now.saturating_sub(entry.deleted_at) > QUARANTINE_RETENTION_SECS;
        if expired || !qpath.exists() {
            let _ = std::fs::remove_file(&qpath);
            purged += 1;
        } else {
            kept.push(entry);
        }
    }
    let _ = save_quarantine_entries(data_dir, &kept);
    purged
}

/// Move a single file into the Sweepr Quarantine vault (`data_dir/quarantine/files/<id>`).
pub fn move_to_quarantine(
    data_dir: &Path,
    path: &Path,
    size: u64,
    category_id: &str,
    entries: &mut Vec<QuarantineEntry>,
) -> bool {
    if size > QUARANTINE_MAX_FILE_BYTES || entries.len() >= QUARANTINE_MAX_ITEMS {
        return trash::delete(path).is_ok();
    }
    let files_dir = quarantine_files_dir(data_dir);
    if std::fs::create_dir_all(&files_dir).is_err() {
        return trash::delete(path).is_ok();
    }
    let ts = now_secs();
    let id = format!("q_{ts}_{}_{}", std::process::id(), entries.len() + 1);
    let dest = files_dir.join(&id);
    let moved = std::fs::rename(path, &dest).is_ok()
        || (std::fs::copy(path, &dest).is_ok() && std::fs::remove_file(path).is_ok());
    if moved {
        let file_name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "file".into());
        entries.insert(
            0,
            QuarantineEntry {
                id,
                original_path: path.to_string_lossy().into_owned(),
                file_name,
                size,
                category_id: category_id.to_string(),
                deleted_at: ts,
            },
        );
        true
    } else {
        let _ = std::fs::remove_file(&dest);
        false
    }
}

pub fn restore_quarantine_entry(data_dir: &Path, id: &str) -> AppResult<String> {
    if !is_safe_quarantine_id(id) {
        return Err(AppError::Other("Invalid quarantine item identifier.".into()));
    }
    let mut entries = list_quarantine_entries(data_dir);
    let idx = entries
        .iter()
        .position(|e| e.id == id)
        .ok_or_else(|| AppError::NotFound("Quarantine item not found".into()))?;
    let entry = entries[idx].clone();
    if !is_safe_quarantine_id(&entry.id) {
        return Err(AppError::Other("Invalid quarantine item identifier.".into()));
    }
    let src = quarantine_files_dir(data_dir).join(&entry.id);
    if !src.is_file() {
        entries.remove(idx);
        let _ = save_quarantine_entries(data_dir, &entries);
        return Err(AppError::NotFound("Quarantined file no longer exists on disk".into()));
    }
    let dest = PathBuf::from(&entry.original_path);
    if !dest.is_absolute()
        || dest
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err(AppError::Other("Invalid restore destination path".into()));
    }
    let allowed_root = crate::rules::all_specs()
        .iter()
        .filter_map(|s| s.base.resolve())
        .any(|base| dest.starts_with(&base))
        || dest.starts_with(std::env::temp_dir());
    if !allowed_root {
        return Err(AppError::Other(
            "Restore destination is outside allowed cleanup directories.".into(),
        ));
    }

    let mut cur = dest.as_path();
    while let Some(parent) = cur.parent() {
        if parent.as_os_str().is_empty() {
            break;
        }
        if let Ok(md) = std::fs::symlink_metadata(parent) {
            if crate::safety::metadata_is_link_like(&md) {
                return Err(AppError::Other(
                    "Refusing to restore through a symlink or reparse point directory.".into(),
                ));
            }
        }
        if parent == cur {
            break;
        }
        cur = parent;
    }

    if dest.exists() || std::fs::symlink_metadata(&dest).is_ok() {
        return Err(AppError::Other(
            "Destination file already exists; refusing to overwrite.".into(),
        ));
    }

    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| AppError::Other(format!("Could not recreate folder: {e}")))?;
    }
    if std::fs::rename(&src, &dest).is_err() {
        std::fs::copy(&src, &dest)
            .map_err(|e| AppError::Other(format!("Could not restore file: {e}")))?;
        let _ = std::fs::remove_file(&src);
    }
    entries.remove(idx);
    let _ = save_quarantine_entries(data_dir, &entries);
    Ok(entry.original_path)
}

#[allow(dead_code)]
pub fn clean(rule: &Rule, use_trash: bool) -> CleanReport {
    clean_with_exclusions(rule, use_trash, &[])
}

pub fn clean_with_exclusions(rule: &Rule, use_trash: bool, exclusions: &[PathBuf]) -> CleanReport {
    clean_with_quarantine(rule, use_trash, exclusions, None)
}

pub fn clean_with_exclusions_and_quarantine(
    rule: &Rule,
    use_trash: bool,
    exclusions: &[PathBuf],
    quarantine_data_dir: Option<&Path>,
) -> CleanReport {
    clean_with_quarantine(rule, use_trash, exclusions, quarantine_data_dir)
}

pub fn clean_with_quarantine(
    rule: &Rule,
    use_trash: bool,
    exclusions: &[PathBuf],
    quarantine_data_dir: Option<&Path>,
) -> CleanReport {
    let mut targets: Vec<(PathBuf, u64)> = Vec::new();
    for_each_target_with_exclusions(rule, exclusions, |p, size| targets.push((p.to_path_buf(), size)));

    let mut report = CleanReport {
        category_id: rule.id.to_string(),
        moved_to_trash: use_trash,
        ..Default::default()
    };

    if use_trash {
        let ctx = trash_context();
        for chunk in targets.chunks(TRASH_BATCH) {
            let paths: Vec<&PathBuf> = chunk.iter().map(|(p, _)| p).collect();
            if ctx.delete_all(&paths).is_ok() {
                report.files_removed += chunk.len() as u64;
                report.bytes_freed += chunk.iter().map(|(_, s)| s).sum::<u64>();
            } else {
                // A locked file fails the whole batch; retry one by one.
                for (p, s) in chunk {
                    if ctx.delete(p).is_ok() {
                        report.files_removed += 1;
                        report.bytes_freed += s;
                    } else {
                        report.files_skipped += 1;
                    }
                }
            }
        }
    } else if let Some(data_dir) = quarantine_data_dir {
        let mut entries = list_quarantine_entries(data_dir);
        for (p, s) in &targets {
            if move_to_quarantine(data_dir, p, *s, rule.id, &mut entries) {
                report.files_removed += 1;
                report.bytes_freed += s;
            } else {
                report.files_skipped += 1;
            }
        }
        entries.truncate(QUARANTINE_MAX_ITEMS);
        let _ = save_quarantine_entries(data_dir, &entries);
        remove_empty_dirs(rule);
    } else {
        for (p, s) in &targets {
            match std::fs::remove_file(p) {
                Ok(()) => {
                    report.files_removed += 1;
                    report.bytes_freed += s;
                }
                Err(_) => report.files_skipped += 1,
            }
        }
        remove_empty_dirs(rule);
    }

    report
}

/// Remove now-empty sub-directories (never the root itself). `remove_dir` only
/// succeeds on empty directories, so this cannot delete content.
fn remove_empty_dirs(rule: &Rule) {
    for root in &rule.roots {
        if !crate::safety::is_safe_root(root) {
            continue;
        }
        for entry in WalkDir::new(root)
            .follow_links(false)
            .min_depth(1)
            .contents_first(true)
            .into_iter()
            .filter_entry(|e| !crate::safety::is_link_like(e))
            .flatten()
        {
            if entry.file_type().is_dir() {
                let _ = std::fs::remove_dir(entry.path());
            }
        }
    }
}

fn trash_context() -> trash::TrashContext {
    #[allow(unused_mut)]
    let mut ctx = trash::TrashContext::default();
    #[cfg(target_os = "macos")]
    {
        // Avoid the Finder/AppleScript path, which needs Automation permission and is slow.
        use trash::macos::{DeleteMethod, TrashContextExtMacos};
        ctx.set_delete_method(DeleteMethod::NsFileManager);
    }
    ctx
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quarantine_roundtrip_and_restore() {
        let dir = std::env::temp_dir().join(format!("sweepr-quarantine-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("work")).unwrap();

        let target = dir.join("work").join("sample.tmp");
        std::fs::write(&target, b"important cache bytes").unwrap();

        let mut entries = list_quarantine_entries(&dir);
        assert!(move_to_quarantine(&dir, &target, 21, "temp", &mut entries));
        save_quarantine_entries(&dir, &entries).unwrap();
        assert!(!target.exists());

        let loaded = list_quarantine_entries(&dir);
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].file_name, "sample.tmp");

        let restored_path = restore_quarantine_entry(&dir, &loaded[0].id).unwrap();
        assert_eq!(PathBuf::from(restored_path), target);
        assert!(target.exists());
        assert!(list_quarantine_entries(&dir).is_empty());

        // Test refusal to overwrite existing file and unsafe IDs
        assert!(is_safe_quarantine_id("q_1700000000_123_1"));
        assert!(!is_safe_quarantine_id("../account.json"));
        assert!(!is_safe_quarantine_id("..\\account.json"));
        assert!(!is_safe_quarantine_id("sub/file"));
        assert!(!is_safe_quarantine_id(""));

        assert!(move_to_quarantine(&dir, &target, 21, "temp", &mut entries));
        save_quarantine_entries(&dir, &entries).unwrap();
        // Recreate target file before restore -> restore must refuse to overwrite
        std::fs::write(&target, b"new file at destination").unwrap();
        assert!(restore_quarantine_entry(&dir, &entries[0].id).is_err());
        assert_eq!(std::fs::read(&target).unwrap(), b"new file at destination");

        let _ = std::fs::remove_dir_all(&dir);
    }
}
