use anyhow::Result;

const SERVICE: &str = "miomail";

pub fn get_password(key: &str) -> Result<Option<String>> {
    let entry = keyring::Entry::new(SERVICE, key)
        .map_err(|e| anyhow::anyhow!("資格情報の読み取り準備に失敗しました: {}", e))?;
    match entry.get_password() {
        Ok(pw) => Ok(Some(pw)),
        // No stored credential for this key — a normal "not set yet" state
        Err(keyring::Error::NoEntry) => Ok(None),
        // A real backend failure must surface, not masquerade as "not found"
        Err(e) => Err(anyhow::anyhow!("資格情報の読み取りに失敗しました: {}", e)),
    }
}

pub fn set_password(key: &str, password: &str) -> Result<()> {
    let entry = keyring::Entry::new(SERVICE, key)
        .map_err(|e| anyhow::anyhow!("Keyring entry creation failed: {}", e))?;
    entry
        .set_password(password)
        .map_err(|e| anyhow::anyhow!("Password save failed: {}", e))?;
    log::info!("Password saved for key: {}", key);
    Ok(())
}

pub fn delete_password(key: &str) -> Result<()> {
    match keyring::Entry::new(SERVICE, key) {
        Ok(entry) => match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => {
                log::warn!("Failed to delete password for {}: {}", key, e);
                Ok(())
            }
        },
        Err(_) => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    /// Verifies the OS credential store actually persists a value round-trip.
    /// Guards against a missing keyring platform feature (which silently falls
    /// back to a non-persistent mock store). Touches the real credential
    /// manager, so it is opt-in via `--ignored`.
    #[test]
    #[ignore = "touches the real OS credential store"]
    fn keyring_persists_roundtrip() {
        let key = "miomail-selftest-roundtrip";
        super::set_password(key, "hello-123").expect("set_password failed");
        let got = super::get_password(key).expect("get_password errored");
        super::delete_password(key).ok();
        assert_eq!(
            got.as_deref(),
            Some("hello-123"),
            "credential store did not persist the value — is the keyring platform feature enabled?"
        );
    }
}
