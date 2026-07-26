import type { TimeEntry } from '@opentracker/preload'

import { parseHoursToDecimal } from '@shared/utils/time'
import {
  parseActivityIdFromHref,
  parseWorkPackageIdFromHref
} from '@shared/utils/hal'

/**
 * Turning a server `TimeEntry` back into something the form can edit.
 *
 * The two representations don't line up: an entry carries its work package and
 * activity as HAL hrefs and its duration as an ISO 8601 string, while the form
 * (and `UpdateTimeEntryInput`) works in numeric ids and decimal hours. This
 * module is that translation, kept pure and out of the components so it can be
 * unit-tested — see `.opencode/rules/conventions-frontend.md` (no business
 * logic in components).
 */

/** The form's edit-mode state, derived from an existing entry. */
export interface TimeEntryDraft {
  /** The entry being edited — becomes `UpdateTimeEntryInput.id`. */
  id: number
  workPackageId: number
  /**
   * `undefined` when the entry's activity href yields no id. The form then
   * falls back to the project's default activity, the same as a new entry —
   * losing the original activity is better than blocking the edit.
   */
  activityId: number | undefined
  hours: number
  comment: string
}

/**
 * The comment as plain text.
 *
 * OpenProject's `comment` is a Formattable object, but the schema also
 * tolerates a bare string or null (older and custom setups) — read all three
 * shapes rather than assuming one.
 */
export function timeEntryCommentText(entry: TimeEntry): string {
  const comment = entry.comment
  if (comment === null || comment === undefined) return ''
  if (typeof comment === 'string') return comment
  return comment.raw ?? ''
}

/**
 * Decimal hours for an entry; an unparseable duration counts as 0.
 *
 * Display-only: the day list shows `0.00h` for a duration it can't read rather
 * than dropping the row. `toTimeEntryDraft` deliberately does *not* use this —
 * a 0 there would silently rewrite the entry's hours on save.
 */
export function timeEntryHours(entry: TimeEntry): number {
  try {
    return parseHoursToDecimal(entry.hours)
  } catch {
    return 0
  }
}

/**
 * Build the form's edit state from an entry, or `null` when the entry can't be
 * edited safely.
 *
 * `null` means "no pencil on this row". That happens when the work package
 * href yields no positive integer id, or the duration doesn't parse — in
 * either case the form would have to invent a value, and saving would either
 * be rejected by the server or quietly overwrite the entry with the invented
 * one. Deleting such a row still works; it needs nothing but the id.
 */
export function toTimeEntryDraft(entry: TimeEntry): TimeEntryDraft | null {
  const workPackageId = parseWorkPackageIdFromHref(
    entry._links.workPackage?.href
  )
  if (workPackageId === null) return null

  let hours: number
  try {
    hours = parseHoursToDecimal(entry.hours)
  } catch {
    return null
  }
  if (!(hours > 0)) return null

  return {
    id: entry.id,
    workPackageId,
    activityId: parseActivityIdFromHref(entry._links.activity?.href) ?? undefined,
    hours,
    comment: timeEntryCommentText(entry)
  }
}
