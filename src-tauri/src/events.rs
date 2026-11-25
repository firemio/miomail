//! プロセス内のイベントバス。
//!
//! デスクトップ版はフロントへ Tauri の `emit` でイベントを届けるが、Web ブリッジ
//! (`miomail --serve`)には AppHandle が無い。発生元(新着メール・MCP経由の送信)が
//! ここへ publish し、
//!   - デスクトップ版: lib.rs の転送タスクが `app.emit` へ中継
//!   - Web ブリッジ:   web.rs の SSE が購読して各ブラウザへ中継
//! という形で、どちらのフロントも同じイベント列を見る。

use once_cell::sync::Lazy;
use serde_json::Value;
use tokio::sync::broadcast;

/// 新着メール。payload = `{ message, unread_count }`。
pub const NEW_MAIL: &str = "miomail://new-mail";
/// MCP サーバー(別プロセス)経由の送信。payload = `{ to, subject }`。
pub const MCP_MAIL_SENT: &str = "miomail://mcp-mail-sent";

/// 1イベント = フロントの `listen(name, …)` 1回分。
#[derive(Clone, Debug)]
pub struct AppEvent {
    pub name: String,
    pub payload: Value,
}

/// 取りこぼしても演出が1回抜けるだけなので、小さめで足りる。
const CAPACITY: usize = 64;

static BUS: Lazy<broadcast::Sender<AppEvent>> = Lazy::new(|| broadcast::channel(CAPACITY).0);

/// イベントを流す。購読者が居なければ捨てられる(エラーにしない)。
pub fn publish(name: &str, payload: Value) {
    let _ = BUS.send(AppEvent {
        name: name.to_string(),
        payload,
    });
}

pub fn subscribe() -> broadcast::Receiver<AppEvent> {
    BUS.subscribe()
}
