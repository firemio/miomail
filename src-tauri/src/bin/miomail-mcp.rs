//! MioMail MCP server — exposes the local MioMail mail store (and its
//! IMAP/SMTP accounts) to AI agents over the Model Context Protocol (stdio).
//!
//! Run MioMail at least once to configure accounts; this binary reads the
//! same SQLite database and OS keyring entries. Register it with e.g.:
//!   claude mcp add miomail -- <path-to>/miomail-mcp.exe
//!
//! Messages are newline-delimited JSON-RPC 2.0 on stdin/stdout.

use miomail_lib::commands::mail as mail_core;
use miomail_lib::db::{self, DbState};
use serde_json::{json, Value};
use std::io::{BufRead, Write};

const PROTOCOL_VERSION: &str = "2024-11-05";

fn main() {
    let runtime = tokio::runtime::Runtime::new().expect("failed to start tokio runtime");

    let db_path = std::env::var("MIOMAIL_DB")
        .map(std::path::PathBuf::from)
        .ok()
        .or_else(db::default_db_path)
        .expect("could not resolve MioMail database path (set MIOMAIL_DB)");

    if !db_path.exists() {
        eprintln!(
            "miomail-mcp: database not found at {} — run the MioMail app once to set up an account",
            db_path.display()
        );
    }

    let conn = db::open_connection(&db_path).expect("failed to open MioMail database");
    let db = DbState::new(conn);

    eprintln!("miomail-mcp: serving {}", db_path.display());

    let stdin = std::io::stdin();
    let stdout = std::io::stdout();

    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let Ok(request) = serde_json::from_str::<Value>(line) else {
            continue;
        };

        let id = request.get("id").cloned();
        let method = request
            .get("method")
            .and_then(|m| m.as_str())
            .unwrap_or_default()
            .to_string();
        let params = request.get("params").cloned().unwrap_or(Value::Null);

        // Notifications (no id) get no response
        let Some(id) = id else {
            continue;
        };

        let response = match method.as_str() {
            "initialize" => json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {
                    "protocolVersion": params
                        .get("protocolVersion")
                        .and_then(|v| v.as_str())
                        .unwrap_or(PROTOCOL_VERSION),
                    "capabilities": { "tools": {} },
                    "serverInfo": { "name": "miomail-mcp", "version": env!("CARGO_PKG_VERSION") }
                }
            }),
            "ping" => json!({ "jsonrpc": "2.0", "id": id, "result": {} }),
            "tools/list" => json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": { "tools": tool_definitions() }
            }),
            "tools/call" => {
                let name = params
                    .get("name")
                    .and_then(|n| n.as_str())
                    .unwrap_or_default()
                    .to_string();
                let args = params
                    .get("arguments")
                    .cloned()
                    .unwrap_or_else(|| json!({}));
                let result = runtime.block_on(call_tool(&db, &name, &args));
                match result {
                    Ok(value) => json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "result": {
                            "content": [{ "type": "text", "text": value.to_string() }]
                        }
                    }),
                    Err(message) => json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "result": {
                            "content": [{ "type": "text", "text": message }],
                            "isError": true
                        }
                    }),
                }
            }
            _ => json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": { "code": -32601, "message": format!("Method not found: {}", method) }
            }),
        };

        let mut out = stdout.lock();
        if writeln!(out, "{}", response).is_err() {
            break;
        }
        out.flush().ok();
    }
}

fn tool_definitions() -> Value {
    json!([
        {
            "name": "list_accounts",
            "description": "List the mail accounts configured in MioMail (id, name, email, servers). Passwords are never returned.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        },
        {
            "name": "list_folders",
            "description": "List the folders of an account with unread/total counts, from the local cache. Use the sync tool first for fresh server state.",
            "inputSchema": {
                "type": "object",
                "properties": { "account_id": { "type": "integer" } },
                "required": ["account_id"],
                "additionalProperties": false
            }
        },
        {
            "name": "list_messages",
            "description": "List messages in a folder (newest first) from the local cache. Returns headers and preview snippets, not full bodies.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "folder_id": { "type": "integer" },
                    "limit": { "type": "integer", "description": "max results, default 50" },
                    "offset": { "type": "integer", "description": "pagination offset, default 0" },
                    "unread_only": { "type": "boolean", "description": "only unread messages" }
                },
                "required": ["folder_id"],
                "additionalProperties": false
            }
        },
        {
            "name": "get_message",
            "description": "Fetch a full message (headers + text body). Downloads from the IMAP server if not cached. Does NOT mark the message as read.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "message_id": { "type": "integer", "description": "the local message id from list_messages/search_messages" },
                    "include_html": { "type": "boolean", "description": "also return the HTML body" }
                },
                "required": ["message_id"],
                "additionalProperties": false
            }
        },
        {
            "name": "search_messages",
            "description": "Search cached messages by keyword (subject, sender, snippet, downloaded body text).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": { "type": "string" },
                    "account_id": { "type": "integer", "description": "restrict to one account; searches all accounts when omitted" }
                },
                "required": ["query"],
                "additionalProperties": false
            }
        },
        {
            "name": "send_mail",
            "description": "Send an email IMMEDIATELY via the account's SMTP server and save a copy to its Sent folder. There is no draft step or undo — confirm the recipients and content with the user before calling this.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "from": { "type": "string", "description": "sender account email; may be omitted when only one account exists" },
                    "to": { "type": "string", "description": "recipient(s), comma separated" },
                    "cc": { "type": "string", "description": "CC recipient(s), comma separated" },
                    "subject": { "type": "string" },
                    "body": { "type": "string", "description": "plain-text body" },
                    "in_reply_to": { "type": "string", "description": "Message-ID being replied to (for threading)" },
                    "attachments": { "type": "array", "items": { "type": "string" }, "description": "absolute paths of local files to attach (25MB total limit)" }
                },
                "required": ["to", "subject", "body"],
                "additionalProperties": false
            }
        },
        {
            "name": "mark_read",
            "description": "Mark a message as read or unread (updates the IMAP server and the local cache).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "message_id": { "type": "integer" },
                    "read": { "type": "boolean", "description": "default true" }
                },
                "required": ["message_id"],
                "additionalProperties": false
            }
        },
        {
            "name": "delete_message",
            "description": "Delete a message. Moves it to the account's Trash folder; deleting from Trash is permanent. Confirm with the user before calling this.",
            "inputSchema": {
                "type": "object",
                "properties": { "message_id": { "type": "integer" } },
                "required": ["message_id"],
                "additionalProperties": false
            }
        },
        {
            "name": "sync",
            "description": "Refresh the local cache from the IMAP server (folder list + inbox messages). Run this before reading when fresh data matters.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "account_id": { "type": "integer", "description": "sync one account; syncs all accounts when omitted" }
                },
                "additionalProperties": false
            }
        }
    ])
}

fn arg_i64(args: &Value, key: &str) -> Option<i64> {
    args.get(key).and_then(|v| v.as_i64())
}

fn require_i64(args: &Value, key: &str) -> Result<i64, String> {
    arg_i64(args, key).ok_or_else(|| format!("missing required argument: {}", key))
}

fn arg_str(args: &Value, key: &str) -> Option<String> {
    args.get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

fn escape_html(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

async fn call_tool(db: &DbState, name: &str, args: &Value) -> Result<Value, String> {
    match name {
        "list_accounts" => {
            let conn = db.conn.lock().map_err(|e| e.to_string())?;
            let mut stmt = conn
                .prepare("SELECT id, name, email, imap_host, imap_port, smtp_host, smtp_port FROM accounts ORDER BY id")
                .map_err(|e| e.to_string())?;
            let accounts: Vec<Value> = stmt
                .query_map([], |row| {
                    Ok(json!({
                        "id": row.get::<_, i64>(0)?,
                        "name": row.get::<_, String>(1)?,
                        "email": row.get::<_, String>(2)?,
                        "imap_host": row.get::<_, Option<String>>(3)?,
                        "imap_port": row.get::<_, Option<i64>>(4)?,
                        "smtp_host": row.get::<_, Option<String>>(5)?,
                        "smtp_port": row.get::<_, Option<i64>>(6)?,
                    }))
                })
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect();
            Ok(json!({ "accounts": accounts }))
        }

        "list_folders" => {
            let account_id = require_i64(args, "account_id")?;
            let conn = db.conn.lock().map_err(|e| e.to_string())?;
            let mut stmt = conn
                .prepare("SELECT id, path, name, unread_count, total_count FROM folders WHERE account_id = ?1 ORDER BY path")
                .map_err(|e| e.to_string())?;
            let folders: Vec<Value> = stmt
                .query_map([account_id], |row| {
                    Ok(json!({
                        "id": row.get::<_, i64>(0)?,
                        "path": row.get::<_, String>(1)?,
                        "name": row.get::<_, String>(2)?,
                        "unread_count": row.get::<_, Option<i64>>(3)?.unwrap_or(0),
                        "total_count": row.get::<_, Option<i64>>(4)?.unwrap_or(0),
                    }))
                })
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect();
            Ok(json!({ "folders": folders }))
        }

        "list_messages" => {
            let folder_id = require_i64(args, "folder_id")?;
            let limit = arg_i64(args, "limit").unwrap_or(50).clamp(1, 200);
            let offset = arg_i64(args, "offset").unwrap_or(0).max(0);
            let unread_only = args
                .get("unread_only")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);

            let conn = db.conn.lock().map_err(|e| e.to_string())?;
            let unread_filter = if unread_only {
                " AND flags NOT LIKE '%Seen%'"
            } else {
                ""
            };
            let sql = format!(
                "SELECT id, account_id, folder_id, uid, message_id, subject, from_address, to_addresses, cc_addresses, date, date_ts, flags, snippet, has_attachments FROM messages WHERE folder_id = ?1{} ORDER BY date_ts DESC, uid DESC LIMIT ?2 OFFSET ?3",
                unread_filter
            );
            let messages = mail_core::query_messages(&conn, &sql, &[&folder_id, &limit, &offset])?;
            Ok(json!({ "messages": summarize(&messages) }))
        }

        "get_message" => {
            let message_id = require_i64(args, "message_id")?;
            let include_html = args
                .get("include_html")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);

            let full = mail_core::get_message_core(db, message_id, false).await?;
            let mut result = json!({
                "id": full.msg.id,
                "account_id": full.msg.account_id,
                "folder_id": full.msg.folder_id,
                "message_id": full.msg.message_id,
                "subject": full.msg.subject,
                "from": full.msg.from_address,
                "to": full.msg.to_addresses,
                "cc": full.msg.cc_addresses,
                "date": full.msg.date,
                "flags": full.msg.flags,
                "has_attachments": full.msg.has_attachments != 0,
                "attachments": full.attachments.iter().map(|a| json!({
                    "id": a.id,
                    "filename": a.filename,
                    "mime_type": a.mime_type,
                    "size": a.size,
                    "is_inline": a.is_inline != 0,
                })).collect::<Vec<_>>(),
                "text_body": full.text_body,
            });
            if include_html {
                result["html_body"] = json!(full.html_body);
            }
            Ok(result)
        }

        "search_messages" => {
            let query = arg_str(args, "query").ok_or("missing required argument: query")?;
            let account_ids: Vec<i64> = match arg_i64(args, "account_id") {
                Some(id) => vec![id],
                None => {
                    let conn = db.conn.lock().map_err(|e| e.to_string())?;
                    let mut stmt = conn
                        .prepare("SELECT id FROM accounts ORDER BY id")
                        .map_err(|e| e.to_string())?;
                    let ids = stmt
                        .query_map([], |row| row.get::<_, i64>(0))
                        .map_err(|e| e.to_string())?
                        .filter_map(|r| r.ok())
                        .collect();
                    ids
                }
            };

            let mut all = Vec::new();
            let conn = db.conn.lock().map_err(|e| e.to_string())?;
            for account_id in account_ids {
                let messages = mail_core::search_messages(&conn, account_id, &query, 50)?;
                all.extend(messages);
            }
            all.sort_by_key(|m| -m.date_ts);
            all.truncate(80);
            Ok(json!({ "messages": summarize(&all) }))
        }

        "send_mail" => {
            let to = arg_str(args, "to").ok_or("missing required argument: to")?;
            let subject = arg_str(args, "subject").ok_or("missing required argument: subject")?;
            let body = arg_str(args, "body").ok_or("missing required argument: body")?;
            let cc = arg_str(args, "cc").filter(|s| !s.trim().is_empty());
            let in_reply_to = arg_str(args, "in_reply_to").filter(|s| !s.trim().is_empty());
            let attachment_inputs: Vec<mail_core::ComposeAttachmentInput> = args
                .get("attachments")
                .and_then(|v| v.as_array())
                .map(|paths| {
                    paths
                        .iter()
                        .filter_map(|p| p.as_str())
                        .map(|p| mail_core::ComposeAttachmentInput {
                            path: Some(p.to_string()),
                            attachment_id: None,
                        })
                        .collect()
                })
                .unwrap_or_default();
            let attachments = mail_core::resolve_compose_attachments(db, attachment_inputs)?;

            let from = match arg_str(args, "from").filter(|s| !s.trim().is_empty()) {
                Some(from) => from,
                None => {
                    let conn = db.conn.lock().map_err(|e| e.to_string())?;
                    let mut stmt = conn
                        .prepare("SELECT email FROM accounts ORDER BY id")
                        .map_err(|e| e.to_string())?;
                    let emails: Vec<String> = stmt
                        .query_map([], |row| row.get::<_, String>(0))
                        .map_err(|e| e.to_string())?
                        .filter_map(|r| r.ok())
                        .collect();
                    match emails.len() {
                        0 => return Err("no accounts configured in MioMail".to_string()),
                        1 => emails.into_iter().next().unwrap(),
                        _ => {
                            return Err(format!(
                                "multiple accounts configured — pass 'from' as one of: {}",
                                emails.join(", ")
                            ))
                        }
                    }
                }
            };

            let html = format!(
                "<div style=\"font-family:'Yu Gothic UI',sans-serif;font-size:14px;\">{}</div>",
                escape_html(&body).replace('\n', "<br>")
            );

            let compose = miomail_lib::smtp_service::ComposeData {
                from: from.clone(),
                to: to.clone(),
                cc,
                subject: subject.clone(),
                html,
                text: Some(body),
                in_reply_to: in_reply_to.clone(),
                references: in_reply_to,
                attachments,
            };

            mail_core::send_and_record(db, compose).await?;

            // アプリが起動中ならマスコットの配達アニメーションを出せるよう、
            // イベントキューに記録する(失敗しても送信自体は成功扱い)
            if let Ok(conn) = db.conn.lock() {
                let payload = json!({ "to": to, "subject": subject }).to_string();
                let _ = conn.execute(
                    "INSERT INTO app_events (event_type, payload, created_ts, consumed)
                     VALUES ('mcp_mail_sent', ?1, strftime('%s','now'), 0)",
                    rusqlite::params![payload],
                );
            }

            Ok(json!({ "sent": true, "from": from, "to": to, "subject": subject }))
        }

        "mark_read" => {
            let message_id = require_i64(args, "message_id")?;
            let read = args.get("read").and_then(|v| v.as_bool()).unwrap_or(true);
            mail_core::mark_read_core(db, message_id, read).await?;
            Ok(json!({ "ok": true, "message_id": message_id, "read": read }))
        }

        "delete_message" => {
            let message_id = require_i64(args, "message_id")?;
            mail_core::delete_core(db, message_id).await?;
            Ok(json!({ "ok": true, "message_id": message_id }))
        }

        "sync" => {
            match arg_i64(args, "account_id") {
                Some(account_id) => {
                    let folders = mail_core::sync_folders_for_account(account_id, db).await?;
                    for folder in folders.iter().filter(|f| {
                        f.path.eq_ignore_ascii_case("INBOX") || f.name.eq_ignore_ascii_case("INBOX")
                    }) {
                        mail_core::sync_messages_for_folder(None, account_id, folder.id, db)
                            .await?;
                    }
                    // 単一アカウント指定でもバックフィル+本文プリフェッチを1サイクル進める
                    // (sync_all_accounts 経由でないと動かないため)
                    if let Err(error) = mail_core::run_backfill_step(account_id, db).await {
                        log::error!("backfill failed for account {}: {}", account_id, error);
                    }
                    if let Err(error) = mail_core::run_prefetch_for_account(account_id, db).await {
                        log::error!("body prefetch failed for account {}: {}", account_id, error);
                    }
                }
                None => {
                    mail_core::sync_all_accounts(None, db).await?;
                }
            }
            Ok(json!({ "ok": true }))
        }

        other => Err(format!("unknown tool: {}", other)),
    }
}

fn summarize(messages: &[mail_core::Message]) -> Vec<Value> {
    messages
        .iter()
        .map(|m| {
            let unread = !m.flags.contains("\\Seen");
            json!({
                "id": m.id,
                "account_id": m.account_id,
                "folder_id": m.folder_id,
                "message_id": m.message_id,
                "subject": m.subject,
                "from": m.from_address,
                "to": m.to_addresses,
                "date": m.date,
                "unread": unread,
                "has_attachments": m.has_attachments != 0,
                "snippet": m.snippet,
            })
        })
        .collect()
}
