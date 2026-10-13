/**
 * Argument resolution for the `novelai_generate` tool: the committed
 * workbench state binds prompt and parameters; call arguments ride along only
 * for the seed and filename.
 * @module @deepseek-ai/dsh-tool-novelai/input
 */
import type { NovelaiWorkbenchState } from '@deepseek-ai/dsh-api-novelai-controller/types'
import type { NovelaiCharacterCaption, NovelaiGenerateInput, NovelaiModel, NovelaiNoiseSchedule, NovelaiSampler } from './types.ts'
import { MAX_NOVELAI_SEED, maxCharactersFor } from './types.ts'
import { DEFAULT_NEGATIVE_PROMPT } from './payload.ts'

/** The session's committed workbench panel state, when the rail is live. */
export type CommittedWorkbench = NovelaiWorkbenchState

/**
 * Model arguments after schema validation, before default resolution. The
 * `characters` array is the one argument that binds even under a live
 * workbench: the model authors the per-character structure at generation
 * time, and the committed panel state carries no characters today.
 */
export interface NovelaiArgs {
  prompt?: string
  negativePrompt?: string
  model?: string
  width?: number
  height?: number
  steps?: number
  cfgScale?: number
  sampler?: string
  noiseSchedule?: string
  seed?: number
  filename?: string
  characters?: NovelaiCharacterCaption[]
}

/**
 * Normalize the call's characters the way the workbench resolution does:
 * trim, drop blank prompts, trim personal negatives, and clamp to the
 * checkpoint's capacity. Empty results stay absent.
 * @param characters - the call's raw character captions.
 * @param model - checkpoint that receives them.
 * @returns the normalized captions, or `undefined` for none.
 */
function resolveCharacters(
  characters: NovelaiArgs['characters'],
  model: NovelaiModel,
): NovelaiCharacterCaption[] | undefined {
  const normalized = (characters ?? [])
    .map(character => ({
      prompt: character.prompt.trim(),
      negativePrompt: (character.negativePrompt ?? '').trim(),
    }))
    .filter(character => character.prompt !== '')
    .slice(0, maxCharactersFor(model))
  return normalized.length === 0 ? undefined : normalized
}

/**
 * Resolve model arguments into the canonical request. A committed workbench
 * state is the binding prompt source (the call's own prompt/parameter
 * arguments are ignored); without one the call must carry its own prompt.
 * The call's `characters` array passes through as-is — it is the model's
 * generation-time structure and is the one argument the committed state does
 * not shadow.
 * @param args - validated model arguments.
 * @param committed - the session's committed workbench state, when present.
 * @returns the canonical generation input with a resolved seed.
 */
export function resolveInput(args: NovelaiArgs, committed: CommittedWorkbench | undefined): NovelaiGenerateInput {
  const source = committed === undefined
    ? {
      prompt: args.prompt,
      negativePrompt: args.negativePrompt,
      model: args.model,
      width: args.width,
      height: args.height,
      steps: args.steps,
      cfgScale: args.cfgScale,
      sampler: args.sampler,
      noiseSchedule: args.noiseSchedule,
    }
    : { ...committed, negativePrompt: committed.negativePrompt === '' ? undefined : committed.negativePrompt }
  if (source.prompt === undefined || source.prompt.trim() === '') {
    throw new Error(
      committed === undefined
        ? 'prompt is required when no workbench panel has committed a prompt for this session'
        : 'the workbench prompt is empty — ask the user to fill the rail panel first',
    )
  }
  const width = source.width ?? 832
  const height = source.height ?? 1216
  if (width % 64 !== 0 || height % 64 !== 0 || width < 64 || width > 3072 || height < 64 || height > 3072) {
    throw new Error(`invalid dimensions: ${width}x${height} (each side must be a multiple of 64 within 64–3072)`)
  }
  const steps = source.steps ?? 28
  if (!Number.isInteger(steps) || steps < 1 || steps > 50) {
    throw new Error(`invalid steps: ${steps} (must be an integer within 1–50)`)
  }
  const cfgScale = source.cfgScale ?? 5
  if (cfgScale < 0 || cfgScale > 10) {
    throw new Error(`invalid cfgScale: ${cfgScale} (must be within 0–10)`)
  }
  const seed = args.seed ?? committed?.seed ?? Math.floor(Math.random() * (MAX_NOVELAI_SEED + 1))
  if (!Number.isInteger(seed) || seed < 0 || seed > MAX_NOVELAI_SEED) {
    throw new Error(`invalid seed: ${seed} (must be an integer within 0–${MAX_NOVELAI_SEED})`)
  }
  const model = (source.model ?? 'nai-diffusion-5-full') as NovelaiModel
  const characters = resolveCharacters(args.characters, model)
  return {
    prompt: source.prompt.trim(),
    negativePrompt: source.negativePrompt?.trim() || DEFAULT_NEGATIVE_PROMPT,
    model,
    width,
    height,
    steps,
    cfgScale,
    sampler: (source.sampler ?? 'k_euler') as NovelaiSampler,
    noiseSchedule: (source.noiseSchedule ?? 'native') as NovelaiNoiseSchedule,
    seed,
    ...(characters === undefined ? {} : { characters }),
  }
}
