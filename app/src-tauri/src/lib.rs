mod cleaner;
mod commands;
mod error;
mod licensing;
mod memory;
mod rules;
mod safety;
mod scanner;
mod duplicates;
mod uninstaller;
mod shredder;
mod registry_cleaner;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            app.manage(commands::AppState {
                licensing: licensing::Licensing::new(data_dir),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::scan_start,
            commands::clean_categories,
            commands::license_status,
            commands::start_checkout,
            commands::open_billing_portal,
            commands::memory_overview,
            commands::startup_items,
            duplicates::find_duplicates,
            uninstaller::fetch_apps,
            uninstaller::uninstall_app,
            shredder::shred_file,
            registry_cleaner::scan_registry,
            registry_cleaner::fix_registry_issue,
            commands::app_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Sweepr");
}

