import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

import {
  StatusSchema,
  StatusCollectionSchema
} from '~~/src/main/schemas/statuses'

/**
 * Minimal structural type for the OpenProject statuses collection fixture
 * JSON. The canonical shape is the Zod `StatusCollectionSchema` (input);
 * this type is only here so TypeScript can follow property accesses in the
 * test bodies. The assertions themselves go through the schema, which is
 * what actually validates the shape.
 */
interface StatusFixture {
  _type: string
  total: number
  count: number
  _embedded: { elements: Record<string, unknown>[] }
}

const fixture = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../../fixtures/statuses-collection.json', import.meta.url)
    ),
    'utf8'
  )
) as StatusFixture

describe('StatusSchema', () => {
  it('parses a realistic status with all fields', () => {
    const status = StatusSchema.parse(fixture._embedded.elements[0])
    expect(status.id).toBe(3)
    expect(status.name).toBe('In Progress')
    expect(status.color).toBe('#3852C6')
    expect(status.isDefault).toBe(false)
    expect(status.isClosed).toBe(false)
  })

  it('parses a status whose color is null (real instances emit null, not absence)', () => {
    // Regression guard: a real OpenProject instance returned `color: null`
    // for statuses with no color, which the original `z.string().optional()`
    // rejected (optional permits absence, not an explicit null).
    const status = StatusSchema.parse(fixture._embedded.elements[1])
    expect(status.id).toBe(7)
    expect(status.name).toBe('To Do')
    expect(status.color).toBeNull()
  })

  it('parses a status with only required fields (id + name)', () => {
    const status = StatusSchema.parse({ id: 1, name: 'New' })
    expect(status.id).toBe(1)
    expect(status.name).toBe('New')
    expect(status.color).toBeUndefined()
    expect(status.isDefault).toBeUndefined()
    expect(status.isClosed).toBeUndefined()
  })

  it('preserves extra keys via .passthrough() (OpenProject may add keys)', () => {
    const status = StatusSchema.parse({
      id: 5,
      name: 'On Hold',
      position: 4,
      defaultDoneRatio: 50
    })
    expect((status as Record<string, unknown>).position).toBe(4)
    expect((status as Record<string, unknown>).defaultDoneRatio).toBe(50)
  })

  it('rejects a status missing the id', () => {
    const { id: _unused, ...bad } = fixture._embedded.elements[0]
    expect(() => StatusSchema.parse(bad)).toThrow()
  })

  it('rejects a status with a non-number id', () => {
    const bad = { ...fixture._embedded.elements[0], id: '3' }
    expect(() => StatusSchema.parse(bad)).toThrow()
  })

  it('rejects a status missing the name', () => {
    const { name: _unused, ...bad } = fixture._embedded.elements[0]
    expect(() => StatusSchema.parse(bad)).toThrow()
  })
})

describe('StatusCollectionSchema', () => {
  it('parses the realistic collection fixture', () => {
    const col = StatusCollectionSchema.parse(fixture)
    expect(col._type).toBe('Collection')
    expect(col.total).toBe(3)
    expect(col.count).toBe(3)
    expect(col._embedded.elements).toHaveLength(3)
    expect(col._embedded.elements[0].id).toBe(3)
    expect(col._embedded.elements[0].name).toBe('In Progress')
  })

  it('rejects a collection missing _embedded', () => {
    const { _embedded: _unused, ...bad } = fixture
    expect(() => StatusCollectionSchema.parse(bad)).toThrow()
  })

  it('accepts a collection with any _type string', () => {
    const typed = { ...fixture, _type: 'StatusCollection' }
    expect(() => StatusCollectionSchema.parse(typed)).not.toThrow()
  })

  it('rejects a collection whose elements array has a bad element', () => {
    const bad = {
      ...fixture,
      _embedded: {
        elements: [fixture._embedded.elements[0], { name: 'no id' }]
      }
    }
    expect(() => StatusCollectionSchema.parse(bad)).toThrow()
  })

  it('parses a collection with an empty elements array (zero results)', () => {
    const empty = {
      ...fixture,
      total: 0,
      count: 0,
      _embedded: { elements: [] }
    }
    const col = StatusCollectionSchema.parse(empty)
    expect(col._embedded.elements).toHaveLength(0)
    expect(col.count).toBe(0)
    expect(col.total).toBe(0)
  })
})