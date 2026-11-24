import { AlertTriangle, ArrowLeft, Bot, Download, ShieldCheck, Smartphone, Sparkles, Terminal } from 'lucide-react'
import { DOWNLOAD_URL, LINUX_APPIMAGE_URL, LINUX_DEB_URL } from './links'
import { useLatestVersion } from './version'
import { MUSE_SETUP_PROMPT } from './museSetup'
import { CopyPromptButton } from './mcpSetup'
import logoImage from '../../src/renderer/assets/miomail-logo.png'

const APT_DEPS = `sudo apt-get update
sudo apt-get install -y libwebkit2gtk-4.1-0 libayatana-appindicator3-1 libdbus-1-3 gnome-keyring`

const INSTALL_DEB = `wget -O MioMail-amd64.deb https://github.com/firemio/miomail/releases/latest/download/MioMail-amd64.deb
sudo apt-get install -y ./MioMail-amd64.deb`

const SCREEN_DEPS = `sudo apt-get install -y xvfb x11vnc novnc websockify matchbox-window-manager`

const SCREEN_SCRIPT = `#!/bin/sh
nohup Xvfb :9 -screen 0 420x880x24 >>~/miomail-screen.log 2>&1 &
sleep 1
DISPLAY=:9 nohup matchbox-window-manager -use_titlebar no >>~/miomail-screen.log 2>&1 &
DISPLAY=:9 WEBKIT_DISABLE_DMABUF_RENDERER=1 nohup miomail >>~/miomail-screen.log 2>&1 &
sleep 2
nohup x11vnc -display :9 -forever -nopw -localhost -rfbport 5900 >>~/miomail-screen.log 2>&1 &
nohup websockify --web=/usr/share/novnc 6080 localhost:5900 >>~/miomail-screen.log 2>&1 &`

const SCREEN_URL = 'http://localhost:6080/vnc.html?autoconnect=1&resize=scale'

const BLANK_WINDOW = `WEBKIT_DISABLE_DMABUF_RENDERER=1 miomail`

const MCP_TOOLS = `echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | /usr/bin/miomail-mcp`

const MCP_ACCOUNTS = `echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_accounts","arguments":{}}}' | /usr/bin/miomail-mcp`

const DIFFERENCES: [string, string][] = [
  ['メールの送受信(IMAP / SMTP)', '使える'],
  ['添付ファイル・キャラクターMOD・8言語の表示切り替え', '使える'],
  ['MCPサーバー(AIエージェント連携)', '使える。Museのカスタムコネクタの口になる'],
  ['画面を指で直接操作する', 'ブラウザ経由(noVNC)で行う。Museはデスクトップアプリを操作できない'],
  ['パスワードの保存', 'GNOMEキーリングがあればそこへ。無ければ暗号化したファイルへ退避する(再起動後も残る)'],
  ['自動更新', 'AppImage版のみ。debは新しいdebを入れ直す'],
  ['セマンティック検索(意味での検索)', '使えない。Windows ML が前提のため'],
  ['New Outlook からの取り込み', '使えない。取り出しスクリプトが Windows の COM を使うため'],
]

export function MuseGuide() {
  const version = useLatestVersion()

  return (
    <div className="site-docs">
      <header className="site-docs-header">
        <a href="./" aria-label="MioMail ホーム">
          <img className="site-brand__logo" src={logoImage} alt="MioMail" draggable={false} />
        </a>
        <nav>
          <a href="./">トップ</a>
          <a href="./mcp.html">MCPガイド</a>
          <a href="./mods.html">MODガイド</a>
          <a href={DOWNLOAD_URL}><Download size={13} /> ダウンロード</a>
        </nav>
      </header>

      <main>
        <h1>Museの仮想マシンでMioMailを使う</h1>
        <p className="site-docs-lead">
          Meta の <Bot size={14} /> <strong>Muse</strong> では、ユーザーひとりごとに
          Ubuntu Linux のクラウドPC(Muse Secure VM)が割り当てられ、スマホや web から操作します。
          MioMail には Linux 版があるので、この仮想マシンに入れて
          <strong>自分のメールをその中で読み書きする</strong>ことができます。
          普段の読み書きは、Museがアプリの中に作る<strong>「スペース」</strong>から行います。
        </p>
        <div className="site-docs-note">
          <Smartphone size={18} />
          <span>
            <strong>Museでは、デスクトップアプリの画面を指で触れません。</strong>
            Museが操作を代われるのはブラウザだけなので、仮想マシンのデスクトップでMioMailを
            起動しても、返ってくるのはVMの画面の大きさのスクリーンショットだけです。
            この手順では<strong>MioMailの画面をブラウザから開ける形</strong>にして、
            スマホの縦画面に合う420x880で映します。幅900px未満なので1カラム表示になり、
            指で押せる戻るボタンで行き来できます。
          </span>
        </div>

        <h2>3つの部品でできています</h2>
        <ul>
          <li>
            <strong>MioMail本体</strong> … 仮想マシンの中にメールを保管し、IMAP/SMTPでやりとりします。
            初回のアカウント設定と、画面を直接触りたいときに使います。
          </li>
          <li>
            <strong>カスタムコネクタ</strong> … 同梱の <code>/usr/bin/miomail-mcp</code> を
            Muse自身が呼べるようにしたものです。審査は要りません。Museに頼めば、
            このコマンドに対してコネクタを作ってくれます。
          </li>
          <li>
            <strong>スペース</strong> … Museがアプリの中に作る、あなた専用の画面です。
            受信箱・本文・返信・検索をここから操作します。普段使いはこれです。
          </li>
        </ul>

        <h2><Sparkles size={20} /> かんたん設定: Museに貼り付ける(おすすめ)</h2>
        <p>
          <strong>下の文章をコピーして、Museとの会話にそのまま貼り付けるだけ</strong>です。
          Museが仮想マシンの中で、インストール → 画面をブラウザから開ける形にする →
          コネクタを作る → スペースを作る、まで進めてくれます。
          メールアカウントのパスワードは<strong>あなた自身がMioMailの画面に入力します</strong>
          (プロンプトにもそう書いてあります)。
        </p>
        <div className="site-docs-prompt">
          <pre className="site-docs-code">{MUSE_SETUP_PROMPT}</pre>
          <CopyPromptButton prompt={MUSE_SETUP_PROMPT} />
        </div>
        <ul>
          <li>Museは外向きの通信に承認を求めることがあります。メールサーバーへの接続(IMAP 993 / SMTP 465・587)を許可してください。</li>
          <li>
            Museが <code>localhost:6080</code> をブラウザで開いたら、
            <strong>「ブラウザの操作を代わる」(Take control)</strong>を押してください。
            そこに映っているのがMioMailの画面です。
          </li>
          <li>アカウント設定の画面まで進んだら、Museの手は止まります。パスワードはあなたが入力してください。</li>
        </ul>

        <h2><Terminal size={20} /> 手動で入れる</h2>
        <ol className="site-docs-steps">
          <li>
            必要なライブラリを入れます。
            <pre className="site-docs-code">{APT_DEPS}</pre>
          </li>
          <li>
            最新版の deb を入れます(URLは常に最新版を指します)。
            <pre className="site-docs-code">{INSTALL_DEB}</pre>
          </li>
          <li>
            画面をブラウザから開くための道具を入れます。
            <pre className="site-docs-code">{SCREEN_DEPS}</pre>
          </li>
          <li>
            次を <code>~/miomail-screen.sh</code> として保存し、<code>chmod +x</code> して実行します。
            420x880の仮想画面でMioMailを起動し、noVNCでブラウザに映します。
            <pre className="site-docs-code">{SCREEN_SCRIPT}</pre>
          </li>
          <li>
            ブラウザで <code>{SCREEN_URL}</code> を開き、MioMailの画面で
            メールアドレス・サーバー名・パスワードを入力します。
            パスワードはOSの資格情報ストアに保存され、MioMailの外へ出ることはありません。
          </li>
        </ol>
        <p>
          仮想マシンを再起動したら、<code>~/miomail-screen.sh</code> をもう一度実行してください。
          うまく動かないときは <code>~/miomail-screen.log</code> を見てください。
          5900番と6080番はループバックだけに開いているので、仮想マシンの外からは見えません。
        </p>
        <p>
          deb は apt の管理下に入るので導入も削除も簡単ですが、更新は新しい deb を入れ直す形になります。
          <strong>自動更新を使いたいなら <a href={LINUX_APPIMAGE_URL}>AppImage版</a></strong> を選んでください
          (<code>chmod +x</code> して実行。Ubuntuでは <code>libfuse2</code> が必要です)。
          deb の直リンクは <a href={LINUX_DEB_URL}>こちら</a>。どちらも x86_64 用です。
        </p>

        <h2>カスタムコネクタにする(スペースの土台)</h2>
        <p>
          MioMailのMCPサーバーも一緒に入ります。実行ファイルは <code>/usr/bin/miomail-mcp</code> で、
          <strong>標準入力に1行のJSON-RPC 2.0を渡すと標準出力に1行返す</strong>だけの作りです。
          初期化のやりとりは要らないので、シェルからそのまま呼べます。
        </p>
        <pre className="site-docs-code">{MCP_TOOLS}</pre>
        <p>
          これでツールの一覧と引数が返ります。Museのカスタムコネクタは
          <strong>CLIに対してMuse自身がコードを書いて作る</strong>仕組みなので、
          この1行を教えれば、あとはMuseが組み立てます。審査は要りません。
          アカウントが見えているかは、次で確かめられます。
        </p>
        <pre className="site-docs-code">{MCP_ACCOUNTS}</pre>
        <p>
          コネクタができたら、Museに<strong>「MioMailのスペースを作って」</strong>と頼みます。
          スペースは連携したアプリの内容を使えるので、受信箱の一覧・本文・返信・検索を
          スマホの画面に合う形で持てます。ツールの一覧と使い方は
          <a href="./mcp.html">MCPガイド</a> にあります。
        </p>
        <div className="site-docs-note">
          <AlertTriangle size={18} />
          <span>
            <strong>送信・削除は取り消せません:</strong> <code>send_mail</code>(即時送信)と
            <code>delete_message</code>(ゴミ箱へ移動)は実行すると元に戻せません。
            エージェントに任せる範囲は、内容を確認せずに実行されても困らないところまでにしてください。
          </span>
        </div>

        <h2>Windows版との違い</h2>
        <table className="site-docs-table site-docs-table--wrap">
          <thead>
            <tr><th>機能</th><th>Linux版での扱い</th></tr>
          </thead>
          <tbody>
            {DIFFERENCES.map(([feature, state]) => (
              <tr key={feature}><td>{feature}</td><td>{state}</td></tr>
            ))}
          </tbody>
        </table>

        <h2>うまくいかないとき</h2>
        <h3>スペースやスクリーンショットから操作できない</h3>
        <p>
          Museが操作を代われるのは<strong>ブラウザだけ</strong>です。仮想マシンのデスクトップで
          <code>miomail</code> を直接起動すると、返ってくるのはVMの画面の大きさの
          スクリーンショットだけで、指で押すことはできません。
          <code>~/miomail-screen.sh</code> でブラウザから開ける形にして、
          <code>{SCREEN_URL}</code> を開いてから「ブラウザの操作を代わる」を押してください。
        </p>
        <p>
          スペースから操作したいときは、先にカスタムコネクタを作る必要があります。
          スペースは、Museが持っている連携を通してしかメールに触れません。
        </p>

        <h3>ウィンドウが真っ白で何も出ない</h3>
        <p>
          GPUの無い仮想マシンでは、WebKitGTKの描画が失敗することがあります。
          <code>~/miomail-screen.sh</code> は最初からこれを避ける形で起動しますが、
          自分で起動するときは次のようにしてください。
        </p>
        <pre className="site-docs-code">{BLANK_WINDOW}</pre>

        <h3>「パスワードを再入力してください」と出る</h3>
        <p>
          パスワードはまずGNOMEキーリングに保存し、それが動いていない環境では
          暗号化したファイル(パーミッション0600)へ退避します。どちらも仮想マシンを
          再起動しても残るので、通常この案内は出ません。
          出たときは、設定 → メールアカウント からアカウントを開き、パスワードを
          入れ直して保存してください。
        </p>

        <h3>メールサーバーにつながらない</h3>
        <p>
          仮想マシンの外向き通信が許可されているか確認してください。
          IMAPは993、SMTPは465または587を使います。
        </p>

        <div className="site-docs-note">
          <ShieldCheck size={18} />
          <span>
            <strong>メールはあなたの仮想マシンの中にあります:</strong> MioMailは
            メールデータを外部のサーバーへ送る仕組みを持っていません。
            読み書きはすべて、あなたのメールサーバーとMioMailの間だけで行われます。
          </span>
        </div>

        <div className="site-docs-cta">
          <a className="site-button site-button--primary" href={LINUX_DEB_URL}>
            <Download size={18} /> Linux版(.deb)をダウンロード
          </a>
          <a className="site-text-link" href="./"><ArrowLeft size={15} /> トップへ戻る</a>
        </div>
      </main>

      <footer className="site-docs-footer">
        <span>v{version}</span>
        <span>© 2026 MioMail</span>
        <span style={{ display: 'inline-flex', gap: 18 }}>
          <a href="./mcp.html">MCPガイド</a>
          <a href="./mods.html">MODガイド</a>
          <a href="https://github.com/firemio/miomail">GitHub</a>
        </span>
      </footer>
    </div>
  )
}
