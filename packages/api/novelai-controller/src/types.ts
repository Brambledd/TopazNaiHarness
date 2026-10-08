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

/** Tag suggestion request for workbench prompt autocomplete. */
export interface NovelaiSuggestTagsRequest {
  /** The partial word at the caret, in either language. */
  readonly prompt: string
  /** Checkpoint the suggestions are scoped to; the workbench default applies when omitted. */
  readonly model?: string
}

/** One ranked tag suggestion. */
export interface NovelaiTagSuggestion {
  /** English Danbooru tag in underscore form. */
  readonly tag: string
  /** Post count used for ordering. */
  readonly count: number
  /** Danbooru tag category id. */
  readonly category: number
  /** Human-readable description (Chinese label when known). */
  readonly description: string
}

/** Ranked tag suggestions, best first. */
export interface NovelaiTagSuggestionsValue {
  readonly tags: readonly NovelaiTagSuggestion[]
}

/** Bilingual tag index presence report. */
export interface NovelaiTagIndexStatusValue {
  /** Whether a valid index file is present and above the record floor. */
  readonly downloaded: boolean
  /** Parsed record count (0 when absent or corrupt). */
  readonly count: number
  /** Index file size in bytes (0 when absent). */
  readonly sizeBytes: number
}

/** Tag index download receipt. */
export interface NovelaiDownloadTagIndexValue {
  /** Whether the download succeeded and the file was replaced. */
  readonly ok: boolean
  /** Human-readable outcome. */
  readonly message: string
  /** Parsed record count (0 on failure). */
  readonly count: number
}

/** Library entry content request. */
export interface NovelaiReadEntryRequest {
  /** Library entry id (the filename stem). */
  readonly id: string
}

/** One library entry's PNG bytes, base64-encoded for the JSON remote channel. */
export interface NovelaiEntryContentValue {
  /** Base64-encoded PNG bytes. */
  readonly data: string
  /** Image media type; always `image/png`. */
  readonly mime: 'image/png'
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
