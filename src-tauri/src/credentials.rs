use anyhow::Result;

const SERVICE: &str = "miomail";

/// 既定の保存先。
/// Windows は資格情報マネージャー、Linux は secret-service(GNOME キーリング等)。
fn primary_entry(key: &str) -> std::result::Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, key).map_err(|e| e.to_string())
}

/// Linux だけの退避先: 暗号化したファイル([`crate::credential_file`])。
///
/// secret-service は常駐デーモンと D-Bus セッションが要るので、画面の無い
/// 仮想マシンでは使えないことがある。カーネルキーリング(keyutils)も動くが
/// 再起動で消えるため、頻繁に再起動する Muse の仮想マシンでは、同期のたびに
/// パスワードの再入力が要ることになる。そこでディスクへ置く。
///
/// 既定の保存先に入れられたときは、ここには書かない(ディスクに置くほうが
/// 弱いため)。古い値が残っていたら消す。
#[cfg(target_os = "linux")]
fn fallback_store() -> Option<crate::credential_file::FileStore> {
    crate::credential_file::FileStore::at_default_path()
}

#[cfg(not(target_os = "linux"))]
fn fallback_store() -> Option<crate::credential_file::FileStore> {
    None
}

pub fn get_password(key: &str) -> Result<Option<String>> {
    let primary_error: Option<String> = match primary_entry(key).map(|e| e.get_password()) {
        Ok(Ok(password)) => return Ok(Some(password)),
        // No stored credential for this key — a normal "not set yet" state
        Ok(Err(keyring::Error::NoEntry)) => None,
        // A real backend failure must surface, not masquerade as "not found"
        Ok(Err(e)) => Some(e.to_string()),
        Err(e) => Some(e),
    };

    if let Some(store) = fallback_store() {
        match store.get(key) {
            Ok(Some(password)) => return Ok(Some(password)),
            Ok(None) => {}
            Err(e) => log::warn!("退避先からの読み取りに失敗しました ({}): {}", key, e),
        }
    }

    match primary_error {
        Some(e) => Err(anyhow::anyhow!("資格情報の読み取りに失敗しました: {}", e)),
        None => Ok(None),
    }
}

pub fn set_password(key: &str, password: &str) -> Result<()> {
    let primary_error: Option<String> = match primary_entry(key).map(|e| e.set_password(password)) {
        Ok(Ok(())) => None,
        Ok(Err(e)) => Some(e.to_string()),
        Err(e) => Some(e),
    };

    let Some(primary_error) = primary_error else {
        // OS の資格情報ストアに入ったので、ディスクには残さない
        if let Some(store) = fallback_store() {
            if let Err(e) = store.delete(key) {
                log::warn!("退避先の古い資格情報を消せません ({}): {}", key, e);
            }
        }
        log::info!("Password saved for key: {}", key);
        return Ok(());
    };

    match fallback_store() {
        Some(store) => {
            store.set(key, password).map_err(|e| {
                anyhow::anyhow!(
                    "Password save failed: {} / 退避先にも保存できません: {}",
                    primary_error,
                    e
                )
            })?;
            log::warn!(
                "既定の資格情報ストアに保存できないため、暗号化したファイルへ保存しました ({}): {}",
                key,
                primary_error
            );
            Ok(())
        }
        None => Err(anyhow::anyhow!("Password save failed: {}", primary_error)),
    }
}

pub fn delete_password(key: &str) -> Result<()> {
    // どちらに入っていても消す。消す対象が無いのは成功扱い。
    if let Ok(entry) = primary_entry(key) {
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(e) => log::warn!("Failed to delete password for {}: {}", key, e),
        }
    }
    if let Some(store) = fallback_store() {
        if let Err(e) = store.delete(key) {
            log::warn!("Failed to delete password for {} (fallback): {}", key, e);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    /// Verifies the OS credential store actually persists a value round-trip.
    /// Guards against a missing keyring platform feature (which silently falls
    /// back to a non-persistent mock store). Touches the real credential
    /// manager, so it is opt-in via `--ignored`.
    ///
    /// Linux では secret-service の無い環境(CI のランナーなど)でも、
    /// 暗号化ファイルへの退避で通ることを確かめる意味も持つ。
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
