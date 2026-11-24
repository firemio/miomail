import { readFileSync } from 'fs'
import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const { version } = JSON.parse(
  readFileSync(resolve(__dirname, '../package.json'), 'utf8')
) as { version: string }

// MioMailのホームページ（静的サイト）。アプリ本体とは別にビルド・デプロイする。
// 実行はリポジトリルートから: npm run site:dev / npm run site:build
export default defineConfig({
  base: './',
  plugins: [react()],
  root: __dirname,
  define: {
    // 表示するバージョンの既定値。サイトはリリースとは別にデプロイするため、
    // 実行時に GitHub の最新リリースで上書きする(src/version.ts)
    __MIOMAIL_VERSION__: JSON.stringify(version)
  },
  server: {
    port: 4173,
    strictPort: true
  },
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        mods: resolve(__dirname, 'mods.html'),
        mcp: resolve(__dirname, 'mcp.html')
      }
    }
  }
})
