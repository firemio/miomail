//! Web ブリッジ — `miomail --serve`
//!
//! MioMail の画面(`src/renderer`)をそのままブラウザーで動かすための層。
//! 画面を作り直すのではなく、レンダラーが使う Tauri の窓口(`invoke` と
//! `listen`)だけを差し替え、ここへ HTTP で転送してもらう。中身はデスクトップ版と
//! 同じコマンド実装・同じ SQLite・同じ資格情報ストアを呼ぶ。
//!
//! 画面の HTML/JS/画像は Tauri がバイナリへ埋め込んだものをそのまま配る
//! (同じ dist を二重に持たないため)。
//!
//! 待ち受けは既定で 127.0.0.1 のみ。URL に付いたワンタイムのトークンを
//! HttpOnly クッキーへ移し、以後のすべての要求でそれを確認する。

use std::collections::{HashMap, VecDeque};
use std::net::{IpAddr, SocketAddr};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;

use axum::body::Bytes;
use axum::extract::{Path as AxumPath, Query, Request, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::Wry;
use tokio::sync::broadcast::error::RecvError;

use crate::commands::account;
use crate::commands::character_mod::{self, CharacterModRegistry};
use crate::commands::mail as mail_core;
use crate::commands::{build, system};
use crate::db::{self, DbState};
use crate::events;

/// クッキー名。`?t=` で渡されたトークンをここへ移す。
const COOKIE_NAME: &str = "miomail_bridge";

/// 1ファイルあたりのアップロード上限。送信の合計上限と同じ 25MB。
const MAX_UPLOAD_BYTES: usize = 25 * 1024 * 1024;

pub struct ServeOptions {
    pub host: IpAddr,
    pub port: u16,
    /// 未指定なら起動時に生成する。
    pub token: Option<String>,
    /// `/` でも1ファイル完結の画面を返す(サンドボックス枠に入れるとき)。
    pub single_file: bool,
    /// false なら合言葉を求めない。ループバック限定の閉じた機械でだけ使う。
    pub require_token: bool,
}

struct Ctx {
    db: Arc<DbState>,
    registry: Arc<CharacterModRegistry>,
    /// Tauri が埋め込んだ画面一式(キー → 展開済みのバイト列)。
    assets: HashMap<String, Vec<u8>>,
    token: String,
    /// 埋め込み HTML に残る CSP nonce プレースホルダの差し替え先。
    nonce: String,
    mods_root: PathBuf,
    builtin_mods_root: Option<PathBuf>,
    /// 添付のアップロードを置く一時フォルダー。
    upload_dir: PathBuf,
    /// `/` でも1ファイル完結の画面を返すか。
    single_file: bool,
    /// 合言葉を求めるか。
    require_token: bool,
    /// 1ファイル完結の画面。初回に組み立てて使い回す(数MBあるため)。
    /// 設定の埋め込み位置で前半・後半に割ってある。
    standalone: OnceLock<Arc<(String, String)>>,
    /// SSE が使えない枠のための、直近イベントの控え。
    recent: Mutex<RecentEvents>,
}

/// `__events_poll` が返す、直近に起きたことの控え。
#[derive(Default)]
struct RecentEvents {
    next: u64,
    items: VecDeque<(u64, String, Value)>,
}

/// 控えておく件数。取りこぼしても演出が1回抜けるだけ。
const RECENT_LIMIT: usize = 64;

type Shared = Arc<Ctx>;

// ---------------------------------------------------------------------------
// 起動
// ---------------------------------------------------------------------------

/// Tauri を立ち上げずに、同じ画面と同じ処理を HTTP で出す。
pub fn run(context: tauri::Context<Wry>, options: ServeOptions) -> Result<(), String> {
    let runtime = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
    runtime.block_on(serve(context, options))
}

async fn serve(context: tauri::Context<Wry>, options: ServeOptions) -> Result<(), String> {
    let db_path = std::env::var("MIOMAIL_DB")
        .map(PathBuf::from)
        .ok()
        .or_else(db::default_db_path)
        .ok_or("MioMail のデータベースの場所を特定できませんでした(MIOMAIL_DB で指定できます)")?;

    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    let conn = db::open_connection(&db_path)
        .map_err(|e| format!("データベースを開けませんでした: {e}"))?;
    let db = Arc::new(DbState::new(conn));

    // 画面一式を展開して持つ。埋め込みは brotli 圧縮なので、キーを辿って get する。
    //
    // 注意: `generate_context!` が画面を埋め込むのは `tauri/custom-protocol` が
    // 有効なときだけ(tauri-codegen が `dev: cfg!(not(feature = "custom-protocol"))`
    // で判定している)。`tauri build` は付けるが、素の `cargo build` は付けない。
    // 空のまま起動すると「真っ白な画面が出るだけ」になるので、ここで止める。
    let assets = {
        let assets = context.assets();
        let keys: Vec<String> = assets.iter().map(|(key, _)| key.to_string()).collect();
        let mut map = HashMap::with_capacity(keys.len());
        for key in keys {
            if let Some(bytes) = assets.get(&key.as_str().into()) {
                map.insert(key, bytes.to_vec());
            }
        }
        map
    };
    if assets.is_empty() {
        return Err(
            "画面のファイルがこの実行ファイルに入っていません。\
             `npm run tauri build`(または cargo build --features tauri/custom-protocol)で\
             ビルドしたものを使ってください。"
                .to_string(),
        );
    }

    // キャラクターMOD: 同梱分はリソースフォルダー、追加分はローカルデータフォルダー。
    // どちらもデスクトップ版と同じ場所を指す。
    let builtin_mods_root =
        tauri::utils::platform::resource_dir(context.package_info(), &tauri::Env::default())
            .ok()
            .map(|dir| dir.join("mods"))
            .filter(|dir| dir.is_dir());
    let mods_root = db::default_local_data_dir()
        .map(|dir| character_mod::mods_root_in(&dir))
        .ok_or("MODフォルダーの場所を特定できませんでした")?;

    let upload_dir = std::env::temp_dir().join("miomail-web-uploads");
    std::fs::create_dir_all(&upload_dir).ok();

    let token = options.token.unwrap_or_else(random_token);
    let asset_count = assets.len();
    let ctx: Shared = Arc::new(Ctx {
        db: db.clone(),
        registry: Arc::new(CharacterModRegistry::default()),
        assets,
        token: token.clone(),
        nonce: random_token(),
        mods_root,
        builtin_mods_root,
        upload_dir,
        single_file: options.single_file,
        require_token: options.require_token,
        standalone: OnceLock::new(),
        recent: Mutex::new(RecentEvents::default()),
    });

    // デスクトップ版の setup と同じ常駐処理。AppHandle が無いので None を渡す。
    spawn_background_sync(db.clone());
    spawn_app_event_bridge(db.clone());
    spawn_event_recorder(ctx.clone());

    // 1ファイル完結の画面はここで組み立てておく(壊れていれば起動時に分かる)。
    let standalone_kb = standalone_html(&ctx).len() / 1024;

    let app = Router::new()
        .route(BRIDGE_MARKER_PATH, get(bridge_marker_handler))
        .route("/__miomail/invoke", post(invoke_handler))
        .route("/__miomail/events", get(events_handler))
        .route("/__miomail/upload", post(upload_handler))
        .route("/__miomail/mod-asset", get(mod_asset_handler))
        .route("/__miomail/attachment/{id}", get(attachment_handler))
        .fallback(get(static_handler))
        // 添付のアップロードは最大25MB(送信の上限と同じ)。axum の既定は 2MB なので上げる。
        .layer(axum::extract::DefaultBodyLimit::max(MAX_UPLOAD_BYTES + 1024 * 1024))
        .with_state(ctx);

    let addr = SocketAddr::new(options.host, options.port);
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|e| format!("{addr} で待ち受けられませんでした: {e}"))?;
    let bound = listener.local_addr().map(|a| a.port()).unwrap_or(options.port);

    let shown_host = if options.host.is_loopback() {
        "localhost".to_string()
    } else {
        options.host.to_string()
    };
    println!("MioMail をブラウザーで開けます:");
    if options.require_token {
        println!("  http://{shown_host}:{bound}/?t={token}");
    } else {
        println!("  http://{shown_host}:{bound}/");
    }
    println!("  http://{shown_host}:{bound}{STANDALONE_PATH}  (1ファイル完結。枠に埋め込むとき)");
    println!();
    println!("データベース: {}", db_path.display());
    println!("画面: {asset_count} ファイル");
    println!("1ファイル完結の画面: {standalone_kb} KB");
    if options.single_file {
        println!("`/` も1ファイル完結の画面を返します(--single-file)");
    }
    if !options.require_token {
        println!("合言葉は求めません(--no-token)。この機械の中の誰でもメールを読めます。");
    }
    if !options.host.is_loopback() {
        println!(
            "警告: {} で待ち受けています。この機械に届く相手は、URL のトークンが分かればメールを読めます。",
            options.host
        );
    }

    axum::serve(listener, app)
        .await
        .map_err(|e| format!("サーバーが停止しました: {e}"))
}

fn random_token() -> String {
    // 乱数源は OS。鍵交換ではなくローカルの合言葉なので 128bit で足りる。
    let mut bytes = [0u8; 16];
    getrandom_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn getrandom_bytes(out: &mut [u8]) {
    use chacha20poly1305::aead::rand_core::RngCore;
    chacha20poly1305::aead::OsRng.fill_bytes(out);
}

/// デスクトップ版の `start_background_sync` と同じ 60 秒ごとの取り込み。
fn spawn_background_sync(db: Arc<DbState>) {
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(60)).await;
            if let Err(error) = mail_core::sync_all_accounts(None, &db).await {
                log::error!("background polling failed: {error}");
            }
        }
    });
}

/// SSE を張れない枠(サンドボックスされた iframe など)のために、
/// 起きたことに番号を振って控えておく。`__events_poll` が差分を返す。
fn spawn_event_recorder(ctx: Shared) {
    tokio::spawn(async move {
        let mut receiver = events::subscribe();
        loop {
            match receiver.recv().await {
                Ok(app_event) => {
                    if let Ok(mut recent) = ctx.recent.lock() {
                        recent.next += 1;
                        let seq = recent.next;
                        recent.items.push_back((seq, app_event.name, app_event.payload));
                        while recent.items.len() > RECENT_LIMIT {
                            recent.items.pop_front();
                        }
                    }
                }
                // 取りこぼしは演出が1回抜けるだけなので読み飛ばす
                Err(RecvError::Lagged(_)) => continue,
                Err(RecvError::Closed) => return,
            }
        }
    });
}

/// MCP サーバー(別プロセス)が積んだイベントを拾ってイベントバスへ流す。
fn spawn_app_event_bridge(db: Arc<DbState>) {
    tokio::spawn(async move {
        mail_core::discard_pending_app_events(&db);
        loop {
            tokio::time::sleep(Duration::from_secs(2)).await;
            mail_core::drain_app_events(&db);
        }
    });
}

// ---------------------------------------------------------------------------
// 認証(ローカルの合言葉)
// ---------------------------------------------------------------------------

fn cookie_token(headers: &HeaderMap) -> Option<String> {
    let raw = headers.get(header::COOKIE)?.to_str().ok()?;
    raw.split(';')
        .filter_map(|part| part.trim().split_once('='))
        .find(|(name, _)| *name == COOKIE_NAME)
        .map(|(_, value)| value.to_string())
}

/// クッキーかヘッダーでトークンが合っていること。
fn authorized(ctx: &Ctx, headers: &HeaderMap) -> bool {
    if !ctx.require_token {
        return true;
    }
    let from_header = headers
        .get("x-miomail-token")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    matches!(cookie_token(headers).or(from_header), Some(t) if constant_time_eq(&t, &ctx.token))
}

fn constant_time_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// 別サイトからの誘導を弾く。同一オリジン以外の Origin が付いていたら拒否する。
/// (後方一致だと `http://notlocalhost:7272` のような名前を通してしまうので、
///  オリジン全体を組み立てて突き合わせる。)
fn origin_ok(headers: &HeaderMap) -> bool {
    let Some(origin) = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok()) else {
        return true;
    };
    let Some(host) = headers.get(header::HOST).and_then(|v| v.to_str().ok()) else {
        return false;
    };
    origin == format!("http://{host}") || origin == format!("https://{host}")
}

fn unauthorized() -> Response {
    (
        StatusCode::UNAUTHORIZED,
        [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
        "<!doctype html><meta charset=\"utf-8\"><title>MioMail</title>\
         <body style=\"font-family:sans-serif;padding:2rem;line-height:1.8\">\
         <h1>MioMail</h1><p>この URL を開く権限がありません。</p>\
         <p><code>miomail --serve</code> を実行した端末に表示された、\
         <code>?t=…</code> 付きの URL を開いてください。</p></body>",
    )
        .into_response()
}

// ---------------------------------------------------------------------------
// 画面(埋め込みアセット)
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct TokenQuery {
    t: Option<String>,
}

#[derive(Deserialize)]
struct AttachmentQuery {
    /// 1 のときは「開く」。ブラウザーのタブで表示させる。
    inline: Option<String>,
}

async fn static_handler(
    State(ctx): State<Shared>,
    Query(query): Query<TokenQuery>,
    request: Request,
) -> Response {
    let headers = request.headers();

    // URL にトークンが付いていれば、クッキーへ移して以後は URL から消す。
    let fresh_token = query
        .t
        .as_deref()
        .filter(|t| constant_time_eq(t, &ctx.token))
        .is_some();

    if !fresh_token && !authorized(&ctx, headers) {
        return unauthorized();
    }

    let path = request.uri().path();

    // サンドボックスされた枠へ入れるときは、外部ファイルを参照しない1枚の HTML。
    if path == STANDALONE_PATH || (ctx.single_file && (path == "/" || path == "/index.html")) {
        let body = standalone_html(&ctx);
        let mut response = Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
            .header(header::CACHE_CONTROL, "no-store");
        if fresh_token {
            response = response.header(
                header::SET_COOKIE,
                format!(
                    "{COOKIE_NAME}={}; Path=/; HttpOnly; SameSite=Strict",
                    ctx.token
                ),
            );
        }
        return response
            .body(body.into())
            .unwrap_or_else(|_| {
                (StatusCode::INTERNAL_SERVER_ERROR, "response build failed").into_response()
            });
    }

    let key = if path == "/" { "/index.html" } else { path };

    // SPA なので、知らないパスは index.html を返す(拡張子付きだけ 404)。
    let (key, body) = match ctx.assets.get(key) {
        Some(bytes) => (key.to_string(), bytes.clone()),
        None if !std::path::Path::new(key)
            .extension()
            .is_some_and(|e| !e.is_empty()) =>
        {
            match ctx.assets.get("/index.html") {
                Some(bytes) => ("/index.html".to_string(), bytes.clone()),
                None => return (StatusCode::NOT_FOUND, "not found").into_response(),
            }
        }
        None => {
            return (
                StatusCode::NOT_FOUND,
                format!(
                    "{key} が見つかりません(埋め込まれている画面のファイル: {}件)",
                    ctx.assets.len()
                ),
            )
                .into_response()
        }
    };

    let is_html = key.ends_with(".html");
    let body = if is_html {
        prepare_html(&ctx, &body)
    } else {
        body
    };

    let mut response = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type_for(&key));

    if is_html {
        // 画面そのものはキャッシュさせない(注入するスクリプトが変わるため)
        response = response.header(header::CACHE_CONTROL, "no-store");
    } else {
        response = response.header(header::CACHE_CONTROL, "public, max-age=31536000, immutable");
    }

    if fresh_token {
        response = response.header(
            header::SET_COOKIE,
            format!(
                "{COOKIE_NAME}={}; Path=/; HttpOnly; SameSite=Strict",
                ctx.token
            ),
        );
    }

    response.body(body.into()).unwrap_or_else(|_| {
        (StatusCode::INTERNAL_SERVER_ERROR, "response build failed").into_response()
    })
}

/// 画面に「ここは Web ブリッジだ」と教えるための目印。
/// index.html には `script-src 'self'` の CSP が入っているので、インラインでは
/// 弾かれる。同一オリジンの外部スクリプトとして読ませる。
/// クラシックスクリプト(module ではない)なので、アプリ本体より先に走る。
const BRIDGE_MARKER_PATH: &str = "/__miomail/bridge.js";
const BRIDGE_MARKER_JS: &str = "window.__MIOMAIL_BRIDGE__ = { version: 1 };\n";

/// 埋め込み HTML に残る CSP nonce プレースホルダを埋め、目印を先頭に差し込む。
fn prepare_html(ctx: &Ctx, bytes: &[u8]) -> Vec<u8> {
    let html = String::from_utf8_lossy(bytes)
        .replace(tauri::utils::assets::SCRIPT_NONCE_TOKEN, &ctx.nonce)
        .replace(tauri::utils::assets::STYLE_NONCE_TOKEN, &ctx.nonce);

    let marker = format!("<script src=\"{BRIDGE_MARKER_PATH}\"></script>");
    insert_after_head(&html, &marker).into_bytes()
}

fn insert_after_head(html: &str, snippet: &str) -> String {
    match html.find("<head>") {
        Some(index) => {
            let cut = index + "<head>".len();
            let mut out = String::with_capacity(html.len() + snippet.len());
            out.push_str(&html[..cut]);
            out.push_str(snippet);
            out.push_str(&html[cut..]);
            out
        }
        None => format!("{snippet}{html}"),
    }
}

fn insert_before_body_end(html: &str, snippet: &str) -> String {
    match html.rfind("</body>") {
        Some(index) => {
            let mut out = String::with_capacity(html.len() + snippet.len());
            out.push_str(&html[..index]);
            out.push_str(snippet);
            out.push_str(&html[index..]);
            out
        }
        None => format!("{html}{snippet}"),
    }
}

// ---------------------------------------------------------------------------
// 1ファイル完結の画面
// ---------------------------------------------------------------------------
//
// Muse のスペースのように、blob: で読み込まれて自分のオリジンを持たない枠へ
// 入れるための形。そういう枠からは `./assets/...` を取りに行けないので、
// JS も CSS も画像も、この HTML 1枚に入れてしまう。
// 画面そのものはデスクトップ版と同じものを使う(作り直さない)。

const STANDALONE_PATH: &str = "/__miomail/standalone.html";

/// 枠の中では localStorage が使えないので、前回の設定をここへ埋めて渡す。
/// 画面はこれを同期的に読んで、テーマやキャラクターの選択を復元する。
const SETTINGS_PLACEHOLDER: &str = "__MIOMAIL_WEB_SETTINGS__";

// --- 親の CSP に止められても起動できる形 ---
//
// 枠の中の文書は、`srcdoc` でも `blob:` でも、親と同じオリジンの URL でも、
// 親ページの Content-Security-Policy を引き継ぐ。引き継いだ分とこの1枚自身の
// 分の両方が効くので、親が `strict-dynamic` と自分の nonce を使っていると、
// この1枚に入っているスクリプトは nonce が合わず1行も実行されない。
// nonce は毎回変わるので、こちらから合わせに行くこともできない。
//
// そこで画面の本体は「ブラウザーが実行しない型」の札に入れて運ぶ。
// 普段は下の起動役(nonce 付き)が札から取り出して走らせるので、何も変わらない。
// 起動役ごと止められる枠の中では、親に同じことをしてもらう。`strict-dynamic` は
// 「信用されたスクリプトが後から差し込んだスクリプト」を通す決まりなので、
// 親の手で差し込めば、こちらが親の nonce を知らなくても動く。
// 親にしてほしいことは、起動しなかったときの案内(index.html)に書いてある。
const EMBED_CODE_TYPE: &str = "application/miomail-module";

/// 札に入れた画面の本体を取り出して走らせる役。
fn boot_script(nonce: &str) -> String {
    let js = format!(
        "(function(){{\
         var d=document;\
         function go(){{\
         if(window.__MIOMAIL_STARTED__)return;\
         window.__MIOMAIL_STARTED__=1;\
         var l=d.querySelectorAll('script[type=\"{t}\"]');\
         for(var i=0;i<l.length;i++){{\
         var s=d.createElement('script');\
         s.type='module';\
         s.nonce='{n}';\
         s.textContent=l[i].textContent;\
         d.head.appendChild(s);\
         }}\
         }}\
         if(d.readyState==='loading')d.addEventListener('DOMContentLoaded',go);\
         else go();\
         }})();",
        t = EMBED_CODE_TYPE,
        n = nonce
    );
    format!("<script nonce=\"{nonce}\">{js}</script>")
}

fn standalone_html(ctx: &Ctx) -> Vec<u8> {
    let parts = ctx
        .standalone
        .get_or_init(|| Arc::new(build_standalone_html(ctx)));
    let settings = serde_json::to_string(&web_settings_all(ctx.db.as_ref()).unwrap_or_default())
        .unwrap_or_else(|_| "{}".to_string());
    let mut out = String::with_capacity(parts.0.len() + settings.len() + parts.1.len());
    out.push_str(&parts.0);
    out.push_str(&settings);
    out.push_str(&parts.1);
    out.into_bytes()
}

fn build_standalone_html(ctx: &Ctx) -> (String, String) {
    let Some(raw) = ctx.assets.get("/index.html") else {
        return ("<!doctype html><meta charset=\"utf-8\">".to_string(), String::new());
    };
    let html = String::from_utf8_lossy(raw)
        .replace(tauri::utils::assets::SCRIPT_NONCE_TOKEN, &ctx.nonce)
        .replace(tauri::utils::assets::STYLE_NONCE_TOKEN, &ctx.nonce);
    let html = replace_csp(&html, &ctx.nonce);
    let html = inline_scripts(ctx, &html);
    let html = inline_styles(ctx, &html);
    let marker = format!(
        "<script nonce=\"{}\">window.__MIOMAIL_BRIDGE__=\
         {{version:1,standalone:true,settings:{SETTINGS_PLACEHOLDER}}};</script>",
        ctx.nonce
    );
    let html = insert_after_head(&html, &marker);
    let html = insert_before_body_end(&html, &boot_script(&ctx.nonce));
    match html.split_once(SETTINGS_PLACEHOLDER) {
        Some((head, tail)) => (head.to_string(), tail.to_string()),
        None => (html, String::new()),
    }
}

// --- 画面の設定の預かり ------------------------------------------------------
//
// ふつうのブラウザーは localStorage に覚える。自分のオリジンを持たない枠では
// それに触れるだけで例外になるので、代わりにここ(データベース)へ預かる。
// 置き場所は既存の小さな KVS。他と混ざらないよう `web.` を付ける。

const WEB_SETTING_PREFIX: &str = "web.";
/// 1つの設定の上限。書きかけのメールも入るので少し大きめ。
const MAX_SETTING_BYTES: usize = 256 * 1024;

fn web_settings_all(db: &DbState) -> Result<serde_json::Map<String, Value>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut statement = conn
        .prepare("SELECT key, value FROM app_settings WHERE key LIKE 'web.%'")
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;

    let mut out = serde_json::Map::new();
    for (key, value) in rows.flatten() {
        if let Some(name) = key.strip_prefix(WEB_SETTING_PREFIX) {
            out.insert(name.to_string(), Value::String(value));
        }
    }
    Ok(out)
}

fn web_settings_set(db: &DbState, key: &str, value: Option<&str>) -> Result<(), String> {
    if let Some(value) = value {
        if value.len() > MAX_SETTING_BYTES {
            return Err("設定が大きすぎます".to_string());
        }
    }
    let full = format!("{WEB_SETTING_PREFIX}{key}");
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    match value {
        Some(value) => conn.execute(
            "INSERT INTO app_settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            rusqlite::params![full, value],
        ),
        None => conn.execute("DELETE FROM app_settings WHERE key = ?1", [full]),
    }
    .map(|_| ())
    .map_err(|e| e.to_string())
}

/// 枠の中では自分のオリジンが無く `'self'` が何にも当たらないので、
/// 「この1枚に入っているもの」だけを許す形に書き換える。
fn replace_csp(html: &str, nonce: &str) -> String {
    let Some(marker) = html.find("http-equiv=\"Content-Security-Policy\"") else {
        return html.to_string();
    };
    let Some(start) = html[..marker].rfind("<meta") else {
        return html.to_string();
    };
    let Some(end) = html[marker..].find('>').map(|i| marker + i + 1) else {
        return html.to_string();
    };
    let policy = format!(
        "default-src 'self'; script-src 'nonce-{nonce}' 'strict-dynamic' 'self'; \
         style-src 'unsafe-inline' 'self'; font-src 'self' data:; \
         img-src 'self' data: blob: https: http:; media-src 'self' data: blob:; \
         connect-src 'self' data: blob:; frame-src blob:; worker-src blob:;"
    );
    format!(
        "{}<meta http-equiv=\"Content-Security-Policy\" content=\"{policy}\" />{}",
        &html[..start],
        &html[end..]
    )
}

/// `<script src=...>` を中身ごと埋め込む。
fn inline_scripts(ctx: &Ctx, html: &str) -> String {
    let mut out = String::with_capacity(html.len() * 2);
    let mut rest = html;
    while let Some(start) = rest.find("<script") {
        let Some(tag_end) = rest[start..].find('>').map(|i| start + i + 1) else {
            break;
        };
        let Some(src) = attr_value(&rest[start..tag_end], "src") else {
            out.push_str(&rest[..tag_end]);
            rest = &rest[tag_end..];
            continue;
        };
        let Some(close) = rest[tag_end..]
            .find("</script>")
            .map(|i| tag_end + i + "</script>".len())
        else {
            break;
        };
        match ctx.assets.get(&asset_key(&src)) {
            Some(bytes) => {
                let code = inline_asset_urls(ctx, &String::from_utf8_lossy(bytes));
                out.push_str(&rest[..start]);
                out.push_str("<script type=\"");
                out.push_str(EMBED_CODE_TYPE);
                out.push_str("\">\n");
                // 文字列リテラルの中にしか現れ得ないが、現れたら HTML が切れるので逃がす
                out.push_str(&code.replace("</script", "<\\/script"));
                out.push_str("\n</script>");
            }
            None => out.push_str(&rest[..close]),
        }
        rest = &rest[close..];
    }
    out.push_str(rest);
    out
}

/// `<link rel="stylesheet" href=...>` を中身ごと埋め込む。
fn inline_styles(ctx: &Ctx, html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut rest = html;
    while let Some(start) = rest.find("<link") {
        let Some(tag_end) = rest[start..].find('>').map(|i| start + i + 1) else {
            break;
        };
        let tag = &rest[start..tag_end];
        let sheet = tag.contains("rel=\"stylesheet\"");
        let loaded = attr_value(tag, "href").and_then(|href| ctx.assets.get(&asset_key(&href)));
        match (sheet, loaded) {
            (true, Some(bytes)) => {
                let css = inline_css_urls(ctx, &String::from_utf8_lossy(bytes));
                out.push_str(&rest[..start]);
                out.push_str("<style>\n");
                out.push_str(&css.replace("</style", "\\3C /style"));
                out.push_str("\n</style>");
            }
            _ => out.push_str(&rest[..tag_end]),
        }
        rest = &rest[tag_end..];
    }
    out.push_str(rest);
    out
}

/// Vite が吐く `new URL("名前",import.meta.url)` を data: に差し替える。
/// 枠の中では `import.meta.url` が blob: になって解決できないため。
fn inline_asset_urls(ctx: &Ctx, code: &str) -> String {
    const HEAD: &str = "new URL(\"";
    const TAIL: &str = "\",import.meta.url)";

    let mut out = String::with_capacity(code.len());
    let mut rest = code;
    while let Some(start) = rest.find(HEAD) {
        let after = start + HEAD.len();
        let Some(quote) = rest[after..].find('"').map(|i| after + i) else {
            break;
        };
        if !rest[quote..].starts_with(TAIL) {
            out.push_str(&rest[..after]);
            rest = &rest[after..];
            continue;
        }
        let name = rest[after..quote].to_string();
        let end = quote + TAIL.len();
        match ctx.assets.get(&asset_key_beside_bundle(&name)) {
            Some(bytes) => {
                out.push_str(&rest[..start]);
                out.push_str("new URL(\"");
                out.push_str(&data_uri(&name, bytes));
                out.push_str("\")");
            }
            None => out.push_str(&rest[..end]),
        }
        rest = &rest[end..];
    }
    out.push_str(rest);
    out
}

/// CSS の `url(...)` を data: に差し替える。
fn inline_css_urls(ctx: &Ctx, css: &str) -> String {
    let mut out = String::with_capacity(css.len());
    let mut rest = css;
    while let Some(start) = rest.find("url(") {
        let open = start + "url(".len();
        let Some(close) = rest[open..].find(')').map(|i| open + i) else {
            break;
        };
        let raw = rest[open..close].trim().trim_matches(|c| c == '"' || c == '\'');
        let replaced = if raw.starts_with("data:") || raw.contains("://") {
            None
        } else {
            ctx.assets
                .get(&asset_key_beside_bundle(raw))
                .map(|bytes| data_uri(raw, bytes))
        };
        match replaced {
            Some(uri) => {
                out.push_str(&rest[..start]);
                out.push_str("url(\"");
                out.push_str(&uri);
                out.push_str("\")");
            }
            None => out.push_str(&rest[..close + 1]),
        }
        rest = &rest[close + 1..];
    }
    out.push_str(rest);
    out
}

/// タグの中の `名前="値"` を取り出す。前に空白を要求して `data-src` 等と区別する。
fn attr_value(tag: &str, name: &str) -> Option<String> {
    let needle = format!(" {name}=\"");
    let at = tag.find(&needle)? + needle.len();
    let end = tag[at..].find('"')? + at;
    Some(tag[at..end].to_string())
}

/// index.html から見た参照(`./assets/x`)を埋め込みアセットのキーにする。
fn asset_key(src: &str) -> String {
    let trimmed = src.trim_start_matches("./");
    if trimmed.starts_with('/') {
        trimmed.to_string()
    } else {
        format!("/{trimmed}")
    }
}

/// JS / CSS から見た参照(同じ `assets` フォルダーの中)をキーにする。
fn asset_key_beside_bundle(name: &str) -> String {
    let trimmed = name.trim_start_matches("./");
    if trimmed.starts_with('/') {
        trimmed.to_string()
    } else {
        format!("/assets/{trimmed}")
    }
}

fn data_uri(name: &str, bytes: &[u8]) -> String {
    let mime = content_type_for(name)
        .split(';')
        .next()
        .unwrap_or("application/octet-stream");
    format!("data:{mime};base64,{}", BASE64.encode(bytes))
}

async fn bridge_marker_handler(State(ctx): State<Shared>, headers: HeaderMap) -> Response {
    if !authorized(&ctx, &headers) {
        return unauthorized();
    }
    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "text/javascript; charset=utf-8"),
            (header::CACHE_CONTROL, "no-store"),
        ],
        BRIDGE_MARKER_JS,
    )
        .into_response()
}

fn content_type_for(path: &str) -> &'static str {
    let ext = path.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "glb" => "model/gltf-binary",
        "wasm" => "application/wasm",
        "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

// ---------------------------------------------------------------------------
// invoke(レンダラーのコマンド呼び出し)
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct InvokeBody {
    cmd: String,
    #[serde(default)]
    args: Value,
}

async fn invoke_handler(
    State(ctx): State<Shared>,
    headers: HeaderMap,
    Json(body): Json<InvokeBody>,
) -> Response {
    if !origin_ok(&headers) || !authorized(&ctx, &headers) {
        return unauthorized();
    }

    match dispatch(&ctx, &body.cmd, body.args).await {
        Ok(value) => Json(json!({ "ok": true, "data": value })).into_response(),
        Err(message) => Json(json!({ "ok": false, "error": message })).into_response(),
    }
}

/// 引数の取り出し。レンダラーは camelCase で送ってくる(Tauri と同じ)ので、
/// snake_case も一応見る。
fn arg<'a>(args: &'a Value, camel: &str, snake: &str) -> Option<&'a Value> {
    args.get(camel).or_else(|| args.get(snake))
}

fn need_i64(args: &Value, camel: &str, snake: &str) -> Result<i64, String> {
    arg(args, camel, snake)
        .and_then(Value::as_i64)
        .ok_or_else(|| format!("引数 {camel} が必要です"))
}

fn need_str(args: &Value, camel: &str, snake: &str) -> Result<String, String> {
    arg(args, camel, snake)
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| format!("引数 {camel} が必要です"))
}

fn need_typed<T: serde::de::DeserializeOwned>(
    args: &Value,
    camel: &str,
    snake: &str,
) -> Result<T, String> {
    let raw = arg(args, camel, snake).ok_or_else(|| format!("引数 {camel} が必要です"))?;
    serde_json::from_value(raw.clone()).map_err(|e| format!("引数 {camel} が不正です: {e}"))
}

fn ok<T: serde::Serialize>(value: T) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|e| e.to_string())
}

/// デスクトップ版の invoke_handler に対応する振り分け。
/// 画面が呼ぶコマンドはすべてここで受ける。
async fn dispatch(ctx: &Ctx, cmd: &str, args: Value) -> Result<Value, String> {
    let db = ctx.db.as_ref();

    match cmd {
        // --- アカウント ---
        "account_list" => ok(account::account_list_core(db)?),
        "account_create" => ok(account::account_create_core(
            db,
            need_typed(&args, "data", "data")?,
        )?),
        "account_update" => {
            account::account_update_core(
                db,
                need_i64(&args, "id", "id")?,
                need_typed(&args, "data", "data")?,
            )?;
            Ok(Value::Null)
        }
        "account_test" => account::account_test(need_typed(&args, "data", "data")?).await,
        "account_delete" => {
            account::account_delete_core(db, need_i64(&args, "id", "id")?)?;
            Ok(Value::Null)
        }

        // --- フォルダ ---
        "mail_sync_folders" => ok(mail_core::sync_folders_for_account(
            need_i64(&args, "accountId", "account_id")?,
            db,
        )
        .await?),
        "mail_list_folders" => ok(mail_core::list_folders_core(
            db,
            need_i64(&args, "accountId", "account_id")?,
        )?),
        "mail_create_folder" => ok(mail_core::create_folder_core(
            db,
            need_i64(&args, "accountId", "account_id")?,
            need_str(&args, "name", "name")?,
            arg(&args, "parentId", "parent_id").and_then(Value::as_i64),
        )
        .await?),
        "mail_rename_folder" => ok(mail_core::rename_folder_core(
            db,
            need_i64(&args, "folderId", "folder_id")?,
            need_str(&args, "newName", "new_name")?,
        )
        .await?),
        "mail_delete_folder" => ok(mail_core::delete_folder_core(
            db,
            need_i64(&args, "folderId", "folder_id")?,
        )
        .await?),

        // --- メール ---
        "mail_sync_messages" => {
            mail_core::sync_messages_for_folder(
                None,
                need_i64(&args, "accountId", "account_id")?,
                need_i64(&args, "folderId", "folder_id")?,
                db,
            )
            .await?;
            Ok(Value::Null)
        }
        "mail_get_messages" => ok(mail_core::get_messages_core(
            db,
            need_i64(&args, "folderId", "folder_id")?,
            need_i64(&args, "offset", "offset")?,
            need_i64(&args, "limit", "limit")?,
        )?),
        "mail_get_message" => ok(mail_core::get_message_core(
            db,
            need_i64(&args, "messageId", "message_id")?,
            true,
        )
        .await?),
        "mail_mark_read" => {
            mail_core::mark_read_core(
                db,
                need_i64(&args, "messageId", "message_id")?,
                arg(&args, "read", "read")
                    .and_then(Value::as_bool)
                    .unwrap_or(true),
            )
            .await?;
            Ok(Value::Null)
        }
        "mail_delete" => {
            mail_core::delete_core(db, need_i64(&args, "messageId", "message_id")?).await?;
            Ok(Value::Null)
        }
        "mail_search" => {
            let account_id = need_i64(&args, "accountId", "account_id")?;
            let query = need_str(&args, "query", "query")?;
            let conn = db.conn.lock().map_err(|e| e.to_string())?;
            ok(mail_core::search_messages(&conn, account_id, &query, 50)?)
        }
        "compose_send" => {
            mail_core::compose_send_core(db, need_typed(&args, "data", "data")?).await?;
            Ok(Value::Null)
        }

        // --- 進捗・環境 ---
        "mail_job_progress" => {
            let account_id = need_i64(&args, "accountId", "account_id")?;
            let conn = db.conn.lock().map_err(|e| e.to_string())?;
            ok(crate::vectorize::job_progress_list(&conn, account_id))
        }
        "mail_semantic_status" => {
            let status = {
                let conn = db.conn.lock().map_err(|e| e.to_string())?;
                crate::embed::semantic_status(&conn)
            };
            let mut value = serde_json::to_value(status).map_err(|e| e.to_string())?;
            value["supported"] = Value::Bool(false);
            Ok(value)
        }
        "mail_system_info" => {
            let mut value =
                serde_json::to_value(system::system_info_core(db)?).map_err(|e| e.to_string())?;
            // ブラウザー越しではローカル推論を動かさない。画面にも誘いを出さない。
            value["semantic"]["supported"] = Value::Bool(false);
            Ok(value)
        }
        "app_get_build_info" => ok(build::app_get_build_info()),

        // --- セマンティック検索: ローカル推論は Web ブリッジでは動かさない ---
        "mail_semantic_search" | "mail_semantic_enable" => Err(
            "意味での検索は Windows 版の MioMail でのみ使えます。言葉での検索をお使いください。"
                .to_string(),
        ),

        // --- New Outlook からの取り込み(Windows の COM 前提) ---
        "import_outlook_folders" | "import_outlook_messages" | "import_outlook_body"
        | "import_save" => {
            Err("New Outlook からの取り込みは Windows 版の MioMail でのみ使えます。".to_string())
        }

        // --- ウィンドウ操作: ブラウザーには窓枠が無いので何もしない ---
        "app_minimize" | "app_maximize" | "app_close" | "app_show_main_window" | "app_quit" => {
            Ok(Value::Null)
        }
        "app_is_maximized" => Ok(Value::Bool(false)),

        // --- 自動更新: ブラウザー越しに自分を置き換えることはできない ---
        // 「最新です」とは答えない(本当に最新かは分からないため)。
        // UpdateBanner はエラーを黙って捨てるので、誘いが出ることもない。
        "update_check" | "update_install" => Err(
            "ブラウザーからは MioMail を更新できません。新しい MioMail を入れ直してください。"
                .to_string(),
        ),

        // --- 自分のオリジンを持たない枠(Muse のスペースなど)のための、
        //     invoke 1本だけで完結する経路。別の URL を取りに行けないので、
        //     イベントも添付も MOD の asset も、ここで JSON にして渡す。 ---
        "__events_poll" => {
            let since = arg(&args, "since", "since")
                .and_then(Value::as_u64)
                .unwrap_or(0);
            let recent = ctx.recent.lock().map_err(|e| e.to_string())?;
            let list: Vec<Value> = recent
                .items
                .iter()
                .filter(|(seq, _, _)| *seq > since)
                .map(|(seq, name, payload)| json!({ "seq": seq, "name": name, "payload": payload }))
                .collect();
            Ok(json!({ "next": recent.next, "events": list }))
        }
        "__upload" => {
            let name = sanitize_upload_name(&need_str(&args, "name", "name")?);
            let encoded = need_str(&args, "base64", "base64")?;
            let bytes = BASE64
                .decode(encoded.as_bytes())
                .map_err(|_| "ファイルを読み取れませんでした".to_string())?;
            if bytes.len() > MAX_UPLOAD_BYTES {
                return Err("ファイルが大きすぎます(25MBまで)".to_string());
            }
            let path = ctx.upload_dir.join(format!("{}-{}", random_token(), name));
            std::fs::write(&path, &bytes)
                .map_err(|e| format!("一時ファイルを作れませんでした: {e}"))?;
            Ok(json!({ "path": path.to_string_lossy(), "name": name, "size": bytes.len() }))
        }
        "__settings_set" => {
            let key = need_str(&args, "key", "key")?;
            let value = arg(&args, "value", "value")
                .filter(|value| !value.is_null())
                .and_then(Value::as_str);
            web_settings_set(db, &key, value)?;
            Ok(Value::Null)
        }
        "__attachment_bytes" => {
            let id = need_i64(&args, "attachmentId", "attachment_id")?;
            let (filename, mime, data) = attachment_bytes(db, id)?;
            Ok(json!({
                "filename": filename,
                "mime": mime,
                "base64": BASE64.encode(&data),
            }))
        }

        // --- キャラクターMOD ---
        // asset は数MBになることがある。ふつうは GET /__miomail/mod-asset で
        // 生のまま取るが、枠の中からはそれができないので base64 でも返せるようにする。
        "character_mod_read_asset" => {
            let bytes = character_mod::read_mod_asset(
                &ctx.registry,
                need_str(&args, "modId", "mod_id")?,
                need_str(&args, "revision", "revision")?,
                need_str(&args, "assetKey", "asset_key")?,
            )
            .await?;
            Ok(json!({ "base64": BASE64.encode(&bytes) }))
        }
        "character_mod_list" => ok(character_mod::scan_mods(
            ctx.builtin_mods_root.clone(),
            ctx.mods_root.clone(),
            &ctx.registry,
        )
        .await?),
        "character_mod_install_archive" => {
            // レンダラーがアップロードした一時ファイルのパスを受け取る
            let Some(path) = arg(&args, "archivePath", "archive_path").and_then(Value::as_str)
            else {
                return Ok(Value::Null); // 選択がキャンセルされた
            };
            let path = ctx.resolve_upload(path)?;
            let result = character_mod::install_mod_archive(
                ctx.builtin_mods_root.clone(),
                ctx.mods_root.clone(),
                path.clone(),
                &ctx.registry,
            )
            .await;
            std::fs::remove_file(&path).ok();
            ok(result?)
        }
        "character_mod_open_folder" => Err(format!(
            "ブラウザーからはフォルダーを開けません。MODフォルダーは {} です。",
            ctx.mods_root.display()
        )),

        // --- 添付 ---
        // 中身は HTTP で出し、ここでは「どこから取れるか」だけを返す。
        // 実際の保存先はブラウザー(ダウンロード)に任せる。
        "attachment_save" => {
            let id = need_i64(&args, "attachmentId", "attachment_id")?;
            let (filename, _) = attachment_meta(db, id)?;
            Ok(json!({ "id": id, "url": format!("/__miomail/attachment/{id}"), "filename": filename }))
        }
        "attachment_save_all" => {
            let message_id = need_i64(&args, "messageId", "message_id")?;
            let files = message_attachment_meta(db, message_id)?;
            if files.is_empty() {
                return Err("保存できる添付ファイルがありません".to_string());
            }
            ok(files
                .into_iter()
                .map(|(id, filename)| {
                    json!({ "id": id, "url": format!("/__miomail/attachment/{id}"), "filename": filename })
                })
                .collect::<Vec<_>>())
        }
        "attachment_open" => {
            let id = need_i64(&args, "attachmentId", "attachment_id")?;
            let (filename, _) = attachment_meta(db, id)?;
            // デスクトップ版と同じく、実行できる形式は開かせない
            if crate::commands::attachment::is_unsafe_to_open(&filename) {
                return Err(
                    "安全のため、実行可能なファイルは直接開けません。「保存」してから内容をよく確認してください"
                        .to_string(),
                );
            }
            Ok(json!({ "url": format!("/__miomail/attachment/{id}?inline=1") }))
        }
        // 添付の選択はブラウザーのファイル選択 + アップロードで済ませる
        "compose_pick_files" => Err("この操作はブラウザー側で行います".to_string()),

        other => Err(format!("未対応のコマンドです: {other}")),
    }
}

/// 添付1件の素性(中身は HTTP 側で返すので、ここでは名前と大きさだけ)。
/// 添付の中身ごと取り出す。枠の中からは `/__miomail/attachment/{id}` を
/// 取りに行けないので、`__attachment_bytes` から使う。
fn attachment_bytes(db: &DbState, attachment_id: i64) -> Result<(String, String, Vec<u8>), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT filename, COALESCE(mime_type, 'application/octet-stream'), data
           FROM attachments WHERE id = ?1",
        [attachment_id],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Vec<u8>>(2)?,
            ))
        },
    )
    .map_err(|_| "添付ファイルが見つかりませんでした。メールを開き直してください".to_string())
    .and_then(|(name, mime, data)| {
        if data.is_empty() {
            Err("添付ファイルのデータが空です。メールを開き直してください".to_string())
        } else {
            Ok((name, mime, data))
        }
    })
}

fn attachment_meta(db: &DbState, attachment_id: i64) -> Result<(String, i64), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT filename, LENGTH(COALESCE(data, '')) FROM attachments WHERE id = ?1",
        [attachment_id],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
    )
    .map_err(|_| "添付ファイルが見つかりませんでした。メールを開き直してください".to_string())
    .and_then(|(name, size)| {
        if size == 0 {
            Err("添付ファイルのデータが空です。メールを開き直してください".to_string())
        } else {
            Ok((name, size))
        }
    })
}

/// メール1通ぶんの、中身が入っている添付の一覧。
fn message_attachment_meta(db: &DbState, message_id: i64) -> Result<Vec<(i64, String)>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, filename FROM attachments
             WHERE message_id = ?1 AND LENGTH(COALESCE(data, '')) > 0
             ORDER BY is_inline, id",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([message_id], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();
    Ok(rows)
}

impl Ctx {
    /// アップロード用の一時フォルダーの外を指していないことを確かめる。
    fn resolve_upload(&self, raw: &str) -> Result<PathBuf, String> {
        let path = PathBuf::from(raw);
        let base = self
            .upload_dir
            .canonicalize()
            .unwrap_or_else(|_| self.upload_dir.clone());
        let resolved = path.canonicalize().map_err(|_| {
            "アップロードされたファイルが見つかりませんでした。もう一度選び直してください"
                .to_string()
        })?;
        if !resolved.starts_with(&base) {
            return Err("不正なファイルパスです".to_string());
        }
        Ok(resolved)
    }
}

// ---------------------------------------------------------------------------
// イベント(listen の代わり)
// ---------------------------------------------------------------------------

async fn events_handler(State(ctx): State<Shared>, headers: HeaderMap) -> Response {
    if !authorized(&ctx, &headers) {
        return unauthorized();
    }

    let receiver = events::subscribe();
    let stream = futures::stream::unfold(receiver, |mut receiver| async move {
        loop {
            match receiver.recv().await {
                Ok(app_event) => {
                    let event = Event::default()
                        .event(app_event.name)
                        .json_data(app_event.payload)
                        .ok()?;
                    return Some((Ok::<Event, std::convert::Infallible>(event), receiver));
                }
                // 取りこぼしは演出が1回抜けるだけなので読み飛ばす
                Err(RecvError::Lagged(_)) => continue,
                Err(RecvError::Closed) => return None,
            }
        }
    });

    Sse::new(stream).keep_alive(KeepAlive::default()).into_response()
}

// ---------------------------------------------------------------------------
// 添付のダウンロード / アップロード
// ---------------------------------------------------------------------------

async fn attachment_handler(
    State(ctx): State<Shared>,
    AxumPath(id): AxumPath<i64>,
    Query(query): Query<AttachmentQuery>,
    headers: HeaderMap,
) -> Response {
    if !authorized(&ctx, &headers) {
        return unauthorized();
    }

    let loaded = {
        let conn = match ctx.db.conn.lock() {
            Ok(conn) => conn,
            Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "db busy").into_response(),
        };
        conn.query_row(
            "SELECT filename, COALESCE(mime_type, 'application/octet-stream'), data
             FROM attachments WHERE id = ?1",
            [id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<Vec<u8>>>(2)?.unwrap_or_default(),
                ))
            },
        )
    };

    let Ok((filename, mime, data)) = loaded else {
        return (StatusCode::NOT_FOUND, "添付ファイルが見つかりませんでした").into_response();
    };
    if data.is_empty() {
        return (
            StatusCode::NOT_FOUND,
            "添付ファイルのデータが空です。メールを開き直してください",
        )
            .into_response();
    }

    let mut response = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime)
        .header(header::CACHE_CONTROL, "no-store");

    // ファイル名は RFC 5987 で渡す(日本語のファイル名がそのまま使えるように)
    let disposition = if query.inline.as_deref() == Some("1") {
        "inline"
    } else {
        "attachment"
    };
    if let Ok(value) = HeaderValue::from_str(&format!(
        "{disposition}; filename*=UTF-8''{}",
        percent_encode(&filename)
    )) {
        response = response.header(header::CONTENT_DISPOSITION, value);
    }

    response.body(data.into()).unwrap_or_else(|_| {
        (StatusCode::INTERNAL_SERVER_ERROR, "response build failed").into_response()
    })
}

#[derive(Deserialize)]
struct UploadQuery {
    name: Option<String>,
}

/// 添付や MOD アーカイブを一時フォルダーへ置き、そのパスを返す。
/// 置いたファイルは送信/追加のあとで消える。
async fn upload_handler(
    State(ctx): State<Shared>,
    headers: HeaderMap,
    Query(query): Query<UploadQuery>,
    body: Bytes,
) -> Response {
    if !origin_ok(&headers) || !authorized(&ctx, &headers) {
        return unauthorized();
    }

    // 送信は合計 25MB まで(デスクトップ版と同じ上限)。
    if body.len() > MAX_UPLOAD_BYTES {
        return Json(json!({ "ok": false, "error": "ファイルが大きすぎます(25MBまで)" }))
            .into_response();
    }

    let name = sanitize_upload_name(query.name.as_deref().unwrap_or("attachment"));
    let unique = format!("{}-{}", random_token(), name);
    let path = ctx.upload_dir.join(&unique);

    if let Err(error) = std::fs::write(&path, &body) {
        return Json(json!({ "ok": false, "error": format!("一時ファイルを作れませんでした: {error}") }))
            .into_response();
    }

    Json(json!({
        "ok": true,
        "data": { "path": path.to_string_lossy(), "name": name, "size": body.len() }
    }))
    .into_response()
}

/// 一時フォルダーの外へ出られないよう、区切り文字と制御文字を落とす。
fn sanitize_upload_name(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or("attachment");
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

fn percent_encode(value: &str) -> String {
    value
        .bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                (b as char).to_string()
            }
            other => format!("%{other:02X}"),
        })
        .collect()
}

// ---------------------------------------------------------------------------
// キャラクターMOD の asset(大きいので JSON ではなく生のバイト列で返す)
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct ModAssetQuery {
    mod_id: String,
    revision: String,
    asset_key: String,
}

async fn mod_asset_handler(
    State(ctx): State<Shared>,
    headers: HeaderMap,
    Query(query): Query<ModAssetQuery>,
) -> Response {
    if !authorized(&ctx, &headers) {
        return unauthorized();
    }

    match character_mod::read_mod_asset(
        &ctx.registry,
        query.mod_id,
        query.revision,
        query.asset_key.clone(),
    )
    .await
    {
        Ok(bytes) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, content_type_for(&query.asset_key))
            .header(header::CACHE_CONTROL, "no-store")
            .body(bytes.into())
            .unwrap_or_else(|_| {
                (StatusCode::INTERNAL_SERVER_ERROR, "response build failed").into_response()
            }),
        Err(error) => (StatusCode::NOT_FOUND, error).into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 枠の中では親ページの CSP も効くので、こちら側にも
    /// 「信用されたスクリプトが後から差し込んだもの」を通す指定が要る。
    /// これが無いと、親が差し込んだ画面本体を自分のポリシーが弾く。
    #[test]
    fn standalone_csp_allows_injected_scripts() {
        let html = "<meta http-equiv=\"Content-Security-Policy\" content=\"x\" />";
        let out = replace_csp(html, "abc");
        assert!(out.contains("'nonce-abc'"), "{out}");
        assert!(out.contains("'strict-dynamic'"), "{out}");
    }

    /// 起動役は、札を探して module として走らせる形であること。
    #[test]
    fn boot_script_runs_the_embedded_code() {
        let out = boot_script("abc");
        assert!(out.contains("nonce=\"abc\""), "{out}");
        assert!(out.contains(EMBED_CODE_TYPE), "{out}");
        assert!(out.contains("__MIOMAIL_STARTED__"), "{out}");
        assert!(out.contains("createElement('script')"), "{out}");
        // 札の型を間違えると、ブラウザーが先に実行してしまう
        assert_eq!(EMBED_CODE_TYPE, "application/miomail-module");
    }

    #[test]
    fn boot_script_goes_last() {
        let out = insert_before_body_end("<body><div id=\"root\"></div></body>", "<!--boot-->");
        assert_eq!(out, "<body><div id=\"root\"></div><!--boot--></body>");
        // </body> が無いときも落とさない
        assert_eq!(insert_before_body_end("<p>", "<!--boot-->"), "<p><!--boot-->");
    }
}
