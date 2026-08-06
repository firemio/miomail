import { create } from 'zustand'
import type {
  CharacterModInstallResult,
  CharacterModIssue,
  CharacterModPackage,
} from '../characters/types'
import { DEFAULT_MOD_ID_BY_MASCOT } from '../characters/types'
import { api } from '../lib/ipc'
import { pruneCharacterModAssetCache } from '../lib/characterMods'

const STORAGE_KEY = 'miomail-character-source-v1'

interface PersistedCharacterSource {
  /** null = 選択中マスコットも既定の同梱MODで描く */
  selectedModId: string | null
}

interface CharacterStore extends PersistedCharacterSource {
  packages: CharacterModPackage[]
  issues: CharacterModIssue[]
  loading: boolean
  installing: boolean
  error: string | null
  selectMod: (modId: string | null) => void
  refreshMods: () => Promise<void>
  installArchive: () => Promise<CharacterModInstallResult | null>
  openModsFolder: () => Promise<void>
}

const fallback: PersistedCharacterSource = {
  selectedModId: null,
}

function loadSelection(): PersistedCharacterSource {
  if (typeof window === 'undefined') return fallback
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<PersistedCharacterSource>
    return {
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
    // 保存に失敗してもキャラクター表示は継続する
  }
}

// 既定4キャラの同梱MODは常に描画に使うため、キャッシュから追い出さない
function liveModIds(selectedModId: string | null) {
  const ids = Object.values(DEFAULT_MOD_ID_BY_MASCOT)
  if (selectedModId && !ids.includes(selectedModId)) ids.push(selectedModId)
  return ids
}

const initial = loadSelection()

export const useCharacterStore = create<CharacterStore>((set, get) => ({
  ...initial,
  packages: [],
  issues: [],
  loading: false,
  installing: false,
  error: null,

  selectMod: (selectedModId) => {
    const selection = { selectedModId }
    persist(selection)
    set(selection)
    pruneCharacterModAssetCache(get().packages, liveModIds(selectedModId))
  },

  refreshMods: async () => {
    if (get().loading) return
    set({ loading: true, error: null })
    try {
      const result = await api.characterMods.list()
      pruneCharacterModAssetCache(result.packages, liveModIds(get().selectedModId))
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
