# Graph Rules

Structural facts — call flow, dependency, schema shape — live only in `graphify-out/graph.json`, never in `knowledge/` or another rule file; that's what stops the two from drifting apart.

`knowledge/` keeps only what no parser can extract: decisions, invariants, playbooks, "why".

Never load `graph.json` or `GRAPH_REPORT.md` into context wholesale. Query it — `graphify query`/`path`/`explain` — don't read it.

`EXTRACTED` edges are ground truth. `INFERRED`/`AMBIGUOUS` edges are a pointer to a source read, not confirmation — a source read wins any disagreement with the graph.

If `graphify-out/graph.json` doesn't exist, skills fall back to grep/read silently.

Query recipes, rebuild command, install/version pinning: `docs/graph-usage.md`.
