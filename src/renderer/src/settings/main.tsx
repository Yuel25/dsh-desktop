import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './settings.css'

const ui = {
  zh: {
    appearance: '外观',
    frameColor: '标题栏颜色',
    black: '黑色',
    white: '白色',
    language: '语言',
    languageSystem: '跟随系统',
    startup: '启动',
    openAtLogin: '开机自启动',
    startHidden: '自启动时隐藏到托盘（后台启动 DSH）',
    port: 'DSH 端口',
    portHint: '端口变更在重启 dsh-desktop 后生效。',
    save: '保存',
    profilesSection: 'Profile',
    profilesHint: '切换会重启 dsh-desktop 管理的 DSH 服务。',
    current: '当前',
    openWindow: '新窗口',
    logs: '日志',
    refresh: '刷新',
    openLogsFolder: '打开日志文件夹',
    emptyLog: '（暂无内容）',
    diagnostics: '诊断',
    copy: '复制诊断信息',
    copied: '已复制',
    update: '更新',
    currentVersion: '当前版本',
    checkUpdate: '检查更新',
    checking: '检查中…',
    upToDate: '已是最新版本。',
    newVersion: '新版本 {0} 可用。',
    updateError: '检查失败：{0}',
    download: '打开发布页',
    loadFailed: '设置加载失败。',
  },
  en: {
    appearance: 'Appearance',
    frameColor: 'Title bar color',
    black: 'Black',
    white: 'White',
    language: 'Language',
    languageSystem: 'Follow system',
    startup: 'Startup',
    openAtLogin: 'Launch at login',
    startHidden: 'Start hidden in tray at login (DSH starts in the background)',
    port: 'DSH port',
    portHint: 'Port changes take effect after restarting dsh-desktop.',
    save: 'Save',
    profilesSection: 'Profile',
    profilesHint: 'Switching restarts the DSH service owned by dsh-desktop.',
    current: 'current',
    openWindow: 'New window',
    logs: 'Logs',
    refresh: 'Refresh',
    openLogsFolder: 'Open logs folder',
    emptyLog: '(empty)',
    diagnostics: 'Diagnostics',
    copy: 'Copy diagnostics',
    copied: 'Copied',
    update: 'Update',
    currentVersion: 'Current version',
    checkUpdate: 'Check for updates',
    checking: 'Checking…',
    upToDate: 'You are on the latest version.',
    newVersion: 'Version {0} is available.',
    updateError: 'Check failed: {0}',
    download: 'Open releases',
    loadFailed: 'Failed to load settings.',
  },
} as const

type Locale = 'zh' | 'en'

function App(): React.JSX.Element {
  const [settings, setSettings] = useState<DshSettings | null>(null)
  const [locale, setLocale] = useState<Locale>('zh')
  const [portDraft, setPortDraft] = useState('')
  const [logName, setLogName] = useState('dsh.stdout.log')
  const [logText, setLogText] = useState('')
  const [diagnostics, setDiagnostics] = useState('')
  const [copied, setCopied] = useState(false)
  const [updateState, setUpdateState] = useState<'idle' | 'checking' | 'done'>('idle')
  const [updateResult, setUpdateResult] = useState<DshUpdateResult | null>(null)

  const text = ui[locale]
  const desktop = window.dshDesktop

  const refresh = useCallback(async (): Promise<void> => {
    if (!desktop) return
    const snapshot = await desktop.getSettings()
    setSettings(snapshot)
    setLocale(snapshot.locale)
    setPortDraft(String(snapshot.port))
  }, [desktop])

  useEffect(() => {
    void refresh()
    if (!desktop) return
    return desktop.onLocaleChanged(() => void refresh())
  }, [refresh, desktop])

  const logFiles = useMemo(() => {
    if (!settings) return ['dsh.stdout.log', 'dsh.stderr.log', 'recovery.log']
    return [
      'dsh.stdout.log',
      'dsh.stderr.log',
      'recovery.log',
      ...settings.profiles.flatMap((profile) => [`dsh.${profile}.stdout.log`, `dsh.${profile}.stderr.log`]),
    ]
  }, [settings])

  const readLog = useCallback(
    async (name: string): Promise<void> => {
      if (!desktop) return
      setLogText(await desktop.readLog(name))
    },
    [desktop],
  )

  useEffect(() => {
    void readLog(logName)
  }, [readLog, logName])

  if (!desktop) {
    return <main className="settings"><p>{text.loadFailed}</p></main>
  }
  if (!settings) {
    return <main className="settings"><div className="loader" /></main>
  }

  const patch = async (changes: Partial<DshSettings>): Promise<void> => {
    setSettings(await desktop.setSettings(changes))
  }

  return (
    <main className="settings">
      <section>
        <h2>{text.appearance}</h2>
        <label>
          <input
            type="radio"
            name="frameColor"
            checked={settings.frameColor === 'black'}
            onChange={() => void patch({ frameColor: 'black' })}
          />
          {text.black}
        </label>
        <label>
          <input
            type="radio"
            name="frameColor"
            checked={settings.frameColor === 'white'}
            onChange={() => void patch({ frameColor: 'white' })}
          />
          {text.white}
        </label>
        <h3>{text.language}</h3>
        {(['system', 'zh', 'en'] as const).map((language) => (
          <label key={language}>
            <input
              type="radio"
              name="language"
              checked={settings.language === language}
              onChange={() => void patch({ language })}
            />
            {language === 'system' ? text.languageSystem : language === 'zh' ? '简体中文' : 'English'}
          </label>
        ))}
      </section>

      <section>
        <h2>{text.startup}</h2>
        <label>
          <input
            type="checkbox"
            checked={settings.openAtLogin}
            onChange={(event) => {
              void desktop.setOpenAtLogin(event.target.checked).then(() => void refresh())
            }}
          />
          {text.openAtLogin}
        </label>
        <label>
          <input
            type="checkbox"
            checked={settings.startHidden}
            disabled={!settings.openAtLogin}
            onChange={(event) => void patch({ startHidden: event.target.checked })}
          />
          {text.startHidden}
        </label>
        <div className="row">
          <label className="inline">
            {text.port}
            <input
              className="port"
              type="number"
              min={1}
              max={65535}
              value={portDraft}
              onChange={(event) => setPortDraft(event.target.value)}
            />
          </label>
          {portDraft !== String(settings.port) && (
            <button
              className="btn"
              onClick={() => {
                const port = Number(portDraft)
                if (Number.isInteger(port) && port >= 1 && port <= 65535) void patch({ port })
              }}
            >
              {text.save}
            </button>
          )}
        </div>
        <p className="hint">{text.portHint}</p>
      </section>

      <section>
        <h2>{text.profilesSection}</h2>
        <p className="hint">{text.profilesHint}</p>
        <div className="profile-list">
          {settings.profiles.length === 0 && <span className="hint">~/.dsh/profiles</span>}
          {settings.profiles.map((profile) => (
            <div className="profile-row" key={profile}>
              <label>
                <input
                  type="radio"
                  name="profile"
                  checked={profile === settings.profile}
                  onChange={() => void patch({ profile })}
                />
                {profile}
                {profile === settings.profile && <span className="tag">{text.current}</span>}
              </label>
              {profile !== settings.profile && (
                <button className="btn small" onClick={() => void desktop.openProfileWindow(profile)}>
                  {text.openWindow}
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2>{text.logs}</h2>
        <div className="row">
          <select value={logName} onChange={(event) => setLogName(event.target.value)}>
            {logFiles.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <button className="btn" onClick={() => void readLog(logName)}>
            {text.refresh}
          </button>
          <button className="btn" onClick={() => void desktop.openLogsFolder()}>
            {text.openLogsFolder}
          </button>
        </div>
        <pre className="output">{logText || text.emptyLog}</pre>
      </section>

      <section>
        <h2>{text.diagnostics}</h2>
        <div className="row">
          <button
            className="btn"
            onClick={async () => {
              setDiagnostics(await desktop.collectDiagnostics())
              await navigator.clipboard.writeText(await desktop.collectDiagnostics())
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }}
          >
            {copied ? text.copied : text.copy}
          </button>
        </div>
        {diagnostics && <pre className="output">{diagnostics}</pre>}
      </section>

      <section>
        <h2>{text.update}</h2>
        <p className="hint">
          {text.currentVersion}: v{settings.appVersion}
        </p>
        <div className="row">
          <button
            className="btn"
            disabled={updateState === 'checking'}
            onClick={async () => {
              setUpdateState('checking')
              setUpdateResult(await desktop.checkUpdate())
              setUpdateState('done')
            }}
          >
            {updateState === 'checking' ? text.checking : text.checkUpdate}
          </button>
          {updateResult?.newer && updateResult.releaseUrl && (
            <button className="btn" onClick={() => void desktop.openExternal(updateResult.releaseUrl!)}>
              {text.download}
            </button>
          )}
        </div>
        {updateResult && (
          <p className="hint">
            {updateResult.error
              ? text.updateError.replace('{0}', updateResult.error)
              : updateResult.newer
                ? text.newVersion.replace('{0}', updateResult.latest ?? '')
                : text.upToDate}
          </p>
        )}
      </section>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
