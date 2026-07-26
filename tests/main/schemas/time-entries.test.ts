import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

import {
  TimeEntrySchema,
  TimeEntryCollectionSchema,
  TimeEntryActivityCollectionSchema,
  TimeEntryFormSchema,
  CreateTimeEntryInputSchema,
  UpdateTimeEntryInputSchema,
  DeleteTimeEntryInputSchema,
  extractActivitiesFromForm
} from '~~/src/main/schemas/time-entries'

// `parseHoursToDecimal` tests moved to `tests/shared/utils/time.test.ts`
// after the helper was moved to `src/shared/utils/time.ts` (task 7).
// `parseActivityIdFromHref` tests likewise moved to
// `tests/shared/utils/hal.test.ts` alongside `parseWorkPackageIdFromHref`.

/**
 * Minimal structural type for the OpenProject Collection fixture JSON. The
 * canonical shape is the Zod `TimeEntryCollectionSchema` (input); this type
 * is only here so TypeScript can follow property accesses in the test
 * bodies. The assertions themselves go through the schema, which is what
 * actually validates the shape.
 */
interface TimeEntryFixture {
  _type: string
  total: number
  count: number
  _embedded: { elements: Record<string, unknown>[] }
}

const fixture = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../../fixtures/time-entries-collection.json', import.meta.url)
    ),
    'utf8'
  )
) as TimeEntryFixture

describe('TimeEntrySchema', () => {
  it('parses a realistic time entry with object comment + extra _links', () => {
    const te = TimeEntrySchema.parse(fixture._embedded.elements[0])
    expect(te.id).toBe(100)
    expect(te._type).toBe('TimeEntry')
    expect(te.hours).toBe('PT1H30M')
    expect(te.spentOn).toBe('2026-01-15')
    expect(te.comment).toEqual({
      format: 'plain',
      raw: 'Fixed the login redirect'
    })
    expect(te._links.workPackage?.title).toBe('Fix login bug')
    expect(te._links.user?.title).toBe('Alice')
    // Extra _links key (`activity`) preserved via .passthrough().
    expect((te._links as Record<string, unknown>).activity).toBeDefined()
  })

  it('parses a time entry with null comment', () => {
    const te = TimeEntrySchema.parse(fixture._embedded.elements[1])
    expect(te.comment).toBeNull()
  })

  it('parses a time entry with a bare-string comment (lenient)', () => {
    const te = TimeEntrySchema.parse(fixture._embedded.elements[2])
    expect(te.comment).toBe('paired review')
  })

  it('rejects a time entry missing the _type literal', () => {
    const bad = { ...fixture._embedded.elements[0], _type: 'NotATimeEntry' }
    expect(() => TimeEntrySchema.parse(bad)).toThrow()
  })

  it('rejects a time entry with a non-string hours', () => {
    const bad = { ...fixture._embedded.elements[0], hours: 1.5 }
    expect(() => TimeEntrySchema.parse(bad)).toThrow()
  })
})

describe('TimeEntryCollectionSchema', () => {
  it('parses the realistic collection fixture', () => {
    const col = TimeEntryCollectionSchema.parse(fixture)
    expect(col._type).toBe('Collection')
    expect(col.total).toBe(3)
    expect(col.count).toBe(3)
    expect(col._embedded.elements).toHaveLength(3)
  })

  it('rejects a collection missing _embedded', () => {
    const { _embedded: _unused, ...bad } = fixture
    expect(() => TimeEntryCollectionSchema.parse(bad)).toThrow()
  })

  it('accepts a collection with any _type string (OpenProject uses typed collections)', () => {
    const typed = { ...fixture, _type: 'TimeEntryCollection' }
    expect(() => TimeEntryCollectionSchema.parse(typed)).not.toThrow()
  })

  it('parses a collection with an empty elements array (zero results)', () => {
    const empty = {
      ...fixture,
      total: 0,
      count: 0,
      _embedded: { elements: [] }
    }
    const col = TimeEntryCollectionSchema.parse(empty)
    expect(col._embedded.elements).toHaveLength(0)
    expect(col.count).toBe(0)
    expect(col.total).toBe(0)
  })

  it('rejects a time entry with a null spentOn (spentOn is required as a string)', () => {
    const bad = { ...fixture._embedded.elements[0], spentOn: null }
    expect(() => TimeEntrySchema.parse(bad)).toThrow()
  })

  it('accepts a time entry whose hours is a malformed duration string (schema only checks it is a string)', () => {
    // The schema validates `hours` is a *string*, not that it is a parseable
    // ISO 8601 duration. `parseHoursToDecimal` runs later in the renderer's
    // aggregation helper, where malformed durations contribute 0. The
    // schema-level contract is therefore: any string passes here.
    const te = TimeEntrySchema.parse({
      ...fixture._embedded.elements[0],
      hours: 'not-a-duration'
    })
    expect(te.hours).toBe('not-a-duration')
  })
})
describe('CreateTimeEntryInputSchema', () => {
  const valid = {
    workPackageId: 42,
    activityId: 3,
    spentOn: '2026-07-25',
    hours: 1.5,
    comment: 'Reviewed the redesign spec'
  }

  it('parses a valid create input', () => {
    const input = CreateTimeEntryInputSchema.parse(valid)
    expect(input.workPackageId).toBe(42)
    expect(input.activityId).toBe(3)
    expect(input.spentOn).toBe('2026-07-25')
    expect(input.hours).toBe(1.5)
    expect(input.comment).toBe('Reviewed the redesign spec')
  })

  it('accepts a missing comment (optional)', () => {
    const { comment: _comment, ...noComment } = valid
    expect(CreateTimeEntryInputSchema.parse(noComment).comment).toBeUndefined()
  })

  it('rejects a non-positive or non-integer workPackageId', () => {
    expect(() =>
      CreateTimeEntryInputSchema.parse({ ...valid, workPackageId: 0 })
    ).toThrow()
    expect(() =>
      CreateTimeEntryInputSchema.parse({ ...valid, workPackageId: -1 })
    ).toThrow()
    expect(() =>
      CreateTimeEntryInputSchema.parse({ ...valid, workPackageId: 1.5 })
    ).toThrow()
  })

  it('rejects a missing activityId (OpenProject requires an activity)', () => {
    const { activityId: _activityId, ...noActivity } = valid
    expect(() => CreateTimeEntryInputSchema.parse(noActivity)).toThrow()
  })

  it('rejects hours outside (0, 24]', () => {
    expect(() => CreateTimeEntryInputSchema.parse({ ...valid, hours: 0 })).toThrow()
    expect(() => CreateTimeEntryInputSchema.parse({ ...valid, hours: -1 })).toThrow()
    expect(() => CreateTimeEntryInputSchema.parse({ ...valid, hours: 24.5 })).toThrow()
    expect(CreateTimeEntryInputSchema.parse({ ...valid, hours: 24 }).hours).toBe(24)
  })

  it('rejects a malformed spentOn', () => {
    for (const spentOn of ['25-07-2026', '2026/07/25', '2026-7-5', 'today', '']) {
      expect(() => CreateTimeEntryInputSchema.parse({ ...valid, spentOn })).toThrow()
    }
  })

  it('rejects a well-formed but non-existent calendar date', () => {
    expect(() =>
      CreateTimeEntryInputSchema.parse({ ...valid, spentOn: '2026-02-31' })
    ).toThrow()
    expect(() =>
      CreateTimeEntryInputSchema.parse({ ...valid, spentOn: '2026-13-01' })
    ).toThrow()
  })

  it('accepts a leap day', () => {
    expect(
      CreateTimeEntryInputSchema.parse({ ...valid, spentOn: '2028-02-29' }).spentOn
    ).toBe('2028-02-29')
  })

  it('rejects an over-long comment', () => {
    expect(() =>
      CreateTimeEntryInputSchema.parse({ ...valid, comment: 'x'.repeat(2001) })
    ).toThrow()
  })
})

describe('UpdateTimeEntryInputSchema', () => {
  const valid = {
    id: 77,
    workPackageId: 42,
    activityId: 3,
    spentOn: '2026-07-25',
    hours: 1.5,
    comment: 'Reviewed the redesign spec'
  }

  it('parses a valid update input', () => {
    expect(UpdateTimeEntryInputSchema.parse(valid)).toEqual(valid)
  })

  it('rejects a missing, non-positive, or non-integer id', () => {
    const { id: _id, ...noId } = valid
    expect(() => UpdateTimeEntryInputSchema.parse(noId)).toThrow()
    for (const id of [0, -1, 1.5, Number.NaN]) {
      expect(() => UpdateTimeEntryInputSchema.parse({ ...valid, id })).toThrow()
    }
  })

  it('rejects a non-numeric id — nothing else may reach the request path', () => {
    for (const id of ['77', '77/../work_packages', true, null]) {
      expect(() => UpdateTimeEntryInputSchema.parse({ ...valid, id })).toThrow()
    }
  })

  it('inherits every create-input rule', () => {
    // Extended from `CreateTimeEntryInputSchema`, so the field rules can't
    // drift between the two writes.
    expect(() =>
      UpdateTimeEntryInputSchema.parse({ ...valid, hours: 25 })
    ).toThrow()
    expect(() =>
      UpdateTimeEntryInputSchema.parse({ ...valid, spentOn: '2026-02-31' })
    ).toThrow()
    expect(() =>
      UpdateTimeEntryInputSchema.parse({ ...valid, workPackageId: 0 })
    ).toThrow()
    expect(() =>
      UpdateTimeEntryInputSchema.parse({ ...valid, comment: 'x'.repeat(2001) })
    ).toThrow()
  })

  it('accepts a missing comment — the client reads that as "clear it"', () => {
    const { comment: _comment, ...noComment } = valid
    expect(UpdateTimeEntryInputSchema.parse(noComment).comment).toBeUndefined()
  })
})

describe('DeleteTimeEntryInputSchema', () => {
  it('parses a positive integer id', () => {
    expect(DeleteTimeEntryInputSchema.parse({ id: 77 }).id).toBe(77)
  })

  it('rejects anything that is not a positive integer id', () => {
    for (const id of [0, -1, 1.5, Number.NaN, '77', null, undefined]) {
      expect(() => DeleteTimeEntryInputSchema.parse({ id })).toThrow()
    }
    expect(() => DeleteTimeEntryInputSchema.parse({})).toThrow()
  })
})

describe('extractActivitiesFromForm', () => {
  it('extracts embedded allowedValues resources', () => {
    const form = TimeEntryFormSchema.parse({
      _type: 'Form',
      _embedded: {
        schema: {
          activity: {
            type: 'TimeEntriesActivity',
            _embedded: {
              allowedValues: [
                { id: 1, _type: 'TimeEntriesActivity', name: 'Management', position: 2 },
                { id: 2, _type: 'TimeEntriesActivity', name: 'Development', default: true }
              ]
            }
          }
        }
      }
    })
    const activities = extractActivitiesFromForm(form)
    expect(activities).toEqual([
      { id: 1, name: 'Management', position: 2 },
      { id: 2, name: 'Development', default: true }
    ])
  })

  it('derives the id from the self href when the resource omits `id`', () => {
    const form = TimeEntryFormSchema.parse({
      _embedded: {
        schema: {
          activity: {
            _embedded: {
              allowedValues: [
                {
                  name: 'Development',
                  _links: { self: { href: '/api/v3/time_entries/activities/9' } }
                }
              ]
            }
          }
        }
      }
    })
    expect(extractActivitiesFromForm(form)).toEqual([{ id: 9, name: 'Development' }])
  })

  it('falls back to _links.allowedValues (href + title)', () => {
    const form = TimeEntryFormSchema.parse({
      _embedded: {
        schema: {
          activity: {
            _links: {
              allowedValues: [
                { href: '/api/v3/time_entries/activities/3', title: 'Development' },
                { href: '/api/v3/time_entries/activities/4', title: 'Support' }
              ]
            }
          }
        }
      }
    })
    expect(extractActivitiesFromForm(form)).toEqual([
      { id: 3, name: 'Development' },
      { id: 4, name: 'Support' }
    ])
  })

  it('prefers embedded resources over links when both are present', () => {
    const form = TimeEntryFormSchema.parse({
      _embedded: {
        schema: {
          activity: {
            _embedded: {
              allowedValues: [{ id: 1, name: 'Embedded' }]
            },
            _links: {
              allowedValues: [
                { href: '/api/v3/time_entries/activities/2', title: 'Linked' }
              ]
            }
          }
        }
      }
    })
    expect(extractActivitiesFromForm(form)).toEqual([{ id: 1, name: 'Embedded' }])
  })

  it('skips malformed entries instead of failing the whole list', () => {
    const form = TimeEntryFormSchema.parse({
      _embedded: {
        schema: {
          activity: {
            _embedded: {
              allowedValues: [
                { id: 1, name: 'Good' },
                { id: 0, name: 'Bad id' },
                { id: 2, name: '   ' },
                { name: 'No id at all' },
                { id: 3, name: 'Also good' },
                { id: 3, name: 'Duplicate id' }
              ]
            }
          }
        }
      }
    })
    expect(extractActivitiesFromForm(form)).toEqual([
      { id: 1, name: 'Good' },
      { id: 3, name: 'Also good' }
    ])
  })

  it('returns an empty list when the form carries no activity property', () => {
    expect(extractActivitiesFromForm(TimeEntryFormSchema.parse({}))).toEqual([])
    expect(
      extractActivitiesFromForm(
        TimeEntryFormSchema.parse({ _embedded: { schema: {} } })
      )
    ).toEqual([])
  })
})

describe('TimeEntryActivityCollectionSchema', () => {
  it('parses the envelope the client builds around extracted activities', () => {
    const col = TimeEntryActivityCollectionSchema.parse({
      _type: 'Collection',
      total: 2,
      count: 2,
      _embedded: {
        elements: [
          { id: 1, name: 'Management' },
          { id: 2, name: 'Development', position: 1, default: true }
        ]
      }
    })
    expect(col.count).toBe(2)
    expect(col._embedded.elements[1].default).toBe(true)
  })

  it('rejects an element missing its name', () => {
    expect(() =>
      TimeEntryActivityCollectionSchema.parse({
        _type: 'Collection',
        total: 1,
        count: 1,
        _embedded: { elements: [{ id: 1 }] }
      })
    ).toThrow()
  })
})
