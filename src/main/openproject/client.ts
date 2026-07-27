import { z } from 'zod'

import type { Credentials } from '../credentials'

import {
  WorkPackageCollectionSchema,
  type WorkPackageCollection
} from '../schemas/work-packages'
import {
  TimeEntryCollectionSchema,
  TimeEntrySchema,
  TimeEntryActivityCollectionSchema,
  TimeEntryFormSchema,
  CreateTimeEntryInputSchema,
  UpdateTimeEntryInputSchema,
  DeleteTimeEntryInputSchema,
  extractActivitiesFromForm,
  TIME_ENTRY_ACTIVITY_PATH,
  TIME_ENTRY_PATH,
  WORK_PACKAGE_PATH,
  type TimeEntryCollection,
  type TimeEntry,
  type TimeEntryActivityCollection,
  type CreateTimeEntryInput,
  type UpdateTimeEntryInput,
  type DeleteTimeEntryInput
} from '../schemas/time-entries'
import {
  StatusCollectionSchema,
  type StatusCollection
} from '../schemas/statuses'
import { formatDecimalHoursToIso } from '../../shared/utils/time'
import {
  WorkPackageSearchTermSchema,
  normalizeWorkPackageSearchTerm
} from '../../shared/validation/work-package-search'

/**
 * OpenProject REST API v3 client.
 *
 * This is the **single** fetch wrapper for the OpenProject API
 * (`.opencode/rules/conventions-server.md`). All OpenProject HTTP happens
 * here, in the main process, using the stored `Credentials`. The renderer
 * never sees the API key, the auth header, or the raw server response —
 * it only receives Zod-validated data via the IPC handlers.
 *
 * Security notes (`.opencode/rules/security.md`):
 * - The API key is a secret. It is never logged, never returned in error
 *   messages, never exposed to the renderer.
 * - `Credentials.baseUrl` is already validated as http(s) by the credential
 *   store, but `buildRequestUrl()` still strips userinfo (username/password)
 *   before building request URLs — defense in depth in case a stored URL
 *   somehow carries userinfo.
 * - All responses are `.parse()`d with a Zod schema before being returned.
 *   A malformed/hostile server cannot inject arbitrary TS shapes into the
 *   renderer; the worst it can do is fail the parse, which surfaces as a
 *   typed `OpenProjectSchemaError`.
 */

// ---------------------------------------------------------------------------
// Error hierarchy
// ---------------------------------------------------------------------------

/**
 * Base class for all OpenProject client errors. Carries a stable `code`
 * the renderer can branch on, plus a human-facing `message` that never
 * contains the API key, the auth header, or the raw response body.
 */
export class OpenProjectError extends Error {
  readonly code: string
  constructor(code: string, message: string, readonly cause?: unknown) {
    super(message)
    this.name = 'OpenProjectError'
    this.code = code
  }
}

/** Bad API key (HTTP 401/403). */
export class OpenProjectAuthError extends OpenProjectError {
  constructor(message = 'Authentication failed. Check your API key.') {
    super('OPENPROJECT_AUTH_FAILED', message)
    this.name = 'OpenProjectAuthError'
  }
}

/** Resource not found / bad base URL (HTTP 404). */
export class OpenProjectNotFoundError extends OpenProjectError {
  constructor(message = 'The OpenProject server did not find the requested resource.') {
    super('OPENPROJECT_NOT_FOUND', message)
    this.name = 'OpenProjectNotFoundError'
  }
}

/** Server-side failure (HTTP 5xx) or network error. */
export class OpenProjectServerError extends OpenProjectError {
  constructor(
    message: string,
    readonly status?: number,
    cause?: unknown
  ) {
    super('OPENPROJECT_SERVER_ERROR', message, cause)
    this.name = 'OpenProjectServerError'
  }
}

/** Any other non-2xx status. */
export class OpenProjectHttpError extends OpenProjectError {
  constructor(
    message: string,
    readonly status: number,
    cause?: unknown
  ) {
    super('OPENPROJECT_HTTP_ERROR', message, cause)
    this.name = 'OpenProjectHttpError'
  }
}

/** Response body failed Zod validation — hostile/malformed server. */
export class OpenProjectSchemaError extends OpenProjectError {
  constructor(
    message = 'The OpenProject server returned an unexpected response shape.',
    cause?: unknown
  ) {
    super('OPENPROJECT_SCHEMA_FAILED', message, cause)
    this.name = 'OpenProjectSchemaError'
  }
}

/**
 * OpenProject rejected the write as invalid (HTTP 422) — e.g. the activity
 * isn't allowed for that project, the work package is closed, or time
 * logging is disabled.
 *
 * Unlike every other error here, this one forwards a server-authored
 * string, because the whole point is to tell the user *which* field
 * OpenProject refused. Only the `message` field extracted by
 * `OpenProjectApiErrorSchema` is used (plus any `_embedded.errors[]`
 * messages) — never the raw body, and the result is length-capped. See
 * `.opencode/rules/security.md`.
 */
export class OpenProjectValidationError extends OpenProjectError {
  constructor(
    message: string,
    readonly status: number = 422,
    cause?: unknown
  ) {
    super('OPENPROJECT_VALIDATION_FAILED', message, cause)
    this.name = 'OpenProjectValidationError'
  }
}

/**
 * The request was rejected **before** any HTTP call, because the input
 * (which originates in the renderer) failed main-process validation. See
 * `CreateTimeEntryInputSchema`.
 */
export class OpenProjectInvalidInputError extends OpenProjectError {
  constructor(
    message = 'The time entry details are invalid.',
    cause?: unknown
  ) {
    super('OPENPROJECT_INVALID_INPUT', message, cause)
    this.name = 'OpenProjectInvalidInputError'
  }
}

/** Request timed out. */
export class OpenProjectTimeoutError extends OpenProjectError {
  constructor(timeoutMs: number) {
    super(
      'OPENPROJECT_TIMEOUT',
      `The OpenProject server did not respond within ${timeoutMs / 1000}s.`
    )
    this.name = 'OpenProjectTimeoutError'
  }
}

// ---------------------------------------------------------------------------
// Filter types
// ---------------------------------------------------------------------------

/**
 * Filters for `listWorkPackages`. Pagination + an optional "only mine"
 * filter (assignee = me). OpenProject's `assignee` filter accepts `"me"`
 * as a special value to mean the authenticated user.
 */
export interface WorkPackageFilters {
  /** Only work packages assigned to the current user (assignee = "me"). */
  onlyMine?: boolean
  /** Only open work packages (status operator `o` = open). */
  onlyOpen?: boolean
  /**
   * Filter to specific status resource IDs (server-side `=` operator),
   * stringified. Takes precedence over `onlyOpen` when both are set.
   * OpenProject's `status` filter `=` operator requires status resource
   * IDs (e.g. `"5"`), NOT titles — passing titles results in HTTP 400.
   * The renderer resolves the hardcoded primary status titles to IDs via
   * `listStatuses()` before calling `listWorkPackages`.
   */
  statuses?: string[]
  /**
   * Search by work-package **title**, via OpenProject's `subjectOrId` filter
   * with the `**` operator: a substring match on the subject, plus an exact
   * match on the id. Free text — the picker filters its own loaded items
   * first and only sends a term that matched none of them.
   *
   * Combines with `onlyMine`/`statuses`, but the picker deliberately sends it
   * alone: a search exists to reach work packages *outside* the user's
   * priority list, so narrowing it by assignee would defeat the point.
   *
   * `listWorkPackages` validates the term against
   * `WorkPackageSearchTermSchema` first, so a renderer can't smuggle an
   * unbounded string into the filter JSON.
   */
  search?: string
  /**
   * Server-side ordering, as `[[field, 'asc' | 'desc'], …]`.
   *
   * Worth setting on any search: OpenProject's default is `id asc`, i.e.
   * creation order, which for a truncated result page means the *oldest*
   * matches are the ones the user sees.
   */
  sortBy?: Array<[string, 'asc' | 'desc']>
  pageSize?: number
  offset?: number
}

/**
 * Hard ceiling on `pageSize`, applied in the main process.
 *
 * The renderer picks page sizes, and a renderer value is not a trusted value
 * (`.opencode/rules/security.md`) — an absurd one costs a multi-megabyte
 * response that this process has to fetch and Zod-parse in full. Comfortably
 * above every page size the app actually asks for.
 */
export const MAX_PAGE_SIZE = 200

/**
 * Filters for `listTimeEntries`. The calendar (task 7) passes
 * `spentOn: { between: [monthStart, monthEnd] }`. An optional `onlyMine`
 * filter limits entries to the authenticated user.
 */
export interface TimeEntryFilters {
  /** Only time entries belonging to the current user (user = "me"). */
  onlyMine?: boolean
  /** Date is ISO `YYYY-MM-DD`. */
  spentOn?:
    | { between: [string, string] }
    | { on: string }
  workPackageId?: number
  pageSize?: number
  offset?: number
}

/**
 * OpenProject's standard error body. Only `message` (and the messages of
 * any `_embedded.errors` entries) is ever read out of a failed response —
 * see `extractApiErrorMessage`.
 */
const OpenProjectApiErrorSchema = z
  .object({
    message: z.string().optional(),
    _embedded: z
      .object({
        errors: z
          .array(z.object({ message: z.string().optional() }).passthrough())
          .optional()
      })
      .passthrough()
      .optional()
  })
  .passthrough()

/** Cap on how much server-authored error text we forward to the renderer. */
const MAX_API_ERROR_MESSAGE_LENGTH = 500

/**
 * Pull a human-readable message out of an OpenProject error body.
 *
 * Reads **only** the schema-declared `message` fields — never the raw
 * body, which can echo request content. Returns `null` when the body
 * isn't a recognisable OpenProject error, so the caller falls back to a
 * generic message.
 */
export function extractApiErrorMessage(rawBody: string): string | null {
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(rawBody) as unknown
  } catch {
    return null
  }
  const result = OpenProjectApiErrorSchema.safeParse(parsedJson)
  if (!result.success) return null

  const messages: string[] = []
  if (result.data.message !== undefined) messages.push(result.data.message)
  for (const err of result.data._embedded?.errors ?? []) {
    if (err.message !== undefined && !messages.includes(err.message)) {
      messages.push(err.message)
    }
  }

  const joined = messages
    .map((m) => m.trim())
    .filter((m) => m.length > 0)
    .join(' ')
  if (joined.length === 0) return null
  return joined.length > MAX_API_ERROR_MESSAGE_LENGTH
    ? `${joined.slice(0, MAX_API_ERROR_MESSAGE_LENGTH)}…`
    : joined
}

/**
 * The OpenProject filter query format: a JSON-encoded array of
 * `{ [field]: { operator: string, values: string[] } }`. See
 * https://www.openproject.org/docs/api/filters/
 */
interface OpenProjectFilter {
  [field: string]: {
    operator: string
    values: string[]
  }
}

// ---------------------------------------------------------------------------
// Pure URL + filter helpers (unit-tested without fetch)
// ---------------------------------------------------------------------------

/**
 * Build a request `URL` from the stored base URL and an API path.
 *
 * Security: strips userinfo (`username`/`password`) and `hash` from the
 * base URL before appending the path — defense in depth, so a stored URL
 * that somehow carries userinfo can never propagate it into the request.
 * The base URL is already validated as http(s) by the credential store,
 * but we re-parse here to be safe.
 *
 * Path joining handles:
 *  - `https://host` + `/api/v3/work_packages` → `https://host/api/v3/work_packages`
 *  - `https://host/` + `/api/v3/...` → same
 *  - `https://host/op/` + `/api/v3/...` → `https://host/op/api/v3/work_packages`
 *  - `https://host/op` (no trailing slash) + `/api/v3/...` → `https://host/op/api/v3/...`
 *
 * @throws {Error} if `baseUrl` is not a parseable URL.
 */
export function buildRequestUrl(
  baseUrl: string,
  path: string,
  params: Record<string, string> = {}
): URL {
  const url = new URL(baseUrl)
  // Strip userinfo + hash — never propagate user-entered userinfo into
  // the request (defense in depth; the credential store validates http(s)
  // and rejects userinfo at save time, but strip here too).
  url.username = ''
  url.password = ''
  url.hash = ''

  // Normalize the API path: ensure a single leading slash and no double
  // slashes at the join point.
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const basePath = url.pathname.replace(/\/$/, '') // drop trailing slash
  url.pathname = `${basePath}${normalizedPath}`

  // Apply query params. `URL.searchParams.set` URL-encodes values.
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  return url
}

/**
 * Encode `TimeEntryFilters` into the OpenProject `filters` query string
 * value (JSON-encoded array, URL-encoded by `URL.searchParams`).
 *
 * Returns `undefined` when no filters need to be sent (so the caller can
 * omit the param entirely).
 */
export function encodeTimeEntryFilters(filters: TimeEntryFilters = {}):
  | string
  | undefined {
  const opFilters: OpenProjectFilter[] = []

  if (filters.spentOn) {
    if ('between' in filters.spentOn) {
      const [from, to] = filters.spentOn.between
      // OpenProject v3 uses `<>d` for "between two dates" (inclusive).
      opFilters.push({
        spentOn: { operator: '<>d', values: [from, to] }
      })
    } else {
        opFilters.push({
          spentOn: { operator: '=d', values: [filters.spentOn.on] }
        })
    }
  }

  if (filters.workPackageId !== undefined) {
    opFilters.push({
      workPackage: { operator: '=', values: [String(filters.workPackageId)] }
    })
  }

  if (filters.onlyMine) {
    opFilters.push({ user: { operator: '=', values: ['me'] } })
  }

  if (opFilters.length === 0) return undefined
  return JSON.stringify(opFilters)
}

/**
 * Bound a renderer-supplied `pageSize` to something this process is willing to
 * fetch and parse: a positive integer, at most {@link MAX_PAGE_SIZE}.
 *
 * Clamped rather than rejected — an out-of-range page size is a caller bug or
 * a hostile renderer, not something the user can act on, and failing the whole
 * request would turn it into a denial of service of its own.
 */
export function clampPageSize(pageSize: number): number {
  if (!Number.isFinite(pageSize)) return MAX_PAGE_SIZE
  return Math.min(Math.max(Math.trunc(pageSize), 1), MAX_PAGE_SIZE)
}

/**
 * Encode `WorkPackageFilters` into query params. Includes pagination + the
 * OpenProject `filters` JSON when `onlyMine` is set.
 */
export function encodeWorkPackageParams(filters: WorkPackageFilters = {}): Record<
  string,
  string
> {
  const params: Record<string, string> = {}
  if (filters.pageSize !== undefined) {
    params.pageSize = String(clampPageSize(filters.pageSize))
  }
  if (filters.offset !== undefined) {
    params.offset = String(filters.offset)
  }
  if (filters.sortBy && filters.sortBy.length > 0) {
    params.sortBy = JSON.stringify(filters.sortBy)
  }
  // Build the OpenProject filter array for assignee = me + status filter.
  const opFilters: OpenProjectFilter[] = []
  if (filters.onlyMine) {
    opFilters.push({ assignee: { operator: '=', values: ['me'] } })
  }
  // `statuses` takes precedence over `onlyOpen` when both are set — both
  // write to the OpenProject `status` field, so they are mutually
  // exclusive in practice. An empty `statuses` array falls through to
  // `onlyOpen` (treated as "not specified") so callers can pass an empty
  // array without accidentally dropping the open-status filter.
  if (filters.statuses && filters.statuses.length > 0) {
    opFilters.push({ status: { operator: '=', values: filters.statuses } })
  } else if (filters.onlyOpen) {
    // `o` = "status is open" — no values needed (empty array).
    opFilters.push({ status: { operator: 'o', values: [] } })
  }
  // `**` on `subjectOrId` is OpenProject's own quick-search operator: it
  // matches a substring of the subject, and an id exactly. Encoding it here
  // (rather than resolving it with per-id fetches, as the old id-prefix search
  // did) means one request answers a search, and the value is percent-encoded
  // into the query string by `buildRequestUrl` — it never reaches a path.
  //
  // Trimmed at the point of use: `listWorkPackages` parses the term through
  // `WorkPackageSearchTermSchema`, so a caller reaching this directly with a
  // raw string gets the same shape the picker would have sent.
  const search = normalizeWorkPackageSearchTerm(filters.search ?? '')
  if (search !== '') {
    opFilters.push({ subjectOrId: { operator: '**', values: [search] } })
  }
  if (opFilters.length > 0) {
    params.filters = JSON.stringify(opFilters)
  }
  return params
}

/**
 * Encode `TimeEntryFilters` into the full query params record (pagination
 * + the OpenProject `filters` JSON).
 */
export function encodeTimeEntryParams(filters: TimeEntryFilters = {}): Record<
  string,
  string
> {
  const params: Record<string, string> = {}
  if (filters.pageSize !== undefined) {
    params.pageSize = String(clampPageSize(filters.pageSize))
  }
  if (filters.offset !== undefined) {
    params.offset = String(filters.offset)
  }
  const filterStr = encodeTimeEntryFilters(filters)
  if (filterStr !== undefined) {
    params.filters = filterStr
  }
  return params
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

/** Cap on how many issues one mismatch logs — a bad shape repeats per element. */
const MAX_LOGGED_SCHEMA_ISSUES = 5

/**
 * Log **where** a response failed schema validation: the field path, the Zod
 * issue code, and the expected type. Without this a shape mismatch surfaces
 * as an opaque `OPENPROJECT_SCHEMA_FAILED` with nothing to act on.
 *
 * Values are never logged — only paths and type names. The offending body may
 * hold work-package subjects, comments, or user names, and
 * `.opencode/rules/security.md` allows logging non-sensitive identifiers only.
 * Array indices in a path (`_embedded.elements.3.…`) are positions, not data.
 */
function logSchemaIssues(e: unknown): void {
  if (!(e instanceof z.ZodError)) return
  const shown = e.issues.slice(0, MAX_LOGGED_SCHEMA_ISSUES).map((issue) => {
    const path = issue.path.join('.') || '(root)'
    const expected =
      'expected' in issue ? ` expected ${String(issue.expected)}` : ''
    return `${path}: ${issue.code}${expected}`
  })
  const omitted = e.issues.length - shown.length
  console.warn(
    `[openproject] response failed schema validation — ${shown.join('; ')}` +
      (omitted > 0 ? ` (+${omitted} more)` : '')
  )
}

// ---------------------------------------------------------------------------
// Write payloads
// ---------------------------------------------------------------------------

/**
 * Build the request body shared by create (`POST`) and update (`PATCH`).
 *
 * Both endpoints take the same representation, so the two paths build it in
 * one place — a field added to one can't silently miss the other. The `_links`
 * hrefs are built from the already-validated **numeric** ids, so nothing
 * renderer-supplied reaches a path (`.opencode/rules/security.md`).
 *
 * `clearAbsentComment` is the one real difference. `POST` omits an absent
 * comment (nothing to clear); `PATCH` sends an empty `raw`, because the update
 * is a full replacement and omitting the key would leave the old comment in
 * place — making "clear this comment" unexpressible.
 */
function buildTimeEntryPayload(
  fields: CreateTimeEntryInput,
  options: { clearAbsentComment: boolean }
): Record<string, unknown> {
  const { workPackageId, activityId, spentOn, hours, comment } = fields
  const hasComment = comment !== undefined && comment.length > 0

  return {
    spentOn,
    hours: formatDecimalHoursToIso(hours),
    // OpenProject's `comment` is a Formattable; send the raw text form.
    ...(hasComment
      ? { comment: { raw: comment } }
      : options.clearAbsentComment
        ? { comment: { raw: '' } }
        : {}),
    _links: {
      workPackage: { href: `${WORK_PACKAGE_PATH}/${workPackageId}` },
      activity: { href: `${TIME_ENTRY_ACTIVITY_PATH}/${activityId}` }
    }
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/** Default request timeout (15s). */
const DEFAULT_TIMEOUT_MS = 15_000

/**
 * Page size used when `listTimeEntries` follows pagination itself. Large
 * enough that a month of entries is one request in practice; the loop stays
 * correct if the instance clamps it lower.
 */
const ALL_ENTRIES_PAGE_SIZE = 200

/** Hard ceiling on pages `listTimeEntries` will follow. */
const MAX_FOLLOWED_PAGES = 25

/**
 * The single OpenProject HTTP client. Constructed in the main process with
 * validated `Credentials`; the API key lives only on the instance and is
 * never logged or returned.
 */
export class OpenProjectClient {
  private readonly timeoutMs: number

  constructor(
    private readonly creds: Credentials,
    timeoutMs: number = DEFAULT_TIMEOUT_MS
  ) {
    this.timeoutMs = timeoutMs
  }

  /**
   * `GET /api/v3/work_packages` — returns a Zod-validated collection.
   *
   * `filters.search` arrives from the renderer, so it is re-validated here (the
   * renderer's own sanitizing is a UI affordance, not a boundary) and the
   * trimmed result is what reaches the filter JSON. A title search is an
   * ordinary filtered collection request — one round trip, server-ordered,
   * whatever the user can see.
   */
  async listWorkPackages(
    filters: WorkPackageFilters = {}
  ): Promise<WorkPackageCollection> {
    let effective = filters
    if (filters.search !== undefined) {
      const parsed = WorkPackageSearchTermSchema.safeParse(filters.search)
      if (!parsed.success) {
        throw new OpenProjectInvalidInputError(
          parsed.error.issues[0]?.message ?? 'Invalid work package search term.'
        )
      }
      effective = { ...filters, search: parsed.data }
    }
    const params = encodeWorkPackageParams(effective)
    const url = buildRequestUrl(this.creds.baseUrl, '/api/v3/work_packages', params)
    const body = await this.request(url)
    return this.parseWithSchema(body, WorkPackageCollectionSchema)
  }

  /**
   * `GET /api/v3/time_entries` — returns a Zod-validated collection holding
   * **every** matching entry, not just the first page.
   *
   * Callers (the calendar month total, the day list) ask a question about a
   * date range — "how much did I log this month" — so a partial answer is a
   * wrong answer, and OpenProject's default page size is 20. Pages are
   * therefore followed until `count` reaches the server's reported `total`,
   * and the merged result reports `count` = what was actually collected.
   *
   * An explicit `offset` means the caller is driving pagination itself, so
   * that request is passed straight through as a single page.
   */
  async listTimeEntries(
    filters: TimeEntryFilters = {}
  ): Promise<TimeEntryCollection> {
    if (filters.offset !== undefined) return this.fetchTimeEntryPage(filters)

    const pageSize = filters.pageSize ?? ALL_ENTRIES_PAGE_SIZE
    const first = await this.fetchTimeEntryPage({ ...filters, pageSize, offset: 1 })
    const elements: TimeEntry[] = [...first._embedded.elements]

    for (let page = 2; elements.length < first.total; page++) {
      // Safety valve: a server that keeps reporting an unreachable `total`
      // (or clamps `pageSize` to 1) must not spin forever.
      if (page > MAX_FOLLOWED_PAGES) break
      const next = await this.fetchTimeEntryPage({ ...filters, pageSize, offset: page })
      // An empty page means there is nothing left, whatever `total` claims.
      if (next._embedded.elements.length === 0) break
      elements.push(...next._embedded.elements)
    }

    return { ...first, count: elements.length, _embedded: { elements } }
  }

  /** One page of `GET /api/v3/time_entries`, Zod-validated. */
  private async fetchTimeEntryPage(
    filters: TimeEntryFilters
  ): Promise<TimeEntryCollection> {
    const params = encodeTimeEntryParams(filters)
    const url = buildRequestUrl(this.creds.baseUrl, '/api/v3/time_entries', params)
    const body = await this.request(url)
    return this.parseWithSchema(body, TimeEntryCollectionSchema)
  }

  /**
   * `GET /api/v3/statuses` — returns a Zod-validated collection of all
   * status resources on the instance. No filters/pagination (the status
   * set is small). Used by the renderer to resolve status titles → IDs
   * before calling `listWorkPackages` (the work-package `status` filter
   * `=` operator requires IDs, not titles).
   */
  async listStatuses(): Promise<StatusCollection> {
    const url = buildRequestUrl(this.creds.baseUrl, '/api/v3/statuses')
    const body = await this.request(url)
    return this.parseWithSchema(body, StatusCollectionSchema)
  }

  /**
   * `POST /api/v3/time_entries` — create a time entry, returning the
   * Zod-validated entry OpenProject echoes back.
   *
   * `input` originates in the renderer, so it is validated here (the
   * boundary that builds the request) rather than trusting the caller —
   * every path into this method is therefore safe, not just the IPC one.
   * The `_links` hrefs are built from the validated **numeric** ids, so no
   * renderer-supplied string ever reaches the request URL or body paths.
   *
   * `hours` is converted from decimal hours to the ISO 8601 duration the
   * API expects via the shared `formatDecimalHoursToIso`.
   */
  async createTimeEntry(input: CreateTimeEntryInput): Promise<TimeEntry> {
    const parsed = CreateTimeEntryInputSchema.safeParse(input)
    if (!parsed.success) {
      // Our own validation message (never a server echo) — safe to forward.
      throw new OpenProjectInvalidInputError(
        parsed.error.issues[0]?.message ?? 'The time entry details are invalid.',
        parsed.error
      )
    }

    // On create an absent comment is simply not sent — there is nothing to
    // clear, and OpenProject defaults it to empty.
    const payload = buildTimeEntryPayload(parsed.data, {
      clearAbsentComment: false
    })

    const url = buildRequestUrl(this.creds.baseUrl, TIME_ENTRY_PATH)
    const body = await this.request(url, { method: 'POST', body: payload })
    return this.parseWithSchema(body, TimeEntrySchema)
  }

  /**
   * `PATCH /api/v3/time_entries/{id}` — replace an existing entry's fields,
   * returning the Zod-validated entry OpenProject echoes back.
   *
   * Same trust model as `createTimeEntry`: `input` comes from the renderer, so
   * it is validated here rather than at the caller, and every href in the body
   * is built from the validated **numeric** ids. `id` is the one value that
   * reaches the request *path*, and it is a validated positive integer by the
   * time it gets there — no renderer-supplied string is ever interpolated.
   *
   * Full replacement, not a partial patch: the edit form holds every field, so
   * every field is sent, and an absent `comment` clears the stored one. See
   * `UpdateTimeEntryInputSchema`.
   */
  async updateTimeEntry(input: UpdateTimeEntryInput): Promise<TimeEntry> {
    const parsed = UpdateTimeEntryInputSchema.safeParse(input)
    if (!parsed.success) {
      throw new OpenProjectInvalidInputError(
        parsed.error.issues[0]?.message ?? 'The time entry details are invalid.',
        parsed.error
      )
    }
    const { id, ...fields } = parsed.data

    const payload = buildTimeEntryPayload(fields, { clearAbsentComment: true })

    const url = buildRequestUrl(this.creds.baseUrl, `${TIME_ENTRY_PATH}/${id}`)
    const body = await this.request(url, { method: 'PATCH', body: payload })
    return this.parseWithSchema(body, TimeEntrySchema)
  }

  /**
   * `DELETE /api/v3/time_entries/{id}` — remove an entry. Resolves on
   * success; OpenProject answers 204 with an empty body, so there is nothing
   * to parse and nothing to return.
   *
   * The id is validated as a positive integer before it reaches the request
   * path. A 404 (already deleted, or never visible to this user) surfaces as
   * `OpenProjectNotFoundError` rather than being swallowed — the caller shows
   * it, because "it was already gone" and "your key can't see it" are
   * different problems for the user.
   */
  async deleteTimeEntry(input: DeleteTimeEntryInput): Promise<void> {
    const parsed = DeleteTimeEntryInputSchema.safeParse(input)
    if (!parsed.success) {
      throw new OpenProjectInvalidInputError(
        parsed.error.issues[0]?.message ?? 'The time entry id is invalid.',
        parsed.error
      )
    }
    const url = buildRequestUrl(
      this.creds.baseUrl,
      `${TIME_ENTRY_PATH}/${parsed.data.id}`
    )
    await this.request(url, { method: 'DELETE' })
  }

  /**
   * Fetch the activities that may be assigned to a time entry.
   *
   * Uses the form endpoint (`POST /api/v3/time_entries/form`) rather than a
   * dedicated activities collection: the form's schema is the authoritative
   * source of *allowed* values and its shape is stable across OpenProject
   * versions. Passing `workPackageId` scopes the allowed set to that work
   * package's project, which is what the form does for a real entry.
   *
   * The form response is parsed leniently and reshaped into the same
   * collection envelope as every other resource, then `.parse()`d — so the
   * renderer sees a validated, familiar shape.
   */
  async listTimeEntryActivities(
    workPackageId?: number
  ): Promise<TimeEntryActivityCollection> {
    // Only a validated positive integer is ever interpolated into the href.
    const scoped =
      typeof workPackageId === 'number' &&
      Number.isInteger(workPackageId) &&
      workPackageId > 0

    const payload = scoped
      ? {
          _links: {
            workPackage: { href: `/api/v3/work_packages/${workPackageId}` }
          }
        }
      : {}

    const url = buildRequestUrl(
      this.creds.baseUrl,
      '/api/v3/time_entries/form'
    )
    const body = await this.request(url, { method: 'POST', body: payload })

    const form = this.parseWithSchema(body, TimeEntryFormSchema)
    const elements = extractActivitiesFromForm(form)
    return this.parseWithSchema(
      {
        _type: 'Collection',
        total: elements.length,
        count: elements.length,
        _embedded: { elements }
      },
      TimeEntryActivityCollectionSchema
    )
  }

  /**
   * Probe the API root (`GET /api/v3`) — used by the test-connection
   * handler. Returns `true` on 2xx, throws a typed error otherwise.
   */
  async testConnection(): Promise<boolean> {
    const url = buildRequestUrl(this.creds.baseUrl, '/api/v3')
    await this.request(url)
    return true
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  /**
   * Perform a request with auth + timeout, returning the parsed JSON body.
   * Throws a typed `OpenProjectError` subclass on any failure.
   *
   * Defaults to `GET`; pass `{ method, body }` to write. `body` is
   * JSON-encoded here (never string-concatenated). Every non-GET carries
   * `Content-Type`, body or not — OpenProject 406s a write without it.
   *
   * The API key is never logged. The `Authorization` header is built
   * inline and lives only in this fetch. Error messages reference the
   * HTTP status, never the key or the raw body — the sole exception is
   * HTTP 422, where `extractApiErrorMessage` forwards only the
   * schema-declared `message` fields so the user can see which field
   * OpenProject refused.
   */
  private async request(
    url: URL,
    init: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown } = {}
  ): Promise<unknown> {
    const method = init.method ?? 'GET'
    const hasBody = init.body !== undefined

    // OpenProject answers HTTP 406 ("client did not send a Content-Type
    // header") to a write that omits it — including a bodyless DELETE, which
    // has no body to describe. So the header goes on every non-GET request,
    // not just the ones carrying JSON. Sending it only with a body is what
    // made `deleteTimeEntry` fail against a real instance.
    const sendContentType = method !== 'GET'

    // OpenProject API key auth: `Basic base64("apikey:<key>")`.
    // The key is a secret — never logged, never in error messages.
    const auth = `Basic ${Buffer.from(`apikey:${this.creds.apiKey}`).toString('base64')}`

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

    let res: Response
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: auth,
          Accept: 'application/json',
          ...(sendContentType ? { 'Content-Type': 'application/json' } : {})
        },
        ...(hasBody ? { body: JSON.stringify(init.body) } : {}),
        signal: controller.signal
      })
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') {
        throw new OpenProjectTimeoutError(this.timeoutMs)
      }
      // Network error — no status. Message uses the error's name only,
      // never the key or auth header.
      throw new OpenProjectServerError(
        `Could not reach the OpenProject server: ${(e as Error).message}`,
        undefined,
        e
      )
    } finally {
      clearTimeout(timeout)
    }

    if (res.ok) {
      // 2xx — parse JSON. Empty bodies (e.g. 204) parse to null.
      const text = await res.text()
      if (text.length === 0) return null
      try {
        return JSON.parse(text) as unknown
      } catch {
        throw new OpenProjectSchemaError(
          `The OpenProject server returned a non-JSON response (HTTP ${res.status}).`
        )
      }
    }

    // Non-2xx — map to typed errors. Never include the raw body (it may
    // contain server-side echoes of the request) or the key.
    if (res.status === 401 || res.status === 403) {
      throw new OpenProjectAuthError(
        `Authentication failed (HTTP ${res.status}). Check your API key.`
      )
    }
    if (res.status === 404) {
      throw new OpenProjectNotFoundError(
        `The OpenProject server responded with HTTP 404. Check the base URL.`
      )
    }
    if (res.status === 400) {
      // A 400 is OpenProject rejecting the *query we built* — an unsupported
      // filter, a bad operator, a value it won't accept. The reason describes
      // our own request, not user data, so it is forwarded on the same terms
      // as the 422 below: only the schema-declared `message`, never the raw
      // body. Without it a bad filter is undiagnosable from the app.
      const detail = extractApiErrorMessage(await res.text().catch(() => ''))
      throw new OpenProjectHttpError(
        detail ?? 'The OpenProject server rejected the request (HTTP 400).',
        400
      )
    }
    if (res.status === 422) {
      // The only place a server-authored string is forwarded — and only the
      // `message` fields declared by `OpenProjectApiErrorSchema`, capped in
      // length. Never the raw body.
      const detail = extractApiErrorMessage(await res.text().catch(() => ''))
      throw new OpenProjectValidationError(
        detail ??
          'OpenProject rejected the time entry. Check the activity, date, and work package.'
      )
    }
    if (res.status >= 500) {
      throw new OpenProjectServerError(
        `The OpenProject server returned HTTP ${res.status}.`,
        res.status
      )
    }
    // Any other 4xx. Forward OpenProject's own explanation on the same terms
    // as the 400/422 above — only the schema-declared `message` fields, capped
    // in length, never the raw body. A bare "returned HTTP 406" says nothing
    // about *what* was unacceptable, which makes such a failure undiagnosable
    // from the app and reduces debugging to guesswork.
    const detail = extractApiErrorMessage(await res.text().catch(() => ''))
    throw new OpenProjectHttpError(
      detail ?? `The OpenProject server returned HTTP ${res.status}.`,
      res.status
    )
  }

  /**
   * Parse a JSON body through a Zod collection schema. Throws
   * `OpenProjectSchemaError` on shape mismatch — a hostile server can
   * never inject an arbitrary shape into the renderer.
   *
   * The renderer-visible message stays deliberately generic; `logSchemaIssues`
   * records *where* the mismatch was so schema drift is diagnosable without
   * that detail crossing IPC.
   */
  private parseWithSchema<T>(
    body: unknown,
    schema: { parse: (v: unknown) => T }
  ): T {
    try {
      return schema.parse(body)
    } catch (e) {
      logSchemaIssues(e)
      throw new OpenProjectSchemaError(
        'The OpenProject server returned an unexpected response shape.',
        e
      )
    }
  }
}

// Re-export the schemas the IPC layer needs to keep imports tidy. The
// canonical definitions live in `src/main/schemas/`.
export {
  WorkPackageCollectionSchema,
  TimeEntryCollectionSchema,
  TimeEntryActivityCollectionSchema,
  CreateTimeEntryInputSchema,
  UpdateTimeEntryInputSchema,
  DeleteTimeEntryInputSchema,
  StatusCollectionSchema
}
export type {
  CreateTimeEntryInput,
  UpdateTimeEntryInput,
  DeleteTimeEntryInput,
  TimeEntryActivityCollection
}