//! IF 契約: mail_system_info — 動作環境情報を返す軽量コマンド。
//!
//! - app_version / os / arch はコンパイル時定数
//! - cpu_name は raw-cpuid で取得(初回のみ、キャッシュ)
//! - アクセラレータ情報は WinML (Windows ML) の情報を返す

use once_cell::sync::OnceCell;
use serde::Serialize;
use tauri::State;

use crate::db::DbState;
use crate::embed::SemanticStatus;

/// IF 契約: AcceleratorInfo
#[derive(Debug, Clone, Serialize)]
pub struct AcceleratorInfo {
    /// 'winml' | 'cpu'
    pub id: String,
    /// 'Windows ML' | 'CPU'
    pub label: String,
    /// 'active' | 'available' | 'unavailable'
    pub status: String,
    /// 補足(利用不可の理由など)
    pub note: String,
}

/// IF 契約: SystemInfo
#[derive(Debug, Clone, Serialize)]
pub struct SystemInfo {
    pub app_version: String,
    pub os: String,
    pub arch: String,
    pub cpu_name: String,
    pub accelerators: Vec<AcceleratorInfo>,
    pub semantic: SemanticStatus,
}

/// WinML アクセラレータ情報を組み立てる。
/// WinML は Windows 組み込みの ONNX Runtime を使用し、デバイス(NPU/GPU/CPU)は
/// システムが自動的に選択するため、個別の EP 検出は不要。
fn accelerator_infos() -> Vec<AcceleratorInfo> {
    let winml_available = cfg!(target_os = "windows");

    let winml = AcceleratorInfo {
        id: "winml".to_string(),
        label: "Windows ML".to_string(),
        status: if winml_available { "active" } else { "unavailable" }.to_string(),
        note: if winml_available {
            "Windows 組み込みの ONNX Runtime を使用。デバイスはシステムが自動選択(NPU > GPU > CPU)".to_string()
        } else {
            "Windows ML は Windows のみ対応です".to_string()
        },
    };

    let cpu = AcceleratorInfo {
        id: "cpu".to_string(),
        label: "CPU".to_string(),
        status: if winml_available { "available" } else { "active" }.to_string(),
        note: "常に利用可能なフォールバックです".to_string(),
    };

    vec![winml, cpu]
}

/// CPU 名を返す(初回のみ検出してキャッシュ。取れなければ "不明")。
fn cpu_name() -> String {
    static NAME: OnceCell<String> = OnceCell::new();
    NAME.get_or_init(detect_cpu_name).clone()
}

#[cfg(any(target_arch = "x86", target_arch = "x86_64"))]
fn detect_cpu_name() -> String {
    raw_cpuid::CpuId::new()
        .get_processor_brand_string()
        .map(|b| b.as_str().trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "不明".to_string())
}

#[cfg(not(any(target_arch = "x86", target_arch = "x86_64")))]
fn detect_cpu_name() -> String {
    "不明".to_string()
}

/// IF 契約: mail_system_info — 動作環境情報を返す。
/// semantic は既存 mail_semantic_status と同じロジック(embed::semantic_status)。
#[tauri::command]
pub fn mail_system_info(db: State<'_, DbState>) -> Result<SystemInfo, String> {
    let semantic = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        crate::embed::semantic_status(&conn)
    };
    Ok(SystemInfo {
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        cpu_name: cpu_name(),
        accelerators: accelerator_infos(),
        semantic,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn find<'a>(infos: &'a [AcceleratorInfo], id: &str) -> &'a AcceleratorInfo {
        infos.iter().find(|i| i.id == id).expect("id が存在すること")
    }

    #[test]
    fn winml_active_on_windows() {
        let infos = accelerator_infos();
        let winml = find(&infos, "winml");
        let cpu = find(&infos, "cpu");

        if cfg!(target_os = "windows") {
            assert_eq!(winml.status, "active");
            assert_eq!(cpu.status, "available");
        } else {
            assert_eq!(winml.status, "unavailable");
            assert_eq!(cpu.status, "active");
        }
    }

    #[test]
    fn exactly_one_active() {
        let infos = accelerator_infos();
        let n = infos.iter().filter(|i| i.status == "active").count();
        assert_eq!(n, 1, "active は常にちょうど 1 つ");
    }
}
