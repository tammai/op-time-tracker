# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Governance — hard security rules, task workflow, path-scoped conventions — lives in [AGENTS.md](./AGENTS.md) and `.claude/rules/`. Authoritative there, not repeated here.

@AGENTS.md

## Commands

Node ≥22, pnpm only. `pnpm test` is watch mode — use `--run` to run once.

| Purpose       | Command                                                          |
|---------------|------------------------------------------------------------------|
| dev · build   | `pnpm dev` · `pnpm build`                                        |
| test          | `pnpm test --run` · one file: `pnpm test --run tests/main/openproject/client.test.ts` · one case: `pnpm test --run -t "strips userinfo"` |
| typecheck     | `pnpm type-check` — runs `tsconfig.json` **and** `tsconfig.test.json` |
| lint · format | `pnpm lint` · `pnpm lint --fix`                                  |

`.git/hooks/pre-commit` → `scripts/pre-commit.sh`: lint → type-check → test → `tools/context_budget.mjs` → `tools/knowledge_validate.mjs`. CI runs the same set. Never `--no-verify` — the bash guard blocks it.

## Dual harness

Claude Code reads `CLAUDE.md` + `.claude/rules/` + `.claude/guards/*.mjs`; OpenCode reads `AGENTS.md` + `.opencode/rules/` + `.opencode/plugins/bigin-guards.ts`. **`.claude/rules/*.md` are symlinks to `.opencode/rules/*.md`** — one source of truth, so editing either path changes both. Source comments cite the `.opencode/rules/…` path.

## Layout

Four trees built by `electron-vite`. Tree-specific conventions and gotchas live in the path-scoped rules, which load when you open those files — read them rather than guessing.

- `src/main/` — Node backend: `index.ts` (window + handler registration), `ipc/`, `openproject/client.ts` (the single fetch wrapper), `schemas/` (Zod), `credentials/`.
- `src/preload/` — `index.ts` (contextBridge marshalling only) + `types.ts` (the IPC contract).
- `src/renderer/` — the Vue SPA. App code sits one level deeper, under `src/renderer/src/`; see `.claude/rules/conventions-frontend.md`.
- `src/shared/` — imported by both main and renderer (`validation/`, `utils/time.ts`). Cross-tree pure logic goes here; not mentioned in AGENTS.md.
- `tests/` mirrors the source tree, plus `tests/support/` and `tests/fixtures/`.

Aliases (defined per-tree in `electron.vite.config.ts`, mirrored in `vitest.config.ts` and every tsconfig): `@main/*`, `@preload/*`, `@shared/*`, `@renderer/*`, `@opentracker/preload`, `~~/*` (repo root, used by tests).

## Request flow

```
component → composables/queries/<domain>.ts   [Pinia Colada]
          → window.openproject.<method>()     [preload bridge]
          → ipcMain.handle('op:openproject:…')[src/main/ipc/]
          → getCredentials() + new OpenProjectClient(creds)
          → fetch + Zod .parse()              → validated shape to renderer
```

The Zod schema in `src/main/schemas/` is the single source of truth for both the runtime validator and the renderer's TS type. A new resource goes: schema → client method → IPC handler → preload `types.ts` + `index.ts` → query composable.

## Repo-wide constraints

- **Two typecheck projects.** `tsconfig.json` is a reference shell (`files: []`) over `tsconfig.node.json` (main/preload/shared) and `tsconfig.web.json` (renderer); `tsconfig.test.json` covers `tests/`. An error can be invisible in one project and fatal in another — hence two passes.
- **Harness scripts are lint-excluded**: `.claude/**`, `.opencode/**`, `tools/**`, `scripts/**`, `knowledge/**`, `graphify-out/**` in `eslint.config.js`.
- **`PLAN.md` is a disposable working file** — written on spec approval, deleted when the task ships. The spec-gate guard blocks edits >20 lines (outside tests/docs/config) unless it exists with `Status: approved`.
- **Budget gate.** `tools/context_budget.mjs` caps `CLAUDE.md` and `AGENTS.md` at 60 lines each and always-loaded harness text at 12 000 chars, and fails the commit. Prefer adding detail to a path-scoped rule over this file.
- **`knowledge/`** = domain knowledge (what/why), rules = conventions (how), `graphify-out/` = structural facts you query rather than read (`docs/graph-usage.md`). A behavior-changing PR updates the related concept file.
