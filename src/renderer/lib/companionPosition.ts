import type { MascotId } from '../data/mascots'

export interface CompanionPosition {
  x: number
  y: number
}

const STORAGE_KEY = 'miomail-companion-position'
const MARGIN = 28
const SIZE = 96

export function clampCompanionPosition(position: CompanionPosition): CompanionPosition {
  const width = typeof window === 'undefined' ? 1440 : window.innerWidth
  const height = typeof window === 'undefined' ? 900 : window.innerHeight
  return {
    x: Math.max(MARGIN, Math.min(width - SIZE - MARGIN, position.x)),
    y: Math.max(92, Math.min(height - SIZE - MARGIN, position.y)),
  }
}

export function loadCompanionPosition(): CompanionPosition {
  if (typeof window === 'undefined') return { x: 1080, y: 640 }
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null')
    if (Number.isFinite(stored?.x) && Number.isFinite(stored?.y)) return clampCompanionPosition(stored)
  } catch { /* use default */ }
  return clampCompanionPosition({ x: window.innerWidth * 0.72, y: window.innerHeight * 0.7 })
}

export function saveCompanionPosition(position: CompanionPosition) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(clampCompanionPosition(position)))
}

export function randomCompanionPosition(seed = Date.now()): CompanionPosition {
  const width = typeof window === 'undefined' ? 1440 : window.innerWidth
  const height = typeof window === 'undefined' ? 900 : window.innerHeight
  const randomA = Math.abs(Math.sin(seed * 12.9898) * 43758.5453) % 1
  const randomB = Math.abs(Math.sin((seed + 17) * 78.233) * 19341.137) % 1
  return clampCompanionPosition({
    x: MARGIN + randomA * (width - SIZE - MARGIN * 2),
    y: 110 + randomB * (height - SIZE - 110 - MARGIN),
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
