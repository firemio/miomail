import { useEffect, useRef, useState } from 'react'
import { getMascotMeta, type MascotId } from '../../data/mascots'
import { useMascotStore, type MascotNeed } from '../../stores/mascotStore'
import { MascotRenderer } from '../characters/MascotRenderer'
import { getSentTripTiming, loadCompanionPosition, randomCompanionPosition, type CompanionPosition } from '../../lib/companionPosition'

type WalkKind = 'sent' | 'received'

interface WalkState {
  key: number
  kind: WalkKind
  start: CompanionPosition
  end: CompanionPosition
  courierMascotId: MascotId
  durationMs: number
  returnDurationMs: number
  outboundDurationMs: number
  returnEasing: string
  postNeed: MascotNeed
}

export interface SentDeliveryHandoff {
  key: number
  destination: CompanionPosition
  status: 'traveling' | 'arrived'
}

interface CourierDeliveryOverlayProps {
  onSentDeliveryChange: (delivery: SentDeliveryHandoff | null) => void
}

const RECEIVING_COURIER: Record<MascotId, MascotId> = {
  makko: 'posty',
  mio: 'saeta',
  posty: 'mio',
  saeta: 'makko',
}

const POST_VARIANTS: Array<{
  need: MascotNeed
  label: string
  routeLabel: string
  gradient: string
  rim: string
  base: string
  text: string
}> = [
  { need: 'fullness', label: 'SNACK', routeLabel: 'おやつ便', gradient: 'linear-gradient(90deg,#ffbd78,#ff936f 58%,#ef6c5b)', rim: '#d95b4f', base: '#b84741', text: '#b84c40' },
  { need: 'mood', label: 'PLAY', routeLabel: 'あそび便', gradient: 'linear-gradient(90deg,#ff9ec6,#ed78b2 58%,#d85a9c)', rim: '#bd4386', base: '#9b386f', text: '#ad3f7b' },
  { need: 'energy', label: 'REST', routeLabel: 'おやすみ便', gradient: 'linear-gradient(90deg,#88b8f5,#668edb 58%,#526fc1)', rim: '#405ca7', base: '#354b89', text: '#405fa6' },
  { need: 'cleanliness', label: 'CARE', routeLabel: 'お手入れ便', gradient: 'linear-gradient(90deg,#7edfd2,#52c3b7 58%,#35a99e)', rim: '#278e86', base: '#1e716b', text: '#278e86' },
]

export function CourierDeliveryOverlay({ onSentDeliveryChange }: CourierDeliveryOverlayProps) {
  const summonEvent = useMascotStore((state) => state.summonEvent)
  const selectedMascotId = useMascotStore((state) => state.selectedMascotId)
  const bond = useMascotStore((state) => state.bondByMascot[state.selectedMascotId] ?? 0)
  const careByMascot = useMascotStore((state) => state.careByMascot)
  const rewardPostDelivery = useMascotStore((state) => state.rewardPostDelivery)
  const [walk, setWalk] = useState<WalkState | null>(null)
  const lastEventAtRef = useRef(0)

  useEffect(() => {
    if (!summonEvent) return
    if (summonEvent.reason !== 'sent' && summonEvent.reason !== 'new-mail') return
    if (summonEvent.at === lastEventAtRef.current) return
    lastEventAtRef.current = summonEvent.at
    const courierMascotId = summonEvent.reason === 'new-mail'
      ? RECEIVING_COURIER[selectedMascotId]
      : selectedMascotId
    const start = loadCompanionPosition()
    const end = randomCompanionPosition(summonEvent.at)
    const sentTiming = getSentTripTiming(selectedMascotId, start, end)
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const nextWalk: WalkState = {
      key: summonEvent.at,
      kind: summonEvent.reason === 'sent' ? 'sent' : 'received',
      start,
      end,
      courierMascotId,
      durationMs: reducedMotion ? 0 : summonEvent.reason === 'sent' ? sentTiming.totalMs : 5600,
      returnDurationMs: reducedMotion ? 0 : sentTiming.returnMs,
      outboundDurationMs: reducedMotion ? 0 : sentTiming.outboundMs,
      returnEasing: sentTiming.easing,
      postNeed: POST_VARIANTS[Math.abs(summonEvent.at) % POST_VARIANTS.length].need,
    }
    setWalk(nextWalk)
    onSentDeliveryChange(nextWalk.kind === 'sent'
      ? { key: nextWalk.key, destination: nextWalk.end, status: 'traveling' }
      : null)
  }, [onSentDeliveryChange, selectedMascotId, summonEvent])

  useEffect(() => {
    if (!walk) return
    const timer = window.setTimeout(() => {
      setWalk(null)
      if (walk.kind === 'sent') {
        onSentDeliveryChange({ key: walk.key, destination: walk.end, status: 'arrived' })
      }
    }, walk.durationMs)
    const rewardTimer = walk.kind === 'sent'
      ? window.setTimeout(() => rewardPostDelivery(walk.postNeed), walk.outboundDurationMs)
      : null
    return () => {
      window.clearTimeout(timer)
      if (rewardTimer !== null) window.clearTimeout(rewardTimer)
    }
  }, [onSentDeliveryChange, rewardPostDelivery, walk])

  useEffect(() => () => onSentDeliveryChange(null), [onSentDeliveryChange])

  if (!walk) return null

  const mascot = getMascotMeta(walk.courierMascotId)
  const post = POST_VARIANTS.find((variant) => variant.need === walk.postNeed) ?? POST_VARIANTS[0]
  // たまご期でも配達員として歩けるように、演出中は配達デビュー期以上の見た目にする
  const walkBond = walk.kind === 'sent' ? bond : Math.max(bond, 12)

  return (
    <div className="pointer-events-none fixed inset-0 z-[70] overflow-hidden" aria-hidden="true">
      <div
        key={walk.key}
        className={`courier-scene courier-scene-${walk.kind}`}
        data-delivery-kind={walk.kind}
        data-current-mascot={selectedMascotId}
        data-courier-mascot={walk.courierMascotId}
        data-post-need={walk.kind === 'sent' ? walk.postNeed : undefined}
        style={{
          '--companion-start-x': `${walk.start.x}px`,
          '--companion-start-y': `${walk.start.y}px`,
          '--companion-end-x': `${walk.end.x}px`,
          '--companion-end-y': `${walk.end.y}px`,
          '--sent-return-duration': `${walk.returnDurationMs}ms`,
          '--sent-outbound-duration': `${walk.outboundDurationMs}ms`,
          '--sent-return-delay': `${walk.outboundDurationMs}ms`,
          '--sent-return-easing': walk.returnEasing,
          '--walk-duration': `${walk.durationMs}ms`,
        } as React.CSSProperties}
      >
        {/* 受信は自宅メールボックス、送信は配送ルートのゲート */}
        {walk.kind === 'sent' && <div className={`courier-post courier-station-${walk.kind}`}>
          <div
            className="absolute inset-x-0 top-0 h-[124px] rounded-t-[46px]"
            style={{
              background: post.gradient,
              boxShadow: '0 14px 28px rgba(80, 110, 130, 0.24)',
            }}
          />
          <div
            className="absolute left-[-5px] right-[-5px] top-[30px] h-[10px] rounded-full"
            style={{ backgroundColor: post.rim }}
          />
          <div
            className="absolute left-1/2 top-[50px] h-[10px] w-[58px] -translate-x-1/2 rounded-full"
            style={{ backgroundColor: '#25393d', boxShadow: 'inset 0 2px 3px rgba(0, 0, 0, 0.35)' }}
          />
          <div
            className="absolute left-1/2 top-[72px] flex h-[29px] w-[68px] -translate-x-1/2 items-center justify-center rounded-[8px] bg-white/95 text-[10px] font-bold tracking-[0.12em]"
            style={{ color: post.text }}
          >
            {post.label}
          </div>
          <div
            className="absolute bottom-[12px] left-1/2 h-[22px] w-[68px] -translate-x-1/2"
            style={{ backgroundColor: post.rim }}
          />
          <div
            className="absolute bottom-0 left-1/2 h-[16px] w-[106px] -translate-x-1/2 rounded-[6px]"
            style={{ backgroundColor: post.base }}
          />
          <div className="courier-post-spark" />
          {walk.kind === 'sent' && <div className="courier-route-label" style={{ color: post.text }}>{post.routeLabel}</div>}
        </div>}

        {/* てくてく歩く相棒 */}
        <div className="courier-walker">
          <div className="courier-walker-waddle">
            <div className="courier-walker-shadow" />
            <MascotRenderer mascotId={walk.courierMascotId} bond={walkBond} care={careByMascot[walk.courierMascotId]} size={88} pose={7} motion="walk" />
            <div className="courier-walker-envelope">
              <div className="courier-envelope-inner">
                <div className="courier-envelope-flap" style={{ backgroundColor: mascot.accentSoft }} />
                <div className="courier-envelope-seal" style={{ backgroundColor: mascot.accent }} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
