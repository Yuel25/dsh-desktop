import { app, net as electronNet, Notification } from 'electron'
import { join } from 'node:path'
import { t } from './i18n.js'
import { UPDATE_FEED_URL, type UpdateResult } from './types.js'

let latestAvailableVersion: string | null = null

export function getLatestAvailableVersion(): string | null {
  return latestAvailableVersion
}

export function compareVersions(a: string, b: string): number {
  const parse = (value: string): number[] =>
    value.replace(/^v/, '').split('.').map((part) => Number(part.replace(/\D.*/, '')) || 0)
  const [aParts, bParts] = [parse(a), parse(b)]
  for (let index = 0; index < Math.max(aParts.length, bParts.length); index += 1) {
    const difference = (aParts[index] ?? 0) - (bParts[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

function appIconPath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(app.getAppPath(), 'assets', 'icon.png')
}

export function notify(title: string, body: string, onClick?: () => void): void {
  if (!Notification.isSupported()) return
  const notification = new Notification({ title, body, icon: appIconPath() })
  if (onClick) notification.once('click', onClick)
  notification.show()
}

export async function checkForUpdates(
  trigger: 'auto' | 'settings',
  onUpdateAvailable?: (latest: string) => void,
): Promise<UpdateResult> {
  const current = app.getVersion()
  const result: UpdateResult = { current, latest: null, newer: false, releaseUrl: null, error: null }
  try {
    const response = await electronNet.fetch(UPDATE_FEED_URL, {
      headers: { 'User-Agent': `dsh-desktop/${current}` },
      signal: AbortSignal.timeout(15_000),
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
    if (onUpdateAvailable) onUpdateAvailable(result.latest)
    if (trigger === 'auto') {
      notify(t('notifyUpdateTitle'), t('notifyUpdateBody', result.latest))
    }
  }
  return result
}
