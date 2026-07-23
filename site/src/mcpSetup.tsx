import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

// LP(トップページ)とMCPガイドページで共有する自動設定プロンプト。
// 内容を変えるときは両ページに同じものが出るよう、このファイルだけを編集すること。
export const AUTO_SETUP_PROMPT = `MioMail MCP サーバーを、あなた(AIエージェント)が使えるように自動設定してください。

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

export function CopyPromptButton() {
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
