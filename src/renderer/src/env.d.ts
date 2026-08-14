/// <reference types="vite/client" />

interface Window {
  dshDesktop: {
    onStatus(listener: (message: string) => void): () => void
    getOpenAtLogin(): Promise<boolean>
    setOpenAtLogin(enabled: boolean): Promise<boolean>
  }
}
