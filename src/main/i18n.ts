import { app } from 'electron'
import type { Locale } from './types.js'

export const messages = {
  trayOpen: { zh: '打开 dsh-desktop', en: 'Open dsh-desktop' },
  trayOpenBrowser: { zh: '在浏览器中打开', en: 'Open in browser' },
  traySettings: { zh: '设置…', en: 'Settings…' },
  trayRestart: { zh: '重启 dsh-desktop', en: 'Restart dsh-desktop' },
  trayDownloadUpdate: { zh: '下载新版本 v{0}', en: 'Download v{0}' },
  trayQuit: { zh: '退出', en: 'Quit' },
  statusConnectingExisting: {
    zh: '检测到已运行的 DSH（profile：{0}），正在连接…',
    en: 'Found a running DSH (profile: {0}), connecting…',
  },
  statusConnectingUnknown: {
    zh: '检测到已运行的 DSH（无法确认其 profile），正在连接…',
    en: 'Found a running DSH (profile unknown), connecting…',
  },
  statusStarting: { zh: '正在启动 DeepSeek Harness…', en: 'Starting DeepSeek Harness…' },
  statusStartingProfile: { zh: '正在启动 profile「{0}」…', en: 'Starting profile "{0}"…' },
  statusRecovering: { zh: 'DSH 意外退出，正在自动恢复（{0}/{1}）…', en: 'DSH exited unexpectedly; recovering ({0}/{1})…' },
  statusReady: { zh: 'DSH 已就绪，正在打开界面…', en: 'DSH is ready, opening the UI…' },
  statusReadyProfile: { zh: 'profile「{0}」已就绪，正在打开界面…', en: 'Profile "{0}" is ready, opening the UI…' },
  statusSwitching: { zh: '正在切换到 profile「{0}」…', en: 'Switching to profile "{0}"…' },
  statusSwitchFailedRestore: { zh: '切换失败，正在恢复 profile「{0}」…', en: 'Switch failed, restoring profile "{0}"…' },
  statusSwitchFailedRestoreFail: { zh: '恢复 profile 失败：{0}', en: 'Failed to restore the profile: {0}' },
  statusPortBusy: {
    zh: '端口 {0} 被外部启动的 DSH 占用，无法切换 profile。',
    en: 'Port {0} is held by an externally started DSH; cannot switch profiles.',
  },
  statusDshMissing: {
    zh: '未检测到 dsh 命令，请先安装 DeepSeek Harness。',
    en: 'The dsh command was not found; install DeepSeek Harness first.',
  },
  errorUntrusted: { zh: '该 API 仅对本地页面开放。', en: 'This API is only available to local pages.' },
  errorExitedEarly: { zh: 'DSH 在就绪前退出（退出码 {0}）。', en: 'DSH exited before becoming ready (code {0}).' },
  errorNotReadyTimeout: { zh: 'DSH 在 {0} 秒内未就绪。', en: 'DSH did not become ready within {0} seconds.' },
  errorAttachCancelled: {
    zh: '已取消连接使用 profile「{0}」的现有 DSH。',
    en: 'Cancelled connecting to the existing DSH with profile "{0}".',
  },
  errorCancelled: { zh: '操作已取消。', en: 'Operation cancelled.' },
  errorExternalHttp: { zh: '仅允许打开 http/https 链接。', en: 'Only http/https URLs can be opened.' },
  dialogProfileMismatchTitle: { zh: 'profile 不一致', en: 'Profile mismatch' },
  dialogProfileMismatchMessage: {
    zh: '端口 {0} 上已运行的 DSH 使用 profile「{1}」，与当前选择的「{2}」不一致。',
    en: 'The DSH on port {0} runs profile "{1}", which differs from the selected "{2}".',
  },
  dialogProfileMismatchDetail: {
    zh: '该 DSH 不是 dsh-desktop 启动的，无法替它切换 profile。可以连接现有实例，或关闭它后重试。',
    en: 'This DSH was not started by dsh-desktop, so its profile cannot be switched. Attach to it, or close it and retry.',
  },
  dialogAttach: { zh: '连接现有实例', en: 'Attach' },
  dialogCancel: { zh: '取消', en: 'Cancel' },
  dialogSwitchBlockedTitle: { zh: '无法切换 profile', en: 'Cannot switch profile' },
  dialogSwitchBlockedMessage: {
    zh: '端口 {0} 上的 DSH 由外部启动，dsh-desktop 无法替它切换 profile。',
    en: 'The DSH on port {0} was started externally; dsh-desktop cannot switch its profile.',
  },
  dialogSwitchBlockedDetail: {
    zh: '已切回 profile「{0}」。请关闭外部 DSH 后再试。',
    en: 'Reverted to profile "{0}". Close the external DSH and retry.',
  },
  dialogSwitchFailedTitle: { zh: '切换 profile 失败', en: 'Failed to switch profile' },
  dialogSwitchFailedMessage: {
    zh: '无法启动 profile「{0}」：{1}',
    en: 'Could not start profile "{0}": {1}',
  },
  dialogSwitchFailedRestored: {
    zh: '已恢复原 profile「{0}」。',
    en: 'Restored the previous profile "{0}".',
  },
  dialogSwitchFailedRestoreFail: {
    zh: '恢复原 profile 也失败了。请检查日志：{0}',
    en: 'Restoring the previous profile also failed. Check the logs: {0}',
  },
  dialogRecoveryFailedTitle: { zh: 'DSH 自动恢复失败', en: 'DSH auto-recovery failed' },
  dialogRecoveryFailedMessage: {
    zh: '已尝试 {0} 次，仍无法恢复 DSH。',
    en: 'DSH could not be recovered after {0} attempts.',
  },
  dialogRendererFailedTitle: { zh: '界面自动恢复失败', en: 'UI auto-recovery failed' },
  dialogRendererFailedMessage: {
    zh: '界面多次崩溃，请从托盘重启 dsh-desktop。',
    en: 'The UI crashed repeatedly; restart dsh-desktop from the tray.',
  },
  dialogLogsDetail: { zh: '请检查日志：{0}', en: 'Check the logs: {0}' },
  notifyUpdateTitle: { zh: 'dsh-desktop 有新版本', en: 'dsh-desktop update available' },
  notifyUpdateBody: { zh: 'v{0} 已发布，可从托盘菜单下载。', en: 'v{0} is available from the tray menu.' },
  notifyRecoveredTitle: { zh: 'DSH 已自动恢复', en: 'DSH recovered automatically' },
  notifyRecoverFailedTitle: { zh: 'DSH 自动恢复失败', en: 'DSH auto-recovery failed' },
} satisfies Record<string, { zh: string; en: string }>

export type MessageKey = keyof typeof messages

export function getSystemLocale(): Locale {
  return app.getLocale().toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

let activeLocale: Locale = 'zh'

export function setActiveLocale(locale: Locale): void {
  activeLocale = locale
}

export function getActiveLocale(): Locale {
  return activeLocale
}

export function t(key: MessageKey, ...args: (string | number)[]): string {
  const messageGroup = messages[key] as Record<Locale, string>
  let text: string = messageGroup[activeLocale]
  args.forEach((arg, index) => {
    text = text.replaceAll(`{${index}}`, String(arg))
  })
  return text
}
