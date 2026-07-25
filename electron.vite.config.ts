import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import ui from '@nuxt/ui/vite'
import { fileURLToPath, URL } from 'node:url'
import { readFileSync } from 'node:fs'

/**
 * `package.json` is the single source of truth for the version + author shown
 * in the settings footer (`src/renderer/src/utils/app-info.ts`). Read here and
 * injected as `define` constants so the renderer needs no IPC round-trip for
 * static build metadata. Mirrored in `vitest.config.ts`.
 */
const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8')
) as { version: string; author?: string | { name?: string; email?: string } }

const appInfoDefine = {
  __APP_VERSION__: JSON.stringify(pkg.version),
  __APP_AUTHOR__: JSON.stringify(
    typeof pkg.author === 'string' ? pkg.author : (pkg.author?.name ?? '')
  ),
  __APP_AUTHOR_EMAIL__: JSON.stringify(
    typeof pkg.author === 'string' ? '' : (pkg.author?.email ?? '')
  )
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: fileURLToPath(new URL('./src/main/index.ts', import.meta.url))
      }
    },
    resolve: {
      alias: {
        '@main': fileURLToPath(new URL('./src/main', import.meta.url)),
        '@preload': fileURLToPath(new URL('./src/preload', import.meta.url)),
        '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
        '~~': fileURLToPath(new URL('.', import.meta.url))
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: fileURLToPath(new URL('./src/preload/index.ts', import.meta.url))
      },
      rollupOptions: {
        output: {
          // Sandbox mode (`sandbox: true` in webPreferences) restricts the
          // preload to a CommonJS-compatible environment. ESM preloads
          // (`index.mjs`) silently fail to expose the contextBridge surface.
          // The root package.json has `"type": "module"`, so `.js` would be
          // parsed as ESM too — output `.cjs` to force CommonJS parsing.
          format: 'cjs',
          entryFileNames: 'index.cjs'
        }
      }
    },
    resolve: {
      alias: {
        '@preload': fileURLToPath(new URL('./src/preload', import.meta.url)),
        '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
        '~~': fileURLToPath(new URL('.', import.meta.url))
      }
    }
  },
  renderer: {
    root: fileURLToPath(new URL('./src/renderer', import.meta.url)),
    base: './',
    define: appInfoDefine,
    build: {
      outDir: fileURLToPath(new URL('./out/renderer', import.meta.url))
    },
    resolve: {
      alias: {
        '@renderer': fileURLToPath(new URL('./src/renderer/src', import.meta.url)),
        '@opentracker/preload': fileURLToPath(new URL('./src/preload/index.ts', import.meta.url)),
        '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
        '~~': fileURLToPath(new URL('.', import.meta.url))
      }
    },
    plugins: [
      vue(),
      // Nuxt UI v4 as a Vue plugin (non-Nuxt). `root` points at the project root so the
      // generated `.nuxt-ui` theme templates land in the top-level `node_modules`, which
      // Tailwind scans (the renderer's `root` is `src/renderer`, so the default would bury
      // them where Tailwind can't see them — `bg-default`/`ring-default` would vanish).
      // `router: false` because this is an Electron SPA with no vue-router.
      ui({
        root: fileURLToPath(new URL('.', import.meta.url)),
        router: false,
        ui: {
          colors: {
            primary: 'blue',
            neutral: 'slate'
          }
        }
      })
    ]
  }
})