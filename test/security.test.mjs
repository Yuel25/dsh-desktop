import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadMain } from './load-main.mjs'
const opened = []
const security = loadMain('security', {
  electron: { shell: { openExternal: async url => opened.push(url) } },
  './i18n.js': { t: key => key }, './logging.js': { writeRecoveryLog() {} },
})
test('production navigation checks credentials, ports, protocols and files', () => {
  for (const [url, expected] of [
    ['http://127.0.0.1:3080/', true], ['http://localhost:3080/dashboard', true],
    ['http://127.0.0.1:3081/', false], ['http://127.0.0.1:3080@evil.com/', false],
    ['https://127.0.0.1:3080/', false], ['http://evil.com:3080/', false],
    [pathToFileURL(resolve('src/renderer/index.html')).href, true],
    [pathToFileURL(resolve('src/renderer/secret.html')).href, false],
  ]) assert.equal(security.isAllowedNavigation(url, () => 3080), expected, url)
  assert.equal(security.isAllowedNavigation('http://localhost:3080/', () => null), false)
  assert.equal(security.isTrustedRenderer({ url: 'https://evil.com' }), false)
})
test('external opener rejects unsafe URLs before calling shell', async () => {
  for (const url of ['file:///C:/Windows/notepad.exe', 'javascript:alert(1)', 'https://user:password@example.com']) {
    assert.equal(await security.safeOpenExternal(url), false)
  }
  assert.equal(opened.length, 0)
  assert.equal(await security.safeOpenExternal('https://example.com/'), true)
  assert.equal(opened.length, 1)
})
