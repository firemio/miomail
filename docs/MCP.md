# MioMail MCP サーバー

MioMail のメールを AI エージェント（Claude Code / Claude Desktop など）から操作するための
MCP (Model Context Protocol) サーバーです。stdio で動作します。

## 仕組み

- MioMail アプリと同じ SQLite データベース（`%APPDATA%\com.firemio.miomail\miomail.db`）と
  OS キーリング（Windows 資格情報マネージャー）を読み取ります。
- 先に MioMail アプリを起動してアカウントを設定しておく必要があります。
- IMAP / SMTP へは直接接続するため、アプリが起動していなくても動作します。
  （エージェント側の変更は、アプリの次回同期時に画面へ反映されます）

## ビルド

```powershell
cd src-tauri
cargo build --release --bin miomail-mcp
# → src-tauri/target/release/miomail-mcp.exe
```

## 登録

### Claude Code

このリポジトリには `.mcp.json` が含まれているため、リポジトリ内でセッションを開けば
そのまま使えます。グローバルに登録する場合:

```powershell
claude mcp add miomail -- C:\firemio\miomail\src-tauri\target\release\miomail-mcp.exe
```

### Claude Desktop

`claude_desktop_config.json` に追加:

```json
{
  "mcpServers": {
    "miomail": {
      "command": "C:\\firemio\\miomail\\src-tauri\\target\\release\\miomail-mcp.exe"
    }
  }
}
```

## ツール一覧

| ツール | 説明 |
|--------|------|
| `list_accounts` | 設定済みアカウント一覧（パスワードは返しません） |
| `list_folders` | フォルダ一覧と未読/総数（ローカルキャッシュ） |
| `list_messages` | フォルダ内のメール一覧（新しい順、`unread_only` 対応） |
| `get_message` | 本文の取得（未取得ならIMAPからダウンロード。**既読にはしません**） |
| `search_messages` | 件名・差出人・スニペット・取得済み本文の横断検索 |
| `send_mail` | メール送信（**即時送信**・送信済みフォルダへ保存） |
| `mark_read` | 既読/未読の切り替え（サーバーにも反映） |
| `delete_message` | 削除（ゴミ箱へ移動。ゴミ箱内は完全削除） |
| `sync` | IMAPサーバーからフォルダ＋受信トレイを再同期 |

## 環境変数

| 変数 | 説明 |
|------|------|
| `MIOMAIL_DB` | データベースパスの上書き（既定: `%APPDATA%\com.firemio.miomail\miomail.db`） |

## 使用例（エージェントへの指示）

- 「未読メールを確認して要約して」 → `sync` → `list_folders` → `list_messages(unread_only)` → `get_message`
- 「◯◯さんからのメールを探して返信の下書きを作って」 → `search_messages` → `get_message` →（内容確認後）`send_mail`
- 「この案内メールをゴミ箱に入れて」 → `delete_message`

`send_mail` と `delete_message` は取り消しができないため、エージェントは実行前に
ユーザーへ内容を確認する想定です（ツール説明にもその旨を記載済み）。
