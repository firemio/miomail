import type { MascotId } from '../data/mascots'
import { isNarrowViewport } from './useNarrowLayout'
import { safeStorage } from './safeStorage'

export interface CompanionPosition {
  x: number
  y: number
}

const STORAGE_KEY = 'miomail-companion-position'
/** 1カラム表示での居場所は別に覚える(広い画面で決めた居場所を上書きしないため)。 */
const NARROW_STORAGE_KEY = 'miomail-companion-position-narrow'
const MARGIN = 28
const SIZE = 96

/** 1カラム表示(スマホ幅)での相棒の大きさ。広い画面(96px)より一回り小さい。 */
export const NARROW_COMPANION_SIZE = 72
const NARROW_MARGIN = 6
/** 1カラム表示で相棒が入らない上端。タイトルバー(検索と設定。高さ 56px)の分。 */
const NARROW_TOP = 60

/** いまの表示での相棒の大きさ(正方形の一辺)。 */
export function companionSize(): number {
  return isNarrowViewport() ? NARROW_COMPANION_SIZE : SIZE
}

/**
 * 相棒が入れる範囲。1カラム表示(スマホ幅)でも画面の中を歩く。
 *
 * 2026-11-28 に一度、1カラム表示ではタイトルバーの左端へ固定した(小さな画面では
 * ボタンにかぶって押せないため)。同じ日に戻した。画面の中を歩き回るのが相棒の
 * いちばんの特徴で、固定するとそれが消える。かぶる問題は、相棒のほうがどくことで
 * 解く(blocksSmallControl / findFreeCompanionPosition)。
 */
function companionBounds() {
  const width = typeof window === 'undefined' ? 1440 : window.innerWidth
  const height = typeof window === 'undefined' ? 900 : window.innerHeight
  if (isNarrowViewport()) {
    const maxX = Math.max(NARROW_MARGIN, width - NARROW_COMPANION_SIZE - NARROW_MARGIN)
    const maxY = Math.max(NARROW_TOP, height - NARROW_COMPANION_SIZE - NARROW_MARGIN)
    return { width, height, minX: NARROW_MARGIN, maxX, minY: NARROW_TOP, maxY }
  }
  const maxX = Math.max(MARGIN, width - SIZE - MARGIN)
  const maxY = Math.max(92, height - SIZE - MARGIN)
  return { width, height, minX: MARGIN, maxX, minY: 92, maxY }
}

function storageKey(): string {
  return isNarrowViewport() ? NARROW_STORAGE_KEY : STORAGE_KEY
}

export function clampCompanionPosition(position: CompanionPosition): CompanionPosition {
  const { minX, maxX, minY, maxY } = companionBounds()
  return {
    x: Math.max(minX, Math.min(maxX, position.x)),
    y: Math.max(minY, Math.min(maxY, position.y)),
  }
}

export function loadCompanionPosition(): CompanionPosition {
  if (typeof window === 'undefined') return { x: 1080, y: 640 }
  try {
    const stored = JSON.parse(safeStorage.getItem(storageKey()) || 'null')
    if (Number.isFinite(stored?.x) && Number.isFinite(stored?.y)) return clampCompanionPosition(stored)
  } catch { /* use default */ }
  return clampCompanionPosition({ x: window.innerWidth * 0.72, y: window.innerHeight * 0.7 })
}

export function saveCompanionPosition(position: CompanionPosition) {
  if (typeof window === 'undefined') return
  safeStorage.setItem(storageKey(), JSON.stringify(clampCompanionPosition(position)))
}

export function randomCompanionPosition(seed = Date.now()): CompanionPosition {
  const { minX, maxX, minY, maxY } = companionBounds()
  const randomA = Math.abs(Math.sin(seed * 12.9898) * 43758.5453) % 1
  const randomB = Math.abs(Math.sin((seed + 17) * 78.233) * 19341.137) % 1
  return clampCompanionPosition({
    x: minX + randomA * Math.max(0, maxX - minX),
    y: minY + randomB * Math.max(0, maxY - minY),
  })
}

/** 押す所として数える要素。 */
const CONTROL_SELECTOR =
  'button, a[href], input, textarea, select, summary, [role="button"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="switch"], [contenteditable="true"]'
/** 押す所のうち、これ以上の割合を相棒が覆ったら「隠している」とみなす。 */
const HIDE_RATIO = 0.3

/**
 * その場所に相棒が立つと、小さな押す所を隠してしまうか。
 *
 * 一覧の行や本文の入力欄のように大きな押す所は、相棒の横を押せるので数えない
 * (覆う割合が小さい)。アイコンのボタンや「送信」のような小さな押す所は、
 * 相棒が乗ると押せなくなるので数える。
 *
 * `self` は相棒自身の要素。当たり判定から外す。
 */
export function blocksSmallControl(position: CompanionPosition, self: Element | null): boolean {
  if (typeof document === 'undefined' || typeof document.elementsFromPoint !== 'function') return false
  const size = companionSize()
  const right = position.x + size
  const bottom = position.y + size
  // 中心と、四隅の少し内側
  const inset = size * 0.22
  const probes: Array<[number, number]> = [
    [size / 2, size / 2],
    [inset, inset],
    [size - inset, inset],
    [inset, size - inset],
    [size - inset, size - inset],
  ]
  const checked = new Set<Element>()
  for (const [dx, dy] of probes) {
    const stack = document.elementsFromPoint(position.x + dx, position.y + dy)
    const top = stack.find((element) => !(self && self.contains(element)))
    const control = top?.closest(CONTROL_SELECTOR)
    if (!control || checked.has(control)) continue
    checked.add(control)
    const rect = control.getBoundingClientRect()
    const area = rect.width * rect.height
    if (area <= 0) continue
    const overlapWidth = Math.max(0, Math.min(right, rect.right) - Math.max(position.x, rect.left))
    const overlapHeight = Math.max(0, Math.min(bottom, rect.bottom) - Math.max(position.y, rect.top))
    if ((overlapWidth * overlapHeight) / area >= HIDE_RATIO) return true
  }
  return false
}

/**
 * 小さな押す所を隠さない居場所を探す。`near` を渡すと、見つかった中でいちばん近い所を返す
 * (どくときに画面の端まで歩かせないため)。見つからなければ null。
 */
export function findFreeCompanionPosition(
  self: Element | null,
  near?: CompanionPosition,
  seed = Date.now(),
): CompanionPosition | null {
  let best: CompanionPosition | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const candidate = randomCompanionPosition(seed + attempt * 7919)
    if (blocksSmallControl(candidate, self)) continue
    if (!near) return candidate
    const distance = Math.hypot(candidate.x - near.x, candidate.y - near.y)
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return best
}

export function getCompanionTravelRule(mascotId: MascotId) {
  if (mascotId === 'makko' || mascotId === 'mio') return { maxPixelsPerSecond: 42, easing: 'linear' }
  if (mascotId === 'posty') return { maxPixelsPerSecond: 110, easing: 'linear' }
  return { maxPixelsPerSecond: 80, easing: 'cubic-bezier(.22,.8,.28,1)' }
}

export function getSentTripTiming(mascotId: MascotId, start: CompanionPosition, destination: CompanionPosition) {
  const width = typeof window === 'undefined' ? 1440 : window.innerWidth
  const height = typeof window === 'undefined' ? 900 : window.innerHeight
  const post = { x: width * 0.42 + 72, y: height - 182 }
  const outboundDistance = Math.hypot(start.x - post.x, start.y - post.y)
  const returnDistance = Math.hypot(destination.x - post.x, destination.y - post.y)
  const rule = getCompanionTravelRule(mascotId)
  const outboundMs = Math.max(1600, Math.ceil((outboundDistance / (rule.maxPixelsPerSecond * 1.45)) * 1000))
  const returnMs = Math.max(1800, Math.ceil((returnDistance / rule.maxPixelsPerSecond) * 1000))
  return { ...rule, outboundMs, returnMs, totalMs: outboundMs + returnMs }
}
