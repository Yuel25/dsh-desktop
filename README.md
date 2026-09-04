<p align="center">
  <img src="assets/icon.png" width="112" height="112" alt="dsh-desktop 鲸鱼娘图标">
</p>

<h1 align="center">dsh-desktop</h1>

<p align="center">面向 Windows 的 DeepSeek Harness 桌面客户端。</p>

<p align="center"><a href="README.en.md">English</a> · 中文</p>

<p align="center">
  <a href="https://github.com/Yuel25/dsh-desktop/actions/workflows/ci.yml"><img src="https://github.com/Yuel25/dsh-desktop/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
</p>

> [!IMPORTANT]
> 本项目是社区开发的非官方桌面客户端，与 DeepSeek 官方无隶属、背书或合作关系。

## 功能

- 在无命令行窗口的情况下启动和管理 `dsh web`
- 使用 Electron 窗口承载 DeepSeek Harness Web UI
- 自定义无边框标题栏、系统托盘和单实例运行（标题栏显示当前 profile），托盘菜单保持精简
- 可从系统托盘安全重启桌面应用及其启动的 DSH 服务
- 可在设置中选择黑色或白色标题栏，并自动保存选择；启动页、加载动画和错误提示同步跟随该预设
- 可在设置中切换 DSH profile（扫描 `~/.dsh/profiles`），切换时仅重启 DSH 服务
- 可为任意 profile 打开独立窗口，多个 profile 并行运行（各自使用独立端口）
- 内置设置窗口：外观与语言、开机自启（可隐藏到托盘）、DSH 端口、profile 管理
- 内置日志查看器与「复制诊断信息」（应用版本、dsh 版本、当前 profile 等）
- 启动时自动检查新版本，有新版本时托盘会出现下载入口并发系统通知
- DSH 服务或界面意外崩溃时自动恢复，并通过系统通知告知结果
- 检测已有的 `127.0.0.1:3080` 服务，识别其 profile 后再连接；不一致时会提示
- 未安装 dsh 时显示安装引导页，可一键重试或打开文档
- 界面与通知支持中英双语，可在设置中跟随系统或手动切换
- 关闭窗口后驻留托盘，退出时清理本应用启动的 DSH 进程
- 记录 DSH 标准输出和错误日志（主实例与各 profile 窗口分文件记录）
- 生成 Windows NSIS 安装包

## 当前状态

目前应用依赖：

- Windows x64
- 在 Windows 中安装并加入 `PATH` 的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) `dsh` 命令

应用尚未内置 DSH 运行时，而是启动 Windows 中现有的 DSH 安装。

## 快速开始

### 1. 在 Windows 中准备 DeepSeek Harness

```bash
npm install -g @deepseek-ai/dsh
dsh --version
```

如果需要社区 Web UI 插件，请先按插件自己的说明安装到 DSH 的 `web` profile。

### 2. 运行 dsh-desktop

从 [GitHub Releases](https://github.com/Yuel25/dsh-desktop/releases) 下载 Windows 安装包，安装并启动。

如果 DSH 已经监听 `127.0.0.1:3080`，应用会识别其 profile 并连接现有实例（与所选 profile 不一致时会先询问）；否则应用会直接启动：

```text
dsh --profile web --no-open
```

## 切换 profile

设置窗口的 Profile 区块会列出 `~/.dsh/profiles` 下所有包含 `cordis.yml` 的子目录。选择后：

- 应用只重启自己管理的 DSH 进程，无需退出桌面应用；
- 选择会保存到用户数据目录的 `settings.json`，下次启动沿用；
- 如果端口被外部启动的 DSH 占用，应用无法替它切换 profile，会提示并保持原选择。

列表中每个非当前 profile 旁的「新窗口」按钮会为它启动一个独立的 DSH 实例（自动分配空闲端口）并打开独立窗口；关闭该窗口即结束对应的 DSH 进程。每个实例的日志单独记录为 `dsh.<profile>.stdout.log` / `dsh.<profile>.stderr.log`。

## 设置与诊断

托盘菜单只保留高频操作（打开、浏览器打开、设置、重启、退出），其余选项都在设置窗口中。设置窗口包含：

设置使用浅色侧栏导航，可按类别切换页面；标题栏颜色提供可视预览，并显示保存状态。窗口缩小时，导航和内容可独立滚动。

- **外观**：标题栏黑/白与语言切换，即时生效；
- **启动**：开机自启动（可选自启动时隐藏到托盘、后台拉起 DSH）、DSH 端口（重启应用后生效）；
- **Profile**：切换主窗口 profile，或为其他 profile 打开新窗口；
- **日志**：内置查看器（dsh 输出、错误、恢复日志及各 profile 窗口日志），也可一键打开日志文件夹；
- **诊断**：一键复制应用版本、dsh 版本、当前 profile、运行端口和配置端口等信息，方便反馈问题；
- **更新**：手动检查新版本并打开发布页。启动时也会自动检查一次，有新版本时通过系统通知提醒。

DSH 输出日志在持续写入时按 5 MiB 轮转，每份日志最多保留 3 个历史文件；目录超过 50 MiB 时优先清理历史日志，保留活动日志。设置文件采用临时文件替换写入，保存失败会返回错误并恢复内存中的原配置，未保存的端口输入会保留。

## 本地开发

```powershell
pnpm install
pnpm run dev
```

> [!NOTE]
> `pnpm run dev` 与 `pnpm run preview` 会在启动前自动调用 `scripts/prepare-runtime.mjs` 检查并准备 Electron 运行时。如处于网络受限环境，可配置 `ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"`。亦可单独执行 `pnpm run prepare:runtime` 预先完成准备。

常用命令：

```powershell
pnpm run prepare:runtime # 校验并准备 Electron 运行时
pnpm run typecheck       # TypeScript 检查
pnpm run test            # 运行自动化单元与生命周期测试
pnpm run build           # 生产构建
pnpm run check           # 类型检查 + 自动化测试 + 生产构建
pnpm run dist            # 生成 Windows NSIS 安装包
```

构建产物位于 `release/`，该目录不会提交到 Git。

## 运行机制

Electron 主进程负责窗口、托盘和 DSH 子进程生命周期。启动时会先检查 `127.0.0.1:3080`：

1. 端口已存在且服务可用：通过监听进程的命令行识别其 profile，一致则连接现有 DSH，不取得该进程的所有权；不一致时提示用户选择。
2. 端口不可用：在 Windows 中启动 `dsh --profile <name> --no-open`，并在应用退出时终止本应用启动的进程。
3. 后端就绪后：窗口从本地加载页切换到 DSH Web UI。

日志保存在 Electron 的用户日志目录。可从托盘菜单选择“查看日志”。

新版 DSH 启用浏览器认证时，桌面客户端会读取所启动实例输出的认证链接，自动完成认证；各 profile 窗口和自动恢复后的新实例分别使用对应链接。HTTP 401/403/404 不再视为就绪。若连接外部启动的 DSH 且桌面客户端尚未认证，请关闭外部实例后点击重试，由桌面客户端启动服务。

## 安全说明

- DSH Web UI 默认只绑定 `127.0.0.1`。
- Electron renderer 禁止 Node.js 集成并启用上下文隔离。
- 应用自身的桥接 API（如开机自启设置）只暴露给本地加载页，DSH Web 页面无法调用。
- 外部链接交给系统默认浏览器打开。
- 应用不会在卸载时删除 `~/.dsh` 或 DSH 会话数据。

如发现安全问题，请参阅 [SECURITY.md](SECURITY.md)。

## 路线图

- DSH 运行时诊断界面
- 设置界面与运行时诊断
- 自动更新和签名发布
- 完善安装、升级、卸载测试

## 贡献

请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。提交更改前请运行 `pnpm run check`。

## 许可证与品牌资产

项目代码使用 [MIT License](LICENSE)。DeepSeek Harness 官网图标不属于 MIT 许可范围，详情见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
