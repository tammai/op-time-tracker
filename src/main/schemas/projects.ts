import { z } from 'zod'

/**
 * Zod schema for OpenProject projects — the options for the create form's
 * project select.
 *
 * Source: **`GET /api/v3/work_packages/available_projects`**, not
 * `GET /api/v3/projects`. The two differ in exactly the way that matters here:
 * the plain collection lists every project the API key can *see*, including
 * ones it may not create work packages in (the probed instance had such a
 * project), while `available_projects` is what the create form's own
 * `project._links.allowedValues` points at and lists only the creatable ones.
 * Offering the wrong set means a create that fails after the form is filled in.
 * See PLAN.md, "Verified API shapes — Stage 3".
 *
 * The response shape is identical either way, so this schema describes both.
 *
 * Strict on `id` and `name` — the two things a select needs — and lenient on
 * everything else. A project carries Formattable `description` and
 * `statusExplanation` fields, a dozen `_links` keys, and whatever the instance
 * adds; a collection parse is all-or-nothing, so modelling any of that would
 * turn one unusual project into an empty select
 * (`knowledge/domains/openproject-response-shapes.md`).
 */

/** A HAL link, nullable for the same reason as elsewhere. */
const HalLinkSchema = z.object({
  href: z.string().nullable(),
  title: z.string().nullable().optional()
})

export const ProjectSchema = z
  .object({
    id: z.number().int(),
    /** `Project` in practice; accepted as any string like every other `_type`. */
    _type: z.string().optional(),
    name: z.string(),
    /** The URL slug. Not used to build requests — ids are. */
    identifier: z.string().optional(),
    active: z.boolean().optional(),
    _links: z
      .object({
        self: HalLinkSchema.optional(),
        /**
         * Present only when this key may create work packages here. Not read as
         * a permission gate — `available_projects` has already applied that —
         * but modelled so its absence can never fail a parse.
         */
        createWorkPackage: z
          .object({ href: z.string().nullable().optional() })
          .passthrough()
          .optional()
      })
      .passthrough()
      .optional()
  })
  .passthrough()

export const ProjectCollectionSchema = z.object({
  // Typed collections again — `"Collection"` or `"ProjectCollection"`.
  _type: z.string(),
  total: z.number().int(),
  count: z.number().int(),
  _embedded: z.object({
    elements: z.array(ProjectSchema)
  })
})

export type Project = z.infer<typeof ProjectSchema>
export type ProjectCollection = z.infer<typeof ProjectCollectionSchema>
