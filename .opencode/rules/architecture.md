---
paths:
  - "src/main/**"
  - "src/preload/**"
  - "src/renderer/**"
---
# Architecture Rules

## Domain Boundaries
- Each domain owns its data — no cross-domain direct DB queries or direct imports.
- Cross-domain communication via service interfaces only.

## Dependency Direction
IPC handlers → openproject client → schemas/validators → safeStorage/credentials
Never reverse. The credentials module must never import an IPC handler.

## IPC Contract (replaces the Nuxt BFF contract)
- The narrowly-typed `window.openproject.*` surface (declared in `src/preload/index.ts` and typed in `src/preload/types.ts`) is the contract between renderer and main process.
- The main process leads with backward-compatible (additive) IPC changes. Adding a new method or optional field is fine; removing/renaming an existing method or field is a breaking change — coordinate with the renderer in the same PR.
- Renderer types come from Zod schemas in `src/main/schemas/` (re-exported via `src/preload/types.ts`), never hand-written inline. The schema is the single source of truth for both the validator and the TS type.

## Electron Layers & Boundaries
- **Renderer** (`src/renderer/`) = Vue 3 + Vite SPA shown in the Electron window. Vue components, composables, Pinia stores, Nuxt UI v4. No Node APIs, no direct HTTP to OpenProject.
- **Preload** (`src/preload/`) = the `contextBridge` surface. Exposes only narrowly-typed methods on `window.openproject.*`. No business logic — just marshalling to IPC channels.
- **Main** (`src/main/`) = the desktop app backend. Owns: window lifecycle, OpenProject HTTP client, Zod schemas, credential storage (safeStorage / electron-store), IPC handlers.
- No business logic in renderer components — composables or Pinia stores only.
- Composables in `src/renderer/composables/`. Shared utilities in `src/renderer/utils/`. Pinia stores in `src/renderer/stores/`.
- Views in `src/renderer/views/` — routing only, delegate to composables for data/logic.

## [Electron] Security Boundary (replaces the Nuxt BFF Boundary)
- `src/main/ipc/` is the **sole caller** of the external OpenProject REST API. The renderer never calls OpenProject directly.
- The OpenProject API key lives in the OS keychain (main-process only via `safeStorage`). It never reaches the renderer, never crosses IPC, never gets logged.
- OpenProject responses are Zod-validated in the **main process** before being handed to the renderer — the renderer never sees raw server shapes.
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` on every `BrowserWindow`. The preload script exposes only the typed bridge.