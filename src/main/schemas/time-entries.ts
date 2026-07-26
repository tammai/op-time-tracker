import { z } from 'zod'

import { parseHoursToDecimal } from '@shared/utils/time'
import {
  CALENDAR_DATE_PATTERN,
  isCalendarDate
} from '@shared/validation/calendar-date'
import {
  TIME_ENTRY_ACTIVITY_PATH,
  TIME_ENTRY_PATH,
  WORK_PACKAGE_PATH,
  parseActivityIdFromHref,
  parseWorkPackageIdFromHref
} from '@shared/utils/hal'

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
// after the move to `@shared/utils/time` and `@shared/utils/hal`. Those
// shared modules are the single source of truth for the implementations —
// the renderer imports them directly (it must not reach into `src/main/`),
// while main-process code keeps importing them from this schema module.
export {
  parseHoursToDecimal,
  TIME_ENTRY_ACTIVITY_PATH,
  TIME_ENTRY_PATH,
  WORK_PACKAGE_PATH,
  parseActivityIdFromHref,
  parseWorkPackageIdFromHref
}

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
 * add other links (e.g. `costObject`) without failing the parse.
 *
 * `activity` is declared rather than left to the passthrough because the day
 * modal reads it to prefill edit mode — a passthrough key types as `unknown`,
 * so reading it would mean casting. Declared and optional, it stays additive:
 * an entry without the link still parses.
 */
const TimeEntryLinksSchema = z
  .object({
    self: HalLinkSchema,
    workPackage: HalLinkSchema.optional(),
    project: HalLinkSchema.optional(),
    user: HalLinkSchema.optional(),
    activity: HalLinkSchema.optional()
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
  /**
   * ISO calendar date, must be a real day (rejects `2026-02-31`). The rule is
   * shared with the renderer's date field via `isCalendarDate` so the inline
   * message and this boundary check can't drift apart.
   */
  spentOn: z
    .string()
    .regex(CALENDAR_DATE_PATTERN, 'spentOn must be an ISO YYYY-MM-DD date')
    .refine(isCalendarDate, 'spentOn must be a real calendar date'),
  /**
   * Decimal hours. Must be positive (a zero-hour entry is meaningless) and
   * at most 24 — a single entry cannot exceed one day.
   */
  hours: z.number().positive().max(24),
  comment: z.string().max(COMMENT_MAX_LENGTH).optional()
})

export type CreateTimeEntryInput = z.infer<typeof CreateTimeEntryInputSchema>

// ---------------------------------------------------------------------------
// Update / delete input (renderer → main; same untrusted source)
// ---------------------------------------------------------------------------

/**
 * Input for updating an existing time entry: the create fields plus the id of
 * the entry to replace.
 *
 * Semantics are **full replacement**, not a partial patch — the renderer's
 * edit form always holds every field, so the client sends every field. That
 * makes an omitted `comment` mean "clear it", which is the only way to express
 * clearing when the field is optional. A partial-patch reading would make
 * clearing impossible.
 *
 * `id` is the only value that reaches a request *path*, so it is validated as
 * a positive integer here, before any URL is built
 * (`.opencode/rules/security.md` — validate at boundaries).
 */
export const UpdateTimeEntryInputSchema = CreateTimeEntryInputSchema.extend({
  id: z.number().int().positive()
})

/**
 * Input for deleting a time entry. Nothing but the id — and it is validated
 * as a positive integer before it is interpolated into the request path.
 */
export const DeleteTimeEntryInputSchema = z.object({
  id: z.number().int().positive()
})

export type UpdateTimeEntryInput = z.infer<typeof UpdateTimeEntryInputSchema>
export type DeleteTimeEntryInput = z.infer<typeof DeleteTimeEntryInputSchema>