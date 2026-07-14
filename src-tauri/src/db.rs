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
        "CREATE INDEX IF NOT EXISTS idx_messages_folder_datets ON messages(folder_id, date_ts);",
    )?;

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
