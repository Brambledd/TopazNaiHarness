/**
 * Pure request assembly for the NovelAI image API.
 * @module @deepseek-ai/dsh-tool-novelai/payload
 */

import {
  MAX_NOVELAI_SEED,
  type NovelaiGenerateInput,
  type NovelaiWirePayload,
} from './types.ts'
import { maxCharactersFor } from './types.ts'

/**
 * Negative prompt used when the caller sends none. Extends the official V4+ "Heavy"
 * undesired-content preset with the operator's standing quality/border-defect list,
 * because the API applies presets client-side: it receives only the merged
 * `uc`/`negative_prompt` text.
 */
export const DEFAULT_NEGATIVE_PROMPT =
  'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, '
  + 'jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, '
  + 'multiple views, logo, too many watermarks, negative space, blank page, black border, '
  + 'black bars, letterbox, pillarbox, black edges, empty black space, dark border, frame border, '
  + 'vignette, out of frame, cropped, incomplete composition, black background edges, '
  + 'low quality, blurry, bad hands'

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
    // Structured character captions, mirroring the core payload: the tool
    // input carries no coordinates, so every caption keeps the (0.5, 0.5)
    // AI-choice center sentinel; when any character carries a personal
    // negative, every entry ships one (empty string included).
    const cap = maxCharactersFor(input.model)
    const characters = (input.characters ?? []).slice(0, cap)
    const captions = characters.map(character => ({
      char_caption: character.prompt,
      centers: [{ x: 0.5, y: 0.5 }],
    }))
    const negativeCaptions = characters.some(character => (character.negativePrompt ?? '') !== '')
      ? characters.map(character => ({
        char_caption: character.negativePrompt ?? '',
        centers: [{ x: 0.5, y: 0.5 }],
      }))
      : []
    // The desktop reference writes the flag at the top level as well as inside
    // both structured objects; the API reads the top-level one. The tool input
    // carries no coordinates, so placement always stays AI-chosen.
    parameters.use_coords = false
    // V4/V4.5/V5 require the structured prompt objects; a request without them
    // (or with empty top-level character lists) fails with HTTP 500.
    parameters.v4_prompt = {
      caption: { base_caption: input.prompt, char_captions: captions },
      use_coords: false,
      use_order: true,
    }
    parameters.v4_negative_prompt = {
      caption: { base_caption: input.negativePrompt, char_captions: negativeCaptions },
      use_coords: false,
      use_order: false,
      legacy_uc: false,
    }
  }
  return { input: input.prompt, model: input.model, action: 'generate', parameters }
}

/**
 * Estimate the Anlas charge of one text-to-image request by the official frontend formula.
 *
 * A single image's base cost is capped at 140 Anlas and floored at 2. Active-Opus free
 * generation and reference-image surcharges are out of scope for this tool's requests.
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
 * @param now - wall clock used for the timestamp prefix.
 * @returns the filename stem, e.g. `novelai-1042-3838384747`.
 */
export function generationFileStem(seed: number, now = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  return `novelai-${stamp}-${seed}`
}
