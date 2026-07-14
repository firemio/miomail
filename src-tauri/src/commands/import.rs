use crate::db::{parse_date_to_timestamp, DbState};
use crate::outlook_import;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn import_outlook_folders(app: AppHandle) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        outlook_import::run_extract(&app, &["--folders"]).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn import_outlook_messages(
    folder_id: String,
    app: AppHandle,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        outlook_import::run_extract(&app, &["--messages", &folder_id]).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn import_outlook_body(
    item_id: String,
    app: AppHandle,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        outlook_import::run_extract(&app, &["--body", &item_id]).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Debug, Deserialize)]
pub struct ImportItem {
    // Real RFC822 Message-ID (preferred identity for dedupe)
    #[serde(alias = "internetMessageId", alias = "messageId")]
    pub msg_id: Option<String>,
    // Outlook item id — sent alongside msg_id by the dialog, so it must be
    // its own field (serde errors on two aliases hitting one field)
    #[serde(alias = "itemId")]
    pub item_id: Option<String>,
    pub subject: Option<String>,
    pub from: Option<String>,
    pub to: Option<String>,
    pub date: Option<String>,
    pub preview: Option<String>,
    pub snippet: Option<String>,
    pub html: Option<String>,
    pub text: Option<String>,
    #[serde(alias = "isRead")]
    pub is_read: Option<bool>,
    #[serde(alias = "hasAttachments")]
    pub has_attachments: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct ImportResult {
    pub imported: i64,
}

#[tauri::command]
pub fn import_save(
    account_id: i64,
    folder_id: i64,
    items: Vec<ImportItem>,
    db: State<'_, DbState>,
) -> Result<ImportResult, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // Verify folder belongs to account
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM folders WHERE id = ?1 AND account_id = ?2",
            [folder_id, account_id],
            |row| row.get(0),
        )
        .unwrap_or(0);
    if count == 0 {
        return Err("Folder not found or access denied".into());
    }

    let mut imported: i64 = 0;

    for item in &items {
        let msg_id = item
            .msg_id
            .as_deref()
            .filter(|s| !s.is_empty())
            .or(item.item_id.as_deref())
            .unwrap_or("");

        if !msg_id.is_empty() {
            let exists: i64 = conn.query_row(
                "SELECT COUNT(*) FROM messages WHERE account_id = ?1 AND folder_id = ?2 AND message_id = ?3",
                rusqlite::params![account_id, folder_id, msg_id], |row| row.get(0)
            ).unwrap_or(0);
            if exists > 0 {
                continue;
            }
        }

        let flags = if item.is_read.unwrap_or(true) {
            r#"["\\Seen"]"#
        } else {
            "[]"
        };
        let snippet_text = item
            .preview
            .as_deref()
            .or(item.snippet.as_deref())
            .unwrap_or("");
        let snippet_short: String = snippet_text.chars().take(120).collect();
        let date = item.date.as_deref().unwrap_or("");
        let date_ts = parse_date_to_timestamp(date);

        // Imported (local-only) messages get uid = NULL so they can never
        // collide with real IMAP UIDs and silently swallow future new mail
        conn.execute(
            "INSERT INTO messages (account_id, folder_id, uid, message_id, subject, from_address, to_addresses, cc_addresses, date, date_ts, flags, snippet, has_attachments) VALUES (?1,?2,NULL,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
            rusqlite::params![
                account_id, folder_id, msg_id,
                item.subject.as_deref().unwrap_or(""), item.from.as_deref().unwrap_or(""),
                item.to.as_deref().unwrap_or(""), "", date, date_ts,
                flags, snippet_short, if item.has_attachments.unwrap_or(false) { 1i64 } else { 0i64 }
            ],
        ).map_err(|e| e.to_string())?;

        let row_id = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO message_bodies (message_id, html_body, text_body) VALUES (?1, ?2, ?3)",
            rusqlite::params![
                row_id,
                item.html.as_deref().unwrap_or(""),
                item.text.as_deref().unwrap_or("")
            ],
        )
        .ok();

        imported += 1;
    }

    crate::commands::mail::recompute_folder_counts(&conn, folder_id);

    Ok(ImportResult { imported })
}
