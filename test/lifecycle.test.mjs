import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadMain } from './load-main.mjs'
const tick = () => new Promise(resolve => setImmediate(resolve))
function fixture(options = {}) {
  const children = [], killed = [], windows = [], events = [], lookupCallbacks = [], loadedUrls = [], spawns = []
  const dialogs = [], notifications = []
  const windowLaunchStates = new Map()
  const settings = { profile: 'web', port: 3080 }
  let port = 40000, now = 0
  let nextWinId = 1
  function window() {
    const w = new EventEmitter()
    let destroyed = false
    const id = nextWinId++
    Object.assign(w, {
      id,
      isDestroyed: () => destroyed, show() {}, focus() {},
      destroy() { if (!destroyed) { destroyed = true; w.emit('closed') } },
      loadURL: async url => { loadedUrls.push(url) },
      webContents: { session: { fetch: async () => ({ ok: options.authorizedSession ?? false }) } },
    })
    w.on('closed', () => { windowLaunchStates.delete(id) })
    windows.push(w)
    return w
  }
  const main = window()
  const pendingTimers = []
  let timerId = 0
  const customSetTimeout = (cb, ms) => {
    if (options.manualTimers && ms >= 30000) {
      const id = ++timerId
      pendingTimers.push({ id, cb, ms: Number(ms) })
      return id
    }
    return setImmediate(cb)
  }
  const customClearTimeout = (id) => {
    const idx = pendingTimers.findIndex(t => t.id === id)
    if (idx >= 0) pendingTimers.splice(idx, 1)
  }
  const advanceTimers = (ms) => {
    const ready = pendingTimers.filter(t => t.ms <= ms)
    for (const t of ready) {
      const idx = pendingTimers.indexOf(t)
      if (idx >= 0) pendingTimers.splice(idx, 1)
      t.cb()
    }
  }

  const dsh = loadMain('dsh', {
    electron: {
      app: { getPath: () => '/fake' },
      dialog: { showMessageBox: async (_win, opts) => { dialogs.push(opts); return { response: 0 } } },
    },
    './config.js': { getSettings: () => settings, saveSettings() {} },
    './i18n.js': { t: (key, ...args) => `${key}:${args.join(',')}` },
    './updater.js': { notify(title, message) { notifications.push({ title, message }) } },
    './logging.js': {
      createRotatingLogStream: () => new Writable({ write(_chunk, _encoding, cb) { cb() } }),
      safeCloseStream(s) { if (s && !s.writableEnded) s.end() }, writeRecoveryLog() {},
    },
    './windows.js': {
      createAppWindow: window,
      getMainWindow: () => main,
      loadLocalPage: async () => {},
      sendStatus(msg) {
        let st = windowLaunchStates.get(main.id)
        if (!st) { st = { status: null, guidance: null, version: 0 }; windowLaunchStates.set(main.id, st) }
        st.status = msg; st.version++
      },
      sendStatusTo(w, msg) {
        let st = windowLaunchStates.get(w.id)
        if (!st) { st = { status: null, guidance: null, version: 0 }; windowLaunchStates.set(w.id, st) }
        st.status = msg; st.version++
      },
      sendGuidance(g) {
        let st = windowLaunchStates.get(main.id)
        if (!st) { st = { status: null, guidance: null, version: 0 }; windowLaunchStates.set(main.id, st) }
        st.guidance = g; st.version++
      },
      sendGuidanceTo(w, g) {
        let st = windowLaunchStates.get(w.id)
        if (!st) { st = { status: null, guidance: null, version: 0 }; windowLaunchStates.set(w.id, st) }
        st.guidance = g; st.version++
      },
      getWindowLaunchState(w) {
        const st = windowLaunchStates.get(w.id)
        return st ? { status: st.status, guidance: st.guidance, version: st.version } : { status: null, guidance: null, version: 0 }
      },
      clearWindowLaunchState(w) {
        windowLaunchStates.delete(w.id)
      },
    },
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
        cb(null, { stdout: command === 'where.exe' ? (options.whereStdout !== undefined ? options.whereStdout : 'dsh.cmd') : '' })
      },
      spawn(cmd, spawnArgs, spawnOptions) {
        const child = new EventEmitter()
        spawns.push({ cmd, args: spawnArgs, options: spawnOptions })
        Object.assign(child, { pid: 100 + children.length, exitCode: null, stdout: new PassThrough(), stderr: new PassThrough() })
        child.on('exit', (code) => { child.exitCode = code ?? 0 })
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
    setTimeout: customSetTimeout,
    clearTimeout: customClearTimeout,
    Date: { now: () => (now += options.timeout ? 20000 : 1) },
  })
  return { dsh, children, killed, windows, window, events, settings, lookupCallbacks, loadedUrls, spawns, dialogs, notifications, windowLaunchStates, advanceTimers, pendingTimers }
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

test('invalid profile names in resolveDshLaunch, switchProfile, and openProfileWindow are rejected without spawning', async () => {
  const dangerousProfiles = ['web&calc.exe', 'foo%TEMP%', 'foo!PATH!', 'foo|bar', 'foo"bar', 'foo^bar', 'foo;dir']
  const f = fixture()

  for (const name of dangerousProfiles) {
    await assert.rejects(f.dsh.resolveDshLaunch(name, 3080), /errorInvalidProfile/)
    await assert.rejects(f.dsh.switchProfile(name), /errorInvalidProfile/)
    await assert.rejects(f.dsh.openProfileWindow(name), /errorInvalidProfile/)
  }
  assert.equal(f.children.length, 0)
  assert.equal(f.spawns.length, 0)
})

test('resolveDshLaunch selects powershell launcher when ps1 candidate is found', async () => {
  const f = fixture({ whereStdout: 'C:\\tools\\dsh.ps1\r\nC:\\tools\\dsh.cmd' })
  const plan = await f.dsh.resolveDshLaunch('coding', 3080)
  assert.equal(plan.available, true)
  assert.equal(plan.command, 'powershell.exe')
  assert.ok(plan.args.includes('-File'))
  assert.ok(plan.args.includes('C:\\tools\\dsh.ps1'))
  assert.ok(plan.args.includes('coding'))
})

test('resolveDshLaunch executes directly without shell when .exe candidate is found', async () => {
  const f = fixture({ whereStdout: 'C:\\Program Files\\dsh\\dsh.exe' })
  const plan = await f.dsh.resolveDshLaunch('coding', 3080)
  assert.equal(plan.available, true)
  assert.equal(plan.command, 'C:\\Program Files\\dsh\\dsh.exe')
  assert.deepEqual([...plan.args], ['--profile', 'coding', '--port', '3080', '--no-open'])
})

test('resolveDshLaunch safely quotes and targets resolved .cmd candidate', async () => {
  const f = fixture({ whereStdout: 'C:\\npm\\dsh.cmd' })
  const plan = await f.dsh.resolveDshLaunch('my profile', 3080)
  assert.equal(plan.available, true)
  assert.ok(plan.command.toLowerCase().includes('cmd'))
  assert.ok(plan.args.includes('/d'))
  assert.ok(plan.args.includes('/s'))
  assert.ok(plan.args.includes('/c'))
  const cmdLine = plan.args[plan.args.length - 1]
  assert.ok(cmdLine.includes('"C:\\npm\\dsh.cmd"'))
  assert.ok(cmdLine.includes('"my profile"'))
})

test('valid unicode and space-containing profile names launch correctly', async () => {
  const f = fixture({ whereStdout: 'C:\\npm\\dsh.cmd' })
  const plan = await f.dsh.resolveDshLaunch('开发环境', 3080)
  assert.equal(plan.available, true)
  const cmdLine = plan.args[plan.args.length - 1]
  assert.ok(cmdLine.includes('开发环境'))
})

test('primary DSH crash recovery respects MAX_RECOVERY_ATTEMPTS and stops after 3 attempts', async () => {
  let f
  f = fixture({ manualTimers: true, ready: () => f.children.some(c => c.exitCode === null) })
  await f.dsh.attemptStartup()
  assert.equal(f.children.length, 1)

  // Crash 1 -> recovery attempt 1
  f.children[0].emit('exit', 1)
  await waitFor(() => f.children.length === 2 && f.pendingTimers.length === 1)
  assert.equal(f.dsh.getPrimaryRecoveryAttempts(), 1)

  // Crash 2 -> recovery attempt 2
  f.children[1].emit('exit', 1)
  await waitFor(() => f.children.length === 3 && f.pendingTimers.length === 1)
  assert.equal(f.dsh.getPrimaryRecoveryAttempts(), 2)

  // Crash 3 -> recovery attempt 3
  f.children[2].emit('exit', 1)
  await waitFor(() => f.children.length === 4 && f.pendingTimers.length === 1)
  assert.equal(f.dsh.getPrimaryRecoveryAttempts(), 3)

  // Crash 4 -> reaches limit (attempts = 4 > 3), stops recovery, shows dialog
  f.children[3].emit('exit', 1)
  await tick()
  await tick()
  assert.equal(f.children.length, 4)
  assert.equal(f.dialogs.length, 1)
  assert.ok(f.dialogs[0].message.includes('3'))
  await f.dsh.stopOwnedDsh()
})

test('primary DSH running stably for 30s resets recovery attempt count to 0', async () => {
  let f
  f = fixture({ manualTimers: true, ready: () => f.children.some(c => c.exitCode === null) })
  await f.dsh.attemptStartup()
  assert.equal(f.children.length, 1)

  // Crash 1 -> recovery 1
  f.children[0].emit('exit', 1)
  await waitFor(() => f.children.length === 2 && f.pendingTimers.length === 1)
  assert.equal(f.dsh.getPrimaryRecoveryAttempts(), 1)

  // Simulate running stably for 30 seconds
  assert.equal(f.pendingTimers.length, 1)
  assert.equal(f.pendingTimers[0].ms, 30000)
  f.advanceTimers(30000)
  assert.equal(f.dsh.getPrimaryRecoveryAttempts(), 0)

  // Next crash should start from attempt 1 again, not attempt 2
  f.children[1].emit('exit', 1)
  await waitFor(() => f.children.length === 3 && f.pendingTimers.length === 1)
  assert.equal(f.dsh.getPrimaryRecoveryAttempts(), 1)

  await f.dsh.stopOwnedDsh()
  assert.equal(f.dsh.getPrimaryRecoveryAttempts(), 0)
})

test('extra window crash recovery respects limit and 30s stability reset', async () => {
  const f = fixture({ manualTimers: true, ready: count => count > 0 })
  await f.dsh.openProfileWindow('coding')
  const entry = f.dsh.getExtraDshWindows()[0]
  assert.ok(entry)
  assert.equal(f.children.length, 1)

  // Crash 1 -> recovery 1
  f.children[0].emit('exit', 1)
  await waitFor(() => f.children.length === 2 && entry.ready)
  assert.equal(entry.recoveryAttempts, 1)

  // Advance 30s timer to reset recoveryAttempts
  assert.equal(f.pendingTimers.length, 1)
  assert.equal(f.pendingTimers[0].ms, 30000)
  f.advanceTimers(30000)
  assert.equal(entry.recoveryAttempts, 0)

  // Rapid crashes up to limit
  f.children[1].emit('exit', 1)
  await waitFor(() => f.children.length === 3 && entry.ready)
  assert.equal(entry.recoveryAttempts, 1)

  f.children[2].emit('exit', 1)
  await waitFor(() => f.children.length === 4 && entry.ready)
  assert.equal(entry.recoveryAttempts, 2)

  f.children[3].emit('exit', 1)
  await waitFor(() => f.children.length === 5 && entry.ready)
  assert.equal(entry.recoveryAttempts, 3)

  // 4th rapid crash exceeds limit -> window destroyed
  f.children[4].emit('exit', 1)
  await tick()
  await tick()
  assert.equal(entry.window.isDestroyed(), true)
  assert.equal(f.notifications.length, 1)
})

test('windows launch state tracks status and guidance snapshots, cleaned up on window close', async () => {
  let winId = 10
  class MockBrowserWindow extends EventEmitter {
    constructor() {
      super()
      this.id = winId++
      this.destroyed = false
      this.webContents = {
        send: (channel, ...args) => this.emit(`ipc:${channel}`, ...args)
      }
    }
    isDestroyed() { return this.destroyed }
    destroy() {
      if (!this.destroyed) {
        this.destroyed = true
        this.emit('closed')
      }
    }
    setMenuBarVisibility() {}
    setBackgroundColor() {}
    show() {}
  }
  const windowsModule = loadMain('windows', {
    electron: {
      app: { isPackaged: false, getAppPath: () => '/fake' },
      BrowserWindow: MockBrowserWindow,
    },
    './config.js': { getSettings: () => ({ frameColor: 'black' }) },
    './i18n.js': { t: (k) => k },
    './security.js': { attachRendererGuards() {} },
  })

  const appWin = windowsModule.createAppWindow({ title: 'test window' })
  const initial = windowsModule.getWindowLaunchState(appWin)
  assert.equal(initial.status, null)
  assert.equal(initial.guidance, null)
  assert.equal(initial.version, 0)

  windowsModule.sendStatusTo(appWin, 'Loading Profile...')
  const st1 = windowsModule.getWindowLaunchState(appWin)
  assert.equal(st1.status, 'Loading Profile...')
  assert.equal(st1.guidance, null)
  assert.equal(st1.version, 1)

  const guidance = { mode: 'start-failed', message: 'Failed to start' }
  windowsModule.sendGuidanceTo(appWin, guidance)
  const st2 = windowsModule.getWindowLaunchState(appWin)
  assert.equal(st2.status, 'Loading Profile...')
  assert.equal(st2.guidance?.mode, 'start-failed')
  assert.equal(st2.guidance?.message, 'Failed to start')
  assert.equal(st2.version, 2)

  appWin.destroy()
  const st3 = windowsModule.getWindowLaunchState(appWin)
  assert.equal(st3.status, null)
  assert.equal(st3.guidance, null)
  assert.equal(st3.version, 0)
})

test('resolved CMD launcher runs on Windows with spaces in path and profile', { skip: process.platform !== 'win32' }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh launcher '))
  const launcher = join(dir, 'dsh.cmd')
  writeFileSync(launcher, '@echo off\r\necho PROFILE=%~2\r\necho PORT=%~4\r\n')
  t.after(() => { unlinkSync(launcher); rmdirSync(dir) })
  const f = fixture({ whereStdout: launcher })
  for (const profile of ['web', 'my profile']) {
    const plan = await f.dsh.resolveDshLaunch(profile, 3080)
    const result = spawnSync(plan.command, plan.args, {
      windowsVerbatimArguments: plan.windowsVerbatimArguments,
      windowsHide: true, encoding: 'utf8', timeout: 5000,
    })
    assert.equal(result.status, 0, result.stderr || result.error?.message)
    assert.ok(result.stdout.includes(`PROFILE=${profile}`))
    assert.ok(result.stdout.includes('PORT=3080'))
  }
  await f.dsh.openProfileWindow('my profile')
  assert.equal(f.spawns[0].options.windowsVerbatimArguments, true)
  await f.dsh.closeAllProfileWindows()
})

test('primary recovery retries failed starts until the third attempt succeeds', async () => {
  let f
  f = fixture({ manualTimers: true, timeout: true,
    ready: () => [1, 4].includes(f.children.length) && f.children.at(-1).exitCode === null })
  await f.dsh.attemptStartup()
  f.children[0].emit('exit', 1)
  await waitFor(() => f.children.length === 4 && f.pendingTimers.length === 1)
  assert.equal(f.dialogs.length, 0)
  assert.equal(f.dsh.getPrimaryRecoveryAttempts(), 3)
  assert.deepEqual(f.killed, [101, 102])
  assert.equal(f.spawns[0].options.windowsVerbatimArguments, true)
  await f.dsh.stopOwnedDsh()
})

test('primary recovery stops after three failed starts and cleans each process', async () => {
  let f
  f = fixture({ manualTimers: true, timeout: true,
    ready: () => f.children.length === 1 && f.children[0].exitCode === null })
  await f.dsh.attemptStartup()
  f.children[0].emit('exit', 1)
  await waitFor(() => f.dialogs.length === 1)
  assert.equal(f.children.length, 4)
  assert.deepEqual(f.killed, [101, 102, 103])
  assert.equal(f.pendingTimers.length, 0)
  await f.dsh.stopOwnedDsh()
})
