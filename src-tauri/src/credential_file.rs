//! OS の資格情報ストアが使えないときの、ファイルによる保存先。
//!
//! Muse の仮想マシンのように画面もキーリングデーモンも無い環境では
//! secret-service が使えない。カーネルキーリング(keyutils)は動くが再起動で
//! 消えるため、頻繁に再起動する仮想マシンでは同期のたびにパスワードの
//! 再入力が要る。そこで最後の手段としてディスクに置く。
//!
//! 鍵はこの機械固有の値(machine-id)と実行ユーザー名から導くので、**ファイル
//! だけを持ち出しても復号できない**。ただし同じ機械で同じユーザーとして
//! 動ける人からは守れない。OS の資格情報ストア(Windows の資格情報マネージャー、
//! Linux の secret-service)が使えるならそちらを優先し、ここには書かない。
//! 判断は credentials.rs 側で行う。

use anyhow::{anyhow, Context, Result};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use chacha20poly1305::aead::{Aead, AeadCore, KeyInit, OsRng};
use chacha20poly1305::{ChaCha20Poly1305, Key, Nonce};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

/// DB と同じフォルダーに置く。
const FILE_NAME: &str = "credentials.json";
/// 鍵導出の用途を固定する文字列。保存形式を変えるときはここも変える。
const KEY_CONTEXT: &[u8] = b"miomail-credential-store-v1";
const NONCE_LEN: usize = 12;

pub struct FileStore {
    path: PathBuf,
}

impl FileStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    /// 既定の置き場所(DB と同じフォルダー)。場所が決まらなければ None。
    pub fn default_path() -> Option<PathBuf> {
        crate::db::default_db_path().and_then(|db| db.parent().map(|dir| dir.join(FILE_NAME)))
    }

    /// 既定の場所の保存先。場所が決まらなければ None。
    pub fn at_default_path() -> Option<Self> {
        Self::default_path().map(Self::new)
    }

    pub fn get(&self, key: &str) -> Result<Option<String>> {
        let Some(encoded) = self.load().remove(key) else {
            return Ok(None);
        };
        let raw = BASE64
            .decode(encoded.as_bytes())
            .context("保存された資格情報を読み取れません")?;
        if raw.len() <= NONCE_LEN {
            return Err(anyhow!("保存された資格情報が壊れています"));
        }
        let (nonce, sealed) = raw.split_at(NONCE_LEN);
        let plain = cipher()?
            .decrypt(Nonce::from_slice(nonce), sealed)
            // 機械が変わった(machine-id が別)場合もここに来る
            .map_err(|_| anyhow!("保存された資格情報を復号できません"))?;
        Ok(Some(String::from_utf8(plain).context("資格情報が UTF-8 ではありません")?))
    }

    pub fn set(&self, key: &str, secret: &str) -> Result<()> {
        let nonce = ChaCha20Poly1305::generate_nonce(&mut OsRng);
        let sealed = cipher()?
            .encrypt(&nonce, secret.as_bytes())
            .map_err(|_| anyhow!("資格情報を暗号化できません"))?;
        let mut blob = nonce.to_vec();
        blob.extend_from_slice(&sealed);

        let mut entries = self.load();
        entries.insert(key.to_string(), BASE64.encode(blob));
        self.store(&entries)
    }

    pub fn delete(&self, key: &str) -> Result<()> {
        let mut entries = self.load();
        if entries.remove(key).is_none() {
            return Ok(());
        }
        self.store(&entries)
    }

    /// 読めないファイル(壊れている・無い)は「空」として扱う。ここで失敗すると
    /// アプリが起動できなくなるため。
    fn load(&self) -> BTreeMap<String, String> {
        fs::read_to_string(&self.path)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default()
    }

    fn store(&self, entries: &BTreeMap<String, String>) -> Result<()> {
        if let Some(dir) = self.path.parent() {
            fs::create_dir_all(dir).context("資格情報の保存先を作れません")?;
        }
        // 書きかけのファイルを読ませないよう、別名で書いてから置き換える
        let tmp = self.path.with_extension("json.tmp");
        fs::write(&tmp, serde_json::to_vec_pretty(entries)?).context("資格情報を書けません")?;
        restrict_to_owner(&tmp)?;
        fs::rename(&tmp, &self.path).context("資格情報の置き換えに失敗しました")?;
        restrict_to_owner(&self.path)?;
        Ok(())
    }
}

/// 本人だけが読めるようにする(Unix のみ。Windows ではこの保存先を使わない)。
#[cfg(unix)]
fn restrict_to_owner(path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .context("資格情報ファイルの権限を設定できません")
}

#[cfg(not(unix))]
fn restrict_to_owner(_path: &Path) -> Result<()> {
    Ok(())
}

fn cipher() -> Result<ChaCha20Poly1305> {
    let mut hasher = Sha256::new();
    hasher.update(KEY_CONTEXT);
    hasher.update(machine_id().as_bytes());
    hasher.update([0u8]);
    hasher.update(user_name().as_bytes());
    let key = hasher.finalize();
    Ok(ChaCha20Poly1305::new(Key::from_slice(&key)))
}

/// この機械を表す値。systemd 系なら /etc/machine-id がある。
/// 無い環境でも何かを返す(鍵が決まらないと保存自体ができないため)。
fn machine_id() -> String {
    for path in ["/etc/machine-id", "/var/lib/dbus/machine-id"] {
        if let Ok(text) = fs::read_to_string(path) {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
    }
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "miomail-unknown-machine".to_string())
}

fn user_name() -> String {
    std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_store(tag: &str) -> (FileStore, PathBuf) {
        let dir = std::env::temp_dir().join(format!(
            "miomail-credfile-{}-{}",
            std::process::id(),
            tag
        ));
        let _ = fs::remove_dir_all(&dir);
        let path = dir.join(FILE_NAME);
        (FileStore::new(path.clone()), dir)
    }

    #[test]
    fn stores_and_reads_back() {
        let (store, dir) = temp_store("roundtrip");
        store.set("acct-1", "hunter2").expect("set");
        assert_eq!(store.get("acct-1").expect("get").as_deref(), Some("hunter2"));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn survives_a_new_store_instance() {
        // 別プロセス(MCP サーバーなど)や再起動後にも読めること
        let (store, dir) = temp_store("reopen");
        store.set("acct-1", "secret-値").expect("set");
        let reopened = FileStore::new(store.path.clone());
        assert_eq!(
            reopened.get("acct-1").expect("get").as_deref(),
            Some("secret-値")
        );
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn does_not_store_the_secret_in_the_clear() {
        let (store, dir) = temp_store("ciphertext");
        store.set("acct-1", "plaintext-password").expect("set");
        let raw = fs::read_to_string(&store.path).expect("read file");
        assert!(
            !raw.contains("plaintext-password"),
            "平文のまま保存されています: {}",
            raw
        );
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn overwrites_and_deletes() {
        let (store, dir) = temp_store("overwrite");
        store.set("acct-1", "first").expect("set");
        store.set("acct-1", "second").expect("set again");
        assert_eq!(store.get("acct-1").expect("get").as_deref(), Some("second"));

        store.set("acct-2", "other").expect("set other");
        store.delete("acct-1").expect("delete");
        assert_eq!(store.get("acct-1").expect("get"), None);
        // 他の鍵は残る
        assert_eq!(store.get("acct-2").expect("get").as_deref(), Some("other"));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn missing_entries_and_files_are_not_errors() {
        let (store, dir) = temp_store("missing");
        assert_eq!(store.get("nope").expect("get on missing file"), None);
        store.delete("nope").expect("delete on missing file");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn a_damaged_entry_surfaces_as_an_error() {
        let (store, dir) = temp_store("damaged");
        store.set("acct-1", "value").expect("set");
        let mut entries = store.load();
        entries.insert("acct-1".to_string(), BASE64.encode([1u8, 2, 3]));
        store.store(&entries).expect("write damaged");
        assert!(store.get("acct-1").is_err(), "壊れた値は読めたことにしない");
        let _ = fs::remove_dir_all(dir);
    }
}
