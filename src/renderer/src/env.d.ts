/// <reference types="vite/client" />

type DshGuidance = { mode: 'dsh-missing' | 'start-failed'; message: string } | null

type DshSettings = {
  frameColor: 'black' | 'white'
  profile: string
  port: number
  startHidden: boolean
  language: 'zh' | 'en' | 'system'
  openAtLogin: boolean
  profiles: string[]
  locale: 'zh' | 'en'
  appVersion: string
}

type DshUpdateResult = {
  current: string
  latest: string | null
  newer: boolean
  releaseUrl: string | null
  error: string | null
}

interface Window {
  // Only exposed on dsh-desktop's own local pages (loading screen and
  // settings); the hosted DSH web UI does not get this bridge.
  dshDesktop?: {
    onStatus(listener: (message: string) => void): () => void
    onGuidance(listener: (guidance: DshGuidance) => void): () => void
    getLocale(): Promise<'zh' | 'en'>
    onLocaleChanged(listener: (locale: 'zh' | 'en') => void): () => void
    getOpenAtLogin(): Promise<boolean>
    setOpenAtLogin(enabled: boolean): Promise<boolean>
    openExternal(url: string): Promise<void>
    openLogsFolder(): Promise<void>
    retryStartup(): Promise<void>
    getSettings(): Promise<DshSettings>
    setSettings(patch: Partial<Pick<DshSettings, 'frameColor' | 'profile' | 'port' | 'startHidden'>>): Promise<DshSettings>
    openProfileWindow(profile: string): Promise<void>
    readLog(name: string): Promise<string>
    collectDiagnostics(): Promise<string>
    checkUpdate(): Promise<DshUpdateResult>
  }
}
