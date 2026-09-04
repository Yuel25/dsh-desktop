import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './settings.css'

const ui = {
  zh: {
    title: '设置',
    navigation: '偏好设置',
    autoSave: '更改会自动保存',
    unsaved: '端口更改尚未保存',
    appearanceHint: '调整窗口外观与显示语言。',
    startupHint: '管理启动方式和本地服务连接。',
    logsHint: '查看服务输出，快速定位问题。',
    diagnosticsHint: '收集运行环境信息，便于反馈和排查。',
    updateHint: '保持更新，获得更好的桌面体验。',
    emptyProfiles: '暂无可用 Profile',
    emptyProfilesHint: '在 ~/.dsh/profiles 中添加配置后，重新打开设置。',
    failed: '操作失败，请重试。',
    switchFailed: '切换 profile 失败，已恢复原设置。',
    copyFailed: '复制失败，请重试。',
    saving: '正在保存…',
    saved: '已保存',
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
    openingWindow: '打开中…',
    logs: '日志',
    refresh: '刷新',
    openLogsFolder: '打开日志文件夹',
    emptyLog: '（暂无内容）',
    emptyLogs: '暂无可用日志文件',
    logReadFailed: '日志读取失败，请重试。',
    retry: '重试',
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
    title: 'Settings',
    navigation: 'PREFERENCES',
    autoSave: 'Changes save automatically',
    unsaved: 'Port changes have not been saved',
    appearanceHint: 'Personalize your window and display language.',
    startupHint: 'Manage startup behavior and the local connection.',
    logsHint: 'Inspect service output and troubleshoot issues.',
    diagnosticsHint: 'Collect environment details for troubleshooting.',
    updateHint: 'Keep your desktop experience up to date.',
    emptyProfiles: 'No profiles yet',
    emptyProfilesHint: 'Add a configuration in ~/.dsh/profiles, then reopen settings.',
    failed: 'Something went wrong. Please try again.',
    switchFailed: 'Failed to switch profile; restored previous setting.',
    copyFailed: 'Failed to copy diagnostics.',
    saving: 'Saving…',
    saved: 'Saved',
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
    openingWindow: 'Opening…',
    logs: 'Logs',
    refresh: 'Refresh',
    openLogsFolder: 'Open logs folder',
    emptyLog: '(empty)',
    emptyLogs: 'No log files available',
    logReadFailed: 'Failed to read log file; please retry.',
    retry: 'Retry',
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
type Panel = 'appearance' | 'startup' | 'profilesSection' | 'logs' | 'diagnostics' | 'update'
const panels: Panel[] = ['appearance', 'startup', 'profilesSection', 'logs', 'diagnostics', 'update']
const iconPaths: Record<Panel, string> = {
  appearance: 'M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 0-4h-1a1.5 1.5 0 0 1 0-3h3a6 6 0 0 0 0-12Z M7 9h.01 M10 6h.01 M15 6h.01',
  startup: 'M12 3v9 M6.3 5.5a8 8 0 1 0 11.4 0',
  profilesSection: 'M3 7h7l2 2h9v11H3Z M3 7V4h7l2 3h9v2',
  logs: 'M6 3h9l3 3v15H6Z M9 10h6 M9 14h6 M9 18h4',
  diagnostics: 'M3 12h4l3-8 4 16 3-8h4',
  update: 'M20 7v5h-5 M4 17v-5h5 M6 6a8 8 0 0 1 13 2 M18 18a8 8 0 0 1-13-2',
}
function Icon({ name }: { name: Panel }): React.JSX.Element {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={iconPaths[name]} /></svg>
}

function App(): React.JSX.Element {
  const [panel, setPanel] = useState<Panel>('appearance')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [settings, setSettings] = useState<DshSettings | null>(null)
  const [locale, setLocale] = useState<Locale>('zh')
  const [portDraft, setPortDraft] = useState('')
  const isPortDirty = useRef(false)
  const [logName, setLogName] = useState('dsh.stdout.log')
  const [logFiles, setLogFiles] = useState<string[]>([])
  const [logText, setLogText] = useState('')
  const [logError, setLogError] = useState('')
  const [logLoading, setLogLoading] = useState(false)
  const activeLogRequestId = useRef(0)
  const [diagnostics, setDiagnostics] = useState('')
  const [copied, setCopied] = useState(false)
  const [updateState, setUpdateState] = useState<'idle' | 'checking' | 'done'>('idle')
  const [updateResult, setUpdateResult] = useState<DshUpdateResult | null>(null)
  const [openingProfiles, setOpeningProfiles] = useState<Set<string>>(new Set())

  const text = ui[locale]
  const desktop = window.dshDesktop

  const refresh = useCallback(async (): Promise<void> => {
    if (!desktop) return
    const snapshot = await desktop.getSettings()
    setSettings(snapshot)
    setLocale(snapshot.locale)
    if (!isPortDirty.current) {
      setPortDraft(String(snapshot.port))
    }
  }, [desktop])

  useEffect(() => {
    void refresh().catch(() => setError(ui.zh.loadFailed))
    if (!desktop) return
    return desktop.onLocaleChanged(() => void refresh())
  }, [refresh, desktop])

  const loadLogs = useCallback(
    async (targetName?: string): Promise<void> => {
      if (!desktop) return
      const reqId = ++activeLogRequestId.current
      setLogLoading(true)
      setLogError('')
      try {
        const files = desktop.listLogs ? await desktop.listLogs() : []
        if (reqId !== activeLogRequestId.current) return
        setLogFiles(files)

        const selected = targetName ?? (files.includes(logName) ? logName : (files[0] ?? ''))
        if (selected !== logName) {
          setLogName(selected)
        }

        if (selected) {
          const content = await desktop.readLog(selected)
          if (reqId !== activeLogRequestId.current) return
          setLogText(content)
        } else {
          setLogText('')
        }
      } catch {
        if (reqId !== activeLogRequestId.current) return
        setLogError(text.logReadFailed)
        setLogText('')
      } finally {
        if (reqId === activeLogRequestId.current) {
          setLogLoading(false)
        }
      }
    },
    [desktop, logName, text.logReadFailed],
  )

  useEffect(() => {
    if (panel === 'logs') {
      void loadLogs()
    }
  }, [panel, loadLogs])

  const handleLogSelect = async (selected: string): Promise<void> => {
    setLogName(selected)
    if (!desktop || !selected) {
      setLogText('')
      return
    }
    const reqId = ++activeLogRequestId.current
    setLogLoading(true)
    setLogError('')
    try {
      const content = await desktop.readLog(selected)
      if (reqId === activeLogRequestId.current) {
        setLogText(content)
      }
    } catch {
      if (reqId === activeLogRequestId.current) {
        setLogError(text.logReadFailed)
        setLogText('')
      }
    } finally {
      if (reqId === activeLogRequestId.current) {
        setLogLoading(false)
      }
    }
  }

  if (!desktop) {
    return <main className="loading-state"><p role="alert">{text.loadFailed}</p></main>
  }
  if (!settings) {
    return <main className="loading-state">{error ? <p role="alert">{error}</p> : <div className="loader" />}</main>
  }

  const patch = async (changes: Partial<DshSettings>): Promise<void> => {
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      const snapshot = await desktop.setSettings(changes)
      setSettings(snapshot)
      setLocale(snapshot.locale)
      if (changes.port !== undefined && snapshot.port === changes.port) {
        isPortDirty.current = false
        setPortDraft(String(snapshot.port))
      }
      if (changes.profile && snapshot.profile !== changes.profile) {
        setError(text.switchFailed)
        setSaved(false)
      } else {
        setSaved(true)
      }
    } catch {
      setError(text.failed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="settings">
      <aside className="sidebar">
        <div className="brand"><img src="./icon.png" alt="" /><div><strong>dsh-desktop</strong><span>DeepSeek Harness</span></div></div>
        <p className="nav-label">{text.navigation}</p>
        <nav aria-label={text.title}>{panels.map((item) => <button key={item} className={panel === item ? 'nav-item active' : 'nav-item'} aria-current={panel === item ? 'page' : undefined} onClick={() => setPanel(item)}><Icon name={item} />{text[item]}</button>)}</nav>
        <div className="sidebar-footer"><span className="version-dot" />dsh-desktop <span>v{settings.appVersion}</span></div>
      </aside>
      <div className="settings-content">
        <header className="page-heading"><span className="eyebrow">{text.title} / {text[panel]}</span><h1>{text[panel]}</h1><p>{panel === 'profilesSection' ? text.profilesHint : panel === 'appearance' ? text.appearanceHint : panel === 'startup' ? text.startupHint : panel === 'logs' ? text.logsHint : panel === 'diagnostics' ? text.diagnosticsHint : text.updateHint}</p></header>
        {error && <p className="feedback error" role="alert">{error}</p>}
      <section hidden={panel !== 'appearance'}>
        <div className="section-label">{text.frameColor}</div>
        <div className="theme-options">
        <label className="theme-option">
          <input
            disabled={busy}
            type="radio"
            name="frameColor"
            checked={settings.frameColor === 'black'}
            onChange={() => void patch({ frameColor: 'black' })}
          />
          <span aria-hidden="true" className="theme-preview dark-preview"><span className="preview-bar"><i /><span>dsh-desktop</span><b>− □ ×</b></span><span className="preview-body"><i /><span><b /><b /><b /></span></span></span><span className="theme-caption">{text.black}<span className="selection-mark" /></span>
        </label>
        <label className="theme-option">
          <input
            disabled={busy}
            type="radio"
            name="frameColor"
            checked={settings.frameColor === 'white'}
            onChange={() => void patch({ frameColor: 'white' })}
          />
          <span aria-hidden="true" className="theme-preview light-preview"><span className="preview-bar"><i /><span>dsh-desktop</span><b>− □ ×</b></span><span className="preview-body"><i /><span><b /><b /><b /></span></span></span><span className="theme-caption">{text.white}<span className="selection-mark" /></span>
        </label>
        </div><div className="section-divider" /><h3>{text.language}</h3><div className="segmented">
        {(['system', 'zh', 'en'] as const).map((language) => (
          <label key={language}>
            <input
              type="radio"
              disabled={busy}
              name="language"
              checked={settings.language === language}
              onChange={() => void patch({ language })}
            />
            {language === 'system' ? text.languageSystem : language === 'zh' ? '简体中文' : 'English'}
          </label>
        ))}
        </div>
      </section>

      <section hidden={panel !== 'startup'}>
        <h2>{text.startup}</h2>
        <label>
          <input
            role="switch"
            type="checkbox"
            disabled={busy}
            checked={settings.openAtLogin}
            onChange={async (event) => {
              const checked = event.target.checked
              setBusy(true)
              setError('')
              try {
                await desktop.setOpenAtLogin(checked)
                await refresh()
              } catch {
                setError(text.failed)
              } finally {
                setBusy(false)
              }
            }}
          />
          {text.openAtLogin}
        </label>
        <label>
          <input
            role="switch"
            type="checkbox"
            checked={settings.startHidden}
            disabled={busy || !settings.openAtLogin}
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
              disabled={busy}
              onChange={(event) => {
                isPortDirty.current = true
                setPortDraft(event.target.value)
              }}
            />
          </label>
          {portDraft !== String(settings.port) && (
            <button
              className="btn"
              disabled={busy || !Number.isInteger(Number(portDraft)) || Number(portDraft) < 1 || Number(portDraft) > 65535}
              onClick={() => {
                const port = Number(portDraft)
                if (Number.isInteger(port) && port >= 1 && port <= 65535) {
                  void patch({ port })
                }
              }}
            >
              {text.save}
            </button>
          )}
        </div>
        <p className="hint">{text.portHint}</p>
      </section>

      <section hidden={panel !== 'profilesSection'}>
        <h2>{text.profilesSection}</h2>
        <p className="hint">{text.profilesHint}</p>
        <div className="profile-list">
          {settings.profiles.length === 0 && <div className="empty-state"><Icon name="profilesSection" /><strong>{text.emptyProfiles}</strong><p>{text.emptyProfilesHint}</p></div>}
          {settings.profiles.map((profile) => (
            <div className={`profile-row ${profile === settings.profile ? 'selected' : ''}`} key={profile}>
              <label>
                <input
                  type="radio"
                  disabled={busy}
                  name="profile"
                  checked={profile === settings.profile}
                  onChange={() => void patch({ profile })}
                />
                {profile}
                {profile === settings.profile && <span className="tag">{text.current}</span>}
              </label>
              {profile !== settings.profile && (
                <button
                  className="btn small"
                  disabled={busy || openingProfiles.has(profile)}
                  onClick={async () => {
                    setOpeningProfiles((prev) => new Set(prev).add(profile))
                    setError('')
                    try {
                      await desktop.openProfileWindow(profile)
                    } catch {
                      setError(text.failed)
                    } finally {
                      setOpeningProfiles((prev) => {
                        const next = new Set(prev)
                        next.delete(profile)
                        return next
                      })
                    }
                  }}
                >
                  {openingProfiles.has(profile) ? text.openingWindow : text.openWindow}
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      <section hidden={panel !== 'logs'}>
        <h2>{text.logs}</h2>
        {logError && (
          <div className="feedback error" role="alert" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>{logError}</span>
            <button className="btn" onClick={() => void loadLogs()}>
              {text.retry}
            </button>
          </div>
        )}
        <div className="row">
          <select
            aria-label={text.logs}
            value={logName}
            disabled={logLoading || logFiles.length === 0}
            onChange={(event) => void handleLogSelect(event.target.value)}
          >
            {logFiles.length === 0 ? (
              <option value="">{text.emptyLogs}</option>
            ) : (
              logFiles.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))
            )}
          </select>
          <button className="btn" disabled={logLoading} onClick={() => void loadLogs(logName)}>
            {text.refresh}
          </button>
          <button
            className="btn"
            onClick={async () => {
              try {
                await desktop.openLogsFolder()
              } catch {
                setLogError(text.failed)
              }
            }}
          >
            {text.openLogsFolder}
          </button>
        </div>
        <pre className="output">{logText || (logLoading ? '…' : (logFiles.length === 0 ? text.emptyLogs : text.emptyLog))}</pre>
      </section>

      <section hidden={panel !== 'diagnostics'}>
        <h2>{text.diagnostics}</h2>
        <div className="row">
          <button
            className="btn"
            onClick={async () => {
              setError('')
              try {
                const details = await desktop.collectDiagnostics()
                setDiagnostics(details)
                await navigator.clipboard.writeText(details)
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              } catch {
                setError(text.copyFailed)
              }
            }}
          >
            {copied ? text.copied : text.copy}
          </button>
        </div>
        {diagnostics && <pre className="output">{diagnostics}</pre>}
      </section>

      <section hidden={panel !== 'update'}>
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
              setError('')
              try {
                const res = await desktop.checkUpdate()
                setUpdateResult(res)
              } catch (err) {
                setUpdateResult({
                  current: settings.appVersion,
                  latest: null,
                  newer: false,
                  releaseUrl: null,
                  error: err instanceof Error ? err.message : String(err),
                })
              } finally {
                setUpdateState('done')
              }
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
        {['appearance', 'startup', 'profilesSection'].includes(panel) && <footer className="save-status" role="status"><span>{busy ? text.saving : panel === 'startup' && portDraft !== String(settings.port) ? text.unsaved : saved ? `✓ ${text.saved}` : text.autoSave}</span></footer>}
      </div>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
