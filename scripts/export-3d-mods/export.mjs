// 既定4キャラの「ふわふわ3D」GLB MODを生成する。
// 旧CourierMascot3D(git履歴)の手続きアニメーションを時間サンプリングして
// glTFアニメーションクリップに焼き込み、mods/<id>-3d/ へ書き出す。
//
// 実行: node scripts/export-3d-mods/export.mjs
//
// 制約(Rustバリデーター): GLB拡張・extras・camera禁止 / accessor≤512 /
// animation channel≤512 / floats≤4M。マテリアルは標準PBRのみ。

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// GLTFExporterがBlob→ArrayBuffer変換にFileReaderを使うため、Node用の最小シム
globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((buffer) => {
      this.result = buffer
      this.onloadend?.()
    })
  }
  readAsDataURL(blob) {
    blob.arrayBuffer().then((buffer) => {
      this.result = 'data:application/octet-stream;base64,' + Buffer.from(buffer).toString('base64')
      this.onloadend?.()
    })
  }
}

const THREE = await import('three')
const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js')
const { MASCOT_IDS, MASCOT_META, IDLE_MOTION_REST, sampleIdleMotion, buildCharacter } = await import('./legacy3d.mjs')

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const FPS = 20
const DURATION = 6.0
const BLEND_SAMPLES = 16 // ループ境界のクロスフェード幅(先頭側を終端の続きへ馴染ませる)
const EPSILON = 1e-4

// pose index → モーション名(=クリップ名)。walk/deliverは既存クリップへ相乗り
const POSE_CLIPS = ['idle', 'look-around', 'alert', 'bounce', 'self-care', 'rest', 'inspect', 'celebrate']
const EXTRA_MOTIONS = { walk: 'idle', deliver: 'bounce' }

const DISPLAY = {
  makko: 'マクコ',
  mio: 'ミオ',
  posty: 'ポスティ',
  saeta: 'サエタ',
}

// 旧render loopのapplyPartMotionと同じ「rest + オフセット」を、時刻tの値として純粋計算する
function sampleTransforms(mascotId, rig, rest, pose, t) {
  const frame = { ...IDLE_MOTION_REST }
  sampleIdleMotion(frame, mascotId, pose, t)

  const breathStrength = mascotId === 'posty' ? 0.004 : pose === 5 ? 0.012 : 0.024
  const breath = 1 + Math.sin(t * 2.05) * breathStrength
  const headDriftStrength = mascotId === 'posty' ? 0.003 : 0.012
  const headDrift = 1 + Math.sin(t * 1.72 + 0.7) * headDriftStrength

  // まばたきはループ周期の高調波にして継ぎ目を作らない(1ループ2回)
  const blinkWave = Math.pow(Math.max(0, Math.sin(((2 * Math.PI * 2) / DURATION) * t - 2.65)), 38)
  const eyeScaleY = Math.max(0.08, (1 - blinkWave * 0.9) * frame.eyeOpen)

  const out = new Map()
  const put = (part, { pitch = 0, yaw = 0, roll = 0, lift = 0, scale = [1, 1, 1] }) => {
    if (!part) return
    const base = rest.get(part)
    const euler = new THREE.Euler(
      base.rotation.x + pitch,
      base.rotation.y + yaw,
      base.rotation.z + roll,
      base.rotation.order,
    )
    out.set(part, {
      position: [base.position.x, base.position.y + lift, base.position.z],
      quaternion: new THREE.Quaternion().setFromEuler(euler).toArray(),
      scale: [base.scale.x * scale[0], base.scale.y * scale[1], base.scale.z * scale[2]],
    })
  }

  put(rig.root, {
    pitch: frame.rootPitch,
    yaw: frame.rootYaw,
    roll: frame.rootRoll,
    lift: frame.rootLift, // rootのrest.position.yは0.04(組み込みと同じ持ち上げ)
  })
  put(rig.body, {
    pitch: frame.bodyPitch,
    yaw: frame.bodyYaw,
    roll: frame.bodyRoll,
    lift: frame.bodyLift,
    scale: [frame.bodyScaleX * (2 - breath), frame.bodyScaleY * breath, frame.bodyScaleZ * breath],
  })
  put(rig.head, {
    pitch: frame.headPitch,
    yaw: frame.headYaw,
    roll: frame.headRoll,
    lift: frame.headLift,
    scale: [headDrift, 2 - headDrift, headDrift],
  })
  put(rig.leftArm, { pitch: frame.leftArmPitch, yaw: frame.leftArmYaw, roll: frame.leftArmRoll, lift: frame.leftArmLift })
  put(rig.rightArm, { pitch: frame.rightArmPitch, yaw: frame.rightArmYaw, roll: frame.rightArmRoll, lift: frame.rightArmLift })
  put(rig.leftFoot, { pitch: frame.leftFootPitch, roll: frame.leftFootRoll })
  put(rig.rightFoot, { pitch: frame.rightFootPitch, roll: frame.rightFootRoll })
  put(rig.leftEar, { pitch: frame.leftEarPitch, roll: frame.leftEarRoll })
  put(rig.rightEar, { pitch: frame.rightEarPitch, roll: frame.rightEarRoll })
  put(rig.tail, { pitch: frame.tailPitch, yaw: frame.tailYaw, roll: frame.tailRoll })
  put(rig.leftWing, { pitch: frame.leftWingPitch, yaw: frame.leftWingYaw, roll: frame.leftWingRoll })
  put(rig.rightWing, { pitch: frame.rightWingPitch, yaw: frame.rightWingYaw, roll: frame.rightWingRoll })
  put(rig.antenna, { pitch: frame.antennaPitch, yaw: frame.antennaYaw, roll: frame.antennaRoll })
  for (const eye of [rig.leftEye, rig.rightEye]) {
    if (!eye) continue
    const base = rest.get(eye)
    out.set(eye, {
      position: [base.position.x, base.position.y, base.position.z],
      quaternion: new THREE.Quaternion().setFromEuler(base.rotation).toArray(),
      scale: [base.scale.x, eyeScaleY, base.scale.z],
    })
  }
  return out
}

// 旧render loopのmorphMeshes(traverse順)と同じ位相ずらしで、時刻tのモーフ重みを返す
function sampleMorphWeights(t, index) {
  const morphBreath = (Math.sin(t * 2.05) * 0.5 + 0.5) * 0.72
  return [
    Math.max(0, morphBreath + Math.sin(t * 1.35 + index * 0.43) * 0.08),
    (Math.sin(t * 0.9 + index * 0.31) * 0.5 + 0.5) * 0.18,
  ]
}

function smoothstep(x) {
  return x * x * (3 - 2 * x)
}

/**
 * サンプル列をシームレスループ化する。
 * 終端の続き(t=DURATION+α)を余分にサンプリングしておき、先頭のBLEND_SAMPLES個を
 * 「終端の続き→本来の値」へクロスフェードする。最終キーは先頭キーと同値に固定。
 */
function loopBlend(samples) {
  const n = samples.length - 1 - BLEND_SAMPLES // 本来のループ長(キー数-1) = FPS*DURATION
  const out = []
  for (let i = 0; i <= n; i += 1) {
    if (i < BLEND_SAMPLES) {
      const w = smoothstep(i / BLEND_SAMPLES)
      const tail = samples[n + i] // t=DURATION+i/FPS の値(終端の続き)
      out.push(samples[i].map((v, c) => tail[c] + (samples[i][c] - tail[c]) * w))
    } else {
      out.push(samples[i])
    }
  }
  out[n] = [...out[0]]
  return out
}

function isConstant(values) {
  return values.every((sample) => sample.every((v, c) => Math.abs(v - values[0][c]) < EPSILON))
}

function equals(a, b) {
  return a.every((v, c) => Math.abs(v - b[c]) < EPSILON)
}

function makeTrack(TrackType, name, values) {
  const n = values.length - 1
  if (isConstant(values)) {
    return new TrackType(name, [0, n / FPS], [...values[0], ...values[0]])
  }
  const times = values.map((_, i) => i / FPS)
  return new TrackType(name, times, values.flat())
}

function bakeClip(mascotId, rig, rest, restState, morphMeshes, pose) {
  // accessor上限(512)対策: もこもこ呼吸モーフはidleとrestにだけ焼き込む。
  // 他ポーズ再生中は直前の重みが保持されるだけで、見た目の破綻はない
  const clipMorphMeshes = pose === 0 || pose === 5 ? morphMeshes : []
  const totalSamples = Math.round(FPS * DURATION) + BLEND_SAMPLES + 1
  const perNode = new Map()
  const perMorph = clipMorphMeshes.map(() => [])

  for (let i = 0; i < totalSamples; i += 1) {
    const t = i / FPS
    const transforms = sampleTransforms(mascotId, rig, rest, pose, t)
    for (const [node, value] of transforms) {
      if (!perNode.has(node)) perNode.set(node, { position: [], quaternion: [], scale: [] })
      const store = perNode.get(node)
      store.position.push(value.position)
      store.quaternion.push(value.quaternion)
      store.scale.push(value.scale)
    }
    clipMorphMeshes.forEach((_, index) => perMorph[index].push(sampleMorphWeights(t, index)))
  }

  const tracks = []
  for (const [node, store] of perNode) {
    const base = restState.get(node)
    for (const [key, TrackType, restValue] of [
      ['position', THREE.VectorKeyframeTrack, base.position],
      ['quaternion', THREE.QuaternionKeyframeTrack, base.quaternion],
      ['scale', THREE.VectorKeyframeTrack, base.scale],
    ]) {
      const values = loopBlend(store[key])
      // 常にrest値のままのトラックは出力しない(accessor/チャンネル節約)
      if (isConstant(values) && equals(values[0], restValue)) continue
      tracks.push(makeTrack(TrackType, `${node.name}.${key}`, values))
    }
  }
  clipMorphMeshes.forEach((mesh, index) => {
    const values = loopBlend(perMorph[index])
    tracks.push(makeTrack(THREE.NumberKeyframeTrack, `${mesh.name}.morphTargetInfluences`, values))
  })

  return new THREE.AnimationClip(POSE_CLIPS[pose], DURATION, tracks)
}

function stripUserData(root) {
  root.traverse((object) => {
    object.userData = {}
    if (object.geometry) object.geometry.userData = {}
    const materials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : []
    materials.forEach((material) => {
      material.userData = {}
    })
  })
}

async function exportGlb(root, clips) {
  const exporter = new GLTFExporter()
  return new Promise((resolve, reject) => {
    exporter.parse(root, resolve, reject, { binary: true, animations: clips })
  })
}

function glbJson(buffer) {
  const view = new DataView(buffer)
  const jsonLength = view.getUint32(12, true)
  return JSON.parse(Buffer.from(buffer, 20, jsonLength).toString('utf8'))
}

// GLTFExporterはモーフ付きメッシュへ自動でextras.targetNamesを書くが、
// アプリのバリデーターはextrasを全拒否する。JSONチャンクから除去して再構築する
function stripExtrasFromGlb(buffer) {
  const view = new DataView(buffer)
  const jsonLength = view.getUint32(12, true)
  const json = JSON.parse(Buffer.from(buffer, 20, jsonLength).toString('utf8'))
  const scrub = (value) => {
    if (Array.isArray(value)) value.forEach(scrub)
    else if (value && typeof value === 'object') {
      delete value.extras
      Object.values(value).forEach(scrub)
    }
  }
  scrub(json)
  let jsonBytes = Buffer.from(JSON.stringify(json), 'utf8')
  const padding = (4 - (jsonBytes.length % 4)) % 4
  if (padding > 0) jsonBytes = Buffer.concat([jsonBytes, Buffer.alloc(padding, 0x20)])
  const rest = Buffer.from(buffer, 20 + jsonLength) // BINチャンク以降(ヘッダー含む)
  const out = Buffer.alloc(20 + jsonBytes.length + rest.length)
  Buffer.from(buffer, 0, 12).copy(out, 0)
  out.writeUInt32LE(out.length, 8) // 全体長
  out.writeUInt32LE(jsonBytes.length, 12)
  out.write('JSON', 16, 'ascii')
  jsonBytes.copy(out, 20)
  rest.copy(out, 20 + jsonBytes.length)
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.length)
}

for (const mascotId of MASCOT_IDS) {
  const rig = buildCharacter(mascotId)
  rig.root.position.y = 0.04 // 組み込みと同じ持ち上げ(rootLiftの基準)

  // モーフ対象は旧実装と同じくtraverse順(位相ずらしのindexを揃える)
  const morphMeshes = []
  rig.root.traverse((object) => {
    if (object.isMesh && object.geometry?.morphAttributes?.position?.length && object.morphTargetInfluences) {
      morphMeshes.push(object)
    }
  })

  // restトランスフォーム(Object3D単位)と、トラック比較用の配列表現
  const rest = new Map()
  const restState = new Map()
  rig.root.traverse(() => {})
  const parts = [
    rig.root, rig.body, rig.head, rig.leftArm, rig.rightArm, rig.leftFoot, rig.rightFoot,
    rig.leftEar, rig.rightEar, rig.tail, rig.leftWing, rig.rightWing, rig.antenna,
    rig.leftEye, rig.rightEye,
  ].filter(Boolean)
  for (const part of parts) {
    rest.set(part, {
      position: part.position.clone(),
      rotation: part.rotation.clone(),
      scale: part.scale.clone(),
    })
    restState.set(part, {
      position: part.position.toArray(),
      quaternion: part.quaternion.toArray(),
      scale: part.scale.toArray(),
    })
  }

  const clips = []
  for (let pose = 0; pose < POSE_CLIPS.length; pose += 1) {
    clips.push(bakeClip(mascotId, rig, rest, restState, morphMeshes, pose))
  }

  stripUserData(rig.root)
  const buffer = stripExtrasFromGlb(await exportGlb(rig.root, clips))

  // バリデーター禁止事項の事前チェック(extensions/extras/camera)
  const json = glbJson(buffer)
  const flat = JSON.stringify(json)
  for (const banned of ['"extensionsUsed"', '"extensionsRequired"', '"extensions"', '"extras"', '"cameras"']) {
    if (flat.includes(banned)) throw new Error(`${mascotId}: GLBに禁止キーが含まれています: ${banned}`)
  }
  const channels = (json.animations ?? []).reduce((sum, a) => sum + a.channels.length, 0)
  const accessors = (json.accessors ?? []).length
  if (accessors > 512) throw new Error(`${mascotId}: accessorが多すぎます (${accessors})`)
  if (channels > 512) throw new Error(`${mascotId}: animation channelが多すぎます (${channels})`)

  const modDir = join(repoRoot, 'mods', `${mascotId}-3d`)
  mkdirSync(join(modDir, 'assets'), { recursive: true })
  writeFileSync(join(modDir, 'assets', 'character.glb'), Buffer.from(buffer))

  const motions = {}
  POSE_CLIPS.forEach((clip) => {
    motions[clip] = { clip }
  })
  Object.entries(EXTRA_MOTIONS).forEach(([motion, clip]) => {
    motions[motion] = { clip }
  })

  const manifest = {
    schemaVersion: 1,
    id: `firemio.${mascotId}-3d`,
    name: `${DISPLAY[mascotId]}（3D）`,
    version: '1.0.0',
    author: 'firemio',
    description: `ふわふわ3D(WebGL)の${DISPLAY[mascotId]}をGLB MODとして再構成した同梱キャラクター`,
    license: 'MIT',
    behaviorProfile: mascotId,
    renderer: 'gltf-3d',
    // ブラウザ実描画のキャプチャから生成(再生成時は既存ファイルをそのまま使う)
    thumbnail: 'thumbnail.webp',
    source: {
      type: 'model',
      file: 'assets/character.glb',
      scale: 1,
      groundOffset: 0,
      rotationY: 0,
      motions,
    },
  }
  writeFileSync(join(modDir, 'character.json'), JSON.stringify(manifest, null, 2) + '\n')

  console.log(
    `OK ${mascotId}: glb=${(buffer.byteLength / 1024).toFixed(0)}KB accessors=${accessors} channels=${channels} morphMeshes=${morphMeshes.length}`,
  )
}
console.log('ALL DONE')
