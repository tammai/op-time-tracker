import {
  beforeEach,
  afterEach,
  describe,
  it,
  expect,
  vi
} from 'vitest'

import type { ElectronStub } from '~~/tests/support/electron-mock'

// `vi.mock('electron', factory)` is hoisted above all `import` statements,
// and the factory cannot reference imported bindings (temporal dead zone).
// `vi.hoisted` callbacks have the same restriction, but they CAN use
// `require()` — so the helper is loaded with a relative `require('<path>.ts')`
// inside `vi.hoisted`, and it in turn `require`s node builtins. The returned
// stub's `module` is what the `electron` mock factory returns. The
// `ElectronStub` type import is erased at runtime, so it's safe as a normal
// import. See `tests/support/electron-mock.ts`.
const electron = vi.hoisted<ElectronStub>(() =>
  require('../../support/electron-mock.ts').createElectronStub()
)
vi.mock('electron', () => electron.module)

const { setupElectronMock, makeUserDataDir, cleanupUserDataDir } = electron

// Wire the real IPC handlers + credential store + OpenProject client
// against the mocked `electron` + mocked `fetch`. Internal collaborators
// are NOT mocked — only the true I/O boundary (`fetch`, `safeStorage`,
// `electron-store`, `ipcMain`).
import { registerOpenProjectIpcHandlers, toIpcError } from '~~/src/main/ipc/openproject'
import {
  saveCredentials,
  __resetStoreForTests,
  CredentialReadError,
  CredentialNotReadyError
} from '~~/src/main/credentials'
import { OpenProjectError } from '~~/src/main/openproject/client'

import { WorkPackageCollectionSchema } from '~~/src/main/schemas/work-packages'
import {
  TimeEntryCollectionSchema,
  TimeEntrySchema,
  TimeEntryActivityCollectionSchema
} from '~~/src/main/schemas/time-entries'
import { StatusCollectionSchema } from '~~/src/main/schemas/statuses'

import workPackagesFixture from '~~/tests/fixtures/work-packages-collection.json'
import timeEntriesFixture from '~~/tests/fixtures/time-entries-collection.json'
import statusesFixture from '~~/tests/fixtures/statuses-collection.json'

const BASE_URL = 'https://openproject.example.com'
// A throwaway test API key. Asserted present in the Authorization header,
// but never printed in test output — assertions compare against the
// precomputed constants below, not template strings embedding the key.
const API_KEY = 'integration-test-api-key-xyz-9876543210'
const EXPECTED_AUTH = `Basic ${Buffer.from(`apikey:${API_KEY}`).toString('base64')}`

let userDataDir: string
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  userDataDir = makeUserDataDir()
  setupElectronMock({ safeStorageAvailable: true, userDataDir })
  __resetStoreForTests()

  // Fresh fetch mock per test. Each scenario stubs `fetchMock.mock*` to
  // return a controlled `Response` (or reject).
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)

  // Register the IPC handlers into the in-memory `ipcMain.handle` map.
  // The test invokes them via `electron.invoke(channel, ...)`.
  registerOpenProjectIpcHandlers()
})

afterEach(() => {
  __resetStoreForTests()
  cleanupUserDataDir(userDataDir)
  vi.unstubAllGlobals()
  electron.resetRegisteredHandlers()
})

/** Helper: invoke the work-packages handler. */
function listWorkPackages(filters?: unknown): Promise<unknown> {
  return electron.invoke('op:openproject:list-work-packages', { filters })
}

/** Helper: invoke the time-entries handler. */
function listTimeEntries(filters?: unknown): Promise<unknown> {
  return electron.invoke('op:openproject:list-time-entries', { filters })
}

/** Helper: invoke the statuses handler. */
function listStatuses(): Promise<unknown> {
  return electron.invoke('op:openproject:list-statuses')
}

/** Build a 200 Response with a JSON body. */
function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}

/**
 * Invoke a handler and capture the rejection. Returns a helper that
 * asserts on the error's `code` and that the message never leaks the API
 * key or auth header. Asserts against precomputed constants so a failure
 * never prints the secret.
 */
async function expectIpcError(fn: () => Promise<unknown>): Promise<{
  code: string
  message: string
}> {
  let caught: { code?: string; message?: string } | undefined
  try {
    await fn()
  } catch (e) {
    caught = e as { code?: string; message?: string }
  }
  expect(caught).toBeDefined()
  expect(typeof caught!.code).toBe('string')
  expect(typeof caught!.message).toBe('string')
  // Security: the error message must never carry the API key, the auth
  // header value, or the raw server response body.
  expect(caught!.message).not.toContain(API_KEY)
  expect(caught!.message).not.toContain(EXPECTED_AUTH)
  return { code: caught!.code!, message: caught!.message! }
}

describe('happy path — work packages', () => {
  it('returns the Zod-validated collection and calls fetch with the right URL + auth', async () => {
    await saveCredentials({ baseUrl: BASE_URL, apiKey: API_KEY })
    fetchMock.mockResolvedValueOnce(jsonOk(workPackagesFixture))

    const result = await listWorkPackages()

    // The returned shape is exactly what the Zod schema parses from the
    // fixture — exercise the real schema + parser, don't re-assert by hand.
    const expected = WorkPackageCollectionSchema.parse(workPackagesFixture)
    expect(result).toEqual(expected)
    expect((result as { count: number }).count).toBe(2)
    const elements = (result as { _embedded: { elements: unknown[] } })._embedded
      .elements
    expect(elements).toHaveLength(2)
    // Spot-check a sample element's fields flow through.
    const first = elements[0] as { id: number; subject: string }
    expect(first.id).toBe(42)
    expect(first.subject).toBe('Fix login bug')

    // fetch was called once, with the right URL + headers.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.href).toBe(`${BASE_URL}/api/v3/work_packages`)
    expect(init.method).toBe('GET')
    const headers = init.headers as Record<string, string>
    // Verify the auth header is the expected Basic value, but never log
    // the key itself (assert on the precomputed value, not a template that
    // would embed the key in a failure message).
    expect(headers.Authorization).toBe(EXPECTED_AUTH)
    expect(headers.Accept).toBe('application/json')
  })
})

describe('happy path — time entries with spentOn between filter', () => {
  it('encodes the spentOn between filter into the URL query string', async () => {
    await saveCredentials({ baseUrl: BASE_URL, apiKey: API_KEY })
    fetchMock.mockResolvedValueOnce(jsonOk(timeEntriesFixture))

    const result = await listTimeEntries({
      spentOn: { between: ['2026-01-01', '2026-01-31'] }
    })

    const expected = TimeEntryCollectionSchema.parse(timeEntriesFixture)
    expect(result).toEqual(expected)

    const [url] = fetchMock.mock.calls[0] as [URL, RequestInit]
    // The filters param is URL-encoded JSON; decode + parse to assert the
    // spentOn between operator + values made it into the request.
    const filtersParam = url.searchParams.get('filters')
    expect(filtersParam).not.toBeNull()
    const parsed = JSON.parse(filtersParam!) as Array<{
      spentOn: { operator: string; values: string[] }
    }>
    expect(parsed[0].spentOn.operator).toBe('<>d')
    expect(parsed[0].spentOn.values).toEqual(['2026-01-01', '2026-01-31'])
    expect(url.href.startsWith(`${BASE_URL}/api/v3/time_entries?`)).toBe(true)
  })
})

describe('happy path — statuses', () => {
  it('returns the Zod-validated collection and calls fetch with the right URL + auth', async () => {
    await saveCredentials({ baseUrl: BASE_URL, apiKey: API_KEY })
    fetchMock.mockResolvedValueOnce(jsonOk(statusesFixture))

    const result = await listStatuses()

    const expected = StatusCollectionSchema.parse(statusesFixture)
    expect(result).toEqual(expected)
    expect((result as { count: number }).count).toBe(3)
    const elements = (result as { _embedded: { elements: unknown[] } })._embedded
      .elements
    expect(elements).toHaveLength(3)
    const first = elements[0] as { id: number; name: string }
    expect(first.id).toBe(3)
    expect(first.name).toBe('In Progress')

    // fetch was called once, with the right URL + headers. The statuses
    // request takes no filters/pagination, so the URL has no query string.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.href).toBe(`${BASE_URL}/api/v3/statuses`)
    expect(url.search).toBe('')
    expect(init.method).toBe('GET')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe(EXPECTED_AUTH)
    expect(headers.Accept).toBe('application/json')
  })

  it('401 → OPENPROJECT_AUTH_FAILED with no key leakage', async () => {
    await saveCredentials({ baseUrl: BASE_URL, apiKey: API_KEY })
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401 })
    )
    const err = await expectIpcError(listStatuses)
    expect(err.code).toBe('OPENPROJECT_AUTH_FAILED')
  })

  it('no credentials configured → CREDENTIAL_NOT_CONFIGURED (fetch never called)', async () => {
    // Deliberately do NOT call saveCredentials.
    const err = await expectIpcError(listStatuses)
    expect(err.code).toBe('CREDENTIAL_NOT_CONFIGURED')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('401 — bad API key', () => {
  it('throws an IPC auth error with no key leakage', async () => {
    await saveCredentials({ baseUrl: BASE_URL, apiKey: API_KEY })
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401 })
    )

    const err = await expectIpcError(listWorkPackages)
    expect(err.code).toBe('OPENPROJECT_AUTH_FAILED')
  })
})

describe('404 — bad base URL / resource', () => {
  it('throws an IPC not-found error with no key leakage', async () => {
    await saveCredentials({ baseUrl: BASE_URL, apiKey: API_KEY })
    fetchMock.mockResolvedValueOnce(new Response('', { status: 404 }))

    const err = await expectIpcError(listWorkPackages)
    expect(err.code).toBe('OPENPROJECT_NOT_FOUND')
  })
})

describe('network failure', () => {
  it('throws a server/network error code with no key leakage', async () => {
    await saveCredentials({ baseUrl: BASE_URL, apiKey: API_KEY })
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))

    const err = await expectIpcError(listWorkPackages)
    expect(err.code).toBe('OPENPROJECT_SERVER_ERROR')
  })
})

describe('timeout (AbortError)', () => {
  it('surfaces a timeout error code', async () => {
    await saveCredentials({ baseUrl: BASE_URL, apiKey: API_KEY })
    // Simulate the client's AbortController firing: fetch rejects with a
    // DOMException named 'AbortError'. The client maps this to
    // `OpenProjectTimeoutError` (code OPENPROJECT_TIMEOUT).
    fetchMock.mockRejectedValueOnce(
      new DOMException('The operation was aborted', 'AbortError')
    )

    const err = await expectIpcError(listWorkPackages)
    expect(err.code).toBe('OPENPROJECT_TIMEOUT')
  })
})

describe('no credentials configured', () => {
  it('throws CREDENTIAL_NOT_CONFIGURED', async () => {
    // Deliberately do NOT call saveCredentials.
    const err = await expectIpcError(listWorkPackages)
    expect(err.code).toBe('CREDENTIAL_NOT_CONFIGURED')
    // fetch must never have been called — the credential gate fired first.
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('Zod validation failure', () => {
  it('throws OPENPROJECT_SCHEMA_FAILED, not a raw Zod error', async () => {
    await saveCredentials({ baseUrl: BASE_URL, apiKey: API_KEY })
    // Malformed collection: missing `_embedded` + wrong `_type`. The client
    // must catch the Zod failure and surface a typed IPC error code, never
    // a raw Zod error string leaking to the renderer.
    fetchMock.mockResolvedValueOnce(
      jsonOk({ _type: 'Wrong', total: 0, count: 0 })
    )

    const err = await expectIpcError(listWorkPackages)
    expect(err.code).toBe('OPENPROJECT_SCHEMA_FAILED')
    // The message must not carry raw Zod issue details (the renderer
    // gets a clean code + message, never the Zod issue list). Note:
    // "unexpected" appears in the clean message itself, so we check for
    // distinct Zod-leakage markers instead.
    expect(err.message).not.toContain('_embedded')
    expect(err.message).not.toContain('invalid_literal')
    expect(err.message).not.toContain('required')
  })
})

describe('toIpcError normalization (the error contract unit)', () => {
  it('maps OpenProjectError → IpcError with { code, message }', () => {
    const err = new OpenProjectError('CUSTOM_CODE', 'boom')
    const normalized = toIpcError(err)
    expect(normalized.code).toBe('CUSTOM_CODE')
    expect(normalized.message).toBe('boom')
    expect(normalized).toBeInstanceOf(Error)
  })

  it('maps CredentialReadError → CREDENTIAL_READ_FAILED', () => {
    const err = new CredentialReadError('cannot read')
    const normalized = toIpcError(err)
    expect(normalized.code).toBe('CREDENTIAL_READ_FAILED')
    expect(normalized.message).toBe('cannot read')
    expect(normalized).toBeInstanceOf(Error)
  })

  it('maps CredentialNotReadyError → CREDENTIAL_NOT_READY', () => {
    const err = new CredentialNotReadyError()
    expect(toIpcError(err).code).toBe('CREDENTIAL_NOT_READY')
  })

  it('maps unknown errors to OPENPROJECT_UNKNOWN without leaking details', () => {
    // An unexpected error that happens to mention the key — toIpcError
    // must replace its message with a generic one, never forward it.
    const err = new Error('something with the key maybe: ' + API_KEY)
    const normalized = toIpcError(err)
    expect(normalized.code).toBe('OPENPROJECT_UNKNOWN')
    expect(normalized.message).not.toContain(API_KEY)
    expect(normalized.message).toBe(
      'An unexpected error occurred while contacting OpenProject.'
    )
  })
})
/** Helper: invoke the create-time-entry handler. */
function createTimeEntry(input: unknown): Promise<unknown> {
  return electron.invoke('op:openproject:create-time-entry', input)
}

/** Helper: invoke the activities handler. */
function listTimeEntryActivities(workPackageId?: number): Promise<unknown> {
  return electron.invoke('op:openproject:list-time-entry-activities', {
    workPackageId
  })
}

describe('happy path — create time entry', () => {
  const validInput = {
    workPackageId: 42,
    activityId: 3,
    spentOn: '2026-07-25',
    hours: 1.5,
    comment: 'Reviewed the redesign spec'
  }

  it('POSTs with auth and returns the Zod-validated created entry', async () => {
    await saveCredentials({ baseUrl: BASE_URL, apiKey: API_KEY })
    const created = timeEntriesFixture._embedded.elements[0]
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(created), {
        status: 201,
        headers: { 'content-type': 'application/json' }
      })
    )

    const result = await createTimeEntry(validInput)
    expect(result).toEqual(TimeEntrySchema.parse(created))

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.href).toBe(`${BASE_URL}/api/v3/time_entries`)
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe(EXPECTED_AUTH)
    expect(headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body as string).hours).toBe('PT1H30M')
  })

  it('rejects renderer-supplied invalid input without calling fetch', async () => {
    await saveCredentials({ baseUrl: BASE_URL, apiKey: API_KEY })

    const err = await expectIpcError(() =>
      createTimeEntry({ ...validInput, hours: 0 })
    )
    expect(err.code).toBe('OPENPROJECT_INVALID_INPUT')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a renderer-supplied href in place of a numeric id', async () => {
    await saveCredentials({ baseUrl: BASE_URL, apiKey: API_KEY })

    // A renderer that tries to smuggle a path/URL instead of an id must be
    // refused by the schema, never interpolated into a request.
    const err = await expectIpcError(() =>
      createTimeEntry({
        ...validInput,
        workPackageId: '../../admin' as unknown as number
      })
    )
    expect(err.code).toBe('OPENPROJECT_INVALID_INPUT')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces a 422 as OPENPROJECT_VALIDATION_FAILED with only the server message', async () => {
    await saveCredentials({ baseUrl: BASE_URL, apiKey: API_KEY })
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          _type: 'Error',
          message: 'Activity is not set to one of the allowed values.',
          _embedded: { payload: { echoed: 'must-not-leak' } }
        }),
        { status: 422, headers: { 'content-type': 'application/json' } }
      )
    )

    const err = await expectIpcError(() => createTimeEntry(validInput))
    expect(err.code).toBe('OPENPROJECT_VALIDATION_FAILED')
    expect(err.message).toBe('Activity is not set to one of the allowed values.')
    expect(err.message).not.toContain('must-not-leak')
  })

  it('surfaces a 401 on the write path as OPENPROJECT_AUTH_FAILED', async () => {
    await saveCredentials({ baseUrl: BASE_URL, apiKey: API_KEY })
    fetchMock.mockResolvedValueOnce(new Response('', { status: 401 }))

    const err = await expectIpcError(() => createTimeEntry(validInput))
    expect(err.code).toBe('OPENPROJECT_AUTH_FAILED')
  })

  it('rejects with CREDENTIAL_NOT_CONFIGURED when nothing is stored', async () => {
    const err = await expectIpcError(() => createTimeEntry(validInput))
    expect(err.code).toBe('CREDENTIAL_NOT_CONFIGURED')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('happy path — time entry activities', () => {
  const formResponse = {
    _type: 'Form',
    _embedded: {
      schema: {
        activity: {
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

  it('returns the validated activity collection', async () => {
    await saveCredentials({ baseUrl: BASE_URL, apiKey: API_KEY })
    fetchMock.mockResolvedValueOnce(jsonOk(formResponse))

    const result = await listTimeEntryActivities()
    expect(
      TimeEntryActivityCollectionSchema.parse(result)._embedded.elements
    ).toEqual([
      { id: 1, name: 'Management' },
      { id: 2, name: 'Development' }
    ])

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.href).toBe(`${BASE_URL}/api/v3/time_entries/form`)
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe(EXPECTED_AUTH)
  })

  it('scopes the request to a work package when one is given', async () => {
    await saveCredentials({ baseUrl: BASE_URL, apiKey: API_KEY })
    fetchMock.mockResolvedValueOnce(jsonOk(formResponse))

    await listTimeEntryActivities(42)
    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({
      _links: { workPackage: { href: '/api/v3/work_packages/42' } }
    })
  })

  it('surfaces a 500 as OPENPROJECT_SERVER_ERROR without leaking the body', async () => {
    await saveCredentials({ baseUrl: BASE_URL, apiKey: API_KEY })
    fetchMock.mockResolvedValueOnce(
      new Response('internal stack trace with ' + API_KEY, { status: 500 })
    )

    const err = await expectIpcError(() => listTimeEntryActivities())
    expect(err.code).toBe('OPENPROJECT_SERVER_ERROR')
    expect(err.message).not.toContain('stack trace')
  })
})
