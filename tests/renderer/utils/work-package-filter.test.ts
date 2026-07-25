import { describe, it, expect } from 'vitest'

import type { WorkPackage } from '@opentracker/preload'

import {
  PRIMARY_STATUSES,
  PRIMARY_STATUSES_LOWER,
  isPriorityWorkPackage,
  sortByStatusPriority,
  statusRank
} from '~~/src/renderer/src/utils/work-package-filter'

/**
 * Build a minimal `WorkPackage` fixture with only the fields these helpers
 * read (`id`, `subject`, and the `_links` titles). Every other field is
 * unused by the pure helpers, so the `as WorkPackage` cast only satisfies
 * the type check — mirroring how they're called in production with full
 * schema-validated objects.
 */
function makeWp(
  id: number,
  subject: string,
  status?: string,
  type = 'Task',
  project = 'Time Tracker'
): WorkPackage {
  return {
    id,
    _type: 'WorkPackage',
    subject,
    _links: {
      self: { href: `/api/v3/work_packages/${id}` },
      type: { href: '/api/v3/types/1', title: type },
      ...(status === undefined
        ? {}
        : { status: { href: '/api/v3/statuses/1', title: status } }),
      project: { href: '/api/v3/projects/1', title: project }
    }
  } as unknown as WorkPackage
}

describe('PRIMARY_STATUSES', () => {
  it('is the In Progress / To Do pair, mirrored lowercased', () => {
    expect(PRIMARY_STATUSES).toEqual(['In Progress', 'To Do'])
    expect([...PRIMARY_STATUSES_LOWER].sort()).toEqual(['in progress', 'to do'])
  })
})

describe('statusRank', () => {
  it('ranks In Progress before To Do', () => {
    expect(statusRank('In Progress')).toBeLessThan(statusRank('To Do'))
  })
  it('matches case-insensitively', () => {
    expect(statusRank('in progress')).toBe(statusRank('In Progress'))
    expect(statusRank('IN PROGRESS')).toBe(statusRank('In Progress'))
  })
  it('ranks unknown and missing statuses last', () => {
    expect(statusRank('Closed')).toBeGreaterThan(statusRank('To Do'))
    expect(statusRank(undefined)).toBeGreaterThan(statusRank('To Do'))
    expect(statusRank('')).toBeGreaterThan(statusRank('To Do'))
  })
})

describe('isPriorityWorkPackage', () => {
  it('accepts the priority statuses, case-insensitively', () => {
    expect(isPriorityWorkPackage(makeWp(1, 'a', 'In Progress'))).toBe(true)
    expect(isPriorityWorkPackage(makeWp(2, 'b', 'to do'))).toBe(true)
  })
  it('rejects other and missing statuses', () => {
    expect(isPriorityWorkPackage(makeWp(3, 'c', 'Closed'))).toBe(false)
    expect(isPriorityWorkPackage(makeWp(4, 'd', undefined))).toBe(false)
  })
})

describe('sortByStatusPriority', () => {
  it('puts In Progress first, then To Do, then everything else', () => {
    const sorted = sortByStatusPriority([
      makeWp(1, 'closed', 'Closed'),
      makeWp(2, 'todo', 'To Do'),
      makeWp(3, 'wip', 'In Progress')
    ])
    expect(sorted.map((w) => w.id)).toEqual([3, 2, 1])
  })

  it('preserves the server order among equal ranks (stable)', () => {
    const sorted = sortByStatusPriority([
      makeWp(1, 'a', 'To Do'),
      makeWp(2, 'b', 'To Do'),
      makeWp(3, 'c', 'To Do')
    ])
    expect(sorted.map((w) => w.id)).toEqual([1, 2, 3])
  })

  it('returns a new array without mutating the cached input', () => {
    const input = [makeWp(1, 'todo', 'To Do'), makeWp(2, 'wip', 'In Progress')]
    const originalOrder = input.map((w) => w.id)
    const sorted = sortByStatusPriority(input)
    expect(sorted).not.toBe(input)
    expect(input.map((w) => w.id)).toEqual(originalOrder)
  })
})

