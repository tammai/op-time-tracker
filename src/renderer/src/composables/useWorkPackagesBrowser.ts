import { computed, onScopeDispose, ref, watch } from 'vue'
import { useQuery } from '@pinia/colada'
import type { WorkPackage } from '@opentracker/preload'

import {
  normalizeWorkPackageSearchTerm,
  sanitizeWorkPackageSearchInput
} from '@shared/validation/work-package-search'
import {
  useOpenWorkPackageInBrowser,
  usePrimaryStatusIds,
  workPackageQueries,
  type WorkPackageFilters
} from '@renderer/composables/queries/work-packages'
import { useStatusResolution } from '@renderer/composables/queries/statuses'
import { useWorkPackageEditor } from '@renderer/composables/useWorkPackageEditor'
import {
  decideWorkPackageSearch,
  isPriorityWorkPackage,
  sortByStatusPriority
} from '@renderer/utils/work-package-filter'

/**
 * All the state behind the work-packages browse screen: the list, the search
 * box, the status filter, and the current selection.
 *
 * It lives here rather than in `WorkPackagesModal.vue` for a specific reason
 * beyond the usual "no logic in components" rule: stage 2 makes the detail
 * panel editable (PATCH) and stage 3 adds a create form (POST). Both are
 * additions to the *panel* and a mutation in the query layer. Keeping every
 * piece of list/search/filter/selection state out here means neither stage has
 * to reopen the modal or the list to get at it.
 *
 * Reuse, not reinvention — three existing units do the load-bearing work:
 * - `usePrimaryStatusIds()` resolves the open-status titles to the resource IDs
 *   OpenProject's `status` filter demands (titles yield HTTP 400);
 * - `decideWorkPackageSearch()` decides whether a term is answered locally,
 *   sent to the server, or too short to send — the last of which is the
 *   difference between "keep typing" and "nothing matches";
 * - `workPackageQueries.search` is the same instance-wide search the time-entry
 *   picker uses.
 */

/**
 * How many items one page holds. There is no pagination by design, so this is
 * the ceiling on what the list shows; `isTruncated` says when the server had
 * more. Matches the picker's priority page size — same request, same shape.
 */
const BROWSE_PAGE_SIZE = 100

/**
 * How long the box must be idle before a term is sent to the server.
 *
 * Only reached when the loaded list answered nothing, so it paces genuine
 * misses. Local filtering is *not* debounced — it costs nothing and the common
 * case should never wait.
 */
const SEARCH_DEBOUNCE_MS = 300

/** Status-filter sentinel: the user's own open work packages (the default). */
export const STATUS_FILTER_OPEN = 'open'

/** Status-filter sentinel: the user's work packages in any status. */
export const STATUS_FILTER_ALL = 'all'

/**
 * A status-filter value: one of the two sentinels above, or a stringified
 * status resource id.
 */
export type StatusFilterValue = string

/** One option in the status-filter select. */
export interface StatusFilterOption {
  label: string
  value: StatusFilterValue
}

export function useWorkPackagesBrowser() {
  const { statuses } = useStatusResolution()
  const { statusIds: primaryStatusIds, isSettled: statusesSettled } =
    usePrimaryStatusIds()

  // ---------------------------------------------------------------------------
  // The status filter
  // ---------------------------------------------------------------------------

  const statusFilter = ref<StatusFilterValue>(STATUS_FILTER_OPEN)

  const statusFilterOptions = computed<StatusFilterOption[]>(() => [
    { label: 'Open', value: STATUS_FILTER_OPEN },
    { label: 'All statuses', value: STATUS_FILTER_ALL },
    ...statuses.value.map((s) => ({ label: s.name, value: String(s.id) }))
  ])

  /**
   * True when the default "Open" scope could not be expressed server-side —
   * the statuses query failed, or this instance doesn't use the titles we
   * consider primary. The list is still shown (see `workPackages`); this is
   * what lets the UI say the filter is approximate rather than silently
   * present a differently-scoped list as if it were the requested one.
   */
  const isStatusFilterDegraded = computed(
    () =>
      statusFilter.value === STATUS_FILTER_OPEN &&
      statusesSettled.value &&
      primaryStatusIds.value.length === 0
  )

  /**
   * The filters for the list request.
   *
   * Always `onlyMine` — the browse screen is the user's own workload; the
   * search box below is the way out of that narrowing. The status dimension is
   * the only thing this filter varies.
   */
  const listFilters = computed<WorkPackageFilters>(() => {
    const base: WorkPackageFilters = {
      onlyMine: true,
      pageSize: BROWSE_PAGE_SIZE
    }
    if (statusFilter.value === STATUS_FILTER_ALL) return base
    if (statusFilter.value === STATUS_FILTER_OPEN) {
      // No IDs resolved → omit the filter rather than send an empty (or
      // title-valued) one, and narrow client-side below instead.
      return primaryStatusIds.value.length > 0
        ? { ...base, statuses: primaryStatusIds.value }
        : base
    }
    return { ...base, statuses: [statusFilter.value] }
  })

  // The options factory call sits inside the getter `useQuery` takes, so the
  // key re-derives when the filter — or the resolved status IDs — change.
  const listQuery = useQuery(() => ({
    ...workPackageQueries.list(listFilters.value),
    // Don't fire before the status IDs are known, or the first request fetches
    // the wrong slice and is immediately superseded.
    enabled: statusesSettled.value
  }))

  /** The raw page the server returned, before any client-side narrowing. */
  const loadedWorkPackages = computed<WorkPackage[]>(
    () => listQuery.data.value?._embedded.elements ?? []
  )

  /**
   * The list for the current status filter, ordered by status priority.
   *
   * When the server already filtered by status ID there is nothing left to
   * narrow. In the degraded path the priority set is applied here — but never
   * to the point of emptying the list: an instance whose status titles differ
   * from ours resolves no IDs *and* matches no titles, and an empty list there
   * would read as "you have no work packages", which is a different and false
   * claim. Showing the unnarrowed page with `isStatusFilterDegraded` set is the
   * honest answer.
   */
  const scopedWorkPackages = computed<WorkPackage[]>(() => {
    const list = loadedWorkPackages.value
    if (!isStatusFilterDegraded.value) return sortByStatusPriority(list)
    const narrowed = list.filter(isPriorityWorkPackage)
    return sortByStatusPriority(narrowed.length > 0 ? narrowed : list)
  })

  /** True once the list query has settled, either way. */
  const isListLoaded = computed(() => listQuery.status.value !== 'pending')

  // ---------------------------------------------------------------------------
  // The search box
  // ---------------------------------------------------------------------------

  /** Bound to the search input. */
  const searchTerm = ref('')

  /**
   * The term as it stands after the box has been idle for
   * {@link SEARCH_DEBOUNCE_MS} — the only thing that reaches the server.
   *
   * Deliberately simpler than the picker's latch-and-freeze machinery, which
   * exists because a dropdown resets its own search term on select and can
   * yank rendered results out from under a mid-scroll user. A full-screen list
   * has neither problem: local filtering is live, and only the server term
   * waits.
   */
  const debouncedTerm = ref('')
  let debounceTimer: ReturnType<typeof setTimeout> | undefined

  watch(searchTerm, (value) => {
    // Strip control characters and cap the length on every keystroke. Writing
    // the sanitized value back is what actually rejects a disallowed character
    // — the box can never hold one, so nothing downstream has to cope with it.
    const clean = sanitizeWorkPackageSearchInput(value)
    if (clean !== value) {
      searchTerm.value = clean
      return
    }
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debouncedTerm.value = clean
    }, SEARCH_DEBOUNCE_MS)
  })

  // A browser unmounted mid-debounce must not wake up and write into a
  // discarded scope.
  onScopeDispose(() => clearTimeout(debounceTimer))

  /**
   * What to do with the term the user can see. Recomputed per keystroke with
   * no latency — the local pass is free, and the common case never waits.
   */
  const liveDecision = computed(() =>
    decideWorkPackageSearch(
      scopedWorkPackages.value,
      searchTerm.value,
      isListLoaded.value
    )
  )

  /**
   * The term to actually query, or `''` when no request should be made.
   *
   * Derived from the *debounced* term, and gated on the same decision: a term
   * the local pass answered, or one below the minimum, must never fire —
   * Colada would otherwise cache a request keyed on a term we never meant to
   * send.
   */
  const serverTerm = computed(() => {
    const decision = decideWorkPackageSearch(
      scopedWorkPackages.value,
      debouncedTerm.value,
      isListLoaded.value
    )
    return decision.mode === 'server'
      ? normalizeWorkPackageSearchTerm(debouncedTerm.value)
      : ''
  })

  const searchQuery = useQuery(() => ({
    ...workPackageQueries.search(serverTerm.value),
    enabled: serverTerm.value !== ''
  }))

  const searchResults = computed<WorkPackage[]>(
    () => searchQuery.data.value?._embedded.elements ?? []
  )

  /** True once the debounce has caught up with what's in the box. */
  const isSettled = computed(() => debouncedTerm.value === searchTerm.value)

  /**
   * True while a term is on its way to results — covering both the debounce
   * window and the request itself, since to the user those are one wait.
   */
  const isSearching = computed(() => {
    if (liveDecision.value.mode !== 'server') return false
    return !isSettled.value || searchQuery.status.value === 'pending'
  })

  /**
   * Nothing matched locally and the term is below the search minimum, so no
   * request was made. The UI must not claim "no work packages match" for a
   * search it never performed.
   */
  const isTermTooShort = computed(() => liveDecision.value.mode === 'too-short')

  /** The search request itself failed — distinct from it finding nothing. */
  const searchError = computed(() =>
    serverTerm.value === '' ? null : searchQuery.error.value
  )

  // ---------------------------------------------------------------------------
  // What the list shows
  // ---------------------------------------------------------------------------

  /**
   * The rows on screen, from whichever pass owns the current term.
   *
   * While the debounce is still running on a term headed for the server, the
   * previous term's results stay put rather than blanking — a full-screen list
   * flickering to empty on every keystroke is worse than a moment of staleness,
   * and `isSearching` says a newer answer is coming.
   */
  const workPackages = computed<WorkPackage[]>(() => {
    switch (liveDecision.value.mode) {
      case 'local':
        return liveDecision.value.matches
      case 'too-short':
        return []
      case 'server':
        return searchResults.value
    }
  })

  /** True while the *first* load is in flight (no data yet). */
  const isInitialLoading = computed(
    () =>
      listQuery.status.value === 'pending' && listQuery.data.value === undefined
  )

  /** Whether the screen is showing search results or the filtered list. */
  const isShowingSearchResults = computed(
    () => liveDecision.value.mode === 'server' && serverTerm.value !== ''
  )

  /** How many items the server said exist for what's on screen. */
  const totalCount = computed(() =>
    isShowingSearchResults.value
      ? (searchQuery.data.value?.total ?? 0)
      : (listQuery.data.value?.total ?? 0)
  )

  /** How many of them were actually loaded. */
  const shownCount = computed(() =>
    isShowingSearchResults.value
      ? searchResults.value.length
      : loadedWorkPackages.value.length
  )

  /**
   * The server had more than the one page we asked for. Surfaced rather than
   * silently truncating: a user who can't find their item needs to know the
   * list is partial, since there is no pagination to reach the rest.
   */
  const isTruncated = computed(
    () => shownCount.value > 0 && totalCount.value > shownCount.value
  )

  // ---------------------------------------------------------------------------
  // Selection
  // ---------------------------------------------------------------------------

  /**
   * The work package the detail panel is showing.
   *
   * The **object**, not an id looked up in the current list — same reasoning as
   * the picker's `seen` map. The selected item routinely leaves the visible
   * list (the term changes, the filter changes, the list refetches), and a
   * lookup would blank the panel out from under the user each time.
   */
  const selectedWorkPackage = ref<WorkPackage | null>(null)

  /**
   * Editing state for whatever is selected.
   *
   * Instantiated here rather than inside the detail panel because the *list*
   * has to consult it: switching rows with unsaved edits has to ask first, and
   * a panel-owned editor would leave the list unable to see that. It takes the
   * selection ref both ways — a successful save writes the echoed work package
   * straight back, which is what refreshes the panel, the row, and the lock
   * version in one move.
   */
  const editor = useWorkPackageEditor(selectedWorkPackage)

  /**
   * An action the user asked for that would have thrown unsaved edits away.
   *
   * Held rather than performed, so the UI can ask. Both kinds resolve through
   * the same pair of answers, because to the user they are the same question.
   */
  type PendingAction =
    | { kind: 'select'; workPackage: WorkPackage }
    | { kind: 'close' }

  const pendingAction = ref<PendingAction | null>(null)

  function select(wp: WorkPackage): void {
    // Re-selecting the row already open is not a switch, and must not prompt.
    if (wp.id === selectedWorkPackage.value?.id) return
    if (editor.isDirty.value) {
      pendingAction.value = { kind: 'select', workPackage: wp }
      return
    }
    selectedWorkPackage.value = wp
  }

  /**
   * Ask whether the screen may close. `false` means it may not — the caller
   * leaves it open and the confirm appears.
   *
   * A predicate rather than a "close" command: the modal owns its own `open`
   * model, and inverting that would mean this composable reaching into the
   * component's visibility.
   */
  function requestClose(): boolean {
    if (!editor.isDirty.value) return true
    pendingAction.value = { kind: 'close' }
    return false
  }

  /**
   * Throw the edits away and do what was asked. Returns the kind that was
   * pending so the caller can finish a close — the one part this composable
   * can't do itself.
   */
  function discardPendingAction(): PendingAction['kind'] | null {
    const action = pendingAction.value
    pendingAction.value = null
    if (action === null) return null
    editor.cancelEditing()
    if (action.kind === 'select') selectedWorkPackage.value = action.workPackage
    return action.kind
  }

  /** Keep the edits; the action is abandoned. */
  function keepEditing(): void {
    pendingAction.value = null
  }

  watch(
    workPackages,
    (list) => {
      const current = selectedWorkPackage.value
      if (current === null) {
        // Nothing chosen yet — open on the first row so a master-detail screen
        // doesn't greet the user with an empty right-hand pane. Only ever fires
        // once, since there is no way to deselect.
        if (list.length > 0) selectedWorkPackage.value = list[0]
        return
      }
      // Still listed → adopt the fresher copy, so a refetch (or a save)
      // updates the panel. Gone from the list → keep what we hold; the
      // selection outlives the list it came from.
      //
      // Safe to do mid-edit: the editor re-seeds on row *identity*, so a
      // fresher revision of the row being edited doesn't touch the draft, and
      // it saves against the lock version it snapshotted rather than this one.
      const fresh = list.find((wp) => wp.id === current.id)
      if (fresh) selectedWorkPackage.value = fresh
    },
    { immediate: true }
  )

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const { mutateAsync: openWorkPackage } = useOpenWorkPackageInBrowser()

  /** The row whose "open in browser" is in flight — only ever one at a time. */
  const openingId = ref<number | null>(null)

  /**
   * Ask the OS to open a work package in the default browser.
   *
   * Only the numeric id crosses the bridge; the main process builds the URL.
   * Rejections are rethrown rather than swallowed — the caller owns the toast,
   * matching how the day modal reports a failed write.
   */
  async function openInBrowser(workPackageId: number): Promise<void> {
    openingId.value = workPackageId
    try {
      await openWorkPackage({ workPackageId })
    } finally {
      openingId.value = null
    }
  }

  /** Clear the search box and anything derived from it, immediately. */
  function resetSearch(): void {
    clearTimeout(debounceTimer)
    searchTerm.value = ''
    debouncedTerm.value = ''
  }

  return {
    // List + filter
    workPackages,
    statusFilter,
    statusFilterOptions,
    isStatusFilterDegraded,
    isInitialLoading,
    isTruncated,
    totalCount,
    shownCount,
    error: listQuery.error,
    isFetching: listQuery.isLoading,
    // `refetch`, not `refresh`: Colada's `refresh()` is stale-gated and returns
    // the cached data untouched when it is still fresh, so a refresh button
    // pressed moments after load would do nothing visible. A manual refresh is
    // an explicit request for new data.
    refetch: listQuery.refetch,

    // Search
    searchTerm,
    isSearching,
    isTermTooShort,
    isShowingSearchResults,
    searchError,
    resetSearch,

    // Selection
    selectedWorkPackage,
    select,

    // Editing
    editor,
    pendingAction,
    requestClose,
    discardPendingAction,
    keepEditing,

    // Actions
    openInBrowser,
    openingId
  }
}
