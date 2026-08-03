# AI Task Guide

The workflow for every non-trivial task is the `task-workflow` skill: run `/task-workflow`, or
just describe the task ("implement X", "fix the bug in Y") and it triggers on its own. It owns the
authoritative version of every step, spec format, and `PLAN.md` layout — if this file and the skill
ever disagree, the skill wins.

## What it does, so you know what you're approving

1. **Scope** — one sentence on what's changing, before any code.
2. **Spec gate** — a spec you approve in chat first. Skipped for bug fixes, copy/config tweaks, and
   changes ≤20 lines of logic.
3. **Plan file** — the approved spec plus a task table, written to `PLAN.md`.
4. **Implement/verify loop** — a routed implementer subagent does the work; a separate read-only
   verifier audits the diff against `PLAN.md`. Capped at 3 rounds, then it stops and asks you.
5. **Review** — offers `/code-review`, plus `/security-review` for auth/secrets/PII/untrusted input.
   Neither runs without your say-so.
6. **Cleanup** — `PLAN.md` is deleted once everything is `Done`. It's a working file, not docs.

## Why `PLAN.md` matters to you

`.claude/guards/spec-gate-guard.mjs` blocks `Edit`/`Write` on non-trivial changes until `PLAN.md`
exists and contains `Status: approved`. That's the gate — approving the spec is what unblocks
implementation. It also checks `PLAN.md`'s `Branch:` line against the branch you're on, so a plan
left over from an earlier task can't quietly approve edits for a new one.
Layout, task statuses, and the opt-in full-spec tier: `/task-workflow`.

This repo runs a dual harness, so the same gate exists twice: `.opencode/plugins/bigin-guards.ts`
enforces it for OpenCode. Both read the same root `PLAN.md` — a spec approved once unblocks either.

## Scope discipline

If implementation turns out to need changes outside the approved scope, the workflow stops and asks
rather than expanding silently. A second task beats a sprawling first one.
