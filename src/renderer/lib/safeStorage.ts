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

function memoryBacking(): Backing {
  const map = new Map<string, string>()
  // サーバーが埋め込んでくれた前回の値で始める
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

function remember(key: string, value: string | null) {
  if (storageIsNative() || !persistHook) return
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
