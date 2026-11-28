// Muse のスペースの代わりをする試験台(手元で、スペースと同じ形を作って確かめるためのもの)。
//   - MioMail の HTML を「置いた写し」として持ち、毎回それを枠に入れる(MioMail へは取りに行かない)
//   - 枠は sandbox="allow-scripts"(allow-same-origin 無し) の srcdoc
//   - 枠からの cmd を、サーバー側(このプロセス)が MioMail の /__miomail/invoke へ中継する
// 再現しないもの: 親ページの CSP の引き継ぎ、スペースのトンネル、スマホの環境。
//
// 使い方:
//   1. npm run tauri -- build --no-bundle
//   2. MIOMAIL_DB=<一時ファイル> で  miomail --serve --port 7412 --single-file --no-token
//      (アカウントは足さない。Windows では資格情報が本物の保存先へ入る)
//   3. node scripts/space-harness.mjs 7411 7412
//   4. curl -X POST http://127.0.0.1:7411/take-snapshot   … いまの HTML を写しとして取る
//   5. http://127.0.0.1:7411/ を開く。外側のページで window.__log(中継の記録)と
//      await window.probe()(枠の中のテーマ・言語・案内・相棒の位置)が読める
// 表示されていないブラウザーの枠では描画が止まり、resize や media query の変化が届かない。
// 状態を読む前にスクリーンショットを1枚撮ると進む。
import http from 'node:http'

const [harnessPort, miomailPort] = process.argv.slice(2).map(Number)
const MIOMAIL = `http://127.0.0.1:${miomailPort}`
let snapshot = null // Buffer
let snapshotTakenAt = null

// 枠の中を外から読むための、試験専用の口。MioMail 自身の nonce を付けて差し込む
// (HTML のほかの部分は変えない)。本番のスペースには無い。
const PROBE = `
addEventListener('message', function (event) {
  var d = event.data
  if (!d || d.probe !== 1) return
  var banner = document.querySelector('[data-testid="connection-banner"]')
  var companion = document.querySelector('[data-testid="companion-overlay"]')
  var dialog = document.querySelector('[role="dialog"]')
  var aside = document.querySelector('aside')
  parent.postMessage({
    probe: 1,
    id: d.id,
    theme: document.documentElement.dataset.theme || null,
    lang: document.documentElement.lang || null,
    banner: banner ? banner.innerText.replace(/\\s+/g, ' ').slice(0, 400) : null,
    companion: companion ? [companion.style.left, companion.style.top, companion.dataset.mascot] : null,
    dialog: dialog ? (dialog.getAttribute('aria-label') || dialog.innerText.slice(0, 60)) : null,
    sidebar: aside ? aside.innerText.replace(/\\s+/g, ' ').slice(0, 200) : null,
    bodyText: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 300),
    width: innerWidth,
    overflowing: Array.prototype.filter.call(document.querySelectorAll('body *'), function (e) {
      var r = e.getBoundingClientRect(); return r.width > 0 && r.right > innerWidth + 1
    }).length,
  }, '*')
})
`

function withProbe(html) {
  const found = html.match(/'nonce-([a-f0-9]{32})'/)
  if (!found) return html
  // </body> という文字列は画面のスクリプトの中にも出てくる。文書の本当の終わり(最後の1つ)に入れる
  const at = html.lastIndexOf('</body>')
  if (at < 0) return html
  return html.slice(0, at) + `<script nonce="${found[1]}">${PROBE}</script>` + html.slice(at)
}

const OUTER = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>MioMail 試験台</title>
<style>html,body{margin:0;height:100%;font:12px sans-serif}#bar{height:22px;line-height:22px;padding:0 8px;background:#222;color:#eee;white-space:nowrap;overflow:hidden}iframe{border:0;display:block;width:100%;height:calc(100% - 22px)}</style>
</head><body><div id="bar">起動中</div>
<script>
const bar = document.getElementById('bar')
window.__log = []        // [ms, cmd, 'ok'|'err:...', value?]
window.__t0 = performance.now()
const stamp = () => Math.round(performance.now() - window.__t0)
let frame = null
let probeId = 0
const probes = new Map()
window.probe = () => new Promise((resolve) => {
  const id = ++probeId
  probes.set(id, resolve)
  frame.contentWindow.postMessage({ probe: 1, id }, '*')
  setTimeout(() => { if (probes.delete(id)) resolve({ timeout: true }) }, 3000)
})
addEventListener('message', async (event) => {
  if (!frame || event.source !== frame.contentWindow) return
  const d = event.data
  if (d && d.probe === 1) { const r = probes.get(d.id); if (r) { probes.delete(d.id); r(d) } return }
  if (!d || d.miomail !== 1) return
  if (d.hello) { frame.contentWindow.postMessage({ miomail: 1, ready: 1 }, '*'); return }
  if (!d.cmd) return
  const started = stamp()
  const note = d.cmd === '__settings_set' ? [d.args.key, String(d.args.value).slice(0, 70)] : undefined
  try {
    const response = await Promise.race([
      fetch('/invoke', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cmd: d.cmd, args: d.args }) }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('時間切れ(10秒)')), 10000)),
    ])
    const text = await response.text()
    let reply
    try { reply = JSON.parse(text) } catch { throw new Error('JSON でない応答: ' + text.slice(0, 80)) }
    if (reply && reply.relayError) throw new Error(reply.relayError)
    window.__log.push([started, d.cmd, reply.ok ? 'ok' : 'app-error:' + reply.error, note])
    frame.contentWindow.postMessage({ miomail: 1, id: d.id, reply }, '*')
  } catch (error) {
    window.__log.push([started, d.cmd, 'err:' + error.message, note])
    frame.contentWindow.postMessage({ miomail: 1, id: d.id, error: String(error.message) }, '*')
  }
  const fails = window.__log.filter((e) => e[2].startsWith('err')).length
  bar.textContent = '中継 ' + window.__log.length + ' 件 / 失敗 ' + fails + ' 件'
})
;(async () => {
  // 置いた写しを取る(MioMail へは行かない)
  const html = await (await fetch('/snapshot.html')).text()
  frame = document.createElement('iframe')
  frame.setAttribute('sandbox', 'allow-scripts')
  frame.srcdoc = html
  document.body.appendChild(frame)
  bar.textContent = '写し ' + html.length + ' 字を枠に入れた'
})()
</script></body></html>`

function readBody(request) {
  return new Promise((resolve) => {
    const chunks = []
    request.on('data', (c) => chunks.push(c))
    request.on('end', () => resolve(Buffer.concat(chunks)))
  })
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && request.url === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
      response.end(OUTER)
    } else if (request.method === 'GET' && request.url === '/snapshot.html') {
      if (!snapshot) { response.writeHead(503); response.end('no snapshot'); return }
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
      response.end(withProbe(snapshot.toString('utf8')))
    } else if (request.method === 'POST' && request.url === '/take-snapshot') {
      const r = await fetch(MIOMAIL + '/')
      snapshot = Buffer.from(await r.arrayBuffer())
      snapshotTakenAt = new Date().toISOString()
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ bytes: snapshot.length, takenAt: snapshotTakenAt }))
    } else if (request.method === 'POST' && request.url === '/invoke') {
      const body = await readBody(request)
      try {
        const r = await fetch(MIOMAIL + '/__miomail/invoke', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
        const text = await r.text()
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(text)
      } catch (error) {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ relayError: '接続エラー: ' + (error.cause?.code || error.message) + ' 127.0.0.1:' + miomailPort }))
      }
    } else {
      response.writeHead(404); response.end('not found')
    }
  } catch (error) {
    response.writeHead(500); response.end(String(error))
  }
})
server.listen(harnessPort, '127.0.0.1', () => console.log('harness on http://127.0.0.1:' + harnessPort + ' -> ' + MIOMAIL))
