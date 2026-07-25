import { defineQueryOptions } from '@pinia/colada'

import type { StatusCollection } from '@opentracker/preload'

/**
 * Statuses domain query options.
 *
 * Per `.opencode/rules/conventions-frontend.md` ("Server State: Pinia Colada"):
 * - One file per domain under `composables/queries/<domain>.ts`.
 * - Keys are defined once here (never hand-written inline in components).
 *   Format: `['<domain>', '<scope>', ...params]`.
 * - The query is the **only** place `window.openproject.*` is called —
 *   components consume this composable, never the bridge directly, so the
 *   Colada cache (and invalidation) stays wired.
 * - No Pinia store wrapping `useQuery` — Colada's cache already lives in
 *   Pinia; wrapping it duplicates state and breaks lifecycle tracking.
 *
 * Types come from the preload contract (`@opentracker/preload`), which
 * re-exports the Zod schemas in `src/main/schemas/` — the single source of
 * truth. The renderer never sees raw server shapes.
 *
 * The statuses list takes no filters (the status set is small and
 * instance-wide), so a single stable key `['statuses', 'list']` is all
 * that's needed — Colada caches it for the session.
 */
export const statusQueries = {
  list: defineQueryOptions(() => ({
    key: ['statuses', 'list'],
    query: () => window.openproject.listStatuses()
  }))
}

export type StatusListQuery = typeof statusQueries.list
export type { StatusCollection }