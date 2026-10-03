import { F, x, y, group, oval, surface, patch, eye, polygon } from './soft2d3d.mjs'

export function buildSaetaFaithful() {
  const root = group('root')
  // One continuous egg-shaped body, as in the 2D drawing. Facial features and
  // crest move with it so animation cannot separate the head from the belly.
  const body = group('body', [0, y(45), 0])
  body.add(oval('body-base', 56, 60, 0.85, ['#c9efc9', '#8fd894']))
  const front = surface(50, 45, 56, 60, 0.85)
  body.add(patch('belly', 50, 57, 38, 30, '#f7fbec', front, 50, 45),
    patch('belly-mark-left', 46, 62, 6, 4, '#badfb8', front, 50, 45, 0.017),
    patch('belly-mark-right', 54, 65, 6, 4, '#badfb8', front, 50, 45, 0.017),
    patch('cheek-left', 25.5, 41, 9, 5, '#e8c3b0', front, 50, 45),
    patch('cheek-right', 74.5, 41, 9, 5, '#e8c3b0', front, 50, 45))
  const leftEye = eye('eyeL', 33.5, 33, 10, '#33503a', front, 45, true)
  const rightEye = eye('eyeR', 66.5, 33, 10, '#33503a', front, 45, true)
  body.add(leftEye, rightEye)
  const beak = polygon('beak-top', [[-6.5, -1.2], [0, -3], [6.5, -1.2], [0, 3]], 0.09, '#ffb451')
  beak.position.set(0, (45 - 39.5) * F, front(50, 39.5) + 0.035)
  const lower = polygon('beak-bottom', [[-3.5, 0], [3.5, 0], [0, 3]], 0.04, '#e8862e')
  lower.position.set(0, (45 - 41) * F, front(50, 41) + 0.015)
  body.add(lower, beak)
  for (const [i, cx, cy, w, h, angle, color] of [
    [0, 41.25, 12.5, 6.5, 11, -26, '#3aa85c'],
    [1, 50, 10.5, 7, 14, -4, '#5ec97a'],
    [2, 58.25, 12, 6.5, 11, 18, '#8fd894'],
  ]) {
    const crest = oval(`crest-${i}`, w, h, 0.13, [color], [x(cx), (45 - cy) * F, 0])
    crest.rotation.z = -angle * Math.PI / 180
    body.add(crest)
  }
  const wings = [-1, 1].map((side, i) => {
    const g = group(i ? 'wingR' : 'wingL', [x(i ? 68 : 32), y(48), -0.04])
    // Rounded shoulder, with the three feather notches of the SVG silhouette.
    const outline = [[0,-13],[12,-13],[23,-11],[29,-7],[31,-2],[30,6],[25,10],[19,12],[20,8],[12,11],[13,6],[5,7],[7,3],[0,1]]
    g.add(polygon(`wing-${i}`, outline.map(([px, py]) => [px * side, py]), 0.16, '#4fbd70'))
    g.rotation.z = (i ? -16 : 16) * Math.PI / 180
    return g
  })
  const tail = group('tail', [x(72), y(58), -0.19])
  tail.rotation.z = -28 * Math.PI / 180
  for (const [i, color] of ['#3aa85c', '#5ec97a', '#8fd894'].entries()) {
    const feather = oval(`tail-feather-${i}`, 22, 7.6, 0.12, [color], [12 * F, (6 - i * 6) * F, i * 0.01])
    feather.rotation.z = (14 - i * 14) * Math.PI / 180
    tail.add(feather)
  }
  const feet = [41, 59].map((cx, i) => {
    const g = group(i ? 'footR' : 'footL', [x(cx), y(73), 0])
    g.add(polygon(`foot-${i}`, [[-1.28,0],[1.28,0],[1.28,4.95],[4,9],[0.96,7.38],[0,9],[-0.96,7.38],[-4,9],[-1.28,4.95]], 0.09, '#ff9f3d'))
    return g
  })
  root.add(tail, ...wings, body, ...feet)
  return { root, body, leftEye, rightEye, leftWing: wings[0], rightWing: wings[1], tail, leftFoot: feet[0], rightFoot: feet[1] }
}
