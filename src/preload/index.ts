import { contextBridge, ipcRenderer } from 'electron'

const TITLEBAR_ID = 'dsh-desktop-titlebar'

type FrameColor = 'black' | 'white'
type Locale = 'zh' | 'en'

const titlebarText = {
  zh: { minimize: '最小化', maximize: '最大化', restore: '还原', close: '关闭' },
  en: { minimize: 'Minimize', maximize: 'Maximize', restore: 'Restore', close: 'Close' },
} as const

function applyFrameColor(color: FrameColor): void {
  document.getElementById(TITLEBAR_ID)?.setAttribute('data-color', color)
  if (isLocalRenderer) document.documentElement.dataset.frameColor = color
}

async function mountTitlebar(): Promise<void> {
  if (document.getElementById(TITLEBAR_ID)) return

  const locale = (await ipcRenderer.invoke('app:get-locale')) as Locale
  let text = titlebarText[locale] ?? titlebarText.zh
  let currentProfile: string | null = null

  const style = document.createElement('style')
  style.textContent = `
    :root { --dsh-desktop-titlebar-height: 38px; }
    html, body { height: 100% !important; }
    body {
      box-sizing: border-box !important;
      height: 100vh !important;
      padding-top: var(--dsh-desktop-titlebar-height) !important;
      overflow: hidden !important;
    }
    body > #root {
      height: 100% !important;
      max-height: 100% !important;
    }
    #${TITLEBAR_ID} {
      position: fixed;
      inset: 0 0 auto 0;
      z-index: 2147483647;
      height: var(--dsh-desktop-titlebar-height);
      display: flex;
      align-items: center;
      color: var(--foreground, #dce8fa);
      background: color-mix(in srgb, var(--background, #0b1220) 94%, transparent);
      border-bottom: 1px solid color-mix(in srgb, var(--border, #7890b0) 22%, transparent);
      box-shadow: 0 1px 10px rgba(0, 0, 0, 0.08);
      backdrop-filter: blur(18px);
      -webkit-app-region: drag;
      user-select: none;
      font-family: Inter, "Segoe UI", system-ui, sans-serif;
    }
    #${TITLEBAR_ID}[data-color="black"] {
      color: #dce8fa;
      background: #171c2a;
      border-bottom-color: rgba(255, 255, 255, 0.12);
    }
    #${TITLEBAR_ID}[data-color="white"] {
      color: #182033;
      background: #f7f8fb;
      border-bottom-color: rgba(0, 0, 0, 0.18);
      box-shadow: 0 1px 10px rgba(0, 0, 0, 0.12);
    }
    #${TITLEBAR_ID} .dsh-desktop-brand {
      min-width: 0;
      flex: 1;
      display: flex;
      align-items: center;
      gap: 9px;
      padding-left: 13px;
    }
    #${TITLEBAR_ID} .dsh-desktop-icon {
      width: 20px;
      height: 20px;
      object-fit: contain;
      filter: drop-shadow(0 2px 5px rgba(77, 107, 254, 0.3));
    }
    #${TITLEBAR_ID} .dsh-desktop-name {
      overflow: hidden;
      font-size: 12px;
      font-weight: 650;
      letter-spacing: 0.015em;
      text-overflow: ellipsis;
      white-space: nowrap;
      opacity: 0.88;
    }
    #${TITLEBAR_ID} .dsh-desktop-controls {
      align-self: stretch;
      display: flex;
      -webkit-app-region: no-drag;
    }
    #${TITLEBAR_ID} button {
      width: 46px;
      height: 100%;
      display: grid;
      place-items: center;
      padding: 0;
      border: 0;
      border-radius: 0;
      color: inherit;
      background: transparent;
      font: inherit;
      cursor: default;
      outline: none;
    }
    #${TITLEBAR_ID} button:hover { background: rgba(127, 151, 190, 0.16); }
    #${TITLEBAR_ID} button:active { background: rgba(127, 151, 190, 0.24); }
    #${TITLEBAR_ID}[data-color="white"] button:hover { background: rgba(15, 23, 42, 0.09); }
    #${TITLEBAR_ID}[data-color="white"] button:active { background: rgba(15, 23, 42, 0.16); }
    #${TITLEBAR_ID} .dsh-desktop-close:hover { color: #fff; background: #e5484d; }
    #${TITLEBAR_ID} svg { width: 11px; height: 11px; stroke: currentColor; stroke-width: 1.25; fill: none; }
  `

  const titlebar = document.createElement('header')
  titlebar.id = TITLEBAR_ID
  titlebar.innerHTML = `
    <div class="dsh-desktop-brand">
      <img class="dsh-desktop-icon" alt="" />
      <span class="dsh-desktop-name">dsh-desktop</span>
    </div>
    <div class="dsh-desktop-controls">
      <button class="dsh-desktop-minimize" title="${text.minimize}" aria-label="${text.minimize}">
        <svg viewBox="0 0 12 12"><path d="M1.5 6.5h9" /></svg>
      </button>
      <button class="dsh-desktop-maximize" title="${text.maximize}" aria-label="${text.maximize}">
        <svg viewBox="0 0 12 12"><rect x="1.75" y="1.75" width="8.5" height="8.5" /></svg>
      </button>
      <button class="dsh-desktop-close" title="${text.close}" aria-label="${text.close}">
        <svg viewBox="0 0 12 12"><path d="M2 2l8 8M10 2l-8 8" /></svg>
      </button>
    </div>
  `

  titlebar.querySelector<HTMLButtonElement>('.dsh-desktop-minimize')?.addEventListener('click', () => {
    ipcRenderer.send('window:minimize')
  })
  titlebar.querySelector<HTMLButtonElement>('.dsh-desktop-maximize')?.addEventListener('click', () => {
    ipcRenderer.send('window:toggle-maximize')
  })
  titlebar.querySelector<HTMLButtonElement>('.dsh-desktop-close')?.addEventListener('click', () => {
    ipcRenderer.send('window:close')
  })
  titlebar.addEventListener('dblclick', (event) => {
    if ((event.target as HTMLElement).closest('button')) return
    ipcRenderer.send('window:toggle-maximize')
  })

  document.head.append(style)
  document.body.append(titlebar)

  // The host page is a full SPA and may re-render <body>; keep the titlebar
  // and its styles attached.
  const reattach = (): void => {
    if (!style.isConnected) document.head.append(style)
    if (document.body && !titlebar.isConnected) document.body.append(titlebar)
  }
  new MutationObserver(reattach).observe(document.documentElement, { childList: true, subtree: true })

  const applyTexts = (): void => {
    const minimize = titlebar.querySelector<HTMLButtonElement>('.dsh-desktop-minimize')
    const maximize = titlebar.querySelector<HTMLButtonElement>('.dsh-desktop-maximize')
    const close = titlebar.querySelector<HTMLButtonElement>('.dsh-desktop-close')
    const name = titlebar.querySelector<HTMLSpanElement>('.dsh-desktop-name')
    if (minimize) {
      minimize.title = text.minimize
      minimize.setAttribute('aria-label', text.minimize)
    }
    if (maximize) {
      maximize.title = text.maximize
      maximize.setAttribute('aria-label', text.maximize)
    }
    if (close) {
      close.title = text.close
      close.setAttribute('aria-label', text.close)
    }
    if (name) name.textContent = currentProfile ? `dsh-desktop · ${currentProfile}` : 'dsh-desktop'
  }

  const profile = (await ipcRenderer.invoke('window:get-profile')) as string | null
  currentProfile = profile
  applyTexts()
  ipcRenderer.on('app:locale-changed', (_event, nextLocale: Locale) => {
    text = titlebarText[nextLocale] ?? titlebarText.zh
    applyTexts()
  })

  applyFrameColor(await ipcRenderer.invoke('appearance:get-frame-color') as FrameColor)
  const icon = titlebar.querySelector<HTMLImageElement>('.dsh-desktop-icon')
  if (icon) icon.src = await ipcRenderer.invoke('app:get-icon-data-url')
}

window.addEventListener('DOMContentLoaded', () => void mountTitlebar())
ipcRenderer.on('appearance:frame-color', (_event, color: FrameColor) => applyFrameColor(color))

// The DSH web page only needs the titlebar; the bridge below is for
// dsh-desktop's own local pages (loading screen and settings), so keep it
// away from hosted app code.
const localRendererOrigin = process.env.ELECTRON_RENDERER_URL
  ? new URL(process.env.ELECTRON_RENDERER_URL).origin
  : null
const normalizedPath = location.pathname.toLowerCase().replace(/\\/g, '/')
const isLocalRenderer =
  (location.protocol === 'file:' &&
    (normalizedPath.endsWith('/index.html') || normalizedPath.endsWith('/settings.html'))) ||
  (localRendererOrigin !== null &&
    location.origin === localRendererOrigin &&
    (normalizedPath === '/' ||
      normalizedPath.endsWith('/index.html') ||
      normalizedPath.endsWith('/settings.html')))

if (isLocalRenderer) {
  // Apply the saved appearance before the local page's first render.
  window.addEventListener('DOMContentLoaded', () => {
    applyFrameColor(new URLSearchParams(location.search).get('frameColor') === 'white' ? 'white' : 'black')
  })
  contextBridge.exposeInMainWorld('dshDesktop', {
    onStatus: (listener: (message: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, message: string): void => listener(message)
      ipcRenderer.on('dsh:status', handler)
      return () => ipcRenderer.removeListener('dsh:status', handler)
    },
    onGuidance: (listener: (guidance: { mode: string; message: string } | null) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, guidance: { mode: string; message: string } | null): void =>
        listener(guidance)
      ipcRenderer.on('dsh:guidance', handler)
      return () => ipcRenderer.removeListener('dsh:guidance', handler)
    },
    getLocale: (): Promise<string> => ipcRenderer.invoke('app:get-locale'),
    onLocaleChanged: (listener: (locale: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, locale: string): void => listener(locale)
      ipcRenderer.on('app:locale-changed', handler)
      return () => ipcRenderer.removeListener('app:locale-changed', handler)
    },
    getOpenAtLogin: (): Promise<boolean> => ipcRenderer.invoke('app:get-login-settings'),
    setOpenAtLogin: (enabled: boolean): Promise<boolean> => ipcRenderer.invoke('app:set-login-settings', enabled),
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('app:open-external', url),
    openLogsFolder: (): Promise<void> => ipcRenderer.invoke('app:open-logs-folder'),
    retryStartup: (): Promise<void> => ipcRenderer.invoke('startup:retry'),
    getStartupState: (): Promise<{
      status: string | null
      guidance: { mode: string; message: string } | null
      version: number
    }> => ipcRenderer.invoke('startup:get-state'),
    getSettings: () => ipcRenderer.invoke('settings:get'),
    setSettings: (patch: Record<string, unknown>) => ipcRenderer.invoke('settings:set', patch),
    openProfileWindow: (profile: string): Promise<void> => ipcRenderer.invoke('profile:open-window', profile),
    listLogs: (): Promise<string[]> => ipcRenderer.invoke('logs:list'),
    readLog: (name: string): Promise<string> => ipcRenderer.invoke('logs:read', name),
    collectDiagnostics: (): Promise<string> => ipcRenderer.invoke('diag:collect'),
    checkUpdate: (): Promise<{
      current: string
      latest: string | null
      newer: boolean
      releaseUrl: string | null
      error: string | null
    }> => ipcRenderer.invoke('update:check'),
  })
}
