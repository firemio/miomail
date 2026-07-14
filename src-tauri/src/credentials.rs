use anyhow::Result;

const SERVICE: &str = "miomail";

pub fn get_password(key: &str) -> Result<Option<String>> {
    match keyring::Entry::new(SERVICE, key) {
        Ok(entry) => match entry.get_password() {
            Ok(pw) => Ok(Some(pw)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => {
                log::error!("Failed to get password for {}: {}", key, e);
                Ok(None)
            }
        },
        Err(e) => {
            log::error!("Failed to create keyring entry for {}: {}", key, e);
            Ok(None)
        }
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
