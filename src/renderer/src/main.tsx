import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

type Locale = 'zh' | 'en'

const ui = {
  zh: {
    preparing: '正在准备桌面环境…',
    bridgeFailed: '桌面桥接加载失败，请查看启动日志。',
    missingTitle: '需要先安装 DeepSeek Harness',
    missingBody: '未检测到 dsh 命令。请在 Windows 中安装后重试：',
    retry: '重试',
    openDocs: '打开安装文档',
    viewLogs: '查看日志',
    failedTitle: '启动失败',
    installCommand: 'npm install -g @deepseek-ai/dsh',
  },
  en: {
    preparing: 'Preparing the desktop environment…',
    bridgeFailed: 'The desktop bridge failed to load; check the startup logs.',
    missingTitle: 'DeepSeek Harness is required',
    missingBody: 'The dsh command was not found. Install it on Windows, then retry:',
    retry: 'Retry',
    openDocs: 'Open install docs',
    viewLogs: 'View logs',
    failedTitle: 'Startup failed',
    installCommand: 'npm install -g @deepseek-ai/dsh',
  },
} as const

function App(): React.JSX.Element {
  const [locale, setLocale] = useState<Locale>('zh')
  const [status, setStatus] = useState<string | null>(null)
  const [guidance, setGuidance] = useState<DshGuidance>(null)

  useEffect(() => {
    if (!window.dshDesktop) return
    const desktop = window.dshDesktop
    void desktop.getLocale().then((value) => setLocale(value))
    const stopStatus = desktop.onStatus(setStatus)
    const stopGuidance = desktop.onGuidance(setGuidance)
    const stopLocale = desktop.onLocaleChanged(setLocale)
    return () => {
      stopStatus()
      stopGuidance()
      stopLocale()
    }
  }, [])

  const text = ui[locale]
  const bridgeReady = Boolean(window.dshDesktop)

  if (guidance) {
    const missing = guidance.mode === 'dsh-missing'
    return (
      <main className="shell">
        <section className="card">
          <img className="mark" src="./icon.png" alt="dsh-desktop" />
          <h1 className="small">{missing ? text.missingTitle : text.failedTitle}</h1>
          {missing ? (
            <>
              <p>{text.missingBody}</p>
              <code className="code">{text.installCommand}</code>
            </>
          ) : (
            <p className="error-text">{guidance.message}</p>
          )}
          <div className="actions">
            <button
              className="btn primary"
              onClick={() => void window.dshDesktop?.retryStartup()}
            >
              {text.retry}
            </button>
            {missing && (
              <button
                className="btn"
                onClick={() => void window.dshDesktop?.openExternal('https://github.com/deepseek-ai/deepseek-harness')}
              >
                {text.openDocs}
              </button>
            )}
            <button className="btn" onClick={() => void window.dshDesktop?.openLogsFolder()}>
              {text.viewLogs}
            </button>
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className="shell">
      <section className="card">
        <img className="mark" src="./icon.png" alt="dsh-desktop" />
        <h1>dsh-desktop</h1>
        <div className="subtitle">DeepSeek Harness Desktop Client</div>
        <p>{bridgeReady ? (status ?? text.preparing) : text.bridgeFailed}</p>
        <div className="loader" aria-label={text.preparing} />
      </section>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
