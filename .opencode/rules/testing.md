---
paths:
  - "tests/**"
  - "vitest.config.ts"
  - "vitest.*.config.ts"
---
# Testing Conventions

## Location
Tests live under `tests/`, mirroring the source tree — never co-located with source.
- `src/main/schemas/work-packages.ts` → `tests/main/schemas/work-packages.test.ts`
- `src/renderer/utils/foo.ts` → `tests/renderer/utils/foo.test.ts`
- `src/main/ipc/openproject.work-packages.ts` → `tests/main/ipc/openproject.work-packages.test.ts`

`vitest.config.ts`'s `test.include` is scoped to `tests/**/*.test.ts` — a stray `*.test.ts` next to source silently won't run.

## Imports
Cross-tree imports (test → source) use the `~~/` root alias (configured in `vitest.config.ts`'s `resolve.alias`), never relative paths — a test's directory depth mirrors source depth, so `../../../src/...` is fragile and breaks on any tree reshuffle.

```ts
// tests/main/schemas/work-packages.test.ts
import { WorkPackagesSchema } from '~~/src/main/schemas/work-packages'
```

## Electron auto-imports
Main-process tests run outside Electron's runtime — `ipcMain`, `BrowserWindow`, `safeStorage` aren't globally available. Stub them via a shared `tests/support/` helper (`tests/support/electron-mock.ts`), not per-test.

Mock only the true I/O boundary — `fetch` (or the OpenProject client's HTTP layer), `safeStorage`, `electron-store`. Wire real implementations of internal collaborators (your own schemas, validators, calendar aggregation) instead of mocking them — mocking internals couples tests to implementation and hides real breakage.

Two mechanics make this work; both are load-bearing:
- `vitest.config.ts` sets `server.deps.inline: ['electron', 'electron-store', 'conf']` so `vi.mock('electron')` also intercepts the `electron` import that `electron-store` performs internally. Without inlining, Vite pre-bundles the real `electron` (which throws outside an Electron runtime) and bypasses the mock.
- The stub is loaded with `require('../../support/electron-mock.ts')` **inside `vi.hoisted`**, not a top-level `import` — `vi.mock` factories and `vi.hoisted` callbacks are hoisted above imports and cannot reference import bindings. Read the header comment in `tests/support/electron-mock.ts` before writing a new main-process test.

## In-process vs IPC
- Pure logic (Zod schemas, calendar aggregation, URL validation) → unit tests, no Electron mock needed.
- IPC handlers → integration tests with `fetch`/`safeStorage` mocked, asserting the handler parses + validates + returns the right shape (and rejects the wrong ones).