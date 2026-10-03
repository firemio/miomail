// Shared geometry for the Makko/Saeta builders. Coordinates follow the SVG's
// percentage layout; depth is added without changing the front silhouette.
import * as THREE from 'three'

export const F = 0.0235
export const x = (v) => (v - 50) * F
export const y = (v) => (50 - v) * F
export const group = (name, position = [0, 0, 0]) => {
  const g = new THREE.Group()
  g.name = name
  g.position.set(...position)
  return g
}
export function material(color) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0 })
}
export function mesh(name, geometry, mat, position = [0, 0, 0]) {
  const m = new THREE.Mesh(geometry, mat)
  m.name = name
  m.position.set(...position)
  return m
}
export function oval(name, w, h, depth, colors, position = [0, 0, 0]) {
  const g = new THREE.SphereGeometry(0.5, 40, 28)
  const p = g.attributes.position
  const top = new THREE.Color(colors[0])
  const bottom = new THREE.Color(colors[1] ?? colors[0])
  const values = []
  for (let i = 0; i < p.count; i++) {
    const c = top.clone().lerp(bottom, 0.5 - p.getY(i))
    values.push(c.r, c.g, c.b)
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(values, 3))
  g.scale(w * F, h * F, depth)
  return mesh(name, g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), position)
}
// A colored oval following the surface of its host ellipsoid, instead of a
// floating disc. The same surface function locates eyes and facial stitches.
export function surface(cx, cy, w, h, depth, z = 0) {
  return (px, py) => z + depth / 2 * Math.sqrt(Math.max(0.015, 1 - ((px - cx) / (w / 2)) ** 2 - ((py - cy) / (h / 2)) ** 2))
}
export function patch(name, cx, cy, w, h, color, front, parentX = 50, parentY = 50, offset = 0.008) {
  const g = new THREE.CircleGeometry(1, 48)
  // Subdivide the interior, so broad patches conform to the curved host.
  const positions = [], indices = []
  for (let ring = 0; ring <= 12; ring++) {
    for (let i = 0; i <= 48; i++) {
      const a = i / 48 * Math.PI * 2
      const px = cx + Math.cos(a) * w / 2 * ring / 12
      const py = cy + Math.sin(a) * h / 2 * ring / 12
      positions.push((px - parentX) * F, (parentY - py) * F, front(px, py) + offset)
      if (ring && i) {
        const b = ring * 49 + i
        indices.push(b, b - 1, b - 50)
        if (ring > 1) indices.push(b, b - 50, b - 49)
      }
    }
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  g.setIndex(indices)
  g.deleteAttribute('normal')
  g.deleteAttribute('uv')
  g.computeVertexNormals()
  return mesh(name, g, material(color))
}
export function eye(name, cx, cy, diameter, color, front, parentY, doubleGlint = false) {
  const g = group(name, [x(cx), (parentY - cy) * F, 0])
  g.add(patch(`${name}-iris`, cx, cy, diameter, diameter, color, front, cx, cy, 0.018))
  const white = material('#ffffff')
  white.emissive.set('#ffffff')
  const glint = mesh(`${name}-highlight`, new THREE.SphereGeometry(1, 16, 12), white,
    [-diameter * F * 0.19, diameter * F * 0.21, front(cx - diameter * 0.19, cy - diameter * 0.21) + 0.027])
  glint.scale.set(diameter * F * 0.15, diameter * F * 0.15, 0.012)
  g.add(glint)
  if (doubleGlint) {
    const small = glint.clone()
    small.name = `${name}-glint`
    small.position.set(diameter * F * 0.22, -diameter * F * 0.18, front(cx + diameter * 0.22, cy + diameter * 0.18) + 0.027)
    small.scale.multiplyScalar(0.5)
    g.add(small)
  }
  return g
}
export function polygon(name, points, depth, color) {
  const shape = new THREE.Shape(points.map(([px, py]) => new THREE.Vector2(px * F, -py * F)))
  shape.closePath()
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 3, steps: 1 })
  g.translate(0, 0, -depth / 2)
  return mesh(name, g, material(color))
}
