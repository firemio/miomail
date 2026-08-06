import type { CharacterModPackage, CharacterMotion } from '../../characters/types'
import { DEFAULT_MOD_ID_BY_MASCOT } from '../../characters/types'
import type { MascotId } from '../../data/mascots'
import type { MascotCareStats } from '../../stores/mascotStore'
import { useMascotStore } from '../../stores/mascotStore'
import { useCharacterStore } from '../../stores/characterStore'
import { MascotModView } from './MascotModView'

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

/** 選択状態(ストア)からMODを解決して描画する。描画本体はMascotModView */
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
  const selectedPackage = resolvePackage(packages, mascotId, selectedMascotId, selectedModId, forceDefaultMod)

  return (
    <MascotModView
      characterPackage={selectedPackage}
      mascotId={mascotId}
      bond={bond}
      care={care}
      size={size}
      pose={pose}
      motion={motion}
      spinSignal={spinSignal}
      className={className}
    />
  )
}
