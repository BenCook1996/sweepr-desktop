use crate::commands::AppState;
use crate::error::{AppError, AppResult};
use crate::safety;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashMap};
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::State;
use walkdir::WalkDir;

/// Upper bound on files examined in one run so a huge folder (or a whole
/// drive) cannot block the app indefinitely.
pub const MAX_FILES: usize = 200_000;
const TOP_LARGE_FILES: usize = 100;

#[derive(Serialize)]
pub struct DuplicateGroup {
    pub hash: String,
    pub size: u64,
    pub files: Vec<String>,
}

#[derive(Serialize, Clone)]
pub struct LargeFileEntry {
    pub path: String,
    pub name: String,
    pub ext: String,
    pub size: u64,
    pub modified_at: u64,
}

#[derive(Serialize, Clone)]
pub struct DiskBreakdownItem {
    pub label: String,
    pub bytes: u64,
    pub files: u64,
}

#[derive(Serialize, Clone)]
pub struct LargeFilesReport {
    pub total_scanned_bytes: u64,
    pub total_scanned_files: u64,
    pub top_files: Vec<LargeFileEntry>,
    pub by_extension: Vec<DiskBreakdownItem>,
    pub by_folder: Vec<DiskBreakdownItem>,
}

fn hash_file(path: &Path) -> Option<String> {
    let mut file = File::open(path).ok()?;
    let mut hasher = Sha256::new();
    let mut buffer = [0; 8192];
    loop {
        match file.read(&mut buffer) {
            Ok(0) => break,
            Ok(n) => hasher.update(&buffer[..n]),
            // A read error would yield a partial hash and false matches: skip the file.
            Err(_) => return None,
        }
    }
    Some(format!("{:x}", hasher.finalize()))
}

#[allow(dead_code)]
pub fn find_duplicates_in(dir: &str, max_files: usize) -> AppResult<Vec<DuplicateGroup>> {
    find_duplicates_with_exclusions(dir, max_files, &[])
}

fn validate_scan_folder(dir: &str) -> AppResult<&Path> {
    let root = Path::new(dir.trim());
    if !root.is_absolute() {
        return Err(AppError::Other("Please enter the full (absolute) path to a folder.".into()));
    }
    let md = std::fs::symlink_metadata(root)
        .map_err(|e| AppError::Other(format!("Cannot access folder: {e}")))?;
    if safety::metadata_is_link_like(&md) {
        return Err(AppError::Other("Refusing to scan through a symlink or junction; choose the real folder.".into()));
    }
    if !md.is_dir() {
        return Err(AppError::Other("Path is not a folder.".into()));
    }
    Ok(root)
}

pub fn find_duplicates_with_exclusions(
    dir: &str,
    max_files: usize,
    exclusions: &[PathBuf],
) -> AppResult<Vec<DuplicateGroup>> {
    let root = validate_scan_folder(dir)?;

    let mut by_size: HashMap<u64, Vec<PathBuf>> = HashMap::new();
    let mut seen = 0usize;

    // 1. Group by size first (fast). Never follow or descend into links/reparse points or excluded paths.
    let walker = WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            (e.depth() == 0 || !safety::is_link_like(e)) && !safety::is_excluded(e.path(), exclusions)
        });
    for entry in walker.filter_map(|e| e.ok()) {
        if entry.file_type().is_file() {
            if safety::is_excluded(entry.path(), exclusions) {
                continue;
            }
            seen += 1;
            if seen > max_files {
                return Err(AppError::Other(format!(
                    "This folder contains more than {max_files} files. Please choose a smaller folder."
                )));
            }
            if let Ok(metadata) = entry.metadata() {
                let size = metadata.len();
                if size > 0 {
                    by_size.entry(size).or_default().push(entry.path().to_path_buf());
                }
            }
        }
    }

    // 2. Filter to sizes with >1 file
    let mut potential = Vec::new();
    for (size, paths) in by_size {
        if paths.len() > 1 {
            potential.push((size, paths));
        }
    }

    // 3. Group by full hash for remaining
    let mut results = Vec::new();
    for (size, paths) in potential {
        let mut by_hash: HashMap<String, Vec<String>> = HashMap::new();
        for path in paths {
            if let Some(hash) = hash_file(&path) {
                by_hash
                    .entry(hash)
                    .or_default()
                    .push(path.to_string_lossy().to_string());
            }
        }

        for (hash, mut files) in by_hash {
            if files.len() > 1 {
                files.sort();
                results.push(DuplicateGroup { hash, size, files });
            }
        }
    }

    // Sort largest groups first
    results.sort_by(|a, b| b.size.cmp(&a.size));
    Ok(results)
}

pub fn scan_large_files_in(
    dir: &str,
    min_bytes: u64,
    max_files: usize,
    exclusions: &[PathBuf],
) -> AppResult<LargeFilesReport> {
    let root = validate_scan_folder(dir)?;
    let mut seen = 0usize;
    let mut total_scanned_bytes = 0u64;
    let mut total_scanned_files = 0u64;
    let mut heap: BinaryHeap<Reverse<(u64, u64, PathBuf)>> = BinaryHeap::new();
    let mut ext_map: HashMap<String, (u64, u64)> = HashMap::new();
    let mut folder_map: HashMap<String, (u64, u64)> = HashMap::new();

    let walker = WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            (e.depth() == 0 || !safety::is_link_like(e)) && !safety::is_excluded(e.path(), exclusions)
        });

    for entry in walker.filter_map(|e| e.ok()) {
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        if safety::is_excluded(path, exclusions) {
            continue;
        }
        seen += 1;
        if seen > max_files {
            return Err(AppError::Other(format!(
                "This folder contains more than {max_files} files. Please choose a smaller folder."
            )));
        }
        let Ok(md) = entry.metadata() else { continue };
        let size = md.len();
        total_scanned_bytes += size;
        total_scanned_files += 1;

        let ext = path
            .extension()
            .and_then(|s| s.to_str())
            .map(|s| format!(".{}", s.to_ascii_lowercase()))
            .unwrap_or_else(|| "(no ext)".into());
        let ext_entry = ext_map.entry(ext).or_insert((0, 0));
        ext_entry.0 += size;
        ext_entry.1 += 1;

        let top_sub = path
            .strip_prefix(root)
            .ok()
            .and_then(|rel| {
                let mut comps = rel.components();
                let first = comps.next()?;
                if comps.next().is_some() {
                    Some(first.as_os_str().to_string_lossy().into_owned())
                } else {
                    Some("(Root files)".into())
                }
            })
            .unwrap_or_else(|| "(Root files)".into());
        let folder_entry = folder_map.entry(top_sub).or_insert((0, 0));
        folder_entry.0 += size;
        folder_entry.1 += 1;

        if size >= min_bytes {
            let modified_at = md
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            if heap.len() < TOP_LARGE_FILES {
                heap.push(Reverse((size, modified_at, path.to_path_buf())));
            } else if let Some(Reverse((min, _, _))) = heap.peek() {
                if size > *min {
                    heap.pop();
                    heap.push(Reverse((size, modified_at, path.to_path_buf())));
                }
            }
        }
    }

    let mut top_files: Vec<LargeFileEntry> = heap
        .into_iter()
        .map(|Reverse((size, modified_at, p))| {
            let name = p
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            let ext = p
                .extension()
                .and_then(|s| s.to_str())
                .map(|s| format!(".{}", s.to_ascii_lowercase()))
                .unwrap_or_else(|| "file".into());
            LargeFileEntry {
                path: p.to_string_lossy().into_owned(),
                name,
                ext,
                size,
                modified_at,
            }
        })
        .collect();
    top_files.sort_by(|a, b| b.size.cmp(&a.size));

    let mut by_extension: Vec<DiskBreakdownItem> = ext_map
        .into_iter()
        .map(|(label, (bytes, files))| DiskBreakdownItem { label, bytes, files })
        .collect();
    by_extension.sort_by(|a, b| b.bytes.cmp(&a.bytes));
    by_extension.truncate(8);

    let mut by_folder: Vec<DiskBreakdownItem> = folder_map
        .into_iter()
        .map(|(label, (bytes, files))| DiskBreakdownItem { label, bytes, files })
        .collect();
    by_folder.sort_by(|a, b| b.bytes.cmp(&a.bytes));
    by_folder.truncate(8);

    Ok(LargeFilesReport {
        total_scanned_bytes,
        total_scanned_files,
        top_files,
        by_extension,
        by_folder,
    })
}

#[derive(Serialize, Clone, Default)]
pub struct DuplicateCleanReport {
    pub files_removed: u64,
    pub bytes_freed: u64,
    pub files_skipped: u64,
}

pub fn delete_duplicates_in(
    dir: &str,
    selected_files: &[String],
    use_trash: bool,
    exclusions: &[PathBuf],
) -> AppResult<DuplicateCleanReport> {
    if selected_files.is_empty() {
        return Ok(DuplicateCleanReport::default());
    }
    let groups = find_duplicates_with_exclusions(dir, MAX_FILES, exclusions)?;
    let selected_set: std::collections::HashSet<&str> = selected_files.iter().map(String::as_str).collect();

    let mut allowed_targets: Vec<(PathBuf, u64)> = Vec::new();
    for group in &groups {
        let mut group_selected: Vec<&String> = group
            .files
            .iter()
            .filter(|f| selected_set.contains(f.as_str()))
            .collect();
        if group_selected.is_empty() {
            continue;
        }
        // Safety guarantee: never allow deleting ALL copies in a duplicate cluster.
        // If the caller selected every file in the cluster, preserve the first copy.
        if group_selected.len() >= group.files.len() {
            group_selected.remove(0);
        }
        for file_str in group_selected {
            allowed_targets.push((PathBuf::from(file_str), group.size));
        }
    }

    let mut report = DuplicateCleanReport::default();
    for (path, size) in allowed_targets {
        let Ok(md) = std::fs::symlink_metadata(&path) else {
            report.files_skipped += 1;
            continue;
        };
        if !md.is_file() || safety::metadata_is_link_like(&md) {
            report.files_skipped += 1;
            continue;
        }
        let ok = if use_trash {
            trash::delete(&path).is_ok()
        } else {
            std::fs::remove_file(&path).is_ok()
        };
        if ok {
            report.files_removed += 1;
            report.bytes_freed += size;
        } else {
            report.files_skipped += 1;
        }
    }

    Ok(report)
}

/// Pro feature: requires an active licence (checked here, in Rust).
#[tauri::command]
pub async fn find_duplicates(state: State<'_, AppState>, dir: String) -> AppResult<Vec<DuplicateGroup>> {
    state.licensing.require_active().await?;
    let exclusions = safety::load_exclusions(&state.data_dir);
    tauri::async_runtime::spawn_blocking(move || find_duplicates_with_exclusions(&dir, MAX_FILES, &exclusions))
        .await
        .map_err(|e| AppError::Other(format!("background task failed: {e}")))?
}

/// Pro feature: safely removes selected duplicate files (moving to Recycle Bin by default)
/// while guaranteeing at least one copy of every duplicate group is kept.
#[tauri::command]
pub async fn delete_duplicates(
    state: State<'_, AppState>,
    dir: String,
    files: Vec<String>,
    use_trash: bool,
) -> AppResult<DuplicateCleanReport> {
    state.licensing.require_active().await?;
    let exclusions = safety::load_exclusions(&state.data_dir);
    tauri::async_runtime::spawn_blocking(move || delete_duplicates_in(&dir, &files, use_trash, &exclusions))
        .await
        .map_err(|e| AppError::Other(format!("background task failed: {e}")))?
}

/// Large-file finder & disk visualiser (#7).
#[tauri::command]
pub async fn scan_large_files(
    state: State<'_, AppState>,
    dir: String,
    min_bytes: u64,
) -> AppResult<LargeFilesReport> {
    let exclusions = safety::load_exclusions(&state.data_dir);
    tauri::async_runtime::spawn_blocking(move || scan_large_files_in(&dir, min_bytes, MAX_FILES, &exclusions))
        .await
        .map_err(|e| AppError::Other(format!("background task failed: {e}")))?
}

/// Safely move a selected large file to the system Recycle Bin / Trash.
#[tauri::command]
pub async fn delete_large_file(state: State<'_, AppState>, path: String) -> AppResult<u64> {
    state.licensing.require_active().await?;
    let target = PathBuf::from(path.trim());
    if !target.is_absolute() {
        return Err(AppError::Other("File path must be absolute.".into()));
    }
    #[cfg(windows)]
    {
        for var in ["SystemRoot", "ProgramFiles", "ProgramFiles(x86)", "ProgramData"] {
            if let Ok(v) = std::env::var(var) {
                if safety::is_within(&target, Path::new(&v)) {
                    return Err(AppError::Other("Refusing to delete a protected Windows or Program Files item.".into()));
                }
            }
        }
    }
    let md = std::fs::symlink_metadata(&target)
        .map_err(|_| AppError::NotFound("File no longer exists".into()))?;
    if !md.is_file() || safety::metadata_is_link_like(&md) {
        return Err(AppError::Other("Refusing to remove symlink or non-file.".into()));
    }
    let size = md.len();
    tauri::async_runtime::spawn_blocking(move || {
        trash::delete(&target).map_err(|e| AppError::Other(format!("Could not move file to Recycle Bin: {e}")))?;
        Ok(size)
    })
    .await
    .map_err(|e| AppError::Other(format!("background task failed: {e}")))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_dupes_and_enforces_limits() {
        assert!(find_duplicates_in("relative/dir", MAX_FILES).is_err());
        let dir = std::env::temp_dir().join(format!("sweepr-dupes-test-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        std::fs::write(dir.join("a.txt"), b"same content").unwrap();
        std::fs::write(dir.join("sub").join("b.txt"), b"same content").unwrap();
        std::fs::write(dir.join("c.txt"), b"other content").unwrap();
        let d = dir.to_string_lossy().to_string();
        let groups = find_duplicates_in(&d, MAX_FILES).unwrap();
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].files.len(), 2);
        assert!(find_duplicates_in(&d, 2).is_err());
        assert!(find_duplicates_in(&dir.join("a.txt").to_string_lossy(), MAX_FILES).is_err());

        // Attempting to delete BOTH copies in the group must preserve at least 1 copy.
        let all_files = groups[0].files.clone();
        let rep = delete_duplicates_in(&d, &all_files, false, &[]).unwrap();
        assert_eq!(rep.files_removed, 1);
        assert!(dir.join("a.txt").exists() || dir.join("sub").join("b.txt").exists());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn scans_large_files_and_breakdowns() {
        let dir = std::env::temp_dir().join(format!("sweepr-large-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("videos")).unwrap();
        std::fs::write(dir.join("videos").join("movie.mp4"), vec![b'x'; 2048]).unwrap();
        std::fs::write(dir.join("notes.txt"), vec![b'y'; 64]).unwrap();

        let d = dir.to_string_lossy().to_string();
        let rep = scan_large_files_in(&d, 1024, MAX_FILES, &[]).unwrap();
        assert_eq!(rep.total_scanned_files, 2);
        assert_eq!(rep.top_files.len(), 1);
        assert_eq!(rep.top_files[0].name, "movie.mp4");
        assert!(!rep.by_extension.is_empty());
        assert!(!rep.by_folder.is_empty());

        let _ = std::fs::remove_dir_all(&dir);
    }
}
