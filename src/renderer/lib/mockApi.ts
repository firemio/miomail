import type {
  Account,
  AppBuildInfo,
  AccountInput,
  ComposeData,
  DemoMailEvent,
  Folder,
  Message,
  MessageFull,
  OutlookFolder,
  OutlookMessage,
} from '../types'
import { APP_BUILD_ID, APP_COMMIT, APP_VERSION } from '../version'

interface PreviewDb {
  accounts: Account[]
  folders: Folder[]
  messages: MessageFull[]
  nextAccountId: number
  nextFolderId: number
  nextMessageId: number
}

const STORAGE_KEY = 'miomail-preview-db'

const outlookFoldersSeed: OutlookFolder[] = [
  {
    id: 'outlook-inbox',
    displayName: '受信トレイ',
    type: 'Inbox',
    unreadCount: 2,
    totalCount: 3,
  },
  {
    id: 'outlook-sent',
    displayName: '送信済み',
    type: 'SentItems',
    unreadCount: 0,
    totalCount: 2,
  },
]

const outlookMessagesSeed: Record<string, OutlookMessage[]> = {
  'outlook-inbox': [
    {
      itemId: 'outlook-inbox-1',
      subject: 'New Outlook からの移行テスト',
      from: 'Aki Sato <aki@example.com>',
      to: 'makko@miomail.local',
      date: new Date(Date.now() - 1000 * 60 * 70).toISOString(),
      dateSent: new Date(Date.now() - 1000 * 60 * 72).toISOString(),
      preview: '本文や差出人、日付を確認しながら移行できるか確認してください。',
      isRead: false,
      isDraft: false,
      hasAttachments: false,
      importance: 'normal',
      parentFolderId: 'outlook-inbox',
      size: 2048,
      text: '本文や差出人、日付を確認しながら移行できるか確認してください。',
      html: '<p>本文や差出人、日付を確認しながら移行できるか確認してください。</p>',
      internetMessageId: '<outlook-inbox-1@preview.local>',
    },
    {
      itemId: 'outlook-inbox-2',
      subject: '仕様確認のお願い',
      from: 'PM Team <pm@example.com>',
      to: 'makko@miomail.local',
      date: new Date(Date.now() - 1000 * 60 * 210).toISOString(),
      dateSent: new Date(Date.now() - 1000 * 60 * 214).toISOString(),
      preview: '複数下書きと返信導線を重点的に確認してほしいです。',
      isRead: true,
      isDraft: false,
      hasAttachments: false,
      importance: 'normal',
      parentFolderId: 'outlook-inbox',
      size: 1812,
      text: '複数下書きと返信導線を重点的に確認してほしいです。',
      html: '<p>複数下書きと返信導線を重点的に確認してほしいです。</p>',
      internetMessageId: '<outlook-inbox-2@preview.local>',
    },
    {
      itemId: 'outlook-inbox-3',
      subject: 'モック受信の演出チェック',
      from: 'QA <qa@example.com>',
      to: 'makko@miomail.local',
      date: new Date(Date.now() - 1000 * 60 * 420).toISOString(),
      dateSent: new Date(Date.now() - 1000 * 60 * 425).toISOString(),
      preview: '通知・未読・マスコット演出が一連で動くか見てください。',
      isRead: false,
      isDraft: false,
      hasAttachments: false,
      importance: 'normal',
      parentFolderId: 'outlook-inbox',
      size: 1944,
      text: '通知・未読・マスコット演出が一連で動くか見てください。',
      html: '<p>通知・未読・マスコット演出が一連で動くか見てください。</p>',
      internetMessageId: '<outlook-inbox-3@preview.local>',
    },
  ],
  'outlook-sent': [
    {
      itemId: 'outlook-sent-1',
      subject: '返信: 複数下書きについて',
      from: 'makko@miomail.local',
      to: 'pm@example.com',
      date: new Date(Date.now() - 1000 * 60 * 140).toISOString(),
      dateSent: new Date(Date.now() - 1000 * 60 * 140).toISOString(),
      preview: '右ドックとフロート切替の改善案を送付しました。',
      isRead: true,
      isDraft: false,
      hasAttachments: false,
      importance: 'normal',
      parentFolderId: 'outlook-sent',
      size: 1504,
      text: '右ドックとフロート切替の改善案を送付しました。',
      html: '<p>右ドックとフロート切替の改善案を送付しました。</p>',
      internetMessageId: '<outlook-sent-1@preview.local>',
    },
    {
      itemId: 'outlook-sent-2',
      subject: 'デザインレビュー共有',
      from: 'makko@miomail.local',
      to: 'design@example.com',
      date: new Date(Date.now() - 1000 * 60 * 540).toISOString(),
      dateSent: new Date(Date.now() - 1000 * 60 * 540).toISOString(),
      preview: 'パネルの透け感と視認性を見直した案です。',
      isRead: true,
      isDraft: false,
      hasAttachments: false,
      importance: 'normal',
      parentFolderId: 'outlook-sent',
      size: 1664,
      text: 'パネルの透け感と視認性を見直した案です。',
      html: '<p>パネルの透け感と視認性を見直した案です。</p>',
      internetMessageId: '<outlook-sent-2@preview.local>',
    },
  ],
}

function parseFlags(flags: string) {
  try {
    return JSON.parse(flags || '[]') as string[]
  } catch {
    return []
  }
}

function stringifyFlags(flags: string[]) {
  return JSON.stringify(Array.from(new Set(flags)))
}

function toTs(date: string): number {
  const parsed = Date.parse(date)
  return Number.isNaN(parsed) ? 0 : Math.floor(parsed / 1000)
}

function toSummary(message: MessageFull): Message {
  return {
    id: message.id,
    account_id: message.account_id,
    folder_id: message.folder_id,
    uid: message.uid,
    message_id: message.message_id,
    subject: message.subject,
    from_address: message.from_address,
    to_addresses: message.to_addresses,
    cc_addresses: message.cc_addresses,
    date: message.date,
    date_ts: message.date_ts || toTs(message.date),
    flags: message.flags,
    snippet: message.snippet,
    has_attachments: message.has_attachments,
  }
}

function makeHtmlFromText(text: string) {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\n/g, '<br>')

  return `<div style="font-family:'Yu Gothic UI',sans-serif;font-size:14px;line-height:1.7;color:#52362f;">${escaped}</div>`
}

function looksCorrupted(text: string) {
  return /[�]|縺|繧|繝|蜿|驟|荳|貂/.test(text)
}

function recalcFolders(db: PreviewDb) {
  db.folders = db.folders.map((folder) => {
    const folderMessages = db.messages.filter((message) => message.folder_id === folder.id)
    const unreadCount = folderMessages.filter(
      (message) => !parseFlags(message.flags).includes('\\Seen')
    ).length

    return {
      ...folder,
      total_count: folderMessages.length,
      unread_count: unreadCount,
    }
  })
}

function seedDb(): PreviewDb {
  const account: Account = {
    id: 1,
    name: 'Makko Preview',
    email: 'makko@miomail.local',
    imap_host: 'preview.local',
    imap_port: 993,
    imap_tls: 1,
    smtp_host: 'preview.local',
    smtp_port: 465,
    smtp_tls: 1,
    created_at: new Date().toISOString(),
  }

  const folders: Folder[] = [
    {
      id: 1,
      account_id: 1,
      path: 'INBOX',
      name: '受信トレイ',
      delimiter: '/',
      flags: '["\\\\Inbox"]',
      unread_count: 0,
      total_count: 0,
    },
    {
      id: 2,
      account_id: 1,
      path: 'Sent',
      name: '送信済み',
      delimiter: '/',
      flags: '["\\\\Sent"]',
      unread_count: 0,
      total_count: 0,
    },
    {
      id: 3,
      account_id: 1,
      path: 'Drafts',
      name: '下書き',
      delimiter: '/',
      flags: '["\\\\Drafts"]',
      unread_count: 0,
      total_count: 0,
    },
    {
      id: 4,
      account_id: 1,
      path: 'Archive',
      name: 'アーカイブ',
      delimiter: '/',
      flags: '[]',
      unread_count: 0,
      total_count: 0,
    },
  ]

  const messageSeeds: Array<Omit<MessageFull, 'date_ts'>> = [
    {
      id: 1,
      account_id: 1,
      folder_id: 1,
      uid: 101,
      message_id: '<preview-1@miomail.local>',
      subject: 'MioMail UI レビューお願いします',
      from_address: 'Aya Tanaka <aya@example.com>',
      to_addresses: 'makko@miomail.local',
      cc_addresses: '',
      date: new Date(Date.now() - 1000 * 60 * 18).toISOString(),
      flags: '[]',
      snippet: '返信しながら本文を読めるか、複数下書きが迷わず切り替えられるかを確認してください。',
      has_attachments: 0,
      html_body:
        '<p>こんにちは。</p><p>返信しながら本文を読めるか、複数下書きが迷わず切り替えられるかを確認してください。</p><p>右パネルとフロート切替の体験を重点的に見てもらえると助かります。</p>',
      text_body:
        'こんにちは。\n\n返信しながら本文を読めるか、複数下書きが迷わず切り替えられるかを確認してください。\n右パネルとフロート切替の体験を重点的に見てもらえると助かります。',
    },
    {
      id: 2,
      account_id: 1,
      folder_id: 1,
      uid: 102,
      message_id: '<preview-2@miomail.local>',
      subject: '朝会メモの共有',
      from_address: 'PM Team <pm@example.com>',
      to_addresses: 'makko@miomail.local',
      cc_addresses: 'mio@example.com',
      date: new Date(Date.now() - 1000 * 60 * 80).toISOString(),
      flags: '["\\\\Seen"]',
      snippet: '今日の確認事項をまとめました。返信導線の見直しも含めて目を通してください。',
      has_attachments: 0,
      html_body:
        '<p>今日の確認事項をまとめました。</p><blockquote>返信導線の見直しも含めて目を通してください。</blockquote>',
      text_body:
        '今日の確認事項をまとめました。\n\n返信導線の見直しも含めて目を通してください。',
    },
    {
      id: 3,
      account_id: 1,
      folder_id: 1,
      uid: 103,
      message_id: '<preview-3@miomail.local>',
      subject: '通知とトレイ常駐の確認項目',
      from_address: 'QA <qa@example.com>',
      to_addresses: 'makko@miomail.local',
      cc_addresses: '',
      date: new Date(Date.now() - 1000 * 60 * 300).toISOString(),
      flags: '[]',
      snippet: 'Windows 通知、新着未読、トレイ復帰までの導線が自然かどうか見てください。',
      has_attachments: 0,
      html_body:
        '<p>Windows 通知、新着未読、トレイ復帰までの導線が自然かどうか見てください。</p><ul><li>未読バッジ</li><li>トレイから復帰</li><li>通知クリック</li></ul>',
      text_body:
        'Windows 通知、新着未読、トレイ復帰までの導線が自然かどうか見てください。\n- 未読バッジ\n- トレイから復帰\n- 通知クリック',
    },
    {
      id: 4,
      account_id: 1,
      folder_id: 2,
      uid: 201,
      message_id: '<preview-sent@miomail.local>',
      subject: 'Re: 朝会メモの共有',
      from_address: 'makko@miomail.local',
      to_addresses: 'pm@example.com',
      cc_addresses: '',
      date: new Date(Date.now() - 1000 * 60 * 25).toISOString(),
      flags: '["\\\\Seen"]',
      snippet: '確認済みです。返信しながら確認できる構成で改善を進めます。',
      has_attachments: 0,
      html_body:
        '<p>確認済みです。返信しながら確認できる構成で改善を進めます。</p><p>フローティング下書きも合わせて見直します。</p>',
      text_body:
        '確認済みです。返信しながら確認できる構成で改善を進めます。\nフローティング下書きも合わせて見直します。',
    },
  ]

  const messages: MessageFull[] = messageSeeds.map((message) => ({
    ...message,
    date_ts: toTs(message.date),
  }))

  const db: PreviewDb = {
    accounts: [account],
    folders,
    messages,
    nextAccountId: 2,
    nextFolderId: 5,
    nextMessageId: 5,
  }

  recalcFolders(db)
  return db
}

function loadDb(): PreviewDb {
  if (typeof window === 'undefined') {
    return seedDb()
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      const seeded = seedDb()
      saveDb(seeded)
      return seeded
    }

    const db = JSON.parse(raw) as PreviewDb
    const sampleText = [
      ...(db.folders ?? []).map((folder) => `${folder.name} ${folder.path}`),
      ...(db.messages ?? []).slice(0, 4).map((message) => `${message.subject} ${message.snippet}`),
    ].join(' ')

    if (looksCorrupted(sampleText)) {
      const seeded = seedDb()
      saveDb(seeded)
      return seeded
    }

    // Older stored data may predate the date_ts column
    db.messages = (db.messages ?? []).map((message) => ({
      ...message,
      date_ts: message.date_ts || toTs(message.date),
    }))

    recalcFolders(db)
    return db
  } catch {
    const seeded = seedDb()
    saveDb(seeded)
    return seeded
  }
}

function saveDb(db: PreviewDb) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(db))
}

function getFolderByPath(db: PreviewDb, accountId: number, path: string) {
  return db.folders.find(
    (folder) => folder.account_id === accountId && folder.path.toUpperCase() === path.toUpperCase()
  )
}

function emitDemoEvent(payload: DemoMailEvent) {
  if (typeof window === 'undefined') {
    return
  }

  window.dispatchEvent(new CustomEvent('miomail:demo', { detail: payload }))
}

function findAccountBySender(db: PreviewDb, from: string) {
  return db.accounts.find((account) => account.email === from) ?? db.accounts[0]
}

function createSnippet(text: string) {
  return text.replace(/\s+/g, ' ').trim().slice(0, 120)
}

function searchIndex(message: MessageFull) {
  return [
    message.subject,
    message.from_address,
    message.to_addresses,
    message.cc_addresses,
    message.snippet,
    message.text_body,
    message.html_body,
  ]
    .join(' ')
    .toLowerCase()
}

export const mockApi = {
  account: {
    list: async (): Promise<Account[]> => loadDb().accounts,

    create: async (data: AccountInput): Promise<Account> => {
      const db = loadDb()
      const account: Account = {
        id: db.nextAccountId++,
        name: data.name,
        email: data.email,
        imap_host: data.imap_host,
        imap_port: data.imap_port,
        imap_tls: data.imap_tls ? 1 : 0,
        smtp_host: data.smtp_host,
        smtp_port: data.smtp_port,
        smtp_tls: data.smtp_tls ? 1 : 0,
        created_at: new Date().toISOString(),
      }

      db.accounts.push(account)
      db.folders.push(
        {
          id: db.nextFolderId++,
          account_id: account.id,
          path: 'INBOX',
          name: '受信トレイ',
          delimiter: '/',
          flags: '["\\\\Inbox"]',
          unread_count: 0,
          total_count: 0,
        },
        {
          id: db.nextFolderId++,
          account_id: account.id,
          path: 'Sent',
          name: '送信済み',
          delimiter: '/',
          flags: '["\\\\Sent"]',
          unread_count: 0,
          total_count: 0,
        },
        {
          id: db.nextFolderId++,
          account_id: account.id,
          path: 'Drafts',
          name: '下書き',
          delimiter: '/',
          flags: '["\\\\Drafts"]',
          unread_count: 0,
          total_count: 0,
        },
        {
          id: db.nextFolderId++,
          account_id: account.id,
          path: 'Archive',
          name: 'アーカイブ',
          delimiter: '/',
          flags: '[]',
          unread_count: 0,
          total_count: 0,
        }
      )

      recalcFolders(db)
      saveDb(db)
      return account
    },

    update: async (id: number, data: AccountInput): Promise<void> => {
      const db = loadDb()
      db.accounts = db.accounts.map((account) =>
        account.id === id
          ? {
              ...account,
              name: data.name,
              email: data.email,
              imap_host: data.imap_host,
              imap_port: data.imap_port,
              imap_tls: data.imap_tls ? 1 : 0,
              smtp_host: data.smtp_host,
              smtp_port: data.smtp_port,
              smtp_tls: data.smtp_tls ? 1 : 0,
            }
          : account
      )
      saveDb(db)
    },

    test: async (): Promise<{ imap: boolean; smtp: boolean }> => ({ imap: true, smtp: true }),

    delete: async (id: number): Promise<void> => {
      const db = loadDb()
      const folderIds = db.folders
        .filter((folder) => folder.account_id === id)
        .map((folder) => folder.id)

      db.accounts = db.accounts.filter((account) => account.id !== id)
      db.folders = db.folders.filter((folder) => folder.account_id !== id)
      db.messages = db.messages.filter((message) => !folderIds.includes(message.folder_id))
      recalcFolders(db)
      saveDb(db)
    },
  },

  mail: {
    syncFolders: async (accountId: number): Promise<Folder[]> => {
      const db = loadDb()
      recalcFolders(db)
      saveDb(db)
      return db.folders.filter((folder) => folder.account_id === accountId)
    },

    listFolders: async (accountId: number): Promise<Folder[]> => {
      const db = loadDb()
      recalcFolders(db)
      return db.folders.filter((folder) => folder.account_id === accountId)
    },

    syncMessages: async (): Promise<void> => undefined,

    createFolder: async (accountId: number, name: string, parentId?: number): Promise<Folder[]> => {
      const db = loadDb()
      const delimiter = '/'
      const parent = parentId ? db.folders.find((folder) => folder.id === parentId) : undefined
      const path = parent ? `${parent.path}${delimiter}${name}` : name
      const exists = db.folders.some(
        (folder) => folder.account_id === accountId && folder.path.toLowerCase() === path.toLowerCase()
      )
      if (exists) {
        throw new Error('同じ名前のフォルダが既にあります')
      }
      db.folders.push({
        id: db.nextFolderId++,
        account_id: accountId,
        path,
        name,
        delimiter,
        flags: '[]',
        unread_count: 0,
        total_count: 0,
      })
      recalcFolders(db)
      saveDb(db)
      return db.folders.filter((folder) => folder.account_id === accountId)
    },

    renameFolder: async (folderId: number, newName: string): Promise<Folder[]> => {
      const db = loadDb()
      const target = db.folders.find((folder) => folder.id === folderId)
      if (!target) throw new Error('フォルダが見つかりません')
      const accountId = target.account_id
      db.folders = db.folders.map((folder) =>
        folder.id === folderId ? { ...folder, name: newName } : folder
      )
      recalcFolders(db)
      saveDb(db)
      return db.folders.filter((folder) => folder.account_id === accountId)
    },

    deleteFolder: async (folderId: number): Promise<Folder[]> => {
      const db = loadDb()
      const target = db.folders.find((folder) => folder.id === folderId)
      if (!target) throw new Error('フォルダが見つかりません')
      const accountId = target.account_id
      db.messages = db.messages.filter((message) => message.folder_id !== folderId)
      db.folders = db.folders.filter((folder) => folder.id !== folderId)
      recalcFolders(db)
      saveDb(db)
      return db.folders.filter((folder) => folder.account_id === accountId)
    },

    getMessages: async (folderId: number, offset: number, limit: number): Promise<Message[]> => {
      const db = loadDb()
      return db.messages
        .filter((message) => message.folder_id === folderId)
        .sort((left, right) => (right.date_ts || 0) - (left.date_ts || 0))
        .slice(offset, offset + limit)
        .map(toSummary)
    },

    getMessage: async (messageId: number): Promise<MessageFull> => {
      const db = loadDb()
      const message = db.messages.find((item) => item.id === messageId)
      if (!message) {
        throw new Error('メールが見つかりません')
      }
      return message
    },

    markRead: async (messageId: number, read: boolean): Promise<void> => {
      const db = loadDb()
      db.messages = db.messages.map((message) => {
        if (message.id !== messageId) {
          return message
        }

        const flags = parseFlags(message.flags)
        const nextFlags = read
          ? Array.from(new Set([...flags, '\\Seen']))
          : flags.filter((flag) => flag !== '\\Seen')

        return {
          ...message,
          flags: stringifyFlags(nextFlags),
        }
      })

      recalcFolders(db)
      saveDb(db)
    },

    delete: async (messageId: number): Promise<void> => {
      const db = loadDb()
      db.messages = db.messages.filter((message) => message.id !== messageId)
      recalcFolders(db)
      saveDb(db)
    },

    search: async (accountId: number, query: string): Promise<Message[]> => {
      const db = loadDb()
      const normalized = query.trim().toLowerCase()
      if (!normalized) {
        return []
      }

      return db.messages
        .filter((message) => message.account_id === accountId)
        .filter((message) => searchIndex(message).includes(normalized))
        .sort((left, right) => (right.date_ts || 0) - (left.date_ts || 0))
        .map(toSummary)
    },

    demoReceive: async (): Promise<DemoMailEvent> => {
      const db = loadDb()
      const account = db.accounts[0]
      if (!account) {
        throw new Error('デモ受信用のアカウントがありません')
      }

      const inbox = getFolderByPath(db, account.id, 'INBOX')
      if (!inbox) {
        throw new Error('受信トレイが見つかりません')
      }

      const templates = [
        {
          from: 'Mio Delivery Bot <bot@miomail.local>',
          subject: 'デモ受信: 新着メールを追加しました',
          text: 'このメールはデモ受信ボタンから生成されました。未読バッジ、一覧、通知、相棒の反応を確認してください。',
        },
        {
          from: 'Design Team <design@example.com>',
          subject: 'パネル配置の再確認',
          text: '本文を見ながら返信できるか、フローティング下書きが邪魔にならないかを重点的に見てほしいです。',
        },
        {
          from: 'Support <support@example.com>',
          subject: '通知導線の最終確認',
          text: '新着が来たときに、何が起きたか一目で分かるUIになっているかを確認してください。',
        },
      ]

      const template = templates[(db.nextMessageId - 1) % templates.length]
      const now = new Date().toISOString()
      const text = template.text
      const message: MessageFull = {
        id: db.nextMessageId++,
        account_id: account.id,
        folder_id: inbox.id,
        uid: 500 + db.nextMessageId,
        message_id: `<demo-incoming-${Date.now()}@miomail.local>`,
        subject: template.subject,
        from_address: template.from,
        to_addresses: account.email,
        cc_addresses: '',
        date: now,
        date_ts: toTs(now),
        flags: '[]',
        snippet: createSnippet(text),
        has_attachments: 0,
        html_body: makeHtmlFromText(text),
        text_body: text,
      }

      db.messages.push(message)
      recalcFolders(db)
      saveDb(db)

      const updatedInbox = db.folders.find((folder) => folder.id === inbox.id) ?? inbox
      const payload: DemoMailEvent = {
        type: 'received',
        folderId: inbox.id,
        message: toSummary(message),
        unread_count: updatedInbox.unread_count,
      }

      emitDemoEvent(payload)
      return payload
    },

    demoSend: async (): Promise<{ to: string; subject: string }> => {
      const db = loadDb()
      const account = db.accounts[0]
      if (!account) {
        throw new Error('デモ送信用のアカウントがありません')
      }

      const templates = [
        {
          to: 'aya.tanaka@example.com',
          subject: 'デモ送信: 資料ありがとうございました',
          text: 'このメールはデモ送信ボタンから生成されました。送信済みフォルダと相棒の配達演出を確認してください。',
        },
        {
          to: 'design@example.com',
          subject: 'レビューコメントの返信',
          text: 'いただいた指摘を反映しました。次のビルドで確認をお願いします。',
        },
        {
          to: 'support@example.com',
          subject: '設定画面についての質問',
          text: '通知のオン・オフはどこから切り替えられますか？',
        },
      ]

      const template = templates[db.nextMessageId % templates.length]
      await mockApi.compose.send({
        from: account.email,
        to: template.to,
        subject: template.subject,
        html: makeHtmlFromText(template.text),
        text: template.text,
      })

      const updatedDb = loadDb()
      const sentFolder = getFolderByPath(updatedDb, account.id, 'Sent')
      const sentMessage = [...updatedDb.messages]
        .reverse()
        .find((message) => message.folder_id === sentFolder?.id)
      if (sentFolder && sentMessage) {
        emitDemoEvent({
          type: 'sent',
          folderId: sentFolder.id,
          message: toSummary(sentMessage),
          unread_count: 0,
        })
      }

      return { to: template.to, subject: template.subject }
    },
  },

  compose: {
    send: async (data: ComposeData): Promise<void> => {
      const db = loadDb()
      const account = findAccountBySender(db, data.from)
      if (!account) {
        throw new Error('送信元アカウントが見つかりません')
      }

      const sentFolder = getFolderByPath(db, account.id, 'Sent')
      if (!sentFolder) {
        throw new Error('送信済みフォルダが見つかりません')
      }

      const text = data.text || ''
      const message: MessageFull = {
        id: db.nextMessageId++,
        account_id: account.id,
        folder_id: sentFolder.id,
        uid: 900 + db.nextMessageId,
        message_id: `<demo-sent-${Date.now()}@miomail.local>`,
        subject: data.subject || '(件名なし)',
        from_address: data.from,
        to_addresses: data.to,
        cc_addresses: data.cc || '',
        date: new Date().toISOString(),
        date_ts: Math.floor(Date.now() / 1000),
        flags: '["\\\\Seen"]',
        snippet: createSnippet(text || data.subject || '(件名なし)'),
        has_attachments: 0,
        html_body: data.html || makeHtmlFromText(text),
        text_body: text,
      }

      db.messages.push(message)
      recalcFolders(db)
      saveDb(db)

    },
  },

  import: {
    outlookFolders: async (): Promise<OutlookFolder[]> => outlookFoldersSeed,

    outlookMessages: async (folderId: string): Promise<OutlookMessage[]> =>
      outlookMessagesSeed[folderId] ?? [],

    outlookBody: async (itemId: string): Promise<any> => {
      const allMessages = Object.values(outlookMessagesSeed).flat()
      const message = allMessages.find((item) => item.itemId === itemId)
      if (!message) {
        throw new Error('本文を取得できませんでした')
      }

      return {
        html: message.html || makeHtmlFromText(message.text || message.preview || ''),
        text: message.text || message.preview || '',
        internetMessageId: message.internetMessageId || `<${itemId}@preview.local>`,
      }
    },

    save: async (accountId: number, folderId: number, items: any[]): Promise<{ imported: number }> => {
      const db = loadDb()
      const targetFolder = db.folders.find(
        (folder) => folder.id === folderId && folder.account_id === accountId
      )

      if (!targetFolder) {
        throw new Error('保存先フォルダが見つかりません')
      }

      items.forEach((item) => {
        const text = item.text || item.preview || ''
        db.messages.push({
          id: db.nextMessageId++,
          account_id: accountId,
          folder_id: folderId,
          uid: 1200 + db.nextMessageId,
          message_id:
            item.internetMessageId || `<imported-${db.nextMessageId}@miomail.local>`,
          subject: item.subject || '(件名なし)',
          from_address: item.from || 'import@example.com',
          to_addresses: item.to || db.accounts.find((account) => account.id === accountId)?.email || '',
          cc_addresses: '',
          date: item.dateSent || item.date || new Date().toISOString(),
          date_ts: toTs(item.dateSent || item.date || new Date().toISOString()),
          flags: item.isRead ? '["\\\\Seen"]' : '[]',
          snippet: createSnippet(text),
          has_attachments: item.hasAttachments ? 1 : 0,
          html_body: item.html || makeHtmlFromText(text),
          text_body: text,
        })
      })

      recalcFolders(db)
      saveDb(db)
      return { imported: items.length }
    },
  },

  app: {
    minimize: async () => undefined,
    maximize: async () => undefined,
    close: async () => undefined,
    isMaximized: async () => false,
    showMainWindow: async () => undefined,
    quit: async () => undefined,
    getBuildInfo: async (): Promise<AppBuildInfo> => ({
      version: APP_VERSION,
      buildId: APP_BUILD_ID,
      commit: APP_COMMIT,
      runtime: 'preview',
    }),
    updateCheck: async () => ({
      available: false,
      current_version: APP_VERSION,
      latest_version: null,
      notes: null,
    }),
    updateInstall: async (): Promise<void> => {
      throw new Error('自動アップデートはデスクトップ版で利用できます')
    },
  },
}
