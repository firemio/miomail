import { useEffect, useMemo, useState } from 'react'
import { Minus, Search, Settings, Square, X } from 'lucide-react'
import { getMascotMeta } from '../../data/mascots'
import { api } from '../../lib/ipc'
import { useMailStore } from '../../stores/mailStore'
import { useMascotStore } from '../../stores/mascotStore'
import { useUIStore } from '../../stores/uiStore'

export function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false)
  const { openCompose, openSettings, searchQuery, setSearchQuery } = useUIStore()
  const { searchMessages, currentFolder, accounts } = useMailStore()
  const {
    selectedMascotId,
    summonEvent,
    dismissSummonEvent,
    gainBond,
  } = useMascotStore()

  const selectedMascot = useMemo(() => getMascotMeta(selectedMascotId), [selectedMascotId])
  const senderAccount = currentFolder
    ? accounts.find((account) => account.id === currentFolder.account_id)
    : accounts[0]

  useEffect(() => {
    const check = async () => setIsMaximized(await api.app.isMaximized())
    void check()
    const interval = setInterval(() => void check(), 1000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!summonEvent) return
    const timer = window.setTimeout(() => dismissSummonEvent(), 5000)
    return () => window.clearTimeout(timer)
  }, [dismissSummonEvent, summonEvent])

  const handleSearch = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      void searchMessages(searchQuery)
    }
  }

  const handleCompose = () => {
    openCompose({ mode: 'new', fromAddress: senderAccount?.email })
    gainBond(1)
  }

  return (
    <div className="drag-region flex h-[78px] shrink-0 items-center justify-between gap-4 px-5">
      <div className="no-drag flex items-center gap-3">
        <div className="px-1">
          <p className="font-display text-[22px] font-semibold tracking-[-0.03em] text-sumi-text">MioMail</p>
        </div>
      </div>

      <div className="mx-2 flex min-w-0 flex-1 justify-center no-drag">
        <label className="glass-panel flex h-12 w-full max-w-xl items-center gap-3 rounded-full px-4 shadow-[0_18px_35px_rgba(255,229,221,0.95)]">
          <Search size={16} className="text-sumi-accent" />
          <input
            type="text"
            placeholder="差出人、件名、本文からおたよりを探す"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={handleSearch}
            className="w-full bg-transparent text-sm text-sumi-text placeholder:text-sumi-text-muted focus:outline-none"
          />
        </label>
      </div>

      <div className="no-drag flex items-center gap-2">
        {summonEvent && (
          <div className="hidden max-w-[320px] rounded-[22px] border border-white/75 bg-white/85 px-4 py-3 text-[11px] leading-5 text-sumi-text-muted shadow-[0_18px_45px_rgba(255,210,210,0.35)] xl:block">
            <span className="font-semibold text-sumi-text">{selectedMascot.name}</span>
            <span className="ml-2">{summonEvent.message}</span>
          </div>
        )}

        <button
          data-testid="settings-button"
          onClick={openSettings}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-white/65 bg-white/75 text-sumi-text-muted shadow-[0_10px_25px_rgba(255,255,255,0.65)] transition hover:-translate-y-0.5 hover:text-sumi-text"
          title="設定"
          aria-label="設定を開く"
        >
          <Settings size={17} />
        </button>

        <button
          data-testid="title-compose-button"
          onClick={handleCompose}
          className="rounded-full bg-sumi-accent px-4 py-2 text-xs font-semibold text-white shadow-[0_18px_30px_rgba(255,138,160,0.34)] transition hover:-translate-y-0.5 hover:bg-sumi-accent-strong"
          title="新規メール"
        >
          作成
        </button>

        <div className="mx-1 h-5 w-px bg-sumi-border" />

        <button
          onClick={() => api.app.minimize()}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-white/65 bg-white/75 text-sumi-text-muted transition hover:bg-white hover:text-sumi-text"
        >
          <Minus size={14} />
        </button>
        <button
          onClick={() => api.app.maximize()}
          className={`flex h-10 w-10 items-center justify-center rounded-full border border-white/65 bg-white/75 text-sumi-text-muted transition hover:bg-white hover:text-sumi-text ${
            isMaximized ? 'text-sumi-accent' : ''
          }`}
        >
          <Square size={12} />
        </button>
        <button
          onClick={() => api.app.close()}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-white/65 bg-white/75 text-sumi-text-muted transition hover:border-red-200 hover:bg-red-50 hover:text-red-500"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
