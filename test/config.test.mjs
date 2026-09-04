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

test('profile validation accepts valid names and rejects invalid/dangerous values', () => {
  const { isValidProfileName } = loadMain('types')
  assert.equal(isValidProfileName('web'), true)
  assert.equal(isValidProfileName('my profile'), true)
  assert.equal(isValidProfileName('测试'), true)
  assert.equal(isValidProfileName('dev-01'), true)
  assert.equal(isValidProfileName('profile.2'), true)

  assert.equal(isValidProfileName(123), false)
  assert.equal(isValidProfileName({}), false)
  assert.equal(isValidProfileName(['web']), false)
  assert.equal(isValidProfileName(true), false)
  assert.equal(isValidProfileName(null), false)
  assert.equal(isValidProfileName(undefined), false)
  assert.equal(isValidProfileName(''), false)
  assert.equal(isValidProfileName('   '), false)
  assert.equal(isValidProfileName(' web'), false)
  assert.equal(isValidProfileName('web '), false)
  assert.equal(isValidProfileName('.'), false)
  assert.equal(isValidProfileName('..'), false)
  assert.equal(isValidProfileName('con'), false)
  assert.equal(isValidProfileName('COM1'), false)
  assert.equal(isValidProfileName('web&calc.exe'), false)
  assert.equal(isValidProfileName('foo%TEMP%bar'), false)
  assert.equal(isValidProfileName('foo!PATH!bar'), false)
  assert.equal(isValidProfileName('foo^bar'), false)
  assert.equal(isValidProfileName('foo|bar'), false)
  assert.equal(isValidProfileName('foo"bar'), false)
  assert.equal(isValidProfileName("foo'bar"), false)
  assert.equal(isValidProfileName('foo;bar'), false)
  assert.equal(isValidProfileName('foo`bar'), false)
  assert.equal(isValidProfileName('foo$bar'), false)
  assert.equal(isValidProfileName('foo\nbar'), false)
})

test('config loading falls back to default profile when encountering non-string or invalid profile', () => {
  const testCases = [
    { input: 123, expected: 'web' },
    { input: {}, expected: 'web' },
    { input: ['web'], expected: 'web' },
    { input: true, expected: 'web' },
    { input: '', expected: 'web' },
    { input: '   ', expected: 'web' },
    { input: 'web&calc.exe', expected: 'web' },
    { input: 'foo%TEMP%', expected: 'web' },
    { input: '我的配置', expected: '我的配置' },
    { input: 'custom profile', expected: 'custom profile' },
  ]

  for (const { input, expected } of testCases) {
    const config = loadMain('config', {
      electron: { app: { getPath: () => '/fake' } },
      './i18n.js': { getSystemLocale: () => 'en' },
      'node:fs': {
        readFileSync() { return JSON.stringify({ profile: input }) },
        existsSync: () => false,
      },
    })
    assert.equal(config.loadSettings().profile, expected)
  }
})

test('legacy config migration validates profile type and value', () => {
  const config = loadMain('config', {
    electron: { app: { getPath: () => '/fake' } },
    './i18n.js': { getSystemLocale: () => 'en' },
    'node:fs': {
      readFileSync(path) {
        if (path.endsWith('settings.json')) throw Error('not found')
        if (path.endsWith('profile.json')) return JSON.stringify({ profile: 999 })
        throw Error('not found')
      },
      existsSync: () => false,
    },
  })
  assert.equal(config.loadSettings().profile, 'web')
})
