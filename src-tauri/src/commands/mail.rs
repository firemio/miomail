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
    /// セマンティック検索時のコサイン類似度(それ以外の経路では None)。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub score: Option<f32>,
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
        score: None,
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

    // 進捗記録: 新規ヘッダの取り込み(0件でも完了状態として記録する)
    if !messages.is_empty() {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        crate::vectorize::job_progress_upsert(
            &conn,
            crate::vectorize::JOB_SYNC,
            account_id,
            0,
            messages.len() as i64,
            &format!("{}: 新規メッセージ {} 件を取り込み中", folder_path, messages.len()),
        );
    }

    {
        let mut conn = db.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        for m in &messages {
            let flags_json = serde_json::to_string(&m.flags).unwrap_or_default();
            tx.execute(
                "INSERT OR IGNORE INTO messages (account_id, folder_id, uid, message_id, subject, from_address, to_addresses, cc_addresses, date, date_ts, flags, snippet, has_attachments) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
                rusqlite::params![account_id, folder_id, m.uid as i64, m.message_id, m.subject, m.from, m.to, m.cc, m.date, m.date_ts, flags_json, m.snippet, if m.has_attachments { 1i64 } else { 0i64 }],
            ).ok();
        }
        tx.commit().map_err(|e| e.to_string())?;

        crate::vectorize::job_progress_upsert(
            &conn,
            crate::vectorize::JOB_SYNC,
            account_id,
            messages.len() as i64,
            messages.len() as i64,
            &format!("{}: 新規 {} 件", folder_path, messages.len()),
        );

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
                    score: None,
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

        // 新着の増分同期を優先したあと、全メールのローカル化を1サイクル分だけ
        // 進める。失敗しても通常同期には影響させない。
        if let Err(error) = run_backfill_step(account_id, db).await {
            log::error!("backfill failed for account {}: {}", account_id, error);
        }
        if let Err(error) = run_prefetch_for_account(account_id, db).await {
            log::error!("body prefetch failed for account {}: {}", account_id, error);
        }

        // セマンティック検索が有効な場合のみ、本文キャッシュ済みメールの
        // ベクトル化を1サイクル分進める(内部で有効性を再チェックする)。
        if let Err(error) = crate::vectorize::run_vectorize_step(account_id, db).await {
            log::error!("vectorize failed for account {}: {}", account_id, error);
        }
    }

    if let Some(app) = app {
        tray::update_tray_tooltip(app, total_unread_count(db)?);
    }
    Ok(())
}

/// バックフィル(全メールのヘッダのローカル化)を1チャンク分だけ進める。
///
/// アカウント内で最初の未完了フォルダを選び、新着同期のあとに過去方向へ
/// `backfill::BACKFILL_CHUNK_SIZE` 件の UID 範囲を UID FETCH する。
/// 既存行との重複は UNIQUE(account_id, folder_id, uid) + INSERT OR IGNORE で
/// 自然に排除される。取得チャンクはトランザクションで一括コミットする。
pub async fn run_backfill_step(account_id: i64, db: &DbState) -> Result<(), String> {
    let (config, folder_id, folder_path, stored_oldest) = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        let config = get_imap_config(&conn, account_id)?;
        // 最初の未完了フォルダ(完了したら次のフォルダへ順に進む)
        let row: Option<(i64, String, i64)> = conn
            .query_row(
                "SELECT id, path, COALESCE(oldest_uid_synced, 0) FROM folders
                 WHERE account_id = ?1 AND COALESCE(backfill_done, 0) = 0
                 ORDER BY id LIMIT 1",
                [account_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .ok();
        let Some((folder_id, folder_path, stored_oldest)) = row else {
            crate::vectorize::job_progress_finish(
                &conn,
                crate::vectorize::JOB_BACKFILL,
                account_id,
                "バックフィルは全フォルダで完了しています",
            );
            return Ok(()); // 全フォルダ完了済み
        };
        (config, folder_id, folder_path, stored_oldest)
    };

    let mut session = imap_service::FolderSession::connect(&config)
        .await
        .map_err(|e| e.to_string())?;
    let result = run_backfill_step_inner(account_id, folder_id, &folder_path, stored_oldest, db, &mut session).await;
    session.logout().await.ok();
    result
}

async fn run_backfill_step_inner(
    account_id: i64,
    folder_id: i64,
    folder_path: &str,
    stored_oldest: i64,
    db: &DbState,
    session: &mut imap_service::FolderSession,
) -> Result<(), String> {
    let mut state = crate::backfill::BackfillState {
        oldest_uid_synced: stored_oldest.max(0) as u32,
        done: false,
    };

    // 未シード(oldest_uid_synced = 0)なら、ローカルの最古 UID または
    // サーバーの UIDNEXT を起点に初期状態を決めて保存する。
    if state.oldest_uid_synced == 0 {
        let local_min_uid: Option<u32> = {
            let conn = db.conn.lock().map_err(|e| e.to_string())?;
            conn.query_row(
                "SELECT MIN(uid) FROM messages WHERE account_id = ?1 AND folder_id = ?2 AND uid > 0",
                [account_id, folder_id],
                |row| row.get::<_, Option<i64>>(0),
            )
            .ok()
            .flatten()
            .and_then(|v| u32::try_from(v).ok())
        };
        let (exists, uid_next) = session
            .mailbox_status(folder_path)
            .await
            .map_err(|e| e.to_string())?;
        state = crate::backfill::seed(local_min_uid, exists, uid_next);
        {
            let conn = db.conn.lock().map_err(|e| e.to_string())?;
            conn.execute(
                "UPDATE folders SET oldest_uid_synced = ?1, backfill_done = ?2 WHERE id = ?3",
                rusqlite::params![
                    state.oldest_uid_synced as i64,
                    if state.done { 1i64 } else { 0i64 },
                    folder_id
                ],
            )
            .ok();
        }
    }

    let Some((low, high)) = crate::backfill::next_chunk_range(state) else {
        return Ok(());
    };

    let headers = session
        .fetch_headers_uid_range(folder_path, low, high)
        .await
        .map_err(|e| e.to_string())?;

    // チャンクの INSERT と進捗更新を1トランザクションでコミットする
    {
        let mut conn = db.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        for m in &headers {
            let flags_json = serde_json::to_string(&m.flags).unwrap_or_default();
            tx.execute(
                "INSERT OR IGNORE INTO messages (account_id, folder_id, uid, message_id, subject, from_address, to_addresses, cc_addresses, date, date_ts, flags, snippet, has_attachments) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
                rusqlite::params![account_id, folder_id, m.uid as i64, m.message_id, m.subject, m.from, m.to, m.cc, m.date, m.date_ts, flags_json, m.snippet, if m.has_attachments { 1i64 } else { 0i64 }],
            ).ok();
        }
        let new_state = crate::backfill::advance(state, headers.first().map(|h| h.uid));
        tx.execute(
            "UPDATE folders SET oldest_uid_synced = ?1, backfill_done = ?2 WHERE id = ?3",
            rusqlite::params![
                new_state.oldest_uid_synced as i64,
                if new_state.done { 1i64 } else { 0i64 },
                folder_id
            ],
        )
        .ok();
        tx.commit().map_err(|e| e.to_string())?;

        // 進捗記録: このフォルダの残り UID 数を分母にする
        {
            let remaining = new_state.oldest_uid_synced.saturating_sub(1) as i64;
            if new_state.done {
                crate::vectorize::job_progress_upsert(
                    &conn,
                    crate::vectorize::JOB_BACKFILL,
                    account_id,
                    1,
                    1,
                    &format!("{}: バックフィル完了", folder_path),
                );
            } else {
                crate::vectorize::job_progress_upsert(
                    &conn,
                    crate::vectorize::JOB_BACKFILL,
                    account_id,
                    0,
                    remaining.max(1),
                    &format!("{}: 履歴取得中(残り約 {} 件)", folder_path, remaining),
                );
            }
        }

        log::info!(
            "backfill: folder '{}' fetched {} headers (uid {}..{}), done={}",
            folder_path,
            headers.len(),
            low,
            high,
            new_state.done
        );
    }

    {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        recompute_folder_counts(&conn, folder_id);
    }
    Ok(())
}

/// 本文プリフェッチ: message_bodies に無い本文を新しい順に
/// `backfill::PREFETCH_PER_CYCLE` 通だけ取得し、全文検索できる
/// ローカルコーパスを段階的に構築する。
///
/// - 対象はアカウントの直近 `backfill::PREFETCH_LOOKBACK_LIMIT` 通まで(安全弁)。
/// - 添付を避けるため `BODY.PEEK[TEXT]`(バイト上限付き)を使い、1ジョブ内では
///   同一 IMAP セッションを使い回す。開封時の従来経路(添付込み全文)は変えない。
pub async fn run_prefetch_for_account(account_id: i64, db: &DbState) -> Result<(), String> {
    let (config, candidates) = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        let config = get_imap_config(&conn, account_id)?;
        let mut stmt = conn
            .prepare(
                "SELECT m.id, m.uid, f.path FROM messages m
                 JOIN folders f ON f.id = m.folder_id
                 LEFT JOIN message_bodies mb ON mb.message_id = m.id
                 WHERE m.account_id = ?1 AND m.uid > 0 AND mb.message_id IS NULL
                   AND m.id IN (
                       SELECT id FROM messages WHERE account_id = ?1
                       ORDER BY date_ts DESC, uid DESC LIMIT ?2
                   )
                 ORDER BY m.date_ts DESC, m.uid DESC LIMIT ?3",
            )
            .map_err(|e| e.to_string())?;
        let candidates: Vec<(i64, i64, String)> = stmt
            .query_map(
                rusqlite::params![
                    account_id,
                    crate::backfill::PREFETCH_LOOKBACK_LIMIT,
                    crate::backfill::PREFETCH_PER_CYCLE
                ],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        (config, candidates)
    };

    if candidates.is_empty() {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        crate::vectorize::job_progress_finish(
            &conn,
            crate::vectorize::JOB_PREFETCH,
            account_id,
            "本文プリフェッチは完了しています",
        );
        return Ok(());
    }

    let mut session = imap_service::FolderSession::connect(&config)
        .await
        .map_err(|e| e.to_string())?;
    let mut fetched = 0usize;
    {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        crate::vectorize::job_progress_upsert(
            &conn,
            crate::vectorize::JOB_PREFETCH,
            account_id,
            0,
            candidates.len() as i64,
            &format!("本文プリフェッチ中 (0/{})", candidates.len()),
        );
    }
    for (message_id, uid, folder_path) in &candidates {
        let body = match session.fetch_body_text(folder_path, *uid as u32).await {
            Ok(body) if !body.text.is_empty() || !body.html.is_empty() => Some(body),
            Ok(_) => {
                log::debug!("prefetch: UID {} の本文が空のためスキップ", uid);
                None
            }
            Err(e) => {
                // 部分取得に失敗した場合は従来通りの全文取得にフォールバック
                log::warn!(
                    "prefetch: BODY.PEEK[TEXT] failed for UID {} ({}), falling back to full fetch",
                    uid,
                    e
                );
                match imap_service::fetch_body(&config, folder_path, *uid as u32, true).await {
                    Ok(body) => Some(body),
                    Err(e2) => {
                        log::warn!("prefetch: full fetch also failed for UID {}: {}", uid, e2);
                        None
                    }
                }
            }
        };

        if let Some(body) = body {
            let conn = db.conn.lock().map_err(|e| e.to_string())?;
            store_prefetched_body(&conn, *message_id, &body.html, &body.text);
            fetched += 1;
            crate::vectorize::job_progress_upsert(
                &conn,
                crate::vectorize::JOB_PREFETCH,
                account_id,
                fetched as i64,
                candidates.len() as i64,
                &format!("本文プリフェッチ中 ({}/{})", fetched, candidates.len()),
            );
        }
    }
    session.logout().await.ok();
    {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        crate::vectorize::job_progress_finish(
            &conn,
            crate::vectorize::JOB_PREFETCH,
            account_id,
            &format!("本文プリフェッチ: {}/{} 件", fetched, candidates.len()),
        );
    }
    log::info!(
        "prefetch: account {} cached {}/{} bodies",
        account_id,
        fetched,
        candidates.len()
    );
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

/// 本文(html/text)からプレビュー用 snippet を生成する。
/// 開封時の本文キャッシュ経路とプリフェッチ経路で共通利用する。
pub(crate) fn snippet_from_body(html: &str, text: &str) -> String {
    make_snippet(if text.is_empty() { html } else { text })
}

/// プリフェッチ等で取得した本文を message_bodies に保存し、snippet を更新する。
/// 添付を含まない部分取得なので attachments_synced = 0 とし、開封時の従来経路
/// (添付込み全文取得)が後で必ず再取得する。既に全文キャッシュ済み
/// (attachments_synced = 1)の行は上書きしない。
pub(crate) fn store_prefetched_body(
    conn: &rusqlite::Connection,
    message_id: i64,
    html: &str,
    text: &str,
) {
    conn.execute(
        "INSERT INTO message_bodies (message_id, html_body, text_body, attachments_synced)
         VALUES (?1, ?2, ?3, 0)
         ON CONFLICT(message_id) DO UPDATE SET
             html_body = excluded.html_body,
             text_body = excluded.text_body,
             attachments_synced = 0
         WHERE message_bodies.attachments_synced = 0",
        rusqlite::params![message_id, html, text],
    )
    .ok();
    let snippet = snippet_from_body(html, text);
    if !snippet.is_empty() {
        conn.execute(
            "UPDATE messages SET snippet = ?1 WHERE id = ?2",
            rusqlite::params![snippet, message_id],
        )
        .ok();
    }
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
        let snippet = snippet_from_body(&body.html, &body.text);
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
    search_messages(&conn, account_id, &query, 50)
}

/// セマンティック検索(FTS + ベクトルの RRF ハイブリッド)をメール UI から使うための
/// コマンド。モデル未ダウンロード時は明示エラーを返す(呼び出し側は従来検索に
/// フォールバックする想定)。
#[tauri::command]
pub async fn mail_semantic_search(
    account_id: i64,
    query: String,
    db: State<'_, DbState>,
) -> Result<Vec<Message>, String> {
    semantic_search_messages(db.inner(), account_id, &query, 50).await
}

/// 従来の LIKE '%q%' 全表走査。1〜2文字のクエリ(trigram は3文字未満を索引化
/// できない)と、FTS の MATCH 構文エラー時のフォールバックに使う。
fn search_messages_like(
    conn: &rusqlite::Connection,
    account_id: i64,
    query: &str,
    limit: usize,
) -> Result<Vec<Message>, String> {
    let q = format!("%{}%", query);
    query_messages(
        conn,
        &format!("SELECT {} FROM messages WHERE account_id = ?1 AND (subject LIKE ?2 OR from_address LIKE ?3 OR snippet LIKE ?4 OR id IN (SELECT message_id FROM message_bodies WHERE text_body LIKE ?5)) ORDER BY date_ts DESC LIMIT ?6", MESSAGE_COLUMNS),
        &[&account_id, &q as &dyn rusqlite::types::ToSql, &q, &q, &q, &(limit as i64)])
}

/// FTS5(trigram)検索。messages_fts(件名/差出人/宛先/snippet)と bodies_fts(本文)を
/// message id で OR 統合し、bm25 昇順(小さいほど関連度が高い)+ date_ts 降順で返す。
/// MATCH 構文エラー(特殊文字入力など)は Err として呼び出し側にフォールバックさせる。
fn search_messages_fts(
    conn: &rusqlite::Connection,
    account_id: i64,
    query: &str,
    limit: usize,
) -> Result<Vec<Message>, String> {
    let ranked_sql = "
        SELECT id, MIN(rank) AS rank, MAX(date_ts) AS date_ts FROM (
            SELECT m.id AS id, bm25(messages_fts) AS rank, m.date_ts AS date_ts
            FROM messages_fts JOIN messages m ON m.id = messages_fts.rowid
            WHERE messages_fts MATCH ?1 AND m.account_id = ?2
            UNION ALL
            SELECT m.id AS id, bm25(bodies_fts) AS rank, m.date_ts AS date_ts
            FROM bodies_fts JOIN messages m ON m.id = bodies_fts.rowid
            WHERE bodies_fts MATCH ?1 AND m.account_id = ?2
        )
        GROUP BY id
        ORDER BY rank ASC, date_ts DESC
        LIMIT ?3";
    let mut stmt = conn.prepare(ranked_sql).map_err(|e| e.to_string())?;
    // FTS5 の MATCH 構文エラーは prepare ではなく行のステップ実行時に出ることが
    // あるため、filter_map で握り潰さず明示的に Err を伝播させる(LIKE フォールバックに回す)。
    let rows = stmt
        .query_map(rusqlite::params![query, account_id, limit as i64], |row| {
            row.get::<_, i64>(0)
        })
        .map_err(|e| e.to_string())?;
    let mut ids: Vec<i64> = Vec::new();
    for r in rows {
        ids.push(r.map_err(|e| e.to_string())?);
    }
    drop(stmt);
    if ids.is_empty() {
        return Ok(Vec::new());
    }

    // ヒットした id を FTS のランク順のまま Message 行として読み直す
    let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let fetch_sql = format!(
        "SELECT {} FROM messages WHERE id IN ({})",
        MESSAGE_COLUMNS, placeholders
    );
    let params: Vec<&dyn rusqlite::types::ToSql> =
        ids.iter().map(|id| id as &dyn rusqlite::types::ToSql).collect();
    let mut msgs = query_messages(conn, &fetch_sql, &params)?;
    let order: HashMap<i64, usize> = ids
        .iter()
        .enumerate()
        .map(|(i, id)| (*id, i))
        .collect();
    msgs.sort_by_key(|m| order.get(&m.id).copied().unwrap_or(usize::MAX));
    Ok(msgs)
}

/// 検索の共通実装(app の mail_search と MCP の search_messages で共有)。
/// 3文字以上は FTS5(trigram)、1〜2文字や MATCH 構文エラー時は従来 LIKE に
/// フォールバックする。LIKE 側は旧実装と同一条件なので退行しない。
pub fn search_messages(
    conn: &rusqlite::Connection,
    account_id: i64,
    query: &str,
    limit: usize,
) -> Result<Vec<Message>, String> {
    let trimmed = query.trim();
    if trimmed.chars().count() >= 3 {
        match search_messages_fts(conn, account_id, trimmed, limit) {
            Ok(msgs) => return Ok(msgs),
            Err(e) => log::warn!("FTS search failed, falling back to LIKE: {}", e),
        }
    }
    search_messages_like(conn, account_id, query, limit)
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

// ---------------------------------------------------------------------------
// セマンティック検索(embed.rs / vectorize.rs)
// ---------------------------------------------------------------------------

/// IF 契約: バックグラウンドジョブの進捗一覧。
/// kind: 'sync' | 'backfill' | 'prefetch' | 'vectorize' | 'model_download'
#[tauri::command]
pub fn mail_job_progress(
    account_id: i64,
    db: State<'_, DbState>,
) -> Result<Vec<crate::vectorize::JobProgress>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    Ok(crate::vectorize::job_progress_list(&conn, account_id))
}

/// IF 契約: セマンティック検索の状態('off'|'downloading'|'ready'|'error')。
#[tauri::command]
pub fn mail_semantic_status(
    db: State<'_, DbState>,
) -> Result<crate::embed::SemanticStatus, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    Ok(crate::embed::semantic_status(&conn))
}

/// IF 契約: セマンティック検索を有効化(オプトイン)してモデル DL を開始する。
/// 既に DL 済みなら即 ready を返す。
#[tauri::command]
pub async fn mail_semantic_enable(
    app: AppHandle,
    db: State<'_, DbState>,
) -> Result<crate::embed::SemanticStatus, String> {
    crate::embed::semantic_enable(&app, db.inner()).await
}

/// セマンティック検索: クエリエンコード → 総当たりコサイン上位K →
/// FTS5 の search_messages の結果と RRF(k=60) で融合 → message を返す。
/// 既存の search_messages は不変。モデル未DL時は FTS にフォールバックせず
/// 明示エラーを返す(キーワード結果と誤解されるのを防ぐため)。
pub async fn semantic_search_messages(
    db: &DbState,
    account_id: i64,
    query: &str,
    limit: usize,
) -> Result<Vec<Message>, String> {
    {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        if !crate::embed::semantic_ready(&conn) {
            return Err(
                "セマンティック検索モデルがまだダウンロードされていません。MioMail アプリの設定画面でセマンティック検索を有効化してください"
                    .to_string(),
            );
        }
    }

    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }

    // ONNX 推論はブロッキングするので専用スレッドで実行する
    let q = trimmed.to_string();
    let query_vec = tokio::task::spawn_blocking(move || crate::embed::encode_query(&q))
        .await
        .map_err(|e| format!("encode worker failed: {}", e))??;

    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    use crate::vectorize::VectorStore;

    // ベクトル側: コサイン類似度の上位K(融合のため limit より多めに取る)
    let vector_k = (limit * 4).max(40);
    let vector_hits = crate::vectorize::SqliteVectorStore { conn: &conn }.search_cosine(
        &query_vec,
        Some(account_id),
        crate::embed::MODEL_VERSION,
        vector_k,
    )?;
    // ruri-v3 の実測分布では関連ヒット ≒ 0.78、無関係は ～0.78 に分かれる。
    // ノイズを結果に混ぜないため類似度の下限で切る(FTS 側のヒットは別経路で残る)。
    let filtered_hits: Vec<(i64, f32)> = vector_hits
        .into_iter()
        .filter(|(_, score)| *score >= crate::vectorize::SEMANTIC_VECTOR_MIN_SCORE)
        .collect();
    let score_map: HashMap<i64, f32> = filtered_hits.iter().copied().collect();
    let vector_ranked: Vec<i64> = filtered_hits.iter().map(|(id, _)| *id).collect();

    // FTS 側: 既存の共通実装(FTS+BM25、LIKE フォールバック込み)をそのまま使う
    let fts_msgs = search_messages(&conn, account_id, trimmed, limit)?;
    let fts_ranked: Vec<i64> = fts_msgs.iter().map(|m| m.id).collect();

    // RRF(k=60)で融合
    let fused = crate::vectorize::rrf_fuse(
        &vector_ranked,
        &fts_ranked,
        crate::vectorize::RRF_K,
        limit,
    );
    if fused.is_empty() {
        return Ok(Vec::new());
    }

    // 融合順のまま Message 行として読み直す
    let placeholders = fused.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let fetch_sql = format!(
        "SELECT {} FROM messages WHERE id IN ({})",
        MESSAGE_COLUMNS, placeholders
    );
    let params: Vec<&dyn rusqlite::types::ToSql> = fused
        .iter()
        .map(|id| id as &dyn rusqlite::types::ToSql)
        .collect();
    let mut msgs = query_messages(&conn, &fetch_sql, &params)?;
    let order: HashMap<i64, usize> = fused
        .iter()
        .enumerate()
        .map(|(i, id)| (*id, i))
        .collect();
    msgs.sort_by_key(|m| order.get(&m.id).copied().unwrap_or(usize::MAX));
    for m in &mut msgs {
        m.score = score_map.get(&m.id).copied();
    }
    Ok(msgs)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use std::path::Path;

    /// in-memory DB に検索テスト用の最小データを作る。
    /// msg1: 日本語件名のみ / msg2: 本文のみに語を含む / msg3: 記号入り件名
    fn setup_conn() -> rusqlite::Connection {
        let conn = db::open_connection(Path::new(":memory:")).unwrap();
        conn.execute_batch(
            "INSERT INTO accounts (id, name, email) VALUES (1, 'test', 't@example.com');
             INSERT INTO folders (id, account_id, path, name) VALUES (1, 1, 'INBOX', 'INBOX');
             INSERT INTO messages (id, account_id, folder_id, uid, subject, from_address, snippet, date_ts)
             VALUES (1, 1, 1, 100, '週次レポート提出のお知らせ', 'boss@example.com', '', 1000);
             INSERT INTO messages (id, account_id, folder_id, uid, subject, from_address, snippet, date_ts)
             VALUES (2, 1, 1, 101, 'Meeting notes', 'alice@example.com', '', 2000);
             INSERT INTO message_bodies (message_id, text_body)
             VALUES (2, '四半期決算の概要を共有します');
             INSERT INTO messages (id, account_id, folder_id, uid, subject, from_address, snippet, date_ts)
             VALUES (3, 1, 1, 102, 'セール 50%OFF のご案内', 'shop@example.com', '', 3000);",
        )
        .unwrap();
        conn
    }

    fn hit_ids(conn: &rusqlite::Connection, query: &str) -> Vec<i64> {
        search_messages(conn, 1, query, 50)
            .unwrap()
            .iter()
            .map(|m| m.id)
            .collect()
    }

    #[test]
    fn japanese_subject_hits_via_fts() {
        let conn = setup_conn();
        // 日本語件名「週次レポート提出のお知らせ」に「レポート」でヒット
        assert_eq!(hit_ids(&conn, "レポート"), vec![1]);
    }

    #[test]
    fn body_only_term_hits_via_bodies_fts() {
        let conn = setup_conn();
        // 件名にも snippet にも無く本文にだけある語 → bodies_fts 経由
        assert_eq!(hit_ids(&conn, "四半期決算"), vec![2]);
    }

    #[test]
    fn fts_results_merge_header_and_body_hits() {
        let conn = setup_conn();
        // ヘッダ側(msg1)と本文側(msg2)の両方が OR 統合で返る
        conn.execute(
            "UPDATE message_bodies SET text_body = 'レポートを確認してください' WHERE message_id = 2",
            [],
        )
        .unwrap();
        let ids = hit_ids(&conn, "レポート");
        assert!(ids.contains(&1) && ids.contains(&2), "ids = {:?}", ids);
        assert_eq!(ids.len(), 2, "重複排除されている: {:?}", ids);
    }

    #[test]
    fn trigger_sync_insert_then_delete() {
        let conn = setup_conn();
        // INSERT 直後に即ヒット
        conn.execute(
            "INSERT INTO messages (id, account_id, folder_id, uid, subject, date_ts)
             VALUES (9, 1, 1, 200, '臨時取締役会の招集通知', 4000)",
            [],
        )
        .unwrap();
        assert_eq!(hit_ids(&conn, "取締役会"), vec![9]);
        // DELETE 後はヒットしない
        conn.execute("DELETE FROM messages WHERE id = 9", []).unwrap();
        assert!(hit_ids(&conn, "取締役会").is_empty());
    }

    #[test]
    fn two_char_query_falls_back_to_like() {
        let conn = setup_conn();
        // trigram は3文字未満を索引化できない → LIKE フォールバックでヒット
        assert_eq!(hit_ids(&conn, "レポ"), vec![1]);
        // 本文側も LIKE でヒットする
        assert_eq!(hit_ids(&conn, "決算"), vec![2]);
    }

    #[test]
    fn match_syntax_error_falls_back_to_like() {
        let conn = setup_conn();
        // クラッシュせず Err にもならない(空結果 or LIKE 結果)
        assert!(search_messages(&conn, 1, "\"", 50).is_ok());
        assert!(search_messages(&conn, 1, "\"\"\"", 50).is_ok());
        assert!(search_messages(&conn, 1, "NEAR/(", 50).is_ok());
        assert!(search_messages(&conn, 1, "foo AND (", 50).is_ok());
        // FTS が構文エラーになる入力でも、旧 LIKE がヒットしていたものは拾う
        assert_eq!(hit_ids(&conn, "50%OFF"), vec![3]);
    }

    #[test]
    fn ascii_and_mixed_queries_hit() {
        let conn = setup_conn();
        assert_eq!(hit_ids(&conn, "meeting"), vec![2]); // 大小文字無視
        assert_eq!(hit_ids(&conn, "alice@example.com"), vec![2]); // from_address
        assert_eq!(hit_ids(&conn, "レポート提出"), vec![1]); // 混在・長めの部分列
    }
}
