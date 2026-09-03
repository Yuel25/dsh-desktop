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
