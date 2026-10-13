/**
 * Workbench generation pipeline: explicit request resolution, paid submission, and
 * library recording.
 * @module @deepseek-ai/dsh-api-novelai-controller/generation
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  DEFAULT_NEGATIVE_PROMPT,
  buildNovelaiImg2ImgPayload,
  buildNovelaiPayload,
  charactersToPipePrompt,
  estimateAnlas,
  generationFileStem,
  maxNovelaiCharacters,
  readPngSize,
  type NovelaiCharacterInput,
  type NovelaiGenerateInput,
  type NovelaiImg2ImgInput,
  type NovelaiModel,
  type NovelaiNoiseSchedule,
  type NovelaiSampler,
} from '@deepseek-ai/dsh-novelai-core'
import { requestGeneration, resolveProxyUrl } from '@deepseek-ai/dsh-novelai-core/node'
import type {
  NovelaiCharacterPromptValue,
  NovelaiEnhanceRequest,
  NovelaiGenerateRequest,
  NovelaiGenerationValue,
} from './types.ts'

/** Workbench defaults: the Opus-friendly V4.5 profile (832×1216 at 28 steps is free on an active Opus subscription). */
export const NOVELAI_WORKBENCH_DEFAULTS: NovelaiGenerateInput = {
  prompt: '',
  negativePrompt: DEFAULT_NEGATIVE_PROMPT,
  model: 'nai-diffusion-4-5-full',
  width: 832,
  height: 1216,
  steps: 28,
  cfgScale: 5,
  sampler: 'k_euler',
  noiseSchedule: 'native',
  seed: 0,
}

/**
 * Resolve a workbench request against the workbench defaults.
 *
 * This is the single explicit defaulting step: the service applies it before pricing
 * and submission, so every consumer observes one resolved input. An omitted or blank
 * negative prompt falls back to the host default; an omitted seed is randomized.
 * @param request - the browser's partial request.
 * @param randomSeed - source of random seeds; the platform's random applies by default.
 * @returns the fully resolved generation input.
 */
export function resolveGenerationRequest(
  request: NovelaiGenerateRequest,
  randomSeed: () => number = Math.random,
): NovelaiGenerateInput {
  const negativePrompt = request.negativePrompt === undefined || request.negativePrompt.trim() === ''
    ? NOVELAI_WORKBENCH_DEFAULTS.negativePrompt
    : request.negativePrompt
  const model = (request.model ?? NOVELAI_WORKBENCH_DEFAULTS.model) as NovelaiModel
  const characters = resolveCharacters(request.characters, model)
  return {
    prompt: request.prompt,
    negativePrompt,
    ...(characters === undefined ? {} : { characters }),
    model,
    width: request.width ?? NOVELAI_WORKBENCH_DEFAULTS.width,
    height: request.height ?? NOVELAI_WORKBENCH_DEFAULTS.height,
    steps: request.steps ?? NOVELAI_WORKBENCH_DEFAULTS.steps,
    cfgScale: request.cfgScale ?? NOVELAI_WORKBENCH_DEFAULTS.cfgScale,
    sampler: (request.sampler ?? NOVELAI_WORKBENCH_DEFAULTS.sampler) as NovelaiSampler,
    noiseSchedule: (request.noiseSchedule ?? NOVELAI_WORKBENCH_DEFAULTS.noiseSchedule) as NovelaiNoiseSchedule,
    seed: request.seed ?? Math.floor(randomSeed() * 0xffff_ffff),
  }
}

/** Normalize the request's characters: trim, drop empties, clamp coordinates, clamp to the model capacity. */
function resolveCharacters(
  characters: NovelaiGenerateRequest['characters'],
  model: NovelaiModel,
): NovelaiCharacterInput[] | undefined {
  const normalized = (characters ?? [])
    .map(character => ({
      prompt: character.prompt.trim(),
      negativePrompt: (character.negativePrompt ?? '').trim(),
      useCoords: character.useCoords,
      x: Math.min(1, Math.max(0, character.x)),
      y: Math.min(1, Math.max(0, character.y)),
    }))
    .filter(character => character.prompt !== '')
    .slice(0, maxNovelaiCharacters(model))
  return normalized.length === 0 ? undefined : normalized
}

/** Submission dependencies of one generation, injectable for tests. */
export interface GenerationDeps {
  /** NovelAI API token; empty means the host has no token configured. */
  readonly token: string
  /** Explicit proxy URL; empty resolves through the environment. */
  readonly proxyUrl: string
  /** Image API base URL. */
  readonly baseUrl: string
  /** Submission timeout in milliseconds. */
  readonly timeoutMs: number
  /** Configured output directory of the library. */
  readonly outputDir: string
  /** Settle clock: names the PNG's `<YYYY>/<MM>/<DD>` day folders and its creation instant; the current local time applies by default. */
  readonly now?: Date
  /** Submission seam; the paid HTTP client applies by default. */
  readonly submit?: (options: Parameters<typeof requestGeneration>[0]) => Promise<Uint8Array[]>
}

/**
 * Run one workbench generation end to end: resolve, price, submit (once — a failed
 * paid submission is never retried), save the PNG into the output directory, and
 * record it in the library index.
 * @param request - the browser's partial request.
 * @param deps - submission dependencies.
 * @returns the completed generation value as served to the workbench.
 * @throws when no token is configured or the submission fails.
 */
export async function runGeneration(
  request: NovelaiGenerateRequest,
  deps: GenerationDeps,
): Promise<NovelaiGenerationValue> {
  if (deps.token.trim() === '') throw new Error('no NovelAI token configured')
  const input = resolveGenerationRequest(request)
  const submit = deps.submit ?? requestGeneration
  const submitOptions = {
    payload: buildNovelaiPayload(input),
    token: deps.token,
    baseUrl: deps.baseUrl,
    timeoutMs: deps.timeoutMs,
    signal: new AbortController().signal,
    proxyUrl: resolveProxyUrl(deps.proxyUrl),
  }
  let images: Uint8Array[]
  try {
    images = await submit(submitOptions)
  } catch (error) {
    // A 400/422 is a pre-charge validation rejection; desktop reference parity folds
    // the structured captions into one pipe-joined prompt and retries exactly once.
    if (input.characters === undefined || !/HTTP 400 |HTTP 422 /.test(describe(error))) throw error
    const piped: NovelaiGenerateInput = {
      ...input,
      prompt: charactersToPipePrompt(input.prompt, input.characters),
      characters: [],
    }
    images = await submit({
      ...submitOptions,
      payload: buildNovelaiPayload(piped),
      signal: new AbortController().signal,
    })
  }
  return settleGeneration(input, images, deps)
}

/** Save the returned PNG under the local-time `<YYYY>/<MM>/<DD>` day folders and project the completed generation value. */
async function settleGeneration(
  input: NovelaiGenerateInput,
  images: readonly Uint8Array[],
  deps: GenerationDeps,
  delivered?: { width: number; height: number },
): Promise<NovelaiGenerationValue> {
  const png = images[0]
  if (png === undefined) throw new Error('the API answered without an image')
  const now = deps.now ?? new Date()
  const stem = generationFileStem(input.seed)
  const dayDir = join(deps.outputDir, ...localDaySegments(now))
  await mkdir(dayDir, { recursive: true })
  const file = join(dayDir, `${stem}.png`)
  await writeFile(file, png)
  return {
    id: stem,
    file,
    bytes: png.byteLength,
    width: delivered?.width ?? input.width,
    height: delivered?.height ?? input.height,
    seed: input.seed,
    model: input.model,
    steps: input.steps,
    prompt: input.prompt,
    negativePrompt: input.negativePrompt,
    ...(input.characters === undefined ? {} : { characters: toCharacterValues(input.characters) }),
    createdAt: now.toISOString(),
    anlasEstimate: estimateAnlas(input.width, input.height, input.steps),
  }
}

/** Local-time `YYYY`, zero-padded `MM`, and `DD` segments naming one day's folder chain. */
function localDaySegments(now: Date): [year: string, month: string, day: string] {
  return [
    String(now.getFullYear()),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ]
}

/**
 * Run one workbench enhancement end to end: resolve the generation parameters,
 * attach the client-resized source image, submit once (never retried — a paid
 * submission may already have produced an image), and settle into the library
 * exactly like a text-to-image generation.
 * @param request - the browser's enhance request.
 * @param deps - submission dependencies.
 * @returns the completed generation value as served to the workbench.
 * @throws when no token is configured or the submission fails.
 */
export async function runEnhancement(
  request: NovelaiEnhanceRequest,
  deps: GenerationDeps,
): Promise<NovelaiGenerationValue> {
  if (deps.token.trim() === '') throw new Error('no NovelAI token configured')
  const resolved = resolveGenerationRequest(request)
  const input: NovelaiImg2ImgInput = {
    ...resolved,
    image: request.image,
    strength: request.strength,
    // The official upscaled enhance is a V5-only API capability.
    ...(request.upscaledEnhance === true && resolved.model.startsWith('nai-diffusion-5-')
      ? { upscaledEnhance: true }
      : {}),
  }
  const submit = deps.submit ?? requestGeneration
  const images = await submit({
    payload: buildNovelaiImg2ImgPayload(input),
    token: deps.token,
    baseUrl: deps.baseUrl,
    timeoutMs: deps.timeoutMs,
    signal: new AbortController().signal,
    proxyUrl: resolveProxyUrl(deps.proxyUrl),
  })
  // The official upscaled enhance delivers a larger PNG than the submitted
  // request; the library records the delivered pixels (desktop reference
  // parity: `actualImageSize`), while pricing stays at the request size.
  const delivered = input.upscaledEnhance === true ? readPngSize(images[0] ?? new Uint8Array()) : undefined
  return settleGeneration(input, images, deps, delivered)
}

/** Human-readable text of one thrown failure, for status matching. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Project resolved character inputs onto the wire value. */
function toCharacterValues(characters: readonly NovelaiCharacterInput[]): NovelaiCharacterPromptValue[] {
  return characters.map(character => ({
    prompt: character.prompt,
    negativePrompt: character.negativePrompt,
    useCoords: character.useCoords,
    x: character.x,
    y: character.y,
  }))
}
