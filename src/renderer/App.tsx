import { useCallback, useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import type { DemoMailEvent, NewMailEvent } from './types'
import { ComposePanel } from './components/compose/ComposePanel'
import { AccountSetup } from './components/account/AccountSetup'
import { ImportDialog } from './components/import/ImportDialog'
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

const isTauriRuntime =
  typeof window !== 'undefined' &&
  (Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) ||
    navigator.userAgent.includes('Tauri'))

export default function App() {
  const { loadAccounts, currentMessage, handleIncomingMail, allFolders } = useMailStore()
  const { pulseUnreadAttention, notifyIncomingMail, notifySentMail, gainBond, selectedMascotId, selectMascot } =
    useMascotStore()
  const {
    showAccountSetup,
    showImport,
    showSettings,
    openAccountSetup,
    composeDrafts,
    themeId,
  } = useUIStore()
  const hasComposeDraft = composeDrafts.length > 0
  const { packages: characterPackages, selectedModId, refreshMods } = useCharacterStore()
  const [sentDelivery, setSentDelivery] = useState<SentDeliveryHandoff | null>(null)
  const activeThemeId = themeId

  const completeSentDeliveryHandoff = useCallback((key: number) => {
    setSentDelivery((current) => current?.key === key ? null : current)
  }, [])

  useEffect(() => {
    void refreshMods()
  }, [refreshMods])

  useEffect(() => {
    const selectedPackage = characterPackages.find((item) => item.manifest.id === selectedModId)
    if (selectedPackage && selectedPackage.manifest.behaviorProfile !== selectedMascotId) {
      selectMascot(selectedPackage.manifest.behaviorProfile)
    }
  }, [characterPackages, selectMascot, selectedMascotId, selectedModId])

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

  useEffect(() => {
    const unreadCount = Array.from(allFolders.values()).reduce(
      (sum, folders) => sum + folders.reduce((folderSum, folder) => folderSum + (folder.unread_count || 0), 0),
      0
    )
    pulseUnreadAttention(unreadCount)
  }, [allFolders, pulseUnreadAttention])

  return (
    <div className="theme-app-shell relative h-screen w-screen overflow-hidden bg-sumi-bg">
      <div className="theme-app-backdrop pointer-events-none absolute inset-0" />
      <div className="theme-glow-a pointer-events-none absolute -left-20 top-20 h-56 w-56 rounded-full blur-3xl" />
      <div className="theme-glow-b pointer-events-none absolute bottom-0 right-0 h-72 w-72 rounded-full blur-3xl" />

      <div className="relative flex h-full flex-col overflow-hidden">
        <div className="theme-topline h-[4px] shrink-0" />

        <TitleBar />

        <div className="flex flex-1 overflow-hidden px-3 pb-3">
          <div className="theme-main-frame flex min-w-0 flex-1 overflow-hidden gap-3 rounded-[32px] border p-3">
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
          </div>
        </div>

        <UpdateBanner />
        {showAccountSetup && <AccountSetup />}
        {showImport && <ImportDialog />}
        {showSettings && <SettingsModal />}
        <CompanionOverlay
          sentDelivery={sentDelivery}
          onSentDeliveryHandoffComplete={completeSentDeliveryHandoff}
        />
        <CourierDeliveryOverlay onSentDeliveryChange={setSentDelivery} />
        <EvolutionCelebrationOverlay />
      </div>
    </div>
  )
}
