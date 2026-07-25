import { z } from 'zod'

/**
 * The work-package picker's search term.
 *
 * The dropdown searches by work-package **id**, so the term is digits only:
 * at most 5, never starting with `0` (no OpenProject id does). Below
 * `WORK_PACKAGE_SEARCH_MIN_DIGITS` the picker filters its already-loaded
 * items locally; at or above it, the term is sent to the server so items
 * outside the priority list become reachable.
 *
 * Lives in `src/shared/` because both trees need the identical rule: the
 * renderer applies it to keystrokes, and the main process re-applies it
 * before building a request — renderer input is never trusted
 * (`.opencode/rules/security.md`).
 */

/** Hard cap on the term's length. */
export const WORK_PACKAGE_SEARCH_MAX_DIGITS = 5

/**
 * Shortest term that triggers a server search.
 *
 * Equal to the cap, so a search is a whole id and resolves in exactly one
 * request. A shorter term would be a prefix, and a prefix has to be enumerated
 * into candidate ids and fetched one by one (see
 * {@link expandWorkPackageIdPrefix}) — 11 requests for a 4-digit term. Lower
 * this only if that fan-out is acceptable.
 */
export const WORK_PACKAGE_SEARCH_MIN_DIGITS = 5

/**
 * A complete, server-searchable term: no leading zero, and between
 * {@link WORK_PACKAGE_SEARCH_MIN_DIGITS} and
 * {@link WORK_PACKAGE_SEARCH_MAX_DIGITS} digits — currently exactly 5.
 * Anything else is either still being typed or not a term at all.
 */
export const WorkPackageSearchTermSchema = z
  .string()
  .regex(
    /^[1-9][0-9]{4}$/,
    `Search must be ${WORK_PACKAGE_SEARCH_MAX_DIGITS} digits and cannot start with 0.`
  )

/**
 * Coerce raw keystrokes into the allowed shape — non-digits dropped, leading
 * zeros dropped, truncated to the cap. Applied on every input event, so it
 * has to accept partial terms (`''`, `'1'`, `'12'`) rather than reject them.
 *
 * Leading zeros are stripped rather than blocking the keystroke so pasting
 * `0123` yields `123` instead of nothing.
 */
export function sanitizeWorkPackageSearchInput(raw: string): string {
  return (raw ?? '')
    .replace(/\D/g, '')
    .replace(/^0+/, '')
    .slice(0, WORK_PACKAGE_SEARCH_MAX_DIGITS)
}

/** Whether `value` is long enough and well-formed to query the server with. */
export function isWorkPackageSearchTerm(value: string): boolean {
  return WorkPackageSearchTermSchema.safeParse(value).success
}

/**
 * Expand a partial id into every id it could be the prefix of — `'1234'` →
 * `['1234', '12340', … '12349']`.
 *
 * OpenProject has no prefix operator for a numeric id: its `subjectOrId`
 * filter matches an id **exactly**, so searching `1234` finds #1234 and never
 * #12345. Enumerating the prefix instead turns a prefix search into an exact
 * `id` `=` filter — server-side, one request, and only ids that exist come
 * back.
 *
 * With the minimum equal to the cap this always returns a single id — the term
 * *is* a whole id. The expansion is kept because it's what makes a shorter
 * minimum possible: drop {@link WORK_PACKAGE_SEARCH_MIN_DIGITS} to 4 and this
 * returns 11 ids, each of which costs a request. The cap encodes the same
 * assumption as the input's length limit — that no work-package id is longer
 * than 5 digits — and each extra digit of range multiplies the list by 10.
 *
 * Returns `[]` for anything that isn't a valid term, so callers can't turn a
 * malformed input into an unfiltered "every work package" request.
 */
export function expandWorkPackageIdPrefix(term: string): string[] {
  if (!isWorkPackageSearchTerm(term)) return []

  const ids = [term]
  let frontier = [term]
  while (frontier[0].length < WORK_PACKAGE_SEARCH_MAX_DIGITS) {
    frontier = frontier.flatMap((prefix) =>
      Array.from({ length: 10 }, (_, digit) => `${prefix}${digit}`)
    )
    ids.push(...frontier)
  }
  return ids
}
