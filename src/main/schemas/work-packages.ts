import { z } from 'zod'

/**
 * Zod schemas for the OpenProject REST API v3 Work Package responses.
 *
 * Reference: https://www.openproject.org/docs/api/work-packages/
 *
 * OpenProject uses HAL+JSON: list responses are `{ _type: 'Collection',
 * _embedded: { elements: [...] } }`, and each element carries a `_links`
 * object with HAL links. We model only the fields the v1 app needs; the
 * `_links` object uses `.passthrough()` so OpenProject's many extra link
 * keys don't fail validation (defense in depth — strict where it matters,
 * lenient where the server adds keys we don't care about).
 *
 * The renderer never sees raw server shapes — every response is `.parse()`d
 * here in the main process before crossing IPC. See
 * `.opencode/rules/security.md` and `.opencode/rules/architecture.md`.
 */

/**
 * A HAL link: an `href`, usually a `title`.
 *
 * `href` is **nullable**: HAL — and OpenProject with it — represents an unset
 * resource link as `{ "href": null }` rather than by omitting the key. A
 * work package with no assignee, no category, or no parent comes back that
 * way, so requiring a string here rejects valid responses. Same for `title`,
 * which is `null` alongside a null `href`.
 */
const HalLinkSchema = z.object({
  href: z.string().nullable(),
  title: z.string().nullable().optional()
})

/**
 * The `_links` object on a Work Package. `self`, `type`, `status`, and
 * `project` are always present in real responses. `.passthrough()` lets
 * OpenProject add other links (e.g. `priority`, `responsible`,
 * `categories`) without failing the parse.
 *
 * Unassigned work packages surface either as `assignee: {}` or, on a real
 * instance, as `assignee: { "href": null }` — both parse.
 */
const WorkPackageLinksSchema = z
  .object({
    self: HalLinkSchema,
    type: HalLinkSchema.optional(),
    status: HalLinkSchema.optional(),
    project: HalLinkSchema.optional(),
    assignee: z
      .object({
        href: z.string().nullable().optional(),
        title: z.string().nullable().optional()
      })
      .passthrough()
      .default({})
  })
  .passthrough()

/**
 * A single Work Package element. `type`/`status` top-level strings are
 * kept for convenience but the canonical display values live in
 * `_links.type.title` / `_links.status.title`.
 *
 * Several fields are `.optional()` because real OpenProject responses
 * omit them depending on the work package type and configuration (e.g.
 * milestones often have no `startDate`/`dueDate`; some instances don't
 * return `spentHours` until time is logged). The schema is strict on the
 * fields the UI depends on (`id`, `subject`, `_links`) and lenient on the
 * rest, so a real response parses without drift.
 */
export const WorkPackageSchema = z.object({
  id: z.number().int(),
  _type: z.literal('WorkPackage'),
  subject: z.string(),
  /** Type title if the API returns it inline (often absent — use _links.type.title). */
  type: z.string().optional(),
  /** Status title if the API returns it inline (often absent — use _links.status.title). */
  status: z.string().optional(),
  startDate: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  /**
   * Number **or** ISO-8601 duration string (`"PT3H30M"`) — OpenProject
   * serializes it as a duration on current versions, and the app reads it
   * nowhere, so both are accepted rather than rejecting the whole collection
   * over a field nothing consumes.
   */
  spentHours: z.union([z.number(), z.string()]).nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  _links: WorkPackageLinksSchema
})

export const WorkPackageCollectionSchema = z.object({
  // OpenProject uses typed collections — the `_type` may be "Collection"
  // or a variant like "WorkPackageCollection" depending on the instance.
  // Accept any string here; the elements array is what we actually validate.
  _type: z.string(),
  total: z.number().int(),
  count: z.number().int(),
  _embedded: z.object({
    elements: z.array(WorkPackageSchema)
  })
})

export type WorkPackage = z.infer<typeof WorkPackageSchema>
export type WorkPackageCollection = z.infer<typeof WorkPackageCollectionSchema>
export type WorkPackageLinks = z.infer<typeof WorkPackageLinksSchema>