import { t, dateLocale } from '../../lib/i18n'
import { useEffect, useMemo, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import { api } from '../../lib/ipc'
import { bindEmailLinks } from '../../lib/emailLinks'
import {
  ChevronDown,
  ChevronLeft,
  Download,
  FileArchive,
  FileAudio,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  File as FileIcon,
  FolderDown,
  Forward,
  Mail,
  MailOpen,
  Paperclip,
  Reply,
  Trash2,
  X,
} from 'lucide-react'
import type { Attachment } from '../../types'
import { formatFileSize } from '../../lib/format'
import { useIsNarrowLayout } from '../../lib/useNarrowLayout'
import { useMailStore } from '../../stores/mailStore'
import { useMascotStore } from '../../stores/mascotStore'
import { useUIStore } from '../../stores/uiStore'

function attachmentIcon(mimeType: string) {
  if (mimeType.startsWith('image/')) return FileImage
  if (mimeType.startsWith('audio/')) return FileAudio
  if (mimeType.startsWith('video/')) return FileVideo
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType === 'text/csv')
    return FileSpreadsheet
  if (
    mimeType.includes('zip') ||
    mimeType.includes('compressed') ||
    mimeType.includes('x-tar') ||
    mimeType.includes('rar')
  )
    return FileArchive
  if (
    mimeType === 'application/pdf' ||
    mimeType.startsWith('text/') ||
    mimeType.includes('word') ||
    mimeType.includes('document')
  )
    return FileText
  return FileIcon
}

function AttachmentChips({ attachments, messageId }: { attachments: Attachment[]; messageId: number }) {
  const narrow = useIsNarrowLayout()
  const [busyId, setBusyId] = useState<number | 'all' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savedNote, setSavedNote] = useState<string | null>(null)

  useEffect(() => {
    setBusyId(null)
    setError(null)
    setSavedNote(null)
  }, [messageId])

  const run = async (key: number | 'all', action: () => Promise<void>) => {
    if (busyId !== null) return
    setBusyId(key)
    setError(null)
    setSavedNote(null)
    try {
      await action()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyId(null)
    }
  }

  const handleOpen = (attachment: Attachment) =>
    run(attachment.id, async () => {
      await api.attachment.open(attachment.id)
    })

  const handleSave = (attachment: Attachment) =>
    run(attachment.id, async () => {
      const path = await api.attachment.save(attachment.id)
      if (path) setSavedNote(t("保存しました: {0}", { "0": path }))
    })

  const handleSaveAll = () =>
    run('all', async () => {
      const dir = await api.attachment.saveAll(messageId)
      if (dir) setSavedNote(t("保存しました: {0}", { "0": dir }))
    })

  if (attachments.length === 0) return null

  return (
    <div className={`shrink-0 border-b border-white/70 ${narrow ? 'px-3 py-2' : 'px-8 py-3'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-sumi-text-muted">
          <Paperclip size={12} />
          {t("添付ファイル")}{attachments.length}{t("件")}</span>
        {attachments.length >= 2 && (
          <button
            onClick={handleSaveAll}
            disabled={busyId !== null}
            data-testid="attachment-save-all"
            className={`inline-flex items-center gap-1 rounded-full border border-white/70 bg-white/70 text-[10px] font-semibold text-sumi-text-muted transition hover:text-sumi-text disabled:opacity-50 ${
              narrow ? 'h-9 px-3.5' : 'px-2.5 py-1'
            }`}
          >
            <FolderDown size={11} />
            {busyId === 'all' ? t("保存中...") : t("すべて保存")}
          </button>
        )}
      </div>
      {/* 1カラム表示では折り返さず横に送る。折り返すと添付が多いメールで本文の場所が無くなる */}
      <div className={`mt-2 flex gap-2 ${narrow ? 'overflow-x-auto pb-1' : 'flex-wrap'}`}>
        {attachments.map((attachment) => {
          const Icon = attachmentIcon(attachment.mime_type)
          const size = formatFileSize(attachment.size)
          return (
            <div
              key={attachment.id}
              className={`group flex items-center gap-1 rounded-2xl border border-white/80 bg-white/80 py-1.5 pl-3 pr-1.5 shadow-[0_4px_12px_rgba(181,132,112,0.08)] ${
                narrow ? 'max-w-[240px] shrink-0' : 'max-w-[280px]'
              }`}
            >
              <button
                onClick={() => handleOpen(attachment)}
                disabled={busyId !== null}
                data-testid={`attachment-open-${attachment.id}`}
                title={t("{0}を開く", { "0": attachment.filename })}
                className={`flex min-w-0 items-center gap-2 text-left disabled:opacity-50 ${narrow ? 'min-h-10' : ''}`}
              >
                <Icon size={15} className="shrink-0 text-sumi-accent" />
                <span className="min-w-0">
                  <span className="block truncate text-xs font-semibold text-sumi-text">
                    {attachment.filename}
                  </span>
                  <span className="block text-[10px] text-sumi-text-muted">
                    {busyId === attachment.id
                      ? t("処理中...")
                      : [size, attachment.is_inline ? t("インライン") : '']
                          .filter(Boolean)
                          .join(' · ')}
                  </span>
                </span>
              </button>
              <button
                onClick={() => handleSave(attachment)}
                disabled={busyId !== null}
                data-testid={`attachment-save-${attachment.id}`}
                title={t("名前を付けて保存")}
                className={`flex shrink-0 items-center justify-center rounded-full text-sumi-text-muted transition hover:bg-sumi-accent/10 hover:text-sumi-accent disabled:opacity-50 ${
                  narrow ? 'h-10 w-10' : 'h-8 w-8'
                }`}
              >
                <Download size={narrow ? 15 : 13} />
              </button>
            </div>
          )
        })}
      </div>
      {error && (
        <p className="mt-2 text-[11px] leading-4 text-red-500" data-testid="attachment-error">
          {error}
        </p>
      )}
      {savedNote && (
        <p className="mt-2 truncate text-[11px] leading-4 text-emerald-600" data-testid="attachment-saved">
          {savedNote}
        </p>
      )}
    </div>
  )
}

function escapeHtml(str: string) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatFullDate(dateStr: string) {
  if (!dateStr) return ''

  return new Date(dateStr).toLocaleString(dateLocale(), {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** 1カラム表示の見出し用。年を省いて1行に収める。 */
function formatShortDate(dateStr: string) {
  if (!dateStr) return ''

  return new Date(dateStr).toLocaleString(dateLocale(), {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function isRead(flags: string) {
  try {
    return JSON.parse(flags || '[]').includes('\\Seen')
  } catch {
    return false
  }
}

/**
 * スマホ幅のときだけ本文に足す CSS。幅を決め打ちした HTML メール(600px の表など)を
 * 画面内に収める。それでも収まらないものは、本文の中だけを横に送れる(画面全体は動かない)。
 */
const NARROW_MAIL_CSS = `
          img, video { max-width: 100% !important; height: auto !important; }
          table { max-width: 100% !important; }
          td, th { padding: 3px 5px; }
          pre { white-space: pre-wrap; word-break: break-word; }
`

/** Tags that stay dangerous even inside the sandboxed iframe. Everything
 *  else (style/font/center/bgcolor tables…) is kept so real-world HTML
 *  mail renders faithfully; scripts and remote loads are stopped by
 *  DOMPurify + the iframe sandbox + its CSP. */
const EMAIL_FORBID_TAGS = [
  'script',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'form',
  'input',
  'textarea',
  'select',
  'option',
  'button',
  'base',
  'link',
  'meta',
  'dialog',
]

/** Sanitize a full HTML mail document, preserving <style> blocks from the
 *  head by moving them in front of the body content. */
function sanitizeEmailHtml(html: string): string {
  const dom = DOMPurify.sanitize(html, {
    WHOLE_DOCUMENT: true,
    RETURN_DOM: true,
    FORBID_TAGS: EMAIL_FORBID_TAGS,
  }) as HTMLElement
  const headStyles = Array.from(dom.querySelectorAll('head style'))
    .map((style) => style.outerHTML)
    .join('')
  const body = dom.querySelector('body')
  return headStyles + (body ? body.innerHTML : dom.innerHTML)
}

/** True when the mail references images (or CSS backgrounds) on remote
 *  servers — those are blocked until the user opts in. */
function detectRemoteImages(html: string): boolean {
  return (
    /(?:src|background)\s*=\s*["']?https?:\/\//i.test(html) ||
    /url\(\s*["']?https?:\/\//i.test(html)
  )
}

export function MessageView() {
  const narrow = useIsNarrowLayout()
  const { currentMessage, closeMessage, deleteMessage, markRead, accounts } = useMailStore()
  const { openCompose, themeId } = useUIStore()
  const { gainBond } = useMascotStore()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showRemoteImages, setShowRemoteImages] = useState(false)
  const [linkError, setLinkError] = useState<string | null>(null)
  // 1カラム表示では宛先・CC を畳んでおく(開いたままだと本文の場所が残らない)
  const [showDetails, setShowDetails] = useState(false)

  useEffect(() => {
    setConfirmDelete(false)
    setShowRemoteImages(false)
    setLinkError(null)
    setShowDetails(false)
  }, [currentMessage?.id])

  const hasRemoteImages = useMemo(
    () => detectRemoteImages(currentMessage?.html_body || ''),
    [currentMessage]
  )

  const senderAccount = useMemo(() => {
    if (!currentMessage) {
      return accounts[0]
    }

    return accounts.find((account) => account.id === currentMessage.account_id) ?? accounts[0]
  }, [accounts, currentMessage])

  useEffect(() => {
    if (!currentMessage || !iframeRef.current) return

    const html =
      currentMessage.html_body ||
      `<pre style="font-family:inherit;white-space:pre-wrap;">${escapeHtml(
        currentMessage.text_body || ''
      )}</pre>`

    const sanitized = sanitizeEmailHtml(html)
    const imgSrc = showRemoteImages ? 'data: cid: https: http:' : 'data: cid:'

    // iframe内にはアプリのCSS変数が届かないため、現在のテーマの
    // 実際の色を読み取ってsrcdocへ埋め込む(themeId変更で再生成される)
    const themeStyles = getComputedStyle(document.body)
    const themeColor = (name: string, fallback: string) => {
      const value = themeStyles.getPropertyValue(name).trim()
      return value ? `rgb(${value})` : fallback
    }
    const mailBg = themeColor('--panel-bg', '#fffdfb')
    const mailText = themeColor('--sumi-text', '#52362f')
    const mailMuted = themeColor('--sumi-text-muted', '#9b776d')
    const mailAccent = themeColor('--sumi-accent-strong', '#f76f8e')
    const mailBorder = themeColor('--sumi-border', '#f0d7cb')

    const doc = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; img-src ${imgSrc}; font-src data:; form-action 'none'; base-uri 'none';">
        <style>
          body {
            font-family: 'Yu Gothic UI', 'Meiryo', sans-serif;
            font-size: ${narrow ? '15px' : '14px'};
            line-height: 1.72;
            color: ${mailText};
            background: ${mailBg};
            padding: ${narrow ? '14px 14px 28px' : '24px 28px 36px'};
            margin: 0;
            word-break: break-word;
            overflow-wrap: anywhere;
            -webkit-text-size-adjust: 100%;
            text-size-adjust: 100%;
          }
          a { color: ${mailAccent}; }
          blockquote {
            border-left: 3px solid ${mailBorder};
            padding-left: 14px;
            margin: 10px 0;
            color: ${mailMuted};
          }
          img { max-width: 100%; height: auto; }
          table { border-collapse: collapse; }
          td, th { padding: 4px 8px; border: 1px solid ${mailBorder}; }
          ${narrow ? NARROW_MAIL_CSS : ''}
        </style>
      </head>
      <body>${sanitized}</body>
      </html>
    `

    const iframe = iframeRef.current
    iframe.srcdoc = doc

    return () => {
      iframe.srcdoc = ''
    }
  }, [currentMessage, narrow, showRemoteImages, themeId])

  if (!currentMessage) return null

  const read = isRead(currentMessage.flags)
  const source = {
    id: currentMessage.id,
    message_id: currentMessage.message_id,
    subject: currentMessage.subject,
    from_address: currentMessage.from_address,
    to_addresses: currentMessage.to_addresses,
    cc_addresses: currentMessage.cc_addresses,
    date: currentMessage.date,
    text_body: currentMessage.text_body,
    attachments: currentMessage.attachments ?? [],
  }

  const handleReply = () => {
    openCompose({
      mode: 'reply',
      source,
      fromAddress: senderAccount?.email,
    })
    gainBond(1)
  }

  const handleForward = () => {
    openCompose({
      mode: 'forward',
      source,
      fromAddress: senderAccount?.email,
    })
    gainBond(1)
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-white/35">
      <div className={`flex shrink-0 items-center justify-between border-b border-white/70 ${narrow ? 'px-2 py-2' : 'px-6 py-4'}`}>
        {narrow && confirmDelete ? (
          // 1カラム表示では、確認を他のボタンと並べると画面からはみ出す。この行を丸ごと確認に切り替える
          <div className="flex min-h-11 w-full items-center gap-1.5 rounded-full border border-red-400/30 bg-red-400/20 py-1 pl-4 pr-1.5">
            <span className="min-w-0 flex-1 text-xs font-semibold text-red-500">{t("ゴミ箱へ移動しますか？")}</span>
            <button
              onClick={() => {
                setConfirmDelete(false)
                void deleteMessage(currentMessage.id)
              }}
              data-testid="message-confirm-delete"
              className="h-9 shrink-0 rounded-full bg-red-400 px-4 text-xs font-semibold text-white transition hover:bg-red-500"
            >
              {t("移動する")}</button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="h-9 shrink-0 rounded-full px-3 text-xs font-semibold text-sumi-text-muted transition hover:text-sumi-text"
            >
              {t("やめる")}</button>
          </div>
        ) : (
        <>
        <div className={`flex flex-wrap items-center ${narrow ? 'min-w-0 flex-1 gap-1.5' : 'gap-2'}`}>
          {narrow && (
            <button
              onClick={closeMessage}
              aria-label={t("メール一覧へ戻る")}
              title={t("メール一覧へ戻る")}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/70 bg-white/70 text-sumi-text-muted transition hover:text-sumi-text"
            >
              <ChevronLeft size={18} />
            </button>
          )}
          <button
            onClick={handleReply}
              data-testid="message-reply-button"
            className={`flex items-center gap-1.5 rounded-full border border-white/70 bg-white/70 text-xs font-semibold text-sumi-text-muted transition hover:text-sumi-text ${narrow ? 'h-11 px-3.5' : 'h-10 px-4'}`}
            title={t("返信")}
          >
            <Reply size={13} />
            <span>{t("返信")}</span>
          </button>
          <button
            onClick={handleForward}
              data-testid="message-forward-button"
            className={`flex items-center gap-1.5 rounded-full border border-white/70 bg-white/70 text-xs font-semibold text-sumi-text-muted transition hover:text-sumi-text ${
              // 1カラム表示ではアイコンだけにする。ラベルを2つ並べると 320px 幅や英語表示で列が2段に折れる
              narrow ? 'h-11 w-11 shrink-0 justify-center' : 'h-10 px-4'
            }`}
            title={t("転送")}
            aria-label={t("転送")}
          >
            <Forward size={narrow ? 16 : 13} />
            {!narrow && <span>{t("転送")}</span>}
          </button>
          <button
            onClick={() => markRead(currentMessage.id, !read)}
            className={`flex items-center gap-1.5 rounded-full border border-white/70 bg-white/70 text-xs font-semibold text-sumi-text-muted transition hover:text-sumi-text ${
              // 1カラム表示ではラベルを省き、右端へ寄せる(返信・転送と押し間違えないように)
              narrow ? 'ml-auto h-11 w-11 shrink-0 justify-center' : 'h-10 px-4'
            }`}
            title={read ? t("未読に戻す") : t("既読にする")}
            aria-label={read ? t("未読に戻す") : t("既読にする")}
          >
            {read ? <Mail size={narrow ? 16 : 13} /> : <MailOpen size={narrow ? 16 : 13} />}
            {!narrow && <span>{read ? t("未読に戻す") : t("既読にする")}</span>}
          </button>
          {confirmDelete ? (
            <div className="flex items-center gap-2 rounded-full border border-red-400/30 bg-red-400/20 px-3 py-1">
              <span className="text-xs font-semibold text-red-500">{t("ゴミ箱へ移動しますか？")}</span>
              <button
                onClick={() => {
                  setConfirmDelete(false)
                  void deleteMessage(currentMessage.id)
                }}
                data-testid="message-confirm-delete"
                className="rounded-full bg-red-400 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-500"
              >
                {t("移動する")}</button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="rounded-full px-2 py-1.5 text-xs font-semibold text-sumi-text-muted transition hover:text-sumi-text"
              >
                {t("やめる")}</button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              data-testid="message-delete-button"
              className={`flex items-center gap-1.5 rounded-full border border-red-400/30 bg-red-400/15 text-xs font-semibold text-red-400 transition hover:bg-red-400/25 ${
                narrow ? 'h-11 w-11 shrink-0 justify-center' : 'h-10 px-4'
              }`}
              title={t("ゴミ箱へ移動")}
              aria-label={t("ゴミ箱へ移動")}
            >
              <Trash2 size={narrow ? 16 : 13} />
              {!narrow && <span>{t("削除")}</span>}
            </button>
          )}
        </div>

        {/* 1カラム表示では左端の「戻る」が同じ働きをするので出さない */}
        {!narrow && (
        <button
          onClick={closeMessage}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-white/70 bg-white/70 text-sumi-text-muted transition hover:text-sumi-text"
          title={t("閉じる")}
        >
          <X size={14} />
        </button>
        )}
        </>
        )}
      </div>

      <div className={`shrink-0 border-b border-white/70 ${narrow ? 'px-4 pb-1.5 pt-3' : 'px-6 py-4'}`}>
        {!read && !narrow && <span className="mb-2 inline-block rounded-full bg-sumi-unread/20 px-3 py-1 text-xs text-sumi-text">{t("未読")}</span>}

        {/* 1カラム表示では見出しを小さく・短くして、本文に高さを譲る。長い件名は詳細を開くと全部読める */}
        <h2
          className={`font-semibold leading-snug text-sumi-text ${
            narrow ? `mb-1 break-words text-lg ${showDetails ? '' : 'line-clamp-2'}` : 'mb-4 text-[28px]'
          }`}
        >
          {currentMessage.subject || t("(件名なし)")}
        </h2>

        {narrow ? (
          <div>
            <button
              type="button"
              onClick={() => setShowDetails((value) => !value)}
              aria-expanded={showDetails}
              aria-label={showDetails ? t("宛先などを閉じる") : t("宛先などを表示")}
              className="flex min-h-10 w-full items-center gap-2 text-left"
            >
              <span className="min-w-0 flex-1 truncate text-xs text-sumi-text">{currentMessage.from_address}</span>
              <span className="shrink-0 text-[11px] text-sumi-text-muted">{formatShortDate(currentMessage.date)}</span>
              <ChevronDown size={15} className={`shrink-0 text-sumi-text-muted transition-transform ${showDetails ? 'rotate-180' : ''}`} />
            </button>
            {showDetails && (
              <div className="max-h-[28vh] space-y-1.5 overflow-y-auto pb-2">
                <div className="text-xs">
                  <span className="text-sumi-text-muted">{t("差出人:")}</span>
                  <span className="break-all text-sumi-text">{currentMessage.from_address}</span>
                </div>
                <div className="text-xs">
                  <span className="text-sumi-text-muted">{t("宛先:")}</span>
                  <span className="break-all text-sumi-text">{currentMessage.to_addresses}</span>
                </div>
                {currentMessage.cc_addresses && (
                  <div className="text-xs">
                    <span className="text-sumi-text-muted">CC: </span>
                    <span className="break-all text-sumi-text">{currentMessage.cc_addresses}</span>
                  </div>
                )}
                <div className="text-[11px] text-sumi-text-muted">{formatFullDate(currentMessage.date)}</div>
              </div>
            )}
          </div>
        ) : (
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="min-w-0 space-y-2">
            <div className="text-xs">
              <span className="text-sumi-text-muted">{t("差出人:")}</span>
              <span className="break-all text-sumi-text">{currentMessage.from_address}</span>
            </div>
            <div className="text-xs">
              <span className="text-sumi-text-muted">{t("宛先:")}</span>
              <span className="break-all text-sumi-text">{currentMessage.to_addresses}</span>
            </div>
            {currentMessage.cc_addresses && (
              <div className="text-xs">
                <span className="text-sumi-text-muted">CC: </span>
                <span className="break-all text-sumi-text">{currentMessage.cc_addresses}</span>
              </div>
            )}
          </div>

          <span className="shrink-0 text-[11px] text-sumi-text-muted">
            {formatFullDate(currentMessage.date)}
          </span>
        </div>
        )}
      </div>

      <AttachmentChips
        attachments={currentMessage.attachments ?? []}
        messageId={currentMessage.id}
      />

      {hasRemoteImages && !showRemoteImages && (
        <div className={`flex shrink-0 items-center justify-between gap-2 border-b border-amber-100 bg-amber-50/80 ${narrow ? 'px-3 py-1.5' : 'flex-wrap px-8 py-2'}`}>
          <p className={`text-[11px] leading-4 text-amber-800 ${narrow ? 'min-w-0 flex-1' : ''}`}>
            {t("プライバシー保護のため、外部サーバーの画像を表示していません")}</p>
          <button
            onClick={() => setShowRemoteImages(true)}
            data-testid="show-remote-images"
            className={`shrink-0 rounded-full border border-amber-200 bg-white/85 px-3 text-[11px] font-semibold text-amber-800 transition hover:bg-white ${narrow ? 'h-9' : 'py-1'}`}
          >
            {t("画像を表示")}</button>
        </div>
      )}

      {linkError && (
        <p role="alert" className={`shrink-0 py-2 text-xs text-red-500 ${narrow ? 'px-4' : 'px-8'}`}>
          リンクを開けませんでした: {linkError}
        </p>
      )}
      <div className="flex-1 overflow-hidden">
        <iframe
          ref={iframeRef}
          onLoad={() => {
            const doc = iframeRef.current?.contentDocument
            if (doc) bindEmailLinks(doc, (error) => setLinkError(error instanceof Error ? error.message : String(error)))
          }}
          className="h-full w-full border-0 bg-transparent"
          sandbox="allow-same-origin"
          title="Email content"
        />
      </div>
    </div>
  )
}
