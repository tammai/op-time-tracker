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
 * The collections a work package's editable `_links` point into.
 *
 * Both directions run through these constants: the parsers below read an id
 * out of a server-supplied href, and `buildWorkPackagePatchPayload` writes a
 * fresh href from a validated numeric id. Sharing the constant is what keeps
 * "the id we read" and "the href we send" from drifting apart.
 */
export const STATUS_PATH = '/api/v3/statuses'
export const TYPE_PATH = '/api/v3/types'
export const PRIORITY_PATH = '/api/v3/priorities'
export const PROJECT_PATH = '/api/v3/projects'
export const USER_PATH = '/api/v3/users'
export const GROUP_PATH = '/api/v3/groups'
export const PLACEHOLDER_USER_PATH = '/api/v3/placeholder_users'

/**
 * Parse a resource id out of a HAL href under `collectionPath`.
 *
 * The trailing segment is validated as a positive integer rather than
 * trusted — a non-numeric, negative, or wrong-collection href yields `null`.
 * A leading origin (`https://host/api/v3/…`) is tolerated: the match is
 * anchored on the collection path and the end of the string, not on the start.
 */
export function parseResourceIdFromHref(
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

/**
 * Parsers for the links the work-package editor reads.
 *
 * Each is anchored on its own collection, so a status href is never mistaken
 * for a type href — the ids overlap freely across collections, and a
 * cross-collection match would silently produce a valid-looking but wrong
 * request.
 */
export function parseStatusIdFromHref(href: unknown): number | null {
  return parseResourceIdFromHref(STATUS_PATH, href)
}

export function parseTypeIdFromHref(href: unknown): number | null {
  return parseResourceIdFromHref(TYPE_PATH, href)
}

export function parsePriorityIdFromHref(href: unknown): number | null {
  return parseResourceIdFromHref(PRIORITY_PATH, href)
}

/**
 * Parse a project id out of a `_links.project.href`.
 *
 * The renderer needs it because the assignee options come from a *project*
 * resource (`/api/v3/projects/{id}/available_assignees`) — see PLAN.md,
 * "Verified API shapes". A number is what crosses IPC; the main process
 * rebuilds the path from it.
 */
export function parseProjectIdFromHref(href: unknown): number | null {
  return parseResourceIdFromHref(PROJECT_PATH, href)
}

/**
 * Parse a principal id out of an assignee href.
 *
 * A principal is a user, a group, or a placeholder user, and OpenProject links
 * each from its own collection — so all three are tried. Only the id is
 * returned: which collection it came from is deliberately dropped, because the
 * editor only ever writes a `/api/v3/users/{id}` href back (assigning a group
 * is out of scope for this stage).
 */
export function parsePrincipalIdFromHref(href: unknown): number | null {
  for (const path of [USER_PATH, GROUP_PATH, PLACEHOLDER_USER_PATH]) {
    const id = parseResourceIdFromHref(path, href)
    if (id !== null) return id
  }
  return null
}
