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
export type BuiltinCharacterRenderer = 'classic-2d' | 'soft-3d'
export type CharacterModRenderer = 'sprite-2d' | 'gltf-3d'

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

export type CharacterModManifest = SpriteCharacterModManifest | GltfCharacterModManifest

export interface CharacterModPackage {
  manifest: CharacterModManifest
  revision: string
}

export interface CharacterModIssue {
  folder: string
  message: string
}

export interface CharacterModScanResult {
  packages: CharacterModPackage[]
  issues: CharacterModIssue[]
}

export function motionForPose(pose = 0): CharacterMotion {
  const index = Math.max(0, Math.min(POSE_MOTIONS.length - 1, Math.trunc(pose)))
  return POSE_MOTIONS[index]
}

