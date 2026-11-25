import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { buildSync } from 'esbuild'
import ts from 'typescript'

const catalogs = Object.fromEntries(readdirSync('src/renderer/locales').filter((file) => file.endsWith('.json')).map((file) => [file, JSON.parse(readFileSync(`src/renderer/locales/${file}`, 'utf8'))]))
const sourceKeys = Object.keys(catalogs['en.json']).sort()
const placeholders = (value) => [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()
for (const [locale, messages] of Object.entries(catalogs)) {
  assert.deepEqual(Object.keys(messages).sort(), sourceKeys, `${locale}: missing or extra messages`)
  for (const [key, value] of Object.entries(messages)) {
    assert.ok(value.trim(), `${locale}: empty translation: ${key}`)
    assert.deepEqual(placeholders(value), placeholders(key), `${locale}: interpolation mismatch: ${key}`)
  }
}

// Every explicit translation call must have a catalog entry. User mail, MOD
// metadata and arbitrary server diagnostics are intentionally not translated.
for (const file of readdirSync('src/renderer', { recursive: true }).filter((file) => /\.tsx?$/.test(file))) {
  const source = ts.createSourceFile(file, readFileSync(`src/renderer/${file}`, 'utf8'), ts.ScriptTarget.Latest, true)
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't' && ts.isStringLiteral(node.arguments[0])) {
      assert.ok(Object.hasOwn(catalogs['en.json'], node.arguments[0].text), `${file}: missing translation: ${node.arguments[0].text}`)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
}

const saved = new Map()
globalThis.localStorage = { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: (key) => saved.delete(key) }
const bundled = buildSync({ stdin: { contents: "export * from './src/renderer/lib/i18n.ts'; export { getFolderDisplayName } from './src/renderer/lib/folderDisplay.ts'", resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', platform: 'node' }).outputFiles[0].text
const load = (suffix) => import(`data:text/javascript;base64,${Buffer.from(bundled).toString('base64')}#${suffix}`)
const { t, useLanguage, languages, dateLocale, getFolderDisplayName } = await load('initial')
assert.equal(useLanguage.getState().language, 'ja')
for (const { id } of languages) {
  useLanguage.getState().setLanguage(id)
  assert.equal(saved.get('miomail-language'), id)
  assert.equal(t('設定'), id === 'ja' ? '設定' : catalogs[`${id}.json`]['設定'])
  assert.equal(getFolderDisplayName({ path: 'INBOX', name: '受信トレイ' }), t('受信トレイ'))
  assert.equal(getFolderDisplayName({ path: 'INBOX.&TtVOiw-', name: '仕事' }), '仕事')
  // Interpolation must not translate or reinterpret user content.
  const subject = '受信トレイ <script> {to} $&'
  assert.ok(t('{to} に「{subject}」を送ったよ。', { to: 'person@example.com', subject }).includes(subject))
  assert.ok(new Intl.DateTimeFormat(dateLocale()).format(new Date('2026-09-11T12:00:00Z')))
}
assert.equal((await load('reload')).useLanguage.getState().language, 'vi')
saved.set('miomail-language', 'unsupported')
assert.equal((await load('invalid')).useLanguage.getState().language, 'ja')
globalThis.localStorage = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') }, removeItem() { throw new Error('blocked') } }
const blocked = await load('blocked')
blocked.useLanguage.getState().setLanguage('ko')
assert.equal(blocked.t('設定'), '설정')

// A sandboxed frame without allow-same-origin throws on the property itself,
// not on the method. Reading it must not take the app down.
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  get() { throw new Error('The document is sandboxed and lacks the allow-same-origin flag.') },
})
const sandboxed = await load('sandboxed')
assert.equal(sandboxed.useLanguage.getState().language, 'ja')
sandboxed.useLanguage.getState().setLanguage('ko')
assert.equal(sandboxed.t('設定'), '설정')

console.log(`Verified ${languages.length} languages, ${sourceKeys.length} messages, interpolation, persistence, and storage fallback.`)
