---
paths:
  - "src/main/**"
  - "src/preload/**"
---
# Main Process Conventions

This is the desktop app's backend — the **sole caller** of the external OpenProject REST API. Treat it like the nuxt profile's `server/` tree.

## Naming
- IPC handlers: kebab-case channel names (`op:openproject:list-work-packages`)
- Modules: camelCase files, PascalCase exported classes/interfaces

## IPC Boundary (replaces the Nuxt BFF proxy)
`src/main/ipc/` is the sole caller of the OpenProject REST API. The renderer communicates only via `contextBridge`-exposed, narrowly-typed IPC (`window.openproject.*`) — no auth headers, no OpenProject URL, no API key in the renderer.

```ts
// src/main/ipc/openproject.work-packages.ts
import { ipcMain } from 'electron'
import { getCredentials } from '../credentials'
import { fetchWorkPackages } from '../openproject/client'
import { WorkPackagesSchema } from '../schemas/work-packages'

ipcMain.handle('op:openproject:list-work-packages', async (_event, filters) => {
  const { baseUrl, apiKey } = await getCredentials()
  const raw = await fetchWorkPackages(baseUrl, apiKey, filters)
  return WorkPackagesSchema.parse(raw) // Zod-validated before reaching the renderer
})
```

## Zod Schemas
Define every OpenProject response shape as a Zod schema in `src/main/schemas/`. The renderer never sees raw server shapes — only the parsed, validated output.
- One schema file per resource: `work-packages.ts`, `time-entries.ts`, etc.
- Export both the schema and the inferred type: `export type WorkPackage = z.infer<typeof WorkPackageSchema>`.
- Never `as` a server response into a TS type — always `.parse()`.

## Auth (main process)
- Credentials read via `getCredentials()` from `src/main/credentials.ts` — the only module allowed to touch `safeStorage` / `electron-store`.
- The API key is never passed across IPC, never logged, never written to disk in plaintext. See `.opencode/rules/security.md`.
- The OpenProject base URL is validated as a well-formed `http(s)` URL before any request is built from it.

## Preload build format
The preload **must** build as CommonJS `index.cjs`. `sandbox: true` restricts the preload to a CJS-compatible environment (ESM preloads silently fail to expose the `contextBridge` surface), and the root `package.json` has `"type": "module"`, so a `.js` preload would be parsed as ESM too. See `rollupOptions.output` in `electron.vite.config.ts` and the matching path in `src/main/index.ts` — changing either without the other breaks the bridge with no error.

## IPC errors
Throw an `Error` subclass (`IpcError` from `src/main/ipc/error.ts`) — never a plain `{ code, message }` object. `ipcMain.handle` preserves `Error.message`/`name` across IPC but serializes plain objects to `[object Object]`. Normalize through `toIpcError()` so the API key, auth header, and raw response body never reach the renderer.

## HTTP client
- One `src/main/openproject/client.ts` — the single fetch wrapper. Centralizes base URL handling, `Authorization: Basic <base64("apikey:<key>")>`, timeouts, and error normalization.
- All responses go through Zod before being returned to an IPC handler. Validation errors throw and surface as a typed IPC error to the renderer (never as raw server JSON).