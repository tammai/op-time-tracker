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

## Work-package edit surface
`getWorkPackageForm`, `listAvailableAssignees` and `updateWorkPackage` make the detail panel editable. Same numeric-ids-only trust model as the time-entry writes, with three things that are **not** true of them:

- **`updateWorkPackage` is a partial update — the opposite of `updateTimeEntry`.** Only the changed fields are sent. An absent field is left alone by OpenProject; `null` (a date) or `{ href: null }` (the assignee) explicitly *clears* it. The two are not interchangeable, so the diff that decides which is which lives in one tested pure function (`src/renderer/src/utils/work-package-draft.ts`), not per-field in a template. Sending every field, as the time-entry path does, would rewrite data the user never opened.
- **`lockVersion` makes every write conditional**, and it must be the version the user actually edited — not the one a background list refetch last delivered, or the write silently overwrites whoever got there first. A stale one answers HTTP 409 → the new `OPENPROJECT_CONFLICT` code, which the renderer handles by refetching and discarding rather than retrying. (Before this, 409 fell through to the generic `OPENPROJECT_HTTP_ERROR` and could not be branched on.)
- **`getWorkPackageForm` is a POST that reads.** Its body is built in the main process and holds exactly the validated `lockVersion`; nothing renderer-supplied is forwarded, which is what stops it being a write primitive. It returns a **flattened, non-HAL** shape — `{ writable, allowedValues: { id, name }[] }` per field — so the renderer never handles an href or an `_embedded` block.

`listAvailableAssignees` takes a **`projectId`**, not a work package id. See [OpenProject Response Shapes](/domains/openproject-response-shapes.md#the-work-package-form-endpoint) for why.

## Work-package create surface
`listProjects`, `getWorkPackageCreateForm` and `createWorkPackage` add creation. Same numeric-ids-only trust model again, with four differences from the edit trio:

- **No `lockVersion` anywhere.** Nothing exists yet to be stale against, so the create form accepts an empty body and `createWorkPackage` sends no version. `OPENPROJECT_CONFLICT` cannot occur on this path.
- **`null` is not accepted on `createWorkPackage`.** On an update `null` means *clear this field* and is distinct from an absent key; on a create there is nothing to clear, so an unset field is simply omitted and OpenProject applies its own default. Two spellings of "absent" is how the clear-vs-omit bug gets in.
- **`description.format` is pinned in the main process** and never taken from the renderer, on both the create and the update path. Not defensive habit: a live instance accepted `format: "custom"` with an `html` of `<script>…</script>` and reported *no* validation error, so the server does not police it. `html` is never sent — it is the server's rendering of `raw`.
- **`listProjects` reads `/api/v3/work_packages/available_projects`**, not `/api/v3/projects`. See [OpenProject Response Shapes](/domains/openproject-response-shapes.md#creating-a-work-package). An empty collection is a real answer — this key may create nowhere — not an error.

`getWorkPackageCreateForm` is a POST that reads, like its edit sibling, and forwards only a `typeId` rebuilt in main as one href. It returns the same flattened non-HAL shape plus `defaults: { typeId, statusId, priorityId }` — OpenProject's own initial values, each `null` when the form offered none. Prefilling from those is why only project/type/subject gate the Create button.

## Shell surface
`openWorkPackageInBrowser({ workPackageId })` is the one channel that hands a URL to the **operating system** rather than to OpenProject. It is on a separate `op:shell:*` channel prefix, handled by `src/main/ipc/shell.ts`, and makes no HTTP request at all.

- **A number crosses IPC, never a URL.** The id is Zod-validated as a positive integer *before credentials are read*; every other key on the input is ignored. The main process builds `<baseUrl>/work_packages/<id>` itself from the **stored** base URL.
- **Never from `_links.self.href`.** That field is server-supplied, so a hostile instance could otherwise carry an arbitrary href straight into `shell.openExternal`.
- **http(s) is re-asserted at the sink**, after the credential schema has already enforced it — so a hand-edited store cannot turn this into a `file:`/`smb:` launch.
- This handler reads `getConnectionInfo()`, not `getCredentials()`: it needs only the non-secret base URL, so the API key is never decrypted on this path and never appears in the opened URL.
- Codes: `SHELL_INVALID_INPUT`, `SHELL_UNSAFE_TARGET`, `SHELL_OPEN_FAILED`, plus `CREDENTIAL_NOT_CONFIGURED` when no usable URL is stored.

`toIpcError()` passes an already-constructed `IpcError` through unchanged, which is what lets a handler raise its own typed code without it being flattened to `OPENPROJECT_UNKNOWN`.

## Identity
`getCurrentUser()` (`GET /api/v3/users/me`) returns the `Principal` the stored key authenticates as. **It takes no input, and that is the security property** — the identity is the key's, so there is nothing for the renderer to name and no value that could steer the request.

Used only to default the create form's assignee, and the id is matched against `listAvailableAssignees` before it is applied: the key's owner is not necessarily a member of every project they can create in, and an id with no matching option would render a blank select that the create is then refused for. Not being assignable is ordinary — the fallback is unassigned and silent, and a failed identity lookup costs the default, never the create.

## Credential read-back
There is still no getter for the API key. `getConnectionInfo()` returns only `{ baseUrl, hasApiKey }` — the URL is not secret, `hasApiKey` is presence only — so the settings form can prefill what's configured without the key ever crossing IPC. Consequently `apiKey` is **optional** on `saveCredentials` and `testConnection`: blank means "use/keep the stored key", resolved inside the main process. A blank key with nothing stored is a validation error.

## Drift gate
CI (or the local pre-commit gate) runs `pnpm lint && pnpm type-check && pnpm test --run`. A type mismatch between `src/preload/types.ts` and `src/main/schemas/` shows up as a typecheck failure.

`pnpm type-check` runs the three real projects explicitly — `tsconfig.node.json` (main/preload/shared), `tsconfig.web.json` (renderer, `.vue` included), `tsconfig.test.json` (tests). Renderer-side contract drift is caught by the gate, not just by `pnpm build`.

Do **not** replace those three with `-p tsconfig.json`: that config is `files: []` plus `references`, and `-p` does not follow references, so it silently checks nothing. That is exactly how the renderer went unchecked before — a deliberate `.vue` type error passed the gate. `--build` would follow them but fails here, because the node and web projects both own `src/shared/**` and collide on declaration emit; splitting a `tsconfig.shared.json` out is the prerequisite for ever using it.

## Citations
- `src/preload/types.ts` — repo, the actual contract
- `.opencode/rules/architecture.md` — IPC contract policy + dependency direction
- `.opencode/rules/conventions-server.md` — Zod schema + IPC handler conventions