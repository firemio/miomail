//! IF 契約: mail_system_info — 動作環境情報を返す軽量コマンド。
//!
//! - app_version / os / arch はコンパイル時定数
//! - cpu_name は raw-cpuid で取得(初回のみ、キャッシュ)
//! - EP 検出は embed::ep_availability() のキャッシュ済み結果を使う
//!   (呼ぶたびに重い処理はしない。モデル DL も発生しない)

use once_cell::sync::OnceCell;
use serde::Serialize;
use tauri::State;

use crate::db::DbState;
use crate::embed::{self, EpAvailability, SemanticStatus};

/// IF 契約: AcceleratorInfo
#[derive(Debug, Clone, Serialize)]
pub struct AcceleratorInfo {
    /// 'intel_npu' | 'amd_npu' | 'directml' | 'cpu'
    pub id: String,
    /// 'Intel NPU (OpenVINO)' | 'AMD NPU (Ryzen AI)' | 'DirectML (GPU)' | 'CPU'
    pub label: String,
    /// 'active' | 'available' | 'unavailable' | 'not_built'
    pub status: String,
    /// 補足(有効化方法・利用不可の理由など)
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

/// npu feature 無効ビルド時の NPU 向け補足。
const NPU_NOT_BUILT_NOTE: &str =
    "npu feature ビルドで有効化可能(cargo build --features npu)";

/// EP 検出結果から AcceleratorInfo 一覧を組み立てる(純粋ロジック)。
/// active は embed::active_ep_id と同じ規則(セッションが実際に使う/使う予定の EP)。
fn accelerator_infos(avail: &EpAvailability) -> Vec<AcceleratorInfo> {
    let active = embed::active_ep_id(avail);
    let mk = |id: &str, label: &str, status: &str, note: &str| AcceleratorInfo {
        id: id.to_string(),
        label: label.to_string(),
        status: status.to_string(),
        note: note.to_string(),
    };

    // --- Intel NPU (OpenVINO) ---
    let intel = if !avail.npu_built {
        mk("intel_npu", "Intel NPU (OpenVINO)", "not_built", NPU_NOT_BUILT_NOTE)
    } else if avail.openvino {
        let status = if active == "intel_npu" { "active" } else { "available" };
        mk("intel_npu", "Intel NPU (OpenVINO)", status, "OpenVINO EP を検出しました")
    } else {
        mk(
            "intel_npu",
            "Intel NPU (OpenVINO)",
            "unavailable",
            "OpenVINO EP を検出できません(NPU 非搭載・ドライバ未導入・または onnxruntime 非対応ビルド)",
        )
    };

    // --- AMD NPU (Vitis / Ryzen AI) ---
    let amd = if !avail.npu_built {
        mk("amd_npu", "AMD NPU (Ryzen AI)", "not_built", NPU_NOT_BUILT_NOTE)
    } else if avail.vitis {
        let status = if active == "amd_npu" { "active" } else { "available" };
        mk("amd_npu", "AMD NPU (Ryzen AI)", status, "Vitis EP を検出しました")
    } else {
        mk(
            "amd_npu",
            "AMD NPU (Ryzen AI)",
            "unavailable",
            "Vitis EP を検出できません(NPU 非搭載・ドライバ未導入・または onnxruntime 非対応ビルド)",
        )
    };

    // --- DirectML (GPU) ---
    let directml = if avail.directml {
        let status = if active == "directml" { "active" } else { "available" };
        mk("directml", "DirectML (GPU)", status, "DirectX 12 対応 GPU で利用可能です")
    } else {
        let note = if !cfg!(target_os = "windows") {
            "DirectML は Windows のみ対応です"
        } else if let Some(e) = avail.ort_error {
            e
        } else {
            "DirectML EP を検出できません(GPU 非対応・ドライバの問題・または onnxruntime 非対応ビルド)"
        };
        mk("directml", "DirectML (GPU)", "unavailable", note)
    };

    // --- CPU(常に存在するフォールバック) ---
    let cpu_status = if active == "cpu" { "active" } else { "available" };
    let cpu = mk("cpu", "CPU", cpu_status, "常に利用可能なフォールバック EP です");

    vec![intel, amd, directml, cpu]
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
        embed::semantic_status(&conn)
    };
    Ok(SystemInfo {
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        cpu_name: cpu_name(),
        accelerators: accelerator_infos(&embed::ep_availability()),
        semantic,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn avail(npu_built: bool, openvino: bool, vitis: bool, directml: bool) -> EpAvailability {
        EpAvailability {
            npu_built,
            openvino,
            vitis,
            directml,
            ort_error: None,
        }
    }

    fn find<'a>(infos: &'a [AcceleratorInfo], id: &str) -> &'a AcceleratorInfo {
        infos.iter().find(|i| i.id == id).expect("id が存在すること")
    }

    #[test]
    fn not_built_when_npu_feature_off() {
        // 通常ビルド: NPU 2 種は not_built + 有効化方法の note、DirectML があれば active
        let infos = accelerator_infos(&avail(false, false, false, true));
        assert_eq!(find(&infos, "intel_npu").status, "not_built");
        assert!(find(&infos, "intel_npu").note.contains("npu feature"));
        assert_eq!(find(&infos, "amd_npu").status, "not_built");
        assert!(find(&infos, "amd_npu").note.contains("npu feature"));
        assert_eq!(find(&infos, "directml").status, "active");
        assert_eq!(find(&infos, "cpu").status, "available");
    }

    #[test]
    fn openvino_wins_over_vitis_and_directml() {
        // npu ビルド + 全 EP 検出: 優先順位の先頭 OpenVINO が active
        let infos = accelerator_infos(&avail(true, true, true, true));
        assert_eq!(find(&infos, "intel_npu").status, "active");
        assert_eq!(find(&infos, "amd_npu").status, "available");
        assert_eq!(find(&infos, "directml").status, "available");
        assert_eq!(find(&infos, "cpu").status, "available");
    }

    #[test]
    fn vitis_wins_when_openvino_missing() {
        let infos = accelerator_infos(&avail(true, false, true, true));
        assert_eq!(find(&infos, "intel_npu").status, "unavailable");
        assert_eq!(find(&infos, "amd_npu").status, "active");
        assert_eq!(find(&infos, "directml").status, "available");
    }

    #[test]
    fn directml_active_when_npus_unavailable_even_if_built() {
        // npu ビルドでも NPU が検出できなければ DirectML が active
        let infos = accelerator_infos(&avail(true, false, false, true));
        assert_eq!(find(&infos, "intel_npu").status, "unavailable");
        assert_eq!(find(&infos, "amd_npu").status, "unavailable");
        assert_eq!(find(&infos, "directml").status, "active");
        assert_eq!(find(&infos, "cpu").status, "available");
    }

    #[test]
    fn cpu_active_when_nothing_available() {
        let infos = accelerator_infos(&avail(false, false, false, false));
        assert_eq!(find(&infos, "directml").status, "unavailable");
        assert_eq!(find(&infos, "cpu").status, "active");
    }

    #[test]
    fn directml_unavailable_note_reflects_ort_error() {
        // DLL ロード失敗時はその理由が DirectML の note に出る
        let mut a = avail(false, false, false, false);
        a.ort_error = Some("onnxruntime.dll を読み込めないため EP を検出できません");
        let infos = accelerator_infos(&a);
        let dml = find(&infos, "directml");
        assert_eq!(dml.status, "unavailable");
        if cfg!(target_os = "windows") {
            assert!(dml.note.contains("onnxruntime.dll"));
        } else {
            assert!(dml.note.contains("Windows"));
        }
    }

    #[test]
    fn active_ep_id_priority_chain() {
        assert_eq!(embed::active_ep_id(&avail(true, true, true, true)), "intel_npu");
        assert_eq!(embed::active_ep_id(&avail(true, false, true, true)), "amd_npu");
        assert_eq!(embed::active_ep_id(&avail(true, false, false, true)), "directml");
        assert_eq!(embed::active_ep_id(&avail(true, false, false, false)), "cpu");
        assert_eq!(embed::active_ep_id(&avail(false, false, false, true)), "directml");
        assert_eq!(embed::active_ep_id(&avail(false, false, false, false)), "cpu");
    }

    #[test]
    fn exactly_one_active() {
        for (nb, ov, vi, dm) in [
            (false, false, false, false),
            (false, false, false, true),
            (true, true, false, false),
            (true, false, true, false),
            (true, false, false, true),
            (true, true, true, true),
        ] {
            let infos = accelerator_infos(&avail(nb, ov, vi, dm));
            let n = infos.iter().filter(|i| i.status == "active").count();
            assert_eq!(n, 1, "active は常にちょうど 1 つ: {:?}", (nb, ov, vi, dm));
        }
    }
}
