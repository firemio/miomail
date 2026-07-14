import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  FilePlus2,
  Forward,
  GripVertical,
  Paperclip,
  PanelRight,
  PanelRightClose,
  SendHorizontal,
  X,
} from 'lucide-react'
import { api } from '../../lib/ipc'
import { formatFileSize } from '../../lib/format'
import { useMailStore } from '../../stores/mailStore'
import { useMascotStore } from '../../stores/mascotStore'
import { type ComposeDraft, useUIStore } from '../../stores/uiStore'

/** Warn above 20MB, refuse above 25MB (matches the backend limit). */
const ATTACHMENT_WARN_BYTES = 20 * 1024 * 1024
const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024

function escapeHtml(str: string) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function getDraftTitle(draft: ComposeDraft) {
  if (draft.mode === 'reply') return '返信'
  if (draft.mode === 'forward') return '転送'
  return '新規メール'
}

function shortenSubject(subject: string) {
  if (!subject.trim()) return '件名なし'
  return subject.length > 16 ? `${subject.slice(0, 16)}…` : subject
}

function ComposeEditor({
  draft,
  docked,
}: {
  draft: ComposeDraft
  docked: boolean
}) {
  const {
    closeCompose,
    updateComposeDraft,
    toggleComposeLayout,
    openCompose,
    bringComposeToFront,
    moveCompose,
  } = useUIStore()
  const { accounts, currentFolder } = useMailStore()
  const { gainBond, notifySentMail } = useMascotStore()
  const [sending, setSending] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [pickingFiles, setPickingFiles] = useState(false)

  const attachments = draft.attachments ?? []
  const attachmentsTotalSize = attachments.reduce((sum, item) => sum + (item.size || 0), 0)
  const attachmentsTooLarge = attachmentsTotalSize > ATTACHMENT_MAX_BYTES

  const defaultSender = useMemo(() => {
    if (draft.from) return draft.from

    const folderAccount = currentFolder
      ? accounts.find((account) => account.id === currentFolder.account_id)
      : null

    return folderAccount?.email || accounts[0]?.email || ''
  }, [accounts, currentFolder, draft.from])

  useEffect(() => {
    if (!draft.from && defaultSender) {
      updateComposeDraft(draft.id, { from: defaultSender, isDirty: false })
    }
  }, [defaultSender, draft.from, draft.id, updateComposeDraft])

  useEffect(() => {
    setConfirmDiscard(false)
    setSendError(null)
  }, [draft.id])

  const handleMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (docked) return

    const target = event.target as HTMLElement
    if (target.closest('button, input, textarea, select')) {
      return
    }

    bringComposeToFront(draft.id)
    const offsetX = event.clientX - draft.position.x
    const offsetY = event.clientY - draft.position.y

    const onMove = (moveEvent: MouseEvent) => {
      moveCompose(draft.id, {
        x: Math.max(180, moveEvent.clientX - offsetX),
        y: Math.max(88, moveEvent.clientY - offsetY),
      })
    }

    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const handlePickFiles = async () => {
    if (pickingFiles || sending) return

    setPickingFiles(true)
    setSendError(null)
    try {
      const picked = await api.attachment.pickFiles()
      if (picked.length === 0) return

      const knownPaths = new Set(
        attachments.map((item) => item.path).filter(Boolean) as string[]
      )
      const added = picked
        .filter((file) => !knownPaths.has(file.path))
        .map((file) => ({
          id: crypto.randomUUID(),
          name: file.name,
          size: file.size,
          path: file.path,
        }))
      if (added.length > 0) {
        updateComposeDraft(draft.id, { attachments: [...attachments, ...added] })
      }
    } catch (error: unknown) {
      setSendError(error instanceof Error ? error.message : String(error))
    } finally {
      setPickingFiles(false)
    }
  }

  const removeAttachment = (attachmentId: string) => {
    updateComposeDraft(draft.id, {
      attachments: attachments.filter((item) => item.id !== attachmentId),
    })
  }

  const handleSend = async () => {
    const from = draft.from || defaultSender
    if (!draft.to.trim() || !from || attachmentsTooLarge) return

    setSending(true)
    setSendError(null)
    try {
      await api.compose.send({
        from,
        to: draft.to.trim(),
        cc: draft.cc.trim() || undefined,
        subject: draft.subject || '(件名なし)',
        html: `<div style="font-family:'Yu Gothic UI',sans-serif;font-size:14px;color:#52362f;">${escapeHtml(
          draft.body
        ).replace(/\n/g, '<br>')}</div>`,
        text: draft.body,
        inReplyTo: draft.mode === 'reply' ? draft.source?.message_id : undefined,
        references: draft.mode === 'reply' ? draft.source?.message_id : undefined,
        attachments: attachments.map((item) =>
          item.path ? { path: item.path } : { attachmentId: item.attachmentId }
        ),
      })
      notifySentMail(draft.to.trim(), draft.subject || '(件名なし)')
      gainBond(3)
      closeCompose(draft.id, true)
    } catch (error: unknown) {
      setSendError(error instanceof Error ? error.message : String(error))
    } finally {
      setSending(false)
    }
  }

  const requestClose = () => {
    const closed = closeCompose(draft.id)
    if (!closed) {
      setConfirmDiscard(true)
    }
  }

  const cancelDiscard = () => {
    setConfirmDiscard(false)
  }

  const discardAndClose = () => {
    setConfirmDiscard(false)
    closeCompose(draft.id, true)
  }

  const containerClass = docked
    ? 'flex h-full min-w-0 flex-1 flex-col bg-[linear-gradient(180deg,rgba(255,253,251,0.98)_0%,rgba(255,246,241,0.98)_100%)]'
    : 'compose-draft-floating pointer-events-auto flex h-[72vh] min-h-[620px] w-[540px] max-w-[calc(100vw-120px)] flex-col overflow-hidden rounded-[30px] border border-white/85 bg-[linear-gradient(180deg,rgba(255,253,251,0.995)_0%,rgba(255,246,241,0.99)_100%)] shadow-[0_30px_80px_rgba(181,132,112,0.24)] backdrop-blur-md'

  return (
    <div
      className={containerClass}
      style={
        docked
          ? undefined
          : {
              left: draft.position.x,
              top: draft.position.y,
              position: 'fixed',
              zIndex: draft.zIndex,
            }
      }
      onMouseDown={() => !docked && bringComposeToFront(draft.id)}
    >
      <div
        className={`flex shrink-0 items-center justify-between border-b border-white/70 px-5 ${
          docked ? 'h-[70px]' : 'h-[68px] cursor-move'
        }`}
        onMouseDown={handleMouseDown}
      >
        <div className="flex min-w-0 items-center gap-3">
          {!docked && <GripVertical size={14} className="text-sumi-text-muted" />}
          <div className="min-w-0">
            <p className="text-[11px] font-semibold tracking-[0.18em] text-sumi-text-muted">
              LETTER STUDIO
            </p>
            <div className="mt-1 flex items-center gap-2">
              <span className="font-display text-2xl text-sumi-text">{getDraftTitle(draft)}</span>
              <span className="rounded-full bg-white/80 px-2.5 py-1 text-[10px] text-sumi-text-muted">
                自動保存
              </span>
            </div>
          </div>
        </div>

        <div className={`flex shrink-0 items-center ${docked ? 'gap-1' : 'gap-2'}`}>
          <button
            onClick={() =>
              openCompose({
                mode: 'new',
                fromAddress: draft.from || defaultSender,
                layout: draft.layout,
              })
            }
            data-testid="compose-add-draft"
            className={`flex items-center justify-center rounded-full border border-white/70 bg-white/80 text-[11px] font-semibold text-sumi-text-muted transition hover:border-sumi-accent/30 hover:text-sumi-text ${
              docked ? 'h-10 w-10' : 'px-3 py-2'
            }`}
            title="新しい下書きを追加"
          >
            <span className="inline-flex items-center gap-1.5">
              <FilePlus2 size={12} />
              {!docked && '追加'}
            </span>
          </button>
          <button
            onClick={() => toggleComposeLayout(draft.id)}
            data-testid={`compose-toggle-layout-${draft.id}`}
            className={`flex items-center justify-center rounded-full border border-white/70 bg-white/80 text-[11px] font-semibold text-sumi-text-muted transition hover:border-sumi-accent/30 hover:text-sumi-text ${
              docked ? 'h-10 w-10' : 'px-3 py-2'
            }`}
            title={docked ? 'ドッキング解除' : '右パネルに戻す'}
          >
            <span className="inline-flex items-center gap-1.5">
              {docked ? <PanelRight size={12} /> : <PanelRightClose size={12} />}
              {!docked && '右パネルに戻す'}
            </span>
          </button>
          {!docked && (
            <button
              onClick={requestClose}
              data-testid={`compose-close-${draft.id}`}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/70 bg-white/80 text-sumi-text-muted transition hover:text-sumi-text"
              title="下書きを閉じる"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {confirmDiscard && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-amber-100 bg-amber-50/90 px-5 py-3">
          <p className="text-xs text-amber-900">保存済みの下書きを削除しますか？</p>
          <div className="flex items-center gap-2">
            <button
              onClick={cancelDiscard}
              data-testid={`compose-cancel-discard-${draft.id}`}
              className="rounded-full border border-white/80 bg-white/85 px-3 py-1.5 text-[11px] font-semibold text-sumi-text-muted transition hover:text-sumi-text"
            >
              キャンセル
            </button>
            <button
              onClick={discardAndClose}
              data-testid={`compose-confirm-discard-${draft.id}`}
              className="rounded-full bg-[#f58b76] px-3 py-1.5 text-[11px] font-semibold text-white transition hover:brightness-95"
            >
              下書きを削除
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="shrink-0 space-y-3 border-b border-white/70 px-5 py-4">
          {accounts.length > 1 && (
            <div className="flex items-center gap-2">
              <label className="w-12 shrink-0 text-[11px] font-semibold text-sumi-text-muted">
                差出人
              </label>
              <select
                value={draft.from || defaultSender}
                onChange={(event) => updateComposeDraft(draft.id, { from: event.target.value })}
                className="h-10 flex-1 rounded-2xl border border-white/80 bg-white/80 px-3 text-xs text-sumi-text focus:border-sumi-accent/50 focus:outline-none"
              >
                {accounts.map((account) => (
                  <option key={account.id} value={account.email}>
                    {account.name ? `${account.name} <${account.email}>` : account.email}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex items-center gap-2">
            <label className="w-12 shrink-0 text-[11px] font-semibold text-sumi-text-muted">
              宛先
            </label>
            <input
              type="text"
              value={draft.to}
              onChange={(event) => updateComposeDraft(draft.id, { to: event.target.value })}
              placeholder="recipient@example.com"
              className="h-10 flex-1 rounded-2xl border border-white/80 bg-white/80 px-3 text-xs text-sumi-text placeholder-sumi-text-muted/50 focus:border-sumi-accent/50 focus:outline-none"
            />
            {!draft.showCc && (
              <button
                onClick={() => updateComposeDraft(draft.id, { showCc: true })}
                className="text-[10px] font-semibold text-sumi-text-muted hover:text-sumi-accent"
              >
                CC
              </button>
            )}
          </div>

          {draft.showCc && (
            <div className="flex items-center gap-2">
              <label className="w-12 shrink-0 text-[11px] font-semibold text-sumi-text-muted">
                CC
              </label>
              <input
                type="text"
                value={draft.cc}
                onChange={(event) => updateComposeDraft(draft.id, { cc: event.target.value })}
                className="h-10 flex-1 rounded-2xl border border-white/80 bg-white/80 px-3 text-xs text-sumi-text focus:border-sumi-accent/50 focus:outline-none"
              />
            </div>
          )}

          <div className="flex items-center gap-2">
            <label className="w-12 shrink-0 text-[11px] font-semibold text-sumi-text-muted">
              件名
            </label>
            <input
              type="text"
              value={draft.subject}
              onChange={(event) => updateComposeDraft(draft.id, { subject: event.target.value })}
              placeholder="件名を入力"
              className="h-10 flex-1 rounded-2xl border border-white/80 bg-white/80 px-3 text-xs text-sumi-text placeholder-sumi-text-muted/50 focus:border-sumi-accent/50 focus:outline-none"
            />
          </div>
        </div>

        <div className="flex-1 overflow-hidden">
          <textarea
            value={draft.body}
            onChange={(event) => updateComposeDraft(draft.id, { body: event.target.value })}
            placeholder="ここに本文を書いてください"
            className="h-full w-full resize-none bg-transparent px-5 py-5 text-sm leading-7 text-sumi-text placeholder-sumi-text-muted/50 focus:outline-none"
          />
        </div>

        {attachments.length > 0 && (
          <div className="shrink-0 border-t border-white/70 px-5 py-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              {attachments.map((item) => (
                <div
                  key={item.id}
                  className="flex max-w-[220px] items-center gap-1.5 rounded-full border border-white/80 bg-white/85 py-1 pl-2.5 pr-1"
                  title={item.name}
                >
                  {item.attachmentId ? (
                    <Forward size={11} className="shrink-0 text-sumi-accent" />
                  ) : (
                    <Paperclip size={11} className="shrink-0 text-sumi-accent" />
                  )}
                  <span className="min-w-0 truncate text-[11px] font-semibold text-sumi-text">
                    {item.name}
                  </span>
                  {item.size > 0 && (
                    <span className="shrink-0 text-[10px] text-sumi-text-muted">
                      {formatFileSize(item.size)}
                    </span>
                  )}
                  <button
                    onClick={() => removeAttachment(item.id)}
                    aria-label={`${item.name}を削除`}
                    data-testid={`compose-remove-attachment-${item.id}`}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sumi-text-muted/70 transition hover:bg-sumi-accent/10 hover:text-sumi-accent"
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}
            </div>
            {attachmentsTotalSize > ATTACHMENT_WARN_BYTES && (
              <p
                className={`mt-1.5 text-[10px] leading-4 ${
                  attachmentsTooLarge ? 'text-red-500' : 'text-amber-600'
                }`}
              >
                {attachmentsTooLarge
                  ? `合計${formatFileSize(attachmentsTotalSize)}: 25MBを超えているため送信できません`
                  : `合計${formatFileSize(attachmentsTotalSize)}: サイズが大きいため相手側で受信できない場合があります`}
              </p>
            )}
          </div>
        )}

        {sendError && (
          <div className="flex shrink-0 items-start justify-between gap-3 border-t border-red-100 bg-red-50/90 px-5 py-2.5">
            <p className="min-w-0 text-[11px] leading-5 text-red-500">送信に失敗しました: {sendError}</p>
            <button
              onClick={() => setSendError(null)}
              aria-label="エラーを閉じる"
              className="shrink-0 text-[11px] font-semibold text-sumi-text-muted transition hover:text-sumi-text"
            >
              閉じる
            </button>
          </div>
        )}

        <div className="flex h-16 shrink-0 items-center justify-between border-t border-white/70 px-5">
          <div className="flex items-center gap-2">
            <button
              onClick={handlePickFiles}
              disabled={pickingFiles || sending}
              data-testid={`compose-attach-${draft.id}`}
              className="flex h-10 items-center gap-1.5 rounded-full border border-white/70 bg-white/75 px-3.5 text-[11px] font-semibold text-sumi-text-muted transition hover:border-sumi-accent/30 hover:text-sumi-text disabled:opacity-50"
              title="ファイルを添付"
            >
              <Paperclip size={12} />
              {pickingFiles ? '選択中...' : '添付'}
            </button>
            <button
              onClick={requestClose}
              data-testid={`compose-cancel-${draft.id}`}
              className="rounded-full border border-white/70 bg-white/80 px-4 py-2 text-xs font-semibold text-sumi-text-muted transition hover:text-sumi-text"
            >
              キャンセル
            </button>
          </div>

          <button
            onClick={handleSend}
            data-testid={`compose-send-${draft.id}`}
            disabled={sending || !draft.to.trim() || attachmentsTooLarge}
            className="flex h-11 items-center gap-1.5 rounded-full bg-sumi-accent px-5 text-sm font-semibold text-white shadow-[0_18px_30px_rgba(255,138,160,0.34)] transition hover:bg-sumi-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
          >
            <SendHorizontal size={13} />
            {sending ? '送信中...' : '送信'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function ComposePanel() {
  const {
    composeDrafts,
    activeDockedComposeId,
    setActiveDockedCompose,
    openCompose,
    closeCompose,
  } = useUIStore()
  const { accounts, currentFolder } = useMailStore()
  const draftTabsRef = useRef<HTMLDivElement>(null)
  const [discardDraftId, setDiscardDraftId] = useState<string | null>(null)
  const [discardPopoverPosition, setDiscardPopoverPosition] = useState({ top: 0, left: 0 })

  const dockedDrafts = composeDrafts.filter((draft) => draft.layout === 'docked')
  const floatingDrafts = composeDrafts.filter((draft) => draft.layout === 'floating')

  const defaultSender = currentFolder
    ? accounts.find((account) => account.id === currentFolder.account_id)?.email
    : accounts[0]?.email

  const activeDockedDraft =
    dockedDrafts.find((draft) => draft.id === activeDockedComposeId) || dockedDrafts[0] || null

  useEffect(() => {
    if (dockedDrafts.length > 0 && !activeDockedComposeId) {
      setActiveDockedCompose(dockedDrafts[0].id)
    }
  }, [activeDockedComposeId, dockedDrafts, setActiveDockedCompose])

  useEffect(() => {
    const activeTab = draftTabsRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')
    activeTab?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
  }, [activeDockedDraft?.id, dockedDrafts.length])

  const closeDraftTab = (draft: ComposeDraft, trigger: HTMLButtonElement) => {
    if (closeCompose(draft.id)) return

    const triggerRect = trigger.getBoundingClientRect()
    const popoverWidth = 292
    setActiveDockedCompose(draft.id)
    setDiscardPopoverPosition({
      top: triggerRect.bottom + 8,
      left: Math.min(
        Math.max(12, triggerRect.right - popoverWidth),
        window.innerWidth - popoverWidth - 12
      ),
    })
    setDiscardDraftId(draft.id)
  }

  const discardDraft = composeDrafts.find((draft) => draft.id === discardDraftId) || null

  const confirmTabDiscard = () => {
    if (discardDraftId) closeCompose(discardDraftId, true)
    setDiscardDraftId(null)
  }

  return (
    <>
      {activeDockedDraft && (
        <div className="relative flex h-full w-[440px] min-w-[400px] flex-col border-l border-white/80 bg-[linear-gradient(180deg,rgba(255,252,249,0.985)_0%,rgba(255,245,239,0.975)_100%)] backdrop-blur-md">
          <div className="flex h-14 shrink-0 items-center gap-2 border-b border-white/70 px-3">
            <div
              ref={draftTabsRef}
              className="compose-draft-tabs flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pb-2 pt-1.5"
              role="tablist"
              aria-label="下書き"
              onScroll={() => setDiscardDraftId(null)}
            >
              {dockedDrafts.map((draft) => {
                const active = draft.id === activeDockedDraft.id
                return (
                  <div
                    key={draft.id}
                    className={`group flex h-9 max-w-[170px] shrink-0 items-center rounded-full pl-4 pr-1 transition ${
                      active
                        ? 'bg-sumi-accent text-white shadow-[0_12px_24px_rgba(255,138,160,0.24)]'
                        : 'bg-white/80 text-sumi-text-muted hover:text-sumi-text'
                    }`}
                  >
                    <button
                      onClick={() => setActiveDockedCompose(draft.id)}
                      role="tab"
                      aria-selected={active}
                      title={draft.subject.trim() || '件名なし'}
                      className="min-w-0 flex-1 whitespace-nowrap text-left text-xs font-semibold focus:outline-none"
                    >
                      <span className="block overflow-hidden text-ellipsis">
                      {shortenSubject(draft.subject)}
                      </span>
                    </button>
                    <button
                      onClick={(event) => closeDraftTab(draft, event.currentTarget)}
                      className={`ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition focus:outline-none focus:ring-2 focus:ring-sumi-accent/30 ${
                        active
                          ? 'text-white/75 hover:bg-white/20 hover:text-white'
                          : 'text-sumi-text-muted/60 hover:bg-sumi-accent/10 hover:text-sumi-accent'
                      }`}
                      aria-label={`${draft.subject.trim() || '件名なし'}を閉じる`}
                      title="下書きを閉じる"
                    >
                      <X size={12} strokeWidth={2.2} />
                    </button>
                  </div>
                )
              })}
            </div>
            <button
              onClick={() => openCompose({ mode: 'new', fromAddress: defaultSender })}
              data-testid="compose-add-draft"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/70 bg-white/80 text-sumi-text-muted transition hover:text-sumi-text"
              title="下書きを追加"
            >
              <FilePlus2 size={14} />
            </button>
          </div>
          <ComposeEditor draft={activeDockedDraft} docked />

          {discardDraft && createPortal(
            <div
              role="alertdialog"
              aria-labelledby="discard-draft-title"
              aria-describedby="discard-draft-description"
              className="fixed z-50 w-[292px] rounded-[20px] border border-white/90 bg-[#fffaf7]/[0.98] p-4 shadow-[0_18px_46px_rgba(91,58,45,0.22)] backdrop-blur-md"
              style={{
                top: discardPopoverPosition.top,
                left: discardPopoverPosition.left,
              }}
            >
              <span className="absolute -top-1.5 right-5 h-3 w-3 rotate-45 border-l border-t border-white/90 bg-[#fffaf7]" />
              <h2 id="discard-draft-title" className="text-sm font-semibold text-sumi-text">
                下書きを削除しますか？
              </h2>
              <p id="discard-draft-description" className="mt-1 text-[11px] leading-5 text-sumi-text-muted">
                「{shortenSubject(discardDraft.subject)}」は自動保存データからも削除されます。
              </p>
              <div className="mt-3 flex justify-end gap-2">
                <button
                  onClick={() => setDiscardDraftId(null)}
                  className="rounded-full px-3 py-2 text-[11px] font-semibold text-sumi-text-muted transition hover:bg-white hover:text-sumi-text"
                >
                  戻る
                </button>
                <button
                  onClick={confirmTabDiscard}
                  autoFocus
                  className="rounded-full bg-[#e77865] px-3.5 py-2 text-[11px] font-semibold text-white shadow-[0_8px_18px_rgba(231,120,101,0.22)] transition hover:bg-[#d96f5d]"
                >
                  下書きを削除
                </button>
              </div>
            </div>,
            document.body
          )}
        </div>
      )}

      {floatingDrafts.length > 0 && (
        <div className="pointer-events-none fixed inset-0 z-40">
          {floatingDrafts.map((draft) => (
            <ComposeEditor key={draft.id} draft={draft} docked={false} />
          ))}
        </div>
      )}
    </>
  )
}
