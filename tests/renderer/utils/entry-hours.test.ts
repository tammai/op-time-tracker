import { describe, it, expect } from 'vitest'

import {
  HOURS_MIN,
  clampEntryHours,
  parseTypedHours
} from '~~/src/renderer/src/utils/entry-hours'

/**
 * The regression these cover: a value typed straight into the hours box reached
 * the server above the form's cap. The input bounds its steppers but not
 * typing, so the cap is applied to the typed text as well.
 */

describe('parseTypedHours', () => {
  it('reads a typed number, whole or fractional', () => {
    expect(parseTypedHours('20')).toBe(20)
    expect(parseTypedHours('1.25')).toBe(1.25)
    expect(parseTypedHours(' 8 ')).toBe(8)
  })

  it('tolerates a half-typed decimal', () => {
    // "8." is what the box holds between the point and the next digit.
    expect(parseTypedHours('8.')).toBe(8)
    expect(parseTypedHours('.5')).toBe(0.5)
  })

  it('returns null for anything that is not a number', () => {
    // Null, not 0 — a 0 here would silently rewrite the field to the minimum
    // while the user is still editing it.
    for (const text of ['', '   ', 'abc', '1e3', '-1', '1,5', '8h']) {
      expect(parseTypedHours(text)).toBeNull()
    }
  })
})

describe('clampEntryHours', () => {
  it('caps a value above the maximum', () => {
    expect(clampEntryHours(20, 8)).toBe(8)
    expect(clampEntryHours(8.25, 8)).toBe(8)
  })

  it('raises a value below the minimum', () => {
    expect(clampEntryHours(0, 8)).toBe(HOURS_MIN)
    expect(clampEntryHours(0.1, 8)).toBe(HOURS_MIN)
  })

  it('leaves a value inside the range alone', () => {
    // Including one off the quarter-hour grid: snapping is the input's job, and
    // doing it here too would give two different answers for one edit.
    expect(clampEntryHours(1.3, 8)).toBe(1.3)
    expect(clampEntryHours(8, 8)).toBe(8)
    expect(clampEntryHours(HOURS_MIN, 8)).toBe(HOURS_MIN)
  })

  it('honours the edit-mode maximum, which is looser by design', () => {
    // An entry longer than a working day can already exist; editing its comment
    // must not force a rewrite of its hours.
    expect(clampEntryHours(20, 24)).toBe(20)
    expect(clampEntryHours(30, 24)).toBe(24)
  })
})
