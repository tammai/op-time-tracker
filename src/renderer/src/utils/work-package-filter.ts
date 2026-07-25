/**
 * Pure work-package narrowing / ordering helpers for
 * `usePriorityWorkPackages()`, which feeds the time-entry form's
 * work-package select.
 *
 * The rules are small enough to live as pure functions — no Vue, no
 * Electron, no fetch — and are unit-tested directly (see
 * `tests/renderer/utils/work-package-filter.test.ts`). The text filter and
 * badge-colour helpers that lived here went with the work-packages drawer
 * when it was removed; these three are what the query composable still uses.
 *
 * The `WorkPackage` *type* is imported type-only (erased at compile time),
 * so this module stays free of runtime dependencies.
 */

import type { WorkPackage } from '@opentracker/preload'

/**
 * Status titles treated as "priority" — the only items offered for logging.
 * These match OpenProject's common default titles and are resolved to
 * status resource **IDs** before filtering server-side (the work-package
 * `status` filter's `=` operator requires IDs, not titles).
 */
export const PRIMARY_STATUSES = ['In Progress', 'To Do']

/** Lowercased set of {@link PRIMARY_STATUSES}, for case-insensitive matching. */
export const PRIMARY_STATUSES_LOWER = new Set(
  PRIMARY_STATUSES.map((s) => s.toLowerCase())
)

/**
 * Display priority — lower index sorts first. Anything unlisted sorts
 * after the known statuses, preserving the server's relative order among
 * those (the sort is stable).
 */
const STATUS_PRIORITY = ['in progress', 'to do']

/**
 * Sort rank for a status title; unknown/missing titles rank last. `null` is
 * accepted because HAL link titles are nullable (an unset link is
 * `{ href: null, title: null }`) — the falsy guard already covers it.
 */
export function statusRank(title: string | null | undefined): number {
  if (!title) return STATUS_PRIORITY.length
  const idx = STATUS_PRIORITY.indexOf(title.toLowerCase())
  return idx === -1 ? STATUS_PRIORITY.length : idx
}

/** True when the work package's status is one of the priority statuses. */
export function isPriorityWorkPackage(wp: WorkPackage): boolean {
  const title = wp._links.status?.title?.toLowerCase()
  return title !== undefined && PRIMARY_STATUSES_LOWER.has(title)
}

/**
 * Order a list by status priority. Returns a new array — never mutates the
 * input, which is a Colada-cached query result.
 */
export function sortByStatusPriority(list: WorkPackage[]): WorkPackage[] {
  return [...list].sort(
    (a, b) =>
      statusRank(a._links.status?.title) - statusRank(b._links.status?.title)
  )
}
