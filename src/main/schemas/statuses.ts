import { z } from 'zod'

/**
 * Zod schemas for the OpenProject REST API v3 Statuses responses.
 *
 * Reference: https://www.openproject.org/docs/api/endpoints/statuses/
 *
 * The statuses endpoint is the source of truth for the status resource IDs
 * that OpenProject's work-package `status` filter `=` operator requires
 * (titles are NOT accepted). The view resolves its hardcoded primary
 * status titles to IDs via this endpoint before calling `listWorkPackages`,
 * falling back to a client-side filter when a title is missing.
 *
 * Each status element is HAL-wrapped (carries `_type: "Status"` and a
 * `_links.self` href), but the display value is the top-level `name` (not
 * a `_links.title`). The collection itself is the standard HAL+JSON
 * `{ _type: 'Collection', _embedded: { elements: [...] } }`.
 *
 * Optional fields use `.nullable().optional()` because real OpenProject
 * instances emit `null` (not a missing key) for unset values — e.g. a
 * status with no color returns `"color": null`. Plain `.optional()` only
 * permits absence, not an explicit null, so it must be `.nullable()` too.
 *
 * The renderer never sees raw server shapes — every response is `.parse()`d
 * here in the main process before crossing IPC. See
 * `.opencode/rules/security.md` and `.opencode/rules/architecture.md`.
 */

/**
 * A single Status element. `id` is the value the work-package `status`
 * filter `=` operator expects (stringified). `name` is the display title
 * the view matches against (case-insensitive).
 *
 * The remaining fields are modelled for future UI use and are all
 * `.nullable().optional()` so a real instance returning `null` for any of
 * them (observed in production for `color`) does not fail the parse.
 * `.passthrough()` lets OpenProject add other keys (e.g. `position`,
 * `defaultDoneRatio`, `isReadonly`, `excludedFromTotals`, `_links`)
 * without failing validation.
 */
export const StatusSchema = z
  .object({
    id: z.number().int(),
    name: z.string(),
    color: z.string().nullable().optional(),
    isDefault: z.boolean().nullable().optional(),
    isClosed: z.boolean().nullable().optional()
  })
  .passthrough()

export const StatusCollectionSchema = z.object({
  // OpenProject uses typed collections — accept any string `_type`.
  _type: z.string(),
  total: z.number().int(),
  count: z.number().int(),
  _embedded: z.object({
    elements: z.array(StatusSchema)
  })
})

export type Status = z.infer<typeof StatusSchema>
export type StatusCollection = z.infer<typeof StatusCollectionSchema>