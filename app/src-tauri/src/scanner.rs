//! Parallel, read-only scanning. Reports only real, measured bytes.

use crate::rules::{Group, Rule};
use crate::safety;
use rayon::prelude::*;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashMap, HashSet};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::time::{Duration, Instant, SystemTime};
use walkdir::WalkDir;

const TOP_FILES: usize = 50;
const MIN_DUP_SIZE: u64 = 1024;
const MAX_QUICK_DUP_BYTES: u64 = 512 * 1024 * 1024;
const MAX_DUP_FILES: usize = 60_000;
const MAX_FILES_PER_ROOT: usize = 50_000;
const DUP_SKIP_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    ".gradle",
    ".cargo",
    ".rustup",
    ".vscode",
    ".idea",
    ".agents",
    "appdata",
    "library",
    "__pycache__",
    ".next",
    "dist",
    "build",
    "venv",
    ".venv",
];

#[derive(Serialize, Clone, Debug)]
pub struct FileEntry {
    pub path: String,
    pub size: u64,
}

#[derive(Serialize, Clone)]
pub struct CategoryResult {
    pub id: String,
    pub name: String,
    pub description: String,
    pub group: Group,
    pub free: bool,
    pub bytes: u64,
    pub files: u64,
    pub roots: Vec<String>,
    pub top_files: Vec<FileEntry>,
}

#[derive(Serialize, Clone)]
pub struct ScanReport {
    pub categories: Vec<CategoryResult>,
    pub total_bytes: u64,
    pub total_files: u64,
    pub duration_ms: u64,
}

#[derive(Serialize, Clone)]
pub struct ScanProgress {
    pub done: usize,
    pub total: usize,
    pub category_id: String,
    pub category_name: String,
    pub bytes_so_far: u64,
}

/// Collect lowercase filenames recently opened by the user according to the OS
/// (e.g., `%APPDATA%\Microsoft\Windows\Recent\*.lnk` modified/accessed after `cutoff`).
fn recently_used_file_names(cutoff: SystemTime) -> HashSet<String> {
    let mut set = HashSet::new();
    #[cfg(target_os = "windows")]
    if let Some(roaming) = dirs::data_dir() {
        let recent_dir = roaming.join("Microsoft").join("Windows").join("Recent");
        if let Ok(rd) = std::fs::read_dir(recent_dir) {
            for entry in rd.flatten() {
                let Ok(md) = entry.metadata() else { continue };
                let is_recent_lnk = md.modified().map(|t| t > cutoff).unwrap_or(false)
                    || md.accessed().map(|t| t > cutoff).unwrap_or(false)
                    || md.created().map(|t| t > cutoff).unwrap_or(false);
                if !is_recent_lnk {
                    continue;
                }
                let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
                if let Some(target_name) = name.strip_suffix(".lnk") {
                    if !target_name.is_empty() {
                        set.insert(target_name.to_string());
                    }
                }
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    let _ = cutoff;
    set
}

/// Check if a file is currently held open by any running process without
/// touching its `LastAccessTime` metadata.
fn is_file_currently_in_use(path: &Path) -> bool {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::fs::OpenOptionsExt;
        // `access_mode(0)` requests metadata-only access (does not read data or update LastAccessTime).
        // `share_mode(0)` fails with ERROR_SHARING_VIOLATION (32) if any process has an open handle.
        match std::fs::OpenOptions::new().access_mode(0).share_mode(0).open(path) {
            Ok(_) => false,
            Err(e) => e.raw_os_error() == Some(32),
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = path;
        false
    }
}

/// Verify that a file is both older than `cutoff` AND unused since `cutoff`.
pub fn is_file_old_and_unused(
    path: &Path,
    md: &std::fs::Metadata,
    cutoff: SystemTime,
    recent_names: &HashSet<String>,
) -> bool {
    // 1. Must not have been modified after cutoff
    match md.modified() {
        Ok(m) if m <= cutoff => {}
        _ => return false,
    }
    // 2. Must not have been created/downloaded onto this system after cutoff
    if let Ok(created) = md.created() {
        if created > cutoff {
            return false;
        }
    }
    // 3. Must not have been accessed/opened after cutoff
    if let Ok(accessed) = md.accessed() {
        if accessed > cutoff {
            return false;
        }
    }
    // 4. Must not appear in OS Recent Items within the cutoff window
    if let Some(fname) = path.file_name().map(|n| n.to_string_lossy().to_ascii_lowercase()) {
        if recent_names.contains(&fname) {
            return false;
        }
        if let Some(stem) = path.file_stem().map(|s| s.to_string_lossy().to_ascii_lowercase()) {
            if recent_names.contains(&stem) {
                return false;
            }
        }
    }
    // 5. Must not be currently open/locked by any running application
    if is_file_currently_in_use(path) {
        return false;
    }
    true
}

fn is_copy_filename(path: &Path) -> bool {
    let Some(stem) = path.file_stem().map(|s| s.to_string_lossy().to_ascii_lowercase()) else {
        return false;
    };
    if stem.ends_with(" - copy") || stem.ends_with(" copy") || stem.contains(" - copy (") {
        return true;
    }
    if let Some(open_idx) = stem.rfind(" (") {
        if let Some(inside) = stem[open_idx + 2..].strip_suffix(')') {
            if !inside.is_empty() && inside.chars().all(|c| c.is_ascii_digit()) {
                return true;
            }
        }
    }
    false
}

fn partial_file_hash(path: &Path, size: u64) -> Option<[u8; 32]> {
    let mut file = File::open(path).ok()?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 8192];
    if size <= 16_384 {
        loop {
            let n = file.read(&mut buf).ok()?;
            if n == 0 {
                break;
            }
            hasher.update(&buf[..n]);
        }
    } else {
        hasher.update(size.to_le_bytes());
        let n1 = file.read(&mut buf).ok()?;
        hasher.update(&buf[..n1]);
        file.seek(SeekFrom::End(-8192)).ok()?;
        let n2 = file.read(&mut buf).ok()?;
        hasher.update(&buf[..n2]);
    }
    Some(hasher.finalize().into())
}

fn full_file_hash(path: &Path) -> Option<[u8; 32]> {
    let mut file = File::open(path).ok()?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 65536];
    loop {
        let n = file.read(&mut buf).ok()?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Some(hasher.finalize().into())
}

fn for_each_device_duplicate(
    roots: &[PathBuf],
    exclusions: &[PathBuf],
    mut f: impl FnMut(&Path, u64),
) {
    let mut by_size: HashMap<u64, Vec<(PathBuf, u64)>> = HashMap::new();
    let mut visited: HashSet<String> = HashSet::new();
    let mut scanned = 0usize;

    for root in roots {
        if !root.exists() || safety::is_excluded(root, exclusions) {
            continue;
        }
        let walker = WalkDir::new(root)
            .follow_links(false)
            .min_depth(1)
            .max_depth(6)
            .into_iter()
            .filter_entry(|e| {
                if safety::is_link_like(e) || safety::is_excluded(e.path(), exclusions) {
                    return false;
                }
                if e.file_type().is_dir() && e.depth() > 0 {
                    let name = e.file_name().to_string_lossy().to_ascii_lowercase();
                    if DUP_SKIP_DIRS.iter().any(|skip| name == *skip) {
                        return false;
                    }
                }
                true
            });

        for entry in walker.flatten() {
            if scanned >= MAX_DUP_FILES {
                break;
            }
            if !entry.file_type().is_file() || !entry.path().starts_with(root) {
                continue;
            }
            if safety::is_excluded(entry.path(), exclusions) {
                continue;
            }
            let Ok(md) = entry.metadata() else { continue };
            let len = md.len();
            if len < MIN_DUP_SIZE || len > MAX_QUICK_DUP_BYTES {
                continue;
            }
            let norm_key = entry.path().to_string_lossy().to_ascii_lowercase();
            if !visited.insert(norm_key) {
                continue;
            }
            scanned += 1;
            let ts = md
                .created()
                .or_else(|_| md.modified())
                .ok()
                .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(u64::MAX);
            by_size.entry(len).or_default().push((entry.into_path(), ts));
        }
    }

    for (size, candidates) in by_size {
        if candidates.len() < 2 {
            continue;
        }
        let mut by_partial: HashMap<[u8; 32], Vec<(PathBuf, u64)>> = HashMap::new();
        for (p, ts) in candidates {
            if let Some(ph) = partial_file_hash(&p, size) {
                by_partial.entry(ph).or_default().push((p, ts));
            }
        }

        for (_ph, partial_group) in by_partial {
            if partial_group.len() < 2 {
                continue;
            }
            if size <= 16_384 {
                let mut group = partial_group;
                group.sort_by(|(pa, tsa), (pb, tsb)| {
                    is_copy_filename(pa)
                        .cmp(&is_copy_filename(pb))
                        .then_with(|| tsa.cmp(tsb))
                        .then_with(|| pa.as_os_str().len().cmp(&pb.as_os_str().len()))
                        .then_with(|| pa.cmp(pb))
                });
                for (dup_path, _) in &group[1..] {
                    if !is_file_currently_in_use(dup_path) {
                        f(dup_path, size);
                    }
                }
            } else {
                let mut by_full: HashMap<[u8; 32], Vec<(PathBuf, u64)>> = HashMap::new();
                for (p, ts) in partial_group {
                    if let Some(fh) = full_file_hash(&p) {
                        by_full.entry(fh).or_default().push((p, ts));
                    }
                }
                for (_fh, mut group) in by_full {
                    if group.len() < 2 {
                        continue;
                    }
                    group.sort_by(|(pa, tsa), (pb, tsb)| {
                        is_copy_filename(pa)
                            .cmp(&is_copy_filename(pb))
                            .then_with(|| tsa.cmp(tsb))
                            .then_with(|| pa.as_os_str().len().cmp(&pb.as_os_str().len()))
                            .then_with(|| pa.cmp(pb))
                    });
                    for (dup_path, _) in &group[1..] {
                        if !is_file_currently_in_use(dup_path) {
                            f(dup_path, size);
                        }
                    }
                }
            }
        }
    }
}

/// Walk every eligible file of a rule. This is the single source of truth used
/// by BOTH scanning and cleaning, so the cleaner can never touch a file the
/// scanner wouldn't have reported.
#[allow(dead_code)]
pub fn for_each_target(rule: &Rule, f: impl FnMut(&Path, u64)) {
    for_each_target_with_exclusions(rule, &[], f);
}

pub fn for_each_target_with_exclusions(rule: &Rule, exclusions: &[PathBuf], mut f: impl FnMut(&Path, u64)) {
    if rule.id == "duplicates" {
        for_each_device_duplicate(&rule.roots, exclusions, f);
        return;
    }

    let cutoff = SystemTime::now()
        .checked_sub(Duration::from_secs(rule.min_age_hours * 3600))
        .unwrap_or(SystemTime::UNIX_EPOCH);
    let check_unused = rule.id == "downloads";
    let recent_names = if check_unused {
        recently_used_file_names(cutoff)
    } else {
        HashSet::new()
    };

    for root in &rule.roots {
        if !safety::is_safe_scan_root(root, rule.min_age_hours) || safety::is_excluded(root, exclusions) {
            continue;
        }
        let walker = WalkDir::new(root)
            .follow_links(false)
            .min_depth(1)
            .into_iter()
            .filter_entry(|e| !safety::is_link_like(e) && !safety::is_excluded(e.path(), exclusions));

        let mut root_files = 0usize;
        for entry in walker.flatten() {
            if root_files >= MAX_FILES_PER_ROOT {
                break;
            }
            if !entry.file_type().is_file() || !entry.path().starts_with(root) {
                continue;
            }
            if safety::is_excluded(entry.path(), exclusions) {
                continue;
            }
            let Ok(md) = entry.metadata() else { continue };
            if check_unused {
                if !is_file_old_and_unused(entry.path(), &md, cutoff, &recent_names) {
                    continue;
                }
            } else if rule.min_age_hours > 0 {
                match md.modified() {
                    Ok(m) if m <= cutoff => {}
                    _ => continue,
                }
            }
            root_files += 1;
            f(entry.path(), md.len());
        }
    }
}

fn scan_rule(rule: &Rule, exclusions: &[PathBuf]) -> CategoryResult {
    let mut bytes = 0u64;
    let mut files = 0u64;
    let mut heap: BinaryHeap<Reverse<(u64, PathBuf)>> = BinaryHeap::new();

    for_each_target_with_exclusions(rule, exclusions, |path, size| {
        bytes += size;
        files += 1;
        if heap.len() < TOP_FILES {
            heap.push(Reverse((size, path.to_path_buf())));
        } else if let Some(Reverse((min, _))) = heap.peek() {
            if size > *min {
                heap.pop();
                heap.push(Reverse((size, path.to_path_buf())));
            }
        }
    });

    let mut top: Vec<FileEntry> = heap
        .into_iter()
        .map(|Reverse((size, p))| FileEntry { path: p.to_string_lossy().into_owned(), size })
        .collect();
    top.sort_by(|a, b| b.size.cmp(&a.size));

    CategoryResult {
        id: rule.id.to_string(),
        name: rule.name.to_string(),
        description: rule.description.to_string(),
        group: rule.group,
        free: rule.free,
        bytes,
        files,
        roots: rule.roots.iter().map(|r| r.to_string_lossy().into_owned()).collect(),
        top_files: top,
    }
}

#[allow(dead_code)]
pub fn scan_all(rules: &[Rule], on_progress: impl Fn(ScanProgress) + Sync) -> ScanReport {
    scan_all_with_exclusions(rules, &[], on_progress)
}

pub fn scan_all_with_exclusions(
    rules: &[Rule],
    exclusions: &[PathBuf],
    on_progress: impl Fn(ScanProgress) + Sync,
) -> ScanReport {
    let started = Instant::now();
    let done = AtomicUsize::new(0);
    let bytes_so_far = AtomicU64::new(0);
    let total = rules.len();

    let mut categories: Vec<CategoryResult> = rules
        .par_iter()
        .map(|rule| {
            let res = scan_rule(rule, exclusions);
            let b = bytes_so_far.fetch_add(res.bytes, Ordering::Relaxed) + res.bytes;
            let d = done.fetch_add(1, Ordering::Relaxed) + 1;
            on_progress(ScanProgress {
                done: d,
                total,
                category_id: res.id.clone(),
                category_name: res.name.clone(),
                bytes_so_far: b,
            });
            res
        })
        .collect();

    categories.sort_by(|a, b| b.bytes.cmp(&a.bytes));
    let total_bytes = categories.iter().map(|c| c.bytes).sum();
    let total_files = categories.iter().map(|c| c.files).sum();

    ScanReport {
        categories,
        total_bytes,
        total_files,
        duration_ms: started.elapsed().as_millis() as u64,
    }
}

#[derive(Serialize, Clone, Debug)]
pub struct StaleDevArtifactEntry {
    pub artifact_path: String,
    pub project_root: String,
    pub artifact_kind: String,
    pub size_bytes: u64,
    pub files_count: u64,
    pub last_source_modified_secs: u64,
    pub inactive_days: u64,
}

#[derive(Serialize, Clone, Debug)]
pub struct DockerDiskInspection {
    pub vhdx_files: Vec<FileEntry>,
    pub total_vhdx_bytes: u64,
    pub buildkit_reclaimable_bytes: u64,
}

#[derive(Serialize, Clone, Debug)]
pub struct StaleDevArtifactsReport {
    pub artifacts: Vec<StaleDevArtifactEntry>,
    pub total_artifact_bytes: u64,
    pub total_artifact_files: u64,
    pub docker: DockerDiskInspection,
    pub duration_ms: u64,
}

const STALE_ARTIFACT_DIRS: &[&str] = &[
    "node_modules",
    "target",
    ".next",
    ".nuxt",
    ".gradle",
    ".venv",
];

pub fn default_dev_project_roots() -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Some(home) = dirs::home_dir() {
        for sub in [
            "Projects",
            "Repos",
            "source/repos",
            "dev",
            "workspace",
            "code",
            "GitHub",
            "Desktop",
            "Documents",
        ] {
            let candidate = home.join(sub);
            if candidate.is_dir() && !roots.iter().any(|r| r == &candidate) {
                roots.push(candidate);
            }
        }
        if roots.is_empty() {
            roots.push(home);
        }
    }
    roots
}

fn measure_dir_bytes_and_files(dir: &Path, exclusions: &[PathBuf]) -> (u64, u64) {
    let mut bytes = 0u64;
    let mut files = 0u64;
    let walker = WalkDir::new(dir)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| !safety::is_link_like(e) && !safety::is_excluded(e.path(), exclusions));
    for entry in walker.flatten() {
        if files >= MAX_FILES_PER_ROOT as u64 {
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

/// Find the most recent modification timestamp (unix seconds) among source/manifest files
/// in `project_root`, ignoring heavy build/dependency artifact subdirectories.
fn latest_project_source_modified_secs(project_root: &Path) -> Option<u64> {
    let mut latest: Option<u64> = None;
    let walker = WalkDir::new(project_root)
        .follow_links(false)
        .min_depth(1)
        .max_depth(4)
        .into_iter()
        .filter_entry(|e| {
            if safety::is_link_like(e) {
                return false;
            }
            if e.file_type().is_dir() && e.depth() > 0 {
                let name = e.file_name().to_string_lossy().to_ascii_lowercase();
                if STALE_ARTIFACT_DIRS.iter().any(|k| name == *k)
                    || name == ".git"
                    || name == "dist"
                    || name == "build"
                    || name == "__pycache__"
                {
                    return false;
                }
            }
            true
        });

    let mut checked = 0usize;
    for entry in walker.flatten() {
        if checked >= 2_500 {
            break;
        }
        if !entry.file_type().is_file() {
            continue;
        }
        checked += 1;
        if let Ok(md) = entry.metadata() {
            if let Ok(m) = md.modified() {
                if let Ok(dur) = m.duration_since(SystemTime::UNIX_EPOCH) {
                    let secs = dur.as_secs();
                    latest = Some(latest.map_or(secs, |prev| prev.max(secs)));
                }
            }
        }
    }
    latest
}

pub fn inspect_docker_disk() -> DockerDiskInspection {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(local) = dirs::data_local_dir() {
        candidates.push(local.join("Docker/wsl/data/ext4.vhdx"));
        candidates.push(local.join("Docker/wsl/disk/docker_data.vhdx"));
        candidates.push(local.join("Docker/wsl/main/ext4.vhdx"));
        candidates.push(local.join("Docker/wsl/distro/ext4.vhdx"));
    }
    if let Some(home) = dirs::home_dir() {
        candidates.push(
            home.join("Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw"),
        );
        candidates.push(home.join(".docker/desktop/vms/0/data/Docker.raw"));
    }

    let mut vhdx_files: Vec<FileEntry> = Vec::new();
    let mut total_vhdx_bytes = 0u64;
    let mut seen = HashSet::new();
    for path in candidates {
        let key = path.to_string_lossy().to_ascii_lowercase();
        if !seen.insert(key) {
            continue;
        }
        if let Ok(md) = std::fs::metadata(&path) {
            if md.is_file() {
                let sz = md.len();
                total_vhdx_bytes += sz;
                vhdx_files.push(FileEntry {
                    path: path.to_string_lossy().into_owned(),
                    size: sz,
                });
            }
        }
    }

    // Measure local Docker Buildx / BuildKit cache directories if present
    let mut buildkit_reclaimable_bytes = 0u64;
    if let Some(home) = dirs::home_dir() {
        for rel in [".docker/buildx", ".cache/docker-buildkit"] {
            let p = home.join(rel);
            if p.is_dir() {
                let (b, _) = measure_dir_bytes_and_files(&p, &[]);
                buildkit_reclaimable_bytes += b;
            }
        }
    }

    DockerDiskInspection {
        vhdx_files,
        total_vhdx_bytes,
        buildkit_reclaimable_bytes,
    }
}

pub fn scan_stale_dev_artifacts_in(
    search_roots: &[PathBuf],
    exclusions: &[PathBuf],
    min_inactive_days: u64,
) -> StaleDevArtifactsReport {
    let started = Instant::now();
    let now_secs = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let min_age_secs = min_inactive_days.saturating_mul(86_400);
    let cutoff_secs = now_secs.saturating_sub(min_age_secs);

    let mut candidate_artifacts: Vec<(PathBuf, PathBuf, String)> = Vec::new();
    let mut seen_artifacts: HashSet<String> = HashSet::new();

    for root in search_roots {
        if !root.is_dir() || safety::is_excluded(root, exclusions) {
            continue;
        }
        let walker = WalkDir::new(root)
            .follow_links(false)
            .min_depth(1)
            .max_depth(5)
            .into_iter()
            .filter_entry(|e| {
                if safety::is_link_like(e) || safety::is_excluded(e.path(), exclusions) {
                    return false;
                }
                if e.file_type().is_dir() && e.depth() > 0 {
                    let name = e.file_name().to_string_lossy();
                    let lower = name.to_ascii_lowercase();
                    if lower == ".git"
                        || lower == "appdata"
                        || lower == "library"
                        || lower == ".cargo"
                        || lower == ".rustup"
                    {
                        return false;
                    }
                    // If parent of this entry is already one of STALE_ARTIFACT_DIRS, don't recurse deeper for discovery
                    if let Some(parent_name) = e
                        .path()
                        .parent()
                        .and_then(|p| p.file_name())
                        .map(|n| n.to_string_lossy().to_ascii_lowercase())
                    {
                        if STALE_ARTIFACT_DIRS.iter().any(|k| parent_name == *k) {
                            return false;
                        }
                    }
                }
                true
            });

        for entry in walker.flatten() {
            if !entry.file_type().is_dir() {
                continue;
            }
            let dir_name = entry.file_name().to_string_lossy();
            let lower = dir_name.to_ascii_lowercase();
            let Some(&matched_kind) = STALE_ARTIFACT_DIRS.iter().find(|&&k| k == lower) else {
                continue;
            };
            let Some(project_root) = entry.path().parent().map(|p| p.to_path_buf()) else {
                continue;
            };
            // For "target", require a Rust `Cargo.toml` in the parent project so we don't flag arbitrary folders named `target`
            if matched_kind == "target" && !project_root.join("Cargo.toml").is_file() {
                continue;
            }
            let key = entry.path().to_string_lossy().to_ascii_lowercase();
            if seen_artifacts.insert(key) {
                candidate_artifacts.push((
                    entry.path().to_path_buf(),
                    project_root,
                    matched_kind.to_string(),
                ));
            }
        }
    }

    let mut artifacts: Vec<StaleDevArtifactEntry> = candidate_artifacts
        .par_iter()
        .filter_map(|(artifact_dir, project_root, kind)| {
            let last_mod = latest_project_source_modified_secs(project_root)?;
            if last_mod > cutoff_secs {
                return None;
            }
            let (size_bytes, files_count) = measure_dir_bytes_and_files(artifact_dir, exclusions);
            if size_bytes == 0 {
                return None;
            }
            let inactive_days = now_secs.saturating_sub(last_mod) / 86_400;
            Some(StaleDevArtifactEntry {
                artifact_path: artifact_dir.to_string_lossy().into_owned(),
                project_root: project_root.to_string_lossy().into_owned(),
                artifact_kind: kind.clone(),
                size_bytes,
                files_count,
                last_source_modified_secs: last_mod,
                inactive_days,
            })
        })
        .collect();

    artifacts.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
    let total_artifact_bytes = artifacts.iter().map(|a| a.size_bytes).sum();
    let total_artifact_files = artifacts.iter().map(|a| a.files_count).sum();
    let docker = inspect_docker_disk();

    StaleDevArtifactsReport {
        artifacts,
        total_artifact_bytes,
        total_artifact_files,
        docker,
        duration_ms: started.elapsed().as_millis() as u64,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cleaner;

    #[test]
    fn scan_clean_and_quarantine_restore_pipeline() {
        let dir = std::env::temp_dir().join(format!("sweepr-scan-pipeline-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let cache_root = dir.join("cache_root");
        let excluded_sub = cache_root.join("keep_me");
        let data_dir = dir.join("data");
        std::fs::create_dir_all(&excluded_sub).unwrap();
        std::fs::create_dir_all(&data_dir).unwrap();

        let f1 = cache_root.join("junk1.tmp");
        let f2 = cache_root.join("junk2.log");
        let f_excl = excluded_sub.join("protected.dat");
        std::fs::write(&f1, vec![b'a'; 1500]).unwrap();
        std::fs::write(&f2, vec![b'b'; 2500]).unwrap();
        std::fs::write(&f_excl, vec![b'c'; 4000]).unwrap();

        let rule = Rule {
            id: "test_cache",
            name: "Test Cache",
            description: "Temporary test cache",
            group: Group::System,
            free: true,
            min_age_hours: 0,
            roots: vec![cache_root.clone()],
        };
        let exclusions = vec![excluded_sub.clone()];

        let report = scan_all_with_exclusions(std::slice::from_ref(&rule), &exclusions, |_| {});
        assert_eq!(report.total_files, 2);
        assert_eq!(report.total_bytes, 4000);
        assert_eq!(report.categories[0].top_files.len(), 2);

        let clean_rep = cleaner::clean_with_exclusions_and_quarantine(
            &rule,
            false,
            &exclusions,
            Some(&data_dir),
        );
        assert_eq!(clean_rep.files_removed, 2);
        assert_eq!(clean_rep.bytes_freed, 4000);
        assert!(!f1.exists());
        assert!(!f2.exists());
        assert!(f_excl.exists(), "Excluded file must never be touched");

        let q_entries = cleaner::list_quarantine_entries(&data_dir);
        assert_eq!(q_entries.len(), 2);
        for qe in &q_entries {
            cleaner::restore_quarantine_entry(&data_dir, &qe.id).unwrap();
        }
        assert!(f1.exists());
        assert!(f2.exists());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn device_duplicate_rule_prefers_removing_copy_filenames() {
        let dir = std::env::temp_dir().join(format!("sweepr-devdup-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let orig = dir.join("invoice.pdf");
        let copy = dir.join("invoice - Copy.pdf");
        let tiny1 = dir.join("tiny1.txt");
        let tiny2 = dir.join("tiny2.txt");

        let payload = vec![b'Z'; 4096];
        std::fs::write(&orig, &payload).unwrap();
        std::fs::write(&copy, &payload).unwrap();
        std::fs::write(&tiny1, b"small").unwrap();
        std::fs::write(&tiny2, b"small").unwrap();

        let dup_rule = Rule {
            id: "duplicates",
            name: "Duplicate Files",
            description: "Device duplicates",
            group: Group::System,
            free: false,
            min_age_hours: 0,
            roots: vec![dir.clone()],
        };

        let report = scan_all_with_exclusions(&[dup_rule], &[], |_| {});
        assert_eq!(report.total_files, 1);
        assert_eq!(report.total_bytes, 4096);
        assert!(report.categories[0].top_files[0]
            .path
            .ends_with("invoice - Copy.pdf"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn stale_dev_artifacts_scanner_detects_node_modules_and_rust_target() {
        let dir = std::env::temp_dir().join(format!("sweepr-stale-dev-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);

        let js_proj = dir.join("old-web-app");
        let js_nm = js_proj.join("node_modules").join("pkg");
        std::fs::create_dir_all(&js_nm).unwrap();
        std::fs::write(js_proj.join("package.json"), br#"{"name":"old-web-app"}"#).unwrap();
        std::fs::write(js_nm.join("index.js"), vec![b'x'; 2048]).unwrap();

        let rust_proj = dir.join("old-rust-cli");
        let rust_target = rust_proj.join("target").join("debug");
        std::fs::create_dir_all(&rust_target).unwrap();
        std::fs::write(rust_proj.join("Cargo.toml"), b"[package]\nname = \"old\"").unwrap();
        std::fs::write(rust_target.join("app.pdb"), vec![b'r'; 4096]).unwrap();

        // With min_inactive_days = 30, freshly written source files must NOT be flagged as stale
        let fresh_report = scan_stale_dev_artifacts_in(std::slice::from_ref(&dir), &[], 30);
        assert_eq!(fresh_report.artifacts.len(), 0);

        // With min_inactive_days = 0, both node_modules and Rust target are detected
        let zero_day_report = scan_stale_dev_artifacts_in(std::slice::from_ref(&dir), &[], 0);
        assert_eq!(zero_day_report.artifacts.len(), 2);
        assert_eq!(zero_day_report.total_artifact_bytes, 6144);
        assert_eq!(zero_day_report.artifacts[0].artifact_kind, "target");
        assert_eq!(zero_day_report.artifacts[1].artifact_kind, "node_modules");

        let _ = std::fs::remove_dir_all(&dir);
    }
}
