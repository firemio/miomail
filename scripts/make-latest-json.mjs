// Generates latest.json for the Tauri updater from the NSIS build artifacts.
// Usage: node scripts/make-latest-json.mjs [--notes "release notes"]
// Output: src-tauri/target/release/bundle/nsis/latest.json
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const conf = JSON.parse(readFileSync(join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'))
const version = conf.version
const repo = 'firemio/miomail'

const nsisDir = join(root, 'src-tauri', 'target', 'release', 'bundle', 'nsis')
const files = readdirSync(nsisDir)
// Select the artifact that matches the current version (the dir may still hold
// older builds), so the URL and signature never drift from `version`.
const setupExe = files.find((f) => f.includes(`_${version}_`) && f.endsWith('-setup.exe'))
const setupSig = setupExe ? `${setupExe}.sig` : undefined

if (!setupExe || !setupSig || !files.includes(setupSig)) {
  console.error(`NSIS setup exe / sig for version ${version} not found in`, nsisDir)
  console.error('Run: npm run tauri build (with TAURI_SIGNING_PRIVATE_KEY set)')
  process.exit(1)
}

const notesFlag = process.argv.indexOf('--notes')
const notes = notesFlag !== -1 ? process.argv[notesFlag + 1] : `MioMail v${version}`

const latest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': {
      signature: readFileSync(join(nsisDir, setupSig), 'utf8'),
      url: `https://github.com/${repo}/releases/download/v${version}/${encodeURIComponent(setupExe)}`,
    },
  },
}

const outPath = join(nsisDir, 'latest.json')
writeFileSync(outPath, JSON.stringify(latest, null, 2))
console.log('Wrote', outPath)
console.log('Artifact:', setupExe)
