/**
 * Pure request assembly for the NovelAI image API.
 * @module @deepseek-ai/dsh-novelai-core/payload
 */

import {
  MAX_NOVELAI_SEED,
  type NovelaiCharacterInput,
  type NovelaiGenerateInput,
  type NovelaiImg2ImgInput,
  type NovelaiWirePayload,
} from './types.ts'

/**
 * Negative prompt used when the caller sends none. Mirrors the official V4+ "Heavy"
 * undesired-content preset, because the API applies presets client-side: it receives
 * only the merged `uc`/`negative_prompt` text.
 */
export const DEFAULT_NEGATIVE_PROMPT =
  'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, '
  + 'jpeg artifacts, very displeasing, chromatic aberration, multiple views, logo, '
  + 'too many watermarks, blank page'

/** Per-pixel coefficient of the official Anlas base-price formula, ported from NovelAI's frontend. */
const BASE_PIXEL_COEFFICIENT = 2951823174884865e-21
/** Per-pixel-per-step coefficient of the official Anlas base-price formula. */
const STEP_PIXEL_COEFFICIENT = 5753298233447344e-22

/**
 * Report whether the checkpoint is V4 or newer (V4/V4.5/V5 all share the wire-parameter family).
 * @param model - checkpoint id to test.
 * @returns true when the model takes the V4+ parameter set.
 */
export function isV4Plus(model: string): boolean {
  return model.startsWith('nai-diffusion-4-') || model.startsWith('nai-diffusion-5-')
}

/**
 * Report whether the checkpoint accepts structured character captions.
 * @param model - checkpoint id to test.
 * @returns true for every V4+ checkpoint.
 */
export function supportsNovelaiCharacters(model: string): boolean {
  return isV4Plus(model)
}

/**
 * Report the per-request character-caption capacity of one checkpoint.
 * @param model - checkpoint id to test.
 * @returns 32 for V5, 6 for V4/V4.5, 0 for anything older.
 */
export function maxNovelaiCharacters(model: string): number {
  if (model.startsWith('nai-diffusion-5-')) return 32
  return isV4Plus(model) ? 6 : 0
}

/** Fold per-character captions into one pipe-joined prompt (`base | char1 | char2`). */
export function charactersToPipePrompt(prompt: string, characters: readonly NovelaiCharacterInput[]): string {
  if (characters.length === 0) return prompt
  return [prompt, ...characters.map(character => character.prompt.trim())]
    .filter(part => part !== '')
    .join(' | ')
}

/**
 * Assemble the text-to-image wire body.
 *
 * Normalizations ported from the official client: CFG is clamped to 0–10, the seed to
 * 0–`MAX_NOVELAI_SEED`, and V5 requests always submit `noise_schedule: "karras"` because
 * the V5 frontend normalizes every request that way regardless of sampler.
 * @param input - canonical request with defaults already resolved.
 * @returns the JSON body for `POST /ai/generate-image`.
 */
export function buildNovelaiPayload(input: NovelaiGenerateInput): NovelaiWirePayload {
  const scale = Math.min(10, Math.max(0, input.cfgScale))
  const seed = Math.min(MAX_NOVELAI_SEED, Math.max(0, Math.round(input.seed)))
  const v5 = input.model.startsWith('nai-diffusion-5-')
  const noiseSchedule = v5 ? 'karras' as const : input.noiseSchedule
  const parameters: Record<string, unknown> = {
    params_version: 4,
    width: input.width,
    height: input.height,
    scale,
    sampler: input.sampler,
    steps: input.steps,
    n_samples: 1,
    seed,
    noise_schedule: noiseSchedule,
    uc: input.negativePrompt,
    negative_prompt: input.negativePrompt,
    ucPreset: 0,
    uc_preset: 0,
    cfg_rescale: 0,
    legacy: false,
    legacy_v3_extend: false,
    dynamic_thresholding: false,
    skip_cfg_above_sigma: null,
  }
  if (isV4Plus(input.model)) {
    // Structured character captions (desktop reference parity): each character keeps
    // its own caption and, when any character carries one, its own negative caption.
    // The API requires one center per caption even for model-chosen placement — an
    // empty centers array fails with HTTP 500 — so (0.5, 0.5) is the AI-choice sentinel.
    const characters = normalizeCharacters(input)
    const cap = maxNovelaiCharacters(input.model)
    const useCoords = characters.some(character => character.useCoords)
    const captions = characters.slice(0, cap).map(character => ({
      char_caption: character.prompt,
      centers: [{ x: character.useCoords ? clampUnit(character.x) : 0.5, y: character.useCoords ? clampUnit(character.y) : 0.5 }],
    }))
    const negativeCaptions = characters.slice(0, cap).some(character => character.negativePrompt !== '')
      ? characters.slice(0, cap).map(character => ({
        char_caption: character.negativePrompt,
        centers: [{ x: character.useCoords ? clampUnit(character.x) : 0.5, y: character.useCoords ? clampUnit(character.y) : 0.5 }],
      }))
      : []
    // The desktop reference writes the flag at the top level as well as inside
    // both structured objects; the API reads the top-level one.
    parameters.use_coords = useCoords
    // V4/V4.5/V5 require the structured prompt objects; a request without them
    // (or with empty top-level character lists) fails with HTTP 500.
    parameters.v4_prompt = {
      caption: { base_caption: input.prompt, char_captions: captions },
      use_coords: useCoords,
      use_order: true,
    }
    parameters.v4_negative_prompt = {
      caption: { base_caption: input.negativePrompt, char_captions: negativeCaptions },
      use_coords: useCoords,
      use_order: false,
      legacy_uc: false,
    }
  }
  return { input: input.prompt, model: input.model, action: 'generate', parameters }
}

/**
 * Assemble the enhance (img2img) wire body: the text-to-image body with the
 * resized source attached, the denoise strength clamped to 0–1, and the
 * official client's fixed fields (`noise: 0`, a fresh `extra_noise_seed`).
 * @param input - canonical request plus the base64 source.
 * @param random - source of the extra noise seed.
 * @returns the JSON body for `POST /ai/generate-image`.
 */
export function buildNovelaiImg2ImgPayload(
  input: NovelaiImg2ImgInput,
  random: () => number = Math.random,
): NovelaiWirePayload {
  const payload = buildNovelaiPayload(input)
  payload.action = 'img2img'
  payload.parameters.image = input.image
  payload.parameters.strength = Math.min(1, Math.max(0, input.strength))
  payload.parameters.noise = 0
  payload.parameters.extra_noise_seed = input.extraNoiseSeed ?? Math.floor(random() * MAX_NOVELAI_SEED)
  return payload
}

/** Trimmed, coordinate-clamped characters of one request; empty captions drop out. */
function normalizeCharacters(input: NovelaiGenerateInput): NovelaiCharacterInput[] {
  return (input.characters ?? [])
    .map(character => ({
      prompt: character.prompt.trim(),
      negativePrompt: character.negativePrompt.trim(),
      useCoords: character.useCoords,
      x: clampUnit(character.x),
      y: clampUnit(character.y),
    }))
    .filter(character => character.prompt !== '')
}

/** Clamp one placement coordinate into the 0–1 image space. */
function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/**
 * Estimate the Anlas charge of one text-to-image request by the official frontend formula.
 *
 * A single image's base cost is capped at 140 Anlas and floored at 2. Active-Opus free
 * generation and reference-image surcharges are out of scope for this library's requests.
 * @param width - image width in pixels.
 * @param height - image height in pixels.
 * @param steps - diffusion step count.
 * @returns the estimated Anlas amount.
 */
export function estimateAnlas(width: number, height: number, steps: number): number {
  const pixels = Math.max(width * height, 65_536)
  const base = Math.ceil(BASE_PIXEL_COEFFICIENT * pixels + STEP_PIXEL_COEFFICIENT * pixels * steps)
  return Math.min(140, Math.max(2, base))
}

/**
 * Produce a deterministic filename stem for one saved generation.
 * @param seed - seed the image was generated with.
 * @returns the filename stem, e.g. `novelai-1042-3838384747`.
 */
export function generationFileStem(seed: number, now = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  return `novelai-${stamp}-${seed}`
}
