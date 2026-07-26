---
type: Contract
title: IPC Contract
description: src/preload/types.ts is the source of truth for the typed renderer↔main process surface (window.openproject.*). Main process leads with additive changes; Zod schemas back the types.
resource: src/preload/types.ts
tags: [ipc, contract, electron, preload]
timestamp: 2026-07-21T00:00:00Z
---

# IPC Contract

`src/preload/types.ts` (re-exported from `src/main/schemas/`) is the source of truth for every method on `window.openproject.*` — the typed `contextBridge` surface between the renderer and the main process. See `.opencode/rules/architecture.md` for the additive-first change policy.

## Rules
- Main process leads with backward-compatible (additive) IPC changes. Adding a new method or optional field is fine.
- Breaking change = removing/renaming an existing method or field on `window.openproject.*`. Coordinate with the renderer in the same PR.
- Renderer types come from Zod schemas in `src/main/schemas/` — the schema is the single source of truth for both the validator (`.parse()`) and the TS type (`z.infer`). Never hand-write the TS type separately.
- The renderer never sees raw OpenProject server shapes — only the parsed, Zod-validated output the main process hands back over IPC.

## Read vs write surface
The bridge was read-only until the single-screen redesign. It now carries full CRUD on time entries — `createTimeEntry`, `updateTimeEntry`, `deleteTimeEntry` — plus `listTimeEntryActivities` to feed the form's required Activity select (OpenProject rejects an entry with no activity).

Invariants specific to the write path:
- **Numeric ids only across IPC** — never hrefs or paths. The main process Zod-validates the input (`Create`/`Update`/`DeleteTimeEntryInputSchema`) and builds every `_links` href itself, so no renderer string reaches a request URL. The update/delete entry `id` is the only renderer value reaching a request *path*, and it is a validated positive integer before it gets there.
- **`updateTimeEntry` is a full replacement, not a partial patch.** Every field is sent, so an omitted `comment` clears the stored one — the only way clearing is expressible when the field is optional. A caller sending just the changed fields would blank the rest.
- **HTTP 422 is the one case where a server-authored string reaches the renderer**, because the user needs to know which field OpenProject refused. Only the schema-declared `message` fields are forwarded, length-capped — never the raw body. Everything else still follows the "generic message" rule.
- Errors add two codes: `OPENPROJECT_INVALID_INPUT` (our own validation, pre-request) and `OPENPROJECT_VALIDATION_FAILED` (the 422). Update and delete also surface `OPENPROJECT_NOT_FOUND` for an entry that is gone or invisible to the configured key.
- **`deleteTimeEntry` returns nothing** — OpenProject answers 204 with an empty body. It is irreversible; there is no server-side undo, so the UI confirms before calling it.

## Credential read-back
There is still no getter for the API key. `getConnectionInfo()` returns only `{ baseUrl, hasApiKey }` — the URL is not secret, `hasApiKey` is presence only — so the settings form can prefill what's configured without the key ever crossing IPC. Consequently `apiKey` is **optional** on `saveCredentials` and `testConnection`: blank means "use/keep the stored key", resolved inside the main process. A blank key with nothing stored is a validation error.

## Drift gate
CI (or the local pre-commit gate) runs `pnpm lint && pnpm type-check && pnpm test --run`. A type mismatch between `src/preload/types.ts` and `src/main/schemas/` shows up as a typecheck failure.

**Known gap:** `pnpm type-check` does **not** currently cover the renderer — `vue-tsc -p tsconfig.json` on a solution-style config with `files: []` checks nothing, and `tsconfig.web.json`'s `@renderer/*` path mapping is missing the inner `src/`. Renderer-side contract drift is therefore caught only by `pnpm build`, not by the typecheck gate.

## Citations
- `src/preload/types.ts` — repo, the actual contract
- `.opencode/rules/architecture.md` — IPC contract policy + dependency direction
- `.opencode/rules/conventions-server.md` — Zod schema + IPC handler conventions