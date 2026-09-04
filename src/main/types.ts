import type { ChildProcess } from 'node:child_process'
import type { Writable } from 'node:stream'
import type { BrowserWindow } from 'electron'

export const DSH_HOST = '127.0.0.1'
export const DEFAULT_DSH_PORT = 3080
export const DEFAULT_PROFILE = 'web'
export const MAX_RECOVERY_ATTEMPTS = 3
export const STABLE_RUNNING_WINDOW_MS = 30_000
export const UPDATE_FEED_URL = 'https://api.github.com/repos/Yuel25/dsh-desktop/releases/latest'
export const DSH_DOCS_URL = 'https://github.com/deepseek-ai/deepseek-harness'

const DOS_DEVICE_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i
const FORBIDDEN_PROFILE_CHARS = /[<>:"/\\|?*&%!^';`$()~[\]{}\r\n\t\x00-\x1f\x7f]/

export function isValidProfileName(name: unknown): name is string {
  if (typeof name !== 'string') return false
  const trimmed = name.trim()
  if (trimmed.length === 0 || trimmed.length > 64) return false
  if (name !== trimmed) return false
  if (name === '.' || name === '..') return false
  if (DOS_DEVICE_NAMES.test(name)) return false
  if (FORBIDDEN_PROFILE_CHARS.test(name)) return false
  return true
}

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

export type WindowLaunchState = {
  status: string | null
  guidance: Guidance
  version: number
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
  stableTimer?: NodeJS.Timeout | null
}
