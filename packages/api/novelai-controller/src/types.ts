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
    /** The character-split auxiliary model call failed or returned unusable output. */
    'novelai/split-failed': { readonly message: string }
    /** The reverse-prompt vision call failed or returned unusable output. */
    'novelai/reverse-failed': { readonly message: string }
    /** The generation-directory settings write was refused (no provider, read-only storage, or a failed persist). */
    'novelai/settings-write-failed': { readonly message: string }
    /** The committed workbench panel state could not be persisted under the harness home. */
    'novelai/state-persist-failed': { readonly message: string }
    /** The committed workbench panel state is the bare unseeded shape, refused so it cannot overwrite stored state. */
    'novelai/state-bare-commit': { readonly message: string }
    /** The committed workbench panel state carries no checkpoint, refused so the stored state stays generable. */
    'novelai/state-model-required': { readonly message: string }
    /** An artist-chains mutation carried an empty or over-long name or tags text. */
    'novelai/artist-chain-invalid': { readonly message: string }
    /** An artist-chains save or removal targeted an id that is not stored. */
    'novelai/artist-chain-missing': { readonly id: string }
  }
}

/** Checkpoint, sampler, and schedule catalogs plus the workbench defaults, served by `catalog()`. */
export interface NovelaiCatalogValue {  /** Selectable checkpoints. */
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

/** One per-character caption of a workbench generation request. */
export interface NovelaiCharacterPromptRequest {
  /** The character's own positive prompt. */
  readonly prompt: string
  /** The character's own negative prompt; empty when unset. */
  readonly negativePrompt?: string
  /** Whether the request fixes this character at `(x, y)`. */
  readonly useCoords: boolean
  /** Horizontal placement in the 0–1 image space. */
  readonly x: number
  /** Vertical placement in the 0–1 image space. */
  readonly y: number
}

/** One per-character caption recorded with a completed generation. */
export interface NovelaiCharacterPromptValue {
  /** The character's own positive prompt. */
  readonly prompt: string
  /** The character's own negative prompt; empty when unset. */
  readonly negativePrompt: string
  /** Whether the generation fixed this character at `(x, y)`. */
  readonly useCoords: boolean
  /** Horizontal placement in the 0–1 image space. */
  readonly x: number
  /** Vertical placement in the 0–1 image space. */
  readonly y: number
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
  /** Per-character captions; V4+ checkpoints only, capped at 6 (V4/V4.5) or 32 (V5). */
  readonly characters?: readonly NovelaiCharacterPromptRequest[]
}

/** One enhance (img2img) request: the generation parameters plus the resized source. */
export interface NovelaiEnhanceRequest {
  /** Base64 PNG of the source image, already resized to `width`×`height`. */
  readonly image: string
  /** Output width in pixels; the client resized the source to exactly this. */
  readonly width: number
  /** Output height in pixels; the client resized the source to exactly this. */
  readonly height: number
  /** Positive prompt text; enhancement re-renders the source under this prompt. */
  readonly prompt: string
  /** Negative prompt; the host merges its default when omitted or blank. */
  readonly negativePrompt?: string
  /** Checkpoint id; a workbench default applies when omitted. */
  readonly model?: string
  /** Step count, 1–50. */
  readonly steps?: number
  /** CFG scale, 0–10. */
  readonly cfgScale?: number
  /** Sampler id. */
  readonly sampler?: string
  /** Noise schedule id. */
  readonly noiseSchedule?: string
  /** Denoise strength 0–1; conservative values keep the source pose and composition. */
  readonly strength: number
  /** V5-only official server-side upscaled enhance; forced off for non-V5 checkpoints. */
  readonly upscaledEnhance?: boolean
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
  /** Per-character captions the generation carried, when known. */
  readonly characters?: readonly NovelaiCharacterPromptValue[]
  /** ISO-8601 creation instant. */
  readonly createdAt: string
  /** Estimated Anlas charge; 0 when the entry's parameters are unknown. */
  readonly anlasEstimate: number
}

/** LLM character-split request: one merged prompt to decompose. */
export interface NovelaiSplitCharactersRequest {
  /** The merged prompt text to split. */
  readonly prompt: string
}

/** LLM character-split result: the remaining base prompt plus one entry per character. */
export interface NovelaiSplitCharactersValue {
  /** Prompt text that stays in the base caption (scene, composition, quality). */
  readonly prompt: string
  /** One entry per character, in the order the model found them. */
  readonly characters: readonly NovelaiCharacterPromptValue[]
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

/** One inspect (restore-parameters) request over an imported PNG's raw bytes. */
export interface NovelaiInspectRequest {
  /** Base64 of the original file bytes; the canvas pipeline must not touch them. */
  readonly image: string
}

/** The NovelAI-embedded parameters found in one imported image. */
export interface NovelaiInspectValue {
  /** Whether any NovelAI parameter chunk was found. */
  readonly hasMeta: boolean
  /** Positive prompt from the `Title` chunk. */
  readonly prompt?: string
  /** Negative prompt from the `Description` chunk. */
  readonly negativePrompt?: string
  /** Checkpoint id from the `Comment` JSON, when present. */
  readonly model?: string
  /** Seed from the `Comment` JSON, when present. */
  readonly seed?: number
  /** Step count from the `Comment` JSON, when present. */
  readonly steps?: number
  /** Sampler id from the `Comment` JSON, when present. */
  readonly sampler?: string
  /** CFG scale from the `Comment` JSON, when present. */
  readonly cfgScale?: number
  /** Pixel width declared by the IHDR chunk. */
  readonly width?: number
  /** Pixel height declared by the IHDR chunk. */
  readonly height?: number
  /** Per-character captions of a V4+ structured prompt, in prompt order. */
  readonly characters?: readonly NovelaiCharacterPromptValue[]
}

/** One reverse-prompt (image interrogation) request over an imported image. */
export interface NovelaiReverseRequest {
  /** Base64 PNG of the image, already downscaled by the client for the vision call. */
  readonly image: string
  /** Output style of the reversed prompt. */
  readonly mode: 'tags' | 'natural' | 'mixed'
  /** What part of the image the reverse covers. */
  readonly scope: 'full' | 'character' | 'object' | 'scene'
  /** Optional target/character hint narrowing the reverse. */
  readonly hint?: string
  /** Whether the subject is a known character (identity + appearance variants). */
  readonly knownCharacter: boolean
}

/** The reversed prompt answer. */
export interface NovelaiReverseValue {
  /** The combined (or single) prompt text. */
  readonly prompt: string
  /** Identity-tagged variant, when the known-character mode answered both sections. */
  readonly namePrompt?: string
  /** Appearance-only variant, when the known-character mode answered both sections. */
  readonly featurePrompt?: string
}

/** One committed workbench panel state: the prompt source `novelai_generate` binds to for that session. */
export interface NovelaiWorkbenchState {
  /** Positive prompt, Danbooru-tag style. */
  readonly prompt: string
  /** Negative prompt. */
  readonly negativePrompt: string
  /** Checkpoint id. */
  readonly model: string
  /** Image width in pixels. */
  readonly width: number
  /** Image height in pixels. */
  readonly height: number
  /** Diffusion steps. */
  readonly steps: number
  /** CFG scale. */
  readonly cfgScale: number
  /** Sampler id. */
  readonly sampler: string
  /** Noise schedule id. */
  readonly noiseSchedule: string
  /** Fixed seed; absent means random per run. */
  readonly seed?: number
  /** Structured per-character prompts; absent when the panel has no character cards. */
  readonly characters?: ReadonlyArray<NovelaiCharacterPromptRequest>
  /** Images per generation run, 1–8; absent means 1. */
  readonly batchCount?: number
  /** Seconds between the images of one run, 0–60; absent means the 5-second default. */
  readonly batchIntervalSec?: number
}

/** `commitWorkbenchState` request: the session whose workbench panel committed. */
export interface NovelaiCommitWorkbenchStateRequest {
  /** Session the panel state belongs to. */
  readonly sessionId: string
  /** The committed panel state. */
  readonly state: NovelaiWorkbenchState
}

/** `readWorkbenchState` answer: the latest committed state, absent when none. */
export interface NovelaiReadWorkbenchStateValue {
  /** The latest committed panel state for the session. */
  readonly state?: NovelaiWorkbenchState
}

/** One saved artist chain (画师串) in the workbench's named-chains library. */
export interface NovelaiArtistChain {
  /** Host-assigned opaque id. */
  readonly id: string
  /** The chain's display name; the naming handle the library is organized by. */
  readonly name: string
  /** The whole chain text, stored verbatim (a `weight:artist::` run joined by `', '`). */
  readonly tags: string
}

/** The named artist-chains library, served by every chains verb so the client re-renders from one source. */
export interface NovelaiArtistChainsValue {
  /** All saved chains, newest first. */
  readonly chains: readonly NovelaiArtistChain[]
}

/** `generationDir()` answer: the effective output directory and who supplies it. */
export interface NovelaiGenerationDirValue {
  /** Effective absolute output directory; a relative settings value resolves against the process cwd. */
  readonly dir: string
  /** Whether the saved settings override (not the deployment config) supplies the directory. */
  readonly configured: boolean
}

/** `setGenerationDir` request: the directory override to persist. */
export interface NovelaiSetGenerationDirRequest {
  /** Directory to save; the empty string clears the override so the deployment `outputDir` applies again. */
  readonly dir: string
}
