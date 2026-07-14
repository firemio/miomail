use anyhow::Result;
use rusqlite::Connection;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

pub struct DbState {
    pub conn: Mutex<Connection>,
}

impl DbState {
    pub fn new(conn: Connection) -> Self {
        DbState {
            conn: Mutex::new(conn),
        }
    }
}

pub fn get_db_path(app: &AppHandle) -> PathBuf {
    let data_dir = app
        .path()
        .app_data_dir()
        .expect("failed to get app data dir");
    fs::create_dir_all(&data_dir).ok();
    data_dir.join("miomail.db")
}

/// DB path resolvable without a Tauri AppHandle (used by the MCP server binary).
/// Matches Tauri's app_data_dir on Windows: %APPDATA%/com.firemio.miomail
pub fn default_db_path() -> Option<PathBuf> {
    std::env::var("APPDATA")
        .ok()
        .map(|p| PathBuf::from(p).join("com.firemio.miomail").join("miomail.db"))
}

pub fn init_database(app: &AppHandle) -> Result<()> {
    let db_path = get_db_path(app);

    // Migrate from old Electron path if exists
    if !db_path.exists() {
        if let Some(appdata) = dirs_next_appdata() {
            let old_path = appdata.join("miomail").join("miomail.db");
            if old_path.exists() {
                fs::copy(&old_path, &db_path).ok();
                log::info!("Migrated DB from Electron path");
            }
        }
    }

    let conn = open_connection(&db_path)?;

    app.manage(DbState::new(conn));

    Ok(())
}

/// Open a connection and apply schema + migrations. Shared by the app and the MCP server.
pub fn open_connection(db_path: &Path) -> Result<Connection> {
    let conn = Connection::open(db_path)?;
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;

    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL,
            imap_host TEXT,
            imap_port INTEGER DEFAULT 993,
            imap_tls INTEGER DEFAULT 1,
            smtp_host TEXT,
            smtp_port INTEGER DEFAULT 587,
            smtp_tls INTEGER DEFAULT 1,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS folders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account_id INTEGER REFERENCES accounts(id),
            path TEXT NOT NULL,
            name TEXT NOT NULL,
            delimiter TEXT,
            flags TEXT,
            unread_count INTEGER DEFAULT 0,
            total_count INTEGER DEFAULT 0,
            UNIQUE(account_id, path)
        );

        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account_id INTEGER REFERENCES accounts(id),
            folder_id INTEGER REFERENCES folders(id),
            uid INTEGER,
            message_id TEXT,
            subject TEXT,
            from_address TEXT,
            to_addresses TEXT,
            cc_addresses TEXT,
            date TEXT,
            flags TEXT,
            snippet TEXT,
            has_attachments INTEGER DEFAULT 0,
            UNIQUE(account_id, folder_id, uid)
        );

        CREATE TABLE IF NOT EXISTS message_bodies (
            message_id INTEGER PRIMARY KEY REFERENCES messages(id),
            html_body TEXT,
            text_body TEXT
        );

        CREATE TABLE IF NOT EXISTS attachments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id INTEGER REFERENCES messages(id),
            filename TEXT NOT NULL,
            mime_type TEXT,
            size INTEGER DEFAULT 0,
            content_id TEXT,
            is_inline INTEGER DEFAULT 0,
            data BLOB
        );",
    )?;

    migrate(&conn)?;

    Ok(conn)
}

fn column_exists(conn: &Connection, table: &str, column: &str) -> bool {
    let mut stmt = match conn.prepare(&format!("PRAGMA table_info({})", table)) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let names: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map(|rows| rows.filter_map(|r| r.ok()).collect())
        .unwrap_or_default();
    names.iter().any(|n| n == column)
}

fn migrate(conn: &Connection) -> Result<()> {
    // v2: sortable numeric timestamp for messages
    if !column_exists(conn, "messages", "date_ts") {
        conn.execute("ALTER TABLE messages ADD COLUMN date_ts INTEGER DEFAULT 0", [])?;
    }
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_messages_folder_datets ON messages(folder_id, date_ts);
         CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id);",
    )?;

    // v4: MCPサーバー等の別プロセスからアプリへイベントを渡すキュー
    // (例: MCP経由の送信をマスコットの配達アニメーションに反映する)
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS app_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_type TEXT NOT NULL,
            payload TEXT,
            created_ts INTEGER NOT NULL,
            consumed INTEGER NOT NULL DEFAULT 0
        );",
    )?;

    // v3: track whether attachments were extracted for a cached body, so
    // bodies cached before attachment support get re-fetched once
    if !column_exists(conn, "message_bodies", "attachments_synced") {
        conn.execute(
            "ALTER TABLE message_bodies ADD COLUMN attachments_synced INTEGER DEFAULT 0",
            [],
        )?;
    }

    // Backfill date_ts for legacy rows
    {
        let mut stmt = conn.prepare(
            "SELECT id, date FROM messages WHERE (date_ts IS NULL OR date_ts = 0) AND date IS NOT NULL AND date != ''",
        )?;
        let rows: Vec<(i64, String)> = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
            .filter_map(|r| r.ok())
            .collect();
        for (id, date) in rows {
            let ts = parse_date_to_timestamp(&date);
            if ts != 0 {
                conn.execute(
                    "UPDATE messages SET date_ts = ?1 WHERE id = ?2",
                    rusqlite::params![ts, id],
                )
                .ok();
            }
        }
    }

    // Normalize legacy flag strings (Rust Debug format "Seen" / Custom("X")) to
    // canonical IMAP flags ("\\Seen" / "X")
    {
        let mut stmt = conn.prepare(
            "SELECT id, flags FROM messages WHERE flags IS NOT NULL AND flags != '' AND flags != '[]'",
        )?;
        let rows: Vec<(i64, String)> = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
            .filter_map(|r| r.ok())
            .collect();
        for (id, flags_json) in rows {
            let Ok(flags) = serde_json::from_str::<Vec<String>>(&flags_json) else {
                continue;
            };
            let normalized: Vec<String> = flags.iter().map(|f| normalize_flag(f)).collect();
            if normalized != flags {
                conn.execute(
                    "UPDATE messages SET flags = ?1 WHERE id = ?2",
                    rusqlite::params![serde_json::to_string(&normalized).unwrap_or_default(), id],
                )
                .ok();
            }
        }
    }

    Ok(())
}

/// Convert legacy Debug-formatted flags to canonical IMAP flag strings.
pub fn normalize_flag(flag: &str) -> String {
    match flag {
        "Seen" => "\\Seen".to_string(),
        "Answered" => "\\Answered".to_string(),
        "Flagged" => "\\Flagged".to_string(),
        "Deleted" => "\\Deleted".to_string(),
        "Draft" => "\\Draft".to_string(),
        "Recent" => "\\Recent".to_string(),
        other => {
            // Custom("NonJunk") -> NonJunk
            if let Some(inner) = other
                .strip_prefix("Custom(\"")
                .and_then(|s| s.strip_suffix("\")"))
            {
                inner.replace("\\\\", "\\")
            } else {
                other.to_string()
            }
        }
    }
}

/// Parse an RFC 2822 date string into a unix timestamp (0 if unparseable).
pub fn parse_date_to_timestamp(date: &str) -> i64 {
    let synthetic = format!("Date: {}\r\n\r\n", date.trim());
    mail_parser::MessageParser::default()
        .parse(synthetic.as_bytes())
        .and_then(|m| m.date().map(|d| d.to_timestamp()))
        .unwrap_or(0)
}

fn dirs_next_appdata() -> Option<PathBuf> {
    std::env::var("APPDATA").ok().map(PathBuf::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_flag_converts_debug_format() {
        assert_eq!(normalize_flag("Seen"), "\\Seen");
        assert_eq!(normalize_flag("Answered"), "\\Answered");
        assert_eq!(normalize_flag("Custom(\"NonJunk\")"), "NonJunk");
        // Already-canonical flags pass through untouched
        assert_eq!(normalize_flag("\\Seen"), "\\Seen");
        assert_eq!(normalize_flag("NonJunk"), "NonJunk");
    }

    #[test]
    fn parse_date_to_timestamp_handles_rfc2822() {
        let ts = parse_date_to_timestamp("Mon, 14 Jul 2025 12:00:00 +0900");
        assert_eq!(ts, 1752462000);
        assert_eq!(parse_date_to_timestamp("garbage"), 0);
        assert_eq!(parse_date_to_timestamp(""), 0);
    }

    #[test]
    fn rfc2047_japanese_subject_is_decoded() {
        // "テスト件名" base64-encoded as an RFC2047 encoded word
        let header = "Subject: =?UTF-8?B?44OG44K544OI5Lu25ZCN?=\r\nFrom: =?UTF-8?B?5bGx55Sw?= <yamada@example.com>\r\n\r\n";
        let parsed = mail_parser::MessageParser::default()
            .parse(header.as_bytes())
            .expect("header block should parse");
        assert_eq!(parsed.subject(), Some("テスト件名"));
        let from = parsed.from().and_then(|a| a.first()).expect("from address");
        assert_eq!(from.name.as_deref(), Some("山田"));
        assert_eq!(from.address.as_deref(), Some("yamada@example.com"));
    }

    #[test]
    fn migration_adds_date_ts_and_normalizes_flags() {
        let dir = std::env::temp_dir().join(format!("miomail-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("migrate.db");
        std::fs::remove_file(&path).ok();

        // Simulate a legacy database: no date_ts column, Debug-format flags
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(
                "CREATE TABLE accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL);
                 CREATE TABLE folders (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER, path TEXT NOT NULL, name TEXT NOT NULL, delimiter TEXT, flags TEXT, unread_count INTEGER DEFAULT 0, total_count INTEGER DEFAULT 0, UNIQUE(account_id, path));
                 CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER, folder_id INTEGER, uid INTEGER, message_id TEXT, subject TEXT, from_address TEXT, to_addresses TEXT, cc_addresses TEXT, date TEXT, flags TEXT, snippet TEXT, has_attachments INTEGER DEFAULT 0, UNIQUE(account_id, folder_id, uid));
                 CREATE TABLE message_bodies (message_id INTEGER PRIMARY KEY, html_body TEXT, text_body TEXT);
                 INSERT INTO messages (account_id, folder_id, uid, subject, date, flags) VALUES (1, 1, 10, 'old', 'Mon, 14 Jul 2025 12:00:00 +0900', '[\"Seen\",\"Custom(\\\"NonJunk\\\")\"]');",
            )
            .unwrap();
        }

        let conn = open_connection(&path).unwrap();
        let (date_ts, flags): (i64, String) = conn
            .query_row("SELECT date_ts, flags FROM messages WHERE uid = 10", [], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .unwrap();
        assert_eq!(date_ts, 1752462000);
        let flags: Vec<String> = serde_json::from_str(&flags).unwrap();
        assert_eq!(flags, vec!["\\Seen".to_string(), "NonJunk".to_string()]);

        drop(conn);
        std::fs::remove_file(&path).ok();
    }
}
