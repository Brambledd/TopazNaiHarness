/**
 * NovelAI workbench resolution math, ported from the desktop reference
 * (`nai-dimensions.ts` + `resolution-tiers.ts`): 64px lattice, the official
 * 3 Mi-pixel area cap, pixel-tier × aspect-ratio picking, and blur-committed
 * dimension normalization.
 */

/** NovelAI generation dimensions move in 64-pixel steps. */
export const NAI_DIMENSION_STEP = 64
/** Smallest selectable side. */
export const NAI_MIN_DIMENSION = 64
/** Official custom-size ceiling: the pair may not exceed 3 Mi pixels. */
export const NAI_MAX_PIXEL_AREA = 3_145_728
/** A single side can consume the whole area only when the other side is 64. */
export const NAI_MAX_DIMENSION = NAI_MAX_PIXEL_AREA / NAI_MIN_DIMENSION

/** Pixel tiers, expressed against a 1024² normal canvas as 1 MP. */
export const RESOLUTION_TIERS = [0.4, 1, 1.5, 2, 3] as const
/** Aspect ratios offered by the tier picker. */
export const RESOLUTION_RATIOS = [
  '1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '1:2', '2:1', '1:3', '3:1', '21:9', '9:21',
] as const

/** Area cap of one tier; the 0.4 MP tier uses the official 640² canvas. */
export function tierPixelCap(tier: (typeof RESOLUTION_TIERS)[number]): number {
  return tier === 0.4 ? 409_600 : Math.round(tier * 1024 * 1024)
}

/** Snap one side onto the 64px lattice and clamp it to the legal range. */
export function snapDimension(value: number, fallback = 1024): number {
  const source = Number.isFinite(value) ? value : fallback
  return Math.min(
    NAI_MAX_DIMENSION,
    Math.max(NAI_MIN_DIMENSION, Math.round(source / NAI_DIMENSION_STEP) * NAI_DIMENSION_STEP),
  )
}

/** Largest legal partner side for the given paired dimension. */
export function maxDimensionFor(paired: number): number {
  const snapped = snapDimension(paired, NAI_MIN_DIMENSION)
  return Math.max(
    NAI_MIN_DIMENSION,
    Math.floor(NAI_MAX_PIXEL_AREA / snapped / NAI_DIMENSION_STEP) * NAI_DIMENSION_STEP,
  )
}

/**
 * Commit one completed dimension field under the area cap. Callers invoke this
 * on blur or Enter, never per keystroke (desktop parity).
 */
export function snapDimensionWithinArea(value: number, paired: number, fallback = 1024): number {
  return Math.min(snapDimension(value, fallback), maxDimensionFor(paired))
}

/** Best (width, height) on the 64px lattice for one tier and aspect ratio. */
export function resolutionForTier(
  tier: (typeof RESOLUTION_TIERS)[number],
  ratio: (typeof RESOLUTION_RATIOS)[number],
): { width: number; height: number } {
  const [ratioWidth = 0, ratioHeight = 0] = ratio.split(':').map(Number)
  const aspect = ratioWidth / ratioHeight
  if (!Number.isFinite(aspect) || aspect <= 0) throw new Error('Invalid aspect ratio')
  const cap = tierPixelCap(tier)
  let best = { width: 64, height: 64 }
  let score = Infinity
  for (let width = 64; width <= cap / 64; width += 64) {
    const ideal = width / aspect
    const candidates = [
      Math.floor(ideal / 64) * 64,
      Math.ceil(ideal / 64) * 64,
      Math.floor(cap / width / 64) * 64,
      Math.floor((ideal * Math.exp(0.079)) / 64) * 64,
      Math.ceil((ideal * Math.exp(-0.079)) / 64) * 64,
    ]
    for (const height of candidates) {
      if (height < 64 || width * height > cap) continue
      const ratioError = Math.abs(Math.log(width / height / aspect))
      const usable = width * height >= cap * 0.8 && ratioError < 0.08
      const error = (usable ? 0 : 100) + 4 * ratioError + Math.abs(Math.log((width * height) / cap))
      if (error < score) {
        score = error
        best = { width, height }
      }
    }
  }
  return best
}

/** Nearest tier whose 80–100% area band contains the pair, or null for custom. */
export function nearestTier(width: number, height: number): (typeof RESOLUTION_TIERS)[number] | null {
  const pixels = width * height
  return RESOLUTION_TIERS.find((t) => {
    const cap = tierPixelCap(t)
    return pixels <= cap && pixels >= cap * 0.8
  }) ?? null
}

/** The exact ratio of the pair when it sits within log tolerance, or null. */
export function nearestRatio(width: number, height: number): (typeof RESOLUTION_RATIOS)[number] | null {
  return RESOLUTION_RATIOS.find((r) => {
    const [w = 0, h = 0] = r.split(':').map(Number)
    return Math.abs(Math.log(width / height / (w / h))) < 0.045
  }) ?? null
}
