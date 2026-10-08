/**
 * Model-facing NovelAI text-to-image tool: submits one paid generation per call and saves
 * the returned PNG into the configured output directory.
 * @module @deepseek-ai/dsh-tool-novelai
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { AttachmentStore, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import {
  MAX_NOVELAI_SEED,
  NOVELAI_MODELS,
  NOVELAI_NOISE_SCHEDULES,
  NOVELAI_SAMPLERS,
  type NovelaiModel,
  type NovelaiGenerateInput,
  type NovelaiNoiseSchedule,
  type NovelaiSampler,
} from './types.ts'
import { DEFAULT_NEGATIVE_PROMPT, buildNovelaiPayload, estimateAnlas, generationFileStem } from './payload.ts'
import { requestGeneration, resolveProxyUrl } from './client.ts'

export const name = 'tool-novelai'
export const inject = ['tools']

/** Model-facing NovelAI tool configuration. */
export interface Config {
  /** Persistent API token; falls back to `NOVELAI_TOKEN` when empty. */
  token: string
  /** Image API base URL. */
  imageBaseUrl: string
  /** Directory the generated PNGs are written to; relative paths resolve against the process working directory. */
  outputDir: string
  /** Per-request timeout in milliseconds. */
  timeoutMs: number
  /** HTTP(S) proxy URL for reaching the NovelAI API, e.g. `http://127.0.0.1:7890`; empty defers to `NOVELAI_PROXY`/`HTTPS_PROXY` environment variables, unset means a direct connection. */
  proxyUrl: string
}

/** Schemastery configuration for the NovelAI tool consumer. */
export const Config: z<Config> = z.object({
  token: z.string().default(''),
  imageBaseUrl: z.string().default('https://image.novelai.net'),
  outputDir: z.string().default('workspace/novelai'),
  timeoutMs: z.number().default(180_000),
  proxyUrl: z.string().default(''),
})

const DESCRIPTION =
  'Generate one anime-style image through the NovelAI image API and save it as a PNG. '
  + 'Write the prompt in Danbooru-tag style (e.g. "1girl, solo, blue hair, white dress, garden, sunlight"). '
  + 'Every call is PAID (Anlas): batch and iterate deliberately, never in a loop. '
  + 'The result reports the saved file path and the seed, so a follow-up can vary one element '
  + 'while keeping the rest identical by reusing that seed.'

/** Model arguments after schema validation, before default resolution. */
interface NovelaiArgs {
  prompt: string
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
}

/**
 * Resolve model arguments into the canonical request: apply defaults and reject values the
 * schema cannot express (non-64-multiple dimensions, out-of-range steps, a filename that
 * escapes the output directory).
 * @param args - validated model arguments.
 * @returns the canonical generation input with a resolved seed.
 */
function resolveInput(args: NovelaiArgs): NovelaiGenerateInput {
  const width = args.width ?? 832
  const height = args.height ?? 1216
  if (width % 64 !== 0 || height % 64 !== 0 || width < 64 || width > 3072 || height < 64 || height > 3072) {
    throw new Error(`invalid dimensions: ${width}x${height} (each side must be a multiple of 64 within 64–3072)`)
  }
  const steps = args.steps ?? 28
  if (!Number.isInteger(steps) || steps < 1 || steps > 50) {
    throw new Error(`invalid steps: ${steps} (must be an integer within 1–50)`)
  }
  const cfgScale = args.cfgScale ?? 5
  if (cfgScale < 0 || cfgScale > 10) {
    throw new Error(`invalid cfgScale: ${cfgScale} (must be within 0–10)`)
  }
  const seed = args.seed ?? Math.floor(Math.random() * (MAX_NOVELAI_SEED + 1))
  if (!Number.isInteger(seed) || seed < 0 || seed > MAX_NOVELAI_SEED) {
    throw new Error(`invalid seed: ${seed} (must be an integer within 0–${MAX_NOVELAI_SEED})`)
  }
  return {
    prompt: args.prompt.trim(),
    negativePrompt: args.negativePrompt?.trim() || DEFAULT_NEGATIVE_PROMPT,
    model: (args.model ?? 'nai-diffusion-4-5-full') as NovelaiModel,
    width,
    height,
    steps,
    cfgScale,
    sampler: (args.sampler ?? 'k_euler') as NovelaiSampler,
    noiseSchedule: (args.noiseSchedule ?? 'native') as NovelaiNoiseSchedule,
    seed,
  }
}

/**
 * Sanitize a caller-supplied filename into a safe stem inside the output directory.
 * @param filename - caller-supplied name; `..`, separators, and non-word characters are rejected.
 * @returns the accepted stem.
 */
function safeFileStem(filename: string): string {
  if (!/^[\w][\w.-]{0,120}$/.test(filename)) {
    throw new Error(`invalid filename: ${JSON.stringify(filename)} (use letters, digits, dot, dash, underscore; no path separators)`)
  }
  return filename.replace(/\.(png|jpe?g|webp)$/i, '')
}

/**
 * Register the `novelai_generate` tool on `ctx.tools`.
 * @param ctx - registrant context carrying the tool registry.
 * @param config - deployment configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const outputDir = isAbsolute(config.outputDir) ? config.outputDir : resolve(config.outputDir)
  ctx.tools.register(defineTool({
    name: 'novelai_generate',
    description: DESCRIPTION,
    parameters: {
      prompt: { type: 'string', required: true, description: 'Positive prompt, Danbooru-tag style.' },
      negativePrompt: { type: 'string', description: 'Negative prompt; defaults to the official heavy undesired-content preset.' },
      model: { type: 'string', enum: [...NOVELAI_MODELS], description: 'Checkpoint; defaults to nai-diffusion-4-5-full.' },
      width: { type: 'integer', description: 'Width in pixels, multiple of 64; defaults to 832.' },
      height: { type: 'integer', description: 'Height in pixels, multiple of 64; defaults to 1216.' },
      steps: { type: 'integer', description: 'Diffusion steps, 1–50; defaults to 28.' },
      cfgScale: { type: 'number', description: 'CFG scale, 0–10; defaults to 5.' },
      sampler: { type: 'string', enum: [...NOVELAI_SAMPLERS], description: 'Sampler; defaults to k_euler.' },
      noiseSchedule: { type: 'string', enum: [...NOVELAI_NOISE_SCHEDULES], description: 'Noise schedule; V5 always submits karras.' },
      seed: { type: 'integer', description: 'Seed, 0–4294967295; defaults to random. Reuse it to vary one element of a liked image.' },
      filename: { type: 'string', description: 'Output file stem without extension; defaults to a timestamp-plus-seed name.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          bytes: { type: 'integer', required: true },
          seed: { type: 'integer', required: true },
          model: { type: 'string', required: true },
          width: { type: 'integer', required: true },
          height: { type: 'integer', required: true },
          steps: { type: 'integer', required: true },
          anlasEstimate: { type: 'integer', required: true },
          attachment: {
            type: 'object',
            additionalProperties: true,
            properties: {
              attachmentId: { type: 'string', required: true },
              mediaType: { type: 'string', required: true },
              width: { type: 'integer', required: true },
              height: { type: 'integer', required: true },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Saved ${value.model} image (${value.width}x${value.height}, seed ${value.seed}, ~${value.anlasEstimate} Anlas) to ${value.path}`,
      }],
      presentationMeta: (_args, value) => value.attachment === undefined ? {} : { image: value.attachment },
    },
    async execute(args, exec) {
      const token = config.token || process.env['NOVELAI_TOKEN'] || ''
      if (!token) {
        throw new Error('NovelAI token missing: set the plugin config `token` or the NOVELAI_TOKEN environment variable')
      }
      const input = resolveInput(args)
      const stem = args.filename ? safeFileStem(args.filename) : generationFileStem(input.seed)
      const payload = buildNovelaiPayload(input)
      const timeout = AbortSignal.timeout(config.timeoutMs)
      const signal = AbortSignal.any([exec.signal, timeout])
      const images = await requestGeneration({
        payload,
        token,
        baseUrl: config.imageBaseUrl,
        timeoutMs: config.timeoutMs,
        signal,
        proxyUrl: resolveProxyUrl(config.proxyUrl) ?? '',
      })
      const image = images[0]
      if (image === undefined) {
        throw new Error('NovelAI returned an empty image list; not retrying to avoid a duplicate charge')
      }
      if (images.length > 1) {
        // Keep sibling images beside the primary one instead of dropping paid output.
        await mkdir(outputDir, { recursive: true })
        for (let index = 1; index < images.length; index++) {
          const sibling = images[index]
          if (sibling !== undefined) await writeFile(join(outputDir, `${stem}-${index}.png`), sibling)
        }
      }
      const path = join(outputDir, `${stem}.png`)
      await mkdir(outputDir, { recursive: true })
      await writeFile(path, image)
      // Durable attachment for transcript display and later reuse. This channel
      // is best-effort: the generation already succeeded and the file result
      // stands on its own, so an unavailable store or a failed save must not
      // fail the paid call's result.
      let attachment: ImageAttachmentRef | undefined
      const store = ctx.get('attachments') as AttachmentStore | undefined
      if (store !== undefined) {
        try {
          attachment = await store.saveImage({
            data: new Uint8Array(image),
            mediaType: 'image/png',
            name: `${stem}.png`,
          })
        } catch {
          // Swallow attachment-save failures only: the image is already on
          // disk at `path`, and display degrades to the plain text result.
        }
      }
      // Plain JSON projection of the durable reference: branded ids and
      // interfaces do not cross the canonical-value boundary.
      const attachmentJson = attachment === undefined ? undefined : {
        attachmentId: `${attachment.attachmentId}`,
        mediaType: attachment.mediaType,
        bytes: attachment.bytes,
        width: attachment.width,
        height: attachment.height,
        ...(attachment.name === undefined ? {} : { name: attachment.name }),
        ...(attachment.originalDimensions === undefined
          ? {}
          : { originalDimensions: attachment.originalDimensions }),
      }
      const result = {
        path,
        bytes: image.byteLength,
        seed: input.seed,
        model: input.model,
        width: input.width,
        height: input.height,
        steps: input.steps,
        anlasEstimate: estimateAnlas(input.width, input.height, input.steps),
        ...(attachmentJson === undefined ? {} : { attachment: attachmentJson }),
      }
      return result
    },
    presentCall: args => ({
      card: 'generic' as const,
      title: 'Generate NovelAI image',
      kind: 'other' as const,
      rawInput: { prompt: args.prompt, model: args.model, seed: args.seed },
    }),
  }))
}
