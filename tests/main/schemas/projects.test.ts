import { describe, it, expect } from 'vitest'

import {
  ProjectSchema,
  ProjectCollectionSchema
} from '~~/src/main/schemas/projects'
import projectsFixture from '~~/tests/fixtures/projects-collection.json'

/**
 * The projects collection — the options for the create form's project select.
 *
 * Captured from `GET /api/v3/work_packages/available_projects` on a real
 * instance (PLAN.md, "Verified API shapes — Stage 3"). Same rule as every other
 * schema here: strict on what the UI reads (`id`, `name`), lenient on the rest,
 * because a collection parse is all-or-nothing and one unmodelled attribute
 * would empty the whole select.
 */
describe('ProjectSchema', () => {
  it('parses a real project element, keeping only what the select needs', () => {
    const project = ProjectSchema.parse(projectsFixture._embedded.elements[0])
    expect(project.id).toBe(7)
    expect(project.name).toBe('Backend')
    expect(project.identifier).toBe('backend')
    expect(project.active).toBe(true)
  })

  it('parses a project whose optional attributes are absent', () => {
    const project = ProjectSchema.parse({
      _type: 'Project',
      id: 30,
      name: 'Archive'
    })
    expect(project.id).toBe(30)
    expect(project.identifier).toBeUndefined()
    expect(project.active).toBeUndefined()
  })

  /**
   * `description` and `statusExplanation` are Formattables, `_links` carries a
   * dozen keys we never read, and instances add their own. None of it may fail
   * the parse — this is the case that turns "one odd project" into "no projects
   * at all".
   */
  it('tolerates formattables and unmodelled links rather than rejecting them', () => {
    expect(() =>
      ProjectSchema.parse({
        _type: 'Project',
        id: 12,
        name: 'Design System',
        description: { format: 'markdown', raw: 'x', html: '<p>x</p>' },
        statusExplanation: null,
        someInstanceSpecificField: { nested: [1, 2, 3] },
        _links: {
          self: { href: '/api/v3/projects/12', title: 'Design System' },
          createWorkPackage: {
            href: '/api/v3/projects/12/work_packages/form',
            method: 'post'
          },
          parent: { href: null, title: null }
        }
      })
    ).not.toThrow()
  })

  it('rejects an element with no usable id or name', () => {
    expect(() => ProjectSchema.parse({ _type: 'Project', name: 'No id' })).toThrow()
    expect(() => ProjectSchema.parse({ _type: 'Project', id: 7 })).toThrow()
    expect(() =>
      ProjectSchema.parse({ _type: 'Project', id: '7', name: 'String id' })
    ).toThrow()
  })
})

describe('ProjectCollectionSchema', () => {
  it('parses the fixture collection', () => {
    const collection = ProjectCollectionSchema.parse(projectsFixture)
    expect(collection.total).toBe(3)
    expect(collection.count).toBe(3)
    expect(collection._embedded.elements.map((p) => p.id)).toEqual([7, 12, 30])
  })

  it('accepts a typed collection `_type`', () => {
    const collection = ProjectCollectionSchema.parse({
      ...projectsFixture,
      _type: 'ProjectCollection'
    })
    expect(collection._type).toBe('ProjectCollection')
  })

  it('parses an empty collection — a key that may create nowhere', () => {
    const collection = ProjectCollectionSchema.parse({
      _type: 'Collection',
      total: 0,
      count: 0,
      _embedded: { elements: [] }
    })
    expect(collection._embedded.elements).toEqual([])
  })

  it('rejects a collection whose elements are not projects', () => {
    expect(() =>
      ProjectCollectionSchema.parse({
        _type: 'Collection',
        total: 1,
        count: 1,
        _embedded: { elements: [{ nope: true }] }
      })
    ).toThrow()
  })

  it('rejects a body with no elements array at all', () => {
    expect(() =>
      ProjectCollectionSchema.parse({ _type: 'Collection', total: 0, count: 0 })
    ).toThrow()
  })
})
