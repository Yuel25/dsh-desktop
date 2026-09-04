import { app } from 'electron'
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { appendFile, stat } from 'node:fs/promises'
import { Writable } from 'node:stream'
import { basename, join } from 'node:path'
import { DshLogRedactor, redactDshToken } from './dsh-auth.js'

export const MAX_LOG_SIZE = 5 * 1024 * 1024 // 5 MiB
export const MAX_ROTATED_FILES = 3
export const MAX_TOTAL_LOG_BUDGET = 50 * 1024 * 1024 // 50 MiB

export function logDirectory(): string {
  const directory = app.getPath('logs')
  mkdirSync(directory, { recursive: true })
  return directory
}

export function safeCloseStream(stream?: Writable | null): void {
  if (!stream || stream.destroyed || stream.closed || stream.writableEnded) return
  try {
    stream.end()
  } catch {
    // ignore
  }
}

/**
 * Enforces total directory storage budget by removing the oldest rotated backup files.
 * Active (unrotated) log files are preserved.
 */
export function enforceDirectoryBudget(dir = logDirectory()): void {
  try {
    const entries = readdirSync(dir, { withFileTypes: true })
    const files: Array<{ name: string; path: string; size: number; mtimeMs: number; isRotated: boolean }> = []
    let totalSize = 0

    for (const entry of entries) {
      if (!entry.isFile()) continue
      const filePath = join(dir, entry.name)
      try {
        const stats = statSync(filePath)
        totalSize += stats.size
        const isRotated = /\.\d+\.log$/i.test(entry.name) || entry.name.endsWith('.old')
        files.push({ name: entry.name, path: filePath, size: stats.size, mtimeMs: stats.mtimeMs, isRotated })
      } catch {
        // ignore inaccessible files
      }
    }

    if (totalSize <= MAX_TOTAL_LOG_BUDGET) return

    // Sort rotated files oldest first
    const rotatedFiles = files.filter((f) => f.isRotated).sort((a, b) => a.mtimeMs - b.mtimeMs)

    for (const file of rotatedFiles) {
      if (totalSize <= MAX_TOTAL_LOG_BUDGET) break
      try {
        unlinkSync(file.path)
        totalSize -= file.size
      } catch {
        // ignore failure to delete locked file
      }
    }
  } catch {
    // ignore directory read issues
  }
}

/**
 * Rotates a single log file if it exceeds MAX_LOG_SIZE.
 * e.g., dsh.stdout.log -> dsh.stdout.1.log -> dsh.stdout.2.log -> dsh.stdout.3.log
 */
export function rotateLogFile(filePath: string): boolean {
  try {
    if (!existsSync(filePath)) return false
    const stats = statSync(filePath)
    if (stats.size < MAX_LOG_SIZE) return false

    // e.g. path = '.../dsh.stdout.log'
    // base = '.../dsh.stdout', ext = '.log'
    const name = basename(filePath)
    const extMatch = name.match(/^(.*?)(\.[^.]*)?$/)
    const baseName = extMatch ? extMatch[1] : name
    const ext = extMatch && extMatch[2] ? extMatch[2] : ''
    const dir = join(filePath, '..')

    // Remove oldest rotated backup if present
    const oldest = join(dir, `${baseName}.${MAX_ROTATED_FILES}${ext}`)
    if (existsSync(oldest)) {
      try {
        unlinkSync(oldest)
      } catch {
        // ignore
      }
    }

    // Cascade shift
    for (let index = MAX_ROTATED_FILES - 1; index >= 1; index -= 1) {
      const src = join(dir, `${baseName}.${index}${ext}`)
      const dst = join(dir, `${baseName}.${index + 1}${ext}`)
      if (existsSync(src)) {
        try {
          renameSync(src, dst)
        } catch {
          // ignore
        }
      }
    }

    // Rename current log file to .1
    const firstBackup = join(dir, `${baseName}.1${ext}`)
    try {
      renameSync(filePath, firstBackup)
    } catch {
      return false
    }

    enforceDirectoryBudget(dir)
    return true
  } catch {
    return false
  }
}

export function createRotatingLogStream(filename: string): Writable {
  const filePath = join(logDirectory(), filename)
  const redactor = new DshLogRedactor()
  // Writable serializes writes and provides backpressure. No file handle remains
  // open between appends, so rotation is safe on Windows as well.
  async function append(chunk: Buffer): Promise<void> {
    let size = await stat(filePath).then((value) => value.size).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return 0
      throw error
    })
    let offset = 0
    while (offset < chunk.length) {
      if (size >= MAX_LOG_SIZE) {
        if (!rotateLogFile(filePath)) throw new Error(`Unable to rotate log: ${filename}`)
        size = 0
      }
      const length = Math.min(MAX_LOG_SIZE - size, chunk.length - offset)
      await appendFile(filePath, chunk.subarray(offset, offset + length))
      offset += length
      size += length
    }
  }
  return new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      const redacted = redactor.write(chunk)
      if (redacted.length === 0) {
        callback()
        return
      }
      void append(Buffer.from(redacted, 'utf8')).then(() => callback(), (error: Error) => callback(error))
    },
    final(callback) {
      const remaining = redactor.end()
      if (remaining.length === 0) {
        callback()
        return
      }
      void append(Buffer.from(remaining, 'utf8')).then(() => callback(), (error: Error) => callback(error))
    },
  })
}

export function writeRecoveryLog(message: string): void {
  try {
    const filePath = join(logDirectory(), 'recovery.log')
    rotateLogFile(filePath)
    const timestamp = new Date().toISOString()
    const redacted = redactDshToken(message)
    writeFileSync(filePath, `[${timestamp}] ${redacted}\n`, { flag: 'a' })
  } catch {
    // ignore
  }
}

const DOS_DEVICE_NAME_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i

export function isAllowedLogFilename(name: string): boolean {
  if (typeof name !== 'string' || name.length === 0 || name.length > 255) return false
  if (name.includes('/') || name.includes('\\') || name.includes('\0') || name.includes('..')) return false
  if (!name.endsWith('.log')) return false
  if (/[<>:"/\\|?*\x00-\x1f]/.test(name)) return false
  if (DOS_DEVICE_NAME_RE.test(name)) return false
  return true
}

export function readLogTail(name: string, maxBytes = 128 * 1024): string {
  if (!isAllowedLogFilename(name)) {
    throw new Error('Unknown log file.')
  }
  const filePath = join(logDirectory(), name)
  if (!existsSync(filePath)) {
    return ''
  }
  try {
    const stats = statSync(filePath)
    const size = stats.size
    const bytesToRead = Math.min(size, maxBytes)
    const buffer = Buffer.alloc(bytesToRead)
    const descriptor = openSync(filePath, 'r')
    try {
      readSync(descriptor, buffer, 0, bytesToRead, size - bytesToRead)
    } finally {
      closeSync(descriptor)
    }
    return buffer.toString('utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return ''
    throw error
  }
}

export function listAvailableLogFiles(): string[] {
  try {
    const dir = logDirectory()
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && isAllowedLogFilename(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}
