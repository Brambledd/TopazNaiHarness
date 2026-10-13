/**
 * The feed wall's masonry placement (the InterKnot VirtualMasonry geometry,
 * minus virtualization — session counts are small). Row-major ordering: the
 * newest card stays top-left, and each next card lands in the currently
 * shortest column, so mixed cover aspect ratios produce the staggered
 * waterfall while reading order sweeps left to right.
 */

/** One placed card: absolute offset in the wall's coordinate space. */
export interface MasonrySlot {
  /** Card id (the session id). */
  id: string
  /** Left offset in px. */
  x: number
  /** Top offset in px. */
  y: number
  /** Column width in px (every card in a row shares it). */
  width: number
}

/** The placement result: per-card slots plus the wall's total height. */
export interface MasonryLayout {
  /** Slot per input id, same order as the input. */
  slots: MasonrySlot[]
  /** Column count after the width clamp. */
  columns: number
  /** Resolved column width in px. */
  columnWidth: number
  /** Wall content height in px (the tallest column). */
  totalHeight: number
}

/** Target column width in px (VirtualMasonry's `columnWidth` default). */
export const MASONRY_TARGET_COLUMN = 240
/** Gap between columns and cards in px (VirtualMasonry's `gap` default). */
export const MASONRY_GAP = 16
/** Lower column-count clamp (VirtualMasonry's `minColumns` default). */
export const MASONRY_MIN_COLUMNS = 2
/** Upper column-count clamp (VirtualMasonry's `maxColumns` default). */
export const MASONRY_MAX_COLUMNS = 6

/**
 * Place one card per id into the shortest column (ties go to the leftmost).
 * Unmeasured ids use `fallbackHeight` (the estimated uniform card height)
 * until their real height arrives from measurement.
 * @param ids - card ids in display order (newest first).
 * @param heights - measured card heights in px; missing ids fall back.
 * @param containerWidth - the wall's content width in px.
 * @param fallbackHeight - height used for ids without a measurement.
 * @returns the slot per card and the wall's total height.
 */
export function placeMasonry(
  ids: readonly string[],
  heights: ReadonlyMap<string, number>,
  containerWidth: number,
  fallbackHeight: number,
): MasonryLayout {
  if (ids.length === 0 || containerWidth <= 0) {
    return { slots: [], columns: 0, columnWidth: 0, totalHeight: 0 }
  }
  const columns = Math.max(
    MASONRY_MIN_COLUMNS,
    Math.min(MASONRY_MAX_COLUMNS, Math.floor((containerWidth + MASONRY_GAP) / (MASONRY_TARGET_COLUMN + MASONRY_GAP))),
  )
  const columnWidth = (containerWidth - (columns - 1) * MASONRY_GAP) / columns
  const columnTops: number[] = Array.from({ length: columns }, () => 0)
  const slots = ids.map((id) => {
    const height = heights.get(id) ?? fallbackHeight
    let shortest = 0
    let shortestTop = columnTops[0] ?? 0
    for (let column = 1; column < columns; column++) {
      const top = columnTops[column] ?? 0
      if (top < shortestTop) {
        shortest = column
        shortestTop = top
      }
    }
    const slot: MasonrySlot = { id, x: shortest * (columnWidth + MASONRY_GAP), y: shortestTop, width: columnWidth }
    columnTops[shortest] = shortestTop + height + MASONRY_GAP
    return slot
  })
  const totalHeight = Math.max(...columnTops) - MASONRY_GAP
  return { slots, columns, columnWidth, totalHeight }
}
