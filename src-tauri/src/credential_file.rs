//! OS の資格情報ストアが使えないときの、ファイルによる保存先。
//!
//! Muse の仮想マシンのように画面もキーリングデーモンも無い環境では
//! secret-service が使えない。カーネルキーリング(keyutils)は動くが再起動で
//! 消えるため、頻繁に再起動する仮想マシンでは同期のたびにパスワードの
//! 再入力が要る。そこで最後の手段としてディスクに置く。
//!
//! 鍵は同じフォルダーの `credentials.key`(初回に作る乱数、0600)と実行ユーザー名
//! から導く。**この2つのファイルを揃えて持ち出せば復号できる**ので、守りは
//! 「データ置き場そのものが本人しか読めないこと」に拠る。同じフォルダーには
//! メール本文の入った DB も置いてあるので、そこを読める相手に対しては
//! どのみち中身は守れない。OS の資格情報ストア(Windows の資格情報マネージャー、
//! Linux の secret-service)が使えるならそちらを優先し、ここには書かない。
//! 判断は credentials.rs 側で行う。
//!
//! **なぜ machine-id をやめたか。** 以前は鍵を `/etc/machine-id` から導いていた。
//! ファイルだけでは復号できない点は強かったが、Muse の仮想マシンのように
//! 土台ごと入れ替わる環境では machine-id が変わり、保存したパスワードが
//! 1〜2時間おきに読めなくなった。読めるが少し弱い方を選んでいる。
//! 古い形式で保存された値は、読めたときに新しい鍵で置き換える。

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
/// 鍵のもと。初回に作る 32 バイトの乱数。
const KEY_FILE_NAME: &str = "credentials.key";
/// 鍵導出の用途を固定する文字列。保存形式を変えるときはここも変える。
const KEY_CONTEXT: &[u8] = b"miomail-credential-store-v1";
const NONCE_LEN: usize = 12;
const KEY_MATERIAL_LEN: usize = 32;

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
        let nonce = Nonce::from_slice(nonce);

        // 今の鍵で読めなければ、古い形式(machine-id 由来)で読んでみる。
        let plain = match self.cipher().and_then(|c| {
            c.decrypt(nonce, sealed)
                .map_err(|_| anyhow!("保存された資格情報を復号できません"))
        }) {
            Ok(plain) => plain,
            Err(current) => {
                let Ok(plain) = legacy_cipher()
                    .and_then(|c| c.decrypt(nonce, sealed).map_err(|_| anyhow!("復号できません")))
                else {
                    return Err(current);
                };
                // 読めたので、今の鍵で置き直す(次からは移行が要らない)
                if let Ok(text) = std::str::from_utf8(&plain) {
                    let _ = self.set(key, text);
                }
                plain
            }
        };
        Ok(Some(String::from_utf8(plain).context("資格情報が UTF-8 ではありません")?))
    }

    /// 鍵のもとを読む。無ければ作る。
    fn key_material(&self) -> Result<Vec<u8>> {
        let path = self
            .path
            .parent()
            .map(|dir| dir.join(KEY_FILE_NAME))
            .ok_or_else(|| anyhow!("資格情報の鍵の置き場所が決まりません"))?;

        if let Ok(existing) = fs::read(&path) {
            if existing.len() >= KEY_MATERIAL_LEN {
                return Ok(existing);
            }
        }

        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir).context("資格情報の保存先を作れません")?;
        }
        let mut fresh = [0u8; KEY_MATERIAL_LEN];
        chacha20poly1305::aead::rand_core::RngCore::fill_bytes(&mut OsRng, &mut fresh);
        fs::write(&path, fresh).context("資格情報の鍵を作れません")?;
        restrict_to_owner(&path)?;
        Ok(fresh.to_vec())
    }

    fn cipher(&self) -> Result<ChaCha20Poly1305> {
        let mut hasher = Sha256::new();
        hasher.update(KEY_CONTEXT);
        hasher.update(self.key_material()?);
        hasher.update([0u8]);
        hasher.update(user_name().as_bytes());
        let key = hasher.finalize();
        Ok(ChaCha20Poly1305::new(Key::from_slice(&key)))
    }

    pub fn set(&self, key: &str, secret: &str) -> Result<()> {
        let nonce = ChaCha20Poly1305::generate_nonce(&mut OsRng);
        let sealed = self.cipher()?
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

/// v2.1.24 までの鍵。machine-id 由来なので、土台が入れ替わると読めなくなる。
/// 読める間だけ、古い値を今の鍵へ移すために使う。
fn legacy_cipher() -> Result<ChaCha20Poly1305> {
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

    /// v2.1.24 までの形式で保存された値が読めること。Muse の仮想マシンのように
    /// 土台が入れ替わる環境のために鍵を変えたので、移行できることを確かめる。
    #[test]
    fn reads_and_migrates_values_saved_with_the_old_key() {
        let (store, dir) = temp_store("legacy");
        let nonce = ChaCha20Poly1305::generate_nonce(&mut OsRng);
        let sealed = legacy_cipher()
            .expect("legacy cipher")
            .encrypt(&nonce, "old-secret".as_bytes())
            .expect("encrypt");
        let mut blob = nonce.to_vec();
        blob.extend_from_slice(&sealed);
        let mut entries = BTreeMap::new();
        entries.insert("acct-1".to_string(), BASE64.encode(blob));
        fs::create_dir_all(store.path.parent().expect("dir")).expect("mkdir");
        fs::write(&store.path, serde_json::to_vec_pretty(&entries).expect("json")).expect("write");

        assert_eq!(store.get("acct-1").expect("get").as_deref(), Some("old-secret"));
        // 読めたら今の鍵へ置き直す
        assert!(store
            .path
            .parent()
            .expect("dir")
            .join(KEY_FILE_NAME)
            .exists());
        assert_eq!(store.get("acct-1").expect("re-get").as_deref(), Some("old-secret"));
        let _ = fs::remove_dir_all(dir);
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
