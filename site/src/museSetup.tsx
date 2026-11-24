// Muse(Meta の AI エージェント)に貼り付けて、仮想マシンへ MioMail を入れて
// もらうためのプロンプト。手順を変えるときは docs/LINUX.md も合わせて見直すこと。
export const MUSE_SETUP_PROMPT = `MioMail をこの仮想マシン(Ubuntu)にインストールして、私が使える状態にしてください。

【MioMail とは】
IMAP/SMTP のメールクライアントです。画面を持つアプリ本体と、あなた(AIエージェント)用の MCP サーバーが同梱されています。

【手順】
1. 必要なライブラリを入れてください。
   sudo apt-get update
   sudo apt-get install -y libwebkit2gtk-4.1-0 libayatana-appindicator3-1 libdbus-1-3 gnome-keyring

2. 最新版をダウンロードしてください(この URL は常に最新版を指します)。
   wget -O MioMail-amd64.deb https://github.com/firemio/miomail/releases/latest/download/MioMail-amd64.deb

3. インストールしてください。
   sudo apt-get install -y ./MioMail-amd64.deb

4. 起動してください。
   miomail
   ウィンドウが真っ白なまま何も出ないときは、いったん終了して
   WEBKIT_DISABLE_DMABUF_RENDERER=1 miomail
   で起動し直してください(GPU の無い仮想マシンでは描画に失敗することがあります)。

5. アカウント設定の画面が出たら、そこで止めて私に知らせてください。
   メールアドレス・サーバー名・パスワードは私が自分で入力します。あなたは入力しないでください。

6. 私が「設定が終わった」と言ったら、MioMail の MCP サーバーをあなた自身に登録してください。
   実行ファイル: /usr/bin/miomail-mcp (stdio で起動。引数なし)
   見つからないときは command -v miomail-mcp や dpkg -L miomail で探してください。
   登録後に使えるツール: sync / list_accounts / list_folders / list_messages / get_message / search_messages / send_mail / mark_read / delete_message

【この環境での注意】
・メールサーバーへの外向き通信を許可してください。IMAP は 993、SMTP は 465 または 587 を使います。
・パスワードは GNOME キーリングに保存されます。キーリングが動いていない場合はカーネルキーリングに入るため、仮想マシンを再起動すると消えます。同期時に「パスワードを再入力してください」と出たら、設定 → メールアカウント から入れ直すよう私に伝えてください。
・画面が狭いときは1カラム表示に切り替わるので、スマホからでも操作できます。
・セマンティック検索(意味での検索)と New Outlook からの取り込みは Windows 版のみの機能です。キーワード検索はそのまま使えます。

【重要】send_mail(即時送信)と delete_message(ゴミ箱へ移動)は取り消せません。私が頼んでいない送信・削除はしないでください。`
