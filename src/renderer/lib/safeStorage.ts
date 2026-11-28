// localStorage に触れない場所でも画面が止まらないようにする包み。
//
// Muse のスペースのように、自分のオリジンを持たない枠(`allow-same-origin` の
// 無い sandbox された iframe)では、`window.localStorage` は**読むだけで**
// SecurityError が飛ぶ。囲って握りつぶすだけだと、テーマもキャラクターも
// 書きかけのメールも開き直すたびに消えてしまうので、そういう場所では
// MioMail のデータベース側へ預け直す。
//
// 画面はこの値を同期的に読む(モジュールの読み込み中に読むものもある)ので、
// 最初の一式はサーバーが HTML へ埋め込んでくる。書くときだけ非同期に預ける。

interface Backing {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
  keys(): string[]
}

interface BridgeMarker {
  settings?: Record<string, string>
}

/** サーバーへ預ける手。`lib/bridge.ts` が読み込まれたときに差し込む。 */
type PersistHook = (key: string, value: string | null) => void

let persistHook: PersistHook | null = null

export function setStoragePersistHook(hook: PersistHook): void {
  persistHook = hook
}

function nativeBacking(): Backing | null {
  try {
    const store = globalThis.localStorage
    // 読めるだけでなく書けることまで確かめる(プライベートモード対策)
    const probe = '__miomail_probe__'
    store.setItem(probe, '1')
    store.removeItem(probe)
    return {
      getItem: (key) => store.getItem(key),
      setItem: (key, value) => store.setItem(key, value),
      removeItem: (key) => store.removeItem(key),
      keys: () => Object.keys(store),
    }
  } catch {
    return null
  }
}

/** localStorage に触れない場所で使う、手元の入れ物。 */
const memory = new Map<string, string>()

function memoryBacking(): Backing {
  const map = memory
  // サーバーが HTML へ埋め込んでくれた値で始める。HTML をスペース側に置いて使う場合
  // (Muse)、これは「置いた時点の写し」なので古いことがある。起動のあと
  // hydrateStorage() が、サーバーから取り直した値で入れ替える。
  const marker = (globalThis as unknown as Record<string, unknown>).__MIOMAIL_BRIDGE__ as
    | BridgeMarker
    | undefined
  for (const [key, value] of Object.entries(marker?.settings ?? {})) {
    map.set(key, value)
  }
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value)
    },
    removeItem: (key) => {
      map.delete(key)
    },
    keys: () => Array.from(map.keys()),
  }
}

let backing: Backing | null = null
let native = true

function store(): Backing {
  if (!backing) {
    const found = nativeBacking()
    native = found !== null
    backing = found ?? memoryBacking()
  }
  return backing
}

/** ブラウザー自身が覚えていてくれるか。false のときはサーバーへ預けている。 */
export function storageIsNative(): boolean {
  store()
  return native
}

/**
 * サーバーへ預けてよいか。
 *
 * 置いた写しの画面は、古い設定を持って始まる。その状態から起動時に走る自動の保存
 * (相棒の状態の更新など)をそのまま預けると、サーバーにある新しい設定を古い値で
 * 上書きしてしまう。だから、サーバーから設定を取り直せるまでは預けない。
 * `lib/bridge.ts` が切り替える。
 */
let persistAllowed = true

export function setStoragePersistAllowed(allowed: boolean): void {
  persistAllowed = allowed
}

type HydrateListener = () => void

const hydrateListeners = new Set<HydrateListener>()

/**
 * 手元の値がサーバーの値で入れ替わったときに呼ばれる。
 * 各ストアは作られた時点の値を持っているので、ここで読み直す。
 */
export function onStorageHydrated(listener: HydrateListener): () => void {
  hydrateListeners.add(listener)
  return () => {
    hydrateListeners.delete(listener)
  }
}

/**
 * サーバーから取り直した設定で、手元の値をまるごと入れ替える(サーバーの値が正)。
 * localStorage が使える場所では何もしない。中身が変わったときだけ true を返す。
 */
export function hydrateStorage(values: Record<string, string>): boolean {
  if (storageIsNative()) return false
  const entries = Object.entries(values).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string'
  )
  const same =
    entries.length === memory.size && entries.every(([key, value]) => memory.get(key) === value)
  if (same) return false

  memory.clear()
  for (const [key, value] of entries) {
    memory.set(key, value)
  }
  for (const listener of hydrateListeners) {
    try {
      listener()
    } catch {
      // 1つのストアが読み直せなくても、ほかは続ける
    }
  }
  return true
}

function remember(key: string, value: string | null) {
  if (storageIsNative() || !persistHook || !persistAllowed) return
  try {
    persistHook(key, value)
  } catch {
    // 預けられなくても、この画面を開いている間は値が残る
  }
}

export const safeStorage = {
  getItem(key: string): string | null {
    try {
      return store().getItem(key)
    } catch {
      return null
    }
  },
  setItem(key: string, value: string): void {
    try {
      store().setItem(key, value)
      remember(key, value)
    } catch {
      // 容量いっぱいなどは諦める。画面は動き続ける。
    }
  },
  removeItem(key: string): void {
    try {
      store().removeItem(key)
      remember(key, null)
    } catch {
      // 同上
    }
  },
  keys(): string[] {
    try {
      return store().keys()
    } catch {
      return []
    }
  },
}
