mod battery;
mod cleaner;
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
mod cloud;
mod cloud_commands;
mod cloud_sync;
mod vault;

use tauri::Manager;

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
    if scheduler::run_headless_if_requested() {
        return;
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let local_data_dir = app
                .path()
                .app_local_data_dir()
                .unwrap_or_else(|_| data_dir.clone());
            let _ = std::fs::create_dir_all(&data_dir);
            let _ = std::fs::create_dir_all(&local_data_dir);

            let licensing = licensing::Licensing::new(data_dir.clone());
            let api_url_for_crash = licensing.api_url().to_string();

            // Flush any sanitized crash report (`last_crash.json`) from a previous session to POST /v1/telemetry/crash
            let mut pending_crash_paths = vec![local_data_dir.join("last_crash.json")];
            if local_data_dir != data_dir {
                pending_crash_paths.push(data_dir.join("last_crash.json"));
            }
            if pending_crash_paths.iter().any(|p| p.exists()) {
                tauri::async_runtime::spawn(async move {
                    flush_last_crash_report(api_url_for_crash, pending_crash_paths).await;
                });
            }

            // Install sanitized crash reporting hook (#3) writing `<app_local_data_dir>/last_crash.json`
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

            app.manage(commands::AppState {
                data_dir: data_dir.clone(),
                local_data_dir: local_data_dir.clone(),
                licensing,
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
            duplicates::find_duplicates,
            duplicates::delete_duplicates,
            duplicates::scan_large_files,
            duplicates::delete_large_file,
            duplicates::move_large_file,
            uninstaller::fetch_apps,
            uninstaller::uninstall_app,
            uninstaller::scan_app_remnants,
            uninstaller::clean_app_remnant,
            uninstaller::check_outdated_software,
            uninstaller::upgrade_software,
            uninstaller::resolve_shortcut_or_exe,
            uninstaller::scan_broken_items,
            uninstaller::clean_broken_items,
            shredder::shred_file,
            shredder::detect_drive_media_type,
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
}
