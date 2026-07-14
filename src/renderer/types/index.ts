export interface Account {
  id: number
  name: string
  email: string
  imap_host: string
  imap_port: number
  imap_tls: number
  smtp_host: string
  smtp_port: number
  smtp_tls: number
  created_at: string
}

export interface AccountInput {
  name: string
  email: string
  imap_host: string
  imap_port: number
  imap_tls: boolean
  smtp_host: string
  smtp_port: number
  smtp_tls: boolean
  imap_password: string
  smtp_password: string
}

export interface Folder {
  id: number
  account_id: number
  path: string
  name: string
  delimiter: string
  flags: string
  unread_count: number
  total_count: number
}

export interface Message {
  id: number
  account_id: number
  folder_id: number
  uid: number
  message_id: string
  subject: string
  from_address: string
  to_addresses: string
  cc_addresses: string
  date: string
  date_ts: number
  flags: string
  snippet: string
  has_attachments: number
}

export interface Attachment {
  id: number
  message_id: number
  filename: string
  mime_type: string
  size: number
  is_inline: number
}

export interface MessageFull extends Message {
  html_body: string
  text_body: string
  attachments: Attachment[]
}

/** Reference to attach: a local file (path) or a cached received attachment (attachmentId, for forwarding). */
export interface ComposeAttachmentRef {
  path?: string
  attachmentId?: number
}

export interface PickedFile {
  path: string
  name: string
  size: number
}

export interface ComposeData {
  from: string
  to: string
  cc?: string
  subject: string
  html: string
  text?: string
  inReplyTo?: string
  references?: string
  attachments?: ComposeAttachmentRef[]
}

export interface OutlookFolder {
  id: string
  displayName: string
  type: string
  unreadCount: number
  totalCount: number
}

export interface OutlookMessage {
  itemId: string
  subject: string
  from: string
  to: string
  date: string
  dateSent: string
  preview: string
  isRead: boolean
  isDraft: boolean
  hasAttachments: boolean
  importance: string
  parentFolderId: string
  size: number
  selected?: boolean
  html?: string
  text?: string
  internetMessageId?: string
}

export interface NewMailEvent {
  message: Message
  unread_count: number
}

export interface DemoMailEvent {
  type: 'received' | 'sent'
  folderId: number
  message: Message
  unread_count: number
}

export interface UpdateStatus {
  available: boolean
  current_version: string
  latest_version: string | null
  notes: string | null
}

export interface AppBuildInfo {
  version: string
  buildId: string
  commit: string
  runtime: 'tauri' | 'preview'
}