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
- Provides a custom frameless title bar, system tray, and single-instance behavior (the title bar shows the active profile)
- Safely restarts the desktop app and its owned DSH service from the system tray
- Offers a persistent black or white title bar selectable from the system tray
- Switches DSH profiles from the system tray (scans `~/.dsh/profiles`), restarting only the DSH service
- Opens any profile in its own window so several profiles can run in parallel on separate ports
- Built-in settings window: appearance, launch-at-login (optionally hidden), DSH port, and profile management
- Built-in log viewer and one-click diagnostics copy (app version, dsh version, active profile, …)
- Checks for updates at startup and links to the releases page from the tray
- Automatically recovers from DSH service and renderer crashes and reports the outcome through system notifications
- Attaches to an existing service on `127.0.0.1:3080`, identifying its profile first and prompting on mismatch
- Shows an install guide with a retry button when the dsh command is missing
- Bilingual UI and notifications (Chinese/English), following the system locale or set manually in settings
- Keeps running in the tray and cleans up DSH processes owned by the app on exit
- Captures DSH stdout/stderr logs (per-instance files for profile windows)
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

If DSH is already listening on `127.0.0.1:3080`, the app identifies its profile and attaches to it (prompting first on a profile mismatch). Otherwise, it launches DSH directly:

```text
dsh --profile web --no-open
```

## Switching profiles

The tray menu lists every directory under `~/.dsh/profiles` that contains a `cordis.yml`. After selecting one:

- Only the DSH process owned by the app is restarted; the desktop app keeps running.
- The choice is saved to `settings.json` in the user data directory and reused on the next launch.
- If the port is held by an externally started DSH, the app cannot switch its profile and keeps the previous selection after showing a warning.

"Open profile in new window" starts a dedicated DSH instance for that profile (on an automatically assigned free port) in its own window; closing that window stops the instance. Their logs are written to `dsh.<profile>.stdout.log` / `dsh.<profile>.stderr.log`.

## Settings and diagnostics

The tray menu's "Settings…" opens the settings window:

- **Appearance**: black or white title bar, applied immediately.
- **Startup**: launch at login (optionally hidden to the tray with DSH starting in the background) and the DSH port (applies after an app restart).
- **Profile**: switch the main window's profile or open other profiles in new windows.
- **Logs**: built-in viewer for dsh output, errors, the recovery log, and per-profile-window logs.
- **Diagnostics**: one-click copy of the app version, dsh version, active profile, and more for issue reports.
- **Update**: manual update check with a link to the releases page. An automatic check also runs at startup and notifies you when a new version is available.

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

The Electron main process owns the window, tray, and DSH child-process lifecycle. At startup it probes `127.0.0.1:3080`, identifies the profile of an existing healthy service from its command line and attaches to it (or starts `dsh --profile <name> --no-open` on Windows when the port is free). Once healthy, the window navigates from the local loading screen to the DSH Web UI.

## Security

- DSH binds to `127.0.0.1` by default.
- Node.js integration is disabled in the renderer and context isolation is enabled.
- dsh-desktop's own bridge APIs (such as the login-item settings) are exposed only to the local loading page, not to the hosted DSH web UI.
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
