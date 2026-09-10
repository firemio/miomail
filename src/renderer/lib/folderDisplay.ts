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
  const key = (folder.name || folder.path).toLowerCase()
  return map[key] || folder.name || folder.path
}

