import { useEffect, useRef, useState } from 'react'
import { Box, Image as ImageIcon } from 'lucide-react'
import type { CharacterModPackage } from '../../characters/types'
import { useCharacterModAssetUrl } from '../../lib/characterMods'

function mimeForFile(file: string) {
  return file.toLowerCase().endsWith('.png') ? 'image/png' : 'image/webp'
}

export function ModThumbnail({ characterPackage }: { characterPackage: CharacterModPackage }) {
  const hostRef = useRef<HTMLSpanElement>(null)
  const [visible, setVisible] = useState(false)
  const thumbnail = characterPackage.manifest.thumbnail ?? null
  const { url } = useCharacterModAssetUrl(
    characterPackage,
    thumbnail && visible ? 'thumbnail' : null,
    thumbnail ? mimeForFile(thumbnail) : 'image/webp'
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

  if (url) {
    return (
      <span ref={hostRef} className="block h-full w-full">
        <img src={url} alt="" className="h-full w-full object-contain" draggable={false} loading="lazy" decoding="async" />
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
