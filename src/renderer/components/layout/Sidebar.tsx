import { useMemo, useState } from 'react'
import {
  Archive,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder as FolderIcon,
  FolderPlus,
  Inbox,
  Mail,
  MailPlus,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  SendHorizontal,
  Star,
  Trash2,
  X,
} from 'lucide-react'
import { useMailStore } from '../../stores/mailStore'
import { useMascotStore } from '../../stores/mascotStore'
import { useUIStore } from '../../stores/uiStore'
import { buildFolderTree, type FolderTreeNode } from '../../lib/folderTree'
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

// Mirrors the backend's protected-folder rule (INBOX + sent/trash/junk/drafts).
function isSystemFolder(folder: Folder): boolean {
  if (folder.path.toUpperCase() === 'INBOX') return true
  const hay = `${folder.name} ${folder.path} ${folder.flags || ''}`.toLowerCase()
  return [
    ['\\sent', 'sent', '送信済'],
    ['\\trash', 'trash', 'deleted', 'ゴミ箱', '削除済'],
    ['\\junk', 'junk', 'spam', '迷惑'],
    ['\\drafts', 'draft', '下書き'],
  ].some((needles) => needles.some((n) => hay.includes(n)))
}

function getAccountLabel(account: Account): string {
  if (account.name && account.name !== account.email) return account.name
  return account.email.split('@')[0]
}

/** 折りたたみの初期状態: システムフォルダと INBOX 配下は展開、それ以外は折りたたむ */
function isDefaultExpanded(node: FolderTreeNode, rootSegment: string): boolean {
  if (rootSegment.toUpperCase() === 'INBOX') return true
  if (node.folder && isSystemFolder(node.folder)) return true
  // 仮想ノードでも名前がシステム系なら展開しておく(中間ノード欠落対策)
  const hay = `${node.segment} ${node.path}`.toLowerCase()
  return ['sent', 'trash', 'deleted', 'junk', 'spam', 'draft', 'archive'].some((n) =>
    hay.includes(n)
  )
}

export function Sidebar() {
  const {
    accounts,
    allFolders,
    currentFolder,
    setCurrentFolder,
    syncAllFolders,
    syncing,
    createFolder,
    renameFolder,
    deleteFolder,
  } = useMailStore()
  const { openCompose } = useUIStore()
  const { gainBond } = useMascotStore()

  // Compose from the account whose folder is open (falls back to the first account)
  const composeSender = currentFolder
    ? accounts.find((account) => account.id === currentFolder.account_id)
    : accounts[0]

  const handleCompose = () => {
    openCompose({ mode: 'new', fromAddress: composeSender?.email })
    gainBond(1)
  }

  const [menuFolderId, setMenuFolderId] = useState<number | null>(null)
  const [renameId, setRenameId] = useState<number | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)
  const [creatingForAccount, setCreatingForAccount] = useState<number | null>(null)
  const [createValue, setCreateValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 折りたたみ状態のユーザー上書き(key: `${accountId}:${nodePath}`、値: 展開なら true)
  const [expandOverrides, setExpandOverrides] = useState<Record<string, boolean>>({})

  // アカウントごとのフォルダツリー(フラット配列 → 階層構造)
  const treesByAccount = useMemo(() => {
    const map = new Map<number, FolderTreeNode[]>()
    for (const account of accounts) {
      map.set(account.id, buildFolderTree(allFolders.get(account.id) || []))
    }
    return map
  }, [accounts, allFolders])

  const resetInlineState = () => {
    setMenuFolderId(null)
    setRenameId(null)
    setConfirmDeleteId(null)
    setError(null)
  }

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
      resetInlineState()
      setCreatingForAccount(null)
      setCreateValue('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const toggleNode = (accountId: number, node: FolderTreeNode, rootSegment: string) => {
    const key = `${accountId}:${node.path}`
    setExpandOverrides((prev) => {
      const current = prev[key] ?? isDefaultExpanded(node, rootSegment)
      return { ...prev, [key]: !current }
    })
  }

  const renderFolderNodes = (account: Account, nodes: FolderTreeNode[], rootSegment: string) =>
    nodes.map((node) => {
      const folder = node.folder
      const hasChildren = node.children.length > 0
      // トップレベルでは自身のセグメントがルート。子孫には最上位のセグメントを引き継ぐ
      const effectiveRoot = rootSegment || node.segment
      const expandKey = `${account.id}:${node.path}`
      const expanded = expandOverrides[expandKey] ?? isDefaultExpanded(node, effectiveRoot)
      const indent = node.depth * 14

      const chevron = hasChildren ? (
        <button
          onClick={() => toggleNode(account.id, node, effectiveRoot)}
          aria-label={expanded ? '折りたたむ' : '展開する'}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-sumi-text-muted/70 transition hover:bg-white/70 hover:text-sumi-text"
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
      ) : (
        <span className="h-5 w-5 shrink-0" />
      )

      // 仮想ノード(中間ノード欠落): 選択不可のラベル行として表示
      if (!folder) {
        return (
          <div key={node.path}>
            <div
              className="mb-1 flex items-center gap-1 rounded-2xl pr-1 text-sumi-text-muted/70"
              style={{ paddingLeft: `${indent}px` }}
            >
              {chevron}
              <div className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2">
                <span className="shrink-0 text-sumi-text-muted/60">
                  <FolderIcon size={14} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs">{node.segment}</div>
                </div>
              </div>
            </div>
            {hasChildren && expanded && renderFolderNodes(account, node.children, effectiveRoot)}
          </div>
        )
      }

      const isActive = currentFolder?.id === folder.id
      const unread = folder.unread_count || 0
      const system = isSystemFolder(folder)

      const childrenBlock =
        hasChildren && expanded ? renderFolderNodes(account, node.children, effectiveRoot) : null

      if (renameId === folder.id) {
        return (
          <div key={node.path}>
            <div
              className="mb-1 flex items-center gap-1.5 py-1.5 pr-2"
              style={{ paddingLeft: `${indent + 8}px` }}
            >
              <input
                autoFocus
                value={renameValue}
                disabled={busy}
                onChange={(event) => setRenameValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && renameValue.trim()) {
                    void run(() => renameFolder(folder.id, renameValue.trim()))
                  } else if (event.key === 'Escape') {
                    setRenameId(null)
                  }
                }}
                className="h-9 min-w-0 flex-1 rounded-xl border border-sumi-accent/40 bg-white px-2.5 text-xs text-sumi-text focus:outline-none"
              />
              <button
                onClick={() => renameValue.trim() && void run(() => renameFolder(folder.id, renameValue.trim()))}
                disabled={busy || !renameValue.trim()}
                aria-label="名前変更を確定"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-sumi-accent text-white disabled:opacity-50"
              >
                <Check size={13} />
              </button>
              <button
                onClick={() => setRenameId(null)}
                aria-label="キャンセル"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-white/70 bg-white/80 text-sumi-text-muted"
              >
                <X size={13} />
              </button>
            </div>
            {childrenBlock}
          </div>
        )
      }

      return (
        <div key={node.path}>
          <div
            className={`group mb-1 flex items-center gap-0.5 rounded-2xl pr-1 transition-all ${
              isActive
                ? 'bg-[linear-gradient(135deg,rgba(255,138,160,0.18),rgba(255,211,110,0.2))] text-sumi-text shadow-[0_10px_25px_rgba(255,138,160,0.15)]'
                : 'text-sumi-text-muted hover:bg-sumi-surface-2/55 hover:text-sumi-text'
            }`}
            style={{ paddingLeft: `${indent}px` }}
          >
            {chevron}
            <button
              onClick={() => setCurrentFolder(folder)}
              className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2.5 text-left"
            >
              <span className={`shrink-0 ${isActive ? 'text-sumi-accent' : 'text-sumi-text-muted group-hover:text-sumi-text'}`}>
                {getFolderIcon(folder)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs">{getFolderDisplayName(folder)}</div>
                <div className="mt-0.5 text-[10px] text-sumi-text-muted/60">{folder.total_count}件</div>
              </div>
              {unread > 0 && (
                <span className="flex h-[20px] min-w-[20px] items-center justify-center rounded-full bg-sumi-unread/25 px-1.5 text-[10px] font-semibold text-sumi-unread">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </button>

            {!system && confirmDeleteId !== folder.id && (
              <div className="relative shrink-0">
                <button
                  onClick={() => setMenuFolderId(menuFolderId === folder.id ? null : folder.id)}
                  aria-label="フォルダの操作"
                  className={`flex h-7 w-7 items-center justify-center rounded-lg text-sumi-text-muted transition hover:bg-white/70 hover:text-sumi-text ${
                    menuFolderId === folder.id ? 'bg-white/70' : 'opacity-0 group-hover:opacity-100'
                  }`}
                >
                  <MoreHorizontal size={14} />
                </button>
                {menuFolderId === folder.id && (
                  <div className="absolute right-0 top-8 z-20 w-32 overflow-hidden rounded-[14px] border border-white/85 bg-white/98 py-1 shadow-[0_16px_40px_rgba(91,58,45,0.18)]">
                    <button
                      onClick={() => {
                        setRenameId(folder.id)
                        setRenameValue(folder.name || folder.path)
                        setMenuFolderId(null)
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] text-sumi-text transition hover:bg-sumi-surface"
                    >
                      <Pencil size={12} /> 名前を変更
                    </button>
                    <button
                      onClick={() => {
                        setConfirmDeleteId(folder.id)
                        setMenuFolderId(null)
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] text-red-400 transition hover:bg-red-400/15"
                    >
                      <Trash2 size={12} /> 削除
                    </button>
                  </div>
                )}
              </div>
            )}

            {confirmDeleteId === folder.id && (
              <div className="flex shrink-0 items-center gap-1 pr-1">
                <button
                  onClick={() => void run(() => deleteFolder(folder.id))}
                  disabled={busy}
                  className="rounded-lg bg-red-400 px-2 py-1 text-[10px] font-semibold text-white transition hover:bg-red-500 disabled:opacity-50"
                >
                  削除
                </button>
                <button
                  onClick={() => setConfirmDeleteId(null)}
                  className="rounded-lg px-1.5 py-1 text-[10px] font-semibold text-sumi-text-muted transition hover:text-sumi-text"
                >
                  やめる
                </button>
              </div>
            )}
          </div>
          {childrenBlock}
        </div>
      )
    })

  return (
    <div className="glass-panel flex h-full w-[260px] min-w-[260px] flex-col rounded-[28px] border border-white/75">
      <div className="shrink-0 px-4 pt-4">
        <button
          onClick={handleCompose}
          data-testid="compose-button"
          disabled={accounts.length === 0}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-sumi-accent text-sm font-semibold text-white shadow-[0_18px_30px_rgba(255,138,160,0.34)] transition hover:-translate-y-0.5 hover:bg-sumi-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
        >
          <MailPlus size={16} />
          新しいメールを書く
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="px-5 pb-4 pt-5">
          <p className="text-[11px] font-semibold tracking-[0.18em] text-sumi-text-muted">
            DELIVERY ROUTES
          </p>
          <h2 className="mt-2 font-display text-2xl text-sumi-text">おたよりルート</h2>
        </div>

        {error && (
          <div className="mx-3 mb-2 rounded-[16px] border border-red-400/30 bg-red-400/15 px-3 py-2 text-[10px] leading-4 text-red-400">
            {error}
          </div>
        )}

        {accounts.map((account) => {
          const folders = allFolders.get(account.id) || []
          const tree = treesByAccount.get(account.id) || []

          return (
            <div
              key={account.id}
              className="mx-3 mb-4 rounded-[24px] bg-white/70 p-2 shadow-[0_10px_30px_rgba(255,255,255,0.55)]"
            >
              <div className="mb-2 flex items-center gap-2 px-2 py-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl bg-sumi-accent/12 text-sumi-accent">
                  <Mail size={14} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11px] font-semibold uppercase tracking-[0.18em] text-sumi-text-muted">
                    {getAccountLabel(account)}
                  </div>
                  <div className="truncate text-[10px] text-sumi-text-muted/65" title={account.email}>
                    {account.email}
                  </div>
                </div>
                <button
                  onClick={() => {
                    resetInlineState()
                    setCreatingForAccount(creatingForAccount === account.id ? null : account.id)
                    setCreateValue('')
                  }}
                  title="新規フォルダ"
                  aria-label="新規フォルダを作成"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl border border-white/70 bg-white/70 text-sumi-text-muted transition hover:text-sumi-accent"
                >
                  <FolderPlus size={14} />
                </button>
              </div>

              {renderFolderNodes(account, tree, '')}

              {creatingForAccount === account.id && (
                <div className="mb-1 mt-1 flex items-center gap-1.5 px-2 py-1.5">
                  <input
                    autoFocus
                    value={createValue}
                    disabled={busy}
                    placeholder="新しいフォルダ名"
                    onChange={(event) => setCreateValue(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && createValue.trim()) {
                        void run(() => createFolder(account.id, createValue.trim()))
                      } else if (event.key === 'Escape') {
                        setCreatingForAccount(null)
                      }
                    }}
                    className="h-9 min-w-0 flex-1 rounded-xl border border-sumi-accent/40 bg-white px-2.5 text-xs text-sumi-text placeholder-sumi-text-muted/50 focus:outline-none"
                  />
                  <button
                    onClick={() => createValue.trim() && void run(() => createFolder(account.id, createValue.trim()))}
                    disabled={busy || !createValue.trim()}
                    aria-label="フォルダを作成"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-sumi-accent text-white disabled:opacity-50"
                  >
                    <Check size={13} />
                  </button>
                  <button
                    onClick={() => setCreatingForAccount(null)}
                    aria-label="キャンセル"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-white/70 bg-white/80 text-sumi-text-muted"
                  >
                    <X size={13} />
                  </button>
                </div>
              )}

              {folders.length === 0 && creatingForAccount !== account.id && (
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
