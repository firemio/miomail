// Web ブリッジ(`miomail --serve`)で動いているときの、Tauri の窓口の差し替え。
//
// 画面はデスクトップ版とまったく同じものを使う。差し替えるのは
//   - invoke  … コマンド呼び出し
//   - listen  … イベント受信
// の2つだけで、UI のコードには手を入れない。
//
// 送り先は2通りある。
//
//   ふつうのブラウザー        … 同じオリジンへ HTTP(fetch と EventSource)
//   自分のオリジンが無い枠    … 外側の窓へ postMessage で頼む
//
// 後者は Muse のスペースのような、blob: で読み込まれて同一オリジンを持たない
// iframe のこと。そこからは相対 URL も EventSource も使えないので、外側に
// 中継してもらう。外側がやることは「この1つの要求を転送して、返事を返す」だけ:
//
//   受け取る: { miomail: 1, id, cmd, args }
//   転送する: POST http://127.0.0.1:7272/__miomail/invoke  {"cmd":…, "args":…}
//   返す:     { miomail: 1, id, reply: <サーバーが返した JSON そのまま> }
//
// 起動時に { miomail: 1, hello: 1 } を投げるので、外側は
// { miomail: 1, ready: 1 } を返す。返事が無ければ HTTP の方に倒れる。
//
// ファイル選択・保存・添付の「開く」だけは、OS のダイアログが使えないので
// ブラウザーのやり方(input[type=file] とダウンロード)に置き換える。
// 中身を扱うのはサーバー側のまま。

import type { PickedFile } from '../types'
import {
  hydrateStorage,
  setStoragePersistAllowed,
  setStoragePersistHook,
  storageIsNative,
} from './safeStorage'

const BASE = '/__miomail'

interface BridgeMarker {
  version: number
  /** 1ファイル完結の画面(= 枠に埋め込まれている可能性がある)。 */
  standalone?: boolean
}

const marker =
  typeof window === 'undefined'
    ? undefined
    : ((window as unknown as Record<string, unknown>).__MIOMAIL_BRIDGE__ as BridgeMarker | undefined)

/** サーバーが画面へ差し込む目印。デスクトップ版では undefined。 */
export const isBridgeRuntime = Boolean(marker)

/** 1ファイル完結の画面が、よその窓の枠に入っている(Muse のスペースなど)。 */
export const isStandaloneFrame =
  Boolean(marker?.standalone) &&
  typeof window !== 'undefined' &&
  Boolean(window.parent) &&
  window.parent !== window

type Args = Record<string, unknown> | undefined

interface InvokeReply {
  ok: boolean
  data?: unknown
  error?: string
}

// ---------------------------------------------------------------------------
// 送り先を決める
// ---------------------------------------------------------------------------

type Transport = 'http' | 'frame'

/** 外側の返事を待つ上限。これを過ぎたら HTTP に倒す。 */
const HANDSHAKE_TIMEOUT_MS = 2500

let transportPromise: Promise<Transport> | null = null

function decideTransport(): Promise<Transport> {
  if (transportPromise) return transportPromise

  transportPromise = new Promise<Transport>((resolve) => {
    const framed = typeof window !== 'undefined' && window.parent && window.parent !== window
    // 1ファイル完結の画面でなければ、ふつうに相対 URL が使える。
    if (!marker?.standalone || !framed) {
      resolve('http')
      return
    }

    let settled = false
    let retry = 0
    let timeout = 0

    const finish = (transport: Transport) => {
      if (settled) return
      settled = true
      window.clearInterval(retry)
      window.clearTimeout(timeout)
      window.removeEventListener('message', onMessage)
      resolve(transport)
    }

    const onMessage = (event: MessageEvent) => {
      const data = event.data as Record<string, unknown> | null
      if (data && typeof data === 'object' && data.miomail === 1 && data.ready) {
        finish('frame')
      }
    }

    const hello = () => {
      try {
        window.parent.postMessage({ miomail: 1, hello: 1 }, '*')
      } catch {
        finish('http')
      }
    }

    window.addEventListener('message', onMessage)
    hello()
    retry = window.setInterval(hello, 250)
    timeout = window.setTimeout(() => finish('http'), HANDSHAKE_TIMEOUT_MS)
  })

  return transportPromise
}

// ---------------------------------------------------------------------------
// 外側の窓へ頼む経路
// ---------------------------------------------------------------------------

/** 1つの要求を待つ上限。大きな添付の取り込みもあるので長めにとる。 */
const FRAME_CALL_TIMEOUT_MS = 180_000

interface PendingCall {
  settle: (reply: InvokeReply) => void
  fail: (error: Error) => void
}

let nextCallId = 1
const pendingCalls = new Map<number, PendingCall>()
let frameListening = false

function listenToFrameReplies() {
  if (frameListening) return
  frameListening = true
  window.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as Record<string, unknown> | null
    if (!data || typeof data !== 'object' || data.miomail !== 1) return
    const id = data.id
    if (typeof id !== 'number') return
    const call = pendingCalls.get(id)
    if (!call) return
    pendingCalls.delete(id)
    if (typeof data.error === 'string') {
      call.fail(new Error(data.error))
    } else {
      call.settle((data.reply ?? { ok: false, error: '返事の形が違います' }) as InvokeReply)
    }
  })
}

function callFrame<T>(cmd: string, args: Args): Promise<T> {
  listenToFrameReplies()
  return new Promise<T>((resolve, reject) => {
    const id = nextCallId
    nextCallId += 1

    const timer = window.setTimeout(() => {
      pendingCalls.delete(id)
      reject(new Error('MioMail のサーバーから返事がありません。しばらくしてからやり直してください。'))
    }, FRAME_CALL_TIMEOUT_MS)

    pendingCalls.set(id, {
      settle: (reply) => {
        window.clearTimeout(timer)
        if (!reply.ok) reject(new Error(reply.error ?? '不明なエラーです'))
        else resolve(reply.data as T)
      },
      fail: (error) => {
        window.clearTimeout(timer)
        reject(error)
      },
    })

    try {
      window.parent.postMessage({ miomail: 1, id, cmd, args: args ?? {} }, '*')
    } catch (error) {
      pendingCalls.delete(id)
      window.clearTimeout(timer)
      reject(error instanceof Error ? error : new Error('外側の画面へ渡せませんでした'))
    }
  })
}

// ---------------------------------------------------------------------------
// 同じオリジンへ HTTP で頼む経路
// ---------------------------------------------------------------------------

async function callHttp<T>(cmd: string, args: Args): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${BASE}/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ cmd, args: args ?? {} }),
    })
  } catch {
    throw new Error('MioMail のサーバーに繋がりませんでした。接続を確かめてください。')
  }

  if (response.status === 401) {
    throw new Error('この画面を開く権限がありません。端末に表示された URL を開き直してください。')
  }
  if (!response.ok) {
    throw new Error(`MioMail のサーバーが応答しませんでした (${response.status})`)
  }

  const reply = (await response.json()) as InvokeReply
  if (!reply.ok) {
    throw new Error(reply.error ?? '不明なエラーです')
  }
  return reply.data as T
}

/** サーバーのコマンドをそのまま呼ぶ(画面側の置き換えを挟まない生の経路)。 */
async function callServer<T>(cmd: string, args: Args): Promise<T> {
  const transport = await decideTransport()
  return transport === 'frame' ? callFrame<T>(cmd, args) : callHttp<T>(cmd, args)
}

// ---------------------------------------------------------------------------
// 画面の設定(テーマ・キャラクター・書きかけのメールなど)
// ---------------------------------------------------------------------------
//
// localStorage に触れない枠では、設定をサーバーへ預ける。戻ってくる道は2本ある。
//
//   1. サーバーが画面の HTML へ埋め込んで返す(同期的に読めるので、最初の描画に間に合う)
//   2. 起動のあと `__settings_all` で取り直す
//
// 2 が要るのは、HTML を毎回サーバーから取らない使い方があるため。Muse のスペースでは
// HTML を切り分けてスペース側に置くので、埋め込まれた設定は「置いた時点の写し」のまま
// になる。2 が無かった v2.1.26 までは、スペースの中で変えた設定が、開き直すたびに
// 元へ戻っていた(保存はされていて、読み戻す道だけが無かった)。

/** 設定をサーバーに預けて暮らす場所か(localStorage が使えない)。 */
const settingsLiveOnServer = isBridgeRuntime && !storageIsNative()

/** サーバーにある設定を取り直し終えたか。終えるまでは預けない。 */
let settingsFresh = !settingsLiveOnServer

if (settingsLiveOnServer) {
  // 取り直す前の値は古いかもしれない。起動時の自動保存で、サーバーの新しい値を
  // 古い値で上書きしないよう、取り直せるまで預けるのを止めておく。
  setStoragePersistAllowed(false)
}

/** 預けようとして失敗した分(キーごとに最後の値)。繋がり直したら送り直す。 */
const pendingSettings = new Map<string, string | null>()
let settingWriteSeq = 0
const latestSettingWrite = new Map<string, number>()

/**
 * 設定を1つ預ける。`lib/safeStorage.ts` から呼ばれる。
 * 失敗した分は覚えておき、あとで送り直す。同じキーに新しい書き込みがあれば、古い方は捨てる。
 */
export async function persistSetting(key: string, value: string | null): Promise<void> {
  if (!isBridgeRuntime) return
  settingWriteSeq += 1
  const seq = settingWriteSeq
  latestSettingWrite.set(key, seq)
  try {
    await callServer('__settings_set', { key, value })
    if (latestSettingWrite.get(key) === seq) pendingSettings.delete(key)
  } catch (error) {
    if (latestSettingWrite.get(key) === seq) pendingSettings.set(key, value)
    throw error
  }
}

async function flushPendingSettings(): Promise<void> {
  for (const [key, value] of Array.from(pendingSettings)) {
    await persistSetting(key, value)
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error('MioMail のサーバーから返事がありません。')),
      ms
    )
    promise.then(
      (value) => {
        window.clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        window.clearTimeout(timer)
        reject(error)
      }
    )
  })
}

let settingsRefreshing: Promise<boolean> | null = null

/**
 * サーバーにある設定で、手元の値を入れ替える。済んだら true。
 *
 * - 設定を預けていない場所(デスクトップ版・localStorage が使えるブラウザー)では何もしない。
 * - まだ取り直せていないとき: `__settings_all` で取り直す。サーバーの値が正。
 *   手元の値が変わると、各ストアが読み直す(`onStorageHydrated`)。
 * - もう取り直してあるとき: 預けそこねた分を送り直すだけ(手元の方が新しいため)。
 *
 * 起動時と、繋がり直したときに呼ぶ。
 */
export function refreshStoredSettings(timeoutMs = 6000): Promise<boolean> {
  if (!settingsLiveOnServer) return Promise.resolve(true)
  if (settingsRefreshing) return settingsRefreshing

  const run = async (): Promise<boolean> => {
    if (settingsFresh) {
      try {
        await flushPendingSettings()
      } catch {
        // まだ繋がらない。次の機会にまた送る
      }
      return true
    }
    try {
      const all = await withTimeout(
        callServer<Record<string, string>>('__settings_all', {}),
        timeoutMs
      )
      hydrateStorage(all && typeof all === 'object' ? all : {})
    } catch (error) {
      // `__settings_all` を知らない古いサーバーなら、これまでどおり(埋め込まれた値で動く)
      const message = error instanceof Error ? error.message : ''
      if (!message.includes('未対応のコマンド')) return false
    }
    settingsFresh = true
    setStoragePersistAllowed(true)
    return true
  }

  settingsRefreshing = run().finally(() => {
    settingsRefreshing = null
  })
  return settingsRefreshing
}

if (isBridgeRuntime) {
  setStoragePersistHook((key, value) => {
    void persistSetting(key, value).catch(() => {
      // 預けられなくても、この画面を開いている間は値が残る(繋がり直したら送り直す)
    })
  })
}

// ---------------------------------------------------------------------------
// サーバーに繋がっているか
// ---------------------------------------------------------------------------
//
// 仮想マシンが入れ替わると、画面を開いたまま MioMail のサーバーだけが止まる。
// イベントの取得が続けて失敗したら「繋がっていない」とみなし、画面に知らせる。

export interface BridgeConnection {
  online: boolean
  /** 繋がっていないときの、最後のエラーの文面。 */
  error: string | null
}

type ConnectionListener = (connection: BridgeConnection) => void

/** 何回続けて失敗したら「繋がっていない」とするか。1回だけの取りこぼしでは騒がない。 */
const OFFLINE_AFTER_FAILURES = 2

const connectionListeners = new Set<ConnectionListener>()
let connection: BridgeConnection = { online: true, error: null }
let failureStreak = 0

function setConnection(next: BridgeConnection) {
  if (next.online === connection.online && next.error === connection.error) return
  const flipped = next.online !== connection.online
  connection = next
  if (!flipped) return
  for (const listener of connectionListeners) {
    try {
      listener(connection)
    } catch {
      // 聞き手の失敗で、次の通知を止めない
    }
  }
}

function noteServerReached() {
  failureStreak = 0
  setConnection({ online: true, error: null })
}

function noteServerUnreachable(error: unknown) {
  failureStreak += 1
  if (failureStreak < OFFLINE_AFTER_FAILURES) return
  const message = error instanceof Error ? error.message : 'MioMail のサーバーに繋がりませんでした。'
  setConnection({ online: false, error: message })
}

/** 繋がった・切れたの切り替わりを聞く。戻り値で解除する。 */
export function onBridgeConnection(listener: ConnectionListener): () => void {
  connectionListeners.add(listener)
  return () => {
    connectionListeners.delete(listener)
  }
}

// ---------------------------------------------------------------------------
// バイト列の受け渡し
// ---------------------------------------------------------------------------

function bytesFromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

async function base64FromFile(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  // 一度に渡すと引数が多すぎて落ちるので刻む
  const CHUNK = 0x8000
  let binary = ''
  for (let index = 0; index < bytes.length; index += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(index, index + CHUNK))
  }
  return btoa(binary)
}

// ---------------------------------------------------------------------------
// ファイルの受け渡し
// ---------------------------------------------------------------------------

/** ブラウザーのファイル選択。キャンセルされたら空配列。 */
function pickLocalFiles(multiple: boolean, accept?: string): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = multiple
    if (accept) input.accept = accept
    input.style.display = 'none'
    document.body.appendChild(input)

    let settled = false
    const finish = (files: File[]) => {
      if (settled) return
      settled = true
      input.remove()
      resolve(files)
    }

    input.addEventListener('change', () => finish(Array.from(input.files ?? [])))
    input.addEventListener('cancel', () => finish([]))
    input.click()
  })
}

/** 選んだファイルをサーバーの一時フォルダーへ預け、そのパスを受け取る。 */
async function uploadFile(file: File): Promise<PickedFile> {
  if ((await decideTransport()) === 'frame') {
    return callFrame<PickedFile>('__upload', {
      name: file.name,
      base64: await base64FromFile(file),
    })
  }

  const response = await fetch(`${BASE}/upload?name=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    credentials: 'same-origin',
    body: file,
  })
  if (!response.ok) {
    throw new Error(`「${file.name}」を送れませんでした (${response.status})`)
  }
  const reply = (await response.json()) as InvokeReply
  if (!reply.ok) {
    throw new Error(reply.error ?? `「${file.name}」を送れませんでした`)
  }
  return reply.data as PickedFile
}

/** ブラウザーにダウンロードさせる。保存先はブラウザーの設定どおり。 */
function downloadUrl(url: string, filename: string) {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

interface AttachmentBytes {
  filename: string
  mime: string
  base64: string
}

/** 枠の中では URL を取りに行けないので、中身をもらってから blob にする。 */
async function attachmentBlobUrl(id: number): Promise<{ url: string; filename: string }> {
  const file = await callFrame<AttachmentBytes>('__attachment_bytes', { attachmentId: id })
  const blob = new Blob([bytesFromBase64(file.base64)], { type: file.mime })
  const url = URL.createObjectURL(blob)
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return { url, filename: file.filename }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// ---------------------------------------------------------------------------
// invoke の差し替え
// ---------------------------------------------------------------------------

interface AttachmentRef {
  id: number
  url: string
  filename: string
}

export async function bridgeInvoke<T>(cmd: string, args?: Args): Promise<T> {
  const framed = (await decideTransport()) === 'frame'

  switch (cmd) {
    // 添付の選択: OS のダイアログの代わりにブラウザーのファイル選択を使い、
    // 中身はサーバーの一時フォルダーへ預ける(以後の経路はデスクトップ版と同じ)。
    case 'compose_pick_files': {
      const files = await pickLocalFiles(true)
      const picked: PickedFile[] = []
      for (const file of files) {
        picked.push(await uploadFile(file))
      }
      return picked as T
    }

    // 保存先はブラウザーが決めるので、ここではダウンロードを始めるだけ。
    case 'attachment_save': {
      const info = await callServer<AttachmentRef>(cmd, args)
      const target = framed ? await attachmentBlobUrl(info.id) : info
      downloadUrl(target.url, target.filename)
      return target.filename as T
    }

    case 'attachment_save_all': {
      const files = await callServer<AttachmentRef[]>(cmd, args)
      for (const file of files) {
        const target = framed ? await attachmentBlobUrl(file.id) : file
        downloadUrl(target.url, target.filename)
        // 連続ダウンロードはブラウザーに止められることがあるので少し空ける
        await wait(300)
      }
      return `${files.length}件` as T
    }

    case 'attachment_open': {
      const info = await callServer<AttachmentRef>(cmd, args)
      const target = framed ? await attachmentBlobUrl(info.id) : info
      const opened = window.open(target.url, '_blank', 'noopener')
      // 枠の中では新しいタブを開けないことがある。そのときは保存に回す。
      if (!opened && framed) downloadUrl(target.url, target.filename)
      return undefined as T
    }

    // MOD の asset は数MBになるので、ふつうは JSON に載せず生のバイト列で取る。
    case 'character_mod_read_asset': {
      if (framed) {
        const reply = await callFrame<{ base64: string }>(cmd, args)
        const bytes = bytesFromBase64(reply.base64)
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as T
      }
      const query = new URLSearchParams({
        mod_id: String((args as Record<string, unknown>)?.modId ?? ''),
        revision: String((args as Record<string, unknown>)?.revision ?? ''),
        asset_key: String((args as Record<string, unknown>)?.assetKey ?? ''),
      })
      const response = await fetch(`${BASE}/mod-asset?${query}`, { credentials: 'same-origin' })
      if (!response.ok) {
        throw new Error(await response.text())
      }
      return (await response.arrayBuffer()) as T
    }

    // MOD の追加: 選んだアーカイブを預けてから、サーバーに展開してもらう。
    case 'character_mod_install_archive': {
      const [file] = await pickLocalFiles(false, '.zip,.xz,.txz')
      if (!file) return null as T
      const uploaded = await uploadFile(file)
      return callServer<T>(cmd, { archivePath: uploaded.path })
    }

    default:
      return callServer<T>(cmd, args)
  }
}

// ---------------------------------------------------------------------------
// listen の差し替え
// ---------------------------------------------------------------------------

type EventHandler = (event: { payload: unknown }) => void

const handlers = new Map<string, Set<EventHandler>>()

function deliver(name: string, payload: unknown) {
  for (const handler of handlers.get(name) ?? []) {
    handler({ payload })
  }
}

// --- 同じオリジンのとき: SSE ------------------------------------------------

let source: EventSource | null = null
let sourceOpened = false

function startSse() {
  if (source) return
  source = new EventSource(`${BASE}/events`, { withCredentials: true })
  source.onopen = () => {
    sourceOpened = true
    noteServerReached()
  }
  source.onerror = () => {
    // 一度も開けないまま落ちる環境(間に入る仕組みが SSE を通さない等)では
    // 張り直しても無駄なので、取りに行く方へ切り替える。
    if (sourceOpened) {
      // 開けていたのに切れた。ブラウザーが自分で張り直し、失敗のたびにここへ来る
      noteServerUnreachable(new Error('MioMail のサーバーに繋がりませんでした。接続を確かめてください。'))
      return
    }
    source?.close()
    source = null
    startPolling()
  }
  for (const name of handlers.keys()) {
    attachSseEvent(name)
  }
}

const sseAttached = new Set<string>()

function attachSseEvent(name: string) {
  if (!source || sseAttached.has(name)) return
  sseAttached.add(name)
  source.addEventListener(name, (event) => {
    try {
      deliver(name, JSON.parse((event as MessageEvent).data))
    } catch {
      // 読めない通知は捨てる
    }
  })
}

// --- 枠の中のとき: 取りに行く -----------------------------------------------

/** 取りに行く間隔。新着の演出が数秒遅れても困らない。 */
const POLL_INTERVAL_MS = 3000

interface PolledEvents {
  next: number
  events: { seq: number; name: string; payload: unknown }[]
}

let pollTimer: number | null = null
let pollSince = 0
let pollPrimed = false

function startPolling() {
  if (pollTimer !== null) return

  const tick = async () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    try {
      const reply = await callServer<PolledEvents>('__events_poll', { since: pollSince })
      noteServerReached()
      pollSince = reply.next
      // 最初の1回は「開く前に起きたこと」なので、番号だけ覚えて流さない。
      if (!pollPrimed) {
        pollPrimed = true
        return
      }
      for (const event of reply.events) {
        deliver(event.name, event.payload)
      }
    } catch (error) {
      // 繋がらない間も次を待つ。続けて失敗したら、画面が「繋がりません」と知らせる
      noteServerUnreachable(error)
    }
  }

  void tick()
  pollTimer = window.setInterval(() => void tick(), POLL_INTERVAL_MS)
}

export function bridgeListen(name: string, handler: EventHandler): Promise<() => void> {
  let set = handlers.get(name)
  if (!set) {
    set = new Set()
    handlers.set(name, set)
  }
  set.add(handler)

  void decideTransport().then((transport) => {
    if (transport === 'frame') {
      startPolling()
    } else {
      startSse()
      attachSseEvent(name)
    }
  })

  return Promise.resolve(() => {
    handlers.get(name)?.delete(handler)
  })
}
