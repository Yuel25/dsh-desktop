import { execFile } from 'node:child_process'
import { createWriteStream, mkdirSync, readFileSync } from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'

const execFileAsync = promisify(execFile)
const DSH_HOST = '127.0.0.1'
const DSH_PORT = 3080
const DSH_URL = `http://${DSH_HOST}:${DSH_PORT}`
const WSL_PID_PREFIX = 'DSH_DESKTOP_PID='
const WSL_START_COMMAND = [
  'command -v dsh >/dev/null 2>&1 || {',
  '  [ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"',
  '}',
  'command -v dsh >/dev/null 2>&1 || { echo "dsh is not installed in WSL" >&2; exit 127; }',
  `printf '${WSL_PID_PREFIX}%s\\n' "$$"`,
  'exec dsh web',
].join('\n')

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let dshProcess: ChildProcess | null = null
let wslDshPid: number | null = null
let quitting = false

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

function wslArguments(command: string): string[] {
  const distribution = process.env.DSH_WSL_DISTRO?.trim()
  return [
    ...(distribution ? ['--distribution', distribution] : []),
    '--exec',
    'bash',
    '-lc',
    command,
  ]
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

async function startDsh(): Promise<'attached' | 'started'> {
  if (await canConnect()) {
    sendStatus('检测到已运行的 DSH，正在连接…')
    await waitForDsh(15_000)
    return 'attached'
  }

  sendStatus('正在通过 WSL 启动 DeepSeek Harness…')
  const logDirectory = app.getPath('logs')
  mkdirSync(logDirectory, { recursive: true })
  const stdout = createWriteStream(join(logDirectory, 'dsh.stdout.log'), { flags: 'a' })
  const stderr = createWriteStream(join(logDirectory, 'dsh.stderr.log'), { flags: 'a' })

  let pendingStdout = ''
  wslDshPid = null
  dshProcess = spawn('wsl.exe', wslArguments(WSL_START_COMMAND), {
    env: process.env,
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  dshProcess.stdout?.pipe(stdout)
  dshProcess.stdout?.on('data', (chunk: Buffer) => {
    pendingStdout += chunk.toString('utf8')
    const lines = pendingStdout.split(/\r?\n/)
    pendingStdout = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith(WSL_PID_PREFIX)) continue
      const processId = Number.parseInt(line.slice(WSL_PID_PREFIX.length), 10)
      if (Number.isSafeInteger(processId) && processId > 0) wslDshPid = processId
    }
  })
  dshProcess.stderr?.pipe(stderr)
  dshProcess.once('error', (error) => {
    stderr.write(`Failed to start DSH: ${error.stack ?? error.message}\n`)
  })
  dshProcess.once('exit', () => {
    stdout.end()
    stderr.end()
    dshProcess = null
    wslDshPid = null
  })

  await waitForDsh()
  return 'started'
}

async function stopOwnedDsh(): Promise<void> {
  const windowsProcessId = dshProcess?.pid
  const linuxProcessId = wslDshPid
  if (!windowsProcessId) return
  dshProcess = null
  wslDshPid = null

  if (linuxProcessId) {
    try {
      await execFileAsync('wsl.exe', wslArguments(`kill -TERM ${linuxProcessId}`), { windowsHide: true })
      return
    } catch {
      // Fall through and terminate the Windows-side WSL client.
    }
  }

  try {
    await execFileAsync('taskkill.exe', ['/pid', String(windowsProcessId), '/t', '/f'], { windowsHide: true })
  } catch {
    // The process may already have exited.
  }
}

function createWindow(): BrowserWindow {
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
  return window
}

function createTray(): void {
  const icon = nativeImage.createFromPath(appIconPath())
  tray = new Tray(icon.resize({ width: 16, height: 16 }))
  tray.setToolTip('dsh-desktop')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开 dsh-desktop', click: () => mainWindow?.show() },
    { label: '在浏览器中打开', click: () => void shell.openExternal(DSH_URL) },
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
  tray.on('double-click', () => mainWindow?.show())
}

async function bootstrap(): Promise<void> {
  mainWindow = createWindow()
  createTray()
  if (process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    await mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  try {
    await startDsh()
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

ipcMain.handle('app:get-login-settings', () => app.getLoginItemSettings().openAtLogin)
ipcMain.handle('app:set-login-settings', (_event, enabled: boolean) => {
  app.setLoginItemSettings({ openAtLogin: enabled })
  return app.getLoginItemSettings().openAtLogin
})
ipcMain.handle('app:get-icon-data-url', () => {
  const icon = readFileSync(appIconPath())
  return `data:image/png;base64,${icon.toString('base64')}`
})
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
