// posty2d3d.mjs — 2D MOD (mods/posty-svg/scene.json) を忠実に立体化したポスティ。
// ブリキのレトロ配達ロボ。正面(+Z)から見たシルエット・比率・色を2D版と一致させる。
//
// 座標系: 2D viewBox 96×96 → 全高約2.35ユニット。
//   S = 0.96 × (2.35 / 96) = 0.0235 units/%(96px箱では 1% = 0.96px)
//   Y_OFF = -0.30 で全体を下げ、足裏を y ≈ -1.11 に合わせる(rootは原点付近)。
// 奥行きは scene.json の z 序列(重なり順)を保ちつつ、幅の50〜70%程度の
// ぬいぐるみ的押し出しで設計。色は scene.json の実値を厳守。
// opacity 付きの装飾(シーム/グリル/傷/サビ)は下地色へ事前合成した不透明色で近似
// (GLB拡張禁止のため transparent を使わない)。
// マテリアルは MeshStandardMaterial のみ。頭・胴の上下グラデーションは
// 頂点カラー(COLOR_0 = glTFコア機能)で焼き込む。

import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

const S = 0.96 * (2.35 / 96) // = 0.0235 units per %
const Y_OFF = -0.3

const px = (v) => v * S // %長 → ユニット長
const cx = (left, width) => (left + width / 2 - 50) * S // left%基準の中心X
const cxr = (right, width) => (50 - right - width / 2) * S // right%基準の中心X
const cy = (top, height) => (50 - (top + height / 2)) * S + Y_OFF // 中心Y(上下反転)

// scene.json の実色
const SHELL_TOP = '#b9d2f9'
const SHELL_BOTTOM = '#7ca4ee'
const BLUE = '#3a63d8'
const BLUE_DARK = '#3557c4'
const NAVY = '#2c4bb0'
const SLOT_NAVY = '#1d3464'
const GREY = '#8fa3c8'
const GREY_DARK = '#5f739c'
const BEACON_RED = '#ff6b6b'
const LAMP_YELLOW = '#ffd166'
const METER_CREAM = '#f4f0e4'
const NEEDLE_RED = '#e0524d'
const LETTER_WHITE = '#ffffff'
// opacity付きパーツの事前合成色(下地=頭/胴のグラデ該当位置の色)
const SEAM_BAKED = '#7390d7' // head-seam: #2c4bb0 α0.45 over 頭上部
const GRILL_BAKED = '#4363c0' // grill: #2c4bb0 α0.75 over 頭下部
const DENT1_BAKED = '#7b98da' // dent-scratch-1: α0.4
const DENT2_BAKED = '#89a5e2' // dent-scratch-2: α0.3
const RUST1_BAKED = '#9b9495' // rust-1: #b08a5a α0.6 over 胴下部
const RUST2_BAKED = '#9398ab' // rust-2: #b08a5a α0.45

// ブリキ金属(legacy3dのmetal相当。色はsceneの実値をそのまま使う)
function metalMat(color, opts = {}) {
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.42,
    metalness: opts.metalness ?? 0.6,
    vertexColors: opts.vertexColors ?? false,
  })
  if (opts.emissive) {
    material.emissive.copy(new THREE.Color(opts.emissive).multiplyScalar(opts.emissiveScale ?? 1))
  }
  return material
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

function group(name, position = [0, 0, 0]) {
  const result = new THREE.Group()
  result.name = name
  result.position.set(...position)
  return result
}

// linearグラデ(上→下)を頂点カラーで焼き込む。マテリアル側は白+vertexColors。
function verticalGradient(geometry, topHex, bottomHex) {
  geometry.computeBoundingBox()
  const { min, max } = geometry.boundingBox
  const range = Math.max(1e-6, max.y - min.y)
  const top = new THREE.Color(topHex)
  const bottom = new THREE.Color(bottomHex)
  const positions = geometry.attributes.position
  const colors = new Float32Array(positions.count * 3)
  const c = new THREE.Color()
  for (let i = 0; i < positions.count; i += 1) {
    const t = (positions.getY(i) - min.y) / range
    c.copy(bottom).lerp(top, t)
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geometry
}

// 正面(+Z)向きの円盤(メーター/ゼンマイ用)。半径1・厚み1をscaleで整形する。
function zDisc(radialSegments = 28) {
  const geometry = new THREE.CylinderGeometry(1, 1, 1, radialSegments)
  geometry.rotateX(Math.PI / 2)
  return geometry
}

export function buildPostyFaithful() {
  const root = group('root')

  // ---- 胴体 (torso: left24 top50 52x27, グラデ #b9d2f9→#7ca4ee) ----
  const bodyY = cy(50, 27) // -0.6173
  const body = group('body', [0, bodyY, 0])
  const by = (top, height) => cy(top, height) - bodyY // body ローカルY
  const TORSO_W = px(52) // 1.222
  const TORSO_H = px(27) // 0.6345
  const TORSO_D = 0.62 // 幅の約50%の押し出し
  body.add(
    mesh(
      'torso',
      verticalGradient(new RoundedBoxGeometry(TORSO_W, TORSO_H, TORSO_D, 4, 0.16), SHELL_TOP, SHELL_BOTTOM),
      metalMat('#ffffff', { vertexColors: true, roughness: 0.4, metalness: 0.55 }),
      [0, 0, 0]
    )
  )

  // torso-rivet-left/right (2.2x2.2 #5f739c) — 胴前面の角丸を避けて少し埋める
  const rivetGeo = new THREE.SphereGeometry(1, 16, 12)
  const rivetMat = metalMat(GREY_DARK, { roughness: 0.38, metalness: 0.65 })
  body.add(mesh('torsoRivetL', rivetGeo, rivetMat, [cx(27, 2.2), by(52, 2.2), 0.26], [0.026, 0.026, 0.016]))
  body.add(mesh('torsoRivetR', rivetGeo, rivetMat, [-cx(27, 2.2), by(52, 2.2), 0.26], [0.026, 0.026, 0.016]))

  // mail-slot (left37 top54.5 26x4.5 #1d3464) + mail-letter (白)
  body.add(
    mesh(
      'mailSlot',
      new RoundedBoxGeometry(px(26), px(4.5), 0.06, 2, 0.025),
      metalMat(SLOT_NAVY, { roughness: 0.5, metalness: 0.5 }),
      [cx(37, 26), by(54.5, 4.5), 0.3]
    )
  )
  body.add(
    mesh(
      'mailLetter',
      new THREE.BoxGeometry(px(21), px(2.6), 0.025),
      metalMat(LETTER_WHITE, { roughness: 0.9, metalness: 0 }), // 紙
      [cx(39.5, 21), by(55.4, 2.6), 0.33]
    )
  )

  // meter (left35 top62 12x9 クリーム地 + #5f739c縁) + meter-needle (回転36° 支点=下端中央)
  const meterX = cx(35, 12)
  const meterY = by(62, 9)
  body.add(mesh('meterRim', zDisc(28), metalMat(GREY_DARK, { roughness: 0.4, metalness: 0.6 }), [meterX, meterY, 0.295], [px(12) / 2 + 0.009, px(9) / 2 + 0.009, 0.04]))
  body.add(mesh('meterFace', zDisc(28), metalMat(METER_CREAM, { roughness: 0.6, metalness: 0.1 }), [meterX, meterY, 0.312], [px(12) / 2 - 0.006, px(9) / 2 - 0.006, 0.03]))
  const needleGeo = new THREE.BoxGeometry(px(1.4), px(4), 0.018)
  needleGeo.translate(0, px(4) / 2, 0) // 支点を下端中央へ(transformOrigin [50,100])
  body.add(
    mesh(
      'meterNeedle',
      needleGeo,
      metalMat(NEEDLE_RED, { roughness: 0.45, metalness: 0.3 }),
      [cx(40, 1.4), (50 - (64 + 4)) * S + Y_OFF - bodyY, 0.335], // 2Dの支点位置(下端)
      [1, 1, 1],
      [0, 0, THREE.MathUtils.degToRad(-36)] // CSS rotate 36°(時計回り) → three -36°
    )
  )

  // windup-key (right20 top59 7x7 円盤 + #5f739c内縁) + windup-key-stem (縦棒)
  const keyX = cxr(20, 7)
  const keyY = by(59, 7)
  body.add(mesh('windupKeyDisc', zDisc(24), metalMat(GREY, { roughness: 0.38, metalness: 0.65 }), [keyX, keyY, 0.3], [px(7) / 2, px(7) / 2, 0.05]))
  body.add(
    mesh(
      'windupKeyRim',
      new THREE.TorusGeometry(px(7) / 2 - 0.021, 0.012, 10, 28),
      metalMat(GREY_DARK, { roughness: 0.4, metalness: 0.6 }),
      [keyX, keyY, 0.328]
    )
  )
  body.add(
    mesh(
      'windupKeyStem',
      new THREE.CapsuleGeometry(px(2) / 2, px(11) - px(2), 4, 12),
      metalMat(GREY_DARK, { roughness: 0.4, metalness: 0.6 }),
      [cxr(22.5, 2), by(57, 11), 0.262]
    )
  )

  // rust-1/2 (右下のサビ。α合成済みの色で薄い膨らみとして)
  const rustMat1 = metalMat(RUST1_BAKED, { roughness: 0.8, metalness: 0.2 })
  const rustMat2 = metalMat(RUST2_BAKED, { roughness: 0.8, metalness: 0.2 })
  body.add(mesh('rust1', rivetGeo, rustMat1, [cxr(29, 5), by(71, 3), 0.295], [px(5) / 2, px(3) / 2, 0.012]))
  body.add(mesh('rust2', rivetGeo, rustMat2, [cxr(27, 3.4), by(73, 2), 0.272], [px(3.4) / 2, px(2) / 2, 0.01]))

  // neck (left41 top45.5 18x7): ハードストップ縞 → 積層円柱のジャバラ
  // 縞: #8fa3c8 0-44.6% / #3a63d8 44.6-89.3% / #8fa3c8 89.3-100%
  const neckTopWorld = (50 - 45.5) * S + Y_OFF
  const neckH = px(7)
  const neckR = px(18) / 2
  const neckBands = [
    { color: GREY, from: 0, to: 44.6, r: neckR },
    { color: BLUE, from: 44.6, to: 89.3, r: neckR + 0.007 }, // 中段をわずかに膨らませて蛇腹感
    { color: GREY, from: 89.3, to: 100, r: neckR },
  ]
  neckBands.forEach((band, index) => {
    const h = ((band.to - band.from) / 100) * neckH
    const centerWorld = neckTopWorld - (((band.from + band.to) / 2) / 100) * neckH
    body.add(
      mesh(
        `neckBand${index + 1}`,
        new THREE.CylinderGeometry(band.r, band.r, h, 24),
        metalMat(band.color, { roughness: 0.45, metalness: 0.55 }),
        [cx(41, 18), centerWorld - bodyY, -0.02]
      )
    )
  })

  // ---- 頭 (head: left19 top11 62x34, グラデ #b9d2f9→#7ca4ee) ----
  const headY = cy(11, 34) // 0.217
  const HEAD_Z = 0.05 // 2D z序列(head32 > torso24)を薄く反映
  const head = group('head', [0, headY, HEAD_Z])
  const hy = (top, height) => cy(top, height) - headY // head ローカルY
  const HEAD_W = px(62) // 1.457
  const HEAD_H = px(34) // 0.799
  const HEAD_D = 0.78 // 幅の約54%
  head.add(
    mesh(
      'headShell',
      verticalGradient(new RoundedBoxGeometry(HEAD_W, HEAD_H, HEAD_D, 4, 0.18), SHELL_TOP, SHELL_BOTTOM),
      metalMat('#ffffff', { vertexColors: true, roughness: 0.4, metalness: 0.55 }),
      [0, 0, 0]
    )
  )

  // head-seam (left22 top17 56x2.1, α0.45合成色の帯)
  head.add(
    mesh(
      'headSeam',
      new THREE.BoxGeometry(px(56), px(2.1), 0.02),
      metalMat(SEAM_BAKED, { roughness: 0.5, metalness: 0.5 }),
      [cx(22, 56), hy(17, 2.1), 0.382]
    )
  )

  // head-rivet tl/tr/bl/br (2.4x2.4 #5f739c)
  const headRivetScale = [0.028, 0.028, 0.018]
  head.add(mesh('headRivetTL', rivetGeo, rivetMat, [cx(23, 2.4), hy(13.5, 2.4), 0.345], headRivetScale))
  head.add(mesh('headRivetTR', rivetGeo, rivetMat, [-cx(23, 2.4), hy(13.5, 2.4), 0.345], headRivetScale))
  head.add(mesh('headRivetBL', rivetGeo, rivetMat, [cx(23, 2.4), hy(40, 2.4), 0.345], headRivetScale))
  head.add(mesh('headRivetBR', rivetGeo, rivetMat, [-cx(23, 2.4), hy(40, 2.4), 0.345], headRivetScale))

  // ear-bolt-left/right (6x9 #8fa3c8) + core (3x4 #5f739c) — 頭側面の耳ボルト
  const earBoltGeo = new THREE.SphereGeometry(1, 20, 14)
  const earBoltMat = metalMat(GREY, { roughness: 0.4, metalness: 0.62 })
  const earCoreMat = metalMat(GREY_DARK, { roughness: 0.4, metalness: 0.62 })
  const earBoltY = hy(24, 9)
  head.add(mesh('earBoltL', earBoltGeo, earBoltMat, [cx(13, 6), earBoltY, 0], [px(6) / 2, px(9) / 2, px(9) / 2]))
  head.add(mesh('earBoltR', earBoltGeo, earBoltMat, [-cx(13, 6), earBoltY, 0], [px(6) / 2, px(9) / 2, px(9) / 2]))
  head.add(mesh('earBoltCoreL', earBoltGeo, earCoreMat, [cx(11, 3), hy(26.5, 4), 0], [px(3) / 2, px(4) / 2, px(4) / 2]))
  head.add(mesh('earBoltCoreR', earBoltGeo, earCoreMat, [-cx(11, 3), hy(26.5, 4), 0], [px(3) / 2, px(4) / 2, px(4) / 2]))

  // eye-rim-left/right (13x13, グラデ #8fa3c8→#5f739c の縁)
  const eyeRimGeo = verticalGradient(zDisc(28), GREY, GREY_DARK)
  const eyeRimMat = metalMat('#ffffff', { vertexColors: true, roughness: 0.38, metalness: 0.62 })
  const eyeX = cx(31.5, 8) // = eye-rim中心と同軸 (-0.3408)
  const eyeYLocal = hy(23, 8) // 0.0235
  head.add(mesh('eyeRimL', eyeRimGeo, eyeRimMat, [eyeX, eyeYLocal, 0.372], [px(13) / 2, px(13) / 2, 0.045]))
  head.add(mesh('eyeRimR', eyeRimGeo, eyeRimMat, [-eyeX, eyeYLocal, 0.372], [px(13) / 2, px(13) / 2, 0.045]))

  // eye-lamp-left/right (8x8 #ffd166 発光気味) — まばたきは eyeL/eyeR の scale.y で表現
  const lampGeo = new THREE.SphereGeometry(px(8) / 2, 24, 16)
  const lampMat = metalMat(LAMP_YELLOW, {
    roughness: 0.3,
    metalness: 0.15,
    emissive: LAMP_YELLOW,
    emissiveScale: 0.35, // emissiveIntensityはKHR拡張が出るため色側で減衰
  })
  const leftEye = group('eyeL', [eyeX, eyeYLocal, 0.4])
  leftEye.add(mesh('eyeLampL', lampGeo, lampMat, [0, 0, 0], [1, 1, 0.6]))
  const rightEye = group('eyeR', [-eyeX, eyeYLocal, 0.4])
  rightEye.add(mesh('eyeLampR', lampGeo, lampMat, [0, 0, 0], [1, 1, 0.6]))
  head.add(leftEye, rightEye)

  // grill-left/center/right (口元のスリット。α0.75合成色)
  const grillMat = metalMat(GRILL_BAKED, { roughness: 0.5, metalness: 0.5 })
  const grillSideGeo = new THREE.CapsuleGeometry(px(2) / 2, px(5.5) - px(2), 4, 10)
  const grillCenterGeo = new THREE.CapsuleGeometry(px(2) / 2, px(7.5) - px(2), 4, 10)
  head.add(mesh('grillL', grillSideGeo, grillMat, [cx(43, 2), hy(36.5, 5.5), 0.386], [1, 1, 0.5]))
  head.add(mesh('grillC', grillCenterGeo, grillMat, [cx(47.5, 2), hy(35.5, 7.5), 0.386], [1, 1, 0.5]))
  head.add(mesh('grillR', grillSideGeo, grillMat, [cx(52, 2), hy(36.5, 5.5), 0.386], [1, 1, 0.5]))

  // cheek-screw-left/right (3.6x3.6 #8fa3c8)
  const cheekMat = metalMat(GREY, { roughness: 0.4, metalness: 0.62 })
  head.add(mesh('cheekScrewL', rivetGeo, cheekMat, [cx(25.5, 3.6), hy(35, 3.6), 0.384], [px(3.6) / 2, px(3.6) / 2, 0.022]))
  head.add(mesh('cheekScrewR', rivetGeo, cheekMat, [-cx(25.5, 3.6), hy(35, 3.6), 0.384], [px(3.6) / 2, px(3.6) / 2, 0.022]))

  // dent-scratch-1/2 (右上の擦り傷。CSS rotate -18° → three +18°)
  const scratch1Geo = new THREE.CapsuleGeometry(px(1.6) / 2, px(8) - px(1.6), 4, 8)
  scratch1Geo.rotateZ(Math.PI / 2) // 横倒し
  const scratch2Geo = new THREE.CapsuleGeometry(px(1.4) / 2, px(5) - px(1.4), 4, 8)
  scratch2Geo.rotateZ(Math.PI / 2)
  const scratchTilt = THREE.MathUtils.degToRad(18)
  head.add(
    mesh('dentScratch1', scratch1Geo, metalMat(DENT1_BAKED, { roughness: 0.5, metalness: 0.5 }), [cxr(26, 8), hy(15, 1.6), 0.375], [1, 1, 0.5], [0, 0, scratchTilt])
  )
  head.add(
    mesh('dentScratch2', scratch2Geo, metalMat(DENT2_BAKED, { roughness: 0.5, metalness: 0.5 }), [cxr(28, 5), hy(17.5, 1.4), 0.372], [1, 1, 0.5], [0, 0, scratchTilt])
  )

  // ---- アンテナ (支点=根本、頭の子。棒+コイル縞+ビーコン球) ----
  const antennaBaseWorld = (50 - (2 + 13)) * S + Y_OFF // アンテナ下端 (top2 + height13)
  const antenna = group('antenna', [cx(48.3, 3.4), antennaBaseWorld - headY, 0])
  const antennaLen = px(13)
  const antennaR = px(3.4) / 2
  antenna.add(
    mesh('antennaRod', new THREE.CylinderGeometry(antennaR, antennaR, antennaLen, 14), metalMat(SHELL_TOP, { roughness: 0.4, metalness: 0.55 }), [0, antennaLen / 2, 0])
  )
  // antenna-coil-1..4 (アンテナ内の横縞 #3a63d8、各高さ16%)
  const coilH = antennaLen * 0.16
  const coilGeo = new THREE.CylinderGeometry(antennaR + 0.008, antennaR + 0.008, coilH, 14)
  const coilMat = metalMat(BLUE, { roughness: 0.4, metalness: 0.6 })
  ;[0, 32.1, 64.1, 96.2].forEach((topPct, index) => {
    const centerPct = 2 + ((topPct + 8) / 100) * 13 // scene全体での中心%
    const centerWorld = (50 - centerPct) * S + Y_OFF
    antenna.add(mesh(`antennaCoil${index + 1}`, coilGeo, coilMat, [0, centerWorld - antennaBaseWorld, 0]))
  })
  // beacon (46.5,-3 7x7 #ff6b6b 発光)
  antenna.add(
    mesh(
      'beacon',
      new THREE.SphereGeometry(px(7) / 2, 20, 14),
      metalMat(BEACON_RED, { roughness: 0.3, metalness: 0.15, emissive: BEACON_RED, emissiveScale: 0.3 }),
      [cx(46.5, 7), cy(-3, 7) - antennaBaseWorld, 0]
    )
  )
  head.add(antenna)

  // ---- 腕 (支点=肩。継ぎ目の縞 #3557c4 入り) + クローハンド ----
  // arm-left: left15 top53 9x19 rotate-10 / arm-right: 対称
  // CSS rotate -10°(画面上で反時計回り) → three rotation.z = +10°
  const buildArm = (sign) => {
    // sign: -1=左, +1=右
    const tilt = THREE.MathUtils.degToRad(10) * -sign
    const centerX = sign * Math.abs(cx(15, 9))
    const centerY = cy(53, 19)
    const half = px(19) / 2
    const shoulderX = centerX - Math.sin(tilt) * half
    const shoulderY = centerY + Math.cos(tilt) * half
    const arm = group(sign < 0 ? 'armL' : 'armR', [shoulderX, shoulderY, -0.05])
    arm.rotation.z = tilt
    const suffix = sign < 0 ? 'L' : 'R'

    const armR = px(9) / 2
    arm.add(
      mesh(`armShell${suffix}`, new THREE.CapsuleGeometry(armR, px(19) - px(9), 6, 16), metalMat(BLUE, { roughness: 0.42, metalness: 0.6 }), [0, -half, 0])
    )
    // 継ぎ目リング: 38.4-49.3%(肘)と87.7-100%(手首)の #3557c4 帯
    const seamMat = metalMat(BLUE_DARK, { roughness: 0.42, metalness: 0.6 })
    arm.add(
      mesh(`armElbow${suffix}`, new THREE.CylinderGeometry(armR + 0.004, armR + 0.004, px(19) * 0.109, 16), seamMat, [0, -px(19) * 0.4385, 0])
    )
    arm.add(
      mesh(`armWrist${suffix}`, new THREE.CylinderGeometry(armR - 0.008, armR - 0.008, px(19) * 0.123, 16), seamMat, [0, -px(19) * 0.9385, 0])
    )

    // hand: left12.5 top70 8x6.5 rotate-10。clipPathのU字クローを2本の爪+掌で近似
    const handWorldX = sign * Math.abs(cx(12.5, 8))
    const handWorldY = cy(70, 6.5)
    const dx = handWorldX - shoulderX
    const dy = handWorldY - shoulderY
    const cosT = Math.cos(tilt)
    const sinT = Math.sin(tilt)
    const hand = group(`hand${suffix}`, [dx * cosT + dy * sinT, -dx * sinT + dy * cosT, 0.06])
    const handW = px(8)
    const handH = px(6.5)
    const prongW = handW * 0.38
    const palmH = handH * 0.45
    const handMat = metalMat(GREY, { roughness: 0.4, metalness: 0.62 })
    const prongGeo = new RoundedBoxGeometry(prongW, handH, 0.09, 2, 0.02)
    hand.add(mesh(`handProngOuter${suffix}`, prongGeo, handMat, [sign * (handW / 2 - prongW / 2), 0, 0]))
    hand.add(mesh(`handProngInner${suffix}`, prongGeo, handMat, [-sign * (handW / 2 - prongW / 2), 0, 0]))
    hand.add(mesh(`handPalm${suffix}`, new RoundedBoxGeometry(handW, palmH, 0.09, 2, 0.02), handMat, [0, -(handH / 2 - palmH / 2), 0]))
    arm.add(hand)
    return arm
  }
  const leftArm = buildArm(-1)
  const rightArm = buildArm(1)

  // ---- 脚・足 (leg: 33,75.5 10x6 #3a63d8 / foot: 28,80 17x4.5 #2c4bb0) ----
  const legGeo = new RoundedBoxGeometry(px(10), px(6), 0.2, 2, 0.05)
  const legMat = metalMat(BLUE, { roughness: 0.42, metalness: 0.6 })
  root.add(mesh('legL', legGeo, legMat, [cx(33, 10), cy(75.5, 6), -0.02]))
  root.add(mesh('legR', legGeo, legMat, [-cx(33, 10), cy(75.5, 6), -0.02]))

  const footGeo = new RoundedBoxGeometry(px(17), px(4.5), 0.3, 2, 0.04)
  const footMat = metalMat(NAVY, { roughness: 0.4, metalness: 0.6 })
  const leftFoot = group('footL', [cx(28, 17), cy(80, 4.5), 0.04])
  leftFoot.add(mesh('footPlateL', footGeo, footMat, [0, 0, 0]))
  const rightFoot = group('footR', [-cx(28, 17), cy(80, 4.5), 0.04])
  rightFoot.add(mesh('footPlateR', footGeo, footMat, [0, 0, 0]))

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
    leftEye,
    rightEye,
  }
}
