import { t } from './i18n'
import type { Folder } from '../types'

export function getFolderDisplayName(folder: Folder): string {
  const map: Record<string, string> = {
    inbox: '受信トレイ',
    sent: '送信済み',
    'sent messages': '送信済み',
    'sent mail': '送信済み',
    drafts: '下書き',
    trash: 'ゴミ箱',
    'deleted items': 'ゴミ箱',
    junk: '迷惑メール',
    'junk e-mail': '迷惑メール',
    spam: '迷惑メール',
    archive: 'アーカイブ',
    starred: 'スター付き',
  }
  // Server paths identify standard folders even when the cached display name
  // was localized by an importer. Never translate an arbitrary custom name.
  const label = map[folder.path.toLowerCase()] || map[folder.name.toLowerCase()]
  return label ? t(label) : folder.name || folder.path
}

