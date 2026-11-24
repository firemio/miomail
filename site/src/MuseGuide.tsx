import { AlertTriangle, ArrowLeft, Bot, Download, ShieldCheck, Smartphone, Sparkles, Terminal } from 'lucide-react'
import { DOWNLOAD_URL, LINUX_APPIMAGE_URL, LINUX_DEB_URL } from './links'
import { useLatestVersion } from './version'
import { MUSE_SETUP_PROMPT } from './museSetup'
import { CopyPromptButton } from './mcpSetup'
import logoImage from '../../src/renderer/assets/miomail-logo.png'

const APT_DEPS = `sudo apt-get update
sudo apt-get install -y libwebkit2gtk-4.1-0 libayatana-appindicator3-1 libdbus-1-3 gnome-keyring`

const INSTALL_DEB = `wget -O MioMail-amd64.deb https://github.com/firemio/miomail/releases/latest/download/MioMail-amd64.deb
sudo apt-get install -y ./MioMail-amd64.deb
miomail`

const BLANK_WINDOW = `WEBKIT_DISABLE_DMABUF_RENDERER=1 miomail`

const FIND_MCP = `command -v miomail-mcp
dpkg -L miomail | grep miomail-mcp`

const DIFFERENCES: [string, string][] = [
  ['メールの送受信(IMAP / SMTP)', '使える'],
  ['添付ファイル・キャラクターMOD・8言語の表示切り替え', '使える'],
  ['MCPサーバー(AIエージェント連携)', '使える'],
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
          Muse 自身に MCP でメールを扱わせることもできます。
        </p>
        <div className="site-docs-note">
          <Smartphone size={18} />
          <span>
            <strong>スマホからの操作を前提にしています:</strong> 画面の幅が狭いときは
            フォルダ・メール一覧・本文を1画面ずつ表示する1カラム表示に切り替わります。
            指で押せる戻るボタンで行き来できます。
          </span>
        </div>

        <h2><Sparkles size={20} /> かんたん設定: Museに貼り付ける(おすすめ)</h2>
        <p>
          <strong>下の文章をコピーして、Museとの会話にそのまま貼り付けるだけ</strong>です。
          Museが仮想マシンの中でライブラリの用意・ダウンロード・インストール・起動までやってくれます。
          メールアカウントのパスワードは<strong>あなた自身がMioMailの画面に入力します</strong>
          (プロンプトにもそう書いてあります)。
        </p>
        <div className="site-docs-prompt">
          <pre className="site-docs-code">{MUSE_SETUP_PROMPT}</pre>
          <CopyPromptButton prompt={MUSE_SETUP_PROMPT} />
        </div>
        <ul>
          <li>Museは外向きの通信に承認を求めることがあります。メールサーバーへの接続(IMAP 993 / SMTP 465・587)を許可してください。</li>
          <li>アカウント設定の画面まで進んだら、Museの手は止まります。そこから先はあなたが入力してください。</li>
        </ul>

        <h2><Terminal size={20} /> 手動で入れる</h2>
        <ol className="site-docs-steps">
          <li>
            必要なライブラリを入れます。
            <pre className="site-docs-code">{APT_DEPS}</pre>
          </li>
          <li>
            最新版の deb を入れて起動します(URLは常に最新版を指します)。
            <pre className="site-docs-code">{INSTALL_DEB}</pre>
          </li>
          <li>
            アカウント設定の画面で、メールアドレス・サーバー名・パスワードを入力します。
            パスワードはOSの資格情報ストアに保存され、MioMailの外へ出ることはありません。
          </li>
        </ol>
        <p>
          deb は apt の管理下に入るので導入も削除も簡単ですが、更新は新しい deb を入れ直す形になります。
          <strong>自動更新を使いたいなら <a href={LINUX_APPIMAGE_URL}>AppImage版</a></strong> を選んでください
          (<code>chmod +x</code> して実行。Ubuntuでは <code>libfuse2</code> が必要です)。
          deb の直リンクは <a href={LINUX_DEB_URL}>こちら</a>。どちらも x86_64 用です。
        </p>

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

        <h2>Museにメールを扱わせる(MCP)</h2>
        <p>
          MioMailのMCPサーバーも一緒に入ります。stdioで動く小さなプログラムで、
          実行ファイルは <code>/usr/bin/miomail-mcp</code> です。見つからないときは次で探せます。
        </p>
        <pre className="site-docs-code">{FIND_MCP}</pre>
        <p>
          これをMuse自身のMCP設定にstdioサーバーとして登録すると、受信箱の確認・検索・送信を
          頼めるようになります。ツールの一覧と使い方は <a href="./mcp.html">MCPガイド</a> にあります。
        </p>
        <div className="site-docs-note">
          <AlertTriangle size={18} />
          <span>
            <strong>送信・削除は取り消せません:</strong> <code>send_mail</code>(即時送信)と
            <code>delete_message</code>(ゴミ箱へ移動)は実行すると元に戻せません。
            エージェントに任せる範囲は、内容を確認せずに実行されても困らないところまでにしてください。
          </span>
        </div>

        <h2>うまくいかないとき</h2>
        <h3>ウィンドウが真っ白で何も出ない</h3>
        <p>
          GPUの無い仮想マシンでは、WebKitGTKの描画が失敗することがあります。
          いったん終了して、次のように起動し直してください。
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
