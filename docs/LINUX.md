# Linux 版

Meta Muse の仮想マシン（ユーザーごとに割り当てられる Ubuntu のクラウドPC）で
MioMail を動かすための対応。スマホから操作する前提なので、画面が狭いときは
1カラム表示に切り替わる。

利用者向けの手順は [サイトの Muse ガイド](https://miomail.app/muse.html)。
ここは開発側のメモ。

## Muse で使えるようにするための前提

Muse の実機で試したところ、**デスクトップアプリをそのまま起動しても Muse からは
操作できない**。この制約がプロンプト(`site/src/museSetup.tsx`)の形を決めている。

- Muse が利用者に操作を渡せるのは**ブラウザだけ**(Meta のヘルプいわく「サインインが
  一番よくある理由」)。VM のデスクトップは、VM の画面サイズのスクリーンショットが
  返るだけで、指で押せない
- 「スペース」(2026-11-06 の新機能)は Muse がアプリ内に作る画面で、**連携(コネクタ)を
  通してしか**データに触れない。VM の画面を映す窓ではない
- カスタムコネクタは**審査不要**で、「CLI に対して Muse 自身がコードを書いて作る」
  仕組み。`miomail-mcp` がその口になる

だから役割分担はこうなる。

| 役 | どこでやるか |
|----|--------------|
| 普段のメール操作 | スペース → カスタムコネクタ → `miomail-mcp` |
| 初回のアカウント設定 | 利用者がブラウザから(noVNC 経由で GUI を出す) |
| パスワードの入力 | 利用者のみ。エージェントには渡さない |

`miomail-mcp` は1行の JSON-RPC を標準入力に渡すと1行返す。`initialize` の
やりとりは要らないので、シェルから叩ける(確認済み)。

```sh
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | /usr/bin/miomail-mcp
```

GUI をブラウザに出すところは Xvfb + matchbox-window-manager + x11vnc + noVNC。
画面を **420x880** にするのは、`NARROW_LAYOUT_QUERY`(`max-width: 899px`)を下回らせて
1カラム表示にするため。VM の画面サイズのままでは、スマホからは小さすぎて読めない。
ウィンドウの既定は 1280x800 なので、画面サイズに合わせる WM(matchbox)が要る。

### 残っている課題

アカウント設定だけが GUI に依存している。Muse では利用者の入力経路がエージェントしか
ないため、パスワードをエージェントに渡さずに入力するには「ブラウザを乗っ取る」しかなく、
そのために VNC 一式が要る。**MioMail 自身が localhost に設定用のページを出せれば**
この依存は消える(`--setup-server` のようなオプトインと、ワンタイムトークンでの保護が前提)。

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

**2 の鍵の強さについて。** 鍵は `/etc/machine-id` と実行ユーザー名から導く。
ファイルだけを持ち出しても復号できないが、**同じ機械で同じユーザーとして動ける
人からは守れない**。ブラウザが keyring の無い環境で使う "basic" 保存と同程度で、
OS の資格情報ストアほど強くはない。`gnome-keyring` を入れてログインセッションで
解錠しておけば 1 が使われる。

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
