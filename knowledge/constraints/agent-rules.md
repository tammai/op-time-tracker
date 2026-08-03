---
type: Constraint
title: Agent Rules
description: Boundaries agents must respect in this repo, beyond what lint/tests catch.
tags: [agents, constraints, guardrails]
timestamp: 2026-07-21T00:00:00Z
---

# Agent Rules

## Before touching IPC handlers / `window.openproject.*`
Read `knowledge/contracts/ipc-contract.md` and confirm the change stays additive, or that a breaking change (removing/renaming a method or field) is the explicit plan and is coordinated with the renderer in the same PR.

## Never expose the API key to the renderer
The OpenProject API key lives only in the main process (via `safeStorage`, with an `electron-store` fallback only when `safeStorage` is unavailable). It never crosses IPC, never gets logged, never gets passed as a render-side argument. See `.opencode/rules/security.md`.

## Never let raw OpenProject server shapes reach the renderer
Every OpenProject response goes through a Zod schema in `src/main/schemas/` and is `.parse()`d in the main process before being returned over IPC. A new response shape = a new schema, first.

## Security-sensitive code
Anything touching auth (API key, base URL), secrets, or PII must have its security considerations named in the spec (`/task-workflow` has the format) before implementation starts, and goes through `.opencode/rules/security.md` before merging. The base URL is user-controlled — validate as a well-formed `http(s)` URL before use.

## Spec-before-code
Non-trivial features need an approved spec first — run `/task-workflow`. The spec must include a Security considerations section for features touching auth, secrets, PII, or untrusted input. Don't start implementation on an unapproved spec.

## Citations
- `.opencode/rules/conventions-server.md`, `.opencode/rules/security.md` — enforced rule files
- `AI_TASK_GUIDE.md` — human orientation; `/task-workflow` is the authoritative spec-gate workflow
- `knowledge/contracts/ipc-contract.md` — IPC contract policy