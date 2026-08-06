// MioMail 既定キャラ「ミオ」— 2D MOD (mods/mio-svg/scene.json) を忠実に立体化した
// 3Dモデルビルダー。scripts/export-3d-mods/export.mjs から呼ばれ、GLBへ焼き出される。
//
// 座標変換規約:
//   2D viewBox は 96×96 で、scene.json の left/top/width/height は % 値。
//   3D はキャラ全高約 2.35 units: 1% = 0.96px = 0.96 × (2.35/96) units = F ≈ 0.0235
//   x = (x% − 50) × F (画面右 = +X) / y = (50 − y%) × F + Y_SHIFT (足元 y ≈ −1.10)
//   奥行き(Z)は「2Dと同じ重なり順」を最優先に、幅の50〜70%程度のぬいぐるみ的な丸みで設計。
//   頭は 2D の z 順(head 36 > torso 22)を再現するため +Z へ 0.10 オフセット。
//
// 制約:
//   - マテリアルは MeshStandardMaterial のみ(グラデーションは頂点カラー COLOR_0 で表現)
//   - morphAttributes なし / userData 不使用 / 全ノードに一意な名前
//   - 目(eyeL/eyeR)は scale=1 の Group。中心が原点で scale.y の縮小がまばたきになる

import * as THREE from 'three'

const U = 2.35 / 96 // units per px
const F = 0.96 * U // units per %(96px箱では 1% = 0.96px)
const Y_SHIFT = -0.06
const DEG = Math.PI / 180

const px = (v) => (v - 50) * F // x%: 中心=0
const py = (v) => (50 - v) * F + Y_SHIFT // y%: 上が+

// ---- scene.json 由来の色 ----------------------------------------------------
// 胴・腕・脚: linear #fffdfa → #f8f0e9(72〜76%) → #e7ded9
const TORSO_STOPS = [
  [0, '#fffdfa'],
  [0.76, '#f8f0e9'],
  [1, '#e7ded9'],
]
const LIMB_STOPS = [
  [0, '#fffdfa'],
  [0.72, '#f8f0e9'],
  [1, '#e7ded9'],
]
// torso-mark: #87878a→#aeabad を opacity .74 で白地に重ねた実効色 → 下端は胴色へ溶かす
const MARK_STOPS = [
  [0, '#a2a2a4'],
  [0.5, '#c3c0c1'],
  [1, '#ded9d6'],
]
// stripe: #87878a→#aeabad→transparent を opacity .78 / .68 で白地に重ねた実効色
const STRIPE_CENTER_STOPS = [
  [0, '#a1a1a4'],
  [0.58, '#b4b1b3'],
  [1, '#e9e2dd'],
]
const STRIPE_SIDE_STOPS = [
  [0, '#ababae'],
  [0.58, '#c0bdbf'],
  [1, '#eae3de'],
]
const HEAD_FILL = '#fffdfa'
const EDGE_COLOR = '#b1adaf' // rgba(98,91,94,.5) を白地に重ねた実効色(輪郭線)
const EAR_INNER = '#efacb9'
const NOSE_PINK = '#f7aebc' // #ffc3cf→#ef99aa の中間
const MOUTH_COLOR = '#a87378'
const WHISKER_COLOR = '#c6c0c0' // rgba(142,132,132,.5) を白地に重ねた実効色
const IRIS_DARK = '#1a1b20' // #17191e / #26252b 系
const EYE_RING = '#6f6769' // border rgba(91,83,85,.88) の実効色
const EYE_AMBER = '#e4c7ad' // rgba(214,168,127,.64) の実効色
const TAIL_GRAY = '#cbc5c4'

// ---- ヘッドの寸法(head svg: left 5 / top 0 / w 90 / h 71.5, viewBox 721×575) ----
// head-base パスは svg x 0..720 / y 35..574 を占める
const HEAD_CY = py(37.87) // ≈ 0.225 (svg y 中心 304.5 → 37.87%)
const HEAD_HX = (89.9 / 2) * F // ≈ 1.056 (svg 幅 720/721 ≒ 89.9%)
const HEAD_HY = (67.03 / 2) * F // ≈ 0.788 (svg 高 539/575 ≒ 67.03%)
const HEAD_RZ = 0.62 // 奥行き半径(幅の約59%)
const HEAD_Z = 0.1 // 2D z順(head > torso)再現の前方オフセット
const hy = (v) => py(v) - HEAD_CY // ヘッド相対 y

// head-base パスをy帯域ごとにサンプリングした半幅プロファイル [高さ位置0(頂)..1(顎), 半幅比]。
// まん丸ではない: 側面はほぼ垂直(≈0.90)、最大幅は高さ61〜66%の頬(≈0.98)、顎は広め(≈0.59)
const HEAD_PROFILE = [
  // 頂部は実測(0.29/0.35)より広めに取り、耳の付け根が頭に乗る肩を作る
  [0.0, 0.12], [0.023, 0.34], [0.068, 0.46], [0.114, 0.62], [0.159, 0.76],
  [0.205, 0.881], [0.25, 0.895], [0.295, 0.906], [0.341, 0.907], [0.386, 0.904],
  [0.432, 0.896], [0.477, 0.904], [0.523, 0.926], [0.568, 0.963], [0.614, 0.98],
  [0.659, 0.983], [0.705, 0.968], [0.75, 0.945], [0.795, 0.911], [0.841, 0.868],
  [0.886, 0.777], [0.932, 0.667], [0.977, 0.589], [1.0, 0.3],
]

// プロファイルの回転体(lathe)。正面シルエットが2Dの頭の形と一致する
function headGeometry(scaleR = 1, scaleY = 1) {
  const points = []
  points.push(new THREE.Vector2(0.001, -HEAD_HY * scaleY))
  for (let k = HEAD_PROFILE.length - 1; k >= 0; k -= 1) {
    const [t, r] = HEAD_PROFILE[k]
    points.push(new THREE.Vector2(Math.max(r * HEAD_HX * scaleR, 0.002), (0.5 - t) * 2 * HEAD_HY * scaleY))
  }
  points.push(new THREE.Vector2(0.001, HEAD_HY * scaleY))
  // 注意: LatheGeometry純正の法線をそのまま使う。computeVertexNormals()で上書きすると
  // 継ぎ目(0/2π)の頂点が分断されたまま平均化され、縦筋のシェーディングむらが出る
  return new THREE.LatheGeometry(points, 48)
}

// ---- ヘルパー(legacy3d.mjs の流儀を踏襲) -----------------------------------
function soft(color, roughness = 0.88) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 })
}

function glossy(color) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.22, metalness: 0 })
}

// 目のハイライト: 照明非依存の白(emissive 同色の Standard)
function highlightMaterial() {
  return new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', roughness: 1 })
}

function mesh(name, geometry, material, position, scale = [1, 1, 1], rotation = [0, 0, 0]) {
  const result = new THREE.Mesh(geometry, material)
  result.name = name
  result.position.set(...position)
  result.scale.set(...scale)
  result.rotation.set(...rotation)
  result.castShadow = true
  result.receiveShadow = true
  return result
}

function group(name, position = [0, 0, 0], rotationZ = 0) {
  const result = new THREE.Group()
  result.name = name
  result.position.set(...position)
  result.rotation.z = rotationZ
  return result
}

// 上下グラデーションを頂点カラー(COLOR_0: glTFコア機能)で焼いた球。
// stops: [[t(0=上..1=下), '#hex'], ...]
function gradientSphereGeometry(stops, widthSegments = 32, heightSegments = 24) {
  const geometry = new THREE.SphereGeometry(0.5, widthSegments, heightSegments)
  const position = geometry.attributes.position
  const parsed = stops.map(([at, hex]) => ({ at, color: new THREE.Color(hex) }))
  const colors = new Float32Array(position.count * 3)
  const c = new THREE.Color()
  for (let i = 0; i < position.count; i += 1) {
    const t = Math.min(1, Math.max(0, 0.5 - position.getY(i)))
    let a = parsed[0]
    let b = parsed[parsed.length - 1]
    for (let s = 0; s < parsed.length - 1; s += 1) {
      if (t >= parsed[s].at && t <= parsed[s + 1].at) {
        a = parsed[s]
        b = parsed[s + 1]
        break
      }
    }
    const w = b.at > a.at ? Math.min(1, Math.max(0, (t - a.at) / (b.at - a.at))) : 0
    c.copy(a.color).lerp(b.color, w)
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geometry
}

export function buildMioFaithful() {
  const gradMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 })
  const sphere = new THREE.SphereGeometry(0.5, 32, 24)
  const sphereLo = new THREE.SphereGeometry(0.5, 16, 12)

  const root = group('root')

  // ---- 胴 (torso: left 36.5 / top 64 / w 27 / h 23.5, z22) ------------------
  const body = group('body', [0, py(75.75), 0])
  body.add(
    // 1px相当の輪郭(4方向drop-shadow)をひと回り大きい暗色シェルで再現
    mesh('torso-rim', sphere, soft(EDGE_COLOR, 0.95), [0, 0, -0.025], [27.9 * F, 24.3 * F, 0.38]),
    mesh('torso', gradientSphereGeometry(TORSO_STOPS), gradMat, [0, 0, 0], [27 * F, 23.5 * F, 0.4]),
  )
  // 肩のシルバーグレー柄 (torso-mark-left/right: 胴ローカル上端の左右パッチ)
  const markGeo = gradientSphereGeometry(MARK_STOPS)
  body.add(
    mesh('torso-mark-left', markGeo, gradMat, [-0.206, 0.155, 0], [0.25, 0.27, 0.43]),
    mesh('torso-mark-right', markGeo, gradMat, [0.206, 0.155, 0], [0.25, 0.27, 0.43]),
  )
  // 胸の白 (chest + chest-belly を1つの前面楕円体に統合)
  body.add(mesh('chest', sphere, soft('#ffffff', 0.95), [0, 0.033, 0.13], [0.355, 0.431, 0.2]))

  // ---- 腕 (arm-left/right: 支点=肩、rotate ±15°) -----------------------------
  // ぬいぐるみらしい丸いミトン腕1本ずつ。グレーのキャップ玉は廃止(ごちゃつきの原因)
  const pawWhite = soft('#fdfaf6', 0.9)
  const armCapsule = new THREE.CapsuleGeometry(0.1, 0.13, 6, 16)
  const leftArm = group('armL', [px(34.9), py(70.63), 0.06], -15 * DEG)
  leftArm.add(
    mesh('arm-left', armCapsule, pawWhite, [-0.035, -0.155, 0], [1, 1, 0.75], [0, 0, -8 * DEG]),
    // 先端のぷにっとした肉球側のふくらみ
    mesh('arm-left-paw', sphereLo, pawWhite, [-0.05, -0.27, 0.02], [0.16, 0.14, 0.13]),
  )
  const rightArm = group('armR', [px(65.1), py(70.63), 0.06], 15 * DEG)
  rightArm.add(
    mesh('arm-right', armCapsule, pawWhite, [0.035, -0.155, 0], [1, 1, 0.75], [0, 0, 8 * DEG]),
    mesh('arm-right-paw', sphereLo, pawWhite, [0.05, -0.27, 0.02], [0.16, 0.14, 0.13]),
  )

  // ---- 脚 (leg-left/right, rotate ±2°) — rig は foot 扱い ---------------------
  // まんまるのぷにっとした足。前面にちょこんと出るシンプルな楕円体1つずつ
  const leftFoot = group('footL', [px(41.6), py(83.3), 0.05], -2 * DEG)
  leftFoot.add(mesh('leg-left', sphere, pawWhite, [0, -0.075, 0.02], [0.29, 0.21, 0.26]))
  const rightFoot = group('footR', [px(58.4), py(83.3), 0.05], 2 * DEG)
  rightFoot.add(mesh('leg-right', sphere, pawWhite, [0, -0.075, 0.02], [0.29, 0.21, 0.26]))

  // ---- 尾 (2D正面絵には無い。胴の後ろ(-Z)の控えめな1本。支点=根本) -----------
  const tail = group('tail', [0.16, -0.86, -0.18])
  const tailCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.1, 0.1, -0.06),
    new THREE.Vector3(0.14, 0.34, -0.14),
    new THREE.Vector3(0.04, 0.54, -0.24),
  ])
  tail.add(
    mesh('tail-mesh', new THREE.TubeGeometry(tailCurve, 24, 0.055, 10, false), soft(TAIL_GRAY, 0.9), [0, 0, 0]),
    mesh('tail-tip', sphereLo, soft('#b7b2b1', 0.9), [0.04, 0.54, -0.24], [0.12, 0.12, 0.12]),
  )

  // ---- 頭 (head svg: z36。head-baseパスの実プロファイルによる回転体) ----------
  const head = group('head', [0, HEAD_CY, HEAD_Z])
  const headDepth = HEAD_RZ / HEAD_HX // 奥行きは幅の約59%へ圧縮
  head.add(
    // 輪郭線 #77767d 相当: ひと回り大きい暗色シェル。前面がグレージング角で
    // 透けてまだらに見えないよう、奥行きを浅くして後方へ引く
    mesh('head-rim', headGeometry(1.02, 1.03), soft(EDGE_COLOR, 0.95), [0, 0, -0.08], [1, 1, headDepth * 0.92]),
    mesh('head-base', headGeometry(), soft(HEAD_FILL, 0.92), [0, 0, 0], [1, 1, headDepth]),
  )

  // ---- 耳 (ear-left/right: アメリカンカールの反り耳。支点=付け根、rig earL/earR) --
  // svg: 左耳 x 61..224 / y 0..180 → 付け根中心 svg(141,150) ≈ (22.6%, 18.65%)
  // コーンの上部を後方へ滑らかに反らせて「くるん」を作る(bendStartより上を
  // X軸まわりに徐々に回転させ、先端でbendAngleに達するease-inカール)
  const curledCone = (radius, height, bendStart, bendAngle, radialSegments = 24, heightSegments = 18) => {
    const geometry = new THREE.ConeGeometry(radius, height, radialSegments, heightSegments)
    const position = geometry.attributes.position
    const y0 = -height / 2 + height * bendStart
    const span = height / 2 - y0
    const v = new THREE.Vector3()
    for (let i = 0; i < position.count; i += 1) {
      v.fromBufferAttribute(position, i)
      if (v.y <= y0) continue
      const t = Math.min((v.y - y0) / span, 1)
      const angle = bendAngle * t * t
      const dy = v.y - y0
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      // 後方(-Z)へ反らせる
      position.setY(i, y0 + dy * cos - v.z * sin)
      position.setZ(i, -(dy * sin) + v.z * cos)
    }
    geometry.computeVertexNormals()
    return geometry
  }
  // 立ち上がりをしっかり残し、先端1/3だけを後ろへ反らせる(反り約63°)
  const earConeRim = curledCone(0.3, 0.78, 0.62, 1.1)
  const earConeOut = curledCone(0.275, 0.74, 0.62, 1.1)
  const earConeIn = curledCone(0.165, 0.54, 0.58, 0.95, 18, 14)
  const makeEar = (name, prefix, sideSign) => {
    // sideSign: 左 = -1 / 右 = +1。先端はやや内側へ反る(svg: 付け根中心141→先端188)
    // 頭の前面ドーム(z≈0.56)に隠れないよう、付け根は頭頂線の高さ・やや前寄りに置く
    const ear = group(name, [sideSign * 0.56, hy(16), 0.16], sideSign * 0.22)
    ear.rotation.x = -0.04
    ear.add(
      mesh(`${prefix}-rim`, earConeRim, soft(EDGE_COLOR, 0.95), [0, 0.24, -0.02], [1, 1, 0.55]),
      mesh(`${prefix}-out`, earConeOut, soft(HEAD_FILL, 0.9), [0, 0.25, 0], [1, 1, 0.55]),
      // 内耳(ピンク)は外殻の前面より手前に出して、正面からしっかり覗かせる
      mesh(`${prefix}-inner`, earConeIn, soft(EAR_INNER, 0.7), [0, 0.23, 0.145], [1.1, 1.05, 0.3]),
    )
    return ear
  }
  const leftEar = makeEar('earL', 'ear-left', -1)
  const rightEar = makeEar('earR', 'ear-right', 1)
  head.add(leftEar, rightEar)

  // ---- 頭上部の3本縞 (stripe-center/left/right: z43) -------------------------
  const stripeCenterGeo = gradientSphereGeometry(STRIPE_CENTER_STOPS)
  const stripeSideGeo = gradientSphereGeometry(STRIPE_SIDE_STOPS)
  head.add(
    mesh('stripe-center', stripeCenterGeo, gradMat, [0, hy(26.25), 0.545], [6 * F, 18.5 * F, 0.1], [-0.3, 0, 0]),
    mesh('stripe-left', stripeSideGeo, gradMat, [px(42.25), hy(24.5), 0.52], [4.5 * F, 15 * F, 0.09], [-0.3, 0, 12 * DEG]),
    mesh('stripe-right', stripeSideGeo, gradMat, [px(57.75), hy(24.5), 0.52], [4.5 * F, 15 * F, 0.09], [-0.3, 0, -12 * DEG]),
  )

  // ---- マズル (muzzle: left 31 / top 43 / w 38 / h 19, z45) ------------------
  head.add(mesh('muzzle', sphere, soft('#ffffff', 0.95), [0, hy(52.5), 0.5], [38 * F, 19 * F, 0.24]))

  // ---- 目 (eye-left/right: w 15.5, z52。Group原点=目の中心、scale.yでまばたき) --
  // 黒目だけのシンプル仕様(白目・縁・琥珀は無し)。キャッチライト2点で生気を出す
  const makeEye = (name, prefix, x) => {
    const D = 15.5 * F // 目の直径 ≈ 0.364
    const eye = group(name, [x, hy(44.25), 0.575])
    eye.add(
      mesh(`${prefix}-iris`, sphere, glossy(IRIS_DARK), [0, 0, 0], [D, D, 0.15]),
      // 白ハイライト大(left 22/top 14/w 24/h 25, rotate 18)
      mesh(`${prefix}-glint-a`, sphereLo, highlightMaterial(), [-0.058, 0.086, 0.072], [0.24 * D, 0.25 * D, 0.05], [0, 0, -18 * DEG]),
      // 白ハイライト小(right 18/top 42/w 9/h 10)
      mesh(`${prefix}-glint-b`, sphereLo, highlightMaterial(), [0.1, 0.011, 0.078], [0.09 * D, 0.1 * D, 0.036]),
    )
    return eye
  }
  const leftEye = makeEye('eyeL', 'eye-left', px(34.75))
  const rightEye = makeEye('eyeR', 'eye-right', px(65.25))
  head.add(leftEye, rightEye)

  // ---- 鼻 (nose: left 47 / top 50.5 / w 6 / h 4.2, z58) ----------------------
  head.add(
    mesh('nose', sphere, glossy(NOSE_PINK), [0, hy(52.6), 0.63], [6 * F, 4.2 * F, 0.07]),
    mesh('nose-glint', sphereLo, highlightMaterial(), [-0.02, hy(52.6) + 0.023, 0.664], [0.035, 0.02, 0.015]),
  )

  // ---- ω口 (mouth-stem + mouth-left/right: z56。細トーラス半弧×2+短柱) --------
  const mouthArcGeo = new THREE.TorusGeometry(0.075, 0.0085, 8, 20, Math.PI)
  const mouthMat = soft(MOUTH_COLOR, 0.6)
  head.add(
    mesh('mouth-stem', new THREE.CylinderGeometry(0.0065, 0.0065, 3.2 * F, 8), mouthMat, [0, hy(55.7), 0.615]),
    // borderBottom の下弧 → 上弧トーラスを180°回転。CSS rotate ±6° は逆符号でZ回転
    mesh('mouth-left', mouthArcGeo, mouthMat, [px(46.75), hy(56.7), 0.615], [1, 0.72, 1], [0, 0, Math.PI - 6 * DEG]),
    mesh('mouth-right', mouthArcGeo, mouthMat, [px(53.25), hy(56.7), 0.615], [1, 0.72, 1], [0, 0, Math.PI + 6 * DEG]),
  )

  // ---- ひげ6本 (whisker-left/right-1..3: z50。頬の支点から外へ細円柱) ----------
  // CSS rotate θ → three rotation.z = -θ(左右とも。左は-X方向、右は+X方向へ伸ばす)
  const whiskerMat = soft(WHISKER_COLOR, 1)
  const whiskerGeoShort = new THREE.CylinderGeometry(0.0095, 0.0095, 22 * F, 6)
  const whiskerGeoLong = new THREE.CylinderGeometry(0.0095, 0.0095, 24 * F, 6)
  const whiskerSpecs = [
    { row: 1, y: hy(44.5), z: 0.43, geo: whiskerGeoShort, len: 22 * F, deg: 7 },
    { row: 2, y: hy(48.5), z: 0.4, geo: whiskerGeoLong, len: 24 * F, deg: 1 },
    { row: 3, y: hy(52.5), z: 0.36, geo: whiskerGeoShort, len: 22 * F, deg: -6 },
  ]
  for (const spec of whiskerSpecs) {
    const wl = group(`whiskerL${spec.row}`, [px(17), spec.y, spec.z], -spec.deg * DEG)
    wl.add(mesh(`whisker-left-${spec.row}`, spec.geo, whiskerMat, [-spec.len / 2, 0, 0], [1, 1, 1], [0, 0, Math.PI / 2]))
    const wr = group(`whiskerR${spec.row}`, [px(83), spec.y, spec.z], spec.deg * DEG)
    wr.add(mesh(`whisker-right-${spec.row}`, spec.geo, whiskerMat, [spec.len / 2, 0, 0], [1, 1, 1], [0, 0, Math.PI / 2]))
    head.add(wl, wr)
  }

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
  }
}
