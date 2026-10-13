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

/** The enhance run's output target plus the official V5 upscaled-enhance verdict. */
export interface EnhanceTarget {
  /** Output width in pixels, a multiple of 64. */
  width: number
  /** Output height in pixels, a multiple of 64. */
  height: number
  /** Whether the target exceeds the official pixel-area ceiling (run disabled). */
  exceedsLimit: boolean
  /** Whether this is the official V5 server-side upscaled enhance (`upscaled_enhance`). */
  upscaled: boolean
  /** The preview size the run actually delivers (server-side upscale for V5 MAX). */
  displayWidth: number
  displayHeight: number
}

/**
 * Fit one image size into the supported lattice: snap to 64-pixel steps, then
 * shrink proportionally when the pair passes the area ceiling (the desktop
 * reference's `adaptiveNAIImageSize`).
 * @param width - source width in pixels.
 * @param height - source height in pixels.
 * @returns the fitted size.
 */
export function adaptiveFitSize(width: number, height: number): { width: number; height: number } {
  const snap = (value: number): number =>
    Math.max(NAI_MIN_DIMENSION, Math.round(value / NAI_DIMENSION_STEP) * NAI_DIMENSION_STEP)
  const snapped = { width: snap(width), height: snap(height) }
  if (snapped.width * snapped.height <= NAI_MAX_PIXEL_AREA) return snapped
  const factor = Math.sqrt(NAI_MAX_PIXEL_AREA / (snapped.width * snapped.height))
  return {
    width: Math.max(NAI_MIN_DIMENSION, Math.floor((snapped.width * factor) / NAI_DIMENSION_STEP) * NAI_DIMENSION_STEP),
    height: Math.max(NAI_MIN_DIMENSION, Math.floor((snapped.height * factor) / NAI_DIMENSION_STEP) * NAI_DIMENSION_STEP),
  }
}

/** Official Max enhance preview: up to 2×, capped by the generation pixel area. */
function maxEnhancePreview(width: number, height: number): { width: number; height: number } {
  const factor = Math.min(2, Math.sqrt(NAI_MAX_PIXEL_AREA / (width * height)))
  return { width: Math.floor(width * factor), height: Math.floor(height * factor) }
}

/**
 * The enhance output size for one source at one scale (desktop reference
 * parity). `1` keeps the resolution; `2` doubles it and reports the ceiling
 * verdict instead of silently shrinking; `max` is the official V5 server-side
 * upscaled enhance (submits at the fitted source size with
 * `upscaled_enhance`, delivering up to 2×) and, on non-V5 checkpoints, a 2×
 * adaptive fit that stays inside the ceiling.
 * @param sourceWidth - source image width in pixels.
 * @param sourceHeight - source image height in pixels.
 * @param scale - 1, 2, or `max`.
 * @param v5 - whether the checkpoint is V5 (the only family with the official
 *   upscaled-enhance capability).
 * @returns the submission target, the ceiling verdict, and the preview size.
 */
export function enhanceOutputSize(
  sourceWidth: number,
  sourceHeight: number,
  scale: 1 | 2 | 'max',
  v5: boolean,
): EnhanceTarget {
  if (scale === 'max') {
    if (v5) {
      const fitted = adaptiveFitSize(sourceWidth, sourceHeight)
      const preview = maxEnhancePreview(fitted.width, fitted.height)
      return { ...fitted, exceedsLimit: false, upscaled: true, displayWidth: preview.width, displayHeight: preview.height }
    }
    const fitted = adaptiveFitSize(sourceWidth * 2, sourceHeight * 2)
    return { ...fitted, exceedsLimit: false, upscaled: false, displayWidth: fitted.width, displayHeight: fitted.height }
  }
  const snap = (value: number): number =>
    Math.max(NAI_MIN_DIMENSION, Math.round((value * scale) / NAI_DIMENSION_STEP) * NAI_DIMENSION_STEP)
  const width = snap(sourceWidth)
  const height = snap(sourceHeight)
  return {
    width,
    height,
    exceedsLimit: width * height > NAI_MAX_PIXEL_AREA,
    upscaled: false,
    displayWidth: width,
    displayHeight: height,
  }
}

/**
 * The enhance denoise strength for one magnitude knob (desktop reference
 * parity): conservative by default so the source pose and composition survive;
 * capped at 0.48 because higher values behave like a redraw.
 * @param magnitude - the 1–10 knob value.
 * @returns the img2img strength.
 */
export function enhanceStrength(magnitude: number): number {
  return Math.min(0.48, 0.10 + magnitude * 0.034)
}
/** A single side can consume the whole area only when the other side is 64. */
export const NAI_MAX_DIMENSION = NAI_MAX_PIXEL_AREA / NAI_MIN_DIMENSION

/** Pixel tiers, expressed against a 1024² normal canvas as 1 MP. */
export const RESOLUTION_TIERS = [0.4, 1, 1.5, 2, 3] as const
/** Aspect ratios offered by the tier picker. */
export const RESOLUTION_RATIOS = [
  '1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '1:2', '2:1', '1:3', '3:1', '21:9', '9:21',
] as const

/**
 * Area cap of one tier; the 0.4 MP tier uses the official 640² canvas.
 * @param tier - one of {@link RESOLUTION_TIERS}.
 * @returns the tier's pixel cap.
 */
export function tierPixelCap(tier: (typeof RESOLUTION_TIERS)[number]): number {
  return tier === 0.4 ? 409_600 : Math.round(tier * 1024 * 1024)
}

/**
 * Snap one side onto the 64px lattice and clamp it to the legal range.
 * @param value - raw side length, possibly not a finite number.
 * @param fallback - value used when `value` is not finite.
 * @returns the snapped, clamped side length.
 */
export function snapDimension(value: number, fallback = 1024): number {
  const source = Number.isFinite(value) ? value : fallback
  return Math.min(
    NAI_MAX_DIMENSION,
    Math.max(NAI_MIN_DIMENSION, Math.round(source / NAI_DIMENSION_STEP) * NAI_DIMENSION_STEP),
  )
}

/**
 * Largest legal partner side for the given paired dimension.
 * @param paired - the already-committed other side.
 * @returns the largest 64px-lattice partner that keeps the pair under the area cap.
 */
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
 * @param value - raw side length, possibly not a finite number.
 * @param paired - the already-committed other side.
 * @param fallback - value used when `value` is not finite.
 * @returns the snapped side clamped to both the legal range and the area cap.
 */
export function snapDimensionWithinArea(value: number, paired: number, fallback = 1024): number {
  return Math.min(snapDimension(value, fallback), maxDimensionFor(paired))
}

/**
 * Best (width, height) on the 64px lattice for one tier and aspect ratio.
 * @param tier - pixel-tier selector.
 * @param ratio - aspect ratio from {@link RESOLUTION_RATIOS}.
 * @returns the width/height pair closest to the ratio that uses the tier's area.
 */
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

/**
 * Nearest tier whose 80–100% area band contains the pair, or null for custom.
 * @param width - committed image width.
 * @param height - committed image height.
 * @returns the matching tier, or null when no tier band contains the pair.
 */
export function nearestTier(width: number, height: number): (typeof RESOLUTION_TIERS)[number] | null {
  const pixels = width * height
  return RESOLUTION_TIERS.find((t) => {
    const cap = tierPixelCap(t)
    return pixels <= cap && pixels >= cap * 0.8
  }) ?? null
}

/**
 * The exact ratio of the pair when it sits within log tolerance, or null.
 * @param width - committed image width.
 * @param height - committed image height.
 * @returns the matching picker ratio, or null when the pair is custom.
 */
export function nearestRatio(width: number, height: number): (typeof RESOLUTION_RATIOS)[number] | null {
  return RESOLUTION_RATIOS.find((r) => {
    const [w = 0, h = 0] = r.split(':').map(Number)
    return Math.abs(Math.log(width / height / (w / h))) < 0.045
  }) ?? null
}
