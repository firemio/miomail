import { useState } from 'react'
import { AlertTriangle, ArrowLeft, Bot, Check, Copy, Download, ShieldCheck, Sparkles, Terminal } from 'lucide-react'
import { DOWNLOAD_URL } from './links'
import logoImage from '../../src/renderer/assets/miomail-logo.png'

const EXE_PATH = '%LOCALAPPDATA%\\MioMail\\miomail-mcp.exe'

const AUTO_SETUP_PROMPT = `MioMail MCP サーバーを、あなた(AIエージェント)が使えるように自動設定してください。

【サーバー実行ファイル】
%LOCALAPPDATA%\\MioMail\\miomail-mcp.exe
(= C:\\Users\\<ユーザー名>\\AppData\\Local\\MioMail\\miomail-mcp.exe。MioMail インストール時に同梱されています)

【手順】
1. 上記パスの環境変数を展開して実際のパスを特定し、ファイルの存在を確認してください。無い場合は設定を進めず、私に報告してください。
2. あなた自身(いまこの会話で使っているクライアント)の MCP 設定に、stdio サーバー "miomail" として登録してください。
   ・Codex の場合: ~/.codex/config.toml に次を追記(シングルクォートのリテラル文字列で書くこと)
     [mcp_servers.miomail]
     command = '<実際のパス>'
   ・Claude Code の場合: claude mcp add miomail -- "<実際のパス>" を実行
   ・Claude Desktop の場合: claude_desktop_config.json の mcpServers に
     "miomail": { "command": "<実際のパス>" } を追加(JSONではバックスラッシュを二重に書くこと)
   ・それ以外の場合: そのクライアントの MCP サーバー登録方法に従って stdio で登録
3. 登録した内容を私に報告してください。クライアントの再起動が必要な場合は、その旨も案内してください。

【登録後に使えるツール】
sync / list_accounts / list_folders / list_messages / get_message / search_messages / send_mail / mark_read / delete_message

【重要】send_mail(即時送信)と delete_message(削除)は取り消せません。これらを実行する前には、必ず内容を提示して私の確認を取ってください。`

function CopyPromptButton() {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(AUTO_SETUP_PROMPT)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = AUTO_SETUP_PROMPT
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }
  return (
    <button type="button" className="site-button site-button--primary site-docs-prompt__copy" onClick={copy}>
      {copied ? <Check size={16} /> : <Copy size={16} />}
      {copied ? 'コピーしました!' : 'プロンプトをコピー'}
    </button>
  )
}

const CODEX_TOML = `[mcp_servers.miomail]
command = 'C:\\Users\\<ユーザー名>\\AppData\\Local\\MioMail\\miomail-mcp.exe'`

const CLAUDE_CODE_CMD = `claude mcp add miomail -- "%LOCALAPPDATA%\\MioMail\\miomail-mcp.exe"`

const CLAUDE_DESKTOP_JSON = `{
  "mcpServers": {
    "miomail": {
      "command": "C:\\\\Users\\\\<ユーザー名>\\\\AppData\\\\Local\\\\MioMail\\\\miomail-mcp.exe"
    }
  }
}`

const GENERIC_CONFIG = `command: C:\\Users\\<ユーザー名>\\AppData\\Local\\MioMail\\miomail-mcp.exe`

const TOOLS = [
  ['list_accounts', 'MioMailに登録されているメールアカウントの一覧を取得'],
  ['list_folders', 'フォルダー一覧と各フォルダーの未読数を取得'],
  ['list_messages', '指定フォルダーのメール一覧(件名・差出人・日時など)を取得'],
  ['get_message', 'メール本文を取得する(既読にはなりません)'],
  ['search_messages', '件名・差出人などでメールを検索'],
  ['send_mail', 'メールを即時送信する(取り消し不可)'],
  ['mark_read', 'メールの既読・未読を切り替える'],
  ['delete_message', 'メールをゴミ箱へ移動する(取り消し不可)'],
  ['sync', 'IMAPと再同期して最新の状態に更新'],
] as const

const PROMPT_EXAMPLES = [
  '「未読メールを確認して、大事そうなものを3件まで要約して」',
  '「◯◯さんからのメールを探して、内容を整理して見せて」',
  '「この返事を下の内容で送っておいて。送信前に一度確認させてね」',
]

export function McpGuide() {
  return (
    <div className="site-docs">
      <header className="site-docs-header">
        <a href="./" aria-label="MioMail ホーム">
          <img className="site-brand__logo" src={logoImage} alt="MioMail" draggable={false} />
        </a>
        <nav>
          <a href="./">トップ</a>
          <a href="./mods.html">MODガイド</a>
          <a href={DOWNLOAD_URL}><Download size={13} /> ダウンロード</a>
        </nav>
      </header>

      <main>
        <h1>MCPサーバーでAIエージェントとつなげる</h1>
        <p className="site-docs-lead">
          MioMailには <Bot size={14} /> <strong>MioMail MCPサーバー</strong> が同梱されています。
          MCP(Model Context Protocol)は、AIエージェントが外部ツールと連携するための標準規格。
          これを使うと、ClaudeやCodexなどのAIエージェントから、MioMailの受信箱の確認・検索・送信を代行させられます。
        </p>

        <h2>どうやって動くの？</h2>
        <p>
          MCPサーバーは<strong>stdioで動く小さなプログラム</strong>です。
          MioMailアプリと同じSQLiteデータベース(<code>%APPDATA%\com.firemio.miomail\miomail.db</code>)とOSキーリングを読み取り、
          IMAP / SMTPへ直接接続します。アプリが起動していなくても動作します。
          データベースの場所は環境変数 <code>MIOMAIL_DB</code> で上書きできます。
        </p>
        <div className="site-docs-note">
          <ShieldCheck size={18} />
          <span>
            <strong>プライバシー:</strong> 読み取りはすべてあなたのPC上で完結します。
            外部サーバーにメールデータを送信する仕組みはありません。
          </span>
        </div>

        <h2>前提条件</h2>
        <ol className="site-docs-steps">
          <li>MioMailをインストールしていること。</li>
          <li>MioMailアプリでメールアカウントの設定が済んでいること。パスワードはOSキーリングから読み取るため、先にアプリ側で保存しておく必要があります。</li>
          <li>stdio MCPに対応したAIクライアント(Codex、Claude Code、Claude Desktop など)を使っていること。</li>
        </ol>

        <h2><Sparkles size={20} /> かんたん設定: AIエージェントに自動設定してもらう(おすすめ)</h2>
        <p>
          設定ファイルを手で編集する必要はありません。
          <strong>下の文章をコピーして、MioMailと連携させたいAIエージェント(Codex、Claude Code など)との会話にそのまま貼り付けるだけ</strong>です。
          エージェントが実行ファイルの場所を確認し、自分自身の設定に miomail を登録してくれます。
        </p>
        <div className="site-docs-prompt">
          <pre className="site-docs-code">{AUTO_SETUP_PROMPT}</pre>
          <CopyPromptButton />
        </div>
        <ul>
          <li>貼り付け先は「連携させたいクライアントそのもの」です。MCPの設定はクライアントごとに必要なので、CodexとClaudeの両方で使いたい場合は、それぞれの会話に貼り付けてください。</li>
          <li>登録が完了したら、クライアントの再起動が必要な場合があります(エージェントが案内します)。</li>
        </ul>

        <h2>実行ファイルの場所</h2>
        <p>インストール版は次の場所にあります(<code>%LOCALAPPDATA%</code> は <code>C:\Users\&lt;ユーザー名&gt;\AppData\Local</code>)。</p>
        <pre className="site-docs-code">{EXE_PATH}</pre>
        <ul>
          <li>フルパスで書くと <code>C:\Users\&lt;ユーザー名&gt;\AppData\Local\MioMail\miomail-mcp.exe</code> です</li>
          <li>ソースからビルドした開発版は <code>src-tauri/target/release/miomail-mcp.exe</code> にあります</li>
        </ul>

        <h2>手動で登録する場合(上級者向け)</h2>
        <p>上の自動設定が使えない環境では、手動でも登録できます。MCPサーバーは「使うクライアントごと」に登録します。お使いのクライアントに合わせて、以下の設定をコピー＆ペーストしてください。</p>

        <h3>a. Codex(OpenAI codex CLI)</h3>
        <p><code>~/.codex/config.toml</code> に次を追記して、Codexを再起動します。</p>
        <pre className="site-docs-code">{CODEX_TOML}</pre>
        <ul>
          <li>TOMLの<strong>シングルクォートはリテラル文字列</strong>なので、バックスラッシュはそのまま書けます</li>
          <li>ダブルクォートで書く場合は <code>\\</code> とエスケープが必要です(例: <code>"C:\\Users\\...\\miomail-mcp.exe"</code>)</li>
        </ul>

        <h3>b. Claude Code</h3>
        <p><Terminal size={13} /> ターミナルで次のコマンドを実行します。</p>
        <pre className="site-docs-code">{CLAUDE_CODE_CMD}</pre>

        <h3>c. Claude Desktop</h3>
        <p><code>claude_desktop_config.json</code> の <code>mcpServers</code> に次を追加して、Claude Desktopを再起動します。</p>
        <pre className="site-docs-code">{CLAUDE_DESKTOP_JSON}</pre>
        <ul>
          <li>JSONではバックスラッシュを <code>\\</code> と2重に書く必要があります</li>
        </ul>

        <h3>d. その他のstdio MCP対応クライアント</h3>
        <p>サーバー種別を <code>stdio</code> にして、commandに上記のexeを指定してください。</p>
        <pre className="site-docs-code">{GENERIC_CONFIG}</pre>

        <h2>「登録されていない」と言われたら</h2>
        <ul>
          <li><strong>クライアントごとに登録が必要:</strong> MCPの設定はクライアントがそれぞれ独自に持っています。Claude Codeに登録しても、Claude DesktopやCodexでは使えません。使うクライアントごとに登録してください。</li>
          <li><strong>パスの確認:</strong> エクスプローラーのアドレスバーに <code>%LOCALAPPDATA%\MioMail</code> と入力して開き、<code>miomail-mcp.exe</code> があるか確認してください。</li>
          <li><strong>再起動が必要:</strong> 設定を追加・変更したあとは、AIクライアントの再起動が必要です。</li>
          <li><strong>アカウント未設定:</strong> 先にMioMailアプリでメールアカウントの設定を完了させてください(パスワードはOSキーリングに保存されます)。</li>
        </ul>

        <h2>使えるツール一覧</h2>
        <p>AIエージェントは次の9個のツールを使ってMioMailを操作します。</p>
        <table className="site-docs-table">
          <thead>
            <tr><th>ツール名</th><th>できること</th></tr>
          </thead>
          <tbody>
            {TOOLS.map(([tool, desc]) => (
              <tr key={tool}><td><code>{tool}</code></td><td>{desc}</td></tr>
            ))}
          </tbody>
        </table>

        <h2>エージェントへの頼み方の例</h2>
        <p>登録が済んだら、AIエージェントに話しかけるだけ。たとえば——</p>
        <ul>
          {PROMPT_EXAMPLES.map((example) => (
            <li key={example}>{example}</li>
          ))}
        </ul>
        <div className="site-docs-note">
          <AlertTriangle size={18} />
          <span>
            <strong>送信・削除は取り消せません:</strong> <code>send_mail</code>(即時送信)と <code>delete_message</code>(ゴミ箱へ移動)は実行すると元に戻せません。
            そのためエージェントはこれらのツールを実行する前に、必ずあなたへ確認を求める設計になっています。
            内容をよく確認してから承認してください。
          </span>
        </div>

        <div className="site-docs-cta">
          <a className="site-button site-button--primary" href={DOWNLOAD_URL}>
            <Download size={18} /> MioMailをダウンロード
          </a>
          <a className="site-text-link" href="./"><ArrowLeft size={15} /> トップへ戻る</a>
        </div>
      </main>

      <footer className="site-docs-footer">
        <span>© 2026 MioMail</span>
        <a href="https://github.com/firemio/miomail">GitHub</a>
      </footer>
    </div>
  )
}
