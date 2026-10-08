/**
 * Workbench generation pipeline: explicit request resolution, paid submission, and
 * library recording.
 * @module @deepseek-ai/dsh-api-novelai-controller/generation
 */

import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  DEFAULT_NEGATIVE_PROMPT,
  buildNovelaiPayload,
  estimateAnlas,
  generationFileStem,
  type NovelaiGenerateInput,
  type NovelaiModel,
  type NovelaiNoiseSchedule,
  type NovelaiSampler,
} from '@deepseek-ai/dsh-novelai-core'
import { requestGeneration, resolveProxyUrl } from '@deepseek-ai/dsh-novelai-core/node'
import type { NovelaiGenerateRequest, NovelaiGenerationValue } from './types.ts'

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
  return {
    prompt: request.prompt,
    negativePrompt,
    model: (request.model ?? NOVELAI_WORKBENCH_DEFAULTS.model) as NovelaiModel,
    width: request.width ?? NOVELAI_WORKBENCH_DEFAULTS.width,
    height: request.height ?? NOVELAI_WORKBENCH_DEFAULTS.height,
    steps: request.steps ?? NOVELAI_WORKBENCH_DEFAULTS.steps,
    cfgScale: request.cfgScale ?? NOVELAI_WORKBENCH_DEFAULTS.cfgScale,
    sampler: (request.sampler ?? NOVELAI_WORKBENCH_DEFAULTS.sampler) as NovelaiSampler,
    noiseSchedule: (request.noiseSchedule ?? NOVELAI_WORKBENCH_DEFAULTS.noiseSchedule) as NovelaiNoiseSchedule,
    seed: request.seed ?? Math.floor(randomSeed() * 0xffff_ffff),
  }
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
  const images = await submit({
    payload: buildNovelaiPayload(input),
    token: deps.token,
    baseUrl: deps.baseUrl,
    timeoutMs: deps.timeoutMs,
    signal: new AbortController().signal,
    proxyUrl: resolveProxyUrl(deps.proxyUrl),
  })
  const png = images[0]
  if (png === undefined) throw new Error('the API answered without an image')
  const stem = generationFileStem(input.seed)
  const file = join(deps.outputDir, `${stem}.png`)
  await writeFile(file, png)
  return {
    id: stem,
    file,
    bytes: png.byteLength,
    width: input.width,
    height: input.height,
    seed: input.seed,
    model: input.model,
    steps: input.steps,
    prompt: input.prompt,
    negativePrompt: input.negativePrompt,
    createdAt: new Date().toISOString(),
    anlasEstimate: estimateAnlas(input.width, input.height, input.steps),
  }
}
