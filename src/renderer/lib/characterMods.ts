import { useEffect, useState } from 'react'
import type { CharacterModPackage } from '../characters/types'
import { api } from './ipc'

const assetBytesCache = new Map<string, Promise<Uint8Array>>()
const assetUrlCache = new Map<string, Promise<string>>()
const createdUrls = new Set<string>()
const assetReadQueue: Array<() => void> = []
let activeAssetReads = 0
const MAX_CONCURRENT_ASSET_READS = 4

function pumpAssetReadQueue() {
  while (activeAssetReads < MAX_CONCURRENT_ASSET_READS && assetReadQueue.length > 0) {
    activeAssetReads += 1
    assetReadQueue.shift()?.()
  }
}

function scheduleAssetRead<T>(read: () => Promise<T>) {
  return new Promise<T>((resolve, reject) => {
    assetReadQueue.push(() => {
      Promise.resolve().then(read).then(resolve, reject).finally(() => {
        activeAssetReads -= 1
        pumpAssetReadQueue()
      })
    })
    pumpAssetReadQueue()
  })
}

function normalizeBytes(value: ArrayBuffer | Uint8Array | number[]) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (value instanceof Uint8Array) return value
  return new Uint8Array(value)
}

function toOwnedArrayBuffer(bytes: Uint8Array) {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

export function loadCharacterModAssetUrl(
  characterPackage: CharacterModPackage,
  assetKey: string,
  mimeType: string
) {
  const cacheKey = `${characterPackage.manifest.id}:${characterPackage.revision}:${assetKey}`
  const cached = assetUrlCache.get(cacheKey)
  if (cached) return cached

  const request = loadCharacterModAssetBytes(characterPackage, assetKey)
    .then((bytes) => {
      const url = URL.createObjectURL(new Blob([toOwnedArrayBuffer(bytes)], { type: mimeType }))
      assetBytesCache.delete(cacheKey)
      createdUrls.add(url)
      return url
    })
    .catch((error) => {
      assetUrlCache.delete(cacheKey)
      throw error
    })

  assetUrlCache.set(cacheKey, request)
  return request
}

export function releaseCharacterModAssetBytes(
  characterPackage: CharacterModPackage,
  assetKey: string,
) {
  assetBytesCache.delete(`${characterPackage.manifest.id}:${characterPackage.revision}:${assetKey}`)
}

export function loadCharacterModAssetBytes(
  characterPackage: CharacterModPackage,
  assetKey: string
) {
  const cacheKey = `${characterPackage.manifest.id}:${characterPackage.revision}:${assetKey}`
  const cached = assetBytesCache.get(cacheKey)
  if (cached) return cached

  const request = scheduleAssetRead(() => api.characterMods
    .readAsset(characterPackage.manifest.id, characterPackage.revision, assetKey))
    .then(normalizeBytes)
    .catch((error) => {
      assetBytesCache.delete(cacheKey)
      throw error
    })
  assetBytesCache.set(cacheKey, request)
  return request
}

export function pruneCharacterModAssetCache(
  packages: CharacterModPackage[],
  selectedModId: string | null = null,
) {
  const livePackages = packages.map((characterPackage) => ({
    id: characterPackage.manifest.id,
    prefix: `${characterPackage.manifest.id}:${characterPackage.revision}:`,
  }))
  const isLive = (cacheKey: string) => livePackages.some(({ id, prefix }) => {
    if (!cacheKey.startsWith(prefix)) return false
    const assetKey = cacheKey.slice(prefix.length)
    return assetKey === 'thumbnail' || id === selectedModId
  })

  for (const cacheKey of assetBytesCache.keys()) {
    if (!isLive(cacheKey)) assetBytesCache.delete(cacheKey)
  }
  for (const [cacheKey, request] of assetUrlCache) {
    if (isLive(cacheKey)) continue
    assetUrlCache.delete(cacheKey)
    void request.then((url) => {
      if (assetUrlCache.get(cacheKey) === request) return
      if (createdUrls.delete(url)) URL.revokeObjectURL(url)
    }, () => undefined)
  }
}

export function useCharacterModAssetUrl(
  characterPackage: CharacterModPackage,
  assetKey: string | null,
  mimeType: string
) {
  const [state, setState] = useState<{ url: string | null; error: string | null }>({
    url: null,
    error: null,
  })

  useEffect(() => {
    let active = true
    if (!assetKey) {
      setState({ url: null, error: null })
      return () => {
        active = false
      }
    }

    setState({ url: null, error: null })
    loadCharacterModAssetUrl(characterPackage, assetKey, mimeType).then(
      (url) => {
        if (active) setState({ url, error: null })
      },
      (error) => {
        if (active) setState({ url: null, error: error instanceof Error ? error.message : String(error) })
      }
    )

    return () => {
      active = false
    }
  }, [assetKey, characterPackage, mimeType])

  return state
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    createdUrls.forEach((url) => URL.revokeObjectURL(url))
    createdUrls.clear()
    assetBytesCache.clear()
    assetUrlCache.clear()
  }, { once: true })
}
