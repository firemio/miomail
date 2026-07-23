import { useEffect, useMemo, useState } from 'react'
import { Minus, Search, Settings, Sparkles, Square, X } from 'lucide-react'
import logoImage from '../../assets/miomail-logo.png'
import { getMascotMeta } from '../../data/mascots'
import { api } from '../../lib/ipc'
import { useMailStore } from '../../stores/mailStore'
import { useMascotStore } from '../../stores/mascotStore'
import { useUIStore } from '../../stores/uiStore'

export function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false)
  const { openSettings, searchQuery, setSearchQuery } = useUIStore()
  const { searchMessages, semanticSearchActive } = useMailStore()
  const {
    selectedMascotId,
    summonEvent,
    dismissSummonEvent,
  } = useMascotStore()

  const selectedMascot = useMemo(() => getMascotMeta(selectedMascotId), [selectedMascotId])

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

  return (
    <div className="drag-region flex h-[56px] shrink-0 items-center justify-between gap-4 px-5">
      <div className="flex items-center gap-3">
        <div className="px-1">
          <img
            src={logoImage}
            alt="MioMail"
            draggable={false}
            className="h-10 w-auto select-none drop-shadow-[0_2px_6px_rgba(180,150,170,0.35)]"
          />
        </div>
      </div>

      <div className="mx-2 flex min-w-0 flex-1 justify-center">
        <label className="no-drag glass-panel flex h-10 w-full max-w-xl items-center gap-3 rounded-full px-4 shadow-[0_18px_35px_rgba(255,229,221,0.95)]">
          <Search size={16} className="text-sumi-accent" />
          {semanticSearchActive && (
            <span
              className="flex shrink-0 items-center gap-1 rounded-full bg-sumi-accent/15 px-2 py-0.5 text-[10px] font-semibold text-sumi-accent"
              title="AI検索(セマンティック)で探しています"
            >
              <Sparkles size={11} /> AI
            </span>
          )}
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

      <div className="flex items-center gap-2">
        {summonEvent && (
          <div className="hidden max-w-[320px] rounded-[22px] border border-white/75 bg-white/85 px-4 py-1.5 text-[11px] leading-5 text-sumi-text-muted shadow-[0_18px_45px_rgba(255,210,210,0.35)] xl:block">
            <span className="font-semibold text-sumi-text">{selectedMascot.name}</span>
            <span className="ml-2">{summonEvent.message}</span>
          </div>
        )}

        <button
          data-testid="settings-button"
          onClick={openSettings}
          className="no-drag flex h-9 w-9 items-center justify-center rounded-full border border-white/65 bg-white/75 text-sumi-text-muted shadow-[0_10px_25px_rgba(255,255,255,0.65)] transition hover:-translate-y-0.5 hover:text-sumi-text"
          title="設定"
          aria-label="設定を開く"
        >
          <Settings size={16} />
        </button>

        <button
          onClick={() => api.app.minimize()}
          aria-label="最小化"
          className="no-drag flex h-8 w-8 items-center justify-center rounded-full border border-white/65 bg-white/75 text-sumi-text-muted transition hover:bg-white hover:text-sumi-text"
        >
          <Minus size={14} />
        </button>
        <button
          onClick={() => api.app.maximize()}
          aria-label="最大化"
          className={`no-drag flex h-8 w-8 items-center justify-center rounded-full border border-white/65 bg-white/75 text-sumi-text-muted transition hover:bg-white hover:text-sumi-text ${
            isMaximized ? 'text-sumi-accent' : ''
          }`}
        >
          <Square size={12} />
        </button>
        <button
          onClick={() => api.app.close()}
          aria-label="閉じる"
          className="no-drag flex h-8 w-8 items-center justify-center rounded-full border border-white/65 bg-white/75 text-sumi-text-muted transition hover:border-red-200 hover:bg-red-50 hover:text-red-500"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
