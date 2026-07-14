import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// MioMailのホームページ（静的サイト）。アプリ本体とは別にビルド・デプロイする。
// 実行はリポジトリルートから: npm run site:dev / npm run site:build
export default defineConfig({
  base: './',
  plugins: [react()],
  root: __dirname,
  server: {
    port: 4173,
    strictPort: true
  },
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true
  }
})
