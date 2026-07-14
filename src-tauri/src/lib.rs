pub mod commands;
pub mod credentials;
pub mod db;
pub mod imap_service;
mod outlook_import;
pub mod smtp_service;
mod tray;

#[cfg(test)]
mod test_imap;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .manage(commands::character_mod::CharacterModRegistry::default())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .on_window_event(|window, event| {
            tray::handle_window_event(window, event);
        })
        .setup(|app| {
            db::init_database(app.handle())?;
            tray::setup_tray(app.handle())?;
            tray::update_tray_tooltip(app.handle(), 0);
            commands::mail::start_background_sync(app.handle().clone());

            let window = app.get_webview_window("main").unwrap();
            window.show().unwrap();

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::account::account_list,
            commands::account::account_create,
            commands::account::account_update,
            commands::account::account_test,
            commands::account::account_delete,
            commands::mail::mail_sync_folders,
            commands::mail::mail_list_folders,
            commands::mail::mail_sync_messages,
            commands::mail::mail_get_messages,
            commands::mail::mail_get_message,
            commands::mail::mail_mark_read,
            commands::mail::mail_delete,
            commands::mail::mail_search,
            commands::mail::compose_send,
            commands::import::import_outlook_folders,
            commands::import::import_outlook_messages,
            commands::import::import_outlook_body,
            commands::import::import_save,
            commands::app::app_minimize,
            commands::app::app_maximize,
            commands::app::app_close,
            commands::app::app_is_maximized,
            commands::app::app_show_main_window,
            commands::app::app_quit,
            commands::build::app_get_build_info,
            commands::update::update_check,
            commands::update::update_install,
            commands::character_mod::character_mod_list,
            commands::character_mod::character_mod_read_asset,
            commands::character_mod::character_mod_open_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
