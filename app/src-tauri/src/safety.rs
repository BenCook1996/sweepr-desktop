//! Defence-in-depth checks applied before anything is scanned or deleted.

use std::path::{Component, Path};
use walkdir::DirEntry;

/// Refuse to operate on roots that are too shallow or are well-known user/system
/// folders, even if a rule were misconfigured.
pub fn is_safe_root(root: &Path) -> bool {
    if !root.is_absolute() {
        return false;
    }
    // Require some depth: e.g. C:\Users\me\AppData\Local\Temp, /home/me/.cache
    let depth = root
        .components()
        .filter(|c| matches!(c, Component::Normal(_)))
        .count();
    if depth < 2 && !paths_equal(root, &std::env::temp_dir()) {
        return false;
    }

    let mut denied: Vec<std::path::PathBuf> = Vec::new();
    if let Some(h) = dirs::home_dir() {
        denied.push(h);
    }
    for d in [
        dirs::document_dir(),
        dirs::desktop_dir(),
        dirs::download_dir(),
        dirs::picture_dir(),
        dirs::video_dir(),
        dirs::audio_dir(),
        dirs::data_dir(),
        dirs::data_local_dir(),
        dirs::config_dir(),
    ]
    .into_iter()
    .flatten()
    {
        denied.push(d);
    }
    #[cfg(windows)]
    {
        for var in ["SystemRoot", "ProgramFiles", "ProgramFiles(x86)", "ProgramData"] {
            if let Ok(v) = std::env::var(var) {
                denied.push(v.into());
            }
        }
    }
    #[cfg(unix)]
    {
        for p in ["/", "/usr", "/bin", "/etc", "/var", "/System", "/Library", "/Applications"] {
            denied.push(p.into());
        }
    }

    // Exact match on a denied folder is refused. Sub-folders (e.g. AppData\Local\Temp) are allowed.
    !denied.iter().any(|d| paths_equal(d, root))
}

fn paths_equal(a: &Path, b: &Path) -> bool {
    #[cfg(windows)]
    {
        a.to_string_lossy().trim_end_matches('\\').eq_ignore_ascii_case(b.to_string_lossy().trim_end_matches('\\'))
    }
    #[cfg(not(windows))]
    {
        a == b
    }
}

/// True for symlinks and (on Windows) any reparse point such as junctions or
/// OneDrive placeholders. We never descend into or delete through these.
pub fn is_link_like(entry: &DirEntry) -> bool {
    if entry.path_is_symlink() || entry.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        if let Ok(md) = entry.metadata() {
            if md.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
                return true;
            }
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_home_and_shallow_paths() {
        if let Some(h) = dirs::home_dir() {
            assert!(!is_safe_root(&h));
        }
        assert!(!is_safe_root(Path::new("relative/path")));
        #[cfg(windows)]
        assert!(!is_safe_root(Path::new("C:\\")));
        #[cfg(unix)]
        assert!(!is_safe_root(Path::new("/")));
    }

    #[test]
    fn allows_temp() {
        assert!(is_safe_root(&std::env::temp_dir()));
    }
}
