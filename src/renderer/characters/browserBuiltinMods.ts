import type { CharacterModManifest, CharacterModPackage, CharacterModScanResult } from './types'
import makkoManifestRaw from '../../../mods/makko-svg/character.json?raw'
import makkoSceneRaw from '../../../mods/makko-svg/scene.json?raw'
import mioManifestRaw from '../../../mods/mio-svg/character.json?raw'
import mioSceneRaw from '../../../mods/mio-svg/scene.json?raw'
import postyManifestRaw from '../../../mods/posty-svg/character.json?raw'
import postySceneRaw from '../../../mods/posty-svg/scene.json?raw'
import saetaManifestRaw from '../../../mods/saeta-svg/character.json?raw'
import saetaSceneRaw from '../../../mods/saeta-svg/scene.json?raw'
import makko3dManifestRaw from '../../../mods/makko-3d/character.json?raw'
import makko3dGlbUrl from '../../../mods/makko-3d/assets/character.glb?url'
import makko3dThumbUrl from '../../../mods/makko-3d/thumbnail.webp?url'
import mio3dManifestRaw from '../../../mods/mio-3d/character.json?raw'
import mio3dGlbUrl from '../../../mods/mio-3d/assets/character.glb?url'
import mio3dThumbUrl from '../../../mods/mio-3d/thumbnail.webp?url'
import posty3dManifestRaw from '../../../mods/posty-3d/character.json?raw'
import posty3dGlbUrl from '../../../mods/posty-3d/assets/character.glb?url'
import posty3dThumbUrl from '../../../mods/posty-3d/thumbnail.webp?url'
import saeta3dManifestRaw from '../../../mods/saeta-3d/character.json?raw'
import saeta3dGlbUrl from '../../../mods/saeta-3d/assets/character.glb?url'
import saeta3dThumbUrl from '../../../mods/saeta-3d/thumbnail.webp?url'

/**
 * ブラウザープレビュー(非Tauri)用: 同梱MOD(SVG 4体+3D 4体)をバンドルへ静的に取り込み、
 * デスクトップ版と同じ経路でキャラクターを描けるようにする。
 * デスクトップ版ではRust側のスキャン結果が使われ、このモジュールは参照されない。
 */
export const BROWSER_BUILTIN_REVISION = 'browser-builtin'

const entries: Array<[manifestRaw: string, sceneRaw: string | null, glbUrl: string | null, thumbUrl: string | null]> = [
  [makkoManifestRaw, makkoSceneRaw, null, null],
  [mioManifestRaw, mioSceneRaw, null, null],
  [postyManifestRaw, postySceneRaw, null, null],
  [saetaManifestRaw, saetaSceneRaw, null, null],
  [makko3dManifestRaw, null, makko3dGlbUrl, makko3dThumbUrl],
  [mio3dManifestRaw, null, mio3dGlbUrl, mio3dThumbUrl],
  [posty3dManifestRaw, null, posty3dGlbUrl, posty3dThumbUrl],
  [saeta3dManifestRaw, null, saeta3dGlbUrl, saeta3dThumbUrl],
]

const sceneRawById = new Map<string, string>()
const glbUrlById = new Map<string, string>()
const thumbUrlById = new Map<string, string>()
const packages: CharacterModPackage[] = []

for (const [manifestRaw, sceneRaw, glbUrl, thumbUrl] of entries) {
  try {
    const manifest = JSON.parse(manifestRaw) as CharacterModManifest
    if (sceneRaw !== null) sceneRawById.set(manifest.id, sceneRaw)
    if (glbUrl !== null) glbUrlById.set(manifest.id, glbUrl)
    if (thumbUrl !== null) thumbUrlById.set(manifest.id, thumbUrl)
    packages.push({ manifest, revision: BROWSER_BUILTIN_REVISION, origin: 'builtin' })
  } catch {
    // 同梱JSONが壊れていても他キャラの表示は続ける
  }
}

export function browserBuiltinScan(): CharacterModScanResult {
  return { packages: [...packages], issues: [] }
}

export async function browserBuiltinAssetBytes(modId: string, assetKey: string): Promise<Uint8Array> {
  if (assetKey === 'scene') {
    const sceneRaw = sceneRawById.get(modId)
    if (sceneRaw !== undefined) return new TextEncoder().encode(sceneRaw)
  }
  const url = assetKey === 'model' ? glbUrlById.get(modId) : assetKey === 'thumbnail' ? thumbUrlById.get(modId) : undefined
  if (url !== undefined) {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`同梱MODのassetを取得できません: ${response.status}`)
    return new Uint8Array(await response.arrayBuffer())
  }
  throw new Error('ブラウザープレビューで読み込めるのは同梱MODのassetだけです。')
}
