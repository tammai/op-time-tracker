import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

import {
  WorkPackageSchema,
  WorkPackageCollectionSchema
} from '~~/src/main/schemas/work-packages'

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