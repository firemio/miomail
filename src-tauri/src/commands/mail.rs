use crate::credentials;
use crate::db::DbState;
use crate::imap_service::{self, ImapConfig};
use crate::smtp_service::{self, ComposeData, SmtpConfig};
use crate::tray;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use tauri::{AppHandle, Manager, State};
use tokio::time::{sleep, Duration};

#[derive(Debug, Serialize)]
pub struct Folder {
    pub id: i64,
    pub account_id: i64,
    pub path: String,
    pub name: String,
    pub delimiter: String,
    pub flags: String,
    pub unread_count: i64,
    pub total_count: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Message {
    pub id: i64,
    pub account_id: i64,
    pub folder_id: i64,
    pub uid: i64,
    pub message_id: String,
    pub subject: String,
    pub from_address: String,
    pub to_addresses: String,
    pub cc_addresses: String,
    pub date: String,
    pub date_ts: i64,
    pub flags: String,
    pub snippet: String,
    pub has_attachments: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct AttachmentMeta {
    pub id: i64,
    pub message_id: i64,
    pub filename: String,
    pub mime_type: String,
    pub size: i64,
    pub is_inline: i64,
}

#[derive(Debug, Serialize)]
pub struct MessageFull {
    #[serde(flatten)]
    pub msg: Message,
    pub html_body: String,
    pub text_body: String,
    pub attachments: Vec<AttachmentMeta>,
}

#[derive(Debug, Deserialize)]
pub struct ComposeAttachmentInput {
    /// Local file picked in the composer
    pub path: Option<String>,
    /// Cached attachment of a received message (forwarding)
    #[serde(rename = "attachmentId")]
    pub attachment_id: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct ComposeInput {
    pub from: String,
    pub to: String,
    pub cc: Option<String>,
    pub subject: String,
    pub html: String,
    pub text: Option<String>,
    #[serde(rename = "inReplyTo")]
    pub in_reply_to: Option<String>,
    pub references: Option<String>,
    pub attachments: Option<Vec<ComposeAttachmentInput>>,
}

const MESSAGE_COLUMNS: &str = "id, account_id, folder_id, uid, message_id, subject, from_address, to_addresses, cc_addresses, date, date_ts, flags, snippet, has_attachments";

pub fn get_imap_config(conn: &rusqlite::Connection, account_id: i64) -> Result<ImapConfig, String> {
    let mut stmt = conn
        .prepare("SELECT email, imap_host, imap_port, imap_tls FROM accounts WHERE id = ?1")
        .map_err(|e| e.to_string())?;
    let config = stmt
        .query_row([account_id], |row| {
            let email: String = row.get(0)?;
            let host: String = row.get::<_, Option<String>>(1)?.unwrap_or_default();
            let port: i64 = row.get::<_, Option<i64>>(2)?.unwrap_or(993);
            let tls: i64 = row.get::<_, Option<i64>>(3)?.unwrap_or(1);
            Ok((email, host, port, tls))
        })
        .map_err(|e| e.to_string())?;

    let pass = credentials::get_password(&format!("miomail-imap-{}", account_id))
        .map_err(|e| e.to_string())?
        .ok_or("Password not found")?;

    Ok(ImapConfig {
        host: config.1,
        port: config.2 as u16,
        secure: config.3 == 1,
        user: config.0,
        pass,
        accept_invalid_certs: false,
    })
}

fn message_from_row(row: &rusqlite::Row) -> Result<Message, rusqlite::Error> {
    Ok(Message {
        id: row.get(0)?,
        account_id: row.get(1)?,
        folder_id: row.get(2)?,
        uid: row.get::<_, Option<i64>>(3)?.unwrap_or(0),
        message_id: row.get::<_, Option<String>>(4)?.unwrap_or_default(),
        subject: row.get::<_, Option<String>>(5)?.unwrap_or_default(),
        from_address: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
        to_addresses: row.get::<_, Option<String>>(7)?.unwrap_or_default(),
        cc_addresses: row.get::<_, Option<String>>(8)?.unwrap_or_default(),
        date: row.get::<_, Option<String>>(9)?.unwrap_or_default(),
        date_ts: row.get::<_, Option<i64>>(10)?.unwrap_or(0),
        flags: row.get::<_, Option<String>>(11)?.unwrap_or_default(),
        snippet: row.get::<_, Option<String>>(12)?.unwrap_or_default(),
        has_attachments: row.get::<_, Option<i64>>(13)?.unwrap_or(0),
    })
}

fn query_folder(
    conn: &rusqlite::Connection,
    sql: &str,
    params: &[&dyn rusqlite::types::ToSql],
) -> Result<Vec<Folder>, String> {
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let folders = stmt
        .query_map(rusqlite::params_from_iter(params.iter()), |row| {
            Ok(Folder {
                id: row.get(0)?,
                account_id: row.get(1)?,
                path: row.get(2)?,
                name: row.get(3)?,
                delimiter: row.get::<_, Option<String>>(4)?.unwrap_or_default(),
                flags: row.get::<_, Option<String>>(5)?.unwrap_or_default(),
                unread_count: row.get::<_, Option<i64>>(6)?.unwrap_or(0),
                total_count: row.get::<_, Option<i64>>(7)?.unwrap_or(0),
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(folders)
}

pub fn query_messages(
    conn: &rusqlite::Connection,
    sql: &str,
    params: &[&dyn rusqlite::types::ToSql],
) -> Result<Vec<Message>, String> {
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let msgs = stmt
        .query_map(rusqlite::params_from_iter(params.iter()), message_from_row)
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(msgs)
}

/// Classify a folder as a special-use kind ("sent", "trash", "junk", "drafts")
/// from its stored flags / name / path.
pub fn folder_matches_kind(flags: &str, name: &str, path: &str, kind: &str) -> bool {
    let flags_l = flags.to_lowercase();
    let name_l = name.to_lowercase();
    let path_l = path.to_lowercase();
    let name_hit = |needles: &[&str]| {
        needles
            .iter()
            .any(|n| name_l.contains(n) || path_l.contains(n))
    };
    match kind {
        "sent" => flags_l.contains("\\sent") || name_hit(&["sent", "送信済"]),
        "trash" => {
            flags_l.contains("\\trash")
                || name_hit(&["trash", "deleted", "ゴミ箱", "削除済"])
        }
        "junk" => flags_l.contains("\\junk") || name_hit(&["junk", "spam", "迷惑"]),
        "drafts" => flags_l.contains("\\drafts") || name_hit(&["draft", "下書き"]),
        _ => false,
    }
}

pub fn find_special_folder(
    conn: &rusqlite::Connection,
    account_id: i64,
    kind: &str,
) -> Option<(i64, String)> {
    let mut stmt = conn
        .prepare("SELECT id, path, name, flags FROM folders WHERE account_id = ?1")
        .ok()?;
    let rows: Vec<(i64, String, String, String)> = stmt
        .query_map([account_id], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get::<_, Option<String>>(3)?.unwrap_or_default(),
            ))
        })
        .ok()?
        .filter_map(|r| r.ok())
        .collect();

    rows.into_iter()
        .find(|(_, path, name, flags)| folder_matches_kind(flags, name, path, kind))
        .map(|(id, path, _, _)| (id, path))
}

/// Recompute a folder's total/unread counters from the messages table.
pub fn recompute_folder_counts(conn: &rusqlite::Connection, folder_id: i64) {
    let (total, unread): (i64, i64) = conn
        .query_row(
            "SELECT COUNT(*), SUM(CASE WHEN flags NOT LIKE '%Seen%' THEN 1 ELSE 0 END) FROM messages WHERE folder_id = ?1",
            [folder_id],
            |row| Ok((row.get(0)?, row.get::<_, Option<i64>>(1)?.unwrap_or(0))),
        )
        .unwrap_or((0, 0));
    conn.execute(
        "UPDATE folders SET total_count = ?1, unread_count = ?2 WHERE id = ?3",
        rusqlite::params![total, unread, folder_id],
    )
    .ok();
}

#[tauri::command]
pub async fn mail_sync_folders(
    account_id: i64,
    db: State<'_, DbState>,
) -> Result<Vec<Folder>, String> {
    sync_folders_for_account(account_id, db.inner()).await
}

/// DB-only folder listing (no network) so the UI can refresh counts cheaply.
#[tauri::command]
pub fn mail_list_folders(account_id: i64, db: State<'_, DbState>) -> Result<Vec<Folder>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    query_folder(
        &conn,
        "SELECT id, account_id, path, name, delimiter, flags, unread_count, total_count FROM folders WHERE account_id = ?1 ORDER BY path",
        &[&account_id],
    )
}

pub async fn sync_folders_for_account(
    account_id: i64,
    db: &DbState,
) -> Result<Vec<Folder>, String> {
    let config = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        get_imap_config(&conn, account_id)?
    };

    let folders = imap_service::list_folders(&config).await.map_err(|e| {
        log::error!("list_folders failed: {}", e);
        e.to_string()
    })?;

    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    for f in &folders {
        let flags_json = serde_json::to_string(&f.flags).unwrap_or_default();
        conn.execute(
            "INSERT INTO folders (account_id, path, name, delimiter, flags) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(account_id, path) DO UPDATE SET name=excluded.name, flags=excluded.flags",
            rusqlite::params![account_id, f.path, f.name, f.delimiter, flags_json],
        )
        .map_err(|e| e.to_string())?;
    }

    query_folder(
        &conn,
        "SELECT id, account_id, path, name, delimiter, flags, unread_count, total_count FROM folders WHERE account_id = ?1 ORDER BY path",
        &[&account_id],
    )
}

/// Unread messages across all folders except sent/trash/junk/drafts.
pub fn total_unread_count(db: &DbState) -> Result<i64, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT f.id, f.path, f.name, COALESCE(f.flags, ''), COALESCE(f.unread_count, 0) FROM folders f",
        )
        .map_err(|e| e.to_string())?;
    let total = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .filter(|(path, name, flags, _)| {
            !["sent", "trash", "junk", "drafts"]
                .iter()
                .any(|kind| folder_matches_kind(flags, name, path, kind))
        })
        .map(|(_, _, _, unread)| unread)
        .sum();
    Ok(total)
}

/// Sync one folder: reconcile flags/deletions with the server, pull new
/// headers, update counters, and (optionally) fire new-mail notifications.
pub async fn sync_messages_for_folder(
    app: Option<&AppHandle>,
    account_id: i64,
    folder_id: i64,
    db: &DbState,
) -> Result<(), String> {
    let (config, folder_path, min_uid, max_uid) = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        let config = get_imap_config(&conn, account_id)?;

        let folder_path: String = conn
            .query_row(
                "SELECT path FROM folders WHERE id = ?1 AND account_id = ?2",
                [folder_id, account_id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;

        let (min_uid, max_uid): (i64, i64) = conn
            .query_row(
                "SELECT COALESCE(MIN(uid), 0), COALESCE(MAX(uid), 0) FROM messages WHERE account_id = ?1 AND folder_id = ?2 AND uid > 0",
                [account_id, folder_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap_or((0, 0));

        (config, folder_path, min_uid, max_uid)
    };

    // 1. Reconcile existing messages (flag changes / deletions on other clients)
    if max_uid > 0 {
        let server_flags = imap_service::fetch_flags(&config, &folder_path, min_uid as u32)
            .await
            .map_err(|e| e.to_string())?;
        let server_map: HashMap<i64, &Vec<String>> = server_flags
            .iter()
            .map(|f| (f.uid as i64, &f.flags))
            .collect();

        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id, uid, COALESCE(flags, '[]') FROM messages WHERE folder_id = ?1 AND uid > 0")
            .map_err(|e| e.to_string())?;
        let local_rows: Vec<(i64, i64, String)> = stmt
            .query_map([folder_id], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?))
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        drop(stmt);

        for (row_id, uid, local_flags_json) in local_rows {
            match server_map.get(&uid) {
                None => {
                    // Deleted on the server (webmail/another client)
                    conn.execute("DELETE FROM attachments WHERE message_id = ?1", [row_id])
                        .ok();
                    conn.execute("DELETE FROM message_bodies WHERE message_id = ?1", [row_id])
                        .ok();
                    conn.execute("DELETE FROM messages WHERE id = ?1", [row_id])
                        .ok();
                }
                Some(server) => {
                    let local: HashSet<String> =
                        serde_json::from_str::<Vec<String>>(&local_flags_json)
                            .unwrap_or_default()
                            .into_iter()
                            .collect();
                    let server_set: HashSet<String> = server.iter().cloned().collect();
                    if local != server_set {
                        conn.execute(
                            "UPDATE messages SET flags = ?1 WHERE id = ?2",
                            rusqlite::params![
                                serde_json::to_string(&server).unwrap_or_default(),
                                row_id
                            ],
                        )
                        .ok();
                    }
                }
            }
        }
    }

    // 2. Fetch new messages (since_uid == 0 -> initial sync)
    let since_uid = if max_uid > 0 { (max_uid + 1) as u32 } else { 0 };
    let messages = imap_service::fetch_messages(&config, &folder_path, since_uid)
        .await
        .map_err(|e| e.to_string())?;

    {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        for m in &messages {
            let flags_json = serde_json::to_string(&m.flags).unwrap_or_default();
            conn.execute(
                "INSERT OR IGNORE INTO messages (account_id, folder_id, uid, message_id, subject, from_address, to_addresses, cc_addresses, date, date_ts, flags, snippet, has_attachments) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
                rusqlite::params![account_id, folder_id, m.uid as i64, m.message_id, m.subject, m.from, m.to, m.cc, m.date, m.date_ts, flags_json, m.snippet, if m.has_attachments { 1i64 } else { 0i64 }],
            ).ok();
        }

        recompute_folder_counts(&conn, folder_id);
    }

    // 3. Notify — only for genuinely new, still-unread messages after an
    //    incremental sync (not the initial import of an existing mailbox)
    let total_unread = total_unread_count(db)?;
    if let Some(app) = app {
        if since_uid > 0 {
            let fresh_unread: Vec<Message> = messages
                .iter()
                .filter(|m| !m.flags.iter().any(|f| f == "\\Seen"))
                .map(|m| Message {
                    id: 0,
                    account_id,
                    folder_id,
                    uid: m.uid as i64,
                    message_id: m.message_id.clone(),
                    subject: m.subject.clone(),
                    from_address: m.from.clone(),
                    to_addresses: m.to.clone(),
                    cc_addresses: m.cc.clone(),
                    date: m.date.clone(),
                    date_ts: m.date_ts,
                    flags: serde_json::to_string(&m.flags).unwrap_or_default(),
                    snippet: m.snippet.clone(),
                    has_attachments: if m.has_attachments { 1 } else { 0 },
                })
                .collect();
            tray::notify_new_mail(app, total_unread, fresh_unread)?;
        } else {
            tray::update_tray_tooltip(app, total_unread);
        }
    }

    Ok(())
}

pub async fn sync_all_accounts(app: Option<&AppHandle>, db: &DbState) -> Result<(), String> {
    let account_ids = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id FROM accounts ORDER BY id")
            .map_err(|e| e.to_string())?;
        let account_ids = stmt
            .query_map([], |row| row.get::<_, i64>(0))
            .map_err(|e| e.to_string())?
            .filter_map(|row| row.ok())
            .collect::<Vec<_>>();
        account_ids
    };

    for account_id in account_ids {
        // One broken account must not stop the others from syncing
        let folders = match sync_folders_for_account(account_id, db).await {
            Ok(folders) => folders,
            Err(error) => {
                log::error!("folder sync failed for account {}: {}", account_id, error);
                continue;
            }
        };

        let inbox_folders = folders
            .into_iter()
            .filter(|folder| {
                folder.path.eq_ignore_ascii_case("INBOX")
                    || folder.name.eq_ignore_ascii_case("INBOX")
                    || folder.flags.contains("\\Inbox")
            })
            .collect::<Vec<_>>();

        for folder in inbox_folders {
            if let Err(error) = sync_messages_for_folder(app, account_id, folder.id, db).await {
                log::error!(
                    "message sync failed for account {} folder {}: {}",
                    account_id,
                    folder.path,
                    error
                );
            }
        }
    }

    if let Some(app) = app {
        tray::update_tray_tooltip(app, total_unread_count(db)?);
    }
    Ok(())
}

pub fn spawn_sync_all_accounts(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let db = app.state::<DbState>();
        if let Err(error) = sync_all_accounts(Some(&app), db.inner()).await {
            log::error!("background sync failed: {}", error);
        }
    });
}

pub fn start_background_sync(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            sleep(Duration::from_secs(60)).await;
            let db = app.state::<DbState>();
            if let Err(error) = sync_all_accounts(Some(&app), db.inner()).await {
                log::error!("background polling failed: {}", error);
            }
        }
    });
}

/// MCPサーバー(別プロセス)がapp_eventsキューへ入れたイベントを拾い、
/// フロントへ転送してマスコットの配達アニメーションなどに反映する。
pub fn start_mcp_event_bridge(app: AppHandle) {
    use tauri::Emitter;

    tauri::async_runtime::spawn(async move {
        // アプリ起動前に溜まったイベントは演出しても意味がないので黙って消化する
        {
            let db = app.state::<DbState>();
            let lock = db.conn.lock();
            if let Ok(conn) = lock {
                let _ = conn.execute("UPDATE app_events SET consumed = 1 WHERE consumed = 0", []);
            }
        }

        loop {
            sleep(Duration::from_secs(2)).await;

            let events: Vec<(i64, String, String)> = {
                let db = app.state::<DbState>();
                let Ok(conn) = db.conn.lock() else { continue };
                let Ok(mut stmt) = conn.prepare(
                    "SELECT id, event_type, COALESCE(payload, '') FROM app_events
                     WHERE consumed = 0 ORDER BY id LIMIT 20",
                ) else {
                    continue;
                };
                stmt.query_map([], |row| {
                    Ok((row.get(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
                })
                .map(|rows| rows.filter_map(Result::ok).collect())
                .unwrap_or_default()
            };

            if events.is_empty() {
                continue;
            }

            for (_, event_type, payload) in &events {
                if event_type == "mcp_mail_sent" {
                    if let Ok(value) = serde_json::from_str::<serde_json::Value>(payload) {
                        let _ = app.emit("miomail://mcp-mail-sent", value);
                    }
                }
            }

            let max_id = events.iter().map(|(id, _, _)| *id).max().unwrap_or(0);
            let db = app.state::<DbState>();
            let lock = db.conn.lock();
            if let Ok(conn) = lock {
                let _ = conn.execute("UPDATE app_events SET consumed = 1 WHERE id <= ?1", [max_id]);
                let _ = conn.execute(
                    "DELETE FROM app_events WHERE consumed = 1 AND created_ts < strftime('%s','now') - 86400",
                    [],
                );
            }
        }
    });
}

#[tauri::command]
pub async fn mail_sync_messages(
    app: AppHandle,
    account_id: i64,
    folder_id: i64,
    db: State<'_, DbState>,
) -> Result<(), String> {
    sync_messages_for_folder(Some(&app), account_id, folder_id, db.inner()).await
}

#[tauri::command]
pub fn mail_get_messages(
    folder_id: i64,
    offset: i64,
    limit: i64,
    db: State<'_, DbState>,
) -> Result<Vec<Message>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    query_messages(
        &conn,
        &format!("SELECT {} FROM messages WHERE folder_id = ?1 ORDER BY date_ts DESC, uid DESC LIMIT ?2 OFFSET ?3", MESSAGE_COLUMNS),
        &[&folder_id, &limit, &offset],
    )
}

fn make_snippet(text: &str) -> String {
    text.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(140)
        .collect()
}

#[tauri::command]
pub async fn mail_get_message(
    message_id: i64,
    db: State<'_, DbState>,
) -> Result<MessageFull, String> {
    get_message_core(db.inner(), message_id, true).await
}

/// Load a full message (from cache or the server). `mark_read` controls
/// whether opening it also sets \Seen (the app does, the MCP server doesn't).
pub async fn get_message_core(
    db: &DbState,
    message_id: i64,
    mark_read: bool,
) -> Result<MessageFull, String> {
    let (msg, cached, config, folder_path) = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        let msg_row = conn
            .query_row(
                &format!("SELECT {} FROM messages WHERE id = ?1", MESSAGE_COLUMNS),
                [message_id],
                message_from_row,
            )
            .map_err(|e| e.to_string())?;

        // (html, text, attachments_synced) — bodies cached before attachment
        // support have attachments_synced = 0 and get re-fetched once
        let cached: Option<(String, String, i64)> = conn
            .query_row(
                "SELECT html_body, text_body, COALESCE(attachments_synced, 0) FROM message_bodies WHERE message_id = ?1",
                [message_id],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?.unwrap_or_default(),
                        row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                        row.get::<_, Option<i64>>(2)?.unwrap_or(0),
                    ))
                },
            )
            .ok();
        let config = get_imap_config(&conn, msg_row.account_id)?;
        let folder_path: String = conn
            .query_row(
                "SELECT path FROM folders WHERE id = ?1",
                [msg_row.folder_id],
                |row| row.get(0),
            )
            .unwrap_or_default();

        (msg_row, cached, config, folder_path)
    };

    let fetch_needed = match &cached {
        None => true,
        Some((_, _, attachments_synced)) => *attachments_synced == 0,
    };

    let mut fetched: Option<imap_service::MessageBody> = None;
    if fetch_needed && msg.uid > 0 {
        match imap_service::fetch_body(&config, &folder_path, msg.uid as u32, !mark_read).await {
            Ok(body) => fetched = Some(body),
            Err(e) => {
                // A stale cached body is still better than an error
                if cached.is_none() {
                    return Err(e.to_string());
                }
                log::warn!("attachment re-fetch failed for message {}: {}", message_id, e);
            }
        }
    }

    let (html_body, text_body) = if let Some(body) = fetched {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("INSERT OR REPLACE INTO message_bodies (message_id, html_body, text_body, attachments_synced) VALUES (?1, ?2, ?3, 1)",
            rusqlite::params![message_id, body.html, body.text]).ok();
        conn.execute("DELETE FROM attachments WHERE message_id = ?1", [message_id])
            .ok();
        for att in &body.attachments {
            conn.execute(
                "INSERT INTO attachments (message_id, filename, mime_type, size, content_id, is_inline, data) VALUES (?1,?2,?3,?4,?5,?6,?7)",
                rusqlite::params![
                    message_id,
                    att.filename,
                    att.mime_type,
                    att.data.len() as i64,
                    att.content_id,
                    if att.is_inline { 1i64 } else { 0i64 },
                    att.data,
                ],
            )
            .ok();
        }
        // Reflect real attachment state (BODYSTRUCTURE heuristics can differ)
        conn.execute(
            "UPDATE messages SET has_attachments = ?1 WHERE id = ?2",
            rusqlite::params![
                if body.attachments.iter().any(|a| !a.is_inline) { 1i64 } else { 0i64 },
                message_id
            ],
        )
        .ok();
        // Now that we have the body, store a real preview snippet
        let snippet = make_snippet(if body.text.is_empty() { &body.html } else { &body.text });
        if !snippet.is_empty() {
            conn.execute(
                "UPDATE messages SET snippet = ?1 WHERE id = ?2",
                rusqlite::params![snippet, message_id],
            )
            .ok();
        }
        (body.html, body.text)
    } else if let Some((html, text, _)) = cached {
        (html, text)
    } else {
        return Err("このメールの本文はローカルに保存されていません".to_string());
    };

    let attachments = list_attachment_meta(db, message_id)?;

    // Mark as read
    if mark_read {
        let flags: Vec<String> = serde_json::from_str(&msg.flags).unwrap_or_default();
        if !flags.contains(&"\\Seen".to_string()) {
            if msg.uid > 0 {
                imap_service::add_flags(&config, &folder_path, msg.uid as u32, "\\Seen")
                    .await
                    .ok();
            }
            let mut new_flags = flags;
            new_flags.push("\\Seen".to_string());
            let conn = db.conn.lock().map_err(|e| e.to_string())?;
            conn.execute(
                "UPDATE messages SET flags = ?1 WHERE id = ?2",
                rusqlite::params![
                    serde_json::to_string(&new_flags).unwrap_or_default(),
                    message_id
                ],
            )
            .ok();
            recompute_folder_counts(&conn, msg.folder_id);
        }
    }

    let mut msg = msg;
    if !attachments.is_empty() {
        msg.has_attachments = if attachments.iter().any(|a| a.is_inline == 0) { 1 } else { msg.has_attachments };
    }

    Ok(MessageFull {
        msg,
        html_body,
        text_body,
        attachments,
    })
}

pub fn list_attachment_meta(db: &DbState, message_id: i64) -> Result<Vec<AttachmentMeta>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, message_id, filename, COALESCE(mime_type, 'application/octet-stream'), COALESCE(size, 0), COALESCE(is_inline, 0) FROM attachments WHERE message_id = ?1 ORDER BY is_inline, id",
        )
        .map_err(|e| e.to_string())?;
    let metas = stmt
        .query_map([message_id], |row| {
            Ok(AttachmentMeta {
                id: row.get(0)?,
                message_id: row.get(1)?,
                filename: row.get(2)?,
                mime_type: row.get(3)?,
                size: row.get(4)?,
                is_inline: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(metas)
}

#[tauri::command]
pub async fn mail_mark_read(
    message_id: i64,
    read: bool,
    db: State<'_, DbState>,
) -> Result<(), String> {
    mark_read_core(db.inner(), message_id, read).await
}

pub async fn mark_read_core(db: &DbState, message_id: i64, read: bool) -> Result<(), String> {
    let (config, folder_path, folder_id, uid, flags_str) = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        let (account_id, folder_id, uid, flags): (i64, i64, i64, String) = conn
            .query_row(
                "SELECT account_id, folder_id, uid, flags FROM messages WHERE id = ?1",
                [message_id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get::<_, Option<i64>>(2)?.unwrap_or(0),
                        row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                    ))
                },
            )
            .map_err(|e| e.to_string())?;
        let config = get_imap_config(&conn, account_id)?;
        let fp: String = conn
            .query_row(
                "SELECT path FROM folders WHERE id = ?1",
                [folder_id],
                |row| row.get(0),
            )
            .unwrap_or_default();
        (config, fp, folder_id, uid, flags)
    };

    if uid > 0 {
        if read {
            imap_service::add_flags(&config, &folder_path, uid as u32, "\\Seen")
                .await
                .ok();
        } else {
            imap_service::remove_flags(&config, &folder_path, uid as u32, "\\Seen")
                .await
                .ok();
        }
    }

    let mut flags: Vec<String> = serde_json::from_str(&flags_str).unwrap_or_default();
    if read && !flags.contains(&"\\Seen".to_string()) {
        flags.push("\\Seen".to_string());
    } else if !read {
        flags.retain(|f| f != "\\Seen");
    }

    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE messages SET flags = ?1 WHERE id = ?2",
        rusqlite::params![
            serde_json::to_string(&flags).unwrap_or_default(),
            message_id
        ],
    )
    .ok();
    recompute_folder_counts(&conn, folder_id);
    Ok(())
}

/// Delete a message. Moves it to the account's Trash folder when possible;
/// deleting from the Trash itself (or when no Trash exists) is permanent.
#[tauri::command]
pub async fn mail_delete(message_id: i64, db: State<'_, DbState>) -> Result<(), String> {
    delete_core(db.inner(), message_id).await
}

pub async fn delete_core(db: &DbState, message_id: i64) -> Result<(), String> {
    let (config, folder_path, folder_id, uid, trash) = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        let (account_id, folder_id, uid): (i64, i64, i64) = conn
            .query_row(
                "SELECT account_id, folder_id, uid FROM messages WHERE id = ?1",
                [message_id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get::<_, Option<i64>>(2)?.unwrap_or(0),
                    ))
                },
            )
            .map_err(|e| e.to_string())?;
        let config = get_imap_config(&conn, account_id)?;
        let fp: String = conn
            .query_row(
                "SELECT path FROM folders WHERE id = ?1",
                [folder_id],
                |row| row.get(0),
            )
            .unwrap_or_default();
        let trash = find_special_folder(&conn, account_id, "trash");
        (config, fp, folder_id, uid, trash)
    };

    if uid > 0 {
        let deleting_from_trash = trash
            .as_ref()
            .map(|(trash_id, _)| *trash_id == folder_id)
            .unwrap_or(false);

        let server_result = match (&trash, deleting_from_trash) {
            (Some((_, trash_path)), false) => {
                imap_service::move_message(&config, &folder_path, uid as u32, trash_path).await
            }
            _ => imap_service::delete_message(&config, &folder_path, uid as u32).await,
        };
        if let Err(e) = server_result {
            // Keep local state consistent with the server: surface the error
            // instead of silently deleting only the local copy
            return Err(format!("サーバー上の削除に失敗しました: {}", e));
        }
    }

    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM attachments WHERE message_id = ?1", [message_id])
        .ok();
    conn.execute(
        "DELETE FROM message_bodies WHERE message_id = ?1",
        [message_id],
    )
    .ok();
    conn.execute("DELETE FROM messages WHERE id = ?1", [message_id])
        .ok();
    recompute_folder_counts(&conn, folder_id);
    Ok(())
}

#[tauri::command]
pub fn mail_search(
    account_id: i64,
    query: String,
    db: State<'_, DbState>,
) -> Result<Vec<Message>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let q = format!("%{}%", query);
    query_messages(&conn,
        &format!("SELECT {} FROM messages WHERE account_id = ?1 AND (subject LIKE ?2 OR from_address LIKE ?3 OR snippet LIKE ?4 OR id IN (SELECT message_id FROM message_bodies WHERE text_body LIKE ?5)) ORDER BY date_ts DESC LIMIT 50", MESSAGE_COLUMNS),
        &[&account_id, &q as &dyn rusqlite::types::ToSql, &q, &q, &q])
}

pub async fn send_and_record(db: &DbState, data: ComposeData) -> Result<(), String> {
    let (config, account_id) = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        // Several rows can share one address (stale rows from old imports),
        // so prefer the newest account that actually has SMTP credentials
        let mut stmt = conn
            .prepare("SELECT id, email, smtp_host, smtp_port, smtp_tls FROM accounts WHERE email = ?1 ORDER BY id DESC")
            .map_err(|e| e.to_string())?;
        let candidates: Vec<(i64, String, String, i64, i64)> = stmt
            .query_map([&data.from], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                    row.get::<_, Option<i64>>(3)?.unwrap_or(587),
                    row.get::<_, Option<i64>>(4)?.unwrap_or(0),
                ))
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        drop(stmt);

        if candidates.is_empty() {
            return Err(format!("送信元アカウントが見つかりません: {}", data.from));
        }

        let chosen = candidates.into_iter().find_map(|(id, email, host, port, tls)| {
            credentials::get_password(&format!("miomail-smtp-{}", id))
                .ok()
                .flatten()
                .map(|pass| (id, email, host, port, tls, pass))
        });

        let Some((id, email, host, port, tls, pass)) = chosen else {
            return Err(format!(
                "SMTPパスワードが保存されていません（{}）。設定画面でパスワードを保存し直してください",
                data.from
            ));
        };

        (
            SmtpConfig {
                host,
                port: port as u16,
                secure: tls == 1,
                user: email,
                pass,
                accept_invalid_certs: false,
            },
            id,
        )
    };

    let raw = smtp_service::send(&config, &data)
        .await
        .map_err(|e| e.to_string())?;

    // Save a copy to the IMAP Sent folder (best effort — the mail is already out)
    let sent_folder = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        find_special_folder(&conn, account_id, "sent")
    };
    if let Some((sent_id, sent_path)) = sent_folder {
        let imap_config = {
            let conn = db.conn.lock().map_err(|e| e.to_string())?;
            get_imap_config(&conn, account_id)?
        };
        match imap_service::append_message(&imap_config, &sent_path, Some("(\\Seen)"), &raw).await {
            Ok(()) => {
                // Pull the appended message into the local cache
                if let Err(e) = sync_messages_for_folder(None, account_id, sent_id, db).await {
                    log::warn!("sent folder sync after append failed: {}", e);
                }
            }
            Err(e) => log::warn!("could not save sent mail to '{}': {}", sent_path, e),
        }
    } else {
        log::warn!("no Sent folder found for account {}; sent mail not archived", account_id);
    }

    Ok(())
}

/// Guard against renaming/deleting the well-known system folders.
fn is_protected_folder(conn: &rusqlite::Connection, folder_id: i64) -> bool {
    let row: Option<(String, String, String)> = conn
        .query_row(
            "SELECT path, name, COALESCE(flags, '') FROM folders WHERE id = ?1",
            [folder_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .ok();
    match row {
        Some((path, name, flags)) => {
            path.eq_ignore_ascii_case("INBOX")
                || ["sent", "trash", "junk", "drafts"]
                    .iter()
                    .any(|kind| folder_matches_kind(&flags, &name, &path, kind))
        }
        None => false,
    }
}

/// The delimiter an account's server uses (from any existing folder), default "/".
fn account_delimiter(conn: &rusqlite::Connection, account_id: i64) -> String {
    conn.query_row(
        "SELECT delimiter FROM folders WHERE account_id = ?1 AND delimiter IS NOT NULL AND delimiter != '' LIMIT 1",
        [account_id],
        |row| row.get::<_, String>(0),
    )
    .ok()
    .filter(|d| !d.is_empty())
    .unwrap_or_else(|| "/".to_string())
}

#[tauri::command]
pub async fn mail_create_folder(
    account_id: i64,
    name: String,
    parent_id: Option<i64>,
    db: State<'_, DbState>,
) -> Result<Vec<Folder>, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("フォルダ名を入力してください".to_string());
    }

    let (config, path) = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        let config = get_imap_config(&conn, account_id)?;
        let delimiter = account_delimiter(&conn, account_id);
        if name.contains(&delimiter) {
            return Err(format!("フォルダ名に区切り文字「{}」は使えません", delimiter));
        }
        // ユーザー入力の表示名を modified UTF-7 の wire 形式にエンコードする。
        // 親パスは DB 上の wire 生名なので、葉だけをエンコードして連結する。
        let wire_name = crate::utf7::encode(&name);
        let path = match parent_id {
            Some(pid) => {
                let parent_path: String = conn
                    .query_row(
                        "SELECT path FROM folders WHERE id = ?1 AND account_id = ?2",
                        [pid, account_id],
                        |row| row.get(0),
                    )
                    .map_err(|_| "親フォルダが見つかりません".to_string())?;
                format!("{}{}{}", parent_path, delimiter, wire_name)
            }
            None => wire_name.clone(),
        };
        (config, path)
    };

    imap_service::create_folder(&config, &path)
        .await
        .map_err(|e| e.to_string())?;

    sync_folders_for_account(account_id, db.inner()).await
}

#[tauri::command]
pub async fn mail_rename_folder(
    folder_id: i64,
    new_name: String,
    db: State<'_, DbState>,
) -> Result<Vec<Folder>, String> {
    let new_name = new_name.trim().to_string();
    if new_name.is_empty() {
        return Err("フォルダ名を入力してください".to_string());
    }

    let (config, account_id, from_path, to_path) = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        if is_protected_folder(&conn, folder_id) {
            return Err("システムフォルダの名前は変更できません".to_string());
        }
        let (account_id, from_path): (i64, String) = conn
            .query_row(
                "SELECT account_id, path FROM folders WHERE id = ?1",
                [folder_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|e| e.to_string())?;
        let config = get_imap_config(&conn, account_id)?;
        let delimiter = account_delimiter(&conn, account_id);
        if new_name.contains(&delimiter) {
            return Err(format!("フォルダ名に区切り文字「{}」は使えません", delimiter));
        }
        // Preserve the parent path, replace only the leaf name.
        // 葉名は modified UTF-7 にエンコードする(親パスは DB 上の wire 生名)。
        let wire_new_name = crate::utf7::encode(&new_name);
        let to_path = match from_path.rsplit_once(delimiter.as_str()) {
            Some((parent, _)) => format!("{}{}{}", parent, delimiter, wire_new_name),
            None => wire_new_name.clone(),
        };
        (config, account_id, from_path, to_path)
    };

    imap_service::rename_folder(&config, &from_path, &to_path)
        .await
        .map_err(|e| e.to_string())?;

    {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        // Drop local rows for the old path subtree; re-sync repopulates them
        conn.execute(
            "DELETE FROM attachments WHERE message_id IN (SELECT id FROM messages WHERE account_id = ?1 AND folder_id IN (SELECT id FROM folders WHERE account_id = ?1 AND (path = ?2 OR path LIKE ?2 || '%')))",
            rusqlite::params![account_id, from_path],
        ).ok();
        conn.execute(
            "DELETE FROM message_bodies WHERE message_id IN (SELECT id FROM messages WHERE account_id = ?1 AND folder_id IN (SELECT id FROM folders WHERE account_id = ?1 AND (path = ?2 OR path LIKE ?2 || '%')))",
            rusqlite::params![account_id, from_path],
        ).ok();
        conn.execute(
            "DELETE FROM messages WHERE account_id = ?1 AND folder_id IN (SELECT id FROM folders WHERE account_id = ?1 AND (path = ?2 OR path LIKE ?2 || '%'))",
            rusqlite::params![account_id, from_path],
        ).ok();
        conn.execute(
            "DELETE FROM folders WHERE account_id = ?1 AND (path = ?2 OR path LIKE ?2 || '%')",
            rusqlite::params![account_id, from_path],
        )
        .ok();
    }

    sync_folders_for_account(account_id, db.inner()).await
}

#[tauri::command]
pub async fn mail_delete_folder(
    folder_id: i64,
    db: State<'_, DbState>,
) -> Result<Vec<Folder>, String> {
    let (config, account_id, path) = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        if is_protected_folder(&conn, folder_id) {
            return Err("システムフォルダは削除できません".to_string());
        }
        let (account_id, path): (i64, String) = conn
            .query_row(
                "SELECT account_id, path FROM folders WHERE id = ?1",
                [folder_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|e| e.to_string())?;
        let config = get_imap_config(&conn, account_id)?;
        (config, account_id, path)
    };

    imap_service::delete_folder(&config, &path)
        .await
        .map_err(|e| e.to_string())?;

    {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM attachments WHERE message_id IN (SELECT id FROM messages WHERE account_id = ?1 AND folder_id IN (SELECT id FROM folders WHERE account_id = ?1 AND (path = ?2 OR path LIKE ?2 || '%')))",
            rusqlite::params![account_id, path],
        ).ok();
        conn.execute(
            "DELETE FROM message_bodies WHERE message_id IN (SELECT id FROM messages WHERE account_id = ?1 AND folder_id IN (SELECT id FROM folders WHERE account_id = ?1 AND (path = ?2 OR path LIKE ?2 || '%')))",
            rusqlite::params![account_id, path],
        ).ok();
        conn.execute(
            "DELETE FROM messages WHERE account_id = ?1 AND folder_id IN (SELECT id FROM folders WHERE account_id = ?1 AND (path = ?2 OR path LIKE ?2 || '%'))",
            rusqlite::params![account_id, path],
        ).ok();
        conn.execute(
            "DELETE FROM folders WHERE account_id = ?1 AND (path = ?2 OR path LIKE ?2 || '%')",
            rusqlite::params![account_id, path],
        )
        .ok();
    }

    sync_folders_for_account(account_id, db.inner()).await
}

/// Total attachment size limit. Most providers cap messages at ~25MB, and
/// base64 adds ~37% on top of the raw bytes.
const MAX_ATTACHMENT_TOTAL_BYTES: usize = 25 * 1024 * 1024;

fn guess_mime(filename: &str) -> &'static str {
    let ext = filename
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "heic" => "image/heic",
        "pdf" => "application/pdf",
        "txt" | "log" | "md" => "text/plain",
        "csv" => "text/csv",
        "html" | "htm" => "text/html",
        "xml" => "text/xml",
        "json" => "application/json",
        "ics" => "text/calendar",
        "eml" => "message/rfc822",
        "zip" => "application/zip",
        "7z" => "application/x-7z-compressed",
        "rar" => "application/vnd.rar",
        "gz" => "application/gzip",
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls" => "application/vnd.ms-excel",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "ppt" => "application/vnd.ms-powerpoint",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "m4a" => "audio/mp4",
        "mp4" => "video/mp4",
        "mov" => "video/quicktime",
        "avi" => "video/x-msvideo",
        _ => "application/octet-stream",
    }
}

/// Resolve composer attachment references (local files / cached attachments
/// of a received message) into raw data ready for the SMTP builder.
pub fn resolve_compose_attachments(
    db: &DbState,
    inputs: Vec<ComposeAttachmentInput>,
) -> Result<Vec<smtp_service::AttachmentData>, String> {
    let mut result = Vec::new();
    let mut total = 0usize;

    for input in inputs {
        let att = if let Some(path) = input.path.as_deref().filter(|p| !p.trim().is_empty()) {
            let path = std::path::Path::new(path);
            let filename = path
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| "attachment".to_string());
            let data = std::fs::read(path).map_err(|e| {
                format!("添付ファイル「{}」を読み込めませんでした: {}", filename, e)
            })?;
            smtp_service::AttachmentData {
                mime_type: guess_mime(&filename).to_string(),
                filename,
                data,
            }
        } else if let Some(attachment_id) = input.attachment_id {
            let conn = db.conn.lock().map_err(|e| e.to_string())?;
            conn.query_row(
                "SELECT filename, COALESCE(mime_type, 'application/octet-stream'), data FROM attachments WHERE id = ?1",
                [attachment_id],
                |row| {
                    Ok(smtp_service::AttachmentData {
                        filename: row.get(0)?,
                        mime_type: row.get(1)?,
                        data: row.get::<_, Option<Vec<u8>>>(2)?.unwrap_or_default(),
                    })
                },
            )
            .map_err(|_| "転送元の添付ファイルが見つかりませんでした。元のメールを開き直してから転送してください".to_string())?
        } else {
            continue;
        };

        if att.data.is_empty() {
            return Err(format!(
                "添付ファイル「{}」の中身が空です",
                att.filename
            ));
        }
        total += att.data.len();
        if total > MAX_ATTACHMENT_TOTAL_BYTES {
            return Err("添付ファイルの合計サイズが25MBを超えています。ファイルを減らすか、共有リンクをご利用ください".to_string());
        }
        result.push(att);
    }

    Ok(result)
}

#[tauri::command]
pub async fn compose_send(data: ComposeInput, db: State<'_, DbState>) -> Result<(), String> {
    let attachments = resolve_compose_attachments(db.inner(), data.attachments.unwrap_or_default())?;
    let compose = ComposeData {
        from: data.from,
        to: data.to,
        cc: data.cc,
        subject: data.subject,
        html: data.html,
        text: data.text,
        in_reply_to: data.in_reply_to,
        references: data.references,
        attachments,
    };
    send_and_record(db.inner(), compose).await
}
