import { z } from 'zod'

import {
  CALENDAR_DATE_PATTERN,
  isCalendarDate
} from '@shared/validation/calendar-date'
import {
  PRIORITY_PATH,
  PROJECT_PATH,
  STATUS_PATH,
  TYPE_PATH,
  USER_PATH,
  parseResourceIdFromHref
} from '@shared/utils/hal'

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
    // Modelled explicitly rather than left to `.passthrough()`: the detail
    // panel reads its title and the edit form writes it, and a passthrough key
    // types as `{}`, so neither could reach `.title` without a cast.
    priority: HalLinkSchema.optional(),
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
 * OpenProject's Formattable, as it appears on `description`.
 *
 * Three spellings in the wild — the `{format, raw, html}` object a current
 * instance sends, a bare string on older ones, and `null` for an empty
 * description — so all three parse. Same union as `TimeEntryCommentSchema`,
 * for the same reason: only `raw` is ever read, and the alternative to
 * accepting the other spellings is failing an entire collection over a field
 * the list view doesn't show.
 *
 * `raw` is what the editor binds to; `html` is the server's rendering of it and
 * is never sent back (see `WORK_PACKAGE_DESCRIPTION_FORMAT`).
 */
const FormattableSchema = z.union([
  z
    .object({
      format: z.string().optional(),
      raw: z.string().nullable().optional(),
      html: z.string().nullable().optional()
    })
    .passthrough(),
  z.string(),
  z.null()
])

export type Formattable = z.infer<typeof FormattableSchema>

// The reader for this shape (`formattableRaw`) lives in `@shared/utils/hal`,
// not here: the renderer calls it at runtime to seed the edit draft, and only
// `src/shared/` is imported by both trees. This module owns the *schema*; the
// shared module owns the pure function that reads what the schema admits.

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
  /**
   * OpenProject's optimistic-locking counter, bumped on every write.
   *
   * **Required**, unlike most fields here, and deliberately so: a `PATCH`
   * without it is an unconditional overwrite of whatever the server currently
   * holds, so an instance that omitted it would silently downgrade every save
   * to last-writer-wins. A loud schema failure is the better outcome — and no
   * OpenProject v3 instance omits it.
   *
   * Non-negative rather than positive: a work package that has never been
   * edited reports `0`.
   */
  lockVersion: z.number().int().nonnegative(),
  subject: z.string(),
  /**
   * The long-form body. Optional because the collection endpoint omits it on
   * some instances and a work package may simply have none — read through
   * `formattableRaw()`, never off `.raw` directly.
   */
  description: FormattableSchema.optional(),
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

// ---------------------------------------------------------------------------
// The edit form (`POST /api/v3/work_packages/{id}/form`)
// ---------------------------------------------------------------------------

/**
 * The slice of the form response we read.
 *
 * Deliberately the most lenient schema in this file. The real payload is a
 * ~10 KB `Form` carrying every attribute and custom field the instance
 * defines; we read four things out of it, and every other key is passed
 * through unvalidated so an instance-specific attribute can never fail the
 * request. Even the fields we *do* read are typed `z.unknown()` and coerced by
 * `normalizeWorkPackageForm` — the schema's job here is only to prove the body
 * is an object of roughly the right shape, and the normalizer's job is to turn
 * whatever it holds into something the renderer can rely on.
 *
 * `_links.allowedValues` is `unknown` rather than an array on purpose: for
 * `status`/`type`/`priority` it *is* an array of `{ href, title }`, but for
 * `assignee` it is a single `{ href }` object pointing at the project's
 * available-assignees collection. See PLAN.md, "Verified API shapes".
 */
const FormPropertySchema = z
  .object({
    writable: z.unknown().optional(),
    _embedded: z
      .object({ allowedValues: z.array(z.unknown()).optional() })
      .passthrough()
      .optional(),
    _links: z
      .object({ allowedValues: z.unknown().optional() })
      .passthrough()
      .optional()
  })
  .passthrough()

export const WorkPackageFormResponseSchema = z
  .object({
    _embedded: z
      .object({
        schema: z
          .object({
            subject: FormPropertySchema.optional(),
            description: FormPropertySchema.optional(),
            startDate: FormPropertySchema.optional(),
            dueDate: FormPropertySchema.optional(),
            assignee: FormPropertySchema.optional(),
            type: FormPropertySchema.optional(),
            status: FormPropertySchema.optional(),
            priority: FormPropertySchema.optional()
          })
          .passthrough()
          .optional()
      })
      .passthrough()
      .optional()
  })
  .passthrough()

export type WorkPackageFormResponse = z.infer<typeof WorkPackageFormResponseSchema>

/**
 * One selectable value for an enumerated field, flattened out of HAL.
 *
 * This — not the `_links`/`_embedded` pair OpenProject sends — is what crosses
 * IPC. The renderer builds three selects from `{ id, name }[]` and never has to
 * know that an allowed value has two possible representations, or that ids live
 * in hrefs. `.opencode/rules/architecture.md`: the renderer never sees raw
 * server shapes.
 */
export const AllowedValueSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1)
})

/** An enumerated field: whether it may be written, and what it may be set to. */
export const WorkPackageFormFieldSchema = z.object({
  writable: z.boolean(),
  allowedValues: z.array(AllowedValueSchema)
})

/** A free-form field: whether it may be written. */
const WorkPackageFormPlainFieldSchema = z.object({ writable: z.boolean() })

/**
 * The normalized form — the shape the IPC contract actually returns.
 *
 * `writable` is carried for every field, not just the enumerated ones: a work
 * package scheduled automatically from its children reports non-writable
 * `startDate`/`dueDate`, and offering an input the server will refuse is worse
 * than showing a disabled one.
 */
export const WorkPackageFormSchema = z.object({
  subject: WorkPackageFormPlainFieldSchema,
  description: WorkPackageFormPlainFieldSchema,
  startDate: WorkPackageFormPlainFieldSchema,
  dueDate: WorkPackageFormPlainFieldSchema,
  assignee: WorkPackageFormPlainFieldSchema,
  status: WorkPackageFormFieldSchema,
  type: WorkPackageFormFieldSchema,
  priority: WorkPackageFormFieldSchema
})

export type AllowedValue = z.infer<typeof AllowedValueSchema>
export type WorkPackageFormField = z.infer<typeof WorkPackageFormFieldSchema>
export type WorkPackageForm = z.infer<typeof WorkPackageFormSchema>

/** A property is writable only if the server said so, in so many words. */
function isWritable(property: z.infer<typeof FormPropertySchema> | undefined): boolean {
  return property?.writable === true
}

/**
 * Pull the allowed values for one enumerated property out of a form response.
 *
 * Mirrors `extractActivitiesFromForm` in `time-entries.ts`, because OpenProject
 * offers the same two representations here: fully `_embedded` resources
 * (which carry `id` and `name` directly) or `_links` entries (href + title).
 * The embedded form wins when present; the link form is the fallback, with the
 * id parsed out of the href and validated as a positive integer.
 *
 * Anything that doesn't yield both a usable id and a non-empty name is skipped
 * rather than throwing — a partially malformed property still produces a usable
 * select instead of failing the whole request.
 */
function extractAllowedValues(
  property: z.infer<typeof FormPropertySchema> | undefined,
  collectionPath: string
): AllowedValue[] {
  const out: AllowedValue[] = []
  const seen = new Set<number>()

  const push = (id: number | null, name: unknown): void => {
    if (id === null || !Number.isInteger(id) || id <= 0) return
    if (typeof name !== 'string' || name.trim() === '') return
    if (seen.has(id)) return
    seen.add(id)
    out.push({ id, name })
  }

  for (const raw of property?._embedded?.allowedValues ?? []) {
    const value = raw as {
      id?: unknown
      name?: unknown
      _links?: { self?: { href?: unknown } }
    }
    const id =
      typeof value?.id === 'number'
        ? value.id
        : parseResourceIdFromHref(collectionPath, value?._links?.self?.href)
    push(id, value?.name)
  }

  if (out.length > 0) return out

  const links = property?._links?.allowedValues
  if (Array.isArray(links)) {
    for (const raw of links) {
      const value = raw as { href?: unknown; title?: unknown }
      push(parseResourceIdFromHref(collectionPath, value?.href), value?.title)
    }
  }

  return out
}

/**
 * Flatten a form response into the normalized {@link WorkPackageForm}.
 *
 * Pure: takes the already-parsed body, returns plain data. The client
 * `.parse()`s the result through `WorkPackageFormSchema` afterwards — the input
 * is still server-derived, so the output is re-validated rather than trusted
 * just because we built it.
 *
 * A missing property yields `writable: false` and an empty allowed-value list.
 * That is the honest reading: nothing is known about the field, and a disabled
 * select says so, where an enabled empty one would claim the workflow offers no
 * transitions.
 */
export function normalizeWorkPackageForm(
  response: WorkPackageFormResponse
): WorkPackageForm {
  const schema = response._embedded?.schema

  return {
    subject: { writable: isWritable(schema?.subject) },
    description: { writable: isWritable(schema?.description) },
    startDate: { writable: isWritable(schema?.startDate) },
    dueDate: { writable: isWritable(schema?.dueDate) },
    assignee: { writable: isWritable(schema?.assignee) },
    status: {
      writable: isWritable(schema?.status),
      allowedValues: extractAllowedValues(schema?.status, STATUS_PATH)
    },
    type: {
      writable: isWritable(schema?.type),
      allowedValues: extractAllowedValues(schema?.type, TYPE_PATH)
    },
    priority: {
      writable: isWritable(schema?.priority),
      allowedValues: extractAllowedValues(schema?.priority, PRIORITY_PATH)
    }
  }
}

// ---------------------------------------------------------------------------
// The create form (`POST /api/v3/projects/{id}/work_packages/form`)
// ---------------------------------------------------------------------------

/**
 * The create form response.
 *
 * A different resource from the edit form, not a variant of it — hence its own
 * pair of schemas rather than an optional field on the existing ones:
 *
 * - it takes **no** `lockVersion` (an empty `{}` body answers 200, where the
 *   edit form 409s), because there is no revision to be stale against;
 * - it is scoped to a **project**, which is what makes every allowed-value list
 *   here project-derived;
 * - it carries `project` and `description` properties the edit form doesn't;
 * - and its `_embedded.payload._links` holds OpenProject's own **defaults** for
 *   the three required links, which is the only reason a create form can offer
 *   a usable status and priority without asking the user to invent one.
 *
 * Verified against a live instance before this was written (PLAN.md, "Verified
 * API shapes — Stage 3"). As lenient as its sibling for the same reason: the
 * real payload carries ~40 attributes and every custom field the instance
 * defines, and none of them may fail the request.
 */
export const WorkPackageCreateFormResponseSchema = z
  .object({
    _embedded: z
      .object({
        payload: z
          .object({
            _links: z
              .object({
                type: HalLinkSchema.partial().optional(),
                status: HalLinkSchema.partial().optional(),
                priority: HalLinkSchema.partial().optional()
              })
              .passthrough()
              .optional()
          })
          .passthrough()
          .optional(),
        schema: z
          .object({
            subject: FormPropertySchema.optional(),
            description: FormPropertySchema.optional(),
            startDate: FormPropertySchema.optional(),
            dueDate: FormPropertySchema.optional(),
            assignee: FormPropertySchema.optional(),
            type: FormPropertySchema.optional(),
            status: FormPropertySchema.optional(),
            priority: FormPropertySchema.optional()
          })
          .passthrough()
          .optional()
      })
      .passthrough()
      .optional()
  })
  .passthrough()

export type WorkPackageCreateFormResponse = z.infer<
  typeof WorkPackageCreateFormResponseSchema
>

/**
 * OpenProject's own initial values for the three required links.
 *
 * `null` means the form offered none — reported honestly rather than guessed at,
 * so the renderer can gate Create on a type it genuinely cannot supply instead
 * of sending one the project never allowed.
 */
export const WorkPackageCreateDefaultsSchema = z.object({
  typeId: z.number().int().positive().nullable(),
  statusId: z.number().int().positive().nullable(),
  priorityId: z.number().int().positive().nullable()
})

/**
 * The normalized create form — what the IPC contract returns.
 *
 * Same flattened `{ writable, allowedValues }` shape as the edit form, plus
 * `description` (which the create form offers and Stage 2's edit form did not
 * expose) and `defaults`.
 */
export const WorkPackageCreateFormSchema = z.object({
  subject: WorkPackageFormPlainFieldSchema,
  description: WorkPackageFormPlainFieldSchema,
  startDate: WorkPackageFormPlainFieldSchema,
  dueDate: WorkPackageFormPlainFieldSchema,
  assignee: WorkPackageFormPlainFieldSchema,
  status: WorkPackageFormFieldSchema,
  type: WorkPackageFormFieldSchema,
  priority: WorkPackageFormFieldSchema,
  defaults: WorkPackageCreateDefaultsSchema
})

export type WorkPackageCreateDefaults = z.infer<typeof WorkPackageCreateDefaultsSchema>
export type WorkPackageCreateForm = z.infer<typeof WorkPackageCreateFormSchema>

/**
 * Flatten a create-form response into the normalized {@link WorkPackageCreateForm}.
 *
 * Pure, and re-`.parse()`d by the caller for the same reason as its sibling: the
 * input is server-derived, so building the output here does not make it trusted.
 *
 * Each default is parsed out of its href **anchored on its own collection**, so
 * a `status` href sitting in the `type` slot yields `null` rather than a
 * plausible-looking wrong id — the ids overlap freely across collections.
 */
export function normalizeWorkPackageCreateForm(
  response: WorkPackageCreateFormResponse
): WorkPackageCreateForm {
  const schema = response._embedded?.schema
  const links = response._embedded?.payload?._links

  return {
    subject: { writable: isWritable(schema?.subject) },
    description: { writable: isWritable(schema?.description) },
    startDate: { writable: isWritable(schema?.startDate) },
    dueDate: { writable: isWritable(schema?.dueDate) },
    assignee: { writable: isWritable(schema?.assignee) },
    status: {
      writable: isWritable(schema?.status),
      allowedValues: extractAllowedValues(schema?.status, STATUS_PATH)
    },
    type: {
      writable: isWritable(schema?.type),
      allowedValues: extractAllowedValues(schema?.type, TYPE_PATH)
    },
    priority: {
      writable: isWritable(schema?.priority),
      allowedValues: extractAllowedValues(schema?.priority, PRIORITY_PATH)
    },
    defaults: {
      typeId: parseResourceIdFromHref(TYPE_PATH, links?.type?.href),
      statusId: parseResourceIdFromHref(STATUS_PATH, links?.status?.href),
      priorityId: parseResourceIdFromHref(PRIORITY_PATH, links?.priority?.href)
    }
  }
}

// ---------------------------------------------------------------------------
// Inputs (renderer → main; the renderer is an untrusted input source)
// ---------------------------------------------------------------------------

/**
 * Cap on the subject, enforced before any request is built.
 *
 * OpenProject's own schema reports `maxLength: 255`, and the form response
 * carries that number — but a server-reported limit cannot be the security
 * boundary, because a hostile instance would simply report a larger one. The
 * bound is therefore hardcoded here, in the main process, where the renderer
 * cannot influence it. See `.opencode/rules/security.md`.
 */
export const WORK_PACKAGE_SUBJECT_MAX_LENGTH = 255

/**
 * Cap on the description, enforced before any request is built.
 *
 * OpenProject imposes no practical limit of its own on a Formattable, so unlike
 * the subject there is no server-reported number to compare against — which
 * makes this the only bound there is. Its job is to stop a renderer from
 * handing this process a string it then has to hold, serialize, and upload;
 * 30 000 characters is far beyond any description a person types into a
 * text area and far below anything that costs this process real memory.
 */
export const WORK_PACKAGE_DESCRIPTION_MAX_LENGTH = 30_000

/**
 * The `format` every description is sent with — **pinned here, in the main
 * process, and never taken from the renderer** (`.opencode/rules/security.md`).
 *
 * Not a defensive nicety: a live instance accepted a payload whose `format` was
 * `"custom"` and whose `html` was `<script>alert(1)</script>` with *empty*
 * validation errors (PLAN.md, "Verified API shapes — Stage 3"). The server does
 * not police this, so nothing downstream of here does either. `html` is never
 * sent at all — it is the server's rendering of `raw`, not an input.
 */
export const WORK_PACKAGE_DESCRIPTION_FORMAT = 'markdown'

/**
 * Renderer-supplied description text: length-bounded, never trimmed.
 *
 * Trailing whitespace is meaningful in markdown (two spaces end a line), so
 * unlike the subject this one is taken as typed.
 */
const DescriptionSchema = z
  .string()
  .max(
    WORK_PACKAGE_DESCRIPTION_MAX_LENGTH,
    `The description cannot be longer than ${WORK_PACKAGE_DESCRIPTION_MAX_LENGTH} characters.`
  )

/** The Formattable a description is sent as, with the format pinned above. */
function descriptionPayload(raw: string): Record<string, unknown> {
  return { format: WORK_PACKAGE_DESCRIPTION_FORMAT, raw }
}

/**
 * An ISO calendar date that is also a real day (rejects `2026-02-31`). Shares
 * `isCalendarDate` with the renderer's own field validation so the inline
 * message and this boundary check cannot drift apart.
 */
const CalendarDateSchema = z
  .string()
  .regex(CALENDAR_DATE_PATTERN, 'Dates must be ISO YYYY-MM-DD.')
  .refine(isCalendarDate, 'Dates must be a real calendar date.')

/**
 * Input for `getWorkPackageForm`.
 *
 * `lockVersion` is not optional: the form endpoint answers HTTP 409 to a
 * payload without one (verified against a live instance — see PLAN.md). It is
 * also the *only* thing that goes into that POST body, which is what keeps a
 * non-mutating probe from becoming a write primitive.
 */
export const WorkPackageFormInputSchema = z.object({
  workPackageId: z.number().int().positive(),
  lockVersion: z.number().int().nonnegative()
})

/**
 * Input for `listAvailableAssignees`.
 *
 * A **project** id, not a work package id: the work-package-scoped
 * `available_assignees` endpoint the spec assumed does not exist (HTTP 404).
 * The renderer derives the project id from the work package's own
 * `_links.project.href` and sends the number; main rebuilds the path.
 */
export const AvailableAssigneesInputSchema = z.object({
  projectId: z.number().int().positive()
})

/**
 * Input for `getWorkPackageCreateForm`.
 *
 * A project id — the create form is project-scoped, which is the whole shape of
 * this stage: until a project is chosen there are no legal types, statuses or
 * assignees.
 *
 * `typeId` is optional and, when present, the *only* thing that reaches the
 * request body — as one href rebuilt from the validated integer. It exists
 * because OpenProject derives a status workflow from (type, role), so an
 * instance with per-type workflows needs it for the status list to be correct.
 * The probed instance returned identical allowed values with and without it, so
 * the renderer currently queries by project alone; sending it later needs no
 * contract change. See PLAN.md, "Verified API shapes — Stage 3".
 */
export const WorkPackageCreateFormInputSchema = z.object({
  projectId: z.number().int().positive(),
  typeId: z.number().int().positive().optional()
})

/**
 * Input for `createWorkPackage`.
 *
 * Deliberately **not** nullable anywhere, which is the one place its semantics
 * differ from `UpdateWorkPackageInputSchema`. On an update, `null` means *clear
 * this field* and is distinct from an absent key; on a create there is nothing
 * to clear, so `null` would be a second spelling of "absent" — and two spellings
 * of one meaning is exactly how the clear-vs-omit bug gets in.
 *
 * `projectId` and `typeId` are required because OpenProject requires them and
 * neither can be defaulted here: which types are legal depends on the project.
 * `statusId` and `priorityId` are optional because the create form reports
 * OpenProject's own defaults for them, which the server applies when they are
 * omitted (verified — a payload without either validated clean).
 *
 * Every id is a plain number so the client builds the hrefs itself, `subject`
 * and `description` are length-bounded here rather than at the caller, and
 * dates must be real calendar days (`.opencode/rules/security.md`).
 */
export const CreateWorkPackageInputSchema = z.object({
  projectId: z.number().int().positive(),
  typeId: z.number().int().positive(),
  subject: z
    .string()
    .trim()
    .min(1, 'The subject cannot be empty.')
    .max(
      WORK_PACKAGE_SUBJECT_MAX_LENGTH,
      `The subject cannot be longer than ${WORK_PACKAGE_SUBJECT_MAX_LENGTH} characters.`
    ),
  description: DescriptionSchema.optional(),
  statusId: z.number().int().positive().optional(),
  priorityId: z.number().int().positive().optional(),
  assigneeId: z.number().int().positive().optional(),
  startDate: CalendarDateSchema.optional(),
  dueDate: CalendarDateSchema.optional()
})

/**
 * Input for `updateWorkPackage` — a **partial** update.
 *
 * This is the one place the semantics differ from `UpdateTimeEntryInputSchema`,
 * and the difference matters: every editable field is `.optional()`, and an
 * absent one must not appear in the request body at all. `null` is a separate,
 * explicit instruction meaning *clear this field*, available only where
 * OpenProject allows a field to be empty (the two dates and the assignee).
 * Collapsing the two would either make clearing impossible or wipe fields the
 * user never touched — see `buildWorkPackagePatchPayload`.
 *
 * `id` and `lockVersion` are validated before either reaches the request path
 * or body (`.opencode/rules/security.md` — validate at boundaries), and every
 * resource id is a plain number so the client can build the hrefs itself.
 */
export const UpdateWorkPackageInputSchema = z.object({
  id: z.number().int().positive(),
  lockVersion: z.number().int().nonnegative(),
  subject: z
    .string()
    .trim()
    .min(1, 'The subject cannot be empty.')
    .max(
      WORK_PACKAGE_SUBJECT_MAX_LENGTH,
      `The subject cannot be longer than ${WORK_PACKAGE_SUBJECT_MAX_LENGTH} characters.`
    )
    .optional(),
  /**
   * Editable since Stage 3, which added the field to the shared
   * `WorkPackageFields` component (the spec's "Deliberate scope widening"). `''`
   * is a real instruction here — *clear the description* — expressed as an empty
   * `raw`, because a Formattable has no null spelling the way a date link does.
   */
  description: DescriptionSchema.optional(),
  startDate: CalendarDateSchema.nullable().optional(),
  dueDate: CalendarDateSchema.nullable().optional(),
  statusId: z.number().int().positive().optional(),
  typeId: z.number().int().positive().optional(),
  priorityId: z.number().int().positive().optional(),
  assigneeId: z.number().int().positive().nullable().optional()
})

export type UpdateWorkPackageInput = z.infer<typeof UpdateWorkPackageInputSchema>
export type CreateWorkPackageInput = z.infer<typeof CreateWorkPackageInputSchema>
export type WorkPackageFormInput = z.infer<typeof WorkPackageFormInputSchema>
export type WorkPackageCreateFormInput = z.infer<
  typeof WorkPackageCreateFormInputSchema
>
export type AvailableAssigneesInput = z.infer<typeof AvailableAssigneesInputSchema>

/**
 * Build the `PATCH /api/v3/work_packages/{id}` body.
 *
 * **Partial, not a replacement.** Only `lockVersion` is unconditional; a field
 * appears in the body if and only if the caller passed it. That is the whole
 * contract: OpenProject leaves an absent field alone, so omitting is how "don't
 * touch this" is expressed, and `null` (a date) or `{ href: null }` (the
 * assignee) is how "clear this" is expressed. `undefined` is never a value —
 * only an absence — which is why the tests below check key *presence*, not
 * equality.
 *
 * Every href is built here from an already-validated numeric id, so nothing
 * renderer-supplied reaches a path. `id` is not in the body at all — it belongs
 * to the URL.
 */
export function buildWorkPackagePatchPayload(
  input: UpdateWorkPackageInput
): Record<string, unknown> {
  const payload: Record<string, unknown> = { lockVersion: input.lockVersion }

  if (input.subject !== undefined) payload.subject = input.subject
  // The format is ours, never the caller's — see WORK_PACKAGE_DESCRIPTION_FORMAT.
  if (input.description !== undefined) {
    payload.description = descriptionPayload(input.description)
  }
  if (input.startDate !== undefined) payload.startDate = input.startDate
  if (input.dueDate !== undefined) payload.dueDate = input.dueDate

  const links: Record<string, unknown> = {}
  if (input.statusId !== undefined) {
    links.status = { href: `${STATUS_PATH}/${input.statusId}` }
  }
  if (input.typeId !== undefined) {
    links.type = { href: `${TYPE_PATH}/${input.typeId}` }
  }
  if (input.priorityId !== undefined) {
    links.priority = { href: `${PRIORITY_PATH}/${input.priorityId}` }
  }
  if (input.assigneeId !== undefined) {
    // The one link that can be cleared. HAL says so with an explicit null
    // href, not by omitting the key — omitting it would mean "unchanged".
    links.assignee =
      input.assigneeId === null
        ? { href: null }
        : { href: `${USER_PATH}/${input.assigneeId}` }
  }
  if (Object.keys(links).length > 0) payload._links = links

  return payload
}

/**
 * Build the `POST /api/v3/work_packages` body.
 *
 * Rebuilt field by field from the parsed input — never spread from it, and
 * never from the caller's object. That is what guarantees a renderer cannot
 * append an `_links` block, a `format`, a rendered `html`, or a `lockVersion`
 * and have it ride along: anything not named here simply does not exist in the
 * request (`.opencode/rules/security.md`).
 *
 * Unlike the PATCH builder there is no clear-vs-omit distinction to preserve —
 * a work package that does not exist yet has no field to clear — so an absent
 * optional is simply not sent and OpenProject applies its own default. The two
 * required links are unconditional, because the API requires them and the
 * create form is what supplied their legal values.
 */
export function buildWorkPackageCreatePayload(
  input: CreateWorkPackageInput
): Record<string, unknown> {
  const payload: Record<string, unknown> = { subject: input.subject }

  // An empty description is nothing to send: there is no stored value to clear,
  // and OpenProject defaults it to empty anyway.
  if (input.description !== undefined && input.description.length > 0) {
    payload.description = descriptionPayload(input.description)
  }
  if (input.startDate !== undefined) payload.startDate = input.startDate
  if (input.dueDate !== undefined) payload.dueDate = input.dueDate

  const links: Record<string, unknown> = {
    project: { href: `${PROJECT_PATH}/${input.projectId}` },
    type: { href: `${TYPE_PATH}/${input.typeId}` }
  }
  if (input.statusId !== undefined) {
    links.status = { href: `${STATUS_PATH}/${input.statusId}` }
  }
  if (input.priorityId !== undefined) {
    links.priority = { href: `${PRIORITY_PATH}/${input.priorityId}` }
  }
  if (input.assigneeId !== undefined) {
    // Users only, exactly as on the update path: the href is built from a bare
    // number and has no way to express a group.
    links.assignee = { href: `${USER_PATH}/${input.assigneeId}` }
  }
  payload._links = links

  return payload
}
