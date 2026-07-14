import { Paperclip, Search, Sparkles } from 'lucide-react'
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
  const now = new Date()
  const isToday = date.toDateString() === now.toDateString()

  if (isToday) {
    return date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
  }

  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))
  if (diffDays < 7) {
    return date.toLocaleDateString('ja-JP', { weekday: 'short' })
  }

  return date.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })
}

function extractName(addr: string): string {
  if (!addr) return '差出人不明'
  const match = addr.match(/^(.+?)\s*</)
  if (match && match[1].trim()) return match[1].trim()
  const emailMatch = addr.match(/<(.+?)>/)
  return emailMatch ? emailMatch[1] : addr
}

export function MessageList() {
  const { composeDrafts, searchQuery } = useUIStore()
  const {
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
  } = useMailStore()

  const handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 240) {
      void loadMoreMessages()
    }
  }
  const hasDockedCompose = composeDrafts.some((draft) => draft.layout === 'docked')
  const listWidthClass = hasDockedCompose ? 'w-[330px] min-w-[296px]' : 'w-[380px] min-w-[320px]'

  if (!currentFolder && !searchMode) {
    return (
      <div className={`flex ${listWidthClass} items-center justify-center border-r border-white/70 bg-white/45 px-6 text-sumi-text-muted`}>
        <div className="text-center">
          <p className="text-sm font-semibold text-sumi-text">フォルダを選ぶとおたよりが並びます</p>
          <p className="mt-2 text-xs text-sumi-text-muted">
            まずは左のルートから受信トレイや送信済みを選んでください。
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className={`flex h-full ${listWidthClass} flex-col border-r border-white/70 bg-white/45`}>
      <div className="shrink-0 border-b border-white/75 px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold tracking-[0.18em] text-sumi-text-muted">
              {searchMode ? 'SEARCH RESULTS' : 'CURRENT BAG'}
            </p>
            <span className="mt-1 block truncate font-display text-2xl text-sumi-text">
              {searchMode ? '検索結果' : currentFolder?.name || 'おたより'}
            </span>
            <p className="mt-1 text-[11px] text-sumi-text-muted">
              {searchMode
                ? `「${lastQuery || searchQuery}」に一致したメール`
                : '新しい順に、読みやすく並べています。'}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {searchMode && (
              <button
                onClick={() => clearSearch()}
                className="rounded-full border border-white/75 bg-white/80 px-3 py-1.5 text-[10px] font-semibold text-sumi-text-muted transition hover:text-sumi-text"
              >
                検索を閉じる
              </button>
            )}
            <span className="rounded-full bg-white/80 px-3 py-1 text-[10px] font-semibold text-sumi-text-muted">
              {messages.length}件
            </span>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2 rounded-2xl bg-white/70 px-3 py-2 text-[11px] text-sumi-text-muted">
          {searchMode ? <Search size={13} className="text-sumi-accent" /> : <Sparkles size={13} className="text-sumi-accent" />}
          <span>
            {searching
              ? 'メールを検索しています…'
              : searchMode
                ? '差出人・件名・本文から横断検索'
                : '未読にはピンクのドットが付きます'}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3 pt-2" onScroll={handleScroll}>
        {loading && messages.length === 0 ? (
          <div className="flex h-32 items-center justify-center">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-sumi-accent border-t-transparent" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-40 items-center justify-center px-6 text-center text-xs text-sumi-text-muted">
            {searchMode
              ? '一致するメールは見つかりませんでした。語句を短くするか、別のキーワードで試してください。'
              : 'このフォルダにはまだメールがありません。'}
          </div>
        ) : (
          messages.map((message) => {
            const unread = isUnread(message)
            const isActive = currentMessage?.id === message.id

            return (
              <button
                key={message.id}
                onClick={() => openMessage(message.id)}
                className={`mx-2 my-2 block w-[calc(100%-1rem)] rounded-[24px] border px-4 py-4 text-left transition-all ${
                  isActive
                    ? 'border-white/80 bg-[linear-gradient(135deg,rgba(255,255,255,0.96),rgba(255,235,227,0.92))] shadow-[0_18px_35px_rgba(255,191,160,0.18)]'
                    : 'border-transparent bg-white/62 hover:-translate-y-0.5 hover:bg-white/88 hover:shadow-[0_14px_28px_rgba(255,255,255,0.55)]'
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
                    {message.subject || '(件名なし)'}
                  </div>
                  {message.has_attachments > 0 && (
                    <span className="shrink-0 text-sumi-text-muted">
                      <Paperclip size={12} />
                    </span>
                  )}
                </div>

                {message.snippet && message.snippet !== message.subject && (
                  <div className="mt-1 line-clamp-2 text-[11px] leading-5 text-sumi-text-muted/75">
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
                さらに読み込む
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}