import { describe, it, expect } from 'vitest'
import type { Principal, WorkPackage } from '@opentracker/preload'

import {
  diffWorkPackageDraft,
  emptyWorkPackageDraft,
  hasWorkPackageChanges,
  toAssigneeOptions,
  toFieldOptions,
  toWorkPackageDraft,
  workPackageDraftIssue,
  workPackageProjectId,
  UNASSIGNED_OPTION_LABEL,
  type WorkPackageDraft
} from '~~/src/renderer/src/utils/work-package-draft'

/**
 * The editable field set, as plain data.
 *
 * Everything the editor decides — what changed, what "clear" means, what the
 * three selects offer — is decided here, in pure functions, so it can be tested
 * without a component runner and reused unchanged by stage 3's create form
 * against an empty draft.
 */

function wp(overrides: Partial<WorkPackage> = {}): WorkPackage {
  return {
    id: 42,
    _type: 'WorkPackage',
    lockVersion: 4,
    subject: 'Fix login bug',
    startDate: '2026-01-15',
    dueDate: '2026-01-22',
    _links: {
      self: { href: '/api/v3/work_packages/42' },
      type: { href: '/api/v3/types/1', title: 'Task' },
      status: { href: '/api/v3/statuses/3', title: 'In Progress' },
      project: { href: '/api/v3/projects/7', title: 'Backend' },
      priority: { href: '/api/v3/priorities/8', title: 'Normal' },
      assignee: { href: '/api/v3/users/11', title: 'Alice' }
    },
    ...overrides
  } as WorkPackage
}

describe('toWorkPackageDraft', () => {
  it('reads every editable field off the work package', () => {
    expect(toWorkPackageDraft(wp())).toEqual({
      subject: 'Fix login bug',
      startDate: '2026-01-15',
      dueDate: '2026-01-22',
      statusId: 3,
      typeId: 1,
      priorityId: 8,
      assigneeId: 11
    })
  })

  /**
   * `''` rather than `null` for an unset date: the draft is what a text/date
   * input binds to, and an input's empty state is the empty string. Keeping one
   * representation in the draft means `null` appears in exactly one place — the
   * diff — where "clear this" is actually being expressed.
   */
  it('represents unset dates as empty strings, not null', () => {
    const draft = toWorkPackageDraft(wp({ startDate: null, dueDate: undefined }))
    expect(draft.startDate).toBe('')
    expect(draft.dueDate).toBe('')
  })

  it('reads an unassigned work package as a null assignee', () => {
    expect(toWorkPackageDraft(wp({ _links: { ...wp()._links, assignee: {} } })).assigneeId).toBeNull()
    expect(
      toWorkPackageDraft(wp({ _links: { ...wp()._links, assignee: { href: null } } }))
        .assigneeId
    ).toBeNull()
  })

  it('reads a group assignee — a principal is not always a user', () => {
    const draft = toWorkPackageDraft(
      wp({
        _links: {
          ...wp()._links,
          assignee: { href: '/api/v3/groups/401', title: 'Platform team' }
        }
      })
    )
    expect(draft.assigneeId).toBe(401)
  })

  it('yields null for a link whose href cannot be read', () => {
    const draft = toWorkPackageDraft(
      wp({
        _links: {
          self: { href: '/api/v3/work_packages/42' },
          status: { href: 'https://evil.example.com/statuses/9' },
          type: { href: null },
          assignee: {}
        }
      } as unknown as Partial<WorkPackage>)
    )
    expect(draft.statusId).toBeNull()
    expect(draft.typeId).toBeNull()
    expect(draft.priorityId).toBeNull()
  })
})

describe('emptyWorkPackageDraft', () => {
  it('is the same shape a loaded work package produces — stage 3 reuses it', () => {
    expect(Object.keys(emptyWorkPackageDraft()).sort()).toEqual(
      Object.keys(toWorkPackageDraft(wp())).sort()
    )
  })

  it('starts with nothing set', () => {
    expect(emptyWorkPackageDraft()).toEqual({
      subject: '',
      startDate: '',
      dueDate: '',
      statusId: null,
      typeId: null,
      priorityId: null,
      assigneeId: null
    })
  })
})

describe('workPackageProjectId', () => {
  it('reads the project id the assignee list is scoped to', () => {
    expect(workPackageProjectId(wp())).toBe(7)
  })

  it('returns null when the project link is missing or unreadable', () => {
    for (const project of [undefined, { href: null }, { href: '/api/v3/projects/abc' }]) {
      expect(
        workPackageProjectId(
          wp({ _links: { ...wp()._links, project: project } } as Partial<WorkPackage>)
        )
      ).toBeNull()
    }
  })
})

/**
 * The clear-vs-omit decision, made once. A key is present only when the field
 * actually changed; its value is `null` only when the change is a *clear*.
 * The assertions therefore check key presence, not just equality — `undefined`
 * and "absent" are the same thing to `toEqual` but very different in a PATCH.
 */
describe('diffWorkPackageDraft', () => {
  const base = toWorkPackageDraft(wp())

  it('reports nothing when nothing changed', () => {
    const changes = diffWorkPackageDraft(base, { ...base })
    expect(changes).toEqual({})
    expect(hasWorkPackageChanges(changes)).toBe(false)
  })

  it('reports only the field that changed', () => {
    const changes = diffWorkPackageDraft(base, { ...base, subject: 'Renamed' })
    expect(changes).toEqual({ subject: 'Renamed' })
    expect(hasWorkPackageChanges(changes)).toBe(true)
  })

  it('sends null for a cleared date and omits the untouched one', () => {
    const changes = diffWorkPackageDraft(base, { ...base, dueDate: '' })
    expect(Object.prototype.hasOwnProperty.call(changes, 'dueDate')).toBe(true)
    expect(changes.dueDate).toBeNull()
    expect(Object.prototype.hasOwnProperty.call(changes, 'startDate')).toBe(false)
  })

  it('sends the new date when one is set on a previously empty field', () => {
    const emptyDates: WorkPackageDraft = { ...base, startDate: '', dueDate: '' }
    const changes = diffWorkPackageDraft(emptyDates, {
      ...emptyDates,
      startDate: '2026-04-01'
    })
    expect(changes).toEqual({ startDate: '2026-04-01' })
  })

  it('sends null for a cleared assignee and omits an unchanged one', () => {
    const cleared = diffWorkPackageDraft(base, { ...base, assigneeId: null })
    expect(Object.prototype.hasOwnProperty.call(cleared, 'assigneeId')).toBe(true)
    expect(cleared.assigneeId).toBeNull()

    const unchanged = diffWorkPackageDraft(base, { ...base })
    expect(Object.prototype.hasOwnProperty.call(unchanged, 'assigneeId')).toBe(false)
  })

  it('never emits null for the three required links — they cannot be cleared', () => {
    const changes = diffWorkPackageDraft(base, {
      ...base,
      statusId: null,
      typeId: null,
      priorityId: null
    })
    expect(changes).toEqual({})
  })

  it('reports a changed status, type and priority as plain ids', () => {
    const changes = diffWorkPackageDraft(base, {
      ...base,
      statusId: 9,
      typeId: 7,
      priorityId: 10
    })
    expect(changes).toEqual({ statusId: 9, typeId: 7, priorityId: 10 })
  })

  it('compares subjects trimmed — padding alone is not an edit', () => {
    expect(diffWorkPackageDraft(base, { ...base, subject: '  Fix login bug  ' })).toEqual(
      {}
    )
    expect(diffWorkPackageDraft(base, { ...base, subject: '  Renamed  ' })).toEqual({
      subject: 'Renamed'
    })
  })

  it('reports every field at once without losing the clear/omit distinction', () => {
    const changes = diffWorkPackageDraft(base, {
      subject: 'All of it',
      startDate: '2026-05-01',
      dueDate: '',
      statusId: 9,
      typeId: 7,
      priorityId: 10,
      assigneeId: null
    })
    expect(changes).toEqual({
      subject: 'All of it',
      startDate: '2026-05-01',
      dueDate: null,
      statusId: 9,
      typeId: 7,
      priorityId: 10,
      assigneeId: null
    })
  })

  it('diffs an empty draft too — stage 3 creates against the same function', () => {
    const empty = emptyWorkPackageDraft()
    const changes = diffWorkPackageDraft(empty, {
      ...empty,
      subject: 'Brand new',
      typeId: 1
    })
    expect(changes).toEqual({ subject: 'Brand new', typeId: 1 })
  })
})

describe('workPackageDraftIssue', () => {
  const base = toWorkPackageDraft(wp())

  it('passes a valid draft', () => {
    expect(workPackageDraftIssue(base)).toBeNull()
  })

  it('refuses an empty or whitespace-only subject before the request is made', () => {
    for (const subject of ['', '   ']) {
      expect(workPackageDraftIssue({ ...base, subject })).toBeTruthy()
    }
  })

  it('refuses a subject past the length the main process enforces', () => {
    expect(workPackageDraftIssue({ ...base, subject: 'x'.repeat(255) })).toBeNull()
    expect(workPackageDraftIssue({ ...base, subject: 'x'.repeat(256) })).toBeTruthy()
  })

  it('refuses a date that is not a real calendar day', () => {
    expect(workPackageDraftIssue({ ...base, startDate: '2026-02-31' })).toBeTruthy()
    expect(workPackageDraftIssue({ ...base, dueDate: 'tomorrow' })).toBeTruthy()
    // Empty is not invalid — it is a clear.
    expect(workPackageDraftIssue({ ...base, dueDate: '' })).toBeNull()
  })

  it('refuses a due date before the start date', () => {
    expect(
      workPackageDraftIssue({ ...base, startDate: '2026-03-10', dueDate: '2026-03-01' })
    ).toBeTruthy()
    expect(
      workPackageDraftIssue({ ...base, startDate: '2026-03-10', dueDate: '2026-03-10' })
    ).toBeNull()
  })
})

describe('toFieldOptions', () => {
  it('maps allowed values to select options in the order the server gave them', () => {
    expect(
      toFieldOptions([
        { id: 1, name: 'To Do' },
        { id: 26, name: 'QA Completed' }
      ])
    ).toEqual([
      { label: 'To Do', value: 1 },
      { label: 'QA Completed', value: 26 }
    ])
  })

  it('yields an empty list for an empty allowed-value set', () => {
    expect(toFieldOptions([])).toEqual([])
  })
})

describe('toAssigneeOptions', () => {
  const principals: Principal[] = [
    { id: 88, _type: 'User', name: 'Dana Okonjo' },
    { id: 36, _type: 'User', name: 'Priya Raman' },
    { id: 401, _type: 'Group', name: 'Platform team' }
  ]

  it('always offers "Unassigned" first — clearing must be reachable', () => {
    const options = toAssigneeOptions(principals, null)
    expect(options[0]).toEqual({ label: UNASSIGNED_OPTION_LABEL, value: null })
  })

  /**
   * Only users. The PATCH builds `/api/v3/users/{id}` from a bare number, so it
   * cannot express a group href — offering a group would produce a write the
   * server rejects. The *schema* still accepts groups so the response parses.
   */
  it('offers users only, not groups', () => {
    expect(toAssigneeOptions(principals, null).map((o) => o.value)).toEqual([
      null,
      88,
      36
    ])
  })

  it('keeps the current assignee visible even when the list does not contain them', () => {
    const options = toAssigneeOptions(principals, {
      id: 999,
      title: 'Former member'
    })
    expect(options[1]).toEqual({ label: 'Former member', value: 999 })
    expect(options.map((o) => o.value)).toEqual([null, 999, 88, 36])
  })

  it('does not duplicate the current assignee when they are already listed', () => {
    const options = toAssigneeOptions(principals, { id: 88, title: 'Dana Okonjo' })
    expect(options.filter((o) => o.value === 88)).toHaveLength(1)
  })

  it('labels a current assignee with no title by id rather than dropping them', () => {
    expect(toAssigneeOptions([], { id: 999, title: null })[1]).toEqual({
      label: '#999',
      value: 999
    })
  })

  it('offers just "Unassigned" when the assignee list could not be loaded', () => {
    expect(toAssigneeOptions([], null)).toEqual([
      { label: UNASSIGNED_OPTION_LABEL, value: null }
    ])
  })
})
