import type { MascotId } from '../data/mascots'
import { isNarrowViewport } from './useNarrowLayout'
import { safeStorage } from './safeStorage'

export interface CompanionPosition {
  x: number
  y: number
}

const STORAGE_KEY = 'miomail-companion-position'
const MARGIN = 28
const SIZE = 96

/** 1カラム表示(スマホ幅)での相棒の大きさ。タイトルバーに収まる寸法。 */
export const NARROW_COMPANION_SIZE = 44
/** 1カラム表示での相棒の定位置(タイトルバーの左端。ロゴが入っていた場所)。 */
const NARROW_SPOT: CompanionPosition = { x: 8, y: 10 }

/**
 * 相棒が入れる範囲。1カラム表示(スマホ幅)では画面が狭く、本文の上のどこにいても
 * 一覧の行・本文・「全アカウント同期」などのボタンにかぶって押せなくなる。
 * そこで、内容と重ならないタイトルバーの左端へ固定する(TitleBar が場所を空けている)。
 */
function companionBounds() {
  const width = typeof window === 'undefined' ? 1440 : window.innerWidth
  const height = typeof window === 'undefined' ? 900 : window.innerHeight
  if (isNarrowViewport()) {
    return { width, height, minX: NARROW_SPOT.x, maxX: NARROW_SPOT.x, minY: NARROW_SPOT.y, maxY: NARROW_SPOT.y }
  }
  const maxX = Math.max(MARGIN, width - SIZE - MARGIN)
  const maxY = Math.max(92, height - SIZE - MARGIN)
  return { width, height, minX: MARGIN, maxX, minY: 92, maxY }
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
    const stored = JSON.parse(safeStorage.getItem(STORAGE_KEY) || 'null')
    if (Number.isFinite(stored?.x) && Number.isFinite(stored?.y)) return clampCompanionPosition(stored)
  } catch { /* use default */ }
  return clampCompanionPosition({ x: window.innerWidth * 0.72, y: window.innerHeight * 0.7 })
}

export function saveCompanionPosition(position: CompanionPosition) {
  if (typeof window === 'undefined') return
  // 1カラム表示の定位置は覚えない(広い画面で決めた居場所を上書きしないため)
  if (isNarrowViewport()) return
  safeStorage.setItem(STORAGE_KEY, JSON.stringify(clampCompanionPosition(position)))
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
