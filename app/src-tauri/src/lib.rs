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
                licensing: licensing::Licensing::new(data_dir),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::scan_start,
            commands::clean_categories,
            commands::list_quarantine,
            commands::restore_quarantine_item,
            commands::get_cleaning_history,
            commands::list_exclusions,
            commands::add_exclusion,
            commands::remove_exclusion,
            commands::check_running_apps,
            commands::license_status,
            commands::start_checkout,
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
            commands::send_support_report,
            commands::app_info,
            commands::quit_app,
            duplicates::find_duplicates,
            duplicates::delete_duplicates,
            duplicates::scan_large_files,
            duplicates::delete_large_file,
            uninstaller::fetch_apps,
            uninstaller::uninstall_app,
            uninstaller::scan_app_remnants,
            uninstaller::clean_app_remnant,
            uninstaller::check_outdated_software,
            uninstaller::upgrade_software,
            shredder::shred_file,
            registry_cleaner::scan_registry,
            registry_cleaner::fix_registry_issue,
            registry_cleaner::list_registry_backups,
            registry_cleaner::restore_registry_backup,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Sweepr");
}
