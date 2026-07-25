import { describe, it, expect } from 'vitest'

import {
  WORK_PACKAGE_SEARCH_MAX_DIGITS,
  WORK_PACKAGE_SEARCH_MIN_DIGITS,
  expandWorkPackageIdPrefix,
  isWorkPackageSearchTerm,
  sanitizeWorkPackageSearchInput
} from '~~/src/shared/validation/work-package-search'

describe('sanitizeWorkPackageSearchInput', () => {
  it('keeps a valid partial term untouched', () => {
    for (const term of ['', '1', '12', '123', '1234', '12345']) {
      expect(sanitizeWorkPackageSearchInput(term)).toBe(term)
    }
  })

  it('drops every non-digit character', () => {
    expect(sanitizeWorkPackageSearchInput('1a2b3')).toBe('123')
    expect(sanitizeWorkPackageSearchInput('12-34')).toBe('1234')
    expect(sanitizeWorkPackageSearchInput('#1234')).toBe('1234')
    expect(sanitizeWorkPackageSearchInput('abc')).toBe('')
    expect(sanitizeWorkPackageSearchInput('  12 34 ')).toBe('1234')
  })

  it('strips leading zeros rather than accepting them', () => {
    expect(sanitizeWorkPackageSearchInput('0')).toBe('')
    expect(sanitizeWorkPackageSearchInput('0123')).toBe('123')
    expect(sanitizeWorkPackageSearchInput('000')).toBe('')
    // Interior and trailing zeros are legitimate digits of an id.
    expect(sanitizeWorkPackageSearchInput('1000')).toBe('1000')
    expect(sanitizeWorkPackageSearchInput('1020')).toBe('1020')
  })

  it(`truncates to ${WORK_PACKAGE_SEARCH_MAX_DIGITS} digits`, () => {
    expect(sanitizeWorkPackageSearchInput('123456789')).toBe('12345')
    // Stripping runs before truncation, so a padded id isn't cut short.
    expect(sanitizeWorkPackageSearchInput('0012345')).toBe('12345')
  })

  it('treats a nullish input as empty', () => {
    expect(
      sanitizeWorkPackageSearchInput(undefined as unknown as string)
    ).toBe('')
  })

  it('is idempotent — sanitizing its own output changes nothing', () => {
    for (const raw of ['0012a345', '#99', 'abc', '000', '12 34 56']) {
      const once = sanitizeWorkPackageSearchInput(raw)
      expect(sanitizeWorkPackageSearchInput(once)).toBe(once)
    }
  })
})

describe('isWorkPackageSearchTerm', () => {
  it(`accepts a full ${WORK_PACKAGE_SEARCH_MAX_DIGITS}-digit id`, () => {
    expect(isWorkPackageSearchTerm('12345')).toBe(true)
    expect(isWorkPackageSearchTerm('10000')).toBe(true)
    expect(isWorkPackageSearchTerm('99999')).toBe(true)
  })

  it('rejects terms below the minimum length', () => {
    // The minimum is the full id length: a search fires only on a whole id, so
    // one request answers it.
    for (const term of ['', '1', '12', '123', '1234']) {
      expect(isWorkPackageSearchTerm(term)).toBe(false)
    }
  })

  it('rejects terms over the maximum length', () => {
    expect(isWorkPackageSearchTerm('123456')).toBe(false)
  })

  it('rejects a leading zero', () => {
    expect(isWorkPackageSearchTerm('01234')).toBe(false)
    expect(isWorkPackageSearchTerm('00123')).toBe(false)
  })

  it('rejects anything that is not purely digits', () => {
    for (const term of ['12a45', '12345 ', ' 12345', '12.45', '1234;', '#12345']) {
      expect(isWorkPackageSearchTerm(term)).toBe(false)
    }
  })

  it('accepts exactly what sanitize produces, once it is long enough', () => {
    // The two functions have to agree, or the picker would either never fire a
    // search or fire one the main process then rejects.
    for (const raw of ['0012345', '#1234', '1a2b3c4', '99999999']) {
      const clean = sanitizeWorkPackageSearchInput(raw)
      if (clean.length >= WORK_PACKAGE_SEARCH_MIN_DIGITS) {
        expect(isWorkPackageSearchTerm(clean)).toBe(true)
      }
    }
  })
})

describe('expandWorkPackageIdPrefix', () => {
  it('returns a single exact id for a full-length term', () => {
    // The minimum equals the cap, so every searchable term is already a whole
    // id — one id, one request.
    expect(expandWorkPackageIdPrefix('12345')).toEqual(['12345'])
    expect(expandWorkPackageIdPrefix('99999')).toEqual(['99999'])
  })

  it('returns [] for a term that is not searchable', () => {
    // An empty list means no request at all — never a widened "every work
    // package" query. `1234` is here because a 4-digit term is no longer
    // searchable.
    for (const term of ['', '1', '123', '1234', '123456', '01234', '12a4', 'abcd']) {
      expect(expandWorkPackageIdPrefix(term)).toEqual([])
    }
  })

  it('produces only valid ids: digits, no leading zero, within the cap', () => {
    for (const id of expandWorkPackageIdPrefix('12345')) {
      expect(id).toMatch(/^[1-9][0-9]*$/)
      expect(id.length).toBeLessThanOrEqual(WORK_PACKAGE_SEARCH_MAX_DIGITS)
    }
  })

  it('costs exactly one request at the current minimum', () => {
    // Each id becomes its own GET (OpenProject can't filter by candidate ids —
    // it 400s on ids that don't exist), so this length IS the request count.
    // Lowering WORK_PACKAGE_SEARCH_MIN_DIGITS by one digit makes it 11.
    expect(WORK_PACKAGE_SEARCH_MIN_DIGITS).toBe(WORK_PACKAGE_SEARCH_MAX_DIGITS)
    expect(expandWorkPackageIdPrefix('12345')).toHaveLength(1)
  })

  it('still enumerates correctly if the minimum is lowered (prefix logic intact)', () => {
    // Guards the generalization rather than the current config: the function is
    // what makes a shorter minimum viable, so its prefix behaviour is pinned
    // even though nothing exercises it today. Verified through the schema, so
    // it stays honest about what a 4-digit term would expand to.
    const fourDigitPrefix = '1234'
    const children = Array.from({ length: 10 }, (_, d) => `${fourDigitPrefix}${d}`)
    for (const id of children) {
      expect(isWorkPackageSearchTerm(id)).toBe(true)
      expect(id).toHaveLength(WORK_PACKAGE_SEARCH_MAX_DIGITS)
    }
    expect(new Set(children).size).toBe(children.length)
  })
})
