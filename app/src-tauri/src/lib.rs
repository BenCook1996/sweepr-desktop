mod battery;
mod cleaner;
mod cli;
mod cmdline;
mod commands;
mod error;
mod licensing;
mod memory;
mod rules;
mod safety;
mod scanner;
mod scheduler;
mod duplicates;
mod uninstaller;
mod shredder;
mod registry_cleaner;
mod security_health;
mod system_tools;
mod cloud;
mod cloud_commands;
mod cloud_sync;
mod vault;

use std::path::{Path, PathBuf};
use tauri::Manager;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedDataDirs {
    pub data_dir: PathBuf,
    pub local_data_dir: PathBuf,
    pub portable: bool,
}

pub fn resolve_data_dirs_with(
    exe_dir: Option<&Path>,
    has_portable_flag_file: bool,
    has_portable_cli_arg: bool,
    default_data_dir: PathBuf,
    default_local_data_dir: PathBuf,
) -> ResolvedDataDirs {
    if let Some(dir) = exe_dir.filter(|_| has_portable_flag_file || has_portable_cli_arg) {
        let portable_dir = dir.join("portable_data");
        return ResolvedDataDirs {
            data_dir: portable_dir.clone(),
            local_data_dir: portable_dir,
            portable: true,
        };
    }
    ResolvedDataDirs {
        data_dir: default_data_dir,
        local_data_dir: default_local_data_dir,
        portable: false,
    }
}

pub fn resolve_cli_data_dirs(args: &[String]) -> ResolvedDataDirs {
    let exe_path = std::env::current_exe().ok();
    let exe_dir = exe_path.as_deref().and_then(|p| p.parent());
    let has_portable_flag_file = exe_dir.map(|d| d.join("portable.flag").is_file()).unwrap_or(false);
    let has_portable_cli_arg = args.iter().any(|a| a == "--portable");
    let base_data = dirs::data_dir().unwrap_or_else(std::env::temp_dir);
    let cleaner_dir = base_data.join("com.sweepr.cleaner");
    let legacy_dir = base_data.join("com.sweepr.app");
    let default_data = if cleaner_dir.exists() || !legacy_dir.exists() {
        cleaner_dir
    } else {
        legacy_dir
    };
    let default_local = dirs::data_local_dir()
        .unwrap_or_else(|| base_data.clone())
        .join("com.sweepr.cleaner");
    resolve_data_dirs_with(
        exe_dir,
        has_portable_flag_file,
        has_portable_cli_arg,
        default_data,
        default_local,
    )
}

pub fn resolve_cli_data_dir(args: &[String]) -> PathBuf {
    resolve_cli_data_dirs(args).data_dir
}

/// Strips personal file paths (e.g. `C:\Users\Alice\...`, `/Users/alice/...`, `/home/alice/...`)
/// so crash telemetry never contains PII or local filesystem usernames.
pub(crate) fn sanitize_crash_text(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for token in raw.split_whitespace() {
        let trimmed = token.trim_matches(|c: char| matches!(c, '"' | '\'' | '(' | ')' | '[' | ']' | ',' | ';'));
        let lower = trimmed.to_ascii_lowercase();
        let is_personal_path = lower.contains(":\\users\\")
            || lower.contains(":/users/")
            || lower.starts_with("/users/")
            || lower.starts_with("/home/")
            || lower.starts_with("\\\\")
            || (trimmed.len() >= 3
                && trimmed.as_bytes()[0].is_ascii_alphabetic()
                && trimmed.as_bytes()[1] == b':'
                && (trimmed.as_bytes()[2] == b'\\' || trimmed.as_bytes()[2] == b'/'));
        if !out.is_empty() {
            out.push(' ');
        }
        if is_personal_path {
            out.push_str("<redacted_path>");
        } else if trimmed.contains('@') && trimmed.contains('.') {
            out.push_str("<redacted_email>");
        } else {
            out.push_str(token);
        }
    }
    out.chars().take(512).collect()
}

pub(crate) fn sanitize_panic_location(file: &str, line: u32, col: u32) -> String {
    let normalized = file.replace('\\', "/");
    let rel = if let Some(idx) = normalized.rfind("src/") {
        &normalized[idx..]
    } else {
        normalized.rsplit('/').next().unwrap_or("unknown.rs")
    };
    format!("{rel}:{line}:{col}")
}

async fn flush_last_crash_report(api_url: String, crash_paths: Vec<std::path::PathBuf>) {
    for path in crash_paths {
        if !path.exists() {
            continue;
        }
        let Ok(raw) = std::fs::read_to_string(&path) else {
            let _ = std::fs::remove_file(&path);
            continue;
        };
        let Ok(mut payload) = serde_json::from_str::<serde_json::Value>(&raw) else {
            let _ = std::fs::remove_file(&path);
            continue;
        };
        if let Some(obj) = payload.as_object_mut() {
            if !obj.contains_key("platform") {
                obj.insert(
                    "platform".to_string(),
                    serde_json::Value::String(std::env::consts::OS.to_string()),
                );
            }
            if !obj.contains_key("error_type") {
                obj.insert(
                    "error_type".to_string(),
                    serde_json::Value::String("rust_panic".to_string()),
                );
            }
        }
        let base = api_url.trim_end_matches('/');
        let base_url = if base.is_empty() {
            "https://sweeprcleaner.com"
        } else {
            base
        };
        let url = format!("{base_url}/v1/telemetry/crash");
        if let Ok(client) = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(8))
            .build()
        {
            if let Ok(resp) = client
                .post(&url)
                .header("x-sweepr-project", "cleaner")
                .json(&payload)
                .send()
                .await
            {
                if resp.status().is_success() || resp.status().as_u16() == 400 {
                    let _ = std::fs::remove_file(&path);
                }
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if cli::run_if_requested() {
        return;
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let default_data_dir = app.path().app_data_dir()?;
            let default_local_data_dir = app
                .path()
                .app_local_data_dir()
                .unwrap_or_else(|_| default_data_dir.clone());
            let exe_path = std::env::current_exe().ok();
            let exe_dir = exe_path.as_deref().and_then(|p| p.parent());
            let has_portable_flag_file = exe_dir
                .map(|d| d.join("portable.flag").is_file())
                .unwrap_or(false);
            let has_portable_cli_arg = std::env::args().any(|a| a == "--portable");
            let resolved_dirs = resolve_data_dirs_with(
                exe_dir,
                has_portable_flag_file,
                has_portable_cli_arg,
                default_data_dir,
                default_local_data_dir,
            );
            let data_dir = resolved_dirs.data_dir;
            let local_data_dir = resolved_dirs.local_data_dir;
            let _ = std::fs::create_dir_all(&data_dir);
            let _ = std::fs::create_dir_all(&local_data_dir);

            let licensing = licensing::Licensing::new(data_dir.clone());
            let api_url_for_crash = licensing.api_url().to_string();

            // Flush any sanitized crash report (`last_crash.json`) from a previous session ONLY when telemetry is opted-in
            let mut pending_crash_paths = vec![local_data_dir.join("last_crash.json")];
            if local_data_dir != data_dir {
                pending_crash_paths.push(data_dir.join("last_crash.json"));
            }
            if commands::is_telemetry_enabled(&data_dir)
                && pending_crash_paths.iter().any(|p| p.exists())
            {
                tauri::async_runtime::spawn(async move {
                    flush_last_crash_report(api_url_for_crash, pending_crash_paths).await;
                });
            }

            // Install sanitized crash reporting hook (#3) writing `<app_local_data_dir>/last_crash.json` (only if telemetry opted-in)
            let panic_local_dir = local_data_dir.clone();
            let panic_data_dir = data_dir.clone();
            let app_version = app.package_info().version.to_string();
            let prev_hook = std::panic::take_hook();
            std::panic::set_hook(Box::new(move |info| {
                let ts = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                let raw_payload = if let Some(s) = info.payload().downcast_ref::<&str>() {
                    (*s).to_string()
                } else if let Some(s) = info.payload().downcast_ref::<String>() {
                    s.clone()
                } else {
                    "Unexpected panic".to_string()
                };
                let sanitized_msg = sanitize_crash_text(&raw_payload);
                let location = info
                    .location()
                    .map(|l| sanitize_panic_location(l.file(), l.line(), l.column()))
                    .unwrap_or_else(|| "unknown:0:0".to_string());
                if commands::is_telemetry_enabled(&panic_data_dir) {
                    let os_name = std::env::consts::OS;
                    let report_json = serde_json::json!({
                        "version": app_version,
                        "app_version": app_version,
                        "os": os_name,
                        "platform": os_name,
                        "error_type": "rust_panic",
                        "location": location,
                        "message": format!("Panic at {location}: {sanitized_msg}"),
                        "stack": format!("location: {location}"),
                        "timestamp": ts,
                    });
                    let _ = std::fs::create_dir_all(&panic_local_dir);
                    let _ = std::fs::write(
                        panic_local_dir.join("last_crash.json"),
                        serde_json::to_string_pretty(&report_json).unwrap_or_default(),
                    );
                    if panic_data_dir != panic_local_dir {
                        let _ = std::fs::create_dir_all(&panic_data_dir);
                        let _ = std::fs::write(
                            panic_data_dir.join("last_crash.json"),
                            serde_json::to_string_pretty(&report_json).unwrap_or_default(),
                        );
                    }
                }
                if let Ok(mut f) = std::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(panic_data_dir.join("crash.log"))
                {
                    use std::io::Write;
                    let _ = writeln!(f, "[ts:{ts}] Panic at {location}: {sanitized_msg}");
                }
                prev_hook(info);
            }));

            // Purge any Sweepr quarantine entries older than 7 days (#10)
            cleaner::purge_expired_quarantine_in(&data_dir);

            let initial_scan_dir =
                cli::extract_scan_dir_arg(&std::env::args().collect::<Vec<_>>());
            app.manage(commands::AppState {
                data_dir: data_dir.clone(),
                local_data_dir: local_data_dir.clone(),
                licensing,
                wipe_running: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
                wipe_cancel: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
                initial_scan_dir: std::sync::Mutex::new(initial_scan_dir),
            });
            let app_handle_for_policy = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let st = app_handle_for_policy.state::<commands::AppState>();
                let _ = st.licensing.apply_policy_token_if_present().await;
            });
            battery::setup_tray_and_monitor(app.handle(), data_dir);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let installer_mode = std::env::args().any(|a| a == "--installer");
                let tray_active = !installer_mode
                    && window.app_handle().tray_by_id(battery::TRAY_ID).is_some();
                if (cfg!(target_os = "windows") && tray_active) || cfg!(target_os = "macos") {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::scan_start,
            commands::clean_categories,
            commands::get_free_allowance,
            commands::list_quarantine,
            commands::get_quarantine_status,
            commands::restore_quarantine_item,
            commands::get_cleaning_history,
            commands::record_cleaning_history,
            commands::list_exclusions,
            commands::add_exclusion,
            commands::remove_exclusion,
            commands::check_running_apps,
            commands::license_status,
            commands::start_checkout,
            commands::start_addon_checkout,
            commands::battery_diagnostics,
            commands::set_battery_charge_limit,
            commands::set_battery_thermal_throttling,
            commands::hibernate_browser_tabs,
            commands::request_login_otp,
            commands::verify_login_otp,
            commands::redeem_pairing_token,
            commands::start_qr_challenge,
            commands::poll_qr_challenge,
            commands::create_qr_link_token,
            commands::memory_overview,
            commands::startup_items,
            commands::toggle_startup_item,
            commands::get_autostart,
            commands::set_autostart,
            commands::get_schedule_settings,
            commands::set_schedule_settings,
            commands::list_rule_definitions,
            commands::list_custom_rules,
            commands::validate_custom_rule,
            commands::import_custom_rules,
            commands::remove_custom_rule,
            commands::get_schedule_config,
            commands::save_schedule_config,
            commands::run_scheduled_clean_now,
            commands::system_overview,
            commands::open_breach_check,
            commands::scan_browser_privacy,
            commands::clean_browser_privacy,
            commands::check_password_breach,
            commands::check_app_update,
            commands::install_app_update,
            commands::send_support_report,
            commands::app_info,
            commands::send_telemetry_event,
            commands::finalize_install,
            commands::get_ui_preferences,
            commands::save_ui_preferences,
            commands::quit_app,
            commands::complete_installation,
            commands::uninstall_self,
            commands::kill_process,
            commands::boost_gaming_mode,
            commands::system_health_details,
            commands::list_context_menu_items,
            commands::toggle_context_menu_item,
            commands::browser_memory_report,
            commands::tame_browser_memory,
            commands::set_browser_memory_policy,
            commands::list_tab_sessions,
            commands::backup_tab_sessions,
            commands::restore_tab_session,
            commands::delete_tab_session,
            commands::get_cookie_allowlist,
            commands::set_cookie_allowlist,
            commands::compact_browser_databases,
            commands::list_browser_extensions,
            commands::generate_strong_password,
            commands::recycle_bin_info,
            commands::empty_recycle_bin,
            commands::pick_folder,
            commands::pick_file,
            commands::scan_stale_dev_artifacts,
            commands::reveal_in_folder,
            commands::check_macos_full_disk_access,
            commands::open_macos_fda_settings,
            commands::take_initial_scan_dir,
            commands::get_explorer_context_menu_enabled,
            commands::set_explorer_context_menu_enabled,
            duplicates::find_duplicates,
            duplicates::delete_duplicates,
            duplicates::scan_large_files,
            duplicates::delete_large_file,
            duplicates::move_large_file,
            duplicates::macos_apfs_space_info,
            security_health::os_security_health,
            system_tools::run_macos_maintenance,
            system_tools::list_optimizable_drives,
            system_tools::optimize_drive,
            system_tools::hibernation_status,
            system_tools::set_hibernation_enabled,
            uninstaller::fetch_apps,
            uninstaller::uninstall_app,
            uninstaller::uninstall_apps_batch,
            uninstaller::preview_force_remove_app,
            uninstaller::force_remove_app,
            uninstaller::scan_app_remnants,
            uninstaller::clean_app_remnant,
            uninstaller::check_outdated_software,
            uninstaller::upgrade_software,
            uninstaller::resolve_shortcut_or_exe,
            uninstaller::scan_broken_items,
            uninstaller::clean_broken_items,
            shredder::shred_file,
            shredder::detect_drive_media_type,
            shredder::list_wipeable_drives,
            shredder::wipe_free_space,
            shredder::cancel_wipe_free_space,
            registry_cleaner::scan_registry,
            registry_cleaner::fix_registry_issue,
            registry_cleaner::list_registry_backups,
            registry_cleaner::restore_registry_backup,
            cloud_commands::cloud_detect_roots,
            cloud_commands::cloud_scan,
            cloud_commands::cloud_delete_files,
            cloud_commands::cloud_offload_files,
            cloud_commands::vault_encrypt,
            cloud_commands::vault_decrypt,
            cloud_commands::vault_list,
            cloud_commands::cloud_sync_list,
            cloud_commands::cloud_sync_add,
            cloud_commands::cloud_sync_remove,
            cloud_commands::cloud_sync_run,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Sweepr");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizes_personal_paths_and_locations() {
        let raw = "Failed reading C:\\Users\\Benjamin\\Documents\\secret.txt for user@example.com";
        let sanitized = sanitize_crash_text(raw);
        assert!(!sanitized.contains("Benjamin"));
        assert!(!sanitized.contains("user@example.com"));
        assert!(sanitized.contains("<redacted_path>"));
        assert!(sanitized.contains("<redacted_email>"));

        let loc = sanitize_panic_location("C:\\Users\\Benjamin\\Downloads\\desktop_cleaner\\app\\src-tauri\\src\\scanner.rs", 142, 9);
        assert_eq!(loc, "src/scanner.rs:142:9");
    }

    #[test]
    fn resolve_data_dirs_handles_portable_flag_cli_and_default_fallback() {
        let exe_dir = PathBuf::from("/opt/sweepr");
        let default_data = PathBuf::from("/home/user/.config/com.sweepr.cleaner");
        let default_local = PathBuf::from("/home/user/.local/share/com.sweepr.cleaner");

        // 1. Neither portable.flag nor --portable -> uses OS default dirs
        let standard = resolve_data_dirs_with(
            Some(&exe_dir),
            false,
            false,
            default_data.clone(),
            default_local.clone(),
        );
        assert!(!standard.portable);
        assert_eq!(standard.data_dir, default_data);
        assert_eq!(standard.local_data_dir, default_local);

        // 2. portable.flag next to executable -> portable_data beside exe
        let via_flag = resolve_data_dirs_with(
            Some(&exe_dir),
            true,
            false,
            default_data.clone(),
            default_local.clone(),
        );
        assert!(via_flag.portable);
        assert_eq!(via_flag.data_dir, exe_dir.join("portable_data"));
        assert_eq!(via_flag.local_data_dir, exe_dir.join("portable_data"));

        // 3. --portable CLI arg -> portable_data beside exe
        let via_cli = resolve_data_dirs_with(
            Some(&exe_dir),
            false,
            true,
            default_data.clone(),
            default_local.clone(),
        );
        assert!(via_cli.portable);
        assert_eq!(via_cli.data_dir, exe_dir.join("portable_data"));
        assert_eq!(via_cli.local_data_dir, exe_dir.join("portable_data"));

        // 4. Missing exe_dir falls back cleanly to defaults even if flags set
        let missing_exe = resolve_data_dirs_with(
            None,
            true,
            true,
            default_data.clone(),
            default_local.clone(),
        );
        assert!(!missing_exe.portable);
        assert_eq!(missing_exe.data_dir, default_data);
        assert_eq!(missing_exe.local_data_dir, default_local);
    }
}
