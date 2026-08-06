import type { DomSvgTransform } from '../types'
import type { DomSvgAnimationDef } from './sceneTypes'

/**
 * 検証済みの数値だけからtransformを組み立てる。MOD側の文字列は一切通さない。
 * 合成順はCSSの慣習どおり translate → rotate → scale で固定する。
 */
export function transformToCss(transform?: DomSvgTransform): string | null {
  if (!transform) return null
  const parts: string[] = []
  if (transform.translateX !== undefined || transform.translateY !== undefined) {
    parts.push(`translate(${transform.translateX ?? 0}%, ${transform.translateY ?? 0}%)`)
  }
  if (transform.rotate !== undefined) parts.push(`rotate(${transform.rotate}deg)`)
  if (transform.rotateX !== undefined) parts.push(`rotateX(${transform.rotateX}deg)`)
  if (transform.rotateY !== undefined) parts.push(`rotateY(${transform.rotateY}deg)`)
  if (transform.scale !== undefined) parts.push(`scale(${transform.scale})`)
  if (transform.scaleX !== undefined) parts.push(`scaleX(${transform.scaleX})`)
  if (transform.scaleY !== undefined) parts.push(`scaleY(${transform.scaleY})`)
  return parts.length > 0 ? parts.join(' ') : null
}

export function animationClassName(namespace: string, animationName: string): string {
  return `${namespace}-anim-${animationName}`
}

// 値は全てvalidateScene()を通過した数値/enumのみ。MOD側の生文字列がここで
// CSSテキストへ直接展開されることはない(paint colorとanimation名は
// バリデーション済みの厳格なグラマー/正規表現に一致した値のみ)。
export function compileSceneStylesheet(animations: Record<string, DomSvgAnimationDef>, namespace: string): string {
  const blocks: string[] = []
  for (const [name, animation] of Object.entries(animations)) {
    const keyframeLines = animation.keyframes.map((keyframe) => {
      const declarations: string[] = []
      if (keyframe.transform) {
        // 空のtransformは「変形なし」の明示指定として扱う(区間の基準点を置ける)
        declarations.push(`transform: ${transformToCss(keyframe.transform) ?? 'none'};`)
      }
      if (keyframe.opacity !== undefined) declarations.push(`opacity: ${keyframe.opacity};`)
      return `  ${keyframe.at}% { ${declarations.join(' ')} }`
    })
    blocks.push(`@keyframes ${namespace}-${name} {\n${keyframeLines.join('\n')}\n}`)
    const iterationCount = animation.iteration === 'infinite' ? 'infinite' : String(animation.iteration)
    blocks.push(
      '@media (prefers-reduced-motion: no-preference) {\n'
      + `  .${animationClassName(namespace, name)} { animation: ${namespace}-${name} ${animation.durationMs}ms `
      + `${animation.easing} ${animation.delayMs ?? 0}ms ${iterationCount} both; }\n`
      + '}',
    )
  }
  return blocks.join('\n\n')
}

interface SceneStyleEntry {
  refCount: number
  element: HTMLStyleElement
}

const sceneStyleRegistry = new Map<string, SceneStyleEntry>()

export function acquireSceneStylesheet(namespace: string, cssText: string): () => void {
  let entry = sceneStyleRegistry.get(namespace)
  if (!entry) {
    const element = document.createElement('style')
    element.setAttribute('data-dom-svg-mod-scene', namespace)
    element.textContent = cssText
    document.head.appendChild(element)
    entry = { refCount: 0, element }
    sceneStyleRegistry.set(namespace, entry)
  }
  entry.refCount += 1

  let released = false
  return () => {
    if (released) return
    released = true
    const current = sceneStyleRegistry.get(namespace)
    if (!current) return
    current.refCount -= 1
    if (current.refCount <= 0) {
      current.element.remove()
      sceneStyleRegistry.delete(namespace)
    }
  }
}

export function sceneNamespace(modId: string, revision: string): string {
  return `mod-${modId.replace(/[^a-z0-9-]/g, '-')}-${revision.slice(0, 8)}`
}
