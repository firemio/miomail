import { useEffect, useRef, useState } from 'react'
import { Box, Image as ImageIcon, Shapes } from 'lucide-react'
import type { CharacterModPackage } from '../../characters/types'
import { useCharacterModAssetUrl } from '../../lib/characterMods'
import { DomModMascot } from './DomModMascot'

function mimeForFile(file: string) {
  return file.toLowerCase().endsWith('.png') ? 'image/png' : 'image/webp'
}

interface SheetPreview {
  column: number
  row: number
  columns: number
  rows: number
  pixelated: boolean
}

interface PreviewSource {
  assetKey: string | null
  mime: string
  sheet?: SheetPreview
}

// thumbnail未指定のMODでも絵が出るように、2Dはスプライト本体から
// 代表フレーム(idleの1コマ目)を切り出してプレビューにする
function resolvePreview(characterPackage: CharacterModPackage): PreviewSource {
  const { manifest } = characterPackage
  if (manifest.thumbnail) {
    return { assetKey: 'thumbnail', mime: mimeForFile(manifest.thumbnail) }
  }
  if (manifest.renderer === 'sprite-2d') {
    if (manifest.source.type === 'sheet') {
      const { columns, rows, motions, imageRendering, file } = manifest.source
      const frame = motions.idle?.frames[0] ?? 0
      const resolvedRows = rows ?? 1
      return {
        assetKey: 'sheet',
        mime: mimeForFile(file),
        sheet: {
          column: frame % columns,
          row: Math.min(Math.floor(frame / columns), resolvedRows - 1),
          columns,
          rows: resolvedRows,
          pixelated: imageRendering === 'pixelated',
        },
      }
    }
    const files = manifest.source.motions.idle?.files
    if (files && files.length > 0) {
      return { assetKey: 'sequence:idle:0', mime: mimeForFile(files[0]) }
    }
  }
  return { assetKey: null, mime: 'image/webp' }
}

export function ModThumbnail({ characterPackage }: { characterPackage: CharacterModPackage }) {
  const hostRef = useRef<HTMLSpanElement>(null)
  const [visible, setVisible] = useState(false)
  const preview = resolvePreview(characterPackage)
  const { url } = useCharacterModAssetUrl(
    characterPackage,
    preview.assetKey && visible ? preview.assetKey : null,
    preview.mime
  )

  useEffect(() => {
    const host = hostRef.current
    if (!host || visible) return
    if (!('IntersectionObserver' in window)) {
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true)
        observer.disconnect()
      }
    }, { rootMargin: '300px' })
    observer.observe(host)
    return () => observer.disconnect()
  }, [visible])

  if (url && preview.sheet) {
    const { column, row, columns, rows, pixelated } = preview.sheet
    return (
      <span
        ref={hostRef}
        className="block h-full w-full bg-no-repeat"
        style={{
          backgroundImage: `url(${url})`,
          backgroundSize: `${columns * 100}% ${rows * 100}%`,
          backgroundPosition: `${columns > 1 ? (column / (columns - 1)) * 100 : 0}% ${rows > 1 ? (row / (rows - 1)) * 100 : 0}%`,
          imageRendering: pixelated ? 'pixelated' : undefined,
        }}
        aria-hidden="true"
      />
    )
  }

  if (url) {
    return (
      <span ref={hostRef} className="block h-full w-full">
        <img src={url} alt="" className="h-full w-full object-contain" draggable={false} loading="lazy" decoding="async" />
      </span>
    )
  }

  // dom-svgはDOMだけで描けるので、thumbnail画像が無くても本体をそのまま縮小表示する
  if (characterPackage.manifest.renderer === 'dom-svg') {
    return (
      <span ref={hostRef} className="flex h-full w-full items-center justify-center" aria-hidden="true">
        {visible && (
          <DomModMascot
            characterPackage={characterPackage}
            motion="idle"
            // ひげのように枠外へ描くパーツがあるMODでも切れないよう、少し余白を残す
            size={60}
            spinSignal={0}
            fallback={<Shapes size={28} strokeWidth={1.6} className="text-sumi-accent" />}
          />
        )}
      </span>
    )
  }

  const Icon = characterPackage.manifest.renderer === 'gltf-3d' ? Box : ImageIcon
  return (
    <span ref={hostRef} className="flex h-full w-full items-center justify-center text-sumi-accent" aria-hidden="true">
      <Icon size={28} strokeWidth={1.6} />
    </span>
  )
}
