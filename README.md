<p align="center">
  <img src="assets/icon.png" width="112" alt="dsh-desktop whale icon">
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
- 自定义无边框标题栏、系统托盘和单实例运行
- 可从系统托盘安全重启桌面应用及其启动的 DSH 服务
- 可从系统托盘选择黑色或白色标题栏，并自动保存选择
- 可从系统托盘切换 DSH profile（扫描 `~/.dsh/profiles`），切换时仅重启 DSH 服务
- DSH 服务或界面意外崩溃时自动恢复，失败信息写入恢复日志
- 关闭窗口后驻留托盘，退出时清理本应用启动的 DSH 进程
- 检测已有的 `127.0.0.1:3080` 服务，识别其 profile 后再连接；不一致时会提示
- 直接启动 Windows 环境中的 DSH，支持登录 Windows 后自动启动
- 记录 DSH 标准输出和错误日志
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

托盘菜单中的「切换 profile 目录」会列出 `~/.dsh/profiles` 下所有包含 `cordis.yml` 的子目录。选择后：

- 应用只重启自己管理的 DSH 进程，无需退出桌面应用；
- 选择会保存到用户数据目录的 `profile.json`，下次启动沿用；
- 如果端口被外部启动的 DSH 占用，应用无法替它切换 profile，会提示并保持原选择。

## 本地开发

```powershell
pnpm install
pnpm run dev
```

常用命令：

```powershell
pnpm run typecheck  # TypeScript 检查
pnpm run build      # 生产构建
pnpm run check      # 类型检查 + 生产构建
pnpm run dist       # 生成 Windows NSIS 安装包
```

构建产物位于 `release/`，该目录不会提交到 Git。

## 运行机制

Electron 主进程负责窗口、托盘和 DSH 子进程生命周期。启动时会先检查 `127.0.0.1:3080`：

1. 端口已存在且服务可用：通过监听进程的命令行识别其 profile，一致则连接现有 DSH，不取得该进程的所有权；不一致时提示用户选择。
2. 端口不可用：在 Windows 中启动 `dsh --profile <name> --no-open`，并在应用退出时终止本应用启动的进程。
3. 后端就绪后：窗口从本地加载页切换到 DSH Web UI。

日志保存在 Electron 的用户日志目录。可从托盘菜单选择“查看日志”。

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
