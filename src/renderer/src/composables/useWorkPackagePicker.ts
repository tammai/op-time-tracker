import { computed, ref, watch } from 'vue'
import { useQuery } from '@pinia/colada'

import {
  isWorkPackageSearchTerm,
  sanitizeWorkPackageSearchInput
} from '@shared/validation/work-package-search'
import {
  usePriorityWorkPackages,
  workPackageQueries
} from '@renderer/composables/queries/work-packages'
import type { WorkPackageCollection } from '@renderer/composables/queries/work-packages'
import {
  formatWorkPackageLabel,
  workPackageSelectionLabel,
  type KnownWorkPackageSubject
} from '@renderer/utils/work-package-label'

/**
 * Options for the time-entry form's work-package select.
 *
 * Two sources, one list:
 * - **Priority items** — the user's own open work packages, loaded once per
 *   app by `usePriorityWorkPackages()`. What the select shows by default, and
 *   what the dropdown filters locally while the term is still short.
 * - **Server search** — once the term is a full id (5 digits), the server
 *   is queried without the `onlyMine`/status filters, so items outside the
 *   priority list become reachable. When those results land they *replace*
 *   the suggestions; local filtering is then switched off so the server's
 *   answer is shown verbatim.
 *
 * Lives in a composable, not the component, per
 * `.opencode/rules/conventions-frontend.md` (no business logic in
 * components; server state via Colada query composables).
 */

/** One `USelectMenu` option. `value` feeds the form's `workPackageId`. */
export interface WorkPackageItem {
  label: string
  value: number
}

type WorkPackage = WorkPackageCollection['_embedded']['elements'][number]

function toItem(wp: WorkPackage): WorkPackageItem {
  return { label: formatWorkPackageLabel(wp.id, wp.subject), value: wp.id }
}

export interface UseWorkPackagePickerOptions {
  /** The form's current selection, so it stays labelled as the list swaps. */
  selectedId: () => number | undefined
  /**
   * A subject the caller already knows for a specific work package — the
   * edited entry's item, read off its HAL link. Used to label the selection
   * when neither source holds it, which is the normal case in edit mode: the
   * entry's item is rarely among the user's priority suggestions, and without a
   * subject the select can only render `#12345`.
   *
   * Carries the id it belongs to so a subject can never label a *different*
   * selection.
   */
  knownSubject?: () => KnownWorkPackageSubject | null
}

export function useWorkPackagePicker(options: UseWorkPackagePickerOptions) {
  const {
    items: priorityItems,
    isInitialLoading: priorityLoading,
    error: priorityError
  } = usePriorityWorkPackages()

  // -------------------------------------------------------------------------
  // The search box
  // -------------------------------------------------------------------------

  /** Bound to `USelectMenu`'s `v-model:search-term`. */
  const searchTerm = ref('')

  // Enforce the allowed shape on every keystroke: digits only, no leading
  // zero, at most 5. Writing back to the same ref is what actually rejects a
  // disallowed character — the box can never hold one, so nothing downstream
  // has to cope with it.
  watch(searchTerm, (value) => {
    const clean = sanitizeWorkPackageSearchInput(value)
    if (clean !== value) searchTerm.value = clean
  })

  /** The term once it's long enough to ask the server about; `''` until then. */
  const serverTerm = computed(() =>
    isWorkPackageSearchTerm(searchTerm.value) ? searchTerm.value : ''
  )

  const searchQuery = useQuery(() => ({
    ...workPackageQueries.search(serverTerm.value),
    // Below the minimum length there is nothing to ask, and Colada would
    // otherwise fire a query keyed on a partial term.
    enabled: serverTerm.value !== ''
  }))

  /**
   * Results for the current term, ascending by id. A prefix search returns an
   * id-space slice (`12340`, `12341`, …), so id order is the order the user is
   * scanning for; the server's own ordering isn't guaranteed to match.
   */
  const searchResults = computed(() =>
    [...(searchQuery.data.value?._embedded.elements ?? [])].sort(
      (a, b) => a.id - b.id
    )
  )

  /**
   * True once results for the *current* term have arrived. Keyed per term, so
   * while a new term is in flight `data` is `undefined` and the priority
   * suggestions stay up rather than flashing an empty list.
   */
  const isServerSearchActive = computed(
    () => serverTerm.value !== '' && searchQuery.data.value !== undefined
  )

  const isSearching = computed(
    () => serverTerm.value !== '' && searchQuery.status.value === 'pending'
  )

  // -------------------------------------------------------------------------
  // The options list
  // -------------------------------------------------------------------------

  /**
   * Every subject this picker has *shown*, by id.
   *
   * Both sources are transient — a search's results are dropped the moment the
   * term changes, and `USelectMenu` resets the term as part of selecting
   * (`resetSearchTermOnSelect`, on by default) — so a subject has to be banked
   * as items pass through. Capturing it when the selection changes instead is a
   * tick too late: the chosen item has already left `searchResults`, leaving
   * the trigger to render a bare `#12345`.
   *
   * Bounded by what the user has actually seen: one priority page plus one item
   * per completed search.
   */
  const seenSubjects = ref(new Map<number, string>())

  watch(
    [priorityItems, searchResults],
    ([priority, results]) => {
      for (const wp of [...priority, ...results]) {
        seenSubjects.value.set(wp.id, wp.subject)
      }
    },
    { immediate: true }
  )

  const items = computed<WorkPackageItem[]>(() => {
    const source = isServerSearchActive.value
      ? searchResults.value
      : priorityItems.value
    const list = source.map(toItem)

    // Keep the selection present in the list whichever source is showing, or
    // the select would render an empty trigger for a valid value.
    const id = options.selectedId()
    if (id !== undefined && !list.some((item) => item.value === id)) {
      list.unshift({
        label: workPackageSelectionLabel(
          id,
          seenSubjects.value,
          options.knownSubject?.()
        ),
        value: id
      })
    }
    return list
  })

  return {
    items,
    searchTerm,
    /** Server results are authoritative — don't filter them again locally. */
    isServerSearchActive,
    isLoading: computed(() => priorityLoading.value || isSearching.value),
    error: priorityError,
    searchError: searchQuery.error
  }
}
