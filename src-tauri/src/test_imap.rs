#[cfg(test)]
mod tests {
    use crate::imap_service::{self, ImapConfig};

    /// Live-server tests read credentials from environment variables so no
    /// secrets live in the repository:
    ///   MIOMAIL_TEST_IMAP_HOST / MIOMAIL_TEST_IMAP_USER / MIOMAIL_TEST_IMAP_PASS
    /// Run with: cargo test -- --ignored
    fn test_config() -> Option<ImapConfig> {
        let host = std::env::var("MIOMAIL_TEST_IMAP_HOST").ok()?;
        let user = std::env::var("MIOMAIL_TEST_IMAP_USER").ok()?;
        let pass = std::env::var("MIOMAIL_TEST_IMAP_PASS").ok()?;
        Some(ImapConfig {
            host,
            port: std::env::var("MIOMAIL_TEST_IMAP_PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(993),
            secure: true,
            user,
            pass,
            accept_invalid_certs: false,
        })
    }

    #[tokio::test]
    #[ignore = "requires live IMAP credentials via MIOMAIL_TEST_IMAP_* env vars"]
    async fn test_list_folders() {
        let Some(config) = test_config() else {
            panic!("MIOMAIL_TEST_IMAP_HOST/USER/PASS not set");
        };

        let folders = imap_service::list_folders(&config).await.unwrap();
        println!("Found {} folders:", folders.len());
        for f in &folders {
            println!(
                "  - {} (name: {}, delim: {:?}, flags: {:?})",
                f.path, f.name, f.delimiter, f.flags
            );
        }
        assert!(!folders.is_empty(), "Should have at least one folder");
    }

    #[tokio::test]
    #[ignore = "requires live IMAP credentials via MIOMAIL_TEST_IMAP_* env vars"]
    async fn test_sync_full_flow() {
        let Some(config) = test_config() else {
            panic!("MIOMAIL_TEST_IMAP_HOST/USER/PASS not set");
        };

        println!("\n=== Step 1: List folders ===");
        let folders = imap_service::list_folders(&config).await.unwrap();
        println!("Found {} folders", folders.len());

        let inbox = folders.iter().find(|f| f.path.to_uppercase() == "INBOX");
        assert!(inbox.is_some(), "INBOX should exist");
        let inbox = inbox.unwrap();
        println!("\n=== Step 2: Found INBOX: {} ===", inbox.path);

        println!("\n=== Step 3: Fetch messages from INBOX (initial sync) ===");
        let messages = imap_service::fetch_messages(&config, &inbox.path, 0)
            .await
            .unwrap();
        println!("Found {} messages", messages.len());
        for m in messages.iter().take(5) {
            println!(
                "  [{}] ts={} attach={} {} from {}",
                m.uid, m.date_ts, m.has_attachments, m.subject, m.from
            );
        }

        if let Some(first_msg) = messages.first() {
            println!(
                "\n=== Step 4: Fetch body for message UID {} (peek) ===",
                first_msg.uid
            );
            let body = imap_service::fetch_body(&config, &inbox.path, first_msg.uid, true)
                .await
                .unwrap();
            println!("HTML body length: {}", body.html.len());
            println!("Text body length: {}", body.text.len());
        }

        println!("\n=== Full sync flow completed successfully! ===");
    }
}
