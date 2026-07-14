import { create } from 'zustand'
import { type ThemeId } from '../data/themes'
import { loadThemeId, persistThemeId } from '../lib/theme'

export type ComposeMode = 'new' | 'reply' | 'forward'
export type ComposeLayout = 'docked' | 'floating'

export interface ComposeSourceSnapshot {
  id: number
  message_id: string
  subject: string
  from_address: string
  to_addresses: string
  cc_addresses: string
  date: string
  text_body: string
}

export interface ComposeDraft {
  id: string
  mode: ComposeMode
  layout: ComposeLayout
  from: string
  to: string
  cc: string
  subject: string
  body: string
  showCc: boolean
  isDirty: boolean
  position: { x: number; y: number }
  zIndex: number
  source?: ComposeSourceSnapshot
}

const COMPOSE_DRAFTS_STORAGE_KEY = 'miomail.compose-drafts.v1'

interface PersistedComposeState {
  drafts: ComposeDraft[]
  activeDockedComposeId: string | null
}

function loadComposeState(): PersistedComposeState {
  if (typeof window === 'undefined') return { drafts: [], activeDockedComposeId: null }

  try {
    const raw = window.localStorage.getItem(COMPOSE_DRAFTS_STORAGE_KEY)
    if (!raw) return { drafts: [], activeDockedComposeId: null }

    const saved = JSON.parse(raw) as Partial<PersistedComposeState>
    const drafts = Array.isArray(saved.drafts)
      ? saved.drafts.filter(
          (draft): draft is ComposeDraft =>
            Boolean(draft) &&
            typeof draft.id === 'string' &&
            typeof draft.subject === 'string' &&
            typeof draft.body === 'string'
        )
      : []
    const activeDockedComposeId = drafts.some(
      (draft) => draft.id === saved.activeDockedComposeId && draft.layout === 'docked'
    )
      ? saved.activeDockedComposeId ?? null
      : drafts.find((draft) => draft.layout === 'docked')?.id ?? null

    return { drafts, activeDockedComposeId }
  } catch {
    return { drafts: [], activeDockedComposeId: null }
  }
}

function persistComposeState(state: PersistedComposeState) {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(COMPOSE_DRAFTS_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Storage failures must not interrupt composing or sending mail.
  }
}

interface OpenComposeOptions {
  mode?: ComposeMode
  source?: ComposeSourceSnapshot
  fromAddress?: string
  layout?: ComposeLayout
}

interface UIState {
  showSettings: boolean
  showAccountSetup: boolean
  showImport: boolean
  searchQuery: string
  themeId: ThemeId
  composeDrafts: ComposeDraft[]
  activeDockedComposeId: string | null
  zCounter: number
  openSettings: () => void
  closeSettings: () => void
  setTheme: (themeId: ThemeId) => void
  openCompose: (options?: OpenComposeOptions) => string
  closeCompose: (draftId: string, force?: boolean) => boolean
  updateComposeDraft: (draftId: string, patch: Partial<ComposeDraft>) => void
  setActiveDockedCompose: (draftId: string) => void
  toggleComposeLayout: (draftId: string) => void
  moveCompose: (draftId: string, position: { x: number; y: number }) => void
  bringComposeToFront: (draftId: string) => void
  discardDraft: (draftId: string) => void
  openAccountSetup: () => void
  closeAccountSetup: () => void
  openImport: () => void
  closeImport: () => void
  setSearchQuery: (query: string) => void
}

function floatingPosition(index: number) {
  const width = typeof window !== 'undefined' ? window.innerWidth : 1600
  const column = index % 3
  const row = Math.floor(index / 3)
  return {
    x: Math.max(40, width - 560 - column * 560),
    y: 92 + row * 72 + column * 22,
  }
}

function makeReplyBody(source: ComposeSourceSnapshot) {
  const quoted = (source.text_body || '')
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
  return `\n\n---\n${source.date} / ${source.from_address}\n${quoted}`
}

function makeForwardBody(source: ComposeSourceSnapshot) {
  return [
    '',
    '',
    '--- Forwarded message ---',
    `差出人: ${source.from_address}`,
    `宛先: ${source.to_addresses}`,
    source.cc_addresses ? `CC: ${source.cc_addresses}` : '',
    `日時: ${source.date}`,
    `件名: ${source.subject || '件名なし'}`,
    '',
    source.text_body || '',
  ]
    .filter(Boolean)
    .join('\n')
}

function normalizeSubject(prefix: 'Re:' | 'Fwd:', subject: string) {
  const base = (subject || '').replace(/^Re:\s*/i, '').replace(/^Fwd:\s*/i, '').trim()
  return `${prefix} ${base || '件名なし'}`
}

function createDraft(options: OpenComposeOptions, index: number, zIndex: number): ComposeDraft {
  const mode = options.mode ?? 'new'
  const source = options.source

  if (mode === 'reply' && source) {
    return {
      id: crypto.randomUUID(),
      mode,
      layout: options.layout ?? 'docked',
      from: options.fromAddress ?? '',
      to: source.from_address,
      cc: '',
      subject: normalizeSubject('Re:', source.subject),
      body: makeReplyBody(source),
      showCc: false,
      isDirty: false,
      position: floatingPosition(index),
      zIndex,
      source,
    }
  }

  if (mode === 'forward' && source) {
    return {
      id: crypto.randomUUID(),
      mode,
      layout: options.layout ?? 'docked',
      from: options.fromAddress ?? '',
      to: '',
      cc: '',
      subject: normalizeSubject('Fwd:', source.subject),
      body: makeForwardBody(source),
      showCc: false,
      isDirty: false,
      position: floatingPosition(index),
      zIndex,
      source,
    }
  }

  return {
    id: crypto.randomUUID(),
    mode,
    layout: options.layout ?? 'docked',
    from: options.fromAddress ?? '',
    to: '',
    cc: '',
    subject: '',
    body: '',
    showCc: false,
    isDirty: false,
    position: floatingPosition(index),
    zIndex,
  }
}

const initialComposeState = loadComposeState()
const initialZCounter = Math.max(20, ...initialComposeState.drafts.map((draft) => draft.zIndex || 20))

export const useUIStore = create<UIState>((set, get) => ({
  showSettings: false,
  showAccountSetup: false,
  showImport: false,
  searchQuery: '',
  themeId: loadThemeId(),
  composeDrafts: initialComposeState.drafts,
  activeDockedComposeId: initialComposeState.activeDockedComposeId,
  zCounter: initialZCounter,

  openSettings: () => set({ showSettings: true }),
  closeSettings: () => set({ showSettings: false }),

  setTheme: (themeId) => {
    persistThemeId(themeId)
    set({ themeId })
  },

  openCompose: (options = {}) => {
    const { composeDrafts, zCounter } = get()
    const zIndex = zCounter + 1
    const draft = createDraft(options, composeDrafts.length, zIndex)
    set((state) => ({
      composeDrafts: [...state.composeDrafts, draft],
      activeDockedComposeId:
        draft.layout === 'docked' ? draft.id : state.activeDockedComposeId,
      zCounter: zIndex,
    }))
    return draft.id
  },

  closeCompose: (draftId, force = false) => {
    const draft = get().composeDrafts.find((item) => item.id === draftId)
    if (!draft) return true
    if (draft.isDirty && !force) {
      return false
    }

    set((state) => {
      const composeDrafts = state.composeDrafts.filter((item) => item.id !== draftId)
      const remainingDocked = composeDrafts.filter((item) => item.layout === 'docked')
      return {
        composeDrafts,
        activeDockedComposeId:
          state.activeDockedComposeId === draftId
            ? remainingDocked[remainingDocked.length - 1]?.id ?? null
            : state.activeDockedComposeId,
      }
    })
    return true
  },

  discardDraft: (draftId) => {
    get().closeCompose(draftId, true)
  },

  updateComposeDraft: (draftId, patch) =>
    set((state) => ({
      composeDrafts: state.composeDrafts.map((draft) =>
        draft.id === draftId
          ? {
              ...draft,
              ...patch,
              isDirty: patch.isDirty ?? true,
            }
          : draft
      ),
    })),

  setActiveDockedCompose: (draftId) => set({ activeDockedComposeId: draftId }),

  toggleComposeLayout: (draftId) =>
    set((state) => {
      const zIndex = state.zCounter + 1
      let activeDockedComposeId = state.activeDockedComposeId

      const composeDrafts = state.composeDrafts.map((draft, index) => {
        if (draft.id !== draftId) return draft

        if (draft.layout === 'docked') {
          if (activeDockedComposeId === draftId) {
            const nextDocked = state.composeDrafts.find(
              (item) => item.id !== draftId && item.layout === 'docked'
            )
            activeDockedComposeId = nextDocked?.id ?? null
          }
          return {
            ...draft,
            layout: 'floating' as const,
            position: floatingPosition(index),
            zIndex,
          }
        }

        activeDockedComposeId = draftId
        return {
          ...draft,
          layout: 'docked' as const,
        }
      })

      return { composeDrafts, activeDockedComposeId, zCounter: zIndex }
    }),

  moveCompose: (draftId, position) =>
    set((state) => ({
      composeDrafts: state.composeDrafts.map((draft) =>
        draft.id === draftId ? { ...draft, position } : draft
      ),
    })),

  bringComposeToFront: (draftId) =>
    set((state) => {
      const zIndex = state.zCounter + 1
      return {
        composeDrafts: state.composeDrafts.map((draft) =>
          draft.id === draftId ? { ...draft, zIndex } : draft
        ),
        zCounter: zIndex,
      }
    }),

  openAccountSetup: () => set({ showAccountSetup: true }),
  closeAccountSetup: () => set({ showAccountSetup: false }),
  openImport: () => set({ showImport: true }),
  closeImport: () => set({ showImport: false }),
  setSearchQuery: (query) => set({ searchQuery: query }),
}))

let lastPersistedComposeState = JSON.stringify(initialComposeState)

useUIStore.subscribe((state) => {
  const composeState = {
    drafts: state.composeDrafts,
    activeDockedComposeId: state.activeDockedComposeId,
  }
  const serialized = JSON.stringify(composeState)
  if (serialized === lastPersistedComposeState) return

  lastPersistedComposeState = serialized
  persistComposeState(composeState)
})
