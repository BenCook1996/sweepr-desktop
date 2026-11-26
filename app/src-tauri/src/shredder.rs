//! File shredder: overwrites a single file three times (0x00, 0xFF, 0x55)
//! before deleting it.
//!
//! Honest limits: on SSDs (wear levelling/TRIM), copy-on-write or journaling
//! filesystems, cloud-synced folders and backups/shadow copies, earlier copies
//! of the data may survive. This is best-effort, not a certified sanitiser.

use crate::commands::AppState;
use crate::error::{AppError, AppResult};
use crate::safety;
use serde::Serialize;
use std::fs::OpenOptions;
use std::io::{ErrorKind, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, State};

const WIPE_CHUNK_BYTES: usize = 1024 * 1024; // 1 MiB
const WIPE_RESERVE_HEADROOM_BYTES: u64 = 32 * 1024 * 1024; // 32 MiB OS safety headroom
static WIPE_SEQ: AtomicU64 = AtomicU64::new(1);

#[derive(Serialize, Clone, Debug)]
pub struct DriveMediaInfo {
    pub is_ssd: bool,
    pub media_label: String,
    pub recommended_passes: u8,
    pub kind: String,
    pub is_removable: bool,
    pub mount_point: String,
    pub available_bytes: u64,
    pub total_bytes: u64,
    pub free_space_wipe_allowed: bool,
    pub block_reason: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct DriveSummary {
    pub mount_point: String,
    pub name: String,
    pub kind: String,
    pub is_removable: bool,
    pub available_bytes: u64,
    pub total_bytes: u64,
    pub media_label: String,
    pub free_space_wipe_allowed: bool,
    pub block_reason: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct WipeFreeSpaceReport {
    pub mount_point: String,
    pub bytes_zeroed: u64,
    pub cancelled: bool,
    pub reached_disk_full: bool,
    pub duration_ms: u64,
}

#[derive(Serialize, Clone, Debug)]
pub struct WipeProgress {
    pub bytes_written: u64,
    pub total_bytes: u64,
    pub percent: u8,
    pub status: String,
}

pub fn normalize_drive_input(raw: &str) -> String {
    let mut s = raw.trim().to_string();
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        s = format!(r"\\{rest}");
    } else if let Some(rest) = s.strip_prefix(r"\\?\") {
        s = rest.to_string();
    }
    #[cfg(windows)]
    {
        s = s.replace('/', "\\");
        if s.len() == 2 && s.as_bytes()[0].is_ascii_alphabetic() && s.as_bytes()[1] == b':' {
            s.push('\\');
        }
    }
    #[cfg(not(windows))]
    {
        if s.len() == 2 && s.as_bytes()[0].is_ascii_alphabetic() && s.as_bytes()[1] == b':' {
            s.push('\\');
        }
    }
    s
}

fn format_for_mount_match(raw: &str) -> String {
    let norm = normalize_drive_input(raw);
    if cfg!(windows) {
        norm.to_ascii_uppercase()
    } else {
        norm
    }
}

fn mount_matches_target(mount_fmt: &str, target_fmt: &str) -> bool {
    if mount_fmt.is_empty() {
        return false;
    }
    if mount_fmt == "/" || mount_fmt == "\\" {
        return target_fmt.starts_with(mount_fmt);
    }
    let trimmed_mount = mount_fmt.trim_end_matches(['\\', '/']);
    let trimmed_target = target_fmt.trim_end_matches(['\\', '/']);
    if trimmed_target == trimmed_mount {
        return true;
    }
    if let Some(rest) = trimmed_target.strip_prefix(trimmed_mount) {
        return rest.starts_with('\\') || rest.starts_with('/');
    }
    false
}

pub fn classify_drive_media(
    kind: sysinfo::DiskKind,
    is_removable: bool,
    matched_mount: bool,
) -> (bool, &'static str, &'static str, u8, bool, Option<String>) {
    if !matched_mount {
        return (
            true,
            "unknown",
            "Unknown Media (Blocked for Free-Space Zeroing)",
            1,
            false,
            Some("Blocked: Could not match target path to a verified fixed mechanical HDD volume.".into()),
        );
    }
    if is_removable {
        return (
            true,
            "removable",
            "Removable / Flash Media (USB / SD)",
            1,
            false,
            Some("Blocked: Removable USB/SD/flash media uses wear-leveling and cannot be safely zeroed via free-space fills.".into()),
        );
    }
    match kind {
        sysinfo::DiskKind::HDD => (
            false,
            "hdd",
            "Mechanical Hard Drive (HDD)",
            3,
            true,
            None,
        ),
        sysinfo::DiskKind::SSD => (
            true,
            "ssd",
            "Solid State Drive (SSD / NVMe)",
            1,
            false,
            Some("Blocked: SSD / NVMe drives use wear-leveling and TRIM; free-space zeroing causes unnecessary flash wear and cannot reliably overwrite unmapped blocks.".into()),
        ),
        sysinfo::DiskKind::Unknown(_) => (
            true,
            "unknown",
            "Unknown Drive Type (Blocked for Free-Space Zeroing)",
            1,
            false,
            Some("Blocked: Drive media type could not be verified as a fixed mechanical HDD (refusing to risk SSD wear-leveling).".into()),
        ),
    }
}

#[tauri::command]
pub fn detect_drive_media_type(path: String) -> AppResult<DriveMediaInfo> {
    let normalized = normalize_drive_input(&path);
    let resolved_path = if normalized.is_empty() {
        normalized.clone()
    } else {
        let p = Path::new(&normalized);
        safety::resolve_path_lexically_and_canonically(p)
            .map(|c| normalize_drive_input(&c.to_string_lossy()))
            .unwrap_or_else(|| normalized.clone())
    };
    let target_fmt = format_for_mount_match(&resolved_path);
    let disks = sysinfo::Disks::new_with_refreshed_list();

    let mut matched: Option<(sysinfo::DiskKind, bool, String, u64, u64)> = None;
    let mut best_len = 0usize;
    for d in disks.list() {
        let mount_raw = d.mount_point().to_string_lossy().into_owned();
        let mount_fmt = format_for_mount_match(&mount_raw);
        if mount_matches_target(&mount_fmt, &target_fmt) && mount_fmt.len() >= best_len {
            best_len = mount_fmt.len();
            matched = Some((
                d.kind(),
                d.is_removable(),
                mount_raw,
                d.available_space(),
                d.total_space(),
            ));
        }
    }

    let (is_ssd, kind, media_label, recommended_passes, free_space_wipe_allowed, block_reason, mount_point, available_bytes, total_bytes, is_removable) =
        if let Some((dk, is_rem, mp, avail, total)) = matched {
            let (is_ssd, kind, label, passes, allowed, reason) =
                classify_drive_media(dk, is_rem, true);
            (is_ssd, kind, label, passes, allowed, reason, mp, avail, total, is_rem)
        } else {
            let (is_ssd, kind, label, passes, allowed, reason) =
                classify_drive_media(sysinfo::DiskKind::Unknown(-1), false, false);
            (is_ssd, kind, label, passes, allowed, reason, String::new(), 0, 0, false)
        };

    Ok(DriveMediaInfo {
        is_ssd,
        media_label: media_label.to_string(),
        recommended_passes,
        kind: kind.to_string(),
        is_removable,
        mount_point,
        available_bytes,
        total_bytes,
        free_space_wipe_allowed,
        block_reason,
    })
}

#[tauri::command]
pub fn list_wipeable_drives() -> AppResult<Vec<DriveSummary>> {
    let disks = sysinfo::Disks::new_with_refreshed_list();
    let mut out = Vec::new();
    let mut seen_mounts = std::collections::HashSet::new();
    for d in disks.list() {
        let total = d.total_space();
        if total == 0 {
            continue;
        }
        let mount_point = d.mount_point().to_string_lossy().into_owned();
        let key = format_for_mount_match(&mount_point);
        if !seen_mounts.insert(key) {
            continue;
        }
        let (_is_ssd, kind, media_label, _passes, free_space_wipe_allowed, block_reason) =
            classify_drive_media(d.kind(), d.is_removable(), true);
        let disk_name = d.name().to_string_lossy().trim().to_string();
        let name = if disk_name.is_empty() {
            mount_point.clone()
        } else {
            format!("{disk_name} ({mount_point})")
        };
        out.push(DriveSummary {
            mount_point,
            name,
            kind: kind.to_string(),
            is_removable: d.is_removable(),
            available_bytes: d.available_space(),
            total_bytes: total,
            media_label: media_label.to_string(),
            free_space_wipe_allowed,
            block_reason,
        });
    }
    out.sort_by(|a, b| a.mount_point.cmp(&b.mount_point));
    Ok(out)
}

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
    if let Ok(exe) = std::env::current_exe() {
        if let Ok(canon_exe) = std::fs::canonicalize(&exe) {
            if canon == canon_exe {
                return Err(refuse("Refusing to shred running executable."));
            }
        }
    }
    for root in protected_roots(app_data_dir) {
        if safety::is_within(&canon, &root) {
            return Err(refuse(format!("Refusing to shred files inside a protected folder ({}).", root.display())));
        }
    }
    Ok(canon)
}

pub(crate) fn overwrite_and_delete(p: &Path, pass_count: u8) -> AppResult<u64> {
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
        let patterns: &[u8] = if pass_count == 1 {
            &[0x00]
        } else {
            &[0x00, 0xFF, 0x55]
        };

        for &pattern in patterns {
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
    if !std::fs::symlink_metadata(p)
        .map(|m| !m.file_type().is_symlink() && !safety::metadata_is_link_like(&m) && m.is_file())
        .unwrap_or(false)
    {
        return Err(refuse("Refusing to remove symlink or non-regular file after overwrite."));
    }
    std::fs::remove_file(p)?;
    Ok(len)
}

/// Pro feature: requires an active licence (checked here, in Rust).
#[tauri::command]
pub async fn shred_file(
    state: State<'_, AppState>,
    path: String,
    passes: Option<u8>,
) -> AppResult<u64> {
    state.licensing.require_active().await?;
    let canon = validate_target(&path, state.licensing.data_dir())?;
    let pass_count = match passes.unwrap_or(3) {
        1 => 1,
        _ => 3,
    };
    tauri::async_runtime::spawn_blocking(move || overwrite_and_delete(&canon, pass_count))
        .await
        .map_err(|e| AppError::Other(format!("background task failed: {e}")))?
}

struct TempWipeFileGuard {
    path: PathBuf,
    file: Option<std::fs::File>,
}

impl Drop for TempWipeFileGuard {
    fn drop(&mut self) {
        // Close handle before remove_file (required on Windows to avoid sharing violation).
        drop(self.file.take());
        let _ = std::fs::remove_file(&self.path);
    }
}

struct WipeRunningGuard {
    flag: Arc<AtomicBool>,
}

impl Drop for WipeRunningGuard {
    fn drop(&mut self) {
        self.flag.store(false, Ordering::SeqCst);
    }
}

fn is_disk_full_io_error(err: &std::io::Error) -> bool {
    if err.kind() == ErrorKind::StorageFull {
        return true;
    }
    matches!(err.raw_os_error(), Some(112) | Some(39) | Some(28))
}

fn validate_wipe_directory(target_dir: &Path, app_data_dir: &Path) -> AppResult<PathBuf> {
    if !target_dir.is_absolute() {
        return Err(refuse("Free-space wipe target must be an absolute directory path."));
    }
    let md = std::fs::symlink_metadata(target_dir)
        .map_err(|e| refuse(format!("Cannot access target directory: {e}")))?;
    if safety::metadata_is_link_like(&md) {
        return Err(refuse(
            "Refusing to zero free space through a symlink, junction, or reparse point.",
        ));
    }
    if !md.is_dir() {
        return Err(refuse("Free-space wipe target must be an existing directory or drive root."));
    }
    let canon = std::fs::canonicalize(target_dir)
        .map_err(|e| refuse(format!("Cannot resolve target directory: {e}")))?;
    let canon_md = std::fs::symlink_metadata(&canon)
        .map_err(|e| refuse(format!("Cannot inspect resolved directory: {e}")))?;
    if safety::metadata_is_link_like(&canon_md) || !canon_md.is_dir() {
        return Err(refuse("Resolved free-space wipe target is not a regular directory."));
    }
    for root in protected_roots(app_data_dir) {
        if safety::is_within(&canon, &root) {
            return Err(refuse(format!(
                "Refusing to zero free space inside a protected folder ({}).",
                root.display()
            )));
        }
    }
    Ok(canon)
}

pub fn wipe_free_space_in_dir(
    target_dir: &Path,
    app_data_dir: &Path,
    target_bytes: u64,
    cancel: &AtomicBool,
    mut on_progress: impl FnMut(u64, u64),
) -> AppResult<WipeFreeSpaceReport> {
    if target_bytes == 0 {
        return Err(refuse("No available free space above safety headroom to zero."));
    }
    let canon = validate_wipe_directory(target_dir, app_data_dir)?;
    let started = Instant::now();
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let seq = WIPE_SEQ.fetch_add(1, Ordering::Relaxed);
    let wipe_file_path = canon.join(format!(
        ".sweepr_free_wipe_{}_{}_{}.tmp",
        std::process::id(),
        ts,
        seq
    ));

    let mut opts = OpenOptions::new();
    opts.write(true).create_new(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
        opts.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    let file = opts
        .open(&wipe_file_path)
        .map_err(|e| refuse(format!("Could not create temporary zeroing file in {}: {e}", canon.display())))?;

    let mut guard = TempWipeFileGuard {
        path: wipe_file_path,
        file: Some(file),
    };

    let zero_buf = vec![0u8; WIPE_CHUNK_BYTES];
    let mut written: u64 = 0;
    let mut cancelled = false;
    let mut reached_disk_full = false;

    while written < target_bytes {
        if cancel.load(Ordering::Relaxed) {
            cancelled = true;
            break;
        }
        let chunk_len = std::cmp::min(WIPE_CHUNK_BYTES as u64, target_bytes - written) as usize;
        let Some(f) = guard.file.as_mut() else {
            break;
        };
        match f.write(&zero_buf[..chunk_len]) {
            Ok(0) => {
                reached_disk_full = true;
                break;
            }
            Ok(n) => {
                written += n as u64;
                on_progress(written, target_bytes);
            }
            Err(e) if e.kind() == ErrorKind::Interrupted => continue,
            Err(e) if is_disk_full_io_error(&e) => {
                reached_disk_full = true;
                break;
            }
            Err(e) => {
                return Err(refuse(format!("Free-space zeroing write failed: {e}")));
            }
        }
    }

    if !cancelled {
        if let Some(f) = guard.file.as_ref() {
            let _ = f.sync_data();
        }
    }

    drop(guard);

    Ok(WipeFreeSpaceReport {
        mount_point: canon.to_string_lossy().into_owned(),
        bytes_zeroed: written,
        cancelled,
        reached_disk_full,
        duration_ms: started.elapsed().as_millis() as u64,
    })
}

/// Pro feature: zeros unallocated space on a verified fixed mechanical HDD only.
/// Explicitly refuses SSDs, NVMe drives, removable flash drives, and unknown media.
#[tauri::command]
pub async fn wipe_free_space(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> AppResult<WipeFreeSpaceReport> {
    state.licensing.require_active().await?;

    if state
        .wipe_running
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err(refuse("A free-space zeroing operation is already running."));
    }
    let _running_guard = WipeRunningGuard {
        flag: Arc::clone(&state.wipe_running),
    };
    state.wipe_cancel.store(false, Ordering::SeqCst);

    let normalized = normalize_drive_input(&path);
    let target_dir = PathBuf::from(&normalized);
    let canon = validate_wipe_directory(&target_dir, &state.data_dir)?;
    let media_info = detect_drive_media_type(canon.to_string_lossy().into_owned())?;
    if !media_info.free_space_wipe_allowed {
        return Err(refuse(
            media_info
                .block_reason
                .unwrap_or_else(|| "Free-space zeroing is only permitted on verified fixed HDD volumes.".into()),
        ));
    }

    let target_bytes = media_info
        .available_bytes
        .saturating_sub(WIPE_RESERVE_HEADROOM_BYTES);
    if target_bytes == 0 {
        return Err(refuse(
            "Less than 32 MiB of free space is available; leaving safety headroom for the OS.",
        ));
    }

    let data_dir = state.data_dir.clone();
    let cancel_flag = Arc::clone(&state.wipe_cancel);
    let mount_point = media_info.mount_point.clone();

    let mut report = tauri::async_runtime::spawn_blocking(move || {
        let mut last_emit = Instant::now();
        let mut last_emitted_bytes = 0u64;
        let _ = app.emit(
            "shredder://wipe-progress",
            WipeProgress {
                bytes_written: 0,
                total_bytes: target_bytes,
                percent: 0,
                status: "Zeroing unallocated HDD sectors…".into(),
            },
        );
        let res = wipe_free_space_in_dir(&canon, &data_dir, target_bytes, &cancel_flag, |written, total| {
            if written.saturating_sub(last_emitted_bytes) >= 16 * 1024 * 1024
                || last_emit.elapsed().as_millis() >= 200
                || written == total
            {
                last_emit = Instant::now();
                last_emitted_bytes = written;
                let pct = ((written.saturating_mul(100)) / total.max(1)).min(100) as u8;
                let _ = app.emit(
                    "shredder://wipe-progress",
                    WipeProgress {
                        bytes_written: written,
                        total_bytes: total,
                        percent: pct,
                        status: "Zeroing unallocated HDD sectors…".into(),
                    },
                );
            }
        });
        let final_status = match &res {
            Ok(r) if r.cancelled => "Free-space zeroing cancelled; temporary file removed.",
            Ok(_) => "Free-space zeroing complete; temporary file removed.",
            Err(_) => "Free-space zeroing stopped; temporary file cleaned up.",
        };
        if let Ok(ref r) = res {
            let pct = ((r.bytes_zeroed.saturating_mul(100)) / target_bytes.max(1)).min(100) as u8;
            let _ = app.emit(
                "shredder://wipe-progress",
                WipeProgress {
                    bytes_written: r.bytes_zeroed,
                    total_bytes: target_bytes,
                    percent: pct,
                    status: final_status.into(),
                },
            );
        }
        res
    })
    .await
    .map_err(|e| AppError::Other(format!("background task failed: {e}")))??;

    if !mount_point.is_empty() {
        report.mount_point = mount_point;
    }
    Ok(report)
}

#[tauri::command]
pub fn cancel_wipe_free_space(state: State<'_, AppState>) -> bool {
    if state.wipe_running.load(Ordering::SeqCst) {
        state.wipe_cancel.store(true, Ordering::SeqCst);
        true
    } else {
        false
    }
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
        if let Ok(exe) = std::env::current_exe() {
            assert!(validate_target(&exe.to_string_lossy(), &data).is_err());
        }
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
        assert_eq!(overwrite_and_delete(&canon, 1).unwrap(), 5);
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

    #[test]
    fn classify_drive_media_allows_only_fixed_hdd() {
        let (ssd, kind, _, passes, allowed, reason) =
            classify_drive_media(sysinfo::DiskKind::HDD, false, true);
        assert!(!ssd);
        assert_eq!(kind, "hdd");
        assert_eq!(passes, 3);
        assert!(allowed);
        assert!(reason.is_none());

        for (dk, rem, matched, expected_kind) in [
            (sysinfo::DiskKind::SSD, false, true, "ssd"),
            (sysinfo::DiskKind::Unknown(-1), false, true, "unknown"),
            (sysinfo::DiskKind::HDD, true, true, "removable"),
            (sysinfo::DiskKind::SSD, true, true, "removable"),
            (sysinfo::DiskKind::HDD, false, false, "unknown"),
        ] {
            let (is_ssd, k, _, p, allow, rsn) = classify_drive_media(dk, rem, matched);
            assert!(is_ssd);
            assert_eq!(k, expected_kind);
            assert_eq!(p, 1);
            assert!(!allow);
            assert!(rsn.is_some());
        }
    }

    #[test]
    fn normalize_drive_input_handles_bare_drives_and_verbatim_prefixes() {
        assert_eq!(normalize_drive_input("D:"), "D:\\");
        assert_eq!(normalize_drive_input("  d:/folder/sub "), if cfg!(windows) { "d:\\folder\\sub" } else { "d:/folder/sub" });
        assert_eq!(normalize_drive_input(r"\\?\D:\temp"), r"D:\temp");
        assert_eq!(normalize_drive_input(r"\\?\UNC\server\share"), r"\\server\share");
        assert!(mount_matches_target("/mnt/hdd", "/mnt/hdd/data"));
        assert!(!mount_matches_target("/mnt/hdd", "/mnt/hdd2/data"));
    }

    #[test]
    fn wipe_free_space_in_dir_writes_zeroes_cleans_up_and_supports_cancel_and_unwind() {
        let base = std::fs::canonicalize(std::env::temp_dir()).unwrap();
        let dir = base.join(format!("sweepr-wipe-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let work_dir = dir.join("hdd_sim");
        let app_data = dir.join("app_data");
        std::fs::create_dir_all(&work_dir).unwrap();
        std::fs::create_dir_all(&app_data).unwrap();

        // 1. Complete chunked zeroing (> 1 MiB) + guaranteed temp file removal
        let cancel = AtomicBool::new(false);
        let mut progress_calls = Vec::new();
        let target_bytes = 2 * 1024 * 1024 + 4096;
        let report = wipe_free_space_in_dir(&work_dir, &app_data, target_bytes, &cancel, |w, t| {
            progress_calls.push((w, t));
        })
        .unwrap();
        assert_eq!(report.bytes_zeroed, target_bytes);
        assert!(!report.cancelled);
        assert!(!progress_calls.is_empty());
        assert_eq!(progress_calls.last().unwrap().0, target_bytes);
        assert_eq!(
            std::fs::read_dir(&work_dir).unwrap().count(),
            0,
            "Temporary wipe file must be removed after completion"
        );

        // 2. Mid-run cancellation removes temp file cleanly
        let cancel_mid = AtomicBool::new(false);
        let mut seen_first = false;
        let rep_cancel = wipe_free_space_in_dir(
            &work_dir,
            &app_data,
            5 * 1024 * 1024,
            &cancel_mid,
            |_w, _t| {
                if !seen_first {
                    seen_first = true;
                    cancel_mid.store(true, Ordering::SeqCst);
                }
            },
        )
        .unwrap();
        assert!(rep_cancel.cancelled);
        assert!(rep_cancel.bytes_zeroed <= 1024 * 1024);
        assert_eq!(
            std::fs::read_dir(&work_dir).unwrap().count(),
            0,
            "Temporary wipe file must be removed after cancellation"
        );

        // 3. Panic unwind inside callback still cleans up temp file via TempWipeFileGuard::drop
        let cancel_unwind = AtomicBool::new(false);
        let work_clone = work_dir.clone();
        let app_clone = app_data.clone();
        let panic_res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
            let _ = wipe_free_space_in_dir(
                &work_clone,
                &app_clone,
                3 * 1024 * 1024,
                &cancel_unwind,
                |_w, _t| {
                    panic!("simulated mid-wipe panic");
                },
            );
        }));
        assert!(panic_res.is_err());
        assert_eq!(
            std::fs::read_dir(&work_dir).unwrap().count(),
            0,
            "TempWipeFileGuard::drop must close handle and remove temp file on unwind"
        );

        // 4. Rejects protected roots and symlinks
        assert!(wipe_free_space_in_dir(&app_data, &app_data, 1024, &cancel, |_, _| {}).is_err());
        #[cfg(windows)]
        if let Ok(sys) = std::env::var("SystemRoot") {
            let sys32 = Path::new(&sys).join("System32");
            if sys32.is_dir() {
                assert!(wipe_free_space_in_dir(&sys32, &app_data, 1024, &cancel, |_, _| {}).is_err());
            }
        }
        let symlink_dir = dir.join("sym_hdd");
        #[cfg(unix)]
        let sym_ok = std::os::unix::fs::symlink(&work_dir, &symlink_dir).is_ok();
        #[cfg(windows)]
        let sym_ok = std::os::windows::fs::symlink_dir(&work_dir, &symlink_dir).is_ok();
        if sym_ok {
            assert!(wipe_free_space_in_dir(&symlink_dir, &app_data, 1024, &cancel, |_, _| {}).is_err());
        }

        let _ = std::fs::remove_dir_all(&dir);
    }
}

