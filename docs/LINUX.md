# Linux 版

Meta Muse の仮想マシン（ユーザーごとに割り当てられる Ubuntu のクラウドPC）で
MioMail を動かすための対応。スマホから操作する前提なので、画面が狭いときは
1カラム表示に切り替わる。

利用者向けの手順は [サイトの Muse ガイド](https://miomail.app/muse.html)。
ここは開発側のメモ。

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
deb / AppImage を作り、更新用の署名アーティファクトは作らない（署名鍵を
CI に置かないため）。MCP サーバーは `/usr/bin/miomail-mcp` へ入れている。

## Windows と違うところ

| 機能 | Linux での扱い |
|------|----------------|
| パスワードの保存 | secret-service（GNOME キーリング等）があればそこへ。無ければカーネルキーリング（keyutils）へ退避する |
| 自動更新 | 無効（deb / AppImage に更新アーティファクトを作っていない）。更新は deb を入れ直す |
| セマンティック検索 | 使えない。Windows ML が前提のため。キーワード検索はそのまま使える |
| New Outlook からの取り込み | 使えない。取り出しスクリプトが Windows の COM を使うため |
| トレイアイコン | libayatana-appindicator3 が必要（deb の依存に入れてある） |

### パスワードの保存について

`src-tauri/src/credentials.rs` は Linux で保存先を2つ持つ。

- **secret-service** … 再起動後も残る。常駐デーモンと D-Bus セッションが要る
- **カーネルキーリング(keyutils)** … 常駐も D-Bus も不要で必ず動くが、
  `keyring` クレートが `UntilReboot` と宣言しているとおり再起動で消える

保存時は両方へ書き、読むときはどちらかにあれば使う。画面の無い環境では
secret-service が使えないので後者だけが残り、仮想マシンを再起動すると
パスワードが消える。その場合は同期時に「パスワードを再入力してください」が
出るので、設定 → メールアカウント から入れ直す。

`gnome-keyring` を入れてログインセッションで解錠されていれば、再起動後も残る。

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
