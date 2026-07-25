---
type: Constraint
title: Knowledge Bundle Spec
description: Frontmatter schema, folder layout, linking, and staleness rules for the knowledge/ bundle.
tags: [knowledge-bundle, meta, spec]
timestamp: 2026-07-21T00:00:00Z
---

# Knowledge Bundle Spec

Internal convention inspired by [Open Knowledge Format v0.1](https://openknowledgeformat.com). We own this spec — no OKF tooling dependency.

## Purpose
`knowledge/` answers "what the system is and why." Skills/rules (`.opencode/rules/`) answer "how we work." Don't mix the two.

## Structure
- One concept per Markdown file, under `knowledge/` (the bundle root).
- **Every** `.md` file under `knowledge/` is a concept file with valid frontmatter — no freeform docs, no exceptions.
- Folders group by kind: `contracts/`, `domains/`, `constraints/`, `meta/`, etc. Add folders as needed.
- Filenames: kebab-case, singular concept per file (`ipc-contract.md`, not `contracts.md`).
- Bundle-relative links resolve against `knowledge/` (e.g. `/contracts/ipc-contract.md` = `knowledge/contracts/ipc-contract.md`).

## Frontmatter schema
Required:
- `type` — one of: `Index`, `Contract`, `System`, `Domain`, `Table`, `Metric`, `Playbook`, `Constraint`, `Log`

Recommended:
- `title`, `description`, `resource` (external URL/path this concept documents), `tags` (array), `timestamp` (ISO 8601, bumped on meaningful edits)

Extension keys are allowed but must not collide with the above.

## Linking & citations
- Relationships between concepts = bundle-relative Markdown links.
- Concept files **add context and point to sources of truth** (`src/preload/types.ts`, `.opencode/rules/`, source code) — never duplicate their content. Link, don't copy.
- Any claim depending on an external source (paper, RFC, vendor doc, incident report) gets a `# Citations` section listing the source.

## Staleness policy
- Any PR that meaningfully changes behavior must update the related concept file(s) in the same PR.
- `knowledge/log.md` (type: Log) gets one entry per sprint summarizing what changed in the bundle.
- Concept files not linked from `knowledge/index.md` are stale by definition — the validator warns on these.

## Validation
`tools/knowledge_validate.mjs` enforces: valid frontmatter + `type` on every file, `type` in the allowed list, all bundle-relative links resolve, `timestamp` is valid ISO 8601 when present. Missing `description`/`tags` and index-unreachable files are warnings, not failures.