//! File shredder: overwrites a single file three times (0x00, 0xFF, 0x55)
//! before deleting it.
//!
//! Honest limits: on SSDs (wear levelling/TRIM), copy-on-write or journaling
//! filesystems, cloud-synced folders and backups/shadow copies, earlier copies
//! of the data may survive. This is best-effort, not a certified sanitiser.

use crate::commands::AppState;
use crate::error::{AppError, AppResult};
use crate::safety;
use std::fs::OpenOptions;
use std::io::{Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use tauri::State;

fn refuse(msg: impl Into<String>) -> AppError {
    AppError::Other(msg.into())
}

/// Folders we never shred inside, regardless of what the UI sends.
fn protected_roots(app_data_dir: &Path) -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = vec![app_data_dir.to_path_buf()];
    #[cfg(windows)]
    {
        for var in ["SystemRoot", "windir", "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432", "ProgramData"] {
            if let Ok(v) = std::env::var(var) {
                if !v.trim().is_empty() {
                    roots.push(PathBuf::from(v));
                }
            }
        }
    }
    #[cfg(unix)]
    {
        for p in ["/System", "/usr", "/bin", "/sbin", "/etc", "/boot", "/lib", "/lib64", "/Library", "/Applications", "/private/etc"] {
            roots.push(PathBuf::from(p));
        }
    }
    roots
}

/// Validate a shred target and return its canonical path.
pub fn validate_target(path: &str, app_data_dir: &Path) -> AppResult<PathBuf> {
    let p = Path::new(path.trim());
    if !p.is_absolute() {
        return Err(refuse("Please enter the full (absolute) path to a file."));
    }
    let md = std::fs::symlink_metadata(p).map_err(|e| refuse(format!("Cannot access file: {e}")))?;
    if safety::metadata_is_link_like(&md) {
        return Err(refuse("Refusing to shred a shortcut, symlink, junction or cloud placeholder."));
    }
    if !md.is_file() {
        return Err(refuse("Target is not a regular file."));
    }
    let canon = std::fs::canonicalize(p).map_err(|e| refuse(format!("Cannot resolve path: {e}")))?;
    // Re-check the resolved target (a parent folder may have been a junction).
    let md2 = std::fs::symlink_metadata(&canon).map_err(|e| refuse(format!("Cannot access file: {e}")))?;
    if safety::metadata_is_link_like(&md2) || !md2.is_file() {
        return Err(refuse("Target is not a regular file."));
    }
    for root in protected_roots(app_data_dir) {
        if safety::is_within(&canon, &root) {
            return Err(refuse(format!("Refusing to shred files inside a protected folder ({}).", root.display())));
        }
    }
    Ok(canon)
}

fn overwrite_and_delete(p: &Path) -> AppResult<u64> {
    let pre_md = std::fs::symlink_metadata(p)?;
    if safety::metadata_is_link_like(&pre_md) || !pre_md.is_file() {
        return Err(refuse("Refusing to shred a symlink, junction or non-regular file."));
    }
    let len = pre_md.len();
    if len > 0 {
        let mut opts = OpenOptions::new();
        opts.write(true);
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
            opts.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
        }
        let mut file = opts.open(p)?;
        let handle_md = file.metadata()?;
        if safety::metadata_is_link_like(&handle_md) || !handle_md.is_file() {
            return Err(refuse("Target changed to a symlink or non-regular file before shredding."));
        }
        let chunk_size = 64 * 1024; // 64 KB chunks
        let passes: [u8; 3] = [0x00, 0xFF, 0x55]; // Pass 1: zeros, Pass 2: ones, Pass 3: 0x55 pattern

        for pattern in passes {
            file.seek(SeekFrom::Start(0))?;
            let buf = vec![pattern; chunk_size];
            let mut written = 0u64;
            while written < len {
                let to_write = std::cmp::min(chunk_size as u64, len - written) as usize;
                file.write_all(&buf[..to_write])?;
                written += to_write as u64;
            }
            file.sync_data()?;
        }
        drop(file);
    }
    std::fs::remove_file(p)?;
    Ok(len)
}

/// Pro feature: requires an active licence (checked here, in Rust).
#[tauri::command]
pub async fn shred_file(state: State<'_, AppState>, path: String) -> AppResult<u64> {
    state.licensing.require_active().await?;
    let canon = validate_target(&path, state.licensing.data_dir())?;
    tauri::async_runtime::spawn_blocking(move || overwrite_and_delete(&canon))
        .await
        .map_err(|e| AppError::Other(format!("background task failed: {e}")))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_relative_missing_and_dirs() {
        let data = std::env::temp_dir().join("sweepr-test-data");
        assert!(validate_target("relative.txt", &data).is_err());
        assert!(validate_target(&std::env::temp_dir().to_string_lossy(), &data).is_err());
        let missing = std::env::temp_dir().join("sweepr-definitely-missing.bin");
        assert!(validate_target(&missing.to_string_lossy(), &data).is_err());
    }

    #[test]
    fn rejects_protected_and_app_data() {
        let dir = std::env::temp_dir().join(format!("sweepr-shred-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("secret.txt");
        std::fs::write(&f, b"hello").unwrap();
        // File inside the app data dir is refused.
        assert!(validate_target(&f.to_string_lossy(), &dir).is_err());
        // Elsewhere it is accepted and can be shredded.
        let other = std::env::temp_dir().join("sweepr-other-data");
        let canon = validate_target(&f.to_string_lossy(), &other).unwrap();
        assert_eq!(overwrite_and_delete(&canon).unwrap(), 5);
        assert!(!f.exists());
        let _ = std::fs::remove_dir_all(&dir);
        #[cfg(windows)]
        if let Ok(root) = std::env::var("SystemRoot") {
            let notepad = Path::new(&root).join("notepad.exe");
            if notepad.exists() {
                assert!(validate_target(&notepad.to_string_lossy(), &other).is_err());
            }
        }
    }
}
