import type { DomSvgExpression, DomSvgTransform } from '../types'

export type DomSvgEasing = 'linear' | 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out'
export type DomSvgStrokeLinecap = 'butt' | 'round' | 'square'
export type DomSvgStrokeLinejoin = 'miter' | 'round' | 'bevel'

export interface DomSvgKeyframe {
  at: number
  transform?: DomSvgTransform
  opacity?: number
}

export interface DomSvgAnimationDef {
  durationMs: number
  easing: DomSvgEasing
  iteration: 'infinite' | number
  delayMs?: number
  keyframes: DomSvgKeyframe[]
}

export interface DomSvgGradientStop {
  color: string
  at: number
}

export type DomSvgPaint =
  | { type: 'solid'; color: string }
  | { type: 'linear'; angle: number; stops: DomSvgGradientStop[] }
  | { type: 'radial'; shape: 'ellipse' | 'circle'; cx: number; cy: number; stops: DomSvgGradientStop[] }

/** CSSと同じく、配列の先頭が最前面のレイヤー */
export type DomSvgBackground = DomSvgPaint | DomSvgPaint[]

export interface DomSvgShadow {
  dx: number
  dy: number
  blur?: number
  spread?: number
  color: string
  inset?: boolean
}

export interface DomSvgBorder {
  width: number
  color: string
}

interface DomSvgNodeCommon {
  id?: string
  left?: number
  right?: number
  top?: number
  bottom?: number
  width?: number
  height?: number
  z?: number
  rotate?: number
  rotateX?: number
  rotateY?: number
  translateX?: number
  translateY?: number
  scale?: number
  scaleX?: number
  scaleY?: number
  opacity?: number
  overflowHidden?: boolean
  filter?: DomSvgShadow[]
  animation?: string
  transformOrigin?: [number, number]
  visibleIn?: DomSvgExpression[]
}

export interface DomSvgGroupNode extends DomSvgNodeCommon {
  kind: 'group'
  children: DomSvgNode[]
}

export interface DomSvgBoxNode extends DomSvgNodeCommon {
  kind: 'box'
  children?: DomSvgNode[]
  background?: DomSvgBackground
  borderRadius?: string
  clipPath?: string
  border?: DomSvgBorder
  borderBottom?: DomSvgBorder
  boxShadow?: DomSvgShadow[]
}

export interface DomSvgSvgNode extends DomSvgNodeCommon {
  kind: 'svg'
  viewBox: [number, number]
  children: DomSvgShape[]
}

export type DomSvgNode = DomSvgGroupNode | DomSvgBoxNode | DomSvgSvgNode

interface DomSvgShapeCommon {
  id?: string
  opacity?: number
  animation?: string
  transformOrigin?: [number, number]
  visibleIn?: DomSvgExpression[]
}

interface DomSvgShapePaintCommon extends DomSvgShapeCommon {
  fill?: DomSvgPaint
  stroke?: DomSvgPaint
  strokeWidth?: number
  strokeLinecap?: DomSvgStrokeLinecap
  strokeLinejoin?: DomSvgStrokeLinejoin
  nonScalingStroke?: boolean
}

export interface DomSvgPathShape extends DomSvgShapePaintCommon {
  kind: 'path'
  d: string
}

export interface DomSvgEllipseShape extends DomSvgShapePaintCommon {
  kind: 'ellipse'
  cx: number
  cy: number
  rx: number
  ry: number
}

export interface DomSvgRectShape extends DomSvgShapePaintCommon {
  kind: 'rect'
  x: number
  y: number
  width: number
  height: number
  rx?: number
}

export interface DomSvgShapeGroupShape extends DomSvgShapeCommon {
  kind: 'shapeGroup'
  children: DomSvgShape[]
}

export type DomSvgShape = DomSvgPathShape | DomSvgEllipseShape | DomSvgRectShape | DomSvgShapeGroupShape

export interface DomSvgScene {
  sceneVersion: 1
  viewBox: [number, number]
  animations: Record<string, DomSvgAnimationDef>
  root: DomSvgNode[]
}
