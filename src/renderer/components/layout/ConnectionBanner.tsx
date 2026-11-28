import { RefreshCw, WifiOff } from 'lucide-react'
import { t } from '../../lib/i18n'
import { isBridgeRuntime, isStandaloneFrame } from '../../lib/bridge'

interface ConnectionBannerProps {
  /** 読み込めなかった理由(サーバーや中継が返した文面そのまま)。 */
  error: string
  retrying: boolean
  onRetry: () => void
}

/**
 * アカウントを読み込めないときの案内。
 *
 * 「読めない」と「アカウントが0件」を見分けるためにある。v2.1.26 までは、Muse の
 * 仮想マシンが入れ替わって MioMail のサーバーが止まっただけで、画面には
 * 「アカウントを追加してください」とだけ出ていた。アカウントが消えたように見える。
 * 止まっている間は自動でつなぎ直すので、この帯は繋がれば消える。
 */
export function ConnectionBanner({ error, retrying, onRetry }: ConnectionBannerProps) {
  return (
    <div
      role="alert"
      data-testid="connection-banner"
      className="mx-3 mb-2 shrink-0 rounded-[20px] border border-sumi-unread/30 bg-white/90 px-4 py-3 shadow-[0_12px_30px_rgba(82,52,60,0.12)] max-[899px]:mx-1.5"
    >
      <div className="flex items-start gap-3 max-[899px]:flex-col max-[899px]:gap-2">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <WifiOff size={18} className="mt-0.5 shrink-0 text-sumi-unread" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-sumi-text">
              {isBridgeRuntime ? t("MioMail のサーバーに繋がりません") : t("アカウントを読み込めませんでした")}
            </p>
            {isBridgeRuntime && (
              <p className="mt-1 text-xs leading-5 text-sumi-text-muted">
                {t("アカウントもメールも消えていません。サーバーが動き出すと、自動でつなぎ直します。")}
              </p>
            )}
            {isStandaloneFrame && (
              <p className="mt-1 text-xs leading-5 text-sumi-text-muted">
                {t("Muse のスペースで使っている場合は、Muse に「sh ~/miomail-start.sh を実行して」と頼んでください。")}
              </p>
            )}
            {/* サーバーや中継が返した文面。翻訳せず、切らずに折り返して最後まで出す */}
            <p className="mt-1 break-words text-[11px] leading-5 text-sumi-text-muted/80">{error}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="flex h-10 shrink-0 items-center justify-center gap-2 rounded-full border border-sumi-border bg-white/80 px-4 text-xs font-semibold text-sumi-text transition hover:border-sumi-accent/40 disabled:opacity-60"
        >
          <RefreshCw size={14} className={retrying ? 'animate-spin' : ''} />
          {t("もう一度試す")}
        </button>
      </div>
    </div>
  )
}
