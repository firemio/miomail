import { useEffect } from 'react'
import { MailOpen, SendHorizontal, Sparkles, Star } from 'lucide-react'
import { getMascotMeta } from '../../data/mascots'
import {
  getMascotCondition,
  getMascotConditionLabel,
  getMascotPhase,
  getMascotPhaseLabel,
  getMascotProgress,
  useMascotStore,
} from '../../stores/mascotStore'
import { CourierMascot } from './CourierMascot'

const EVOLUTION_CONFETTI = [
  { x: -88, y: -104, r: -190, color: '#ff8faa', delay: 0 },
  { x: -58, y: -132, r: -120, color: '#ffd166', delay: 45 },
  { x: -24, y: -112, r: 150, color: '#72d6c9', delay: 100 },
  { x: 8, y: -142, r: 210, color: '#8fa8ff', delay: 20 },
  { x: 42, y: -116, r: 135, color: '#ffad73', delay: 80 },
  { x: 82, y: -98, r: 200, color: '#e696ff', delay: 130 },
  { x: -104, y: -64, r: -145, color: '#8fa8ff', delay: 150 },
  { x: -70, y: -82, r: 190, color: '#ffad73', delay: 210 },
  { x: -38, y: -72, r: -220, color: '#e696ff', delay: 170 },
  { x: 34, y: -78, r: 230, color: '#ffd166', delay: 190 },
  { x: 70, y: -72, r: -160, color: '#72d6c9', delay: 230 },
  { x: 106, y: -58, r: 170, color: '#ff8faa', delay: 145 },
] as const

function getEventIcon(reason: 'unread' | 'new-mail' | 'sent') {
  switch (reason) {
    case 'sent':
      return <SendHorizontal size={12} />
    case 'new-mail':
      return <MailOpen size={12} />
    default:
      return <Sparkles size={12} />
  }
}

function getEventLabel(reason: 'unread' | 'new-mail' | 'sent') {
  switch (reason) {
    case 'sent':
      return '送信演出'
    case 'new-mail':
      return '新着演出'
    default:
      return '未読アテンション'
  }
}

function getEventTone(mascotId: string, reason: 'unread' | 'new-mail' | 'sent') {
  if (reason === 'sent') {
    switch (mascotId) {
      case 'makko':
        return 'きらきら速達'
      case 'mio':
        return 'しっぽ案内便'
      case 'posty':
        return 'ホログラム投函'
      default:
        return '滑空エアメール'
    }
  }

  if (reason === 'new-mail') {
    switch (mascotId) {
      case 'makko':
        return 'ぴょこん通知'
      case 'mio':
        return 'くるり案内'
      case 'posty':
        return 'レーダー検知'
      default:
        return '旋回アラート'
    }
  }

  switch (mascotId) {
    case 'makko':
      return '耳ぴくアテンション'
    case 'mio':
      return 'しっぽ待機アテンション'
    case 'posty':
      return '監視モード'
    default:
      return '上空見回り'
  }
}

export function CourierCompanionDock({ compact = false }: { compact?: boolean }) {
  const {
    selectedMascotId,
    bondByMascot,
    careByMascot,
    streakDays,
    summonEvent,
    evolutionEvent,
    refreshMascotState,
    dismissEvolutionEvent,
  } = useMascotStore()

  const mascot = getMascotMeta(selectedMascotId)
  const bond = bondByMascot[selectedMascotId] ?? 0
  const care = careByMascot[selectedMascotId]
  const phase = getMascotPhase(bond)
  const condition = getMascotCondition(care)
  const progress = getMascotProgress(bond)
  const signalKey = `${summonEvent?.reason ?? 'idle'}-${summonEvent?.at ?? 0}-${evolutionEvent?.phase ?? 'none'}-${evolutionEvent?.at ?? 0}`
  const showSignal = Boolean(summonEvent || evolutionEvent)
  const eventIntensity = summonEvent?.intensity ?? 'soft'
  const isBurst = summonEvent?.reason === 'new-mail' || summonEvent?.reason === 'unread'
  const isLaunch = summonEvent?.reason === 'sent'
  const eventTone = summonEvent ? getEventTone(selectedMascotId, summonEvent.reason) : null
  const signalClass =
    eventIntensity === 'launch'
      ? 'companion-signal companion-signal-launch'
      : eventIntensity === 'burst'
        ? 'companion-signal companion-signal-burst'
        : 'companion-signal'
  const mascotMotionClass = isLaunch
    ? 'companion-launch'
    : isBurst
      ? 'companion-bounce-burst'
      : showSignal
        ? 'companion-bounce'
        : ''

  useEffect(() => {
    refreshMascotState()
    const timer = window.setInterval(() => refreshMascotState(), 60_000)
    return () => window.clearInterval(timer)
  }, [refreshMascotState])

  useEffect(() => {
    if (!evolutionEvent) return
    const timer = window.setTimeout(() => dismissEvolutionEvent(), 4500)
    return () => window.clearTimeout(timer)
  }, [dismissEvolutionEvent, evolutionEvent])

  return (
    <aside
      data-testid="companion-dock"
      className={`flex h-full flex-col border-l border-white/80 bg-[linear-gradient(180deg,rgba(255,252,249,0.96)_0%,rgba(255,246,241,0.94)_100%)] ${
        compact ? 'w-[228px] min-w-[220px] p-3' : 'w-[248px] min-w-[236px] p-4'
      }`}
    >
      <div
        className={`rounded-[28px] border border-white/80 bg-white/78 shadow-[0_18px_40px_rgba(255,214,214,0.2)] ${
          compact ? 'p-3' : 'p-4'
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-[11px] font-semibold tracking-[0.18em] text-sumi-text-muted">
              COMPANION
            </p>
            <h2 className={`mt-1 font-display leading-none text-sumi-text ${compact ? 'text-[24px]' : 'text-[28px]'}`}>
              {mascot.name}
            </h2>
            <p className="mt-2 text-[11px] leading-5 text-sumi-text-muted">{mascot.subtitle}</p>
          </div>
          <div className="rounded-full bg-sumi-surface px-3 py-1 text-[10px] font-semibold text-sumi-text-muted">
            {bond}pt
          </div>
        </div>

        <div className="relative mt-4 flex justify-center">
          {evolutionEvent && evolutionEvent.mascotId === selectedMascotId && (
            <div
              key={`evolution-party-${evolutionEvent.at}`}
              className="evolution-party pointer-events-none absolute left-1/2 top-1/2 z-20"
              aria-hidden="true"
            >
              <div className="party-cracker party-cracker-left">
                <span />
              </div>
              <div className="party-cracker party-cracker-right">
                <span />
              </div>
              <div className="party-pop party-pop-left" />
              <div className="party-pop party-pop-right" />
              {EVOLUTION_CONFETTI.map((piece, index) => (
                <i
                  key={index}
                  className={`party-confetti ${index % 3 === 0 ? 'party-confetti-ribbon' : ''}`}
                  style={
                    {
                      '--party-x': `${piece.x}px`,
                      '--party-y': `${piece.y}px`,
                      '--party-r': `${piece.r}deg`,
                      '--party-delay': `${piece.delay}ms`,
                      '--party-color': piece.color,
                    } as React.CSSProperties
                  }
                />
              ))}
            </div>
          )}
          {showSignal && (
            <div
              key={signalKey}
              className={`${signalClass} pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full ${
                compact ? 'h-[124px] w-[124px]' : 'h-[148px] w-[148px]'
              }`}
            />
          )}
          {isBurst && (
            <>
              <div
                key={`${signalKey}-ring-a`}
                className={`mail-burst-ring mail-burst-${selectedMascotId} pointer-events-none ${compact ? 'h-[96px] w-[96px]' : 'h-[120px] w-[120px]'}`}
              />
              <div
                key={`${signalKey}-ring-b`}
                className={`mail-burst-ring mail-burst-${selectedMascotId} delay-1 pointer-events-none ${compact ? 'h-[128px] w-[128px]' : 'h-[156px] w-[156px]'}`}
              />
              {(selectedMascotId === 'makko'
                  ? [
                      { x: '-18px', y: '-76px', color: '#ffe07d' },
                      { x: '48px', y: '-60px', color: '#ff97ba' },
                      { x: '68px', y: '6px', color: '#ffc7df' },
                      { x: '-66px', y: '-10px', color: '#ffd788' },
                      { x: '-32px', y: '46px', color: '#ffb8d7' },
                      { x: '10px', y: '60px', color: '#fff0a2' },
                    ]
                  : selectedMascotId === 'mio'
                    ? [
                        { x: '-54px', y: '-40px', color: '#ffd0a8' },
                        { x: '-12px', y: '-78px', color: '#ffe7be' },
                        { x: '48px', y: '-46px', color: '#ffb888' },
                        { x: '70px', y: '14px', color: '#ffe1b2' },
                        { x: '-24px', y: '52px', color: '#ffdcb4' },
                        { x: '28px', y: '62px', color: '#fff0c8' },
                      ]
                    : selectedMascotId === 'posty'
                      ? [
                          { x: '-20px', y: '-80px', color: '#9fb6ff' },
                          { x: '52px', y: '-52px', color: '#c7d6ff' },
                          { x: '76px', y: '8px', color: '#82a3ff' },
                          { x: '-72px', y: '2px', color: '#d7e2ff' },
                          { x: '-34px', y: '52px', color: '#98b4ff' },
                          { x: '16px', y: '64px', color: '#dce8ff' },
                        ]
                      : [
                          { x: '-18px', y: '-82px', color: '#8be6f2' },
                          { x: '44px', y: '-64px', color: '#bdf5fb' },
                          { x: '78px', y: '-4px', color: '#58d1e1' },
                          { x: '-76px', y: '14px', color: '#96eff8' },
                          { x: '-30px', y: '58px', color: '#79dceb' },
                          { x: '18px', y: '68px', color: '#d7fbff' },
                        ]).map((spark, index) => (
                <div
                  key={`${signalKey}-spark-${index}`}
                  className={`mail-burst-star mail-burst-star-${selectedMascotId} pointer-events-none`}
                  style={
                    {
                      '--burst-x': spark.x,
                      '--burst-y': spark.y,
                      backgroundColor: spark.color,
                    } as React.CSSProperties
                  }
                />
              ))}
            </>
          )}
          {isLaunch && (
            <>
              <div
                key={`${signalKey}-trail`}
                className={`mail-launch-trail mail-launch-${selectedMascotId} pointer-events-none`}
              />
              <div
                key={`${signalKey}-envelope`}
                className={`mail-launch-envelope mail-launch-envelope-${selectedMascotId} pointer-events-none`}
              />
            </>
          )}
          <div className={`companion-stage ${mascotMotionClass}`}>
            <CourierMascot
              mascotId={selectedMascotId}
              bond={bond}
              care={care}
              size={compact ? 112 : 138}
              stage="full"
              spinOnClick
            />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <span className="rounded-full bg-white/85 px-3 py-1 text-[10px] font-semibold text-sumi-text-muted">
            {getMascotPhaseLabel(phase)}
          </span>
          <span className="rounded-full bg-sumi-surface px-3 py-1 text-[10px] font-semibold text-sumi-text-muted">
            {getMascotConditionLabel(condition.status)}
          </span>
          <span className="rounded-full bg-white/85 px-3 py-1 text-[10px] font-semibold text-sumi-text-muted">
            連続 {streakDays}日
          </span>
        </div>

        {summonEvent && (
          <div className="companion-badge mt-4 rounded-[22px] border border-white/80 bg-[linear-gradient(135deg,rgba(255,255,255,0.98),rgba(255,237,231,0.95))] px-4 py-3 shadow-[0_14px_30px_rgba(255,204,194,0.18)]">
            <div className="flex items-center gap-2 text-[11px] font-semibold text-sumi-accent">
              {getEventIcon(summonEvent.reason)}
              <span>{getEventLabel(summonEvent.reason)}</span>
            </div>
            {eventTone && (
              <p className="mt-1 text-[10px] font-semibold tracking-[0.08em] text-sumi-text-muted">
                {eventTone}
              </p>
            )}
            <p className="mt-2 text-[11px] leading-6 text-sumi-text">{summonEvent.message}</p>
          </div>
        )}

        {evolutionEvent && evolutionEvent.mascotId === selectedMascotId && (
          <div className="companion-badge mt-3 rounded-[22px] border border-[#ffd8a8] bg-[linear-gradient(135deg,rgba(255,252,245,0.98),rgba(255,240,219,0.96))] px-4 py-3 shadow-[0_14px_30px_rgba(255,221,173,0.18)]">
            <div className="flex items-center gap-2 text-[11px] font-semibold text-[#d3822f]">
              <Star size={12} />
              <span>成長演出</span>
            </div>
            <p className="mt-2 text-[11px] leading-6 text-sumi-text">
              {mascot.name} が {getMascotPhaseLabel(evolutionEvent.phase)} に進化しました。
            </p>
          </div>
        )}

        <div className={`mt-4 rounded-[22px] bg-white/72 ${compact ? 'p-3' : 'p-4'}`}>
          <div className="flex items-center justify-between text-[11px] text-sumi-text-muted">
            <span>成長ゲージ</span>
            <span>{progress.current} / {progress.nextGoal}pt</span>
          </div>
          <div className="mt-2 h-2 rounded-full bg-sumi-surface">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.max(10, progress.progress * 100)}%`,
                background: `linear-gradient(90deg, ${mascot.accent}, ${mascot.accentSoft})`,
              }}
            />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[10px] text-sumi-text-muted">
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span>おなか</span>
                <span>{care.fullness}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-white/90">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${care.fullness}%`, backgroundColor: mascot.accent }}
                />
              </div>
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span>ごきげん</span>
                <span>{care.mood}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-white/90">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${care.mood}%`, backgroundColor: mascot.accent }}
                />
              </div>
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span>げんき</span>
                <span>{care.energy}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-white/90">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${care.energy}%`, backgroundColor: mascot.accent }}
                />
              </div>
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span>みだしなみ</span>
                <span>{care.cleanliness}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-white/90">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${care.cleanliness}%`, backgroundColor: mascot.accent }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

    </aside>
  )
}
