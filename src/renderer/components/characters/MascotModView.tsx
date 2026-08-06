import type { ReactNode } from 'react'
import type { CharacterModPackage, CharacterMotion } from '../../characters/types'
import { motionForPose } from '../../characters/types'
import type { MascotId } from '../../data/mascots'
import type { MascotCareStats } from '../../stores/mascotStore'
import { getMascotPhase } from '../../stores/mascotStore'
import { DomModMascot } from './DomModMascot'
import { EggMascot } from './EggMascot'
import { GltfModMascot } from './GltfModMascot'
import { SpriteModMascot } from './SpriteModMascot'

/** 育成スケール。組み込み時代の式 (1 + min(bond,80)/400) * phaseScale を踏襲 */
export function growthScaleForBond(bond: number): number {
  const phase = getMascotPhase(bond)
  const phaseScale =
    phase === 'egg' ? 0.76 : phase === 'hatchling' ? 0.9 : phase === 'courier' ? 1 : phase === 'partner' ? 1.06 : 1.14
  return (1 + Math.min(bond, 80) / 400) * phaseScale
}

interface MascotModViewProps {
  /** 描画するMOD。null なら卵を表示 */
  characterPackage: CharacterModPackage | null
  mascotId: MascotId
  bond?: number
  care?: MascotCareStats
  size?: number
  pose?: number
  motion?: CharacterMotion
  spinSignal?: number
  className?: string
}

/**
 * 指定されたMODパッケージ1つを、育成スケール・卵段階・お疲れ時の薄まりまで
 * 込みで描画する表示専用コンポーネント。選択状態(ストア)には依存しない。
 * 通常表示はMascotRenderer経由、テストモーダルはここを直接使う。
 */
export function MascotModView({
  characterPackage,
  mascotId,
  bond = 0,
  care,
  size = 96,
  pose = 0,
  motion,
  spinSignal = 0,
  className = '',
}: MascotModViewProps) {
  const phase = getMascotPhase(bond)
  const growthScale = growthScaleForBond(bond)
  const bodyOpacity = care && care.energy <= 24 ? 0.84 : 1

  // 孵化前はたまご。ポスティだけは卵期もロボの姿を貫く(組み込み時代からの仕様)
  const showEgg = phase === 'egg' && mascotId !== 'posty'

  const egg = <EggMascot mascotId={mascotId} size={size} spinSignal={spinSignal} />

  let content: ReactNode
  if (showEgg || !characterPackage) {
    content = egg
  } else {
    const resolvedMotion = motion ?? motionForPose(pose)
    switch (characterPackage.manifest.renderer) {
      case 'sprite-2d':
        content = (
          <SpriteModMascot
            characterPackage={characterPackage}
            motion={resolvedMotion}
            size={size}
            spinSignal={spinSignal}
            fallback={egg}
          />
        )
        break
      case 'dom-svg':
        content = (
          <DomModMascot
            characterPackage={characterPackage}
            motion={resolvedMotion}
            size={size}
            spinSignal={spinSignal}
            fallback={egg}
          />
        )
        break
      case 'gltf-3d':
        content = (
          <GltfModMascot
            characterPackage={characterPackage}
            motion={resolvedMotion}
            size={size}
            spinSignal={spinSignal}
            fallback={egg}
          />
        )
        break
      default:
        content = egg
    }
  }

  // 育成の伸縮とお疲れ時の薄まりは全MOD共通で外側から掛ける
  return (
    <div className={`relative shrink-0 ${className}`} style={{ width: size, height: size, opacity: bodyOpacity }}>
      <div
        className="absolute inset-0"
        style={{
          transformStyle: 'preserve-3d',
          transform: growthScale === 1 ? undefined : `scale3d(${growthScale}, ${growthScale}, ${growthScale})`,
        }}
      >
        {content}
      </div>
    </div>
  )
}
