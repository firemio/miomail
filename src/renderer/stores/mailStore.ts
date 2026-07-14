import { create } from 'zustand'
import { api } from '../lib/ipc'
import type { Account, Folder, Message, MessageFull } from '../types'

const PAGE_SIZE = 50

function parseFlags(flags: string): string[] {
  try {
    return JSON.parse(flags || '[]')
  } catch {
    return []
  }
}

function withSeenFlag(flags: string, read: boolean): string {
  const parsed = parseFlags(flags)
  const next = read
    ? Array.from(new Set([...parsed, '\\Seen']))
    : parsed.filter((flag) => flag !== '\\Seen')
  return JSON.stringify(next)
}

function sortMessagesByDate(messages: Message[]) {
  return [...messages].sort((left, right) => (right.date_ts || 0) - (left.date_ts || 0))
}

function sortFolders(folders: Folder[]) {
  const preferredOrder = ['inbox', 'sent', 'drafts', 'archive', 'junk', 'trash']

  return [...folders].sort((left, right) => {
    const leftKey = `${left.name || left.path}`.toLowerCase()
    const rightKey = `${right.name || right.path}`.toLowerCase()
    const leftIndex = preferredOrder.findIndex((value) => leftKey.includes(value))
    const rightIndex = preferredOrder.findIndex((value) => rightKey.includes(value))
    const normalizedLeft = leftIndex === -1 ? preferredOrder.length : leftIndex
    const normalizedRight = rightIndex === -1 ? preferredOrder.length : rightIndex

    if (normalizedLeft !== normalizedRight) {
      return normalizedLeft - normalizedRight
    }

    return leftKey.localeCompare(rightKey)
  })
}

interface MailState {
  accounts: Account[]
  allFolders: Map<number, Folder[]>
  currentFolder: Folder | null
  messages: Message[]
  hasMoreMessages: boolean
  loadingMore: boolean
  currentMessage: MessageFull | null
  loading: boolean
  syncing: boolean
  searching: boolean
  searchMode: boolean
  lastQuery: string
  selectedMessageIds: number[]
  syncError: string | null
  clearSyncError: () => void
  loadAccounts: () => Promise<void>
  syncAllFolders: () => Promise<void>
  refreshFolderCounts: (accountId: number) => Promise<void>
  setCurrentFolder: (folder: Folder) => void
  syncMessages: () => Promise<void>
  loadMessages: () => Promise<void>
  loadMoreMessages: () => Promise<void>
  openMessage: (messageId: number) => Promise<void>
  closeMessage: () => void
  markRead: (messageId: number, read: boolean) => Promise<void>
  deleteMessage: (messageId: number) => Promise<void>
  searchMessages: (query: string) => Promise<void>
  clearSearch: () => Promise<void>
  refreshFolder: (folderId: number) => Promise<void>
  createFolder: (accountId: number, name: string, parentId?: number) => Promise<void>
  renameFolder: (folderId: number, newName: string) => Promise<void>
  deleteFolder: (folderId: number) => Promise<void>
  handleIncomingMail: (folderId: number) => Promise<void>
  toggleMessageSelection: (messageId: number) => void
  clearMessageSelection: () => void
}

export const useMailStore = create<MailState>((set, get) => ({
  accounts: [],
  allFolders: new Map(),
  currentFolder: null,
  messages: [],
  hasMoreMessages: false,
  loadingMore: false,
  currentMessage: null,
  loading: false,
  syncing: false,
  searching: false,
  searchMode: false,
  lastQuery: '',
  selectedMessageIds: [],
  syncError: null,

  clearSyncError: () => set({ syncError: null }),

  loadAccounts: async () => {
    const accounts = await api.account.list()
    set({ accounts })

    if (accounts.length > 0) {
      await get().syncAllFolders()
    }
  },

  syncAllFolders: async () => {
    const { accounts } = get()
    if (accounts.length === 0) return

    set({ syncing: true })

    try {
      const newFolders = new Map<number, Folder[]>()
      const errors: string[] = []

      await Promise.all(
        accounts.map(async (account) => {
          try {
            const folders = await api.mail.syncFolders(account.id)
            newFolders.set(account.id, sortFolders(folders))
          } catch (error) {
            newFolders.set(account.id, [])
            const label = account.email || `アカウント${account.id}`
            errors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`)
          }
        })
      )

      set({ allFolders: newFolders, syncError: errors.length > 0 ? errors.join('\n') : null })

      if (!get().currentFolder) {
        for (const [, folders] of newFolders) {
          const inbox = folders.find((folder) => folder.path.toUpperCase() === 'INBOX') ?? folders[0]
          if (inbox) {
            get().setCurrentFolder(inbox)
            break
          }
        }
      }
    } finally {
      set({ syncing: false })
    }
  },

  // DB-only refresh of folder counters (no network round trip)
  refreshFolderCounts: async (accountId) => {
    try {
      const folders = await api.mail.listFolders(accountId)
      set((state) => {
        const next = new Map(state.allFolders)
        next.set(accountId, sortFolders(folders))
        const updatedCurrent =
          state.currentFolder && state.currentFolder.account_id === accountId
            ? folders.find((folder) => folder.id === state.currentFolder!.id) ?? state.currentFolder
            : state.currentFolder
        return { allFolders: next, currentFolder: updatedCurrent }
      })
    } catch {
      // counts refresh is best-effort
    }
  },

  setCurrentFolder: (folder) => {
    set({
      currentFolder: folder,
      messages: [],
      hasMoreMessages: false,
      currentMessage: null,
      selectedMessageIds: [],
      searchMode: false,
      lastQuery: '',
    })
    void get().syncMessages()
  },

  syncMessages: async () => {
    const { currentFolder } = get()
    if (!currentFolder) return

    set({ syncing: true })

    try {
      try {
        await api.mail.syncMessages(currentFolder.account_id, currentFolder.id)
        set({ syncError: null })
      } catch (error) {
        set({
          syncError: `${currentFolder.name || 'フォルダ'}の同期に失敗しました: ${
            error instanceof Error ? error.message : String(error)
          }`,
        })
      } finally {
        await get().loadMessages()
        await get().refreshFolderCounts(currentFolder.account_id)
      }
    } finally {
      set({ syncing: false })
    }
  },

  loadMessages: async () => {
    const { currentFolder } = get()
    if (!currentFolder) return

    set({ loading: true, searchMode: false, lastQuery: '' })

    try {
      const messages = await api.mail.getMessages(currentFolder.id, 0, PAGE_SIZE)
      set({
        messages: sortMessagesByDate(messages),
        hasMoreMessages: messages.length === PAGE_SIZE,
        selectedMessageIds: [],
      })
    } finally {
      set({ loading: false })
    }
  },

  loadMoreMessages: async () => {
    const { currentFolder, messages, hasMoreMessages, loadingMore, searchMode } = get()
    if (!currentFolder || !hasMoreMessages || loadingMore || searchMode) return

    set({ loadingMore: true })

    try {
      const older = await api.mail.getMessages(currentFolder.id, messages.length, PAGE_SIZE)
      const known = new Set(messages.map((message) => message.id))
      const merged = [...messages, ...older.filter((message) => !known.has(message.id))]
      set({
        messages: sortMessagesByDate(merged),
        hasMoreMessages: older.length === PAGE_SIZE,
      })
    } finally {
      set({ loadingMore: false })
    }
  },

  openMessage: async (messageId) => {
    set({ loading: true })

    try {
      const message = await api.mail.getMessage(messageId)
      // The backend marks the message \Seen on open — reflect that in the
      // list and folder badges immediately
      const readFlags = withSeenFlag(message.flags, true)
      set((state) => ({
        currentMessage: { ...message, flags: readFlags },
        messages: state.messages.map((item) =>
          item.id === messageId ? { ...item, flags: withSeenFlag(item.flags, true) } : item
        ),
      }))
      void get().refreshFolderCounts(message.account_id)
    } finally {
      set({ loading: false })
    }
  },

  closeMessage: () => set({ currentMessage: null }),

  markRead: async (messageId, read) => {
    await api.mail.markRead(messageId, read)

    const nextMessages = get().messages.map((message) =>
      message.id === messageId ? { ...message, flags: withSeenFlag(message.flags, read) } : message
    )

    const currentMessage =
      get().currentMessage?.id === messageId
        ? { ...get().currentMessage!, flags: withSeenFlag(get().currentMessage!.flags, read) }
        : get().currentMessage

    set({ messages: nextMessages, currentMessage })

    const accountId =
      get().messages.find((message) => message.id === messageId)?.account_id ??
      get().currentFolder?.account_id
    if (accountId) {
      void get().refreshFolderCounts(accountId)
    }
  },

  deleteMessage: async (messageId) => {
    const target = get().messages.find((message) => message.id === messageId)

    await api.mail.delete(messageId)

    const nextMessages = get().messages.filter((message) => message.id !== messageId)
    const currentMessage = get().currentMessage?.id === messageId ? null : get().currentMessage

    set((state) => ({
      messages: nextMessages,
      currentMessage,
      selectedMessageIds: state.selectedMessageIds.filter((selectedId) => selectedId !== messageId),
    }))

    const accountId = target?.account_id ?? get().currentFolder?.account_id
    if (accountId) {
      void get().refreshFolderCounts(accountId)
    }
  },

  searchMessages: async (query) => {
    const trimmed = query.trim()

    if (!trimmed) {
      await get().clearSearch()
      return
    }

    const { accounts } = get()
    if (accounts.length === 0) return

    set({ loading: true, searching: true, searchMode: true, lastQuery: trimmed, currentMessage: null })

    try {
      const results: Message[] = []

      await Promise.all(
        accounts.map(async (account) => {
          try {
            const messages = await api.mail.search(account.id, trimmed)
            results.push(...messages)
          } catch {}
        })
      )

      set({
        messages: sortMessagesByDate(results).slice(0, 80),
        hasMoreMessages: false,
        selectedMessageIds: [],
      })
    } finally {
      set({ loading: false, searching: false })
    }
  },

  clearSearch: async () => {
    set({ searchMode: false, lastQuery: '', searching: false, currentMessage: null })
    await get().loadMessages()
  },

  refreshFolder: async (folderId) => {
    const { allFolders } = get()

    for (const [accountId, folders] of allFolders) {
      const target = folders.find((folder) => folder.id === folderId)

      if (target) {
        const messages = await api.mail.getMessages(folderId, 0, PAGE_SIZE)
        const sorted = sortMessagesByDate(messages)

        set((state) => ({
          messages:
            state.currentFolder?.id === folderId && !state.searchMode ? sorted : state.messages,
          hasMoreMessages:
            state.currentFolder?.id === folderId && !state.searchMode
              ? messages.length === PAGE_SIZE
              : state.hasMoreMessages,
        }))

        await get().refreshFolderCounts(accountId)
        return
      }
    }
  },

  createFolder: async (accountId, name, parentId) => {
    const folders = await api.mail.createFolder(accountId, name, parentId)
    set((state) => {
      const next = new Map(state.allFolders)
      next.set(accountId, sortFolders(folders))
      return { allFolders: next }
    })
  },

  renameFolder: async (folderId, newName) => {
    const account = get().accounts.find((candidate) =>
      (get().allFolders.get(candidate.id) || []).some((folder) => folder.id === folderId)
    )
    if (!account) return
    const folders = await api.mail.renameFolder(folderId, newName)
    set((state) => {
      const next = new Map(state.allFolders)
      next.set(account.id, sortFolders(folders))
      const current = state.currentFolder
      return {
        allFolders: next,
        currentFolder:
          current?.id === folderId
            ? folders.find((folder) => folder.id === folderId) ?? current
            : current,
      }
    })
  },

  deleteFolder: async (folderId) => {
    const account = get().accounts.find((candidate) =>
      (get().allFolders.get(candidate.id) || []).some((folder) => folder.id === folderId)
    )
    if (!account) return
    const folders = await api.mail.deleteFolder(folderId)
    const removingCurrent = get().currentFolder?.id === folderId
    set((state) => {
      const next = new Map(state.allFolders)
      next.set(account.id, sortFolders(folders))
      return {
        allFolders: next,
        ...(removingCurrent
          ? { currentFolder: null, messages: [], currentMessage: null, hasMoreMessages: false }
          : {}),
      }
    })
  },

  handleIncomingMail: async (folderId) => {
    await get().refreshFolder(folderId)
  },

  toggleMessageSelection: (messageId) =>
    set((state) => ({
      selectedMessageIds: state.selectedMessageIds.includes(messageId)
        ? state.selectedMessageIds.filter((selectedId) => selectedId !== messageId)
        : [...state.selectedMessageIds, messageId],
    })),

  clearMessageSelection: () => set({ selectedMessageIds: [] }),
}))
