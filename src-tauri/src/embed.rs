//! セマンティック検索: 埋め込みモデルの管理・ダウンロード・エンコード。
//!
//! # モデル
//! - 採用: `mochiya98/ruri-v3-70m-onnx` の `onnx/model_int8.onnx`
//!   (cl-nagoya/ruri-v3-70m のコミュニティ int8 ONNX 変換版。Apache-2.0、約 67MB)。
//!   出力は [B, L, 384] のトークン埋め込みで、公式通り mean pooling + L2 正規化を
//!   自前実装している。詳細な選定根拠は MODEL_REPO_OWNER のコメントを参照。
//! - リビジョンと SHA256(モデル・トークナイザ双方)をピン留めし、DL 後に検証する。
//! - プレフィックスは ruri 方式(文書: 「検索文書: 」/ クエリ: 「検索クエリ: 」)。
//!
//! # onnxruntime.dll の準備(開発者向け)
//! ort は `load-dynamic` 構成のため、onnxruntime.dll はリンク時ではなく
//! **実行時**にロードする(ort-sys は load-dynamic 時にバイナリを自動取得しない)。
//! 次のいずれかで DLL を用意すること:
//!   1. `src-tauri/scripts/fetch-ort-dll.ps1` を実行すると、公式リリース
//!      (microsoft/onnxruntime v1.23.2 = ort-sys 2.0.0-rc.11 が想定する版)から
//!      onnxruntime.dll を target/debug/ 等に配置する。
//!   2. あるいは手動で onnxruntime.dll を exe と同じディレクトリに置く。
//!   3. あるいは環境変数 `ORT_DYLIB_PATH` に DLL のフルパスを設定する。
//! DLL が見つからない場合、セマンティック機能はエラーを返すだけで
//! アプリ本体(FTS 検索など)には影響しない(protoc も不要)。
//!
//! # Execution Provider 優先順位
//! cargo feature `npu` 有効時: OpenVINO > Vitis > DirectML > CPU
//! 既定(無効時):              DirectML > CPU
//! is_available() / supported_by_platform() で検出できたものだけを登録し、
//! 登録失敗時は ort が次の EP へフォールバックする。

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use once_cell::sync::OnceCell;
use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::db::DbState;

// ---------------------------------------------------------------------------
// モデル定数(ピン留め)
// ---------------------------------------------------------------------------

/// Hugging Face リポジトリ(owner/name)。
/// 採用: mochiya98/ruri-v3-70m-onnx(cl-nagoya/ruri-v3-70m の int8 ONNX 変換版、
/// Apache-2.0)。選定根拠:
///   - 出力が [B, L, 384] のトークン埋め込みで mean pooling を自力実装できる
///     (公式は mean pooling。CLS プーリング内蔵の変換版は検証で棄却)
///   - 同梱 tokenizer.json が公式 cl-nagoya/ruri-v3-70m とバイト一致(SHA256 同一)
///   - 公式モデルカードの類似度行列をほぼ再現(sim(0,1)=0.948 / 公式 0.954 など)
///   - int8 で約 67MB と軽量(fp32 変換版の 147MB より小さい)
///   - 70m は 30m より JMTEB が高い(75.48 vs 74.51)
pub const MODEL_REPO_OWNER: &str = "mochiya98";
pub const MODEL_REPO_NAME: &str = "ruri-v3-70m-onnx";
/// 取得する ONNX モデルのリポジトリ内パス(int8 量子化版)。
pub const MODEL_REPO_FILE: &str = "onnx/model_int8.onnx";
/// トークナイザのリポジトリ内パス。
pub const TOKENIZER_REPO_FILE: &str = "tokenizer.json";
/// ピン留めするリビジョン(コミット SHA。2025-05-03 時点の main)。
pub const MODEL_REVISION: &str = "b026e28b1cac69eddb2f59f0393bac994c442750";
/// model_int8.onnx の SHA256(ダウンロード後検証用)。
pub const MODEL_SHA256: &str = "c0d9885f7cdd014518b25404b75b67b2072d93c49d0cc5509263b5e8a1994dfa";
/// tokenizer.json の SHA256(公式 cl-nagoya/ruri-v3-70m のものと同一)。
pub const TOKENIZER_SHA256: &str = "0a94ac9a0a02c067bdef25b72ae9f4ee33f48f552e55988d444f6d25eeb1d062";
/// model_int8.onnx の期待バイト数(部分DL検出用)。
pub const MODEL_ONNX_BYTES: u64 = 70_684_662;
/// tokenizer.json の期待バイト数。
pub const TOKENIZER_BYTES: u64 = 6_724_873;
/// 想定ダウンロードサイズ(MB 表示用・概算)。
pub const EXPECTED_MODEL_SIZE_MB: i64 = 75;
/// vectors テーブルに記録するモデルバージョン識別子。
/// モデルを差し替える場合はこの文字列を変えること(古いベクトルは無視され再生成される)。
pub const MODEL_VERSION: &str = "ruri-v3-70m-int8-1";
/// ruri 方式の文書プレフィックス。
pub const DOC_PREFIX: &str = "検索文書: ";
/// ruri 方式のクエリプレフィックス。
pub const QUERY_PREFIX: &str = "検索クエリ: ";
/// トークナイズの最大系列長(それ以降は切り捨て)。
pub const MAX_SEQ_LEN: usize = 512;

// ---------------------------------------------------------------------------
// パス解決
// ---------------------------------------------------------------------------

/// モデル配置ディレクトリ(%LOCALAPPDATA%\com.firemio.miomail\models)。
/// MCP サーバー(別プロセス)からも同じ規則で解決できるよう env ベースで求める。
pub fn models_dir() -> PathBuf {
    let base = std::env::var("LOCALAPPDATA")
        .ok()
        .filter(|p| !p.is_empty())
        .or_else(|| std::env::var("APPDATA").ok().filter(|p| !p.is_empty()));
    match base {
        Some(p) => PathBuf::from(p).join("com.firemio.miomail").join("models"),
        None => std::env::temp_dir().join("com.firemio.miomail").join("models"),
    }
}

pub fn model_onnx_path() -> PathBuf {
    // リポジトリ側パス("onnx/model_int8.onnx")の構造を保ったまま保存される
    models_dir().join(MODEL_REPO_FILE)
}

pub fn tokenizer_path() -> PathBuf {
    models_dir().join(TOKENIZER_REPO_FILE)
}

fn file_has_size(path: &Path, expected: u64) -> bool {
    std::fs::metadata(path).map(|m| m.len() == expected).unwrap_or(false)
}

/// モデルファイル一式が完全に揃っているか(サイズ一致で部分DLを除外)。
pub fn model_files_present() -> bool {
    file_has_size(&model_onnx_path(), MODEL_ONNX_BYTES)
        && file_has_size(&tokenizer_path(), TOKENIZER_BYTES)
}

/// ディスク上のモデルサイズ合計(MB)。
pub fn model_size_on_disk_mb() -> i64 {
    let mut total = 0u64;
    for f in [model_onnx_path(), tokenizer_path()] {
        if let Ok(m) = std::fs::metadata(&f) {
            total += m.len();
        }
    }
    (total / (1024 * 1024)) as i64
}

// ---------------------------------------------------------------------------
// セマンティック機能の状態(IF 契約: SemanticStatus)
// ---------------------------------------------------------------------------

/// IF 契約: mail_semantic_status / mail_semantic_enable の戻り値。
#[derive(Debug, Clone, Serialize)]
pub struct SemanticStatus {
    /// 'off' | 'downloading' | 'ready' | 'error'
    pub state: String,
    pub model_size_mb: i64,
    pub error: Option<String>,
}

/// 現在の状態を組み立てる。enabled フラグ(app_settings)とファイル有無と
/// 記録されたエラーから導出する単純規則。
pub fn semantic_status(conn: &rusqlite::Connection) -> SemanticStatus {
    let enabled = crate::vectorize::semantic_enabled(conn);
    let present = model_files_present();
    let error = crate::vectorize::semantic_error(conn);
    let state = if !enabled {
        "off"
    } else if present {
        "ready"
    } else if error.is_some() {
        "error"
    } else {
        // 有効だがファイルが無く、エラーも無い = DL 中 or これから開始
        "downloading"
    };
    SemanticStatus {
        state: state.to_string(),
        model_size_mb: if present {
            model_size_on_disk_mb()
        } else {
            EXPECTED_MODEL_SIZE_MB
        },
        error: if state == "error" { error } else { None },
    }
}

/// セマンティック機能が実際に使える状態か(有効化済み + モデル完備)。
pub fn semantic_ready(conn: &rusqlite::Connection) -> bool {
    crate::vectorize::semantic_enabled(conn) && model_files_present()
}

// ---------------------------------------------------------------------------
// モデルのダウンロード
// ---------------------------------------------------------------------------

static DOWNLOAD_RUNNING: AtomicBool = AtomicBool::new(false);

/// ファイルの SHA256 を hex で返す(ダウンロード検証用)。
pub fn sha256_file(path: &Path) -> Result<String, String> {
    use sha2::Digest;
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = sha2::Sha256::new();
    std::io::copy(&mut file, &mut hasher).map_err(|e| e.to_string())?;
    Ok(hex_encode(&hasher.finalize()))
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

/// モデルを Hugging Face からダウンロードする(部分再開は hf-hub 側の
/// キャッシュ/既存ファイルスキップで効く)。進捗は `progress(done, total, message)`
/// に都度通知する。完了後に SHA256 を検証し、不一致ならファイルを消して失敗にする。
pub async fn download_model<F>(progress: F) -> Result<(), String>
where
    F: Fn(i64, i64, String) + Send + Sync + 'static,
{
    use hf_hub::progress::{DownloadEvent, ProgressEvent, ProgressHandler};
    use std::collections::HashMap;

    let dir = models_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    struct Handler {
        cb: std::sync::Arc<dyn Fn(i64, i64, String) + Send + Sync>,
        // per-file の累積バイト数(デルタイベントを積算する)
        files: Mutex<HashMap<String, u64>>,
    }
    impl ProgressHandler for Handler {
        fn on_progress(&self, event: &ProgressEvent) {
            let ProgressEvent::Download(ev) = event else { return };
            let cb = self.cb.as_ref();
            match ev {
                DownloadEvent::Start {
                    total_files,
                    total_bytes,
                } => {
                    cb(
                        0,
                        *total_bytes as i64,
                        format!("モデルをダウンロード中 ({} ファイル)", total_files),
                    );
                }
                DownloadEvent::Progress { files } => {
                    let mut acc = self.files.lock().unwrap();
                    for f in files {
                        acc.insert(f.filename.clone(), f.bytes_completed);
                    }
                    let done: u64 = acc.values().sum();
                    let total: u64 = files.iter().map(|f| f.total_bytes).max().unwrap_or(0);
                    cb(done as i64, total as i64, "モデルをダウンロード中".to_string());
                }
                DownloadEvent::AggregateProgress {
                    bytes_completed,
                    total_bytes,
                    ..
                } => {
                    cb(
                        *bytes_completed as i64,
                        *total_bytes as i64,
                        "モデルをダウンロード中".to_string(),
                    );
                }
                DownloadEvent::Complete => {}
            }
        }
    }

    let progress: std::sync::Arc<dyn Fn(i64, i64, String) + Send + Sync> =
        std::sync::Arc::new(progress);

    let client = hf_hub::HFClient::new().map_err(|e| format!("HF クライアント初期化失敗: {}", e))?;
    let repo = client.model(MODEL_REPO_OWNER, MODEL_REPO_NAME);

    // 既存ファイルの破損・旧版の残存で検証に失敗しうるため、
    // 検証失敗時は force_download で1回だけやり直す。
    let mut last_error: Option<String> = None;
    for attempt in 0..2 {
        repo.snapshot_download()
            .revision(MODEL_REVISION)
            .allow_patterns(vec![
                MODEL_REPO_FILE.to_string(),
                TOKENIZER_REPO_FILE.to_string(),
            ])
            .local_dir(dir.clone())
            .force_download(attempt > 0)
            .progress(Handler {
                cb: progress.clone(),
                files: Mutex::new(HashMap::new()),
            })
            .send()
            .await
            .map_err(|e| format!("モデルのダウンロードに失敗しました: {}", e))?;

        // 整合性検証(ピン留めしたリビジョンの既知ハッシュと照合)
        let hash = sha256_file(&model_onnx_path())?;
        let model_ok = hash.eq_ignore_ascii_case(MODEL_SHA256);
        if !model_ok {
            std::fs::remove_file(model_onnx_path()).ok();
        }
        let tok_hash = sha256_file(&tokenizer_path())?;
        let tok_ok = tok_hash.eq_ignore_ascii_case(TOKENIZER_SHA256);
        if !tok_ok {
            std::fs::remove_file(tokenizer_path()).ok();
        }
        if model_ok && tok_ok && model_files_present() {
            // 旧配置(models_dir 直下の model_int8.onnx)の残骸があれば掃除する
            let legacy = dir.join("model_int8.onnx");
            if legacy != model_onnx_path() && legacy.exists() {
                std::fs::remove_file(legacy).ok();
            }
            return Ok(());
        }
        last_error = Some(format!(
            "ダウンロードしたファイルの整合性チェックに失敗しました(SHA256 不一致: model={}, tokenizer={})",
            model_ok, tok_ok
        ));
    }
    Err(last_error.unwrap_or_else(|| "モデルのダウンロードに失敗しました".to_string()))
}

/// mail_semantic_enable: 有効化フラグを立て、必要なら DL タスクを起動する。
pub async fn semantic_enable(app: &AppHandle, db: &DbState) -> Result<SemanticStatus, String> {
    {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        crate::vectorize::setting_set(&conn, crate::vectorize::SETTING_SEMANTIC_ENABLED, "1");
        crate::vectorize::setting_delete(&conn, crate::vectorize::SETTING_SEMANTIC_ERROR);
    }
    // 既に DL 済みなら即 ready
    if model_files_present() {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        return Ok(semantic_status(&conn));
    }
    start_model_download(app.clone());
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    Ok(semantic_status(&conn))
}

/// ダウンロードタスクを(多重起動を防ぎつつ)バックグラウンドで開始する。
pub fn start_model_download(app: AppHandle) {
    if DOWNLOAD_RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }
    tauri::async_runtime::spawn(async move {
        let app2 = app.clone();
        let result = download_model(move |done, total, message| {
            let db = app2.state::<DbState>();
            let lock = db.conn.lock();
            if let Ok(conn) = lock {
                crate::vectorize::job_progress_upsert(
                    &conn,
                    crate::vectorize::JOB_MODEL_DOWNLOAD,
                    0,
                    done,
                    total,
                    &message,
                );
            }
        })
        .await;
        DOWNLOAD_RUNNING.store(false, Ordering::SeqCst);
        let db = app.state::<DbState>();
        let lock = db.conn.lock();
        if let Ok(conn) = lock {
            match result {
                Ok(()) => {
                    crate::vectorize::setting_delete(&conn, crate::vectorize::SETTING_SEMANTIC_ERROR);
                    crate::vectorize::job_progress_finish(
                        &conn,
                        crate::vectorize::JOB_MODEL_DOWNLOAD,
                        0,
                        "モデルのダウンロードが完了しました",
                    );
                    log::info!("semantic model downloaded to {}", models_dir().display());
                }
                Err(e) => {
                    log::error!("semantic model download failed: {}", e);
                    crate::vectorize::setting_set(&conn, crate::vectorize::SETTING_SEMANTIC_ERROR, &e);
                    crate::vectorize::job_progress_fail(
                        &conn,
                        crate::vectorize::JOB_MODEL_DOWNLOAD,
                        0,
                        &format!("モデルのダウンロードに失敗しました: {}", e),
                    );
                }
            }
        }
    });
}

/// アプリ起動時の再開処理: 有効化済みなのにモデル未完備なら DL を再開する。
/// (エラー記録がある場合はユーザーが再度「有効化」を押すまで再試行しない)
pub fn maybe_resume_model_download(app: &AppHandle) {
    let (enabled, has_error) = {
        let db = app.state::<DbState>();
        let lock = db.conn.lock();
        match lock {
            Ok(conn) => (
                crate::vectorize::semantic_enabled(&conn),
                crate::vectorize::semantic_error(&conn).is_some(),
            ),
            Err(_) => return,
        }
    };
    if enabled && !has_error && !model_files_present() {
        start_model_download(app.clone());
    }
}

// ---------------------------------------------------------------------------
// エンコード(ONNX 推論)
// ---------------------------------------------------------------------------

/// エンコード対象の種別(プレフィックスが変わる)。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EncodeKind {
    /// 検索対象の文書(メール本文など)。
    Document,
    /// 検索クエリ。
    Query,
}

struct Embedder {
    session: Mutex<ort::session::Session>,
    tokenizer: tokenizers::Tokenizer,
}

static EMBEDDER: OnceCell<Result<Embedder, String>> = OnceCell::new();

/// onnxruntime.dll の候補パスを探す(存在するものを返す)。
fn find_ort_dll() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("ORT_DYLIB_PATH") {
        if !p.is_empty() && Path::new(&p).exists() {
            return Some(PathBuf::from(p));
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let candidate = dir.join("onnxruntime.dll");
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }
    None
}

/// ORT 環境を一度だけ初期化する。DLL 不在やロード失敗(ort 内部で panic
/// しうる)をアプリ全体に波及させないよう catch_unwind で閉じ込める。
fn ensure_ort_env() -> Result<(), String> {
    static ORT_ENV: OnceCell<Result<(), String>> = OnceCell::new();
    ORT_ENV
        .get_or_init(|| {
            let Some(dll) = find_ort_dll() else {
                return Err(
                    "onnxruntime.dll が見つかりません。src-tauri/scripts/fetch-ort-dll.ps1 で配置するか、ORT_DYLIB_PATH を設定してください"
                        .to_string(),
                );
            };
            std::panic::catch_unwind(|| {
                match ort::init_from(&dll) {
                    Ok(builder) => {
                        let _ = builder.with_name("miomail").commit();
                        Ok(())
                    }
                    Err(e) => Err(format!(
                        "onnxruntime.dll の初期化に失敗しました ({}): {}",
                        dll.display(),
                        e
                    )),
                }
            })
            .map_err(|_| format!("onnxruntime.dll の読み込みに失敗しました: {}", dll.display()))?
        })
        .clone()
}

// ---------------------------------------------------------------------------
// EP 検出(ep_chain / system info 共有)
// ---------------------------------------------------------------------------

/// EP の検出結果。ort 呼び出しは初回のみ行い、結果をプロセス内でキャッシュする。
#[derive(Debug, Clone, Copy)]
pub struct EpAvailability {
    /// cargo feature `npu` 有効ビルドか(OpenVINO / Vitis を候補に含めるか)。
    pub npu_built: bool,
    /// OpenVINO (Intel NPU) EP が利用可能か。
    pub openvino: bool,
    /// Vitis (AMD NPU / Ryzen AI) EP が利用可能か。
    pub vitis: bool,
    /// DirectML EP が利用可能か。
    pub directml: bool,
    /// onnxruntime.dll の初期化に失敗した場合の理由(この場合 EP 検出自体が不能)。
    pub ort_error: Option<&'static str>,
}

/// EP 可用性を返す(初回のみ検出しキャッシュ。DLL ロード失敗時は全 EP 不可)。
pub fn ep_availability() -> EpAvailability {
    static AVAIL: OnceCell<EpAvailability> = OnceCell::new();
    *AVAIL.get_or_init(detect_ep_availability)
}

fn detect_ep_availability() -> EpAvailability {
    use ort::ep::ExecutionProvider;

    // is_available() は ORT 環境の初期化が前提。DLL 不在なら検出不能として扱う。
    let ort_error: Option<&'static str> = match ensure_ort_env() {
        Ok(()) => None,
        Err(_) => Some("onnxruntime.dll を読み込めないため EP を検出できません"),
    };

    let mut avail = EpAvailability {
        npu_built: cfg!(feature = "npu"),
        openvino: false,
        vitis: false,
        directml: false,
        ort_error,
    };
    if ort_error.is_some() {
        return avail;
    }

    #[cfg(feature = "npu")]
    {
        avail.openvino = ort::ep::OpenVINO::default().is_available().unwrap_or(false);
        avail.vitis = ort::ep::Vitis::default().is_available().unwrap_or(false);
    }

    let dml = ort::ep::DirectML::default();
    avail.directml = dml.supported_by_platform() && dml.is_available().unwrap_or(false);

    avail
}

/// 優先順位チェーン(OpenVINO > Vitis > DirectML > CPU)で実際に選ばれる EP の
/// 識別子を返す。セッション未初期化でも「使う予定の EP」として同じ規則で決まる。
/// 戻り値: 'intel_npu' | 'amd_npu' | 'directml' | 'cpu'
pub fn active_ep_id(avail: &EpAvailability) -> &'static str {
    if avail.npu_built {
        if avail.openvino {
            return "intel_npu";
        }
        if avail.vitis {
            return "amd_npu";
        }
    }
    if avail.directml {
        return "directml";
    }
    "cpu"
}

/// EP 優先順位チェーンを組み立てる。検出できたものだけを登録候補にする。
fn ep_chain() -> Vec<ort::ep::ExecutionProviderDispatch> {
    let avail = ep_availability();

    let mut eps: Vec<ort::ep::ExecutionProviderDispatch> = Vec::new();

    // NPU は cargo feature `npu` で opt-in された場合のみ候補に入れる
    #[cfg(feature = "npu")]
    {
        if avail.openvino {
            log::info!("semantic: OpenVINO (NPU) EP を候補に追加");
            eps.push(ort::ep::OpenVINO::default().build());
        }
        if avail.vitis {
            log::info!("semantic: Vitis (NPU) EP を候補に追加");
            eps.push(ort::ep::Vitis::default().build());
        }
    }

    if avail.directml {
        log::info!("semantic: DirectML EP を候補に追加");
        eps.push(ort::ep::DirectML::default().build());
    }

    // 最後は必ず CPU
    eps.push(ort::ep::CPU::default().build());
    eps
}

fn embedder() -> Result<&'static Embedder, String> {
    EMBEDDER
        .get_or_init(|| {
            ensure_ort_env()?;

            if !model_files_present() {
                return Err(
                    "セマンティック検索モデルがダウンロードされていません。MioMail アプリの設定でセマンティック検索を有効化してください"
                        .to_string(),
                );
            }

            let session = std::panic::catch_unwind(|| {
                ort::session::Session::builder()
                    .and_then(|b| b.with_intra_threads(2))
                    .and_then(|b| b.with_execution_providers(ep_chain()))
                    .and_then(|b| b.commit_from_file(model_onnx_path()))
            })
            .map_err(|_| "ONNX セッションの作成に失敗しました(panic)".to_string())?
            .map_err(|e| format!("ONNX セッションの作成に失敗しました: {}", e))?;

            let mut tokenizer = tokenizers::Tokenizer::from_file(tokenizer_path())
                .map_err(|e| format!("tokenizer.json の読み込みに失敗しました: {}", e))?;
            // 長文は MAX_SEQ_LEN で切り捨てる(それ以上はモデルに入れない)
            let truncation = tokenizers::TruncationParams {
                max_length: MAX_SEQ_LEN,
                ..Default::default()
            };
            tokenizer.with_truncation(Some(truncation)).ok();

            Ok(Embedder {
                session: Mutex::new(session),
                tokenizer,
            })
        })
        .as_ref()
        .map_err(|e| e.clone())
}

/// テキスト群を埋め込みベクトルに変換する(mean pooling + L2 正規化)。
/// 戻り値は入力と同じ順序の Vec<Vec<f32>>(L2 正規化済み)。
/// 失敗時(DLL 不在・モデル未DLなど)は Err。
///
/// この関数は CPU 負荷が高くブロッキングするため、async コンテキストからは
/// `tokio::task::spawn_blocking` 経由で呼ぶこと。
///
/// 注意: この ONNX グラフはパディングトークンが attention に僅かに漏洩する
/// (検証: パディング率に比例して埋め込みがずれる)。そのためトークン長が
/// 同じテキスト同士をグループ化し、グループ内はパディング無しで推論する。
pub fn encode(texts: &[String], kind: EncodeKind) -> Result<Vec<Vec<f32>>, String> {
    if texts.is_empty() {
        return Ok(Vec::new());
    }
    let emb = embedder()?;

    let prefix = match kind {
        EncodeKind::Document => DOC_PREFIX,
        EncodeKind::Query => QUERY_PREFIX,
    };
    let prefixed: Vec<String> = texts.iter().map(|t| format!("{}{}", prefix, t)).collect();
    let encodings = emb
        .tokenizer
        .encode_batch(prefixed, true)
        .map_err(|e| format!("トークナイズに失敗しました: {}", e))?;

    // トークン長 → その長さのテキストのインデックス群
    use std::collections::HashMap;
    let mut groups: HashMap<usize, Vec<usize>> = HashMap::new();
    for (i, enc) in encodings.iter().enumerate() {
        groups.entry(enc.get_ids().len()).or_default().push(i);
    }

    let mut session = emb.session.lock().map_err(|e| e.to_string())?;

    // ONNX グラフの入力名に合わせて名前付きで供給する
    let input_names: Vec<String> = session.inputs().iter().map(|i| i.name().to_string()).collect();
    let ids_name = input_names
        .iter()
        .find(|n| n.contains("input_ids"))
        .cloned()
        .unwrap_or_else(|| input_names[0].clone());
    let mask_name = input_names.iter().find(|n| n.contains("attention_mask")).cloned();

    let mut result: Vec<Option<Vec<f32>>> = (0..texts.len()).map(|_| None).collect();

    for (len, idxs) in groups {
        let group_size = idxs.len();
        let len = len.max(1);

        // [G, L] の i64 入力(同一長グループなのでパディング不要)
        let mut ids_flat = vec![0i64; group_size * len];
        let mut mask_flat = vec![0i64; group_size * len];
        for (g, &idx) in idxs.iter().enumerate() {
            let enc = &encodings[idx];
            let ids = enc.get_ids();
            let mask = enc.get_attention_mask();
            for (i, &id) in ids.iter().enumerate() {
                ids_flat[g * len + i] = id as i64;
                mask_flat[g * len + i] = mask.get(i).copied().unwrap_or(0) as i64;
            }
        }

        let shape = vec![group_size as i64, len as i64];
        let ids_tensor = ort::value::Tensor::from_array((shape.clone(), ids_flat))
            .map_err(|e| e.to_string())?;
        let mask_tensor =
            ort::value::Tensor::from_array((shape, mask_flat.clone())).map_err(|e| e.to_string())?;

        let inputs: Vec<(std::borrow::Cow<'_, str>, ort::session::SessionInputValue<'_>)> =
            match &mask_name {
                Some(mn) => ort::inputs![ids_name.clone() => ids_tensor, mn.clone() => mask_tensor],
                None => ort::inputs![ids_name.clone() => ids_tensor],
            };

        let outputs = session
            .run(inputs)
            .map_err(|e| format!("ONNX 推論に失敗しました: {}", e))?;

        let (oshape, data) = outputs[0]
            .try_extract_tensor::<f32>()
            .map_err(|e| format!("出力テンソルの取得に失敗しました: {}", e))?;
        let dims: Vec<i64> = oshape.iter().copied().collect();

        match dims.len() {
            // [G, L, D]: トークン埋め込み → attention mask 付き mean pooling
            3 => {
                let seq = dims[1] as usize;
                let dim = dims[2] as usize;
                for (g, &idx) in idxs.iter().enumerate() {
                    let mut pooled = vec![0f32; dim];
                    let mut count = 0f32;
                    for i in 0..seq {
                        if mask_flat[g * len + i] == 0 {
                            continue;
                        }
                        count += 1.0;
                        let base = (g * seq + i) * dim;
                        for d in 0..dim {
                            pooled[d] += data[base + d];
                        }
                    }
                    if count > 0.0 {
                        for v in pooled.iter_mut() {
                            *v /= count;
                        }
                    }
                    result[idx] = Some(pooled);
                }
            }
            // [G, D]: 既にプーリング済み
            2 => {
                let dim = dims[1] as usize;
                for (g, &idx) in idxs.iter().enumerate() {
                    result[idx] = Some(data[g * dim..(g + 1) * dim].to_vec());
                }
            }
            other => {
                return Err(format!("想定外の出力テンソル形状です: {:?}", other));
            }
        }
    }

    let mut out: Vec<Vec<f32>> = Vec::with_capacity(texts.len());
    for r in result {
        let mut v = r.ok_or_else(|| "エンコード結果の整合性エラー".to_string())?;
        // L2 正規化
        let norm: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt();
        if norm > 0.0 {
            for x in v.iter_mut() {
                *x /= norm;
            }
        }
        out.push(std::mem::take(&mut v));
    }
    Ok(out)
}

/// クエリ1件のエンコード(セマンティック検索用)。
pub fn encode_query(query: &str) -> Result<Vec<f32>, String> {
    let texts = vec![query.to_string()];
    let mut vecs = encode(&texts, EncodeKind::Query)?;
    vecs.pop().ok_or_else(|| "エンコード結果が空です".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn models_dir_is_under_local_app_data() {
        let dir = models_dir();
        let s = dir.to_string_lossy();
        assert!(s.contains("com.firemio.miomail"), "dir = {}", s);
        assert!(s.ends_with("models"), "dir = {}", s);
    }

    #[test]
    fn hex_encode_works() {
        assert_eq!(hex_encode(&[0x0a, 0xff, 0x00]), "0aff00");
    }

    /// 実際にモデルを DL してエンコードする手動テスト。
    /// 実行: `cargo test --lib embed::tests::manual_download_and_encode -- --ignored --nocapture`
    /// (onnxruntime.dll を target/debug/deps から解決できること。要 ORT_DYLIB_PATH)
    #[test]
    #[ignore]
    fn manual_download_and_encode() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        if !model_files_present() {
            rt.block_on(async {
                download_model(|done, total, msg| {
                    eprintln!("{}/{} {}", done, total, msg);
                })
                .await
                .expect("download failed");
            });
        }
        assert!(model_files_present(), "モデルファイルが揃っている");

        let docs = vec![
            "来週の定例会議の議題を送ります。予算案と進捗報告を含みます。".to_string(),
            "本日のランチはカレーうどんがおすすめです。".to_string(),
        ];
        let vecs = encode(&docs, EncodeKind::Document).expect("encode failed");
        assert_eq!(vecs.len(), 2);
        assert_eq!(vecs[0].len(), 384, "ruri-v3-70m の埋め込み次元");
        let norm: f32 = vecs[0].iter().map(|x| x * x).sum::<f32>().sqrt();
        assert!((norm - 1.0).abs() < 1e-3, "L2 正規化されている: {}", norm);

        let q = encode_query("会議の予定").expect("query encode failed");
        let sim_related = crate::vectorize::cosine_similarity(&q, &vecs[0]);
        let sim_unrelated = crate::vectorize::cosine_similarity(&q, &vecs[1]);
        eprintln!("related={} unrelated={}", sim_related, sim_unrelated);
        assert!(
            sim_related > sim_unrelated + 0.05,
            "関連文書の方が無関係文書より類似度が高い: {} <= {}",
            sim_related,
            sim_unrelated
        );
    }
}


#[cfg(test)]
mod diag_real_tests {
    use crate::embed::*;
    use crate::vectorize::{SqliteVectorStore, VectorStore};

    /// 実 DB のベクトルに対する実クエリのスコア分布を出す診断用。
    /// 実行: ORT_DYLIB_PATH=... cargo test --lib diag_real_scores -- --ignored --nocapture
    #[test]
    #[ignore]
    fn diag_real_scores() {
        let db_path = crate::db::default_db_path().expect("db path");
        let conn = rusqlite::Connection::open(&db_path).expect("open db");
        let mut stmt = conn
            .prepare("SELECT id, subject FROM messages WHERE account_id = 2 ORDER BY id")
            .unwrap();
        let subjects: Vec<(i64, String)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        let store = SqliteVectorStore { conn: &conn };
        for q in ["温泉の宿を予約したい", "お金の支払いに関する案内", "請求書", "payment deadline", "新製品の案内"] {
            let qv = encode_query(q).expect("encode query");
            let hits = store.search_cosine(&qv, Some(2), MODEL_VERSION, 8).unwrap();
            eprintln!("
== query: {}", q);
            for (id, score) in &hits {
                let subj = subjects
                    .iter()
                    .find(|(rid, _)| rid == id)
                    .map(|r| r.1.clone())
                    .unwrap_or_default();
                let short: String = subj.chars().take(34).collect();
                eprintln!("  {:.4}  id={}  {}", score, id, short);
            }
        }
    }
}
