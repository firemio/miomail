import { useEffect, useMemo, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import { invoke } from '@tauri-apps/api/core'
import { api, isTauriRuntime } from '../../lib/ipc'
import {
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
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import type { Attachment } from '../../types'
import { formatFileSize } from '../../lib/format'
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
      if (path) setSavedNote(`保存しました: ${path}`)
    })

  const handleSaveAll = () =>
    run('all', async () => {
      const dir = await api.attachment.saveAll(messageId)
      if (dir) setSavedNote(`保存しました: ${dir}`)
    })

  if (attachments.length === 0) return null

  return (
    <div className="shrink-0 border-b border-white/70 px-8 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-sumi-text-muted">
          <Paperclip size={12} />
          添付ファイル {attachments.length}件
        </span>
        {attachments.length >= 2 && (
          <button
            onClick={handleSaveAll}
            disabled={busyId !== null}
            data-testid="attachment-save-all"
            className="inline-flex items-center gap-1 rounded-full border border-white/70 bg-white/70 px-2.5 py-1 text-[10px] font-semibold text-sumi-text-muted transition hover:text-sumi-text disabled:opacity-50"
          >
            <FolderDown size={11} />
            {busyId === 'all' ? '保存中...' : 'すべて保存'}
          </button>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {attachments.map((attachment) => {
          const Icon = attachmentIcon(attachment.mime_type)
          const size = formatFileSize(attachment.size)
          return (
            <div
              key={attachment.id}
              className="group flex max-w-[280px] items-center gap-1 rounded-2xl border border-white/80 bg-white/80 py-1.5 pl-3 pr-1.5 shadow-[0_4px_12px_rgba(181,132,112,0.08)]"
            >
              <button
                onClick={() => handleOpen(attachment)}
                disabled={busyId !== null}
                data-testid={`attachment-open-${attachment.id}`}
                title={`${attachment.filename}を開く`}
                className="flex min-w-0 items-center gap-2 text-left disabled:opacity-50"
              >
                <Icon size={15} className="shrink-0 text-sumi-accent" />
                <span className="min-w-0">
                  <span className="block truncate text-xs font-semibold text-sumi-text">
                    {attachment.filename}
                  </span>
                  <span className="block text-[10px] text-sumi-text-muted">
                    {busyId === attachment.id
                      ? '処理中...'
                      : [size, attachment.is_inline ? 'インライン' : '']
                          .filter(Boolean)
                          .join(' · ')}
                  </span>
                </span>
              </button>
              <button
                onClick={() => handleSave(attachment)}
                disabled={busyId !== null}
                data-testid={`attachment-save-${attachment.id}`}
                title="名前を付けて保存"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sumi-text-muted transition hover:bg-sumi-accent/10 hover:text-sumi-accent disabled:opacity-50"
              >
                <Download size={13} />
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

  return new Date(dateStr).toLocaleString('ja-JP', {
    year: 'numeric',
    month: 'long',
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

async function openExternalLink(url: string) {
  if (!/^https?:\/\//i.test(url) && !/^mailto:/i.test(url)) {
    return
  }

  if (isTauriRuntime) {
    try {
      await invoke('plugin:opener|open_url', { url })
      return
    } catch {
      // fall through to window.open
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}

export function MessageView() {
  const { currentMessage, closeMessage, deleteMessage, markRead, accounts } = useMailStore()
  const { openCompose, themeId } = useUIStore()
  const { gainBond } = useMascotStore()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showRemoteImages, setShowRemoteImages] = useState(false)

  useEffect(() => {
    setConfirmDelete(false)
    setShowRemoteImages(false)
  }, [currentMessage?.id])

  const hasRemoteImages = useMemo(
    () => detectRemoteImages(currentMessage?.html_body || ''),
    [currentMessage]
  )

  // Links inside the sandboxed iframe post a message; open them in the
  // system browser instead of navigating the (blocked) iframe
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; href?: string } | null
      if (data?.type === 'miomail:open-link' && typeof data.href === 'string') {
        void openExternalLink(data.href)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

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
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src ${imgSrc}; font-src data:;">
        <style>
          body {
            font-family: 'Yu Gothic UI', 'Meiryo', sans-serif;
            font-size: 14px;
            line-height: 1.72;
            color: ${mailText};
            background: ${mailBg};
            padding: 24px 28px 36px;
            margin: 0;
            word-break: break-word;
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
        </style>
      </head>
      <body>${sanitized}<script>
        document.addEventListener('click', function (event) {
          var anchor = event.target && event.target.closest ? event.target.closest('a') : null;
          if (anchor && anchor.getAttribute('href')) {
            event.preventDefault();
            parent.postMessage({ type: 'miomail:open-link', href: anchor.getAttribute('href') }, '*');
          }
        });
      </script></body>
      </html>
    `

    const iframe = iframeRef.current
    iframe.srcdoc = doc

    return () => {
      iframe.srcdoc = ''
    }
  }, [currentMessage, showRemoteImages, themeId])

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
      <div className="flex shrink-0 items-center justify-between border-b border-white/70 px-6 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleReply}
              data-testid="message-reply-button"
            className="flex h-10 items-center gap-1.5 rounded-full border border-white/70 bg-white/70 px-4 text-xs font-semibold text-sumi-text-muted transition hover:text-sumi-text"
            title="返信"
          >
            <Reply size={13} />
            <span>返信</span>
          </button>
          <button
            onClick={handleForward}
              data-testid="message-forward-button"
            className="flex h-10 items-center gap-1.5 rounded-full border border-white/70 bg-white/70 px-4 text-xs font-semibold text-sumi-text-muted transition hover:text-sumi-text"
            title="転送"
          >
            <Forward size={13} />
            <span>転送</span>
          </button>
          <button
            onClick={() => markRead(currentMessage.id, !read)}
            className="flex h-10 items-center gap-1.5 rounded-full border border-white/70 bg-white/70 px-4 text-xs font-semibold text-sumi-text-muted transition hover:text-sumi-text"
            title={read ? '未読に戻す' : '既読にする'}
          >
            {read ? <Mail size={13} /> : <MailOpen size={13} />}
            <span>{read ? '未読に戻す' : '既読にする'}</span>
          </button>
          {confirmDelete ? (
            <div className="flex items-center gap-2 rounded-full border border-red-400/30 bg-red-400/20 px-3 py-1">
              <span className="text-xs font-semibold text-red-500">ゴミ箱へ移動しますか？</span>
              <button
                onClick={() => {
                  setConfirmDelete(false)
                  void deleteMessage(currentMessage.id)
                }}
                data-testid="message-confirm-delete"
                className="rounded-full bg-red-400 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-500"
              >
                移動する
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="rounded-full px-2 py-1.5 text-xs font-semibold text-sumi-text-muted transition hover:text-sumi-text"
              >
                やめる
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              data-testid="message-delete-button"
              className="flex h-10 items-center gap-1.5 rounded-full border border-red-400/30 bg-red-400/15 px-4 text-xs font-semibold text-red-400 transition hover:bg-red-400/25"
              title="ゴミ箱へ移動"
            >
              <Trash2 size={13} />
              <span>削除</span>
            </button>
          )}
        </div>

        <button
          onClick={closeMessage}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-white/70 bg-white/70 text-sumi-text-muted transition hover:text-sumi-text"
          title="閉じる"
        >
          <X size={14} />
        </button>
      </div>

      <div className="shrink-0 border-b border-white/70 px-8 py-6">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-full border border-white/70 bg-white/70 px-3 py-1 text-[11px] font-semibold tracking-[0.16em] text-sumi-text-muted">
            OPENED LETTER
          </div>
          {!read && (
            <div className="inline-flex items-center gap-1 rounded-full bg-sumi-unread/20 px-3 py-1 text-[10px] font-semibold text-sumi-unread">
              <Sparkles size={12} />
              未読
            </div>
          )}
        </div>

        <h2 className="mb-4 text-[28px] font-semibold leading-snug text-sumi-text">
          {currentMessage.subject || '(件名なし)'}
        </h2>

        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="min-w-0 space-y-2">
            <div className="text-xs">
              <span className="text-sumi-text-muted">差出人: </span>
              <span className="break-all text-sumi-text">{currentMessage.from_address}</span>
            </div>
            <div className="text-xs">
              <span className="text-sumi-text-muted">宛先: </span>
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
      </div>

      <AttachmentChips
        attachments={currentMessage.attachments ?? []}
        messageId={currentMessage.id}
      />

      {hasRemoteImages && !showRemoteImages && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-amber-100 bg-amber-50/80 px-8 py-2">
          <p className="text-[11px] leading-4 text-amber-800">
            プライバシー保護のため、外部サーバーの画像を表示していません
          </p>
          <button
            onClick={() => setShowRemoteImages(true)}
            data-testid="show-remote-images"
            className="shrink-0 rounded-full border border-amber-200 bg-white/85 px-3 py-1 text-[11px] font-semibold text-amber-800 transition hover:bg-white"
          >
            画像を表示
          </button>
        </div>
      )}

      <div className="flex-1 overflow-hidden">
        <iframe
          ref={iframeRef}
          className="h-full w-full border-0 bg-transparent"
          sandbox="allow-scripts"
          title="Email content"
        />
      </div>
    </div>
  )
}
