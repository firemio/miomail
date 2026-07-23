import { useCallback, useEffect, useState } from 'react'
import { CircleCheck, Cpu, Download, MonitorCog, RefreshCw, SearchCheck, TriangleAlert } from 'lucide-react'
import { api } from '../../lib/ipc'
import type { AcceleratorStatus, SemanticState, SystemInfo } from '../../types'

type LoadState =
  | { phase: 'loading' }
  | { phase: 'ready'; info: SystemInfo }
  | { phase: 'error'; message: string }

const ACCELERATOR_BADGES: Record<AcceleratorStatus, { label: string; className: string }> = {
  active: {
    label: '利用中',
    className: 'bg-sumi-accent text-white shadow-[0_8px_18px_rgba(255,111,145,0.22)]',
  },
  available: {
    label: '利用可能',
    className: 'bg-[#5f9d7a]/15 text-[#3f7a5c] border border-[#5f9d7a]/30',
  },
  unavailable: {
    label: '未検出',
    className: 'bg-sumi-surface text-sumi-text-muted border border-sumi-border/70',
  },
  not_built: {
    label: '未対応ビルド',
    className: 'bg-[#e7b674]/15 text-[#98632d] border border-[#e7b674]/45',
  },
}

const SEMANTIC_STATES: Record<SemanticState, { label: string; note: string; className: string }> = {
  ready: {
    label: '有効',
    note: '意味の近さでメールを探せるAI検索が使える状態です。',
    className: 'bg-sumi-accent text-white shadow-[0_8px_18px_rgba(255,111,145,0.22)]',
  },
  off: {
    label: '未設定',
    note: 'まだ有効化されていません。有効化はメール画面の検索バー付近から行えます。',
    className: 'bg-sumi-surface text-sumi-text-muted border border-sumi-border/70',
  },
  downloading: {
    label: 'ダウンロード中',
    note: '検索用モデルをダウンロードしています。完了すると自動で有効になります。',
    className: 'bg-[#e7b674]/15 text-[#98632d] border border-[#e7b674]/45',
  },
  error: {
    label: 'エラー',
    note: 'モデルの準備に失敗しました。詳細は下のメッセージを確認してください。',
    className: 'bg-[#efb1a7]/25 text-[#a9554a] border border-[#efb1a7]/55',
  },
}

export function SystemSection() {
  const [state, setState] = useState<LoadState>({ phase: 'loading' })

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const info = await api.system.info()
      setState({ phase: 'ready', info })
    } catch (error) {
      setState({
        phase: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (state.phase === 'loading') {
    return (
      <div className="flex min-h-[260px] flex-col items-center justify-center rounded-[28px] border border-white/80 bg-white/58">
        <RefreshCw size={22} className="animate-spin text-sumi-accent" />
        <p className="mt-3 text-xs text-sumi-text-muted">動作環境を確認しています…</p>
      </div>
    )
  }

  if (state.phase === 'error') {
    return (
      <div className="flex min-h-[260px] flex-col items-center justify-center rounded-[28px] border border-white/80 bg-white/58 p-6 text-center">
        <TriangleAlert size={22} className="text-[#a9554a]" />
        <p className="mt-3 text-sm font-semibold text-sumi-text">動作環境を取得できませんでした</p>
        <p className="mt-1 max-w-[420px] text-[11px] leading-5 text-sumi-text-muted">{state.message}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-4 inline-flex items-center gap-2 rounded-full bg-sumi-accent px-5 py-2.5 text-xs font-semibold text-white"
        >
          <RefreshCw size={13} />
          再試行
        </button>
      </div>
    )
  }

  const { info } = state
  const semantic = SEMANTIC_STATES[info.semantic.state]
  const environmentRows = [
    { label: 'アプリバージョン', value: `v${info.app_version}` },
    { label: 'OS', value: info.os },
    { label: 'アーキテクチャ', value: info.arch },
    { label: 'CPU', value: info.cpu_name },
  ]

  return (
    <div className="space-y-5">
      <section className="rounded-[28px] border border-white/80 bg-white/72 p-6">
        <div className="flex items-start justify-between gap-5">
          <div>
            <div className="flex items-center gap-2">
              <MonitorCog size={16} className="text-sumi-accent" />
              <p className="text-[10px] font-semibold tracking-[0.18em] text-sumi-text-muted">ENVIRONMENT</p>
            </div>
            <h3 className="mt-2 text-lg font-semibold text-sumi-text">動作環境</h3>
            <p className="mt-1 text-xs leading-5 text-sumi-text-muted">このMioMailが動いている環境の基本情報です。</p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex h-10 shrink-0 items-center gap-2 rounded-2xl border border-white/90 bg-white/82 px-3 text-[11px] font-semibold text-sumi-text-muted transition hover:text-sumi-text"
          >
            <RefreshCw size={14} />
            再取得
          </button>
        </div>
        <dl className="mt-5 divide-y divide-sumi-border/50 rounded-[20px] border border-white/85 bg-white/60">
          {environmentRows.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-4 px-4 py-3">
              <dt className="text-[11px] font-semibold text-sumi-text-muted">{row.label}</dt>
              <dd className="min-w-0 truncate text-xs font-semibold text-sumi-text">{row.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="rounded-[28px] border border-white/80 bg-white/72 p-6">
        <div className="flex items-start justify-between gap-5">
          <div>
            <div className="flex items-center gap-2">
              <Cpu size={16} className="text-sumi-accent" />
              <p className="text-[10px] font-semibold tracking-[0.18em] text-sumi-text-muted">ACCELERATORS</p>
            </div>
            <h3 className="mt-2 text-lg font-semibold text-sumi-text">アクセラレータ</h3>
            <p className="mt-1 text-xs leading-5 text-sumi-text-muted">
              NPU・GPUなど、AI処理を速くするハードウェアの検出状況です。
            </p>
          </div>
        </div>
        <ul className="mt-5 space-y-2.5">
          {info.accelerators.map((accelerator) => {
            const badge = ACCELERATOR_BADGES[accelerator.status]
            return (
              <li
                key={accelerator.id}
                className={`flex items-start justify-between gap-4 rounded-[20px] border px-4 py-3.5 ${
                  accelerator.status === 'active'
                    ? 'border-sumi-accent/45 bg-sumi-accent/[0.07]'
                    : 'border-white/85 bg-white/60'
                }`}
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-semibold text-sumi-text">
                    <Cpu size={14} className={accelerator.status === 'active' ? 'text-sumi-accent' : 'text-sumi-text-muted'} />
                    {accelerator.label}
                  </p>
                  {accelerator.note && (
                    <p className="mt-1 text-[11px] leading-5 text-sumi-text-muted">{accelerator.note}</p>
                  )}
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${badge.className}`}>
                  {badge.label}
                </span>
              </li>
            )
          })}
        </ul>
      </section>

      <section className="rounded-[28px] border border-white/80 bg-white/72 p-6">
        <div className="flex items-start justify-between gap-5">
          <div>
            <div className="flex items-center gap-2">
              <SearchCheck size={16} className="text-sumi-accent" />
              <p className="text-[10px] font-semibold tracking-[0.18em] text-sumi-text-muted">SEMANTIC SEARCH</p>
            </div>
            <h3 className="mt-2 text-lg font-semibold text-sumi-text">AI検索（セマンティック）</h3>
            <p className="mt-1 text-xs leading-5 text-sumi-text-muted">
              キーワードが一致しなくても、意味の近いメールを探せる機能です。
            </p>
          </div>
          <span className={`shrink-0 rounded-full px-3 py-1.5 text-[10px] font-semibold ${semantic.className}`}>
            {info.semantic.state === 'downloading' && <Download size={11} className="mr-1 inline-block" />}
            {info.semantic.state === 'ready' && <CircleCheck size={11} className="mr-1 inline-block" />}
            {semantic.label}
          </span>
        </div>
        <p className="mt-4 rounded-[18px] border border-white/85 bg-sumi-surface/65 px-4 py-3 text-[11px] leading-5 text-sumi-text-muted">
          {semantic.note}
          {info.semantic.state !== 'ready' && info.semantic.model_size_mb > 0 && (
            <> モデルサイズ: 約{info.semantic.model_size_mb}MB。</>
          )}
        </p>
        {info.semantic.state === 'error' && info.semantic.error && (
          <div className="mt-3 flex items-start gap-3 rounded-[18px] border border-[#efb1a7]/55 bg-[#fff0ed]/75 px-4 py-3 text-[11px] leading-5 text-[#a9554a]">
            <TriangleAlert size={15} className="mt-0.5 shrink-0" />
            <span>{info.semantic.error}</span>
          </div>
        )}
      </section>
    </div>
  )
}
