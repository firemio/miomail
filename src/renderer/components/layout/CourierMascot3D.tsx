import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { MASCOT_IDLE_MOTION_COUNT } from '../../data/mascotIdleMotions'
import { getMascotMeta, type MascotId } from '../../data/mascots'
import { getMascotPhase, type MascotCareStats } from '../../stores/mascotStore'
import { CourierMascot } from './CourierMascot'

interface CourierMascot3DProps {
  mascotId: MascotId
  bond?: number
  care?: MascotCareStats
  size?: number
  pose?: number
  spinSignal?: number
  className?: string
}

interface MascotRig {
  root: THREE.Group
  head: THREE.Group
  body: THREE.Group
  leftArm?: THREE.Object3D
  rightArm?: THREE.Object3D
  leftFoot?: THREE.Object3D
  rightFoot?: THREE.Object3D
  leftEar?: THREE.Object3D
  rightEar?: THREE.Object3D
  tail?: THREE.Object3D
  leftWing?: THREE.Object3D
  rightWing?: THREE.Object3D
  antenna?: THREE.Object3D
  leftEye?: THREE.Object3D
  rightEye?: THREE.Object3D
  headScale: THREE.Vector3
  bodyScale: THREE.Vector3
}

interface IdleMotionFrame {
  rootPitch: number
  rootYaw: number
  rootRoll: number
  rootLift: number
  headPitch: number
  headYaw: number
  headRoll: number
  headLift: number
  bodyPitch: number
  bodyYaw: number
  bodyRoll: number
  bodyLift: number
  bodyScaleX: number
  bodyScaleY: number
  bodyScaleZ: number
  leftArmPitch: number
  leftArmYaw: number
  leftArmRoll: number
  leftArmLift: number
  rightArmPitch: number
  rightArmYaw: number
  rightArmRoll: number
  rightArmLift: number
  leftFootPitch: number
  leftFootRoll: number
  rightFootPitch: number
  rightFootRoll: number
  leftEarPitch: number
  leftEarRoll: number
  rightEarPitch: number
  rightEarRoll: number
  tailPitch: number
  tailYaw: number
  tailRoll: number
  leftWingPitch: number
  leftWingYaw: number
  leftWingRoll: number
  rightWingPitch: number
  rightWingYaw: number
  rightWingRoll: number
  antennaPitch: number
  antennaYaw: number
  antennaRoll: number
  eyeOpen: number
}

const IDLE_MOTION_REST: IdleMotionFrame = {
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

const REDUCED_MOTION_SAMPLE_TIMES = [0.8, 2.18, 1.1, 0.7, 0.65, 1, 0.8, 0.65] as const

function positiveBounce(value: number) {
  return Math.pow(Math.max(0, value), 2)
}

function applySlowLook(frame: IdleMotionFrame, elapsed: number) {
  const look = Math.sin(elapsed * 0.72)
  frame.rootYaw = look * Math.PI * 0.2
  frame.headYaw = look * Math.PI * 0.05
  frame.rootLift = Math.sin(elapsed * 1.05) * 0.012
}

function sampleIdleMotion(
  frame: IdleMotionFrame,
  mascotId: MascotId,
  pose: number,
  elapsed: number
) {
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

function fluffyGeometry(seed: number) {
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

function softMaterial(color: string, sheenColor = '#ffffff') {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.82,
    metalness: 0,
    sheen: 0.9,
    sheenColor: new THREE.Color(sheenColor),
    sheenRoughness: 0.72,
    clearcoat: 0.06,
    clearcoatRoughness: 0.9,
  })
}

function glossyMaterial(color: string) {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.18,
    metalness: 0.05,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
  })
}

function mesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: [number, number, number],
  scale: [number, number, number],
  rotation: [number, number, number] = [0, 0, 0]
) {
  const result = new THREE.Mesh(geometry, material)
  result.position.set(...position)
  result.scale.set(...scale)
  result.rotation.set(...rotation)
  result.castShadow = true
  result.receiveShadow = true
  return result
}

function extrudedShapeGeometry(
  points: Array<[number, number]>,
  depth = 0.12,
  bevelSize = 0.035
) {
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

function makeRod(
  start: [number, number, number],
  end: [number, number, number],
  radius: number,
  color: string
) {
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

function makeArc(
  start: [number, number, number],
  control: [number, number, number],
  end: [number, number, number],
  color: string,
  radius = 0.012
) {
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

function makeCharacterEye(
  color: string,
  position: [number, number, number],
  scale: [number, number, number],
  doubleGlint = false
) {
  const group = new THREE.Group()
  group.position.set(...position)
  group.add(mesh(new THREE.SphereGeometry(0.5, 28, 20), glossyMaterial(color), [0, 0, 0], scale))
  group.add(
    mesh(
      new THREE.SphereGeometry(0.5, 12, 8),
      new THREE.MeshBasicMaterial({ color: '#ffffff' }),
      [-scale[0] * 0.2, scale[1] * 0.24, scale[2] * 0.62],
      [scale[0] * 0.28, scale[0] * 0.32, scale[2] * 0.2]
    )
  )
  if (doubleGlint) {
    group.add(
      mesh(
        new THREE.SphereGeometry(0.5, 10, 8),
        new THREE.MeshBasicMaterial({ color: '#ffffff' }),
        [scale[0] * 0.2, -scale[1] * 0.2, scale[2] * 0.64],
        [scale[0] * 0.15, scale[0] * 0.15, scale[2] * 0.14]
      )
    )
  }
  return group
}

function makeDiamond(color: string, position: [number, number, number], scale = 0.11) {
  const result = mesh(
    new THREE.OctahedronGeometry(0.5, 0),
    glossyMaterial(color),
    position,
    [scale, scale * 1.25, scale * 0.65]
  )
  result.castShadow = false
  result.userData.sparkle = true
  result.userData.baseY = position[1]
  result.userData.phase = position[0] * 2.7 + position[1]
  return result
}

function makeEye(color: string, x: number, y: number, z: number) {
  const eye = mesh(
    new THREE.SphereGeometry(0.5, 24, 18),
    glossyMaterial(color),
    [x, y, z],
    [0.15, 0.19, 0.09]
  )
  const glint = mesh(
    new THREE.SphereGeometry(0.5, 12, 8),
    new THREE.MeshBasicMaterial({ color: '#ffffff' }),
    [x - 0.035, y + 0.055, z + 0.052],
    [0.042, 0.052, 0.022]
  )
  const group = new THREE.Group()
  group.add(eye, glint)
  return group
}

function makeEnvelope(accent: string) {
  const group = new THREE.Group()
  const paper = softMaterial('#fffdf9')
  const box = mesh(new THREE.BoxGeometry(1, 0.64, 0.12), paper, [0, 0, 0], [0.76, 0.66, 0.75])
  box.geometry.translate(0, 0, 0)
  group.add(box)
  const flapShape = new THREE.Shape()
  flapShape.moveTo(-0.38, 0.19)
  flapShape.lineTo(0.38, 0.19)
  flapShape.lineTo(0, -0.12)
  flapShape.closePath()
  const flap = mesh(
    new THREE.ExtrudeGeometry(flapShape, { depth: 0.025, bevelEnabled: false }),
    softMaterial('#fff4ef'),
    [0, 0.02, 0.07],
    [1, 1, 1]
  )
  const seal = mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.035, 24), glossyMaterial(accent), [0, -0.08, 0.12], [1, 1, 1], [Math.PI / 2, 0, 0])
  group.add(flap, seal)
  return group
}

function addFace(
  head: THREE.Group,
  eyeColor: string,
  accent: string,
  options: { eyeY?: number; eyeX?: number; eyeZ?: number; muzzle?: boolean } = {}
) {
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

function attachInPlace(root: THREE.Group, parent: THREE.Object3D, object: THREE.Object3D) {
  root.add(object)
  root.updateMatrixWorld(true)
  parent.attach(object)
}

function addGrowthGear(
  rig: MascotRig,
  phase: string,
  accent: string,
  accentSoft: string,
  accentStrong: string,
  mascotId: MascotId
) {
  const { root, head, body } = rig
  const hasDeliveryGear = phase === 'courier' || phase === 'partner' || phase === 'star'
  if (!hasDeliveryGear) return

  const envelope = makeEnvelope(accent)
  envelope.position.set(
    0,
    mascotId === 'posty' ? -0.5 : phase === 'star' ? -0.46 : phase === 'partner' ? -0.49 : -0.52,
    mascotId === 'posty' ? 0.83 : 0.78
  )
  envelope.rotation.x = -0.08
  attachInPlace(root, body, envelope)

  // ポスティはユーザー確認済みの現行造形を維持する。
  if (mascotId === 'posty') {
    if (phase === 'courier') {
      const postyCap = new THREE.Group()
      postyCap.position.set(0, 1.03, 0)
      postyCap.add(mesh(new THREE.SphereGeometry(0.5, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2), softMaterial(accent), [0, 0, 0], [0.72, 0.2, 0.58]))
      postyCap.add(mesh(new THREE.BoxGeometry(1, 0.12, 0.34), softMaterial(accent), [0, -0.04, 0.28], [0.65, 1, 1]))
      attachInPlace(root, head, postyCap)
    }
    if (phase === 'partner') {
      attachInPlace(root, body, mesh(new THREE.TorusGeometry(0.46, 0.09, 12, 40), softMaterial(accent), [0, -0.07, 0.12], [1, 0.65, 1], [Math.PI / 2, 0, 0]))
    }
    if (phase === 'star') {
      const halo = mesh(new THREE.TorusGeometry(1.1, 0.025, 12, 64), glossyMaterial('#ffe28a'), [0, 0.12, -0.28], [1, 1, 1], [Math.PI / 2, 0, 0])
      halo.castShadow = false
      root.add(halo)
    }
    return
  }

  // 原画どおり、配達員以降は帽子を継承する。
  const cap = new THREE.Group()
  cap.position.set(0, 1.03, 0.04)
  cap.rotation.z = -0.035
  cap.add(
    mesh(
      new THREE.SphereGeometry(0.5, 32, 18, 0, Math.PI * 2, 0, Math.PI / 2),
      softMaterial(accent),
      [0, 0, 0],
      [1.18, 0.58, 0.76]
    )
  )
  cap.add(
    mesh(
      new THREE.SphereGeometry(0.5, 28, 16),
      softMaterial(accentStrong, accent),
      [0, -0.045, 0.26],
      [1.46, 0.12, 0.42]
    )
  )
  cap.add(
    mesh(
      new THREE.SphereGeometry(0.5, 18, 12),
      glossyMaterial(accentSoft),
      [0, 0.1, 0.39],
      [0.13, 0.13, 0.045]
    )
  )
  attachInPlace(root, head, cap)

  // 相棒期以降は首元の太いスカーフも継承する。
  if (phase === 'partner' || phase === 'star') {
    const scarf = mesh(
      new THREE.CapsuleGeometry(0.085, 0.78, 10, 24),
      softMaterial(accent),
      [0, -0.02, 0.53],
      [1, 1, 0.72],
      [0, 0, Math.PI / 2]
    )
    scarf.castShadow = false
    attachInPlace(root, body, scarf)
    attachInPlace(
      root,
      body,
      mesh(
          new THREE.CapsuleGeometry(0.07, 0.27, 8, 16),
          softMaterial(accent),
          [0.39, -0.22, 0.34],
          [1, 1, 0.7],
          [0, 0, -0.36]
        )
    )
  }

  if (phase === 'star') {
    const halo = mesh(
      new THREE.TorusGeometry(1.06, 0.025, 12, 72),
      new THREE.MeshBasicMaterial({ color: accentSoft, transparent: true, opacity: 0.9 }),
      [0, 0.02, -0.34],
      [1, 1, 1]
    )
    halo.castShadow = false
    root.add(halo)
  }
}

function addStageSparkles(
  root: THREE.Group,
  meta: ReturnType<typeof getMascotMeta>,
  phase: string
) {
  const spread = phase === 'egg' ? 0.78 : 0.94
  root.add(
    makeDiamond(meta.accent, [-spread, 0.4, 0.04], phase === 'egg' ? 0.09 : 0.11),
    makeDiamond(meta.accent, [spread, 0.34, 0.02], phase === 'egg' ? 0.08 : 0.1)
  )
  if (phase === 'star') {
    root.add(
      makeDiamond('#ffe38a', [-0.72, 0.72, 0.08], 0.08),
      makeDiamond('#ffe38a', [0.76, 0.68, 0.06], 0.07),
      makeDiamond(meta.accentSoft, [0, 1.14, 0.02], 0.07)
    )
  }
}

function buildEgg(meta: ReturnType<typeof getMascotMeta>): MascotRig {
  const root = new THREE.Group()
  const body = new THREE.Group()
  const head = new THREE.Group()
  const creatureMaterial = softMaterial(meta.bodyTop, meta.accentSoft)
  const shellMaterial = softMaterial('#fffaf4', '#ffffff')
  body.position.y = -0.06
  body.add(mesh(fluffyGeometry(2), creatureMaterial, [0, 0.16, 0], [0.72, 0.82, 0.64]))
  body.add(mesh(fluffyGeometry(3), shellMaterial, [0, -0.42, 0.05], [0.86, 0.56, 0.72]))

  // 原画の割れ殻。前面に立体的なギザギザを並べる。
  const shellTooth = extrudedShapeGeometry(
    [
      [-0.5, -0.5],
      [0.5, -0.5],
      [0, 0.5],
    ],
    0.12,
    0.02
  )
  const shellRimPositions = [-0.48, -0.24, 0, 0.24, 0.48]
  shellRimPositions.forEach((x, index) => {
    body.add(
      mesh(
        shellTooth,
        shellMaterial,
        [x, -0.2 + (index % 2 === 0 ? 0.015 : -0.015), 0.39],
        [0.25, 0.28, 0.5]
      )
    )
  })

  head.position.y = -0.06
  const leftEye = makeCharacterEye(meta.eyeColor, [-0.19, 0.25, 0.34], [0.085, 0.11, 0.055])
  const rightEye = makeCharacterEye(meta.eyeColor, [0.19, 0.25, 0.34], [0.085, 0.11, 0.055])
  head.add(leftEye, rightEye)
  head.add(makeRod([-0.08, 0.11, 0.39], [0.08, 0.11, 0.39], 0.012, meta.eyeColor))
  head.add(mesh(new THREE.SphereGeometry(0.5, 16, 10), softMaterial(meta.accentSoft), [-0.29, 0.13, 0.31], [0.12, 0.06, 0.04]))
  head.add(mesh(new THREE.SphereGeometry(0.5, 16, 10), softMaterial(meta.accentSoft), [0.29, 0.13, 0.31], [0.12, 0.06, 0.04]))

  // 殻から見える種別モチーフ。
  if (meta.model === 'bear') {
    head.add(mesh(fluffyGeometry(31), creatureMaterial, [-0.19, 0.57, -0.01], [0.2, 0.2, 0.15]))
    head.add(mesh(fluffyGeometry(32), creatureMaterial, [0.19, 0.57, -0.01], [0.2, 0.2, 0.15]))
  } else if (meta.model === 'cat') {
    const ear = extrudedShapeGeometry(
      [
        [-0.5, -0.5],
        [0.5, -0.5],
        [0, 0.5],
      ],
      0.1,
      0.02
    )
    head.add(mesh(ear, creatureMaterial, [-0.2, 0.57, 0], [0.25, 0.3, 0.5], [0, 0, -0.1]))
    head.add(mesh(ear, creatureMaterial, [0.2, 0.57, 0], [0.25, 0.3, 0.5], [0, 0, 0.1]))
  } else if (meta.model === 'bird') {
    const crest = softMaterial(meta.accentStrong)
    head.add(mesh(new THREE.CapsuleGeometry(0.045, 0.16, 6, 12), crest, [-0.11, 0.59, 0], [1, 1, 0.75], [0, 0, 0.26]))
    head.add(mesh(new THREE.CapsuleGeometry(0.045, 0.2, 6, 12), crest, [0, 0.62, 0], [1, 1, 0.75]))
    head.add(mesh(new THREE.CapsuleGeometry(0.045, 0.16, 6, 12), crest, [0.11, 0.59, 0], [1, 1, 0.75], [0, 0, -0.26]))
  }

  root.add(body, head)
  return {
    root,
    head,
    body,
    leftEye,
    rightEye,
    headScale: head.scale.clone(),
    bodyScale: body.scale.clone(),
  } satisfies MascotRig
}

function buildBear(meta: ReturnType<typeof getMascotMeta>): MascotRig {
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
  } satisfies MascotRig
}

function buildCat(meta: ReturnType<typeof getMascotMeta>): MascotRig {
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
  } satisfies MascotRig
}

function buildRobot(meta: ReturnType<typeof getMascotMeta>): MascotRig {
  const root = new THREE.Group()
  const body = new THREE.Group()
  const head = new THREE.Group()
  const metal = new THREE.MeshPhysicalMaterial({ color: meta.bodyTop, roughness: 0.38, metalness: 0.62, clearcoat: 0.32 })
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
  } satisfies MascotRig
}

function buildBird(meta: ReturnType<typeof getMascotMeta>): MascotRig {
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
  const makeBirdFoot = (x: number) => {
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
  } satisfies MascotRig
}

function buildRig(mascotId: MascotId, bond: number) {
  const meta = getMascotMeta(mascotId)
  const phase = getMascotPhase(bond)
  const rig: MascotRig = phase === 'egg' && mascotId !== 'posty'
    ? buildEgg(meta)
    : mascotId === 'makko'
      ? buildBear(meta)
      : mascotId === 'mio'
        ? buildCat(meta)
        : mascotId === 'posty'
          ? buildRobot(meta)
          : buildBird(meta)
  addGrowthGear(rig, phase, meta.accent, meta.accentSoft, meta.accentStrong, mascotId)
  if (mascotId !== 'posty') addStageSparkles(rig.root, meta, phase)

  const currentPhaseScale = phase === 'egg' ? 0.78 : phase === 'hatchling' ? 0.9 : phase === 'courier' ? 1 : phase === 'partner' ? 1.06 : 1.12
  const originalPhaseScale = phase === 'egg' ? 0.76 : phase === 'hatchling' ? 0.9 : phase === 'courier' ? 1 : phase === 'partner' ? 1.06 : 1.14
  const bondGrowth = 1 + Math.min(bond, 80) / 400
  rig.root.scale.setScalar(mascotId === 'posty' ? currentPhaseScale : originalPhaseScale * bondGrowth)
  return rig
}

export function CourierMascot3D({
  mascotId,
  bond = 0,
  care,
  size = 96,
  pose = 0,
  spinSignal = 0,
  className = '',
}: CourierMascot3DProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const poseRef = useRef(pose)
  const spinSignalRef = useRef(spinSignal)
  const careRef = useRef(care)
  const [webglFailed, setWebglFailed] = useState(false)
  poseRef.current = pose
  spinSignalRef.current = spinSignal
  careRef.current = care

  useEffect(() => {
    const host = hostRef.current
    if (!host || webglFailed) return

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100)
    camera.position.set(0, 0.2, mascotId === 'posty' ? 6.5 : 7.2)
    camera.lookAt(0, -0.05, 0)

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
    } catch {
      setWebglFailed(true)
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setSize(size, size, false)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = mascotId === 'posty' ? 1.08 : 0.98
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    renderer.domElement.setAttribute('aria-hidden', 'true')
    renderer.domElement.style.display = 'block'
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    const handleContextLost = (event: Event) => {
      event.preventDefault()
      setWebglFailed(true)
    }
    renderer.domElement.addEventListener('webglcontextlost', handleContextLost)
    host.replaceChildren(renderer.domElement)

    scene.add(new THREE.HemisphereLight('#fff7f2', '#8d7b91', 2.2))
    const keyLight = new THREE.DirectionalLight('#fff1df', mascotId === 'posty' ? 4.6 : 3.7)
    keyLight.position.set(-3.5, 5, 5)
    keyLight.castShadow = true
    keyLight.shadow.mapSize.set(512, 512)
    scene.add(keyLight)
    const fillLight = new THREE.PointLight('#ffc5d7', mascotId === 'posty' ? 14 : 8.5, 12)
    fillLight.position.set(3.5, 1.5, 3)
    scene.add(fillLight)
    const rimLight = new THREE.PointLight('#bdeeff', mascotId === 'posty' ? 10 : 7, 10)
    rimLight.position.set(-3, 1, -2)
    scene.add(rimLight)

    const rig = buildRig(mascotId, bond)
    rig.root.position.y = 0.04
    scene.add(rig.root)
    const morphMeshes: THREE.Mesh[] = []
    const sparkleMeshes: THREE.Mesh[] = []
    rig.root.traverse((object) => {
      if (object instanceof THREE.Mesh && object.userData.sparkle) {
        sparkleMeshes.push(object)
      }
      if (
        object instanceof THREE.Mesh &&
        object.geometry.userData.fluffy &&
        object.morphTargetInfluences
      ) {
        morphMeshes.push(object)
      }
    })

    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.86, 48), new THREE.ShadowMaterial({ color: '#5e4650', opacity: 0.2 }))
    shadow.rotation.x = -Math.PI / 2
    shadow.position.set(0, mascotId === 'posty' ? -1.22 : -1.08 * rig.root.scale.y, 0)
    shadow.receiveShadow = true
    scene.add(shadow)

    const timer = new THREE.Timer()
    timer.connect(document)
    let frame = 0
    let currentPitch = 0
    let currentYaw = 0
    let currentRoll = 0
    let currentLift = 0
    let observedSpinSignal = spinSignalRef.current
    let spinStartedAt = -1
    let observedPose = Math.min(MASCOT_IDLE_MOTION_COUNT - 1, Math.max(0, Math.trunc(poseRef.current)))
    let poseStartedAt = 0
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
    let reducedMotion = motionPreference.matches
    const handleMotionPreference = (event: MediaQueryListEvent) => {
      reducedMotion = event.matches
      if (event.matches) spinStartedAt = -1
    }
    motionPreference.addEventListener('change', handleMotionPreference)

    interface PartRestTransform {
      position: THREE.Vector3
      rotation: THREE.Euler
      scale: THREE.Vector3
    }
    const restTransforms = new Map<THREE.Object3D, PartRestTransform>()
    const animatedParts = [
      rig.head,
      rig.body,
      rig.leftArm,
      rig.rightArm,
      rig.leftFoot,
      rig.rightFoot,
      rig.leftEar,
      rig.rightEar,
      rig.tail,
      rig.leftWing,
      rig.rightWing,
      rig.antenna,
    ].filter((part): part is THREE.Object3D => Boolean(part))
    animatedParts.forEach((part) => {
      restTransforms.set(part, {
        position: part.position.clone(),
        rotation: part.rotation.clone(),
        scale: part.scale.clone(),
      })
    })
    const motionFrame = { ...IDLE_MOTION_REST }

    const applyPartMotion = (
      part: THREE.Object3D | undefined,
      pitch: number,
      yaw: number,
      roll: number,
      lift: number,
      scaleX: number,
      scaleY: number,
      scaleZ: number,
      alpha: number
    ) => {
      if (!part) return
      const rest = restTransforms.get(part)
      if (!rest) return
      part.position.x = THREE.MathUtils.lerp(part.position.x, rest.position.x, alpha)
      part.position.y = THREE.MathUtils.lerp(part.position.y, rest.position.y + lift, alpha)
      part.position.z = THREE.MathUtils.lerp(part.position.z, rest.position.z, alpha)
      part.rotation.x = THREE.MathUtils.lerp(part.rotation.x, rest.rotation.x + pitch, alpha)
      part.rotation.y = THREE.MathUtils.lerp(part.rotation.y, rest.rotation.y + yaw, alpha)
      part.rotation.z = THREE.MathUtils.lerp(part.rotation.z, rest.rotation.z + roll, alpha)
      part.scale.x = THREE.MathUtils.lerp(part.scale.x, rest.scale.x * scaleX, alpha)
      part.scale.y = THREE.MathUtils.lerp(part.scale.y, rest.scale.y * scaleY, alpha)
      part.scale.z = THREE.MathUtils.lerp(part.scale.z, rest.scale.z * scaleZ, alpha)
    }

    const animate = (timestamp: number) => {
      timer.update(timestamp)
      const elapsed = timer.getElapsed()
      const delta = Math.min(0.05, timer.getDelta())
      const rootAlpha = reducedMotion ? 1 : 1 - Math.exp(-7 * delta)
      const partAlpha = reducedMotion ? 1 : 1 - Math.exp(-10 * delta)
      const currentPose = Math.min(MASCOT_IDLE_MOTION_COUNT - 1, Math.max(0, Math.trunc(poseRef.current)))
      if (currentPose !== observedPose) {
        observedPose = currentPose
        poseStartedAt = elapsed
      }
      const poseElapsed = elapsed - poseStartedAt
      const sampleTime = reducedMotion ? REDUCED_MOTION_SAMPLE_TIMES[currentPose] : poseElapsed
      sampleIdleMotion(motionFrame, mascotId, currentPose, sampleTime)
      if (spinSignalRef.current !== observedSpinSignal) {
        observedSpinSignal = spinSignalRef.current
        spinStartedAt = reducedMotion ? -1 : elapsed
      }
      currentPitch = THREE.MathUtils.lerp(currentPitch, motionFrame.rootPitch, rootAlpha)
      currentYaw = THREE.MathUtils.lerp(currentYaw, motionFrame.rootYaw, rootAlpha)
      currentRoll = THREE.MathUtils.lerp(currentRoll, motionFrame.rootRoll, rootAlpha)
      currentLift = THREE.MathUtils.lerp(currentLift, motionFrame.rootLift, rootAlpha)
      let spinRotation = 0
      if (spinStartedAt >= 0) {
        const spinProgress = Math.min(1, (elapsed - spinStartedAt) / 0.9)
        spinRotation = (1 - Math.pow(1 - spinProgress, 3)) * Math.PI * 2
        if (spinProgress >= 1) spinStartedAt = -1
      }
      rig.root.rotation.x = currentPitch
      rig.root.rotation.y = currentYaw + spinRotation
      rig.root.rotation.z = currentRoll
      rig.root.position.y = 0.04 + currentLift

      const breathStrength = mascotId === 'posty' ? 0.004 : currentPose === 5 ? 0.012 : 0.024
      const breath = 1 + Math.sin(sampleTime * 2.05) * breathStrength
      const morphBreath = reducedMotion
        ? 0
        : (Math.sin(sampleTime * 2.05) * 0.5 + 0.5) * 0.72
      morphMeshes.forEach((morphMesh, index) => {
        if (morphMesh.morphTargetInfluences) {
          morphMesh.morphTargetInfluences[0] = Math.max(
            0,
            morphBreath + Math.sin(sampleTime * 1.35 + index * 0.43) * 0.08 * (reducedMotion ? 0 : 1)
          )
          morphMesh.morphTargetInfluences[1] =
            (Math.sin(sampleTime * 0.9 + index * 0.31) * 0.5 + 0.5) * 0.18 * (reducedMotion ? 0 : 1)
        }
      })
      sparkleMeshes.forEach((sparkle, index) => {
        const sparklePhase = Number(sparkle.userData.phase ?? index)
        const baseY = Number(sparkle.userData.baseY ?? sparkle.position.y)
        sparkle.rotation.y = sampleTime * (0.65 + index * 0.08)
        sparkle.rotation.z = Math.sin(sampleTime * 0.9 + sparklePhase) * 0.26 * (reducedMotion ? 0 : 1)
        sparkle.position.y = baseY + Math.sin(sampleTime * 1.1 + sparklePhase) * 0.035 * (reducedMotion ? 0 : 1)
      })
      const headDriftStrength = mascotId === 'posty' ? 0.003 : 0.012
      const headDrift = 1 + Math.sin(sampleTime * 1.72 + 0.7) * headDriftStrength * (reducedMotion ? 0 : 1)
      applyPartMotion(
        rig.body,
        motionFrame.bodyPitch,
        motionFrame.bodyYaw,
        motionFrame.bodyRoll,
        motionFrame.bodyLift,
        motionFrame.bodyScaleX * (2 - breath),
        motionFrame.bodyScaleY * breath,
        motionFrame.bodyScaleZ * breath,
        partAlpha
      )
      applyPartMotion(
        rig.head,
        motionFrame.headPitch,
        motionFrame.headYaw,
        motionFrame.headRoll,
        motionFrame.headLift,
        headDrift,
        2 - headDrift,
        headDrift,
        partAlpha
      )
      applyPartMotion(rig.leftArm, motionFrame.leftArmPitch, motionFrame.leftArmYaw, motionFrame.leftArmRoll, motionFrame.leftArmLift, 1, 1, 1, partAlpha)
      applyPartMotion(rig.rightArm, motionFrame.rightArmPitch, motionFrame.rightArmYaw, motionFrame.rightArmRoll, motionFrame.rightArmLift, 1, 1, 1, partAlpha)
      applyPartMotion(rig.leftFoot, motionFrame.leftFootPitch, 0, motionFrame.leftFootRoll, 0, 1, 1, 1, partAlpha)
      applyPartMotion(rig.rightFoot, motionFrame.rightFootPitch, 0, motionFrame.rightFootRoll, 0, 1, 1, 1, partAlpha)
      applyPartMotion(rig.leftEar, motionFrame.leftEarPitch, 0, motionFrame.leftEarRoll, 0, 1, 1, 1, partAlpha)
      applyPartMotion(rig.rightEar, motionFrame.rightEarPitch, 0, motionFrame.rightEarRoll, 0, 1, 1, 1, partAlpha)
      applyPartMotion(rig.tail, motionFrame.tailPitch, motionFrame.tailYaw, motionFrame.tailRoll, 0, 1, 1, 1, partAlpha)
      applyPartMotion(rig.leftWing, motionFrame.leftWingPitch, motionFrame.leftWingYaw, motionFrame.leftWingRoll, 0, 1, 1, 1, partAlpha)
      applyPartMotion(rig.rightWing, motionFrame.rightWingPitch, motionFrame.rightWingYaw, motionFrame.rightWingRoll, 0, 1, 1, 1, partAlpha)
      applyPartMotion(rig.antenna, motionFrame.antennaPitch, motionFrame.antennaYaw, motionFrame.antennaRoll, 0, 1, 1, 1, partAlpha)

      const blinkWave = reducedMotion ? 0 : Math.pow(Math.max(0, Math.sin(elapsed * 0.78 + 1.8)), 38)
      const sleepy = careRef.current && careRef.current.energy < 25 ? 0.52 : 1
      const eyeScaleY = Math.max(0.08, (1 - blinkWave * 0.9) * sleepy * motionFrame.eyeOpen)
      if (rig.leftEye) rig.leftEye.scale.y = THREE.MathUtils.lerp(rig.leftEye.scale.y, eyeScaleY, partAlpha)
      if (rig.rightEye) rig.rightEye.scale.y = THREE.MathUtils.lerp(rig.rightEye.scale.y, eyeScaleY, partAlpha)

      renderer.render(scene, camera)
      frame = window.requestAnimationFrame(animate)
    }
    frame = window.requestAnimationFrame(animate)

    return () => {
      window.cancelAnimationFrame(frame)
      timer.dispose()
      motionPreference.removeEventListener('change', handleMotionPreference)
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost)
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return
        object.geometry.dispose()
        const materials = Array.isArray(object.material) ? object.material : [object.material]
        materials.forEach((material) => material.dispose())
      })
      renderer.dispose()
      renderer.forceContextLoss()
      if (renderer.domElement.parentElement === host) host.removeChild(renderer.domElement)
    }
  }, [bond, mascotId, size, webglFailed])

  if (webglFailed) {
    return (
      <CourierMascot
        mascotId={mascotId}
        bond={bond}
        care={care}
        size={size}
        stage="mini"
        className={className}
      />
    )
  }

  return (
    <div
      ref={hostRef}
      className={`mascot-webgl relative shrink-0 ${className}`}
      style={{ width: size, height: size }}
      data-mascot-3d={mascotId}
    />
  )
}
