import test from 'node:test'
import assert from 'node:assert/strict'
import { loadMain } from './load-main.mjs'

test('failed atomic save rolls back shared settings and preserves disk data', () => {
  let fail = false, disk = '', temporary = ''
  const config = loadMain('config', {
    electron: { app: { getPath: () => '/fake' } },
    './i18n.js': { getSystemLocale: () => 'en' },
    'node:fs': {
      readFileSync() { throw Error('first run') }, existsSync: () => false,
      writeFileSync(_file, data) { temporary = data },
      renameSync() { if (fail) throw Error('EACCES'); disk = temporary },
      unlinkSync() { temporary = '' },
    },
  })
  const reference = config.getSettings()
  config.saveSettings()
  const previousDisk = disk
  fail = true
  reference.port = 4080
  assert.throws(() => config.saveSettings(), /EACCES/)
  assert.equal(reference.port, 3080)
  assert.equal(config.getSettings(), reference)
  assert.equal(disk, previousDisk)
  fail = false
  reference.port = 4080
  config.saveSettings()
  assert.equal(JSON.parse(disk).port, 4080)
})

test('login registration errors reach the caller', () => {
  const config = loadMain('config', {
    electron: { app: { getPath: () => '/nonexistent', setLoginItemSettings() { throw Error('denied') } } },
    './i18n.js': { getSystemLocale: () => 'en' },
  })
  assert.throws(() => config.applyLoginItems(true), /denied/)
})
