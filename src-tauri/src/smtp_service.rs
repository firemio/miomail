use anyhow::Result;
use lettre::message::header;
use lettre::message::{Mailbox, Mailboxes, MultiPart};
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

    let email = builder.multipart(MultiPart::alternative_plain_html(text, data.html.clone()))?;
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
