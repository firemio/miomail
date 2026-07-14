use anyhow::Result;
use lettre::message::header;
use lettre::message::{Attachment, Mailbox, Mailboxes, MultiPart};
use lettre::{
    transport::smtp::authentication::Credentials, AsyncSmtpTransport, AsyncTransport, Message,
    Tokio1Executor,
};

#[derive(Clone, Debug)]
pub struct SmtpConfig {
    pub host: String,
    pub port: u16,
    pub secure: bool,
    pub user: String,
    pub pass: String,
    pub accept_invalid_certs: bool,
}

pub struct ComposeData {
    pub from: String,
    pub to: String,
    pub cc: Option<String>,
    pub subject: String,
    pub html: String,
    pub text: Option<String>,
    pub in_reply_to: Option<String>,
    pub references: Option<String>,
    pub attachments: Vec<AttachmentData>,
}

pub struct AttachmentData {
    pub filename: String,
    pub mime_type: String,
    pub data: Vec<u8>,
}

fn build_transport(config: &SmtpConfig) -> Result<AsyncSmtpTransport<Tokio1Executor>> {
    let creds = Credentials::new(config.user.clone(), config.pass.clone());

    let tls_params = lettre::transport::smtp::client::TlsParameters::builder(config.host.clone())
        .dangerous_accept_invalid_certs(config.accept_invalid_certs)
        .build_native()?;

    let transport = if config.secure {
        // Port 465: implicit TLS
        AsyncSmtpTransport::<Tokio1Executor>::relay(&config.host)?
            .port(config.port)
            .credentials(creds)
            .tls(lettre::transport::smtp::client::Tls::Wrapper(tls_params))
            .build()
    } else {
        // Port 587: STARTTLS
        AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&config.host)?
            .port(config.port)
            .credentials(creds)
            .tls(lettre::transport::smtp::client::Tls::Required(tls_params))
            .build()
    };

    Ok(transport)
}

pub async fn test_connection(config: &SmtpConfig) -> Result<()> {
    let transport = build_transport(config)?;
    transport.test_connection().await?;
    Ok(())
}

fn parse_mailboxes(input: &str, field: &str) -> Result<Mailboxes> {
    input
        .parse::<Mailboxes>()
        .map_err(|e| anyhow::anyhow!("{}のアドレスを解釈できません ({}): {}", field, input, e))
}

/// Derive a plain-text body from HTML for clients that prefer text/plain.
fn html_to_fallback_text(html: &str) -> String {
    let mut text = html
        .replace("<br>", "\n")
        .replace("<br/>", "\n")
        .replace("<br />", "\n")
        .replace("</p>", "\n")
        .replace("</div>", "\n");
    // Strip remaining tags
    let mut result = String::with_capacity(text.len());
    let mut in_tag = false;
    for c in text.drain(..) {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            c if !in_tag => result.push(c),
            _ => {}
        }
    }
    result
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

/// Build the RFC822 message. Returns the lettre Message so callers can both
/// send it and serialize it (for saving to the IMAP Sent folder).
pub fn build_message(data: &ComposeData) -> Result<Message> {
    let from: Mailbox = data
        .from
        .parse()
        .map_err(|e| anyhow::anyhow!("差出人アドレスを解釈できません ({}): {}", data.from, e))?;

    let to = parse_mailboxes(&data.to, "宛先(To)")?;
    if to.iter().next().is_none() {
        anyhow::bail!("宛先(To)が空です");
    }

    let mut builder = Message::builder()
        .from(from)
        .subject(&data.subject)
        .mailbox(header::To::from(to));

    if let Some(cc) = data.cc.as_deref().filter(|s| !s.trim().is_empty()) {
        let cc = parse_mailboxes(cc, "CC")?;
        if cc.iter().next().is_some() {
            builder = builder.mailbox(header::Cc::from(cc));
        }
    }

    if let Some(irt) = data.in_reply_to.as_deref().filter(|s| !s.trim().is_empty()) {
        builder = builder.in_reply_to(irt.trim().to_string());
    }
    if let Some(refs) = data.references.as_deref().filter(|s| !s.trim().is_empty()) {
        builder = builder.references(refs.trim().to_string());
    }

    let text = data
        .text
        .clone()
        .filter(|t| !t.trim().is_empty())
        .unwrap_or_else(|| html_to_fallback_text(&data.html));

    let body = MultiPart::alternative_plain_html(text, data.html.clone());

    let email = if data.attachments.is_empty() {
        builder.multipart(body)?
    } else {
        let mut mixed = MultiPart::mixed().multipart(body);
        for att in &data.attachments {
            let content_type = header::ContentType::parse(&att.mime_type)
                .or_else(|_| header::ContentType::parse("application/octet-stream"))
                .map_err(|e| anyhow::anyhow!("添付のContent-Typeが不正です: {}", e))?;
            mixed = mixed.singlepart(
                Attachment::new(att.filename.clone()).body(att.data.clone(), content_type),
            );
        }
        builder.multipart(mixed)?
    };
    Ok(email)
}

/// Send the message. Returns the raw RFC822 bytes of what was sent so the
/// caller can APPEND it to the account's Sent folder.
pub async fn send(config: &SmtpConfig, data: &ComposeData) -> Result<Vec<u8>> {
    let email = build_message(data)?;
    let raw = email.formatted();

    let transport = build_transport(config)?;
    transport.send(email).await?;
    Ok(raw)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base_data() -> ComposeData {
        ComposeData {
            from: "Makko <makko@example.com>".to_string(),
            to: "a@example.com, Bee <b@example.com>".to_string(),
            cc: Some("c@example.com".to_string()),
            subject: "テスト件名".to_string(),
            html: "<p>こんにちは &amp; さようなら</p>".to_string(),
            text: Some("こんにちは & さようなら".to_string()),
            in_reply_to: Some("<parent-123@example.com>".to_string()),
            references: Some("<root-1@example.com> <parent-123@example.com>".to_string()),
            attachments: Vec::new(),
        }
    }

    #[test]
    fn build_message_supports_multiple_recipients_cc_and_threading() {
        let email = build_message(&base_data()).expect("message should build");
        let raw = String::from_utf8_lossy(&email.formatted()).to_string();

        assert!(raw.contains("a@example.com"), "first To recipient missing");
        assert!(raw.contains("b@example.com"), "second To recipient missing");
        assert!(raw.contains("Cc:"), "Cc header missing");
        assert!(raw.contains("c@example.com"), "Cc recipient missing");
        assert!(
            raw.contains("In-Reply-To: <parent-123@example.com>"),
            "In-Reply-To header missing"
        );
        assert!(raw.contains("References:"), "References header missing");
        assert!(
            raw.contains("multipart/alternative"),
            "should send text + html alternative"
        );
        assert!(raw.contains("text/plain"), "plain part missing");
        assert!(raw.contains("text/html"), "html part missing");
    }

    #[test]
    fn build_message_rejects_invalid_recipients() {
        let mut data = base_data();
        data.to = "not-an-address".to_string();
        assert!(build_message(&data).is_err());
    }

    #[test]
    fn build_message_derives_text_from_html_when_missing() {
        let mut data = base_data();
        data.text = None;
        data.html = "<p>hello<br>world &amp; more</p>".to_string();
        let email = build_message(&data).expect("message should build");
        let raw = String::from_utf8_lossy(&email.formatted()).to_string();
        assert!(raw.contains("multipart/alternative"));
    }

    #[test]
    fn build_message_includes_attachments_as_multipart_mixed() {
        let mut data = base_data();
        data.attachments = vec![
            AttachmentData {
                filename: "レポート.pdf".to_string(),
                mime_type: "application/pdf".to_string(),
                data: b"%PDF-1.4 dummy".to_vec(),
            },
            AttachmentData {
                filename: "photo.png".to_string(),
                mime_type: "image/png".to_string(),
                data: vec![0x89, 0x50, 0x4E, 0x47],
            },
        ];
        let email = build_message(&data).expect("message should build");
        let raw = String::from_utf8_lossy(&email.formatted()).to_string();

        assert!(raw.contains("multipart/mixed"), "outer part should be mixed");
        assert!(
            raw.contains("multipart/alternative"),
            "text+html alternative should be nested"
        );
        assert!(raw.contains("application/pdf"), "pdf content type missing");
        assert!(raw.contains("image/png"), "png content type missing");
        assert!(
            raw.contains("Content-Disposition: attachment"),
            "attachment disposition missing"
        );
        // Invalid mime types fall back to octet-stream instead of failing
        let mut fallback = base_data();
        fallback.attachments = vec![AttachmentData {
            filename: "data.bin".to_string(),
            mime_type: "not a mime".to_string(),
            data: vec![1, 2, 3],
        }];
        let raw = String::from_utf8_lossy(&build_message(&fallback).unwrap().formatted()).to_string();
        assert!(raw.contains("application/octet-stream"));
    }

    #[test]
    fn html_fallback_strips_tags_and_entities() {
        let text = html_to_fallback_text("<p>hello<br>world &amp; <b>more</b></p>");
        assert!(text.contains("hello"));
        assert!(text.contains("world & more"));
        assert!(!text.contains('<'));
    }
}
