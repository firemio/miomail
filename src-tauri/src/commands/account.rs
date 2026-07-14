use crate::credentials;
use crate::db::DbState;
use crate::imap_service::{self, ImapConfig};
use crate::smtp_service::{self, SmtpConfig};
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
pub struct Account {
    pub id: i64,
    pub name: String,
    pub email: String,
    pub imap_host: String,
    pub imap_port: i64,
    pub imap_tls: i64,
    pub smtp_host: String,
    pub smtp_port: i64,
    pub smtp_tls: i64,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
pub struct AccountInput {
    pub name: String,
    pub email: String,
    pub imap_host: String,
    pub imap_port: i64,
    pub imap_tls: bool,
    pub smtp_host: String,
    pub smtp_port: i64,
    pub smtp_tls: bool,
    pub imap_password: String,
    pub smtp_password: String,
}

#[tauri::command]
pub fn account_list(db: State<'_, DbState>) -> Result<Vec<Account>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, name, email, imap_host, imap_port, imap_tls, smtp_host, smtp_port, smtp_tls, created_at FROM accounts ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;

    let accounts = stmt
        .query_map([], |row| {
            Ok(Account {
                id: row.get(0)?,
                name: row.get(1)?,
                email: row.get(2)?,
                imap_host: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                imap_port: row.get::<_, Option<i64>>(4)?.unwrap_or(993),
                imap_tls: row.get::<_, Option<i64>>(5)?.unwrap_or(1),
                smtp_host: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
                smtp_port: row.get::<_, Option<i64>>(7)?.unwrap_or(587),
                smtp_tls: row.get::<_, Option<i64>>(8)?.unwrap_or(1),
                created_at: row.get::<_, Option<String>>(9)?.unwrap_or_default(),
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(accounts)
}

#[tauri::command]
pub fn account_create(data: AccountInput, db: State<'_, DbState>) -> Result<Account, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO accounts (name, email, imap_host, imap_port, imap_tls, smtp_host, smtp_port, smtp_tls) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![data.name, data.email, data.imap_host, data.imap_port, if data.imap_tls { 1 } else { 0 }, data.smtp_host, data.smtp_port, if data.smtp_tls { 1 } else { 0 }],
    ).map_err(|e| e.to_string())?;

    let id = conn.last_insert_rowid();

    // If the keyring write fails, remove the account row again so we don't
    // leave a credential-less account behind
    let save_result = credentials::set_password(&format!("miomail-imap-{}", id), &data.imap_password)
        .and_then(|_| credentials::set_password(&format!("miomail-smtp-{}", id), &data.smtp_password));
    if let Err(e) = save_result {
        conn.execute("DELETE FROM accounts WHERE id = ?1", [id]).ok();
        credentials::delete_password(&format!("miomail-imap-{}", id)).ok();
        return Err(format!("パスワードの保存に失敗しました: {}", e));
    }

    Ok(Account {
        id,
        name: data.name,
        email: data.email,
        imap_host: data.imap_host,
        imap_port: data.imap_port,
        imap_tls: if data.imap_tls { 1 } else { 0 },
        smtp_host: data.smtp_host,
        smtp_port: data.smtp_port,
        smtp_tls: if data.smtp_tls { 1 } else { 0 },
        created_at: String::new(),
    })
}

#[tauri::command]
pub async fn account_test(data: AccountInput) -> Result<serde_json::Value, String> {
    let mut result = serde_json::json!({ "imap": false, "smtp": false });

    let imap_config = ImapConfig {
        host: data.imap_host.clone(),
        port: data.imap_port as u16,
        secure: data.imap_tls,
        user: data.email.clone(),
        pass: data.imap_password.clone(),
        accept_invalid_certs: false,
    };

    if imap_service::test_connection(&imap_config).await.is_ok() {
        result["imap"] = serde_json::json!(true);
    }

    let smtp_config = SmtpConfig {
        host: data.smtp_host.clone(),
        port: data.smtp_port as u16,
        secure: data.smtp_tls,
        user: data.email.clone(),
        pass: data.smtp_password.clone(),
        accept_invalid_certs: false,
    };

    if smtp_service::test_connection(&smtp_config).await.is_ok() {
        result["smtp"] = serde_json::json!(true);
    }

    Ok(result)
}

#[tauri::command]
pub fn account_update(id: i64, data: AccountInput, db: State<'_, DbState>) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE accounts SET name=?1, email=?2, imap_host=?3, imap_port=?4, imap_tls=?5, smtp_host=?6, smtp_port=?7, smtp_tls=?8 WHERE id=?9",
        rusqlite::params![data.name, data.email, data.imap_host, data.imap_port, if data.imap_tls { 1 } else { 0 }, data.smtp_host, data.smtp_port, if data.smtp_tls { 1 } else { 0 }, id],
    ).map_err(|e| e.to_string())?;

    if !data.imap_password.is_empty() {
        credentials::set_password(&format!("miomail-imap-{}", id), &data.imap_password)
            .map_err(|e| e.to_string())?;
    }
    if !data.smtp_password.is_empty() {
        credentials::set_password(&format!("miomail-smtp-{}", id), &data.smtp_password)
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn account_delete(id: i64, db: State<'_, DbState>) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    conn.execute_batch("BEGIN TRANSACTION;")
        .map_err(|e| e.to_string())?;
    let r = (|| -> Result<(), rusqlite::Error> {
        conn.execute("DELETE FROM message_bodies WHERE message_id IN (SELECT id FROM messages WHERE account_id = ?1)", [id])?;
        conn.execute("DELETE FROM messages WHERE account_id = ?1", [id])?;
        conn.execute("DELETE FROM folders WHERE account_id = ?1", [id])?;
        conn.execute("DELETE FROM accounts WHERE id = ?1", [id])?;
        Ok(())
    })();

    match r {
        Ok(()) => {
            conn.execute_batch("COMMIT;").map_err(|e| e.to_string())?;
        }
        Err(e) => {
            conn.execute_batch("ROLLBACK;").ok();
            return Err(e.to_string());
        }
    }

    credentials::delete_password(&format!("miomail-imap-{}", id)).ok();
    credentials::delete_password(&format!("miomail-smtp-{}", id)).ok();

    Ok(())
}
