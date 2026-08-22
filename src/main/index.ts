import { execFile, spawn, type ChildProcess } from 'node:child_process'
import {
  closeSync,
  createWriteStream,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  type MenuItemConstructorOptions,
  nativeImage,
  net as electronNet,
  Notification,
  shell,
  Tray,
  type WebContents,
} from 'electron'

const execFileAsync = promisify(execFile)
const DSH_HOST = '127.0.0.1'
const DEFAULT_DSH_PORT = 3080
const DEFAULT_PROFILE = 'web'
const MAX_RECOVERY_ATTEMPTS = 3
const UPDATE_FEED_URL = 'https://api.github.com/repos/Yuel25/dsh-desktop/releases/latest'
const DSH_DOCS_URL = 'https://github.com/deepseek-ai/deepseek-harness'

type FrameColor = 'black' | 'white'
type Locale = 'zh' | 'en'
type LanguageSetting = 'zh' | 'en' | 'system'
type AppSettings = { frameColor: FrameColor; profile: string; port: number; startHidden: boolean; language: LanguageSetting }
type GuidanceMode = 'dsh-missing' | 'start-failed'
type Guidance = { mode: GuidanceMode; message: string } | null
type UpdateResult = {
  current: string
  latest: string | null
  newer: boolean
  releaseUrl: string | null
  error: string | null
}

let mainWindow: BrowserWindow | null = null
let settingsWindow: BrowserWindow | null = null
let tray: Tray | null = null
let dshProcess: ChildProcess | null = null
let dshStartupError: Error | null = null
let quitting = false
let restarting = false
let dshReady = false
let recoveringDsh = false
let switchingProfile = false
let startingPrimary = false
let rendererRecoveryAttempts = 0
let rendererStableTimer: NodeJS.Timeout | null = null
let latestAvailableVersion: string | null = null
let cachedDshVersion: string | null = null
let settings: AppSettings = { frameColor: 'black', profile: DEFAULT_PROFILE, port: DEFAULT_DSH_PORT, startHidden: false, language: 'system' }

function effectiveLocale(): Locale {
  return settings.language === 'zh' || settings.language === 'en' ? settings.language : systemLocale
}

type ExtraDshWindow = {
  profile: string
  port: number
  url: string
  process: ChildProcess | null
  window: BrowserWindow
  recoveryAttempts: number
}
const extraDshWindows: ExtraDshWindow[] = []

const systemLocale: Locale = app.getLocale().toLowerCase().startsWith('zh') ? 'zh' : 'en'
let activeLocale: Locale = systemLocale
const launchHidden = process.argv.includes('--hidden') || process.argv.includes('/hidden')

// ---------------------------------------------------------------------------
// Localization
// ---------------------------------------------------------------------------

const messages = {  trayOpen: { zh: '打开 dsh-desktop', en: 'Open dsh-desktop' },
  trayOpenBrowser: { zh: '在浏览器中打开', en: 'Open in browser' },
  traySettings: { zh: '设置…', en: 'Settings…' },
  trayRestart: { zh: '重启 dsh-desktop', en: 'Restart dsh-desktop' },
  trayDownloadUpdate: { zh: '下载新版本 v{0}', en: 'Download v{0}' },
  trayQuit: { zh: '退出', en: 'Quit' },
  statusConnectingExisting: { zh: '检测到已运行的 DSH（profile：{0}），正在连接…', en: 'Found a running DSH (profile: {0}), connecting…' },
  statusConnectingUnknown: { zh: '检测到已运行的 DSH（无法确认其 profile），正在连接…', en: 'Found a running DSH (profile unknown), connecting…' },
  statusStarting: { zh: '正在启动 DeepSeek Harness…', en: 'Starting DeepSeek Harness…' },
  statusStartingProfile: { zh: '正在启动 profile「{0}」…', en: 'Starting profile "{0}"…' },
  statusRecovering: { zh: 'DSH 意外退出，正在自动恢复（{0}/{1}）…', en: 'DSH exited unexpectedly; recovering ({0}/{1})…' },
  statusReady: { zh: 'DSH 已就绪，正在打开界面…', en: 'DSH is ready, opening the UI…' },
  statusReadyProfile: { zh: 'profile「{0}」已就绪，正在打开界面…', en: 'Profile "{0}" is ready, opening the UI…' },
  statusSwitching: { zh: '正在切换到 profile「{0}」…', en: 'Switching to profile "{0}"…' },
  statusSwitchFailedRestore: { zh: '切换失败，正在恢复 profile「{0}」…', en: 'Switch failed, restoring profile "{0}"…' },
  statusSwitchFailedRestoreFail: { zh: '恢复 profile 失败：{0}', en: 'Failed to restore the profile: {0}' },
  statusPortBusy: { zh: '端口 {0} 被外部启动的 DSH 占用，无法切换 profile。', en: 'Port {0} is held by an externally started DSH; cannot switch profiles.' },
  statusDshMissing: { zh: '未检测到 dsh 命令，请先安装 DeepSeek Harness。', en: 'The dsh command was not found; install DeepSeek Harness first.' },
  errorUntrusted: { zh: '该 API 仅对本地页面开放。', en: 'This API is only available to local pages.' },
  errorExitedEarly: { zh: 'DSH 在就绪前退出（退出码 {0}）。', en: 'DSH exited before becoming ready (code {0}).' },
  errorNotReadyTimeout: { zh: 'DSH 在 {0} 秒内未就绪。', en: 'DSH did not become ready within {0} seconds.' },
  errorAttachCancelled: { zh: '已取消连接使用 profile「{0}」的现有 DSH。', en: 'Cancelled connecting to the existing DSH with profile "{0}".' },
  errorExternalHttp: { zh: '仅允许打开 https 链接。', en: 'Only https URLs can be opened.' },
  dialogProfileMismatchTitle: { zh: 'profile 不一致', en: 'Profile mismatch' },
  dialogProfileMismatchMessage: {
    zh: '端口 {0} 上已运行的 DSH 使用 profile「{1}」，与当前选择的「{2}」不一致。',
    en: 'The DSH on port {0} runs profile "{1}", which differs from the selected "{2}".',
  },
  dialogProfileMismatchDetail: {
    zh: '该 DSH 不是 dsh-desktop 启动的，无法替它切换 profile。可以连接现有实例，或关闭它后重试。',
    en: 'This DSH was not started by dsh-desktop, so its profile cannot be switched. Attach to it, or close it and retry.',
  },
  dialogAttach: { zh: '连接现有实例', en: 'Attach' },
  dialogCancel: { zh: '取消', en: 'Cancel' },
  dialogSwitchBlockedTitle: { zh: '无法切换 profile', en: 'Cannot switch profile' },
  dialogSwitchBlockedMessage: {
    zh: '端口 {0} 上的 DSH 由外部启动，dsh-desktop 无法替它切换 profile。',
    en: 'The DSH on port {0} was started externally; dsh-desktop cannot switch its profile.',
  },
  dialogSwitchBlockedDetail: {
    zh: '已切回 profile「{0}」。请关闭外部 DSH 后再试。',
    en: 'Reverted to profile "{0}". Close the external DSH and retry.',
  },
  dialogSwitchFailedTitle: { zh: '切换 profile 失败', en: 'Failed to switch profile' },
  dialogSwitchFailedMessage: {
    zh: '无法启动 profile「{0}」：{1}',
    en: 'Could not start profile "{0}": {1}',
  },
  dialogSwitchFailedRestored: {
    zh: '已恢复原 profile「{0}」。',
    en: 'Restored the previous profile "{0}".',
  },
  dialogSwitchFailedRestoreFail: {
    zh: '恢复原 profile 也失败了。请检查日志：{0}',
    en: 'Restoring the previous profile also failed. Check the logs: {0}',
  },
  dialogRecoveryFailedTitle: { zh: 'DSH 自动恢复失败', en: 'DSH auto-recovery failed' },
  dialogRecoveryFailedMessage: {
    zh: '已尝试 {0} 次，仍无法恢复 DSH。',
    en: 'DSH could not be recovered after {0} attempts.',
  },
  dialogRendererFailedTitle: { zh: '界面自动恢复失败', en: 'UI auto-recovery failed' },
  dialogRendererFailedMessage: {
    zh: '界面多次崩溃，请从托盘重启 dsh-desktop。',
    en: 'The UI crashed repeatedly; restart dsh-desktop from the tray.',
  },
  dialogLogsDetail: { zh: '请检查日志：{0}', en: 'Check the logs: {0}' },
  notifyUpdateTitle: { zh: 'dsh-desktop 有新版本', en: 'dsh-desktop update available' },
  notifyUpdateBody: { zh: 'v{0} 已发布，可从托盘菜单下载。', en: 'v{0} is available from the tray menu.' },
  notifyRecoveredTitle: { zh: 'DSH 已自动恢复', en: 'DSH recovered automatically' },
  notifyRecoverFailedTitle: { zh: 'DSH 自动恢复失败', en: 'DSH auto-recovery failed' },
} satisfies Record<string, { zh: string; en: string }>

type MessageKey = keyof typeof messages

function t(key: MessageKey, ...args: (string | number)[]): string {
  let text: string = messages[key][activeLocale]
  args.forEach((arg, index) => {
    text = text.replaceAll(`{${index}}`, String(arg))
  })
  return text
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}

function primaryDshUrl(): string {
  return `http://${DSH_HOST}:${settings.port}`
}

function appIconPath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(app.getAppPath(), 'assets', 'icon.png')
}

function notify(title: string, body: string, onClick?: () => void): void {
  if (!Notification.isSupported()) return
  const notification = new Notification({ title, body, icon: appIconPath() })
  if (onClick) notification.once('click', onClick)
  notification.show()
}

function logDirectory(): string {
  const directory = app.getPath('logs')
  mkdirSync(directory, { recursive: true })
  return directory
}

function writeRecoveryLog(message: string): void {
  const timestamp = new Date().toISOString()
  writeFileSync(join(logDirectory(), 'recovery.log'), `[${timestamp}] ${message}\n`, { flag: 'a' })
}

function readLogTail(name: string, maxBytes = 128 * 1024): string {
  try {
    const filePath = join(logDirectory(), name)
    const fd = openSync(filePath, 'r')
    try {
      const size = fstatSync(fd).size
      const length = Math.min(size, maxBytes)
      const buffer = Buffer.alloc(length)
      readSync(fd, buffer, 0, length, size - length)
      const text = buffer.toString('utf8')
      return size > maxBytes ? `…\n${text}` : text
    } finally {
      closeSync(fd)
    }
  } catch {
    return ''
  }
}

function canConnect(port: number): Promise<boolean> {
  return new Promise((resolveConnection) => {
    const socket = net.createConnection({ host: DSH_HOST, port })
    const finish = (result: boolean): void => {
      socket.destroy()
      resolveConnection(result)
    }
    socket.setTimeout(750)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

function isDshReady(url: string): Promise<boolean> {
  return new Promise((resolveReady) => {
    const request = http.get(url, { timeout: 1_000 }, (response) => {
      response.resume()
      resolveReady((response.statusCode ?? 500) < 500)
    })
    request.once('timeout', () => {
      request.destroy()
      resolveReady(false)
    })
    request.once('error', () => resolveReady(false))
  })
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, DSH_HOST, () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => (port ? resolve(port) : reject(new Error('No free port available.'))))
    })
  })
}

function killProcessTree(pid: number | undefined): Promise<void> {
  if (!pid) return Promise.resolve()
  return execFileAsync('taskkill.exe', ['/pid', String(pid), '/t', '/f'], { windowsHide: true })
    .then(() => undefined)
    .catch(() => {
      // The process may already have exited.
    })
}

function isTrustedRenderer(sender: WebContents): boolean {
  const url = sender.getURL()
  if (process.env.ELECTRON_RENDERER_URL) return url.startsWith(process.env.ELECTRON_RENDERER_URL)
  return url.startsWith('file:')
}

// ---------------------------------------------------------------------------
// Settings (migrates the former appearance.json / profile.json files)
// ---------------------------------------------------------------------------

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function legacySetting<T>(fileName: string, key: string): T | null {
  try {
    const parsed = JSON.parse(readFileSync(join(app.getPath('userData'), fileName), 'utf8')) as Record<string, unknown>
    return (parsed[key] ?? null) as T | null
  } catch {
    return null
  }
}

function loadSettings(): AppSettings {
  const loaded: AppSettings = { frameColor: 'black', profile: DEFAULT_PROFILE, port: DEFAULT_DSH_PORT, startHidden: false, language: 'system' }
  let fromFile = false
  try {
    Object.assign(loaded, JSON.parse(readFileSync(settingsPath(), 'utf8')) as Partial<AppSettings>)
    fromFile = true
  } catch {
    // First run; fall back to the legacy files below.
  }
  if (!fromFile) {
    if (legacySetting<FrameColor>('appearance.json', 'frameColor') === 'white') loaded.frameColor = 'white'
    const profile = legacySetting<string>('profile.json', 'profile')
    if (profile) loaded.profile = profile
  }
  if (loaded.frameColor !== 'black' && loaded.frameColor !== 'white') loaded.frameColor = 'black'
  if (!loaded.profile) loaded.profile = DEFAULT_PROFILE
  if (!Number.isInteger(loaded.port) || loaded.port < 1 || loaded.port > 65535) loaded.port = DEFAULT_DSH_PORT
  if (typeof loaded.startHidden !== 'boolean') loaded.startHidden = false
  if (loaded.language !== 'zh' && loaded.language !== 'en' && loaded.language !== 'system') loaded.language = 'system'
  return loaded
}

function saveSettings(): void {
  writeFileSync(settingsPath(), `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
}

function applyLoginItems(enabled: boolean): void {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    args: enabled && settings.startHidden ? ['--hidden'] : [],
  })
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

function profilesDirectory(): string {
  return join(homedir(), '.dsh', 'profiles')
}

function listProfiles(): string[] {
  try {
    const root = profilesDirectory()
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, 'cordis.yml')))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b))
  } catch {
    return []
  }
}

function quoteCmdArgument(argument: string): string {
  if (!/[\s"]/.test(argument)) return argument
  return `"${argument.replace(/"/g, '""')}"`
}

function dshArgsFor(profile: string, port: number): string[] {
  return ['--profile', profile, '--port', String(port), '--no-open']
}

function dshLaunch(profile: string, port: number): { command: string; args: string[] } {
  const dshArgs = dshArgsFor(profile, port)
  const powershellLauncher = process.env.APPDATA ? join(process.env.APPDATA, 'npm', 'dsh.ps1') : null
  if (powershellLauncher && existsSync(powershellLauncher)) {
    return {
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
  const quoted = dshArgs.map(quoteCmdArgument)
  return { command: process.env.ComSpec || 'cmd.exe', args: ['/d', '/c', `dsh ${quoted.join(' ')}`] }
}

async function listeningPid(port: number): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync('netstat.exe', ['-ano', '-p', 'tcp'], { timeout: 5_000, windowsHide: true })
    for (const line of stdout.split('\n')) {
      const match = line.trim().match(/^TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)$/)
      if (match && Number(match[1]) === port) return Number(match[2])
    }
  } catch {
    // netstat unavailable; the caller treats this as "unknown".
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

async function dshVersion(): Promise<string> {
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

// ---------------------------------------------------------------------------
// Primary DSH instance (the one the main window hosts)
// ---------------------------------------------------------------------------

function sendStatus(message: string): void {
  mainWindow?.webContents.send('dsh:status', message)
}

function sendStatusTo(window: BrowserWindow, message: string): void {
  if (!window.isDestroyed()) window.webContents.send('dsh:status', message)
}

function sendGuidance(guidance: Guidance): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('dsh:guidance', guidance)
}

async function waitUntilReady(url: string, timeoutMs: number, child: ChildProcess | null): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await isDshReady(url)) return
    if (dshStartupError) throw dshStartupError
    if (child && child.exitCode !== null) {
      throw new Error(t('errorExitedEarly', child.exitCode ?? '?'))
    }
    await delay(500)
  }
  throw new Error(t('errorNotReadyTimeout', timeoutMs / 1_000))
}

async function startDsh(): Promise<'attached' | 'started'> {
  dshStartupError = null
  const url = primaryDshUrl()
  if (await canConnect(settings.port)) {
    const runningProfile = await runningDshProfile(settings.port)
    if (runningProfile && runningProfile !== settings.profile && mainWindow && !mainWindow.isDestroyed()) {
      const choice = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: t('dialogProfileMismatchTitle'),
        message: t('dialogProfileMismatchMessage', settings.port, runningProfile, settings.profile),
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
      runningProfile
        ? t('statusConnectingExisting', runningProfile)
        : t('statusConnectingUnknown'),
    )
    await waitUntilReady(url, 15_000, null)
    return 'attached'
  }

  sendStatus(t('statusStarting'))
  const stdout = createWriteStream(join(logDirectory(), 'dsh.stdout.log'), { flags: 'a' })
  const stderr = createWriteStream(join(logDirectory(), 'dsh.stderr.log'), { flags: 'a' })

  const launch = dshLaunch(settings.profile, settings.port)
  dshStartupError = null
  dshProcess = spawn(launch.command, launch.args, {
    env: process.env,
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  dshProcess.stdout?.pipe(stdout)
  dshProcess.stderr?.pipe(stderr)
  dshProcess.once('error', (error) => {
    dshStartupError = new Error(`Failed to start DSH: ${error.message}`)
    stderr.write(`Failed to start DSH: ${error.stack ?? error.message}\n`)
  })
  dshProcess.once('exit', (code) => {
    const shouldRecover = dshReady && !quitting
    dshReady = false
    if (code !== 0) {
      dshStartupError = new Error(
        `DSH exited before becoming ready (code ${code ?? 'unknown'}). Make sure dsh is installed on Windows and available on PATH.`,
      )
    }
    stdout.end()
    stderr.end()
    dshProcess = null
    if (shouldRecover) void recoverDsh()
  })

  await waitUntilReady(url, 60_000, dshProcess)
  dshReady = true
  return 'started'
}

async function stopOwnedDsh(): Promise<void> {
  // Clearing dshReady first keeps the exit handler from treating our own
  // shutdown as a crash and racing recovery against the caller.
  dshReady = false
  const pid = dshProcess?.pid
  dshProcess = null
  await killProcessTree(pid)
}

async function recoverDsh(): Promise<void> {
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

async function switchProfile(name: string): Promise<void> {
  if (name === settings.profile || quitting || recoveringDsh || switchingProfile || startingPrimary) return
  switchingProfile = true
  const previousProfile = settings.profile
  settings.profile = name
  saveSettings()
  updateTrayMenu()

  try {
    sendStatus(t('statusSwitching', name))
    if (mainWindow && !mainWindow.isDestroyed()) await loadLocalPage(mainWindow, 'index.html')
    await stopOwnedDsh()

    if (await canConnect(settings.port)) {
      settings.profile = previousProfile
      saveSettings()
      updateTrayMenu()
      sendStatus(t('statusPortBusy', settings.port))
      if (mainWindow && !mainWindow.isDestroyed()) {
        await dialog.showMessageBox(mainWindow, {
          type: 'warning',
          title: t('dialogSwitchBlockedTitle'),
          message: t('dialogSwitchBlockedMessage', settings.port),
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
      settings.profile = previousProfile
      saveSettings()
      updateTrayMenu()

      let restored = false
      try {
        sendStatus(t('statusSwitchFailedRestore', previousProfile))
        await startDsh()
        dshReady = true
        restored = true
      } catch (restoreError) {
        const restoreMessage = restoreError instanceof Error ? restoreError.message : String(restoreError)
        writeRecoveryLog(`Restoring profile "${previousProfile}" failed: ${restoreMessage}`)
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
    updateTrayMenu()
  }
}

// ---------------------------------------------------------------------------
// Extra per-profile windows (each DSH instance on its own port)
// ---------------------------------------------------------------------------

function spawnExtraProcess(entry: ExtraDshWindow): void {
  const { profile } = entry
  const stdout = createWriteStream(join(logDirectory(), `dsh.${profile}.stdout.log`), { flags: 'a' })
  const stderr = createWriteStream(join(logDirectory(), `dsh.${profile}.stderr.log`), { flags: 'a' })
  const launch = dshLaunch(profile, entry.port)
  entry.process = spawn(launch.command, launch.args, {
    env: process.env,
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  entry.process.stdout?.pipe(stdout)
  entry.process.stderr?.pipe(stderr)
  entry.process.once('exit', () => {
    stdout.end()
    stderr.end()
    if (quitting || entry.window.isDestroyed()) return
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

async function openProfileWindow(profile: string): Promise<void> {
  const existing = extraDshWindows.find((entry) => entry.profile === profile)
  if (existing) {
    existing.window.show()
    existing.window.focus()
    return
  }
  if (profile === settings.profile && dshReady) {
    mainWindow?.show()
    mainWindow?.focus()
    return
  }

  const port = await freePort()
  const url = `http://${DSH_HOST}:${port}`
  const window = createAppWindow({ title: `dsh-desktop · ${profile}` })
  const entry: ExtraDshWindow = { profile, port, url, process: null, window, recoveryAttempts: 0 }
  extraDshWindows.push(entry)

  const detach = (): void => {
    const index = extraDshWindows.indexOf(entry)
    if (index >= 0) extraDshWindows.splice(index, 1)
    void killProcessTree(entry.process?.pid)
    entry.process = null
  }
  window.once('closed', detach)

  try {
    await loadLocalPage(window, 'index.html')
    sendStatusTo(window, t('statusStartingProfile', profile))
    spawnExtraProcess(entry)
    await waitUntilReadyFor(url, 60_000, entry.process)
    if (window.isDestroyed()) return
    sendStatusTo(window, t('statusReadyProfile', profile))
    await window.loadURL(url)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    writeRecoveryLog(`Opening profile window "${profile}" failed: ${message}`)
    if (!window.isDestroyed()) window.destroy()
    else detach()
  }
}

async function recoverProfileWindow(entry: ExtraDshWindow): Promise<void> {
  const { window, profile } = entry
  try {
    await loadLocalPage(window, 'index.html')
    sendStatusTo(window, t('statusStartingProfile', profile))
    spawnExtraProcess(entry)
    await waitUntilReadyFor(entry.url, 60_000, entry.process)
    if (window.isDestroyed()) return
    await window.loadURL(entry.url)
    entry.recoveryAttempts = 0
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    writeRecoveryLog(`Recovering profile window "${profile}" failed: ${message}`)
    if (!window.isDestroyed()) window.destroy()
  }
}

async function waitUntilReadyFor(url: string, timeoutMs: number, child: ChildProcess | null): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await isDshReady(url)) return
    if (child && child.exitCode !== null) throw new Error(t('errorExitedEarly', child.exitCode ?? '?'))
    await delay(500)
  }
  throw new Error(t('errorNotReadyTimeout', timeoutMs / 1_000))
}

// ---------------------------------------------------------------------------
// Update checks
// ---------------------------------------------------------------------------

function compareVersions(a: string, b: string): number {
  const parse = (value: string): number[] =>
    value.replace(/^v/, '').split('.').map((part) => Number(part.replace(/\D.*/, '')) || 0)
  const [aParts, bParts] = [parse(a), parse(b)]
  for (let index = 0; index < Math.max(aParts.length, bParts.length); index += 1) {
    const difference = (aParts[index] ?? 0) - (bParts[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

async function checkForUpdates(trigger: 'auto' | 'settings'): Promise<UpdateResult> {
  const current = app.getVersion()
  const result: UpdateResult = { current, latest: null, newer: false, releaseUrl: null, error: null }
  try {
    const response = await electronNet.fetch(UPDATE_FEED_URL, {
      headers: { 'User-Agent': `dsh-desktop/${current}` },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = (await response.json()) as { tag_name?: string }
    result.latest = data.tag_name?.replace(/^v/, '') ?? null
    result.releaseUrl = 'https://github.com/Yuel25/dsh-desktop/releases/latest'
    result.newer = result.latest !== null && compareVersions(result.latest, current) > 0
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error)
  }

  if (result.newer && result.latest) {
    latestAvailableVersion = result.latest
    updateTrayMenu()
    if (trigger === 'auto') {
      notify(t('notifyUpdateTitle'), t('notifyUpdateBody', result.latest))
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

function loadLocalPage(window: BrowserWindow | null, page: string): Promise<void> {
  if (!window || window.isDestroyed()) return Promise.resolve()
  if (process.env.ELECTRON_RENDERER_URL) {
    return window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/${page}`)
  }
  return window.loadFile(join(__dirname, '../renderer', page))
}

function attachRendererGuards(window: BrowserWindow): void {
  let windowResponsive = true
  let attempts = 0
  let stableTimer: NodeJS.Timeout | null = null
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file:') && !/^http:\/\/(127\.0\.0\.1|localhost):\d+/.test(url)) {
      event.preventDefault()
      void shell.openExternal(url)
    }
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    if (quitting || details.reason === 'clean-exit') return
    if (stableTimer) clearTimeout(stableTimer)
    attempts += 1
    writeRecoveryLog(`Renderer process gone (${details.reason}), attempt ${attempts}.`)
    if (attempts <= MAX_RECOVERY_ATTEMPTS) {
      setTimeout(() => {
        if (!window.isDestroyed()) window.webContents.reload()
      }, attempts * 1_000)
    } else {
      void dialog.showMessageBox(window, {
        type: 'error',
        title: t('dialogRendererFailedTitle'),
        message: t('dialogRendererFailedMessage'),
        detail: t('dialogLogsDetail', app.getPath('logs')),
      })
    }
  })
  window.webContents.on('did-finish-load', () => {
    if (stableTimer) clearTimeout(stableTimer)
    stableTimer = setTimeout(() => {
      attempts = 0
      stableTimer = null
    }, 30_000)
  })
  window.on('unresponsive', () => {
    windowResponsive = false
    writeRecoveryLog('Window became unresponsive; scheduling a renderer reload.')
    setTimeout(() => {
      if (!window.isDestroyed() && !window.webContents.isDestroyed() && !windowResponsive) {
        window.webContents.reload()
      }
    }, 5_000)
  })
  window.on('responsive', () => {
    windowResponsive = true
  })
}

function createAppWindow(options: {
  title: string
  width?: number
  height?: number
  minWidth?: number
  minHeight?: number
  hideOnClose?: boolean
}): BrowserWindow {
  const window = new BrowserWindow({
    width: options.width ?? 1440,
    height: options.height ?? 920,
    minWidth: options.minWidth ?? 960,
    minHeight: options.minHeight ?? 640,
    frame: false,
    show: false,
    autoHideMenuBar: true,
    title: options.title,
    icon: appIconPath(),
    backgroundColor: '#0b1220',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
  window.setMenuBarVisibility(false)
  attachRendererGuards(window)
  if (options.hideOnClose) {
    window.on('close', (event) => {
      if (!quitting) {
        event.preventDefault()
        window.hide()
      }
    })
  }
  return window
}

function createMainWindow(): BrowserWindow {
  const window = createAppWindow({ title: 'dsh-desktop', hideOnClose: true })
  window.once('ready-to-show', () => {
    if (!launchHidden) window.show()
  })
  mainWindow = window
  return window
}

function openSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show()
    settingsWindow.focus()
    return
  }
  settingsWindow = createAppWindow({
    title: `dsh-desktop · ${t('traySettings')}`,
    width: 780,
    height: 760,
    minWidth: 560,
    minHeight: 420,
  })
  settingsWindow.once('ready-to-show', () => settingsWindow?.show())
  settingsWindow.on('closed', () => {
    settingsWindow = null
  })
  void loadLocalPage(settingsWindow, 'settings.html')
}

// ---------------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------------

function createTray(): void {
  const icon = nativeImage.createFromPath(appIconPath())
  tray = new Tray(icon.resize({ width: 16, height: 16 }))
  tray.setToolTip('dsh-desktop')
  updateTrayMenu()
  tray.on('double-click', () => mainWindow?.show())
  tray.on('right-click', () => updateTrayMenu())
}

function updateTrayMenu(): void {
  // High-frequency actions only; everything else lives in the settings window.
  const template: MenuItemConstructorOptions[] = [
    { label: t('trayOpen'), click: () => mainWindow?.show() },
    { label: t('trayOpenBrowser'), click: () => void shell.openExternal(primaryDshUrl()) },
    { label: t('traySettings'), click: () => openSettingsWindow() },
  ]
  if (latestAvailableVersion) {
    template.push({
      label: t('trayDownloadUpdate', latestAvailableVersion),
      click: () => void shell.openExternal('https://github.com/Yuel25/dsh-desktop/releases/latest'),
    })
  }
  template.push(
    { label: t('trayRestart'), click: () => void restartApp() },
    { type: 'separator' },
    {
      label: t('trayQuit'),
      click: () => {
        quitting = true
        app.quit()
      },
    },
  )
  tray?.setContextMenu(Menu.buildFromTemplate(template))
}

function setFrameColor(color: FrameColor): void {
  settings.frameColor = color
  saveSettings()
  for (const window of [mainWindow, settingsWindow, ...extraDshWindows.map((entry) => entry.window)]) {
    window?.webContents.send('appearance:frame-color', color)
  }
  updateTrayMenu()
}

async function restartApp(): Promise<void> {
  if (restarting) return
  restarting = true
  quitting = true
  await stopOwnedDsh()
  app.relaunch()
  app.exit(0)
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

function looksLikeDshMissing(message: string): boolean {
  return /ENOENT|not recognized|not found|无法找到|找不到|不是内部或外部命令/i.test(message)
}

async function attemptStartup(): Promise<void> {
  if (startingPrimary || quitting) return
  startingPrimary = true
  try {
    sendGuidance(null)
    await startDsh()
    dshReady = true
    sendStatus(t('statusReady'))
    if (mainWindow && !mainWindow.isDestroyed()) await mainWindow.loadURL(primaryDshUrl())
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    writeRecoveryLog(`Startup failed: ${message}`)
    const mode: GuidanceMode = looksLikeDshMissing(message) ? 'dsh-missing' : 'start-failed'
    sendStatus(mode === 'dsh-missing' ? t('statusDshMissing') : message)
    sendGuidance({ mode, message })
  } finally {
    startingPrimary = false
    updateTrayMenu()
  }
}

async function bootstrap(): Promise<void> {
  settings = loadSettings()
  activeLocale = effectiveLocale()
  const availableProfiles = listProfiles()
  if (availableProfiles.length > 0 && !availableProfiles.includes(settings.profile)) {
    settings.profile = DEFAULT_PROFILE
    saveSettings()
  }
  createMainWindow()
  createTray()
  await loadLocalPage(mainWindow, 'index.html')
  await attemptStartup()
  void checkForUpdates('auto')
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    mainWindow?.show()
    mainWindow?.focus()
  })
  Menu.setApplicationMenu(null)
  app.whenReady().then(() => void bootstrap())
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

type SettingsSnapshot = {
  frameColor: FrameColor
  profile: string
  port: number
  startHidden: boolean
  language: LanguageSetting
  openAtLogin: boolean
  profiles: string[]
  locale: Locale
  appVersion: string
}

function settingsSnapshot(): SettingsSnapshot {
  return {
    frameColor: settings.frameColor,
    profile: settings.profile,
    port: settings.port,
    startHidden: settings.startHidden,
    language: settings.language,
    openAtLogin: app.getLoginItemSettings().openAtLogin,
    profiles: listProfiles(),
    locale: activeLocale,
    appVersion: app.getVersion(),
  }
}

function applyLanguage(language: LanguageSetting): void {
  settings.language = language
  activeLocale = effectiveLocale()
  saveSettings()
  updateTrayMenu()
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('app:locale-changed', activeLocale)
  }
}

ipcMain.handle('settings:get', (event) => {
  if (!isTrustedRenderer(event.sender)) throw new Error(t('errorUntrusted'))
  return settingsSnapshot()
})

ipcMain.handle(
  'settings:set',
  (event, patch: Partial<Pick<AppSettings, 'frameColor' | 'profile' | 'port' | 'startHidden' | 'language'>>) => {
    if (!isTrustedRenderer(event.sender)) throw new Error(t('errorUntrusted'))
    if (patch.frameColor === 'black' || patch.frameColor === 'white') setFrameColor(patch.frameColor)
    if (patch.language === 'zh' || patch.language === 'en' || patch.language === 'system') {
      applyLanguage(patch.language)
    }
  if (typeof patch.startHidden === 'boolean') {
    settings.startHidden = patch.startHidden
    saveSettings()
    applyLoginItems(app.getLoginItemSettings().openAtLogin)
  }
  if (typeof patch.port === 'number' && Number.isInteger(patch.port) && patch.port >= 1 && patch.port <= 65535) {
    // Port changes take effect on the next app restart so the primary DSH
    // instance is not pulled out from under the main window.
    settings.port = patch.port
    saveSettings()
  }
  if (typeof patch.profile === 'string' && patch.profile && patch.profile !== settings.profile) {
    void switchProfile(patch.profile)
  }
  return settingsSnapshot()
})

ipcMain.handle('app:get-login-settings', (event) => {
  if (!isTrustedRenderer(event.sender)) throw new Error(t('errorUntrusted'))
  return app.getLoginItemSettings().openAtLogin
})

ipcMain.handle('app:set-login-settings', (event, enabled: boolean) => {
  if (!isTrustedRenderer(event.sender)) throw new Error(t('errorUntrusted'))
  applyLoginItems(enabled)
  return app.getLoginItemSettings().openAtLogin
})

ipcMain.handle('app:get-icon-data-url', () => {
  const icon = readFileSync(appIconPath())
  return `data:image/png;base64,${icon.toString('base64')}`
})

ipcMain.handle('app:get-locale', () => activeLocale)

ipcMain.handle('appearance:get-frame-color', () => settings.frameColor)

ipcMain.handle('window:get-profile', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (window === mainWindow) return settings.profile
  return extraDshWindows.find((entry) => entry.window === window)?.profile ?? null
})

ipcMain.handle('app:open-external', (event, url: string) => {
  if (!isTrustedRenderer(event.sender)) throw new Error(t('errorUntrusted'))
  if (!/^https:\/\/\S+$/.test(url)) throw new Error(t('errorExternalHttp'))
  void shell.openExternal(url)
})

ipcMain.handle('app:open-logs-folder', (event) => {
  if (!isTrustedRenderer(event.sender)) throw new Error(t('errorUntrusted'))
  void shell.openPath(app.getPath('logs'))
})

ipcMain.handle('startup:retry', (event) => {
  if (!isTrustedRenderer(event.sender)) throw new Error(t('errorUntrusted'))
  void attemptStartup()
})

ipcMain.handle('profile:open-window', (event, profile: string) => {
  if (!isTrustedRenderer(event.sender)) throw new Error(t('errorUntrusted'))
  if (typeof profile === 'string' && profile) void openProfileWindow(profile)
})

ipcMain.handle('logs:read', (event, name: string) => {
  if (!isTrustedRenderer(event.sender)) throw new Error(t('errorUntrusted'))
  const allowed = ['dsh.stdout.log', 'dsh.stderr.log', 'recovery.log', ...listProfiles().flatMap((profile) => [`dsh.${profile}.stdout.log`, `dsh.${profile}.stderr.log`])]
  if (typeof name !== 'string' || !allowed.includes(name)) throw new Error('Unknown log file.')
  return readLogTail(name)
})

ipcMain.handle('diag:collect', async (event) => {
  if (!isTrustedRenderer(event.sender)) throw new Error(t('errorUntrusted'))
  return [
    `app: dsh-desktop ${app.getVersion()}`,
    `electron: ${process.versions.electron}`,
    `node: ${process.versions.node}`,
    `platform: ${process.platform} ${process.arch}`,
    `locale: ${activeLocale}`,
    `dsh: ${await dshVersion()}` || 'dsh: (not detected)',
    `profile: ${settings.profile}`,
    `port: ${settings.port}`,
    `profiles: ${listProfiles().join(', ') || '(none)'}`,
  ].join('\n')
})

ipcMain.handle('update:check', (event) => {
  if (!isTrustedRenderer(event.sender)) throw new Error(t('errorUntrusted'))
  return checkForUpdates('settings')
})

ipcMain.on('window:minimize', (event) => BrowserWindow.fromWebContents(event.sender)?.minimize())

ipcMain.on('window:toggle-maximize', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window) return
  if (window.isMaximized()) window.unmaximize()
  else window.maximize()
})

ipcMain.on('window:close', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window) return
  if (window === mainWindow) {
    window.close()
    return
  }
  window.destroy()
})

app.on('before-quit', () => {
  quitting = true
})

app.on('will-quit', (event) => {
  const ownedPids = [dshProcess?.pid, ...extraDshWindows.map((entry) => entry.process?.pid)].filter(
    (pid): pid is number => typeof pid === 'number',
  )
  if (ownedPids.length > 0) {
    event.preventDefault()
    void Promise.all(ownedPids.map((pid) => killProcessTree(pid))).finally(() => app.exit())
  }
})

app.on('window-all-closed', () => {
  // The tray keeps the desktop app alive on Windows and Linux.
})
