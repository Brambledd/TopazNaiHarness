/**
 * Pure types of the armor domain: the ONE home of the `armor` projection-key
 * declaration, free of this package's host-side value imports.
 *
 * @module @deepseek-ai/dsh-infinite-gen-3/types
 */

// Marks this file a module so the declaration below AUGMENTS the projection
// table instead of declaring an ambient module.
export {}

/**
 * One armor-verdict classification of a completed assistant message, folded
 * from the durable log by the opening-window scorer (see ./armor.ts). The
 * initial state carries `null` — no verdict exists before the first answer.
 */
export type ArmorVerdict = 'pass' | 'refusal' | 'fallback'

/** The `armor` projection's state and wire value (the view is the whole state). */
export interface ArmorProjection {
  /** A user message is queued or a turn is in flight; no verdict yet. */
  running: boolean
  /** Latest scored verdict, or null before the first answer. */
  verdict: ArmorVerdict | null
  /** Opening-window refusal/fallback markers that fired, capped at three. */
  words: string[]
  /** Safe-domain markers hit anywhere in the answer, capped at three. */
  safe: string[]
  /** Risk-domain markers hit anywhere in the answer, capped at three. */
  risk: string[]
  /** The best-scoring request domain of the opening window, or null. */
  domain: string | null
  /** The winning domain's marker hits in the opening window. */
  domainHits: number
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Armor-status verdict for the latest assistant message; see {@link ArmorProjection}. */
    armor: ArmorProjection
  }

  interface SessionProjectionStateMap {
    /** Fold state of the armor unit; identical to its wire view. */
    armor: ArmorProjection
  }
}
