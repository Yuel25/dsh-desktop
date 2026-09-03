import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { transformSync } from 'esbuild'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../src/main')
const nativeRequire = createRequire(import.meta.url)

// Run production TypeScript, replacing environment boundaries rather than logic.
export function loadMain(name, mocks = {}, globals = {}) {
  const cache = new Map()
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports
    const module = { exports: {} }
    cache.set(filename, module)
    const code = transformSync(readFileSync(filename, 'utf8'), {
      loader: 'ts', format: 'cjs', target: 'es2022', sourcefile: filename,
    }).code
    vm.runInNewContext(code, {
      module, exports: module.exports,
      require(specifier) {
        if (Object.hasOwn(mocks, specifier)) return mocks[specifier]
        if (specifier.startsWith('.')) return load(resolve(dirname(filename), specifier.replace(/\.js$/, '.ts')))
        return nativeRequire(specifier)
      },
      __dirname: dirname(filename), Buffer, URL, AbortSignal, console,
      setTimeout, clearTimeout, setImmediate, process: { env: {} }, ...globals,
    }, { filename })
    return module.exports
  }
  return load(resolve(root, name + '.ts'))
}
