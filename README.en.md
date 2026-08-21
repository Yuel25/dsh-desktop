<p align="center">
  <img src="assets/icon.png" width="112" alt="dsh-desktop whale icon">
</p>

<h1 align="center">dsh-desktop</h1>

<p align="center">A Windows desktop client for DeepSeek Harness.</p>

<p align="center">English · <a href="README.md">中文</a></p>

<p align="center">
  <a href="https://github.com/Yuel25/dsh-desktop/actions/workflows/ci.yml"><img src="https://github.com/Yuel25/dsh-desktop/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
</p>

> [!IMPORTANT]
> This is an unofficial community project. It is not affiliated with, endorsed by, or sponsored by DeepSeek.

## Features

- Starts and manages `dsh web` without a console window
- Hosts the DeepSeek Harness Web UI in an Electron window
- Provides a custom frameless title bar, system tray, and single-instance behavior
- Safely restarts the desktop app and its owned DSH service from the system tray
- Offers a persistent black or white title bar selectable from the system tray
- Automatically recovers from DSH service and renderer crashes and records recovery logs
- Keeps running in the tray and cleans up DSH processes owned by the app on exit
- Attaches to an existing service on `127.0.0.1:3080`
- Starts DSH directly on Windows and supports launch at Windows login
- Captures DSH stdout and stderr logs
- Produces a Windows NSIS installer

## Current status

The app currently requires:

- Windows x64
- The [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) `dsh` command installed on Windows and available on `PATH`

The DSH runtime is not bundled; the app starts the existing DSH installation on Windows.

## Quick start

Prepare DeepSeek Harness on Windows:

```bash
npm install -g @deepseek-ai/dsh
dsh --version
```

Download the Windows installer from [GitHub Releases](https://github.com/Yuel25/dsh-desktop/releases), install it, and launch it.

If DSH is already listening on `127.0.0.1:3080`, the app attaches to it. Otherwise, it launches DSH directly:

```text
dsh web --no-open
```

## Development

```powershell
pnpm install
pnpm run dev
```

Available checks and builds:

```powershell
pnpm run typecheck
pnpm run build
pnpm run check
pnpm run dist
```

Installer artifacts are written to `release/` and are not committed.

## Architecture

The Electron main process owns the window, tray, and DSH child-process lifecycle. At startup it probes `127.0.0.1:3080`, attaches to an existing healthy service, or starts `dsh web` on Windows. Once healthy, the window navigates from the local loading screen to the DSH Web UI.

## Security

- DSH binds to `127.0.0.1` by default.
- Node.js integration is disabled in the renderer and context isolation is enabled.
- External links open in the system browser.
- Uninstalling the app does not remove `~/.dsh` or DSH session data.

See [SECURITY.md](SECURITY.md) for vulnerability reporting guidance.

## Roadmap

- Add DSH runtime diagnostics
- Add a settings and runtime diagnostics UI
- Add signed releases and automatic updates
- Complete installer, upgrade, and uninstall testing

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) and run `pnpm run check` before submitting changes.

## License and brand assets

The project code is licensed under the [MIT License](LICENSE). The DeepSeek Harness website icon is excluded from the MIT license; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
