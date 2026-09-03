import type { ChildProcess } from 'node:child_process'
import type { Writable } from 'node:stream'
import type { BrowserWindow } from 'electron'

export const DSH_HOST = '127.0.0.1'
export const DEFAULT_DSH_PORT = 3080
export const DEFAULT_PROFILE = 'web'
export const MAX_RECOVERY_ATTEMPTS = 3
export const UPDATE_FEED_URL = 'https://api.github.com/repos/Yuel25/dsh-desktop/releases/latest'
export const DSH_DOCS_URL = 'https://github.com/deepseek-ai/deepseek-harness'

export type FrameColor = 'black' | 'white'
export type Locale = 'zh' | 'en'
export type LanguageSetting = 'zh' | 'en' | 'system'

export type AppSettings = {
  frameColor: FrameColor
  profile: string
  port: number
  startHidden: boolean
  language: LanguageSetting
}

export type GuidanceMode = 'dsh-missing' | 'start-failed'
export type Guidance = { mode: GuidanceMode; message: string } | null

export type UpdateResult = {
  current: string
  latest: string | null
  newer: boolean
  releaseUrl: string | null
  error: string | null
}

export type DshErrorKind = 'not-installed' | 'spawn-failed' | 'exited-early' | 'timeout' | 'generic'

export class DshError extends Error {
  constructor(
    public readonly kind: DshErrorKind,
    message: string,
    public readonly exitCode?: number | null,
  ) {
    super(message)
    this.name = 'DshError'
  }
}

export type CancellationToken = {
  readonly isCancelled: boolean
}

export function createCancellationToken(): { token: CancellationToken; cancel: () => void } {
  let isCancelled = false
  return {
    token: {
      get isCancelled() {
        return isCancelled
      },
    },
    cancel() {
      isCancelled = true
    },
  }
}

export type ExtraDshWindow = {
  profile: string
  port: number
  url: string
  process: ChildProcess | null
  window: BrowserWindow
  recoveryAttempts: number
  startupError: Error | null
  stdoutStream?: Writable
  stderrStream?: Writable
  ready?: boolean
  recovering?: boolean
}
