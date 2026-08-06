import type { MascotId } from '../data/mascots'

export const CHARACTER_MOTIONS = [
  'idle',
  'look-around',
  'alert',
  'bounce',
  'self-care',
  'rest',
  'inspect',
  'celebrate',
  'walk',
  'deliver',
] as const

export type CharacterMotion = (typeof CHARACTER_MOTIONS)[number]
export type CharacterModRenderer = 'sprite-2d' | 'gltf-3d' | 'dom-svg'
/** builtin=アプリ同梱（読み取り専用・既定4キャラ）、user=ユーザー導入 */
export type CharacterModOrigin = 'builtin' | 'user'

/** 既定キャラの見た目を担う同梱MOD。ユーザーが同idのMODを導入すると差し替わる */
export const DEFAULT_MOD_ID_BY_MASCOT: Record<MascotId, string> = {
  makko: 'firemio.makko-svg',
  mio: 'firemio.mio-svg',
  posty: 'firemio.posty-svg',
  saeta: 'firemio.saeta-svg',
}
export type DomSvgExpression = 'normal' | 'sleepy' | 'happy' | 'sad'

export const POSE_MOTIONS: readonly CharacterMotion[] = [
  'idle',
  'look-around',
  'alert',
  'bounce',
  'self-care',
  'rest',
  'inspect',
  'celebrate',
]

export interface SpriteSheetMotion {
  frames: number[]
  fps: number
  loop: boolean
}

export interface SpriteSequenceMotion {
  files: string[]
  fps: number
  loop: boolean
}

export interface GltfMotion {
  clip: string
  loop: boolean
}

export interface SpriteSheetSource {
  type: 'sheet'
  file: string
  frameWidth: number
  frameHeight: number
  columns: number
  rows?: number
  imageRendering?: 'auto' | 'pixelated'
  motions: Partial<Record<CharacterMotion, SpriteSheetMotion>>
}

export interface SpriteSequenceSource {
  type: 'sequence'
  motions: Partial<Record<CharacterMotion, SpriteSequenceMotion>>
}

export interface GltfModelSource {
  type: 'model'
  file: string
  scale?: number
  groundOffset?: number
  rotationY?: number
  motions: Partial<Record<CharacterMotion, GltfMotion>>
}

export interface DomSvgTransform {
  rotate?: number
  rotateX?: number
  rotateY?: number
  translateX?: number
  translateY?: number
  scale?: number
  scaleX?: number
  scaleY?: number
}

export interface DomSvgMotion {
  pose?: DomSvgTransform
  /** モデル全体に掛けるアニメーション。spriteのframes、gltfのclipに相当する */
  poseAnimation?: string
  poseOrigin?: [number, number]
  animations?: string[]
  expression?: DomSvgExpression
  loop: boolean
}

export interface DomSvgSceneSource {
  type: 'scene'
  file: string
  motions: Partial<Record<CharacterMotion, DomSvgMotion>>
}

interface CharacterModManifestBase {
  schemaVersion: 1
  id: string
  name: string
  version: string
  author: string
  description: string
  license?: string | null
  behaviorProfile: MascotId
  thumbnail?: string | null
}

export interface SpriteCharacterModManifest extends CharacterModManifestBase {
  renderer: 'sprite-2d'
  source: SpriteSheetSource | SpriteSequenceSource
}

export interface GltfCharacterModManifest extends CharacterModManifestBase {
  renderer: 'gltf-3d'
  source: GltfModelSource
}

export interface DomSvgCharacterModManifest extends CharacterModManifestBase {
  renderer: 'dom-svg'
  source: DomSvgSceneSource
}

export type CharacterModManifest =
  | SpriteCharacterModManifest
  | GltfCharacterModManifest
  | DomSvgCharacterModManifest

export interface CharacterModPackage {
  manifest: CharacterModManifest
  revision: string
  origin: CharacterModOrigin
}

export interface CharacterModIssue {
  folder: string
  message: string
}

export interface CharacterModScanResult {
  packages: CharacterModPackage[]
  issues: CharacterModIssue[]
}

export interface CharacterModInstallResult {
  installedId: string
  installedName: string
  replaced: boolean
  scan: CharacterModScanResult
}

export function motionForPose(pose = 0): CharacterMotion {
  const index = Math.max(0, Math.min(POSE_MOTIONS.length - 1, Math.trunc(pose)))
  return POSE_MOTIONS[index]
}

