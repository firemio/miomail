import { t, dateLocale } from '../../lib/i18n'
import { AlertTriangle, ChevronLeft, MailPlus, Paperclip, X } from 'lucide-react'
import { getFolderDisplayName } from '../../lib/folderDisplay'
import { useIsNarrowLayout } from '../../lib/useNarrowLayout'
import { useMailStore } from '../../stores/mailStore'
import { useUIStore } from '../../stores/uiStore'
import type { Message } from '../../types'

function isUnread(message: Message): boolean {
  try {
    const flags = JSON.parse(message.flags || '[]')
    return !flags.includes('\\Seen')
  } catch {
    return true
  }
}

function formatDate(dateStr: string): string {
  if (!dateStr) return ''

  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const isToday = date.toDateString() === now.toDateString()

  if (isToday) {
    return date.toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' })
  }

  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))
  if (diffDays >= 0 && diffDays < 7) {
    return date.toLocaleDateString(dateLocale(), { weekday: 'short' })
  }

  return date.toLocaleDateString(dateLocale(), { year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined, month: 'short', day: 'numeric' })
}

function extractName(addr: string): string {
  if (!addr) return t("差出人不明")
  const match = addr.match(/^(.+?)\s*</)
  if (match && match[1].trim()) return match[1].trim()
  const emailMatch = addr.match(/<(.+?)>/)
  return emailMatch ? emailMatch[1] : addr
}

export function MessageList() {
  const narrow = useIsNarrowLayout()
  const { composeDrafts, searchQuery, setSearchQuery, setNarrowPane, openCompose } = useUIStore()
  const {
    accounts,
    messages,
    currentMessage,
    openMessage,
    currentFolder,
    loading,
    searching,
    searchMode,
    lastQuery,
    clearSearch,
    loadMoreMessages,
    hasMoreMessages,
    loadingMore,
    syncError,
    clearSyncError,
  } = useMailStore()

  const handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 240) {
      void loadMoreMessages()
    }
  }
  const hasDockedCompose = composeDrafts.some((draft) => draft.layout === 'docked')
  const listWidthClass = narrow
    ? 'w-full min-w-0 flex-1'
    : hasDockedCompose
      ? 'w-[330px] min-w-[296px]'
      : 'w-[380px] min-w-[320px]'
  const listBorderClass = narrow ? '' : 'border-r border-white/70'

  // 1カラム表示ではサイドバーが隠れるので、一覧から直接メールを書けるようにする
  const handleCompose = () => {
    const sender = currentFolder
      ? accounts.find((account) => account.id === currentFolder.account_id)
      : accounts[0]
    openCompose({ mode: 'new', fromAddress: sender?.email })
  }

  if (!currentFolder && !searchMode) {
    return (
      <div className={`flex ${listWidthClass} ${listBorderClass} items-center justify-center bg-white/45 px-6 text-sumi-text-muted`}>
        <div className="text-center">
          <p className="text-sm font-semibold text-sumi-text">{t("フォルダを選んでください")}</p>
          {narrow ? (
            // 1カラム表示ではサイドバーが見えないので、行き先を用意する
            <button
              onClick={() => setNarrowPane('folders')}
              className="mt-3 rounded-full bg-sumi-accent px-4 py-2 text-xs font-semibold text-white shadow-[0_10px_22px_rgba(255,138,160,0.34)] transition hover:bg-sumi-accent-strong"
            >
              {t("フォルダ")}
            </button>
          ) : (
          <p className="mt-2 text-xs text-sumi-text-muted">
            {t("左のサイドバーから受信トレイや送信済みを選べます。")}</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className={`flex h-full ${listWidthClass} ${listBorderClass} flex-col bg-white/45`}>
      <div className="shrink-0 border-b border-white/75 px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          {narrow && (
            <button
              onClick={() => setNarrowPane('folders')}
              aria-label={t("フォルダ一覧へ戻る")}
              title={t("フォルダ")}
              className="-ml-1 mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/75 bg-white/80 text-sumi-text-muted transition hover:text-sumi-text"
            >
              <ChevronLeft size={16} />
            </button>
          )}
          <div className="min-w-0 flex-1">
            <span className="block truncate text-lg font-semibold text-sumi-text">
              {searchMode ? t("検索結果") : currentFolder ? getFolderDisplayName(currentFolder) : t("メール")}
            </span>
            {searchMode && <p className="mt-1 break-words text-xs text-sumi-text-muted">「{lastQuery || searchQuery}」</p>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {searchMode && (
              <button
                onClick={() => { setSearchQuery(''); void clearSearch() }}
                aria-label={t("検索を閉じる")}
                title={t("検索を閉じる")}
                className={`rounded-full border border-white/75 bg-white/80 font-semibold text-sumi-text-muted transition hover:text-sumi-text ${
                  narrow
                    ? 'flex h-9 w-9 shrink-0 items-center justify-center'
                    : 'px-3 py-1.5 text-[10px]'
                }`}
              >
                {narrow ? <X size={14} /> : t("検索を閉じる")}</button>
            )}
            <span className="rounded-full bg-white/80 px-3 py-1 text-[10px] font-semibold text-sumi-text-muted">
              {searching ? t("検索中…") : t("{0}{1}件", { "0": messages.length, "1": hasMoreMessages ? '+' : '' })}
            </span>
            {narrow && !searchMode && (
              <button
                onClick={handleCompose}
                aria-label={t("新しいメールを書く")}
                title={t("新しいメールを書く")}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-sumi-accent text-white shadow-[0_10px_22px_rgba(255,138,160,0.34)] transition hover:bg-sumi-accent-strong"
              >
                <MailPlus size={16} />
              </button>
            )}
          </div>
        </div>

      </div>

      {syncError && (
        <div className="mx-3 mt-3 flex shrink-0 items-start gap-2 rounded-[18px] border border-amber-200 bg-amber-50/90 px-3 py-2.5">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500" />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold text-amber-900">{t("同期に失敗しました")}</p>
            <p className="mt-0.5 whitespace-pre-line break-words text-[10px] leading-4 text-amber-800/90">
              {syncError}
            </p>
            {/Password not found|パスワード/i.test(syncError) && (
              <p className="mt-1 text-[10px] leading-4 text-amber-800/90">
                {t("設定 → メールアカウント からアカウントを開き、パスワードを再入力して保存してください。")}</p>
            )}
          </div>
          <button
            onClick={clearSyncError}
            aria-label={t("エラーを閉じる")}
            className="shrink-0 text-amber-600 transition hover:text-amber-800"
          >
            <X size={13} />
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-2 pb-3 pt-2" onScroll={handleScroll} aria-busy={loading || searching}>
        {searching || (loading && messages.length === 0) ? (
          <div role="status" className="flex h-32 items-center justify-center gap-2 text-xs text-sumi-text-muted">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-sumi-accent border-t-transparent" />
            {searching ? t("検索しています…") : t("読み込んでいます…")}
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-40 items-center justify-center px-6 text-center text-xs text-sumi-text-muted">
            {searchMode
              ? t("一致するメールは見つかりませんでした。語句を短くするか、別のキーワードで試してください。")
              : t("このフォルダにはまだメールがありません。")}
          </div>
        ) : (
          messages.map((message) => {
            const unread = isUnread(message)
            const isActive = currentMessage?.id === message.id

            return (
              <button
                key={message.id}
                aria-current={isActive ? 'true' : undefined}
                aria-label={`${unread ? t("未読、") : ''}${extractName(message.from_address)}、${message.subject || t("(件名なし)")}`}
                onClick={() => {
                  void openMessage(message.id)
                  setNarrowPane('message')
                }}
                className={`my-1 block w-full rounded-xl border px-4 py-3 text-left transition-colors ${
                  isActive
                    ? 'border-white/80 bg-[linear-gradient(135deg,rgba(255,255,255,0.96),rgba(255,235,227,0.92))] shadow-[0_18px_35px_rgba(255,191,160,0.18)]'
                    : 'border-transparent bg-white/62 hover:bg-white/88'
                }`}
              >
                <div className="mb-1 flex items-center justify-between gap-3">
                  <span
                    className={`min-w-0 flex-1 truncate text-xs ${
                      unread ? 'font-semibold text-sumi-text' : 'text-sumi-text-muted'
                    }`}
                  >
                    {extractName(message.from_address)}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5 text-[10px] text-sumi-text-muted">
                    {unread && <span className="h-1.5 w-1.5 rounded-full bg-sumi-unread" />}
                    {formatDate(message.date)}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <div
                    className={`min-w-0 flex-1 truncate text-xs ${
                      unread ? 'text-sumi-text' : 'text-sumi-text-muted'
                    }`}
                  >
                    {message.subject || t("(件名なし)")}
                  </div>
                  {message.has_attachments > 0 && (
                    <span className="shrink-0 text-sumi-text-muted">
                      <Paperclip size={12} />
                    </span>
                  )}
                </div>

                {message.snippet && message.snippet !== message.subject && (
                  <div className="mt-1 line-clamp-1 text-xs leading-5 text-sumi-text-muted">
                    {message.snippet}
                  </div>
                )}
              </button>
            )
          })
        )}
        {!searchMode && messages.length > 0 && (loadingMore || hasMoreMessages) && (
          <div className="flex h-12 items-center justify-center text-[11px] text-sumi-text-muted">
            {loadingMore ? (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-sumi-accent border-t-transparent" />
            ) : (
              <button onClick={() => void loadMoreMessages()} className="rounded-full bg-white/70 px-4 py-1.5 font-semibold transition hover:text-sumi-text">
                {t("さらに読み込む")}</button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
