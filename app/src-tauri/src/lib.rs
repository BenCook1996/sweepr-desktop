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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if scheduler::run_headless_if_requested() {
        return;
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let _ = std::fs::create_dir_all(&data_dir);

            // Install crash reporting hook (#3)
            let panic_dir = data_dir.clone();
            let prev_hook = std::panic::take_hook();
            std::panic::set_hook(Box::new(move |info| {
                let ts = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                let msg = format!("[ts:{ts}] Panic: {}\n", info);
                let _ = std::fs::create_dir_all(&panic_dir);
                if let Ok(mut f) = std::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(panic_dir.join("crash.log"))
                {
                    use std::io::Write;
                    let _ = write!(f, "{}", msg);
                }
                prev_hook(info);
            }));

            // Purge any Sweepr quarantine entries older than 7 days (#10)
            cleaner::purge_expired_quarantine_in(&data_dir);

            app.manage(commands::AppState {
                data_dir: data_dir.clone(),
                licensing: licensing::Licensing::new(data_dir.clone()),
            });
            battery::setup_tray_and_monitor(app.handle(), data_dir);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::scan_start,
            commands::clean_categories,
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
