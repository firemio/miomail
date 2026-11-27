import { t } from '../../lib/i18n'
import { useEffect, useMemo, useState } from 'react'
import { Minus, Search, Settings, Sparkles, Square, X } from 'lucide-react'
// 表示は高さ40pxなので、4倍密度(524×160)の縮小版を使う。原寸の PNG(1662×507、770KB)を
// ここで読むと、`--single-file` の画面に base64 で約1MB 載り、Muse のスペースでは
// 開くたびにそれが VM から運ばれる(docs/LINUX.md)。原寸はサイト側だけが使う。
import logoImage from '../../assets/miomail-logo-titlebar.webp'
import { getMascotMeta } from '../../data/mascots'
import { isBridgeRuntime } from '../../lib/bridge'
import { api } from '../../lib/ipc'
import { useMailStore } from '../../stores/mailStore'
import { useMascotStore } from '../../stores/mascotStore'
import { useUIStore } from '../../stores/uiStore'
import { useIsNarrowLayout } from '../../lib/useNarrowLayout'

export function TitleBar() {
  const narrow = useIsNarrowLayout()
  const [isMaximized, setIsMaximized] = useState(false)
  const { openSettings, searchQuery, setSearchQuery, setNarrowPane } = useUIStore()
  const { searchMessages, semanticSearchActive, clearSearch } = useMailStore()
  const {
    selectedMascotId,
    summonEvent,
    dismissSummonEvent,
  } = useMascotStore()

  const selectedMascot = useMemo(() => getMascotMeta(selectedMascotId), [selectedMascotId])

  useEffect(() => {
    // ブラウザーには窓枠が無いので、最大化の状態も見に行かない
    if (isBridgeRuntime) return
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

  return (
    <div
      className={`drag-region flex h-[56px] shrink-0 items-center justify-between ${
        narrow ? 'gap-1.5 px-2' : 'gap-4 px-5'
      }`}
    >
      {/* 1カラム表示では、ここ(ロゴの場所)に相棒が入る。lib/companionPosition.ts の定位置と揃える */}
      {narrow && <div className="h-11 w-11 shrink-0" aria-hidden="true" />}
      {!narrow && (
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
      )}

      <div className={`flex min-w-0 flex-1 justify-center ${narrow ? '' : 'mx-2'}`}>
        <form role="search" onSubmit={(event) => { event.preventDefault(); setNarrowPane('list'); void searchMessages(searchQuery) }} className={`no-drag glass-panel flex h-10 w-full max-w-xl items-center rounded-full px-4 ${narrow ? 'gap-1.5' : 'gap-3'}`}>
          <button type="submit" aria-label={t("メールを検索")} title={t("検索")} className={`shrink-0 text-sumi-accent ${narrow ? '-ml-2 flex h-10 w-9 items-center justify-center' : ''}`}><Search size={16} /></button>
          {semanticSearchActive && (
            <span
              className="flex shrink-0 items-center gap-1 rounded-full bg-sumi-accent/15 px-2 py-0.5 text-[10px] font-semibold text-sumi-accent"
              title={t("意味検索で探しています")}
            >
              <Sparkles size={11} /> AI
            </span>
          )}
          <input
            type="text"
            aria-label={t("メールを検索")}
            placeholder={t("メールを検索")}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing && event.key === 'Enter') event.preventDefault()
              if (event.key === 'Escape') { setSearchQuery(''); void clearSearch() }
            }}
            className="h-full min-w-0 w-full bg-transparent text-sm text-sumi-text placeholder:text-sumi-text-muted focus:outline-none"
          />
          {searchQuery && <button type="button" aria-label={t("検索をクリア")} title={t("検索をクリア")} onClick={() => { setSearchQuery(''); void clearSearch() }} className={`shrink-0 text-sumi-text-muted ${narrow ? '-mr-2 flex h-10 w-9 items-center justify-center' : ''}`}><X size={14} /></button>}
        </form>
      </div>

      <div className={`flex items-center ${narrow ? 'gap-1' : 'gap-2'}`}>
        {summonEvent && (
          <div className="hidden max-w-[320px] rounded-[22px] border border-white/75 bg-white/85 px-4 py-1.5 text-[11px] leading-5 text-sumi-text-muted shadow-[0_18px_45px_rgba(255,210,210,0.35)] xl:block">
            <span className="font-semibold text-sumi-text">{selectedMascot.name}</span>
            <span className="ml-2">{summonEvent.message}</span>
          </div>
        )}

        <button
          data-testid="settings-button"
          onClick={openSettings}
          className={`no-drag flex shrink-0 items-center justify-center rounded-full border border-white/65 bg-white/75 text-sumi-text-muted shadow-[0_10px_25px_rgba(255,255,255,0.65)] transition hover:-translate-y-0.5 hover:text-sumi-text ${
            narrow ? 'h-10 w-10' : 'h-9 w-9'
          }`}
          title={t("設定")}
          aria-label={t("設定を開く")}
        >
          <Settings size={16} />
        </button>

        {/* ブラウザーでは窓枠をブラウザーが持っているので、この3つは出さない */}
        {!isBridgeRuntime && (
          <>
            <button
              onClick={() => api.app.minimize()}
              aria-label={t("最小化")}
              className="no-drag flex h-8 w-8 items-center justify-center rounded-full border border-white/65 bg-white/75 text-sumi-text-muted transition hover:bg-white hover:text-sumi-text"
            >
              <Minus size={14} />
            </button>
            <button
              onClick={() => api.app.maximize()}
              aria-label={isMaximized ? t("元のサイズに戻す") : t("最大化")}
              className={`no-drag flex h-8 w-8 items-center justify-center rounded-full border border-white/65 bg-white/75 text-sumi-text-muted transition hover:bg-white hover:text-sumi-text ${
                isMaximized ? 'text-sumi-accent' : ''
              }`}
            >
              <Square size={12} />
            </button>
            <button
              onClick={() => api.app.close()}
              aria-label={t("閉じる")}
              className="no-drag flex h-8 w-8 items-center justify-center rounded-full border border-white/65 bg-white/75 text-sumi-text-muted transition hover:border-red-200 hover:bg-red-50 hover:text-red-500"
            >
              <X size={14} />
            </button>
          </>
        )}
      </div>
    </div>
  )
}
