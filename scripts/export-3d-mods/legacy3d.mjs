// MioMail 旧3Dマスコット (CourierMascot3D.old.tsx) の手続き生成ロジックを
// Node/ESM 向けに移植したモジュール。
// - 座標・スケール・色・角度・セグメント数は原本から変更していない。
// - 例外はマテリアルのみ: GLTFExporter が MeshPhysicalMaterial の sheen/clearcoat を
//   KHR 拡張として出力し、アプリ側バリデーターが GLB 拡張を全拒否するため、
//   MeshStandardMaterial へ変換している(MeshBasicMaterial は emissive 同色の Standard へ)。
// - アニメーショントラックが名前でバインドされるため、各パーツと
//   モーフターゲットを持つメッシュには一意な .name を付与する。

import * as THREE from 'three'

export const MASCOT_IDS = ['makko', 'mio', 'posty', 'saeta']

// src/renderer/data/mascots.ts の getMascotMeta 相当(4体分をプレーンオブジェクト化)。
export const MASCOT_META = {
  makko: {
    id: 'makko',
    accent: '#ff8fb3',
    accentSoft: '#ffe0eb',
    accentStrong: '#f76a99',
    bodyTop: '#ffd9e6',
    bodyBottom: '#ffb3cd',
    eyeColor: '#6b4249',
    accessoryColor: '#ff8fb3',
    model: 'bear',
  },
  mio: {
    id: 'mio',
    accent: '#f4a7b9',
    accentSoft: '#f8dfe5',
    accentStrong: '#d97f94',
    bodyTop: '#fffaf5',
    bodyBottom: '#eee4de',
    eyeColor: '#26252b',
    accessoryColor: '#f4a7b9',
    marking: '#aaa6aa',
    markingSoft: '#cbc5c4',
    markingStrong: '#77767d',
    model: 'cat',
  },
  posty: {
    id: 'posty',
    accent: '#5b8bef',
    accentSoft: '#dbe7ff',
    accentStrong: '#3a63d8',
    bodyTop: '#b9d2f9',
    bodyBottom: '#7ca4ee',
    eyeColor: '#ffd166',
    accessoryColor: '#5b8bef',
    model: 'robot',
  },
  saeta: {
    id: 'saeta',
    accent: '#5ec97a',
    accentSoft: '#dff5e2',
    accentStrong: '#3aa85c',
    bodyTop: '#c9efc9',
    bodyBottom: '#8fd894',
    eyeColor: '#33503a',
    accessoryColor: '#ffb347',
    model: 'bird',
  },
}

export const IDLE_MOTION_REST = {
  rootPitch: 0,
  rootYaw: 0,
  rootRoll: 0,
  rootLift: 0,
  headPitch: 0,
  headYaw: 0,
  headRoll: 0,
  headLift: 0,
  bodyPitch: 0,
  bodyYaw: 0,
  bodyRoll: 0,
  bodyLift: 0,
  bodyScaleX: 1,
  bodyScaleY: 1,
  bodyScaleZ: 1,
  leftArmPitch: 0,
  leftArmYaw: 0,
  leftArmRoll: 0,
  leftArmLift: 0,
  rightArmPitch: 0,
  rightArmYaw: 0,
  rightArmRoll: 0,
  rightArmLift: 0,
  leftFootPitch: 0,
  leftFootRoll: 0,
  rightFootPitch: 0,
  rightFootRoll: 0,
  leftEarPitch: 0,
  leftEarRoll: 0,
  rightEarPitch: 0,
  rightEarRoll: 0,
  tailPitch: 0,
  tailYaw: 0,
  tailRoll: 0,
  leftWingPitch: 0,
  leftWingYaw: 0,
  leftWingRoll: 0,
  rightWingPitch: 0,
  rightWingYaw: 0,
  rightWingRoll: 0,
  antennaPitch: 0,
  antennaYaw: 0,
  antennaRoll: 0,
  eyeOpen: 1,
}

function positiveBounce(value) {
  return Math.pow(Math.max(0, value), 2)
}

function applySlowLook(frame, elapsed) {
  const look = Math.sin(elapsed * 0.72)
  frame.rootYaw = look * Math.PI * 0.2
  frame.headYaw = look * Math.PI * 0.05
  frame.rootLift = Math.sin(elapsed * 1.05) * 0.012
}

export function sampleIdleMotion(frame, mascotId, pose, elapsed) {
  Object.assign(frame, IDLE_MOTION_REST)
  const slow = Math.sin(elapsed * 0.82)
  const medium = Math.sin(elapsed * 1.55)

  if (mascotId === 'makko') {
    if (pose === 0) {
      frame.rootRoll = slow * 0.045
      frame.rootLift = Math.sin(elapsed * 1.25) * 0.025
      frame.headRoll = -slow * 0.025
      frame.leftArmRoll = medium * 0.05
      frame.rightArmRoll = -medium * 0.05
      frame.leftEarRoll = medium * 0.055
      frame.rightEarRoll = -Math.sin(elapsed * 1.55 + 0.35) * 0.055
    } else if (pose === 1) {
      applySlowLook(frame, elapsed)
      frame.leftEarRoll = Math.sin(elapsed * 0.72 + 0.3) * 0.08
      frame.rightEarRoll = -Math.sin(elapsed * 0.72 + 0.55) * 0.08
    } else if (pose === 2) {
      const brace = 0.82 + Math.sin(elapsed * 1.15) * 0.08
      frame.rootLift = -0.055
      frame.rootPitch = 0.08
      frame.bodyLift = -0.045
      frame.bodyScaleX = 1.08
      frame.bodyScaleY = 0.9
      frame.bodyScaleZ = 1.04
      frame.headLift = -0.055
      frame.headPitch = 0.12
      frame.leftArmRoll = 1.15 * brace
      frame.rightArmRoll = -1.15 * brace
      frame.leftArmPitch = -0.22
      frame.rightArmPitch = -0.22
      frame.leftEarRoll = 0.12
      frame.rightEarRoll = -0.12
    } else if (pose === 3) {
      const hop = positiveBounce(Math.sin(elapsed * 2.2))
      frame.rootLift = hop * 0.16
      frame.bodyScaleX = 1 - hop * 0.06
      frame.bodyScaleY = 1 + hop * 0.1
      frame.bodyScaleZ = 1 - hop * 0.04
      frame.leftArmRoll = -hop * 0.18
      frame.rightArmRoll = hop * 0.18
      frame.leftEarRoll = -hop * 0.12
      frame.rightEarRoll = hop * 0.12
    } else if (pose === 4) {
      const stretch = 0.5 + Math.sin(elapsed * 0.9) * 0.5
      frame.rootLift = stretch * 0.045
      frame.bodyLift = stretch * 0.06
      frame.bodyScaleX = 1 - stretch * 0.08
      frame.bodyScaleY = 1 + stretch * 0.18
      frame.bodyScaleZ = 1 - stretch * 0.05
      frame.headLift = stretch * 0.13
      frame.leftArmLift = stretch * 0.17
      frame.rightArmLift = stretch * 0.17
      frame.leftArmRoll = -stretch * 1.75
      frame.rightArmRoll = stretch * 1.75
      frame.headPitch = -stretch * 0.08
    } else if (pose === 5) {
      frame.rootLift = -0.055
      frame.rootRoll = 0.075
      frame.bodyScaleY = 0.96
      frame.headLift = -0.075
      frame.headRoll = 0.18 + Math.sin(elapsed * 0.45) * 0.018
      frame.leftArmRoll = 0.2
      frame.rightArmRoll = -0.12
      frame.leftEarRoll = 0.12
      frame.rightEarRoll = -0.04
      frame.eyeOpen = 0.08
    } else if (pose === 6) {
      const glance = Math.tanh(Math.sin(elapsed * 1.9) * 4)
      frame.headYaw = glance * 0.58
      frame.rootYaw = glance * 0.07
      frame.headRoll = Math.sin(elapsed * 3.8) * 0.025
      frame.leftEarRoll = Math.sin(elapsed * 3.8 + 0.4) * 0.13
      frame.rightEarRoll = -Math.sin(elapsed * 3.8 + 0.8) * 0.13
    } else {
      const jump = positiveBounce(Math.sin(elapsed * 2.45))
      frame.rootLift = jump * 0.24
      frame.bodyScaleX = 1 + (1 - jump) * 0.03 - jump * 0.07
      frame.bodyScaleY = 0.97 + jump * 0.14
      frame.leftArmLift = jump * 0.08
      frame.rightArmLift = jump * 0.08
      frame.leftArmRoll = -jump * 1.85
      frame.rightArmRoll = jump * 1.85
      frame.leftEarRoll = -jump * 0.2
      frame.rightEarRoll = jump * 0.2
    }
  } else if (mascotId === 'mio') {
    if (pose === 0) {
      frame.rootRoll = slow * 0.032
      frame.rootLift = Math.sin(elapsed * 1.18) * 0.022
      frame.headRoll = -slow * 0.018
      frame.tailRoll = Math.sin(elapsed * 1.25) * 0.3
      frame.tailYaw = Math.sin(elapsed * 0.72 + 0.5) * 0.09
      frame.leftEarRoll = medium * 0.055
      frame.rightEarRoll = -Math.sin(elapsed * 1.55 + 0.4) * 0.055
    } else if (pose === 1) {
      applySlowLook(frame, elapsed)
      frame.tailRoll = -Math.sin(elapsed * 0.72) * 0.2
    } else if (pose === 2) {
      frame.rootLift = Math.sin(elapsed * 1.05) * 0.012
      frame.tailRoll = Math.sin(elapsed * 1.65) * 0.62
      frame.tailYaw = Math.sin(elapsed * 1.05 + 0.8) * 0.16
      frame.headYaw = Math.sin(elapsed * 0.82) * 0.16
      frame.leftEarRoll = Math.sin(elapsed * 1.65 + 0.3) * 0.1
      frame.rightEarRoll = -Math.sin(elapsed * 1.65 + 0.7) * 0.1
    } else if (pose === 3) {
      const hop = positiveBounce(Math.sin(elapsed * 2.12))
      frame.rootLift = hop * 0.14
      frame.bodyScaleX = 1 - hop * 0.055
      frame.bodyScaleY = 1 + hop * 0.09
      frame.tailRoll = -hop * 0.38
      frame.leftArmRoll = -hop * 0.14
      frame.rightArmRoll = hop * 0.14
    } else if (pose === 4) {
      const groom = 0.5 + Math.sin(elapsed * 2.2) * 0.5
      frame.rootRoll = -0.04
      frame.headYaw = -0.2
      frame.headPitch = 0.13
      frame.headRoll = -0.14
      frame.leftArmLift = 0.28 + groom * 0.035
      frame.leftArmPitch = -0.28
      frame.leftArmRoll = 1.92 + groom * 0.16
      frame.rightArmRoll = 0.08
      frame.tailRoll = Math.sin(elapsed * 1.18) * 0.34
      frame.eyeOpen = 0.82
    } else if (pose === 5) {
      frame.rootLift = -0.05
      frame.rootRoll = -0.055
      frame.bodyScaleY = 0.96
      frame.headLift = -0.09
      frame.headPitch = 0.12
      frame.headRoll = -0.17
      frame.tailRoll = -0.45 + Math.sin(elapsed * 0.5) * 0.04
      frame.leftEarRoll = 0.11
      frame.rightEarRoll = -0.06
      frame.eyeOpen = 0.08
    } else if (pose === 6) {
      const glance = Math.tanh(Math.sin(elapsed * 2) * 4.2)
      frame.headYaw = glance * 0.62
      frame.rootYaw = glance * 0.055
      frame.leftEarRoll = Math.sin(elapsed * 4.1) * 0.14
      frame.rightEarRoll = -Math.sin(elapsed * 4.1 + 0.7) * 0.14
      frame.tailRoll = -glance * 0.22
    } else {
      frame.rootLift = -0.075
      frame.rootPitch = 0.14
      frame.bodyLift = -0.04
      frame.bodyScaleX = 1.12
      frame.bodyScaleY = 0.86
      frame.bodyScaleZ = 1.05
      frame.headLift = -0.1
      frame.headPitch = 0.2
      frame.leftArmPitch = -0.32
      frame.rightArmPitch = -0.32
      frame.leftArmRoll = 0.42
      frame.rightArmRoll = -0.42
      frame.leftFootPitch = 0.18
      frame.rightFootPitch = 0.18
      frame.tailRoll = Math.sin(elapsed * 5.2) * 0.48
      frame.leftEarRoll = 0.12
      frame.rightEarRoll = -0.12
    }
  } else if (mascotId === 'posty') {
    if (pose === 0) {
      frame.rootLift = Math.abs(Math.sin(elapsed * 1.35)) * 0.012
      frame.bodyRoll = Math.sin(elapsed * 2.8) * 0.012
      frame.leftArmRoll = Math.sin(elapsed * 1.2) * 0.035
      frame.rightArmRoll = -Math.sin(elapsed * 1.2) * 0.035
      frame.antennaRoll = Math.sin(elapsed * 1.1) * 0.04
    } else if (pose === 1) {
      applySlowLook(frame, elapsed)
    } else if (pose === 2) {
      const diagnostic = Math.sin(elapsed * 2.35)
      frame.headYaw = diagnostic * 0.34
      frame.headPitch = Math.sin(elapsed * 1.15) * 0.08
      frame.bodyRoll = Math.tanh(diagnostic * 3) * 0.018
      frame.leftArmRoll = Math.max(0, diagnostic) * 0.42
      frame.rightArmRoll = Math.min(0, diagnostic) * 0.42
      frame.antennaYaw = diagnostic * 0.45
      frame.antennaRoll = diagnostic * 0.12
      frame.eyeOpen = 0.74 + Math.sin(elapsed * 4.7) * 0.2
    } else if (pose === 3) {
      const hop = positiveBounce(Math.sin(elapsed * 2.35))
      frame.rootLift = hop * 0.13
      frame.bodyScaleX = 1 - hop * 0.04
      frame.bodyScaleY = 1 + hop * 0.07
      frame.leftFootPitch = hop * 0.18
      frame.rightFootPitch = hop * 0.18
      frame.leftArmRoll = hop * 0.15
      frame.rightArmRoll = -hop * 0.15
      frame.antennaRoll = -hop * 0.24
    } else if (pose === 4) {
      frame.headYaw = Math.sin(elapsed * 0.92) * 0.72
      frame.rootYaw = Math.sin(elapsed * 0.92) * 0.06
      frame.antennaYaw = Math.sin(elapsed * 2.8) * 0.55
      frame.antennaRoll = Math.cos(elapsed * 2.8) * 0.12
      frame.eyeOpen = 0.88 + Math.sin(elapsed * 5.4) * 0.1
    } else if (pose === 5) {
      frame.rootLift = -0.065
      frame.bodyScaleY = 0.98
      frame.headLift = -0.055
      frame.headPitch = 0.22
      frame.leftArmRoll = 0.16
      frame.rightArmRoll = -0.16
      frame.antennaRoll = Math.sin(elapsed * 1.1) * 0.05
      frame.eyeOpen = 0.24 + (Math.sin(elapsed * 1.2) * 0.5 + 0.5) * 0.12
    } else if (pose === 6) {
      const cycle = elapsed % 3.2
      if (cycle < 0.75) {
        frame.rootLift = -0.06
        frame.headPitch = 0.22
        frame.eyeOpen = 0.06
      } else if (cycle < 1.05) {
        const rebootJump = Math.sin(((cycle - 0.75) / 0.3) * Math.PI)
        frame.rootLift = rebootJump * 0.17
        frame.rootRoll = Math.sin((cycle - 0.75) * 50) * 0.06 * (1 - rebootJump)
        frame.antennaYaw = Math.sin((cycle - 0.75) * 18) * 0.62
        frame.eyeOpen = 0.4 + rebootJump * 0.6
      } else {
        const settle = Math.exp(-(cycle - 1.05) * 2.2)
        frame.rootRoll = Math.sin((cycle - 1.05) * 20) * 0.055 * settle
        frame.antennaYaw = Math.sin((cycle - 0.75) * 14) * 0.38 * settle
        frame.eyeOpen = 1
      }
    } else {
      frame.rootRoll = -0.025
      frame.headRoll = -0.08
      frame.rightArmLift = 0.08
      frame.rightArmPitch = -0.12
      frame.rightArmRoll = -2.55
      frame.leftArmRoll = 0.04
      frame.antennaRoll = -0.055
    }
  } else {
    if (pose === 0) {
      frame.rootLift = Math.sin(elapsed * 1.05) * 0.01
      frame.headRoll = slow * 0.04
      frame.leftWingRoll = Math.sin(elapsed * 0.9) * 0.035
      frame.rightWingRoll = -Math.sin(elapsed * 0.9 + 0.25) * 0.035
      frame.leftFootPitch = Math.sin(elapsed * 1.1) * 0.025
      frame.rightFootPitch = -Math.sin(elapsed * 1.1) * 0.025
    } else if (pose === 1) {
      applySlowLook(frame, elapsed)
    } else if (pose === 2) {
      frame.rootLift = -0.07
      frame.rootPitch = 0.14
      frame.bodyScaleX = 1.08
      frame.bodyScaleY = 0.91
      frame.headPitch = 0.1
      frame.leftWingRoll = -0.42 + Math.sin(elapsed * 1.1) * 0.05
      frame.rightWingRoll = 0.42 - Math.sin(elapsed * 1.1) * 0.05
      frame.leftFootPitch = 0.18
      frame.rightFootPitch = 0.18
    } else if (pose === 3) {
      const prepare = Math.sin(elapsed * 2.4)
      frame.rootLift = Math.abs(prepare) * 0.035
      frame.leftWingRoll = -0.34 - prepare * 0.24
      frame.rightWingRoll = 0.34 + prepare * 0.24
      frame.bodyScaleY = 1 + Math.abs(prepare) * 0.025
    } else if (pose === 4) {
      const preen = Math.sin(elapsed * 2.8)
      frame.headYaw = -0.48
      frame.headPitch = 0.18
      frame.headRoll = -0.24 + preen * 0.04
      frame.headLift = -0.045
      frame.leftWingPitch = -0.22
      frame.leftWingRoll = 0.58 + preen * 0.12
      frame.rightWingRoll = 0.08
      frame.eyeOpen = 0.78
    } else if (pose === 5) {
      frame.rootLift = -0.055
      frame.bodyScaleY = 0.97
      frame.headLift = -0.095
      frame.headPitch = 0.16
      frame.headRoll = 0.18
      frame.leftWingRoll = 0.13
      frame.rightWingRoll = -0.13
      frame.eyeOpen = 0.08
    } else if (pose === 6) {
      const flap = Math.sin(elapsed * 8.5)
      frame.rootLift = 0.1 + Math.sin(elapsed * 2.9) * 0.06
      frame.leftWingRoll = -flap * 0.56
      frame.rightWingRoll = flap * 0.56
      frame.leftWingPitch = Math.cos(elapsed * 8.5) * 0.16
      frame.rightWingPitch = -Math.cos(elapsed * 8.5) * 0.16
      frame.leftFootPitch = 0.45
      frame.rightFootPitch = 0.45
    } else {
      frame.headRoll = Math.sin(elapsed * 0.88) * 0.3
      frame.headYaw = Math.sin(elapsed * 0.44) * 0.14
      frame.leftWingRoll = Math.sin(elapsed * 0.88 + 0.3) * 0.04
      frame.rightWingRoll = -Math.sin(elapsed * 0.88 + 0.5) * 0.04
    }
  }

  return frame
}

function fluffyGeometry(seed) {
  const geometry = new THREE.SphereGeometry(0.5, 48, 32)
  const positions = geometry.attributes.position
  const vertex = new THREE.Vector3()
  const breathTarget = new Float32Array(positions.count * 3)
  const swayTarget = new Float32Array(positions.count * 3)
  for (let index = 0; index < positions.count; index += 1) {
    vertex.fromBufferAttribute(positions, index)
    const ripple =
      Math.sin(vertex.x * 23 + seed) *
      Math.sin(vertex.y * 19 - seed * 0.7) *
      Math.sin(vertex.z * 17 + seed * 1.3)
    vertex.normalize().multiplyScalar(0.5 * (1 + ripple * 0.009))
    positions.setXYZ(index, vertex.x, vertex.y, vertex.z)
    const softness = 1 - Math.min(1, Math.abs(vertex.y) * 1.35)
    breathTarget[index * 3] = vertex.x * (1 + 0.035 * softness)
    breathTarget[index * 3 + 1] = vertex.y * 1.045
    breathTarget[index * 3 + 2] = vertex.z * (1 + 0.055 * softness)
    const sway = Math.sin((vertex.y + 0.5) * Math.PI) * 0.028
    swayTarget[index * 3] = vertex.x + sway
    swayTarget[index * 3 + 1] = vertex.y * (1 - sway * 0.18)
    swayTarget[index * 3 + 2] = vertex.z
  }
  geometry.morphAttributes.position = [
    new THREE.Float32BufferAttribute(breathTarget, 3),
    new THREE.Float32BufferAttribute(swayTarget, 3),
  ]
  geometry.userData.fluffy = true
  geometry.computeVertexNormals()
  return geometry
}

// 原本は MeshPhysicalMaterial(sheen/clearcoat 付き)。GLB 拡張回避のため Standard 化。
// sheenColor 引数は呼び出し側の互換のため残すが使用しない。
function softMaterial(color, _sheenColor = '#ffffff') {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.82,
    metalness: 0,
  })
}

// 原本は clearcoat 付き MeshPhysicalMaterial。GLB 拡張回避のため Standard 化。
function glossyMaterial(color) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.18,
    metalness: 0.05,
  })
}

// 目のハイライト等。原本の MeshBasicMaterial 相当(照明非依存の白)を
// emissive 同色の Standard で再現する。
function highlightMaterial() {
  return new THREE.MeshStandardMaterial({
    color: '#ffffff',
    emissive: '#ffffff',
    roughness: 1,
  })
}

function mesh(geometry, material, position, scale, rotation = [0, 0, 0]) {
  const result = new THREE.Mesh(geometry, material)
  result.position.set(...position)
  result.scale.set(...scale)
  result.rotation.set(...rotation)
  result.castShadow = true
  result.receiveShadow = true
  return result
}

function extrudedShapeGeometry(points, depth = 0.12, bevelSize = 0.035) {
  const shape = new THREE.Shape()
  points.forEach(([x, y], index) => {
    if (index === 0) shape.moveTo(x, y)
    else shape.lineTo(x, y)
  })
  shape.closePath()
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSegments: 3,
    bevelSize,
    bevelThickness: bevelSize,
    curveSegments: 8,
  })
  geometry.center()
  return geometry
}

function makeRod(start, end, radius, color) {
  const from = new THREE.Vector3(...start)
  const to = new THREE.Vector3(...end)
  const direction = to.clone().sub(from)
  const result = mesh(
    new THREE.CylinderGeometry(radius, radius, direction.length(), 10),
    softMaterial(color),
    [0, 0, 0],
    [1, 1, 1]
  )
  result.position.copy(from.clone().add(to).multiplyScalar(0.5))
  result.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize())
  result.castShadow = false
  return result
}

function makeArc(start, control, end, color, radius = 0.012) {
  const curve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(...start),
    new THREE.Vector3(...control),
    new THREE.Vector3(...end)
  )
  const result = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 18, radius, 8, false),
    softMaterial(color)
  )
  result.castShadow = false
  return result
}

function makeCharacterEye(color, position, scale, doubleGlint = false) {
  const group = new THREE.Group()
  group.position.set(...position)
  group.add(mesh(new THREE.SphereGeometry(0.5, 28, 20), glossyMaterial(color), [0, 0, 0], scale))
  group.add(
    mesh(
      new THREE.SphereGeometry(0.5, 12, 8),
      highlightMaterial(),
      [-scale[0] * 0.2, scale[1] * 0.24, scale[2] * 0.62],
      [scale[0] * 0.28, scale[0] * 0.32, scale[2] * 0.2]
    )
  )
  if (doubleGlint) {
    group.add(
      mesh(
        new THREE.SphereGeometry(0.5, 10, 8),
        highlightMaterial(),
        [scale[0] * 0.2, -scale[1] * 0.2, scale[2] * 0.64],
        [scale[0] * 0.15, scale[0] * 0.15, scale[2] * 0.14]
      )
    )
  }
  return group
}

function makeDiamond(color, position, scale = 0.11) {
  const result = mesh(
    new THREE.OctahedronGeometry(0.5, 0),
    glossyMaterial(color),
    position,
    [scale, scale * 1.25, scale * 0.65]
  )
  result.castShadow = false
  return result
}

function makeEye(color, x, y, z) {
  const eye = mesh(
    new THREE.SphereGeometry(0.5, 24, 18),
    glossyMaterial(color),
    [x, y, z],
    [0.15, 0.19, 0.09]
  )
  const glint = mesh(
    new THREE.SphereGeometry(0.5, 12, 8),
    highlightMaterial(),
    [x - 0.035, y + 0.055, z + 0.052],
    [0.042, 0.052, 0.022]
  )
  const group = new THREE.Group()
  group.add(eye, glint)
  return group
}

function addFace(head, eyeColor, accent, options = {}) {
  const eyeY = options.eyeY ?? 0.08
  const eyeX = options.eyeX ?? 0.27
  const eyeZ = options.eyeZ ?? 0.46
  const leftEye = makeEye(eyeColor, -eyeX, eyeY, eyeZ)
  const rightEye = makeEye(eyeColor, eyeX, eyeY, eyeZ)
  head.add(leftEye, rightEye)
  if (options.muzzle !== false) {
    head.add(mesh(fluffyGeometry(51), softMaterial('#fff7f2'), [0, -0.18, 0.45], [0.35, 0.23, 0.18]))
  }
  head.add(mesh(new THREE.SphereGeometry(0.5, 20, 14), glossyMaterial(accent), [0, -0.12, 0.59], [0.09, 0.065, 0.055]))
  head.add(mesh(new THREE.SphereGeometry(0.5, 16, 12), softMaterial(accent), [-0.43, -0.16, 0.38], [0.15, 0.075, 0.045]))
  head.add(mesh(new THREE.SphereGeometry(0.5, 16, 12), softMaterial(accent), [0.43, -0.16, 0.38], [0.15, 0.075, 0.045]))
  return { leftEye, rightEye }
}

function buildBear(meta) {
  const root = new THREE.Group()
  const body = new THREE.Group()
  const head = new THREE.Group()
  const fur = softMaterial(meta.bodyTop, '#ffffff')
  const lowerFur = softMaterial(meta.bodyBottom, meta.accentSoft)
  const innerEar = softMaterial(meta.accentSoft, '#ffffff')
  const cream = softMaterial('#fff7f7', '#ffffff')

  body.position.y = -0.4
  body.add(mesh(fluffyGeometry(41), lowerFur, [0, 0, 0], [0.92, 0.92, 0.72]))
  body.add(mesh(fluffyGeometry(42), innerEar, [0, -0.01, 0.38], [0.48, 0.54, 0.1]))
  body.add(makeRod([-0.06, 0.03, 0.445], [0.06, -0.09, 0.445], 0.012, meta.accentStrong))
  body.add(makeRod([0.06, 0.03, 0.447], [-0.06, -0.09, 0.447], 0.012, meta.accentStrong))

  head.position.y = 0.43
  head.add(mesh(fluffyGeometry(43), fur, [0, 0, 0], [1.18, 0.98, 0.86]))

  const leftEar = new THREE.Group()
  leftEar.position.set(-0.49, 0.38, -0.02)
  leftEar.add(mesh(fluffyGeometry(44), lowerFur, [0, 0.03, 0], [0.38, 0.38, 0.3]))
  leftEar.add(mesh(fluffyGeometry(45), innerEar, [0, 0.03, 0.16], [0.21, 0.21, 0.08]))
  const rightEar = new THREE.Group()
  rightEar.position.set(0.49, 0.38, -0.02)
  rightEar.add(mesh(fluffyGeometry(46), lowerFur, [0, 0.03, 0], [0.38, 0.38, 0.3]))
  rightEar.add(mesh(fluffyGeometry(47), innerEar, [0, 0.03, 0.16], [0.21, 0.21, 0.08]))
  head.add(leftEar, rightEar)

  const leftEye = makeCharacterEye(meta.eyeColor, [-0.31, 0.09, 0.44], [0.13, 0.16, 0.075])
  const rightEye = makeCharacterEye(meta.eyeColor, [0.31, 0.09, 0.44], [0.13, 0.16, 0.075])
  head.add(leftEye, rightEye)
  head.add(mesh(fluffyGeometry(48), cream, [0, -0.16, 0.43], [0.39, 0.25, 0.15]))
  head.add(mesh(new THREE.SphereGeometry(0.5, 24, 16), glossyMaterial(meta.eyeColor), [0, -0.12, 0.55], [0.12, 0.085, 0.065]))
  head.add(makeRod([0, -0.16, 0.595], [0, -0.24, 0.595], 0.012, meta.eyeColor))
  head.add(makeArc([0, -0.235, 0.595], [-0.075, -0.31, 0.595], [-0.16, -0.26, 0.58], meta.eyeColor, 0.013))
  head.add(makeArc([0, -0.235, 0.595], [0.075, -0.31, 0.595], [0.16, -0.26, 0.58], meta.eyeColor, 0.013))
  head.add(mesh(new THREE.SphereGeometry(0.5, 18, 12), softMaterial(meta.accent), [-0.46, -0.14, 0.39], [0.16, 0.075, 0.05]))
  head.add(mesh(new THREE.SphereGeometry(0.5, 18, 12), softMaterial(meta.accent), [0.46, -0.14, 0.39], [0.16, 0.075, 0.05]))

  const leftArm = new THREE.Group()
  leftArm.position.set(-0.52, -0.1, 0.03)
  leftArm.rotation.z = -0.3
  leftArm.add(mesh(fluffyGeometry(55), lowerFur, [0, 0, 0], [0.24, 0.24, 0.22]))
  leftArm.add(mesh(fluffyGeometry(49), lowerFur, [0, -0.34, 0], [0.28, 0.5, 0.28]))
  const rightArm = new THREE.Group()
  rightArm.position.set(0.52, -0.1, 0.03)
  rightArm.rotation.z = 0.3
  rightArm.add(mesh(fluffyGeometry(56), lowerFur, [0, 0, 0], [0.24, 0.24, 0.22]))
  rightArm.add(mesh(fluffyGeometry(50), lowerFur, [0, -0.34, 0], [0.28, 0.5, 0.28]))
  const leftFoot = new THREE.Group()
  leftFoot.position.set(-0.31, -0.94, 0.08)
  leftFoot.add(mesh(fluffyGeometry(51), lowerFur, [0, 0, 0], [0.34, 0.25, 0.39]))
  leftFoot.add(mesh(fluffyGeometry(53), innerEar, [0, 0, 0.2], [0.18, 0.1, 0.06]))
  const rightFoot = new THREE.Group()
  rightFoot.position.set(0.31, -0.94, 0.08)
  rightFoot.add(mesh(fluffyGeometry(52), lowerFur, [0, 0, 0], [0.34, 0.25, 0.39]))
  rightFoot.add(mesh(fluffyGeometry(54), innerEar, [0, 0, 0.2], [0.18, 0.1, 0.06]))
  root.add(body, head, leftArm, rightArm, leftFoot, rightFoot)

  return {
    root,
    head,
    body,
    leftArm,
    rightArm,
    leftFoot,
    rightFoot,
    leftEar,
    rightEar,
    leftEye,
    rightEye,
    headScale: head.scale.clone(),
    bodyScale: body.scale.clone(),
  }
}

function buildCat(meta) {
  const root = new THREE.Group()
  const body = new THREE.Group()
  const head = new THREE.Group()
  const whiteFur = softMaterial(meta.bodyTop, '#ffffff')
  const shadowFur = softMaterial(meta.bodyBottom, '#ffffff')
  const pink = softMaterial(meta.accent, '#ffffff')
  const whiskerColor = '#c9beb9'

  body.position.y = -0.55
  body.add(mesh(fluffyGeometry(61), shadowFur, [0, 0, 0], [0.76, 0.7, 0.66]))
  body.add(mesh(fluffyGeometry(62), whiteFur, [0, 0.2, 0.28], [0.54, 0.42, 0.22]))
  body.add(mesh(fluffyGeometry(63), whiteFur, [-0.17, 0.08, 0.39], [0.24, 0.24, 0.12]))
  body.add(mesh(fluffyGeometry(64), whiteFur, [0, 0.03, 0.42], [0.25, 0.26, 0.12]))
  body.add(mesh(fluffyGeometry(65), whiteFur, [0.17, 0.08, 0.39], [0.24, 0.24, 0.12]))

  head.position.y = 0.27
  head.add(mesh(fluffyGeometry(66), whiteFur, [0, 0, 0], [1.34, 1.08, 0.88]))
  head.add(mesh(fluffyGeometry(67), whiteFur, [-0.62, -0.02, -0.03], [0.28, 0.33, 0.34], [0, 0, -0.2]))
  head.add(mesh(fluffyGeometry(68), whiteFur, [0.62, -0.02, -0.03], [0.28, 0.33, 0.34], [0, 0, 0.2]))

  const earGeometry = extrudedShapeGeometry(
    [
      [-0.5, -0.5],
      [0.5, -0.5],
      [0, 0.5],
    ],
    0.16,
    0.035
  )
  const innerEarGeometry = extrudedShapeGeometry(
    [
      [-0.5, -0.5],
      [0.5, -0.5],
      [0, 0.5],
    ],
    0.09,
    0.02
  )
  const leftEar = new THREE.Group()
  leftEar.position.set(-0.43, 0.46, -0.03)
  leftEar.add(mesh(earGeometry, shadowFur, [0, 0, 0], [0.43, 0.58, 0.52], [0, 0, -0.08]))
  leftEar.add(mesh(innerEarGeometry, pink, [0, -0.02, 0.09], [0.25, 0.34, 0.38], [0, 0, -0.08]))
  const rightEar = new THREE.Group()
  rightEar.position.set(0.43, 0.46, -0.03)
  rightEar.add(mesh(earGeometry, shadowFur, [0, 0, 0], [0.43, 0.58, 0.52], [0, 0, 0.08]))
  rightEar.add(mesh(innerEarGeometry, pink, [0, -0.02, 0.09], [0.25, 0.34, 0.38], [0, 0, 0.08]))
  head.add(leftEar, rightEar)

  // 原画の前髪3束。
  head.add(mesh(fluffyGeometry(69), whiteFur, [-0.18, 0.48, 0.18], [0.18, 0.3, 0.18], [0, 0, -0.42]))
  head.add(mesh(fluffyGeometry(70), whiteFur, [0, 0.52, 0.2], [0.18, 0.34, 0.18]))
  head.add(mesh(fluffyGeometry(71), whiteFur, [0.18, 0.48, 0.18], [0.18, 0.3, 0.18], [0, 0, 0.42]))

  const leftEye = makeCharacterEye(meta.eyeColor, [-0.34, 0.07, 0.48], [0.19, 0.23, 0.09], true)
  const rightEye = makeCharacterEye(meta.eyeColor, [0.34, 0.07, 0.48], [0.19, 0.23, 0.09], true)
  head.add(leftEye, rightEye)
  const noseGeometry = extrudedShapeGeometry(
    [
      [0, -0.5],
      [0.5, 0.45],
      [-0.5, 0.45],
    ],
    0.1,
    0.02
  )
  head.add(mesh(noseGeometry, glossyMaterial(meta.accent), [0, -0.13, 0.51], [0.14, 0.1, 0.4]))
  head.add(makeArc([0, -0.18, 0.535], [-0.06, -0.25, 0.535], [-0.14, -0.21, 0.52], meta.eyeColor, 0.011))
  head.add(makeArc([0, -0.18, 0.535], [0.06, -0.25, 0.535], [0.14, -0.21, 0.52], meta.eyeColor, 0.011))
  head.add(mesh(new THREE.SphereGeometry(0.5, 18, 12), pink, [-0.5, -0.11, 0.4], [0.16, 0.07, 0.045]))
  head.add(mesh(new THREE.SphereGeometry(0.5, 18, 12), pink, [0.5, -0.11, 0.4], [0.16, 0.07, 0.045]))

  const whiskerRows = [-0.05, -0.14]
  whiskerRows.forEach((y, index) => {
    const spread = 0.76 + index * 0.03
    head.add(makeRod([-0.43, y, 0.46], [-spread, y + (index === 0 ? 0.04 : -0.02), 0.45], 0.008, whiskerColor))
    head.add(makeRod([0.43, y, 0.46], [spread, y + (index === 0 ? 0.04 : -0.02), 0.45], 0.008, whiskerColor))
  })

  const tail = new THREE.Group()
  tail.position.set(0.32, -0.7, -0.28)
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.38, 0.04, -0.06),
    new THREE.Vector3(0.6, 0.36, 0),
    new THREE.Vector3(0.46, 0.76, 0.16),
  ])
  const tailMesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.14, 16, false), shadowFur)
  tailMesh.castShadow = true
  tail.add(tailMesh)

  const leftArm = new THREE.Group()
  leftArm.position.set(-0.39, -0.28, 0.08)
  leftArm.rotation.z = -0.24
  leftArm.add(mesh(fluffyGeometry(76), shadowFur, [0, 0, 0], [0.18, 0.18, 0.17]))
  leftArm.add(mesh(fluffyGeometry(72), shadowFur, [0, -0.28, 0], [0.24, 0.4, 0.24]))
  const rightArm = new THREE.Group()
  rightArm.position.set(0.39, -0.28, 0.08)
  rightArm.rotation.z = 0.24
  rightArm.add(mesh(fluffyGeometry(77), shadowFur, [0, 0, 0], [0.18, 0.18, 0.17]))
  rightArm.add(mesh(fluffyGeometry(73), shadowFur, [0, -0.28, 0], [0.24, 0.4, 0.24]))
  const leftFoot = mesh(fluffyGeometry(74), whiteFur, [-0.24, -0.94, 0.09], [0.3, 0.23, 0.34])
  const rightFoot = mesh(fluffyGeometry(75), whiteFur, [0.24, -0.94, 0.09], [0.3, 0.23, 0.34])
  root.add(tail, body, head, leftArm, rightArm, leftFoot, rightFoot)

  return {
    root,
    head,
    body,
    leftArm,
    rightArm,
    leftFoot,
    rightFoot,
    leftEar,
    rightEar,
    tail,
    leftEye,
    rightEye,
    headScale: head.scale.clone(),
    bodyScale: body.scale.clone(),
  }
}

function buildRobot(meta) {
  const root = new THREE.Group()
  const body = new THREE.Group()
  const head = new THREE.Group()
  // 原本は clearcoat 付き MeshPhysicalMaterial。GLB 拡張回避のため Standard 化。
  const metal = new THREE.MeshStandardMaterial({ color: meta.bodyTop, roughness: 0.38, metalness: 0.62 })
  body.position.y = -0.42
  body.add(mesh(new THREE.BoxGeometry(1.15, 1.05, 0.72, 3, 3, 3), metal, [0, 0, 0], [1, 1, 1]))
  head.position.y = 0.48
  head.add(mesh(new THREE.BoxGeometry(1.35, 0.86, 0.78, 3, 3, 3), metal, [0, 0, 0], [1, 1, 1]))
  const face = addFace(head, meta.eyeColor, meta.accent, { eyeY: 0.05, eyeX: 0.3, eyeZ: 0.43, muzzle: false })
  const antenna = new THREE.Group()
  antenna.position.set(0, 0.75, 0)
  antenna.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.38, 12), glossyMaterial(meta.accentStrong), [0, 0, 0], [1, 1, 1]))
  antenna.add(mesh(new THREE.SphereGeometry(0.11, 18, 12), glossyMaterial('#ff6969'), [0, 0.25, 0], [1, 1, 1]))
  head.add(antenna)
  const leftArm = new THREE.Group()
  leftArm.position.set(-0.72, 0, 0)
  leftArm.rotation.z = -0.12
  leftArm.add(mesh(new THREE.CapsuleGeometry(0.14, 0.48, 8, 16), metal, [0, -0.35, 0], [1, 1, 1]))
  const rightArm = new THREE.Group()
  rightArm.position.set(0.72, 0, 0)
  rightArm.rotation.z = 0.12
  rightArm.add(mesh(new THREE.CapsuleGeometry(0.14, 0.48, 8, 16), metal, [0, -0.35, 0], [1, 1, 1]))
  const leftFoot = mesh(new THREE.CylinderGeometry(0.24, 0.3, 0.22, 20), metal, [-0.34, -1.02, 0.05], [1, 1, 1])
  const rightFoot = mesh(new THREE.CylinderGeometry(0.24, 0.3, 0.22, 20), metal, [0.34, -1.02, 0.05], [1, 1, 1])
  root.add(body, head, leftArm, rightArm, leftFoot, rightFoot)
  return {
    root,
    head,
    body,
    leftArm,
    rightArm,
    leftFoot,
    rightFoot,
    antenna,
    leftEye: face.leftEye,
    rightEye: face.rightEye,
    headScale: head.scale.clone(),
    bodyScale: body.scale.clone(),
  }
}

function buildBird(meta) {
  const root = new THREE.Group()
  const body = new THREE.Group()
  const head = new THREE.Group()
  const feather = softMaterial(meta.bodyTop, '#ffffff')
  const lowerFeather = softMaterial(meta.bodyBottom, meta.accentSoft)
  const wingFeather = softMaterial(meta.accentStrong, meta.accentSoft)
  const bellyMaterial = softMaterial('#f7fbec', '#ffffff')
  const orange = meta.accessoryColor

  // 頭と胴が一体に見える、原画のしずく型シルエット。
  body.position.y = -0.3
  body.add(mesh(fluffyGeometry(81), lowerFeather, [0, 0, 0], [1.03, 1.2, 0.8]))
  body.add(mesh(fluffyGeometry(82), bellyMaterial, [0, -0.1, 0.41], [0.66, 0.72, 0.12]))
  body.add(mesh(fluffyGeometry(83), softMaterial(meta.accentSoft), [-0.12, -0.22, 0.49], [0.11, 0.07, 0.04]))
  body.add(mesh(fluffyGeometry(84), softMaterial(meta.accentSoft), [0.12, -0.28, 0.49], [0.11, 0.07, 0.04]))

  head.position.y = 0.35
  head.add(mesh(fluffyGeometry(85), feather, [0, 0, 0], [0.98, 0.9, 0.8]))
  const leftEye = makeCharacterEye(meta.eyeColor, [-0.27, 0.08, 0.43], [0.15, 0.19, 0.08], true)
  const rightEye = makeCharacterEye(meta.eyeColor, [0.27, 0.08, 0.43], [0.15, 0.19, 0.08], true)
  head.add(leftEye, rightEye)
  const beakGeometry = extrudedShapeGeometry(
    [
      [0, 0.5],
      [0.62, 0],
      [0, -0.5],
      [-0.62, 0],
    ],
    0.14,
    0.025
  )
  head.add(mesh(beakGeometry, glossyMaterial(orange), [0, -0.12, 0.48], [0.24, 0.17, 0.5]))
  head.add(mesh(new THREE.SphereGeometry(0.5, 18, 12), softMaterial('#ffb5c2'), [-0.4, -0.1, 0.39], [0.14, 0.065, 0.045]))
  head.add(mesh(new THREE.SphereGeometry(0.5, 18, 12), softMaterial('#ffb5c2'), [0.4, -0.1, 0.39], [0.14, 0.065, 0.045]))

  // 三枚の冠羽。
  head.add(mesh(new THREE.CapsuleGeometry(0.055, 0.25, 8, 16), wingFeather, [-0.13, 0.51, -0.01], [1, 1, 0.8], [0, 0, 0.28]))
  head.add(mesh(new THREE.CapsuleGeometry(0.06, 0.3, 8, 16), softMaterial(meta.accent), [0, 0.56, 0], [1, 1, 0.8]))
  head.add(mesh(new THREE.CapsuleGeometry(0.05, 0.22, 8, 16), softMaterial(meta.bodyTop), [0.13, 0.5, -0.01], [1, 1, 0.8], [0, 0, -0.28]))

  const leftWing = new THREE.Group()
  leftWing.position.set(-0.48, -0.18, -0.02)
  leftWing.add(mesh(fluffyGeometry(86), wingFeather, [-0.16, 0.01, 0], [0.58, 0.72, 0.32], [0, 0, -0.13]))
  leftWing.add(mesh(fluffyGeometry(87), wingFeather, [-0.34, -0.2, -0.01], [0.26, 0.4, 0.26], [0, 0, -0.38]))
  leftWing.add(mesh(fluffyGeometry(88), wingFeather, [-0.25, -0.34, -0.02], [0.24, 0.34, 0.24], [0, 0, -0.62]))
  const rightWing = new THREE.Group()
  rightWing.position.set(0.48, -0.18, -0.02)
  rightWing.add(mesh(fluffyGeometry(89), wingFeather, [0.16, 0.01, 0], [0.58, 0.72, 0.32], [0, 0, 0.13]))
  rightWing.add(mesh(fluffyGeometry(90), wingFeather, [0.34, -0.2, -0.01], [0.26, 0.4, 0.26], [0, 0, 0.38]))
  rightWing.add(mesh(fluffyGeometry(91), wingFeather, [0.25, -0.34, -0.02], [0.24, 0.34, 0.24], [0, 0, 0.62]))
  leftWing.rotation.z = -0.28
  rightWing.rotation.z = 0.28

  // 背面へ広がる三枚の尾羽。
  const tailGeometry = extrudedShapeGeometry(
    [
      [-0.45, -0.5],
      [0.45, -0.5],
      [0, 0.5],
    ],
    0.12,
    0.03
  )
  root.add(mesh(tailGeometry, wingFeather, [0.18, -0.83, -0.34], [0.38, 0.6, 0.55], [0, 0, -0.34]))
  root.add(mesh(tailGeometry, softMaterial(meta.accent), [0.42, -0.74, -0.31], [0.34, 0.58, 0.5], [0, 0, -0.78]))
  root.add(mesh(tailGeometry, feather, [0.58, -0.58, -0.28], [0.28, 0.5, 0.46], [0, 0, -1.02]))

  // オレンジ色の三本指の足。
  const makeBirdFoot = (x) => {
    const foot = new THREE.Group()
    foot.position.set(x, -0.86, 0.08)
    foot.add(makeRod([0, 0, 0], [0, -0.14, 0.04], 0.018, orange))
    foot.add(makeRod([0, -0.13, 0.04], [-0.08, -0.18, 0.12], 0.014, orange))
    foot.add(makeRod([0, -0.13, 0.04], [0, -0.19, 0.14], 0.014, orange))
    foot.add(makeRod([0, -0.13, 0.04], [0.08, -0.18, 0.12], 0.014, orange))
    return foot
  }
  const leftFoot = makeBirdFoot(-0.2)
  const rightFoot = makeBirdFoot(0.2)
  root.add(body, head, leftWing, rightWing, leftFoot, rightFoot)

  return {
    root,
    head,
    body,
    leftFoot,
    rightFoot,
    leftWing,
    rightWing,
    leftEye,
    rightEye,
    headScale: head.scale.clone(),
    bodyScale: body.scale.clone(),
  }
}

// アニメーショントラックのバインド先となる固定パーツ名。
const RIG_PART_NAMES = {
  root: 'root',
  body: 'body',
  head: 'head',
  leftArm: 'armL',
  rightArm: 'armR',
  leftFoot: 'footL',
  rightFoot: 'footR',
  leftEar: 'earL',
  rightEar: 'earR',
  tail: 'tail',
  leftWing: 'wingL',
  rightWing: 'wingR',
  antenna: 'antenna',
  leftEye: 'eyeL',
  rightEye: 'eyeR',
}

// 無名ノードへ一意な名前を割り当てる。
// - モーフターゲット付きメッシュ(fluffyGeometry 由来)は 'fluffy-N':
//   モーフアニメのトラック名に必要。
// - それ以外の無名ノードは 'node-N': exporter の名前衝突対策。
function assignUniqueNames(root) {
  const used = new Set()
  root.traverse((object) => {
    if (object.name) used.add(object.name)
  })
  let fluffyIndex = 0
  let nodeIndex = 0
  root.traverse((object) => {
    if (object.name) return
    const isFluffy = Boolean(
      object.isMesh && object.geometry && object.geometry.userData && object.geometry.userData.fluffy
    )
    let name
    do {
      name = isFluffy ? `fluffy-${fluffyIndex++}` : `node-${nodeIndex++}`
    } while (used.has(name))
    object.name = name
    used.add(name)
  })
}

export function buildCharacter(mascotId) {
  const meta = MASCOT_META[mascotId]
  if (!meta) {
    throw new Error(`unknown mascot id: ${mascotId}`)
  }
  const rig =
    meta.model === 'bear'
      ? buildBear(meta)
      : meta.model === 'cat'
        ? buildCat(meta)
        : meta.model === 'robot'
          ? buildRobot(meta)
          : buildBird(meta)
  for (const [key, name] of Object.entries(RIG_PART_NAMES)) {
    const part = rig[key]
    if (part) part.name = name
  }
  assignUniqueNames(rig.root)
  return rig
}
