/** Dictionary tag suggestion ranking (desktop reference parity). */
import { describe, expect, it } from 'vitest'
import { suggestTagsFromDictionary } from '../src/tags.ts'

describe('suggestTagsFromDictionary', () => {
  it('ranks an exact Latin match above partial matches', () => {
    const tags = suggestTagsFromDictionary('solo', 12)
    expect(tags[0]?.tag).toBe('solo')
    expect(tags[0]?.description).toBe('单人画面')
  })

  it('matches Chinese keywords to English tags', () => {
    const tags = suggestTagsFromDictionary('女孩', 12)
    expect(tags.length).toBeGreaterThan(0)
    expect(tags.some(tag => tag.tag === '1girl')).toBe(true)
  })

  it('normalizes underscores in the query', () => {
    const tags = suggestTagsFromDictionary('cat_ears', 12)
    expect(tags[0]?.tag).toBe('cat ears')
  })

  it('places the exact match first and orders ties by post count', () => {
    const tags = suggestTagsFromDictionary('girl', 12)
    expect(tags[0]?.tag).toBe('1girl')
    expect(tags.length).toBeGreaterThan(2)
    expect(tags[1]!.count).toBeGreaterThanOrEqual(tags[2]!.count)
  })

  it('respects the limit and answers empty for a blank query', () => {
    expect(suggestTagsFromDictionary('', 12)).toEqual([])
    expect(suggestTagsFromDictionary('1girl', 1)).toHaveLength(1)
  })
})
