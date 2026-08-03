import { create } from 'zustand'
import type {
  BuiltinCharacterRenderer,
  CharacterModInstallResult,
  CharacterModIssue,
  CharacterModPackage,
} from '../characters/types'
import { api } from '../lib/ipc'
import { pruneCharacterModAssetCache } from '../lib/characterMods'

const STORAGE_KEY = 'miomail-character-source-v1'

interface PersistedCharacterSource {
  builtinRenderer: BuiltinCharacterRenderer
  selectedModId: string | null
}

interface CharacterStore extends PersistedCharacterSource {
  packages: CharacterModPackage[]
  issues: CharacterModIssue[]
  loading: boolean
  installing: boolean
  error: string | null
  selectBuiltinRenderer: (renderer: BuiltinCharacterRenderer) => void
  selectMod: (modId: string) => void
  refreshMods: () => Promise<void>
  installArchive: () => Promise<CharacterModInstallResult | null>
  openModsFolder: () => Promise<void>
}

const fallback: PersistedCharacterSource = {
  builtinRenderer: 'soft-3d',
  selectedModId: null,
}

function loadSelection(): PersistedCharacterSource {
  if (typeof window === 'undefined') return fallback
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<PersistedCharacterSource>
    return {
      builtinRenderer: parsed.builtinRenderer === 'classic-2d' ? 'classic-2d' : 'soft-3d',
      selectedModId: typeof parsed.selectedModId === 'string' && parsed.selectedModId
        ? parsed.selectedModId
        : null,
    }
  } catch {
    return fallback
  }
}

function persist(selection: PersistedCharacterSource) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(selection))
  } catch {
    // A storage failure must not prevent the built-in character from rendering.
  }
}

const initial = loadSelection()

export const useCharacterStore = create<CharacterStore>((set, get) => ({
  ...initial,
  packages: [],
  issues: [],
  loading: false,
  installing: false,
  error: null,

  selectBuiltinRenderer: (builtinRenderer) => {
    const selection = { builtinRenderer, selectedModId: null }
    persist(selection)
    set(selection)
    pruneCharacterModAssetCache(get().packages, null)
  },

  selectMod: (selectedModId) => {
    const selection = { builtinRenderer: get().builtinRenderer, selectedModId }
    persist(selection)
    set(selection)
    pruneCharacterModAssetCache(get().packages, selectedModId)
  },

  refreshMods: async () => {
    if (get().loading) return
    set({ loading: true, error: null })
    try {
      const result = await api.characterMods.list()
      pruneCharacterModAssetCache(result.packages, get().selectedModId)
      set({ packages: result.packages, issues: result.issues, loading: false })
    } catch (error) {
      pruneCharacterModAssetCache([])
      set({
        packages: [],
        issues: [],
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  },

  installArchive: async () => {
    if (get().installing) return null
    set({ installing: true, error: null })
    try {
      const result = await api.characterMods.installArchive()
      if (!result) {
        set({ installing: false })
        return null
      }
      set({ packages: result.scan.packages, issues: result.scan.issues, installing: false })
      get().selectMod(result.installedId)
      return result
    } catch (error) {
      set({
        installing: false,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  },

  openModsFolder: async () => {
    try {
      await api.characterMods.openFolder()
      set({ error: null })
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
    }
  },
}))

export function getSelectedCharacterMod() {
  const { selectedModId, packages } = useCharacterStore.getState()
  return packages.find((item) => item.manifest.id === selectedModId) ?? null
}
