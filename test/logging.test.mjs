import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, statSync, readFileSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { finished } from 'node:stream/promises'
import { loadMain } from './load-main.mjs'
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-logging-'))
  t.after(() => {
    for (const name of readdirSync(directory)) unlinkSync(join(directory, name))
    rmdirSync(directory)
  })
  return { directory, logs: loadMain('logging', { electron: { app: { getPath: () => directory } } }) }
}
test('continuous writes split oversized chunks and rotate while stream stays open', async t => {
  const { directory, logs } = fixture(t)
  const stream = logs.createRotatingLogStream('service.log')
  const done = finished(stream)
  stream.write(Buffer.alloc(logs.MAX_LOG_SIZE + 1024, 'x'))
  stream.end('end')
  await done
  assert.equal(statSync(join(directory, 'service.1.log')).size, logs.MAX_LOG_SIZE)
  assert.equal(statSync(join(directory, 'service.log')).size, 1027)
  assert.equal(logs.readLogTail('service.log', 3), 'end')
})
test('ongoing stream retains only three backups and newest data', async t => {
  const { directory, logs } = fixture(t)
  const stream = logs.createRotatingLogStream('service.log')
  const done = finished(stream)
  for (let i = 0; i < 5; i++) stream.write(Buffer.alloc(logs.MAX_LOG_SIZE, String(i)))
  stream.end('newest')
  await done
  assert.equal(readdirSync(directory).length, 4)
  assert.equal(readFileSync(join(directory, 'service.log'), 'utf8'), 'newest')
  assert.equal(logs.readLogTail('service.1.log', 1), '4')
})
test('directory budget removes backups and preserves active logs', t => {
  const { directory, logs } = fixture(t)
  writeFileSync(join(directory, 'active.log'), 'active')
  writeFileSync(join(directory, 'service.1.log'), Buffer.alloc(logs.MAX_TOTAL_LOG_BUDGET))
  logs.enforceDirectoryBudget(directory)
  assert.deepEqual(readdirSync(directory), ['active.log'])
})
test('append failure surfaces as a stream error', async t => {
  const { logs } = fixture(t)
  const stream = logs.createRotatingLogStream('missing/child.log')
  const done = finished(stream)
  stream.end('data')
  await assert.rejects(done, /ENOENT/)
})

test('rotating log stream redacts token before persisting to disk', async t => {
  const { directory, logs } = fixture(t)
  const stream = logs.createRotatingLogStream('dsh.stdout.log')
  const done = finished(stream)
  stream.write('dsh web: http://127.0.0.1:3080/?token=liveSecret123\n')
  stream.write('stderr line: http://127.0.0.1:3080/?token=anotherSecret')
  stream.end()
  await done

  const content = readFileSync(join(directory, 'dsh.stdout.log'), 'utf8')
  assert.ok(!content.includes('liveSecret123'))
  assert.ok(!content.includes('anotherSecret'))
  assert.ok(content.includes('http://127.0.0.1:3080/?token=[redacted]\n'))
  assert.ok(content.includes('http://127.0.0.1:3080/?token=[redacted]'))
})

test('writeRecoveryLog redacts auth tokens in messages', t => {
  const { directory, logs } = fixture(t)
  logs.writeRecoveryLog('Connection failed: http://127.0.0.1:3080/?token=recoverySecret999')
  const content = readFileSync(join(directory, 'recovery.log'), 'utf8')
  assert.ok(!content.includes('recoverySecret999'))
  assert.ok(content.includes('?token=[redacted]'))
})

test('isAllowedLogFilename accepts safe log names and rejects path traversal and dangerous names', t => {
  const { logs } = fixture(t)
  const valid = [
    'dsh.stdout.log',
    'dsh.stderr.log',
    'recovery.log',
    'dsh.1.log',
    'dsh.coding.stdout.log',
    'dsh.开发环境.stdout.log',
    'dsh.my profile.stdout.log',
    'service.log',
  ]
  for (const name of valid) {
    assert.equal(logs.isAllowedLogFilename(name), true, `Expected valid: ${name}`)
  }

  const invalid = [
    '../dsh.stdout.log',
    '..\\dsh.stdout.log',
    'foo/bar.log',
    'foo\\bar.log',
    'dsh.stdout.log\0',
    'dsh:stdout.log',
    'dsh*log.log',
    'dsh?log.log',
    'dsh"log.log',
    'dsh<log.log',
    'dsh>log.log',
    'dsh|log.log',
    'nul.log',
    'con.log',
    'aux.log',
    'prn.log',
    'com1.log',
    'dsh.exe',
    'dsh.cmd',
    'secret.txt',
    '',
    null,
    undefined,
    123,
  ]
  for (const name of invalid) {
    assert.equal(logs.isAllowedLogFilename(name), false, `Expected invalid: ${name}`)
  }
})

test('readLogTail returns empty string for missing or empty logs without error and rejects invalid paths', t => {
  const { directory, logs } = fixture(t)
  // Missing log returns ''
  assert.equal(logs.readLogTail('dsh.stdout.log'), '')

  // Empty log returns ''
  writeFileSync(join(directory, 'dsh.stdout.log'), '')
  assert.equal(logs.readLogTail('dsh.stdout.log'), '')

  // Non-empty log returns contents
  writeFileSync(join(directory, 'dsh.stdout.log'), 'hello logs')
  assert.equal(logs.readLogTail('dsh.stdout.log'), 'hello logs')

  // Illegal log name throws
  assert.throws(() => logs.readLogTail('../secret.log'), /Unknown log file/)
  assert.throws(() => logs.readLogTail('secret.txt'), /Unknown log file/)
})

test('listAvailableLogFiles returns empty array on empty directory and lists only valid log files', t => {
  const { directory, logs } = fixture(t)
  // Initially empty directory
  assert.deepEqual(logs.listAvailableLogFiles(), [])

  // Create valid and invalid files
  writeFileSync(join(directory, 'dsh.stdout.log'), 'line')
  writeFileSync(join(directory, 'recovery.log'), 'line')
  writeFileSync(join(directory, 'not-a-log.txt'), 'line')
  writeFileSync(join(directory, 'dsh.exe'), 'binary')

  const available = logs.listAvailableLogFiles()
  assert.deepEqual(available, ['dsh.stdout.log', 'recovery.log'])
})

test('log listing propagates permission errors but tolerates a missing directory', () => {
  for (const code of ['EACCES', 'EPERM', 'ENOENT']) {
    const logs = loadMain('logging', {
      electron: { app: { getPath: () => '/fake' } },
      'node:fs': {
        mkdirSync() {}, existsSync: () => true,
        readdirSync() { throw Object.assign(new Error(code), { code }) },
      },
    })
    if (code === 'ENOENT') assert.equal(logs.listAvailableLogFiles().length, 0)
    else assert.throws(() => logs.listAvailableLogFiles(), error => error.code === code)
  }
})
