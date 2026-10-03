import * as THREE from 'three'
import { F, x, y, group, oval, surface, patch, eye, mesh, material } from './soft2d3d.mjs'

export function buildMakkoFaithful() {
  const pink = ['#ffd9e6', '#ffb3cd']
  const root = group('root')
  const head = group('head', [0, y(33), 0.08])
  head.add(oval('head-base', 58, 42, 0.8, pink))
  const face = surface(50, 33, 58, 42, 0.8)
  const leftEye = eye('eyeL', 36.5, 32.5, 8, '#6b4249', face, 33)
  const rightEye = eye('eyeR', 63.5, 32.5, 8, '#6b4249', face, 33)
  head.add(leftEye, rightEye,
    patch('muzzle', 50, 42, 24, 15, '#fffafb', face, 50, 33),
    patch('cheek-left', 27, 41.25, 10, 5.5, '#ff9fbe', face, 50, 33),
    patch('cheek-right', 73, 41.25, 10, 5.5, '#ff9fbe', face, 50, 33),
    oval('nose', 8, 5.5, 0.06, ['#6b4249'], [0, (33 - 39.25) * F, face(50, 39.25) + 0.02]))
  const mouthPoints = [[50, 41.5], [50, 44.5]]
  const smile = Array.from({ length: 25 }, (_, i) => {
    const a = i / 24 * Math.PI
    return [50 - 5 * Math.cos(a), 43.5 + 4.5 * Math.sin(a)]
  })
  for (const [name, points, radius] of [['nose-stitch', mouthPoints, 0.014], ['smile', smile, 0.018]]) {
    const curve = new THREE.CatmullRomCurve3(points.map(([px, py]) => new THREE.Vector3(x(px), (33 - py) * F, face(px, py) + 0.02)))
    head.add(mesh(name, new THREE.TubeGeometry(curve, 32, radius, 8, false), material('#6b4249')))
  }
  const ears = [27.5, 72.5].map((cx, i) => {
    const g = group(i ? 'earR' : 'earL', [x(cx), (33 - 25) * F, -0.04])
    g.add(oval(`ear-${i}`, 21, 20, 0.24, pink, [0, 10 * F, 0]),
      oval(`ear-inner-${i}`, 11.34, 10.8, 0.045, ['#ffe0eb'], [0, 9.8 * F, 0.115]))
    head.add(g)
    return g
  })
  const body = group('body', [0, y(63), 0])
  const belly = surface(50, 63, 52, 34, 0.65)
  body.add(oval('torso', 52, 34, 0.65, pink), patch('belly', 50, 62, 30, 22, '#ffe0eb', belly, 50, 63))
  for (const sign of [-1, 1]) {
    const curve = new THREE.LineCurve3(
      new THREE.Vector3(-1.7 * F, (63 - 60.5 + sign * 1.7) * F, belly(48.3, 60.5 - sign * 1.7) + 0.02),
      new THREE.Vector3(1.7 * F, (63 - 60.5 - sign * 1.7) * F, belly(51.7, 60.5 + sign * 1.7) + 0.02))
    body.add(mesh(`belly-stitch-${sign}`, new THREE.TubeGeometry(curve, 2, 0.012, 8), material('#fb9fbd')))
  }
  const arms = [22, 78].map((cx, i) => {
    const g = group(i ? 'armR' : 'armL', [x(cx), y(52), 0])
    g.rotation.z = (i ? 18 : -18) * Math.PI / 180
    g.add(oval(`arm-${i}`, 14, 18, 0.26, ['#ffb3cd'], [0, -7 * F, 0]))
    return g
  })
  const feet = [35, 65].map((cx, i) => {
    const g = group(i ? 'footR' : 'footL', [x(cx), y(78), 0.08])
    g.add(oval(`foot-${i}`, 16, 12, 0.32, ['#ffb3cd']), oval(`foot-pad-${i}`, 8.5, 6.5, 0.035, ['#ffe0eb'], [0, -0.25 * F, 0.16]))
    return g
  })
  root.add(body, head, ...arms, ...feet)
  return { root, body, head, leftEye, rightEye, leftEar: ears[0], rightEar: ears[1], leftArm: arms[0], rightArm: arms[1], leftFoot: feet[0], rightFoot: feet[1] }
}
