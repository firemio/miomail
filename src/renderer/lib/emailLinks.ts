import { invoke } from '@tauri-apps/api/core'
import { isTauriRuntime } from './ipc'

export async function openEmailLink(href: string) {
  const value = href.trim()
  const url = new URL(value.startsWith('//') ? `https:${value}` : value)
  if (!['https:', 'http:', 'mailto:'].includes(url.protocol)) return

  if (isTauriRuntime) {
    // Never fall back to WebView navigation when the system opener fails.
    await invoke('plugin:opener|open_url', { url: url.href })
  } else {
    window.open(url.href, '_blank', 'noopener,noreferrer')
  }
}

/** Installed by the parent app: the mail frame never needs script permission. */
export function bindEmailLinks(doc: Document, onError: (error: unknown) => void) {
  const onClick = (event: MouseEvent) => {
    if (event.button !== 0 && event.button !== 1) return
    const target = event.target as Element | null
    const anchor = target?.closest?.('a[href], area[href]')
    if (!anchor) return
    event.preventDefault()
    const href = anchor.getAttribute('href')?.trim()
    if (!href) return
    if (href.startsWith('#')) {
      try {
        const id = decodeURIComponent(href.slice(1))
        const destination = doc.getElementById(id) ?? doc.getElementsByName(id)[0]
        destination?.scrollIntoView()
      } catch { /* Ignore malformed fragment identifiers. */ }
      return
    }
    void openEmailLink(href).catch(onError)
  }
  doc.addEventListener('click', onClick)
  doc.addEventListener('auxclick', onClick)
}
