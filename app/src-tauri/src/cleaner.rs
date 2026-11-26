//! Cleaning executor & Quarantine manager. Re-walks targets at clean time
//! (never trusts a path list from the UI). Files in use are skipped, not forced.

use crate::error::{AppError, AppResult};
use crate::rules::Rule;
use crate::scanner::for_each_target_with_exclusions;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use walkdir::WalkDir;

const TRASH_BATCH: usize = 256;
pub const QUARANTINE_RETENTION_SECS: u64 = 7 * 24 * 3600;
pub const QUARANTINE_MIN_BUDGET_BYTES: u64 = 2 * 1024 * 1024 * 1024;
pub const QUARANTINE_DEFAULT_BUDGET_BYTES: u64 = 5 * 1024 * 1024 * 1024;
pub const QUARANTINE_MAX_BUDGET_BYTES: u64 = 10 * 1024 * 1024 * 1024;

static QUARANTINE_SEQ: AtomicU64 = AtomicU64::new(1);

pub fn clamp_quarantine_budget(bytes: u64) -> u64 {
    bytes.clamp(QUARANTINE_MIN_BUDGET_BYTES, QUARANTINE_MAX_BUDGET_BYTES)
}

#[derive(Serialize, Clone, Default, Debug)]
pub struct CleanReport {
    pub category_id: String,
    pub bytes_freed: u64,
    pub files_removed: u64,
    pub files_skipped: u64,
    pub moved_to_trash: bool,
    pub quarantined_count: u64,
    pub quarantine_fallback_count: u64,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct QuarantineStatus {
    pub item_count: usize,
    pub used_bytes: u64,
    pub budget_bytes: u64,
    pub min_budget_bytes: u64,
    pub max_budget_bytes: u64,
    pub retention_days: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum QuarantineMoveOutcome {
    Quarantined,
    FallbackTrash,
    Skipped,
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

pub fn quarantine_status(data_dir: &Path, budget_bytes: u64) -> QuarantineStatus {
    let entries = list_quarantine_entries(data_dir);
    let used_bytes = entries.iter().map(|e| e.size).sum();
    QuarantineStatus {
        item_count: entries.len(),
        used_bytes,
        budget_bytes: clamp_quarantine_budget(budget_bytes),
        min_budget_bytes: QUARANTINE_MIN_BUDGET_BYTES,
        max_budget_bytes: QUARANTINE_MAX_BUDGET_BYTES,
        retention_days: QUARANTINE_RETENTION_SECS / (24 * 3600),
    }
}

fn save_quarantine_entries(data_dir: &Path, entries: &[QuarantineEntry]) -> std::io::Result<()> {
    let dir = quarantine_dir(data_dir);
    std::fs::create_dir_all(&dir)?;
    let json = serde_json::to_string_pretty(entries).unwrap_or_else(|_| "[]".into());
    let path = quarantine_manifest_path(data_dir);
    crate::safety::atomic_write(&path, json.as_bytes())?;
    crate::safety::restrict_file_permissions(&path);
    Ok(())
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

/// Move a single file into the Sweepr Quarantine vault (`data_dir/quarantine/files/<id>`),
/// using O(1) same-volume rename first, FIFO-evicting oldest entries (and deleting their
/// backing files) to stay within `budget_bytes`, and falling back to OS Recycle Bin/Trash
/// if the single file exceeds `budget_bytes`.
pub fn move_to_quarantine_with_budget(
    data_dir: &Path,
    path: &Path,
    size: u64,
    category_id: &str,
    entries: &mut Vec<QuarantineEntry>,
    budget_bytes: u64,
) -> QuarantineMoveOutcome {
    if std::fs::symlink_metadata(path)
        .map(|m| m.file_type().is_symlink() || crate::safety::metadata_is_link_like(&m))
        .unwrap_or(true)
    {
        return QuarantineMoveOutcome::Skipped;
    }

    // Single file larger than the entire configured quarantine budget: do NOT evict
    // existing undo items; route directly to OS Recycle Bin / Trash fallback.
    if size > budget_bytes {
        return if trash_context().delete(path).is_ok() {
            QuarantineMoveOutcome::FallbackTrash
        } else {
            QuarantineMoveOutcome::Skipped
        };
    }

    let files_dir = quarantine_files_dir(data_dir);
    if std::fs::create_dir_all(&files_dir).is_err() {
        return if trash_context().delete(path).is_ok() {
            QuarantineMoveOutcome::FallbackTrash
        } else {
            QuarantineMoveOutcome::Skipped
        };
    }

    let ts = now_secs();
    let pid = std::process::id();
    let (id, dest) = loop {
        let seq = QUARANTINE_SEQ.fetch_add(1, Ordering::Relaxed);
        let candidate = format!("q_{ts}_{pid}_{seq}");
        let path_candidate = files_dir.join(&candidate);
        if !path_candidate.exists() {
            break (candidate, path_candidate);
        }
    };

    // Move/copy the incoming file into Quarantine BEFORE running FIFO eviction,
    // so a locked or unmovable source file never destroys existing restorable items.
    let moved = if std::fs::rename(path, &dest).is_ok() {
        true
    } else if std::fs::copy(path, &dest).is_ok() {
        if std::fs::remove_file(path).is_ok() {
            true
        } else {
            let _ = std::fs::remove_file(&dest);
            false
        }
    } else {
        false
    };

    if !moved {
        let _ = std::fs::remove_file(&dest);
        return QuarantineMoveOutcome::Skipped;
    }

    // Evict oldest entries FIFO (smallest `deleted_at`; ties broken by largest index
    // since newer entries are inserted at index 0) and delete backing files cleanly.
    let mut used: u64 = entries.iter().map(|e| e.size).sum();
    while used.saturating_add(size) > budget_bytes && !entries.is_empty() {
        let Some(oldest_idx) = entries
            .iter()
            .enumerate()
            .min_by_key(|(idx, e)| (e.deleted_at, std::cmp::Reverse(*idx)))
            .map(|(idx, _)| idx)
        else {
            break;
        };
        let evicted = entries.remove(oldest_idx);
        used = used.saturating_sub(evicted.size);
        if is_safe_quarantine_id(&evicted.id) {
            let _ = std::fs::remove_file(files_dir.join(&evicted.id));
        }
    }

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
    QuarantineMoveOutcome::Quarantined
}

/// Move a single file into the Sweepr Quarantine vault using the default 5 GB budget.
#[allow(dead_code)]
pub fn move_to_quarantine(
    data_dir: &Path,
    path: &Path,
    size: u64,
    category_id: &str,
    entries: &mut Vec<QuarantineEntry>,
) -> bool {
    matches!(
        move_to_quarantine_with_budget(
            data_dir,
            path,
            size,
            category_id,
            entries,
            QUARANTINE_DEFAULT_BUDGET_BYTES,
        ),
        QuarantineMoveOutcome::Quarantined | QuarantineMoveOutcome::FallbackTrash
    )
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
            .any(|c| matches!(c, std::path::Component::ParentDir) || c.as_os_str() == "..")
    {
        return Err(AppError::Other("Invalid restore destination path".into()));
    }
    let dest_norm = dest.to_string_lossy().replace('/', "\\").to_ascii_lowercase();
    if crate::duplicates::is_protected_system_path(&dest)
        || crate::safety::is_within(&dest, data_dir)
        || dest_norm.contains("\\start menu\\programs\\startup")
    {
        return Err(AppError::Other(
            "Restore destination is inside a protected system or startup directory.".into(),
        ));
    }
    let allowed_root = crate::rules::all_with_custom(data_dir)
        .into_iter()
        .any(|r| {
            r.roots
                .iter()
                .any(|root| crate::safety::is_within(&dest, root))
                || r.file_targets
                    .iter()
                    .any(|ft| crate::safety::is_within(&dest, &ft.dir))
        })
        || crate::safety::is_within(&dest, &std::env::temp_dir());
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

#[allow(dead_code)]
pub fn clean_with_exclusions_and_quarantine(
    rule: &Rule,
    use_trash: bool,
    exclusions: &[PathBuf],
    quarantine_data_dir: Option<&Path>,
) -> CleanReport {
    clean_with_exclusions_quarantine_and_budget(rule, use_trash, exclusions, quarantine_data_dir, None)
}

pub fn clean_with_quarantine(
    rule: &Rule,
    use_trash: bool,
    exclusions: &[PathBuf],
    quarantine_data_dir: Option<&Path>,
) -> CleanReport {
    clean_with_exclusions_quarantine_and_budget(rule, use_trash, exclusions, quarantine_data_dir, None)
}

pub fn clean_with_exclusions_quarantine_and_budget(
    rule: &Rule,
    use_trash: bool,
    exclusions: &[PathBuf],
    quarantine_data_dir: Option<&Path>,
    max_bytes: Option<u64>,
) -> CleanReport {
    clean_with_exclusions_quarantine_and_options(
        rule,
        use_trash,
        exclusions,
        quarantine_data_dir,
        max_bytes,
        QUARANTINE_DEFAULT_BUDGET_BYTES,
    )
}

pub fn clean_with_exclusions_quarantine_and_options(
    rule: &Rule,
    use_trash: bool,
    exclusions: &[PathBuf],
    quarantine_data_dir: Option<&Path>,
    max_bytes: Option<u64>,
    quarantine_budget_bytes: u64,
) -> CleanReport {
    if let Some(data_dir) = quarantine_data_dir {
        let disabled = crate::safety::load_disabled_rules(data_dir);
        if disabled.contains(&rule.id.to_ascii_lowercase()) {
            return CleanReport {
                category_id: rule.id.to_string(),
                moved_to_trash: use_trash,
                ..Default::default()
            };
        }
    }

    let mut targets: Vec<(PathBuf, u64)> = Vec::new();
    for_each_target_with_exclusions(rule, exclusions, |p, size| targets.push((p.to_path_buf(), size)));

    let mut report = CleanReport {
        category_id: rule.id.to_string(),
        moved_to_trash: use_trash,
        ..Default::default()
    };

    if let Some(limit) = max_bytes {
        if limit == 0 {
            report.files_skipped = targets.len() as u64;
            return report;
        }
        // Sort ascending by size so smaller files fit cleanly under an optional byte budget.
        targets.sort_by_key(|(_, s)| *s);
    }

    if use_trash && max_bytes.is_none() {
        let ctx = trash_context();
        for chunk in targets.chunks(TRASH_BATCH) {
            let paths: Vec<&PathBuf> = chunk
                .iter()
                .map(|(p, _)| p)
                .filter(|p| {
                    !std::fs::symlink_metadata(p)
                        .map(|m| m.file_type().is_symlink() || crate::safety::metadata_is_link_like(&m))
                        .unwrap_or(true)
                })
                .collect();
            if !paths.is_empty() && paths.len() == chunk.len() && ctx.delete_all(&paths).is_ok() {
                report.files_removed += chunk.len() as u64;
                report.bytes_freed += chunk.iter().map(|(_, s)| s).sum::<u64>();
            } else {
                // A locked file fails the whole batch; retry one by one.
                for (path, s) in chunk {
                    if std::fs::symlink_metadata(&path)
                        .map(|m| m.file_type().is_symlink() || crate::safety::metadata_is_link_like(&m))
                        .unwrap_or(true)
                    {
                        report.files_skipped += 1;
                        continue;
                    }
                    if ctx.delete(path).is_ok() {
                        report.files_removed += 1;
                        report.bytes_freed += s;
                    } else {
                        report.files_skipped += 1;
                    }
                }
            }
        }
    } else if use_trash {
        let ctx = trash_context();
        for (path, s) in &targets {
            if let Some(limit) = max_bytes {
                if report.bytes_freed.saturating_add(*s) > limit {
                    report.files_skipped += 1;
                    continue;
                }
            }
            if std::fs::symlink_metadata(&path)
                .map(|m| m.file_type().is_symlink() || crate::safety::metadata_is_link_like(&m))
                .unwrap_or(true)
            {
                report.files_skipped += 1;
                continue;
            }
            if ctx.delete(path).is_ok() {
                report.files_removed += 1;
                report.bytes_freed += s;
            } else {
                report.files_skipped += 1;
            }
        }
    } else if let Some(data_dir) = quarantine_data_dir {
        let mut entries = list_quarantine_entries(data_dir);
        for (path, s) in &targets {
            if let Some(limit) = max_bytes {
                if report.bytes_freed.saturating_add(*s) > limit {
                    report.files_skipped += 1;
                    continue;
                }
            }
            if std::fs::symlink_metadata(&path)
                .map(|m| m.file_type().is_symlink() || crate::safety::metadata_is_link_like(&m))
                .unwrap_or(true)
            {
                report.files_skipped += 1;
                continue;
            }
            match move_to_quarantine_with_budget(
                data_dir,
                path,
                *s,
                &rule.id,
                &mut entries,
                quarantine_budget_bytes,
            ) {
                QuarantineMoveOutcome::Quarantined => {
                    report.files_removed += 1;
                    report.bytes_freed += s;
                    report.quarantined_count += 1;
                    if report.files_removed.is_multiple_of(25) {
                        let _ = save_quarantine_entries(data_dir, &entries);
                    }
                }
                QuarantineMoveOutcome::FallbackTrash => {
                    report.files_removed += 1;
                    report.bytes_freed += s;
                    report.quarantine_fallback_count += 1;
                }
                QuarantineMoveOutcome::Skipped => {
                    report.files_skipped += 1;
                }
            }
        }
        let _ = save_quarantine_entries(data_dir, &entries);
        remove_empty_dirs(rule);
    } else {
        for (path, s) in &targets {
            if let Some(limit) = max_bytes {
                if report.bytes_freed.saturating_add(*s) > limit {
                    report.files_skipped += 1;
                    continue;
                }
            }
            if std::fs::symlink_metadata(&path)
                .map(|m| m.file_type().is_symlink() || crate::safety::metadata_is_link_like(&m))
                .unwrap_or(true)
            {
                report.files_skipped += 1;
                continue;
            }
            match std::fs::remove_file(path) {
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
        let data_dir = dir.join("data");
        let work_dir = dir.join("work");
        std::fs::create_dir_all(&data_dir).unwrap();
        std::fs::create_dir_all(&work_dir).unwrap();

        let target = work_dir.join("sample.tmp");
        std::fs::write(&target, b"important cache bytes").unwrap();

        let mut entries = list_quarantine_entries(&data_dir);
        assert!(move_to_quarantine(&data_dir, &target, 21, "temp", &mut entries));
        save_quarantine_entries(&data_dir, &entries).unwrap();
        assert!(!target.exists());

        let loaded = list_quarantine_entries(&data_dir);
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].file_name, "sample.tmp");

        let restored_path = restore_quarantine_entry(&data_dir, &loaded[0].id).unwrap();
        assert_eq!(PathBuf::from(restored_path), target);
        assert!(target.exists());
        assert!(list_quarantine_entries(&data_dir).is_empty());

        // Test refusal to overwrite existing file and unsafe IDs
        assert!(is_safe_quarantine_id("q_1700000000_123_1"));
        assert!(!is_safe_quarantine_id("../account.json"));
        assert!(!is_safe_quarantine_id("..\\account.json"));
        assert!(!is_safe_quarantine_id("sub/file"));
        assert!(!is_safe_quarantine_id(""));

        assert!(move_to_quarantine(&data_dir, &target, 21, "temp", &mut entries));
        save_quarantine_entries(&data_dir, &entries).unwrap();
        // Recreate target file before restore -> restore must refuse to overwrite
        std::fs::write(&target, b"new file at destination").unwrap();
        assert!(restore_quarantine_entry(&data_dir, &entries[0].id).is_err());
        assert_eq!(std::fs::read(&target).unwrap(), b"new file at destination");

        // Refuses restoring into app data_dir
        entries[0].original_path = data_dir.join("account.json").to_string_lossy().into_owned();
        save_quarantine_entries(&data_dir, &entries).unwrap();
        assert!(restore_quarantine_entry(&data_dir, &entries[0].id).is_err());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn budget_capped_quarantine_clean_respects_limit() {
        let dir = std::env::temp_dir().join(format!("sweepr-budget-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let data_dir = dir.join("data");
        let work_dir = dir.join("temp_root");
        std::fs::create_dir_all(&data_dir).unwrap();
        std::fs::create_dir_all(&work_dir).unwrap();

        // Create 3 files: 100 bytes, 200 bytes, and 500 bytes (800 bytes total).
        std::fs::write(work_dir.join("small_a.tmp"), vec![b'a'; 100]).unwrap();
        std::fs::write(work_dir.join("small_b.tmp"), vec![b'b'; 200]).unwrap();
        std::fs::write(work_dir.join("large_c.tmp"), vec![b'c'; 500]).unwrap();

        let rule = Rule {
            id: "temp".into(),
            name: "Temporary files".into(),
            description: "Test temp".into(),
            group: crate::rules::Group::System,
            roots: vec![work_dir.clone()],
            file_targets: Vec::new(),
            min_age_hours: 0,
            free: true,
        };

        // Cap budget at 350 bytes: small_a (100) + small_b (200) = 300 <= 350, large_c (500) skipped.
        let report = clean_with_exclusions_quarantine_and_budget(
            &rule,
            false,
            &[],
            Some(&data_dir),
            Some(350),
        );
        assert_eq!(report.bytes_freed, 300);
        assert_eq!(report.files_removed, 2);
        assert_eq!(report.files_skipped, 1);
        assert!(!work_dir.join("small_a.tmp").exists());
        assert!(!work_dir.join("small_b.tmp").exists());
        assert!(work_dir.join("large_c.tmp").exists());

        let quarantined = list_quarantine_entries(&data_dir);
        assert_eq!(quarantined.len(), 2);
        assert_eq!(report.quarantined_count, 2);
        assert_eq!(report.quarantine_fallback_count, 0);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn quarantine_allows_more_than_300_items_and_files_over_50mb_within_budget() {
        let dir = std::env::temp_dir().join(format!("sweepr-q-unlimited-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let data_dir = dir.join("data");
        let work_dir = dir.join("temp_root");
        std::fs::create_dir_all(&data_dir).unwrap();
        std::fs::create_dir_all(&work_dir).unwrap();

        // Create 320 small files (> old 300-item ceiling) + one 60 MB file (> old 50 MB ceiling)
        for i in 0..320 {
            std::fs::write(work_dir.join(format!("item_{i:03}.tmp")), b"cache-bytes").unwrap();
        }
        let big_file = work_dir.join("large_shader.bin");
        let f = std::fs::File::create(&big_file).unwrap();
        f.set_len(60 * 1024 * 1024).unwrap();
        drop(f);

        let rule = Rule {
            id: "temp".into(),
            name: "Temporary files".into(),
            description: "Test temp".into(),
            group: crate::rules::Group::System,
            roots: vec![work_dir.clone()],
            file_targets: Vec::new(),
            min_age_hours: 0,
            free: true,
        };

        let report = clean_with_exclusions_quarantine_and_options(
            &rule,
            false,
            &[],
            Some(&data_dir),
            None,
            QUARANTINE_MIN_BUDGET_BYTES,
        );
        assert_eq!(report.files_removed, 321);
        assert_eq!(report.quarantined_count, 321);
        assert_eq!(report.quarantine_fallback_count, 0);
        assert_eq!(report.files_skipped, 0);

        let entries = list_quarantine_entries(&data_dir);
        assert_eq!(entries.len(), 321);
        assert!(entries.iter().any(|e| e.file_name == "large_shader.bin" && e.size == 60 * 1024 * 1024));

        let status = quarantine_status(&data_dir, 100);
        assert_eq!(status.item_count, 321);
        assert_eq!(status.budget_bytes, QUARANTINE_MIN_BUDGET_BYTES);
        assert!(status.used_bytes > 60 * 1024 * 1024);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn quarantine_fifo_evicts_oldest_and_deletes_backing_files() {
        let dir = std::env::temp_dir().join(format!("sweepr-q-fifo-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let data_dir = dir.join("data");
        let work_dir = dir.join("temp_root");
        std::fs::create_dir_all(&data_dir).unwrap();
        std::fs::create_dir_all(&work_dir).unwrap();

        let p_a = work_dir.join("a.tmp");
        let p_b = work_dir.join("b.tmp");
        let p_c = work_dir.join("c.tmp");
        std::fs::write(&p_a, vec![b'a'; 400]).unwrap();
        std::fs::write(&p_b, vec![b'b'; 400]).unwrap();
        std::fs::write(&p_c, vec![b'c'; 400]).unwrap();

        let mut entries = Vec::new();
        let budget = 1000;
        assert_eq!(
            move_to_quarantine_with_budget(&data_dir, &p_a, 400, "temp", &mut entries, budget),
            QuarantineMoveOutcome::Quarantined
        );
        let id_a = entries[0].id.clone();
        assert_eq!(
            move_to_quarantine_with_budget(&data_dir, &p_b, 400, "temp", &mut entries, budget),
            QuarantineMoveOutcome::Quarantined
        );
        // Adding C (400 bytes) makes total 1200 > 1000, so oldest (A) must be evicted + backing file deleted.
        assert_eq!(
            move_to_quarantine_with_budget(&data_dir, &p_c, 400, "temp", &mut entries, budget),
            QuarantineMoveOutcome::Quarantined
        );
        save_quarantine_entries(&data_dir, &entries).unwrap();

        let loaded = list_quarantine_entries(&data_dir);
        assert_eq!(loaded.len(), 2);
        assert!(loaded.iter().all(|e| e.file_name != "a.tmp"));
        assert!(loaded.iter().any(|e| e.file_name == "b.tmp"));
        assert!(loaded.iter().any(|e| e.file_name == "c.tmp"));
        assert_ne!(loaded[0].id, loaded[1].id);
        assert!(
            !quarantine_files_dir(&data_dir).join(&id_a).exists(),
            "Evicted backing file must be removed from quarantine/files"
        );
        for e in &loaded {
            assert!(quarantine_files_dir(&data_dir).join(&e.id).is_file());
        }

        // B and C remain restorable
        restore_quarantine_entry(&data_dir, &loaded[0].id).unwrap();
        restore_quarantine_entry(&data_dir, &loaded[1].id).unwrap();
        assert!(p_b.exists());
        assert!(p_c.exists());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn quarantine_oversized_single_file_falls_back_without_evicting() {
        let dir = std::env::temp_dir().join(format!("sweepr-q-oversized-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let data_dir = dir.join("data");
        let work_dir = dir.join("temp_root");
        std::fs::create_dir_all(&data_dir).unwrap();
        std::fs::create_dir_all(&work_dir).unwrap();

        let p_small = work_dir.join("keep_in_q.tmp");
        let p_big = work_dir.join("oversized.tmp");
        std::fs::write(&p_small, vec![b's'; 400]).unwrap();

        let budget = 1000;
        let mut entries = Vec::new();
        assert_eq!(
            move_to_quarantine_with_budget(&data_dir, &p_small, 400, "temp", &mut entries, budget),
            QuarantineMoveOutcome::Quarantined
        );
        save_quarantine_entries(&data_dir, &entries).unwrap();
        let kept_id = entries[0].id.clone();

        // Now clean an oversized file (2000 bytes > 1000 byte budget)
        std::fs::write(&p_big, vec![b'x'; 2000]).unwrap();
        let rule = Rule {
            id: "temp".into(),
            name: "Temporary files".into(),
            description: "Test temp".into(),
            group: crate::rules::Group::System,
            roots: vec![work_dir.clone()],
            file_targets: Vec::new(),
            min_age_hours: 0,
            free: true,
        };
        let report = clean_with_exclusions_quarantine_and_options(
            &rule,
            false,
            &[],
            Some(&data_dir),
            None,
            budget,
        );

        // Existing quarantine item must NEVER be evicted by an oversized file
        let after = list_quarantine_entries(&data_dir);
        assert_eq!(after.len(), 1);
        assert_eq!(after[0].id, kept_id);
        assert!(quarantine_files_dir(&data_dir).join(&kept_id).is_file());

        // On desktop environments with OS Trash/Recycle Bin, oversized file falls back cleanly
        if report.files_removed == 1 {
            assert_eq!(report.quarantined_count, 0);
            assert_eq!(report.quarantine_fallback_count, 1);
            assert_eq!(report.bytes_freed, 2000);
        } else {
            assert_eq!(report.files_skipped, 1);
        }

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn quarantine_unmovable_or_locked_file_does_not_evict_existing_entries() {
        let dir = std::env::temp_dir().join(format!("sweepr-q-locked-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let data_dir = dir.join("data");
        let work_dir = dir.join("temp_root");
        std::fs::create_dir_all(&data_dir).unwrap();
        std::fs::create_dir_all(&work_dir).unwrap();

        let p_keep = work_dir.join("keep.tmp");
        std::fs::write(&p_keep, vec![b'k'; 700]).unwrap();

        let budget = 1000;
        let mut entries = Vec::new();
        assert_eq!(
            move_to_quarantine_with_budget(&data_dir, &p_keep, 700, "temp", &mut entries, budget),
            QuarantineMoveOutcome::Quarantined
        );
        let kept_id = entries[0].id.clone();

        // 1. Missing source file whose size (500) + existing (700) > budget (1000) must skip without evicting.
        let p_missing = work_dir.join("missing.tmp");
        assert_eq!(
            move_to_quarantine_with_budget(&data_dir, &p_missing, 500, "temp", &mut entries, budget),
            QuarantineMoveOutcome::Skipped
        );
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].id, kept_id);
        assert!(quarantine_files_dir(&data_dir).join(&kept_id).is_file());

        // 2. On Windows, an exclusively locked open file must also skip without evicting.
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            let p_locked = work_dir.join("locked.tmp");
            std::fs::write(&p_locked, vec![b'l'; 500]).unwrap();
            let _lock_handle = std::fs::OpenOptions::new()
                .read(true)
                .write(true)
                .share_mode(0)
                .open(&p_locked)
                .unwrap();
            assert_eq!(
                move_to_quarantine_with_budget(&data_dir, &p_locked, 500, "temp", &mut entries, budget),
                QuarantineMoveOutcome::Skipped
            );
            assert_eq!(entries.len(), 1);
            assert_eq!(entries[0].id, kept_id);
            assert!(quarantine_files_dir(&data_dir).join(&kept_id).is_file());
        }

        save_quarantine_entries(&data_dir, &entries).unwrap();
        restore_quarantine_entry(&data_dir, &kept_id).unwrap();
        assert!(p_keep.is_file());

        let _ = std::fs::remove_dir_all(&dir);
    }
}
