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

fn table_exists(conn: &Connection, name: &str) -> bool {
    conn.query_row(
        "SELECT 1 FROM sqlite_master WHERE name = ?1 AND type = 'table'",
        [name],
        |_| Ok(()),
    )
    .is_ok()
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

    // v5: バックフィル(全メールのローカル化)の進捗をフォルダ単位で保持する。
    // oldest_uid_synced = ローカル取得済みの最古 UID(0 = 未開始)、
    // backfill_done = サーバー上の全履歴を取得し終えたか。
    if !column_exists(conn, "folders", "oldest_uid_synced") {
        conn.execute(
            "ALTER TABLE folders ADD COLUMN oldest_uid_synced INTEGER DEFAULT 0",
            [],
        )?;
    }
    if !column_exists(conn, "folders", "backfill_done") {
        conn.execute(
            "ALTER TABLE folders ADD COLUMN backfill_done INTEGER DEFAULT 0",
            [],
        )?;
    }

    // v6: FTS5 全文検索索引(trigram トークナイザ: 日本語など単語区切りのない
    // 言語でも3文字以上の部分文字列を索引化できる)。
    // messages_fts = messages の外部コンテンツ型(件名/差出人/宛先/snippet)。
    // bodies_fts   = 本文用の通常 FTS5(rowid = message_bodies.message_id)。
    // どちらもトリガーで自動同期し、テーブル新規作成時のみ既存行を一括投入する。
    if !table_exists(conn, "messages_fts") {
        conn.execute_batch(
            "CREATE VIRTUAL TABLE messages_fts USING fts5(
                subject, from_address, to_addresses, cc_addresses, snippet,
                content='messages', content_rowid='id',
                tokenize='trigram'
            );",
        )?;
        // 既存行の一括投入(外部コンテンツ型の標準 rebuild)
        conn.execute_batch("INSERT INTO messages_fts(messages_fts) VALUES('rebuild');")?;
    }
    conn.execute_batch(
        "CREATE TRIGGER IF NOT EXISTS messages_fts_ai AFTER INSERT ON messages BEGIN
            INSERT INTO messages_fts(rowid, subject, from_address, to_addresses, cc_addresses, snippet)
            VALUES (new.id, new.subject, new.from_address, new.to_addresses, new.cc_addresses, new.snippet);
        END;
        CREATE TRIGGER IF NOT EXISTS messages_fts_ad AFTER DELETE ON messages BEGIN
            INSERT INTO messages_fts(messages_fts, rowid, subject, from_address, to_addresses, cc_addresses, snippet)
            VALUES ('delete', old.id, old.subject, old.from_address, old.to_addresses, old.cc_addresses, old.snippet);
        END;
        CREATE TRIGGER IF NOT EXISTS messages_fts_au AFTER UPDATE ON messages BEGIN
            INSERT INTO messages_fts(messages_fts, rowid, subject, from_address, to_addresses, cc_addresses, snippet)
            VALUES ('delete', old.id, old.subject, old.from_address, old.to_addresses, old.cc_addresses, old.snippet);
            INSERT INTO messages_fts(rowid, subject, from_address, to_addresses, cc_addresses, snippet)
            VALUES (new.id, new.subject, new.from_address, new.to_addresses, new.cc_addresses, new.snippet);
        END;",
    )?;

    if !table_exists(conn, "bodies_fts") {
        conn.execute_batch(
            "CREATE VIRTUAL TABLE bodies_fts USING fts5(
                text_body,
                tokenize='trigram'
            );",
        )?;
        // 既存本文の一括投入
        conn.execute_batch(
            "INSERT INTO bodies_fts(rowid, text_body)
             SELECT message_id, text_body FROM message_bodies
             WHERE text_body IS NOT NULL AND text_body != '';",
        )?;
    }
    // INSERT OR REPLACE(message_bodies へのキャッシュ保存で使用)では REPLACE の
    // 暗黙 DELETE にトリガーが乗らない(recursive_triggers 無効のため)場合がある。
    // そのため INSERT/UPDATE トリガーは先に同 rowid を消してから入れ直し、
    // 索引の重複・残滓を防ぐ。
    conn.execute_batch(
        "CREATE TRIGGER IF NOT EXISTS bodies_fts_ai AFTER INSERT ON message_bodies BEGIN
            DELETE FROM bodies_fts WHERE rowid = new.message_id;
            INSERT INTO bodies_fts(rowid, text_body) VALUES (new.message_id, new.text_body);
        END;
        CREATE TRIGGER IF NOT EXISTS bodies_fts_ad AFTER DELETE ON message_bodies BEGIN
            DELETE FROM bodies_fts WHERE rowid = old.message_id;
        END;
        CREATE TRIGGER IF NOT EXISTS bodies_fts_au AFTER UPDATE ON message_bodies BEGIN
            DELETE FROM bodies_fts WHERE rowid = old.message_id;
            INSERT INTO bodies_fts(rowid, text_body) VALUES (new.message_id, new.text_body);
        END;",
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
                 INSERT INTO folders (id, account_id, path, name) VALUES (1, 1, 'INBOX', 'INBOX');
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

        // v5: backfill state columns are added to legacy folders tables
        assert!(column_exists(&conn, "folders", "oldest_uid_synced"));
        assert!(column_exists(&conn, "folders", "backfill_done"));
        let (oldest, done): (i64, i64) = conn
            .query_row(
                "SELECT COALESCE(oldest_uid_synced, -1), COALESCE(backfill_done, -1) FROM folders LIMIT 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!((oldest, done), (0, 0), "初期状態は未開始・未完了");

        drop(conn);
        std::fs::remove_file(&path).ok();
    }

    /// v6 テスト用の最小データ(accounts / folders / messages 各1件)を入れる。
    /// foreign_keys = ON なので参照先から順に作る。
    fn seed_one_message(conn: &Connection, subject: &str) {
        conn.execute_batch(
            "INSERT INTO accounts (id, name, email) VALUES (1, 'test', 't@example.com');
             INSERT INTO folders (id, account_id, path, name) VALUES (1, 1, 'INBOX', 'INBOX');",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO messages (id, account_id, folder_id, uid, subject, from_address, snippet, date_ts)
             VALUES (1, 1, 1, 100, ?1, 'boss@example.com', '', 1000)",
            [subject],
        )
        .unwrap();
    }

    fn fts_match_count(conn: &Connection, table: &str, query: &str) -> i64 {
        conn.query_row(
            &format!("SELECT count(*) FROM {table} WHERE {table} MATCH ?1"),
            [query],
            |r| r.get(0),
        )
        .unwrap()
    }

    #[test]
    fn fts_tables_created_and_synced_via_triggers() {
        let conn = open_connection(Path::new(":memory:")).unwrap();
        assert!(table_exists(&conn, "messages_fts"));
        assert!(table_exists(&conn, "bodies_fts"));

        // INSERT トリガー: 日本語件名が即座に索引化される
        seed_one_message(&conn, "週次レポート提出のお知らせ");
        assert_eq!(fts_match_count(&conn, "messages_fts", "レポート"), 1);

        // UPDATE トリガー: 古い語は消え、新しい語がヒットする
        conn.execute("UPDATE messages SET subject = '定例会議の案内' WHERE id = 1", [])
            .unwrap();
        assert_eq!(fts_match_count(&conn, "messages_fts", "レポート"), 0);
        assert_eq!(fts_match_count(&conn, "messages_fts", "定例会議"), 1);

        // DELETE トリガー: 削除後はヒットしない
        conn.execute("DELETE FROM messages WHERE id = 1", []).unwrap();
        assert_eq!(fts_match_count(&conn, "messages_fts", "定例会議"), 0);
    }

    #[test]
    fn bodies_fts_synced_via_triggers() {
        let conn = open_connection(Path::new(":memory:")).unwrap();
        seed_one_message(&conn, "plain subject");

        // 本文 INSERT → bodies_fts に即反映
        conn.execute(
            "INSERT INTO message_bodies (message_id, text_body) VALUES (1, 'プロジェクト進捗報告書を添付します')",
            [],
        )
        .unwrap();
        assert_eq!(fts_match_count(&conn, "bodies_fts", "進捗報告"), 1);

        // INSERT OR REPLACE(本文キャッシュの保存経路)でも索引が重複・残存しない
        conn.execute(
            "INSERT OR REPLACE INTO message_bodies (message_id, text_body) VALUES (1, '差し替え後の本文です')",
            [],
        )
        .unwrap();
        assert_eq!(fts_match_count(&conn, "bodies_fts", "進捗報告"), 0);
        assert_eq!(fts_match_count(&conn, "bodies_fts", "差し替え後"), 1);

        // DELETE 後はヒットしない
        conn.execute("DELETE FROM message_bodies WHERE message_id = 1", [])
            .unwrap();
        assert_eq!(fts_match_count(&conn, "bodies_fts", "差し替え後"), 0);
    }

    #[test]
    fn fts_migration_backfills_existing_rows() {
        let dir = std::env::temp_dir().join(format!("miomail-fts-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("fts-migrate.db");
        std::fs::remove_file(&path).ok();

        // v6 より前の DB を模擬: FTS テーブルなしで既存データだけがある
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(
                "CREATE TABLE accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL);
                 CREATE TABLE folders (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER, path TEXT NOT NULL, name TEXT NOT NULL, delimiter TEXT, flags TEXT, unread_count INTEGER DEFAULT 0, total_count INTEGER DEFAULT 0, UNIQUE(account_id, path));
                 CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER, folder_id INTEGER, uid INTEGER, message_id TEXT, subject TEXT, from_address TEXT, to_addresses TEXT, cc_addresses TEXT, date TEXT, flags TEXT, snippet TEXT, has_attachments INTEGER DEFAULT 0, UNIQUE(account_id, folder_id, uid));
                 CREATE TABLE message_bodies (message_id INTEGER PRIMARY KEY, html_body TEXT, text_body TEXT);
                 INSERT INTO folders (id, account_id, path, name) VALUES (1, 1, 'INBOX', 'INBOX');
                 INSERT INTO messages (id, account_id, folder_id, uid, subject, from_address, snippet) VALUES (1, 1, 1, 10, '既存メール件名テスト', 'a@example.com', '');
                 INSERT INTO message_bodies (message_id, text_body) VALUES (1, '事前に保存済みの本文内容');",
            )
            .unwrap();
        }

        let conn = open_connection(&path).unwrap();
        // rebuild により既存ヘッダが索引化されている
        assert_eq!(fts_match_count(&conn, "messages_fts", "件名テスト"), 1);
        // 既存本文の一括投入も効いている
        assert_eq!(fts_match_count(&conn, "bodies_fts", "保存済み"), 1);

        // マイグレーションは冪等: 再オープンしても重複投入されない
        drop(conn);
        let conn = open_connection(&path).unwrap();
        let n: i64 = conn
            .query_row("SELECT count(*) FROM bodies_fts", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1, "rebuild/一括投入は初回のみ");

        drop(conn);
        std::fs::remove_file(&path).ok();
    }
}
