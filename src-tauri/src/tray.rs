use once_cell::sync::Lazy;
use serde::Serialize;
use std::collections::HashSet;
use std::sync::Mutex;
use tauri::menu::MenuBuilder;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Window, WindowEvent};
use tauri_plugin_notification::NotificationExt;

use crate::commands::mail::{self, Message};

const TRAY_ID: &str = "main-tray";
const MENU_OPEN: &str = "tray-open";
const MENU_SYNC: &str = "tray-sync";
const MENU_QUIT: &str = "tray-quit";
const EVENT_NEW_MAIL: &str = "miomail://new-mail";

static SEEN_MESSAGE_KEYS: Lazy<Mutex<HashSet<String>>> = Lazy::new(|| Mutex::new(HashSet::new()));

#[derive(Debug, Clone, Serialize)]
pub struct NewMailEvent {
    pub message: Message,
    pub unread_count: i64,
}

pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let menu = MenuBuilder::new(app)
        .text(MENU_OPEN, "Open MioMail")
        .text(MENU_SYNC, "Sync now")
        .separator()
        .text(MENU_QUIT, "Quit")
        .build()?;

    let icon = app.default_window_icon().cloned().ok_or_else(|| {
        tauri::Error::AssetNotFound("default window icon not available".to_string())
    })?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("MioMail")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            MENU_OPEN => {
                let _ = show_main_window(app);
            }
            MENU_SYNC => {
                mail::spawn_sync_all_accounts(app.clone());
            }
            MENU_QUIT => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let _ = show_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

pub fn handle_window_event(window: &Window, event: &WindowEvent) {
    if window.label() != "main" {
        return;
    }

    if let WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let _ = window.hide();
    }
}

pub fn update_tray_tooltip(app: &AppHandle, unread_count: i64) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let tooltip = if unread_count > 0 {
            format!("MioMail - {} unread", unread_count)
        } else {
            "MioMail - No unread mail".to_string()
        };
        let _ = tray.set_tooltip(Some(tooltip));
    }
}

pub fn notify_new_mail(
    app: &AppHandle,
    unread_count: i64,
    messages: Vec<Message>,
) -> Result<(), String> {
    if messages.is_empty() {
        update_tray_tooltip(app, unread_count);
        return Ok(());
    }

    let fresh_messages = {
        let mut seen = SEEN_MESSAGE_KEYS.lock().map_err(|e| e.to_string())?;
        let mut fresh = Vec::new();

        for message in messages {
            let key = if message.message_id.is_empty() {
                format!(
                    "{}:{}:{}",
                    message.account_id, message.folder_id, message.uid
                )
            } else {
                format!("{}:{}", message.account_id, message.message_id)
            };

            if seen.insert(key) {
                fresh.push(message);
            }
        }

        fresh
    };

    if fresh_messages.is_empty() {
        update_tray_tooltip(app, unread_count);
        return Ok(());
    }

    // Messages arrive sorted by UID ascending, so the newest is the last one
    let latest = fresh_messages[fresh_messages.len() - 1].clone();
    app.notification()
        .builder()
        .title(if fresh_messages.len() == 1 {
            "New mail arrived"
        } else {
            "You have new mail"
        })
        .body(if fresh_messages.len() == 1 {
            format!(
                "{}\n{}",
                sanitize_text(&latest.from_address),
                sanitize_text(&title_or_fallback(&latest.subject))
            )
        } else {
            format!(
                "{} new messages\nLatest: {} / {}",
                fresh_messages.len(),
                sanitize_text(&latest.from_address),
                sanitize_text(&title_or_fallback(&latest.subject))
            )
        })
        .show()
        .map_err(|e| e.to_string())?;

    app.emit(
        EVENT_NEW_MAIL,
        NewMailEvent {
            message: latest,
            unread_count,
        },
    )
    .map_err(|e| e.to_string())?;

    update_tray_tooltip(app, unread_count);
    Ok(())
}

fn title_or_fallback(subject: &str) -> String {
    let trimmed = subject.trim();
    if trimmed.is_empty() {
        "(no subject)".to_string()
    } else {
        trimmed.to_string()
    }
}

fn sanitize_text(value: &str) -> String {
    value.replace('\n', " ").replace('\r', " ")
}

fn show_main_window(app: &AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("window not found")?;
    window.show().map_err(|e| e.to_string())?;
    window.unminimize().ok();
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}
