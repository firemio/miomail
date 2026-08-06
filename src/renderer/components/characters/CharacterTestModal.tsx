import { useEffect, useState } from 'react'
import { RotateCw, X } from 'lucide-react'
import type { CharacterModPackage, CharacterMotion } from '../../characters/types'
import { POSE_MOTIONS } from '../../characters/types'
import { MASCOT_IDLE_MOTION_LABELS } from '../../data/mascotIdleMotions'
import { getMascotMeta } from '../../data/mascots'
import { getMascotPhase, getMascotPhaseLabel, MASCOT_GROWTH_STAGES } from '../../stores/mascotStore'
import { MascotModView } from './MascotModView'

interface CharacterTestModalProps {
  characterPackage: CharacterModPackage
  onClose: () => void
}

const EXTRA_MOTION_LABELS: ReadonlyArray<[CharacterMotion, string]> = [
  ['walk', '歩く'],
  ['deliver', 'おとどけ'],
]

const SIZE_OPTIONS = [96, 140, 200, 280] as const

function rendererLabel(renderer: CharacterModPackage['manifest']['renderer']) {
  return renderer === 'gltf-3d' ? '3D' : renderer === 'dom-svg' ? 'SVG' : '2D'
}

/**
 * MODを選択状態に関係なくその場で試せるテストモーダル。
 * 全モーション・育成段階(卵含む)・表示サイズ・クリック回転を確認できる。
 */
export function CharacterTestModal({ characterPackage, onClose }: CharacterTestModalProps) {
  const manifest = characterPackage.manifest
  const mascotId = manifest.behaviorProfile
  const mascot = getMascotMeta(mascotId)
  const [motion, setMotion] = useState<CharacterMotion>('idle')
  const [bond, setBond] = useState(20)
  const [size, setSize] = useState<number>(200)
  const [spinSignal, setSpinSignal] = useState(0)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // 設定モーダル側のEscapeを発火させない(テストだけ閉じる)
        event.stopImmediatePropagation()
        event.stopPropagation()
        onClose()
      }
    }
    // 設定モーダル側のEscapeより先に受け取る(captureで先勝ち)
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [onClose])

  const phase = getMascotPhase(bond)
  const motionItems: Array<{ motion: CharacterMotion; label: string }> = [
    ...POSE_MOTIONS.map((poseMotion, index) => ({
      motion: poseMotion,
      label: MASCOT_IDLE_MOTION_LABELS[mascotId][index] ?? poseMotion,
    })),
    ...EXTRA_MOTION_LABELS.map(([extraMotion, label]) => ({ motion: extraMotion, label })),
  ]

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-[#4a3540]/45 p-6 backdrop-blur-[2px]"
      onClick={onClose}
      // 設定モーダルの背景はmousedownで閉じる。clickだけ止めてもmousedownが先に
      // 届いてしまい、テスト内のボタンやスライダーを触った瞬間に設定ごと閉じる
      onMouseDown={(event) => event.stopPropagation()}
      role="dialog"
      aria-modal="true"
      aria-label={`${manifest.name}のテスト`}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-[860px] flex-col overflow-hidden rounded-[28px] border border-white/85 bg-[linear-gradient(160deg,#fffdfb,#fff3ee)] shadow-[0_30px_80px_rgba(90,55,70,0.3)]"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-4 border-b border-white/80 px-6 py-4">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold tracking-[0.18em] text-sumi-text-muted">CHARACTER TEST</p>
            <h3 className="mt-0.5 flex items-center gap-2 truncate text-lg font-semibold text-sumi-text">
              {manifest.name}
              <span className="rounded-full bg-sumi-surface px-2 py-0.5 text-[10px] font-semibold text-sumi-text-muted">{rendererLabel(manifest.renderer)}</span>
            </h3>
            <p className="mt-0.5 truncate text-[11px] text-sumi-text-muted">{manifest.author} v{manifest.version}・仕草: {mascot.name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/90 bg-white/85 text-sumi-text-muted transition hover:text-sumi-text"
            aria-label="テストを閉じる"
          >
            <X size={16} />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(300px,1fr)_minmax(0,1.1fr)] gap-5 overflow-y-auto p-6">
          <div
            className="relative flex min-h-[340px] cursor-pointer flex-col items-center justify-center rounded-[24px] border border-white/85 bg-white/72 p-5 shadow-[0_18px_46px_rgba(121,85,96,0.08)]"
            onClick={() => setSpinSignal((cycle) => cycle + 1)}
            title="クリックでくるっと回る"
          >
            <MascotModView
              characterPackage={characterPackage}
              mascotId={mascotId}
              bond={bond}
              size={size}
              motion={motion}
              spinSignal={spinSignal}
            />
            <p className="pointer-events-none absolute bottom-4 text-[10px] text-sumi-text-muted">クリックでくるっと回る</p>
          </div>

          <div className="space-y-5">
            <section>
              <p className="text-[10px] font-semibold tracking-[0.14em] text-sumi-text-muted">モーション</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {motionItems.map((item) => {
                  const active = motion === item.motion
                  return (
                    <button
                      key={item.motion}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setMotion(item.motion)}
                      className={`flex items-center justify-between rounded-[16px] border px-3 py-2.5 text-left transition ${active ? 'border-sumi-accent/45 bg-white shadow-[0_10px_22px_rgba(255,111,145,0.12)]' : 'border-white/80 bg-white/62 hover:bg-white/85'}`}
                    >
                      <span className="text-xs font-semibold text-sumi-text">{item.label}</span>
                      <span className="text-[9px] tracking-[0.1em] text-sumi-text-muted">{item.motion}</span>
                    </button>
                  )
                })}
              </div>
            </section>

            <section>
              <div className="flex items-end justify-between">
                <p className="text-[10px] font-semibold tracking-[0.14em] text-sumi-text-muted">成長段階</p>
                <p className="text-[11px] font-semibold text-sumi-text">{getMascotPhaseLabel(phase)}・{bond}pt</p>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={bond}
                onChange={(event) => setBond(Number(event.target.value))}
                className="mt-2 w-full accent-[#ff6f91]"
              />
              <div className="mt-1 flex gap-1.5">
                {MASCOT_GROWTH_STAGES.map((stage) => (
                  <button
                    key={stage.phase}
                    type="button"
                    aria-pressed={phase === stage.phase}
                    onClick={() => setBond(stage.minBond)}
                    className={`rounded-full px-2.5 py-1.5 text-[10px] font-semibold transition ${phase === stage.phase ? 'bg-sumi-accent text-white' : 'border border-white/90 bg-white/80 text-sumi-text-muted hover:text-sumi-text'}`}
                  >
                    {getMascotPhaseLabel(stage.phase)}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[10px] leading-4 text-sumi-text-muted">孵化前はたまごで表示されます(ポスティはロボの姿のまま)。実際のアプリ挙動と同じです。</p>
            </section>

            <section className="flex items-end justify-between gap-4">
              <div>
                <p className="text-[10px] font-semibold tracking-[0.14em] text-sumi-text-muted">表示サイズ</p>
                <div className="mt-2 flex gap-1.5">
                  {SIZE_OPTIONS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={size === option}
                      onClick={() => setSize(option)}
                      className={`rounded-full px-3 py-1.5 text-[10px] font-semibold transition ${size === option ? 'bg-sumi-accent text-white' : 'border border-white/90 bg-white/80 text-sumi-text-muted hover:text-sumi-text'}`}
                    >
                      {option}px
                    </button>
                  ))}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSpinSignal((cycle) => cycle + 1)}
                className="inline-flex h-10 items-center gap-2 rounded-2xl border border-white/90 bg-white/85 px-4 text-[11px] font-semibold text-sumi-text-muted transition hover:text-sumi-text"
              >
                <RotateCw size={13} />くるっと回す
              </button>
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}
