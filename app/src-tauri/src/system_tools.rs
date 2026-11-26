//! Platform system maintenance tools:
//! - #18 macOS System Maintenance Helpers (Spotlight, LaunchServices, DNS flush)
//! - #21 Windows Drive Optimization (TRIM / Defrag)
//! - #23 Windows One-Click Hibernation Toggle (`hiberfil.sys` & `powercfg /hibernate`)

use crate::commands::AppState;
use crate::error::{AppError, AppResult};
#[cfg(target_os = "windows")]
use crate::safety;
#[cfg(target_os = "windows")]
use crate::shredder;
use serde::Serialize;
#[cfg(any(target_os = "windows", target_os = "macos"))]
use std::path::Path;
use tauri::State;

// ---------------------------------------------------------------------------
// #18 macOS System Maintenance Helpers
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MacosMaintenanceTask {
    SpotlightReindex,
    LaunchServicesRebuild,
    DnsFlush,
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MacosMaintenanceSpec {
    pub program: String,
    pub args: Vec<String>,
    pub requires_admin: bool,
    pub display_name: String,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct MacosMaintenanceResult {
    pub task: String,
    pub success: bool,
    pub message: String,
    pub output: String,
}

pub fn parse_macos_maintenance_task(task: &str) -> AppResult<MacosMaintenanceTask> {
    match task.trim() {
        "spotlight_reindex" => Ok(MacosMaintenanceTask::SpotlightReindex),
        "launch_services_rebuild" => Ok(MacosMaintenanceTask::LaunchServicesRebuild),
        "dns_flush" => Ok(MacosMaintenanceTask::DnsFlush),
        other => Err(AppError::Other(format!(
            "Unknown macOS maintenance task: {other}"
        ))),
    }
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
impl MacosMaintenanceTask {
    pub fn as_id(self) -> &'static str {
        match self {
            Self::SpotlightReindex => "spotlight_reindex",
            Self::LaunchServicesRebuild => "launch_services_rebuild",
            Self::DnsFlush => "dns_flush",
        }
    }
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn build_macos_maintenance_spec(task: MacosMaintenanceTask) -> MacosMaintenanceSpec {
    match task {
        MacosMaintenanceTask::SpotlightReindex => MacosMaintenanceSpec {
            program: "osascript".to_string(),
            args: vec![
                "-e".to_string(),
                r#"do shell script "/usr/bin/mdutil -E /" with administrator privileges"#.to_string(),
            ],
            requires_admin: true,
            display_name: "Rebuild Spotlight Index".to_string(),
        },
        MacosMaintenanceTask::LaunchServicesRebuild => MacosMaintenanceSpec {
            program: "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister".to_string(),
            args: vec![
                "-kill".to_string(),
                "-r".to_string(),
                "-domain".to_string(),
                "local".to_string(),
                "-domain".to_string(),
                "system".to_string(),
                "-domain".to_string(),
                "user".to_string(),
            ],
            requires_admin: false,
            display_name: "Rebuild LaunchServices Database".to_string(),
        },
        MacosMaintenanceTask::DnsFlush => MacosMaintenanceSpec {
            program: "osascript".to_string(),
            args: vec![
                "-e".to_string(),
                r#"do shell script "/usr/bin/dscacheutil -flushcache; /usr/bin/killall -HUP mDNSResponder" with administrator privileges"#.to_string(),
            ],
            requires_admin: true,
            display_name: "Flush macOS DNS Cache".to_string(),
        },
    }
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn format_macos_maintenance_result(
    task: MacosMaintenanceTask,
    exit_code: Option<i32>,
    stdout: &str,
    stderr: &str,
) -> AppResult<MacosMaintenanceResult> {
    let combined = format!("{}\n{}", stdout.trim(), stderr.trim()).trim().to_string();
    let lower = combined.to_ascii_lowercase();
    if lower.contains("user canceled") || lower.contains("user cancelled") || lower.contains("-128") {
        return Err(AppError::Other(
            "Administrator authorization was cancelled.".to_string(),
        ));
    }
    let spec = build_macos_maintenance_spec(task);
    if exit_code == Some(0) {
        let message = match task {
            MacosMaintenanceTask::SpotlightReindex => {
                "Spotlight index reset triggered. macOS will reindex your drive in the background.".to_string()
            }
            MacosMaintenanceTask::LaunchServicesRebuild => {
                "LaunchServices database rebuilt (\"Open With\" menu refreshed).".to_string()
            }
            MacosMaintenanceTask::DnsFlush => {
                "DNS cache flushed and mDNSResponder refreshed.".to_string()
            }
        };
        Ok(MacosMaintenanceResult {
            task: task.as_id().to_string(),
            success: true,
            message,
            output: combined,
        })
    } else {
        let detail = if combined.is_empty() {
            format!("{} exited with code {:?}", spec.display_name, exit_code)
        } else {
            combined
        };
        Err(AppError::Other(detail))
    }
}

#[cfg(target_os = "macos")]
fn run_macos_maintenance_blocking(task: MacosMaintenanceTask) -> AppResult<MacosMaintenanceResult> {
    let spec = build_macos_maintenance_spec(task);
    let program = if task == MacosMaintenanceTask::LaunchServicesRebuild {
        let candidates = [
            "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
            "/System/Library/Frameworks/CoreServices.framework/Versions/Current/Frameworks/LaunchServices.framework/Versions/Current/Support/lsregister",
        ];
        candidates
            .iter()
            .find(|p| Path::new(p).exists())
            .copied()
            .unwrap_or(&spec.program)
            .to_string()
    } else {
        spec.program.clone()
    };

    let out = std::process::Command::new(&program)
        .args(&spec.args)
        .output()
        .map_err(|e| AppError::Other(format!("Could not run {}: {e}", spec.display_name)))?;

    if task == MacosMaintenanceTask::LaunchServicesRebuild && !out.status.success() {
        // Newer macOS releases sometimes disallow `-domain system` / `-kill` without SIP disable; retry user/local scope
        let fallback = std::process::Command::new(&program)
            .args(["-r", "-domain", "local", "-domain", "user"])
            .output()
            .map_err(|e| AppError::Other(format!("Could not run lsregister: {e}")))?;
        return format_macos_maintenance_result(
            task,
            fallback.status.code(),
            &String::from_utf8_lossy(&fallback.stdout),
            &String::from_utf8_lossy(&fallback.stderr),
        );
    }

    format_macos_maintenance_result(
        task,
        out.status.code(),
        &String::from_utf8_lossy(&out.stdout),
        &String::from_utf8_lossy(&out.stderr),
    )
}

#[tauri::command]
pub async fn run_macos_maintenance(
    state: State<'_, AppState>,
    task: String,
) -> AppResult<MacosMaintenanceResult> {
    let parsed = parse_macos_maintenance_task(&task)?;
    state.licensing.require_active().await?;

    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(move || run_macos_maintenance_blocking(parsed))
            .await
            .map_err(|e| AppError::Other(format!("background task failed: {e}")))?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = parsed;
        Err(AppError::Other(
            "macOS system maintenance helpers are only available on macOS.".into(),
        ))
    }
}

// ---------------------------------------------------------------------------
// Shared Windows UAC Elevation Runner (#21, #23)
// ---------------------------------------------------------------------------

pub fn should_retry_with_uac(code: Option<i32>, combined: &str, already_elevated: bool) -> bool {
    if code == Some(0) {
        return false;
    }
    if !already_elevated {
        return true;
    }
    let lower = combined.to_ascii_lowercase();
    code == Some(5)
        || lower.contains("permission")
        || lower.contains("access")
        || lower.contains("denied")
        || lower.contains("administrator")
        || lower.contains("privilege")
        || lower.contains("elevation")
        || lower.contains("elevated")
        || lower.contains("0x80041003")
        || lower.contains("0x80070005")
        || lower.contains("cim")
}

#[cfg(target_os = "windows")]
fn is_windows_process_elevated() -> bool {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    std::process::Command::new(safety::system32_binary("net"))
        .arg("session")
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[cfg(target_os = "windows")]
pub fn run_windows_admin_command(program: &Path, args: &str) -> AppResult<String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let mut direct = std::process::Command::new(program);
    if !args.trim().is_empty() {
        direct.raw_arg(args);
    }
    direct.creation_flags(CREATE_NO_WINDOW);

    let (needs_uac, failure_detail) = match direct.output() {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
            let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
            let combined = format!("{stdout}\n{stderr}").trim().to_string();
            if out.status.success() {
                return Ok(combined);
            }
            let already_elevated = is_windows_process_elevated();
            let retry = should_retry_with_uac(out.status.code(), &combined, already_elevated);
            (retry, combined)
        }
        Err(e) if e.raw_os_error() == Some(740) => (true, String::new()),
        Err(e) => {
            return Err(AppError::Other(format!(
                "Could not execute {}: {e}",
                program.display()
            )));
        }
    };

    if !needs_uac {
        return Err(AppError::Other(if failure_detail.is_empty() {
            format!("{} did not complete successfully.", program.display())
        } else {
            format!(
                "{} did not complete successfully: {}",
                program.display(),
                failure_detail
            )
        }));
    }

    let elev_script = r#"
try {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $env:SWEEPR_ELEV_BIN
  $psi.Arguments = $env:SWEEPR_ELEV_ARGS
  $psi.Verb = 'runas'
  $psi.UseShellExecute = $true
  $psi.WindowStyle = 'Hidden'
  $p = [System.Diagnostics.Process]::Start($psi)
  if ($null -eq $p) { exit 1 }
  $p.WaitForExit()
  exit $p.ExitCode
} catch [System.ComponentModel.Win32Exception] {
  if ($_.Exception.NativeErrorCode -eq 1223) { exit 1223 }
  Write-Error $_.Exception.Message
  exit 1
}
"#;

    let elev_out = std::process::Command::new(safety::system_powershell_path())
        .env("SWEEPR_ELEV_BIN", program.as_os_str())
        .env("SWEEPR_ELEV_ARGS", args)
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-Command",
            elev_script,
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| AppError::Other(format!("Could not prompt for administrator rights: {e}")))?;

    match elev_out.status.code() {
        Some(0) => Ok(String::new()),
        Some(1223) => Err(AppError::Other(
            "Administrator permission was cancelled.".into(),
        )),
        other => {
            let elev_err = format!(
                "{}\n{}",
                String::from_utf8_lossy(&elev_out.stdout).trim(),
                String::from_utf8_lossy(&elev_out.stderr).trim()
            )
            .trim()
            .to_string();
            let detail = if !elev_err.is_empty() {
                elev_err
            } else {
                failure_detail
            };
            Err(AppError::Other(if detail.is_empty() {
                format!("Elevated command failed (exit code {:?}).", other)
            } else {
                format!("Elevated command failed (exit code {:?}): {}", other, detail)
            }))
        }
    }
}

// ---------------------------------------------------------------------------
// #21 Windows Drive Optimization (TRIM / Defrag)
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct OptimizableDrive {
    pub drive_letter: String,
    pub mount_point: String,
    pub name: String,
    pub media_kind: String,         // "ssd" | "hdd" | "removable" | "unknown"
    pub media_label: String,
    pub optimizable: bool,
    pub recommended_action: String, // "retrim" | "defrag" | "unsupported"
    pub block_reason: Option<String>,
    pub available_bytes: u64,
    pub total_bytes: u64,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct DriveOptimizeReport {
    pub drive_letter: String,
    pub action: String, // "retrim" | "defrag"
    pub success: bool,
    pub message: String,
}

pub fn parse_windows_drive_letter(raw: &str) -> AppResult<char> {
    let trimmed = raw.trim().trim_end_matches(['\\', '/']).trim_end_matches(':');
    let mut chars = trimmed.chars();
    let Some(ch) = chars.next() else {
        return Err(AppError::Other("Invalid drive letter.".into()));
    };
    if chars.next().is_some() || !ch.is_ascii_alphabetic() {
        return Err(AppError::Other(
            "Drive identifier must be a single Windows drive letter (e.g. C:).".into(),
        ));
    }
    Ok(ch.to_ascii_uppercase())
}

pub fn build_drive_optimize_spec(letter: char, is_ssd: bool) -> (&'static str, String) {
    let upper = letter.to_ascii_uppercase();
    if is_ssd {
        (
            "powershell",
            format!("-NoProfile -NonInteractive -WindowStyle Hidden -Command \"Optimize-Volume -DriveLetter {upper} -ReTrim\""),
        )
    } else {
        ("defrag", format!("{upper}: /O"))
    }
}

#[cfg(target_os = "windows")]
fn list_optimizable_drives_blocking() -> Vec<OptimizableDrive> {
    let disks = sysinfo::Disks::new_with_refreshed_list();
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for d in disks.list() {
        let total = d.total_space();
        if total == 0 {
            continue;
        }
        let mount_raw = d.mount_point().to_string_lossy().into_owned();
        let Ok(letter) = parse_windows_drive_letter(&mount_raw) else {
            continue;
        };
        if !seen.insert(letter) {
            continue;
        }
        let (_is_ssd, kind, media_label, _, _, _) =
            shredder::classify_drive_media(d.kind(), d.is_removable(), true);
        let (optimizable, recommended_action, block_reason) = match kind {
            "ssd" => (true, "retrim".to_string(), None),
            "hdd" => (true, "defrag".to_string(), None),
            "removable" => (
                false,
                "unsupported".to_string(),
                Some("Removable USB/SD drives are skipped to avoid unnecessary flash wear.".into()),
            ),
            _ => (
                false,
                "unsupported".to_string(),
                Some("Drive media type could not be verified as SSD or HDD.".into()),
            ),
        };
        let disk_name = d.name().to_string_lossy().trim().to_string();
        let drive_letter = format!("{letter}:");
        let name = if disk_name.is_empty() {
            format!("Local Disk ({drive_letter})")
        } else {
            format!("{disk_name} ({drive_letter})")
        };

        out.push(OptimizableDrive {
            drive_letter,
            mount_point: mount_raw,
            name,
            media_kind: kind.to_string(),
            media_label: media_label.to_string(),
            optimizable,
            recommended_action,
            block_reason,
            available_bytes: d.available_space(),
            total_bytes: total,
        });
    }
    out.sort_by(|a, b| a.drive_letter.cmp(&b.drive_letter));
    out
}

#[cfg(not(target_os = "windows"))]
fn list_optimizable_drives_blocking() -> Vec<OptimizableDrive> {
    Vec::new()
}

#[tauri::command]
pub async fn list_optimizable_drives() -> AppResult<Vec<OptimizableDrive>> {
    tauri::async_runtime::spawn_blocking(list_optimizable_drives_blocking)
        .await
        .map_err(|e| AppError::Other(format!("background task failed: {e}")))
}

#[tauri::command]
pub async fn optimize_drive(
    state: State<'_, AppState>,
    drive_letter: String,
) -> AppResult<DriveOptimizeReport> {
    let letter = parse_windows_drive_letter(&drive_letter)?;
    state.licensing.require_active().await?;

    #[cfg(target_os = "windows")]
    {
        tauri::async_runtime::spawn_blocking(move || {
            let mount = format!("{letter}:\\");
            let media = shredder::detect_drive_media_type(mount)?;
            if media.is_removable || !matches!(media.kind.as_str(), "ssd" | "hdd") {
                return Err(AppError::Other(
                    media.block_reason.unwrap_or_else(|| {
                        format!(
                            "Drive {letter}: cannot be optimized because its media type ({}) is unsupported.",
                            media.kind
                        )
                    }),
                ));
            }
            let is_ssd = media.kind == "ssd";
            let (bin_tag, args) = build_drive_optimize_spec(letter, is_ssd);
            let prog = if bin_tag == "powershell" {
                safety::system_powershell_path()
            } else {
                safety::system32_binary("defrag")
            };
            run_windows_admin_command(&prog, &args)?;
            let action = if is_ssd { "retrim" } else { "defrag" };
            let message = if is_ssd {
                format!("TRIM optimization completed for SSD {letter}:.")
            } else {
                format!("Defragmentation & optimization completed for HDD {letter}:.")
            };
            Ok(DriveOptimizeReport {
                drive_letter: format!("{letter}:"),
                action: action.to_string(),
                success: true,
                message,
            })
        })
        .await
        .map_err(|e| AppError::Other(format!("background task failed: {e}")))?
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = letter;
        Err(AppError::Other(
            "Drive TRIM/Defrag optimization is only supported on Windows.".into(),
        ))
    }
}

// ---------------------------------------------------------------------------
// #23 One-Click Windows Hibernation Toggle
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct HibernationStatus {
    pub supported: bool,
    pub enabled: bool,
    pub hiberfil_exists: bool,
    pub hiberfil_bytes: u64,
    pub fast_startup_enabled: bool,
    pub note: String,
}

pub fn parse_powercfg_a_output(raw: &str) -> Option<bool> {
    let lower = raw.to_ascii_lowercase();
    if lower.is_empty() {
        return None;
    }
    if lower.contains("hibernation has not been enabled")
        || lower.contains("hibernate has not been enabled")
        || lower.contains("system does not support hibernation")
    {
        return Some(false);
    }
    let mut in_available_section = false;
    for line in lower.lines() {
        let t = line.trim();
        if t.contains("available on this system") {
            in_available_section = true;
            continue;
        }
        if t.contains("not available on this system") {
            in_available_section = false;
            continue;
        }
        if in_available_section && t == "hibernate" {
            return Some(true);
        }
    }
    None
}

pub fn evaluate_hibernation_state(
    reg_hibernate: Option<u32>,
    reg_hiberboot: Option<u32>,
    powercfg_enabled: Option<bool>,
    hiberfil_bytes: Option<u64>,
) -> HibernationStatus {
    let hiberfil_exists = hiberfil_bytes.is_some();
    let bytes = hiberfil_bytes.unwrap_or(0);
    let enabled = match (reg_hibernate, powercfg_enabled) {
        (Some(v), _) => v != 0,
        (None, Some(b)) => b,
        (None, None) => hiberfil_exists && bytes > 0,
    };
    let fast_startup_enabled = enabled && reg_hiberboot.unwrap_or(0) != 0;
    let note = if enabled {
        "Disabling hibernation deletes hiberfil.sys to reclaim disk space, and also turns off Windows Fast Startup (Hiberboot).".to_string()
    } else {
        "Hibernation is currently disabled (0 B reserved). Re-enabling restores Hibernate and allows Windows Fast Startup.".to_string()
    };

    HibernationStatus {
        supported: true,
        enabled,
        hiberfil_exists,
        hiberfil_bytes: bytes,
        fast_startup_enabled,
        note,
    }
}

#[cfg(target_os = "windows")]
fn inspect_hiberfil_size_via_read_dir(drive_root: &Path) -> Option<u64> {
    // Use directory entry enumeration rather than std::fs::metadata(C:\hiberfil.sys)
    // because the Windows kernel holds hiberfil.sys open exclusively (ERROR_SHARING_VIOLATION).
    let rd = std::fs::read_dir(drive_root).ok()?;
    for entry in rd.flatten() {
        if entry.file_name().to_string_lossy().eq_ignore_ascii_case("hiberfil.sys") {
            if let Ok(md) = entry.metadata() {
                return Some(md.len());
            }
        }
    }
    None
}

#[cfg(target_os = "windows")]
fn hibernation_status_blocking() -> HibernationStatus {
    use std::os::windows::process::CommandExt;
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let sys_drive = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into());
    let root = format!("{}\\", sys_drive.trim_end_matches(['\\', '/']));
    let hiberfil_bytes = inspect_hiberfil_size_via_read_dir(Path::new(&root));

    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let reg_hibernate = hklm
        .open_subkey(r"SYSTEM\CurrentControlSet\Control\Power")
        .ok()
        .and_then(|k| k.get_value::<u32, _>("HibernateEnabled").ok());
    let reg_hiberboot = hklm
        .open_subkey(r"SYSTEM\CurrentControlSet\Control\Session Manager\Power")
        .ok()
        .and_then(|k| k.get_value::<u32, _>("HiberbootEnabled").ok());

    let powercfg_out = std::process::Command::new(safety::system32_binary("powercfg"))
        .arg("/a")
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
        .unwrap_or_default();
    let powercfg_enabled = parse_powercfg_a_output(&powercfg_out);

    evaluate_hibernation_state(reg_hibernate, reg_hiberboot, powercfg_enabled, hiberfil_bytes)
}

#[cfg(not(target_os = "windows"))]
fn hibernation_status_blocking() -> HibernationStatus {
    HibernationStatus {
        supported: false,
        enabled: false,
        hiberfil_exists: false,
        hiberfil_bytes: 0,
        fast_startup_enabled: false,
        note: "Windows hibernation (hiberfil.sys) toggle is only supported on Windows.".to_string(),
    }
}

#[tauri::command]
pub async fn hibernation_status() -> AppResult<HibernationStatus> {
    tauri::async_runtime::spawn_blocking(hibernation_status_blocking)
        .await
        .map_err(|e| AppError::Other(format!("background task failed: {e}")))
}

#[tauri::command]
pub async fn set_hibernation_enabled(
    state: State<'_, AppState>,
    enabled: bool,
) -> AppResult<HibernationStatus> {
    state.licensing.require_active().await?;

    #[cfg(target_os = "windows")]
    {
        tauri::async_runtime::spawn_blocking(move || {
            let arg = if enabled {
                "/hibernate on"
            } else {
                "/hibernate off"
            };
            let powercfg = safety::system32_binary("powercfg");
            run_windows_admin_command(&powercfg, arg)?;
            Ok(hibernation_status_blocking())
        })
        .await
        .map_err(|e| AppError::Other(format!("background task failed: {e}")))?
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = enabled;
        Err(AppError::Other(
            "Windows hibernation toggle is only supported on Windows.".into(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn macos_maintenance_task_specs_and_results() {
        let t_spot = parse_macos_maintenance_task("spotlight_reindex").unwrap();
        let spec_spot = build_macos_maintenance_spec(t_spot);
        assert_eq!(spec_spot.program, "osascript");
        assert!(spec_spot.args[1].contains("/usr/bin/mdutil -E /"));
        assert!(spec_spot.requires_admin);

        let t_ls = parse_macos_maintenance_task("launch_services_rebuild").unwrap();
        let spec_ls = build_macos_maintenance_spec(t_ls);
        assert!(spec_ls.program.ends_with("lsregister"));
        assert!(!spec_ls.requires_admin);

        let t_dns = parse_macos_maintenance_task("dns_flush").unwrap();
        let spec_dns = build_macos_maintenance_spec(t_dns);
        assert!(spec_dns.args[1].contains("dscacheutil -flushcache"));
        assert!(spec_dns.args[1].contains("mDNSResponder"));

        assert!(parse_macos_maintenance_task("unknown_task").is_err());

        let ok_res = format_macos_maintenance_result(t_dns, Some(0), "", "").unwrap();
        assert!(ok_res.success);
        let cancel_err = format_macos_maintenance_result(
            t_spot,
            Some(1),
            "",
            "execution error: User canceled. (-128)",
        )
        .unwrap_err();
        assert!(cancel_err.to_string().to_ascii_lowercase().contains("cancelled"));
    }

    #[test]
    fn windows_drive_letter_and_optimize_spec_validation() {
        assert_eq!(parse_windows_drive_letter("c").unwrap(), 'C');
        assert_eq!(parse_windows_drive_letter("D:").unwrap(), 'D');
        assert_eq!(parse_windows_drive_letter(r"e:\").unwrap(), 'E');
        assert!(parse_windows_drive_letter("").is_err());
        assert!(parse_windows_drive_letter("C:\\Windows").is_err());
        assert!(parse_windows_drive_letter("1:").is_err());

        let (ssd_bin, ssd_args) = build_drive_optimize_spec('c', true);
        assert_eq!(ssd_bin, "powershell");
        assert!(ssd_args.contains("Optimize-Volume -DriveLetter C -ReTrim"));

        let (hdd_bin, hdd_args) = build_drive_optimize_spec('d', false);
        assert_eq!(hdd_bin, "defrag");
        assert_eq!(hdd_args, "D: /O");
    }

    #[test]
    fn hibernation_parsers_and_evaluator() {
        let on_sample = "\
The following sleep states are available on this system:
    Standby (S0 Low Power Idle) Network Connected
    Hibernate
    Fast Startup

The following sleep states are not available on this system:
    Standby (S1)
";
        assert_eq!(parse_powercfg_a_output(on_sample), Some(true));

        let off_sample = "\
The following sleep states are not available on this system:
    Hibernate
        Hibernation has not been enabled.
";
        assert_eq!(parse_powercfg_a_output(off_sample), Some(false));

        let enabled = evaluate_hibernation_state(Some(1), Some(1), Some(true), Some(6_871_947_673));
        assert!(enabled.enabled);
        assert!(enabled.hiberfil_exists);
        assert_eq!(enabled.hiberfil_bytes, 6_871_947_673);
        assert!(enabled.fast_startup_enabled);

        let disabled = evaluate_hibernation_state(Some(0), Some(1), Some(false), None);
        assert!(!disabled.enabled);
        assert!(!disabled.hiberfil_exists);
        assert_eq!(disabled.hiberfil_bytes, 0);
        assert!(!disabled.fast_startup_enabled);
    }

    #[test]
    fn windows_uac_retry_trigger_handles_powercfg_permission_and_locales() {
        // Real un-elevated Windows powercfg /hibernate output (exit 1, "permission")
        assert!(should_retry_with_uac(
            Some(1),
            "You do not have permission to enable or disable the Hibernate feature.",
            false
        ));
        assert!(should_retry_with_uac(
            Some(1),
            "You do not have permission to enable or disable the Hibernate feature.",
            true
        ));
        // Non-English localized error when un-elevated must still trigger UAC
        assert!(should_retry_with_uac(
            Some(1),
            "Sie verfügen nicht über die Berechtigung zum Aktivieren oder Deaktivieren des Ruhezustands.",
            false
        ));
        // Exit code 5 / 0x80070005 / elevated keywords
        assert!(should_retry_with_uac(Some(5), "", true));
        assert!(should_retry_with_uac(Some(1), "Error 0x80070005", true));
        assert!(should_retry_with_uac(
            Some(1),
            "This operation requires an elevated command prompt.",
            true
        ));
        // Success never retries; unrelated error when already elevated does not re-prompt UAC
        assert!(!should_retry_with_uac(Some(0), "", false));
        assert!(!should_retry_with_uac(Some(1), "Invalid parameters", true));
    }
}
