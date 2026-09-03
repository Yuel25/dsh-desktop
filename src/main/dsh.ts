import { app, dialog } from 'electron'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { get } from 'node:http'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { getSettings, saveSettings } from './config.js'
import { t } from './i18n.js'
import { createRotatingLogStream, safeCloseStream, writeRecoveryLog } from './logging.js'
import { createDshLaunchReader, redactDshToken } from './dsh-auth.js'
import {
  createCancellationToken,
  DEFAULT_DSH_PORT,
  DEFAULT_PROFILE,
  DSH_HOST,
  DshError,
  MAX_RECOVERY_ATTEMPTS,
  type CancellationToken,
  type ExtraDshWindow,
  type Guidance,
  type GuidanceMode,
} from './types.js'
import { notify } from './updater.js'
import {
  createAppWindow,
  getMainWindow,
  loadLocalPage,
  sendGuidance,
  sendStatus,
  sendStatusTo,
} from './windows.js'

const execFileAsync = promisify(execFile)

export function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}

let activeDshPort = DEFAULT_DSH_PORT
let dshProcess: ChildProcess | null = null
let dshStartupError: Error | null = null
let dshReady = false
let quitting = false
let recoveringDsh = false
let switchingProfile = false
let startingPrimary = false
let cachedDshVersion: string | null = null
let primaryLaunchUrl: string | null = null

const extraDshWindows: ExtraDshWindow[] = []
const openingProfiles = new Map<string, Promise<void>>()
const stoppingProfiles = new Set<Promise<void>>()
let onStateChangeHook: (() => void) | null = null

export function setOnStateChange(hook: () => void): void {
  onStateChangeHook = hook
}

function notifyStateChange(): void {
  if (onStateChangeHook) onStateChangeHook()
}

export function setDshQuitting(isQuitting: boolean): void {
  quitting = isQuitting
}

export function getActiveDshPort(): number {
  return activeDshPort
}

export function setActiveDshPort(port: number): void {
  if (port !== activeDshPort) primaryLaunchUrl = null
  activeDshPort = port
}

export function primaryDshUrl(): string {
  return primaryLaunchUrl ?? `http://${DSH_HOST}:${activeDshPort}`
}

export function isDshReadyState(): boolean {
  return dshReady
}

export function getExtraDshWindows(): ExtraDshWindow[] {
  return extraDshWindows
}

export function clearCachedDshVersion(): void {
  cachedDshVersion = null
}

export function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const request = get(`http://${DSH_HOST}:${port}`, { timeout: 1_000 }, (response) => {
      response.resume()
      resolve(true)
    })
    request.on('error', () => resolve(false))
    request.on('timeout', () => {
      request.destroy()
      resolve(false)
    })
  })
}

function dshHttpStatus(url: string): Promise<number> {
  return new Promise((resolve) => {
    const request = get(url, { timeout: 1_000 }, (response) => {
      response.resume()
      const status = response.statusCode ?? 500
      // Only the documented same-origin launch-token exchange is a ready redirect.
      resolve(status === 303 && (response.headers.location !== '/' || !new URL(url).searchParams.has('token')) ? 500 : status)
    })
    request.on('error', () => resolve(0))
    request.on('timeout', () => {
      request.destroy()
      resolve(0)
    })
  })
}

export async function isDshReady(url: string): Promise<boolean> {
  const status = await dshHttpStatus(url)
  return (status >= 200 && status < 300) || status === 303
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, DSH_HOST, () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : null
      server.close(() => (port ? resolve(port) : reject(new Error('No free port available.'))))
    })
  })
}

export function killProcessTree(pid: number | undefined): Promise<void> {
  if (!pid) return Promise.resolve()
  return execFileAsync('taskkill.exe', ['/pid', String(pid), '/t', '/f'], { windowsHide: true })
    .then(() => undefined)
    .catch(() => {
      // The process may already have exited.
    })
}

function quoteCmdArgument(argument: string): string {
  if (!/[\s"]/.test(argument)) return argument
  return `"${argument.replace(/"/g, '""')}"`
}

function dshArgsFor(profile: string, port: number): string[] {
  return ['--profile', profile, '--port', String(port), '--no-open']
}

export type DshLaunchPlan =
  | { available: true; command: string; args: string[] }
  | { available: false; reason: string }

export async function resolveDshLaunch(profile: string, port: number): Promise<DshLaunchPlan> {
  const dshArgs = dshArgsFor(profile, port)
  const powershellLauncher = process.env.APPDATA ? join(process.env.APPDATA, 'npm', 'dsh.ps1') : null
  if (powershellLauncher && existsSync(powershellLauncher)) {
    return {
      available: true,
      command: 'powershell.exe',
      args: [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        powershellLauncher,
        ...dshArgs,
      ],
    }
  }

  const cmdLauncher = process.env.APPDATA ? join(process.env.APPDATA, 'npm', 'dsh.cmd') : null
  if (cmdLauncher && existsSync(cmdLauncher)) {
    const quoted = dshArgs.map(quoteCmdArgument)
    return {
      available: true,
      command: process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/c', `"${cmdLauncher}" ${quoted.join(' ')}`],
    }
  }

  try {
    const { stdout } = await execFileAsync('where.exe', ['dsh'], { windowsHide: true, timeout: 5_000 })
    if (stdout.trim().length > 0) {
      const quoted = dshArgs.map(quoteCmdArgument)
      return {
        available: true,
        command: process.env.ComSpec || 'cmd.exe',
        args: ['/d', '/c', `dsh ${quoted.join(' ')}`],
      }
    }
  } catch {
    // where.exe returned non-zero
  }

  return { available: false, reason: t('statusDshMissing') }
}

async function listeningPid(port: number): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync('netstat.exe', ['-ano', '-p', 'tcp'], { timeout: 5_000, windowsHide: true })
    for (const line of stdout.split('\n')) {
      const match = line.trim().match(/^TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)$/)
      if (match && Number(match[1]) === port) return Number(match[2])
    }
  } catch {
    // netstat unavailable
  }
  return null
}

async function processCommandLine(pid: number): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
      ],
      { timeout: 5_000, windowsHide: true },
    )
    return stdout.trim() || null
  } catch {
    return null
  }
}

function profileFromCommandLine(commandLine: string): string | null {
  if (!/\bdsh(\.cmd|\.ps1|\.exe)?\b/i.test(commandLine)) return null
  const flagged = commandLine.match(/--profile[= ]"?([^\s"]+)"?/i)
  return flagged ? flagged[1] : DEFAULT_PROFILE
}

async function runningDshProfile(port: number): Promise<string | null> {
  const pid = await listeningPid(port)
  if (!pid) return null
  const commandLine = await processCommandLine(pid)
  if (!commandLine) return null
  return profileFromCommandLine(commandLine)
}

export async function dshVersion(): Promise<string> {
  if (cachedDshVersion !== null) return cachedDshVersion
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', 'dsh --version'],
      { timeout: 15_000, windowsHide: true },
    )
    cachedDshVersion = stdout.trim()
  } catch {
    cachedDshVersion = ''
  }
  return cachedDshVersion
}

async function waitUntilReady(
  getUrl: () => string,
  timeoutMs: number,
  child: ChildProcess | null,
  cancelToken?: CancellationToken,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (cancelToken?.isCancelled || quitting) {
      throw new DshError('generic', t('errorCancelled'))
    }
    if (await isDshReady(getUrl())) return
    if (dshStartupError) throw dshStartupError
    if (child && child.exitCode !== null) {
      throw new DshError('exited-early', t('errorExitedEarly', child.exitCode ?? '?'), child.exitCode)
    }
    await delay(500)
  }
  throw new DshError('timeout', t('errorNotReadyTimeout', timeoutMs / 1_000))
}

export async function startDsh(cancelToken?: CancellationToken): Promise<'attached' | 'started'> {
  dshStartupError = null
  const url = `http://${DSH_HOST}:${activeDshPort}`
  const settings = getSettings()
  const mainWindow = getMainWindow()

  if (await canConnect(activeDshPort)) {
    const runningProfile = await runningDshProfile(activeDshPort)
    if (runningProfile && runningProfile !== settings.profile && mainWindow && !mainWindow.isDestroyed()) {
      const choice = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: t('dialogProfileMismatchTitle'),
        message: t('dialogProfileMismatchMessage', activeDshPort, runningProfile, settings.profile),
        detail: t('dialogProfileMismatchDetail'),
        buttons: [t('dialogAttach'), t('dialogCancel')],
        defaultId: 0,
        cancelId: 1,
      })
      if (choice.response === 1) {
        throw new Error(t('errorAttachCancelled', runningProfile))
      }
    }
    sendStatus(
      runningProfile ? t('statusConnectingExisting', runningProfile) : t('statusConnectingUnknown'),
    )
    if (await dshHttpStatus(url) === 401) {
      // Reuse a browser session previously authorized by this desktop client.
      const authorized = mainWindow && !mainWindow.isDestroyed()
        ? await mainWindow.webContents.session.fetch(url, {
          method: 'HEAD', redirect: 'error', signal: AbortSignal.timeout(5000),
        }).then(response => response.ok).catch(() => false)
        : false
      if (!authorized) throw new DshError('generic', t('errorExternalAuth', activeDshPort))
      primaryLaunchUrl = null
    } else {
      await waitUntilReady(() => url, 15_000, null, cancelToken)
    }
    return 'attached'
  }

  const plan = await resolveDshLaunch(settings.profile, activeDshPort)
  if (cancelToken?.isCancelled || quitting) throw new DshError('generic', t('errorCancelled'))
  if (!plan.available) {
    throw new DshError('not-installed', plan.reason)
  }

  sendStatus(t('statusStarting'))
  const stdout = createRotatingLogStream('dsh.stdout.log')
  const stderr = createRotatingLogStream('dsh.stderr.log')

  stdout.on('error', (err: Error) => writeRecoveryLog(`Primary DSH stdout stream error: ${err.message}`))
  stderr.on('error', (err: Error) => writeRecoveryLog(`Primary DSH stderr stream error: ${err.message}`))

  dshStartupError = null
  primaryLaunchUrl = null
  const child = spawn(plan.command, plan.args, {
    env: process.env,
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  dshProcess = child

  child.stdout?.on('data', createDshLaunchReader(activeDshPort, (launchUrl) => {
    if (dshProcess === child) primaryLaunchUrl = launchUrl
  }))

  child.stdout?.pipe(stdout)
  child.stderr?.pipe(stderr)

  child.once('error', (error) => {
    if (dshProcess !== child) return
    dshStartupError = new DshError('spawn-failed', `Failed to start DSH: ${error.message}`)
    try {
      stderr.write(`Failed to start DSH: ${error.stack ?? error.message}\n`)
    } catch {
      // ignore
    }
  })

  child.once('exit', (code) => {
    safeCloseStream(stdout)
    safeCloseStream(stderr)
    const shouldRecover = dshReady && !quitting && dshProcess === child
    if (dshProcess === child) {
      dshProcess = null
      dshReady = false
    }
    if (shouldRecover && code !== 0 && !dshStartupError) {
      dshStartupError = new DshError('exited-early', t('errorExitedEarly', code ?? 'unknown'), code)
    }
    if (shouldRecover) void recoverDsh()
  })

  try {
    await waitUntilReady(primaryDshUrl, 60_000, child, cancelToken)
    if (cancelToken?.isCancelled || quitting) throw new DshError('generic', t('errorCancelled'))
    dshReady = true
    return 'started'
  } catch (error) {
    const pid = child.pid
    if (dshProcess === child) {
      dshProcess = null
      dshReady = false
    }
    child.stdout?.unpipe(stdout)
    child.stderr?.unpipe(stderr)
    safeCloseStream(stdout)
    safeCloseStream(stderr)
    await killProcessTree(pid)
    throw error
  }
}

export async function stopOwnedDsh(): Promise<void> {
  dshReady = false
  primaryLaunchUrl = null
  const pid = dshProcess?.pid
  dshProcess = null
  await killProcessTree(pid)
}

export async function recoverDsh(): Promise<void> {
  const mainWindow = getMainWindow()
  if (recoveringDsh || quitting) return
  recoveringDsh = true
  try {
    await loadLocalPage(mainWindow, 'index.html')
    for (let attempt = 1; attempt <= MAX_RECOVERY_ATTEMPTS && !quitting; attempt += 1) {
      sendStatus(t('statusRecovering', attempt, MAX_RECOVERY_ATTEMPTS))
      await delay(attempt * 1_000)
      try {
        await startDsh()
        if (!mainWindow || mainWindow.isDestroyed()) return
        sendStatus(t('statusReady'))
        await mainWindow.loadURL(primaryDshUrl())
        notify(t('notifyRecoveredTitle'), t('statusReady'))
        return
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        writeRecoveryLog(`DSH recovery attempt ${attempt} failed: ${message}`)
      }
    }
    if (!quitting && mainWindow && !mainWindow.isDestroyed()) {
      await dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: t('dialogRecoveryFailedTitle'),
        message: t('dialogRecoveryFailedMessage', MAX_RECOVERY_ATTEMPTS),
        detail: t('dialogLogsDetail', app.getPath('logs')),
      })
    }
  } finally {
    recoveringDsh = false
  }
}

export async function switchProfile(name: string): Promise<void> {
  const settings = getSettings()
  const mainWindow = getMainWindow()
  if (name === settings.profile || quitting || recoveringDsh || switchingProfile || startingPrimary) return
  switchingProfile = true
  const previousProfile = settings.profile

  try {
    settings.profile = name
    saveSettings()
    notifyStateChange()
    sendStatus(t('statusSwitching', name))
    if (mainWindow && !mainWindow.isDestroyed()) await loadLocalPage(mainWindow, 'index.html')
    await stopOwnedDsh()

    if (await canConnect(activeDshPort)) {
      settings.profile = previousProfile
      saveSettings()
      notifyStateChange()
      sendStatus(t('statusPortBusy', activeDshPort))
      if (mainWindow && !mainWindow.isDestroyed()) {
        await dialog.showMessageBox(mainWindow, {
          type: 'warning',
          title: t('dialogSwitchBlockedTitle'),
          message: t('dialogSwitchBlockedMessage', activeDshPort),
          detail: t('dialogSwitchBlockedDetail', previousProfile),
        })
        await mainWindow.loadURL(primaryDshUrl())
      }
      return
    }

    try {
      await startDsh()
      dshReady = true
      sendStatus(t('statusReadyProfile', name))
      if (mainWindow && !mainWindow.isDestroyed()) await mainWindow.loadURL(primaryDshUrl())
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      writeRecoveryLog(`Switch to profile "${name}" failed: ${message}`)
      await stopOwnedDsh()
      settings.profile = previousProfile
      saveSettings()
      notifyStateChange()

      let restored = false
      try {
        sendStatus(t('statusSwitchFailedRestore', previousProfile))
        await startDsh()
        dshReady = true
        restored = true
      } catch (restoreError) {
        const restoreMessage = restoreError instanceof Error ? restoreError.message : String(restoreError)
        writeRecoveryLog(`Restoring profile "${previousProfile}" failed: ${restoreMessage}`)
        await stopOwnedDsh()
        sendStatus(t('statusSwitchFailedRestoreFail', restoreMessage))
      }
      if (restored && mainWindow && !mainWindow.isDestroyed()) await mainWindow.loadURL(primaryDshUrl())
      if (mainWindow && !mainWindow.isDestroyed()) {
        await dialog.showMessageBox(mainWindow, {
          type: 'error',
          title: t('dialogSwitchFailedTitle'),
          message: t('dialogSwitchFailedMessage', name, message),
          detail: restored
            ? t('dialogSwitchFailedRestored', previousProfile)
            : t('dialogSwitchFailedRestoreFail', app.getPath('logs')),
        })
      }
    }
  } finally {
    switchingProfile = false
    notifyStateChange()
  }
}

export function looksLikeDshMissing(message: string): boolean {
  return /ENOENT|not recognized|not found|无法找到|找不到|不是内部或外部命令/i.test(message)
}

export async function attemptStartup(): Promise<void> {
  const mainWindow = getMainWindow()
  if (startingPrimary || quitting) return
  startingPrimary = true
  try {
    sendGuidance(null)
    await startDsh()
    dshReady = true
    sendStatus(t('statusReady'))
    if (mainWindow && !mainWindow.isDestroyed()) await mainWindow.loadURL(primaryDshUrl())
  } catch (error) {
    const message = redactDshToken(error instanceof Error ? error.message : String(error))
    writeRecoveryLog(`Startup failed: ${message}`)
    const isMissing = error instanceof DshError ? error.kind === 'not-installed' : looksLikeDshMissing(message)
    const mode: GuidanceMode = isMissing ? 'dsh-missing' : 'start-failed'
    sendStatus(mode === 'dsh-missing' ? t('statusDshMissing') : message)
    sendGuidance({ mode, message })
  } finally {
    startingPrimary = false
    notifyStateChange()
  }
}

export function spawnExtraProcess(entry: ExtraDshWindow, plan: { command: string; args: string[] }): void {
  assertExtraActive(entry)
  const { profile } = entry
  safeCloseStream(entry.stdoutStream)
  safeCloseStream(entry.stderrStream)

  const stdout = createRotatingLogStream(`dsh.${profile}.stdout.log`)
  const stderr = createRotatingLogStream(`dsh.${profile}.stderr.log`)
  entry.stdoutStream = stdout
  entry.stderrStream = stderr

  stdout.on('error', (err: Error) => writeRecoveryLog(`Profile "${profile}" stdout stream error: ${err.message}`))
  stderr.on('error', (err: Error) => writeRecoveryLog(`Profile "${profile}" stderr stream error: ${err.message}`))

  entry.startupError = null
  entry.ready = false
  entry.url = `http://${DSH_HOST}:${entry.port}`
  const child = spawn(plan.command, plan.args, {
    env: process.env,
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  entry.process = child

  child.stdout?.on('data', createDshLaunchReader(entry.port, (launchUrl) => {
    if (entry.process === child) entry.url = launchUrl
  }))

  child.stdout?.pipe(stdout)
  child.stderr?.pipe(stderr)

  child.once('error', (error) => {
    if (entry.process !== child) return
    entry.startupError = new DshError('spawn-failed', `Failed to start profile "${profile}": ${error.message}`)
    try {
      stderr.write(`Failed to start profile "${profile}": ${error.stack ?? error.message}\n`)
    } catch {
      // ignore
    }
  })

  child.once('exit', (code) => {
    safeCloseStream(stdout)
    safeCloseStream(stderr)
    if (quitting || entry.window.isDestroyed() || entry.process !== child) return
    const shouldRecover = entry.ready
    entry.ready = false
    entry.process = null
    if (code !== 0 && !entry.startupError) {
      entry.startupError = new DshError('exited-early', t('errorExitedEarly', code ?? 'unknown'), code)
    }
    if (!shouldRecover) return
    entry.recoveryAttempts += 1
    if (entry.recoveryAttempts <= MAX_RECOVERY_ATTEMPTS) {
      writeRecoveryLog(`Profile window "${profile}" exited; recovery attempt ${entry.recoveryAttempts}.`)
      void recoverProfileWindow(entry)
    } else {
      notify(t('notifyRecoverFailedTitle'), `${profile}: ${t('dialogRecoveryFailedMessage', MAX_RECOVERY_ATTEMPTS)}`)
      entry.window.destroy()
    }
  })
}

export async function openProfileWindow(profile: string): Promise<void> {
  if (quitting) throw new DshError('generic', t('errorCancelled'))
  const settings = getSettings()
  const mainWindow = getMainWindow()
  const existing = extraDshWindows.find((entry) => entry.profile === profile)
  if (existing) {
    if (!existing.window.isDestroyed()) {
      existing.window.show()
      existing.window.focus()
    }
    return
  }
  if (profile === settings.profile && dshReady) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show()
      mainWindow.focus()
    }
    return
  }

  const inFlight = openingProfiles.get(profile)
  if (inFlight) {
    return inFlight
  }

  const openPromise = (async () => {
    const port = await freePort()
    if (quitting) throw new DshError('generic', t('errorCancelled'))
    const url = `http://${DSH_HOST}:${port}`
    const window = createAppWindow({
      title: `dsh-desktop · ${profile}`,
      getAllowedPort: () => port,
    })
    window.once('ready-to-show', () => {
      if (!window.isDestroyed()) window.show()
    })
    const entry: ExtraDshWindow = {
      profile,
      port,
      url,
      process: null,
      window,
      recoveryAttempts: 0,
      startupError: null,
    }
    extraDshWindows.push(entry)

    const cancelSource = createCancellationToken()

    const detach = (): void => {
      cancelSource.cancel()
      const index = extraDshWindows.indexOf(entry)
      if (index >= 0) extraDshWindows.splice(index, 1)
      void stopExtraProcess(entry)
    }
    window.once('closed', detach)

    try {
      await loadLocalPage(window, 'index.html')
      if (window.isDestroyed() || cancelSource.token.isCancelled) return
      sendStatusTo(window, t('statusStartingProfile', profile))
      const plan = await resolveDshLaunch(profile, entry.port)
      assertExtraActive(entry, cancelSource.token)
      if (!plan.available) {
        throw new DshError('not-installed', plan.reason)
      }
      spawnExtraProcess(entry, plan)
      await waitUntilReadyFor(60_000, entry, cancelSource.token)
      assertExtraActive(entry, cancelSource.token)
      entry.ready = true
      sendStatusTo(window, t('statusReadyProfile', profile))
      await window.loadURL(entry.url)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      writeRecoveryLog(`Opening profile window "${profile}" failed: ${message}`)
      await stopExtraProcess(entry)
      if (!window.isDestroyed()) window.destroy()
      else detach()
      throw error
    }
  })()

  openingProfiles.set(profile, openPromise)
  try {
    await openPromise
  } finally {
    openingProfiles.delete(profile)
  }
}

export async function recoverProfileWindow(entry: ExtraDshWindow): Promise<void> {
  const { window, profile } = entry
  if (window.isDestroyed() || quitting || entry.recovering) return
  entry.recovering = true
  try {
    await loadLocalPage(window, 'index.html')
    assertExtraActive(entry)
    sendStatusTo(window, t('statusStartingProfile', profile))
    const plan = await resolveDshLaunch(profile, entry.port)
    assertExtraActive(entry)
    if (!plan.available) {
      throw new DshError('not-installed', plan.reason)
    }
    spawnExtraProcess(entry, plan)
    await waitUntilReadyFor(60_000, entry)
    assertExtraActive(entry)
    await window.loadURL(entry.url)
    entry.ready = true
    entry.recoveryAttempts = 0
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    writeRecoveryLog(`Recovering profile window "${profile}" failed: ${message}`)
    await stopExtraProcess(entry)
    if (!window.isDestroyed()) window.destroy()
  } finally {
    entry.recovering = false
  }
}

function assertExtraActive(entry: ExtraDshWindow, token?: CancellationToken): void {
  if (quitting || entry.window.isDestroyed() || token?.isCancelled) {
    throw new DshError('generic', t('errorCancelled'))
  }
}

async function stopExtraProcess(entry: ExtraDshWindow): Promise<void> {
  const child = entry.process
  entry.process = null
  entry.ready = false
  child?.stdout?.unpipe(entry.stdoutStream)
  child?.stderr?.unpipe(entry.stderrStream)
  safeCloseStream(entry.stdoutStream)
  safeCloseStream(entry.stderrStream)
  if (!child?.pid) return
  const stopping = killProcessTree(child.pid)
  stoppingProfiles.add(stopping)
  try {
    await stopping
  } finally {
    stoppingProfiles.delete(stopping)
  }
}

async function waitUntilReadyFor(
  timeoutMs: number,
  entry: ExtraDshWindow,
  cancelToken?: CancellationToken,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (cancelToken?.isCancelled || quitting || entry.window.isDestroyed()) {
      throw new DshError('generic', t('errorCancelled'))
    }
    if (await isDshReady(entry.url)) return
    if (entry.startupError) throw entry.startupError
    if (entry.process && entry.process.exitCode !== null) {
      throw new DshError('exited-early', t('errorExitedEarly', entry.process.exitCode ?? '?'), entry.process.exitCode)
    }
    await delay(500)
  }
  throw new DshError('timeout', t('errorNotReadyTimeout', timeoutMs / 1_000))
}

export async function closeAllProfileWindows(): Promise<void> {
  for (const entry of [...extraDshWindows]) {
    const stopping = stopExtraProcess(entry)
    if (!entry.window.isDestroyed()) entry.window.destroy()
    await stopping
  }
  extraDshWindows.length = 0
  // Closed windows are already detached from the list, but their taskkill may
  // still be running. Do not exit the application before those calls finish.
  await Promise.all([...stoppingProfiles])
}
