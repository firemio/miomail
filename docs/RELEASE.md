# リリース手順（配布・自動アップデート）

MioMail は GitHub Releases で配布し、Tauri updater が
`https://github.com/firemio/miomail/releases/latest/download/latest.json`
を見て自動アップデートします。

## 前提（1回だけ）

- 署名鍵: `%USERPROFILE%\.tauri\miomail.key`（**紛失するとアップデート配信不可。必ずバックアップ**）
- 公開鍵は `src-tauri/tauri.conf.json` の `plugins.updater.pubkey` に設定済み
- 鍵の再生成: `npx tauri signer generate -w %USERPROFILE%\.tauri\miomail.key`

## 新バージョンを出す手順

1. バージョンを上げる（**3ファイル同期**）:
   - `src-tauri/tauri.conf.json` の `version`
   - `src-tauri/Cargo.toml` の `version`
   - `package.json` の `version`
2. コミットしてタグを付ける:
   ```powershell
   git commit -am "chore: v2.0.1"
   git tag v2.0.1
   git push && git push --tags
   ```
3. 署名付きでビルド:
   ```powershell
   $env:TAURI_SIGNING_PRIVATE_KEY_PATH="$env:USERPROFILE\.tauri\miomail.key"
   $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
   npm run tauri build
   ```
   → `src-tauri\target\release\bundle\nsis\` に `MioMail_x.y.z_x64-setup.exe` と `.sig` が出ます
4. latest.json を生成:
   ```powershell
   node scripts/make-latest-json.mjs --notes "修正内容の説明"
   ```
5. GitHub Release を作成（インストーラー・sig・latest.json の3点をアップロード）:
   ```powershell
   cd src-tauri\target\release\bundle\nsis
   gh release create v2.0.1 *.exe *.sig latest.json --title "MioMail v2.0.1" --notes "変更点..."
   ```

これだけで、既存ユーザーのアプリが起動時（15秒後、以降6時間ごと）に更新を検知し、
バナーから1クリックで更新→自動再起動します。設定 → データ管理 → アップデート からも手動確認できます。

## ユーザーデータの保護（アップデートで壊さないために）

ユーザーデータは全てインストールフォルダの**外**にあり、アップデートでは触られません:

| データ | 場所 |
|--------|------|
| キャラクターMOD | `%LOCALAPPDATA%\com.firemio.miomail\character-mods\` |
| メールDB | `%APPDATA%\com.firemio.miomail\miomail.db` |
| 設定・相棒の成長状態・下書き | WebView2 localStorage（`%LOCALAPPDATA%\com.firemio.miomail\`） |
| メールパスワード | Windows 資格情報マネージャー |

守るべきルール:

1. **バンドルにユーザーデータのパスを含めない**（インストーラーが上書き対象にしない）
2. **MODマニフェストの `schemaVersion: 1` の後方互換を壊さない。**
   形式を変える場合は `schemaVersion: 2` を追加し、1も読み続けること
   （未対応バージョンはクラッシュせず issues として報告される設計になっている）
3. **SQLiteスキーマの変更は必ず `db.rs` の `migrate()` に追加**（旧DBからの自動移行。
   カラム削除や型変更ではなく、カラム追加＋後方互換の形にする）
4. `deleteAppDataOnUninstall` は `false` のまま維持（アンインストール時もデータを残す）
5. localStorage のキー名（`miomail-*`）を変える場合は旧キーからの移行コードを入れる

## 注意

- **latest.json は必ず各リリースにアップロード**すること（updaterは `releases/latest/download/latest.json` を見るため、最新リリースに無いと更新検知が止まる）
- リリースは draft や pre-release にしない（`latest/download` の対象にならない）
- アップデートパッケージは minisign 署名で検証されるため、鍵が一致しないと配信しても適用されません
- コード署名（SmartScreen対策）は未導入。導入する場合は Azure Trusted Signing 等で `bundle.windows.signCommand` を設定
