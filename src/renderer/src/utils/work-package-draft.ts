/**
 * The editable field set of a work package, as plain data.
 *
 * This module is the whole answer to "how does the editor hold dirty state,
 * and how does stage 3 reuse it". Three properties make that work:
 *
 * 1. **A draft is flat, serializable state** — no HAL, no refs, no work
 *    package. `toWorkPackageDraft()` produces one from a loaded work package;
 *    `emptyWorkPackageDraft()` produces the same shape from nothing, which is
 *    what stage 3's create form starts from. Neither the panel nor the editor
 *    composable has to branch on which it got.
 * 2. **The diff decides clear-vs-omit, once.** `diffWorkPackageDraft()` is the
 *    only place that turns "the user emptied this field" into the `null` a
 *    PATCH needs, and "the user didn't touch it" into an absent key. Getting
 *    that wrong wipes data, so it lives in a pure function with tests rather
 *    than being re-derived per field in a template.
 * 3. **Options are built here too**, so the panel binds `{ label, value }` and
 *    never learns that an allowed value arrived as `{ id, name }`, let alone as
 *    an href.
 *
 * Pure — no Vue, no Electron, no fetch — like `time-entry-draft.ts`, and for
 * the same reason: `.opencode/rules/conventions-frontend.md` keeps logic out of
 * components, and `tests/renderer/` has no component runner.
 */

import type {
  AllowedValue,
  Principal,
  UpdateWorkPackageInput,
  WorkPackage
} from '@opentracker/preload'

import { isCalendarDate } from '@shared/validation/calendar-date'
import {
  parsePrincipalIdFromHref,
  parsePriorityIdFromHref,
  parseProjectIdFromHref,
  parseStatusIdFromHref,
  parseTypeIdFromHref
} from '@shared/utils/hal'

/**
 * Mirrors the main process's own bound (`WORK_PACKAGE_SUBJECT_MAX_LENGTH`).
 * Duplicated deliberately: this copy is a UI affordance that stops a doomed
 * request, the main-process one is the boundary that actually enforces it.
 */
const SUBJECT_MAX_LENGTH = 255

/** What the assignee select calls "nobody". */
export const UNASSIGNED_OPTION_LABEL = 'Unassigned'

/**
 * The editable fields, as the form holds them.
 *
 * Dates are `''` when unset rather than `null`: a draft is what an input binds
 * to, and an empty input is an empty string. Keeping one representation here
 * means `null` shows up in exactly one place — the diff — where it carries its
 * real meaning of *clear this field*.
 */
export interface WorkPackageDraft {
  subject: string
  startDate: string
  dueDate: string
  statusId: number | null
  typeId: number | null
  priorityId: number | null
  assigneeId: number | null
}

/** The changed half of an update — everything but the identity fields. */
export type WorkPackageChanges = Omit<UpdateWorkPackageInput, 'id' | 'lockVersion'>

/** A select option, in the shape `USelectMenu` binds with `value-key="value"`. */
export interface FieldOption {
  label: string
  value: number
}

/** An assignee option; `null` is the "Unassigned" entry. */
export interface AssigneeOption {
  label: string
  value: number | null
}

/** The draft stage 3 starts a create form from. */
export function emptyWorkPackageDraft(): WorkPackageDraft {
  return {
    subject: '',
    startDate: '',
    dueDate: '',
    statusId: null,
    typeId: null,
    priorityId: null,
    assigneeId: null
  }
}

/**
 * The draft a loaded work package starts from — also the snapshot the diff
 * measures against, so re-deriving it after a save is what stops the *next*
 * save from reporting phantom changes.
 *
 * Every id comes from a HAL href, parsed and validated as a positive integer;
 * an href we can't read yields `null`, which the diff then never sends.
 */
export function toWorkPackageDraft(workPackage: WorkPackage): WorkPackageDraft {
  const links = workPackage._links
  return {
    subject: workPackage.subject,
    startDate: workPackage.startDate ?? '',
    dueDate: workPackage.dueDate ?? '',
    statusId: parseStatusIdFromHref(links.status?.href),
    typeId: parseTypeIdFromHref(links.type?.href),
    priorityId: parsePriorityIdFromHref(
      (links as { priority?: { href?: string | null } }).priority?.href
    ),
    // A principal may be a user, a group, or a placeholder user — all three
    // hrefs are read, because the *current* value has to render even when the
    // editor can only ever write a user back.
    assigneeId: parsePrincipalIdFromHref(links.assignee?.href)
  }
}

/**
 * The project a work package belongs to.
 *
 * Needed because the assignee options come from a **project** resource, not a
 * work-package one (PLAN.md, "Verified API shapes"). Reading it here — from the
 * work package the panel already has — is what lets the form request and the
 * assignee request go out in parallel, and what keeps one failing from
 * disabling the other.
 */
export function workPackageProjectId(workPackage: WorkPackage): number | null {
  return parseProjectIdFromHref(workPackage._links.project?.href)
}

/**
 * What changed between the loaded snapshot and what the user has on screen.
 *
 * The contract, and the reason this is a tested pure function rather than
 * inline template logic:
 * - a field that did not change is **absent** from the result, so it is absent
 *   from the PATCH body, so OpenProject leaves it alone;
 * - a *cleared* nullable field is present with the value `null`, which is how
 *   HAL says "empty this";
 * - the three required links can never be cleared, so a `null` there is read as
 *   "we couldn't determine the current value", not as an instruction.
 *
 * Collapsing the first two — sending every field, as `updateTimeEntry` does —
 * would rewrite data the user never opened.
 */
export function diffWorkPackageDraft(
  base: WorkPackageDraft,
  draft: WorkPackageDraft
): WorkPackageChanges {
  const changes: WorkPackageChanges = {}

  const subject = draft.subject.trim()
  if (subject !== base.subject.trim()) changes.subject = subject

  if (draft.startDate !== base.startDate) {
    changes.startDate = draft.startDate === '' ? null : draft.startDate
  }
  if (draft.dueDate !== base.dueDate) {
    changes.dueDate = draft.dueDate === '' ? null : draft.dueDate
  }

  // Required links: only ever *set*, never cleared.
  if (draft.statusId !== null && draft.statusId !== base.statusId) {
    changes.statusId = draft.statusId
  }
  if (draft.typeId !== null && draft.typeId !== base.typeId) {
    changes.typeId = draft.typeId
  }
  if (draft.priorityId !== null && draft.priorityId !== base.priorityId) {
    changes.priorityId = draft.priorityId
  }

  // The one link that *can* be cleared, so `null` passes straight through.
  if (draft.assigneeId !== base.assigneeId) changes.assigneeId = draft.assigneeId

  return changes
}

/** Whether a diff is worth sending. */
export function hasWorkPackageChanges(changes: WorkPackageChanges): boolean {
  return Object.keys(changes).length > 0
}

/**
 * The first thing wrong with a draft, or `null`.
 *
 * A UI affordance, not a boundary: the main process re-checks all of this
 * (`UpdateWorkPackageInputSchema`). Its job is to turn a request that would
 * come back as `OPENPROJECT_INVALID_INPUT` into a disabled Save and an inline
 * message, which is a far better answer than a failed round trip.
 *
 * The date ordering rule is the one check that has no main-process twin:
 * OpenProject enforces it itself and answers 422, so this only saves a round
 * trip — but "due before start" is the mistake a date pair invites.
 */
export function workPackageDraftIssue(draft: WorkPackageDraft): string | null {
  const subject = draft.subject.trim()
  if (subject === '') return 'A subject is required.'
  if (subject.length > SUBJECT_MAX_LENGTH) {
    return `The subject cannot be longer than ${SUBJECT_MAX_LENGTH} characters.`
  }
  if (draft.startDate !== '' && !isCalendarDate(draft.startDate)) {
    return 'The start date is not a real date.'
  }
  if (draft.dueDate !== '' && !isCalendarDate(draft.dueDate)) {
    return 'The due date is not a real date.'
  }
  if (
    draft.startDate !== '' &&
    draft.dueDate !== '' &&
    draft.dueDate < draft.startDate
  ) {
    return 'The due date cannot be before the start date.'
  }
  return null
}

/**
 * Allowed values → select options.
 *
 * Server order is preserved: OpenProject returns statuses and types in their
 * configured workflow order, which is more meaningful than anything we could
 * sort them by.
 */
export function toFieldOptions(values: AllowedValue[]): FieldOption[] {
  return values.map((value) => ({ label: value.name, value: value.id }))
}

/**
 * Assignee options: "Unassigned", then the project's assignable **users**.
 *
 * Users only. The PATCH builds `/api/v3/users/{id}` from a bare number and has
 * no way to express a group href, so offering a group would produce a write the
 * server refuses. The schema still accepts groups, because one in the response
 * must not fail the parse and empty the whole select.
 *
 * `current` is the work package's existing assignee, pinned to the top when the
 * fetched list doesn't contain them — a former member, or a group. Without it
 * the select would render blank for a work package that is plainly assigned,
 * and the user would have no way to tell "nobody" from "somebody we couldn't
 * list". Selecting it back is a no-op, since it equals the snapshot.
 */
export function toAssigneeOptions(
  principals: Principal[],
  current: { id: number; title?: string | null } | null
): AssigneeOption[] {
  const users = principals
    .filter((principal) => principal._type === 'User')
    .map((principal) => ({ label: principal.name, value: principal.id }))

  const options: AssigneeOption[] = [
    { label: UNASSIGNED_OPTION_LABEL, value: null }
  ]
  if (current !== null && !users.some((user) => user.value === current.id)) {
    options.push({ label: current.title || `#${current.id}`, value: current.id })
  }
  return [...options, ...users]
}
