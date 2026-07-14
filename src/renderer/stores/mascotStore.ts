import { create } from 'zustand'
import { MASCOT_IDS, type MascotId } from '../data/mascots'

const STORAGE_KEY = 'miomail-mascot-state'
const DECAY_STEP_MS = 1000 * 60 * 45
const STREAK_WINDOW_MS = 1000 * 60 * 60 * 36

export type MascotCareAction = 'feed' | 'play' | 'rest' | 'clean'
export type MascotNeed = 'fullness' | 'mood' | 'energy' | 'cleanliness'
export type MascotCondition = 'great' | 'good' | 'watch' | 'needs-care'
export type MascotPhase = 'egg' | 'hatchling' | 'courier' | 'partner' | 'star'
export type MascotMoodFace = 'sparkle' | 'calm' | 'sleepy' | 'hungry' | 'grumpy' | 'dirty'

export const MASCOT_GROWTH_STAGES: ReadonlyArray<{ phase: MascotPhase; minBond: number }> = [
  { phase: 'egg', minBond: 0 },
  { phase: 'hatchling', minBond: 8 },
  { phase: 'courier', minBond: 20 },
  { phase: 'partner', minBond: 40 },
  { phase: 'star', minBond: 72 },
]

export interface MascotCareStats {
  fullness: number
  mood: number
  energy: number
  cleanliness: number
  lastUpdatedAt: number
}

export interface MascotEvolutionEvent {
  mascotId: MascotId
  phase: MascotPhase
  bond: number
  at: number
}

export interface MascotSummonEvent {
  at: number
  reason: 'unread' | 'new-mail' | 'sent'
  message: string
  intensity: 'soft' | 'burst' | 'launch'
}

interface MascotSnapshot {
  selectedMascotId: MascotId
  bondByMascot: Record<MascotId, number>
  careByMascot: Record<MascotId, MascotCareStats>
  unlockedPhaseByMascot: Record<MascotId, MascotPhase>
  streakDays: number
  lastCareAt: number | null
  lastCareDayKey: string | null
}

interface MascotStore extends MascotSnapshot {
  evolutionEvent: MascotEvolutionEvent | null
  summonEvent: MascotSummonEvent | null
  selectMascot: (id: MascotId) => void
  gainBond: (amount: number) => void
  cheerMascot: () => void
  careForMascot: (action: MascotCareAction) => void
  rewardPostDelivery: (need: MascotNeed) => void
  refreshMascotState: () => void
  pulseUnreadAttention: (unreadCount: number) => void
  notifyIncomingMail: (from: string, subject: string) => void
  notifySentMail: (to: string, subject: string) => void
  dismissEvolutionEvent: () => void
  dismissSummonEvent: () => void
  debugSetPhase: (phase: MascotPhase) => void
  debugEvolveFrom: (phase: MascotPhase) => void
}

const DEFAULT_BOND_BY_MASCOT: Record<MascotId, number> = {
  makko: 6,
  mio: 3,
  posty: 1,
  saeta: 2,
}

const DEFAULT_CARE_BY_MASCOT: Record<MascotId, MascotCareStats> = {
  makko: defaultCareStats({ fullness: 84, mood: 88, energy: 76, cleanliness: 90 }),
  mio: defaultCareStats({ fullness: 72, mood: 74, energy: 84, cleanliness: 76 }),
  posty: defaultCareStats({ fullness: 66, mood: 70, energy: 68, cleanliness: 82 }),
  saeta: defaultCareStats({ fullness: 78, mood: 82, energy: 91, cleanliness: 74 }),
}

const DEFAULT_UNLOCKED_PHASE_BY_MASCOT: Record<MascotId, MascotPhase> = {
  makko: 'egg',
  mio: 'egg',
  posty: 'egg',
  saeta: 'egg',
}

function clampGauge(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function clampBond(value: number) {
  return Math.max(0, Math.min(999, Math.round(value)))
}

function getDayKey(timestamp: number) {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function defaultCareStats(partial: Partial<MascotCareStats> = {}): MascotCareStats {
  return {
    fullness: clampGauge(partial.fullness ?? 78),
    mood: clampGauge(partial.mood ?? 80),
    energy: clampGauge(partial.energy ?? 74),
    cleanliness: clampGauge(partial.cleanliness ?? 82),
    lastUpdatedAt: Number(partial.lastUpdatedAt ?? Date.now()),
  }
}

function defaultState(): MascotSnapshot {
  return {
    selectedMascotId: 'makko',
    bondByMascot: { ...DEFAULT_BOND_BY_MASCOT },
    careByMascot: Object.fromEntries(
      MASCOT_IDS.map((id) => [id, { ...DEFAULT_CARE_BY_MASCOT[id] }])
    ) as Record<MascotId, MascotCareStats>,
    unlockedPhaseByMascot: { ...DEFAULT_UNLOCKED_PHASE_BY_MASCOT },
    streakDays: 0,
    lastCareAt: null,
    lastCareDayKey: null,
  }
}

function getSnapshot(state: MascotSnapshot | MascotStore): MascotSnapshot {
  return {
    selectedMascotId: state.selectedMascotId,
    bondByMascot: { ...state.bondByMascot },
    careByMascot: Object.fromEntries(
      MASCOT_IDS.map((id) => [id, { ...state.careByMascot[id] }])
    ) as Record<MascotId, MascotCareStats>,
    unlockedPhaseByMascot: { ...state.unlockedPhaseByMascot },
    streakDays: state.streakDays,
    lastCareAt: state.lastCareAt,
    lastCareDayKey: state.lastCareDayKey,
  }
}

function parseSelectedMascotId(value: unknown): MascotId {
  return typeof value === 'string' && MASCOT_IDS.includes(value as MascotId)
    ? (value as MascotId)
    : 'makko'
}

function parseCareStats(value: unknown, fallback: Partial<MascotCareStats> = {}) {
  const care = value as Partial<MascotCareStats> | undefined
  return defaultCareStats({
    fullness: Number(care?.fullness ?? fallback.fullness ?? 78),
    mood: Number(care?.mood ?? fallback.mood ?? 80),
    energy: Number(care?.energy ?? fallback.energy ?? 74),
    cleanliness: Number(care?.cleanliness ?? fallback.cleanliness ?? 82),
    lastUpdatedAt: Number(care?.lastUpdatedAt ?? fallback.lastUpdatedAt ?? Date.now()),
  })
}

function loadInitialState(): MascotSnapshot {
  const fallback = defaultState()
  if (typeof window === 'undefined') {
    return fallback
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return fallback
    }

    const parsed = JSON.parse(raw)
    const bondByMascot = Object.fromEntries(
      MASCOT_IDS.map((id) => [
        id,
        clampBond(Number(parsed.bondByMascot?.[id] ?? fallback.bondByMascot[id])),
      ])
    ) as Record<MascotId, number>
    return {
      selectedMascotId: parseSelectedMascotId(parsed.selectedMascotId),
      bondByMascot,
      careByMascot: Object.fromEntries(
        MASCOT_IDS.map((id) => [
          id,
          parseCareStats(parsed.careByMascot?.[id], fallback.careByMascot[id]),
        ])
      ) as Record<MascotId, MascotCareStats>,
      unlockedPhaseByMascot: Object.fromEntries(
        MASCOT_IDS.map((id) => [id, getMascotPhase(bondByMascot[id])])
      ) as Record<MascotId, MascotPhase>,
      streakDays: Math.max(0, Number(parsed.streakDays ?? fallback.streakDays)),
      lastCareAt: parsed.lastCareAt ? Number(parsed.lastCareAt) : null,
      lastCareDayKey: typeof parsed.lastCareDayKey === 'string' ? parsed.lastCareDayKey : null,
    }
  } catch {
    return fallback
  }
}

function persist(state: MascotSnapshot | MascotStore) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(getSnapshot(state)))
}

function applyDecayToCare(care: MascotCareStats, now: number) {
  const elapsed = Math.max(0, now - care.lastUpdatedAt)
  const steps = Math.floor(elapsed / DECAY_STEP_MS)
  if (steps <= 0) {
    return care
  }

  const fullness = clampGauge(care.fullness - steps * 6)
  const energy = clampGauge(care.energy - steps * 5)
  const cleanliness = clampGauge(care.cleanliness - steps * 3)
  const moodPenalty = (fullness < 28 ? 2 : 0) + (cleanliness < 28 ? 1 : 0)
  const mood = clampGauge(care.mood - steps * (4 + moodPenalty))

  return {
    fullness,
    mood,
    energy,
    cleanliness,
    lastUpdatedAt: care.lastUpdatedAt + steps * DECAY_STEP_MS,
  }
}

function refreshSnapshot(snapshot: MascotSnapshot, now: number) {
  return {
    ...snapshot,
    careByMascot: Object.fromEntries(
      MASCOT_IDS.map((id) => [id, applyDecayToCare(snapshot.careByMascot[id], now)])
    ) as Record<MascotId, MascotCareStats>,
  }
}

function updateSelectedCare(
  snapshot: MascotSnapshot,
  updater: (current: MascotCareStats) => MascotCareStats
) {
  const mascotId = snapshot.selectedMascotId
  return {
    ...snapshot,
    careByMascot: {
      ...snapshot.careByMascot,
      [mascotId]: updater(snapshot.careByMascot[mascotId]),
    },
  }
}

function rewardMailActivity(snapshot: MascotSnapshot, amount: number, now: number) {
  let next = updateSelectedCare(snapshot, (current) => ({
    ...current,
    mood: clampGauge(current.mood + Math.max(2, Math.min(10, amount * 2))),
    energy: clampGauge(current.energy + Math.max(1, Math.ceil(amount / 2))),
    fullness: clampGauge(current.fullness - (amount >= 3 ? 1 : 0)),
    cleanliness: clampGauge(current.cleanliness - (amount >= 3 ? 1 : 0)),
    lastUpdatedAt: now,
  }))

  next = applyStreak(next, now)
  return next
}

function phaseOrder(phase: MascotPhase) {
  switch (phase) {
    case 'egg':
      return 0
    case 'hatchling':
      return 1
    case 'courier':
      return 2
    case 'partner':
      return 3
    case 'star':
      return 4
  }
}

function maybeUnlockPhase(snapshot: MascotSnapshot, mascotId: MascotId) {
  const nextPhase = getMascotPhase(snapshot.bondByMascot[mascotId] ?? 0)
  const currentPhase = snapshot.unlockedPhaseByMascot[mascotId]
  if (phaseOrder(nextPhase) <= phaseOrder(currentPhase)) {
    return { snapshot, evolutionEvent: null as MascotEvolutionEvent | null }
  }

  return {
    snapshot: {
      ...snapshot,
      unlockedPhaseByMascot: {
        ...snapshot.unlockedPhaseByMascot,
        [mascotId]: nextPhase,
      },
    },
    evolutionEvent: {
      mascotId,
      phase: nextPhase,
      bond: snapshot.bondByMascot[mascotId],
      at: Date.now(),
    },
  }
}

function applyStreak(snapshot: MascotSnapshot, now: number) {
  const today = getDayKey(now)
  if (snapshot.lastCareDayKey === today) {
    return snapshot
  }

  const keepStreak =
    snapshot.lastCareAt !== null && now - snapshot.lastCareAt <= STREAK_WINDOW_MS

  return {
    ...snapshot,
    streakDays: keepStreak ? snapshot.streakDays + 1 : 1,
    lastCareAt: now,
    lastCareDayKey: today,
    bondByMascot: {
      ...snapshot.bondByMascot,
      [snapshot.selectedMascotId]: clampBond(
        snapshot.bondByMascot[snapshot.selectedMascotId] + (keepStreak ? 2 : 1)
      ),
    },
  }
}

const initial = loadInitialState()

export const useMascotStore = create<MascotStore>((set) => ({
  selectedMascotId: initial.selectedMascotId,
  bondByMascot: initial.bondByMascot,
  careByMascot: initial.careByMascot,
  unlockedPhaseByMascot: initial.unlockedPhaseByMascot,
  streakDays: initial.streakDays,
  lastCareAt: initial.lastCareAt,
  lastCareDayKey: initial.lastCareDayKey,
  evolutionEvent: null,
  summonEvent: null,

  selectMascot: (id) =>
    set((state) => {
      const next = {
        ...refreshSnapshot(getSnapshot(state), Date.now()),
        selectedMascotId: id,
      }
      persist(next)
      return { ...next, evolutionEvent: null, summonEvent: state.summonEvent }
    }),

  gainBond: (amount) =>
    set((state) => {
      const now = Date.now()
      let next = refreshSnapshot(getSnapshot(state), now)
      next = rewardMailActivity(next, amount, now)
      next.bondByMascot[next.selectedMascotId] = clampBond(
        next.bondByMascot[next.selectedMascotId] + amount
      )
      const unlocked = maybeUnlockPhase(next, next.selectedMascotId)
      next = unlocked.snapshot
      persist(next)
      return {
        ...next,
        evolutionEvent: unlocked.evolutionEvent,
        summonEvent: state.summonEvent,
      }
    }),

  cheerMascot: () =>
    set((state) => {
      const now = Date.now()
      const base = refreshSnapshot(getSnapshot(state), now)
      let next = updateSelectedCare(base, (current) => ({
        ...current,
        mood: clampGauge(current.mood + 8),
        energy: clampGauge(current.energy + 2),
        lastUpdatedAt: now,
      }))
      next.bondByMascot[next.selectedMascotId] = clampBond(
        next.bondByMascot[next.selectedMascotId] + 1
      )
      const unlocked = maybeUnlockPhase(next, next.selectedMascotId)
      next = unlocked.snapshot
      persist(next)
      return {
        ...next,
        evolutionEvent: unlocked.evolutionEvent,
        summonEvent: state.summonEvent,
      }
    }),

  careForMascot: (action) =>
    set((state) => {
      const now = Date.now()
      const base = refreshSnapshot(getSnapshot(state), now)
      let next = updateSelectedCare(base, (current) => {
        switch (action) {
          case 'feed':
            return {
              ...current,
              fullness: clampGauge(current.fullness + 18),
              mood: clampGauge(current.mood + 4),
              cleanliness: clampGauge(current.cleanliness - 2),
              lastUpdatedAt: now,
            }
          case 'play':
            return {
              ...current,
              fullness: clampGauge(current.fullness - 4),
              mood: clampGauge(current.mood + 18),
              energy: clampGauge(current.energy - 6),
              lastUpdatedAt: now,
            }
          case 'rest':
            return {
              ...current,
              energy: clampGauge(current.energy + 22),
              mood: clampGauge(current.mood + 5),
              lastUpdatedAt: now,
            }
          case 'clean':
            return {
              ...current,
              cleanliness: clampGauge(current.cleanliness + 24),
              mood: clampGauge(current.mood + 3),
              lastUpdatedAt: now,
            }
        }
      })
      next.bondByMascot[next.selectedMascotId] = clampBond(
        next.bondByMascot[next.selectedMascotId] + 1
      )
      next = applyStreak(next, now)
      const unlocked = maybeUnlockPhase(next, next.selectedMascotId)
      next = unlocked.snapshot
      persist(next)
      return {
        ...next,
        evolutionEvent: unlocked.evolutionEvent,
        summonEvent: state.summonEvent,
      }
    }),

  rewardPostDelivery: (need) =>
    set((state) => {
      const now = Date.now()
      let next = updateSelectedCare(refreshSnapshot(getSnapshot(state), now), (current) => ({
        ...current,
        [need]: clampGauge(current[need] + 10),
        lastUpdatedAt: now,
      }))
      next.bondByMascot[next.selectedMascotId] = clampBond(
        next.bondByMascot[next.selectedMascotId] + 1
      )
      const unlocked = maybeUnlockPhase(next, next.selectedMascotId)
      next = unlocked.snapshot
      persist(next)
      return {
        ...next,
        evolutionEvent: unlocked.evolutionEvent,
        summonEvent: state.summonEvent,
      }
    }),

  refreshMascotState: () =>
    set((state) => {
      const next = refreshSnapshot(getSnapshot(state), Date.now())
      persist(next)
      return {
        ...next,
        evolutionEvent: state.evolutionEvent,
        summonEvent: state.summonEvent,
      }
    }),

  pulseUnreadAttention: (unreadCount) =>
    set(() => {
      if (unreadCount <= 0) {
        return { summonEvent: null }
      }
      return {
        summonEvent: {
          at: Date.now(),
          reason: 'unread',
            intensity: unreadCount >= 5 ? 'burst' : 'soft',
          message:
            unreadCount >= 5
              ? `未読が ${unreadCount} 通たまってるよ。そろそろのぞいてみる？`
              : `未読が ${unreadCount} 通あるよ。ちょっと見に行ってみる？`,
        },
      }
    }),

  notifyIncomingMail: (from, subject) =>
    set(() => ({
      summonEvent: {
        at: Date.now(),
        reason: 'new-mail',
          intensity: 'burst',
        message: `${from || '新しい差出人'} から「${subject || '件名なし'}」が届いたよ。`,
      },
    })),

  notifySentMail: (to, subject) =>
    set(() => ({
      summonEvent: {
        at: Date.now(),
        reason: 'sent',
          intensity: 'launch',
        message: `${to || '宛先未設定'} に「${subject || '件名なし'}」を送ったよ。`,
      },
    })),

  dismissEvolutionEvent: () => set({ evolutionEvent: null }),
  dismissSummonEvent: () => set({ summonEvent: null }),

  debugSetPhase: (phase) =>
    set((state) => {
      const stage = MASCOT_GROWTH_STAGES.find((item) => item.phase === phase)
      if (!stage) return state
      const next = getSnapshot(state)
      next.bondByMascot[next.selectedMascotId] = stage.minBond
      next.unlockedPhaseByMascot[next.selectedMascotId] = phase
      persist(next)
      return { ...next, evolutionEvent: null, summonEvent: null }
    }),

  debugEvolveFrom: (phase) =>
    set((state) => {
      const startIndex = MASCOT_GROWTH_STAGES.findIndex((item) => item.phase === phase)
      const nextStage = MASCOT_GROWTH_STAGES[startIndex + 1]
      if (startIndex < 0 || !nextStage) return state
      const next = getSnapshot(state)
      next.bondByMascot[next.selectedMascotId] = nextStage.minBond
      next.unlockedPhaseByMascot[next.selectedMascotId] = nextStage.phase
      persist(next)
      return {
        ...next,
        summonEvent: null,
        evolutionEvent: {
          mascotId: next.selectedMascotId,
          phase: nextStage.phase,
          bond: nextStage.minBond,
          at: Date.now(),
        },
      }
    }),
}))

export function getMascotProgress(bond: number) {
  const currentStageIndex = [...MASCOT_GROWTH_STAGES]
    .reverse()
    .findIndex((stage) => bond >= stage.minBond)
  const normalizedIndex = currentStageIndex < 0
    ? 0
    : MASCOT_GROWTH_STAGES.length - 1 - currentStageIndex
  const previousGoal = MASCOT_GROWTH_STAGES[normalizedIndex].minBond
  const nextGoal = MASCOT_GROWTH_STAGES[normalizedIndex + 1]?.minBond ?? 120

  return {
    current: bond,
    nextGoal,
    progress:
      nextGoal === previousGoal
        ? 1
        : Math.max(0, Math.min(1, (bond - previousGoal) / (nextGoal - previousGoal))),
  }
}

export function getMascotCondition(care: MascotCareStats) {
  const entries: [MascotNeed, number][] = [
    ['fullness', care.fullness],
    ['mood', care.mood],
    ['energy', care.energy],
    ['cleanliness', care.cleanliness],
  ]
  const [lowestNeed, lowestValue] = entries.reduce((lowest, current) =>
    current[1] < lowest[1] ? current : lowest
  )
  const overall =
    (care.fullness + care.mood + care.energy + care.cleanliness) / entries.length
  const status: MascotCondition =
    overall >= 86 ? 'great' : overall >= 68 ? 'good' : overall >= 45 ? 'watch' : 'needs-care'

  return {
    overall: Math.round(overall),
    lowestNeed,
    lowestValue,
    status,
  }
}

export function getMascotConditionLabel(condition: MascotCondition) {
  switch (condition) {
    case 'great':
      return 'ごきげん'
    case 'good':
      return 'いい感じ'
    case 'watch':
      return 'そろそろお世話'
    default:
      return '要お世話'
  }
}

export function getMascotNeedLabel(need: MascotNeed) {
  switch (need) {
    case 'fullness':
      return 'おなか'
    case 'mood':
      return 'ごきげん'
    case 'energy':
      return 'げんき'
    default:
      return 'みだしなみ'
  }
}

export function getMascotPhase(bond: number): MascotPhase {
  return [...MASCOT_GROWTH_STAGES]
    .reverse()
    .find((stage) => bond >= stage.minBond)?.phase ?? 'egg'
}

export function getMascotPhaseLabel(phase: MascotPhase) {
  switch (phase) {
    case 'star':
      return 'きらきら期'
    case 'partner':
      return '相棒期'
    case 'courier':
      return '配達デビュー期'
    case 'hatchling':
      return 'ぴよぴよ期'
    default:
      return 'たまご期'
  }
}

export function getMascotStatusHint(care: MascotCareStats) {
  const condition = getMascotCondition(care)
  if (condition.lowestValue >= 72) {
    return 'すっかりごきげん。メールの相棒として絶好調です。'
  }

  switch (condition.lowestNeed) {
    case 'fullness':
      return 'おなかがすいてきたみたい。おやつをあげると元気になります。'
    case 'mood':
      return 'ちょっとさびしそう。あそんであげると笑顔が戻ります。'
    case 'energy':
      return '少し眠たそうです。ひとやすみで回復させてあげましょう。'
    default:
      return '配達でくたびれ気味。おふろでさっぱりさせてあげると安心です。'
  }
}

export function getMascotMoodFace(care: MascotCareStats): MascotMoodFace {
  if (care.cleanliness <= 28) return 'dirty'
  if (care.fullness <= 24) return 'hungry'
  if (care.energy <= 26) return 'sleepy'
  if (care.mood <= 26) return 'grumpy'
  if (care.mood >= 86 && care.energy >= 66) return 'sparkle'
  return 'calm'
}
