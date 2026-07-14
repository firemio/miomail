import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown, Heart, Settings2, Sparkles } from 'lucide-react'
import { getMascotMeta } from '../../data/mascots'
import { MASCOT_IDLE_MOTION_DURATIONS } from '../../data/mascotIdleMotions'
import {
  getMascotCondition,
  getMascotConditionLabel,
  getMascotPhase,
  getMascotPhaseLabel,
  getMascotProgress,
  useMascotStore,
} from '../../stores/mascotStore'
import { useUIStore } from '../../stores/uiStore'
import { clampCompanionPosition, getCompanionTravelRule, loadCompanionPosition, randomCompanionPosition, saveCompanionPosition, type CompanionPosition } from '../../lib/companionPosition'
import type { SentDeliveryHandoff } from './CourierDeliveryOverlay'
import { MascotRenderer } from '../characters/MascotRenderer'

interface CompanionOverlayProps {
  sentDelivery: SentDeliveryHandoff | null
  onSentDeliveryHandoffComplete: (key: number) => void
}

export function CompanionOverlay({ sentDelivery, onSentDeliveryHandoffComplete }: CompanionOverlayProps) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<CompanionPosition>(loadCompanionPosition)
  const [wandering, setWandering] = useState(false)
  const [movementDurationMs, setMovementDurationMs] = useState(0)
  const [pose, setPose] = useState(0)
  const [spinSignal, setSpinSignal] = useState(0)
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const panelRef = useRef<HTMLDivElement>(null)
  const positionRef = useRef(position)
  const dragRef = useRef<{ startX: number; startY: number; origin: CompanionPosition } | null>(null)
  const didDragRef = useRef(false)
  const wanderingRef = useRef(false)
  const poseActiveRef = useRef(false)
  const wanderEndTimerRef = useRef<number | null>(null)
  const { openSettings } = useUIStore()
  const {
    selectedMascotId,
    bondByMascot,
    careByMascot,
    streakDays,
    summonEvent,
    refreshMascotState,
  } = useMascotStore()

  const mascot = getMascotMeta(selectedMascotId)
  const bond = bondByMascot[selectedMascotId] ?? 0
  const care = careByMascot[selectedMascotId]
  const phase = getMascotPhase(bond)
  const condition = getMascotCondition(care)
  const progress = getMascotProgress(bond)
  const onDelivery = sentDelivery !== null
  positionRef.current = position

  const cancelWander = useCallback(() => {
    if (wanderEndTimerRef.current) window.clearTimeout(wanderEndTimerRef.current)
    wanderEndTimerRef.current = null
    wanderingRef.current = false
    setWandering(false)
  }, [])

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handleChange = (event: MediaQueryListEvent) => setReducedMotion(event.matches)
    preference.addEventListener('change', handleChange)
    return () => preference.removeEventListener('change', handleChange)
  }, [])

  useEffect(() => {
    refreshMascotState()
    const timer = window.setInterval(refreshMascotState, 60_000)
    return () => window.clearInterval(timer)
  }, [refreshMascotState])

  useEffect(() => {
    if (!open) return
    const closeOnOutside = (event: PointerEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', closeOnOutside)
    return () => window.removeEventListener('pointerdown', closeOnOutside)
  }, [open])

  useEffect(() => {
    if (sentDelivery) setOpen(false)
  }, [sentDelivery])

  useEffect(() => {
    const handleResize = () => setPosition((current) => clampCompanionPosition(current))
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    if (reducedMotion) {
      cancelWander()
      return
    }

    const wander = () => {
      if (open || dragRef.current || onDelivery || wanderingRef.current || poseActiveRef.current) return
      wanderingRef.current = true
      setWandering(true)
      const next = randomCompanionPosition()
      const current = positionRef.current
      const distance = Math.hypot(next.x - current.x, next.y - current.y)
      const { maxPixelsPerSecond } = getCompanionTravelRule(selectedMascotId)
      const duration = Math.max(1800, Math.ceil((distance / maxPixelsPerSecond) * 1000))
      setMovementDurationMs(duration)
      positionRef.current = next
      setPosition(next)
      saveCompanionPosition(next)
      wanderEndTimerRef.current = window.setTimeout(() => {
        wanderEndTimerRef.current = null
        wanderingRef.current = false
        setWandering(false)
      }, duration + 100)
    }

    let timer: number
    const scheduleWanderCheck = () => {
      const nextCheckMs = 20_000 + Math.random() * 20_000
      timer = window.setTimeout(() => {
        if (Math.random() < 0.1) wander()
        scheduleWanderCheck()
      }, nextCheckMs)
    }

    scheduleWanderCheck()
    return () => {
      window.clearTimeout(timer)
      cancelWander()
    }
  }, [cancelWander, onDelivery, open, reducedMotion, selectedMascotId])

  useEffect(() => {
    if (reducedMotion) {
      setPose(0)
      poseActiveRef.current = false
      return
    }

    let checkTimer: number
    let returnTimer: number | null = null
    const posePool = [1, 1, 2, 2, 3, 4, 5, 6, 7]

    const scheduleCheck = () => {
      const nextCheckMs = 6000 + Math.random() * 4000
      checkTimer = window.setTimeout(() => {
        const canPerform = !open && !onDelivery && !wanderingRef.current && !dragRef.current && !poseActiveRef.current
        if (canPerform && Math.random() < 0.45) {
          const nextPose = posePool[Math.floor(Math.random() * posePool.length)]
          poseActiveRef.current = true
          setPose(nextPose)
          returnTimer = window.setTimeout(() => {
            setPose(0)
            poseActiveRef.current = false
            returnTimer = null
          }, MASCOT_IDLE_MOTION_DURATIONS[nextPose])
        }
        scheduleCheck()
      }, nextCheckMs)
    }

    setPose(0)
    poseActiveRef.current = false
    scheduleCheck()
    return () => {
      window.clearTimeout(checkTimer)
      if (returnTimer) window.clearTimeout(returnTimer)
      poseActiveRef.current = false
    }
  }, [onDelivery, open, reducedMotion, selectedMascotId])

  useLayoutEffect(() => {
    if (sentDelivery?.status !== 'arrived') return
    const destination = clampCompanionPosition(sentDelivery.destination)
    positionRef.current = destination
    setMovementDurationMs(0)
    setPosition(destination)
    saveCompanionPosition(destination)
    onSentDeliveryHandoffComplete(sentDelivery.key)
  }, [onSentDeliveryHandoffComplete, sentDelivery])

  const startDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (onDelivery) return
    cancelWander()
    didDragRef.current = false
    dragRef.current = { startX: event.clientX, startY: event.clientY, origin: position }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const moveDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragRef.current) return
    const dx = event.clientX - dragRef.current.startX
    const dy = event.clientY - dragRef.current.startY
    if (Math.abs(dx) + Math.abs(dy) > 5) didDragRef.current = true
    setWandering(false)
    wanderingRef.current = false
    const next = clampCompanionPosition({ x: dragRef.current.origin.x + dx, y: dragRef.current.origin.y + dy })
    positionRef.current = next
    setPosition(next)
  }

  const endDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragRef.current) return
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    saveCompanionPosition(positionRef.current)
  }

  const cancelDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragRef.current) return
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    saveCompanionPosition(positionRef.current)
  }

  if (onDelivery) return null

  const movementClass = wandering
    ? 'transition-[left,top]'
    : ''
  const movementTiming = getCompanionTravelRule(selectedMascotId).easing

  return (
    <div
      ref={panelRef}
      className={`fixed z-[65] opacity-100 ${movementClass}`}
      style={{
        left: position.x,
        top: position.y,
        transitionDuration: wandering ? `${movementDurationMs}ms` : undefined,
        transitionTimingFunction: wandering ? movementTiming : undefined,
      }}
      data-testid="companion-overlay"
      data-mascot={selectedMascotId}
      data-event-reason={summonEvent?.reason ?? 'idle'}
      data-on-delivery="false"
    >
      {open && (
        <section className={`glass-panel absolute w-[320px] rounded-[30px] border border-white/80 bg-white/90 p-5 shadow-[0_28px_80px_rgba(82,52,60,0.28)] backdrop-blur-2xl ${position.x > window.innerWidth - 450 ? 'right-[108px]' : 'left-[108px]'} ${position.y > window.innerHeight - 520 ? 'bottom-0' : 'top-0'}`} role="dialog" aria-label={`${mascot.name}の詳細`}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-semibold tracking-[0.2em] text-sumi-text-muted">COMPANION</p>
              <h2 className="mt-1 font-display text-2xl text-sumi-text">{mascot.name}</h2>
              <p className="mt-1 text-[11px] text-sumi-text-muted">{mascot.subtitle}</p>
            </div>
            <button onClick={() => setOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-full border border-white/80 bg-white/80 text-sumi-text-muted" aria-label="相棒の詳細を閉じる"><ChevronDown size={16} /></button>
          </div>

          {summonEvent && <div className="mt-4 rounded-[18px] border border-sumi-accent/20 bg-sumi-accent/10 px-4 py-3"><div className="flex items-center gap-2 text-[10px] font-semibold text-sumi-accent"><Sparkles size={12} />お知らせ</div><p className="mt-1 text-[11px] leading-5 text-sumi-text">{summonEvent.message}</p></div>}

          <div className="mt-4 flex items-center gap-4 rounded-[22px] bg-sumi-surface/70 p-4">
            <MascotRenderer mascotId={selectedMascotId} bond={bond} care={care} size={94} pose={0} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap gap-1.5"><span className="rounded-full bg-white/80 px-2.5 py-1 text-[10px] text-sumi-text-muted">{getMascotPhaseLabel(phase)}</span><span className="rounded-full bg-white/80 px-2.5 py-1 text-[10px] text-sumi-text-muted">{getMascotConditionLabel(condition.status)}</span></div>
              <div className="mt-3 flex items-center justify-between text-[10px] text-sumi-text-muted"><span>成長</span><span>{progress.current} / {progress.nextGoal}pt</span></div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/80"><div className="h-full rounded-full bg-sumi-accent" style={{ width: `${Math.max(8, progress.progress * 100)}%` }} /></div>
              <p className="mt-2 text-[10px] text-sumi-text-muted">連続 {streakDays}日</p>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            {[
              ['おなか', care.fullness],
              ['ごきげん', care.mood],
              ['げんき', care.energy],
              ['みだしなみ', care.cleanliness],
            ].map(([label, value]) => <div key={String(label)} className="rounded-[16px] border border-white/80 bg-white/68 px-3 py-2.5"><div className="flex items-center justify-between text-[10px] text-sumi-text-muted"><span>{label}</span><span>{value}%</span></div><div className="mt-1.5 h-1.5 rounded-full bg-sumi-surface"><div className="h-full rounded-full" style={{ width: `${value}%`, backgroundColor: mascot.accent }} /></div></div>)}
          </div>

          <button onClick={() => { setOpen(false); openSettings() }} className="mt-4 flex w-full items-center justify-center gap-2 rounded-full border border-sumi-border bg-white/75 py-2.5 text-xs font-semibold text-sumi-text transition hover:border-sumi-accent/40"><Settings2 size={14} />相棒・テーマ設定</button>
        </section>
      )}

      <button
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={cancelDrag}
        onLostPointerCapture={cancelDrag}
        onClick={() => {
          if (!didDragRef.current) {
            setSpinSignal((signal) => signal + 1)
            setOpen((current) => !current)
          }
        }}
        className="group relative flex h-[96px] w-[96px] touch-none cursor-grab items-center justify-center active:cursor-grabbing"
        aria-label={open ? `${mascot.name}の詳細を閉じる` : `${mascot.name}の詳細を開く`}
      >
        <div className={wandering ? 'courier-walker-waddle' : ''}>
          <MascotRenderer mascotId={selectedMascotId} bond={bond} care={care} size={88} pose={pose} spinSignal={spinSignal} />
        </div>
        <span className="absolute -left-2 -top-2 flex h-7 min-w-7 items-center justify-center rounded-full border-2 border-white bg-sumi-accent px-1.5 text-[10px] font-bold text-white"><Heart size={10} className="mr-0.5" />{bond}</span>
        {summonEvent && <span className="absolute -right-1 -top-1 h-4 w-4 animate-pulse rounded-full border-2 border-white bg-sumi-unread" />}
      </button>
    </div>
  )
}
