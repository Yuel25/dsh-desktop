import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

function App(): React.JSX.Element {
  const [status, setStatus] = useState('正在准备桌面环境…')

  useEffect(() => {
    if (!window.dshDesktop) {
      setStatus('桌面桥接加载失败，请查看启动日志。')
      return
    }
    return window.dshDesktop.onStatus(setStatus)
  }, [])

  return (
    <main className="shell">
      <section className="card">
        <img className="mark" src="./icon.png" alt="dsh-desktop" />
        <h1>dsh-desktop</h1>
        <div className="subtitle">DeepSeek Harness Desktop Client</div>
        <p>{status}</p>
        <div className="loader" aria-label="正在启动" />
      </section>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
