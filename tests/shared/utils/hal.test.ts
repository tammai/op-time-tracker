import { describe, it, expect } from 'vitest'

import {
  parseActivityIdFromHref,
  parseWorkPackageIdFromHref
} from '~~/src/shared/utils/hal'

// `parseActivityIdFromHref` tests moved here from
// `tests/main/schemas/time-entries.test.ts` when the href parsers moved to
// `src/shared/utils/hal.ts` — the renderer needs them to prefill the edit
// form, and it must not import from `src/main/`.

describe('parseActivityIdFromHref', () => {
  it('parses the id from a canonical activity href', () => {
    expect(parseActivityIdFromHref('/api/v3/time_entries/activities/5')).toBe(5)
  })
  it('tolerates a trailing slash', () => {
    expect(parseActivityIdFromHref('/api/v3/time_entries/activities/12/')).toBe(12)
  })
  it('parses an absolute href', () => {
    expect(
      parseActivityIdFromHref(
        'https://openproject.example.com/api/v3/time_entries/activities/7'
      )
    ).toBe(7)
  })
  it('returns null for a non-numeric or negative segment', () => {
    expect(parseActivityIdFromHref('/api/v3/time_entries/activities/abc')).toBeNull()
    expect(parseActivityIdFromHref('/api/v3/time_entries/activities/-3')).toBeNull()
    expect(parseActivityIdFromHref('/api/v3/time_entries/activities/')).toBeNull()
  })
  it('returns null for an unrelated href', () => {
    expect(parseActivityIdFromHref('/api/v3/statuses/1')).toBeNull()
    expect(parseActivityIdFromHref('')).toBeNull()
  })
})

describe('parseWorkPackageIdFromHref', () => {
  it('parses the id from a canonical work package href', () => {
    expect(parseWorkPackageIdFromHref('/api/v3/work_packages/12345')).toBe(12345)
  })
  it('tolerates a trailing slash', () => {
    expect(parseWorkPackageIdFromHref('/api/v3/work_packages/42/')).toBe(42)
  })
  it('parses an absolute href', () => {
    expect(
      parseWorkPackageIdFromHref(
        'https://openproject.example.com/api/v3/work_packages/7'
      )
    ).toBe(7)
  })
  it('returns null for a non-numeric or negative segment', () => {
    expect(parseWorkPackageIdFromHref('/api/v3/work_packages/abc')).toBeNull()
    expect(parseWorkPackageIdFromHref('/api/v3/work_packages/-3')).toBeNull()
    expect(parseWorkPackageIdFromHref('/api/v3/work_packages/')).toBeNull()
  })
  it('returns null for a sub-resource rather than reading the wrong id', () => {
    // The id must be the last segment — `/12345/activities` is a different
    // resource, and returning 12345 for it would address the wrong thing.
    expect(
      parseWorkPackageIdFromHref('/api/v3/work_packages/12345/activities')
    ).toBeNull()
  })
  it('returns null for an unrelated href', () => {
    expect(parseWorkPackageIdFromHref('/api/v3/time_entries/9')).toBeNull()
    expect(parseWorkPackageIdFromHref('/api/v3/statuses/1')).toBeNull()
    expect(parseWorkPackageIdFromHref('')).toBeNull()
  })
  it('returns null for a non-string href', () => {
    // OpenProject sends an unset link as `{ "href": null }`, so the parsers
    // are handed `null`/`undefined` in practice, not just strings.
    expect(parseWorkPackageIdFromHref(null)).toBeNull()
    expect(parseWorkPackageIdFromHref(undefined)).toBeNull()
    expect(parseWorkPackageIdFromHref(12345)).toBeNull()
  })
  it('does not confuse the two collections', () => {
    // `/api/v3/time_entries/activities/5` ends in a numeric segment too.
    expect(
      parseWorkPackageIdFromHref('/api/v3/time_entries/activities/5')
    ).toBeNull()
    expect(parseActivityIdFromHref('/api/v3/work_packages/5')).toBeNull()
  })
})
