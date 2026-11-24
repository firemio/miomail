use anyhow::Result;

const SERVICE: &str = "miomail";

/// 既定の保存先。
/// Windows は資格情報マネージャー、Linux は secret-service(GNOME キーリング等)。
fn primary_entry(key: &str) -> std::result::Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, key).map_err(|e| e.to_string())
}

/// Linux だけの退避先: カーネルキーリング(keyutils)。
///
/// 既定の secret-service は常駐デーモンと D-Bus セッションが要るため、画面の
/// 無い仮想マシンでは使えないことがある。keyutils はカーネル内蔵で常駐も
/// D-Bus も不要なので必ず動くが、keyring クレートが UntilReboot と宣言して
/// いるとおり再起動で消える。そこで「残るほう」を主、「必ず動くほう」を
/// 退避先にして両方へ書き、読むときはどちらかにあれば使う。
/// 消えていた場合は、同期時に「パスワードを再入力してください」と案内される。
#[cfg(target_os = "linux")]
fn fallback_entry(key: &str) -> Option<keyring::Entry> {
    match keyring::keyutils::KeyutilsCredential::new_with_target(None, SERVICE, key) {
        Ok(cred) => Some(keyring::Entry::new_with_credential(Box::new(cred))),
        Err(e) => {
            log::warn!("カーネルキーリングを使えません ({}): {}", key, e);
            None
        }
    }
}

#[cfg(not(target_os = "linux"))]
fn fallback_entry(_key: &str) -> Option<keyring::Entry> {
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

    if let Some(entry) = fallback_entry(key) {
        match entry.get_password() {
            Ok(password) => return Ok(Some(password)),
            Err(keyring::Error::NoEntry) => {}
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

    let mut saved_to_fallback = false;
    if let Some(entry) = fallback_entry(key) {
        match entry.set_password(password) {
            Ok(()) => saved_to_fallback = true,
            Err(e) => log::warn!("退避先への保存に失敗しました ({}): {}", key, e),
        }
    }

    match primary_error {
        None => {
            log::info!("Password saved for key: {}", key);
            Ok(())
        }
        // 既定の保存先が無い環境(画面の無い Linux など)。再起動までは使える。
        Some(e) if saved_to_fallback => {
            log::warn!(
                "既定の資格情報ストアに保存できないため、カーネルキーリングへ保存しました ({}): {}",
                key,
                e
            );
            Ok(())
        }
        Some(e) => Err(anyhow::anyhow!("Password save failed: {}", e)),
    }
}

pub fn delete_password(key: &str) -> Result<()> {
    // どちらに入っていても消す。消す対象が無いのは成功扱い。
    for entry in [primary_entry(key).ok(), fallback_entry(key)]
        .into_iter()
        .flatten()
    {
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(e) => log::warn!("Failed to delete password for {}: {}", key, e),
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
    /// Linux では secret-service が無い環境(CI のランナーなど)でも、
    /// カーネルキーリングへの退避で通ることを確かめる意味も持つ。
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
