# Review Checklist

Before marking any task complete, every item must be checked.

## Gates (run these commands)
```sh
pnpm lint
pnpm type-check
pnpm test --run
```

## Code quality
- [ ] No new `@ts-ignore`, `as any`, or `eslint-disable` without a justifying comment
- [ ] No hardcoded secrets, credentials, or API keys
- [ ] No business logic in renderer components — moved to a composable or store

## Testing
- [ ] Business-logic changes have tests covering the edge cases named in the spec
- [ ] No mocking of non-I/O units (pure functions, in-process logic — Zod schemas, calendar aggregation, URL validation)
- [ ] Mock only the true I/O boundary — `fetch`/OpenProject HTTP layer, `safeStorage`, `electron-store`
- [ ] No skipped/TODO tests left without being flagged

## Security
- [ ] Every risk named in the spec's Security considerations section was actually addressed
- [ ] The OpenProject API key never crosses IPC, never gets logged, never written to disk in plaintext
- [ ] All OpenProject HTTP is in the main process; renderer uses only `window.openproject.*`
- [ ] `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` on every `BrowserWindow`
- [ ] OpenProject base URL validated as a well-formed `http(s)` URL before use
- [ ] OpenProject responses Zod-validated in the main process before reaching the renderer
- [ ] No PII logged (API key, server URL, user data — mask in logs)

## Contract
- [ ] If a new IPC method was added/changed, `src/preload/types.ts` updated to match
- [ ] If an OpenProject response shape changed, the Zod schema in `src/main/schemas/` updated first — renderer types regenerated from it
- [ ] Breaking IPC changes (removing/renaming a method or field) coordinated with the renderer in the same PR

## Scope
- [ ] Spec was approved before implementation (non-trivial features only)
- [ ] Changes are in scope — nothing extra was modified
- [ ] README / docs updated if commands or onboarding changed
- [ ] Behavior-changing PR → related knowledge/ concept updated?