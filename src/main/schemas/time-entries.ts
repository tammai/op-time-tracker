import { z } from 'zod'

import { parseHoursToDecimal } from '@shared/utils/time'

/**
 * Zod schemas for the OpenProject REST API v3 Time Entry responses.
 *
 * Reference: https://www.openproject.org/docs/api/time-entries/
 *
 * OpenProject returns `hours` as an ISO 8601 duration string (e.g.
 * `"PT1H30M"`, `"PT45M"`, `"PT2H"`, `"PT0S"`). We keep the raw string on
 * the parsed object and convert it to a decimal-hours number via
 * `parseHoursToDecimal()` (now in `src/shared/utils/time.ts`) — that
 * helper is shared with the renderer's calendar aggregation (task 7) so
 * duration parsing lives in exactly one place across the IPC boundary.
 *
 * The renderer never sees raw server shapes — every response is `.parse()`d
 * here in the main process before crossing IPC. See
 * `.opencode/rules/security.md` and `.opencode/rules/architecture.md`.
 */

// Re-export so existing imports (`src/preload/types.ts`, tests) keep working
// after the move to `@shared/utils/time`. The shared module is the single
// source of truth for the implementation.
export { parseHoursToDecimal }

/**
 * A HAL link: an `href`, usually a `title`.
 *
 * Both are nullable for the same reason as in `work-packages.ts`: OpenProject
 * sends an unset resource link as `{ "href": null }` rather than omitting the
 * key, so requiring a string rejects valid responses. One such link in one
 * entry would fail the whole month's parse.
 */
const HalLinkSchema = z.object({
  href: z.string().nullable(),
  title: z.string().nullable().optional()
})

/**
 * The `_links` object on a Time Entry. `self` is always present; the others
 * may be absent depending on the entry. `.passthrough()` lets OpenProject
 * add other links (e.g. `activity`, `costObject`) without failing the parse.
 */
const TimeEntryLinksSchema = z
  .object({
    self: HalLinkSchema,
    workPackage: HalLinkSchema.optional(),
    project: HalLinkSchema.optional(),
    user: HalLinkSchema.optional()
  })
  .passthrough()

/**
 * OpenProject's `comment` field is a "Formattable" — it can be a typed
 * object `{ format, raw, html }`, or `null` when no comment was entered.
 * Be lenient: also accept a bare string (some older/custom setups), or
 * undefined (some responses omit the key entirely).
 */
const TimeEntryCommentSchema = z
  .union([
    z.object({
      format: z.string(),
      raw: z.string(),
      html: z.string().optional()
    }),
    z.string(),
    z.null()
  ])
  .nullish()
  .default(null)

/**
 * A single Time Entry element. `hours` is the raw ISO 8601 duration
 * string — convert with `parseHoursToDecimal()` for numeric work.
 *
 * `createdAt`/`updatedAt` are optional because some OpenProject setups
 * omit them; `spentOn` is kept required since the calendar depends on it.
 */
export const TimeEntrySchema = z.object({
  id: z.number().int(),
  _type: z.literal('TimeEntry'),
  hours: z.string(),
  spentOn: z.string(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  comment: TimeEntryCommentSchema,
  _links: TimeEntryLinksSchema
})

export const TimeEntryCollectionSchema = z.object({
  // OpenProject uses typed collections — accept any string `_type`.
  _type: z.string(),
  total: z.number().int(),
  count: z.number().int(),
  _embedded: z.object({
    elements: z.array(TimeEntrySchema)
  })
})

export type TimeEntry = z.infer<typeof TimeEntrySchema>
export type TimeEntryCollection = z.infer<typeof TimeEntryCollectionSchema>
export type TimeEntryLinks = z.infer<typeof TimeEntryLinksSchema>

// ---------------------------------------------------------------------------
// Time entry activities (required on every created time entry)
// ---------------------------------------------------------------------------

/**
 * API path of the `TimeEntriesActivity` resource collection. Both the
 * href → id parser below and the client's href builder derive from this
 * one constant so they can never drift apart.
 */
export const TIME_ENTRY_ACTIVITY_PATH = '/api/v3/time_entries/activities'

/**
 * A single `TimeEntriesActivity` — the "what kind of work" enumeration
 * OpenProject requires on every time entry (e.g. "Development",
 * "Management"). `position`/`default` are optional because the form
 * endpoint's link-only representation carries neither.
 */
export const TimeEntryActivitySchema = z.object({
  id: z.number().int(),
  name: z.string(),
  position: z.number().int().optional(),
  default: z.boolean().optional()
})

/**
 * Activities in the same collection envelope as every other resource, so
 * the renderer's query layer treats them like `listStatuses()`. Built by
 * the client from the form response (see `extractActivitiesFromForm`),
 * then `.parse()`d — the elements are still server-derived data.
 */
export const TimeEntryActivityCollectionSchema = z.object({
  _type: z.string(),
  total: z.number().int(),
  count: z.number().int(),
  _embedded: z.object({
    elements: z.array(TimeEntryActivitySchema)
  })
})

export type TimeEntryActivity = z.infer<typeof TimeEntryActivitySchema>
export type TimeEntryActivityCollection = z.infer<
  typeof TimeEntryActivityCollectionSchema
>

/**
 * The slice of `POST /api/v3/time_entries/form` we care about: the
 * `activity` schema property's allowed values.
 *
 * OpenProject represents a schema property's allowed values in one of two
 * ways depending on version and payload — fully `_embedded` resources, or
 * `_links` (href + title) only. Both are accepted here; everything else in
 * the (large) form response is ignored via `.passthrough()`, so we never
 * depend on parts of the payload we don't read.
 */
export const TimeEntryFormSchema = z
  .object({
    _embedded: z
      .object({
        schema: z
          .object({
            activity: z
              .object({
                _embedded: z
                  .object({
                    allowedValues: z.array(z.unknown()).optional()
                  })
                  .passthrough()
                  .optional(),
                _links: z
                  .object({
                    allowedValues: z.array(z.unknown()).optional()
                  })
                  .passthrough()
                  .optional()
              })
              .passthrough()
              .optional()
          })
          .passthrough()
          .optional()
      })
      .passthrough()
      .optional()
  })
  .passthrough()

/**
 * Parse a `TimeEntriesActivity` id out of its self href.
 *
 * The href is server-supplied, so the trailing segment is validated as a
 * positive integer rather than trusted — a non-numeric or negative
 * segment yields `null` and the entry is skipped.
 */
export function parseActivityIdFromHref(href: string): number | null {
  if (typeof href !== 'string') return null
  const match = new RegExp(`${TIME_ENTRY_ACTIVITY_PATH}/(\\d+)/?$`).exec(href)
  if (!match) return null
  const id = Number(match[1])
  return Number.isInteger(id) && id > 0 ? id : null
}

/**
 * Extract the allowed activities from a `time_entries/form` response.
 *
 * Prefers the `_embedded.allowedValues` resources (they carry `position`
 * and `default`); falls back to `_links.allowedValues`, deriving each id
 * from its href and using the link `title` as the name. Anything that
 * doesn't yield both a positive integer id and a non-empty name is
 * skipped — a partially malformed form still produces a usable list
 * rather than failing the whole request.
 *
 * Pure: takes the already-`TimeEntryFormSchema`-parsed body, returns plain
 * data. Unit-tested in `tests/main/schemas/time-entries.test.ts`.
 */
export function extractActivitiesFromForm(
  form: z.infer<typeof TimeEntryFormSchema>
): TimeEntryActivity[] {
  const activity = form._embedded?.schema?.activity
  const out: TimeEntryActivity[] = []
  const seen = new Set<number>()

  const push = (id: number | null | undefined, name: unknown, extra?: {
    position?: unknown
    default?: unknown
  }): void => {
    if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) return
    if (typeof name !== 'string' || name.trim() === '') return
    if (seen.has(id)) return
    seen.add(id)
    out.push({
      id,
      name,
      ...(typeof extra?.position === 'number' && Number.isInteger(extra.position)
        ? { position: extra.position }
        : {}),
      ...(typeof extra?.default === 'boolean' ? { default: extra.default } : {})
    })
  }

  for (const raw of activity?._embedded?.allowedValues ?? []) {
    const v = raw as {
      id?: unknown
      name?: unknown
      position?: unknown
      default?: unknown
      _links?: { self?: { href?: unknown } }
    }
    // Prefer the explicit `id`; fall back to the self href when absent.
    const id =
      typeof v?.id === 'number'
        ? v.id
        : typeof v?._links?.self?.href === 'string'
          ? parseActivityIdFromHref(v._links.self.href)
          : null
    push(id, v?.name, { position: v?.position, default: v?.default })
  }

  if (out.length > 0) return out

  for (const raw of activity?._links?.allowedValues ?? []) {
    const v = raw as { href?: unknown; title?: unknown }
    if (typeof v?.href !== 'string') continue
    push(parseActivityIdFromHref(v.href), v?.title)
  }

  return out
}

// ---------------------------------------------------------------------------
// Create input (renderer → main; the renderer is an untrusted input source)
// ---------------------------------------------------------------------------

/** Max comment length accepted before we even call OpenProject. */
const COMMENT_MAX_LENGTH = 2000

/**
 * Input for creating a time entry, as sent by the renderer over IPC.
 *
 * Validated in the **main process** before any request is built
 * (`.opencode/rules/security.md` — validate at boundaries). The ids are
 * numbers, never renderer-supplied hrefs or paths, so the client builds
 * the `_links` hrefs itself and no renderer string can be injected into a
 * request URL.
 */
export const CreateTimeEntryInputSchema = z.object({
  workPackageId: z.number().int().positive(),
  activityId: z.number().int().positive(),
  /** ISO calendar date, must be a real day (rejects `2026-02-31`). */
  spentOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'spentOn must be an ISO YYYY-MM-DD date')
    .refine((ymd) => {
      const d = new Date(`${ymd}T00:00:00Z`)
      return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === ymd
    }, 'spentOn must be a real calendar date'),
  /**
   * Decimal hours. Must be positive (a zero-hour entry is meaningless) and
   * at most 24 — a single entry cannot exceed one day.
   */
  hours: z.number().positive().max(24),
  comment: z.string().max(COMMENT_MAX_LENGTH).optional()
})

export type CreateTimeEntryInput = z.infer<typeof CreateTimeEntryInputSchema>