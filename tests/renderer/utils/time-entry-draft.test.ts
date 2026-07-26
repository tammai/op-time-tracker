import { describe, it, expect } from 'vitest'

import type { TimeEntry } from '@opentracker/preload'

import {
  timeEntryCommentText,
  timeEntryHours,
  toTimeEntryDraft
} from '~~/src/renderer/src/utils/time-entry-draft'

/**
 * Build a `TimeEntry` fixture, overriding only what a scenario cares about.
 * `as TimeEntry` mirrors `calendar-aggregation.test.ts`: the helpers under
 * test read a handful of fields, and in production they receive full
 * schema-validated objects.
 */
function makeEntry(overrides: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: 100,
    _type: 'TimeEntry',
    hours: 'PT1H30M',
    spentOn: '2026-07-25',
    createdAt: '2026-07-25T10:00:00Z',
    updatedAt: '2026-07-25T10:00:00Z',
    comment: { format: 'plain', raw: 'Reviewed the redesign spec' },
    _links: {
      self: { href: '/api/v3/time_entries/100' },
      workPackage: { href: '/api/v3/work_packages/42' },
      project: { href: '/api/v3/projects/1' },
      user: { href: '/api/v3/users/1' },
      activity: { href: '/api/v3/time_entries/activities/3' }
    },
    ...overrides
  } as TimeEntry
}

describe('timeEntryCommentText', () => {
  it('reads the raw text of a Formattable comment', () => {
    expect(timeEntryCommentText(makeEntry())).toBe('Reviewed the redesign spec')
  })

  it('accepts a bare string comment', () => {
    expect(timeEntryCommentText(makeEntry({ comment: 'plain text' }))).toBe(
      'plain text'
    )
  })

  it('returns an empty string for a null or absent comment', () => {
    expect(timeEntryCommentText(makeEntry({ comment: null }))).toBe('')
    expect(timeEntryCommentText(makeEntry({ comment: undefined }))).toBe('')
  })
})

describe('timeEntryHours', () => {
  it('converts the ISO duration to decimal hours', () => {
    expect(timeEntryHours(makeEntry({ hours: 'PT2H15M' }))).toBe(2.25)
  })

  it('counts an unreadable duration as 0 rather than throwing', () => {
    // Display-only: the day list shows `0.00h` instead of dropping the row.
    expect(timeEntryHours(makeEntry({ hours: 'not-a-duration' }))).toBe(0)
  })
})

describe('toTimeEntryDraft', () => {
  it('derives the form state from an entry', () => {
    expect(toTimeEntryDraft(makeEntry())).toEqual({
      id: 100,
      workPackageId: 42,
      activityId: 3,
      hours: 1.5,
      comment: 'Reviewed the redesign spec'
    })
  })

  it('leaves activityId undefined when the activity link is missing or unreadable', () => {
    // The form then falls back to the project's default activity — losing the
    // original is better than blocking the edit.
    for (const activity of [
      undefined,
      { href: null },
      { href: '/api/v3/time_entries/activities/abc' }
    ]) {
      const entry = makeEntry({
        _links: { ...makeEntry()._links, activity }
      } as Partial<TimeEntry>)
      expect(toTimeEntryDraft(entry)?.activityId).toBeUndefined()
    }
  })

  it('returns null when the work package href yields no id', () => {
    // No numeric id means the form would have to invent one, and saving would
    // rewrite the entry with it — so the row gets no pencil.
    for (const workPackage of [
      undefined,
      { href: null },
      { href: '/api/v3/work_packages/abc' },
      { href: '/api/v3/work_packages/-1' }
    ]) {
      const entry = makeEntry({
        _links: { ...makeEntry()._links, workPackage }
      } as Partial<TimeEntry>)
      expect(toTimeEntryDraft(entry)).toBeNull()
    }
  })

  it('returns null when the duration is unreadable or zero', () => {
    // Unlike the display path, a 0 here would silently rewrite the entry's
    // hours on save — and the form rejects a non-positive value anyway.
    expect(toTimeEntryDraft(makeEntry({ hours: 'not-a-duration' }))).toBeNull()
    expect(toTimeEntryDraft(makeEntry({ hours: 'PT0S' }))).toBeNull()
  })

  it('carries an empty comment through, so clearing one is expressible', () => {
    expect(toTimeEntryDraft(makeEntry({ comment: null }))?.comment).toBe('')
  })
})
