# MioMail

Tauri 2 + React 製の IMAP/SMTP メールクライアント（Windows向け、日本語UI）。
マスコット（相棒）システムとキャラクターMOD対応が特徴。

## インストール

[Releases](https://github.com/firemio/miomail/releases/latest) から
`MioMail_x.y.z_x64-setup.exe` をダウンロードして実行してください。

- 現在コード署名は行っていないため、Windows SmartScreen の警告が出る場合があります。
  「詳細情報」→「実行」で続行できます
- アプリは起動時に新バージョンを自動確認し、1クリックで更新できます
  （更新パッケージは署名検証されます）。リリース手順は [docs/RELEASE.md](docs/RELEASE.md)

## ライセンス

[MIT](LICENSE)

## 構成

| パス | 内容 |
|------|------|
| `src/renderer/` | React フロントエンド（Vite + Tailwind + Zustand） |
| `src-tauri/` | Rust バックエンド（IMAP: async-imap / SMTP: lettre / DB: rusqlite） |
| `src-tauri/src/bin/miomail-mcp.rs` | MCP サーバー（AIエージェント連携、[docs/MCP.md](docs/MCP.md)） |
| `docs/character-mods/` | キャラクターMODの仕様 |

## 開発

```powershell
npm install
npm run tauri dev      # アプリ起動（vite + cargo）
npm run typecheck      # TypeScript 型チェック
npm run build          # 型チェック + フロントエンドビルド
cd src-tauri; cargo test --lib   # Rust ユニットテスト
npm run tauri build    # NSISインストーラ作成
```

ブラウザで `npm run dev` のみを起動した場合はモックデータで動作します（Tauri外実行時）。

## データの場所

- 設定/メールキャッシュ: `%APPDATA%\com.firemio.miomail\miomail.db`（SQLite）
- パスワード: Windows 資格情報マネージャー（サービス名 `miomail`）

## MCP（AIエージェント連携）

```powershell
cd src-tauri
cargo build --release --bin miomail-mcp
```

リポジトリ直下の `.mcp.json` で Claude Code から自動認識されます。
詳細は [docs/MCP.md](docs/MCP.md) を参照。

## ライブIMAPテスト

資格情報は環境変数で渡します（リポジトリには含めません）:

```powershell
$env:MIOMAIL_TEST_IMAP_HOST="imap.example.com"
$env:MIOMAIL_TEST_IMAP_USER="you@example.com"
$env:MIOMAIL_TEST_IMAP_PASS="..."
cd src-tauri; cargo test -- --ignored
```
