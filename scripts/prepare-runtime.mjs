import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'

const require = createRequire(import.meta.url)

function prepareElectronRuntime() {
  try {
    const electronPath = require('electron')
    if (typeof electronPath === 'string' && existsSync(electronPath)) {
      // Electron runtime is already downloaded and ready.
      return true
    }
  } catch (error) {
    console.error('[prepare-runtime] Error resolving Electron runtime:', error instanceof Error ? error.message : error)
  }

  console.error('[prepare-runtime] Electron binary is missing or could not be downloaded.')
  console.error('[prepare-runtime] Troubleshooting:')
  console.error('  1. Check your network or proxy settings.')
  console.error('  2. In regions with restricted GitHub access, configure ELECTRON_MIRROR:')
  console.error('     ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" pnpm install')
  console.error('  3. You can manually test download via: node -e "require(\'electron\')"')
  return false
}

if (!prepareElectronRuntime()) {
  process.exit(1)
}
