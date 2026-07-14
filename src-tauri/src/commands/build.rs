use serde::Serialize;

#[derive(Serialize)]
pub struct AppBuildInfo {
    version: String,
    build_id: String,
    commit: String,
    runtime: String,
}

#[tauri::command]
pub fn app_get_build_info() -> AppBuildInfo {
    AppBuildInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        build_id: option_env!("MIOMAIL_BUILD_ID")
            .unwrap_or("dev-build")
            .to_string(),
        commit: option_env!("MIOMAIL_COMMIT")
            .unwrap_or("unknown")
            .to_string(),
        runtime: "tauri".to_string(),
    }
}
