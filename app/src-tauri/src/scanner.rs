//! Parallel, read-only scanning. Reports only real, measured bytes.

use crate::rules::{Group, Rule};
use crate::safety;
use rayon::prelude::*;
use serde::Serialize;
use std::cmp::Reverse;
use std::collections::BinaryHeap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::time::{Duration, Instant, SystemTime};
use walkdir::WalkDir;

const TOP_FILES: usize = 50;

#[derive(Serialize, Clone)]
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

/// Walk every eligible file of a rule. This is the single source of truth used
/// by BOTH scanning and cleaning, so the cleaner can never touch a file the
/// scanner wouldn't have reported.
pub fn for_each_target(rule: &Rule, mut f: impl FnMut(&Path, u64)) {
    let cutoff = SystemTime::now()
        .checked_sub(Duration::from_secs(rule.min_age_hours * 3600))
        .unwrap_or(SystemTime::UNIX_EPOCH);

    for root in &rule.roots {
        if !safety::is_safe_root(root) {
            continue;
        }
        let walker = WalkDir::new(root)
            .follow_links(false)
            .min_depth(1)
            .into_iter()
            .filter_entry(|e| !safety::is_link_like(e));

        for entry in walker.flatten() {
            if !entry.file_type().is_file() || !entry.path().starts_with(root) {
                continue;
            }
            let Ok(md) = entry.metadata() else { continue };
            if rule.min_age_hours > 0 {
                match md.modified() {
                    Ok(m) if m <= cutoff => {}
                    _ => continue,
                }
            }
            f(entry.path(), md.len());
        }
    }
}

fn scan_rule(rule: &Rule) -> CategoryResult {
    let mut bytes = 0u64;
    let mut files = 0u64;
    let mut heap: BinaryHeap<Reverse<(u64, PathBuf)>> = BinaryHeap::new();

    for_each_target(rule, |path, size| {
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

pub fn scan_all(rules: &[Rule], on_progress: impl Fn(ScanProgress) + Sync) -> ScanReport {
    let started = Instant::now();
    let done = AtomicUsize::new(0);
    let bytes_so_far = AtomicU64::new(0);
    let total = rules.len();

    let mut categories: Vec<CategoryResult> = rules
        .par_iter()
        .map(|rule| {
            let res = scan_rule(rule);
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
