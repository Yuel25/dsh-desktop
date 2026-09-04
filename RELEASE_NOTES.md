# dsh-desktop v1.2.4

## 中文

- 启动页、加载动画和错误提示跟随已保存的黑色／白色外观预设。
- 校验 Profile 名称和配置类型，修复 Windows CMD 回退启动中含空格路径及参数的处理。
- 对新写入日志的启动认证 token 进行流式脱敏，覆盖跨数据块和超长内容；历史日志不自动改写。
- 修复连续崩溃的恢复次数限制，以及恢复启动失败后未继续重试的问题；稳定运行 30 秒后重置计数。
- 页面重新加载后恢复启动提示和安装引导，避免错误页变成持续加载状态。
- 日志按需读取，区分空日志与权限错误，并防止旧请求覆盖当前内容。
- 补充开发环境 Electron 运行时准备步骤。
- 验证：类型检查、49 项自动化测试和生产构建通过，包含 Windows CMD 实际参数传递测试。

## English

- Match startup screens, loading indicators, and error guidance to the saved black/white appearance preset.
- Validate profile names and configuration types; fix Windows CMD fallback launches with spaces in paths and arguments.
- Redact launch authentication tokens from newly written logs, including split and oversized values. Existing logs are not rewritten.
- Bound repeated crash recovery, retry failed recovery launches, and reset the counter after 30 seconds of stable operation.
- Restore startup status and installation guidance after page reloads.
- Load logs on demand, distinguish empty logs from permission errors, and prevent stale responses from replacing current content.
- Prepare the Electron runtime before development and preview launches.
- Validated with type checks, 49 automated tests, and a production build, including real Windows CMD argument handling.

# dsh-desktop v1.2.3

## 中文

- 新增 GitHub 自动发布流程：推送稳定版本标签后，自动检查、构建并发布 Windows x64 安装包。
- 发布附带对应版本的更新说明、安装包 blockmap 和 SHA256 校验文件。
- 支持手动补发已有版本标签，保护已发布的正式 Release 不被覆盖。
- 包含 v1.2.2 的鲸鱼娘图标与中英文 README 更新。

## English

- Add automatic GitHub Releases for stable version tags, with checks and Windows x64 installer builds.
- Include version-specific release notes, installer blockmaps, and SHA256 checksums.
- Support manual publishing of existing tags without overwriting published releases.
- Include the whale-girl icon and bilingual README updates from v1.2.2.

# dsh-desktop v1.2.2

## 中文

- 更换为全新的蓝色鲸鱼娘应用图标，统一窗口、托盘、通知、启动加载页、设置页及安装包的图标资源。
- 中英文 README 同步展示新图标。
- 验证：类型检查、24 项自动化测试和生产构建通过。

## English

- Introduce a blue whale-girl application icon shared by windows, the tray, notifications, startup and settings pages, and installer builds.
- Update the icon displayed in both Chinese and English READMEs.
- Validated with type checks, 24 automated tests, and a production build.

# dsh-desktop v1.2.1

- 修复新版 DSH 启用浏览器认证后桌面界面无法加载的问题，自动读取并使用当前实例的启动认证链接。
- 主窗口、独立 profile 窗口及自动恢复均使用对应实例的链接；停止主实例时清除旧链接。
- HTTP 401/403/404 不再视为就绪；未认证的外部实例显示处理提示，已认证的桌面会话可继续连接。
- 验证：类型检查、24 项自动化测试，以及使用真实 DSH 的 Electron 认证与页面加载测试。

English:
- Fix blank desktop pages with authenticated DSH versions by consuming each instance's launch URL.
- Support authentication for the main window, profile windows, and recovered processes; clear the primary launch URL when its instance is stopped.
- Reject HTTP 401/403/404 as readiness signals. Show actionable guidance for unauthorized external instances and reuse existing authorized desktop sessions.
- Validated with type checks, 24 automated tests, and a real DSH/Electron authentication and UI smoke test. The Windows installer upgrade was also verified locally.

# dsh-desktop v1.2.0

## 中文

- 全新浅色设置界面：侧栏分类导航、标题栏颜色预览、小窗口适配和保存状态反馈。
- 修复独立 profile 窗口首次显示、重复打开、关闭与恢复竞态，以及重启时的进程清理。
- 区分运行端口与配置端口；profile 切换失败时正确回滚并提示。
- 收紧页面导航、重定向和外部链接校验；完善 DSH 安装检测和启动错误处理。
- DSH 输出日志持续写入时按 5 MiB 轮转，最多保留 3 份备份；优先清理超出目录预算的历史日志。
- 设置采用临时文件替换写入，保存失败时恢复原配置并保留端口草稿。
- 更新检查增加 15 秒超时；新增直接验证生产模块的回归测试。
- 合并远程 Electron 44、TypeScript 7 和 CI 依赖更新。

Windows x64 安装包。应用仍需预先安装并配置 Windows 中的 DeepSeek Harness `dsh` 命令。

发布验证：17 项生产模块回归测试、类型检查和生产构建通过；使用隔离配置及模拟本地服务验证了打包内容的启动、设置页、语言切换、标题栏颜色和桥接隔离。未执行真实 DSH 故障注入或安装向导交互测试。

## English

- Redesigned settings with light sidebar navigation, title bar previews, compact-window support, and save feedback.
- Fixed profile window visibility, duplicate opens, recovery/close races, and process cleanup on restart.
- Kept active and configured ports separate, with accurate profile-switch rollback feedback.
- Hardened navigation, redirects, and external links; improved DSH discovery and startup error handling.
- Added continuous 5 MiB output-log rotation with three backups and historical-log budget pruning.
- Added atomic settings replacement with failure rollback and preservation of unsaved port input.
- Added a 15-second update timeout and regression tests that execute production modules.
- Included upstream Electron 44, TypeScript 7, and CI dependency updates.

Windows x64 installer. A working DeepSeek Harness `dsh` installation on Windows is still required.
