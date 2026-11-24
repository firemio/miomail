// Muse(Meta の AI エージェント)に貼り付けて、仮想マシンへ MioMail を入れて
// もらうためのプロンプト。手順を変えるときは docs/LINUX.md も合わせて見直すこと。
//
// 設計の前提(2026-11 時点):
//   - Muse が利用者に操作を渡せるのは「ブラウザ」だけ。VM上のデスクトップアプリは
//     スクリーンショットしか返らず、指で触れない。だから MioMail の画面は
//     noVNC でブラウザから開ける形にしてもらう。
//   - カスタムコネクタは「CLI に対して Muse がコードを書いて作る」もの(審査不要)。
//     同梱の miomail-mcp は1行JSON-RPCで呼べるので、これをコネクタの口にする。
//   - 「スペース」は Muse がアプリ内に作る画面で、連携したアプリの内容を使える。
//     普段使いはこれ。GUI は初回設定と、どうしても画面を触りたいときだけ。
export const MUSE_SETUP_PROMPT = `MioMail をこの仮想マシン(Ubuntu)に入れて、Muse の「スペース」から私のメールを読み書きできる状態にしてください。

【MioMail とは】
IMAP/SMTP のメールクライアントです。画面を持つアプリ本体と、コマンドとして呼べる MCP サーバー(miomail-mcp)が同梱されています。メールはこの仮想マシンの中だけに置かれ、外のサーバーへは送られません。

【できあがりの姿】
1. MioMail がこの仮想マシンに入っていて、私のメールアカウントが設定されている
2. あなたが MioMail をカスタムコネクタとして呼べる
3. 私が「スペース」から受信箱を見て、読んで、返信できる

【1. インストール】
sudo apt-get update
sudo apt-get install -y libwebkit2gtk-4.1-0 libayatana-appindicator3-1 libdbus-1-3 gnome-keyring
wget -O MioMail-amd64.deb https://github.com/firemio/miomail/releases/latest/download/MioMail-amd64.deb
sudo apt-get install -y ./MioMail-amd64.deb

【2. MioMail の画面を、あなたのブラウザから開ける形にしてください】
このあとのアカウント設定で、パスワードの入力が要ります。パスワードは私が自分で入力します。あなたは入力しないでください。
ただ、あなたのスクリーンショットや画面共有では私が押せません。私が操作を代われるのはブラウザだけなので、MioMail の画面をブラウザから開ける形にしてください。

sudo apt-get install -y xvfb x11vnc novnc websockify matchbox-window-manager

次の内容を ~/miomail-screen.sh として保存し、実行してください。

#!/bin/sh
nohup Xvfb :9 -screen 0 420x880x24 >>~/miomail-screen.log 2>&1 &
sleep 1
DISPLAY=:9 nohup matchbox-window-manager -use_titlebar no >>~/miomail-screen.log 2>&1 &
DISPLAY=:9 WEBKIT_DISABLE_DMABUF_RENDERER=1 nohup miomail >>~/miomail-screen.log 2>&1 &
sleep 2
nohup x11vnc -display :9 -forever -nopw -localhost -rfbport 5900 >>~/miomail-screen.log 2>&1 &
nohup websockify --web=/usr/share/novnc 6080 localhost:5900 >>~/miomail-screen.log 2>&1 &

できたら、あなたのブラウザで次を開き、「ブラウザの操作を代わる」で私に操作を渡して、私に知らせてください。
http://localhost:6080/vnc.html?autoconnect=1&resize=scale

・画面を420x880にしているのは、MioMail が幅900px未満で1カラム表示になり、スマホから押しやすくなるからです。VMの画面の大きさそのままでは、スマホからは小さすぎて読めません。
・vnc.html が無いときは vnc_lite.html を試してください。
・5900番と6080番はループバックだけに開いています。仮想マシンの外からは見えません。
・この仮想マシンを再起動したら、~/miomail-screen.sh をもう一度実行してください。
・うまく動かないときは ~/miomail-screen.log を見てください。パッケージ名やパスが違っていたら、同じことができる別の手段に替えて、何に替えたかを私に教えてください。

【3. アカウント設定は私がやります】
画面が出たら、そこで止めて私に知らせてください。メールアドレス・サーバー名・パスワードは私が自分で入力します。
私が「終わった」と言ったら、次のコマンドで確認してください。アカウントが1件返れば成功です。

echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_accounts","arguments":{}}}' | /usr/bin/miomail-mcp

【4. MioMail をカスタムコネクタにしてください】
/usr/bin/miomail-mcp は、標準入力に1行の JSON-RPC 2.0 を渡すと標準出力に1行返すコマンドです(MCP / protocolVersion 2024-11-05)。初期化のやり取りは要りません。1行入れて1行返るだけなので、シェルからそのまま呼べます。
ツールの一覧と引数は次で取れます。これを読んでコネクタを作ってください。

echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | /usr/bin/miomail-mcp

semantic_search(意味での検索)は Windows 版のみの機能で、Linux では使えません。代わりに search_messages を使ってください。

【5. 「MioMail」という名前のスペースを作ってください】
・受信箱: 新しい順に、差出人・件名・時刻・未読かどうか。選ぶと本文が読める
・返信と新規作成: 送る前に必ず下書きを私に見せて、私が許可してから送る
・検索: 言葉でメールを探せる
・新着の取り込み: sync を呼んでから一覧を出し直す
スマホの縦画面で読める大きさにしてください。

【この環境での注意】
・メールサーバーへの外向き通信を許可してください。IMAP は 993、SMTP は 465 または 587 を使います。
・パスワードは GNOME キーリングに保存します。使えない環境では、暗号化したファイル(パーミッション 0600)へ退避します。どちらも仮想マシンを再起動しても残ります。
・自動更新は AppImage 版のみ対応です。deb で入れた場合は、新しい deb を入れ直してください。
・画面を直接触りたくなったときは、いつでも ~/miomail-screen.sh を実行して上の URL を開いてください。

【重要】send_mail(即時送信)と delete_message(ゴミ箱へ移動)は取り消せません。私が頼んでいない送信・削除はしないでください。`
