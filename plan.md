# IMAP フォルダ バグ修正プラン

## バグ報告(別ユーザー環境)
1. IMAP のフォルダ名が文字化けする
2. 多重階層フォルダがおかしい(最初の階層に全データが集まる / サブフォルダが取得できない)

## 再現確認(本環境: imap.lolipop.jp, dovecot 系, delimiter ".", INBOX. プレフィックス必須)
- `INBOX.仕事`(wire: `INBOX.&TtVOiw-`)を作成し MCP sync → `name: "&TtVOiw-"` のまま表示 = 文字化け確定
  - 原因: `src-tauri/src/imap_service.rs` `list_folders()` が modified UTF-7 (RFC 3501) をデコードせず生の wire 名を保存
  - 関連: `create_folder` / `rename_folder` も非ASCII名をエンコードせず送信している
- 階層: サーバーは `INBOX.仕事.2025.案件A` を正しく返すが、UI(Sidebar)はフラット表示のみでツリー構築ロジックが存在しない
  - また `LIST "" *` を拒否するサーバーがあり得る(imaplib 経由で BAD Invalid pattern を観測)→ フォールバック未取得でサブフォルダ欠落の可能性

## Stage 1 — 並行実装(AgentSwarm)
- Worker_A「バックエンド_Rust」(coder): src-tauri のみ
  - `src-tauri/src/utf7.rs` 新規: modified UTF-7 encode/decode + 単体テスト(仕事⇔&TtVOiw-, 案件A⇔&aEhO9g-A, &⇔&-)
  - `list_folders`: path は wire 生名のまま(SELECT 等に使用)、name はセグメント単位でデコードした短縮表示名に
  - `create_folder` / `rename_folder`: ユーザー入力名を modified UTF-7 エンコードして送信
  - LIST フォールバック: `list(Some(""), Some("*"))` が失敗/空なら `LIST "" ""` で prefix+delimiter を取得し `prefix + "*"` で再試行
  - MCP バイナリ(src-tauri/src/bin/miomail-mcp.rs)でも表示名がデコードされることを確認
  - `cargo test` / `cargo check` パス
- Worker_B「フロントエンド_TS」(coder): src/renderer のみ
  - Sidebar: フォルダを delimiter でツリー化(親 path 欠落時はフラットにフォールバック)、インデント+折りたたみ、件数表示維持、既存の改名/削除メニュー維持
  - 表示名は backend の `name`(デコード済み)を使用
  - `npm run build` または `tsc --noEmit` パス

## Stage 2 — 検証(Stage 1 完了後)
- cargo test / cargo check / フロント build の最終確認
- 実サーバー(本環境のテストフォルダ INBOX.仕事.*)で修正後ロジックの入出力を検証
- テストフォルダ(INBOX.仕事, INBOX.仕事.2025, INBOX.仕事.2025.案件A)を削除して後片付け

## 成果物
- 修正コード + テスト + 検証レポート

---

# セマンティック検索 + 進捗UI (2026-07-24 追記)

## 決定事項(調査済み)
- LanceDB は不採用(依存+20〜40MB/protoc必須/fat LTO衝突/<100K件ではbrute-forceで十分)。ベクトルは SQLite BLOB + 総当たりコサイン、VectorStore 抽象層で将来差し替え可能に
- 埋め込み: ort(ONNX Runtime) + ruri-v3 int8(初回HFダウンロード、オプトイン)
- EP優先: OpenVINO(NPU) > Vitis(NPU) > DirectML > CPU(NPUはcargo feature opt-in、出荷はDirectML+CPU)
- 進捗: job_progress テーブル(DB共有、アプリ/MCP両対応) + アプリ下部プログレスバー

## IF契約(バックエンド⇔フロント)
- コマンド mail_job_progress(account_id) -> [{kind: 'sync'|'backfill'|'prefetch'|'vectorize'|'model_download', done, total, message, updated_at, active}]
- コマンド mail_semantic_status() -> {state: 'off'|'downloading'|'ready'|'error', model_size_mb, error?}
- コマンド mail_semantic_enable() -> モデルDL開始
- MCPツール semantic_search(query, account_id?, limit?) -> FTS5+ベクトルのRRFハイブリッド結果

## Stage
- Worker_A バックエンド: src-tauri(ort/tokenizers/hf-hub, embed.rs, vectorize.rs, job_progress, MCP semantic_search)
- Worker_B フロント: src/renderer(下部プログレスバー + セマンティック有効化UI、上記契約に対して実装)
