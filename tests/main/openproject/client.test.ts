import { describe, it, expect, vi } from 'vitest'

import {
  buildRequestUrl,
  encodeTimeEntryFilters,
  encodeTimeEntryParams,
  encodeWorkPackageParams,
  MAX_PAGE_SIZE,
  extractApiErrorMessage,
  OpenProjectClient
} from '~~/src/main/openproject/client'
import { StatusCollectionSchema } from '~~/src/main/schemas/statuses'
import { TimeEntrySchema } from '~~/src/main/schemas/time-entries'
import statusesFixture from '~~/tests/fixtures/statuses-collection.json'
import timeEntriesFixture from '~~/tests/fixtures/time-entries-collection.json'

describe('buildRequestUrl', () => {
  describe('path joining', () => {
    it('joins https://host (no path) + /api/v3/work_packages', () => {
      const u = buildRequestUrl(
        'https://openproject.example.com',
        '/api/v3/work_packages'
      )
      expect(u.href).toBe(
        'https://openproject.example.com/api/v3/work_packages'
      )
    })

    it('joins https://host/ (trailing slash) + /api/v3/...', () => {
      const u = buildRequestUrl(
        'https://openproject.example.com/',
        '/api/v3/work_packages'
      )
      expect(u.href).toBe(
        'https://openproject.example.com/api/v3/work_packages'
      )
    })

    it('joins https://host/op/ (subpath) + /api/v3/...', () => {
      const u = buildRequestUrl(
        'https://openproject.example.com/op/',
        '/api/v3/work_packages'
      )
      expect(u.href).toBe(
        'https://openproject.example.com/op/api/v3/work_packages'
      )
    })

    it('joins https://host/op (no trailing slash) + /api/v3/...', () => {
      const u = buildRequestUrl(
        'https://openproject.example.com/op',
        '/api/v3/work_packages'
      )
      expect(u.href).toBe(
        'https://openproject.example.com/op/api/v3/work_packages'
      )
    })

    it('normalizes a path without a leading slash', () => {
      const u = buildRequestUrl(
        'https://openproject.example.com',
        'api/v3/time_entries'
      )
      expect(u.href).toBe(
        'https://openproject.example.com/api/v3/time_entries'
      )
    })

    it('preserves an explicit port', () => {
      const u = buildRequestUrl('http://localhost:3000', '/api/v3')
      expect(u.href).toBe('http://localhost:3000/api/v3')
    })
  })

  describe('userinfo stripping (security — defense in depth)', () => {
    it('strips username:password from the base URL', () => {
      const u = buildRequestUrl(
        'https://evil:notsecret@openproject.example.com/op/',
        '/api/v3/work_packages'
      )
      expect(u.username).toBe('')
      expect(u.password).toBe('')
      expect(u.href).toBe(
        'https://openproject.example.com/op/api/v3/work_packages'
      )
    })

    it('strips a username-only userinfo', () => {
      const u = buildRequestUrl(
        'https://user@openproject.example.com',
        '/api/v3'
      )
      expect(u.username).toBe('')
      expect(u.password).toBe('')
    })

    it('strips a hash fragment from the base URL', () => {
      const u = buildRequestUrl(
        'https://openproject.example.com#anchor',
        '/api/v3'
      )
      expect(u.hash).toBe('')
    })

    it('strips both userinfo and hash together', () => {
      const u = buildRequestUrl(
        'https://u:p@openproject.example.com/op/#frag',
        '/api/v3/work_packages'
      )
      expect(u.username).toBe('')
      expect(u.password).toBe('')
      expect(u.hash).toBe('')
      expect(u.href).toBe(
        'https://openproject.example.com/op/api/v3/work_packages'
      )
    })
  })

  describe('query params', () => {
    it('applies simple string params', () => {
      const u = buildRequestUrl('https://host', '/api/v3', {
        pageSize: '10',
        offset: '1'
      })
      expect(u.searchParams.get('pageSize')).toBe('10')
      expect(u.searchParams.get('offset')).toBe('1')
    })

    it('URL-encodes param values', () => {
      const u = buildRequestUrl('https://host', '/api/v3', {
        filters: '[{"spentOn":{"operator":"<>d","values":["2026-01-01","2026-01-31"]}}]'
      })
      // searchParams.get decodes back to the original.
      expect(u.searchParams.get('filters')).toBe(
        '[{"spentOn":{"operator":"<>d","values":["2026-01-01","2026-01-31"]}}]'
      )
      // The href contains the URL-encoded form.
      expect(u.href).toContain(encodeURIComponent('{"spentOn"'))
    })

    it('returns a URL with no query when params is empty', () => {
      const u = buildRequestUrl('https://host', '/api/v3')
      expect(u.search).toBe('')
    })
  })

  it('throws on a non-URL base', () => {
    expect(() => buildRequestUrl('not a url', '/api/v3')).toThrow()
  })
})

describe('encodeTimeEntryFilters', () => {
  it('returns undefined when no filters given', () => {
    expect(encodeTimeEntryFilters()).toBeUndefined()
    expect(encodeTimeEntryFilters({})).toBeUndefined()
  })

  it('encodes a between (date range) filter with the <>d operator', () => {
    const encoded = encodeTimeEntryFilters({
      spentOn: { between: ['2026-01-01', '2026-01-31'] }
    })
    expect(encoded).toBeDefined()
    const parsed = JSON.parse(encoded!) as Array<{
      spentOn: { operator: string; values: string[] }
    }>
    expect(parsed).toHaveLength(1)
    expect(parsed[0].spentOn.operator).toBe('<>d')
    expect(parsed[0].spentOn.values).toEqual(['2026-01-01', '2026-01-31'])
  })

  it('encodes a single-day (on) filter with the =d operator', () => {
    const encoded = encodeTimeEntryFilters({
      spentOn: { on: '2026-01-15' }
    })
    const parsed = JSON.parse(encoded!) as Array<{
      spentOn: { operator: string; values: string[] }
    }>
    expect(parsed[0].spentOn.operator).toBe('=d')
    expect(parsed[0].spentOn.values).toEqual(['2026-01-15'])
  })

  it('encodes a workPackageId filter', () => {
    const encoded = encodeTimeEntryFilters({ workPackageId: 42 })
    const parsed = JSON.parse(encoded!) as Array<{
      workPackage: { operator: string; values: string[] }
    }>
    expect(parsed[0].workPackage.operator).toBe('=')
    expect(parsed[0].workPackage.values).toEqual(['42'])
  })

  it('combines spentOn (between) + workPackageId into one filters array', () => {
    const encoded = encodeTimeEntryFilters({
      spentOn: { between: ['2026-01-01', '2026-01-31'] },
      workPackageId: 42
    })
    const parsed = JSON.parse(encoded!) as Array<Record<string, unknown>>
    expect(parsed).toHaveLength(2)
    expect(parsed[0]).toHaveProperty('spentOn')
    expect(parsed[1]).toHaveProperty('workPackage')
  })
})

describe('encodeWorkPackageParams', () => {
  it('returns empty record when no filters given', () => {
    expect(encodeWorkPackageParams()).toEqual({})
    expect(encodeWorkPackageParams({})).toEqual({})
  })

  it('encodes pageSize + offset', () => {
    expect(encodeWorkPackageParams({ pageSize: 20, offset: 1 })).toEqual({
      pageSize: '20',
      offset: '1'
    })
  })

  it('encodes only pageSize when offset omitted', () => {
    expect(encodeWorkPackageParams({ pageSize: 20 })).toEqual({
      pageSize: '20'
    })
  })

  it('encodes onlyMine as an assignee = me filter', () => {
    const params = encodeWorkPackageParams({ onlyMine: true })
    const parsed = JSON.parse(params.filters!) as Array<{
      assignee: { operator: string; values: string[] }
    }>
    expect(parsed).toHaveLength(1)
    expect(parsed[0].assignee.operator).toBe('=')
    expect(parsed[0].assignee.values).toEqual(['me'])
  })

  it('encodes onlyOpen as a status `o` (open) filter', () => {
    const params = encodeWorkPackageParams({ onlyOpen: true })
    const parsed = JSON.parse(params.filters!) as Array<{
      status: { operator: string; values: string[] }
    }>
    expect(parsed).toHaveLength(1)
    expect(parsed[0].status.operator).toBe('o')
    expect(parsed[0].status.values).toEqual([])
  })

  it('encodes statuses as a status `=` filter with the given IDs', () => {
    const params = encodeWorkPackageParams({
      statuses: ['3', '7']
    })
    const parsed = JSON.parse(params.filters!) as Array<{
      status: { operator: string; values: string[] }
    }>
    expect(parsed).toHaveLength(1)
    expect(parsed[0].status.operator).toBe('=')
    expect(parsed[0].status.values).toEqual(['3', '7'])
  })

  it('statuses takes precedence over onlyOpen when both are set', () => {
    const params = encodeWorkPackageParams({
      onlyOpen: true,
      statuses: ['3', '7']
    })
    const parsed = JSON.parse(params.filters!) as Array<{
      status: { operator: string; values: string[] }
    }>
    expect(parsed).toHaveLength(1)
    expect(parsed[0].status.operator).toBe('=')
    expect(parsed[0].status.values).toEqual(['3', '7'])
  })

  it('statuses: [] (empty) falls through to onlyOpen when set', () => {
    const params = encodeWorkPackageParams({
      onlyOpen: true,
      statuses: []
    })
    const parsed = JSON.parse(params.filters!) as Array<{
      status: { operator: string; values: string[] }
    }>
    expect(parsed).toHaveLength(1)
    expect(parsed[0].status.operator).toBe('o')
    expect(parsed[0].status.values).toEqual([])
  })

  it('statuses: [] (empty) with no onlyOpen omits the status filter', () => {
    const params = encodeWorkPackageParams({ statuses: [] })
    expect(params.filters).toBeUndefined()
  })

  it('encodes search as a subjectOrId `**` filter', () => {
    // `**` is OpenProject's quick-search operator: substring on the subject,
    // exact on the id — which is what keeps a pasted id working now that the
    // picker searches by title.
    const params = encodeWorkPackageParams({ search: 'login bug' })
    const parsed = JSON.parse(params.filters!) as Array<{
      subjectOrId: { operator: string; values: string[] }
    }>
    expect(parsed).toHaveLength(1)
    expect(parsed[0].subjectOrId.operator).toBe('**')
    expect(parsed[0].subjectOrId.values).toEqual(['login bug'])
  })

  it('trims the search term before it reaches the filter value', () => {
    const params = encodeWorkPackageParams({ search: '  report  ' })
    const parsed = JSON.parse(params.filters!) as Array<{
      subjectOrId: { values: string[] }
    }>
    expect(parsed[0].subjectOrId.values).toEqual(['report'])
  })

  it('omits the search filter for an empty or whitespace-only term', () => {
    // A blank term must never widen into an unfiltered "every work package"
    // request — it produces no filter at all.
    for (const search of ['', '   ']) {
      expect(encodeWorkPackageParams({ search }).filters).toBeUndefined()
    }
  })

  it('strips the `#` off an id search so `#12345` reaches the filter as `12345`', () => {
    // `subjectOrId` `**` compares ids exactly, so an unstripped `#12345`
    // matches nothing — and `#12345` is the form the picker itself displays.
    const params = encodeWorkPackageParams({ search: '#12345' })
    const parsed = JSON.parse(params.filters!) as Array<{
      subjectOrId: { values: string[] }
    }>
    expect(parsed[0].subjectOrId.values).toEqual(['12345'])
  })

  it('leaves a `#` that is not an id prefix in the term', () => {
    const params = encodeWorkPackageParams({ search: '#hashtag' })
    const parsed = JSON.parse(params.filters!) as Array<{
      subjectOrId: { values: string[] }
    }>
    expect(parsed[0].subjectOrId.values).toEqual(['#hashtag'])
  })

  it('encodes sortBy as OpenProject expects', () => {
    // Without it OpenProject defaults to `id asc` — creation order — so a
    // capped page shows the oldest matches rather than the likeliest ones.
    const params = encodeWorkPackageParams({
      search: 'bug',
      sortBy: [['updatedAt', 'desc']]
    })
    expect(JSON.parse(params.sortBy!)).toEqual([['updatedAt', 'desc']])
  })

  it('omits sortBy when not asked for', () => {
    expect(encodeWorkPackageParams({ search: 'bug' }).sortBy).toBeUndefined()
    expect(encodeWorkPackageParams({ sortBy: [] }).sortBy).toBeUndefined()
  })

  it('clamps a renderer-supplied pageSize to the main-process ceiling', () => {
    // pageSize crosses IPC from the renderer, which is not a trusted source:
    // an absurd value costs a response this process must fetch and parse.
    expect(encodeWorkPackageParams({ pageSize: 1_000_000 }).pageSize).toBe(
      String(MAX_PAGE_SIZE)
    )
    expect(encodeWorkPackageParams({ pageSize: 0 }).pageSize).toBe('1')
    expect(encodeWorkPackageParams({ pageSize: -5 }).pageSize).toBe('1')
    expect(encodeWorkPackageParams({ pageSize: 12.7 }).pageSize).toBe('12')
    expect(encodeWorkPackageParams({ pageSize: Number.NaN }).pageSize).toBe(
      String(MAX_PAGE_SIZE)
    )
    // A sane value passes through untouched.
    expect(encodeWorkPackageParams({ pageSize: 50 }).pageSize).toBe('50')
  })

  it('combines search with onlyMine + statuses in one filters array', () => {
    // The picker sends search alone, but the encoder must not silently drop
    // filters when they are combined.
    const params = encodeWorkPackageParams({
      onlyMine: true,
      statuses: ['3'],
      search: 'bug'
    })
    const parsed = JSON.parse(params.filters!) as Array<Record<string, unknown>>
    expect(parsed).toHaveLength(3)
    expect(parsed[0]).toHaveProperty('assignee')
    expect(parsed[1]).toHaveProperty('status')
    expect(parsed[2]).toHaveProperty('subjectOrId')
  })

  it('combines onlyMine + statuses into one filters array', () => {
    const params = encodeWorkPackageParams({
      onlyMine: true,
      statuses: ['3', '7']
    })
    const parsed = JSON.parse(params.filters!) as Array<Record<string, {
      operator: string
      values: string[]
    }>>
    expect(parsed).toHaveLength(2)
    expect(parsed[0]).toHaveProperty('assignee')
    expect(parsed[1]).toHaveProperty('status')
    expect(parsed[1].status.operator).toBe('=')
    expect(parsed[1].status.values).toEqual(['3', '7'])
  })
})

describe('encodeTimeEntryParams', () => {
  it('combines pagination + filters into one params record', () => {
    const params = encodeTimeEntryParams({
      pageSize: 50,
      spentOn: { between: ['2026-01-01', '2026-01-31'] }
    })
    expect(params.pageSize).toBe('50')
    expect(params.filters).toBeDefined()
    const parsed = JSON.parse(params.filters) as Array<{
      spentOn: { operator: string; values: string[] }
    }>
    expect(parsed[0].spentOn.operator).toBe('<>d')
  })

  it('omits the filters key when no OpenProject filters are set', () => {
    const params = encodeTimeEntryParams({ pageSize: 50 })
    expect(params.filters).toBeUndefined()
    expect(params.pageSize).toBe('50')
  })

  it('omits pagination keys when not set', () => {
    const params = encodeTimeEntryParams({
      spentOn: { on: '2026-01-15' }
    })
    expect(params.pageSize).toBeUndefined()
    expect(params.offset).toBeUndefined()
    expect(params.filters).toBeDefined()
  })
})

describe('listStatuses', () => {
  it('returns the Zod-validated collection and calls fetch with the right URL + auth', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    try {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(statusesFixture), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      )

      const BASE_URL = 'https://openproject.example.com'
      const API_KEY = 'unit-test-api-key'
      const EXPECTED_AUTH = `Basic ${Buffer.from(`apikey:${API_KEY}`).toString('base64')}`

      const client = new OpenProjectClient({ baseUrl: BASE_URL, apiKey: API_KEY })
      const result = await client.listStatuses()

      const expected = StatusCollectionSchema.parse(statusesFixture)
      expect(result).toEqual(expected)
      expect(result._embedded.elements).toHaveLength(3)
      expect(result._embedded.elements[0].id).toBe(3)
      expect(result._embedded.elements[0].name).toBe('In Progress')

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
      expect(url.href).toBe(`${BASE_URL}/api/v3/statuses`)
      // No filters/pagination params on the statuses request.
      expect(url.search).toBe('')
      expect(init.method).toBe('GET')
      const headers = init.headers as Record<string, string>
      expect(headers.Authorization).toBe(EXPECTED_AUTH)
      expect(headers.Accept).toBe('application/json')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
describe('listTimeEntries', () => {
  const BASE_URL = 'https://openproject.example.com'
  const API_KEY = 'unit-test-api-key'
  const MONTH: Parameters<OpenProjectClient['listTimeEntries']>[0] = {
    onlyMine: true,
    spentOn: { between: ['2026-07-01', '2026-07-31'] }
  }

  /** A collection page: `total` across all pages, `count` for this page. */
  function page(ids: number[], total: number): Response {
    const [template] = timeEntriesFixture._embedded.elements
    return new Response(
      JSON.stringify({
        _type: 'Collection',
        total,
        count: ids.length,
        _embedded: {
          elements: ids.map((id) => ({ ...template, id }))
        }
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )
  }

  /** The `offset`/`pageSize` params of every fetch the client made. */
  function pagination(fetchMock: ReturnType<typeof vi.fn>): string[][] {
    return fetchMock.mock.calls.map(([url]) => {
      const u = url as URL
      return [u.searchParams.get('offset') ?? '', u.searchParams.get('pageSize') ?? '']
    })
  }

  it('requests a large first page (not the server default of 20)', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    try {
      fetchMock.mockResolvedValueOnce(page([1, 2], 2))
      const client = new OpenProjectClient({ baseUrl: BASE_URL, apiKey: API_KEY })
      const result = await client.listTimeEntries(MONTH)

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(pagination(fetchMock)).toEqual([['1', '200']])
      expect(result.count).toBe(2)
      // The month filter still rides along on the paginated request.
      const [url] = fetchMock.mock.calls[0] as [URL]
      expect(JSON.parse(url.searchParams.get('filters') as string)).toEqual([
        { spentOn: { operator: '<>d', values: ['2026-07-01', '2026-07-31'] } },
        { user: { operator: '=', values: ['me'] } }
      ])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('follows pages until every entry is collected', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    try {
      fetchMock
        .mockResolvedValueOnce(page([1, 2], 5))
        .mockResolvedValueOnce(page([3, 4], 5))
        .mockResolvedValueOnce(page([5], 5))
      const client = new OpenProjectClient({ baseUrl: BASE_URL, apiKey: API_KEY })
      const result = await client.listTimeEntries({ ...MONTH, pageSize: 2 })

      expect(fetchMock).toHaveBeenCalledTimes(3)
      expect(pagination(fetchMock)).toEqual([
        ['1', '2'],
        ['2', '2'],
        ['3', '2']
      ])
      // The merged collection reports what was actually collected.
      expect(result.count).toBe(5)
      expect(result.total).toBe(5)
      expect(result._embedded.elements.map((e) => e.id)).toEqual([1, 2, 3, 4, 5])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('stops on an empty page even when the server over-reports `total`', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    try {
      fetchMock
        .mockResolvedValueOnce(page([1], 99))
        .mockResolvedValueOnce(page([], 99))
      const client = new OpenProjectClient({ baseUrl: BASE_URL, apiKey: API_KEY })
      const result = await client.listTimeEntries({ ...MONTH, pageSize: 1 })

      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(result.count).toBe(1)
      expect(result._embedded.elements.map((e) => e.id)).toEqual([1])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('caps the pages it will follow when `total` is never reached', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    try {
      // Always one entry, `total` never reachable — the loop must still end.
      fetchMock.mockImplementation(() => Promise.resolve(page([1], 10_000)))
      const client = new OpenProjectClient({ baseUrl: BASE_URL, apiKey: API_KEY })
      const result = await client.listTimeEntries({ ...MONTH, pageSize: 1 })

      expect(fetchMock).toHaveBeenCalledTimes(25)
      expect(result.count).toBe(25)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('passes an explicit `offset` straight through as a single page', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    try {
      fetchMock.mockResolvedValueOnce(page([7], 50))
      const client = new OpenProjectClient({ baseUrl: BASE_URL, apiKey: API_KEY })
      const result = await client.listTimeEntries({ pageSize: 1, offset: 3 })

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(pagination(fetchMock)).toEqual([['3', '1']])
      // Untouched server shape: `count` is the page's own count.
      expect(result.count).toBe(1)
      expect(result.total).toBe(50)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('extractApiErrorMessage', () => {
  it('extracts the top-level message', () => {
    expect(
      extractApiErrorMessage(
        JSON.stringify({
          _type: 'Error',
          errorIdentifier: 'urn:openproject-org:api:v3:errors:PropertyConstraintViolation',
          message: 'Activity is not set to one of the allowed values.'
        })
      )
    ).toBe('Activity is not set to one of the allowed values.')
  })

  it('joins embedded error messages after the top-level one', () => {
    expect(
      extractApiErrorMessage(
        JSON.stringify({
          message: 'Multiple field constraints have been violated.',
          _embedded: {
            errors: [
              { message: 'Hours must be greater than 0.' },
              { message: 'Activity is not set.' }
            ]
          }
        })
      )
    ).toBe(
      'Multiple field constraints have been violated. Hours must be greater than 0. Activity is not set.'
    )
  })

  it('de-duplicates a repeated message', () => {
    expect(
      extractApiErrorMessage(
        JSON.stringify({
          message: 'Activity is not set.',
          _embedded: { errors: [{ message: 'Activity is not set.' }] }
        })
      )
    ).toBe('Activity is not set.')
  })

  it('returns null for a non-JSON body', () => {
    expect(extractApiErrorMessage('<html>500</html>')).toBeNull()
    expect(extractApiErrorMessage('')).toBeNull()
  })

  it('returns null when no message field is present', () => {
    expect(extractApiErrorMessage(JSON.stringify({ _type: 'Error' }))).toBeNull()
    expect(extractApiErrorMessage(JSON.stringify({ message: '   ' }))).toBeNull()
  })

  it('caps a very long server message', () => {
    const out = extractApiErrorMessage(
      JSON.stringify({ message: 'x'.repeat(5000) })
    )
    expect(out).not.toBeNull()
    expect((out as string).length).toBe(501) // 500 chars + the ellipsis
    expect((out as string).endsWith('…')).toBe(true)
  })

  it('reads only the declared message fields, never the rest of the body', () => {
    // A hostile/echoing server could put anything in the body. Only
    // `message` is forwarded — the echoed request payload is dropped.
    const out = extractApiErrorMessage(
      JSON.stringify({
        message: 'Activity is not set.',
        _embedded: { payload: { apiKey: 'super-secret-key-should-never-leak' } },
        rawRequest: 'Authorization: Basic c2hvdWxkLW5vdC1sZWFr'
      })
    )
    expect(out).toBe('Activity is not set.')
    expect(out).not.toContain('super-secret-key-should-never-leak')
    expect(out).not.toContain('Authorization')
  })
})

describe('listWorkPackages — title search', () => {
  const BASE_URL = 'https://openproject.example.com'
  const API_KEY = 'unit-test-api-key'

  /** A collection as `GET /api/v3/work_packages?filters=…` returns it. */
  function collection(ids: number[]): Record<string, unknown> {
    return {
      _type: 'WorkPackageCollection',
      total: ids.length,
      count: ids.length,
      _embedded: {
        elements: ids.map((id) => ({
          id,
          _type: 'WorkPackage',
          subject: `Work package ${id}`,
          _links: { self: { href: `/api/v3/work_packages/${id}` } }
        }))
      }
    }
  }

  /** Always 200 with `ids`. Takes the URL so assertions can read it back. */
  function respondWith(ids: number[]) {
    return (_url: URL) =>
      Promise.resolve(
        new Response(JSON.stringify(collection(ids)), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      )
  }

  it('issues one filtered collection request, not a per-id fetch', async () => {
    // The old id search fanned out over GET /work_packages/{id}. A title search
    // is an ordinary filtered collection — one round trip, and nothing
    // user-authored in the path.
    const fetchMock = vi.fn(respondWith([12345]))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const client = new OpenProjectClient({ baseUrl: BASE_URL, apiKey: API_KEY })
      await client.listWorkPackages({ search: 'login bug' })

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url] = fetchMock.mock.calls[0] as [URL]
      expect(url.pathname).toBe('/api/v3/work_packages')
      expect(JSON.parse(url.searchParams.get('filters')!)).toEqual([
        { subjectOrId: { operator: '**', values: ['login bug'] } }
      ])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('returns the parsed collection in server order', async () => {
    // No client-side re-sorting: relevance is the server's call for a title
    // search, unlike the id-space slice the old search returned.
    const fetchMock = vi.fn(respondWith([900, 12, 400]))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const client = new OpenProjectClient({ baseUrl: BASE_URL, apiKey: API_KEY })
      const result = await client.listWorkPackages({ search: 'report' })

      expect(result._embedded.elements.map((e) => e.id)).toEqual([900, 12, 400])
      expect(result.total).toBe(3)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('returns an empty collection when nothing matches', async () => {
    const fetchMock = vi.fn(respondWith([]))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const client = new OpenProjectClient({ baseUrl: BASE_URL, apiKey: API_KEY })
      const result = await client.listWorkPackages({ search: 'nothing matches' })
      expect(result._embedded.elements).toEqual([])
      expect(result.total).toBe(0)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('percent-encodes a term with query-significant characters', async () => {
    // The term is untrusted renderer input. It must land as a value, unable to
    // add or alter query parameters.
    const fetchMock = vi.fn(respondWith([]))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const client = new OpenProjectClient({ baseUrl: BASE_URL, apiKey: API_KEY })
      await client.listWorkPackages({ search: 'a&pageSize=999#x' })

      const [url] = fetchMock.mock.calls[0] as [URL]
      expect(url.searchParams.get('pageSize')).toBeNull()
      expect(JSON.parse(url.searchParams.get('filters')!)).toEqual([
        { subjectOrId: { operator: '**', values: ['a&pageSize=999#x'] } }
      ])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('propagates a failure instead of reporting "no results"', async () => {
    // A revoked key must not look like an empty search.
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response('{}', { status: 401 }))
    )
    vi.stubGlobal('fetch', fetchMock)
    try {
      const client = new OpenProjectClient({ baseUrl: BASE_URL, apiKey: API_KEY })
      await expect(
        client.listWorkPackages({ search: 'login bug' })
      ).rejects.toMatchObject({ code: 'OPENPROJECT_AUTH_FAILED' })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('forwards the server message on HTTP 400 so a bad query is diagnosable', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            _type: 'Error',
            message: 'Invalid query filters: ID filter has invalid values.',
            // Must not reach the renderer.
            _embedded: { payload: { apiKey: 'must-not-leak' } }
          }),
          { status: 400, headers: { 'content-type': 'application/json' } }
        )
      )
    )
    vi.stubGlobal('fetch', fetchMock)
    try {
      const client = new OpenProjectClient({ baseUrl: BASE_URL, apiKey: API_KEY })
      const err = await client
        .listWorkPackages({ onlyMine: true })
        .catch((e: Error) => e)
      expect(err).toMatchObject({ code: 'OPENPROJECT_HTTP_ERROR' })
      expect((err as Error).message).toBe(
        'Invalid query filters: ID filter has invalid values.'
      )
      expect((err as Error).message).not.toContain('must-not-leak')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('rejects a malformed term before making any request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    try {
      const client = new OpenProjectClient({ baseUrl: BASE_URL, apiKey: API_KEY })
      const badTerms = [
        '', // empty — must never widen into "every work package"
        'a', // below the 2-character minimum
        '1',
        '   ', // whitespace only: 3 characters, but a 0-character term
        ' a ', // trims to 1 character
        'x'.repeat(101) // over the 100-character cap
      ]
      for (const search of badTerms) {
        await expect(client.listWorkPackages({ search })).rejects.toMatchObject({
          code: 'OPENPROJECT_INVALID_INPUT'
        })
      }
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('createTimeEntry', () => {
  const BASE_URL = 'https://openproject.example.com'
  const API_KEY = 'unit-test-api-key'
  const EXPECTED_AUTH = `Basic ${Buffer.from(`apikey:${API_KEY}`).toString('base64')}`

  const validInput = {
    workPackageId: 42,
    activityId: 3,
    spentOn: '2026-07-25',
    hours: 1.5,
    comment: 'Reviewed the redesign spec'
  }

  /** The created entry OpenProject echoes back (reuse a realistic element). */
  const createdEntry = timeEntriesFixture._embedded.elements[0]

  it('POSTs the right URL, headers, and body, and returns the parsed entry', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    try {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(createdEntry), {
          status: 201,
          headers: { 'content-type': 'application/json' }
        })
      )

      const client = new OpenProjectClient({ baseUrl: BASE_URL, apiKey: API_KEY })
      const result = await client.createTimeEntry(validInput)

      expect(result).toEqual(TimeEntrySchema.parse(createdEntry))

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
      expect(url.href).toBe(`${BASE_URL}/api/v3/time_entries`)
      expect(url.search).toBe('')
      expect(init.method).toBe('POST')

      const headers = init.headers as Record<string, string>
      expect(headers.Authorization).toBe(EXPECTED_AUTH)
      expect(headers.Accept).toBe('application/json')
      expect(headers['Content-Type']).toBe('application/json')

      expect(JSON.parse(init.body as string)).toEqual({
        spentOn: '2026-07-25',
        hours: 'PT1H30M',
        comment: { raw: 'Reviewed the redesign spec' },
        _links: {
          workPackage: { href: '/api/v3/work_packages/42' },
          activity: { href: '/api/v3/time_entries/activities/3' }
        }
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('converts decimal hours to an ISO 8601 duration', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    try {
      for (const [hours, iso] of [
        [0.25, 'PT15M'],
        [2, 'PT2H'],
        [7.75, 'PT7H45M']
      ] as [number, string][]) {
        fetchMock.mockResolvedValueOnce(
          new Response(JSON.stringify(createdEntry), { status: 201 })
        )
        const client = new OpenProjectClient({ baseUrl: BASE_URL, apiKey: API_KEY })
        await client.createTimeEntry({ ...validInput, hours })
        const [, init] = fetchMock.mock.calls.at(-1) as [URL, RequestInit]
        expect(JSON.parse(init.body as string).hours).toBe(iso)
      }
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('omits the comment key entirely when no comment is given', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    try {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(createdEntry), { status: 201 })
      )
      const { comment: _comment, ...noComment } = validInput
      const client = new OpenProjectClient({ baseUrl: BASE_URL, apiKey: API_KEY })
      await client.createTimeEntry(noComment)

      const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
      expect(JSON.parse(init.body as string)).not.toHaveProperty('comment')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('rejects invalid input before making any request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    try {
      const client = new OpenProjectClient({ baseUrl: BASE_URL, apiKey: API_KEY })
      const badInputs = [
        { ...validInput, hours: 0 },
        { ...validInput, hours: 25 },
        { ...validInput, workPackageId: -1 },
        { ...validInput, activityId: 0 },
        { ...validInput, spentOn: '2026-02-31' },
        { ...validInput, spentOn: 'today' }
      ]
      for (const input of badInputs) {
        await expect(client.createTimeEntry(input)).rejects.toMatchObject({
          code: 'OPENPROJECT_INVALID_INPUT'
        })
      }
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('maps HTTP 422 to a validation error carrying only the server message', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    try {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            _type: 'Error',
            errorIdentifier:
              'urn:openproject-org:api:v3:errors:PropertyConstraintViolation',
            message: 'Activity is not set to one of the allowed values.',
            // A body field that must never reach the renderer.
            _embedded: { payload: { secret: 'must-not-leak' } }
          }),
          { status: 422, headers: { 'content-type': 'application/json' } }
        )
      )

      const client = new OpenProjectClient({ baseUrl: BASE_URL, apiKey: API_KEY })
      await expect(client.createTimeEntry(validInput)).rejects.toMatchObject({
        code: 'OPENPROJECT_VALIDATION_FAILED',
        status: 422,
        message: 'Activity is not set to one of the allowed values.'
      })

      await expect(
        client.createTimeEntry(validInput).catch((e: Error) => e.message)
      ).resolves.not.toContain('must-not-leak')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('falls back to a generic message when the 422 body is unreadable', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    try {
      fetchMock.mockResolvedValueOnce(
        new Response('<html>nope</html>', { status: 422 })
      )
      const client = new OpenProjectClient({ baseUrl: BASE_URL, apiKey: API_KEY })
      await expect(client.createTimeEntry(validInput)).rejects.toMatchObject({
        code: 'OPENPROJECT_VALIDATION_FAILED'
      })
      await expect(
        client.createTimeEntry(validInput).catch((e: Error) => e.message)
      ).resolves.not.toContain('<html>')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('still maps 401 and 5xx on the write path', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    try {
      const client = new OpenProjectClient({ baseUrl: BASE_URL, apiKey: API_KEY })

      fetchMock.mockResolvedValueOnce(new Response('', { status: 401 }))
      await expect(client.createTimeEntry(validInput)).rejects.toMatchObject({
        code: 'OPENPROJECT_AUTH_FAILED'
      })

      fetchMock.mockResolvedValueOnce(new Response('', { status: 503 }))
      await expect(client.createTimeEntry(validInput)).rejects.toMatchObject({
        code: 'OPENPROJECT_SERVER_ERROR'
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('maps an unexpected 201 response shape to a schema error', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    try {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ nope: true }), { status: 201 })
      )
      const client = new OpenProjectClient({ baseUrl: BASE_URL, apiKey: API_KEY })
      await expect(client.createTimeEntry(validInput)).rejects.toMatchObject({
        code: 'OPENPROJECT_SCHEMA_FAILED'
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('listTimeEntryActivities', () => {
  const BASE_URL = 'https://openproject.example.com'
  const API_KEY = 'unit-test-api-key'

  const formResponse = {
    _type: 'Form',
    _embedded: {
      schema: {
        activity: {
          type: 'TimeEntriesActivity',
          _links: {
            allowedValues: [
              { href: '/api/v3/time_entries/activities/1', title: 'Management' },
              { href: '/api/v3/time_entries/activities/2', title: 'Development' }
            ]
          }
        }
      }
    }
  }

  it('POSTs the form endpoint and returns the activities as a collection', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    try {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(formResponse), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      )

      const client = new OpenProjectClient({ baseUrl: BASE_URL, apiKey: API_KEY })
      const result = await client.listTimeEntryActivities()

      expect(result.total).toBe(2)
      expect(result.count).toBe(2)
      expect(result._embedded.elements).toEqual([
        { id: 1, name: 'Management' },
        { id: 2, name: 'Development' }
      ])

      const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
      expect(url.href).toBe(`${BASE_URL}/api/v3/time_entries/form`)
      expect(init.method).toBe('POST')
      // Unscoped call sends an empty payload, not a work-package link.
      expect(JSON.parse(init.body as string)).toEqual({})
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('scopes the form to a work package when given a valid id', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    try {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(formResponse), { status: 200 })
      )
      const client = new OpenProjectClient({ baseUrl: BASE_URL, apiKey: API_KEY })
      await client.listTimeEntryActivities(42)

      const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
      expect(JSON.parse(init.body as string)).toEqual({
        _links: { workPackage: { href: '/api/v3/work_packages/42' } }
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('ignores a non-positive or non-integer work package id (sends unscoped)', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    try {
      const client = new OpenProjectClient({ baseUrl: BASE_URL, apiKey: API_KEY })
      for (const bad of [0, -1, 1.5, Number.NaN]) {
        fetchMock.mockResolvedValueOnce(
          new Response(JSON.stringify(formResponse), { status: 200 })
        )
        await client.listTimeEntryActivities(bad)
        const [, init] = fetchMock.mock.calls.at(-1) as [URL, RequestInit]
        expect(JSON.parse(init.body as string)).toEqual({})
      }
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('returns an empty collection when the form exposes no activities', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    try {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ _type: 'Form', _embedded: { schema: {} } }), {
          status: 200
        })
      )
      const client = new OpenProjectClient({ baseUrl: BASE_URL, apiKey: API_KEY })
      const result = await client.listTimeEntryActivities()
      expect(result.total).toBe(0)
      expect(result._embedded.elements).toEqual([])
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('updateTimeEntry', () => {
  const BASE_URL = 'https://openproject.example.com'
  const API_KEY = 'unit-test-api-key'
  const EXPECTED_AUTH = `Basic ${Buffer.from(`apikey:${API_KEY}`).toString('base64')}`

  const validInput = {
    id: 77,
    workPackageId: 42,
    activityId: 3,
    spentOn: '2026-07-25',
    hours: 1.5,
    comment: 'Reviewed the redesign spec'
  }

  /** The updated entry OpenProject echoes back. */
  const updatedEntry = timeEntriesFixture._embedded.elements[0]

  it('PATCHes the entry URL with the right headers and body', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    try {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(updatedEntry), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      )

      const client = new OpenProjectClient({ baseUrl: BASE_URL, apiKey: API_KEY })
      const result = await client.updateTimeEntry(validInput)

      expect(result).toEqual(TimeEntrySchema.parse(updatedEntry))

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
      expect(url.href).toBe(`${BASE_URL}/api/v3/time_entries/77`)
      expect(init.method).toBe('PATCH')

      const headers = init.headers as Record<string, string>
      expect(headers.Authorization).toBe(EXPECTED_AUTH)
      expect(headers['Content-Type']).toBe('application/json')

      // `id` addresses the entry in the path — it is never a body field.
      const body = JSON.parse(init.body as string)
      expect(body).not.toHaveProperty('id')
      expect(body).toEqual({
        spentOn: '2026-07-25',
        hours: 'PT1H30M',
        comment: { raw: 'Reviewed the redesign spec' },
        _links: {
          workPackage: { href: '/api/v3/work_packages/42' },
          activity: { href: '/api/v3/time_entries/activities/3' }
        }
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('sends an empty comment to clear one — the update is a full replacement', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    try {
      const client = new OpenProjectClient({ baseUrl: BASE_URL, apiKey: API_KEY })

      // Omitting the key would leave the stored comment in place, making
      // "clear this comment" unexpressible — unlike create, which omits it.
      for (const input of [
        (({ comment: _c, ...rest }) => rest)(validInput),
        { ...validInput, comment: '' }
      ]) {
        fetchMock.mockResolvedValueOnce(
          new Response(JSON.stringify(updatedEntry), { status: 200 })
        )
        await client.updateTimeEntry(input)
        const [, init] = fetchMock.mock.calls.at(-1) as [URL, RequestInit]
        expect(JSON.parse(init.body as string).comment).toEqual({ raw: '' })
      }
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('converts decimal hours to an ISO 8601 duration', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    try {
      for (const [hours, iso] of [
        [0.25, 'PT15M'],
        [2, 'PT2H'],
        [7.75, 'PT7H45M']
      ] as [number, string][]) {
        fetchMock.mockResolvedValueOnce(
          new Response(JSON.stringify(updatedEntry), { status: 200 })
        )
        const client = new OpenProjectClient({ baseUrl: BASE_URL, apiKey: API_KEY })
        await client.updateTimeEntry({ ...validInput, hours })
        const [, init] = fetchMock.mock.calls.at(-1) as [URL, RequestInit]
        expect(JSON.parse(init.body as string).hours).toBe(iso)
      }
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('rejects invalid input before making any request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    try {
      const client = new OpenProjectClient({ baseUrl: BASE_URL, apiKey: API_KEY })
      const badInputs = [
        { ...validInput, id: 0 },
        { ...validInput, id: -3 },
        { ...validInput, id: 1.5 },
        // A non-numeric id must never reach the request path.
        { ...validInput, id: '77/../work_packages' as unknown as number },
        { ...validInput, hours: 0 },
        { ...validInput, hours: 25 },
        { ...validInput, workPackageId: -1 },
        { ...validInput, activityId: 0 },
        { ...validInput, spentOn: '2026-02-31' }
      ]
      for (const input of badInputs) {
        await expect(client.updateTimeEntry(input)).rejects.toMatchObject({
          code: 'OPENPROJECT_INVALID_INPUT'
        })
      }
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('maps HTTP 422 to a validation error carrying only the server message', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    try {
      fetchMock.mockResolvedValue(
        new Response(
          JSON.stringify({
            _type: 'Error',
            message: 'Activity is not set to one of the allowed values.',
            _embedded: { payload: { secret: 'must-not-leak' } }
          }),
          { status: 422, headers: { 'content-type': 'application/json' } }
        )
      )

      const client = new OpenProjectClient({ baseUrl: BASE_URL, apiKey: API_KEY })
      await expect(client.updateTimeEntry(validInput)).rejects.toMatchObject({
        code: 'OPENPROJECT_VALIDATION_FAILED',
        status: 422,
        message: 'Activity is not set to one of the allowed values.'
      })
      await expect(
        client.updateTimeEntry(validInput).catch((e: Error) => e.message)
      ).resolves.not.toContain('must-not-leak')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('maps 404 to a not-found error — the entry is gone or not visible', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    try {
      fetchMock.mockResolvedValueOnce(new Response('', { status: 404 }))
      const client = new OpenProjectClient({ baseUrl: BASE_URL, apiKey: API_KEY })
      await expect(client.updateTimeEntry(validInput)).rejects.toMatchObject({
        code: 'OPENPROJECT_NOT_FOUND'
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('maps an unexpected 200 response shape to a schema error', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    try {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ nope: true }), { status: 200 })
      )
      const client = new OpenProjectClient({ baseUrl: BASE_URL, apiKey: API_KEY })
      await expect(client.updateTimeEntry(validInput)).rejects.toMatchObject({
        code: 'OPENPROJECT_SCHEMA_FAILED'
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('deleteTimeEntry', () => {
  const BASE_URL = 'https://openproject.example.com'
  const API_KEY = 'unit-test-api-key'
  const EXPECTED_AUTH = `Basic ${Buffer.from(`apikey:${API_KEY}`).toString('base64')}`

  it('DELETEs the entry URL and resolves on an empty 204', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    try {
      // A 204 carries no body at all — `new Response('')` is rejected for it.
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))

      const client = new OpenProjectClient({ baseUrl: BASE_URL, apiKey: API_KEY })
      await expect(client.deleteTimeEntry({ id: 77 })).resolves.toBeUndefined()

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
      expect(url.href).toBe(`${BASE_URL}/api/v3/time_entries/77`)
      expect(init.method).toBe('DELETE')
      expect(init.body).toBeUndefined()

      const headers = init.headers as Record<string, string>
      expect(headers.Authorization).toBe(EXPECTED_AUTH)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('sends Content-Type despite having no body — OpenProject 406s without it', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    try {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
      const client = new OpenProjectClient({ baseUrl: BASE_URL, apiKey: API_KEY })
      await client.deleteTimeEntry({ id: 77 })

      // OpenProject documents 406 as "the client did not send a Content-Type
      // header" and applies it to a bodyless DELETE too, so the header cannot
      // be conditional on there being a body.
      const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
      const headers = init.headers as Record<string, string>
      expect(headers['Content-Type']).toBe('application/json')
      expect(init.body).toBeUndefined()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('leaves every method asking for JSON', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    try {
      const client = new OpenProjectClient({ baseUrl: BASE_URL, apiKey: API_KEY })
      const entry = timeEntriesFixture._embedded.elements[0]
      const write = {
        workPackageId: 42,
        activityId: 3,
        spentOn: '2026-07-25',
        hours: 1.5
      }

      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(timeEntriesFixture), { status: 200 })
      )
      await client.listTimeEntries()

      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(entry), { status: 201 })
      )
      await client.createTimeEntry(write)

      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(entry), { status: 200 })
      )
      await client.updateTimeEntry({ id: 77, ...write })

      for (const call of fetchMock.mock.calls) {
        const [, init] = call as [URL, RequestInit]
        expect((init.headers as Record<string, string>).Accept).toBe(
          'application/json'
        )
      }
      // A GET has nothing to describe, so it sends no Content-Type — the 406
      // rule applies to writes, and the reads work without it today.
      const [, getInit] = fetchMock.mock.calls[0] as [URL, RequestInit]
      expect((getInit.headers as Record<string, string>)['Content-Type']).toBe(
        undefined
      )
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('rejects a non-positive-integer id before making any request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    try {
      const client = new OpenProjectClient({ baseUrl: BASE_URL, apiKey: API_KEY })
      const badIds = [
        0,
        -1,
        1.5,
        Number.NaN,
        // Path-traversal and injection shapes must never reach the URL.
        '77/../../work_packages' as unknown as number,
        '77?foo=bar' as unknown as number,
        undefined as unknown as number
      ]
      for (const id of badIds) {
        await expect(client.deleteTimeEntry({ id })).rejects.toMatchObject({
          code: 'OPENPROJECT_INVALID_INPUT'
        })
      }
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('maps 404 and 403 to typed errors', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    try {
      const client = new OpenProjectClient({ baseUrl: BASE_URL, apiKey: API_KEY })

      fetchMock.mockResolvedValueOnce(new Response('', { status: 404 }))
      await expect(client.deleteTimeEntry({ id: 77 })).rejects.toMatchObject({
        code: 'OPENPROJECT_NOT_FOUND'
      })

      fetchMock.mockResolvedValueOnce(new Response('', { status: 403 }))
      await expect(client.deleteTimeEntry({ id: 77 })).rejects.toMatchObject({
        code: 'OPENPROJECT_AUTH_FAILED'
      })

      fetchMock.mockResolvedValueOnce(new Response('', { status: 503 }))
      await expect(client.deleteTimeEntry({ id: 77 })).rejects.toMatchObject({
        code: 'OPENPROJECT_SERVER_ERROR'
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
