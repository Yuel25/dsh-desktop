import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
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
  shell,
  Tray,
  type WebContents,
} from 'electron'

const execFileAsync = promisify(execFile)
const DSH_HOST = '127.0.0.1'
const DSH_PORT = 3080
const DSH_URL = `http://${DSH_HOST}:${DSH_PORT}`
type FrameColor = 'black' | 'white'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let dshProcess: ChildProcess | null = null
let dshStartupError: Error | null = null
let quitting = false
let restarting = false
let frameColor: FrameColor = 'black'
let dshReady = false
let recoveringDsh = false
let switchingProfile = false
let rendererRecoveryAttempts = 0
let rendererStableTimer: NodeJS.Timeout | null = null
const MAX_RECOVERY_ATTEMPTS = 3
const DEFAULT_PROFILE = 'web'
let currentProfile = DEFAULT_PROFILE

function canConnect(): Promise<boolean> {
  return new Promise((resolveConnection) => {
    const socket = net.createConnection({ host: DSH_HOST, port: DSH_PORT })
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

function isDshReady(): Promise<boolean> {
  return new Promise((resolveReady) => {
    const request = http.get(DSH_URL, { timeout: 1_000 }, (response) => {
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

async function waitForDsh(timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await isDshReady()) return
    if (dshStartupError) throw dshStartupError
    if (dshProcess?.exitCode !== null) {
      throw new Error(`DSH exited before becoming ready (code ${dshProcess?.exitCode ?? 'unknown'}).`)
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500))
  }
  throw new Error(`DSH did not become ready within ${timeoutMs / 1_000} seconds.`)
}

function sendStatus(message: string): void {
  mainWindow?.webContents.send('dsh:status', message)
}

function appIconPath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(app.getAppPath(), 'assets', 'icon.png')
}

function appearanceSettingsPath(): string {
  return join(app.getPath('userData'), 'appearance.json')
}

function loadFrameColor(): FrameColor {
  try {
    const settings = JSON.parse(readFileSync(appearanceSettingsPath(), 'utf8')) as { frameColor?: unknown }
    return settings.frameColor === 'white' ? 'white' : 'black'
  } catch {
    return 'black'
  }
}

function setFrameColor(color: FrameColor): void {
  frameColor = color
  writeFileSync(appearanceSettingsPath(), `${JSON.stringify({ frameColor }, null, 2)}\n`, 'utf8')
  mainWindow?.webContents.send('appearance:frame-color', frameColor)
  updateTrayMenu()
}

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

function profileSettingsPath(): string {
  return join(app.getPath('userData'), 'profile.json')
}

function loadProfile(): string {
  try {
    const settings = JSON.parse(readFileSync(profileSettingsPath(), 'utf8')) as { profile?: unknown }
    if (typeof settings.profile === 'string' && settings.profile) return settings.profile
  } catch {
    // Missing or unreadable settings fall back to the default profile.
  }
  return DEFAULT_PROFILE
}

function saveProfile(name: string): void {
  currentProfile = name
  writeFileSync(profileSettingsPath(), `${JSON.stringify({ profile: currentProfile }, null, 2)}\n`, 'utf8')
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
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
        `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`],
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

async function runningDshProfile(): Promise<string | null> {
  const pid = await listeningPid(DSH_PORT)
  if (!pid) return null
  const commandLine = await processCommandLine(pid)
  if (!commandLine) return null
  return profileFromCommandLine(commandLine)
}

async function switchProfile(name: string): Promise<void> {
  if (name === currentProfile || quitting || recoveringDsh || switchingProfile) return
  switchingProfile = true
  const previousProfile = currentProfile
  saveProfile(name)
  updateTrayMenu()

  try {
    sendStatus(`正在切换到 profile「${name}」…`)
    await showLocalLoadingScreen()
    await stopOwnedDsh()

    if (await canConnect()) {
      saveProfile(previousProfile)
      updateTrayMenu()
      sendStatus(`端口 ${DSH_PORT} 被外部启动的 DSH 占用，无法切换 profile。`)
      if (mainWindow && !mainWindow.isDestroyed()) {
        await dialog.showMessageBox(mainWindow, {
          type: 'warning',
          title: '无法切换 profile',
          message: `端口 ${DSH_PORT} 上的 DSH 由外部启动，dsh-desktop 无法替它切换 profile。`,
          detail: `已切回 profile「${previousProfile}」。请关闭外部 DSH 后再试。`,
        })
        await mainWindow.loadURL(DSH_URL)
      }
      return
    }

    try {
      await startDsh()
      dshReady = true
      sendStatus(`profile「${name}」已就绪，正在打开界面…`)
      if (mainWindow && !mainWindow.isDestroyed()) await mainWindow.loadURL(DSH_URL)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      writeRecoveryLog(`Switch to profile "${name}" failed: ${message}`)
      saveProfile(previousProfile)
      updateTrayMenu()

      let restored = false
      try {
        sendStatus(`切换失败，正在恢复 profile「${previousProfile}」…`)
        await startDsh()
        dshReady = true
        restored = true
      } catch (restoreError) {
        const restoreMessage = restoreError instanceof Error ? restoreError.message : String(restoreError)
        writeRecoveryLog(`Restoring profile "${previousProfile}" failed: ${restoreMessage}`)
        sendStatus(`恢复 profile 失败：${restoreMessage}`)
      }
      if (restored && mainWindow && !mainWindow.isDestroyed()) await mainWindow.loadURL(DSH_URL)
      if (mainWindow && !mainWindow.isDestroyed()) {
        await dialog.showMessageBox(mainWindow, {
          type: 'error',
          title: '切换 profile 失败',
          message: `无法启动 profile「${name}」：${message}`,
          detail: restored
            ? `已恢复原 profile「${previousProfile}」。`
            : `恢复原 profile 也失败了。请检查日志：${app.getPath('logs')}`,
        })
      }
    }
  } finally {
    switchingProfile = false
    updateTrayMenu()
  }
}

function buildProfileMenu(): MenuItemConstructorOptions[] {
  const root = profilesDirectory()
  if (!existsSync(root)) {
    return [{ label: `（未找到目录 ${root}）`, enabled: false }]
  }
  const profiles = listProfiles()
  if (profiles.length === 0) {
    return [{ label: `（${root} 中没有包含 cordis.yml 的 profile）`, enabled: false }]
  }
  return profiles.map((name) => ({
    label: name,
    type: 'radio' as const,
    checked: name === currentProfile,
    click: () => void switchProfile(name),
  }))
}

function quoteCmdArgument(argument: string): string {
  if (!/[\s"]/.test(argument)) return argument
  return `"${argument.replace(/"/g, '""')}"`
}

function dshLaunch(): { command: string; args: string[] } {
  const dshArgs = ['--profile', currentProfile, '--no-open']
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

async function startDsh(): Promise<'attached' | 'started'> {
  if (await canConnect()) {
    const runningProfile = await runningDshProfile()
    if (runningProfile && runningProfile !== currentProfile && mainWindow && !mainWindow.isDestroyed()) {
      const choice = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'profile 不一致',
        message: `端口 ${DSH_PORT} 上已运行的 DSH 使用 profile「${runningProfile}」，与当前选择的「${currentProfile}」不一致。`,
        detail: '该 DSH 不是 dsh-desktop 启动的，无法替它切换 profile。可以连接现有实例，或关闭它后重试。',
        buttons: ['连接现有实例', '取消'],
        defaultId: 0,
        cancelId: 1,
      })
      if (choice.response === 1) {
        throw new Error(`已取消连接使用 profile「${runningProfile}」的现有 DSH。`)
      }
    }
    sendStatus(
      runningProfile
        ? `检测到已运行的 DSH（profile：${runningProfile}），正在连接…`
        : '检测到已运行的 DSH（无法确认其 profile），正在连接…',
    )
    await waitForDsh(15_000)
    return 'attached'
  }

  sendStatus('正在启动 DeepSeek Harness…')
  const logDirectory = app.getPath('logs')
  mkdirSync(logDirectory, { recursive: true })
  const stdout = createWriteStream(join(logDirectory, 'dsh.stdout.log'), { flags: 'a' })
  const stderr = createWriteStream(join(logDirectory, 'dsh.stderr.log'), { flags: 'a' })

  const launch = dshLaunch()
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

  await waitForDsh()
  dshReady = true
  return 'started'
}

async function showLocalLoadingScreen(): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    await mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

async function recoverDsh(): Promise<void> {
  if (recoveringDsh || quitting) return
  recoveringDsh = true
  try {
    await showLocalLoadingScreen()
    for (let attempt = 1; attempt <= MAX_RECOVERY_ATTEMPTS && !quitting; attempt += 1) {
      sendStatus(`DSH 意外退出，正在自动恢复（${attempt}/${MAX_RECOVERY_ATTEMPTS}）…`)
      await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 1_000))
      try {
        await startDsh()
        if (!mainWindow || mainWindow.isDestroyed()) return
        sendStatus('DSH 已恢复，正在重新打开界面…')
        await mainWindow.loadURL(DSH_URL)
        return
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        writeRecoveryLog(`DSH recovery attempt ${attempt} failed: ${message}`)
      }
    }
    if (!quitting && mainWindow && !mainWindow.isDestroyed()) {
      await dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: 'DSH 自动恢复失败',
        message: `已尝试 ${MAX_RECOVERY_ATTEMPTS} 次，仍无法恢复 DSH。`,
        detail: `请检查日志：${app.getPath('logs')}`,
      })
    }
  } finally {
    recoveringDsh = false
  }
}

function writeRecoveryLog(message: string): void {
  const logDirectory = app.getPath('logs')
  mkdirSync(logDirectory, { recursive: true })
  const timestamp = new Date().toISOString()
  writeFileSync(join(logDirectory, 'recovery.log'), `[${timestamp}] ${message}\n`, { flag: 'a' })
}

async function stopOwnedDsh(): Promise<void> {
  // Clearing dshReady first keeps the exit handler from treating our own
  // shutdown as a crash and racing recovery against the caller.
  dshReady = false
  const windowsProcessId = dshProcess?.pid
  if (!windowsProcessId) return
  dshProcess = null

  try {
    await execFileAsync('taskkill.exe', ['/pid', String(windowsProcessId), '/t', '/f'], { windowsHide: true })
  } catch {
    // The process may already have exited.
  }
}

async function restartApp(): Promise<void> {
  if (restarting) return
  restarting = true
  quitting = true
  await stopOwnedDsh()
  app.relaunch()
  app.exit(0)
}

function createWindow(): BrowserWindow {
  let windowResponsive = true
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    frame: false,
    show: false,
    autoHideMenuBar: true,
    title: 'dsh-desktop',
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

  window.once('ready-to-show', () => window.show())
  window.on('close', (event) => {
    if (!quitting) {
      event.preventDefault()
      window.hide()
    }
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(DSH_URL) && !url.startsWith('file:')) {
      event.preventDefault()
      void shell.openExternal(url)
    }
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    if (quitting || details.reason === 'clean-exit') return
    if (rendererStableTimer) clearTimeout(rendererStableTimer)
    rendererRecoveryAttempts += 1
    writeRecoveryLog(`Renderer process gone (${details.reason}), attempt ${rendererRecoveryAttempts}.`)
    if (rendererRecoveryAttempts <= MAX_RECOVERY_ATTEMPTS) {
      setTimeout(() => {
        if (!window.isDestroyed()) window.webContents.reload()
      }, rendererRecoveryAttempts * 1_000)
    } else {
      void dialog.showMessageBox(window, {
        type: 'error',
        title: '界面自动恢复失败',
        message: '界面多次崩溃，请从托盘重启 dsh-desktop。',
        detail: `请检查日志：${app.getPath('logs')}`,
      })
    }
  })
  window.webContents.on('did-finish-load', () => {
    if (rendererStableTimer) clearTimeout(rendererStableTimer)
    rendererStableTimer = setTimeout(() => {
      rendererRecoveryAttempts = 0
      rendererStableTimer = null
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
  return window
}

function createTray(): void {
  const icon = nativeImage.createFromPath(appIconPath())
  tray = new Tray(icon.resize({ width: 16, height: 16 }))
  tray.setToolTip('dsh-desktop')
  updateTrayMenu()
  tray.on('double-click', () => mainWindow?.show())
  tray.on('right-click', () => updateTrayMenu())
}

function updateTrayMenu(): void {
  tray?.setContextMenu(Menu.buildFromTemplate([
    { label: '打开 dsh-desktop', click: () => mainWindow?.show() },
    { label: '在浏览器中打开', click: () => void shell.openExternal(DSH_URL) },
    { label: '重启 dsh-desktop', click: () => void restartApp() },
    {
      label: '标题栏颜色',
      submenu: [
        { label: '黑色', type: 'radio', checked: frameColor === 'black', click: () => setFrameColor('black') },
        { label: '白色', type: 'radio', checked: frameColor === 'white', click: () => setFrameColor('white') },
      ],
    },
    {
      label: '切换 profile 目录',
      submenu: buildProfileMenu(),
    },
    { type: 'separator' },
    {
      label: '开机自启动',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
    },
    { label: '查看日志', click: () => void shell.openPath(app.getPath('logs')) },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        quitting = true
        app.quit()
      },
    },
  ]))
}

async function bootstrap(): Promise<void> {
  frameColor = loadFrameColor()
  const availableProfiles = listProfiles()
  currentProfile = loadProfile()
  if (availableProfiles.length > 0 && !availableProfiles.includes(currentProfile)) {
    currentProfile = DEFAULT_PROFILE
  }
  mainWindow = createWindow()
  createTray()
  await showLocalLoadingScreen()

  try {
    await startDsh()
    dshReady = true
    sendStatus('DSH 已就绪，正在打开界面…')
    await mainWindow.loadURL(DSH_URL)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    sendStatus(`启动失败：${message}`)
    await dialog.showMessageBox(mainWindow, {
      type: 'error',
      title: 'dsh-desktop 启动失败',
      message,
      detail: `日志目录：${app.getPath('logs')}`,
    })
  }
}

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

function isTrustedRenderer(sender: WebContents): boolean {
  const url = sender.getURL()
  if (process.env.ELECTRON_RENDERER_URL) return url.startsWith(process.env.ELECTRON_RENDERER_URL)
  return url.startsWith('file:')
}

ipcMain.handle('app:get-login-settings', (event) => {
  if (!isTrustedRenderer(event.sender)) throw new Error('This API is only available to the local loading page.')
  return app.getLoginItemSettings().openAtLogin
})
ipcMain.handle('app:set-login-settings', (event, enabled: boolean) => {
  if (!isTrustedRenderer(event.sender)) throw new Error('This API is only available to the local loading page.')
  app.setLoginItemSettings({ openAtLogin: enabled })
  return app.getLoginItemSettings().openAtLogin
})
ipcMain.handle('app:get-icon-data-url', () => {
  const icon = readFileSync(appIconPath())
  return `data:image/png;base64,${icon.toString('base64')}`
})
ipcMain.handle('appearance:get-frame-color', () => frameColor)
ipcMain.on('window:minimize', (event) => BrowserWindow.fromWebContents(event.sender)?.minimize())
ipcMain.on('window:toggle-maximize', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window) return
  if (window.isMaximized()) window.unmaximize()
  else window.maximize()
})
ipcMain.on('window:close', (event) => BrowserWindow.fromWebContents(event.sender)?.close())

app.on('before-quit', () => {
  quitting = true
})
app.on('will-quit', (event) => {
  if (dshProcess) {
    event.preventDefault()
    void stopOwnedDsh().finally(() => app.exit())
  }
})
app.on('window-all-closed', () => {
  // The tray keeps the desktop app alive on Windows and Linux.
})
