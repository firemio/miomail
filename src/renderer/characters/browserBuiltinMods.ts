import type { CharacterModManifest, CharacterModPackage, CharacterModScanResult } from './types'
import makkoManifestRaw from '../../../mods/makko-svg/character.json?raw'
import makkoSceneRaw from '../../../mods/makko-svg/scene.json?raw'
import mioManifestRaw from '../../../mods/mio-svg/character.json?raw'
import mioSceneRaw from '../../../mods/mio-svg/scene.json?raw'
import postyManifestRaw from '../../../mods/posty-svg/character.json?raw'
import postySceneRaw from '../../../mods/posty-svg/scene.json?raw'
import saetaManifestRaw from '../../../mods/saeta-svg/character.json?raw'
import saetaSceneRaw from '../../../mods/saeta-svg/scene.json?raw'

/**
 * ブラウザープレビュー(非Tauri)用: 同梱の既定4MODをバンドルへ静的に取り込み、
 * デスクトップ版と同じscene.json経由でキャラクターを描けるようにする。
 * デスクトップ版ではRust側のスキャン結果が使われ、このモジュールは参照されない。
 */
export const BROWSER_BUILTIN_REVISION = 'browser-builtin'

const pairs: Array<[manifestRaw: string, sceneRaw: string]> = [
  [makkoManifestRaw, makkoSceneRaw],
  [mioManifestRaw, mioSceneRaw],
  [postyManifestRaw, postySceneRaw],
  [saetaManifestRaw, saetaSceneRaw],
]

const sceneRawById = new Map<string, string>()
const packages: CharacterModPackage[] = []

for (const [manifestRaw, sceneRaw] of pairs) {
  try {
    const manifest = JSON.parse(manifestRaw) as CharacterModManifest
    sceneRawById.set(manifest.id, sceneRaw)
    packages.push({ manifest, revision: BROWSER_BUILTIN_REVISION, origin: 'builtin' })
  } catch {
    // 同梱JSONが壊れていても他キャラの表示は続ける
  }
}

export function browserBuiltinScan(): CharacterModScanResult {
  return { packages: [...packages], issues: [] }
}

export function browserBuiltinAssetBytes(modId: string, assetKey: string): Uint8Array {
  const sceneRaw = assetKey === 'scene' ? sceneRawById.get(modId) : undefined
  if (sceneRaw === undefined) {
    throw new Error('ブラウザープレビューで読み込めるのは同梱MODのsceneだけです。')
  }
  return new TextEncoder().encode(sceneRaw)
}
