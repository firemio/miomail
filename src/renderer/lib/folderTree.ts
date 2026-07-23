import type { Folder } from '../types'

/**
 * フラットな Folder[] (IMAP の LIST 結果) から階層ツリーを構築するユーティリティ。
 *
 * 設計メモ:
 * - path の分解は各フォルダ自身の `delimiter` を使う。空の場合は `.` と `/`
 *   の両方を試し、path 中に実際に出現する方を採用する(両方なければ単一セグメント)。
 * - 親 path に対応する Folder が配列に存在しない場合(中間ノード欠落)は
 *   仮想ノード(virtual: true, folder: null)を生成して階層を維持する。
 *   仮想ノードは選択不可のラベルとして表示し、後から実フォルダが来たら実体化する。
 * - 兄弟ソートは mailStore.sortFolders と同じ優先順
 *   (inbox, sent, drafts, archive, junk, trash) をセグメント名に対して適用する。
 */

export interface FolderTreeNode {
  /** 実フォルダ。中間ノード欠落で作られた仮想ノードは null */
  folder: Folder | null
  /** このノードの表示セグメント(path の最終セグメント) */
  segment: string
  /** ルートからのフル path(実フォルダと同じ区切り文字で連結) */
  path: string
  /** ルートを 0 とする深さ */
  depth: number
  /** 中間ノード欠落により生成された仮想ノードかどうか */
  virtual: boolean
  children: FolderTreeNode[]
}

export interface FlatFolderEntry {
  node: FolderTreeNode
  folder: Folder
  depth: number
}

/** sortFolders (mailStore) と同じ優先順。こちらは兄弟ノードのセグメント名に適用する */
const PREFERRED_ORDER = ['inbox', 'sent', 'drafts', 'archive', 'junk', 'trash']

function folderSortKey(name: string): string {
  return name.toLowerCase()
}

function compareSegments(left: string, right: string): number {
  const leftKey = folderSortKey(left)
  const rightKey = folderSortKey(right)
  const leftIndex = PREFERRED_ORDER.findIndex((value) => leftKey.includes(value))
  const rightIndex = PREFERRED_ORDER.findIndex((value) => rightKey.includes(value))
  const normalizedLeft = leftIndex === -1 ? PREFERRED_ORDER.length : leftIndex
  const normalizedRight = rightIndex === -1 ? PREFERRED_ORDER.length : rightIndex

  if (normalizedLeft !== normalizedRight) {
    return normalizedLeft - normalizedRight
  }
  return leftKey.localeCompare(rightKey)
}

/** フォルダの path を分解して返す。delimiter 未指定時は `.` / `/` を両対応で推定する */
export function splitFolderPath(folder: Pick<Folder, 'path' | 'delimiter'>): {
  segments: string[]
  delimiter: string
} {
  const path = folder.path || ''
  const declared = (folder.delimiter || '').trim()

  if (declared) {
    return { segments: path.split(declared).filter((s) => s.length > 0), delimiter: declared }
  }

  // delimiter 不明: path 中に出現する方を採用(両方出る場合は多い方)
  const dotCount = path.split('.').length - 1
  const slashCount = path.split('/').length - 1
  if (dotCount === 0 && slashCount === 0) {
    return { segments: path ? [path] : [], delimiter: '/' }
  }
  const delimiter = dotCount >= slashCount ? '.' : '/'
  return { segments: path.split(delimiter).filter((s) => s.length > 0), delimiter }
}

/** ツリー全体を兄弟ソートする(破壊的に並べ替えて同じ配列を返す) */
export function sortFolderTree(nodes: FolderTreeNode[]): FolderTreeNode[] {
  nodes.sort((left, right) => {
    // 実フォルダは name(短縮名)優先、仮想ノードは segment で比較
    const leftName = left.folder?.name || left.segment
    const rightName = right.folder?.name || right.segment
    return compareSegments(leftName, rightName)
  })
  for (const node of nodes) {
    sortFolderTree(node.children)
  }
  return nodes
}

/**
 * Folder[] からフォルダツリーを構築する。
 * 入力順に依らず壊れないこと(例外を投げないこと)を最優先とする。
 */
export function buildFolderTree(folders: Folder[]): FolderTreeNode[] {
  const roots: FolderTreeNode[] = []
  const nodeByPath = new Map<string, FolderTreeNode>()

  const findOrCreateNode = (
    path: string,
    segment: string,
    depth: number,
    siblings: FolderTreeNode[]
  ): FolderTreeNode => {
    const existing = nodeByPath.get(path)
    if (existing) return existing

    const node: FolderTreeNode = {
      folder: null,
      segment,
      path,
      depth,
      virtual: true,
      children: [],
    }
    nodeByPath.set(path, node)
    siblings.push(node)
    return node
  }

  for (const folder of folders) {
    if (!folder || !folder.path) continue

    const { segments, delimiter } = splitFolderPath(folder)
    if (segments.length === 0) continue

    let siblings = roots
    let parentPath = ''

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]
      const currentPath = parentPath ? `${parentPath}${delimiter}${segment}` : segment
      const isLeaf = i === segments.length - 1

      const node = findOrCreateNode(currentPath, segment, i, siblings)

      if (isLeaf) {
        // 実フォルダで実体化(重複 path は先勝ち)
        if (!node.folder) {
          node.folder = folder
          node.virtual = false
        }
      }

      siblings = node.children
      parentPath = currentPath
    }
  }

  return sortFolderTree(roots)
}

/** 表示用にツリーを深さ優先でフラット化する(仮想ノードは除外) */
export function flattenFolderTree(nodes: FolderTreeNode[]): FlatFolderEntry[] {
  const entries: FlatFolderEntry[] = []

  const walk = (list: FolderTreeNode[]) => {
    for (const node of list) {
      if (node.folder) {
        entries.push({ node, folder: node.folder, depth: node.depth })
      }
      walk(node.children)
    }
  }

  walk(nodes)
  return entries
}

/**
 * 型レベル + ランタイムの簡易自己チェック(vitest 未導入のため開発者向けエクスポート)。
 * 正常系でツリーが構築できることのスモークテストとして使える。
 */
export function folderTreeSelfCheck(): boolean {
  const sample: Folder[] = [
    { id: 1, account_id: 1, path: 'INBOX', name: 'INBOX', delimiter: '.', flags: '', unread_count: 0, total_count: 0 },
    { id: 2, account_id: 1, path: 'INBOX.仕事.2025.案件A', name: '案件A', delimiter: '.', flags: '', unread_count: 3, total_count: 10 },
    { id: 3, account_id: 1, path: 'Archive/2024', name: '2024', delimiter: '', flags: '', unread_count: 0, total_count: 5 },
  ]

  const tree = buildFolderTree(sample)
  const flat = flattenFolderTree(tree)

  // 3 実フォルダ全てが到達可能であること
  if (flat.length !== 3) return false
  // INBOX 配下に 仕事(仮想) > 2025(仮想) > 案件A がぶら下がること
  const inbox = tree.find((node) => node.segment.toUpperCase() === 'INBOX')
  if (!inbox || inbox.children.length !== 1) return false
  const work = inbox.children[0]
  if (work.segment !== '仕事' || !work.virtual) return false
  const year = work.children[0]
  if (!year || year.segment !== '2025' || !year.virtual) return false
  const leaf = year.children[0]
  if (!leaf || leaf.folder?.id !== 2) return false
  // delimiter 空のフォルダが `/` で分解されること
  const archive = tree.find((node) => node.segment === 'Archive')
  if (!archive || archive.children.length !== 1 || archive.children[0].folder?.id !== 3) return false

  return true
}
