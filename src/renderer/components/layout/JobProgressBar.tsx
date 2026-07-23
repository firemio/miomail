import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronUp,
  Database,
  Download,
  FileText,
  RefreshCw,
  RotateCw,
  Sparkles,
  Zap,
} from 'lucide-react'
import type { JobKind, JobProgress, SemanticStatus } from '../../types'
import { api } from '../../lib/ipc'
import { useMailStore } from '../../stores/mailStore'

const KIND_LABEL: Record<JobKind, string> = {
  sync: '同期',
  backfill: '過去メール取得',
  prefetch: '本文取得',
  vectorize: 'ベクトル化',
  model_download: 'モデルDL',
}

const KIND_ICON: Record<JobKind, typeof RefreshCw> = {
  sync: RefreshCw,
  backfill: Database,
  prefetch: FileText,
  vectorize: Zap,
  model_download: Download,
}

const ACTIVE_POLL_MS = 2_000
const IDLE_POLL_MS = 10_000

/**
 * アプリ最下部のジョブ進捗ステータス帯。
 * アクティブなジョブがある間は 2 秒、無いときは 10 秒間隔でポーリングする
 * (アイドル時の省電力のため setTimeout で逐次再スケジュール)。
 */
export function JobProgressBar() {
  const accounts = useMailStore((state) => state.accounts)
  const currentFolder = useMailStore((state) => state.currentFolder)

  // 選択中アカウント優先、未選択時は先頭アカウント
  const accountId = currentFolder?.account_id ?? accounts[0]?.id ?? null

  const [jobs, setJobs] = useState<JobProgress[]>([])
  const [semantic, setSemantic] = useState<SemanticStatus | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [enabling, setEnabling] = useState(false)
  const [enableError, setEnableError] = useState<string | null>(null)
  const timerRef = useRef<number | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    const poll = async () => {
      let nextJobs: JobProgress[] = []
      let nextSemantic: SemanticStatus | null = null

      try {
        const [jobList, semanticStatus] = await Promise.all([
          accountId !== null ? api.jobs.progress(accountId) : Promise.resolve([]),
          api.semantic.status(),
        ])
        nextJobs = jobList
        nextSemantic = semanticStatus
        if (!cancelled) {
          setJobs(jobList)
          setSemantic(semanticStatus)
        }
      } catch {
        // ポーリング失敗は静かに次回に任せる(バックエンド起動中など)
      }

      if (cancelled) return

      const active =
        nextJobs.some((job) => job.active) || nextSemantic?.state === 'downloading'
      timerRef.current = window.setTimeout(poll, active ? ACTIVE_POLL_MS : IDLE_POLL_MS)
    }

    void poll()
    return () => {
      cancelled = true
      clearTimer()
    }
  }, [accountId, clearTimer])

  const enableSemantic = async () => {
    setEnabling(true)
    setEnableError(null)
    try {
      const status = await api.semantic.enable()
      setSemantic(status)
      // ポーリングループは継続しているため、次回ポーリングで
      // downloading 状態が検出され 2 秒間隔に切り替わる
    } catch (err) {
      setEnableError(err instanceof Error ? err.message : String(err))
    } finally {
      setEnabling(false)
    }
  }

  const activeJobs = jobs.filter((job) => job.active)
  const latestInactive = jobs.find((job) => !job.active)
  const hasVisibleJobs = activeJobs.length > 0
  const modelDownloadJob = activeJobs.find((job) => job.kind === 'model_download')

  const formatPercent = (job: JobProgress) =>
    job.total > 0 ? `${Math.min(100, Math.floor((job.done / job.total) * 100))}%` : null

  const renderProgressTrack = (job: JobProgress) => (
    <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-sumi-border/50">
      {job.total > 0 ? (
        <div
          className="h-full rounded-full bg-sumi-accent transition-[width] duration-500 ease-out"
          style={{ width: `${Math.min(100, (job.done / job.total) * 100)}%` }}
        />
      ) : (
        <div className="job-progress-indeterminate absolute top-0 h-full w-2/5 rounded-full bg-sumi-accent/70" />
      )}
    </div>
  )

  return (
    <div className="mx-3 mb-2 mt-0 shrink-0">
      <div className="rounded-2xl border border-sumi-border/60 bg-sumi-surface/80 px-3 py-1.5 backdrop-blur-sm">
        {/* 折りたたみ時・常時の1行表示 */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCollapsed((value) => !value)}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
            aria-label={collapsed ? '進捗を展開' : '進捗を折りたたむ'}
          >
            {hasVisibleJobs ? (
              <>
                <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-sumi-accent" />
                <span className="truncate text-[11px] text-sumi-text">
                  {KIND_LABEL[activeJobs[0].kind]}中
                  {activeJobs.length > 1 ? ` ほか${activeJobs.length - 1}件` : ''}
                  {formatPercent(activeJobs[0]) ? ` (${formatPercent(activeJobs[0])})` : ''}
                  {' — '}
                  {activeJobs[0].message}
                </span>
              </>
            ) : (
              <span className="truncate text-[11px] text-sumi-text-muted">
                {latestInactive
                  ? `${KIND_LABEL[latestInactive.kind]}完了 — ${latestInactive.message}`
                  : 'バックグラウンドジョブはありません'}
              </span>
            )}
          </button>

          <SemanticBadge
            status={semantic}
            modelDownloadJob={modelDownloadJob}
            enabling={enabling}
            enableError={enableError}
            onEnable={enableSemantic}
            onRetry={enableSemantic}
          />

          <button
            onClick={() => setCollapsed((value) => !value)}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sumi-text-muted transition hover:bg-sumi-surface-2 hover:text-sumi-text"
            aria-label={collapsed ? '進捗を展開' : '進捗を折りたたむ'}
          >
            {collapsed ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        </div>

        {/* 展開時のジョブ詳細 */}
        {!collapsed && hasVisibleJobs && (
          <div className="mt-2 space-y-2 border-t border-sumi-border/40 pt-2">
            {activeJobs.map((job) => {
              const Icon = KIND_ICON[job.kind]
              const percent = formatPercent(job)
              return (
                <div key={job.kind} className="flex items-center gap-2">
                  <Icon size={12} className="shrink-0 text-sumi-accent" />
                  <span className="w-24 shrink-0 text-[11px] font-medium text-sumi-text">
                    {KIND_LABEL[job.kind]}
                  </span>
                  <div className="min-w-0 flex-1">{renderProgressTrack(job)}</div>
                  <span className="w-10 shrink-0 text-right text-[10px] tabular-nums text-sumi-text-muted">
                    {percent ?? '…'}
                  </span>
                  <span className="w-48 shrink-0 truncate text-[10px] text-sumi-text-muted">
                    {job.message}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

interface SemanticBadgeProps {
  status: SemanticStatus | null
  modelDownloadJob: JobProgress | undefined
  enabling: boolean
  enableError: string | null
  onEnable: () => void
  onRetry: () => void
}

function SemanticBadge({
  status,
  modelDownloadJob,
  enabling,
  enableError,
  onEnable,
  onRetry,
}: SemanticBadgeProps) {
  const [showConsent, setShowConsent] = useState(false)

  if (!status) return null

  if (status.state === 'ready') {
    return (
      <span className="flex shrink-0 items-center gap-1 rounded-full border border-sumi-accent/40 bg-sumi-accent/10 px-2.5 py-0.5 text-[10px] font-medium text-sumi-accent-strong">
        <Sparkles size={11} />
        AI検索 ON
      </span>
    )
  }

  if (status.state === 'downloading') {
    const percent =
      modelDownloadJob && modelDownloadJob.total > 0
        ? Math.min(100, Math.floor((modelDownloadJob.done / modelDownloadJob.total) * 100))
        : null
    return (
      <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-sumi-border/60 bg-sumi-surface-2 px-2.5 py-0.5 text-[10px] text-sumi-text-muted">
        <Download size={11} className="animate-pulse text-sumi-accent" />
        AIモデル取得中{percent !== null ? ` ${percent}%` : '…'}
      </span>
    )
  }

  if (status.state === 'error') {
    return (
      <span className="flex shrink-0 items-center gap-1.5">
        <span
          className="max-w-56 truncate text-[10px] text-red-700/80"
          title={status.error ?? enableError ?? undefined}
        >
          AI検索の準備に失敗しました{status.error ? `: ${status.error}` : ''}
        </span>
        <button
          onClick={onRetry}
          disabled={enabling}
          className="flex items-center gap-1 rounded-full border border-sumi-border/70 bg-sumi-surface-2 px-2.5 py-0.5 text-[10px] font-medium text-sumi-text transition hover:bg-sumi-border/40 disabled:opacity-50"
        >
          <RotateCw size={10} />
          リトライ
        </button>
      </span>
    )
  }

  // state === 'off'
  return (
    <span className="relative flex shrink-0 items-center">
      {showConsent && (
        <span className="absolute bottom-full right-0 z-10 mb-2 block w-72 rounded-2xl border border-sumi-border/70 bg-sumi-surface p-3 shadow-lg">
          <span className="block text-[11px] leading-relaxed text-sumi-text">
            意味ベースでメールを探せる「AI検索」を使えるようにします。検索用の小さなモデル
            (約{status.model_size_mb} MB)を一度だけダウンロードします。
          </span>
          <span className="mt-1 block text-[10px] leading-relaxed text-sumi-text-muted">
            メール本文が外部サーバーに送信されることはありません。処理はすべてこのPC上で行われます。
          </span>
          <span className="mt-2 flex justify-end gap-1.5">
            <button
              onClick={() => setShowConsent(false)}
              className="rounded-full px-2.5 py-1 text-[10px] text-sumi-text-muted transition hover:text-sumi-text"
            >
              キャンセル
            </button>
            <button
              onClick={() => {
                setShowConsent(false)
                onEnable()
              }}
              disabled={enabling}
              className="rounded-full bg-sumi-accent px-3 py-1 text-[10px] font-semibold text-white transition hover:bg-sumi-accent-strong disabled:opacity-50"
            >
              {enabling ? '開始中…' : '有効にする'}
            </button>
          </span>
        </span>
      )}
      {enableError && (
        <span className="mr-1.5 max-w-40 truncate text-[10px] text-red-700/80" title={enableError}>
          {enableError}
        </span>
      )}
      <button
        onClick={() => setShowConsent((value) => !value)}
        disabled={enabling}
        className="flex items-center gap-1 rounded-full border border-sumi-border/70 bg-sumi-surface-2 px-2.5 py-0.5 text-[10px] font-medium text-sumi-text transition hover:bg-sumi-border/40 disabled:opacity-50"
      >
        <Sparkles size={11} className="text-sumi-accent" />
        AI検索を有効にする(約{status.model_size_mb} MB)
      </button>
    </span>
  )
}
