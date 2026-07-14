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

#[derive(Debug, Serialize)]
pub struct MessageFull {
    #[serde(flatten)]
    pub msg: Message,
    pub html_body: String,
    pub text_body: String,
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
    let (msg, has_body, config, folder_path) = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        let msg_row = conn
            .query_row(
                &format!("SELECT {} FROM messages WHERE id = ?1", MESSAGE_COLUMNS),
                [message_id],
                message_from_row,
            )
            .map_err(|e| e.to_string())?;

        let has_body = conn
            .query_row(
                "SELECT COUNT(*) FROM message_bodies WHERE message_id = ?1",
                [message_id],
                |row| row.get::<_, i64>(0),
            )
            .unwrap_or(0)
            > 0;
        let config = get_imap_config(&conn, msg_row.account_id)?;
        let folder_path: String = conn
            .query_row(
                "SELECT path FROM folders WHERE id = ?1",
                [msg_row.folder_id],
                |row| row.get(0),
            )
            .unwrap_or_default();

        (msg_row, has_body, config, folder_path)
    };

    let (html_body, text_body) = if has_body {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT html_body, text_body FROM message_bodies WHERE message_id = ?1",
            [message_id],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                ))
            },
        )
        .unwrap_or_default()
    } else {
        if msg.uid <= 0 {
            return Err("このメールの本文はローカルに保存されていません".to_string());
        }
        let body = imap_service::fetch_body(&config, &folder_path, msg.uid as u32, !mark_read)
            .await
            .map_err(|e| e.to_string())?;
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("INSERT OR REPLACE INTO message_bodies (message_id, html_body, text_body) VALUES (?1, ?2, ?3)",
            rusqlite::params![message_id, body.html, body.text]).ok();
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
    };

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

    Ok(MessageFull {
        msg,
        html_body,
        text_body,
    })
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
        let (id, email, host, port, tls): (i64, String, String, i64, i64) = conn
            .query_row(
                "SELECT id, email, smtp_host, smtp_port, smtp_tls FROM accounts WHERE email = ?1",
                [&data.from],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                        row.get::<_, Option<i64>>(3)?.unwrap_or(587),
                        row.get::<_, Option<i64>>(4)?.unwrap_or(0),
                    ))
                },
            )
            .map_err(|e| format!("Account not found: {}", e))?;

        let pass = credentials::get_password(&format!("miomail-smtp-{}", id))
            .map_err(|e| e.to_string())?
            .ok_or("SMTP password not found")?;

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

#[tauri::command]
pub async fn compose_send(data: ComposeInput, db: State<'_, DbState>) -> Result<(), String> {
    let compose = ComposeData {
        from: data.from,
        to: data.to,
        cc: data.cc,
        subject: data.subject,
        html: data.html,
        text: data.text,
        in_reply_to: data.in_reply_to,
        references: data.references,
    };
    send_and_record(db.inner(), compose).await
}
