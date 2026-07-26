# OpenProject Time Tracker

Electron desktop app for tracking OpenProject time entries. Vue 3 + TypeScript renderer bundled via Vite (`electron-vite`).

## Commands

| Purpose   | Command            |
|-----------|--------------------|
| dev       | `pnpm dev`         |
| test      | `pnpm test --run`  |
| lint      | `pnpm lint`        |
| format    | `pnpm lint --fix`  |
| typecheck | `pnpm type-check`  |
| build     | `pnpm build`       |
| package   | `pnpm dist`        |

## Packaging for distribution

`pnpm dist` builds and packages a **macOS universal** app (Apple Silicon +
Intel) into `release/`:

- `OP Time Tracker-<version>-universal.dmg` — the one to hand out.
- `OP Time Tracker-<version>-universal-mac.zip` — same bundle, for anyone who'd
  rather not mount a disk image.

Config lives in `electron-builder.yml`. `pnpm dist:dir` skips the DMG/zip and
leaves an unpacked `.app` for a quick local check. Bump `version` in
`package.json` for each build you share — it names the artifact and shows in the
app's settings footer.

Only `electron-store` and `zod` are runtime `dependencies`; everything the
renderer uses is bundled by Vite and therefore belongs in `devDependencies`.
Adding a renderer library to `dependencies` ships it — and its platform
binaries — inside the app, which is how a build first fails on `@esbuild/*`
during the universal merge.

Windows and Linux targets aren't configured. Cross-building either from macOS is
unreliable; it wants a CI runner or a real machine.

### The build is unsigned — what recipients see

There is no Apple Developer ID in play, so macOS quarantines the download and
the first launch is refused ("damaged or can't be opened"). Once per install:

1. Drag the app to `/Applications`.
2. Right-click it → **Open** → **Open** in the dialog. (Or, in a terminal:
   `xattr -dr com.apple.quarantine "/Applications/OP Time Tracker.app"`.)

That is a genuine trade-off, not just a nag screen: recipients get no
cryptographic evidence that the app came from you unmodified, so send the DMG
over a channel they already trust and tell them the checksum
(`shasum -a 256 release/*.dmg`) out of band. To remove the step entirely, see
`knowledge/playbooks/packaging-distribution.md` for what a Developer ID +
notarization would change.

## Architecture

- `src/main/` — Electron main process (window lifecycle, IPC handlers).
- `src/preload/` — `contextBridge` exposing a typed `window.openproject.*` surface.
- `src/renderer/` — Vue 3 + Vite SPA shown inside the Electron window.

See `AGENTS.md` and `.opencode/rules/` for conventions and security boundaries.

## AI Onboarding

This repo runs a **dual harness**: Claude Code reads `CLAUDE.md` + `.claude/rules/` + `.claude/guards/`; OpenCode reads `AGENTS.md` + `.opencode/rules/` + `.opencode/plugins/`. The rule files are shared — `.claude/rules/*.md` are symlinks to `.opencode/rules/*.md`, so edit either path and both tools see the change.

1. Clone the repo and install dependencies (`pnpm install`).
2. Run `claude` in the repo root and accept the workspace trust dialog — this repo ships a `.claude/settings.json` with pre-approved permissions, which Claude Code only applies after you trust the folder. (If the dialog doesn't appear, or you're on a headless setup, set `hasTrustDialogAccepted: true` for this path in `~/.claude.json`.)
3. Install the git hook:
   ```sh
   ln -sf ../../scripts/pre-commit.sh .git/hooks/pre-commit && chmod +x scripts/pre-commit.sh
   ```
4. Verify gates pass: `pnpm lint && pnpm type-check && pnpm test --run`
5. Read `CLAUDE.md` → use `/task-workflow` (or read `AI_TASK_GUIDE.md`) for the per-task workflow.
6. Do one scoped task end-to-end through all gates to confirm the setup works.

### Runtime hygiene
- Run `/clear` between unrelated tasks to reset context and avoid token accumulation.
- Pipe long command output: `long-cmd | head -50` to avoid flooding context.
- Delegate broad scans (grep across the repo, full test suites) to subagents rather than running them inline.

## Context Budget

Run `/context` after setup and record the harness token footprint. Run `node tools/context_budget.mjs` for the automated budget check — it counts `CLAUDE.md` + `AGENTS.md` + unscoped rule files (rule dirs deduped by realpath, since they're symlinked).

| Date | Always-loaded tokens (est.) | Budget status |
|------|-----------------------------|---------------|
| 2026-07-25 | ~2 383 | Pass (9 532 / 12 000 chars) |