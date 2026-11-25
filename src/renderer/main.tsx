import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/globals.css'

// index.html の「起動しませんでした」の案内を消す。
// ここが動いている＝スクリプトは実行されている、ということなので。
document.getElementById('miomail-boot-fallback')?.remove()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
