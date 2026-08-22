/// <reference types="vite/client" />

interface Window {
  // Only exposed on dsh-desktop's own loading page; the hosted DSH web UI
  // does not get this bridge.
  dshDesktop?: {
    onStatus(listener: (message: string) => void): () => void
    getOpenAtLogin(): Promise<boolean>
    setOpenAtLogin(enabled: boolean): Promise<boolean>
  }
}
