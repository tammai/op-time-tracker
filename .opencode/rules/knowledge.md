# Knowledge Bundle Rules

`knowledge/` holds domain knowledge — what the system is and why. Rules (`.opencode/rules/`) hold how we work. Don't mix the two.

## Before non-trivial changes
Read `knowledge/index.md`. The one-line summaries there are usually sufficient. Open a concept file only when the index summary is insufficient for the change at hand — don't read concept files preemptively.

## Writing or updating a concept file
- One concept per file, kebab-case name, under `knowledge/<folder>/`.
- Frontmatter is required: `type` (one of Index, Contract, System, Domain, Table, Metric, Playbook, Constraint, Log), plus `title`, `description`, `tags`, `timestamp` when relevant.
- Link relationships with bundle-relative Markdown links (e.g. `/contracts/openapi-contract.md`).
- Claims from an external source get a `# Citations` section.
- Keep it under ~60 lines. Terse beats complete.

## Link, don't copy
Concept files point to sources of truth (`src/preload/types.ts`, `.opencode/rules/`, source code) — they never duplicate that content. If you're about to paste code or a schema into `knowledge/`, link to it instead.

## Staleness
A PR that meaningfully changes behavior updates the related concept file(s) in the same PR. Add one entry to `knowledge/log.md` per sprint.

Full spec: `knowledge/meta/knowledge-bundle-spec.md`.