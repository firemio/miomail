import { create } from 'zustand'
import english from '../locales/en.json'
import korean from '../locales/ko.json'
import chinese from '../locales/zh-CN.json'
import spanish from '../locales/es.json'
import thai from '../locales/th.json'
import indonesian from '../locales/id.json'
import vietnamese from '../locales/vi.json'
import { safeStorage } from './safeStorage'

export const languages = [
  { id: 'ja', name: '日本語', region: 'JP', locale: 'ja-JP' },
  { id: 'en', name: 'English', region: 'US', locale: 'en-US' },
  { id: 'ko', name: '한국어', region: 'KR', locale: 'ko-KR' },
  { id: 'zh-CN', name: '中文', region: 'CN', locale: 'zh-CN' },
  { id: 'es', name: 'Español', region: 'ES', locale: 'es-ES' },
  { id: 'th', name: 'ไทย', region: 'TH', locale: 'th-TH-u-ca-gregory' },
  { id: 'id', name: 'Bahasa Indonesia', region: 'ID', locale: 'id-ID' },
  { id: 'vi', name: 'Tiếng Việt', region: 'VN', locale: 'vi-VN' },
] as const
export type Language = typeof languages[number]['id']
const catalogs: Partial<Record<Language, Record<string, string>>> = {
  en: english, ko: korean, 'zh-CN': chinese, es: spanish, th: thai, id: indonesian, vi: vietnamese,
}
export function isLanguage(value: unknown): value is Language {
  return languages.some((language) => language.id === value)
}
const STORAGE_KEY = 'miomail-language'

function loadLanguage(): Language {
  try {
    const value = safeStorage.getItem(STORAGE_KEY)
    return isLanguage(value) ? value : 'ja'
  } catch {
    return 'ja'
  }
}

export const useLanguage = create<{ language: Language; setLanguage: (language: Language) => void }>((set) => ({
  language: loadLanguage(),
  setLanguage: (language) => {
    if (!isLanguage(language)) return
    try { safeStorage.setItem(STORAGE_KEY, language) } catch { /* Keep the UI usable without storage. */ }
    set({ language })
  },
}))

/** Translate app-owned messages only. Never pass mail content or custom names. */
export function t(message: string, values: Record<string, string | number> = {}): string {
  const language = useLanguage.getState().language
  const translated = language === 'ja' ? message
    : catalogs[language]?.[message] ?? (english as Record<string, string>)[message] ?? message
  return translated.replace(/\{(\w+)\}/g, (match, key: string) => String(values[key] ?? match))
}

export function dateLocale(): string {
  return languages.find((language) => language.id === useLanguage.getState().language)?.locale ?? 'ja-JP'
}
