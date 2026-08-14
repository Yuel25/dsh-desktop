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
- 关闭窗口后驻留托盘，退出时清理本应用启动的 DSH 进程
- 检测已有的 `127.0.0.1:3080` 服务并直接连接
- 保存 DSH 源码目录，支持登录 Windows 后自动启动
- 记录 DSH 标准输出和错误日志
- 生成 Windows NSIS 安装包

## 当前状态

`0.1.0` 是第一阶段预览版。目前应用仍然依赖：

- Windows x64
- Node.js `^22.19.0` 或 `>=24.0.0`（推荐 Node.js 24）
- 已完成依赖安装和构建的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 源码目录

应用尚未内置 Node.js 与 DSH 运行时。首次启动安装版时，需要选择本机的 `deepseek-harness` 目录。

## 快速开始

### 1. 准备 DeepSeek Harness

```powershell
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
```

如果需要社区 Web UI 插件，请先按插件自己的说明安装到 DSH 的 `web` profile。

### 2. 运行 dsh-desktop

从 [GitHub Releases](https://github.com/Yuel25/dsh-desktop/releases) 下载 Windows 安装包，安装并启动。首次运行时选择上一步的 `deepseek-harness` 目录。

如果 DSH 已经监听 `127.0.0.1:3080`，应用会连接现有实例；否则应用会使用系统 Node.js 启动：

```text
node --import tsx/esm apps/cli/src/bin.ts web
```

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

1. 端口已存在且服务可用：连接现有 DSH，不取得该进程的所有权。
2. 端口不可用：从用户选择的源码目录启动 DSH，并在应用退出时清理该进程树。
3. 后端就绪后：窗口从本地加载页切换到 DSH Web UI。

日志保存在 Electron 的用户日志目录。可从托盘菜单选择“查看日志”。

## 安全说明

- DSH Web UI 默认只绑定 `127.0.0.1`。
- Electron renderer 禁止 Node.js 集成并启用上下文隔离。
- 外部链接交给系统默认浏览器打开。
- 应用不会在卸载时删除 `~/.dsh` 或 DSH 会话数据。

如发现安全问题，请参阅 [SECURITY.md](SECURITY.md)。

## 路线图

- 内置受控 Node.js 运行时
- 打包 DSH 构建产物，不再依赖源码目录
- 设置界面与运行时诊断
- 自动更新和签名发布
- 完善安装、升级、卸载测试

## 贡献

请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。提交更改前请运行 `pnpm run check`。

## 许可证与品牌资产

项目代码使用 [MIT License](LICENSE)。DeepSeek Harness 官网图标不属于 MIT 许可范围，详情见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
