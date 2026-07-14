import { invoke } from '@tauri-apps/api/core'
import type {
  Account,
  AppBuildInfo,
  AccountInput,
  Folder,
  Message,
  MessageFull,
  ComposeData,
  DemoMailEvent,
  OutlookFolder,
  OutlookMessage,
} from '../types'
import type { CharacterModScanResult } from '../characters/types'
import { mockApi } from './mockApi'

export const isTauriRuntime =
  typeof window !== 'undefined' &&
  (Boolean((window as any).__TAURI_INTERNALS__) || navigator.userAgent.includes('Tauri'))

const accountApi = isTauriRuntime
  ? {
      list: (): Promise<Account[]> => invoke('account_list'),
      create: (data: AccountInput): Promise<Account> => invoke('account_create', { data }),
      update: (id: number, data: AccountInput): Promise<void> => invoke('account_update', { id, data }),
      test: (data: AccountInput): Promise<{ imap: boolean; smtp: boolean }> =>
        invoke('account_test', { data }),
      delete: (id: number): Promise<void> => invoke('account_delete', { id }),
    }
  : mockApi.account

const mailApi = isTauriRuntime
  ? {
      syncFolders: (accountId: number): Promise<Folder[]> =>
        invoke('mail_sync_folders', { accountId }),
      listFolders: (accountId: number): Promise<Folder[]> =>
        invoke('mail_list_folders', { accountId }),
      syncMessages: (accountId: number, folderId: number): Promise<void> =>
        invoke('mail_sync_messages', { accountId, folderId }),
      getMessages: (folderId: number, offset: number, limit: number): Promise<Message[]> =>
        invoke('mail_get_messages', { folderId, offset, limit }),
      getMessage: (messageId: number): Promise<MessageFull> =>
        invoke('mail_get_message', { messageId }),
      markRead: (messageId: number, read: boolean): Promise<void> =>
        invoke('mail_mark_read', { messageId, read }),
      delete: (messageId: number): Promise<void> => invoke('mail_delete', { messageId }),
      search: (accountId: number, query: string): Promise<Message[]> =>
        invoke('mail_search', { accountId, query }),
      demoReceive: async (): Promise<DemoMailEvent | null> => null,
      demoSend: async (): Promise<{ to: string; subject: string } | null> => null,
    }
  : mockApi.mail

const composeApi = isTauriRuntime
  ? {
      send: (data: ComposeData): Promise<void> => invoke('compose_send', { data }),
    }
  : mockApi.compose

const importApi = isTauriRuntime
  ? {
      outlookFolders: (): Promise<OutlookFolder[]> => invoke('import_outlook_folders'),
      outlookMessages: (folderId: string): Promise<OutlookMessage[]> =>
        invoke('import_outlook_messages', { folderId }),
      outlookBody: (itemId: string): Promise<any> => invoke('import_outlook_body', { itemId }),
      save: (accountId: number, folderId: number, items: any[]): Promise<{ imported: number }> =>
        invoke('import_save', { accountId, folderId, items }),
    }
  : mockApi.import

const appApi = isTauriRuntime
  ? {
      minimize: () => invoke('app_minimize'),
      maximize: () => invoke('app_maximize'),
      close: () => invoke('app_close'),
      isMaximized: (): Promise<boolean> => invoke('app_is_maximized'),
      showMainWindow: (): Promise<void> => invoke('app_show_main_window'),
      quit: (): Promise<void> => invoke('app_quit'),
      getBuildInfo: (): Promise<AppBuildInfo> => invoke('app_get_build_info'),
    }
  : mockApi.app

const characterModsApi = isTauriRuntime
  ? {
      list: (): Promise<CharacterModScanResult> => invoke('character_mod_list'),
      readAsset: (
        modId: string,
        revision: string,
        assetKey: string
      ): Promise<ArrayBuffer | Uint8Array | number[]> =>
        invoke('character_mod_read_asset', { modId, revision, assetKey }),
      openFolder: (): Promise<void> => invoke('character_mod_open_folder'),
    }
  : {
      list: async (): Promise<CharacterModScanResult> => ({ packages: [], issues: [] }),
      readAsset: async (): Promise<ArrayBuffer> => {
        throw new Error('キャラクターMODはデスクトップ版で読み込めます。')
      },
      openFolder: async (): Promise<void> => {
        throw new Error('MODフォルダーはデスクトップ版から開けます。')
      },
    }

export const api = {
  account: accountApi,
  mail: mailApi,
  compose: composeApi,
  import: importApi,
  app: appApi,
  characterMods: characterModsApi,
}
