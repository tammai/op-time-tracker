import { z } from 'zod'

/**
 * Zod schema for OpenProject "principals" — the things a work package can be
 * assigned to.
 *
 * Source: `GET /api/v3/projects/{id}/available_assignees`. That is a **project**
 * resource, not a work-package one: the work-package-scoped
 * `/available_assignees` the spec assumed answers HTTP 404 on a real instance,
 * and the form's `assignee._links.allowedValues` points here instead. See
 * PLAN.md, "Verified API shapes".
 *
 * A principal is a `User`, a `Group`, or a `PlaceholderUser`. The live instance
 * returned only users, but the other two are legal on instances that enable
 * them — so `_type` is any string rather than a literal union. One group in the
 * list must not fail the parse and empty the assignee select.
 *
 * The renderer never sees the raw shape: this is `.parse()`d in the main
 * process like every other response (`.opencode/rules/security.md`).
 */

/** A HAL link, nullable for the same reason as elsewhere. */
const HalLinkSchema = z.object({
  href: z.string().nullable(),
  title: z.string().nullable().optional()
})

/**
 * A single principal. `id` and `name` are what the select needs and are
 * therefore required; everything else the server sends (avatars, e-mail,
 * status) is ignored rather than modelled.
 */
export const PrincipalSchema = z.object({
  id: z.number().int(),
  /** `User` | `Group` | `PlaceholderUser` — instance-dependent. */
  _type: z.string(),
  name: z.string(),
  _links: z
    .object({ self: HalLinkSchema.optional() })
    .passthrough()
    .optional()
})

export const PrincipalCollectionSchema = z.object({
  // Typed collections again — accept any `_type` string.
  _type: z.string(),
  total: z.number().int(),
  count: z.number().int(),
  _embedded: z.object({
    elements: z.array(PrincipalSchema)
  })
})

export type Principal = z.infer<typeof PrincipalSchema>
export type PrincipalCollection = z.infer<typeof PrincipalCollectionSchema>
