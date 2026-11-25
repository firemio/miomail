# Linux 版

Meta Muse の仮想マシン（ユーザーごとに割り当てられる Ubuntu のクラウドPC）で
MioMail を動かすための対応。スマホから操作する前提なので、画面が狭いときは
1カラム表示に切り替わる。

利用者向けの手順は [サイトの Muse ガイド](https://miomail.app/muse.html)。
ここは開発側のメモ。

## ブラウザから使う(`miomail --serve`)

Muse の実機で試したところ、**デスクトップアプリをそのまま起動しても Muse からは
操作できない**。Muse が利用者に操作を渡せるのは**ブラウザだけ**で、VM のデスクトップは
VM の画面サイズのスクリーンショットが返るだけ、指で押せない。

当初は Xvfb + x11vnc + noVNC で画面をブラウザへ映していたが、遅いうえに VM の
カーソルまで見えてしまう。**本体の画面をそのまま HTTP で出すほうが速くて正確**なので、
`--serve` を足した。VNC 一式はもう要らない。

```sh
miomail --serve                              # 127.0.0.1:7272
miomail --serve --port 8080
MIOMAIL_WEB_TOKEN=... miomail --serve        # 合言葉を固定して URL を安定させる
miomail --serve --single-file --no-token     # Muse のスペースへ埋め込むとき
```

### 画面は作り直していない

**`src/renderer` をそのまま配る。** 差し替えたのは、レンダラーが使う Tauri の窓口
2つだけ(`src/renderer/lib/bridge.ts`)。

| 窓口 | デスクトップ版 | `--serve` |
|------|----------------|-----------|
| `invoke(cmd, args)` | Tauri の IPC | `POST /__miomail/invoke` |
| `listen(name, fn)` | Tauri のイベント | `GET /__miomail/events`(SSE) |

`ipc.ts` の `isTauriRuntime` は「**本物のバックエンドがいるか**」の意味になり、
ブリッジでも true。だから UI 側の分岐(14 箇所)は一切変えていない。false のときだけ
ブラウザープレビュー用のモックに落ちる、という従来の形はそのまま。

HTML/JS/画像は **Tauri がバイナリへ埋め込んだものを読み出して配る**(`context.assets()`)。
dist を二重に持たないので、バイナリも deb も大きくならない。配信時に
`<head>` の直後へ `window.__MIOMAIL_BRIDGE__` を差し込み、レンダラーはこれを見て
送り先を決める。ビルドは1種類のまま。

### Muse のスペース(blob の iframe)

Muse のスペースは **`blob:` の iframe** の中で動く。2026-11-25 に検証用スペースを
作って計測した値:

| 調べたもの | 実測値 |
|------------|--------|
| `location.href` | `blob:https://muse.ai/<uuid>` |
| `location.origin` | `https://muse.ai` |
| `location.ancestorOrigins` | `https://muse.ai`, `https://muse.ai`(2段の入れ子) |
| `http://127.0.0.1:7272/` への `fetch` | **失敗**。`TypeError: Failed to fetch`(`localhost` でも同じ) |
| 親フレームが送ってくるもの | `hatch:space:theme` / `hatch:space:capabilities` / `hatch:space:blank-check` / `cvm-bridge:confirm-document` |
| 親フレームが任意のメッセージに返すもの | **何も返さない**。こちらの `{miomail:1,hello:1}` は無視された |

効いてくるのは3つ:

| できないこと | 対処 |
|--------------|------|
| `./assets/...` を取りに行く | `--single-file`(または `/__miomail/standalone.html`)が、JS も CSS も画像も入った1枚の HTML を返す |
| VM のループバックへ届く | 画面は**利用者のブラウザー**で動くので、`127.0.0.1` は利用者の機械を指す。VM に届くのはスペースの**サーバーアクション**だけ |
| `localStorage` | スペースの作られ方によっては `allow-same-origin` が無く、**触るだけで** SecurityError になる(前に作られたスペースで実際に出た。上の計測では出ていない)。`lib/safeStorage.ts` が包み、読めないときはテーマ・相棒・書きかけを DB (`app_settings` の `web.*`)へ預け、次に開くときサーバーが HTML へ埋めて返す |

1枚にするときは、Vite が吐く `new URL("名前",import.meta.url)` を `data:` へ書き換える
(枠の中では `import.meta.url` が `blob:` になって解決できない)。CSP の `'self'` も
当たらないことがあるので、nonce 付きに書き換える。できあがりは約 2.3MB。

ブラウザープレビュー用の同梱MOD(`characters/browserBuiltinMods.ts`。3Dモデルなど約4MB)は
動的 import に変えてある。本物のバックエンドがいる経路では読み込まれないので、
1枚の HTML には入らない。

**中継の約束**(MioMail 側の口は `invoke` 1本)。Muse の親フレームは自前の
プロトコルしか話さず、こちらのメッセージには応答しない。なので**スペースの画面の
中に MioMail を iframe で置いて、その外側で中継してもらう**:

```
画面 → 外側   { miomail: 1, hello: 1 }
外側 → 画面   { miomail: 1, ready: 1 }

画面 → 外側   { miomail: 1, id, cmd, args }
外側         サーバーアクションから
             POST http://127.0.0.1:7272/__miomail/invoke  {"cmd":…, "args":…}
外側 → 画面   { miomail: 1, id, reply: <サーバーの JSON> }
              または { miomail: 1, id, error: "…" }
```

ブラウザーから直に POST しても届かない。必ずサーバーアクション越しにする。
挨拶の返事が 2.5 秒来なければ、画面は自分で `fetch` に切り替える。
添付・MODのasset・イベントも、この経路では `invoke` だけで済むようにしてある
(`__attachment_bytes` / `character_mod_read_asset` は base64、イベントは
`__events_poll` で差分を取りに行く)。

### サーバー側も作り直していない

`web.rs` はコマンドを**再実装していない**。デスクトップ版の `#[tauri::command]` から
`State<DbState>` を外した `*_core` を呼ぶだけで、SQLite も資格情報ストアも同じ。
`miomail-mcp` が既にやっていたことの範囲を広げた形。

OS のダイアログが要るものだけ、ブラウザのやり方に置き換えてある。

| 操作 | `--serve` でのやり方 |
|------|----------------------|
| 添付を選ぶ | `input[type=file]` → `POST /__miomail/upload` で一時フォルダへ → 以後は同じ経路 |
| 添付を保存 | `GET /__miomail/attachment/{id}` をダウンロード |
| 添付を開く | 同 URL を `inline` で新しいタブに。実行可能な拡張子は従来どおり拒否 |
| MOD を追加 | ファイル選択 → アップロード → サーバーが展開 |
| MOD の asset | `GET /__miomail/mod-asset`(数MBあるので JSON に載せない) |
| ウィンドウ操作 | ボタン自体を出さない(窓枠はブラウザが持っている) |

### 動かないもの

| 機能 | 理由 |
|------|------|
| 意味での検索 | Windows ML が前提。`semantic_status.supported = false` を返し、画面に誘いを出さない |
| New Outlook からの取り込み | Windows の COM が前提 |
| 自動更新 | ブラウザー越しに自分を置き換えられない。`update_check` はエラーを返す(「最新です」とは答えない。本当に最新かは分からないため) |
| MODフォルダーを開く | ブラウザからファイルマネージャは開けない。場所を文言で返す |

### 守り

- 既定は **127.0.0.1 のみ**(`--host` で変えられるが、起動時に警告を出す)
- 起動時に合言葉を作り、`?t=` で渡す。受けた側は HttpOnly / SameSite=Strict の
  クッキーへ移し、以後すべての要求で突き合わせる
- `--no-token` で合言葉を外せる。スペースの枠は URL に `?t=` を足せないため。
  127.0.0.1 で待ち受けているときだけ指定でき、それ以外では起動を断る。
  同じ機械の中からは誰でも読めるようになるので、VM のように閉じた機械でだけ使う
- `Origin` が付いていて自分のオリジンと一致しなければ拒否(後方一致ではなく完全一致)
- アップロードは一時フォルダ配下に正規化して閉じ込める。1ファイル 25MB まで

**この層はメールの中身を HTTP に出す。** 合言葉とループバックで守っているが、
「待ち受けないデスクトップアプリ」ではなくなる、という性質の変化はある。
`--serve` を付けたときだけ有効で、既定では何も開かない。

### イベント

新着メールと MCP 経由の送信は `src-tauri/src/events.rs` のプロセス内バスへ publish し、
デスクトップ版は `lib.rs` の転送タスクが `app.emit` へ、`--serve` は SSE へ中継する。
重複落とし(`mail::dedup_new_messages`)はバスへ流す前に1回だけ行うので、
どちらのフロントでも同じメールで二度演出されない。

## ビルド

開発機が Windows なので、**Linux 版はこのリポジトリでは GitHub Actions で
ビルドする**（`.github/workflows/linux-build.yml`）。Windows から Linux への
クロスコンパイルは webkit2gtk が要るため現実的でない。

- 自動で動く: `main` への push（`src-tauri/**` や `src/**` を含むもの）
- 手動で動かす: Actions タブから `Linux build` を実行
- リリース公開時: `MioMail-amd64.deb` と `MioMail-x86_64.AppImage` をその
  リリースへ添付する（固定名。サイトのダウンロードURLがこの名前を指す）

`scripts/release.ps1` は Windows 専用のまま。Linux 版の成果物は、リリースを
公開したあとに上のワークフローが追加する。

ローカルの Ubuntu でビルドする場合:

```sh
sudo apt-get install -y libwebkit2gtk-4.1-dev libayatana-appindicator3-dev \
  librsvg2-dev libdbus-1-dev libssl-dev libxdo-dev build-essential patchelf
npm ci
npm run tauri -- build
```

`src-tauri/tauri.linux.conf.json` は Tauri が Linux のときだけ自動で読む。
deb と AppImage を作る。MCP サーバーは `/usr/bin/miomail-mcp` へ入れている。

## Windows と違うところ

| 機能 | Linux での扱い |
|------|----------------|
| パスワードの保存 | secret-service（GNOME キーリング等）があればそこへ。無ければ暗号化したファイルへ退避する（再起動後も残る） |
| 自動更新 | AppImage 版のみ。deb は apt の管理下なので、新しい deb を入れ直す |
| セマンティック検索 | 使えない。Windows ML が前提のため。キーワード検索はそのまま使える |
| New Outlook からの取り込み | 使えない。取り出しスクリプトが Windows の COM を使うため |
| トレイアイコン | libayatana-appindicator3 が必要（deb の依存に入れてある） |

### パスワードの保存について

`src-tauri/src/credentials.rs` は Linux で保存先を2段構えにする。

1. **secret-service**（GNOME キーリング等） … OS の資格情報ストア。常駐
   デーモンと D-Bus セッションが要る
2. **暗号化したファイル**（`src-tauri/src/credential_file.rs`） … 1 が使えない
   ときだけ使う。`<データ置き場>/credentials.json` に ChaCha20-Poly1305 で
   暗号化して置き、パーミッションは 0600

1 に入れられたときは 2 には書かない（ディスクに置くほうが弱いため）。古い値が
残っていれば消す。読むときは 1 → 2 の順に探す。

当初はカーネルキーリング（keyutils）を退避先にしていたが、`keyring` クレートが
`UntilReboot` と宣言しているとおり再起動で消える。Muse の仮想マシンは頻繁に
再起動するため、同期のたびにパスワードの再入力が要ることになり、使えなかった。

**2 の鍵の強さについて。** 鍵は同じフォルダーの `credentials.key`(初回に作る
32バイトの乱数、0600)と実行ユーザー名から導く。**この2つのファイルを揃えて
持ち出せば復号できる**ので、守りは「データ置き場そのものが本人しか読めないこと」に
拠る。同じフォルダーにはメール本文の入った DB も置いてあるので、そこを読める相手に
対してはどのみち中身は守れない。`gnome-keyring` を入れてログインセッションで
解錠しておけば 1 が使われる。

**なぜ machine-id をやめたか(2026-11-25)。** 以前は鍵を `/etc/machine-id` から
導いていた。ファイルだけでは復号できない点は強かったが、Muse の仮想マシンは
1〜2時間おきに土台ごと入れ替わり、そのたびに machine-id が変わって保存済みの
パスワードが読めなくなった。読めるが少し弱い方を選んでいる。古い形式で保存された
値は、読めたときに新しい鍵で置き換える(`credential_file::tests::
reads_and_migrates_values_saved_with_the_old_key`)。

## 自動更新

Tauri の updater は Linux では **AppImage のときだけ**動く。deb は apt の
管理下なので、アプリから置き換えない（`commands/update.rs` が `APPIMAGE`
環境変数を見て、無ければその旨を返す）。

更新の案内役は `latest.json`。Windows 版はリリース時に
`scripts/make-latest-json.mjs` が作るが、Linux 版は Windows 機でビルドできない
ので、リリース公開後に CI が `scripts/add-linux-to-latest-json.mjs` で
`linux-x86_64` の項目を追記し、同じリリースへ上げ直す。

これには**署名鍵をリポジトリのシークレットに置く必要がある**。

```powershell
Get-Content "$env:USERPROFILE\.tauri\miomail.key" -Raw | gh secret set TAURI_SIGNING_PRIVATE_KEY --repo firemio/miomail
```

鍵のパスフレーズを設定している場合は `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` も
同じように登録する（`release.ps1` は空で使っている）。

シークレットが無いうちは、CI は `createUpdaterArtifacts` を落としてビルドし、
`latest.json` にも触らない。つまり deb / AppImage は作られるが、Linux の自動更新は
無効のまま。鍵を入れた次のリリースから有効になる。

### データの置き場所

`db::default_db_path()` は Tauri の `app_data_dir` と同じ場所を返す必要がある。

- Windows: `%APPDATA%/com.firemio.miomail/miomail.db`
- Linux: `$XDG_DATA_HOME`（既定 `~/.local/share`）`/com.firemio.miomail/miomail.db`

MCP サーバーは Tauri の AppHandle を持たないので、この関数で場所を解決する。
`MIOMAIL_DB` で上書きできる。

## 仮想マシンで画面が真っ白になるとき

GPU の無い環境では WebKitGTK の描画が失敗することがある。

```sh
WEBKIT_DISABLE_DMABUF_RENDERER=1 miomail
```

アプリ側でこの環境変数は設定していない（GPU のあるデスクトップでは
不要なため）。サイトの Muse ガイドと設定プロンプトに回避策として載せてある。
