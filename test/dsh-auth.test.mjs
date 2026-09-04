import test from 'node:test'
import assert from 'node:assert/strict'
import { loadMain } from './load-main.mjs'
const { parseDshLaunchUrl, createDshLaunchReader, redactDshToken, DshLogRedactor } = loadMain('dsh-auth')

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

test('DshLogRedactor redacts launch tokens across arbitrary chunk split boundaries', () => {
  const fullText = '启动服务中...\ndsh web: http://127.0.0.1:3080/?token=0123456789abcdef\n就绪已完成\n'
  const secret = '0123456789abcdef'
  const buffer = Buffer.from(fullText, 'utf8')

  for (let split = 1; split < buffer.length; split++) {
    const redactor = new DshLogRedactor()
    let output = ''
    output += redactor.write(buffer.subarray(0, split))
    output += redactor.write(buffer.subarray(split))
    output += redactor.end()

    assert.ok(!output.includes(secret), `Secret leaked when split at ${split}`)
    assert.ok(output.includes('?token=[redacted]'), `Redacted token missing when split at ${split}`)
    assert.ok(output.includes('启动服务中...'), `UTF-8 corrupted when split at ${split}`)
    assert.ok(output.includes('就绪已完成'), `UTF-8 corrupted when split at ${split}`)
  }
})

test('DshLogRedactor handles byte-by-byte streaming without trailing newline', () => {
  const fullText = '正在启动：http://localhost:3080/?foo=1&token=mySecretToken123'
  const secret = 'mySecretToken123'
  const bytes = Buffer.from(fullText, 'utf8')
  const redactor = new DshLogRedactor()
  let output = ''

  for (const byte of bytes) {
    output += redactor.write(Buffer.from([byte]))
  }
  output += redactor.end()

  assert.ok(!output.includes(secret))
  assert.equal(output, '正在启动：http://localhost:3080/?foo=1&token=[redacted]')
})

test('DshLogRedactor handles oversized input without memory blowup', () => {
  const redactor = new DshLogRedactor()
  const prefix = 'x'.repeat(20000)
  const tokenPart = 'http://127.0.0.1:3080/?token=secretToken '
  const suffix = 'y'.repeat(20000)
  let output = ''
  output += redactor.write(prefix + tokenPart + suffix)
  output += redactor.end()

  assert.ok(!output.includes('secretToken'))
  assert.ok(output.includes('?token=[redacted] '))
  assert.equal(output.length, (prefix + tokenPart + suffix).length - 'secretToken'.length + '[redacted]'.length)
})

test('DshLogRedactor discards all oversized token fragments and resumes after delimiters', () => {
  for (const size of [1, 513, 1024, 4096, 40000]) {
    const redactor = new DshLogRedactor()
    const input = '?token=' + 'a'.repeat(25000) + 'SYNTHETIC_TAIL&next=ok&token=secondSecret\n完成'
    const bytes = Buffer.from(input)
    let output = ''
    for (let i = 0; i < bytes.length; i += size) output += redactor.write(bytes.subarray(i, i + size))
    output += redactor.end()
    assert.equal(output, '?token=[redacted]&next=ok&token=[redacted]\n完成')
  }
  const redactor = new DshLogRedactor()
  assert.equal(redactor.write('?token=' + 'a'.repeat(25000)), '?token=[redacted]')
  assert.equal(redactor.end('SYNTHETIC_TAIL'), '')
})
