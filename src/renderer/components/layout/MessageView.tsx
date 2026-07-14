import { useEffect, useMemo, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import { invoke } from '@tauri-apps/api/core'
import { isTauriRuntime } from '../../lib/ipc'
import {
  Forward,
  Mail,
  MailOpen,
  Reply,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { useMailStore } from '../../stores/mailStore'
import { useMascotStore } from '../../stores/mascotStore'
import { useUIStore } from '../../stores/uiStore'

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
  const { openCompose } = useUIStore()
  const { gainBond } = useMascotStore()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    setConfirmDelete(false)
  }, [currentMessage?.id])

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
      `<pre style="font-family:inherit;white-space:pre-wrap;color:#52362f;">${escapeHtml(
        currentMessage.text_body || ''
      )}</pre>`

    const sanitized = DOMPurify.sanitize(html, {
      ALLOWED_TAGS: [
        'p',
        'br',
        'div',
        'span',
        'a',
        'b',
        'strong',
        'i',
        'em',
        'u',
        'ul',
        'ol',
        'li',
        'table',
        'tr',
        'td',
        'th',
        'thead',
        'tbody',
        'h1',
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
        'blockquote',
        'pre',
        'code',
        'img',
        'hr',
      ],
      ALLOWED_ATTR: [
        'href',
        'src',
        'alt',
        'style',
        'class',
        'width',
        'height',
        'border',
        'cellpadding',
        'cellspacing',
        'colspan',
        'rowspan',
        'align',
        'valign',
      ],
      FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'style'],
    })

    const doc = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: cid:;">
        <style>
          body {
            font-family: 'Yu Gothic UI', 'Meiryo', sans-serif;
            font-size: 14px;
            line-height: 1.72;
            color: #52362f;
            background: #fffdfb;
            padding: 24px 28px 36px;
            margin: 0;
            word-break: break-word;
          }
          a { color: #f76f8e; }
          blockquote {
            border-left: 3px solid #f0d7cb;
            padding-left: 14px;
            margin: 10px 0;
            color: #9b776d;
          }
          img { max-width: 100%; height: auto; }
          table { border-collapse: collapse; }
          td, th { padding: 4px 8px; border: 1px solid #f0d7cb; }
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
  }, [currentMessage])

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
            <div className="flex items-center gap-2 rounded-full border border-red-100 bg-red-50/90 px-3 py-1">
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
              className="flex h-10 items-center gap-1.5 rounded-full border border-red-100 bg-red-50/80 px-4 text-xs font-semibold text-red-400 transition hover:bg-red-100"
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

      <div className="flex-1 overflow-hidden">
        <iframe
          ref={iframeRef}
          className="h-full w-full border-0 bg-white"
          sandbox="allow-scripts"
          title="Email content"
        />
      </div>
    </div>
  )
}
