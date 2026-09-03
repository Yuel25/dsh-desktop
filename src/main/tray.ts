import { Menu, nativeImage, Tray, type MenuItemConstructorOptions } from 'electron'
import { primaryDshUrl } from './dsh.js'
import { t } from './i18n.js'
import { safeOpenExternal } from './security.js'
import { getLatestAvailableVersion } from './updater.js'
import { appIconPath, getMainWindow, openSettingsWindow } from './windows.js'

let tray: Tray | null = null
let onRestartApp: (() => void) | null = null
let onQuitApp: (() => void) | null = null

export function updateTrayMenu(): void {
  if (!tray) return
  const mainWindow = getMainWindow()
  const latestVersion = getLatestAvailableVersion()

  const template: MenuItemConstructorOptions[] = [
    { label: t('trayOpen'), click: () => mainWindow?.show() },
    { label: t('trayOpenBrowser'), click: () => void safeOpenExternal(primaryDshUrl()) },
    { label: t('traySettings'), click: () => openSettingsWindow() },
  ]

  if (latestVersion) {
    template.push({
      label: t('trayDownloadUpdate', latestVersion),
      click: () => void safeOpenExternal('https://github.com/Yuel25/dsh-desktop/releases/latest'),
    })
  }

  template.push(
    { label: t('trayRestart'), click: () => onRestartApp?.() },
    { type: 'separator' },
    {
      label: t('trayQuit'),
      click: () => onQuitApp?.(),
    },
  )

  tray.setContextMenu(Menu.buildFromTemplate(template))
}

export function createTray(callbacks: { onRestart: () => void; onQuit: () => void }): Tray {
  onRestartApp = callbacks.onRestart
  onQuitApp = callbacks.onQuit

  const icon = nativeImage.createFromPath(appIconPath())
  tray = new Tray(icon.resize({ width: 16, height: 16 }))
  tray.setToolTip('dsh-desktop')
  updateTrayMenu()

  tray.on('double-click', () => getMainWindow()?.show())
  tray.on('right-click', () => updateTrayMenu())
  return tray
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy()
    tray = null
  }
}
