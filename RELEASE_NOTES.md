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
