import { defineConfig } from 'vitest/config'
import { fileURLToPath, URL } from 'node:url'
import { readFileSync } from 'node:fs'

// Mirrors the `define` block in `electron.vite.config.ts` (duplicated the same
// way the aliases below are) so `@renderer/utils/app-info` resolves the same
// build constants under test as it does in the app.
const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8')
) as { version: string; author?: string | { name?: string; email?: string } }

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_AUTHOR__: JSON.stringify(
      typeof pkg.author === 'string' ? pkg.author : (pkg.author?.name ?? '')
    ),
    __APP_AUTHOR_EMAIL__: JSON.stringify(
      typeof pkg.author === 'string' ? '' : (pkg.author?.email ?? '')
    )
  },
  test: {
    include: ['tests/**/*.test.ts'],
    globals: false,
    passWithNoTests: true,
    // Inline `electron` + `electron-store` (+ `conf`, the store's engine) so
    // `vi.mock('electron')` in main-process integration tests intercepts the
    // `electron` import that `electron-store` performs internally. Without
    // inlining, Vite pre-bundles `electron-store` and bakes in the real
    // `electron` (which throws on import outside a real Electron runtime),
    // bypassing the mock. Inlining routes these deps through Vite's
    // transform pipeline where `vi.mock` applies. See `tests/support/
    // electron-mock.ts`.
    server: {
      deps: {
        inline: ['electron', 'electron-store', 'conf']
      }
    }
  },
  resolve: {
    alias: {
      '@renderer': fileURLToPath(new URL('./src/renderer/src', import.meta.url)),
      '@main': fileURLToPath(new URL('./src/main', import.meta.url)),
      '@preload': fileURLToPath(new URL('./src/preload', import.meta.url)),
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
      '@opentracker/preload': fileURLToPath(new URL('./src/preload/index.ts', import.meta.url)),
      '~~': fileURLToPath(new URL('.', import.meta.url))
    }
  }
})