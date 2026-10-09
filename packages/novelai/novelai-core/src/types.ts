/**
 * Shared value shapes for the NovelAI image domain.
 * @module @deepseek-ai/dsh-novelai-core
 */

/** The NovelAI image checkpoints this library submits, mirroring the official frontend's current list. */
export const NOVELAI_MODELS = [
  'nai-diffusion-5-full',
  'nai-diffusion-5-curated',
  'nai-diffusion-4-5-full',
  'nai-diffusion-4-5-curated',
  'nai-diffusion-4-full',
  'nai-diffusion-4-curated-preview',
  'nai-diffusion-3',
  'nai-diffusion-furry-3',
] as const

/** One selectable NovelAI checkpoint. */
export type NovelaiModel = (typeof NOVELAI_MODELS)[number]

/** Samplers accepted by the NovelAI image API. */
export const NOVELAI_SAMPLERS = [
  'k_euler',
  'k_euler_ancestral',
  'k_dpmpp_2s_ancestral',
  'k_dpmpp_2m',
  'k_dpmpp_2m_sde',
  'k_dpmpp_3m_sde',
] as const

/** One selectable sampler. */
export type NovelaiSampler = (typeof NOVELAI_SAMPLERS)[number]

/** Noise schedules accepted by the NovelAI image API. */
export const NOVELAI_NOISE_SCHEDULES = ['native', 'karras', 'exponential', 'polyexponential'] as const

/** One selectable noise schedule. */
export type NovelaiNoiseSchedule = (typeof NOVELAI_NOISE_SCHEDULES)[number]

/** Inclusive upper bound of a NovelAI seed (the API rejects anything above `0xffffffff`). */
export const MAX_NOVELAI_SEED = 0xffff_ffff

/** One per-character caption of a V4+ structured prompt. */
export interface NovelaiCharacterInput {
  /** The character's own positive prompt. */
  prompt: string
  /** The character's own negative prompt; empty shares nothing extra. */
  negativePrompt: string
  /** Whether the image fixes this character at `(x, y)`; false leaves placement to the model. */
  useCoords: boolean
  /** Horizontal placement in the 0–1 image space when `useCoords`. */
  x: number
  /** Vertical placement in the 0–1 image space when `useCoords`. */
  y: number
}

/** Canonical text-to-image request after defaults are resolved. */
export interface NovelaiGenerateInput {
  /** Positive prompt; Danbooru-style tags for anime checkpoints. */
  prompt: string
  /** Negative prompt; already merged with the default heavy preset when the caller sent none. */
  negativePrompt: string
  /** Per-character captions; V4+ checkpoints only, capped by the checkpoint generation. */
  characters?: NovelaiCharacterInput[]
  /** Checkpoint to submit. */
  model: NovelaiModel
  /** Image width in pixels, a positive multiple of 64. */
  width: number
  /** Image height in pixels, a positive multiple of 64. */
  height: number
  /** Diffusion step count, 1–50 inclusive. */
  steps: number
  /** Classifier-free-guidance scale, 0–10 inclusive. */
  cfgScale: number
  /** Sampler id. */
  sampler: NovelaiSampler
  /** Noise schedule; V5 requests normalize to `karras` before submission. */
  noiseSchedule: NovelaiNoiseSchedule
  /** Seed, 0–`MAX_NOVELAI_SEED` inclusive. */
  seed: number
}

/** Wire body of `POST /ai/generate-image` (text-to-image, `action: "generate"`). */
export interface NovelaiWirePayload {
  /** Positive prompt text. */
  input: string
  /** Checkpoint id. */
  model: NovelaiModel
  /** Requested action; this library only submits `generate`. */
  action: 'generate'
  /** Generation parameters as the API expects them. */
  parameters: Record<string, unknown>
}

/** Canonical result of one successful generation. */
export interface NovelaiGenerationResult {
  /** Absolute path of the saved PNG. */
  path: string
  /** Size of the saved PNG in bytes. */
  bytes: number
  /** Seed the image was generated with. */
  seed: number
  /** Checkpoint the image was generated with. */
  model: NovelaiModel
  /** Final image width in pixels. */
  width: number
  /** Final image height in pixels. */
  height: number
  /** Final step count. */
  steps: number
  /** Estimated Anlas charge for the request, before any subscription allowance. */
  anlasEstimate: number
}
