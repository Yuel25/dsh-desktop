import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import { loadMain } from './load-main.mjs'
const tick = () => new Promise(resolve => setImmediate(resolve))
function fixture(options = {}) {
  const children = [], killed = [], windows = [], events = [], lookupCallbacks = [], loadedUrls = []
  const settings = { profile: 'web', port: 3080 }
  let port = 40000, now = 0
  function window() {
    const w = new EventEmitter()
    let destroyed = false
    Object.assign(w, {
      isDestroyed: () => destroyed, show() {}, focus() {},
      destroy() { if (!destroyed) { destroyed = true; w.emit('closed') } },
      loadURL: async url => { loadedUrls.push(url) },
      webContents: { session: { fetch: async () => ({ ok: options.authorizedSession ?? false }) } },
    })
    windows.push(w)
    return w
  }
  const main = window()
  const dsh = loadMain('dsh', {
    electron: { app: { getPath: () => '/fake' }, dialog: { showMessageBox: async () => ({ response: 0 }) } },
    './config.js': { getSettings: () => settings, saveSettings() {} },
    './i18n.js': { t: key => key }, './updater.js': { notify() {} },
    './logging.js': {
      createRotatingLogStream: () => new Writable({ write(_chunk, _encoding, cb) { cb() } }),
      safeCloseStream(s) { if (s && !s.writableEnded) s.end() }, writeRecoveryLog() {},
    },
    './windows.js': { createAppWindow: window, getMainWindow: () => main, loadLocalPage: async () => {}, sendStatus() {}, sendStatusTo() {}, sendGuidance() {} },
    'node:fs': { existsSync: () => false },
    'node:child_process': {
      execFile(command, args, _options, cb) {
        if (command === 'taskkill.exe') {
          killed.push(Number(args[1])); events.push('kill')
          if (options.holdKill) options.holdKill(() => cb(null, { stdout: '' }))
          else cb(null, { stdout: '' })
          return
        }
        if (command === 'where.exe' && options.holdLookup) { lookupCallbacks.push(cb); return }
        cb(null, { stdout: command === 'where.exe' ? 'dsh.cmd' : '' })
      },
      spawn() {
        const child = new EventEmitter()
        Object.assign(child, { pid: 100 + children.length, exitCode: null, stdout: new PassThrough(), stderr: new PassThrough() })
        children.push(child); events.push('spawn')
        if (options.output) queueMicrotask(() => options.output(child, children.length))
        if (options.spawnError && children.length === 1) queueMicrotask(() => child.emit('error', Error('ENOENT')))
        return child
      },
    },
    'node:net': { createServer() {
      return { unref() {}, on() {}, listen(_port, _host, cb) { setImmediate(cb) }, address: () => ({ port: port++ }), close: cb => cb() }
    } },
    'node:http': { get(url, _options, cb) {
      const req = new EventEmitter(); req.destroy = () => {}
      setImmediate(() => {
        if (options.http) { const reply = options.http(url, children.length); if (reply) cb({ headers: {}, resume() {}, ...reply }); else req.emit('error', Error('offline')); return }
        if (options.holdHttp && children.length) { options.holdHttp(() => cb({ statusCode: 200, resume() {} })); return }
        const ready = options.ready ? options.ready(children.length) : true
        if (ready) cb({ statusCode: 200, resume() {} }); else req.emit('error', Error('offline'))
      })
      return req
    } },
  }, {
    setTimeout: cb => setImmediate(cb),
    Date: { now: () => (now += options.timeout ? 20000 : 1) },
  })
  return { dsh, children, killed, windows, window, events, settings, lookupCallbacks, loadedUrls }
}
function entry(f) {
  return { window: f.window(), profile: 'coding', port: 40000, url: 'http://127.0.0.1:40000', process: null, recoveryAttempts: 0, startupError: null }
}
async function waitFor(predicate) {
  for (let i = 0; i < 30; i++) { if (predicate()) return; await tick() }
  throw Error('Expected boundary was not reached')
}
test('closing during recovery command lookup never spawns a process', async () => {
  const f = fixture({ holdLookup: true }), e = entry(f)
  const pending = f.dsh.recoverProfileWindow(e)
  await waitFor(() => f.lookupCallbacks.length)
  e.window.destroy()
  f.lookupCallbacks[0](null, { stdout: 'dsh.cmd' })
  await pending
  assert.equal(f.children.length, 0)
  assert.equal(e.process, null)
})
test('closing during recovery readiness cleans up even when window is already destroyed', async () => {
  let reply
  const f = fixture({ holdHttp: cb => { reply = cb } }), e = entry(f)
  const pending = f.dsh.recoverProfileWindow(e)
  await waitFor(() => reply)
  e.window.destroy(); reply()
  await pending
  assert.deepEqual(f.killed, [100])
  assert.equal(e.process, null)
})
test('recovery timeout cleans up child before closing window', async () => {
  const f = fixture({ timeout: true, ready: () => false }), e = entry(f)
  await f.dsh.recoverProfileWindow(e)
  assert.deepEqual(f.killed, [100])
  assert.equal(e.process, null)
  assert.equal(e.window.isDestroyed(), true)
})
test('concurrent production open calls create one window and one process', async () => {
  const f = fixture()
  await Promise.all([f.dsh.openProfileWindow('coding'), f.dsh.openProfileWindow('coding'), f.dsh.openProfileWindow('coding')])
  assert.equal(f.children.length, 1)
  assert.equal(f.dsh.getExtraDshWindows().length, 1)
  await f.dsh.closeAllProfileWindows()
  assert.deepEqual(f.killed, [100])
})
test('primary spawn error rejects and cleans up rather than escaping as an unhandled error', async () => {
  const f = fixture({ spawnError: true, ready: () => false })
  await assert.rejects(f.dsh.startDsh(), error => error.kind === 'spawn-failed')
  assert.deepEqual(f.killed, [100])
})
test('profile failure cleans up before rollback starts the previous profile', async () => {
  const f = fixture({ spawnError: true, ready: count => count >= 2 })
  await f.dsh.switchProfile('coding')
  assert.equal(f.settings.profile, 'web')
  assert.deepEqual(f.events, ['spawn', 'kill', 'spawn'])
  await f.dsh.stopOwnedDsh()
})
test('attached external service is never killed', async () => {
  const f = fixture()
  assert.equal(await f.dsh.startDsh(), 'attached')
  await f.dsh.stopOwnedDsh()
  assert.equal(f.children.length, 0)
  assert.equal(f.killed.length, 0)
})
test('quitting during command discovery cancels primary launch', async () => {
  const f = fixture({ holdLookup: true, ready: () => false })
  const pending = f.dsh.startDsh()
  await waitFor(() => f.lookupCallbacks.length)
  f.dsh.setDshQuitting(true)
  f.lookupCallbacks[0](null, { stdout: 'dsh.cmd' })
  await assert.rejects(pending, /errorCancelled/)
  assert.equal(f.children.length, 0)
})

test('shutdown waits for process cleanup of an already detached window', async () => {
  let finishKill
  const f = fixture({ holdKill: cb => { finishKill = cb } })
  await f.dsh.openProfileWindow('coding')
  f.dsh.getExtraDshWindows()[0].window.destroy()
  assert.equal(f.dsh.getExtraDshWindows().length, 0)
  let finished = false
  const closing = f.dsh.closeAllProfileWindows().then(() => { finished = true })
  await tick()
  assert.equal(finished, false)
  finishKill()
  await closing
  assert.equal(finished, true)
  assert.deepEqual(f.killed, [100])
})

test('primary startup uses the split launch token and clears it after stopping', async () => {
  const f = fixture({
    output(child, count) {
      child.stdout.write('dsh web: http://127.0.0.1:3080/?tok')
      child.stdout.write(`en=launch-${count}\r\n`)
    },
    http(url, count) {
      if (url.includes(`token=launch-${count}`)) return { statusCode: 303, headers: { location: '/' } }
      return count ? { statusCode: 401 } : null
    },
  })
  await f.dsh.attemptStartup()
  assert.deepEqual(f.loadedUrls, ['http://127.0.0.1:3080/?token=launch-1'])
  await f.dsh.stopOwnedDsh()
  // A stopped instance must not leave its token on future URLs.
  assert.equal(f.dsh.primaryDshUrl(), 'http://127.0.0.1:3080')
  f.children[0].stdout.write('dsh web: http://127.0.0.1:3080/?token=stale\n')
  assert.equal(f.dsh.primaryDshUrl(), 'http://127.0.0.1:3080')
})

test('extra windows load their own token, including after process recovery', async () => {
  const f = fixture({
    output(child, count) { child.stdout.write(`dsh web: http://127.0.0.1:40000/?token=extra-${count}\n`) },
    http(url, count) { return url.includes(`token=extra-${count}`) ? { statusCode: 303, headers: { location: '/' } } : { statusCode: 401 } },
  })
  await f.dsh.openProfileWindow('coding')
  const e = f.dsh.getExtraDshWindows()[0]
  e.process = null // Simulate the exit handler before recovery.
  await f.dsh.recoverProfileWindow(e)
  assert.deepEqual(f.loadedUrls, ['http://127.0.0.1:40000/?token=extra-1', 'http://127.0.0.1:40000/?token=extra-2'])
  await f.dsh.closeAllProfileWindows()
})

test('401 external service gives actionable guidance without killing it or loading an error page', async () => {
  const f = fixture({ http: () => ({ statusCode: 401 }) })
  await assert.rejects(f.dsh.startDsh(), /errorExternalAuth/)
  assert.equal(f.killed.length, 0)
  assert.equal(f.loadedUrls.length, 0)
})

test('external service reuses an already authenticated desktop session', async () => {
  const f = fixture({ http: () => ({ statusCode: 401 }), authorizedSession: true })
  assert.equal(await f.dsh.startDsh(), 'attached')
  assert.equal(f.children.length, 0)
})

test('HTTP errors and unrelated redirects do not count as ready', async () => {
  for (const statusCode of [401, 403, 404, 500, 302, 303]) {
    const f = fixture({ http: () => ({ statusCode, headers: { location: 'https://example.com/' } }) })
    assert.equal(await f.dsh.isDshReady('http://127.0.0.1:3080/?token=test'), false)
  }
})
