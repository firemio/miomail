//! IF 契約: mail_system_info — 動作環境情報を返す軽量コマンド。
//!
//! - app_version / os / arch はコンパイル時定数
//! - cpu_name は raw-cpuid で取得(初回のみ、キャッシュ)
//! - アクセラレータ情報は ort(ONNX Runtime + 新 Windows ML)が `GetEpDevices` で
//!   列挙した実デバイス(EP名・ベンダー・CPU/GPU/NPU)から組み立てる。
//!   検出は embed::ep_probe() のキャッシュ済み結果を使う(呼ぶたびに重い処理は
//!   しない。モデル DL も発生しない)。

use once_cell::sync::OnceCell;
use serde::Serialize;
use tauri::State;

use crate::db::DbState;
use crate::embed::{self, EpDeviceInfo, EpHardware, SemanticStatus};

/// IF 契約: AcceleratorInfo
#[derive(Debug, Clone, Serialize)]
pub struct AcceleratorInfo {
    /// 一意な識別子(表示キー)。'intel_npu' | 'amd_npu' | 'qnn_npu' | 'directml'
    /// | 'tensorrt' | 'cpu' など。重複時は末尾に連番が付く。
    pub id: String,
    /// 表示ラベル(例: 'Intel NPU (OpenVINO)' | 'DirectML (GPU)' | 'CPU')
    pub label: String,
    /// 'active' | 'available' | 'unavailable'
    pub status: String,
    /// 補足(EP 名・ベンダー・利用不可の理由など)
    pub note: String,
}

/// IF 契約: RuntimeInfo — 実際にロードした Windows ML の素性。
///
/// NPU/GPU が出ないときに「ハードウェアが無い」のか「掴んだ DLL が違う」のかを
/// 設定画面だけで切り分けられるようにするため、常時表示する。
#[derive(Debug, Clone, Serialize)]
pub struct RuntimeInfo {
    /// ONNX Runtime のバージョン文字列。取得できなければ空。
    pub version: String,
    /// 解決した onnxruntime.dll のフルパス。
    pub path: String,
}

/// IF 契約: SystemInfo
#[derive(Debug, Clone, Serialize)]
pub struct SystemInfo {
    pub app_version: String,
    pub os: String,
    pub arch: String,
    pub cpu_name: String,
    /// Windows ML が見つからなければ `None`。
    pub runtime: Option<RuntimeInfo>,
    pub accelerators: Vec<AcceleratorInfo>,
    pub semantic: SemanticStatus,
}

/// EP デバイス 1 件から (id ベース, ラベル) を導出する(純粋ロジック)。
/// EP 名(OpenVINO/VitisAI/QNN/Dml/TensorRT/CUDA)とハードウェア種別から
/// 人間可読なラベルとベース ID を決める。
fn label_for(dev: &EpDeviceInfo) -> (String, String) {
    let ep = dev.ep.as_str();
    let has = |needle: &str| ep.to_ascii_lowercase().contains(&needle.to_ascii_lowercase());
    match dev.hardware {
        EpHardware::Npu => {
            if has("openvino") {
                ("intel_npu".into(), "Intel NPU (OpenVINO)".into())
            } else if has("vitis") {
                ("amd_npu".into(), "AMD NPU (Ryzen AI / VitisAI)".into())
            } else if has("qnn") {
                ("qnn_npu".into(), "Qualcomm NPU (QNN)".into())
            } else {
                let v = if dev.vendor.is_empty() { "".to_string() } else { format!("{} ", dev.vendor) };
                ("npu".into(), format!("{}NPU", v).trim().to_string())
            }
        }
        EpHardware::Gpu => {
            if has("dml") || has("directml") {
                ("directml".into(), "DirectML (GPU)".into())
            } else if has("tensorrt") {
                ("tensorrt".into(), "NVIDIA GPU (TensorRT)".into())
            } else if has("cuda") {
                ("cuda".into(), "NVIDIA GPU (CUDA)".into())
            } else if has("migraphx") {
                ("migraphx".into(), "AMD GPU (MIGraphX)".into())
            } else {
                let v = if dev.vendor.is_empty() { "GPU".to_string() } else { format!("{} GPU", dev.vendor) };
                ("gpu".into(), v)
            }
        }
        EpHardware::Cpu => ("cpu".into(), "CPU".into()),
    }
}

/// EP 名・ベンダーを note 文字列にする。
fn note_for(dev: &EpDeviceInfo) -> String {
    let ep = if dev.ep.is_empty() { "-" } else { dev.ep.as_str() };
    let vendor = if dev.vendor.is_empty() { "-" } else { dev.vendor.as_str() };
    format!("EP: {} / ベンダー: {}", ep, vendor)
}

/// EP 列挙結果から AcceleratorInfo 一覧を組み立てる(純粋ロジック)。
/// `active` は embed::active_device_index と同じ規則(PreferNPU: NPU>GPU>CPU)。
/// `ort_error` があれば推論エンジン利用不可の 1 件を返す。
fn build_accelerators(
    devices: &[EpDeviceInfo],
    active: Option<usize>,
    ort_error: Option<&str>,
) -> Vec<AcceleratorInfo> {
    if let Some(err) = ort_error {
        return vec![AcceleratorInfo {
            id: "engine".into(),
            label: "Windows ML (ONNX Runtime)".into(),
            status: "unavailable".into(),
            note: err.to_string(),
        }];
    }

    if devices.is_empty() {
        return vec![AcceleratorInfo {
            id: "engine".into(),
            label: "Windows ML (ONNX Runtime)".into(),
            status: "unavailable".into(),
            note: "利用可能な Execution Provider が列挙できませんでした".into(),
        }];
    }

    use std::collections::HashMap;
    let mut used: HashMap<String, u32> = HashMap::new();
    let mut infos = Vec::with_capacity(devices.len());
    for (i, dev) in devices.iter().enumerate() {
        let (base_id, label) = label_for(dev);
        // ID の一意化(DirectML GPU が 2 枚など、同じベース ID の重複に連番を付ける)
        let count = used.entry(base_id.clone()).or_insert(0);
        let id = if *count == 0 { base_id.clone() } else { format!("{}-{}", base_id, count) };
        *count += 1;

        let status = if Some(i) == active { "active" } else { "available" };
        infos.push(AcceleratorInfo {
            id,
            label,
            status: status.to_string(),
            note: note_for(dev),
        });
    }
    infos
}

/// アクセラレータ情報を組み立てる(embed::ep_probe のキャッシュ結果を使用)。
fn accelerator_infos() -> Vec<AcceleratorInfo> {
    let probe = embed::ep_probe();
    let active = embed::active_device_index(&probe.devices);
    build_accelerators(&probe.devices, active, probe.ort_error.as_deref())
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
        runtime: runtime_info(),
        accelerators: accelerator_infos(),
        semantic,
    })
}

/// ロード済み Windows ML の素性を返す(embed::ep_probe のキャッシュ結果を使用)。
fn runtime_info() -> Option<RuntimeInfo> {
    embed::ep_probe().runtime.as_ref().map(|r| RuntimeInfo {
        version: r.version.clone(),
        path: r.path.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dev(ep: &str, vendor: &str, hw: EpHardware) -> EpDeviceInfo {
        EpDeviceInfo {
            ep: ep.to_string(),
            vendor: vendor.to_string(),
            hardware: hw,
            id: 0,
        }
    }

    fn find<'a>(infos: &'a [AcceleratorInfo], id: &str) -> &'a AcceleratorInfo {
        infos.iter().find(|i| i.id == id).expect("id が存在すること")
    }

    #[test]
    fn labels_map_from_ep_name() {
        let devices = vec![
            dev("OpenVINOExecutionProvider", "Intel", EpHardware::Npu),
            dev("VitisAIExecutionProvider", "AMD", EpHardware::Npu),
            dev("DmlExecutionProvider", "Intel", EpHardware::Gpu),
            dev("CPUExecutionProvider", "", EpHardware::Cpu),
        ];
        let active = embed::active_device_index(&devices); // 先頭 NPU
        let infos = build_accelerators(&devices, active, None);
        assert_eq!(find(&infos, "intel_npu").label, "Intel NPU (OpenVINO)");
        assert_eq!(find(&infos, "amd_npu").label, "AMD NPU (Ryzen AI / VitisAI)");
        assert_eq!(find(&infos, "directml").label, "DirectML (GPU)");
        assert_eq!(find(&infos, "cpu").label, "CPU");
    }

    #[test]
    fn npu_wins_and_exactly_one_active() {
        let devices = vec![
            dev("DmlExecutionProvider", "Intel", EpHardware::Gpu),
            dev("OpenVINOExecutionProvider", "Intel", EpHardware::Npu),
            dev("CPUExecutionProvider", "", EpHardware::Cpu),
        ];
        let active = embed::active_device_index(&devices);
        let infos = build_accelerators(&devices, active, None);
        assert_eq!(find(&infos, "intel_npu").status, "active");
        let n = infos.iter().filter(|i| i.status == "active").count();
        assert_eq!(n, 1, "active は常にちょうど 1 つ");
    }

    #[test]
    fn gpu_active_when_no_npu() {
        let devices = vec![
            dev("CPUExecutionProvider", "", EpHardware::Cpu),
            dev("DmlExecutionProvider", "Intel", EpHardware::Gpu),
        ];
        let active = embed::active_device_index(&devices);
        let infos = build_accelerators(&devices, active, None);
        assert_eq!(find(&infos, "directml").status, "active");
        assert_eq!(find(&infos, "cpu").status, "available");
    }

    #[test]
    fn duplicate_gpu_ids_are_uniquified() {
        let devices = vec![
            dev("DmlExecutionProvider", "Intel", EpHardware::Gpu),
            dev("DmlExecutionProvider", "NVIDIA", EpHardware::Gpu),
            dev("CPUExecutionProvider", "", EpHardware::Cpu),
        ];
        let active = embed::active_device_index(&devices);
        let infos = build_accelerators(&devices, active, None);
        // 2 枚目は directml-1 に一意化される
        assert!(infos.iter().any(|i| i.id == "directml"));
        assert!(infos.iter().any(|i| i.id == "directml-1"));
        let ids: std::collections::HashSet<_> = infos.iter().map(|i| i.id.clone()).collect();
        assert_eq!(ids.len(), infos.len(), "id は全て一意");
    }

    #[test]
    fn ort_error_yields_single_unavailable() {
        let infos = build_accelerators(&[], None, Some("onnxruntime.dll を読み込めません"));
        assert_eq!(infos.len(), 1);
        assert_eq!(infos[0].status, "unavailable");
        assert!(infos[0].note.contains("onnxruntime.dll"));
    }
}
