---
type: Index
title: Knowledge Bundle Index
description: Root map of all concept files in this bundle. Read this before non-trivial changes — summaries are self-sufficient for routine work; open a concept file only when you need more detail.
tags: [knowledge-bundle, index]
timestamp: 2026-07-21T00:00:00Z
---

# Knowledge Bundle

Root map of everything under `knowledge/`. Read this before non-trivial changes. Format: `- [Title](path) — one-line summary (sufficient for routine reads)`.

## Meta
- [Knowledge Bundle Spec](/meta/knowledge-bundle-spec.md) — frontmatter schema, folder layout, linking, and staleness rules

## Contracts
- [IPC Contract](/contracts/ipc-contract.md) — `src/preload/types.ts` is the source of truth for the renderer↔main surface; main process leads with additive changes, Zod schemas back the types

## Domains
- [OpenProject Response Shapes](/domains/openproject-response-shapes.md) — how HAL+JSON responses vary in practice (null link hrefs, duration strings) and why the Zod schemas are strict only on fields the UI reads

## Playbooks
- [Packaging for Distribution](/playbooks/packaging-distribution.md) — unsigned macOS universal DMG + Windows x64 installer, released from CI on a tag; why renderer libs must stay in `devDependencies`, and what signing would change

## Constraints
- [Agent Rules](/constraints/agent-rules.md) — what agents must check before touching IPC handlers, credentials, or security-sensitive code

## Log
- [Bundle Log](/log.md) — one entry per sprint summarizing changes to the bundle