import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

import {
  WorkPackageSchema,
  WorkPackageCollectionSchema,
  WorkPackageFormResponseSchema,
  WorkPackageFormSchema,
  WorkPackageFormInputSchema,
  AvailableAssigneesInputSchema,
  UpdateWorkPackageInputSchema,
  buildWorkPackagePatchPayload,
  normalizeWorkPackageForm,
  WORK_PACKAGE_SUBJECT_MAX_LENGTH
} from '~~/src/main/schemas/work-packages'
import formFixture from '~~/tests/fixtures/work-package-form.json'

/**
 * Minimal structural type for the OpenProject Collection fixture JSON. The
 * canonical shape is the Zod `WorkPackageCollectionSchema` (input); this
 * type is only here so TypeScript can follow property accesses in the test
 * bodies. The assertions themselves go through the schema, which is what
 * actually validates the shape.
 */
interface WorkPackageFixture {
  _type: string
  total: number
  count: number
  _embedded: { elements: Record<string, unknown>[] }
}

const fixture = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../../fixtures/work-packages-collection.json', import.meta.url)
    ),
    'utf8'
  )
) as WorkPackageFixture

describe('WorkPackageSchema', () => {
  it('parses a realistic work package with all fields + extra _links keys', () => {
    const wp = WorkPackageSchema.parse(fixture._embedded.elements[0])
    expect(wp.id).toBe(42)
    expect(wp._type).toBe('WorkPackage')
    expect(wp.subject).toBe('Fix login bug')
    expect(wp.startDate).toBe('2026-01-15')
    expect(wp.dueDate).toBe('2026-01-22')
    expect(wp.spentHours).toBe(3.5)
    // HAL link titles are the canonical display strings.
    expect(wp._links.type?.title).toBe('Task')
    expect(wp._links.status?.title).toBe('In Progress')
    expect(wp._links.project?.title).toBe('Backend')
    expect(wp._links.assignee.title).toBe('Alice')
    // Extra _links key (`priority`) preserved via .passthrough().
    expect((wp._links as Record<string, unknown>).priority).toBeDefined()
  })

  it('parses an unassigned work package (empty assignee link, null dates)', () => {
    const wp = WorkPackageSchema.parse(fixture._embedded.elements[1])
    expect(wp.id).toBe(43)
    expect(wp.startDate).toBeNull()
    expect(wp.dueDate).toBeNull()
    expect(wp.spentHours).toBeNull()
    // Empty assignee object defaults to {}.
    expect(wp._links.assignee.href).toBeUndefined()
    expect(wp._links.assignee.title).toBeUndefined()
  })

  /**
   * Shapes a real instance returns that the hand-authored fixture doesn't
   * cover. Each of these previously failed the parse, which failed the whole
   * collection — one unassigned work package in a search result was enough to
   * turn the response into `OPENPROJECT_SCHEMA_FAILED`.
   */
  describe('real-instance link shapes', () => {
    const base = {
      id: 99,
      _type: 'WorkPackage' as const,
      lockVersion: 2,
      subject: 'Search result from another project',
      _links: {
        self: { href: '/api/v3/work_packages/99' },
        status: { href: '/api/v3/statuses/1', title: 'New' }
      }
    }

    it('parses an unassigned work package sent as { href: null }', () => {
      const wp = WorkPackageSchema.parse({
        ...base,
        _links: { ...base._links, assignee: { href: null, title: null } }
      })
      expect(wp._links.assignee.href).toBeNull()
      expect(wp._links.assignee.title).toBeNull()
    })

    it('parses null hrefs on any HAL link, not just assignee', () => {
      const wp = WorkPackageSchema.parse({
        ...base,
        _links: {
          ...base._links,
          type: { href: null, title: null },
          project: { href: null }
        }
      })
      expect(wp._links.type?.href).toBeNull()
      expect(wp._links.project?.href).toBeNull()
    })

    it('parses spentHours as an ISO-8601 duration string', () => {
      expect(
        WorkPackageSchema.parse({ ...base, spentHours: 'PT3H30M' }).spentHours
      ).toBe('PT3H30M')
      // The numeric form still parses — instances differ.
      expect(WorkPackageSchema.parse({ ...base, spentHours: 2.5 }).spentHours).toBe(
        2.5
      )
    })

    it('parses a collection mixing assigned, unassigned, and null-link items', () => {
      const collection = WorkPackageCollectionSchema.parse({
        _type: 'WorkPackageCollection',
        total: 3,
        count: 3,
        _embedded: {
          elements: [
            fixture._embedded.elements[0],
            { ...base, _links: { ...base._links, assignee: { href: null } } },
            { ...base, id: 100, spentHours: 'PT1H' }
          ]
        }
      })
      expect(collection._embedded.elements).toHaveLength(3)
    })
  })

  /**
   * `lockVersion` is required, not optional: OpenProject sends it on every
   * work package, and a PATCH without it is an unconditional overwrite of
   * whatever the server currently holds. Optional here would mean the editor
   * silently degrades to a last-writer-wins save on the one instance that
   * omitted it — a data-loss bug that never surfaces as an error.
   */
  describe('lockVersion', () => {
    it('parses the lockVersion off a real work package', () => {
      expect(WorkPackageSchema.parse(fixture._embedded.elements[0]).lockVersion).toBe(4)
    })

    it('accepts 0 — a work package that has never been edited', () => {
      expect(WorkPackageSchema.parse(fixture._embedded.elements[1]).lockVersion).toBe(0)
    })

    it('rejects a work package with no lockVersion', () => {
      const { lockVersion: _unused, ...bad } = fixture._embedded.elements[0]
      expect(() => WorkPackageSchema.parse(bad)).toThrow()
    })

    it('rejects a non-integer or negative lockVersion', () => {
      for (const lockVersion of ['4', 4.5, -1, null]) {
        expect(() =>
          WorkPackageSchema.parse({ ...fixture._embedded.elements[0], lockVersion })
        ).toThrow()
      }
    })
  })

  it('rejects a work package missing the _type literal', () => {
    const bad = { ...fixture._embedded.elements[0], _type: 'NotAWP' }
    expect(() => WorkPackageSchema.parse(bad)).toThrow()
  })

  it('rejects a work package missing _links', () => {
    const { _links: _unused, ...bad } = fixture._embedded.elements[0]
    expect(() => WorkPackageSchema.parse(bad)).toThrow()
  })

  it('rejects a work package with a non-number id', () => {
    const bad = { ...fixture._embedded.elements[0], id: '42' }
    expect(() => WorkPackageSchema.parse(bad)).toThrow()
  })
})

describe('WorkPackageCollectionSchema', () => {
  it('parses the realistic collection fixture', () => {
    const col = WorkPackageCollectionSchema.parse(fixture)
    expect(col._type).toBe('Collection')
    expect(col.total).toBe(2)
    expect(col.count).toBe(2)
    expect(col._embedded.elements).toHaveLength(2)
    expect(col._embedded.elements[0].id).toBe(42)
  })

  it('rejects a collection missing _embedded', () => {
    const { _embedded: _unused, ...bad } = fixture
    expect(() => WorkPackageCollectionSchema.parse(bad)).toThrow()
  })

  it('accepts a collection with any _type string (OpenProject uses typed collections)', () => {
    const typed = { ...fixture, _type: 'WorkPackageCollection' }
    expect(() => WorkPackageCollectionSchema.parse(typed)).not.toThrow()
  })

  it('rejects a collection whose elements array has a bad element', () => {
    const bad = {
      ...fixture,
      _embedded: {
        elements: [fixture._embedded.elements[0], { id: 'nope' }]
      }
    }
    expect(() => WorkPackageCollectionSchema.parse(bad)).toThrow()
  })

  it('parses a collection with an empty elements array (zero results)', () => {
    const empty = {
      ...fixture,
      total: 0,
      count: 0,
      _embedded: { elements: [] }
    }
    const col = WorkPackageCollectionSchema.parse(empty)
    expect(col._embedded.elements).toHaveLength(0)
    expect(col.count).toBe(0)
    expect(col.total).toBe(0)
  })
})
// ---------------------------------------------------------------------------
// The edit form (`POST /api/v3/work_packages/{id}/form`)
// ---------------------------------------------------------------------------

/**
 * The fixture is a trimmed capture of a **real** response (see PLAN.md,
 * "Verified API shapes"). The spec's guessed shape was wrong twice over, so
 * these tests are anchored on what the instance actually sends.
 */
describe('WorkPackageFormResponseSchema', () => {
  it('parses the real form response', () => {
    const form = WorkPackageFormResponseSchema.parse(formFixture)
    expect(form._embedded?.schema?.status?.writable).toBe(true)
    expect(form._embedded?.schema?.status?._embedded?.allowedValues).toHaveLength(3)
  })

  it('parses a form whose properties carry only the _links form of allowedValues', () => {
    const form = WorkPackageFormResponseSchema.parse({
      _type: 'Form',
      _embedded: {
        schema: {
          status: {
            writable: true,
            _links: { allowedValues: [{ href: '/api/v3/statuses/1', title: 'To Do' }] }
          }
        }
      }
    })
    expect(form._embedded?.schema?.status?._links?.allowedValues).toHaveLength(1)
  })

  it('tolerates a form with no schema at all rather than failing the request', () => {
    expect(() => WorkPackageFormResponseSchema.parse({ _type: 'Form' })).not.toThrow()
  })

  it('rejects a non-object body', () => {
    expect(() => WorkPackageFormResponseSchema.parse('nope')).toThrow()
  })
})

describe('normalizeWorkPackageForm', () => {
  const normalized = () =>
    WorkPackageFormSchema.parse(
      normalizeWorkPackageForm(WorkPackageFormResponseSchema.parse(formFixture))
    )

  it('flattens the three enumerated fields to plain { id, name } lists', () => {
    const form = normalized()
    expect(form.status.allowedValues).toEqual([
      { id: 1, name: 'To Do' },
      { id: 21, name: 'Ready for UAT' },
      { id: 26, name: 'QA Completed' }
    ])
    expect(form.type.allowedValues.map((v) => v.name)).toEqual([
      'Task',
      'User story',
      'Bug',
      'Sub-Task'
    ])
    expect(form.priority.allowedValues.map((v) => v.id)).toEqual([7, 8, 9, 10])
  })

  it('carries `writable` for every editable field', () => {
    const form = normalized()
    for (const key of [
      'subject',
      'startDate',
      'dueDate',
      'status',
      'type',
      'priority',
      'assignee'
    ] as const) {
      expect(form[key].writable).toBe(true)
    }
  })

  it('reports a non-writable field rather than dropping it', () => {
    const form = WorkPackageFormSchema.parse(
      normalizeWorkPackageForm(
        WorkPackageFormResponseSchema.parse({
          _type: 'Form',
          _embedded: {
            schema: {
              // Derived dates on an automatically-scheduled parent: present,
              // but the server will refuse a write to them.
              startDate: { writable: false },
              dueDate: { writable: false }
            }
          }
        })
      )
    )
    expect(form.startDate.writable).toBe(false)
    expect(form.dueDate.writable).toBe(false)
  })

  it('falls back to the _links form of allowedValues, deriving ids from hrefs', () => {
    const form = WorkPackageFormSchema.parse(
      normalizeWorkPackageForm(
        WorkPackageFormResponseSchema.parse({
          _type: 'Form',
          _embedded: {
            schema: {
              status: {
                writable: true,
                _links: {
                  allowedValues: [
                    { href: '/api/v3/statuses/3', title: 'In Progress' },
                    { href: '/api/v3/statuses/9', title: 'Closed' }
                  ]
                }
              }
            }
          }
        })
      )
    )
    expect(form.status.allowedValues).toEqual([
      { id: 3, name: 'In Progress' },
      { id: 9, name: 'Closed' }
    ])
  })

  it('skips allowed values with an unusable id or a blank name, keeping the rest', () => {
    const form = WorkPackageFormSchema.parse(
      normalizeWorkPackageForm(
        WorkPackageFormResponseSchema.parse({
          _type: 'Form',
          _embedded: {
            schema: {
              type: {
                writable: true,
                _embedded: {
                  allowedValues: [
                    { id: 1, name: 'Task' },
                    { id: -3, name: 'Negative' },
                    { id: 4, name: '   ' },
                    { name: 'No id at all' },
                    // Duplicate id — first one wins.
                    { id: 1, name: 'Task (again)' }
                  ]
                }
              }
            }
          }
        })
      )
    )
    expect(form.type.allowedValues).toEqual([{ id: 1, name: 'Task' }])
  })

  it('yields empty allowed values (not a throw) when the schema is missing', () => {
    const form = WorkPackageFormSchema.parse(
      normalizeWorkPackageForm(WorkPackageFormResponseSchema.parse({ _type: 'Form' }))
    )
    expect(form.status.allowedValues).toEqual([])
    // Nothing is known about the field, so it is reported as not writable —
    // a disabled select is honest, an enabled empty one is not.
    expect(form.status.writable).toBe(false)
  })

  it('never emits a value the normalized schema would reject', () => {
    expect(() =>
      WorkPackageFormSchema.parse(
        normalizeWorkPackageForm(
          WorkPackageFormResponseSchema.parse({
            _type: 'Form',
            _embedded: {
              schema: {
                status: {
                  writable: 'yes',
                  _embedded: { allowedValues: [{ id: 'x', name: 5 }] }
                }
              }
            }
          })
        )
      )
    ).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Inputs (renderer → main; an untrusted source)
// ---------------------------------------------------------------------------

describe('WorkPackageFormInputSchema', () => {
  it('accepts a positive id with a non-negative lock version', () => {
    expect(
      WorkPackageFormInputSchema.parse({ workPackageId: 42, lockVersion: 0 })
    ).toEqual({ workPackageId: 42, lockVersion: 0 })
  })

  it('rejects anything that could reach the request path as a non-integer', () => {
    for (const input of [
      { workPackageId: 0, lockVersion: 1 },
      { workPackageId: -1, lockVersion: 1 },
      { workPackageId: 1.5, lockVersion: 1 },
      { workPackageId: '42', lockVersion: 1 },
      { workPackageId: 42, lockVersion: -1 },
      { workPackageId: 42, lockVersion: '1' },
      { workPackageId: 42 }
    ]) {
      expect(WorkPackageFormInputSchema.safeParse(input).success).toBe(false)
    }
  })
})

describe('AvailableAssigneesInputSchema', () => {
  it('accepts a positive project id', () => {
    expect(AvailableAssigneesInputSchema.parse({ projectId: 41 })).toEqual({
      projectId: 41
    })
  })

  it('rejects a non-positive-integer project id', () => {
    for (const projectId of [0, -1, 1.5, '41', null, undefined]) {
      expect(AvailableAssigneesInputSchema.safeParse({ projectId }).success).toBe(false)
    }
  })
})

describe('UpdateWorkPackageInputSchema', () => {
  const base = { id: 42, lockVersion: 4 }

  it('accepts an update carrying nothing but the identity fields', () => {
    expect(UpdateWorkPackageInputSchema.parse(base)).toEqual(base)
  })

  it('accepts every editable field at once', () => {
    const parsed = UpdateWorkPackageInputSchema.parse({
      ...base,
      subject: 'Rewrite the onboarding flow',
      startDate: '2026-03-01',
      dueDate: '2026-03-14',
      statusId: 3,
      typeId: 1,
      priorityId: 8,
      assigneeId: 11
    })
    expect(parsed.subject).toBe('Rewrite the onboarding flow')
    expect(parsed.assigneeId).toBe(11)
  })

  it('accepts an explicit clear on the two nullable fields', () => {
    const parsed = UpdateWorkPackageInputSchema.parse({
      ...base,
      startDate: null,
      dueDate: null,
      assigneeId: null
    })
    expect(parsed.startDate).toBeNull()
    expect(parsed.dueDate).toBeNull()
    expect(parsed.assigneeId).toBeNull()
  })

  it('bounds the subject — it is renderer free text', () => {
    expect(
      UpdateWorkPackageInputSchema.safeParse({
        ...base,
        subject: 'x'.repeat(WORK_PACKAGE_SUBJECT_MAX_LENGTH)
      }).success
    ).toBe(true)
    expect(
      UpdateWorkPackageInputSchema.safeParse({
        ...base,
        subject: 'x'.repeat(WORK_PACKAGE_SUBJECT_MAX_LENGTH + 1)
      }).success
    ).toBe(false)
  })

  it('rejects an empty or whitespace-only subject', () => {
    for (const subject of ['', '   ', '\t\n']) {
      expect(UpdateWorkPackageInputSchema.safeParse({ ...base, subject }).success).toBe(
        false
      )
    }
  })

  it('trims the subject rather than sending the padding', () => {
    expect(
      UpdateWorkPackageInputSchema.parse({ ...base, subject: '  Tidy up  ' }).subject
    ).toBe('Tidy up')
  })

  it('requires dates to be real YYYY-MM-DD calendar days', () => {
    for (const startDate of ['2026-02-31', 'today', '01-01-2026', '2026-1-1', '']) {
      expect(
        UpdateWorkPackageInputSchema.safeParse({ ...base, startDate }).success
      ).toBe(false)
    }
    // 2028 is a leap year; 2026 is not, so `2026-02-29` belongs above.
    expect(
      UpdateWorkPackageInputSchema.safeParse({ ...base, dueDate: '2028-02-29' }).success
    ).toBe(true)
    expect(
      UpdateWorkPackageInputSchema.safeParse({ ...base, dueDate: '2026-02-29' }).success
    ).toBe(false)
  })

  it('rejects a non-positive-integer resource id on any of the four links', () => {
    for (const key of ['statusId', 'typeId', 'priorityId', 'assigneeId'] as const) {
      for (const value of [0, -1, 2.5, '3']) {
        expect(
          UpdateWorkPackageInputSchema.safeParse({ ...base, [key]: value }).success
        ).toBe(false)
      }
    }
  })

  it('refuses to clear a required link — only the assignee is nullable', () => {
    for (const key of ['statusId', 'typeId', 'priorityId'] as const) {
      expect(
        UpdateWorkPackageInputSchema.safeParse({ ...base, [key]: null }).success
      ).toBe(false)
    }
  })

  it('rejects an id or lock version that could not reach a request safely', () => {
    for (const input of [
      { id: 0, lockVersion: 1 },
      { id: -5, lockVersion: 1 },
      { id: 4.2, lockVersion: 1 },
      { id: '42', lockVersion: 1 },
      { id: 42, lockVersion: -1 },
      { id: 42, lockVersion: 1.5 },
      { lockVersion: 1 }
    ]) {
      expect(UpdateWorkPackageInputSchema.safeParse(input).success).toBe(false)
    }
  })
})

/**
 * The clear-vs-omit distinction, which is the whole reason this is a partial
 * update rather than `updateTimeEntry`'s full replacement. Collapsing the two
 * silently wipes data the user never touched.
 */
describe('buildWorkPackagePatchPayload', () => {
  const base = { id: 42, lockVersion: 4 }

  it('sends lockVersion and nothing else when no field changed', () => {
    expect(buildWorkPackagePatchPayload(UpdateWorkPackageInputSchema.parse(base))).toEqual(
      { lockVersion: 4 }
    )
  })

  it('never puts the work package id in the body — it belongs to the path', () => {
    const payload = buildWorkPackagePatchPayload(
      UpdateWorkPackageInputSchema.parse({ ...base, subject: 'New subject' })
    )
    expect(payload).not.toHaveProperty('id')
  })

  it('omits an untouched field entirely', () => {
    const payload = buildWorkPackagePatchPayload(
      UpdateWorkPackageInputSchema.parse({ ...base, subject: 'Only the subject' })
    )
    expect(payload).toEqual({ lockVersion: 4, subject: 'Only the subject' })
    expect(payload).not.toHaveProperty('startDate')
    expect(payload).not.toHaveProperty('dueDate')
    expect(payload).not.toHaveProperty('_links')
  })

  it('sends null for an explicitly cleared date, distinct from omitting it', () => {
    const cleared = buildWorkPackagePatchPayload(
      UpdateWorkPackageInputSchema.parse({ ...base, startDate: null })
    )
    expect(cleared).toEqual({ lockVersion: 4, startDate: null })
    expect(Object.prototype.hasOwnProperty.call(cleared, 'startDate')).toBe(true)

    const untouched = buildWorkPackagePatchPayload(
      UpdateWorkPackageInputSchema.parse(base)
    )
    expect(Object.prototype.hasOwnProperty.call(untouched, 'startDate')).toBe(false)
  })

  it('sends { href: null } for a cleared assignee, and omits it when untouched', () => {
    const cleared = buildWorkPackagePatchPayload(
      UpdateWorkPackageInputSchema.parse({ ...base, assigneeId: null })
    )
    expect(cleared._links).toEqual({ assignee: { href: null } })

    const untouched = buildWorkPackagePatchPayload(
      UpdateWorkPackageInputSchema.parse(base)
    )
    expect(untouched).not.toHaveProperty('_links')
  })

  it('builds every href itself from the validated numeric ids', () => {
    const payload = buildWorkPackagePatchPayload(
      UpdateWorkPackageInputSchema.parse({
        ...base,
        statusId: 3,
        typeId: 1,
        priorityId: 8,
        assigneeId: 11
      })
    )
    expect(payload._links).toEqual({
      status: { href: '/api/v3/statuses/3' },
      type: { href: '/api/v3/types/1' },
      priority: { href: '/api/v3/priorities/8' },
      assignee: { href: '/api/v3/users/11' }
    })
  })

  it('keeps a cleared date distinguishable from a set one in the same payload', () => {
    const payload = buildWorkPackagePatchPayload(
      UpdateWorkPackageInputSchema.parse({
        ...base,
        startDate: '2026-03-01',
        dueDate: null
      })
    )
    expect(payload).toEqual({
      lockVersion: 4,
      startDate: '2026-03-01',
      dueDate: null
    })
  })
})
