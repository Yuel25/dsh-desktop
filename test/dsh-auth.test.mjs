import test from 'node:test'
import assert from 'node:assert/strict'
import { loadMain } from './load-main.mjs'
const { parseDshLaunchUrl, createDshLaunchReader, redactDshToken } = loadMain('dsh-auth')

test('only accepts the current instance root launch URL', () => {
  assert.equal(parseDshLaunchUrl('\x1b[32mdsh web: http://localhost:3080/?token=abc\x1b[0m', 3080), 'http://127.0.0.1:3080/?token=abc')
  for (const url of ['https://127.0.0.1:3080/?token=a', 'http://evil.test:3080/?token=a', 'http://127.0.0.1:3081/?token=a', 'http://user@127.0.0.1:3080/?token=a', 'http://127.0.0.1:3080/path?token=a', 'http://127.0.0.1:3080/?token=a&token=b', 'http://127.0.0.1:3080/?token=', 'http://127.0.0.1:3080/?token=a&other=b']) {
    assert.equal(parseDshLaunchUrl(`dsh web: ${url}`, 3080), null)
  }
})

test('reader handles split lines, UTF-8, CRLF, and oversized output', () => {
  const urls = [], read = createDshLaunchReader(3080, url => urls.push(url))
  const bytes = Buffer.from('启动中\ndsh web: http://127.0.0.1:3080/?token=abc\r\n')
  for (const byte of bytes) read(Buffer.from([byte]))
  read(Buffer.from('x'.repeat(10000)))
  read(Buffer.from('dsh web: http://127.0.0.1:3080/?token=ignored\n'))
  read(Buffer.from('dsh web: http://127.0.0.1:3080/?token=next\n'))
  assert.deepEqual(urls, ['http://127.0.0.1:3080/?token=abc', 'http://127.0.0.1:3080/?token=next'])
  assert.equal(redactDshToken('load failed http://127.0.0.1:3080/?token=secret'), 'load failed http://127.0.0.1:3080/?token=[redacted]')
})
