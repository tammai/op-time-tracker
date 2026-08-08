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

import {
  WorkPackageCollectionSchema,
  WorkPackageSchema
} from '~~/src/main/schemas/work-packages'
import { PrincipalCollectionSchema } from '~~/src/main/schemas/principals'
import { ProjectCollectionSchema } from '~~/src/main/schemas/projects'
import {
  TimeEntryCollectionSchema,
  TimeEntrySchema,
  TimeEntryActivityCollectionSchema
} from '~~/src/main/schemas/time-entries'
import { StatusCollectionSchema } from '~~/src/main/schemas/statuses'

import workPackagesFixture from '~~/tests/fixtures/work-packages-collection.json'
import timeEntriesFixture from '~~/tests/fixtures/time-entries-collection.json'
import statusesFixture from '~~/tests/fixtures/statuses-collection.json'
import workPackageFormFixture from '~~/tests/fixtures/work-package-form.json'
import assigneesFixture from '~~/tests/fixtures/available-assignees-collection.json'
import projectsFixture from '~~/tests/fixtures/projects-collection.json'
import createFormFixture from '~~/tests/fixtures/work-package-create-form.json'

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

/** Helper: invoke the update-time-entry handler. */
function updateTimeEntry(input: unknown): Promise<unknown> {
  return electron.invoke('op:openproject:update-time-entry', input)
}

/** Helper: invoke the delete-time-entry handler. */
function deleteTimeEntry(input: unknown): Promise<unknown> {
  return electron.invoke('op:openproject:delete-time-entry', input)
}

describe('happy path — update time entry', () => {
  const validInput = {
    id: 100,
    workPackageId: 42,
    activityId: 3,
    spentOn: '2026-07-25',
    hours: 1.5,
    comment: 'Reviewed the redesign spec'
  }

  it('PATCHes the entry URL with auth and returns the Zod-validated entry', async () => {
    await saveCredentials({ baseUrl: BASE_URL, apiKey: API_KEY })
    const updated = timeEntriesFixture._embedded.elements[0]
    fetchMock.mockResolvedValueOnce(jsonOk(updated))

    const result = await updateTimeEntry(validInput)
    expect(result).toEqual(TimeEntrySchema.parse(updated))

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.href).toBe(`${BASE_URL}/api/v3/time_entries/100`)
    expect(init.method).toBe('PATCH')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe(EXPECTED_AUTH)
    expect(headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body as string).hours).toBe('PT1H30M')
  })

  it('rejects renderer-supplied invalid input without calling fetch', async () => {
    await saveCredentials({ baseUrl: BASE_URL, apiKey: API_KEY })

    const err = await expectIpcError(() =>
      updateTimeEntry({ ...validInput, hours: 0 })
    )
    expect(err.code).toBe('OPENPROJECT_INVALID_INPUT')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a renderer-supplied path in place of a numeric entry id', async () => {
    await saveCredentials({ baseUrl: BASE_URL, apiKey: API_KEY })

    // The entry id is the one value that reaches the request *path*. A
    // renderer that sends a traversal string must be refused by the schema,
    // never interpolated into the URL.
    for (const id of ['100/../../users', '100?x=1', '../admin']) {
      const err = await expectIpcError(() =>
        updateTimeEntry({ ...validInput, id: id as unknown as number })
      )
      expect(err.code).toBe('OPENPROJECT_INVALID_INPUT')
    }
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

    const err = await expectIpcError(() => updateTimeEntry(validInput))
    expect(err.code).toBe('OPENPROJECT_VALIDATION_FAILED')
    expect(err.message).toBe('Activity is not set to one of the allowed values.')
    expect(err.message).not.toContain('must-not-leak')
  })

  it('surfaces a 404 as OPENPROJECT_NOT_FOUND — the entry is gone', async () => {
    await saveCredentials({ baseUrl: BASE_URL, apiKey: API_KEY })
    fetchMock.mockResolvedValueOnce(new Response('', { status: 404 }))

    const err = await expectIpcError(() => updateTimeEntry(validInput))
    expect(err.code).toBe('OPENPROJECT_NOT_FOUND')
  })

  it('rejects with CREDENTIAL_NOT_CONFIGURED when nothing is stored', async () => {
    const err = await expectIpcError(() => updateTimeEntry(validInput))
    expect(err.code).toBe('CREDENTIAL_NOT_CONFIGURED')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('happy path — delete time entry', () => {
  it('DELETEs the entry URL with auth and resolves with nothing', async () => {
    await saveCredentials({ baseUrl: BASE_URL, apiKey: API_KEY })
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))

    // The handler returns nothing — a 204 has no body to hand the renderer.
    await expect(deleteTimeEntry({ id: 100 })).resolves.toBeUndefined()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.href).toBe(`${BASE_URL}/api/v3/time_entries/100`)
    expect(init.method).toBe('DELETE')
    expect(init.body).toBeUndefined()
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe(EXPECTED_AUTH)
  })

  it('rejects a non-positive-integer id without calling fetch', async () => {
    await saveCredentials({ baseUrl: BASE_URL, apiKey: API_KEY })

    for (const id of [0, -1, 1.5, '100/../../users', null, undefined]) {
      const err = await expectIpcError(() => deleteTimeEntry({ id }))
      expect(err.code).toBe('OPENPROJECT_INVALID_INPUT')
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces a 404 as OPENPROJECT_NOT_FOUND', async () => {
    await saveCredentials({ baseUrl: BASE_URL, apiKey: API_KEY })
    fetchMock.mockResolvedValueOnce(new Response('', { status: 404 }))

    const err = await expectIpcError(() => deleteTimeEntry({ id: 100 }))
    expect(err.code).toBe('OPENPROJECT_NOT_FOUND')
  })

  it('surfaces a 500 without leaking the response body or the key', async () => {
    await saveCredentials({ baseUrl: BASE_URL, apiKey: API_KEY })
    fetchMock.mockResolvedValueOnce(
      new Response('internal stack trace with ' + API_KEY, { status: 500 })
    )

    const err = await expectIpcError(() => deleteTimeEntry({ id: 100 }))
    expect(err.code).toBe('OPENPROJECT_SERVER_ERROR')
    expect(err.message).not.toContain('stack trace')
  })

  it('rejects with CREDENTIAL_NOT_CONFIGURED when nothing is stored', async () => {
    const err = await expectIpcError(() => deleteTimeEntry({ id: 100 }))
    expect(err.code).toBe('CREDENTIAL_NOT_CONFIGURED')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Work-package editing channels (stage 2)
//
// Same integration shape as the time-entry writes above: the real handler, the
// real credential store, the real client and the real schemas, with only
// `fetch` / `safeStorage` / `ipcMain` stubbed. What these cover that the client
// unit tests cannot is the wiring — that the channel exists, reads credentials
// before anything else, and normalizes every failure through `toIpcError()` so
// no credential detail or raw server body reaches the renderer.
// ---------------------------------------------------------------------------

/** Helper: invoke the work-package form handler. */
function getWorkPackageForm(input: unknown): Promise<unknown> {
  return electron.invoke('op:openproject:get-work-package-form', input)
}

/** Helper: invoke the available-assignees handler. */
function listAvailableAssignees(input: unknown): Promise<unknown> {
  return electron.invoke('op:openproject:list-available-assignees', input)
}

/** Helper: invoke the update-work-package handler. */
function updateWorkPackage(input: unknown): Promise<unknown> {
  return electron.invoke('op:openproject:update-work-package', input)
}

describe('happy path — work package form', () => {
  const validInput = { workPackageId: 34922, lockVersion: 5 }

  it('POSTs the form endpoint with auth and returns the flattened allowed values', async () => {
    await saveCredentials({ baseUrl: BASE_URL, apiKey: API_KEY })
    fetchMock.mockResolvedValueOnce(jsonOk(workPackageFormFixture))

    const result = (await getWorkPackageForm(validInput)) as {
      status: { writable: boolean; allowedValues: Array<{ id: number; name: string }> }
      subject: { writable: boolean }
    }

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.href).toBe(`${BASE_URL}/api/v3/work_packages/34922/form`)
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe(EXPECTED_AUTH)

    // The renderer receives `{ id, name }` lists — the HAL never crosses IPC.
    expect(result.status.allowedValues).toEqual([
      { id: 1, name: 'To Do' },
      { id: 21, name: 'Ready for UAT' },
      { id: 26, name: 'QA Completed' }
    ])
    expect(result.subject.writable).toBe(true)
    expect(JSON.stringify(result)).not.toContain('href')
  })

  it('forwards nothing but the lock version — the POST is never a write primitive', async () => {
    await saveCredentials({ baseUrl: BASE_URL, apiKey: API_KEY })
    fetchMock.mockResolvedValueOnce(jsonOk(workPackageFormFixture))

    // Extra keys a hostile renderer might append to the IPC payload. If any of
    // them reached the body, this read channel would become a write.
    await getWorkPackageForm({
      ...validInput,
      subject: 'pwned',
      _links: { status: { href: '/api/v3/statuses/9' } }
    })

    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ lockVersion: 5 })
  })

  it('rejects a renderer-supplied path in place of the numeric id, without calling fetch', async () => {
    await saveCredentials({ baseUrl: BASE_URL, apiKey: API_KEY })

    for (const workPackageId of ['34922/../../users', '../admin', 0, -1, 1.5]) {
      const err = await expectIpcError(() =>
        getWorkPackageForm({ ...validInput, workPackageId })
      )
      expect(err.code).toBe('OPENPROJECT_INVALID_INPUT')
    }
    for (const lockVersion of [-1, 1.5, '5', null, undefined]) {
      const err = await expectIpcError(() =>
        getWorkPackageForm({ ...validInput, lockVersion })
      )
      expect(err.code).toBe('OPENPROJECT_INVALID_INPUT')
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces a 409 as OPENPROJECT_CONFLICT — a stale lock version', async () => {
    await saveCredentials({ baseUrl: BASE_URL, apiKey: API_KEY })
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          _type: 'Error',
          errorIdentifier: 'urn:openproject-org:api:v3:errors:UpdateConflict',
          message: 'Could not update the resource because of conflicting modifications.'
        }),
        { status: 409, headers: { 'content-type': 'application/json' } }
      )
    )

    // The renderer branches on this code to refetch rather than retry, so it
    // must survive `toIpcError()` intact instead of flattening to a generic
    // HTTP failure.
    const err = await expectIpcError(() => getWorkPackageForm(validInput))
    expect(err.code).toBe('OPENPROJECT_CONFLICT')
  })

  it('surfaces a 500 without leaking the response body or the key', async () => {
    await saveCredentials({ baseUrl: BASE_URL, apiKey: API_KEY })
    fetchMock.mockResolvedValueOnce(
      new Response('internal stack trace with ' + API_KEY, { status: 500 })
    )

    const err = await expectIpcError(() => getWorkPackageForm(validInput))
    expect(err.code).toBe('OPENPROJECT_SERVER_ERROR')
    expect(err.message).not.toContain('stack trace')
  })

  it('rejects with CREDENTIAL_NOT_CONFIGURED when nothing is stored', async () => {
    const err = await expectIpcError(() => getWorkPackageForm(validInput))
    expect(err.code).toBe('CREDENTIAL_NOT_CONFIGURED')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('happy path — available assignees', () => {
  it('GETs the project-scoped endpoint with auth and returns the validated collection', async () => {
    await saveCredentials({ baseUrl: BASE_URL, apiKey: API_KEY })
    fetchMock.mockResolvedValueOnce(jsonOk(assigneesFixture))

    const result = await listAvailableAssignees({ projectId: 41 })
    expect(result).toEqual(PrincipalCollectionSchema.parse(assigneesFixture))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    // A *project* resource — the work-package-scoped route answers 404.
    expect(url.pathname).toBe('/api/v3/projects/41/available_assignees')
    expect(init.method ?? 'GET').toBe('GET')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe(EXPECTED_AUTH)

    // A group in the list must not fail the parse and empty the whole select.
    const elements = (result as { _embedded: { elements: Array<{ _type: string }> } })
      ._embedded.elements
    expect(elements).toHaveLength(5)
    expect(elements.some((p) => p._type === 'Group')).toBe(true)
  })

  it('rejects a renderer-supplied path in place of the numeric project id', async () => {
    await saveCredentials({ baseUrl: BASE_URL, apiKey: API_KEY })

    for (const projectId of ['41/../../users', 0, -1, 2.5, null, undefined]) {
      const err = await expectIpcError(() => listAvailableAssignees({ projectId }))
      expect(err.code).toBe('OPENPROJECT_INVALID_INPUT')
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces a 404 as OPENPROJECT_NOT_FOUND — the project is gone or invisible', async () => {
    await saveCredentials({ baseUrl: BASE_URL, apiKey: API_KEY })
    fetchMock.mockResolvedValueOnce(new Response('', { status: 404 }))

    const err = await expectIpcError(() => listAvailableAssignees({ projectId: 41 }))
    expect(err.code).toBe('OPENPROJECT_NOT_FOUND')
  })

  it('surfaces a 500 without leaking the response body or the key', async () => {
    await saveCredentials({ baseUrl: BASE_URL, apiKey: API_KEY })
    fetchMock.mockResolvedValueOnce(
      new Response('internal stack trace with ' + API_KEY, { status: 500 })
    )

    const err = await expectIpcError(() => listAvailableAssignees({ projectId: 41 }))
    expect(err.code).toBe('OPENPROJECT_SERVER_ERROR')
    expect(err.message).not.toContain('stack trace')
  })

  it('rejects with CREDENTIAL_NOT_CONFIGURED when nothing is stored', async () => {
    const err = await expectIpcError(() => listAvailableAssignees({ projectId: 41 }))
    expect(err.code).toBe('CREDENTIAL_NOT_CONFIGURED')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('happy path — update work package', () => {
  const validInput = { id: 42, lockVersion: 4, subject: 'Fix login bug (revised)' }

  /** What OpenProject echoes back after a successful PATCH. */
  const echoed = {
    ...workPackagesFixture._embedded.elements[0],
    lockVersion: 5,
    subject: 'Fix login bug (revised)'
  }

  it('PATCHes the work package URL with auth and returns the Zod-validated result', async () => {
    await saveCredentials({ baseUrl: BASE_URL, apiKey: API_KEY })
    fetchMock.mockResolvedValueOnce(jsonOk(echoed))

    const result = await updateWorkPackage(validInput)
    // The echoed lock version is what the renderer re-seeds from; without it
    // the next save would conflict against this one.
    expect(result).toEqual(WorkPackageSchema.parse(echoed))
    expect((result as { lockVersion: number }).lockVersion).toBe(5)

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.href).toBe(`${BASE_URL}/api/v3/work_packages/42`)
    expect(init.method).toBe('PATCH')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe(EXPECTED_AUTH)
    expect(headers['Content-Type']).toBe('application/json')
  })

  it('sends only the fields the renderer actually passed, plus the lock version', async () => {
    await saveCredentials({ baseUrl: BASE_URL, apiKey: API_KEY })
    fetchMock.mockResolvedValueOnce(jsonOk(echoed))

    await updateWorkPackage({ id: 42, lockVersion: 4, statusId: 26 })

    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    // A partial update: an absent field must be absent from the body, or
    // OpenProject would rewrite data the user never opened.
    expect(body).toEqual({
      lockVersion: 4,
      _links: { status: { href: '/api/v3/statuses/26' } }
    })
    expect('subject' in body).toBe(false)
    expect('startDate' in body).toBe(false)
  })

  it('keeps "clear this field" distinct from "leave it alone"', async () => {
    await saveCredentials({ baseUrl: BASE_URL, apiKey: API_KEY })
    fetchMock.mockResolvedValueOnce(jsonOk(echoed))

    await updateWorkPackage({
      id: 42,
      lockVersion: 4,
      dueDate: null,
      assigneeId: null
    })

    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.dueDate).toBeNull()
    expect(body._links).toEqual({ assignee: { href: null } })
    // The untouched date must not ride along as a null and wipe itself.
    expect('startDate' in body).toBe(false)
  })

  it('rejects renderer-supplied invalid input without calling fetch', async () => {
    await saveCredentials({ baseUrl: BASE_URL, apiKey: API_KEY })

    for (const bad of [
      { ...validInput, subject: '' },
      { ...validInput, subject: 'x'.repeat(256) },
      { ...validInput, startDate: '2026-02-31' },
      { ...validInput, statusId: 0 },
      { ...validInput, assigneeId: -3 },
      { ...validInput, lockVersion: -1 }
    ]) {
      const err = await expectIpcError(() => updateWorkPackage(bad))
      expect(err.code).toBe('OPENPROJECT_INVALID_INPUT')
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a renderer-supplied path in place of the numeric work package id', async () => {
    await saveCredentials({ baseUrl: BASE_URL, apiKey: API_KEY })

    // The id is the one value that reaches the request *path*.
    for (const id of ['42/../../users', '42?x=1', '../admin', 0, 1.5]) {
      const err = await expectIpcError(() => updateWorkPackage({ ...validInput, id }))
      expect(err.code).toBe('OPENPROJECT_INVALID_INPUT')
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces a 409 as OPENPROJECT_CONFLICT — somebody else saved first', async () => {
    await saveCredentials({ baseUrl: BASE_URL, apiKey: API_KEY })
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          _type: 'Error',
          message: 'Could not update the resource because of conflicting modifications.'
        }),
        { status: 409, headers: { 'content-type': 'application/json' } }
      )
    )

    const err = await expectIpcError(() => updateWorkPackage(validInput))
    expect(err.code).toBe('OPENPROJECT_CONFLICT')
  })

  it('surfaces a 422 as OPENPROJECT_VALIDATION_FAILED with only the server message', async () => {
    await saveCredentials({ baseUrl: BASE_URL, apiKey: API_KEY })
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          _type: 'Error',
          message: 'Status is not set to one of the allowed values.',
          _embedded: { payload: { echoed: 'must-not-leak' } }
        }),
        { status: 422, headers: { 'content-type': 'application/json' } }
      )
    )

    // 422 is the actionable one — the user can fix an illegal transition, so
    // the server's own wording is worth forwarding. The echoed payload is not.
    const err = await expectIpcError(() => updateWorkPackage(validInput))
    expect(err.code).toBe('OPENPROJECT_VALIDATION_FAILED')
    expect(err.message).toBe('Status is not set to one of the allowed values.')
    expect(err.message).not.toContain('must-not-leak')
  })

  it('surfaces a 401 on the write path as OPENPROJECT_AUTH_FAILED', async () => {
    await saveCredentials({ baseUrl: BASE_URL, apiKey: API_KEY })
    fetchMock.mockResolvedValueOnce(new Response('', { status: 401 }))

    const err = await expectIpcError(() => updateWorkPackage(validInput))
    expect(err.code).toBe('OPENPROJECT_AUTH_FAILED')
  })

  it('rejects with CREDENTIAL_NOT_CONFIGURED when nothing is stored', async () => {
    const err = await expectIpcError(() => updateWorkPackage(validInput))
    expect(err.code).toBe('CREDENTIAL_NOT_CONFIGURED')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Stage 3 — the create channels
// ---------------------------------------------------------------------------

/** Helper: invoke the projects handler (it takes no input). */
function listProjects(): Promise<unknown> {
  return electron.invoke('op:openproject:list-projects')
}

/** Helper: invoke the create-form handler. */
function getWorkPackageCreateForm(input: unknown): Promise<unknown> {
  return electron.invoke('op:openproject:get-work-package-create-form', input)
}

/** Helper: invoke the create handler. */
function createWorkPackage(input: unknown): Promise<unknown> {
  return electron.invoke('op:openproject:create-work-package', input)
}

describe('happy path — projects', () => {
  it('GETs the available-projects collection with auth and Zod-validates it', async () => {
    await saveCredentials({ baseUrl: BASE_URL, apiKey: API_KEY })
    fetchMock.mockResolvedValueOnce(jsonOk(projectsFixture))

    const result = await listProjects()
    expect(result).toEqual(ProjectCollectionSchema.parse(projectsFixture))

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    // Not `/api/v3/projects` — that collection includes projects this key can
    // see but not create in.
    expect(url.pathname).toBe('/api/v3/work_packages/available_projects')
    expect((init.headers as Record<string, string>).Authorization).toBe(EXPECTED_AUTH)
  })

  it('returns an empty collection rather than an error when the key may create nowhere', async () => {
    await saveCredentials({ baseUrl: BASE_URL, apiKey: API_KEY })
    fetchMock.mockResolvedValueOnce(
      jsonOk({ _type: 'Collection', total: 0, count: 0, _embedded: { elements: [] } })
    )
    const result = (await listProjects()) as { _embedded: { elements: unknown[] } }
    expect(result._embedded.elements).toEqual([])
  })

  it('rejects with a typed error when no credentials are configured', async () => {
    const err = await expectIpcError(() => listProjects())
    expect(err.code).toBe('CREDENTIAL_NOT_CONFIGURED')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('happy path — work package create form', () => {
  it('POSTs the project-scoped form endpoint and returns the normalized form', async () => {
    await saveCredentials({ baseUrl: BASE_URL, apiKey: API_KEY })
    fetchMock.mockResolvedValueOnce(jsonOk(createFormFixture))

    const form = (await getWorkPackageCreateForm({ projectId: 7 })) as {
      type: { allowedValues: { id: number; name: string }[] }
      defaults: Record<string, number | null>
    }

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.href).toBe(`${BASE_URL}/api/v3/projects/7/work_packages/form`)
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe(EXPECTED_AUTH)

    expect(form.type.allowedValues).toEqual([
      { id: 1, name: 'Task' },
      { id: 7, name: 'Bug' }
    ])
    expect(form.defaults).toEqual({ typeId: 1, statusId: 1, priorityId: 8 })
    // Flattened out of HAL before it crosses IPC.
    expect(JSON.stringify(form)).not.toContain('href')
  })

  /**
   * The property that makes a POST acceptable on a read channel. Unlike the
   * edit form there is not even a lock version to send, so with no type chosen
   * the body is empty — and a hostile renderer's extra keys never survive.
   */
  it('forwards nothing the renderer supplied beyond a validated type id', async () => {
    await saveCredentials({ baseUrl: BASE_URL, apiKey: API_KEY })

    fetchMock.mockResolvedValueOnce(jsonOk(createFormFixture))
    await getWorkPackageCreateForm({ projectId: 7 })
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual(
      {}
    )

    fetchMock.mockResolvedValueOnce(jsonOk(createFormFixture))
    await getWorkPackageCreateForm({
      projectId: 7,
      typeId: 1,
      subject: 'pwned',
      _links: { project: { href: '/api/v3/projects/999' } }
    })
    expect(JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)).toEqual({
      _links: { type: { href: '/api/v3/types/1' } }
    })
  })

  it('rejects a renderer-supplied path in place of the numeric project id', async () => {
    await saveCredentials({ baseUrl: BASE_URL, apiKey: API_KEY })

    for (const projectId of ['7/../../work_packages', '7?x=1', '../admin', 0, 1.5]) {
      const err = await expectIpcError(() => getWorkPackageCreateForm({ projectId }))
      expect(err.code).toBe('OPENPROJECT_INVALID_INPUT')
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces a 404 as OPENPROJECT_NOT_FOUND — the project is gone or invisible', async () => {
    await saveCredentials({ baseUrl: BASE_URL, apiKey: API_KEY })
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 404 }))

    const err = await expectIpcError(() => getWorkPackageCreateForm({ projectId: 999 }))
    expect(err.code).toBe('OPENPROJECT_NOT_FOUND')
  })
})

describe('happy path — create work package', () => {
  const validInput = { projectId: 7, typeId: 1, subject: 'Add a create form' }

  /** What OpenProject echoes back after a successful POST. */
  const echoed = {
    ...workPackagesFixture._embedded.elements[0],
    id: 99,
    lockVersion: 0,
    subject: 'Add a create form'
  }

  it('POSTs the collection URL with auth and returns the Zod-validated result', async () => {
    await saveCredentials({ baseUrl: BASE_URL, apiKey: API_KEY })
    fetchMock.mockResolvedValueOnce(jsonOk(echoed))

    const result = await createWorkPackage(validInput)
    expect(result).toEqual(WorkPackageSchema.parse(echoed))

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.href).toBe(`${BASE_URL}/api/v3/work_packages`)
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe(EXPECTED_AUTH)
    expect(headers['Content-Type']).toBe('application/json')
  })

  it('builds every href in main from the ids the renderer sent', async () => {
    await saveCredentials({ baseUrl: BASE_URL, apiKey: API_KEY })
    fetchMock.mockResolvedValueOnce(jsonOk(echoed))

    await createWorkPackage({
      ...validInput,
      statusId: 1,
      priorityId: 8,
      assigneeId: 11,
      startDate: '2026-03-01'
    })

    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body._links).toEqual({
      project: { href: '/api/v3/projects/7' },
      type: { href: '/api/v3/types/1' },
      status: { href: '/api/v3/statuses/1' },
      priority: { href: '/api/v3/priorities/8' },
      assignee: { href: '/api/v3/users/11' }
    })
    expect(body.startDate).toBe('2026-03-01')
    expect('dueDate' in body).toBe(false)
  })

  it('pins the description format in the main process', async () => {
    await saveCredentials({ baseUrl: BASE_URL, apiKey: API_KEY })
    fetchMock.mockResolvedValueOnce(jsonOk(echoed))

    await createWorkPackage({
      ...validInput,
      description: 'Body **text**',
      // A renderer trying to choose the format, or to inject rendered HTML.
      descriptionFormat: 'textile',
      descriptionHtml: '<script>alert(1)</script>'
    })

    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(JSON.parse(init.body as string).description).toEqual({
      format: 'markdown',
      raw: 'Body **text**'
    })
    expect(init.body as string).not.toContain('textile')
    expect(init.body as string).not.toContain('<script>')
  })

  it('rejects renderer-supplied invalid input without calling fetch', async () => {
    await saveCredentials({ baseUrl: BASE_URL, apiKey: API_KEY })

    for (const bad of [
      { typeId: 1, subject: 'x' },
      { projectId: 7, subject: 'x' },
      { projectId: 7, typeId: 1 },
      { ...validInput, subject: '   ' },
      { ...validInput, subject: 'x'.repeat(256) },
      { ...validInput, description: 'x'.repeat(30_001) },
      { ...validInput, startDate: '2026-02-31' },
      { ...validInput, assigneeId: 0 },
      { ...validInput, projectId: '7/../../users' }
    ]) {
      const err = await expectIpcError(() => createWorkPackage(bad))
      expect(err.code).toBe('OPENPROJECT_INVALID_INPUT')
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  /**
   * The 422 the create form cannot predict. Its message is the only actionable
   * thing the user gets, so it is forwarded — while the echoed request content
   * the same body carries is not.
   */
  it('surfaces a 422 with OpenProject’s message and nothing else from the body', async () => {
    await saveCredentials({ baseUrl: BASE_URL, apiKey: API_KEY })
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          _type: 'Error',
          message: 'Team can’t be blank.',
          _embedded: { payload: { subject: 'must-not-leak' } }
        }),
        { status: 422, headers: { 'content-type': 'application/json' } }
      )
    )

    const err = await expectIpcError(() => createWorkPackage(validInput))
    expect(err.code).toBe('OPENPROJECT_VALIDATION_FAILED')
    expect(err.message).toBe('Team can’t be blank.')
    expect(err.message).not.toContain('must-not-leak')
  })

  it('rejects with a typed error when no credentials are configured', async () => {
    const err = await expectIpcError(() => createWorkPackage(validInput))
    expect(err.code).toBe('CREDENTIAL_NOT_CONFIGURED')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
