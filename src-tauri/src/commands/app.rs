use tauri::{AppHandle, Manager};

#[tauri::command]
pub async fn app_minimize(app: AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("window not found")?;
    window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn app_maximize(app: AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("window not found")?;
    if window.is_maximized().unwrap_or(false) {
        window.unmaximize().map_err(|e| e.to_string())
    } else {
        window.maximize().map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub async fn app_close(app: AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("window not found")?;
    window.hide().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn app_is_maximized(app: AppHandle) -> Result<bool, String> {
    let window = app.get_webview_window("main").ok_or("window not found")?;
    window.is_maximized().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn app_show_main_window(app: AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("window not found")?;
    window.show().map_err(|e| e.to_string())?;
    window.unminimize().ok();
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn app_quit(app: AppHandle) -> Result<(), String> {
    app.exit(0);
    Ok(())
}
