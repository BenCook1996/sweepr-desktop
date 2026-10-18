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

/// Same as [`is_safe_root`], except `dirs::download_dir()` is permitted when the
/// rule enforces at least a 30-day minimum file age (`min_age_hours >= 24 * 30`).
pub fn is_safe_scan_root(root: &Path, min_age_hours: u64) -> bool {
    if is_safe_root(root) {
        return true;
    }
    if min_age_hours >= 24 * 30 {
        if let Some(dl) = dirs::download_dir() {
            if root.is_absolute() && paths_equal(&dl, root) {
                return true;
            }
        }
    }
    false
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
    match entry.metadata() {
        Ok(md) => metadata_is_link_like(&md),
        Err(_) => false,
    }
}

/// Same test as [`is_link_like`] for metadata obtained via
/// `std::fs::symlink_metadata` (which does not follow links).
pub fn metadata_is_link_like(md: &std::fs::Metadata) -> bool {
    if md.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        if md.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return true;
        }
    }
    false
}

/// Normalise a path for prefix comparison: strip the Windows verbatim prefix
/// produced by `canonicalize`, unify separators and case, trim trailing slashes.
fn normalise_for_compare(p: &Path) -> String {
    let s = p.to_string_lossy();
    #[cfg(windows)]
    {
        let s = if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
            format!(r"\\{rest}")
        } else if let Some(rest) = s.strip_prefix(r"\\?\") {
            rest.to_string()
        } else {
            s.to_string()
        };
        s.replace('/', "\\").trim_end_matches('\\').to_lowercase()
    }
    #[cfg(not(windows))]
    {
        s.trim_end_matches('/').to_string()
    }
}

/// True if `child` is `parent` or lies inside it. Both paths should be
/// absolute; they are canonicalised when possible.
pub fn is_within(child: &Path, parent: &Path) -> bool {
    let c = std::fs::canonicalize(child).unwrap_or_else(|_| child.to_path_buf());
    let p = std::fs::canonicalize(parent).unwrap_or_else(|_| parent.to_path_buf());
    let (c, p) = (normalise_for_compare(&c), normalise_for_compare(&p));
    if p.is_empty() {
        // Filesystem root ("/"): everything is inside it.
        return true;
    }
    let sep = if cfg!(windows) { '\\' } else { '/' };
    c == p || (c.starts_with(&p) && c[p.len()..].starts_with(sep))
}

/// True if `path` matches or is inside any user-configured exclusion path.
pub fn is_excluded(path: &Path, exclusions: &[ std::path::PathBuf ]) -> bool {
    exclusions.iter().any(|ex| is_within(path, ex))
}

fn exclusions_file(data_dir: &Path) -> std::path::PathBuf {
    data_dir.join("exclusions.json")
}

pub fn load_exclusions(data_dir: &Path) -> Vec<std::path::PathBuf> {
    let file = exclusions_file(data_dir);
    let Ok(raw) = std::fs::read_to_string(file) else {
        return Vec::new();
    };
    let list: Vec<String> = serde_json::from_str(&raw).unwrap_or_default();
    list.into_iter()
        .map(std::path::PathBuf::from)
        .filter(|p| p.is_absolute())
        .collect()
}

pub fn save_exclusions(data_dir: &Path, paths: &[std::path::PathBuf]) -> std::io::Result<()> {
    std::fs::create_dir_all(data_dir)?;
    let strings: Vec<String> = paths.iter().map(|p| p.to_string_lossy().into_owned()).collect();
    let json = serde_json::to_string_pretty(&strings).unwrap_or_else(|_| "[]".into());
    std::fs::write(exclusions_file(data_dir), json)
}

pub fn system_powershell_path() -> std::path::PathBuf {
    if let Some(root) = std::env::var_os("SystemRoot") {
        let candidate = std::path::PathBuf::from(root).join(r"System32\WindowsPowerShell\v1.0\powershell.exe");
        if candidate.exists() {
            return candidate;
        }
    }
    std::path::PathBuf::from("powershell.exe")
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

    #[test]
    fn containment() {
        let t = std::fs::canonicalize(std::env::temp_dir()).unwrap();
        assert!(is_within(&t.join("a").join("b.txt"), &t));
        assert!(is_within(&t, &t));
        let sibling = format!("{}-sibling", t.to_string_lossy().trim_end_matches(['\\', '/']));
        assert!(!is_within(Path::new(&sibling), &t));
    }

    #[test]
    fn exclusions_match_files_and_dirs() {
        let t = std::fs::canonicalize(std::env::temp_dir()).unwrap();
        let ex = vec![t.join("keep_dir"), t.join("keep_file.log")];
        assert!(is_excluded(&t.join("keep_dir").join("nested.bin"), &ex));
        assert!(is_excluded(&t.join("keep_file.log"), &ex));
        assert!(!is_excluded(&t.join("other.log"), &ex));
    }
}
