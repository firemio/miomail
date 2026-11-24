use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

#[derive(Debug, Serialize)]
pub struct UpdateStatus {
    pub available: bool,
    pub current_version: String,
    pub latest_version: Option<String>,
    pub notes: Option<String>,
}

/// Linux で自動更新が使えるのは AppImage で動かしているときだけ。
/// deb で入れた場合は apt の管理下なので、アプリから置き換えない。
#[cfg(target_os = "linux")]
fn ensure_updatable() -> Result<(), String> {
    if std::env::var_os("APPIMAGE").is_none() {
        return Err(
            "自動更新は AppImage 版のみ対応しています。deb で入れた場合は、新しい deb を入れ直してください。"
                .to_string(),
        );
    }
    Ok(())
}

#[cfg(not(target_os = "linux"))]
fn ensure_updatable() -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn update_check(app: AppHandle) -> Result<UpdateStatus, String> {
    ensure_updatable()?;
    let current_version = app.package_info().version.to_string();

    let updater = app.updater().map_err(|e| e.to_string())?;
    let update = updater.check().await.map_err(|e| {
        log::warn!("update check failed: {}", e);
        format!("更新の確認に失敗しました: {}", e)
    })?;

    Ok(match update {
        Some(update) => UpdateStatus {
            available: true,
            current_version,
            latest_version: Some(update.version.clone()),
            notes: update.body.clone(),
        },
        None => UpdateStatus {
            available: false,
            current_version,
            latest_version: None,
            notes: None,
        },
    })
}

/// Download and install the latest update, then restart the app.
#[tauri::command]
pub async fn update_install(app: AppHandle) -> Result<(), String> {
    ensure_updatable()?;
    let updater = app.updater().map_err(|e| e.to_string())?;
    let update = updater
        .check()
        .await
        .map_err(|e| format!("更新の確認に失敗しました: {}", e))?
        .ok_or("すでに最新バージョンです")?;

    log::info!("installing update {}", update.version);
    update
        .download_and_install(
            |chunk, total| {
                log::debug!("update download: {} / {:?}", chunk, total);
            },
            || {
                log::info!("update download finished");
            },
        )
        .await
        .map_err(|e| format!("更新のダウンロード/インストールに失敗しました: {}", e))?;

    app.restart();
}
