# AGENTS.md

Stack: Electron desktop app · Vue 3 + TypeScript renderer (Vite) · Nuxt UI v4 · Pinia · VueUse · Zod · Vitest
Auth: OpenProject API key (stored in OS keychain via Electron `safeStorage`)
Runtime: Node ≥22 · pnpm only

## Architecture note
This is **not** a Nuxt web app. The nuxt profile templates are adapted here to an Electron context:
- **Renderer** (`src/renderer/`) = the Vue 3 + Vite SPA shown inside the Electron window. Uses Nuxt UI v4 as a Vue component library (not Nuxt's auto-import + SSR pipeline — manual plugin install + Tailwind layer). Treat this tree like the nuxt profile's `app/` tree.
- **Main process** (`src/main/`) = the Node.js backend of the desktop app. Owns all OpenProject HTTP calls, credential storage, and IPC handlers. Treat this tree like the nuxt profile's `server/` tree — the **sole caller** of the external OpenProject REST API. The renderer never makes HTTP calls to OpenProject directly.
- **Preload** (`src/preload/`) = the `contextBridge` between main and renderer. Exposes only narrowly-typed IPC methods — never a generic fetch, never the API key.
- `electron-vite` builds all three. There is no Nitro/Cloudflare Pages runtime.

## Commands
| Purpose   | Command            |
|-----------|--------------------|
| dev       | `pnpm dev`         |
| test      | `pnpm test --run`  |
| lint      | `pnpm lint`        |
| format    | `pnpm lint --fix`  |
| typecheck | `pnpm type-check`  |
| build     | `pnpm build`       |

## Rules
See `.opencode/rules/` — path-scoped conventions, security, architecture.

## Hard Rules (non-negotiable)
- No `--no-verify`. No `eslint-disable` without a justifying comment. No weakening eslint config to pass checks.
- No `@ts-ignore` or `as any` without a justifying comment.
- The OpenProject API key is a **secret**. It lives only in the main process and the OS keychain (Electron `safeStorage`), with an `electron-store` fallback only when `safeStorage.isEncryptionAvailable()` returns false. It is never written to disk in plaintext, never logged, never exposed to the renderer.
- All OpenProject HTTP requests are made by the **main process**. The renderer communicates only via `contextBridge`-exposed, narrowly-typed IPC (`window.openproject.*`) — never a generic fetch, never the key itself.
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` on the renderer. The preload script exposes only the typed bridge.
- User-controlled OpenProject base URL is validated as a well-formed `http(s)` URL before use.
- OpenProject responses are parsed and schema-validated (Zod) in the **main process** before being handed to the renderer — never trust raw server shapes.
- `.opencode/plugins/bigin-guards.ts` enforces the bash guard, spec gate, and injection gate below — don't try to work around it; fix the underlying issue instead.

## Task workflow
Non-trivial features: /task-workflow.