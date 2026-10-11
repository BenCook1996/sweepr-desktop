//! Cleaning executor. Re-walks targets at clean time (never trusts a path list
//! from the UI). Files in use are skipped, not forced.

use crate::rules::Rule;
use crate::scanner::for_each_target;
use serde::Serialize;
use std::path::PathBuf;
use walkdir::WalkDir;

const TRASH_BATCH: usize = 256;

#[derive(Serialize, Clone, Default)]
pub struct CleanReport {
    pub category_id: String,
    pub bytes_freed: u64,
    pub files_removed: u64,
    pub files_skipped: u64,
    pub moved_to_trash: bool,
}

pub fn clean(rule: &Rule, use_trash: bool) -> CleanReport {
    let mut targets: Vec<(PathBuf, u64)> = Vec::new();
    for_each_target(rule, |p, size| targets.push((p.to_path_buf(), size)));

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
