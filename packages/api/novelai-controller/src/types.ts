/**
 * Browser-safe request and result vocabulary for the NovelAI Remote namespace.
 * @module @deepseek-ai/dsh-api-novelai-controller/types
 */

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The host has no NovelAI token configured (set `NOVELAI_TOKEN`). */
    'novelai/token-missing': Record<string, never>
    /** The image API rejected or could not complete the paid submission. */
    'novelai/generation-failed': { readonly message: string }
    /** The configured output directory could not be created or read. */
    'novelai/library-unavailable': { readonly path: string }
    /** The requested library entry does not exist or was already removed. */
    'novelai/entry-missing': { readonly id: string }
  }
}

/** Checkpoint, sampler, and schedule catalogs plus the workbench defaults, served by `catalog()`. */
export interface NovelaiCatalogValue {
  /** Selectable checkpoints. */
  readonly models: readonly string[]
  /** Selectable samplers. */
  readonly samplers: readonly string[]
  /** Selectable noise schedules. */
  readonly noiseSchedules: readonly string[]
  /** Inclusive upper bound of a seed. */
  readonly maxSeed: number
  /** Workbench defaults applied when a request omits a parameter. */
  readonly defaults: NovelaiGenerationDefaults
}

/** Parameter defaults applied by the host when a request omits them. */
export interface NovelaiGenerationDefaults {
  readonly model: string
  readonly width: number
  readonly height: number
  readonly steps: number
  readonly cfgScale: number
  readonly sampler: string
  readonly noiseSchedule: string
}

/** Anlas price quote request. */
export interface NovelaiEstimateRequest {
  readonly width: number
  readonly height: number
  readonly steps: number
}

/** Anlas price quote. */
export interface NovelaiEstimateValue {
  readonly anlas: number
}

/** Workbench generation request; every parameter except `prompt` is optional. */
export interface NovelaiGenerateRequest {
  /** Positive prompt text. */
  readonly prompt: string
  /** Negative prompt; the host merges its default when omitted or blank. */
  readonly negativePrompt?: string
  /** Checkpoint id; a workbench default applies when omitted. */
  readonly model?: string
  /** Image width in pixels, a positive multiple of 64. */
  readonly width?: number
  /** Image height in pixels, a positive multiple of 64. */
  readonly height?: number
  /** Step count, 1–50. */
  readonly steps?: number
  /** CFG scale, 0–10. */
  readonly cfgScale?: number
  /** Sampler id. */
  readonly sampler?: string
  /** Noise schedule id. */
  readonly noiseSchedule?: string
  /** Seed; a random seed applies when omitted. */
  readonly seed?: number
}

/** One completed generation, recorded in the shared library. Fields the PNG or index row does not carry stay absent. */
export interface NovelaiGenerationValue {
  /** Library entry id (the filename stem). */
  readonly id: string
  /** Absolute host path of the saved PNG. */
  readonly file: string
  /** PNG size in bytes. */
  readonly bytes: number
  readonly width?: number
  readonly height?: number
  readonly seed?: number
  readonly model?: string
  readonly steps?: number
  readonly prompt?: string
  readonly negativePrompt?: string
  /** ISO-8601 creation instant. */
  readonly createdAt: string
  /** Estimated Anlas charge; 0 when the entry's parameters are unknown. */
  readonly anlasEstimate: number
}

/** Library page request; paging walks newest-first. */
export interface NovelaiHistoryRequest {
  /** Zero-based first entry of the page. */
  readonly offset?: number
  /** Maximum entries in the page. */
  readonly limit?: number
}

/** One library page. */
export interface NovelaiHistoryValue {
  readonly entries: readonly NovelaiGenerationValue[]
  /** Total entries in the library. */
  readonly total: number
}

/** Library entry removal request. */
export interface NovelaiRemoveRequest {
  /** Library entry id (the filename stem). */
  readonly id: string
}

/** Removal receipt. */
export interface NovelaiRemoveValue {
  /** Whether the entry and its file were removed. */
  readonly removed: boolean
}
