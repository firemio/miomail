import { useEffect, useState } from 'react'
import { Download, X } from 'lucide-react'
import { api, isTauriRuntime } from '../../lib/ipc'

const CHECK_DELAY_MS = 15_000
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

/**
 * Checks for app updates in the background and shows a dismissible banner
 * when a new version is available.
 */
export function UpdateBanner() {
  const [latestVersion, setLatestVersion] = useState<string | null>(null)
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!isTauriRuntime) return

    let cancelled = false

    const check = async () => {
      try {
        const status = await api.app.updateCheck()
        if (!cancelled && status.available && status.latest_version) {
          setLatestVersion(status.latest_version)
        }
      } catch {
        // Silent: no network or endpoint unavailable — retry on next interval
      }
    }

    const initial = window.setTimeout(check, CHECK_DELAY_MS)
    const interval = window.setInterval(check, CHECK_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearTimeout(initial)
      window.clearInterval(interval)
    }
  }, [])

  if (!latestVersion || dismissed) return null

  const install = async () => {
    setInstalling(true)
    setError(null)
    try {
      await api.app.updateInstall()
      // On success the app restarts; this line is normally never reached
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setInstalling(false)
    }
  }

  return (
    <div className="pointer-events-auto fixed left-1/2 top-16 z-[130] w-[min(480px,90vw)] -translate-x-1/2 rounded-[24px] border border-white/85 bg-[#fffaf7]/[0.97] px-5 py-4 shadow-[0_24px_60px_rgba(91,58,45,0.25)] backdrop-blur-md">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-sumi-text">
            新しいバージョン v{latestVersion} が利用できます
          </p>
          <p className="mt-0.5 text-[11px] text-sumi-text-muted">
            {installing
              ? 'ダウンロード中… 完了すると自動で再起動します'
              : error
                ? `更新に失敗しました: ${error}`
                : '今すぐ更新すると、ダウンロード後に自動で再起動します。'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={install}
            disabled={installing}
            className="flex h-9 items-center gap-1.5 rounded-full bg-sumi-accent px-4 text-xs font-semibold text-white transition hover:bg-sumi-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Download size={13} />
            {installing ? '更新中…' : '今すぐ更新'}
          </button>
          <button
            onClick={() => setDismissed(true)}
            disabled={installing}
            aria-label="後で更新する"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/80 bg-white/80 text-sumi-text-muted transition hover:text-sumi-text disabled:opacity-50"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}
