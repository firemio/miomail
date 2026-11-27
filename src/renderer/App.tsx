import { useCallback, useEffect, useState } from 'react'
import { PenLine } from 'lucide-react'
import { listen as tauriListen } from '@tauri-apps/api/event'
import type { DemoMailEvent, NewMailEvent } from './types'
import { ComposePanel } from './components/compose/ComposePanel'
import { AccountSetup } from './components/account/AccountSetup'
import { ImportDialog } from './components/import/ImportDialog'
import { JobProgressBar } from './components/layout/JobProgressBar'
import { CourierWelcome } from './components/layout/CourierWelcome'
import { CompanionOverlay } from './components/layout/CompanionOverlay'
import { CourierDeliveryOverlay, type SentDeliveryHandoff } from './components/layout/CourierDeliveryOverlay'
import { EvolutionCelebrationOverlay } from './components/layout/EvolutionCelebrationOverlay'
import { MessageList } from './components/layout/MessageList'
import { MessageView } from './components/layout/MessageView'
import { Sidebar } from './components/layout/Sidebar'
import { TitleBar } from './components/layout/TitleBar'
import { UpdateBanner } from './components/layout/UpdateBanner'
import { SettingsModal } from './components/settings/SettingsModal'
import { useMailStore } from './stores/mailStore'
import { useMascotStore } from './stores/mascotStore'
import { useCharacterStore } from './stores/characterStore'
import { useUIStore } from './stores/uiStore'

import { bridgeListen, isBridgeRuntime } from './lib/bridge'
import { isTauriRuntime } from './lib/ipc'
import { useIsNarrowLayout } from './lib/useNarrowLayout'

/** イベントの受け口。デスクトップ版は Tauri、Web ブリッジは SSE。 */
const listen = isBridgeRuntime
  ? (bridgeListen as unknown as typeof tauriListen)
  : tauriListen
import { t, useLanguage } from './lib/i18n'

export default function App() {
  const language = useLanguage((state) => state.language)
  useEffect(() => { document.documentElement.lang = language }, [language])
  const { loadAccounts, currentMessage, handleIncomingMail, allFolders } = useMailStore()
  const { pulseUnreadAttention, notifyIncomingMail, notifySentMail, gainBond } = useMascotStore()
  const {
    showAccountSetup,
    showImport,
    showSettings,
    openAccountSetup,
    composeDrafts,
    narrowPane,
    setNarrowPane,
    narrowComposeMinimized,
    setNarrowComposeMinimized,
    themeId,
  } = useUIStore()
  const hasComposeDraft = composeDrafts.length > 0
  const narrow = useIsNarrowLayout()
  // 狭い画面では作成パネルが画面を占有する(他のペインは隠す)。
  // ただし畳んでいる間は一覧や本文を見せ、下の帯から作成画面へ戻れるようにする。
  const narrowComposeTakesOver = narrow && hasComposeDraft && !narrowComposeMinimized
  const currentFolderId = useMailStore((state) => state.currentFolder?.id)
  const currentMessageId = currentMessage?.id
  const { refreshMods } = useCharacterStore()
  const [sentDelivery, setSentDelivery] = useState<SentDeliveryHandoff | null>(null)
  const activeThemeId = themeId

  const completeSentDeliveryHandoff = useCallback((key: number) => {
    setSentDelivery((current) => current?.key === key ? null : current)
  }, [])

  useEffect(() => {
    void refreshMods()
  }, [refreshMods])

  useEffect(() => {
    document.documentElement.dataset.theme = activeThemeId
    document.body.dataset.theme = activeThemeId
  }, [activeThemeId])

  // First run: go straight to account setup (the one required step). Mascot
  // and theme keep their defaults and are customizable in Settings anytime.
  useEffect(() => {
    loadAccounts().then(() => {
      const { accounts } = useMailStore.getState()
      if (accounts.length === 0) {
        openAccountSetup()
      }
    })
  }, [loadAccounts, openAccountSetup])

  useEffect(() => {
    if (!isTauriRuntime) {
      return
    }

    const unlistenPromises = [
      listen<NewMailEvent>('miomail://new-mail', async (event) => {
        notifyIncomingMail(event.payload.message.from_address, event.payload.message.subject)
        gainBond(1)
        await handleIncomingMail(event.payload.message.folder_id)
      }),
      // MCPサーバー(AIエージェント)経由の送信でも配達アニメーションを出す
      listen<{ to?: string; subject?: string }>('miomail://mcp-mail-sent', (event) => {
        notifySentMail(event.payload.to ?? '', event.payload.subject ?? '')
        gainBond(1)
      }),
    ]

    return () => {
      unlistenPromises.forEach(async (promise) => {
        const unlisten = await promise
        unlisten()
      })
    }
  }, [gainBond, handleIncomingMail, notifyIncomingMail, notifySentMail])

  useEffect(() => {
    const listener = async (event: Event) => {
      const payload = (event as CustomEvent<DemoMailEvent>).detail
      if (!payload) return

      if (payload.type === 'received') {
        notifyIncomingMail(payload.message.from_address, payload.message.subject)
        gainBond(1)
      }

      if (payload.type === 'sent') {
        notifySentMail(payload.message.to_addresses, payload.message.subject)
        gainBond(1)
      }

      await handleIncomingMail(payload.folderId)
    }

    window.addEventListener('miomail:demo', listener as EventListener)
    return () => window.removeEventListener('miomail:demo', listener as EventListener)
  }, [gainBond, handleIncomingMail, notifyIncomingMail, notifySentMail])

  // 1カラム表示のとき、フォルダや本文を選んだらその先のペインへ進める。
  // 本文を閉じた(currentMessage が null になった)ときは一覧へ戻る。
  useEffect(() => {
    setNarrowPane(currentMessageId ? 'message' : 'list')
  }, [currentMessageId, setNarrowPane])

  useEffect(() => {
    if (currentFolderId) setNarrowPane('list')
  }, [currentFolderId, setNarrowPane])

  useEffect(() => {
    const unreadCount = Array.from(allFolders.values()).reduce(
      (sum, folders) => sum + folders.reduce((folderSum, folder) => folderSum + (folder.unread_count || 0), 0),
      0
    )
    pulseUnreadAttention(unreadCount)
  }, [allFolders, pulseUnreadAttention])

  return (
    // 高さは dvh を優先する。スマホのブラウザーでは 100vh がアドレスバーの分だけ
    // 画面より長く、下端(送信ボタンなど)が画面の外へ出てしまう。
    <div className="theme-app-shell relative h-screen h-dvh w-full overflow-hidden bg-sumi-bg">
      <div className="theme-app-backdrop pointer-events-none absolute inset-0" />
      <div className="theme-glow-a pointer-events-none absolute -left-20 top-20 h-56 w-56 rounded-full blur-3xl" />
      <div className="theme-glow-b pointer-events-none absolute bottom-0 right-0 h-72 w-72 rounded-full blur-3xl" />

      <div className="relative flex h-full flex-col overflow-hidden">
        <div className="theme-topline h-[4px] shrink-0" />

        <TitleBar />

        <div className={`flex flex-1 overflow-hidden ${narrow ? 'px-1.5 pb-1.5' : 'px-3 pb-3'}`}>
          <div
            className={`theme-main-frame flex min-w-0 flex-1 overflow-hidden border ${
              // 1カラムでは枠の二重の余白と大きな角丸が、ただでさえ狭い横幅を食う
              narrow ? 'rounded-[22px] p-0.5' : 'gap-3 rounded-[32px] p-3'
            }`}
          >
            {narrow ? (
              // 1カラム: フォルダ / 一覧 / 本文 のうち1つだけ出す。
              // 作成中は作成パネルが画面を占有する。
              <div className="theme-content-frame flex min-w-0 flex-1 flex-col overflow-hidden rounded-[20px] border">
                <div className="flex min-h-0 flex-1 overflow-hidden">
                  {narrowComposeTakesOver ? (
                    <ComposePanel />
                  ) : narrowPane === 'folders' ? (
                    <Sidebar />
                  ) : narrowPane === 'message' && currentMessage ? (
                    <MessageView />
                  ) : (
                    <MessageList />
                  )}
                </div>
                {hasComposeDraft && narrowComposeMinimized && (
                  <button
                    type="button"
                    onClick={() => setNarrowComposeMinimized(false)}
                    data-testid="compose-resume"
                    className="flex min-h-12 shrink-0 items-center gap-2 border-t border-white/70 bg-sumi-accent/10 px-3 py-1.5 text-left"
                  >
                    <PenLine size={15} className="shrink-0 text-sumi-accent" />
                    <span className="min-w-0 flex-1 truncate text-xs font-semibold text-sumi-text">
                      {t("書きかけのメールが{0}件あります", { "0": composeDrafts.length })}
                    </span>
                    <span className="shrink-0 rounded-full bg-sumi-accent px-3.5 py-2 text-xs font-semibold text-white">
                      {t("続きを書く")}
                    </span>
                  </button>
                )}
              </div>
            ) : (
              <>
                <Sidebar />

                <div className="theme-content-frame flex min-w-0 flex-1 overflow-hidden rounded-[28px] border">
                  <MessageList />
                  <div className="flex min-w-0 flex-1 overflow-hidden">
                    {hasComposeDraft ? (
                      currentMessage ? <MessageView /> : <div className="theme-message-empty flex-1" />
                    ) : currentMessage ? (
                      <MessageView />
                    ) : (
                      <CourierWelcome />
                    )}
                  </div>
                  <ComposePanel />
                </div>
              </>
            )}
          </div>
        </div>

        <JobProgressBar />

        <UpdateBanner />
        {showAccountSetup && <AccountSetup />}
        {showImport && <ImportDialog />}
        {showSettings && <SettingsModal />}
        {/* 1カラム表示(スマホ幅)では相棒が右下に固定されるため、
            ダイアログの「保存」などのボタンに重なって押せなくなる。その間だけ引っ込める。 */}
        {!(narrow && (showAccountSetup || showImport || showSettings)) && (
          <CompanionOverlay
            sentDelivery={sentDelivery}
            onSentDeliveryHandoffComplete={completeSentDeliveryHandoff}
          />
        )}
        <CourierDeliveryOverlay onSentDeliveryChange={setSentDelivery} />
        <EvolutionCelebrationOverlay />
      </div>
    </div>
  )
}
