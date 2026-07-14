import { useEffect, useMemo, useState } from 'react'
import {
  Archive,
  Check,
  CheckSquare,
  Download,
  FileText,
  Inbox,
  Loader2,
  SendHorizontal,
  Square,
  Trash2,
  X,
} from 'lucide-react'
import { api } from '../../lib/ipc'
import { useMailStore } from '../../stores/mailStore'
import { useUIStore } from '../../stores/uiStore'
import type { Folder, OutlookFolder, OutlookMessage } from '../../types'

function formatDate(dateStr: string): string {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  return date.toLocaleDateString('ja-JP', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function extractName(addr: string): string {
  if (!addr) return '(差出人不明)'
  const match = addr.match(/^(.+?)\s*</)
  if (match && match[1].trim()) return match[1].trim()
  const emailMatch = addr.match(/<(.+?)>/)
  return emailMatch ? emailMatch[1] : addr
}

function getOutlookFolderIcon(type: string) {
  const normalized = type.toLowerCase()
  if (normalized.includes('inbox')) return <Inbox size={14} />
  if (normalized.includes('sent')) return <SendHorizontal size={14} />
  if (normalized.includes('draft')) return <FileText size={14} />
  if (normalized.includes('delete')) return <Trash2 size={14} />
  return <Archive size={14} />
}

function getFolderDisplayName(type: string, displayName: string) {
  const normalized = type.toLowerCase()
  if (normalized.includes('inbox')) return '受信トレイ'
  if (normalized.includes('sent')) return '送信済み'
  if (normalized.includes('draft')) return '下書き'
  if (normalized.includes('delete')) return '削除済み'
  if (normalized.includes('junk')) return '迷惑メール'
  if (normalized.includes('archive')) return 'アーカイブ'
  return displayName
}

export function ImportDialog() {
  const { closeImport } = useUIStore()
  const { accounts, allFolders, refreshFolder } = useMailStore()

  const flatFolders = useMemo(
    () =>
      accounts.flatMap((account) =>
        (allFolders.get(account.id) || []).map((folder: Folder) => ({
          accountId: account.id,
          accountName: account.name || account.email,
          folder,
        }))
      ),
    [accounts, allFolders]
  )

  const [step, setStep] = useState<'folders' | 'messages' | 'importing' | 'done'>('folders')
  const [outlookFolders, setOutlookFolders] = useState<OutlookFolder[]>([])
  const [selectedOutlookFolder, setSelectedOutlookFolder] = useState<OutlookFolder | null>(null)
  const [messages, setMessages] = useState<(OutlookMessage & { selected: boolean })[]>([])
  const [targetFolder, setTargetFolder] = useState<number>(0)
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState('')
  const [result, setResult] = useState<{ imported: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void loadOutlookFolders()
  }, [])

  const loadOutlookFolders = async () => {
    setLoading(true)
    setError(null)
    try {
      const folders = await api.import.outlookFolders()
      const useful = folders.filter(
        (folder) => folder.totalCount > 0 || ['inbox', 'sentitems', 'drafts'].includes(folder.type)
      )
      setOutlookFolders(useful)
    } catch (err: any) {
      setError(
        `New Outlook のデータを読み込めませんでした。\nOutlook が起動中か確認してください。\n\n${err.message || err}`
      )
    } finally {
      setLoading(false)
    }
  }

  const loadMessages = async (folder: OutlookFolder) => {
    setSelectedOutlookFolder(folder)
    setLoading(true)
    setError(null)
    try {
      const items = await api.import.outlookMessages(folder.id)
      const filtered = items.filter((item) => item.subject || item.preview)
      setMessages(filtered.map((item) => ({ ...item, selected: !item.isDraft })))
      setStep('messages')

      if (flatFolders.length > 0) {
        const inbox = flatFolders.find((item) => item.folder.path?.toUpperCase() === 'INBOX')
        setTargetFolder(inbox ? inbox.folder.id : flatFolders[0].folder.id)
      }
    } catch (err: any) {
      setError(`メッセージの読み込みに失敗しました: ${err.message || err}`)
    } finally {
      setLoading(false)
    }
  }

  const toggleAll = () => {
    const allSelected = messages.every((message) => message.selected)
    setMessages(messages.map((message) => ({ ...message, selected: !allSelected })))
  }

  const toggleOne = (index: number) => {
    setMessages(
      messages.map((message, messageIndex) =>
        messageIndex === index ? { ...message, selected: !message.selected } : message
      )
    )
  }

  const selectedCount = messages.filter((message) => message.selected).length

  const handleImport = async () => {
    const target = flatFolders.find((item) => item.folder.id === targetFolder)
    if (!target || selectedCount === 0) return

    setImporting(true)
    setStep('importing')

    try {
      const selected = messages.filter((message) => message.selected)
      const withBodies: any[] = []

      for (let index = 0; index < selected.length; index += 1) {
        const message = selected[index]
        setImportProgress(`本文を読み込み中... ${index + 1}/${selected.length}`)
        try {
          const body = await api.import.outlookBody(message.itemId)
          withBodies.push({
            ...message,
            html: body?.html || '',
            text: body?.text || '',
            internetMessageId: body?.internetMessageId || '',
          })
        } catch {
          withBodies.push(message)
        }
      }

      setImportProgress('MioMail に保存中...')
      const saveResult = await api.import.save(target.accountId, targetFolder, withBodies)
      setResult(saveResult)
      setStep('done')
      await refreshFolder(targetFolder)
    } catch (err: any) {
      setError(`インポートに失敗しました: ${err.message || err}`)
      setStep('messages')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={closeImport} />

      <div className="relative flex max-h-[80vh] w-[680px] flex-col overflow-hidden rounded-[32px] border border-white/75 bg-[linear-gradient(180deg,#fffdfb_0%,#fff6f1_100%)] shadow-[0_30px_80px_rgba(181,132,112,0.24)]">
        <div className="flex h-[76px] shrink-0 items-center justify-between border-b border-white/70 px-5">
          <div className="flex items-center gap-2">
            <Download size={14} className="text-sumi-accent" />
            <div>
              <p className="text-[11px] font-semibold tracking-[0.18em] text-sumi-text-muted">
                MAIL IMPORTER
              </p>
              <span className="mt-1 block font-display text-2xl text-sumi-text">
                New Outlook から取り込む
              </span>
            </div>
          </div>
          <button
            onClick={closeImport}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/70 bg-white/80 text-sumi-text-muted transition hover:text-sumi-text"
          >
            <X size={14} />
          </button>
        </div>

        {error && (
          <div className="border-b border-red-100 bg-red-50/80 px-4 py-3">
            <p className="whitespace-pre-line text-xs text-red-400">{error}</p>
          </div>
        )}

        {step === 'folders' && (
          <>
            {loading ? (
              <div className="flex flex-1 items-center justify-center gap-3 p-10">
                <Loader2 size={16} className="animate-spin text-sumi-accent" />
                <span className="text-xs text-sumi-text-muted">New Outlook のフォルダを読み込み中...</span>
              </div>
            ) : outlookFolders.length === 0 && !error ? (
              <div className="flex flex-1 items-center justify-center p-10">
                <p className="text-xs text-sumi-text-muted">
                  インポート可能なフォルダが見つかりませんでした
                </p>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto" style={{ maxHeight: '500px' }}>
                <div className="border-b border-white/70 px-4 py-3">
                  <p className="text-[11px] text-sumi-text-muted">
                    取り込みたい Outlook フォルダを選んでください
                  </p>
                </div>
                {outlookFolders.map((folder) => (
                  <button
                    key={folder.id}
                    onClick={() => void loadMessages(folder)}
                    className="mx-4 my-3 flex w-auto items-center gap-3 rounded-[24px] border border-white/75 bg-white/78 px-4 py-4 text-left shadow-[0_14px_30px_rgba(255,255,255,0.62)] transition hover:-translate-y-0.5"
                  >
                    <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-sumi-surface text-sumi-text-muted">
                      {getOutlookFolderIcon(folder.type)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <span className="text-xs text-sumi-text">
                        {getFolderDisplayName(folder.type, folder.displayName)}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-sumi-text-muted">
                      <span>{folder.totalCount}件</span>
                      {folder.unreadCount > 0 && <span className="text-sumi-unread">{folder.unreadCount}未読</span>}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {step === 'messages' && (
          <>
            <div className="flex shrink-0 items-center gap-3 border-b border-white/70 px-4 py-3">
              <button onClick={() => setStep('folders')} className="text-[11px] text-sumi-accent hover:underline">
                ← フォルダ選択に戻る
              </button>
              <span className="text-[11px] text-sumi-text-muted">
                {selectedOutlookFolder?.displayName}
              </span>
            </div>

            <div className="flex shrink-0 items-center gap-3 border-b border-white/70 px-4 py-3">
              <label className="shrink-0 text-[11px] text-sumi-text-muted">MioMail の保存先:</label>
              <select
                value={targetFolder}
                onChange={(event) => setTargetFolder(Number(event.target.value))}
                className="h-10 flex-1 rounded-2xl border border-white/80 bg-white/80 px-3 text-xs text-sumi-text focus:border-sumi-accent/50 focus:outline-none"
              >
                {flatFolders.map(({ accountName, folder }) => (
                  <option key={folder.id} value={folder.id}>
                    [{accountName}] {folder.name}
                  </option>
                ))}
              </select>
              <span className="text-[11px] text-sumi-text-muted">
                {selectedCount}/{messages.length}件
              </span>
            </div>

            <div className="shrink-0 border-b border-white/70 px-4 py-2">
              <button onClick={toggleAll} className="flex items-center gap-2 text-[11px] text-sumi-text-muted transition-colors hover:text-sumi-text">
                {messages.length > 0 && messages.every((message) => message.selected) ? (
                  <CheckSquare size={14} className="text-sumi-accent" />
                ) : (
                  <Square size={14} />
                )}
                すべて選択
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto" style={{ maxHeight: '350px' }}>
              {loading ? (
                <div className="flex h-32 items-center justify-center gap-2">
                  <Loader2 size={14} className="animate-spin text-sumi-accent" />
                  <span className="text-xs text-sumi-text-muted">メッセージを読み込み中...</span>
                </div>
              ) : messages.length === 0 ? (
                <div className="flex h-32 items-center justify-center">
                  <span className="text-xs text-sumi-text-muted">メッセージが見つかりません</span>
                </div>
              ) : (
                messages.map((message, index) => (
                  <button
                    key={index}
                    onClick={() => toggleOne(index)}
                    className={`mx-4 my-2 flex w-auto items-start gap-3 rounded-[24px] border border-transparent px-4 py-3 text-left transition ${
                      message.selected
                        ? 'bg-[linear-gradient(135deg,rgba(255,255,255,0.96),rgba(255,235,227,0.92))] shadow-[0_16px_30px_rgba(255,191,160,0.16)]'
                        : 'bg-white/72 hover:bg-white/88'
                    }`}
                  >
                    <div className="shrink-0 pt-0.5">
                      {message.selected ? (
                        <CheckSquare size={15} className="text-sumi-accent" />
                      ) : (
                        <Square size={15} className="text-sumi-text-muted" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="mb-0.5 flex items-center justify-between">
                        <span className={`mr-2 flex-1 truncate text-xs ${!message.isRead ? 'font-semibold text-sumi-text' : 'text-sumi-text-muted'}`}>
                          {extractName(message.from)}
                        </span>
                        <span className="flex shrink-0 items-center gap-1.5 text-[10px] text-sumi-text-muted">
                          {!message.isRead && <span className="h-1.5 w-1.5 rounded-full bg-sumi-unread" />}
                          {formatDate(message.date)}
                        </span>
                      </div>
                      <div className={`truncate text-xs ${!message.isRead ? 'text-sumi-text' : 'text-sumi-text-muted'}`}>
                        {message.subject || '(件名なし)'}
                      </div>
                      {message.preview && (
                        <div className="mt-0.5 truncate text-[11px] text-sumi-text-muted/50">
                          {message.preview.substring(0, 80)}
                        </div>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>

            <div className="flex h-16 shrink-0 items-center justify-end border-t border-white/70 px-4">
              <button
                onClick={() => void handleImport()}
                disabled={importing || selectedCount === 0 || !targetFolder}
                className="flex h-11 items-center gap-1.5 rounded-full bg-sumi-accent px-5 text-sm font-semibold text-white shadow-[0_18px_30px_rgba(255,138,160,0.34)] transition hover:bg-sumi-accent-strong disabled:opacity-50"
              >
                <Download size={12} />
                {selectedCount}件をインポート
              </button>
            </div>
          </>
        )}

        {step === 'importing' && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-10">
            <Loader2 size={24} className="animate-spin text-sumi-accent" />
            <p className="text-xs text-sumi-text-muted">{importProgress}</p>
          </div>
        )}

        {step === 'done' && result && (
          <div className="flex flex-1 flex-col items-center justify-center gap-5 p-10">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-900/30">
              <Check size={28} className="text-green-400" />
            </div>
            <div className="space-y-1 text-center">
              <p className="text-sm text-sumi-text">{result.imported}件のメールを取り込みました</p>
            </div>
            <button
              onClick={closeImport}
              className="h-11 rounded-full bg-sumi-accent px-5 text-sm font-semibold text-white shadow-[0_18px_30px_rgba(255,138,160,0.34)] transition hover:bg-sumi-accent-strong"
            >
              閉じる
            </button>
          </div>
        )}
      </div>
    </div>
  )
}