use crate::db::DbState;
use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

#[derive(Debug, Serialize)]
pub struct PickedFile {
    pub path: String,
    pub name: String,
    pub size: i64,
}

/// File types that Windows may execute on open. Opening these straight from
/// a mail attachment is a malware vector, so they must be saved explicitly.
const UNSAFE_OPEN_EXTENSIONS: &[&str] = &[
    "exe", "msi", "bat", "cmd", "com", "scr", "pif", "ps1", "psm1", "vbs", "vbe", "js", "jse",
    "wsf", "wsh", "hta", "cpl", "jar", "lnk", "url", "reg", "dll", "application", "appx",
];

fn is_unsafe_to_open(filename: &str) -> bool {
    let ext = filename
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    UNSAFE_OPEN_EXTENSIONS.contains(&ext.as_str())
}

/// Strip directory components and characters Windows rejects in file names.
fn sanitize_filename(name: &str) -> String {
    let base = name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("attachment");
    let cleaned: String = base
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '|' | '?' | '*' => '_',
            c if (c as u32) < 0x20 => '_',
            c => c,
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').trim().to_string();
    if trimmed.is_empty() {
        "attachment".to_string()
    } else {
        trimmed
    }
}

fn load_attachment_blob(db: &DbState, attachment_id: i64) -> Result<(String, Vec<u8>), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT filename, data FROM attachments WHERE id = ?1",
        [attachment_id],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<Vec<u8>>>(1)?.unwrap_or_default(),
            ))
        },
    )
    .map_err(|_| "添付ファイルが見つかりませんでした。メールを開き直してください".to_string())
    .and_then(|(name, data)| {
        if data.is_empty() {
            Err("添付ファイルのデータが空です。メールを開き直してください".to_string())
        } else {
            Ok((name, data))
        }
    })
}

/// If `path` already exists, append " (n)" before the extension.
fn unique_path(dir: &std::path::Path, filename: &str) -> PathBuf {
    let candidate = dir.join(filename);
    if !candidate.exists() {
        return candidate;
    }
    let (stem, ext) = match filename.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s.to_string(), format!(".{}", e)),
        _ => (filename.to_string(), String::new()),
    };
    for n in 1..1000 {
        let candidate = dir.join(format!("{} ({}){}", stem, n, ext));
        if !candidate.exists() {
            return candidate;
        }
    }
    dir.join(filename)
}

/// Pick files to attach in the composer. Returns an empty list on cancel.
#[tauri::command]
pub async fn compose_pick_files(app: AppHandle) -> Result<Vec<PickedFile>, String> {
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("添付するファイルを選択")
            .blocking_pick_files()
    })
    .await
    .map_err(|e| e.to_string())?;

    let Some(files) = picked else {
        return Ok(Vec::new());
    };

    let mut result = Vec::new();
    for file in files {
        let path = file.into_path().map_err(|e| e.to_string())?;
        let size = std::fs::metadata(&path).map(|m| m.len() as i64).unwrap_or(0);
        let name = path
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "attachment".to_string());
        result.push(PickedFile {
            path: path.to_string_lossy().to_string(),
            name,
            size,
        });
    }
    Ok(result)
}

/// Save one attachment via a save-file dialog. Returns the chosen path,
/// or None when the user cancelled.
#[tauri::command]
pub async fn attachment_save(
    app: AppHandle,
    attachment_id: i64,
    db: State<'_, DbState>,
) -> Result<Option<String>, String> {
    let (filename, data) = load_attachment_blob(db.inner(), attachment_id)?;
    let suggested = sanitize_filename(&filename);

    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("添付ファイルを保存")
            .set_file_name(&suggested)
            .blocking_save_file()
    })
    .await
    .map_err(|e| e.to_string())?;

    let Some(file) = picked else {
        return Ok(None);
    };
    let path = file.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, &data)
        .map_err(|e| format!("ファイルの保存に失敗しました: {}", e))?;
    Ok(Some(path.to_string_lossy().to_string()))
}

/// Save all attachments of a message into a picked folder. Returns the
/// folder path, or None when the user cancelled.
#[tauri::command]
pub async fn attachment_save_all(
    app: AppHandle,
    message_id: i64,
    db: State<'_, DbState>,
) -> Result<Option<String>, String> {
    let attachments: Vec<(String, Vec<u8>)> = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT filename, data FROM attachments WHERE message_id = ?1 ORDER BY is_inline, id")
            .map_err(|e| e.to_string())?;
        let rows: Vec<(String, Vec<u8>)> = stmt
            .query_map([message_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<Vec<u8>>>(1)?.unwrap_or_default(),
                ))
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .filter(|(_, data)| !data.is_empty())
            .collect();
        rows
    };

    if attachments.is_empty() {
        return Err("保存できる添付ファイルがありません".to_string());
    }

    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("保存先フォルダを選択")
            .blocking_pick_folder()
    })
    .await
    .map_err(|e| e.to_string())?;

    let Some(folder) = picked else {
        return Ok(None);
    };
    let dir = folder.into_path().map_err(|e| e.to_string())?;

    for (filename, data) in &attachments {
        let target = unique_path(&dir, &sanitize_filename(filename));
        std::fs::write(&target, data)
            .map_err(|e| format!("「{}」の保存に失敗しました: {}", filename, e))?;
    }
    Ok(Some(dir.to_string_lossy().to_string()))
}

/// Open an attachment with its default application (via a temp copy).
/// Executable file types are refused — the user must save them explicitly.
#[tauri::command]
pub async fn attachment_open(
    attachment_id: i64,
    db: State<'_, DbState>,
) -> Result<(), String> {
    let (filename, data) = load_attachment_blob(db.inner(), attachment_id)?;
    if is_unsafe_to_open(&filename) {
        return Err(
            "安全のため、実行可能なファイルは直接開けません。「保存」してから内容をよく確認してください".to_string(),
        );
    }

    let dir = std::env::temp_dir().join("miomail-attachments");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{}-{}", attachment_id, sanitize_filename(&filename)));
    std::fs::write(&path, &data)
        .map_err(|e| format!("一時ファイルの作成に失敗しました: {}", e))?;

    tauri_plugin_opener::open_path(path.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| format!("ファイルを開けませんでした: {}", e))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_filename_strips_paths_and_reserved_chars() {
        assert_eq!(sanitize_filename("..\\..\\evil.exe"), "evil.exe");
        assert_eq!(sanitize_filename("/etc/passwd"), "passwd");
        assert_eq!(sanitize_filename("a<b>c:d.txt"), "a_b_c_d.txt");
        assert_eq!(sanitize_filename("  .hidden.  "), "hidden");
        assert_eq!(sanitize_filename(""), "attachment");
        assert_eq!(sanitize_filename("請求書 2026-07.pdf"), "請求書 2026-07.pdf");
    }

    #[test]
    fn unsafe_extensions_are_refused_for_open() {
        assert!(is_unsafe_to_open("setup.exe"));
        assert!(is_unsafe_to_open("script.PS1"));
        assert!(is_unsafe_to_open("evil.js"));
        assert!(!is_unsafe_to_open("report.pdf"));
        assert!(!is_unsafe_to_open("photo.jpg"));
        assert!(!is_unsafe_to_open("data.xlsx"));
    }
}
