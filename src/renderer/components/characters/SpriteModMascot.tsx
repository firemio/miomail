import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type {
  CharacterModPackage,
  CharacterMotion,
  SpriteSequenceMotion,
  SpriteSheetMotion,
} from '../../characters/types'
import { loadCharacterModAssetUrl, useCharacterModAssetUrl } from '../../lib/characterMods'

interface SpriteModMascotProps {
  characterPackage: CharacterModPackage
  motion: CharacterMotion
  size: number
  spinSignal: number
  className?: string
  fallback: ReactNode
}

function mimeForFile(file: string) {
  return file.toLowerCase().endsWith('.png') ? 'image/png' : 'image/webp'
}

function firstMotion<T>(motions: Partial<Record<CharacterMotion, T>>) {
  return Object.entries(motions)[0] as [CharacterMotion, T] | undefined
}

function resolveMotion<T>(motions: Partial<Record<CharacterMotion, T>>, requested: CharacterMotion) {
  if (motions[requested]) return [requested, motions[requested]] as const
  if (motions.idle) return ['idle', motions.idle] as const
  return firstMotion(motions) ?? null
}

function useFrameCursor(frameCount: number, fps: number, loop: boolean, identity: string) {
  const [cursor, setCursor] = useState(0)

  useEffect(() => {
    setCursor(0)
    if (frameCount <= 1 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const interval = window.setInterval(() => {
      setCursor((current) => {
        if (current + 1 < frameCount) return current + 1
        return loop ? 0 : current
      })
    }, Math.max(16, Math.round(1000 / fps)))
    return () => window.clearInterval(interval)
  }, [fps, frameCount, identity, loop])

  return Math.min(cursor, Math.max(0, frameCount - 1))
}

function SpriteSheetView({
  characterPackage,
  motion,
  size,
  onFailure,
}: Omit<SpriteModMascotProps, 'spinSignal' | 'className' | 'fallback'> & { onFailure: () => void }) {
  const manifest = characterPackage.manifest
  if (manifest.renderer !== 'sprite-2d' || manifest.source.type !== 'sheet') return null
  const source = manifest.source
  const resolved = resolveMotion<SpriteSheetMotion>(source.motions, motion)
  const frames = resolved?.[1].frames ?? [0]
  const fps = resolved?.[1].fps ?? 1
  const loop = resolved?.[1].loop ?? true
  const cursor = useFrameCursor(frames.length, fps, loop, `${resolved?.[0] ?? 'idle'}:${characterPackage.revision}`)
  const frame = frames[cursor] ?? frames[0] ?? 0
  const highestFrame = Math.max(
    0,
    ...Object.values(source.motions).flatMap((motion) => motion.frames),
  )
  const rows = source.rows ?? Math.max(1, Math.ceil((highestFrame + 1) / source.columns))
  const { url, error } = useCharacterModAssetUrl(characterPackage, 'sheet', mimeForFile(source.file))

  useEffect(() => {
    if (error) onFailure()
  }, [error, onFailure])

  if (!url) return null
  const column = frame % source.columns
  const row = Math.floor(frame / source.columns)
  const frameScale = Math.min(size / source.frameWidth, size / source.frameHeight)
  const displayWidth = source.frameWidth * frameScale
  const displayHeight = source.frameHeight * frameScale

  return (
    <div className="grid place-items-center" style={{ width: size, height: size }} aria-hidden="true">
      <div className="overflow-hidden" style={{ width: displayWidth, height: displayHeight }}>
        <img
          src={url}
          alt=""
          draggable={false}
          onError={onFailure}
          style={{
            display: 'block',
            width: source.columns * displayWidth,
            height: rows * displayHeight,
            maxWidth: 'none',
            transform: `translate(${-column * displayWidth}px, ${-row * displayHeight}px)`,
            imageRendering: source.imageRendering ?? 'auto',
            userSelect: 'none',
          }}
        />
      </div>
    </div>
  )
}

function SpriteSequenceView({
  characterPackage,
  motion,
  size,
  onFailure,
}: Omit<SpriteModMascotProps, 'spinSignal' | 'className' | 'fallback'> & { onFailure: () => void }) {
  const manifest = characterPackage.manifest
  const [urls, setUrls] = useState<Record<number, string>>({})
  if (manifest.renderer !== 'sprite-2d' || manifest.source.type !== 'sequence') return null
  const resolved = resolveMotion<SpriteSequenceMotion>(manifest.source.motions, motion)
  const motionName = resolved?.[0] ?? 'idle'
  const config = resolved?.[1]
  const files = useMemo(() => config?.files ?? [], [config?.files])
  const [cursor, setCursor] = useState(0)
  const activeCursor = Math.min(cursor, Math.max(0, files.length - 1))

  useEffect(() => {
    setCursor(0)
    setUrls({})
  }, [characterPackage, files, motionName])

  useEffect(() => {
    let active = true
    let timer = 0
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const canAdvance = files.length > 1
      && !reducedMotion
      && (config?.loop !== false || activeCursor + 1 < files.length)
    const nextIndex = canAdvance ? (activeCursor + 1) % files.length : activeCursor
    const indexes = [...new Set([activeCursor, nextIndex])]
    const requests = indexes.map((index) => {
      const file = files[index]
      if (!file) return Promise.reject(new Error('sequence frame is missing'))
      return loadCharacterModAssetUrl(
        characterPackage,
        `sequence:${motionName}:${index}`,
        mimeForFile(file),
      ).then((url) => [index, url] as const)
    })
    void Promise.all(requests).then(
      (loaded) => {
        if (!active) return
        setUrls((current) => ({
          ...current,
          ...Object.fromEntries(loaded),
        }))
        if (canAdvance) {
          timer = window.setTimeout(() => setCursor(nextIndex), Math.max(16, Math.round(1000 / (config?.fps ?? 1))))
        }
      },
      () => {
        if (active) onFailure()
      },
    )
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [activeCursor, characterPackage, config?.fps, config?.loop, files, motionName, onFailure])

  const url = urls[activeCursor] ?? urls[0] ?? Object.values(urls)[0]
  if (!url) return null
  return (
    <img
      src={url}
      alt=""
      draggable={false}
      onError={onFailure}
      className="block object-contain"
      style={{ width: size, height: size, userSelect: 'none' }}
      aria-hidden="true"
    />
  )
}

export function SpriteModMascot({
  characterPackage,
  motion,
  size,
  spinSignal,
  className = '',
  fallback,
}: SpriteModMascotProps) {
  const [failed, setFailed] = useState(false)
  const onFailure = useMemo(() => () => setFailed(true), [])

  useEffect(() => setFailed(false), [characterPackage.revision])
  if (failed) return <>{fallback}</>

  const source = characterPackage.manifest.renderer === 'sprite-2d'
    ? characterPackage.manifest.source
    : null

  return (
    <div
      className={`character-mod-frame character-mod-float relative shrink-0 ${className}`}
      style={{ width: size, height: size }}
      data-character-renderer="sprite-2d"
      data-character-mod={characterPackage.manifest.id}
    >
      <div key={spinSignal} className={spinSignal > 0 ? 'mascot-spin-once' : ''}>
        {source?.type === 'sheet' ? (
          <SpriteSheetView characterPackage={characterPackage} motion={motion} size={size} onFailure={onFailure} />
        ) : (
          <SpriteSequenceView characterPackage={characterPackage} motion={motion} size={size} onFailure={onFailure} />
        )}
      </div>
    </div>
  )
}
