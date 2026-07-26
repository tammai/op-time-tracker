/**
 * HAL href helpers shared by both trees.
 *
 * OpenProject links resources by href, not by id: a time entry carries its
 * work package as `_links.workPackage.href = "/api/v3/work_packages/12345"`.
 * The main process needs the id to *build* those hrefs, and the renderer needs
 * it to prefill the edit form from an existing entry — so the parsing lives
 * here rather than in either tree, exactly as `parseHoursToDecimal` does in
 * `./time.ts`. `src/main/schemas/time-entries.ts` re-exports these, so main
 * process code keeps importing from the schema module.
 *
 * Nothing here trusts its input: hrefs are server-supplied, and the ids they
 * yield are fed straight back into request paths, so a segment that isn't a
 * positive integer yields `null` and the caller skips the resource. See
 * `.opencode/rules/security.md`.
 */

/**
 * API path of the `TimeEntriesActivity` resource collection. The href → id
 * parsers below and the client's href builders both derive from these
 * constants so they can never drift apart.
 */
export const TIME_ENTRY_ACTIVITY_PATH = '/api/v3/time_entries/activities'

/** API path of the work package collection. */
export const WORK_PACKAGE_PATH = '/api/v3/work_packages'

/**
 * API path of the time entry collection — the base for the update and delete
 * request URLs, which append a validated numeric id.
 */
export const TIME_ENTRY_PATH = '/api/v3/time_entries'

/**
 * Parse a resource id out of a HAL href under `collectionPath`.
 *
 * The trailing segment is validated as a positive integer rather than
 * trusted — a non-numeric, negative, or wrong-collection href yields `null`.
 * A leading origin (`https://host/api/v3/…`) is tolerated: the match is
 * anchored on the collection path and the end of the string, not on the start.
 */
function parseResourceIdFromHref(
  collectionPath: string,
  href: unknown
): number | null {
  if (typeof href !== 'string') return null
  const match = new RegExp(`${collectionPath}/(\\d+)/?$`).exec(href)
  if (!match) return null
  const id = Number(match[1])
  return Number.isInteger(id) && id > 0 ? id : null
}

/** Parse a `TimeEntriesActivity` id out of its self href. */
export function parseActivityIdFromHref(href: unknown): number | null {
  return parseResourceIdFromHref(TIME_ENTRY_ACTIVITY_PATH, href)
}

/**
 * Parse a work package id out of a `_links.workPackage.href`.
 *
 * Used to prefill the edit form from an existing entry: the entry carries its
 * work package only as an href, while the update input takes a numeric id. An
 * href that yields nothing makes the entry non-editable, rather than producing
 * a request the server would reject.
 *
 * Note the two parsers are anchored on different collections — an activity
 * href (`/api/v3/time_entries/activities/3`) is not a work package href, and
 * neither parser accepts the other's input.
 */
export function parseWorkPackageIdFromHref(href: unknown): number | null {
  return parseResourceIdFromHref(WORK_PACKAGE_PATH, href)
}
