import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/globals.css'
import { refreshStoredSettings } from './lib/bridge'

// index.html の「起動しませんでした」の案内を消す。
// ここが動いている＝スクリプトは実行されている、ということなので。
document.getElementById('miomail-boot-fallback')?.remove()

/** 最初の描画を、設定の取り直しのために待つ上限。 */
const SETTINGS_WAIT_MS = 1500

function start() {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}

// HTML をスペース側に置いて使う場合(Muse)、画面は「置いた時点の設定」を持って始まる。
// 描く前に、サーバーから最新の設定を取り直す(テーマや言語が一瞬古い姿で出るのを防ぐ)。
// デスクトップ版や、localStorage が使えるブラウザーでは何も待たない。
// サーバーが止まっていても画面は出す。1.5 秒で終わらなければ先に描き、
// 届いたときに各ストアが読み直す(lib/safeStorage.ts の onStorageHydrated)。
let started = false
const startOnce = () => {
  if (started) return
  started = true
  start()
}
window.setTimeout(startOnce, SETTINGS_WAIT_MS)
void refreshStoredSettings().then(startOnce, startOnce)
