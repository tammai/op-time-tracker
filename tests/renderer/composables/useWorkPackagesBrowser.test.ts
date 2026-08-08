import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, effectScope, nextTick, type App, type EffectScope } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { PiniaColada } from '@pinia/colada'

import {
  STATUS_FILTER_ALL,
  STATUS_FILTER_OPEN,
  useWorkPackagesBrowser
} from '~~/src/renderer/src/composables/useWorkPackagesBrowser'

/**
 * Harness for the browse screen's state composable.
 *
 * Same shape as `useWorkPackagePicker.test.ts`: no component runner and no DOM,
 * so a bare app supplies the injection context (`app.runWithContext`) and an
 * `effectScope` carries the effects. That is all Pinia Colada needs.
 *
 * What it buys is the coverage no pure util can reach — which filters actually
 * reach the bridge, the statuses-failure fallback, and the invariant that the
 * selection outlives the list it was chosen from.
 */

/** A work package as the bridge returns it. */
function wp(id: number, subject: string, status = 'In Progress') {
  return {
    id,
    _type: 'WorkPackage' as const,
    subject,
    _links: {
      self: { href: `/api/v3/work_packages/${id}` },
      status: { href: '/api/v3/statuses/1', title: status },
      // The schema defaults this to `{}`, so a parsed work package always has
      // the key — an unassigned one included. Present here so the fixture is
      // assignable to `WorkPackage` where `select()` takes one.
      assignee: {}
    }
  }
}

function collection(elements: ReturnType<typeof wp>[], total = elements.length) {
  return {
    _type: 'WorkPackageCollection',
    total,
    count: elements.length,
    _embedded: { elements }
  }
}

/** The instance's statuses. `In Progress` = 1, `To Do` = 2, `Closed` = 9. */
const STATUSES = {
  _type: 'Collection',
  total: 3,
  count: 3,
  _embedded: {
    elements: [
      { id: 1, _type: 'Status', name: 'In Progress', isClosed: false },
      { id: 2, _type: 'Status', name: 'To Do', isClosed: false },
      { id: 9, _type: 'Status', name: 'Closed', isClosed: true }
    ]
  }
}

const MINE = [
  wp(101, 'Auth: fix login redirect'),
  wp(102, 'Billing: invoice PDF export', 'To Do')
]

let app: App
let scope: EffectScope
let listWorkPackages: ReturnType<typeof vi.fn>
let listStatuses: ReturnType<typeof vi.fn>
let openWorkPackageInBrowser: ReturnType<typeof vi.fn>

/** The `filters` object of every `listWorkPackages` call, in order. */
function listCalls(): Array<Record<string, unknown>> {
  return listWorkPackages.mock.calls.map(
    (c) =>
      (c[0] as { filters?: Record<string, unknown> } | undefined)?.filters ?? {}
  )
}

/** Every call that carried a search term. */
function searchCalls(): string[] {
  return listCalls()
    .map((f) => f.search)
    .filter((s): s is string => typeof s === 'string')
}

function mountBrowser(into: EffectScope = scope) {
  let browser!: ReturnType<typeof useWorkPackagesBrowser>
  app.runWithContext(() => {
    into.run(() => {
      browser = useWorkPackagesBrowser()
    })
  })
  return browser
}

/** Let queries resolve without advancing the debounce clock. */
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) await nextTick()
}

beforeEach(() => {
  vi.useFakeTimers()

  listWorkPackages = vi.fn((input?: { filters?: { search?: string } }) => {
    const search = input?.filters?.search
    if (search === undefined) return Promise.resolve(collection(MINE))
    return Promise.resolve(collection([wp(900, `Server hit for ${search}`)], 12))
  })
  listStatuses = vi.fn(() => Promise.resolve(STATUSES))
  openWorkPackageInBrowser = vi.fn(() => Promise.resolve())

  vi.stubGlobal('window', {
    openproject: { listWorkPackages, listStatuses, openWorkPackageInBrowser }
  })

  const pinia = createPinia()
  setActivePinia(pinia)
  app = createApp({ render: () => null })
  app.use(pinia)
  app.use(PiniaColada, {})
  scope = effectScope()
})

afterEach(() => {
  scope.stop()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('useWorkPackagesBrowser — the default scope', () => {
  it('asks for the user’s own work packages, narrowed to the resolved open status IDs', async () => {
    const browser = mountBrowser()
    await flush()

    // The whole point of resolving titles first: OpenProject's `status` filter
    // `=` operator rejects titles with HTTP 400, so IDs are what get sent.
    const withIds = listCalls().filter((f) => f.statuses !== undefined)
    expect(withIds.length).toBeGreaterThan(0)
    expect(withIds.at(-1)).toMatchObject({
      onlyMine: true,
      statuses: ['1', '2']
    })
    expect(browser.workPackages.value.map((w) => w.id)).toEqual([101, 102])
  })

  it('never sends a status filter before the statuses have settled', async () => {
    mountBrowser()
    await flush()

    // A request fired before resolution would fetch the wrong slice and be
    // immediately superseded — so no call may carry an empty status list.
    for (const filters of listCalls()) {
      expect(filters.statuses).not.toEqual([])
    }
  })
})

describe('useWorkPackagesBrowser — the statuses query fails', () => {
  beforeEach(() => {
    listStatuses = vi.fn(() => Promise.reject(new Error('statuses unavailable')))
    vi.stubGlobal('window', {
      openproject: { listWorkPackages, listStatuses, openWorkPackageInBrowser }
    })
  })

  it('drops the server-side status filter and narrows client-side instead', async () => {
    const browser = mountBrowser()
    await flush()

    // No IDs resolved → the filter must be omitted entirely rather than sent
    // empty (or, worse, sent as titles).
    expect(listCalls().every((f) => f.statuses === undefined)).toBe(true)
    // The list still arrives, narrowed by `isPriorityWorkPackage`.
    expect(browser.workPackages.value.map((w) => w.id)).toEqual([101, 102])
    expect(browser.isStatusFilterDegraded.value).toBe(true)
  })

  it('still shows the list when the client-side narrowing matches nothing', async () => {
    // An instance that uses neither "In Progress" nor "To Do" resolves no IDs
    // *and* matches no titles. Showing an empty list there is indistinguishable
    // from "you have no work packages", which would be a lie.
    listWorkPackages.mockImplementation(() =>
      Promise.resolve(collection([wp(201, 'Ops: rotate certs', 'Scheduled')]))
    )

    const browser = mountBrowser()
    await flush()

    expect(browser.workPackages.value.map((w) => w.id)).toEqual([201])
    expect(browser.isStatusFilterDegraded.value).toBe(true)
  })
})

describe('useWorkPackagesBrowser — the status filter', () => {
  it('sends the chosen status id on its own', async () => {
    const browser = mountBrowser()
    await flush()

    browser.statusFilter.value = '9'
    await flush()

    expect(listCalls().at(-1)).toMatchObject({ onlyMine: true, statuses: ['9'] })
  })

  it('drops the status filter entirely for "all"', async () => {
    const browser = mountBrowser()
    await flush()

    browser.statusFilter.value = STATUS_FILTER_ALL
    await flush()

    const last = listCalls().at(-1)!
    expect(last.onlyMine).toBe(true)
    expect(last.statuses).toBeUndefined()
  })

  it('offers the instance’s statuses alongside the two sentinels', async () => {
    const browser = mountBrowser()
    await flush()

    const values = browser.statusFilterOptions.value.map((o) => o.value)
    expect(values.slice(0, 2)).toEqual([STATUS_FILTER_OPEN, STATUS_FILTER_ALL])
    expect(values).toContain('9')
    const closed = browser.statusFilterOptions.value.find((o) => o.value === '9')
    expect(closed?.label).toBe('Closed')
  })
})

describe('useWorkPackagesBrowser — search', () => {
  it('answers a term the loaded list matches without any request', async () => {
    const browser = mountBrowser()
    await flush()

    browser.searchTerm.value = 'login'
    await flush()
    await vi.advanceTimersByTimeAsync(2000)
    await flush()

    expect(searchCalls()).toEqual([])
    expect(browser.workPackages.value.map((w) => w.id)).toEqual([101])
  })

  it('escapes the mine/open narrowing for a term nothing local matched', async () => {
    const browser = mountBrowser()
    await flush()

    browser.searchTerm.value = 'payment gateway'
    await flush()
    expect(searchCalls()).toEqual([])

    await vi.advanceTimersByTimeAsync(300)
    await flush()

    expect(searchCalls()).toEqual(['payment gateway'])
    // The search deliberately carries no assignee/status narrowing — reaching
    // items outside the user's own open set is the entire point.
    const searchCall = listCalls().find((f) => f.search !== undefined)!
    expect(searchCall.onlyMine).toBeUndefined()
    expect(searchCall.statuses).toBeUndefined()
    expect(browser.workPackages.value.map((w) => w.id)).toEqual([900])
  })

  it('says "keep typing" for a term below the minimum, and asks nothing', async () => {
    const browser = mountBrowser()
    await flush()

    browser.searchTerm.value = 'z'
    await flush()
    await vi.advanceTimersByTimeAsync(2000)
    await flush()

    expect(searchCalls()).toEqual([])
    // Distinct from "no work packages match": claiming that would be a
    // statement about the whole instance, for a search never performed.
    expect(browser.isTermTooShort.value).toBe(true)
    expect(browser.workPackages.value).toEqual([])
  })

  it('coalesces keystrokes into one request for the final term', async () => {
    const browser = mountBrowser()
    await flush()

    for (const term of ['p', 'pa', 'pay', 'paym']) {
      browser.searchTerm.value = term
      await flush()
      await vi.advanceTimersByTimeAsync(50)
    }
    await vi.advanceTimersByTimeAsync(300)
    await flush()

    expect(searchCalls()).toEqual(['paym'])
  })

  it('strips control characters from the box', async () => {
    const browser = mountBrowser()
    await flush()

    browser.searchTerm.value = 'pay ment\n'
    await flush()

    expect(browser.searchTerm.value).toBe('payment')
  })

  it('restores the full list when the term is cleared', async () => {
    const browser = mountBrowser()
    await flush()

    browser.searchTerm.value = 'login'
    await flush()
    expect(browser.workPackages.value.map((w) => w.id)).toEqual([101])

    browser.resetSearch()
    await flush()

    expect(browser.searchTerm.value).toBe('')
    expect(browser.workPackages.value.map((w) => w.id)).toEqual([101, 102])
  })
})

describe('useWorkPackagesBrowser — truncation', () => {
  it('reports the server total when it exceeds the page that was loaded', async () => {
    listWorkPackages.mockImplementation(() =>
      Promise.resolve(collection(MINE, 250))
    )

    const browser = mountBrowser()
    await flush()

    expect(browser.isTruncated.value).toBe(true)
    expect(browser.totalCount.value).toBe(250)
    expect(browser.shownCount.value).toBe(2)
  })

  it('reports no truncation when the whole set fits', async () => {
    const browser = mountBrowser()
    await flush()

    expect(browser.isTruncated.value).toBe(false)
  })

  it('reports truncation of a search result too', async () => {
    const browser = mountBrowser()
    await flush()

    browser.searchTerm.value = 'payment gateway'
    await flush()
    await vi.advanceTimersByTimeAsync(300)
    await flush()

    // The stubbed search answers with 1 of 12.
    expect(browser.isTruncated.value).toBe(true)
    expect(browser.totalCount.value).toBe(12)
    expect(browser.shownCount.value).toBe(1)
  })
})

describe('useWorkPackagesBrowser — selection', () => {
  it('selects the first row so the detail panel is never blank on arrival', async () => {
    const browser = mountBrowser()
    await flush()

    expect(browser.selectedWorkPackage.value?.id).toBe(101)
  })

  it('keeps the selection when it leaves the visible list', async () => {
    // The panel holds the object, not an id looked up in the current list —
    // otherwise searching would blank the panel out from under the user.
    const browser = mountBrowser()
    await flush()

    browser.select(MINE[1])
    expect(browser.selectedWorkPackage.value?.id).toBe(102)

    browser.searchTerm.value = 'login'
    await flush()

    expect(browser.workPackages.value.map((w) => w.id)).toEqual([101])
    expect(browser.selectedWorkPackage.value?.id).toBe(102)
  })

  it('refreshes the held object when the same work package comes back changed', async () => {
    const browser = mountBrowser()
    await flush()
    expect(browser.selectedWorkPackage.value?.subject).toBe(
      'Auth: fix login redirect'
    )

    // A refetch returning an edited subject must update the panel — the
    // selection survives *and* stays current. Stage 2's PATCH depends on this.
    listWorkPackages.mockImplementation(() =>
      Promise.resolve(collection([wp(101, 'Auth: fix login redirect (v2)'), MINE[1]]))
    )
    await browser.refetch()
    await flush()

    expect(browser.selectedWorkPackage.value?.id).toBe(101)
    expect(browser.selectedWorkPackage.value?.subject).toBe(
      'Auth: fix login redirect (v2)'
    )
  })
})

describe('useWorkPackagesBrowser — open in browser', () => {
  it('sends only the numeric id across the bridge', async () => {
    const browser = mountBrowser()
    await flush()

    await browser.openInBrowser(101)

    expect(openWorkPackageInBrowser).toHaveBeenCalledTimes(1)
    // Never an href, a path, or a URL — the main process builds the target.
    expect(openWorkPackageInBrowser).toHaveBeenCalledWith({ workPackageId: 101 })
  })

  it('rethrows so the caller can toast, and clears the pending id', async () => {
    openWorkPackageInBrowser.mockRejectedValueOnce(
      Object.assign(new Error('Could not open the work package in your browser.'), {
        code: 'SHELL_OPEN_FAILED'
      })
    )

    const browser = mountBrowser()
    await flush()

    await expect(browser.openInBrowser(101)).rejects.toMatchObject({
      code: 'SHELL_OPEN_FAILED'
    })
    // The row must not be left spinning after the failure.
    expect(browser.openingId.value).toBeNull()
  })
})

describe('useWorkPackagesBrowser — errors', () => {
  it('surfaces the list error for the modal’s error state', async () => {
    listWorkPackages.mockImplementation(() =>
      Promise.reject(
        Object.assign(new Error('Authentication failed. Check your API key.'), {
          code: 'OPENPROJECT_AUTH_FAILED'
        })
      )
    )

    const browser = mountBrowser()
    await flush()

    expect(browser.error.value).toBeTruthy()
    expect((browser.error.value as { code?: string } | null)?.code).toBe(
      'OPENPROJECT_AUTH_FAILED'
    )
  })
})
