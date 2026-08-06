import type { DomSvgExpression, DomSvgTransform } from '../types'
import type {
  DomSvgAnimationDef,
  DomSvgBackground,
  DomSvgBorder,
  DomSvgBoxNode,
  DomSvgEasing,
  DomSvgEllipseShape,
  DomSvgGradientStop,
  DomSvgGroupNode,
  DomSvgKeyframe,
  DomSvgNode,
  DomSvgPaint,
  DomSvgPathShape,
  DomSvgRectShape,
  DomSvgScene,
  DomSvgShadow,
  DomSvgShape,
  DomSvgShapeGroupShape,
  DomSvgStrokeLinecap,
  DomSvgStrokeLinejoin,
  DomSvgSvgNode,
} from './sceneTypes'

// dom-svg MODは生のHTML/CSS/SVGマークアップを一切受け取らない。ここはRust側
// validate_scene()と同じ拒否条件をフロントでもミラーする多層防御であり、
// 最終的な信頼境界はRust側（インストール時）にある。

const MAX_SCENE_NODES = 400
const MAX_SCENE_DEPTH = 12
const MAX_PATH_DATA_CHARS = 12_000
const MAX_SCENE_ANIMATIONS = 32
const MAX_KEYFRAMES_PER_ANIMATION = 24
const MAX_GRADIENT_STOPS = 8
const MAX_CLIP_PATH_POINTS = 24
const MAX_BACKGROUND_LAYERS = 4
const MAX_SHADOWS = 6
const ALLOWED_EXPRESSIONS: DomSvgExpression[] = ['normal', 'sleepy', 'happy', 'sad']
const ALLOWED_EASINGS: DomSvgEasing[] = ['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out']
const ALLOWED_STROKE_LINECAPS: DomSvgStrokeLinecap[] = ['butt', 'round', 'square']
const ALLOWED_STROKE_LINEJOINS: DomSvgStrokeLinejoin[] = ['miter', 'round', 'bevel']
const PATH_DATA_PATTERN = /^[MmLlHhVvCcSsQqTtAaZz0-9 .,+\-eE\n\t\r]+$/
const ANIMATION_NAME_PATTERN = /^[a-z][a-z0-9-]{0,39}$/
const SCENE_ID_PATTERN = /^[a-z0-9-]+$/
// Rustのf64::parseに合わせ、".92" のような先頭ゼロ省略も受理する
const DECIMAL_NUMBER_PATTERN = /^[+-]?(\d+(\.\d*)?|\.\d+)$/

export class SceneValidationError extends Error {}

function fail(message: string): never {
  throw new SceneValidationError(message)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertKeys(object: Record<string, unknown>, allowed: readonly string[], label: string) {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) fail(`${label}に未対応のキーがあります: ${key}`)
  }
}

function numberInRange(
  object: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
  label: string,
): number | undefined {
  const value = object[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    fail(`${label}.${key}は${min}〜${max}にしてください`)
  }
  return value
}

function requireNumber(object: Record<string, unknown>, key: string, min: number, max: number, label: string): number {
  const value = numberInRange(object, key, min, max, label)
  if (value === undefined) fail(`${label}に${key}が必要です`)
  return value
}

function optionalBoolean(object: Record<string, unknown>, key: string, label: string): boolean | undefined {
  const value = object[key]
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') fail(`${label}.${key}は真偽値にしてください`)
  return value
}

function validateSceneId(id: unknown, label: string): string | undefined {
  if (id === undefined) return undefined
  if (typeof id !== 'string' || id.length === 0 || id.length > 64 || !SCENE_ID_PATTERN.test(id)) {
    fail(`${label}のidは半角小文字・数字・-のみ、64文字以内にしてください`)
  }
  return id
}

function validateAnimationRef(
  object: Record<string, unknown>,
  animationNames: Set<string>,
): string | undefined {
  const animation = object.animation
  if (animation === undefined) return undefined
  if (typeof animation !== 'string' || !animationNames.has(animation)) {
    fail(`未定義のanimationを参照しています: ${String(animation)}`)
  }
  return animation
}

function validateTransformOrigin(object: Record<string, unknown>, label: string): [number, number] | undefined {
  const origin = object.transformOrigin
  if (origin === undefined) return undefined
  if (
    !Array.isArray(origin)
    || origin.length !== 2
    || origin.some((value) => typeof value !== 'number' || !Number.isFinite(value))
  ) {
    fail(`${label}.transformOriginは[x,y]の2要素にしてください`)
  }
  return origin as [number, number]
}

function validateVisibleIn(object: Record<string, unknown>, label: string): DomSvgExpression[] | undefined {
  const visibleIn = object.visibleIn
  if (visibleIn === undefined) return undefined
  if (!Array.isArray(visibleIn) || visibleIn.length > ALLOWED_EXPRESSIONS.length) {
    fail(`${label}.visibleInの要素数が多すぎます`)
  }
  const seen = new Set<string>()
  for (const item of visibleIn) {
    if (typeof item !== 'string' || !ALLOWED_EXPRESSIONS.includes(item as DomSvgExpression)) {
      fail(`未対応のexpressionです: ${String(item)}`)
    }
    if (seen.has(item)) fail(`${label}.visibleInに重複があります`)
    seen.add(item)
  }
  return visibleIn as DomSvgExpression[]
}

function validateViewBox(value: unknown): [number, number] {
  if (!Array.isArray(value) || value.length !== 2) fail('viewBoxは[width,height]の2要素にしてください')
  for (const item of value) {
    if (typeof item !== 'number' || !Number.isFinite(item) || item < 1 || item > 4096) {
      fail('viewBoxの値は1〜4096にしてください')
    }
  }
  return value as [number, number]
}

function validateColor(value: unknown): string {
  if (typeof value !== 'string' || value.length > 32) fail(`colorが不正です: ${String(value)}`)
  if (value === 'transparent') return value
  if (value.startsWith('#')) {
    const hex = value.slice(1)
    if ([3, 4, 6, 8].includes(hex.length) && /^[0-9a-fA-F]+$/.test(hex)) return value
    fail(`colorのhex表記が不正です: ${value}`)
  }
  for (const [prefix, count] of [['rgba(', 4], ['rgb(', 3]] as const) {
    if (value.startsWith(prefix) && value.endsWith(')')) {
      const inner = value.slice(prefix.length, -1)
      const parts = inner.split(',').map((part) => part.trim())
      if (parts.length !== count) fail(`colorの要素数が不正です: ${value}`)
      parts.forEach((part, index) => {
        if (!DECIMAL_NUMBER_PATTERN.test(part)) fail(`colorの数値が不正です: ${value}`)
        const number = Number(part)
        const max = index === 3 ? 1 : 255
        if (!Number.isFinite(number) || number < 0 || number > max) fail(`colorの数値が範囲外です: ${value}`)
      })
      return value
    }
  }
  fail(`未対応のcolor形式です: ${value}`)
}

function validateGradientStops(object: Record<string, unknown>): DomSvgGradientStop[] {
  const stops = object.stops
  if (!Array.isArray(stops) || stops.length === 0 || stops.length > MAX_GRADIENT_STOPS) {
    fail(`paint.stopsは1〜${MAX_GRADIENT_STOPS}個にしてください`)
  }
  return stops.map((raw) => {
    if (!isPlainObject(raw)) fail('paint.stopはobjectにしてください')
    assertKeys(raw, ['color', 'at'], 'paint.stop')
    const color = validateColor(raw.color)
    const at = numberInRange(raw, 'at', 0, 100, 'paint.stop')
    if (at === undefined) fail('paint.stopにatが必要です')
    return { color, at }
  })
}

function validatePaint(value: unknown): DomSvgPaint {
  if (!isPlainObject(value)) fail('paintはobjectにしてください')
  const type = value.type
  if (type === 'solid') {
    assertKeys(value, ['type', 'color'], 'solid paint')
    return { type: 'solid', color: validateColor(value.color) }
  }
  if (type === 'linear') {
    assertKeys(value, ['type', 'angle', 'stops'], 'linear paint')
    const angle = numberInRange(value, 'angle', -360, 360, 'linear paint')
    if (angle === undefined) fail('linear paintにangleが必要です')
    return { type: 'linear', angle, stops: validateGradientStops(value) }
  }
  if (type === 'radial') {
    assertKeys(value, ['type', 'shape', 'cx', 'cy', 'stops'], 'radial paint')
    if (value.shape !== 'ellipse' && value.shape !== 'circle') {
      fail('radial paint.shapeはellipseまたはcircleにしてください')
    }
    const cx = numberInRange(value, 'cx', -100, 200, 'radial paint')
    const cy = numberInRange(value, 'cy', -100, 200, 'radial paint')
    if (cx === undefined) fail('radial paintにcxが必要です')
    if (cy === undefined) fail('radial paintにcyが必要です')
    return { type: 'radial', shape: value.shape, cx, cy, stops: validateGradientStops(value) }
  }
  fail(`未対応のpaint.typeです: ${String(type)}`)
}

function validateBackground(value: unknown): DomSvgBackground {
  if (Array.isArray(value)) {
    if (value.length === 0 || value.length > MAX_BACKGROUND_LAYERS) {
      fail(`backgroundのレイヤーは1〜${MAX_BACKGROUND_LAYERS}枚にしてください`)
    }
    return value.map(validatePaint)
  }
  return validatePaint(value)
}

function validateShadowList(value: unknown, label: string, allowInset: boolean): DomSvgShadow[] {
  if (!Array.isArray(value)) fail(`${label}は配列にしてください`)
  if (value.length === 0 || value.length > MAX_SHADOWS) fail(`${label}は1〜${MAX_SHADOWS}個にしてください`)
  return value.map((raw) => {
    if (!isPlainObject(raw)) fail(`${label}の要素はobjectにしてください`)
    assertKeys(raw, allowInset ? ['dx', 'dy', 'blur', 'spread', 'color', 'inset'] : ['dx', 'dy', 'blur', 'color'], label)
    const dx = requireNumber(raw, 'dx', -50, 50, label)
    const dy = requireNumber(raw, 'dy', -50, 50, label)
    const blur = numberInRange(raw, 'blur', 0, 50, label)
    const spread = allowInset ? numberInRange(raw, 'spread', -50, 50, label) : undefined
    const inset = allowInset ? optionalBoolean(raw, 'inset', label) : undefined
    const color = validateColor(raw.color)
    return { dx, dy, blur, spread, color, inset }
  })
}

function validateBorder(value: unknown, label: string): DomSvgBorder {
  if (!isPlainObject(value)) fail(`${label}はobjectにしてください`)
  assertKeys(value, ['width', 'color'], label)
  const width = requireNumber(value, 'width', 0, 20, label)
  return { width, color: validateColor(value.color) }
}

function validateBorderRadius(value: unknown): string {
  if (typeof value !== 'string' || value.length > 64) fail('borderRadiusが不正です')
  const tokens = value.split(/[ /]/).filter(Boolean)
  if (tokens.length === 0 || tokens.length > 8) fail(`borderRadiusは0〜100%にしてください: ${value}`)
  for (const token of tokens) {
    // CSSと同じく、ゼロだけは単位なしで書ける
    const digits = token.endsWith('%') ? token.slice(0, -1) : token === '0' ? token : null
    if (digits === null) fail(`borderRadiusは%指定にしてください: ${value}`)
    if (!DECIMAL_NUMBER_PATTERN.test(digits)) fail(`borderRadiusの数値が不正です: ${value}`)
    const number = Number(digits)
    if (!Number.isFinite(number) || number < 0 || number > 100) fail(`borderRadiusは0〜100%にしてください: ${value}`)
  }
  return value
}

function validateClipPath(value: unknown): string {
  if (typeof value !== 'string' || value.length > 512) fail('clipPathが不正です')
  const match = /^polygon\(([\s\S]*)\)$/.exec(value)
  if (!match) fail('clipPathはpolygon(...)にしてください')
  const points = match[1].split(',')
  if (points.length === 0 || points.length > MAX_CLIP_PATH_POINTS) {
    fail(`clipPathの頂点数は1〜${MAX_CLIP_PATH_POINTS}個にしてください`)
  }
  for (const point of points) {
    const coords = point.trim().split(/\s+/)
    if (coords.length !== 2) fail('clipPathの頂点は"x% y%"の形式にしてください')
    for (const coord of coords) {
      const digits = coord.endsWith('%') ? coord.slice(0, -1) : coord === '0' ? coord : null
      if (digits === null) fail('clipPathの座標は%指定にしてください')
      if (!DECIMAL_NUMBER_PATTERN.test(digits)) fail('clipPathの数値が不正です')
      const number = Number(digits)
      if (!Number.isFinite(number) || number < -50 || number > 150) fail('clipPathの座標は-50〜150%にしてください')
    }
  }
  return value
}

function validatePathData(value: string): string {
  if (value.length === 0 || value.length > MAX_PATH_DATA_CHARS) {
    fail(`path dataは1〜${MAX_PATH_DATA_CHARS}文字にしてください`)
  }
  if (!PATH_DATA_PATTERN.test(value)) fail('path dataに使用できない文字が含まれています')
  const first = value.trimStart()[0]
  if (first !== 'M' && first !== 'm') fail('path dataはMまたはmで始めてください')
  return value
}

function validateAnimationName(name: string) {
  if (!ANIMATION_NAME_PATTERN.test(name)) fail(`animation名の形式が不正です: ${name}`)
}

function validateTransform(raw: unknown, label: string): DomSvgTransform {
  if (!isPlainObject(raw)) fail(`${label}はobjectにしてください`)
  assertKeys(
    raw,
    ['rotate', 'rotateX', 'rotateY', 'translateX', 'translateY', 'scale', 'scaleX', 'scaleY'],
    label,
  )
  return {
    rotate: numberInRange(raw, 'rotate', -360, 360, 'transform'),
    rotateX: numberInRange(raw, 'rotateX', -360, 360, 'transform'),
    rotateY: numberInRange(raw, 'rotateY', -360, 360, 'transform'),
    translateX: numberInRange(raw, 'translateX', -200, 200, 'transform'),
    translateY: numberInRange(raw, 'translateY', -200, 200, 'transform'),
    scale: numberInRange(raw, 'scale', 0.01, 10, 'transform'),
    scaleX: numberInRange(raw, 'scaleX', 0.01, 10, 'transform'),
    scaleY: numberInRange(raw, 'scaleY', 0.01, 10, 'transform'),
  }
}

function validateAnimations(value: unknown): Record<string, DomSvgAnimationDef> {
  if (value === undefined) return {}
  if (!isPlainObject(value)) fail('scene.animationsはobjectにしてください')
  const entries = Object.entries(value)
  if (entries.length > MAX_SCENE_ANIMATIONS) fail(`scene.animationsは${MAX_SCENE_ANIMATIONS}個までにしてください`)
  const result: Record<string, DomSvgAnimationDef> = {}
  for (const [name, definitionRaw] of entries) {
    validateAnimationName(name)
    if (!isPlainObject(definitionRaw)) fail(`animation定義はobjectにしてください: ${name}`)
    assertKeys(definitionRaw, ['durationMs', 'easing', 'iteration', 'delayMs', 'keyframes'], 'animation')
    const durationMs = numberInRange(definitionRaw, 'durationMs', 100, 30_000, 'animation')
    if (durationMs === undefined) fail(`animation.durationMsが必要です: ${name}`)
    const easing = definitionRaw.easing
    if (typeof easing !== 'string' || !ALLOWED_EASINGS.includes(easing as DomSvgEasing)) {
      fail(`未対応のeasingです: ${String(easing)}`)
    }
    const iteration = definitionRaw.iteration
    if (iteration !== 'infinite') {
      if (typeof iteration !== 'number' || !Number.isFinite(iteration) || iteration < 1 || iteration > 1000) {
        fail(`animation.iterationは"infinite"または1〜1000の数値にしてください: ${name}`)
      }
    }
    const delayMs = numberInRange(definitionRaw, 'delayMs', 0, 10_000, 'animation')
    const keyframesRaw = definitionRaw.keyframes
    if (!Array.isArray(keyframesRaw) || keyframesRaw.length === 0 || keyframesRaw.length > MAX_KEYFRAMES_PER_ANIMATION) {
      fail(`animation.keyframesは1〜${MAX_KEYFRAMES_PER_ANIMATION}個にしてください: ${name}`)
    }
    let previousAt = -1
    const keyframes: DomSvgKeyframe[] = keyframesRaw.map((raw) => {
      if (!isPlainObject(raw)) fail(`keyframeはobjectにしてください: ${name}`)
      assertKeys(raw, ['at', 'transform', 'opacity'], 'keyframe')
      const at = numberInRange(raw, 'at', 0, 100, 'keyframe')
      if (at === undefined) fail(`keyframe.atが必要です: ${name}`)
      if (at <= previousAt) fail(`keyframe.atは昇順にしてください: ${name}`)
      previousAt = at
      const transform = raw.transform !== undefined ? validateTransform(raw.transform, 'keyframe.transform') : undefined
      const opacity = numberInRange(raw, 'opacity', 0, 1, 'keyframe')
      return { at, transform, opacity }
    })
    result[name] = {
      durationMs,
      easing: easing as DomSvgEasing,
      iteration: iteration as 'infinite' | number,
      delayMs,
      keyframes,
    }
  }
  return result
}

interface NodeBudget {
  remaining: number
}

function consumeBudget(budget: NodeBudget) {
  if (budget.remaining <= 0) fail('dom-svg sceneのノード数が上限を超えています')
  budget.remaining -= 1
}

const COMMON_NODE_KEYS = [
  'kind', 'id',
  'left', 'right', 'top', 'bottom', 'width', 'height',
  'z', 'rotate', 'rotateX', 'rotateY', 'translateX', 'translateY', 'scale', 'scaleX', 'scaleY',
  'opacity', 'overflowHidden', 'filter',
  'animation', 'transformOrigin', 'visibleIn',
] as const
const GROUP_KEYS = [...COMMON_NODE_KEYS, 'children']
const BOX_KEYS = [
  ...COMMON_NODE_KEYS,
  'children', 'background', 'borderRadius', 'clipPath', 'border', 'borderBottom', 'boxShadow',
]
const SVG_KEYS = [...COMMON_NODE_KEYS, 'children', 'viewBox']

const COMMON_SHAPE_KEYS = ['kind', 'id', 'opacity', 'animation', 'transformOrigin', 'visibleIn'] as const
const SHAPE_PAINT_KEYS = [
  ...COMMON_SHAPE_KEYS,
  'fill', 'stroke', 'strokeWidth', 'strokeLinecap', 'strokeLinejoin', 'nonScalingStroke',
] as const
const PATH_KEYS = [...SHAPE_PAINT_KEYS, 'd']
const ELLIPSE_KEYS = [...SHAPE_PAINT_KEYS, 'cx', 'cy', 'rx', 'ry']
const RECT_KEYS = [...SHAPE_PAINT_KEYS, 'x', 'y', 'width', 'height', 'rx']
const SHAPE_GROUP_KEYS = [...COMMON_SHAPE_KEYS, 'children']

type CommonNodeFields = Omit<DomSvgGroupNode, 'kind' | 'children'>

function validateCommonNodeFields(object: Record<string, unknown>, animationNames: Set<string>): CommonNodeFields {
  return {
    id: validateSceneId(object.id, 'node'),
    left: numberInRange(object, 'left', -200, 300, 'node'),
    right: numberInRange(object, 'right', -200, 300, 'node'),
    top: numberInRange(object, 'top', -200, 300, 'node'),
    bottom: numberInRange(object, 'bottom', -200, 300, 'node'),
    width: numberInRange(object, 'width', -200, 300, 'node'),
    height: numberInRange(object, 'height', -200, 300, 'node'),
    z: numberInRange(object, 'z', 0, 200, 'node'),
    rotate: numberInRange(object, 'rotate', -360, 360, 'node'),
    rotateX: numberInRange(object, 'rotateX', -360, 360, 'node'),
    rotateY: numberInRange(object, 'rotateY', -360, 360, 'node'),
    translateX: numberInRange(object, 'translateX', -200, 200, 'node'),
    translateY: numberInRange(object, 'translateY', -200, 200, 'node'),
    scale: numberInRange(object, 'scale', 0.01, 10, 'node'),
    scaleX: numberInRange(object, 'scaleX', 0.01, 10, 'node'),
    scaleY: numberInRange(object, 'scaleY', 0.01, 10, 'node'),
    opacity: numberInRange(object, 'opacity', 0, 1, 'node'),
    overflowHidden: optionalBoolean(object, 'overflowHidden', 'node'),
    filter: object.filter !== undefined ? validateShadowList(object.filter, 'node.filter', false) : undefined,
    animation: validateAnimationRef(object, animationNames),
    transformOrigin: validateTransformOrigin(object, 'node'),
    visibleIn: validateVisibleIn(object, 'node'),
  }
}

type CommonShapeFields = Omit<DomSvgShapeGroupShape, 'kind' | 'children'>

function validateCommonShapeFields(object: Record<string, unknown>, animationNames: Set<string>): CommonShapeFields {
  return {
    id: validateSceneId(object.id, 'shape'),
    opacity: numberInRange(object, 'opacity', 0, 1, 'shape'),
    animation: validateAnimationRef(object, animationNames),
    transformOrigin: validateTransformOrigin(object, 'shape'),
    visibleIn: validateVisibleIn(object, 'shape'),
  }
}

type ShapePaintFields = Pick<
  DomSvgPathShape,
  'fill' | 'stroke' | 'strokeWidth' | 'strokeLinecap' | 'strokeLinejoin' | 'nonScalingStroke'
>

function validateShapePaintFields(object: Record<string, unknown>): ShapePaintFields {
  const strokeLinecap = object.strokeLinecap
  if (strokeLinecap !== undefined && !ALLOWED_STROKE_LINECAPS.includes(strokeLinecap as DomSvgStrokeLinecap)) {
    fail(`未対応のstrokeLinecapです: ${String(strokeLinecap)}`)
  }
  const strokeLinejoin = object.strokeLinejoin
  if (strokeLinejoin !== undefined && !ALLOWED_STROKE_LINEJOINS.includes(strokeLinejoin as DomSvgStrokeLinejoin)) {
    fail(`未対応のstrokeLinejoinです: ${String(strokeLinejoin)}`)
  }
  return {
    fill: object.fill !== undefined ? validatePaint(object.fill) : undefined,
    stroke: object.stroke !== undefined ? validatePaint(object.stroke) : undefined,
    strokeWidth: numberInRange(object, 'strokeWidth', 0, 20, 'shape'),
    strokeLinecap: strokeLinecap as DomSvgStrokeLinecap | undefined,
    strokeLinejoin: strokeLinejoin as DomSvgStrokeLinejoin | undefined,
    nonScalingStroke: optionalBoolean(object, 'nonScalingStroke', 'shape'),
  }
}

function validateNode(raw: unknown, depth: number, animationNames: Set<string>, budget: NodeBudget): DomSvgNode {
  if (depth > MAX_SCENE_DEPTH) fail('dom-svg sceneのネスト階層が深すぎます')
  consumeBudget(budget)
  if (!isPlainObject(raw)) fail('dom-svg sceneのnodeはobjectにしてください')
  const kind = raw.kind

  if (kind === 'group') {
    assertKeys(raw, GROUP_KEYS, 'group node')
    const common = validateCommonNodeFields(raw, animationNames)
    if (!Array.isArray(raw.children)) fail('groupにはchildrenが必要です')
    const children = raw.children.map((child) => validateNode(child, depth + 1, animationNames, budget))
    return { kind: 'group', ...common, children } satisfies DomSvgGroupNode
  }
  if (kind === 'box') {
    assertKeys(raw, BOX_KEYS, 'box node')
    const common = validateCommonNodeFields(raw, animationNames)
    let children: DomSvgNode[] | undefined
    if (raw.children !== undefined) {
      if (!Array.isArray(raw.children)) fail('box.childrenは配列にしてください')
      children = raw.children.map((child) => validateNode(child, depth + 1, animationNames, budget))
    }
    return {
      kind: 'box',
      ...common,
      children,
      background: raw.background !== undefined ? validateBackground(raw.background) : undefined,
      borderRadius: raw.borderRadius !== undefined ? validateBorderRadius(raw.borderRadius) : undefined,
      clipPath: raw.clipPath !== undefined ? validateClipPath(raw.clipPath) : undefined,
      border: raw.border !== undefined ? validateBorder(raw.border, 'box.border') : undefined,
      borderBottom: raw.borderBottom !== undefined ? validateBorder(raw.borderBottom, 'box.borderBottom') : undefined,
      boxShadow: raw.boxShadow !== undefined ? validateShadowList(raw.boxShadow, 'box.boxShadow', true) : undefined,
    } satisfies DomSvgBoxNode
  }
  if (kind === 'svg') {
    assertKeys(raw, SVG_KEYS, 'svg node')
    const common = validateCommonNodeFields(raw, animationNames)
    const viewBox = validateViewBox(raw.viewBox)
    if (!Array.isArray(raw.children)) fail('svg nodeにはchildrenが必要です')
    const children = raw.children.map((child) => validateShape(child, depth + 1, animationNames, budget))
    return { kind: 'svg', ...common, viewBox, children } satisfies DomSvgSvgNode
  }
  fail(`未対応のnode kindです: ${String(kind)}`)
}

function validateShape(raw: unknown, depth: number, animationNames: Set<string>, budget: NodeBudget): DomSvgShape {
  if (depth > MAX_SCENE_DEPTH) fail('dom-svg sceneのネスト階層が深すぎます')
  consumeBudget(budget)
  if (!isPlainObject(raw)) fail('dom-svg sceneのshapeはobjectにしてください')
  const kind = raw.kind

  if (kind === 'path') {
    assertKeys(raw, PATH_KEYS, 'path')
    const common = validateCommonShapeFields(raw, animationNames)
    if (typeof raw.d !== 'string') fail('pathにはdが必要です')
    return { kind: 'path', ...common, ...validateShapePaintFields(raw), d: validatePathData(raw.d) } satisfies DomSvgPathShape
  }
  if (kind === 'ellipse') {
    assertKeys(raw, ELLIPSE_KEYS, 'ellipse')
    const common = validateCommonShapeFields(raw, animationNames)
    return {
      kind: 'ellipse',
      ...common,
      ...validateShapePaintFields(raw),
      cx: requireNumber(raw, 'cx', -2000, 4096, 'ellipse'),
      cy: requireNumber(raw, 'cy', -2000, 4096, 'ellipse'),
      rx: requireNumber(raw, 'rx', -2000, 4096, 'ellipse'),
      ry: requireNumber(raw, 'ry', -2000, 4096, 'ellipse'),
    } satisfies DomSvgEllipseShape
  }
  if (kind === 'rect') {
    assertKeys(raw, RECT_KEYS, 'rect')
    const common = validateCommonShapeFields(raw, animationNames)
    return {
      kind: 'rect',
      ...common,
      ...validateShapePaintFields(raw),
      x: requireNumber(raw, 'x', -2000, 4096, 'rect'),
      y: requireNumber(raw, 'y', -2000, 4096, 'rect'),
      width: requireNumber(raw, 'width', -2000, 4096, 'rect'),
      height: requireNumber(raw, 'height', -2000, 4096, 'rect'),
      rx: numberInRange(raw, 'rx', 0, 2048, 'rect'),
    } satisfies DomSvgRectShape
  }
  if (kind === 'shapeGroup') {
    assertKeys(raw, SHAPE_GROUP_KEYS, 'shapeGroup')
    const common = validateCommonShapeFields(raw, animationNames)
    if (!Array.isArray(raw.children)) fail('shapeGroupにはchildrenが必要です')
    const children = raw.children.map((child) => validateShape(child, depth + 1, animationNames, budget))
    return { kind: 'shapeGroup', ...common, children } satisfies DomSvgShapeGroupShape
  }
  fail(`未対応のshape kindです: ${String(kind)}`)
}

export function validateSceneDocument(raw: unknown): DomSvgScene {
  if (!isPlainObject(raw)) fail('scene.jsonはobjectにしてください')
  assertKeys(raw, ['sceneVersion', 'viewBox', 'animations', 'root'], 'scene.json')
  if (raw.sceneVersion !== 1) fail(`未対応のsceneVersionです: ${String(raw.sceneVersion)}`)
  const viewBox = validateViewBox(raw.viewBox)
  const animations = validateAnimations(raw.animations)
  const animationNames = new Set(Object.keys(animations))
  if (!Array.isArray(raw.root) || raw.root.length === 0) fail('scene.jsonのrootは最低1個のnodeが必要です')
  const budget: NodeBudget = { remaining: MAX_SCENE_NODES }
  const root = raw.root.map((node) => validateNode(node, 1, animationNames, budget))
  return { sceneVersion: 1, viewBox, animations, root }
}

export function parseAndValidateScene(bytes: Uint8Array): DomSvgScene {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    fail('scene.jsonの文字コードが不正です')
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    fail(`scene.jsonを解析できません: ${error instanceof Error ? error.message : String(error)}`)
  }
  return validateSceneDocument(raw)
}
