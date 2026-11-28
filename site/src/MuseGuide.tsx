import { AlertTriangle, ArrowLeft, Bot, Download, ShieldCheck, Smartphone, Sparkles, Terminal } from 'lucide-react'
import { DOWNLOAD_URL, LINUX_APPIMAGE_URL, LINUX_DEB_URL } from './links'
import { useLatestVersion } from './version'
import { MUSE_SETUP_PROMPT } from './museSetup'
import { CopyPromptButton } from './mcpSetup'
import logoImage from '../../src/renderer/assets/miomail-logo.png'

const APT_DEPS = `sudo apt-get update
sudo apt-get install -y libwebkit2gtk-4.1-0 libayatana-appindicator3-1 libdbus-1-3`

const INSTALL_DEB = `wget -O /tmp/MioMail-amd64.deb https://github.com/firemio/miomail/releases/latest/download/MioMail-amd64.deb
rm -rf "$HOME/miomail-app"
dpkg -x /tmp/MioMail-amd64.deb "$HOME/miomail-app"`

const SERVE_CMD = `~/miomail-app/usr/bin/miomail --serve --single-file --no-token`

const START_SCRIPT = `#!/bin/sh
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
fi`

const RECOVER_SCRIPT = `#!/bin/sh
set -e
while sudo fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1; do sleep 5; done
sudo apt-get update
sudo apt-get install -y libwebkit2gtk-4.1-0 libayatana-appindicator3-1 libdbus-1-3
if [ ! -x "$HOME/miomail-app/usr/bin/miomail" ]; then
  wget -qO /tmp/MioMail-amd64.deb https://github.com/firemio/miomail/releases/latest/download/MioMail-amd64.deb
  rm -rf "$HOME/miomail-app"
  dpkg -x /tmp/MioMail-amd64.deb "$HOME/miomail-app"
fi
sh "$HOME/miomail-start.sh"`

const MCP_TOOLS = `echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | ~/miomail-app/usr/bin/miomail-mcp`

const MCP_ACCOUNTS = `echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_accounts","arguments":{}}}' | ~/miomail-app/usr/bin/miomail-mcp`

const DIFFERENCES: [string, string][] = [
  ['メールの送受信(IMAP / SMTP)', '使える'],
  ['相棒キャラクター・キャラクターMOD・テーマ・8言語', '使える。アプリ本体と同じ画面がそのまま出る'],
  ['添付ファイル', '使える。選ぶのはブラウザのファイル選択、保存はブラウザのダウンロード'],
  ['MCPサーバー(AIエージェント連携)', '使える。Muse に登録すれば Muse からもメールを扱える'],
  ['ウィンドウの最小化・最大化・閉じる', 'ボタンを出さない。窓枠はブラウザが持っているため'],
  ['パスワードの保存', 'GNOMEキーリングがあればそこへ。無ければ暗号化したファイルへ退避する(仮想マシンが入れ替わっても残る)'],
  ['テーマ・相棒の選択・書きかけのメール', '保存はされるが、スペースを開き直すと元に戻る(v2.1.26 時点)。スペースの画面は、置いた時点の設定で始まるため'],
  ['自動更新', 'AppImage版のみ。debは新しいdebを入れ直す。スペースからは更新できない'],
  ['セマンティック検索(意味での検索)', '使えない。Windows ML が前提のため。言葉での検索はそのまま使える'],
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
        </p>
        <div className="site-docs-note">
          <Smartphone size={18} />
          <span>
            <strong>アプリの画面が、そのままMuseのスペースに入ります。</strong>
            <code>miomail --serve</code> で起動すると、MioMailは
            <strong>デスクトップ版とまったく同じ画面</strong>を、仮想マシンの中だけで
            開けるページとして出します。幅900px未満では1カラム表示になるので、
            スマホからそのまま使えます。作り直した画面ではないので、
            相棒キャラクターもキャラクターMODもテーマもそのままです。
          </span>
        </div>

        <h2>2つの部品でできています</h2>
        <ul>
          <li>
            <strong>MioMail本体</strong> … 仮想マシンの中にメールを保管し、IMAP/SMTPでやりとりします。
            <code>--serve</code> を付けて起動すると、同じ画面をブラウザから開けるようにします。
            あなたが読み書きするのはここです。
          </li>
          <li>
            <strong>MCPサーバー</strong> … 同梱の <code>miomail-mcp</code> です。
            Muse に登録すると、Muse 自身があなたのメールを読んだり、下書きを作ったりできます。
          </li>
        </ul>

        <h2><Sparkles size={20} /> かんたん設定: Museに貼り付ける(おすすめ)</h2>
        <p>
          <strong>下の文章をコピーして、Museとの会話にそのまま貼り付けるだけ</strong>です。
          Museが仮想マシンの中で、インストール → 起動 → スマホから触れるスペースを作る →
          MCPサーバーの登録 → 復旧スクリプトの用意、まで進めてくれます。
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
            Museが<strong>スペース</strong>を作ります。サイドバーのそのスペースを開くと、
            MioMailの画面がそのまま出ます。これがあなたの普段の入り口です。
          </li>
          <li>アカウントが未設定なら、最初に設定画面が出ます。パスワードはあなたが入力してください。</li>
        </ul>

        <h2>スペースに本物のMioMailが入ります</h2>
        <p>
          Museのスペースは、仮想マシンのポートに繋がった<strong>枠</strong>です。
          その枠には<strong>自分のアドレスが無い</strong>ため、ふつうのWebページのように
          別ファイルを読みに行ったり、ブラウザに設定を覚えさせたりできません。
          MioMailは、この枠のために
        </p>
        <ul>
          <li><strong>画面を1枚のファイルにまとめて返します</strong>(<code>--single-file</code>)。文字も絵もキャラクターも、ぜんぶその中です。</li>
          <li><strong>問い合わせ口を1つにまとめています。</strong>メールも添付もMODの絵も新着の知らせも、同じ1本を通ります。Muse側に書いてもらう中継はごく短いもので済みます。</li>
          <li><strong>テーマ・相棒の選択・書きかけのメールは、MioMailのデータベースに保存します。</strong>枠がブラウザに覚えさせられない分をこちらで持ちます。保存したものは仮想マシンが入れ替わっても消えません。ただし v2.1.26 の時点では、<strong>スペースを開き直すと元に戻ります</strong>。スペースの画面は、Museが置いた時点の設定を持ったまま始まるためです。</li>
          <li><strong>親のページの合言葉を書き写してもらってから渡します。</strong>枠の中の画面は、それを載せているページの安全設定(Content-Security-Policy)を引き継ぐ決まりです。そのままでは中のスクリプトが1行も動かないので、枠に入れる前にページ側の合言葉(nonce)を写してもらいます。Muse側に書いてもらうのは数行です。</li>
          <li><strong>スマホへは、小分けにして運んでもらいます。</strong>スペースのファイルは、開くたびに仮想マシンから運ばれます。画面のファイルを1つのまま置くと、PCでは開けてもスマホには届きませんでした。プロンプトでは、200,000バイト以下の部品に切って置くよう頼んでいます。</li>
        </ul>
        <p>
          画面を作り直しているわけではありません。<strong>デスクトップ版とまったく同じ画面</strong>が、
          そのまま枠に入ります。
        </p>

        <h2><Terminal size={20} /> 手動で入れる</h2>
        <ol className="site-docs-steps">
          <li>
            必要なライブラリを入れます。
            <pre className="site-docs-code">{APT_DEPS}</pre>
          </li>
          <li>
            最新版の deb を<strong>ホームの中へ展開します</strong>(URLは常に最新版を指します)。
            <pre className="site-docs-code">{INSTALL_DEB}</pre>
            <code>sudo apt-get install ./MioMail-amd64.deb</code> は使いません。
            Museの仮想マシンは入れ替えのたびに <code>/usr</code> が初期化されるので、
            ホームの中に置けば消えません。
          </li>
          <li>
            ブラウザから開ける状態で起動します。
            <pre className="site-docs-code">{SERVE_CMD}</pre>
          </li>
          <li>
            <code>http://127.0.0.1:7272/</code> を開き、メールアドレス・サーバー名・パスワードを入力します。
            パスワードは仮想マシンの中に暗号化して保存され、MioMailの外へ出ることはありません。
          </li>
        </ol>
        <p>
          <code>--serve</code> は既定で <strong>127.0.0.1 の 7272番</strong>だけで待ち受けます。
          仮想マシンの外からは見えません。ポートは <code>--port</code> で変えられます。
          ふだんは合言葉付きのURL(<code>?t=…</code>)で守りますが、
          スペースの枠はURLに合言葉を足せないので <code>--no-token</code> で外します。
          これは <strong>127.0.0.1 で待ち受けているときだけ</strong>指定できます。
        </p>
        <p>
          入れ替わったあとも一発で戻せるよう、次を
          <code>~/miomail-start.sh</code> として保存しておいてください。
        </p>
        <pre className="site-docs-code">{START_SCRIPT}</pre>
        <p>
          deb は apt の管理下に入るので導入も削除も簡単ですが、更新は新しい deb を入れ直す形になります。
          <strong>自動更新を使いたいなら <a href={LINUX_APPIMAGE_URL}>AppImage版</a></strong> を選んでください
          (<code>chmod +x</code> して実行。Ubuntuでは <code>libfuse2</code> が必要です)。
          deb の直リンクは <a href={LINUX_DEB_URL}>こちら</a>。どちらも x86_64 用です。
        </p>

        <h2>仮想マシンが入れ替わったとき</h2>
        <p>
          Muse の仮想マシンは、1〜2時間おきに入れ替わって<strong>システム領域が初期化される</strong>ことがあります。
          <strong>ホームの中(メール・パスワード・設定・MioMail本体)は消えません</strong>。
          消えるのは <code>/usr</code> のライブラリと、動いていたプロセスです。
          ライブラリは apt で名前を指定して入れてあるので自動で戻り、あとは起動し直すだけです。
          次を <code>~/miomail-recover.sh</code> として置いておいてください。
          スペースを開いて「アカウントを追加してください」と出たり、メールが1通も出なかったりしたら、たいていこれで直ります。アカウントもメールも消えていません。スペースを作り直す必要はありません。
        </p>
        <pre className="site-docs-code">{RECOVER_SCRIPT}</pre>

        <h2>Museにもメールを扱わせる(MCP)</h2>
        <p>
          MioMailのMCPサーバーも一緒に入ります。実行ファイルは <code>~/miomail-app/usr/bin/miomail-mcp</code> で、
          <strong>標準入力に1行のJSON-RPC 2.0を渡すと標準出力に1行返す</strong>だけの作りです。
          初期化のやりとりは要らないので、シェルからそのまま呼べます。
        </p>
        <pre className="site-docs-code">{MCP_TOOLS}</pre>
        <p>
          これでツールの一覧と引数が返ります。Museに
          <strong>「このコマンドをMCPサーバーとして登録して」</strong>と頼めば、あとはMuseが組み立てます。
          アカウントが見えているかは、次で確かめられます。
        </p>
        <pre className="site-docs-code">{MCP_ACCOUNTS}</pre>
        <p>
          ツールの一覧と使い方は <a href="./mcp.html">MCPガイド</a> にあります。
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
        <h3>ブラウザで開いても「権限がありません」と出る</h3>
        <p>
          URLの末尾に付く <code>?t=…</code> が合言葉です。これが無いと開けません。
          <code>miomail --serve</code> を実行した端末に表示されたURLを、そのまま開いてください。
          一度開けば合言葉はブラウザが覚えるので、次からは <code>?t=…</code> 無しでも開けます。
        </p>

        <h3>スクリーンショットからは操作できない</h3>
        <p>
          仮想マシンのデスクトップで <code>miomail</code> を<strong>そのまま</strong>起動すると、
          返ってくるのはVMの画面の大きさのスクリーンショットだけで、指で押すことはできません。
          Museが操作を渡せるのは<strong>スペースかブラウザだけ</strong>です。
          <code>--serve</code> を付けて起動し、スペースから開いてください。
        </p>

        <h3>似ているけれど別物の画面が出てきた</h3>
        <p>
          エージェントが<strong>自分でWebメールを作ってしまった</strong>ときです。
          相棒キャラクターもMODもテーマも出ません。
          貼り付けるプロンプトには「画面を作らないでください」と書いてあります。
          <code>http://127.0.0.1:7272/</code> が返すものを、そのままスペースに映すよう伝えてください。
        </p>

        <h3>スペースに「アカウントを追加してください」と出る・メールが出ない</h3>
        <p>
          たいてい仮想マシンが入れ替わって MioMail が止まっています。
          v2.1.26 の時点では、止まっていることを画面は知らせません。アカウントが消えたように見えますが、消えていません。
          <code>sh ~/miomail-start.sh</code> を実行し直してください。
          本体ごと消えていた場合は <code>sh ~/miomail-recover.sh</code> です。
          それでも出ないときは <code>~/miomail-serve.log</code> を見てください。
          ポートが使われている場合は <code>--port</code> で別の番号にしてください。
        </p>

        <h3>「パスワードを再入力してください」と出る</h3>
        <p>
          パスワードはまずGNOMEキーリングに保存し、それが動いていない環境では
          暗号化したファイル(パーミッション0600)へ退避します。退避先はメールと同じ
          ホームの中で、<strong>仮想マシンが入れ替わっても残ります</strong>ので、
          通常この案内は出ません。
          出たときは、設定 → メールアカウント からアカウントを開き、パスワードを
          入れ直して保存してください。
        </p>

        <h3>メールサーバーにつながらない</h3>
        <p>
          仮想マシンの外向き通信が許可されているか確認してください。
          IMAPは993(TLS必須)、SMTPは465または587を使います。
        </p>

        <div className="site-docs-note">
          <ShieldCheck size={18} />
          <span>
            <strong>メールはあなたの仮想マシンの中にあります:</strong> MioMailは
            メールデータを外部のサーバーへ送る仕組みを持っていません。
            読み書きはすべて、あなたのメールサーバーとMioMailの間だけで行われます。
            <code>--serve</code> が開くのも、仮想マシンの中だけで届くアドレスです。
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
