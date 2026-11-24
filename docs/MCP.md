# MioMail MCP サーバー

MioMail のメールを AI エージェント（Claude Code / Claude Desktop / Codex など）から操作するための
MCP (Model Context Protocol) サーバーです。stdio で動作します。

エンドユーザー向けには、公式サイトのガイド（https://miomail.app/mcp.html）もあわせて参照してください。

## 仕組み

- MioMail アプリと同じ SQLite データベース（`%APPDATA%\com.firemio.miomail\miomail.db`）と
  OS キーリング（Windows 資格情報マネージャー）を読み取ります。
- 先に MioMail アプリを起動してアカウントを設定しておく必要があります。
- IMAP / SMTP へは直接接続するため、アプリが起動していなくても動作します。
  （エージェント側の変更は、アプリの次回同期時に画面へ反映されます）

## 実行ファイルの場所

- **インストール版（正規）**: NSIS インストーラに `miomail-mcp.exe` が同梱され、
  アプリと一緒に以下へインストールされます。
  `%LOCALAPPDATA%\MioMail\miomail-mcp.exe`
  （= `C:\Users\<ユーザー名>\AppData\Local\MioMail\miomail-mcp.exe`）
- **開発ビルド（開発者向け）**: このリポジトリからビルドした場合は
  `src-tauri/target/release/miomail-mcp.exe` に生成されます（下記「ビルド」参照）。

## ビルド（開発者向け）

```powershell
cd src-tauri
cargo build --release --bin miomail-mcp
# → src-tauri/target/release/miomail-mcp.exe
```

## 登録

MCP クライアントはそれぞれ独自の登録設定を持つため、使いたいクライアントごとに
MCP サーバーの登録が必要です。以下はインストール版のパス
（`%LOCALAPPDATA%\MioMail\miomail-mcp.exe`）を使う例です。開発ビルドを使う場合は
パスを `src-tauri/target/release/miomail-mcp.exe` に読み替えてください。

### Claude Code

```powershell
claude mcp add miomail -- "$env:LOCALAPPDATA\MioMail\miomail-mcp.exe"
```

開発者向け: リポジトリ直下の `.mcp.json` は開発ビルドのパスを指しているため、
リポジトリ内でセッションを開けば開発ビルドをそのまま使えます。

### Claude Desktop

`claude_desktop_config.json` に追加:

```json
{
  "mcpServers": {
    "miomail": {
      "command": "C:\\Users\\<ユーザー名>\\AppData\\Local\\MioMail\\miomail-mcp.exe"
    }
  }
}
```

- `<ユーザー名>` は実際の Windows ユーザー名に置き換えてください。
- JSON ではバックスラッシュを `\\` とエスケープする必要があります。

### Codex（codex CLI）

`~/.codex/config.toml`（`C:\Users\<ユーザー名>\.codex\config.toml`）に以下を追加して、
Codex を再起動します:

```toml
[mcp_servers.miomail]
command = 'C:\Users\<ユーザー名>\AppData\Local\MioMail\miomail-mcp.exe'
```

- `<ユーザー名>` は実際の Windows ユーザー名に置き換えてください。
- シングルクォート（`'...'`）は TOML のリテラル文字列で、バックスラッシュは
  エスケープされずそのまま解釈されます。ダブルクォート（`"..."`）の基本文字列で
  書く場合は `"C:\\Users\\...\\miomail-mcp.exe"` のように二重にしてください。

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

## 承認プロンプトを減らす

各ツールには MCP の annotations（`readOnlyHint` / `destructiveHint` / `idempotentHint` /
`openWorldHint`）と日本語の表示名を付けています。対応クライアントは、読み取りだけの
ツール（一覧・検索・本文取得）と、変更を伴うツール（送信・削除・既読変更・同期）を
区別して扱えます。

それでも毎回の承認ダイアログが出る場合は、クライアント側の許可設定で止めます。

**Claude Code** — `.claude/settings.json`（プロジェクト）または
`~/.claude/settings.json`（全体）の `permissions.allow` に追加します。

| 書き方 | 意味 |
|--------|------|
| `mcp__miomail__list_messages` | そのツールだけ許可 |
| `mcp__miomail__send_mail` | 送信を毎回聞かずに実行 |
| `mcp__miomail__*` | MioMail のツールをすべて許可 |

**Claude Desktop** — 承認ダイアログで「常に許可」を選びます。

`send_mail`（即時送信）と `delete_message`（ゴミ箱へ移動。ゴミ箱から消すと復元不可）は
取り消せません。許可を省略するのは、内容を確認せずに実行されても困らない範囲に
とどめてください。

## トラブルシューティング

- **「登録されていない」「ツールが見つからない」と言われる**
  MCP サーバーの登録はクライアントごとに行います。あるクライアント
  （例: Claude Code）で登録済みでも、別のクライアント（例: Codex）では
  改めてそのクライアントの設定への登録が必要です。上記「登録」セクションの
  手順を、使いたいクライアントで実施済みか確認してください。
- **実行ファイルの存在を確認**
  インストール版では `%LOCALAPPDATA%\MioMail\miomail-mcp.exe` にあります。
  エクスプローラーでパスを開き、`miomail-mcp.exe` が実際に存在するか確認してください。
  （開発ビルドの場合は `src-tauri/target/release/miomail-mcp.exe`）
- **設定変更後はクライアントを再起動**
  設定ファイルを編集しただけでは反映されないクライアントが多いため、
  登録・編集後はクライアントを再起動してください。
- **先に MioMail アプリでアカウントを設定**
  MCP サーバーはアプリと同じデータベース・キーリングを読むため、先にアプリ側で
  アカウント設定を済ませておく必要があります。
