// Windows のリリース時に作った latest.json へ、Linux(AppImage)の項目を足す。
//
// Tauri の自動更新は latest.json の platforms を見る。Windows 版は
// scripts/make-latest-json.mjs が作り、Linux 版は Windows 機でビルドできない
// ため、リリース公開後に GitHub Actions がこのスクリプトで追記する。
//
// Usage:
//   node scripts/add-linux-to-latest-json.mjs \
//     --manifest latest.json \
//     --appimage dist-linux/MioMail-x86_64.AppImage \
//     --tag v2.1.23 \
//     [--asset MioMail-x86_64.AppImage]
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { basename } from 'node:path'

const REPO = 'firemio/miomail'
const PLATFORM = 'linux-x86_64'

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1]
  if (fallback !== undefined) return fallback
  console.error(`--${name} が指定されていません`)
  process.exit(1)
}

const manifestPath = arg('manifest')
const appImagePath = arg('appimage')
const tag = arg('tag')
// リリースへ固定名でアップロードしたファイル名。サイトのリンクと同じもの。
const assetName = arg('asset', basename(appImagePath))

const sigPath = `${appImagePath}.sig`
if (!existsSync(sigPath)) {
  console.error(`署名ファイルがありません: ${sigPath}`)
  console.error('TAURI_SIGNING_PRIVATE_KEY を設定して tauri build を実行したか確認してください')
  process.exit(1)
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const expected = tag.replace(/^v/, '')
if (manifest.version !== expected) {
  // バージョンがずれたまま追記すると、更新先が食い違う
  console.error(`latest.json の version (${manifest.version}) がタグ (${expected}) と一致しません`)
  process.exit(1)
}

manifest.platforms = manifest.platforms || {}
manifest.platforms[PLATFORM] = {
  signature: readFileSync(sigPath, 'utf8').trim(),
  url: `https://github.com/${REPO}/releases/download/${tag}/${encodeURIComponent(assetName)}`,
}

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
console.log(`Added ${PLATFORM} to ${manifestPath}`)
console.log('url:', manifest.platforms[PLATFORM].url)
console.log('platforms:', Object.keys(manifest.platforms).join(', '))
