//! Cloud Backup Sync: one-way mirror of critical folders into a second cloud
//! (or any folder), so a locked / suspended account never means lost files.
//!
//! Safety rules: we only ever *add or update* files in the destination. Nothing
//! is deleted there, and the source is never written to.

use crate::error::{AppError, AppResult};
use crate::safety;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use walkdir::WalkDir;

const CONFIG_FILE: &str = "cloud_sync.json";
const MAX_FILES_PER_RUN: usize = 200_000;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SyncPair {
    pub id: String,
    pub source: String,
    pub destination: String,
    #[serde(default)]
    pub last_run_at: Option<u64>,
    #[serde(default)]
    pub last_copied: u64,
    #[serde(default)]
    pub last_bytes: u64,
    #[serde(default)]
    pub last_error: Option<String>,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct SyncRunReport {
    pub pair_id: String,
    pub files_copied: u64,
    pub files_up_to_date: u64,
    pub bytes_copied: u64,
    pub online_only_skipped: u64,
    pub errors: Vec<String>,
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

pub fn load_pairs(data_dir: &Path) -> Vec<SyncPair> {
    std::fs::read_to_string(data_dir.join(CONFIG_FILE))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_pairs(data_dir: &Path, pairs: &[SyncPair]) -> AppResult<()> {
    std::fs::create_dir_all(data_dir)?;
    std::fs::write(data_dir.join(CONFIG_FILE), serde_json::to_vec_pretty(pairs)?)?;
    Ok(())
}

pub fn add_pair(data_dir: &Path, source: &str, destination: &str) -> AppResult<Vec<SyncPair>> {
    let src = PathBuf::from(source.trim());
    let dst = PathBuf::from(destination.trim());
    if !src.is_absolute() || !src.is_dir() {
        return Err(AppError::Other("Choose an existing source folder.".into()));
    }
    if !dst.is_absolute() || !dst.is_dir() {
        return Err(AppError::Other("Choose an existing destination folder.".into()));
    }
    if crate::duplicates::is_protected_system_path(&src) || !safety::is_safe_root(&src) || safety::is_within(&src, data_dir) {
        return Err(AppError::Other("Source cannot be a system, protected, or application data directory.".into()));
    }
    if crate::duplicates::is_protected_system_path(&dst) || !safety::is_safe_root(&dst) || safety::is_within(&dst, data_dir) {
        return Err(AppError::Other("Destination cannot be a system, protected, or application data directory.".into()));
    }
    if safety::is_within(&dst, &src) || safety::is_within(&src, &dst) {
        return Err(AppError::Other("Source and destination must not be inside each other.".into()));
    }
    let mut pairs = load_pairs(data_dir);
    if pairs.iter().any(|p| p.source.eq_ignore_ascii_case(source.trim()) && p.destination.eq_ignore_ascii_case(destination.trim())) {
        return Ok(pairs);
    }
    pairs.push(SyncPair {
        id: format!("sync-{}-{}", now_secs(), pairs.len()),
        source: src.to_string_lossy().to_string(),
        destination: dst.to_string_lossy().to_string(),
        last_run_at: None,
        last_copied: 0,
        last_bytes: 0,
        last_error: None,
    });
    save_pairs(data_dir, &pairs)?;
    Ok(pairs)
}

pub fn remove_pair(data_dir: &Path, id: &str) -> AppResult<Vec<SyncPair>> {
    let mut pairs = load_pairs(data_dir);
    pairs.retain(|p| p.id != id);
    save_pairs(data_dir, &pairs)?;
    Ok(pairs)
}

fn needs_copy(src_md: &std::fs::Metadata, dst: &Path) -> bool {
    let Ok(dst_md) = std::fs::metadata(dst) else { return true };
    if dst_md.len() != src_md.len() {
        return true;
    }
    match (src_md.modified(), dst_md.modified()) {
        // Allow 2 s of slack for FAT/exFAT and cloud timestamp rounding.
        (Ok(s), Ok(d)) => s.duration_since(d).map(|x| x.as_secs() > 2).unwrap_or(false),
        _ => false,
    }
}

fn is_online_only(md: &std::fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        md.file_attributes() & (0x1000 | 0x0004_0000 | 0x0040_0000) != 0
    }
    #[cfg(not(windows))]
    {
        let _ = md;
        false
    }
}

/// Mirrors one pair. Online-only source files are skipped unless `include_online_only`
/// (reading them would download every file from the source cloud).
pub fn run_pair(pair: &SyncPair, include_online_only: bool) -> SyncRunReport {
    let mut rep = SyncRunReport { pair_id: pair.id.clone(), ..Default::default() };
    let src_root = Path::new(&pair.source);
    let dst_root = Path::new(&pair.destination);
    if !src_root.is_dir() || !dst_root.is_dir() {
        rep.errors.push("Source or destination folder is no longer available.".into());
        return rep;
    }
    let mut seen = 0usize;
    for entry in WalkDir::new(src_root).follow_links(false).into_iter().flatten() {
        seen += 1;
        if seen > MAX_FILES_PER_RUN {
            rep.errors.push(format!("Stopped after {MAX_FILES_PER_RUN} files; run again to continue."));
            break;
        }
        if entry.file_type().is_symlink() || !entry.file_type().is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_lowercase();
        if name == "desktop.ini" || name == ".ds_store" || name.starts_with("~$") || name.ends_with(".tmp") {
            continue;
        }
        let Ok(rel) = entry.path().strip_prefix(src_root) else { continue };
        let dst = dst_root.join(rel);
        let Ok(md) = std::fs::symlink_metadata(entry.path()) else { continue };
        if !needs_copy(&md, &dst) {
            rep.files_up_to_date += 1;
            continue;
        }
        if !include_online_only && is_online_only(&md) {
            rep.online_only_skipped += 1;
            continue;
        }
        let result = (|| -> std::io::Result<u64> {
            if let Some(parent) = dst.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let tmp = dst.with_file_name(format!(".{}.sweepr-sync", entry.file_name().to_string_lossy()));
            let n = std::fs::copy(entry.path(), &tmp)?;
            std::fs::rename(&tmp, &dst).or_else(|_| {
                let _ = std::fs::remove_file(&dst);
                std::fs::rename(&tmp, &dst)
            })?;
            Ok(n)
        })();
        match result {
            Ok(n) => {
                rep.files_copied += 1;
                rep.bytes_copied += n;
            }
            Err(e) => {
                if rep.errors.len() < 50 {
                    rep.errors.push(format!("{}: {e}", rel.display()));
                }
            }
        }
    }
    rep
}

/// Runs every pair (or just `only_id`) and records the outcome.
pub fn run_pairs(data_dir: &Path, only_id: Option<&str>, include_online_only: bool) -> AppResult<Vec<SyncRunReport>> {
    let mut pairs = load_pairs(data_dir);
    let mut reports = Vec::new();
    for pair in pairs.iter_mut().filter(|p| only_id.map(|id| id == p.id).unwrap_or(true)) {
        let rep = run_pair(pair, include_online_only);
        pair.last_run_at = Some(now_secs());
        pair.last_copied = rep.files_copied;
        pair.last_bytes = rep.bytes_copied;
        pair.last_error = rep.errors.first().cloned();
        reports.push(rep);
    }
    save_pairs(data_dir, &pairs)?;
    Ok(reports)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mirrors_new_files_and_never_deletes() {
        let base = std::env::temp_dir().join(format!("sweepr-sync-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let (src, dst, data) = (base.join("src"), base.join("dst"), base.join("data"));
        std::fs::create_dir_all(src.join("tax")).unwrap();
        std::fs::create_dir_all(&dst).unwrap();
        std::fs::write(src.join("tax").join("2025.pdf"), b"return").unwrap();
        std::fs::write(dst.join("keep-me.txt"), b"existing").unwrap();

        let pairs = add_pair(&data, &src.to_string_lossy(), &dst.to_string_lossy()).unwrap();
        let reps = run_pairs(&data, Some(&pairs[0].id), false).unwrap();
        assert_eq!(reps[0].files_copied, 1);
        assert_eq!(std::fs::read(dst.join("tax").join("2025.pdf")).unwrap(), b"return");
        assert!(dst.join("keep-me.txt").exists());

        let again = run_pairs(&data, None, false).unwrap();
        assert_eq!(again[0].files_copied, 0);
        assert_eq!(again[0].files_up_to_date, 1);
        assert!(add_pair(&data, &src.to_string_lossy(), &src.join("tax").to_string_lossy()).is_err());
        assert!(add_pair(&data, &data.to_string_lossy(), &dst.to_string_lossy()).is_err());
        assert!(add_pair(&data, &src.to_string_lossy(), &data.to_string_lossy()).is_err());
        let _ = std::fs::remove_dir_all(&base);
    }
}
