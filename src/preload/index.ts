import { contextBridge, ipcRenderer } from 'electron'

const TITLEBAR_ID = 'dsh-desktop-titlebar'

async function mountTitlebar(): Promise<void> {
  if (document.getElementById(TITLEBAR_ID)) return

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
      <button class="dsh-desktop-minimize" title="最小化" aria-label="最小化">
        <svg viewBox="0 0 12 12"><path d="M1.5 6.5h9" /></svg>
      </button>
      <button class="dsh-desktop-maximize" title="最大化" aria-label="最大化">
        <svg viewBox="0 0 12 12"><rect x="1.75" y="1.75" width="8.5" height="8.5" /></svg>
      </button>
      <button class="dsh-desktop-close" title="隐藏到托盘" aria-label="隐藏到托盘">
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
  const icon = titlebar.querySelector<HTMLImageElement>('.dsh-desktop-icon')
  if (icon) icon.src = await ipcRenderer.invoke('app:get-icon-data-url')
}

window.addEventListener('DOMContentLoaded', () => void mountTitlebar())

contextBridge.exposeInMainWorld('dshDesktop', {
  onStatus: (listener: (message: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, message: string): void => listener(message)
    ipcRenderer.on('dsh:status', handler)
    return () => ipcRenderer.removeListener('dsh:status', handler)
  },
  getOpenAtLogin: (): Promise<boolean> => ipcRenderer.invoke('app:get-login-settings'),
  setOpenAtLogin: (enabled: boolean): Promise<boolean> => ipcRenderer.invoke('app:set-login-settings', enabled),
})
