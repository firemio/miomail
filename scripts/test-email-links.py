"""Browser regression test. Requires Python Playwright and `npm run dev` on 1420."""
from pathlib import Path
import os
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
HTML = ROOT / 'src/renderer/__email_link_test.html'
SCRIPT = ROOT / 'src/renderer/__email_link_test.tsx'

try:
    HTML.write_text('''<!doctype html><meta http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;">
      <div id="root"></div><script type="module" src="/__email_link_test.tsx"></script>''', encoding='utf-8')
    SCRIPT.write_text('''import React from 'react'
import { createRoot } from 'react-dom/client'
window.__TAURI_INTERNALS__ = { invoke: async (cmd, args) => {
  window.calls.push({cmd, args})
  if (window.failOpen) throw new Error('Browser unavailable')
} }
window.calls = []
window.fallbacks = []
window.open = (...args) => { window.fallbacks.push(args); return null }
const { MessageView } = await import('./components/layout/MessageView')
const { useMailStore } = await import('./stores/mailStore')
useMailStore.setState({ currentMessage: {
  id: 1, account_id: 1, subject: 'Link test', from_address: 'test@example.com',
  to_addresses: 'reader@example.com', date: '2026-10-03', flags: '[]', attachments: [],
  html_body: `<a id="normal" href="https://example.com/path?a=1&amp;b=2"><span>Normal</span></a>
    <a id="blank" target="_blank" href="http://example.com/blank">Blank</a>
    <a id="middle" href="https://example.com/middle">Middle</a>
    <a id="relative" href="//example.com/relative">Relative</a>
    <a id="mail" href="mailto:test@example.com">Mail</a>
    <a id="fragment" href="#section">Fragment</a><div id="section">Section</div>
    <a id="unsafe" href="file:///C:/test.txt">Unsafe</a>
    <a id="injected" href="https://example.com/safe" onclick="parent.injected=true">Injected</a>
    <script>parent.injected=true;<\\/script>`
} })
createRoot(document.getElementById('root')).render(<MessageView />)
''', encoding='utf-8')
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto(os.environ.get('MIOMAIL_TEST_URL', 'http://127.0.0.1:1420') + '/__email_link_test.html')
        frame = page.frame_locator('iframe')
        frame.locator('#normal span').click()
        page.wait_for_function('window.calls.length === 1')
        assert page.evaluate('window.calls[0]') == {
            'cmd': 'plugin:opener|open_url',
            'args': {'url': 'https://example.com/path?a=1&b=2'},
        }
        frame.locator('#blank').click(modifiers=['Control'])
        frame.locator('#middle').click(button='middle')
        frame.locator('#relative').click()
        frame.locator('#mail').focus()
        page.keyboard.press('Enter')
        page.wait_for_function('window.calls.length === 5')
        assert page.evaluate('window.calls.map(c => c.args.url)') == [
            'https://example.com/path?a=1&b=2', 'http://example.com/blank',
            'https://example.com/middle', 'https://example.com/relative', 'mailto:test@example.com',
        ]
        frame.locator('#fragment').click()
        frame.locator('#unsafe').click()
        assert page.evaluate('window.calls.length') == 5
        assert frame.locator('#section').is_visible()
        frame.locator('#injected').click()
        page.wait_for_function('window.calls.length === 6')
        assert page.evaluate('window.injected === undefined')
        # No postMessage bridge remains for another frame to spoof.
        page.evaluate("window.postMessage({type:'miomail:open-link',href:'https://example.com/spoof'}, '*')")
        page.evaluate('window.failOpen = true')
        frame.locator('#normal').click()
        page.get_by_role('alert').filter(has_text='Browser unavailable').wait_for()
        assert page.evaluate('window.calls.length') == 7
        assert page.evaluate('window.fallbacks.length') == 0
        assert len(browser.contexts[0].pages) == 1
        assert page.frames[1].url == 'about:srcdoc'
        assert page.locator('iframe').get_attribute('sandbox') == 'allow-same-origin'
        browser.close()
    print('PASS: parent CSP, external opener, middle/keyboard clicks, fragments, blocked scripts, failure handling')
finally:
    HTML.unlink(missing_ok=True)
    SCRIPT.unlink(missing_ok=True)
