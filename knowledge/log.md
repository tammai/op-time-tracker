---
type: Log
title: Knowledge Bundle Log
description: One entry per sprint summarizing changes to the knowledge bundle.
tags: [knowledge-bundle, log]
timestamp: 2026-07-21T00:00:00Z
---

# Knowledge Bundle Log

## 2026-07-26
Time entries became editable in place and movable to another day (row actions in the day modal, whole-entry PATCH because the update is a full replacement). Editing exposed that a select can only label an option it holds: the edited entry's work package is rarely in the priority suggestions, so the picker showed a bare `#12345`. Labelled from the entry's own `_links.workPackage.title` instead of a new fetch — recorded in `domains/openproject-response-shapes.md`. A second pass found the same symptom on any selected search result: `USelectMenu` resets the search term as part of selecting, so the chosen item leaves the results in the same tick and a label captured *on selection* is always a tick late. The picker now banks every subject it shows (`utils/work-package-label.ts`, pure and unit-tested).

## 2026-07-25
Work-package picker gained a server-side id search (a full 5-digit id, unfiltered by assignee, resolved by a direct `GET /api/v3/work_packages/{id}` because OpenProject 400s on an id filter whose values may not exist), which surfaced a HAL modelling bug: unset links arrive as `{ "href": null }`, so unassigned items failed the collection parse. `domains/openproject-response-shapes.md` added to record that and the other real-instance variations, plus the new schema-issue logging in `parseWithSchema`.

Single-screen redesign: the shell collapsed to one `UDashboardPanel` (calendar body, work-packages drawer, day + settings modals) and the IPC bridge gained its first write path (`createTimeEntry`, `listTimeEntryActivities`). `contracts/ipc-contract.md` updated with the read-vs-write invariants and the renderer typecheck gap found along the way.

## 2026-07-21
Bundle created: `index.md`, `contracts/ipc-contract.md`, `constraints/agent-rules.md`, `meta/knowledge-bundle-spec.md`. Validator added at `tools/knowledge_validate.mjs`. Harness set up on the Electron + Vue + Nuxt UI v4 stack (nuxt profile, adapted — no Nuxt web scaffold, no Nitro/Cloudflare Pages).