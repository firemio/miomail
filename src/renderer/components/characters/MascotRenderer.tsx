import type { ReactNode } from 'react'
import type { CharacterModPackage, CharacterMotion } from '../../characters/types'
import { DEFAULT_MOD_ID_BY_MASCOT, motionForPose } from '../../characters/types'
import type { MascotId } from '../../data/mascots'
import type { MascotCareStats } from '../../stores/mascotStore'
import { getMascotPhase, useMascotStore } from '../../stores/mascotStore'
import { useCharacterStore } from '../../stores/characterStore'
import { DomModMascot } from './DomModMascot'
import { EggMascot } from './EggMascot'
import { GltfModMascot } from './GltfModMascot'
import { SpriteModMascot } from './SpriteModMascot'

interface MascotRendererProps {
  mascotId: MascotId
  bond?: number
  care?: MascotCareStats
  size?: number
  pose?: number
  motion?: CharacterMotion
  spinSignal?: number
  className?: string
  /** 選択中MODによる差し替えを無視して既定の同梱MODで描く（設定のキャラ一覧用） */
  forceDefaultMod?: boolean
}

function resolvePackage(
  packages: CharacterModPackage[],
  mascotId: MascotId,
  selectedMascotId: MascotId,
  selectedModId: string | null,
  forceDefaultMod: boolean,
): CharacterModPackage | null {
  if (!forceDefaultMod && mascotId === selectedMascotId && selectedModId) {
    const chosen = packages.find((item) => item.manifest.id === selectedModId)
    if (chosen) return chosen
  }
  return (
    packages.find((item) => item.manifest.id === DEFAULT_MOD_ID_BY_MASCOT[mascotId])
    ?? packages.find((item) => item.origin === 'builtin' && item.manifest.behaviorProfile === mascotId)
    ?? null
  )
}

export function MascotRenderer({
  mascotId,
  bond = 0,
  care,
  size = 96,
  pose = 0,
  motion,
  spinSignal = 0,
  className = '',
  forceDefaultMod = false,
}: MascotRendererProps) {
  const selectedMascotId = useMascotStore((state) => state.selectedMascotId)
  const { selectedModId, packages } = useCharacterStore()

  const phase = getMascotPhase(bond)
  // 育成スケールは組み込み時代の式を踏襲: (1 + min(bond,80)/400) * phaseScale
  const phaseScale =
    phase === 'egg' ? 0.76 : phase === 'hatchling' ? 0.9 : phase === 'courier' ? 1 : phase === 'partner' ? 1.06 : 1.14
  const growthScale = (1 + Math.min(bond, 80) / 400) * phaseScale
  const bodyOpacity = care && care.energy <= 24 ? 0.84 : 1

  const selectedPackage = resolvePackage(packages, mascotId, selectedMascotId, selectedModId, forceDefaultMod)
  // 孵化前はたまご。ポスティだけは卵期もロボの姿を貫く（組み込み時代からの仕様）
  const showEgg = phase === 'egg' && mascotId !== 'posty'

  const egg = <EggMascot mascotId={mascotId} size={size} spinSignal={spinSignal} />

  let content: ReactNode
  if (showEgg || !selectedPackage) {
    content = egg
  } else {
    const resolvedMotion = motion ?? motionForPose(pose)
    switch (selectedPackage.manifest.renderer) {
      case 'sprite-2d':
        content = (
          <SpriteModMascot
            characterPackage={selectedPackage}
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
            characterPackage={selectedPackage}
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
            characterPackage={selectedPackage}
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
