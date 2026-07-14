import {
  Archive,
  FileText,
  Folder as FolderIcon,
  Inbox,
  Mail,
  RefreshCw,
  SendHorizontal,
  Star,
  Trash2,
} from 'lucide-react'
import { useMailStore } from '../../stores/mailStore'
import type { Account, Folder } from '../../types'

function getFolderIcon(folder: Folder) {
  const name = (folder.name || folder.path).toLowerCase()
  if (name.includes('inbox')) return <Inbox size={14} />
  if (name.includes('sent')) return <SendHorizontal size={14} />
  if (name.includes('draft')) return <FileText size={14} />
  if (name.includes('trash') || name.includes('deleted')) return <Trash2 size={14} />
  if (name.includes('junk') || name.includes('spam')) return <Archive size={14} />
  if (name.includes('star')) return <Star size={14} />
  return <FolderIcon size={14} />
}

function getFolderDisplayName(folder: Folder): string {
  const map: Record<string, string> = {
    inbox: '受信トレイ',
    sent: '送信済み',
    'sent messages': '送信済み',
    'sent mail': '送信済み',
    drafts: '下書き',
    trash: 'ゴミ箱',
    'deleted items': 'ゴミ箱',
    junk: '迷惑メール',
    'junk e-mail': '迷惑メール',
    spam: '迷惑メール',
    archive: 'アーカイブ',
    starred: 'スター付き',
  }
  const key = (folder.name || folder.path).toLowerCase()
  return map[key] || folder.name || folder.path
}

function getAccountLabel(account: Account): string {
  if (account.name && account.name !== account.email) return account.name
  return account.email.split('@')[0]
}

export function Sidebar() {
  const { accounts, allFolders, currentFolder, setCurrentFolder, syncAllFolders, syncing } =
    useMailStore()

  return (
    <div className="glass-panel flex h-full w-[260px] min-w-[260px] flex-col rounded-[28px] border border-white/75">
      <div className="flex-1 overflow-y-auto">
        <div className="px-5 pb-4 pt-5">
          <p className="text-[11px] font-semibold tracking-[0.18em] text-sumi-text-muted">
            DELIVERY ROUTES
          </p>
          <h2 className="mt-2 font-display text-2xl text-sumi-text">おたよりルート</h2>
        </div>

        {accounts.map((account) => {
          const folders = allFolders.get(account.id) || []

          return (
            <div
              key={account.id}
              className="mx-3 mb-4 rounded-[24px] bg-white/70 p-2 shadow-[0_10px_30px_rgba(255,255,255,0.55)]"
            >
              <div className="mb-2 flex items-center gap-2 px-2 py-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl bg-sumi-accent/12 text-sumi-accent">
                  <Mail size={14} />
                </span>
                <div className="min-w-0">
                  <div className="truncate text-[11px] font-semibold uppercase tracking-[0.18em] text-sumi-text-muted">
                    {getAccountLabel(account)}
                  </div>
                  <div className="truncate text-[10px] text-sumi-text-muted/65" title={account.email}>
                    {account.email}
                  </div>
                </div>
              </div>

              {folders.map((folder) => {
                const isActive = currentFolder?.id === folder.id
                const unread = folder.unread_count || 0

                return (
                  <button
                    key={folder.id}
                    onClick={() => setCurrentFolder(folder)}
                    className={`mb-1 flex w-full items-center gap-2 rounded-2xl px-3 py-2.5 text-left transition-all group ${
                      isActive
                        ? 'bg-[linear-gradient(135deg,rgba(255,138,160,0.18),rgba(255,211,110,0.2))] text-sumi-text shadow-[0_10px_25px_rgba(255,138,160,0.15)]'
                        : 'text-sumi-text-muted hover:bg-sumi-surface-2/55 hover:text-sumi-text'
                    }`}
                  >
                    <span
                      className={`shrink-0 ${
                        isActive
                          ? 'text-sumi-accent'
                          : 'text-sumi-text-muted group-hover:text-sumi-text'
                      }`}
                    >
                      {getFolderIcon(folder)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs">{getFolderDisplayName(folder)}</div>
                      <div className="mt-0.5 text-[10px] text-sumi-text-muted/60">
                        {folder.total_count}件
                      </div>
                    </div>
                    {unread > 0 && (
                      <span className="flex h-[20px] min-w-[20px] items-center justify-center rounded-full bg-sumi-unread/25 px-1.5 text-[10px] font-semibold text-sumi-unread">
                        {unread > 99 ? '99+' : unread}
                      </span>
                    )}
                  </button>
                )
              })}

              {folders.length === 0 && (
                <div className="px-4 py-2 text-[11px] text-sumi-text-muted/50">
                  フォルダがまだありません
                </div>
              )}
            </div>
          )
        })}

        {accounts.length === 0 && (
          <div className="flex h-20 items-center justify-center text-xs text-sumi-text-muted">
            アカウントを追加してください
          </div>
        )}
      </div>

      <div className="border-t border-white/70 p-4">
        <button
          onClick={() => syncAllFolders()}
          disabled={syncing}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-sumi-surface text-xs font-semibold text-sumi-text transition hover:bg-sumi-surface-2 disabled:opacity-50"
        >
          <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} />
          {syncing ? '全体を更新中...' : '全アカウント同期'}
        </button>
      </div>
    </div>
  )
}