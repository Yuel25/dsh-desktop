# Contributing

Thank you for helping improve dsh-desktop.

## Before opening an issue

- Confirm the problem is in dsh-desktop rather than the DSH Web UI or a DSH plugin.
- Check that DeepSeek Harness runs successfully with `dsh web` on Windows.
- Search existing issues before creating a duplicate.

## Development setup

Requirements:

- Windows x64
- Node.js `^22.19.0` or `>=24.0.0`
- pnpm 11.21.0
- A working DeepSeek Harness source checkout

Install and run:

```powershell
pnpm install
pnpm run dev
```

## Pull requests

1. Keep each pull request focused on one change.
2. Do not commit `node_modules/`, `out/`, `release/`, logs, or user data.
3. Update both `README.md` and `README.en.md` when user-facing behavior changes.
4. Run the required checks:

```powershell
pnpm run check
```

5. Describe how the change was tested on Windows.

## Code style

- Keep TypeScript strict and avoid `any` unless the external interface makes narrowing impractical.
- Keep Electron renderer isolation enabled and Node.js integration disabled.
- Treat process ownership explicitly: never terminate a DSH process that dsh-desktop did not start.
- Do not commit API keys, credentials, `.env` files, DSH profiles, or session data.

## License

By contributing code, you agree that your contribution is licensed under the repository's MIT License. Do not add third-party brand assets or code without documenting their source and license.
