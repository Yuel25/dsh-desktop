import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { t } from './i18n.js'
import { attachRendererGuards } from './security.js'
import type { Guidance } from './types.js'

let mainWindow: BrowserWindow | null = null
let settingsWindow: BrowserWindow | null = null
let isQuitting = false

export function setWindowsQuitting(quitting: boolean): void {
  isQuitting = quitting
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

export function getSettingsWindow(): BrowserWindow | null {
  return settingsWindow
}

export function appIconPath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(app.getAppPath(), 'assets', 'icon.png')
}

export function loadLocalPage(window: BrowserWindow | null, page: string): Promise<void> {
  if (!window || window.isDestroyed()) return Promise.resolve()
  if (process.env.ELECTRON_RENDERER_URL) {
    return window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/${page}`)
  }
  return window.loadFile(join(__dirname, '../renderer', page))
}

export function createAppWindow(options: {
  title: string
  width?: number
  height?: number
  minWidth?: number
  minHeight?: number
  hideOnClose?: boolean
  getAllowedPort?: () => number | null
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
  attachRendererGuards(window, options.getAllowedPort)
  if (options.hideOnClose) {
    window.on('close', (event) => {
      if (!isQuitting) {
        event.preventDefault()
        window.hide()
      }
    })
  }
  return window
}

export function createMainWindow(getActivePort: () => number, launchHidden = false): BrowserWindow {
  const window = createAppWindow({
    title: 'dsh-desktop',
    hideOnClose: true,
    getAllowedPort: getActivePort,
  })
  window.once('ready-to-show', () => {
    if (!launchHidden) window.show()
  })
  mainWindow = window
  return window
}

export function openSettingsWindow(): BrowserWindow {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show()
    settingsWindow.focus()
    return settingsWindow
  }
  const window = createAppWindow({
    title: `dsh-desktop · ${t('traySettings')}`,
    width: 780,
    height: 760,
    minWidth: 560,
    minHeight: 420,
    getAllowedPort: () => null,
  })
  settingsWindow = window
  window.once('ready-to-show', () => {
    if (!window.isDestroyed()) window.show()
  })
  window.on('closed', () => {
    settingsWindow = null
  })
  void loadLocalPage(window, 'settings.html')
  return window
}

export function sendStatus(message: string): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('dsh:status', message)
  }
}

export function sendStatusTo(window: BrowserWindow, message: string): void {
  if (!window.isDestroyed()) {
    window.webContents.send('dsh:status', message)
  }
}

export function sendGuidance(guidance: Guidance): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('dsh:guidance', guidance)
  }
}
