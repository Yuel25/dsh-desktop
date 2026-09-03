import { StringDecoder } from 'node:string_decoder'

/** Accept only the launch URL for this instance, never arbitrary child output. */
export function parseDshLaunchUrl(line: string, port: number): string | null {
  const match = line.replace(/\x1b\[[0-9;]*m/g, '').trim().match(/^dsh web:\s+(\S+)$/)
  if (!match) return null
  try {
    const url = new URL(match[1])
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)
      || Number(url.port) !== port || url.username || url.password || url.pathname !== '/' || url.hash) return null
    const tokens = url.searchParams.getAll('token')
    if (tokens.length !== 1 || !tokens[0] || tokens[0].length > 512
      || [...url.searchParams.keys()].some(key => key !== 'token')) return null
    url.hostname = '127.0.0.1'
    return url.href
  } catch {
    return null
  }
}

/** stdout can split the URL (and UTF-8 characters) across arbitrary chunks. */
export function createDshLaunchReader(port: number, onUrl: (url: string) => void): (chunk: Buffer) => void {
  const decoder = new StringDecoder('utf8')
  let pending = ''
  let oversized = false
  return (chunk) => {
    pending += decoder.write(chunk)
    let newline: number
    while ((newline = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, newline)
      if (!oversized && line.length <= 8192) {
        const url = parseDshLaunchUrl(line, port)
        if (url) onUrl(url)
      }
      oversized = false
      pending = pending.slice(newline + 1)
    }
    if (pending.length > 8192) { pending = ''; oversized = true }
  }
}

export function redactDshToken(message: string): string {
  return message.replace(/([?&]token=)[^\s&#"'<>]+/gi, '$1[redacted]')
}
