import { useEffect, useId, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import type { CharacterModPackage, CharacterMotion, DomSvgExpression, DomSvgMotion } from '../../characters/types'
import type {
  DomSvgBackground,
  DomSvgNode,
  DomSvgPaint,
  DomSvgScene,
  DomSvgShadow,
  DomSvgShape,
} from '../../characters/domSvg/sceneTypes'
import { parseAndValidateScene } from '../../characters/domSvg/validateScene'
import {
  acquireSceneStylesheet,
  animationClassName,
  compileSceneStylesheet,
  sceneNamespace,
  transformToCss,
} from '../../characters/domSvg/compileScene'
import { loadCharacterModAssetBytes, releaseCharacterModAssetBytes } from '../../lib/characterMods'

interface DomModMascotProps {
  characterPackage: CharacterModPackage
  motion: CharacterMotion
  size: number
  spinSignal: number
  className?: string
  fallback: ReactNode
}

function firstMotion(motions: Partial<Record<CharacterMotion, DomSvgMotion>>) {
  return Object.entries(motions)[0] as [CharacterMotion, DomSvgMotion] | undefined
}

function resolveMotion(motions: Partial<Record<CharacterMotion, DomSvgMotion>>, requested: CharacterMotion) {
  if (motions[requested]) return [requested, motions[requested]] as const
  if (motions.idle) return ['idle', motions.idle] as const
  return firstMotion(motions) ?? null
}

function useValidatedScene(characterPackage: CharacterModPackage, onFailure: () => void) {
  const [scene, setScene] = useState<DomSvgScene | null>(null)

  useEffect(() => {
    let active = true
    setScene(null)
    loadCharacterModAssetBytes(characterPackage, 'scene')
      .then((bytes) => {
        if (!active) return
        setScene(parseAndValidateScene(bytes))
      })
      .catch(() => {
        if (active) onFailure()
      })
      .finally(() => releaseCharacterModAssetBytes(characterPackage, 'scene'))
    return () => {
      active = false
    }
  }, [characterPackage, onFailure])

  return scene
}

function paintToCss(paint: DomSvgPaint): string {
  if (paint.type === 'solid') return paint.color
  const stops = paint.stops.map((stop) => `${stop.color} ${stop.at}%`).join(', ')
  if (paint.type === 'linear') return `linear-gradient(${paint.angle}deg, ${stops})`
  return `radial-gradient(${paint.shape} at ${paint.cx}% ${paint.cy}%, ${stops})`
}

function backgroundToCss(background: DomSvgBackground): string {
  const layers = Array.isArray(background) ? background : [background]
  // 単色は gradient と混ぜられないので、1レイヤーだけの単色はそのまま background に渡す
  if (layers.length === 1) return paintToCss(layers[0])
  return layers
    .map((paint) => (paint.type === 'solid' ? `linear-gradient(${paint.color}, ${paint.color})` : paintToCss(paint)))
    .join(', ')
}

function shadowsToFilterCss(shadows: DomSvgShadow[]): string {
  return shadows
    .map((shadow) => `drop-shadow(${shadow.dx}px ${shadow.dy}px ${shadow.blur ?? 0}px ${shadow.color})`)
    .join(' ')
}

function shadowsToBoxShadowCss(shadows: DomSvgShadow[]): string {
  return shadows
    .map((shadow) => {
      const spread = shadow.spread !== undefined ? ` ${shadow.spread}px` : ''
      return `${shadow.inset ? 'inset ' : ''}${shadow.dx}px ${shadow.dy}px ${shadow.blur ?? 0}px${spread} ${shadow.color}`
    })
    .join(', ')
}

function resolveSvgPaint(paint: DomSvgPaint | undefined, id: string, defs: ReactNode[]): string | undefined {
  if (!paint) return undefined
  if (paint.type === 'solid') return paint.color
  if (paint.type === 'linear') {
    const radians = (paint.angle * Math.PI) / 180
    const dx = Math.sin(radians) * 0.5
    const dy = -Math.cos(radians) * 0.5
    defs.push(
      <linearGradient
        key={id}
        id={id}
        x1={`${(0.5 - dx) * 100}%`}
        y1={`${(0.5 - dy) * 100}%`}
        x2={`${(0.5 + dx) * 100}%`}
        y2={`${(0.5 + dy) * 100}%`}
      >
        {paint.stops.map((stop, index) => (
          <stop key={index} offset={`${stop.at}%`} stopColor={stop.color} />
        ))}
      </linearGradient>,
    )
  } else {
    defs.push(
      <radialGradient key={id} id={id} cx={`${paint.cx}%`} cy={`${paint.cy}%`} r="50%">
        {paint.stops.map((stop, index) => (
          <stop key={index} offset={`${stop.at}%`} stopColor={stop.color} />
        ))}
      </radialGradient>,
    )
  }
  return `url(#${id})`
}

interface RenderContext {
  namespace: string
  instanceScope: string
  activeAnimations: Set<string>
  expression: DomSvgExpression
  depthScale: number
}

function isVisible(visibleIn: DomSvgExpression[] | undefined, expression: DomSvgExpression) {
  return !visibleIn || visibleIn.includes(expression)
}

/**
 * nodeの静的な配置・変形。translateZ(疑似3Dの層)は必ずこの外側の要素に置き、
 * アニメーションは内側のラッパーへ分ける。CSSアニメーションはtransformを
 * まるごと置き換えるため、同じ要素に載せると再生中だけ深度が消えてしまう。
 */
function staticNodeStyle(node: Extract<DomSvgNode, { kind: string }>, context: RenderContext): CSSProperties {
  const style: CSSProperties = { position: 'absolute' }
  if (node.left !== undefined) style.left = `${node.left}%`
  if (node.right !== undefined) style.right = `${node.right}%`
  if (node.top !== undefined) style.top = `${node.top}%`
  if (node.bottom !== undefined) style.bottom = `${node.bottom}%`
  if (node.width !== undefined) style.width = `${node.width}%`
  if (node.height !== undefined) style.height = `${node.height}%`
  if (node.opacity !== undefined) style.opacity = node.opacity

  const transformParts: string[] = []
  if (node.z !== undefined) transformParts.push(`translateZ(${node.z * context.depthScale}px)`)
  // 一様スケールは奥行きにも掛ける。疑似3Dの層を持つコンテナを縮めたとき、
  // 子のtranslateZだけ元のままだと手前のパーツが浮いて見えてしまう
  const localTransform = transformToCss({ ...node, scale: undefined })
  if (localTransform) transformParts.push(localTransform)
  if (node.scale !== undefined) transformParts.push(`scale3d(${node.scale}, ${node.scale}, ${node.scale})`)
  if (transformParts.length > 0) style.transform = transformParts.join(' ')
  if (node.transformOrigin) style.transformOrigin = `${node.transformOrigin[0]}% ${node.transformOrigin[1]}%`
  if (node.filter) style.filter = shadowsToFilterCss(node.filter)
  return style
}

function nodeVisualStyle(node: DomSvgNode): CSSProperties {
  const style: CSSProperties = {}
  if (node.kind !== 'box') return style
  if (node.background) style.background = backgroundToCss(node.background)
  if (node.borderRadius) style.borderRadius = node.borderRadius
  if (node.clipPath) style.clipPath = node.clipPath
  if (node.border) style.border = `${node.border.width}px solid ${node.border.color}`
  if (node.borderBottom) style.borderBottom = `${node.borderBottom.width}px solid ${node.borderBottom.color}`
  if (node.boxShadow) style.boxShadow = shadowsToBoxShadowCss(node.boxShadow)
  return style
}

function renderNode(node: DomSvgNode, key: string, context: RenderContext): ReactNode {
  if (!isVisible(node.visibleIn, context.expression)) return null

  const outerStyle = staticNodeStyle(node, context)
  const animationClass = node.animation && context.activeAnimations.has(node.animation)
    ? animationClassName(context.namespace, node.animation)
    : undefined
  // 入れ子コンテナは子のtranslateZ(疑似3Dの層)を潰さないよう3Dを引き継ぐ。
  // filter / overflow を持つ要素はCSS側で強制的に平面化されるため指定は無害
  const containerStyle: CSSProperties = node.kind === 'group' || node.children
    ? { transformStyle: 'preserve-3d' }
    : {}

  let content: ReactNode
  if (node.kind === 'svg') {
    const defs: ReactNode[] = []
    const children = node.children.map((child, index) => renderShape(child, `${key}-${index}`, context, defs))
    content = (
      <svg
        style={{ display: 'block', width: '100%', height: '100%', overflow: 'visible' }}
        viewBox={`0 0 ${node.viewBox[0]} ${node.viewBox[1]}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {defs.length > 0 && <defs>{defs}</defs>}
        {children}
      </svg>
    )
  } else if (node.kind === 'group' || node.children) {
    content = node.children?.map((child, index) => renderNode(child, `${key}-${index}`, context))
  }

  const visualStyle = nodeVisualStyle(node)

  // アニメーションなし: 外側1枚に配置・見た目・中身をまとめる
  if (!animationClass) {
    return (
      <div
        key={key}
        data-part={node.id}
        style={{
          ...outerStyle,
          ...visualStyle,
          ...containerStyle,
          overflow: node.overflowHidden ? 'hidden' : undefined,
        }}
      >
        {content}
      </div>
    )
  }

  // アニメーションあり: 外側=配置とtranslateZ、内側=アニメーション + 見た目。
  // 外側にoverflowを付けるとfilterの輪郭が切られるので、クリップは内側だけに掛ける。
  // 外側にもpreserve-3dが必要: 無いと子のtranslateZ(疑似3D層)がここで平面化され、
  // ポーズの3D回転時にzを持つ子だけのノード(例: マクコの耳)が頭から置き去りに見える
  return (
    <div key={key} data-part={node.id} style={{ ...outerStyle, ...containerStyle }}>
      <div
        className={animationClass}
        style={{
          ...visualStyle,
          ...containerStyle,
          position: 'absolute',
          inset: 0,
          overflow: node.overflowHidden ? 'hidden' : undefined,
          transformOrigin: outerStyle.transformOrigin,
        }}
      >
        {content}
      </div>
    </div>
  )
}

function renderShape(shape: DomSvgShape, key: string, context: RenderContext, defs: ReactNode[]): ReactNode {
  if (!isVisible(shape.visibleIn, context.expression)) return null
  const animationClass = shape.animation && context.activeAnimations.has(shape.animation)
    ? animationClassName(context.namespace, shape.animation)
    : undefined
  const style: CSSProperties = {}
  if (shape.opacity !== undefined) style.opacity = shape.opacity
  if (shape.transformOrigin) {
    // SVG内でtransform-originを図形自身の座標基準にする
    style.transformBox = 'fill-box'
    style.transformOrigin = `${shape.transformOrigin[0]}% ${shape.transformOrigin[1]}%`
  }

  if (shape.kind === 'shapeGroup') {
    return (
      <g key={key} data-part={shape.id} className={animationClass} style={style}>
        {shape.children.map((child, index) => renderShape(child, `${key}-${index}`, context, defs))}
      </g>
    )
  }

  const fill = resolveSvgPaint(shape.fill, `${context.instanceScope}-${key}-fill`, defs)
  const stroke = resolveSvgPaint(shape.stroke, `${context.instanceScope}-${key}-stroke`, defs)
  const paintProps = {
    'data-part': shape.id,
    fill: fill ?? 'none',
    stroke,
    strokeWidth: shape.strokeWidth,
    strokeLinecap: shape.strokeLinecap,
    strokeLinejoin: shape.strokeLinejoin,
    vectorEffect: shape.nonScalingStroke ? ('non-scaling-stroke' as const) : undefined,
  }

  if (shape.kind === 'path') {
    return <path key={key} className={animationClass} style={style} d={shape.d} {...paintProps} />
  }
  if (shape.kind === 'ellipse') {
    return (
      <ellipse
        key={key}
        className={animationClass}
        style={style}
        cx={shape.cx}
        cy={shape.cy}
        rx={shape.rx}
        ry={shape.ry}
        {...paintProps}
      />
    )
  }
  return (
    <rect
      key={key}
      className={animationClass}
      style={style}
      x={shape.x}
      y={shape.y}
      width={shape.width}
      height={shape.height}
      rx={shape.rx}
      {...paintProps}
    />
  )
}

export function DomModMascot({
  characterPackage,
  motion,
  size,
  spinSignal,
  className = '',
  fallback,
}: DomModMascotProps) {
  const [failed, setFailed] = useState(false)
  const manifest = characterPackage.manifest
  const instanceId = useId()

  useEffect(() => setFailed(false), [characterPackage.revision])

  const onFailure = useMemo(() => () => setFailed(true), [])
  const scene = useValidatedScene(characterPackage, onFailure)
  const namespace = useMemo(
    () => sceneNamespace(manifest.id, characterPackage.revision),
    [manifest.id, characterPackage.revision],
  )

  useEffect(() => {
    if (!scene) return undefined
    return acquireSceneStylesheet(namespace, compileSceneStylesheet(scene.animations, namespace))
  }, [scene, namespace])

  if (failed || manifest.renderer !== 'dom-svg') return <>{fallback}</>
  if (!scene) return null

  const resolved = resolveMotion(manifest.source.motions, motion)
  const motionConfig = resolved?.[1]
  const context: RenderContext = {
    namespace,
    instanceScope: `${namespace}-${instanceId.replace(/[^a-zA-Z0-9-]/g, '')}`,
    activeAnimations: new Set(motionConfig?.animations ?? []),
    expression: motionConfig?.expression ?? 'normal',
    // Z層はビルトインキャラと同じくサイズ比例で伸縮させる(sceneのviewBox幅が基準)
    depthScale: scene.viewBox[0] > 0 ? size / scene.viewBox[0] : 1,
  }

  return (
    <div
      className={`character-mod-frame character-mod-float relative shrink-0 ${className}`}
      // 投影距離はsize比例(比率が変わると表示サイズごとに立体感がぶれる)。size*4だと
      // 頭(z36)が約9%膨らんで胴を飲み込み、ひげ(z50)がシルエットの外まで張り出すため、
      // 前後関係は保ったまま張り出しだけ半減するsize*6にしている
      style={{ width: size, height: size, perspective: size * 6, transformStyle: 'preserve-3d' }}
      data-character-renderer="dom-svg"
      data-character-mod={manifest.id}
    >
      <div
        key={spinSignal}
        className={spinSignal > 0 ? 'mascot-spin-once' : ''}
        style={{ position: 'absolute', inset: 0, transformStyle: 'preserve-3d' }}
      >
        {/* 横を向く間だけ奥行きを潰す層。回転と同じ要素には載せられない(transformの奪い合い) */}
        <div
          className={spinSignal > 0 ? 'mascot-spin-flatten' : ''}
          style={{ position: 'absolute', inset: 0, transformStyle: 'preserve-3d' }}
        >
          <div
            className={
              motionConfig?.poseAnimation
                ? animationClassName(namespace, motionConfig.poseAnimation)
                : undefined
            }
            style={{
              position: 'absolute',
              inset: 0,
              transformStyle: 'preserve-3d',
              // poseAnimationがある場合はCSSアニメーション側がtransformを持つ
              transform: motionConfig?.poseAnimation ? undefined : transformToCss(motionConfig?.pose) ?? undefined,
              transformOrigin: motionConfig?.poseOrigin
                ? `${motionConfig.poseOrigin[0]}% ${motionConfig.poseOrigin[1]}%`
                : undefined,
              transition: motionConfig?.poseAnimation ? undefined : 'transform 220ms ease',
            }}
          >
            {scene.root.map((node, index) => renderNode(node, `n${index}`, context))}
          </div>
        </div>
      </div>
    </div>
  )
}
