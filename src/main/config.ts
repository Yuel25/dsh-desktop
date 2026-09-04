import { app } from 'electron'
import { existsSync, readdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getSystemLocale } from './i18n.js'
import {
  DEFAULT_DSH_PORT,
  DEFAULT_PROFILE,
  isValidProfileName,
  type AppSettings,
  type FrameColor,
  type LanguageSetting,
  type Locale,
} from './types.js'

export function settingsPath(): string {
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

export function loadSettings(): AppSettings {
  const loaded: AppSettings = {
    frameColor: 'black',
    profile: DEFAULT_PROFILE,
    port: DEFAULT_DSH_PORT,
    startHidden: false,
    language: 'system',
  }
  let fromFile = false
  try {
    Object.assign(loaded, JSON.parse(readFileSync(settingsPath(), 'utf8')) as Partial<AppSettings>)
    fromFile = true
  } catch {
    // First run; fall back to legacy files
  }
  if (!fromFile) {
    if (legacySetting<FrameColor>('appearance.json', 'frameColor') === 'white') loaded.frameColor = 'white'
    const profile = legacySetting<string>('profile.json', 'profile')
    if (isValidProfileName(profile)) loaded.profile = profile
  }
  if (loaded.frameColor !== 'black' && loaded.frameColor !== 'white') loaded.frameColor = 'black'
  if (!isValidProfileName(loaded.profile)) loaded.profile = DEFAULT_PROFILE
  if (!Number.isInteger(loaded.port) || loaded.port < 1 || loaded.port > 65535) loaded.port = DEFAULT_DSH_PORT
  if (typeof loaded.startHidden !== 'boolean') loaded.startHidden = false
  if (loaded.language !== 'zh' && loaded.language !== 'en' && loaded.language !== 'system') loaded.language = 'system'
  return loaded
}

let appSettings: AppSettings = loadSettings()
let persistedSettings = { ...appSettings }

export function getSettings(): AppSettings {
  return appSettings
}

export function setSettings(updated: AppSettings): void {
  Object.assign(appSettings, updated)
  saveSettings()
}

export function saveSettings(): void {
  const target = settingsPath()
  const temporary = `${target}.tmp`
  try {
    writeFileSync(temporary, `${JSON.stringify(appSettings, null, 2)}\n`, 'utf8')
    renameSync(temporary, target)
    persistedSettings = { ...appSettings }
  } catch (error) {
    Object.assign(appSettings, persistedSettings)
    try { unlinkSync(temporary) } catch { /* The temporary file may not exist. */ }
    throw error
  }
}

export function effectiveLocale(language: LanguageSetting = appSettings.language): Locale {
  return language === 'system' ? getSystemLocale() : language
}

export function applyLoginItems(enabled: boolean): void {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    args: enabled && appSettings.startHidden ? ['--hidden'] : [],
  })
}

export function profilesDirectory(): string {
  return join(homedir(), '.dsh', 'profiles')
}

export function listProfiles(): string[] {
  try {
    const root = profilesDirectory()
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && isValidProfileName(entry.name) && existsSync(join(root, entry.name, 'cordis.yml')))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b))
  } catch {
    return []
  }
}
