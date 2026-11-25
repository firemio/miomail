// Muse(Meta の AI エージェント)に貼り付けて、仮想マシンへ MioMail を入れて
// もらうためのプロンプト。手順を変えるときは docs/LINUX.md も合わせて見直すこと。
//
// 設計の前提(2026-11 時点。実機のスペースを調べて分かったこと):
//   - Muse のスペースは、VM のポートに繋がった **blob: の iframe**。
//     `allow-same-origin` が無いので、中の画面には自分のオリジンが無い。
//     つまり ./assets/... を取りに行けず、fetch も EventSource も使えず、
//     localStorage は触るだけで SecurityError になる。
//     → MioMail 側に「1ファイル完結の画面」と「外側へ postMessage で頼む経路」を用意した。
//   - Muse が利用者に操作を渡せるのは、そのスペースかブラウザーだけ。VM のデスクトップは
//     スクリーンショットしか返らず、指で触れない(利用者に却下済み)。
//   - 自作のWebメール画面を作らせてはいけない。相棒キャラクターもテーマも
//     再現できず、別物になる(これも却下済み)。
//   - 仮想マシンは1〜2時間おきに入れ替わり、システム領域が初期化される。
//     だから /usr/bin へは入れず、ホームの中へ展開させる。ホームは残る。
export const MUSE_SETUP_PROMPT = `MioMail をこの仮想マシン(Ubuntu)に入れて、私がスマホから使える状態にしてください。

【MioMail とは】
IMAP/SMTP のメールクライアントです。アプリ本体と、AIエージェント用の MCP サーバー(miomail-mcp。stdio、引数なし)が同梱されています。メールはこの仮想マシンの中だけに置かれ、外のサーバーへは送られません。
相棒キャラクターとキャラクターMOD、テーマがあり、画面デザインはアプリの大切な一部です。

本体には \`miomail --serve\` という起動の仕方があります。アプリとまったく同じ画面を、この仮想マシンの中だけで開ける HTTP として出します。幅900px未満では1カラム表示になるので、スマホからそのまま使えます。

【やらないでほしいこと】
・見た目を似せた自作のWebメール画面。キャラクターもMODもテーマも再現できず、私は「MioMail らしくない」と却下します。画面を作らないでください。\`miomail --serve\` が本体の画面をそのまま出します。
・画面を撮ってタップを送り返す「リモコン方式」。遅くて使い物になりません。Xvfb も VNC も要りません。
・MioMail を /usr/bin へ入れること。この仮想マシンでは入れ替えのたびに消えます。

【できあがりの姿】
1. MioMail がホームの中に入っていて、私のメールアカウントが設定されている
2. Muse のスペースを開くと MioMail の画面がそのまま出て、スマホから読んで、書いて、送れる
3. あなたが miomail-mcp 経由で私のメールを扱える
4. 仮想マシンが入れ替わっても、コマンド1つで元に戻せる

【1. 入れる — ホームの中へ展開してください】
起動直後はプラットフォーム側のパッケージ復旧が apt のロックを掴んでいることがあります。待ってから実行してください。

sudo apt-get update
sudo apt-get install -y libwebkit2gtk-4.1-0 libayatana-appindicator3-1 libdbus-1-3
wget -O /tmp/MioMail-amd64.deb https://github.com/firemio/miomail/releases/latest/download/MioMail-amd64.deb
rm -rf "$HOME/miomail-app"
dpkg -x /tmp/MioMail-amd64.deb "$HOME/miomail-app"

\`sudo apt-get install ./MioMail-amd64.deb\` はしないでください。この仮想マシンは入れ替えでシステム領域が初期化され、ローカルファイルから入れたものは復旧されません。ホームの中に置けば残ります。
展開すると、こう並びます。この並びを崩さないでください(本体が同じ場所からの相対でMODを探します)。
  本体       : ~/miomail-app/usr/bin/miomail
  MCPサーバー : ~/miomail-app/usr/bin/miomail-mcp
  同梱MOD    : ~/miomail-app/usr/lib/MioMail/mods

ライブラリ3つは apt で名前を指定して入れるので、入れ替え後に自動で戻ります。

【2. 動かす】
次の内容を ~/miomail-start.sh として保存し、実行してください。

#!/bin/sh
set -e
APP="$HOME/miomail-app/usr/bin/miomail"
if [ ! -x "$APP" ]; then
  echo "MioMail がありません。~/miomail-recover.sh を実行してください。" >&2
  exit 1
fi
pkill -f 'miomail --serve' 2>/dev/null || true
nohup "$APP" --serve --port 7272 --single-file --no-token >>"$HOME/miomail-serve.log" 2>&1 &
sleep 3
if curl -sf -o /dev/null http://127.0.0.1:7272/; then
  echo "MioMail は http://127.0.0.1:7272/ で動いています"
else
  echo "起動できませんでした。$HOME/miomail-serve.log を見てください。" >&2
  exit 1
fi

・127.0.0.1 だけで待ち受けます。仮想マシンの外からは見えません。
・\`--serve\` はウィンドウを開きません。画面の無い仮想マシンでそのまま動くので、Xvfb も WEBKIT_DISABLE_DMABUF_RENDERER も要りません。
・\`--single-file\` は、外部ファイルを一切参照しない1枚の HTML を返させる指定です。スペースの枠に入れるのに必要です。
・\`--no-token\` は合言葉を求めない指定です。スペースの枠は URL に合言葉を足せないので外しています。127.0.0.1 限定のときだけ使えます。
・うまく動かないときは ~/miomail-serve.log を見てください。

【3. スペースを作って、スマホから触れるようにしてください】
私が触るのはスペースです。スペースの中身は、あなたが書くのではなく、MioMail が出すものをそのまま使ってください。

**映す画面**: http://127.0.0.1:7272/ が返す HTML を、1枚の画面としてそのまま使ってください。JS も CSS も画像もその中に入っています。書き換えないでください。2.3MB ほどあるので、チャットへ貼らずにファイルのまま扱ってください(\`curl -s http://127.0.0.1:7272/ > ~/miomail-space.html\` で取り出せます)。

**画面からサーバーへの問い合わせ**: スペースの画面は利用者のブラウザーの中で動くので、この仮想マシンの 127.0.0.1 には届きません。実測でも http://127.0.0.1:7272/ と http://localhost:7272/ の両方が TypeError: Failed to fetch で落ちます。仮想マシンに届くのはスペースの**サーバーアクション**だけです。

そこで、MioMail の HTML はあなたのスペースの画面の中に iframe で置いて、その外側で中継してください。画面の側はこう頼みます。

  { miomail: 1, hello: 1 }                                 最初の挨拶
  { miomail: 1, id: <番号>, cmd: <文字列>, args: <オブジェクト> }

外側(あなたが書く側)がやることは2つだけです。

  1. hello を受けたら { miomail: 1, ready: 1 } を返す
  2. cmd を受けたら、**サーバーアクションから**
       POST http://127.0.0.1:7272/__miomail/invoke
       Content-Type: application/json
       {"cmd": <cmd>, "args": <args>}
     を叩き、返ってきた JSON をそのまま
       { miomail: 1, id: <同じ番号>, reply: <その JSON> }
     として画面へ返す。叩けなければ
       { miomail: 1, id: <同じ番号>, error: "<理由>" }

ブラウザーから直に POST しても届きません。必ずサーバーアクション越しにしてください。
口はこの1本だけです。メールも、添付も、キャラクターMODの絵も、新着の通知も、設定の保存も、すべてここを通ります。他のURLを用意する必要はありません。
画面は挨拶の返事が2.5秒来なければ、自分で fetch に切り替えます。中継の要らない置き方ができるなら、それでも動きます。
枠は縦長(スマホ幅)で構いません。幅900px未満で1カラムになります。

スペースに「繋がらない」と出たら、たいてい仮想マシンが入れ替わって MioMail が止まっています。~/miomail-start.sh を実行し直してください。

【4. アカウント設定は私がやります】
スペースが開いたら、そこで止めて私に知らせてください。アカウントが未設定なら設定画面が最初に出ます。メールアドレス・サーバー名・パスワードは私が自分で入力します。あなたは入力しないでください。チャットでパスワードを聞かないでください。
私が「終わった」と言ったら、次で確認してください。アカウントが1件返れば成功です。

echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_accounts","arguments":{}}}' | ~/miomail-app/usr/bin/miomail-mcp

【5. miomail-mcp をあなたの MCP サーバーとして登録してください】
~/miomail-app/usr/bin/miomail-mcp は、標準入力に1行の JSON-RPC 2.0 を渡すと標準出力に1行返すコマンドです(MCP / protocolVersion 2024-11-05)。初期化のやり取りは要りません。
使えるツールは次で取れます。

echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | ~/miomail-app/usr/bin/miomail-mcp

sync / list_accounts / list_folders / list_messages / get_message / search_messages / send_mail / mark_read / delete_message が使えます。
semantic_search(意味での検索)は Windows 版のみの機能です。Linux では search_messages を使ってください。

【6. 入れ替わったときの戻し方】
この仮想マシンは再起動や入れ替えでシステム領域が初期化されます。ホーム配下(メールDB・パスワード・設定)は消えません。
次の内容を ~/miomail-recover.sh として保存してください。入れ替わったあとはこれだけで元に戻ります。

#!/bin/sh
set -e
while sudo fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1; do sleep 5; done
sudo apt-get update
sudo apt-get install -y libwebkit2gtk-4.1-0 libayatana-appindicator3-1 libdbus-1-3
if [ ! -x "$HOME/miomail-app/usr/bin/miomail" ]; then
  wget -qO /tmp/MioMail-amd64.deb https://github.com/firemio/miomail/releases/latest/download/MioMail-amd64.deb
  rm -rf "$HOME/miomail-app"
  dpkg -x /tmp/MioMail-amd64.deb "$HOME/miomail-app"
fi
sh "$HOME/miomail-start.sh"

ふつうは本体が残っているので、ライブラリを戻して起動し直すだけで済みます。スペースは作り直さなくて構いません。

【この環境での注意】
・メールサーバーへの外向き通信を許可してください。IMAP は 993(TLS必須。非TLSのIMAPは未対応です)、SMTP は 465 または 587 を使います。
・パスワードは、メールDBと同じフォルダーに暗号化して保存します(credentials.json と鍵の credentials.key。どちらも 0600)。ホームの中なので、仮想マシンが入れ替わっても残ります。
・テーマや相棒の選択、書きかけのメールは、枠の中では localStorage が使えないため MioMail のデータベースへ預かります。こちらも入れ替えで消えません。
・自動更新はこの入れ方では働きません。新しくするときは ~/miomail-recover.sh の中の \`if [ ! -x ... ]\` を外して実行し、入れ直してください。
・New Outlook からの取り込みは Windows 版のみの機能です。

【進め方】
・各段階で「何ができて、何ができていないか」を正確に報告してください。できていない部分を、できたように見せないでください。
・方式の選択肢がある場合は、勝手に決めず、選択肢とおすすめを示して私に聞いてください。

【重要】send_mail(即時送信)と delete_message(ゴミ箱へ移動)は取り消せません。私が頼んでいない送信・削除はしないでください。送る前には宛先・件名・本文を私に見せて、私が許可してから送ってください。`
