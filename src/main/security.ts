import { app, dialog, shell, type BrowserWindow, type WebContents, type WebFrameMain } from 'electron'
import { join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { t } from './i18n.js'
import { writeRecoveryLog } from './logging.js'
import { MAX_RECOVERY_ATTEMPTS } from './types.js'

let isAppQuitting = false

export function setAppQuitting(quitting: boolean): void {
  isAppQuitting = quitting
}

export function isAllowedLocalUrl(urlString: string): boolean {
  try {
    const parsed = new URL(urlString)
    if (parsed.protocol === 'file:') {
      const filePath = normalize(fileURLToPath(parsed.href)).toLowerCase()
      const allowedIndex = normalize(join(__dirname, '../renderer/index.html')).toLowerCase()
      const allowedSettings = normalize(join(__dirname, '../renderer/settings.html')).toLowerCase()
      return filePath === allowedIndex || filePath === allowedSettings
    }
    if (process.env.ELECTRON_RENDERER_URL) {
      const devUrl = new URL(process.env.ELECTRON_RENDERER_URL)
      if (parsed.origin === devUrl.origin) {
        const path = parsed.pathname.toLowerCase()
        return path === '/' || path === '/index.html' || path === '/settings.html'
      }
    }
  } catch {
    return false
  }
  return false
}

export function isTrustedRenderer(source: WebContents | WebFrameMain | null | undefined): boolean {
  if (!source) return false
  const url =
    'url' in source && typeof source.url === 'string'
      ? source.url
      : typeof (source as WebContents).getURL === 'function'
        ? (source as WebContents).getURL()
        : ''
  return isAllowedLocalUrl(url)
}

export async function safeOpenExternal(rawUrl: string): Promise<boolean> {
  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false
    }
    if (parsed.username || parsed.password) {
      return false
    }
    await shell.openExternal(parsed.href)
    return true
  } catch {
    return false
  }
}

export function isAllowedNavigation(urlString: string, getAllowedPort?: () => number | null): boolean {
  if (isAllowedLocalUrl(urlString)) return true
  try {
    const parsed = new URL(urlString)
    if (parsed.protocol !== 'http:') return false
    if (parsed.username || parsed.password) return false
    if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') return false
    if (getAllowedPort) {
      const allowed = getAllowedPort()
      if (allowed === null || Number(parsed.port) !== allowed) return false
    }
    return true
  } catch {
    return false
  }
}

export function attachRendererGuards(window: BrowserWindow, getAllowedPort?: () => number | null): void {
  let windowResponsive = true
  let attempts = 0
  let stableTimer: NodeJS.Timeout | null = null

  window.webContents.setWindowOpenHandler(({ url }) => {
    void safeOpenExternal(url)
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url, getAllowedPort)) {
      event.preventDefault()
      void safeOpenExternal(url)
    }
  })

  window.webContents.on('will-redirect', (event, url) => {
    if (!isAllowedNavigation(url, getAllowedPort)) {
      event.preventDefault()
      void safeOpenExternal(url)
    }
  })

  window.webContents.on('render-process-gone', (_event, details) => {
    if (isAppQuitting || details.reason === 'clean-exit') return
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
    }, 10_000)
  })

  window.on('unresponsive', () => {
    windowResponsive = false
    writeRecoveryLog('Window became unresponsive.')
  })

  window.on('responsive', () => {
    if (!windowResponsive) {
      windowResponsive = true
      writeRecoveryLog('Window recovered from unresponsive state.')
    }
  })
}
