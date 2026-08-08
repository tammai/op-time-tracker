import { describe, it, expect } from 'vitest'

import {
  PrincipalSchema,
  PrincipalCollectionSchema
} from '~~/src/main/schemas/principals'
import assigneesFixture from '~~/tests/fixtures/available-assignees-collection.json'

/**
 * `GET /api/v3/projects/{id}/available_assignees` — the assignee options for a
 * work package.
 *
 * The fixture is a trimmed, anonymised capture of a real response. The live
 * instance returned only `_type: "User"`, but OpenProject also allows `Group`
 * and `PlaceholderUser` as principals, so the schema accepts any `_type`
 * string: one group in the list must not fail the parse and empty the select.
 */
describe('PrincipalSchema', () => {
  it('parses a user principal', () => {
    const user = PrincipalSchema.parse(assigneesFixture._embedded.elements[0])
    expect(user.id).toBe(88)
    expect(user._type).toBe('User')
    expect(user.name).toBe('Dana Okonjo')
    expect(user._links?.self?.href).toBe('/api/v3/users/88')
  })

  it('parses a group principal — a different _type, same shape', () => {
    const group = PrincipalSchema.parse(
      assigneesFixture._embedded.elements.at(-1)
    )
    expect(group._type).toBe('Group')
    expect(group.name).toBe('Platform team')
  })

  it('parses a principal with no _links at all', () => {
    expect(() =>
      PrincipalSchema.parse({ _type: 'User', id: 5, name: 'Nobody' })
    ).not.toThrow()
  })

  it('keeps extra server-added keys without failing (passthrough _links)', () => {
    const parsed = PrincipalSchema.parse({
      _type: 'User',
      id: 5,
      name: 'Nobody',
      avatar: 'https://example.com/a.png',
      _links: {
        self: { href: '/api/v3/users/5' },
        memberships: { href: '/api/v3/memberships' }
      }
    })
    expect(parsed._links?.self?.href).toBe('/api/v3/users/5')
  })

  it('rejects a principal with no usable id or name', () => {
    for (const bad of [
      { _type: 'User', name: 'No id' },
      { _type: 'User', id: '5', name: 'String id' },
      { _type: 'User', id: 5 },
      { _type: 'User', id: 5, name: 5 },
      { id: 5, name: 'No type' }
    ]) {
      expect(PrincipalSchema.safeParse(bad).success).toBe(false)
    }
  })
})

describe('PrincipalCollectionSchema', () => {
  it('parses the realistic collection fixture', () => {
    const col = PrincipalCollectionSchema.parse(assigneesFixture)
    expect(col.total).toBe(5)
    expect(col._embedded.elements).toHaveLength(5)
  })

  it('parses an empty collection — a project with no assignable members', () => {
    const col = PrincipalCollectionSchema.parse({
      _type: 'Collection',
      total: 0,
      count: 0,
      _embedded: { elements: [] }
    })
    expect(col._embedded.elements).toHaveLength(0)
  })

  it('rejects a collection whose elements array has a bad element', () => {
    expect(
      PrincipalCollectionSchema.safeParse({
        ...assigneesFixture,
        _embedded: { elements: [{ _type: 'User', id: 'nope', name: 'x' }] }
      }).success
    ).toBe(false)
  })

  it('rejects a collection missing _embedded', () => {
    const { _embedded: _unused, ...bad } = assigneesFixture
    expect(PrincipalCollectionSchema.safeParse(bad).success).toBe(false)
  })
})
