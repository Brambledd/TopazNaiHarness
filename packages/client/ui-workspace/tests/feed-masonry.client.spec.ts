import { describe, expect, it } from 'vitest'
import { MASONRY_GAP, placeMasonry } from '../src/client/rows/feed-masonry.ts'

/** Uniform heights collapse to left-to-right round-robin (ties go leftmost). */
describe('placeMasonry', () => {
  it('keeps row-major order: uniform heights fill columns left to right', () => {
    // 1520 content width → 6 columns of exactly 240px (256px pitch).
    const layout = placeMasonry(['a', 'b', 'c', 'd', 'e'], new Map([['a', 100], ['b', 100], ['c', 100], ['d', 100], ['e', 100]]), 1520, 208)
    expect(layout.columns).toBe(6)
    expect(layout.columnWidth).toBe(240)
    expect(layout.slots.map(slot => slot.x)).toEqual([0, 256, 512, 768, 1024])
    expect(layout.slots.map(slot => slot.y)).toEqual([0, 0, 0, 0, 0])
  })

  it('places each card into the currently shortest column', () => {
    const layout = placeMasonry(['a', 'b', 'c'], new Map([['a', 300], ['b', 100]]), 496, 208)
    expect(layout.columns).toBe(2)
    expect(layout.columnWidth).toBe(240)
    expect(layout.slots[0]).toMatchObject({ x: 0, y: 0 })
    expect(layout.slots[1]).toMatchObject({ x: 256, y: 0 })
    // Column 0 holds a 300px card, column 1 a 100px card: the third card
    // lands under the shorter one.
    expect(layout.slots[2]).toMatchObject({ x: 256, y: 116 })
    expect(layout.totalHeight).toBe(116 + 208 + MASONRY_GAP - MASONRY_GAP)
  })

  it('uses the fallback height for ids without a measurement', () => {
    const layout = placeMasonry(['a', 'b'], new Map([['a', 100]]), 496, 208)
    // Both columns top at 0: the tie goes leftmost for 'a'; 'b' follows
    // under it only when its fallback height makes column 0 taller.
    expect(layout.slots[0]).toMatchObject({ x: 0, y: 0 })
    expect(layout.slots[1]).toMatchObject({ x: 256, y: 0 })
    const taller = placeMasonry(['a', 'b'], new Map([['a', 100], ['b', 100]]), 496, 208)
    expect(taller.slots[1]).toMatchObject({ x: 256, y: 0 })
    expect(taller.slots).toHaveLength(2)
  })

  it('clamps the column count into [2, 6]', () => {
    expect(placeMasonry(['a'], new Map(), 300, 208).columns).toBe(2)
    expect(placeMasonry(['a'], new Map(), 496, 208).columns).toBe(2)
    expect(placeMasonry(['a'], new Map(), 1680, 208).columns).toBe(6)
    expect(placeMasonry(['a'], new Map(), 4000, 208).columns).toBe(6)
  })

  it('returns an empty layout for no cards or no width', () => {
    expect(placeMasonry([], new Map(), 1680, 208)).toMatchObject({ slots: [], columns: 0, columnWidth: 0, totalHeight: 0 })
    expect(placeMasonry(['a'], new Map(), 0, 208)).toMatchObject({ slots: [], columns: 0, totalHeight: 0 })
  })
})
