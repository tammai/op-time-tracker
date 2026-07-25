import { defineQuery, defineQueryOptions, useQuery } from '@pinia/colada'
import { computed } from 'vue'
import type {
  WorkPackageCollection,
  WorkPackageFilters
} from '@opentracker/preload'

import {
  PRIMARY_STATUSES,
  isPriorityWorkPackage,
  sortByStatusPriority
} from '@renderer/utils/work-package-filter'

import { statusQueries } from './statuses'

/**
 * Work Packages domain query options.
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
 */

/**
 * Query options for the work packages list. The key includes the full
 * `filters` object so distinct pagination offsets / page sizes cache
 * separately and don't collide across pages.
 *
 * `filters` is a **plain** object — never a `ref` or getter. Reactivity is the
 * caller's job: pass the whole factory call inside a getter,
 * `useQuery(() => workPackageQueries.list({ … }))`, the form
 * `defineQueryOptions` documents. Calling the factory eagerly freezes the key
 * at setup, so a filter change would never rekey or refetch.
 */
export const workPackageQueries = {
  list: defineQueryOptions((filters?: WorkPackageFilters) => ({
    key: ['work-packages', 'list', filters ?? {}],
    query: () => window.openproject.listWorkPackages({ filters })
  })),

  /**
   * Search by work-package id **prefix**, for the picker's search box. The
   * main process resolves it by fetching the candidate ids directly (see
   * `searchWorkPackagesByIdPrefix`), so there is no pagination to pass and no
   * assignee/status narrowing — the point is to reach items the priority list
   * doesn't include.
   *
   * Keyed on the term, so each one caches separately and re-typing a term is
   * free. `term` must already be a valid `WorkPackageSearchTermSchema` value;
   * callers gate on `enabled` rather than passing a partial term.
   */
  search: defineQueryOptions((term: string) => ({
    key: ['work-packages', 'search', term],
    query: () => window.openproject.listWorkPackages({ filters: { search: term } })
  }))
}

export type WorkPackageListQuery = typeof workPackageQueries.list

/**
 * How many priority items are loaded in one go. There is no pagination by
 * design, so this is the hard ceiling on what the select offers — generous
 * enough that a normal assignee list fits entirely. `isTruncated` below says
 * when it didn't.
 */
const PRIORITY_PAGE_SIZE = 100

/**
 * The user's priority work packages — the options for the time-entry form's
 * work-package select.
 *
 * `defineQuery` (not a bare `useQuery`) so the status resolution below
 * happens once per app rather than once per mounting component, and so the
 * resolved list survives the day modal closing and reopening.
 *
 * Status titles → IDs: OpenProject's work-package `status` filter `=`
 * operator requires status resource **IDs**, not titles (titles yield HTTP
 * 400), so the always-on statuses query resolves `PRIMARY_STATUSES` first
 * and the list query is gated on it via `enabled`. If the instance doesn't
 * use those titles — or the statuses query fails — the filter is dropped
 * and the priority set is applied client-side instead, so the user always
 * sees something.
 */
export const usePriorityWorkPackages = defineQuery(() => {
  const { data: statusesData, status: statusesStatus } = useQuery(
    statusQueries.list()
  )

  /** Lowercased status `name` → status resource `id`. */
  const statusTitleToId = computed(() => {
    const map = new Map<string, number>()
    for (const s of statusesData.value?._embedded.elements ?? []) {
      map.set(s.name.toLowerCase(), s.id)
    }
    return map
  })

  /** `PRIMARY_STATUSES` resolved to stringified IDs; missing titles dropped. */
  const resolvedStatusIds = computed(() =>
    PRIMARY_STATUSES.map((title) => statusTitleToId.value.get(title.toLowerCase()))
      .filter((id): id is number => id !== undefined)
      .map((id) => String(id))
  )

  /** True once the statuses query has settled (either way). */
  const statusesLoaded = computed(() => statusesStatus.value !== 'pending')

  // The options factory call sits inside the getter `useQuery` takes, so the
  // filters (and therefore the key) re-derive once the status IDs resolve.
  const query = useQuery(() => {
    const statuses = resolvedStatusIds.value
    const filters: WorkPackageFilters = {
      onlyMine: true,
      pageSize: PRIORITY_PAGE_SIZE,
      // No IDs resolved → omit the filter and narrow client-side below.
      ...(statuses.length > 0 ? { statuses } : {})
    }
    return {
      ...workPackageQueries.list(filters),
      // Don't fire before the status IDs are known, or the first request would
      // fetch the wrong slice and immediately be superseded.
      enabled: statusesLoaded.value
    }
  })

  /**
   * Priority items, ordered by status priority. When the server already
   * filtered by status ID there is nothing left to narrow; in the fallback
   * path (no IDs resolved) the priority set is applied here.
   */
  const items = computed(() => {
    const list = query.data.value?._embedded.elements ?? []
    const filtered =
      resolvedStatusIds.value.length > 0 ? list : list.filter(isPriorityWorkPackage)
    return sortByStatusPriority(filtered)
  })

  /** True while the *first* load is in flight (no data yet). */
  const isInitialLoading = computed(
    () => query.status.value === 'pending' && query.data.value === undefined
  )

  /**
   * True when the server reported more items than one page holds. Nothing
   * surfaces it since the drawer (which showed a "showing the first N"
   * notice) was removed — kept so the select can say so rather than
   * silently offering a truncated list.
   */
  const isTruncated = computed(
    () => (query.data.value?.total ?? 0) > items.value.length
  )

  return { ...query, items, isInitialLoading, isTruncated }
})

export type { WorkPackageCollection, WorkPackageFilters }