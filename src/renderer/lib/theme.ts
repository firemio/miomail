import { THEME_IDS, type ThemeId } from '../data/themes'
import { safeStorage } from './safeStorage'

const THEME_STORAGE_KEY = 'miomail-ui-theme'

export function getDefaultThemeId(): ThemeId {
  return 'petal-pop'
}

export function parseThemeId(value: unknown): ThemeId {
  return typeof value === 'string' && THEME_IDS.includes(value as ThemeId)
    ? (value as ThemeId)
    : getDefaultThemeId()
}

export function loadThemeId(): ThemeId {
  if (typeof window === 'undefined') {
    return getDefaultThemeId()
  }

  try {
    return parseThemeId(safeStorage.getItem(THEME_STORAGE_KEY))
  } catch {
    return getDefaultThemeId()
  }
}

export function persistThemeId(themeId: ThemeId) {
  if (typeof window === 'undefined') {
    return
  }

  safeStorage.setItem(THEME_STORAGE_KEY, themeId)
}