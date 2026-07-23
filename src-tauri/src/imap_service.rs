use anyhow::Result;
use async_imap::types::{Fetch, Flag, Name, NameAttribute};
use async_imap::Session;
use async_native_tls::TlsConnector;
use async_std::net::TcpStream;
use futures::StreamExt;
use async_imap::imap_proto::types::BodyStructure;
use serde::{Deserialize, Serialize};

use crate::utf7;

#[derive(Clone, Debug)]
pub struct ImapConfig {
    pub host: String,
    pub port: u16,
    pub secure: bool,
    pub user: String,
    pub pass: String,
    pub accept_invalid_certs: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FolderInfo {
    pub path: String,
    pub name: String,
    pub delimiter: String,
    pub flags: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MessageHeader {
    pub uid: u32,
    pub message_id: String,
    pub subject: String,
    pub from: String,
    pub to: String,
    pub cc: String,
    pub date: String,
    pub date_ts: i64,
    pub flags: Vec<String>,
    pub snippet: String,
    pub has_attachments: bool,
}

#[derive(Debug)]
pub struct FlagState {
    pub uid: u32,
    pub flags: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MessageBody {
    pub html: String,
    pub text: String,
    pub attachments: Vec<AttachmentPart>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AttachmentPart {
    pub filename: String,
    pub mime_type: String,
    pub content_id: String,
    pub is_inline: bool,
    pub data: Vec<u8>,
}

/// How many messages to pull on the first sync of a folder.
const INITIAL_SYNC_LIMIT: u32 = 200;

const HEADER_ITEMS: &str =
    "(UID FLAGS BODYSTRUCTURE BODY.PEEK[HEADER.FIELDS (SUBJECT FROM TO CC DATE MESSAGE-ID)])";

type ImapSession = Session<async_native_tls::TlsStream<TcpStream>>;

fn flag_to_string(flag: &Flag) -> String {
    match flag {
        Flag::Seen => "\\Seen".to_string(),
        Flag::Answered => "\\Answered".to_string(),
        Flag::Flagged => "\\Flagged".to_string(),
        Flag::Deleted => "\\Deleted".to_string(),
        Flag::Draft => "\\Draft".to_string(),
        Flag::Recent => "\\Recent".to_string(),
        Flag::MayCreate => "\\*".to_string(),
        Flag::Custom(s) => s.to_string(),
    }
}

fn name_attribute_to_string(attr: &NameAttribute) -> String {
    match attr {
        NameAttribute::NoInferiors => "\\Noinferiors".to_string(),
        NameAttribute::NoSelect => "\\Noselect".to_string(),
        NameAttribute::Marked => "\\Marked".to_string(),
        NameAttribute::Unmarked => "\\Unmarked".to_string(),
        NameAttribute::Extension(s) => s.to_string(),
        other => format!("{:?}", other),
    }
}

async fn connect(config: &ImapConfig) -> Result<ImapSession> {
    log::info!("IMAP connecting to {}:{}", config.host, config.port);

    if !config.secure {
        anyhow::bail!(
            "非TLSのIMAP接続（ポート143/STARTTLS）は現在サポートされていません。ポート993のSSL/TLSを使用してください。"
        );
    }

    let tls = TlsConnector::new()
        .danger_accept_invalid_certs(config.accept_invalid_certs)
        .min_protocol_version(Some(async_native_tls::Protocol::Tlsv12));

    let addr = format!("{}:{}", config.host, config.port);
    let tcp = TcpStream::connect(&addr)
        .await
        .map_err(|e| anyhow::anyhow!("TCP connect to {} failed: {}", addr, e))?;

    let tls_stream = tls
        .connect(&config.host, tcp)
        .await
        .map_err(|e| anyhow::anyhow!("TLS handshake with {} failed: {}", config.host, e))?;

    let client = async_imap::Client::new(tls_stream);
    let session = client
        .login(&config.user, &config.pass)
        .await
        .map_err(|e| anyhow::anyhow!("IMAP login as {} failed: {}", config.user, e.0))?;

    log::info!("IMAP connected as {}", config.user);
    Ok(session)
}

pub async fn test_connection(config: &ImapConfig) -> Result<()> {
    let mut session = connect(config).await?;
    session.logout().await?;
    Ok(())
}

/// Run one LIST command and collect all returned names.
async fn collect_list(session: &mut ImapSession, reference: &str, pattern: &str) -> Result<Vec<Name>> {
    let stream = session.list(Some(reference), Some(pattern)).await?;
    let names = stream
        .filter_map(|r| async { r.ok() })
        .collect::<Vec<_>>()
        .await;
    Ok(names)
}

pub async fn list_folders(config: &ImapConfig) -> Result<Vec<FolderInfo>> {
    let mut session = connect(config).await?;

    // まずは一般的な LIST "" "*" を試す。サーバーによってはこれを
    // "BAD Invalid pattern" で拒否する(imaplib 経由で観測)ため、
    // Err または 0 件の場合は LIST "" "" でルートの prefix(例: "INBOX.")を
    // 取得し、「prefix + *」で再試行する。それでも駄目なら最初の結果を返す。
    let first = collect_list(&mut session, "", "*").await;
    let need_fallback = match &first {
        Err(_) => true,
        Ok(v) => v.is_empty(),
    };

    let names_result = if need_fallback {
        let mut retried: Option<Vec<Name>> = None;
        if let Ok(roots) = collect_list(&mut session, "", "").await {
            if let Some(prefix) = roots.iter().map(|n| n.name()).find(|p| !p.is_empty()) {
                let pattern = format!("{}*", prefix);
                if let Ok(v) = collect_list(&mut session, "", &pattern).await {
                    if !v.is_empty() {
                        log::info!(
                            "LIST \"{}\" fallback found {} folders",
                            pattern,
                            v.len()
                        );
                        retried = Some(v);
                    }
                }
            }
        }
        match retried {
            Some(v) => Ok(v),
            None => first, // フォールバック不成立: 最初の Err / 空をそのまま返す
        }
    } else {
        first
    };

    session.logout().await?;
    let names = names_result?;

    log::info!("IMAP listed {} folders", names.len());

    let mut folders = Vec::new();
    for name in &names {
        // path は wire 生名(modified UTF-7 のまま)を保持する。
        // SELECT/COPY/APPEND などのコマンドにそのまま渡すためデコードしない。
        let path = name.name().to_string();
        let delimiter = name.delimiter().map(|d| d.to_string()).unwrap_or_default();
        // name は表示用の短縮名。path を delimiter でセグメント分割し、
        // 各セグメントを modified UTF-7 デコードしたうちの最後(葉)を使う。
        // delimiter が空なら全体をデコードする。
        let short_name = if !delimiter.is_empty() {
            path.split(delimiter.as_str())
                .map(utf7::decode)
                .last()
                .unwrap_or_else(|| path.clone())
        } else {
            utf7::decode(&path)
        };
        let flags: Vec<String> = name
            .attributes()
            .iter()
            .map(name_attribute_to_string)
            .collect();

        folders.push(FolderInfo {
            path,
            name: short_name,
            delimiter,
            flags,
        });
    }

    Ok(folders)
}

fn addr_list_to_string(addr: Option<&mail_parser::Address>) -> String {
    let Some(addr) = addr else {
        return String::new();
    };
    addr.iter()
        .map(|a| {
            let name = a.name.as_deref().unwrap_or("").trim();
            let email = a.address.as_deref().unwrap_or("").trim();
            if name.is_empty() {
                email.to_string()
            } else if email.is_empty() {
                name.to_string()
            } else {
                format!("{} <{}>", name, email)
            }
        })
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(", ")
}

fn structure_has_attachments(bs: &BodyStructure) -> bool {
    fn is_attachment_leaf(
        common: &async_imap::imap_proto::types::BodyContentCommon,
        allow_inline_media: bool,
    ) -> bool {
        if let Some(disp) = &common.disposition {
            if disp.ty.eq_ignore_ascii_case("attachment") {
                return true;
            }
        }
        if allow_inline_media {
            return false;
        }
        // Non-text leaf without explicit disposition still counts as an attachment
        // (e.g. application/pdf embedded without Content-Disposition)
        !common.ty.ty.eq_ignore_ascii_case("text")
    }

    fn walk(bs: &BodyStructure, top_level: bool) -> bool {
        match bs {
            BodyStructure::Multipart { common, bodies, .. } => {
                let subtype_related = common.ty.subtype.eq_ignore_ascii_case("related");
                bodies.iter().any(|b| {
                    if subtype_related {
                        // multipart/related children (inline images for HTML) are not
                        // user-visible attachments unless explicitly marked
                        match b {
                            BodyStructure::Basic { common, .. }
                            | BodyStructure::Text { common, .. } => {
                                is_attachment_leaf(common, true)
                            }
                            _ => walk(b, false),
                        }
                    } else {
                        walk(b, false)
                    }
                })
            }
            BodyStructure::Message { common, .. } => is_attachment_leaf(common, false),
            BodyStructure::Text { common, .. } => {
                if let Some(disp) = &common.disposition {
                    disp.ty.eq_ignore_ascii_case("attachment")
                } else {
                    false
                }
            }
            BodyStructure::Basic { common, .. } => {
                if top_level {
                    // A single-part non-text message body (rare) — treat explicit
                    // attachment disposition only
                    is_attachment_leaf(common, true)
                } else {
                    is_attachment_leaf(common, false)
                }
            }
        }
    }

    walk(bs, true)
}

fn parse_header_fetch(msg: &Fetch) -> Option<MessageHeader> {
    let uid = msg.uid.unwrap_or(0);
    if uid == 0 {
        return None;
    }

    let flags: Vec<String> = msg.flags().map(|f| flag_to_string(&f)).collect();
    let has_attachments = msg
        .bodystructure()
        .map(structure_has_attachments)
        .unwrap_or(false);

    let header_bytes = msg.header().unwrap_or(&[]);
    let parsed = mail_parser::MessageParser::default().parse(header_bytes);

    let (subject, from, to, cc, date, date_ts, message_id) = match &parsed {
        Some(m) => (
            m.subject().unwrap_or("").to_string(),
            addr_list_to_string(m.from()),
            addr_list_to_string(m.to()),
            addr_list_to_string(m.cc()),
            m.date().map(|d| d.to_rfc3339()).unwrap_or_default(),
            m.date().map(|d| d.to_timestamp()).unwrap_or(0),
            m.message_id().map(|s| format!("<{}>", s)).unwrap_or_default(),
        ),
        None => Default::default(),
    };

    Some(MessageHeader {
        uid,
        message_id,
        subject,
        from,
        to,
        cc,
        date,
        date_ts,
        flags,
        snippet: String::new(),
        has_attachments,
    })
}

/// Fetch message headers. `since_uid == 0` means initial sync (latest
/// INITIAL_SYNC_LIMIT messages); otherwise only messages with UID >= since_uid
/// are returned (the "N:*" IMAP quirk of returning the last message is
/// filtered out here).
pub async fn fetch_messages(
    config: &ImapConfig,
    folder: &str,
    since_uid: u32,
) -> Result<Vec<MessageHeader>> {
    let mut session = connect(config).await?;
    let mailbox = session
        .select(folder)
        .await
        .map_err(|e| anyhow::anyhow!("Failed to SELECT '{}': {}", folder, e))?;

    let total = mailbox.exists;
    log::info!(
        "IMAP SELECT '{}': {} messages exist, since_uid={}",
        folder,
        total,
        since_uid
    );

    if total == 0 {
        session.logout().await?;
        return Ok(Vec::new());
    }

    let raw_messages: Vec<Fetch> = if since_uid == 0 {
        // Initial sync: fetch only the newest INITIAL_SYNC_LIMIT by sequence number
        let start = total.saturating_sub(INITIAL_SYNC_LIMIT - 1).max(1);
        let range = format!("{}:{}", start, total);
        log::info!("IMAP initial fetch range (seq): {}", range);
        let stream = session
            .fetch(&range, HEADER_ITEMS)
            .await
            .map_err(|e| anyhow::anyhow!("IMAP FETCH failed: {}", e))?;
        stream.filter_map(|r| async move { r.ok() }).collect().await
    } else {
        let range = format!("{}:*", since_uid);
        log::info!("IMAP incremental uid_fetch range: {}", range);
        let stream = session
            .uid_fetch(&range, HEADER_ITEMS)
            .await
            .map_err(|e| anyhow::anyhow!("IMAP UID FETCH failed: {}", e))?;
        stream.filter_map(|r| async move { r.ok() }).collect().await
    };

    let mut result: Vec<MessageHeader> = raw_messages
        .iter()
        .filter_map(parse_header_fetch)
        // Drop the "last message" that IMAP returns for a 'N:*' range even
        // when N exceeds the highest UID
        .filter(|h| since_uid == 0 || h.uid >= since_uid)
        .collect();

    result.sort_by_key(|h| h.uid);

    log::info!(
        "IMAP parsed {} new messages from '{}'",
        result.len(),
        folder
    );
    session.logout().await?;
    Ok(result)
}

/// Fetch current flags for all messages with UID >= min_uid.
/// Used to reconcile local state (read/unread, deletions) with the server.
pub async fn fetch_flags(
    config: &ImapConfig,
    folder: &str,
    min_uid: u32,
) -> Result<Vec<FlagState>> {
    let mut session = connect(config).await?;
    let mailbox = session
        .select(folder)
        .await
        .map_err(|e| anyhow::anyhow!("Failed to SELECT '{}': {}", folder, e))?;

    if mailbox.exists == 0 {
        session.logout().await?;
        return Ok(Vec::new());
    }

    let range = format!("{}:*", min_uid.max(1));
    let stream = session
        .uid_fetch(&range, "(UID FLAGS)")
        .await
        .map_err(|e| anyhow::anyhow!("IMAP UID FETCH (flags) failed: {}", e))?;
    let messages: Vec<Fetch> = stream.filter_map(|r| async move { r.ok() }).collect().await;

    let result = messages
        .iter()
        .filter_map(|m| {
            let uid = m.uid?;
            Some(FlagState {
                uid,
                flags: m.flags().map(|f| flag_to_string(&f)).collect(),
            })
        })
        .collect();

    session.logout().await?;
    Ok(result)
}

/// A short file extension for attachments that arrive without a filename.
fn extension_for_mime(mime: &str) -> &'static str {
    match mime.to_ascii_lowercase().as_str() {
        "image/png" => "png",
        "image/jpeg" | "image/jpg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/bmp" => "bmp",
        "image/svg+xml" => "svg",
        "application/pdf" => "pdf",
        "application/zip" => "zip",
        "text/plain" => "txt",
        "text/html" => "html",
        "text/calendar" => "ics",
        "message/rfc822" => "eml",
        _ => "bin",
    }
}

/// RFC2047 encoded-word folding can leak spaces into decoded filenames
/// (e.g. "資料.pd f"). A file extension never legitimately contains
/// whitespace, so strip it there to keep the file openable.
fn fix_extension_whitespace(filename: &str) -> String {
    match filename.rsplit_once('.') {
        Some((stem, ext))
            if !stem.is_empty()
                && ext.chars().any(char::is_whitespace)
                && ext.chars().filter(|c| !c.is_whitespace()).count() <= 5
                && ext
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c.is_whitespace()) =>
        {
            let clean: String = ext.chars().filter(|c| !c.is_whitespace()).collect();
            format!("{}.{}", stem, clean)
        }
        _ => filename.to_string(),
    }
}

fn extract_attachments(parsed: &mail_parser::Message) -> Vec<AttachmentPart> {
    use mail_parser::MimeHeaders;

    let mut result = Vec::new();
    for (index, part) in parsed.attachments().enumerate() {
        let data = part.contents().to_vec();
        if data.is_empty() {
            continue;
        }

        let mime_type = part
            .content_type()
            .map(|ct| match &ct.c_subtype {
                Some(sub) => format!("{}/{}", ct.c_type, sub),
                None => ct.c_type.to_string(),
            })
            .unwrap_or_else(|| "application/octet-stream".to_string());

        let content_id = part
            .content_id()
            .map(|s| s.trim_start_matches('<').trim_end_matches('>').to_string())
            .unwrap_or_default();

        let filename = part
            .attachment_name()
            .map(|s| fix_extension_whitespace(s.trim()))
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| {
                format!("attachment-{}.{}", index + 1, extension_for_mime(&mime_type))
            });

        result.push(AttachmentPart {
            filename,
            mime_type,
            content_id,
            is_inline: false,
            data,
        });
    }
    result
}

/// Replace `cid:` references in the HTML body with data: URIs so inline
/// images render inside the sandboxed viewer, and mark those parts inline.
fn embed_inline_images(html: String, attachments: &mut [AttachmentPart]) -> String {
    use base64::Engine as _;

    let mut out = html;
    for att in attachments.iter_mut() {
        if att.content_id.is_empty() {
            continue;
        }
        let marker = format!("cid:{}", att.content_id);
        if out.contains(&marker) {
            att.is_inline = true;
            let data_uri = format!(
                "data:{};base64,{}",
                att.mime_type,
                base64::engine::general_purpose::STANDARD.encode(&att.data)
            );
            out = out.replace(&marker, &data_uri);
        }
    }
    out
}

pub async fn fetch_body(config: &ImapConfig, folder: &str, uid: u32, peek: bool) -> Result<MessageBody> {
    let mut session = connect(config).await?;
    session.select(folder).await?;

    let items = if peek { "BODY.PEEK[]" } else { "BODY[]" };
    let messages_stream = session.uid_fetch(uid.to_string(), items).await?;
    let messages: Vec<_> = messages_stream
        .filter_map(|r| async { r.ok() })
        .collect()
        .await;
    let raw = messages
        .iter()
        .find(|m| m.uid == Some(uid))
        .and_then(|m| m.body())
        .ok_or_else(|| {
            anyhow::anyhow!("メール本文を取得できませんでした（サーバー上で削除された可能性があります）")
        })?;

    let parsed = mail_parser::MessageParser::default()
        .parse(raw)
        .unwrap_or_default();

    let html = parsed
        .body_html(0)
        .map(|s| s.to_string())
        .unwrap_or_default();
    let text = parsed
        .body_text(0)
        .map(|s| s.to_string())
        .unwrap_or_default();

    let mut attachments = extract_attachments(&parsed);
    let html = embed_inline_images(html, &mut attachments);

    session.logout().await?;
    Ok(MessageBody { html, text, attachments })
}

pub async fn add_flags(config: &ImapConfig, folder: &str, uid: u32, flags: &str) -> Result<()> {
    let mut session = connect(config).await?;
    session.select(folder).await?;
    let _ = session
        .uid_store(uid.to_string(), format!("+FLAGS ({})", flags))
        .await?
        .collect::<Vec<_>>()
        .await;
    session.logout().await?;
    Ok(())
}

pub async fn remove_flags(config: &ImapConfig, folder: &str, uid: u32, flags: &str) -> Result<()> {
    let mut session = connect(config).await?;
    session.select(folder).await?;
    let _ = session
        .uid_store(uid.to_string(), format!("-FLAGS ({})", flags))
        .await?
        .collect::<Vec<_>>()
        .await;
    session.logout().await?;
    Ok(())
}

/// Move a message to another folder (used for move-to-Trash on delete).
/// Falls back to COPY + delete + expunge on servers without MOVE.
pub async fn move_message(
    config: &ImapConfig,
    folder: &str,
    uid: u32,
    dest_folder: &str,
) -> Result<()> {
    let mut session = connect(config).await?;
    session.select(folder).await?;

    let uid_str = uid.to_string();
    let mv = session.uid_mv(&uid_str, dest_folder).await;
    if let Err(e) = mv {
        log::warn!("UID MOVE failed ({}), falling back to COPY+EXPUNGE", e);
        session
            .uid_copy(&uid_str, dest_folder)
            .await
            .map_err(|e| anyhow::anyhow!("UID COPY to '{}' failed: {}", dest_folder, e))?;
        expunge_uid(&mut session, uid).await?;
    }

    session.logout().await?;
    Ok(())
}

/// Permanently delete a message (\Deleted + expunge).
pub async fn delete_message(config: &ImapConfig, folder: &str, uid: u32) -> Result<()> {
    let mut session = connect(config).await?;
    session.select(folder).await?;
    expunge_uid(&mut session, uid).await?;
    session.logout().await?;
    Ok(())
}

async fn expunge_uid(session: &mut ImapSession, uid: u32) -> Result<()> {
    let uid_str = uid.to_string();
    let _ = session
        .uid_store(&uid_str, "+FLAGS (\\Deleted)")
        .await?
        .collect::<Vec<_>>()
        .await;
    // UID EXPUNGE needs UIDPLUS; fall back to a full EXPUNGE
    let uid_expunge_ok = match session.uid_expunge(&uid_str).await {
        Ok(stream) => {
            let _ = stream.collect::<Vec<_>>().await;
            true
        }
        Err(e) => {
            log::warn!("UID EXPUNGE failed ({}), falling back to EXPUNGE", e);
            false
        }
    };
    if !uid_expunge_ok {
        let _ = session.expunge().await?.collect::<Vec<_>>().await;
    }
    Ok(())
}

/// 既に wire 形式の `&-` / `&<base64>-` セクションは温存しつつ、それ以外の
/// 部分だけを modified UTF-7 にエンコードする。DB 由来の wire path と
/// ユーザー入力の生 Unicode が混ざったパスにも安全に使える(冪等)。
fn encode_wire_path(path: &str) -> String {
    let bytes = path.as_bytes();
    let mut out = String::with_capacity(path.len());
    let mut raw = String::new(); // エンコード待ちの生テキスト
    let mut i = 0;

    fn flush(out: &mut String, raw: &mut String) {
        if !raw.is_empty() {
            out.push_str(&utf7::encode(raw));
            raw.clear();
        }
    }

    while i < bytes.len() {
        if bytes[i] == b'&' {
            // `&…-` セクションとしてデコードできれば既に wire 形式とみなす
            let section_end = bytes[i + 1..]
                .iter()
                .position(|&b| b == b'-')
                .map(|p| i + 1 + p);
            if let Some(end) = section_end {
                let section = &path[i..=end]; // `&` から `-` まで両端含む
                if section == "&-" || utf7::decode(section) != section {
                    flush(&mut out, &mut raw);
                    out.push_str(section);
                    i = end + 1;
                    continue;
                }
            }
        }
        // 1 文字分(マルチバイト考慮)を生テキスト側へ積む
        let ch_len = path[i..].chars().next().map(char::len_utf8).unwrap_or(1);
        raw.push_str(&path[i..i + ch_len]);
        i += ch_len;
    }
    flush(&mut out, &mut raw);
    out
}

/// Create a new mailbox (folder) on the server.
pub async fn create_folder(config: &ImapConfig, path: &str) -> Result<()> {
    // ユーザー入力の非ASCII名を送信前に modified UTF-7 へエンコードする。
    // 既に wire 形式の部分は二重エンコードされない。
    let wire_path = encode_wire_path(path);
    let mut session = connect(config).await?;
    session
        .create(&wire_path)
        .await
        .map_err(|e| anyhow::anyhow!("フォルダ '{}' の作成に失敗しました: {}", path, e))?;
    // Subscribe so it shows up in clients that only list subscribed folders
    session.subscribe(&wire_path).await.ok();
    session.logout().await?;
    Ok(())
}

/// Rename / move a mailbox on the server.
pub async fn rename_folder(config: &ImapConfig, from: &str, to: &str) -> Result<()> {
    // create_folder と同様に wire 形式へエンコードしてから送信する。
    let wire_from = encode_wire_path(from);
    let wire_to = encode_wire_path(to);
    let mut session = connect(config).await?;
    session
        .rename(&wire_from, &wire_to)
        .await
        .map_err(|e| anyhow::anyhow!("フォルダの名前変更に失敗しました: {}", e))?;
    session.subscribe(&wire_to).await.ok();
    session.logout().await?;
    Ok(())
}

/// Delete a mailbox on the server.
pub async fn delete_folder(config: &ImapConfig, path: &str) -> Result<()> {
    let mut session = connect(config).await?;
    session.unsubscribe(path).await.ok();
    session
        .delete(path)
        .await
        .map_err(|e| anyhow::anyhow!("フォルダ '{}' の削除に失敗しました: {}", path, e))?;
    session.logout().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wire_path_encoding_is_idempotent() {
        // 生の Unicode はエンコードされる
        assert_eq!(encode_wire_path("仕事"), "&TtVOiw-");
        assert_eq!(encode_wire_path("案件A"), "&aEhO9g-A");
        // 既に wire 形式のパス(DB 由来)はそのまま
        assert_eq!(encode_wire_path("&TtVOiw-"), "&TtVOiw-");
        assert_eq!(encode_wire_path("INBOX"), "INBOX");
        assert_eq!(encode_wire_path("INBOX.&TtVOiw-"), "INBOX.&TtVOiw-");
        // wire 親パス + 生の葉名が混ざったパスは葉だけエンコード
        assert_eq!(encode_wire_path("&TtVOiw-.新規"), "&TtVOiw-.&ZbCJjw-");
        // 生の `&` は `&-` に、`&-` はそのまま
        assert_eq!(encode_wire_path("R&D"), "R&-D");
        assert_eq!(encode_wire_path("R&-D"), "R&-D");
    }

    const MULTIPART_MAIL: &str = "From: sender@example.com\r\n\
To: receiver@example.com\r\n\
Subject: attachments\r\n\
MIME-Version: 1.0\r\n\
Content-Type: multipart/mixed; boundary=\"outer\"\r\n\
\r\n\
--outer\r\n\
Content-Type: multipart/related; boundary=\"inner\"\r\n\
\r\n\
--inner\r\n\
Content-Type: text/html; charset=utf-8\r\n\
\r\n\
<p>hello <img src=\"cid:logo123\"></p>\r\n\
--inner\r\n\
Content-Type: image/png\r\n\
Content-ID: <logo123>\r\n\
Content-Transfer-Encoding: base64\r\n\
Content-Disposition: inline\r\n\
\r\n\
iVBORw0KGgo=\r\n\
--inner--\r\n\
--outer\r\n\
Content-Type: application/pdf; name=\"report.pdf\"\r\n\
Content-Transfer-Encoding: base64\r\n\
Content-Disposition: attachment; filename=\"report.pdf\"\r\n\
\r\n\
JVBERi0xLjQ=\r\n\
--outer--\r\n";

    #[test]
    fn attachments_are_extracted_with_names_and_inline_images_embedded() {
        let parsed = mail_parser::MessageParser::default()
            .parse(MULTIPART_MAIL.as_bytes())
            .expect("mail should parse");

        let html = parsed.body_html(0).map(|s| s.to_string()).unwrap_or_default();
        let mut attachments = extract_attachments(&parsed);
        assert_eq!(attachments.len(), 2, "png + pdf expected: {:?}", attachments.iter().map(|a| &a.filename).collect::<Vec<_>>());

        let html = embed_inline_images(html, &mut attachments);
        assert!(
            html.contains("data:image/png;base64,"),
            "cid reference should be replaced with a data URI: {}",
            html
        );
        assert!(!html.contains("cid:logo123"));

        let png = attachments.iter().find(|a| a.mime_type == "image/png").unwrap();
        assert!(png.is_inline, "referenced cid part should be inline");
        assert_eq!(png.content_id, "logo123");

        let pdf = attachments.iter().find(|a| a.mime_type == "application/pdf").unwrap();
        assert!(!pdf.is_inline);
        assert_eq!(pdf.filename, "report.pdf");
        assert_eq!(pdf.data, b"%PDF-1.4");
    }

    #[test]
    fn extension_whitespace_from_folded_headers_is_repaired() {
        assert_eq!(
            fix_extension_whitespace("RFID導入検討に関する資料20260522.pd f"),
            "RFID導入検討に関する資料20260522.pdf"
        );
        assert_eq!(fix_extension_whitespace("report.x lsx"), "report.xlsx");
        // Untouched cases
        assert_eq!(fix_extension_whitespace("report.pdf"), "report.pdf");
        assert_eq!(fix_extension_whitespace("議事録 7月.docx"), "議事録 7月.docx");
        assert_eq!(fix_extension_whitespace("no-extension"), "no-extension");
        assert_eq!(
            fix_extension_whitespace("odd.name with space"),
            "odd.name with space"
        );
    }

    #[test]
    fn attachment_without_filename_gets_a_default_name() {
        let mail = "From: a@example.com\r\n\
To: b@example.com\r\n\
Subject: unnamed\r\n\
MIME-Version: 1.0\r\n\
Content-Type: multipart/mixed; boundary=\"x\"\r\n\
\r\n\
--x\r\n\
Content-Type: text/plain\r\n\
\r\n\
body\r\n\
--x\r\n\
Content-Type: image/png\r\n\
Content-Transfer-Encoding: base64\r\n\
Content-Disposition: attachment\r\n\
\r\n\
iVBORw0KGgo=\r\n\
--x--\r\n";
        let parsed = mail_parser::MessageParser::default()
            .parse(mail.as_bytes())
            .expect("mail should parse");
        let attachments = extract_attachments(&parsed);
        assert_eq!(attachments.len(), 1);
        assert_eq!(attachments[0].filename, "attachment-1.png");
    }
}

/// Append a raw RFC822 message to a folder (used to save sent mail).
pub async fn append_message(
    config: &ImapConfig,
    folder: &str,
    flags: Option<&str>,
    content: &[u8],
) -> Result<()> {
    let mut session = connect(config).await?;
    session
        .append(folder, flags, None, content)
        .await
        .map_err(|e| anyhow::anyhow!("APPEND to '{}' failed: {}", folder, e))?;
    session.logout().await?;
    Ok(())
}
