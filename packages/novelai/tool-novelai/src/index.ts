/**
 * Model-facing NovelAI text-to-image tool: submits one paid generation per call and saves
 * the returned PNG into the configured output directory.
 * @module @deepseek-ai/dsh-tool-novelai
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the api-novelai-controller Context merge (ctx.novelaiController,
// the workbench-state and live-output-directory source) into this program.
import type {} from '@deepseek-ai/dsh-api-novelai-controller'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-projection-cache'
import type {} from '@deepseek-ai/dsh-session-query'
import {
  NOVELAI_MODELS,
  NOVELAI_NOISE_SCHEDULES,
  NOVELAI_SAMPLERS,
} from './types.ts'
import { buildNovelaiPayload, estimateAnlas, generationFileStem } from './payload.ts'
import { requestGeneration, resolveProxyUrl } from './client.ts'
import { NOVELAI_TOKEN_REF, resolveToken } from './token.ts'
import { latestNovelaiImageProjection } from './projection.ts'
import { backfillLatestImageCovers } from './backfill.ts'
import { PATCH_DESCRIPTION, SETTINGS_FIELDS, normalizePatch } from './patch.ts'
import { resolveInput, type CommittedWorkbench } from './input.ts'
import { dayDirectory, resolveGenerationRoot } from './directory.ts'

const DESCRIPTION =
  'Generate one anime-style image through the NovelAI image API and save it as a PNG. '
  + 'When the session has a live workbench panel (the rail beside the conversation), this tool ALWAYS '
  + "runs off the workbench's committed prompt and parameters — pass only an optional seed or filename. "
  + 'WORKFLOW: if the user requests a scene or any visual change not already in the workbench, FIRST call '
  + 'novelai_prompt_patch with the needed tags and WAIT for the user to apply it — never generate a scene '
  + 'the workbench does not describe. Generate ONCE per request; iterate only when the user asks. '
  + 'A repeat with an unchanged workbench prompt and seed is rejected (it returns a near-identical image). '
  + 'Without a workbench, write the prompt in Danbooru-tag style (e.g. "1girl, solo, blue hair, white dress"). '
  + 'Every call is PAID (Anlas): batch and iterate deliberately, never in a loop. '
  + 'The result reports the saved file path and the seed, so a follow-up can vary one element '
  + 'while keeping the rest identical by reusing that seed. '
  + 'Never post-process, rename, copy, or "fix" the produced image files with other tools; '
  + 'show the user the generated image and let them decide.'

export const name = 'tool-novelai'
export const inject = ['tools']

/** Model-facing NovelAI tool configuration. */
export interface Config {
  /** Persistent API token; when empty the `NOVELAI_TOKEN` credential (credential store, then environment) supplies it. */
  token: string
  /** Image API base URL. */
  imageBaseUrl: string
  /** Directory the generated PNGs are written to; relative paths resolve against the process working directory. */
  outputDir: string
  /** Per-request timeout in milliseconds. */
  timeoutMs: number
  /** HTTP(S) proxy URL for reaching the NovelAI API, e.g. `http://127.0.0.1:7890`; empty defers to `NOVELAI_PROXY`/`HTTPS_PROXY` environment variables, unset means a direct connection. */
  proxyUrl: string
  /** Cold Sessions folded at startup to fill the session-list cover projection (newest first); `0` disables the backfill. */
  coverBackfillSessions: number
}

/** Schemastery configuration for the NovelAI tool consumer. */
export const Config: z<Config> = z.object({
  token: z.string().default(''),
  imageBaseUrl: z.string().default('https://image.novelai.net'),
  outputDir: z.string().default('workspace/novelai'),
  timeoutMs: z.number().default(180_000),
  proxyUrl: z.string().default(''),
  coverBackfillSessions: z.natural().default(100),
})

/**
 * Re-brand the schema-projected attachment value into the durable reference an
 * image content block carries.
 * @param value - the attachment value recorded in the tool result.
 * @returns the branded attachment reference.
 */
function attachmentRefOf(value: {
  attachmentId: string
  mediaType: string
  bytes: number
  width: number
  height: number
  name?: unknown
  originalDimensions?: unknown
}): ImageAttachmentRef {
  const name = typeof value.name === 'string' ? value.name : undefined
  const original = value.originalDimensions
  const originalDimensions = typeof original === 'object' && original !== null
    && typeof (original as { width?: unknown }).width === 'number'
    && typeof (original as { height?: unknown }).height === 'number'
    ? { width: (original as { width: number }).width, height: (original as { height: number }).height }
    : undefined
  return {
    attachmentId: AttachmentId(value.attachmentId),
    // The canonical schema projects the declared wire string; the block shape
    // carries the branded media-type union.
    mediaType: value.mediaType as ImageMediaType,
    bytes: value.bytes,
    width: value.width,
    height: value.height,
    ...name === undefined ? {} : { name },
    ...originalDimensions === undefined ? {} : { originalDimensions },
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
  /** Fallback root when no NovelAI controller is mounted; the controller's live directory wins per call. */
  const fallbackOutputDir = isAbsolute(config.outputDir) ? config.outputDir : resolve(config.outputDir)
  const credentials = ctx.get('credentials')
  /** Last generation fingerprint per session; feeds the identical-rerun guard. */
  const lastGenerations = new Map<string, { prompt: string; seed: number }>()
  // The projection service materializes with the session-controller plugin,
  // which can land after this plugin's own dependencies (tools) resolve. The
  // inject waits for it; compositions without the service keep the tool with
  // the session list on its default cover. The disposer rides the inject fiber.
  ctx.inject(['sessionProjections'], (projections) => {
    projections.sessionProjections.register(latestNovelaiImageProjection)
    if (config.coverBackfillSessions > 0) {
      void projections.inject(['sessionQuery', 'sessionProjectionCache'], (cold) => {
        void backfillLatestImageCovers(cold, config.coverBackfillSessions)
      })
    }
  })
  ctx.tools.register(defineTool({
    name: 'novelai_generate',
    description: DESCRIPTION,
    parameters: {
      prompt: { type: 'string', description: 'Positive prompt, Danbooru-tag style. Ignored when the session has a live workbench panel — the committed workbench prompt binds. When you pass characters, keep the shared scene, composition, and setting here and put each character\'s personal tags only in their entry.' },
      characters: {
        type: 'array',
        description: 'One entry per distinct character in the scene. Each entry\'s prompt carries that character\'s personal appearance and action tags (e.g. "1girl, blue hair, school uniform"); the shared scene/composition stays in the base prompt. Without characters the base prompt describes everyone, as today. Caps: 32 entries on V5 checkpoints, 6 on V4/V4.5, unsupported on V3 (entries beyond the cap are dropped).',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            prompt: { type: 'string', required: true, description: 'This character\'s personal appearance/action tags, Danbooru style.' },
            negativePrompt: { type: 'string', description: 'This character\'s personal negative tags; omit to inherit only the shared negative prompt.' },
          },
        },
      },
      negativePrompt: { type: 'string', description: 'Negative prompt; defaults to the official heavy undesired-content preset.' },
      model: { type: 'string', enum: [...NOVELAI_MODELS], description: 'Checkpoint; defaults to nai-diffusion-5-full.' },
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
              bytes: { type: 'integer', required: true },
              width: { type: 'integer', required: true },
              height: { type: 'integer', required: true },
            },
          },
        },
      },
      render: (_args, value) => {
        const text = `Saved ${value.model} image (${value.width}x${value.height}, seed ${value.seed}, ~${value.anlasEstimate} Anlas) to ${value.path}`
        // The durable image block in the result CONTENT is what session
        // attachment authorization scans (`referencedImage` in the web session
        // controller); result metadata alone never authorizes a read.
        return value.attachment === undefined
          ? [{ type: 'text', text }]
          : [{ type: 'text', text }, { type: 'image', attachment: attachmentRefOf(value.attachment) }]
      },
      presentationMeta: (_args, value) => value.attachment === undefined ? {} : { image: value.attachment },
    },
    async execute(args, exec) {
      const token = await resolveToken(config, credentials)
      // The mounted NovelAI controller, when the composition has one: its
      // committed workbench state is this call's prompt source, and its live
      // output directory is where the PNG saves.
      const controller = ctx.get('novelaiController')
      // The session's committed workbench state, when the NovelAI controller
      // is mounted: the rail beside the conversation commits on every panel
      // change, and its prompt/parameters bind this generation.
      const sessionId = exec.agent?.session.id
      let committed: CommittedWorkbench | undefined
      if (sessionId !== undefined) {
        committed = (await controller?.readWorkbenchState({ sessionId: sessionId }))?.state
      }
      const input = resolveInput(args, committed)
      // Identical-rerun guard: the same prompt+seed returns a near-identical
      // image, so a back-to-back repeat with an unchanged workbench is a paid
      // no-op. The model must change something (novelai_prompt_patch, a seed
      // override, or wait for the user) before generating again. Character
      // captions join the fingerprint (pipe-joined, like the workbench
      // resolution) so a characters-only change stays a legitimate variation.
      const fingerprint = input.characters === undefined
        ? input.prompt
        : [input.prompt, ...input.characters.map(character => character.prompt)].join(' | ')
      const lastKey = sessionId === undefined ? undefined : sessionId
      if (lastKey !== undefined) {
        const previous = lastGenerations.get(lastKey)
        if (previous !== undefined && previous.prompt === fingerprint && previous.seed === input.seed) {
          throw new Error(
            'blocked identical rerun: the workbench prompt and seed are unchanged since the previous generation, '
            + 'so this call would return a near-identical image for the same Anlas. '
            + 'Change the workbench through novelai_prompt_patch (wait for the user to apply), '
            + 'pass a different seed, or stop — one generation per request unless the user asks to iterate.',
          )
        }
        lastGenerations.set(lastKey, { prompt: fingerprint, seed: input.seed })
      }
      const stem = args.filename ? safeFileStem(args.filename) : generationFileStem(input.seed)
      const payload = buildNovelaiPayload(input)
      const timeout = AbortSignal.timeout(config.timeoutMs)
      const signal = AbortSignal.any([exec.signal, timeout])
      let images: Uint8Array[]
      try {
        images = await requestGeneration({
          payload,
          token,
          baseUrl: config.imageBaseUrl,
          timeoutMs: config.timeoutMs,
          signal,
          proxyUrl: resolveProxyUrl(config.proxyUrl) ?? '',
        })
      } catch (error: unknown) {
        if (error instanceof Error && error.message.includes('HTTP 401')) {
          throw new Error(
            'NovelAI rejected the token (HTTP 401): save a valid persistent token in Settings → General '
            + '(NovelAI API token), or update the plugin config `token` / the '
            + `${NOVELAI_TOKEN_REF} credential`,
            { cause: error },
          )
        }
        throw error
      }
      const image = images[0]
      if (image === undefined) {
        throw new Error('NovelAI returned an empty image list; not retrying to avoid a duplicate charge')
      }
      // The controller's live directory when mounted (it honors the Settings
      // generation-directory override), the plugin config otherwise; the PNG
      // saves under the local-time day folders, like the workbench library.
      const outputDir = dayDirectory(await resolveGenerationRoot(fallbackOutputDir, controller), new Date())
      await mkdir(outputDir, { recursive: true })
      if (images.length > 1) {
        // Keep sibling images beside the primary one instead of dropping paid output.
        for (let index = 1; index < images.length; index++) {
          const sibling = images[index]
          if (sibling !== undefined) await writeFile(join(outputDir, `${stem}-${index}.png`), sibling)
        }
      }
      const path = join(outputDir, `${stem}.png`)
      await writeFile(path, image)
      // Durable attachment for transcript display and later reuse. This channel
      // is best-effort: the generation already succeeded and the file result
      // stands on its own, so an unavailable store or a failed save must not
      // fail the paid call's result.
      let attachment: ImageAttachmentRef | undefined
      const store = ctx.get('attachments')
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
        attachmentId: attachment.attachmentId,
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

  ctx.tools.register(defineTool({
    name: 'novelai_prompt_patch',
    description: PATCH_DESCRIPTION,
    parameters: {
      slot: {
        type: 'string', enum: ['positive', 'negative', 'settings', 'characters'], required: true,
        description: 'Which workbench slot the operations target. Multi-character scenes: use `characters` — one `character` number per character — and keep only shared scene tags on `positive`.',
      },
      operations: {
        type: 'array', required: true,
        description: 'Ordered operations; the workbench rail applies them as one patch.',
        items: {
          type: 'object',
          additionalProperties: true,
          properties: {
            op: { type: 'string', enum: ['add', 'remove', 'modify'], required: true, description: 'Tag verb (add/remove/modify); on the settings slot only modify (set) is meaningful.' },
            tag: { type: 'string', description: 'Danbooru tag (positive/negative/characters slots). `modify` rewrites this tag to `value`.' },
            field: { type: 'string', enum: [...SETTINGS_FIELDS], description: 'Settings field (settings slot): model, width, height, steps, cfgScale, sampler, noiseSchedule, seed.' },
            value: { type: 'string', description: 'Replacement tag (modify) or the settings field value as a string.' },
            character: { type: 'integer', description: '1-based character number (characters slot only); a new number creates that character card.' },
          },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          slot: { type: 'string', required: true },
          operations: { type: 'array', required: true, items: { type: 'json' } },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Proposed ${value.operations.length} ${value.slot}-slot operation(s). WAIT: do not call novelai_generate `
          + 'until the user confirms the patch is applied in the workbench rail — generation reads the workbench, '
          + 'and an unapplied patch means the image will not contain these tags.',
      }],
    },
    async execute(args) {
      const patch = normalizePatch(args)
      return patch
    },
    presentCall: args => ({
      card: 'generic' as const,
      title: 'Propose workbench prompt patch',
      kind: 'other' as const,
      rawInput: { slot: args.slot, count: Array.isArray(args.operations) ? args.operations.length : 0 },
    }),
  }))
}
