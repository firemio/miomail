import type { ReactNode } from 'react'
import type { BuiltinCharacterRenderer, CharacterMotion } from '../../characters/types'
import { motionForPose } from '../../characters/types'
import type { MascotId } from '../../data/mascots'
import type { MascotCareStats } from '../../stores/mascotStore'
import { useMascotStore } from '../../stores/mascotStore'
import { useCharacterStore } from '../../stores/characterStore'
import { CourierMascot } from '../layout/CourierMascot'
import { CourierMascot3D } from '../layout/CourierMascot3D'
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
  forceBuiltinRenderer?: BuiltinCharacterRenderer
}

function BuiltinMascot({
  renderer,
  mascotId,
  bond,
  care,
  size,
  pose,
  spinSignal,
  className,
}: MascotRendererProps & { renderer: BuiltinCharacterRenderer }) {
  if (renderer === 'classic-2d') {
    return (
      <div
        className={`mascot-classic-2d companion-pose companion-pose-${mascotId} companion-pose-${Math.max(0, Math.min(7, Math.trunc(pose ?? 0)))} relative shrink-0 ${className ?? ''}`}
        style={{ width: size, height: size }}
        data-character-renderer="classic-2d"
      >
        <div key={spinSignal ?? 0} className={(spinSignal ?? 0) > 0 ? 'mascot-spin-once' : ''}>
          <CourierMascot mascotId={mascotId} bond={bond} care={care} size={size} stage="full" />
        </div>
      </div>
    )
  }

  return (
    <CourierMascot3D
      mascotId={mascotId}
      bond={bond}
      care={care}
      size={size}
      pose={pose}
      spinSignal={spinSignal}
      className={className}
    />
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
  forceBuiltinRenderer,
}: MascotRendererProps) {
  const selectedMascotId = useMascotStore((state) => state.selectedMascotId)
  const { builtinRenderer, selectedModId, packages } = useCharacterStore()
  const selectedPackage = !forceBuiltinRenderer && mascotId === selectedMascotId
    ? packages.find((item) => item.manifest.id === selectedModId) ?? null
    : null
  const fallback: ReactNode = (
    <BuiltinMascot
      renderer={forceBuiltinRenderer ?? builtinRenderer}
      mascotId={mascotId}
      bond={bond}
      care={care}
      size={size}
      pose={pose}
      spinSignal={spinSignal}
      className={className}
    />
  )

  if (!selectedPackage) return fallback
  const resolvedMotion = motion ?? motionForPose(pose)

  return selectedPackage.manifest.renderer === 'sprite-2d' ? (
    <SpriteModMascot
      characterPackage={selectedPackage}
      motion={resolvedMotion}
      size={size}
      spinSignal={spinSignal}
      className={className}
      fallback={fallback}
    />
  ) : (
    <GltfModMascot
      characterPackage={selectedPackage}
      motion={resolvedMotion}
      size={size}
      spinSignal={spinSignal}
      className={className}
      fallback={fallback}
    />
  )
}

