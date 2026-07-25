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
//! # 推論エンジン: ort(ONNX Runtime)+ 新 Windows ML
//! 推論には `ort` クレート(`load-dynamic` 構成)を使い、onnxruntime.dll を
//! **実行時**にロードする。指す DLL は新しい Windows ML(Windows App SDK 同梱の
//! ONNX Runtime 1.24 系)で、これが EP カタログ経由で各ベンダーの
//! Execution Provider(Intel=OpenVINO / AMD=VitisAI / Qualcomm=QNN / NVIDIA=TensorRT
//! / DirectML)を実行時に供給・登録する。
//!
//! ## EP 選択
//! セッションは `AutoDevicePolicy::PreferNPU`(= [`EP_POLICY`])で構築し、
//! ONNX Runtime が NPU > GPU > CPU の優先度で自動選択する(利用不可なら順に
//! フォールバックし、最終的に CPU で必ず動く)。実際にどのデバイス/EP が
//! 列挙されているかは [`ep_probe`] が `GetEpDevices`(env.devices())で取得し、
//! 設定画面「システム」に表示する。
//!
//! ## onnxruntime.dll の解決(開発者向け)
//! `find_ort_dll` が次の順で DLL を探す:
//!   1. 環境変数 `ORT_DYLIB_PATH`(新 Windows ML の onnxruntime.dll フルパスを指定)
//!   2. exe と同じディレクトリの `onnxruntime.dll`(配布同梱物)
//! DLL が見つからない/ロードできない場合、セマンティック機能はエラーを返すだけで
//! アプリ本体(FTS 検索など)には影響しない。
//!
//! ### 注意: 汎用 onnxruntime を使ってはいけない
//! GitHub の汎用リリース(`onnxruntime-win-x64-*.zip`)の DLL を掴むと、EP は
//! **CPU 1 個しか列挙されない**。GPU も NPU も出ないため「ハードウェアが無い」と
//! 誤診しやすい(実際に一度この事故を起こした)。必ず WinML の DLL を使うこと:
//!   `C:\Program Files\WindowsApps\Microsoft.WindowsAppRuntime.2_*_x64__*\onnxruntime.dll`
//! パス特定は `scripts/fetch-ort-dll.ps1`(`Get-AppxPackage` を使用。WindowsApps 直下は
//! 権限で列挙できないため `Get-ChildItem` による探索は不可)。
//! この DLL はパッケージ内の依存 DLL と同居した状態でロードする必要があるので、
//! コピーせず `ORT_DYLIB_PATH` で直接指す。

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

/// セッション構築時の EP 自動選択ポリシー。
/// NPU を最優先し、無ければ GPU、最後に CPU へフォールバックする。
const EP_POLICY: ort::session::builder::AutoDevicePolicy =
    ort::session::builder::AutoDevicePolicy::PreferNPU;

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

/// ファイルを HuggingFace からダウンロードする。
/// 進捗は `progress(done, total, message)` に都度通知する。
async fn download_file(
    client: &reqwest::Client,
    url: &str,
    dest: &std::path::Path,
    progress: &std::sync::Arc<dyn Fn(i64, i64, String) + Send + Sync>,
    done_accum: &std::sync::atomic::AtomicI64,
    total: i64,
) -> Result<(), String> {
    use futures::StreamExt;
    use tokio::io::AsyncWriteExt;

    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("ダウンロード開始に失敗しました ({}): {}", url, e))?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!("ダウンロード失敗 ({}): HTTP {}", url, status));
    }

    let mut file = tokio::fs::File::create(dest)
        .await
        .map_err(|e| format!("ファイル作成に失敗しました ({}): {}", dest.display(), e))?;

    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("ダウンロード中にエラー: {}", e))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("ファイル書き込みに失敗しました: {}", e))?;
        let added = chunk.len() as i64;
        let prev = done_accum.fetch_add(added, std::sync::atomic::Ordering::SeqCst);
        progress(prev + added, total, "モデルをダウンロード中".to_string());
    }

    file.flush().await.map_err(|e| e.to_string())?;
    Ok(())
}

/// モデルを Hugging Face からダウンロードする。進捗は `progress(done, total, message)`
/// に都度通知する。完了後に SHA256 を検証し、不一致ならファイルを消して失敗にする。
pub async fn download_model<F>(progress: F) -> Result<(), String>
where
    F: Fn(i64, i64, String) + Send + Sync + 'static,
{
    let dir = models_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let progress: std::sync::Arc<dyn Fn(i64, i64, String) + Send + Sync> =
        std::sync::Arc::new(progress);

    let client = reqwest::Client::new();

    // 既存ファイルの破損・旧版の残存で検証に失敗しうるため、
    // 検証失敗時は1回だけやり直す。
    let mut last_error: Option<String> = None;
    for attempt in 0..2 {
        if attempt > 0 {
            std::fs::remove_file(model_onnx_path()).ok();
            std::fs::remove_file(tokenizer_path()).ok();
        }

        let base_url = format!(
            "https://huggingface.co/{}/{}/resolve/{}",
            MODEL_REPO_OWNER, MODEL_REPO_NAME, MODEL_REVISION
        );

        let total = (MODEL_ONNX_BYTES + TOKENIZER_BYTES) as i64;
        let done = std::sync::atomic::AtomicI64::new(0);
        progress(0, total, "モデルをダウンロード中 (2 ファイル)".to_string());

        download_file(
            &client,
            &format!("{}/{}", base_url, MODEL_REPO_FILE),
            &model_onnx_path(),
            &progress,
            &done,
            total,
        )
        .await?;

        download_file(
            &client,
            &format!("{}/{}", base_url, TOKENIZER_REPO_FILE),
            &tokenizer_path(),
            &progress,
            &done,
            total,
        )
        .await?;

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
// ORT 環境の初期化 / onnxruntime.dll の解決
// ---------------------------------------------------------------------------

/// 新しい Windows ML(ONNX Runtime 1.24 系)を提供する MSIX パッケージのファミリ名。
const WINML_PACKAGE_FAMILY: &str = "Microsoft.WindowsAppRuntime.2_8wekyb3d8bbwe";

/// onnxruntime.dll の候補パスを探す(存在するものを返す)。
/// 1. `ORT_DYLIB_PATH`(明示指定。開発/検証用の最優先オーバーライド)
/// 2. 導入済み Windows ML パッケージ内の onnxruntime.dll ← 通常のユーザーはここ
/// 3. exe と同じディレクトリの onnxruntime.dll(最後の砦)
///
/// 2 を 3 より先に見るのは意図的。exe 同階層に汎用ビルドの onnxruntime.dll が
/// 紛れ込むと CPU EP しか列挙されず GPU/NPU が消えるため、WinML を優先する。
fn find_ort_dll() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("ORT_DYLIB_PATH") {
        if !p.is_empty() && Path::new(&p).exists() {
            return Some(PathBuf::from(p));
        }
    }
    if let Some(p) = find_winml_ort_dll() {
        return Some(p);
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

/// 導入済み Windows ML パッケージ内の onnxruntime.dll を探す。
///
/// パッケージは `C:\Program Files\WindowsApps\...` にあるが、この配下は
/// **ディレクトリ列挙が権限で拒否される**ため `read_dir` では見つけられない。
/// アンパッケージプロセスからも使える kernel32 のパッケージ問い合わせ API
/// (`FindPackagesByPackageFamily` / `GetPackagePathByFullName`)で解決する。
#[cfg(windows)]
fn find_winml_ort_dll() -> Option<PathBuf> {
    let full_names = winml_package::find_packages_by_family(WINML_PACKAGE_FAMILY)?;
    let picked = pick_latest_package(&full_names, current_package_arch())?;
    let dll = winml_package::package_path(picked)?.join("onnxruntime.dll");
    dll.exists().then_some(dll)
}

#[cfg(not(windows))]
fn find_winml_ort_dll() -> Option<PathBuf> {
    None
}

/// 現在のプロセスと同じアーキテクチャを表す、パッケージフルネーム中の識別子。
///
/// onnxruntime.dll はプロセスと同一アーキテクチャでなければロードできない。
/// ARM64 機で x64 ビルドをエミュレーション実行する場合も「プロセスは x64」なので
/// x64 パッケージが要る。したがって実行時 OS ではなくビルドターゲットで決まる。
fn current_package_arch() -> &'static str {
    match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        "x86" => "x86",
        other => other,
    }
}

/// パッケージフルネーム(`Name_Version_Arch__PublisherId`)から
/// (アーキテクチャ, バージョン4要素)を取り出す。形式が違えば `None`。
fn parse_package_full_name(full: &str) -> Option<(&str, [u32; 4])> {
    let mut parts = full.split('_');
    let _name = parts.next()?;
    let version = parts.next()?;
    let arch = parts.next()?;

    let mut v = [0u32; 4];
    let mut nums = version.split('.');
    for slot in v.iter_mut() {
        *slot = nums.next()?.parse().ok()?;
    }
    if nums.next().is_some() {
        return None;
    }
    Some((arch, v))
}

/// 同一ファミリで複数バージョンが同居しうる(実機で 2.1.3.0〜2.3.1.0 を確認)。
/// アーキテクチャが一致するもののうち最新バージョンを選ぶ。
fn pick_latest_package<'a>(full_names: &'a [String], arch: &str) -> Option<&'a str> {
    full_names
        .iter()
        .filter_map(|f| parse_package_full_name(f).map(|(a, v)| (a, v, f)))
        .filter(|(a, _, _)| *a == arch)
        .max_by_key(|(_, v, _)| *v)
        .map(|(_, _, f)| f.as_str())
}

/// kernel32 のパッケージ問い合わせ API の薄いラッパ。
#[cfg(windows)]
mod winml_package {
    use std::ffi::{OsStr, OsString};
    use std::os::windows::ffi::{OsStrExt, OsStringExt};
    use std::path::PathBuf;

    const ERROR_SUCCESS: i32 = 0;
    const ERROR_INSUFFICIENT_BUFFER: i32 = 122;
    /// 実体を持つ通常のパッケージ(ヘッド + 直接参照)を対象にする。
    const PACKAGE_FILTER_HEAD: u32 = 0x0000_0010;
    const PACKAGE_FILTER_DIRECT: u32 = 0x0000_0020;

    #[link(name = "kernel32")]
    extern "system" {
        fn FindPackagesByPackageFamily(
            package_family_name: *const u16,
            package_filters: u32,
            count: *mut u32,
            package_full_names: *mut *mut u16,
            buffer_length: *mut u32,
            buffer: *mut u16,
            package_properties: *mut u32,
        ) -> i32;

        fn GetPackagePathByFullName(
            package_full_name: *const u16,
            path_length: *mut u32,
            path: *mut u16,
        ) -> i32;
    }

    fn to_wide(s: &str) -> Vec<u16> {
        OsStr::new(s)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    /// NUL 終端のワイド文字列を `String` にする。
    ///
    /// # Safety
    /// `p` は NUL 終端された有効なワイド文字列を指していること。
    unsafe fn wide_to_string(p: *const u16) -> String {
        let mut len = 0usize;
        while *p.add(len) != 0 {
            len += 1;
        }
        OsString::from_wide(std::slice::from_raw_parts(p, len))
            .to_string_lossy()
            .into_owned()
    }

    /// ファミリ名に属する、このユーザーに登録済みのパッケージフルネーム一覧。
    /// 未導入なら `None`(1 回目の呼び出しが count=0 で成功する)。
    pub fn find_packages_by_family(family: &str) -> Option<Vec<String>> {
        let family_w = to_wide(family);
        let filters = PACKAGE_FILTER_HEAD | PACKAGE_FILTER_DIRECT;
        let mut count: u32 = 0;
        let mut buf_len: u32 = 0;

        // 1 回目: 必要な件数とバッファ長を問い合わせる。
        let rc = unsafe {
            FindPackagesByPackageFamily(
                family_w.as_ptr(),
                filters,
                &mut count,
                std::ptr::null_mut(),
                &mut buf_len,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        };
        if rc != ERROR_INSUFFICIENT_BUFFER || count == 0 {
            return None;
        }

        // 2 回目: 実際に取得する。names は buf 内を指すポインタ配列。
        let mut names: Vec<*mut u16> = vec![std::ptr::null_mut(); count as usize];
        let mut buf: Vec<u16> = vec![0; buf_len as usize];
        let rc = unsafe {
            FindPackagesByPackageFamily(
                family_w.as_ptr(),
                filters,
                &mut count,
                names.as_mut_ptr(),
                &mut buf_len,
                buf.as_mut_ptr(),
                std::ptr::null_mut(),
            )
        };
        if rc != ERROR_SUCCESS {
            return None;
        }

        // buf が生きているうちに String へコピーする。
        Some(
            names
                .iter()
                .filter(|p| !p.is_null())
                .map(|p| unsafe { wide_to_string(*p) })
                .collect(),
        )
    }

    /// パッケージフルネームからインストール先ディレクトリを得る。
    pub fn package_path(full_name: &str) -> Option<PathBuf> {
        let w = to_wide(full_name);
        let mut len: u32 = 0;
        let rc = unsafe { GetPackagePathByFullName(w.as_ptr(), &mut len, std::ptr::null_mut()) };
        if rc != ERROR_INSUFFICIENT_BUFFER || len == 0 {
            return None;
        }
        let mut buf: Vec<u16> = vec![0; len as usize];
        let rc = unsafe { GetPackagePathByFullName(w.as_ptr(), &mut len, buf.as_mut_ptr()) };
        if rc != ERROR_SUCCESS {
            return None;
        }
        let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        Some(PathBuf::from(OsString::from_wide(&buf[..end])))
    }
}

/// ORT 環境を一度だけ初期化する。DLL 不在やロード失敗(ort 内部で panic
/// しうる)をアプリ全体に波及させないよう catch_unwind で閉じ込める。
fn ensure_ort_env() -> Result<(), String> {
    static ORT_ENV: OnceCell<Result<(), String>> = OnceCell::new();
    ORT_ENV
        .get_or_init(|| {
            let Some(dll) = find_ort_dll() else {
                // エンドユーザーに出る文言。原因(Windows ML 未導入)と対処が分かるようにする。
                // 開発者向けの ORT_DYLIB_PATH は補足として最後に置く。
                return Err(
                    "Windows ML が見つからないため、セマンティック検索を利用できません。\
                     Microsoft Store から「アプリ インストーラー」経由で Windows App SDK ランタイムを導入するか、\
                     Windows Update を適用してください。\
                     (開発者向け: ORT_DYLIB_PATH に WinML の onnxruntime.dll のフルパスを指定しても解決できます)"
                        .to_string(),
                );
            };
            let dll_str = dll.to_string_lossy().to_string();
            std::panic::catch_unwind(|| match ort::init_from(&dll_str) {
                Ok(builder) => {
                    // commit() -> bool(グローバル環境として採用できたか)。
                    // 既に別の環境が採用済みでも推論自体は可能なため戻り値は捨てる。
                    builder.with_name("miomail").commit();
                    Ok(())
                }
                Err(e) => Err(format!(
                    "onnxruntime.dll の初期化に失敗しました ({}): {}",
                    dll_str, e
                )),
            })
            .map_err(|_| format!("onnxruntime.dll の読み込みに失敗しました: {}", dll_str))?
        })
        .clone()
}

// ---------------------------------------------------------------------------
// EP デバイスの列挙(system.rs / 設定画面「システム」と共有)
// ---------------------------------------------------------------------------

/// EP デバイスのハードウェア種別。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EpHardware {
    Cpu,
    Gpu,
    Npu,
}

/// `GetEpDevices`(env.devices())で列挙された 1 デバイス分の情報。
#[derive(Debug, Clone)]
pub struct EpDeviceInfo {
    /// Execution Provider 名(例: "OpenVINOExecutionProvider" / "VitisAIExecutionProvider"
    /// / "DmlExecutionProvider" / "CPUExecutionProvider")。取得不能なら空。
    pub ep: String,
    /// ハードウェアベンダー名(例: "Intel" / "AMD" / "NVIDIA")。取得不能なら空。
    pub vendor: String,
    /// ハードウェア種別(CPU / GPU / NPU)。
    pub hardware: EpHardware,
    /// デバイス ID。
    pub id: u32,
}

/// EP 列挙の結果(初回のみ検出しキャッシュ)。
#[derive(Debug, Clone)]
pub struct EpProbe {
    /// 列挙できた EP デバイス一覧。ORT が使えない場合は空。
    pub devices: Vec<EpDeviceInfo>,
    /// ORT 初期化に失敗した場合の理由(この場合 devices は空)。
    pub ort_error: Option<String>,
}

/// EP デバイス一覧を返す(初回のみ検出しキャッシュ。DLL ロード失敗時は空 + error)。
pub fn ep_probe() -> &'static EpProbe {
    static PROBE: OnceCell<EpProbe> = OnceCell::new();
    PROBE.get_or_init(detect_ep_probe)
}

fn detect_ep_probe() -> EpProbe {
    if let Err(e) = ensure_ort_env() {
        return EpProbe {
            devices: Vec::new(),
            ort_error: Some(e),
        };
    }

    let env = match ort::environment::Environment::current() {
        Ok(env) => env,
        Err(e) => {
            return EpProbe {
                devices: Vec::new(),
                ort_error: Some(format!("ORT 環境の取得に失敗しました: {}", e)),
            }
        }
    };

    let mut devices = Vec::new();
    for d in env.devices() {
        let hardware = match d.ty() {
            ort::memory::DeviceType::NPU => EpHardware::Npu,
            ort::memory::DeviceType::GPU => EpHardware::Gpu,
            _ => EpHardware::Cpu,
        };
        devices.push(EpDeviceInfo {
            ep: d.ep().map(|s| s.to_string()).unwrap_or_default(),
            vendor: d.vendor().map(|s| s.to_string()).unwrap_or_default(),
            hardware,
            id: d.id(),
        });
    }
    log::info!("semantic: ORT EP devices = {:?}", devices);

    EpProbe {
        devices,
        ort_error: None,
    }
}

/// `EP_POLICY`(PreferNPU)で実際に選ばれるであろうデバイスの索引を返す。
/// 規則: 最初の NPU > 最初の GPU > 最初の CPU。1 つも無ければ None。
pub fn active_device_index(devices: &[EpDeviceInfo]) -> Option<usize> {
    devices
        .iter()
        .position(|d| d.hardware == EpHardware::Npu)
        .or_else(|| devices.iter().position(|d| d.hardware == EpHardware::Gpu))
        .or_else(|| devices.iter().position(|d| d.hardware == EpHardware::Cpu))
        .or(if devices.is_empty() { None } else { Some(0) })
}

// ---------------------------------------------------------------------------
// エンコード(ORT 推論)
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

            // セッション構築(AutoDevicePolicy で NPU>GPU>CPU を自動選択)。
            // ort 内部の panic をアプリ全体に波及させないよう閉じ込める。
            // RC 版のビルダーは各メソッドがビルダー内包型のエラー(Error<SessionBuilder>)を
            // 返し `?` で統一できないため、都度 map_err で String に正規化する。
            let session = std::panic::catch_unwind(|| -> Result<ort::session::Session, String> {
                let builder = ort::session::Session::builder().map_err(|e| e.to_string())?;
                let builder = builder.with_auto_device(EP_POLICY).map_err(|e| e.to_string())?;
                // commit_from_file は &mut self のため mut で束縛する。
                let mut builder = builder.with_intra_threads(2).map_err(|e| e.to_string())?;
                builder
                    .commit_from_file(model_onnx_path())
                    .map_err(|e| e.to_string())
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
        let ids_tensor =
            ort::value::Tensor::from_array((shape.clone(), ids_flat)).map_err(|e| e.to_string())?;
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

    #[test]
    fn active_device_index_prefers_npu() {
        let mk = |hw: EpHardware| EpDeviceInfo {
            ep: String::new(),
            vendor: String::new(),
            hardware: hw,
            id: 0,
        };
        // NPU があれば NPU
        let devs = vec![mk(EpHardware::Cpu), mk(EpHardware::Gpu), mk(EpHardware::Npu)];
        assert_eq!(active_device_index(&devs), Some(2));
        // NPU 無し → GPU
        let devs = vec![mk(EpHardware::Cpu), mk(EpHardware::Gpu)];
        assert_eq!(active_device_index(&devs), Some(1));
        // CPU のみ
        let devs = vec![mk(EpHardware::Cpu)];
        assert_eq!(active_device_index(&devs), Some(0));
        // 空
        assert_eq!(active_device_index(&[]), None);
    }

    #[test]
    fn parse_package_full_name_extracts_arch_and_version() {
        assert_eq!(
            parse_package_full_name("Microsoft.WindowsAppRuntime.2_2.3.1.0_x64__8wekyb3d8bbwe"),
            Some(("x64", [2, 3, 1, 0]))
        );
        assert_eq!(
            parse_package_full_name("Microsoft.WindowsAppRuntime.2_2.3.1.0_arm64__8wekyb3d8bbwe"),
            Some(("arm64", [2, 3, 1, 0]))
        );
        // 形式が違うものは弾く
        assert_eq!(parse_package_full_name("NoUnderscores"), None);
        assert_eq!(
            parse_package_full_name("Name_notaversion_x64__pub"),
            None
        );
        assert_eq!(parse_package_full_name("Name_1.2.3_x64__pub"), None);
    }

    #[test]
    fn pick_latest_package_picks_newest_matching_arch() {
        // 実機で同居していた並び(順不同・arm64 混在)を模す
        let names: Vec<String> = [
            "Microsoft.WindowsAppRuntime.2_2.3.0.0_x64__8wekyb3d8bbwe",
            "Microsoft.WindowsAppRuntime.2_2.10.0.0_arm64__8wekyb3d8bbwe",
            "Microsoft.WindowsAppRuntime.2_2.3.1.0_x64__8wekyb3d8bbwe",
            "Microsoft.WindowsAppRuntime.2_2.1.3.0_x64__8wekyb3d8bbwe",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();

        assert_eq!(
            pick_latest_package(&names, "x64"),
            Some("Microsoft.WindowsAppRuntime.2_2.3.1.0_x64__8wekyb3d8bbwe")
        );
        assert_eq!(
            pick_latest_package(&names, "arm64"),
            Some("Microsoft.WindowsAppRuntime.2_2.10.0.0_arm64__8wekyb3d8bbwe")
        );
        // 一致するアーキテクチャが無ければ None(勝手に別 arch を掴まない)
        assert_eq!(pick_latest_package(&names, "x86"), None);
        assert_eq!(pick_latest_package(&[], "x64"), None);
    }

    #[test]
    fn version_compare_is_numeric_not_lexicographic() {
        // "2.10.0.0" > "2.9.0.0"(文字列比較だと逆転する)
        let names: Vec<String> = [
            "P_2.9.0.0_x64__pub",
            "P_2.10.0.0_x64__pub",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        assert_eq!(pick_latest_package(&names, "x64"), Some("P_2.10.0.0_x64__pub"));
    }
}

#[cfg(test)]
mod diag_real_tests {
    use crate::embed::*;
    use crate::vectorize::{SqliteVectorStore, VectorStore};

    /// 実機で ORT が列挙する EP デバイス(CPU/GPU/NPU)を出す診断用。
    /// 実行: cargo test --lib diag_ep_devices -- --ignored --nocapture
    /// (onnxruntime.dll が必要。ORT_DYLIB_PATH か target 配下に配置しておくこと。
    ///  NPU 機ではここに OpenVINO/VitisAI が NPU として出れば成功)。
    #[test]
    #[ignore]
    fn diag_ep_devices() {
        let probe = ep_probe();
        if let Some(err) = &probe.ort_error {
            eprintln!("ORT 初期化エラー: {}", err);
            return;
        }
        eprintln!("列挙された EP デバイス数: {}", probe.devices.len());
        let active = active_device_index(&probe.devices);
        for (i, d) in probe.devices.iter().enumerate() {
            let mark = if Some(i) == active { " <= 選択(PreferNPU)" } else { "" };
            eprintln!(
                "  [{}] hw={:?} ep={:?} vendor={:?} id={}{}",
                i, d.hardware, d.ep, d.vendor, d.id, mark
            );
        }
    }

    /// 実 DB のベクトルに対する実クエリのスコア分布を出す診断用。
    /// 実行: cargo test --lib diag_real_scores -- --ignored --nocapture
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
            eprintln!("\n== query: {}", q);
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
