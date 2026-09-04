import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron'
import { readFileSync } from 'node:fs'
import {
  applyLoginItems,
  effectiveLocale,
  getSettings,
  listProfiles,
  saveSettings,
} from './config.js'
import {
  attemptStartup,
  clearCachedDshVersion,
  closeAllProfileWindows,
  dshVersion,
  getActiveDshPort,
  getExtraDshWindows,
  openProfileWindow,
  setActiveDshPort,
  setDshQuitting,
  setOnStateChange,
  stopOwnedDsh,
  switchProfile,
} from './dsh.js'
import { getActiveLocale, setActiveLocale, t } from './i18n.js'
import { isAllowedLogFilename, listAvailableLogFiles, readLogTail } from './logging.js'
import { isTrustedRenderer, safeOpenExternal, setAppQuitting } from './security.js'
import { createTray, updateTrayMenu } from './tray.js'
import {
  DEFAULT_PROFILE,
  isValidProfileName,
  type AppSettings,
  type ExtraDshWindow,
  type FrameColor,
  type LanguageSetting,
  type Locale,
} from './types.js'
import { checkForUpdates } from './updater.js'
import {
  appIconPath,
  createMainWindow,
  getMainWindow,
  getSettingsWindow,
  getWindowLaunchState,
  loadLocalPage,
  setWindowsQuitting,
} from './windows.js'

const launchHidden = process.argv.includes('--hidden') || process.argv.includes('/hidden')
let restarting = false

function settingsSnapshot(): {
  frameColor: FrameColor
  profile: string
  port: number
  startHidden: boolean
  language: LanguageSetting
  openAtLogin: boolean
  profiles: string[]
  locale: Locale
  appVersion: string
} {
  const settings = getSettings()
  return {
    frameColor: settings.frameColor,
    profile: settings.profile,
    port: settings.port,
    startHidden: settings.startHidden,
    language: settings.language,
    openAtLogin: app.getLoginItemSettings().openAtLogin,
    profiles: listProfiles(),
    locale: getActiveLocale(),
    appVersion: app.getVersion(),
  }
}

function setFrameColor(color: FrameColor): void {
  const settings = getSettings()
  settings.frameColor = color
  saveSettings()
  const mainWindow = getMainWindow()
  const settingsWindow = getSettingsWindow()
  const extraWindows = getExtraDshWindows().map((entry: ExtraDshWindow) => entry.window)
  for (const window of [mainWindow, settingsWindow, ...extraWindows]) {
    window?.webContents.send('appearance:frame-color', color)
  }
  updateTrayMenu()
}

function applyLanguage(language: LanguageSetting): void {
  const settings = getSettings()
  settings.language = language
  const newLocale = effectiveLocale(language)
  saveSettings()
  setActiveLocale(newLocale)
  updateTrayMenu()
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('app:locale-changed', newLocale)
  }
}

async function restartApp(): Promise<void> {
  if (restarting) return
  restarting = true
  setAppQuitting(true)
  setWindowsQuitting(true)
  setDshQuitting(true)
  await Promise.all([stopOwnedDsh(), closeAllProfileWindows()])
  app.relaunch()
  app.exit(0)
}

async function bootstrap(): Promise<void> {
  const settings = getSettings()
  setActiveDshPort(settings.port)
  setActiveLocale(effectiveLocale(settings.language))

  const availableProfiles = listProfiles()
  if (!isValidProfileName(settings.profile) || (availableProfiles.length > 0 && !availableProfiles.includes(settings.profile))) {
    settings.profile = DEFAULT_PROFILE
    saveSettings()
  }

  createMainWindow(() => getActiveDshPort(), launchHidden)
  createTray({
    onRestart: () => void restartApp(),
    onQuit: () => {
      setAppQuitting(true)
      setWindowsQuitting(true)
      setDshQuitting(true)
      app.quit()
    },
  })

  setOnStateChange(updateTrayMenu)

  const mainWindow = getMainWindow()
  await loadLocalPage(mainWindow, 'index.html')
  await attemptStartup()
  void checkForUpdates('auto', () => updateTrayMenu())
}

// ---------------------------------------------------------------------------
// App Lifecycle
// ---------------------------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const mainWindow = getMainWindow()
    mainWindow?.show()
    mainWindow?.focus()
  })
  Menu.setApplicationMenu(null)
  app.whenReady().then(() => void bootstrap())
}

app.on('before-quit', () => {
  setAppQuitting(true)
  setWindowsQuitting(true)
  setDshQuitting(true)
})

app.on('will-quit', (event) => {
  event.preventDefault()
  void Promise.all([stopOwnedDsh(), closeAllProfileWindows()]).finally(() => app.exit())
})

app.on('window-all-closed', () => {
  // Tray keeps desktop app running
})

// ---------------------------------------------------------------------------
// IPC Handlers
// ---------------------------------------------------------------------------

ipcMain.handle('settings:get', (event) => {
  if (!isTrustedRenderer(event.senderFrame ?? event.sender)) throw new Error(t('errorUntrusted'))
  return settingsSnapshot()
})

ipcMain.handle(
  'settings:set',
  async (event, patch: Partial<Pick<AppSettings, 'frameColor' | 'profile' | 'port' | 'startHidden' | 'language'>>) => {
    if (!isTrustedRenderer(event.senderFrame ?? event.sender)) throw new Error(t('errorUntrusted'))
    const settings = getSettings()
    if (patch.frameColor === 'black' || patch.frameColor === 'white') setFrameColor(patch.frameColor)
    if (patch.language === 'zh' || patch.language === 'en' || patch.language === 'system') {
      applyLanguage(patch.language)
    }
    if (typeof patch.startHidden === 'boolean') {
      const previous = settings.startHidden
      settings.startHidden = patch.startHidden
      const enabled = app.getLoginItemSettings().openAtLogin
      try {
        applyLoginItems(enabled)
        saveSettings()
      } catch (error) {
        settings.startHidden = previous
        try { applyLoginItems(enabled) } catch { /* Preserve the original failure. */ }
        throw error
      }
    }
    if (typeof patch.port === 'number' && Number.isInteger(patch.port) && patch.port >= 1 && patch.port <= 65535) {
      settings.port = patch.port
      saveSettings()
    }
    if (patch.profile !== undefined) {
      if (!isValidProfileName(patch.profile)) {
        throw new Error(t('errorInvalidProfile', String(patch.profile)))
      }
      if (patch.profile !== settings.profile) {
        await switchProfile(patch.profile)
      }
    }
    return settingsSnapshot()
  },
)

ipcMain.handle('app:get-login-settings', (event) => {
  if (!isTrustedRenderer(event.senderFrame ?? event.sender)) throw new Error(t('errorUntrusted'))
  return app.getLoginItemSettings().openAtLogin
})

ipcMain.handle('app:set-login-settings', (event, enabled: boolean) => {
  if (!isTrustedRenderer(event.senderFrame ?? event.sender)) throw new Error(t('errorUntrusted'))
  applyLoginItems(enabled)
  return app.getLoginItemSettings().openAtLogin
})

ipcMain.handle('app:get-icon-data-url', () => {
  const icon = readFileSync(appIconPath())
  return `data:image/png;base64,${icon.toString('base64')}`
})

ipcMain.handle('app:get-locale', () => getActiveLocale())

ipcMain.handle('appearance:get-frame-color', () => getSettings().frameColor)

ipcMain.handle('window:get-profile', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (window === getMainWindow()) return getSettings().profile
  return getExtraDshWindows().find((entry: ExtraDshWindow) => entry.window === window)?.profile ?? null
})

ipcMain.handle('app:open-external', async (event, url: string) => {
  if (!isTrustedRenderer(event.senderFrame ?? event.sender)) throw new Error(t('errorUntrusted'))
  const opened = await safeOpenExternal(url)
  if (!opened) throw new Error(t('errorExternalHttp'))
})

ipcMain.handle('app:open-logs-folder', (event) => {
  if (!isTrustedRenderer(event.senderFrame ?? event.sender)) throw new Error(t('errorUntrusted'))
  void shell.openPath(app.getPath('logs'))
})

ipcMain.handle('startup:retry', (event) => {
  if (!isTrustedRenderer(event.senderFrame ?? event.sender)) throw new Error(t('errorUntrusted'))
  clearCachedDshVersion()
  void attemptStartup()
})

ipcMain.handle('startup:get-state', (event) => {
  if (!isTrustedRenderer(event.senderFrame ?? event.sender)) throw new Error(t('errorUntrusted'))
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window) return { status: null, guidance: null, version: 0 }
  return getWindowLaunchState(window)
})

ipcMain.handle('profile:open-window', async (event, profile: string) => {
  if (!isTrustedRenderer(event.senderFrame ?? event.sender)) throw new Error(t('errorUntrusted'))
  if (!isValidProfileName(profile)) {
    throw new Error(t('errorInvalidProfile', String(profile)))
  }
  await openProfileWindow(profile)
})

ipcMain.handle('logs:list', (event) => {
  if (!isTrustedRenderer(event.senderFrame ?? event.sender)) throw new Error(t('errorUntrusted'))
  return listAvailableLogFiles()
})

ipcMain.handle('logs:read', (event, name: string) => {
  if (!isTrustedRenderer(event.senderFrame ?? event.sender)) throw new Error(t('errorUntrusted'))
  if (typeof name !== 'string' || !isAllowedLogFilename(name)) {
    throw new Error('Unknown log file.')
  }
  return readLogTail(name)
})

ipcMain.handle('diag:collect', async (event) => {
  if (!isTrustedRenderer(event.senderFrame ?? event.sender)) throw new Error(t('errorUntrusted'))
  const settings = getSettings()
  return [
    `app: dsh-desktop ${app.getVersion()}`,
    `electron: ${process.versions.electron}`,
    `node: ${process.versions.node}`,
    `platform: ${process.platform} ${process.arch}`,
    `locale: ${getActiveLocale()}`,
    `dsh: ${await dshVersion()}` || 'dsh: (not detected)',
    `profile: ${settings.profile}`,
    `port: ${getActiveDshPort()}`,
    `configured port: ${settings.port}`,
    `profiles: ${listProfiles().join(', ') || '(none)'}`,
  ].join('\n')
})

ipcMain.handle('update:check', (event) => {
  if (!isTrustedRenderer(event.senderFrame ?? event.sender)) throw new Error(t('errorUntrusted'))
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
  if (window === getMainWindow()) {
    window.close()
    return
  }
  window.destroy()
})
