/** Host NovelAI Remote owner: workbench generation and the shared output library. */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, TypertRemoteService, RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import {
  MAX_NOVELAI_SEED,
  NOVELAI_MODELS,
  NOVELAI_NOISE_SCHEDULES,
  NOVELAI_SAMPLERS,
  estimateAnlas,
} from '@deepseek-ai/dsh-novelai-core'
import { NovelaiImageLibrary } from './library.ts'
import { NOVELAI_WORKBENCH_DEFAULTS, runGeneration } from './generation.ts'
import type {
  NovelaiCatalogValue,
  NovelaiEstimateRequest,
  NovelaiEstimateValue,
  NovelaiGenerateRequest,
  NovelaiGenerationValue,
  NovelaiHistoryRequest,
  NovelaiHistoryValue,
  NovelaiRemoveRequest,
  NovelaiRemoveValue,
} from './types.ts'

export type * from './types.ts'
export { NovelaiImageLibrary, LIBRARY_INDEX_FILE } from './library.ts'
export { NOVELAI_WORKBENCH_DEFAULTS, resolveGenerationRequest, runGeneration } from './generation.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host NovelAI business API and Remote namespace owner. */
    novelaiController: NovelaiController
  }
}

/** Deployment settings of the NovelAI workbench backend. */
export interface NovelaiControllerConfig {
  /** Output directory of the shared image library; the generation tool must point at the same directory. */
  outputDir: string
}

/** Host service backing the generated `ctx.remote.novelai` namespace. */
export class NovelaiController extends TypertRemoteService {
  static inject = ['typert']

  static Config: z<NovelaiControllerConfig> = z.object({
    outputDir: z.string().default('workspace/novelai'),
  })

  private readonly config: NovelaiControllerConfig
  private readonly library: NovelaiImageLibrary

  /** @param ctx - Host context carrying the typert registry. @param config - deployment settings. */
  constructor(ctx: Context, config: NovelaiControllerConfig) {
    super(ctx, 'novelaiController', { namespace: 'novelai' })
    this.config = config
    this.library = new NovelaiImageLibrary(config.outputDir)
  }

  /**
   * Serve the checkpoint/sampler/schedule catalogs and workbench defaults.
   * @returns the complete generation catalog.
   */
  @Remote('catalog')
  catalog(): Promise<NovelaiCatalogValue> {
    return Promise.resolve({
      models: NOVELAI_MODELS,
      samplers: NOVELAI_SAMPLERS,
      noiseSchedules: NOVELAI_NOISE_SCHEDULES,
      maxSeed: MAX_NOVELAI_SEED,
      defaults: {
        model: NOVELAI_WORKBENCH_DEFAULTS.model,
        width: NOVELAI_WORKBENCH_DEFAULTS.width,
        height: NOVELAI_WORKBENCH_DEFAULTS.height,
        steps: NOVELAI_WORKBENCH_DEFAULTS.steps,
        cfgScale: NOVELAI_WORKBENCH_DEFAULTS.cfgScale,
        sampler: NOVELAI_WORKBENCH_DEFAULTS.sampler,
        noiseSchedule: NOVELAI_WORKBENCH_DEFAULTS.noiseSchedule,
      },
    })
  }

  /**
   * Quote the Anlas price of one request size.
   * @param request - width, height, and steps of the imagined request.
   * @returns the estimated Anlas charge.
   */
  @Remote('estimate')
  estimate(request: NovelaiEstimateRequest): Promise<NovelaiEstimateValue> {
    return Promise.resolve({ anlas: estimateAnlas(request.width, request.height, request.steps) })
  }

  /**
   * Submit one paid text-to-image generation and record it in the shared library.
   * @param request - the workbench's partial generation request.
   * @returns the completed generation value.
   */
  @Remote('generate')
  async generate(request: NovelaiGenerateRequest): Promise<NovelaiGenerationValue> {
    const token = process.env['NOVELAI_TOKEN'] ?? ''
    try {
      await this.library.ensure()
      const value = await runGeneration(request, {
        token,
        proxyUrl: '',
        baseUrl: 'https://image.novelai.net',
        timeoutMs: 180_000,
        outputDir: this.config.outputDir,
      })
      await this.library.record({
        id: value.id,
        file: value.file,
        bytes: value.bytes,
        ...(value.width === undefined ? {} : { width: value.width }),
        ...(value.height === undefined ? {} : { height: value.height }),
        ...(value.seed === undefined ? {} : { seed: value.seed }),
        ...(value.model === undefined ? {} : { model: value.model }),
        ...(value.steps === undefined ? {} : { steps: value.steps }),
        ...(value.prompt === undefined ? {} : { prompt: value.prompt }),
        ...(value.negativePrompt === undefined ? {} : { negativePrompt: value.negativePrompt }),
        createdAt: value.createdAt,
      })
      return value
    } catch (error) {
      throw this.asRemoteError(error)
    }
  }

  /**
   * Read one page of the merged library, newest first.
   * @param request - paging offsets.
   * @returns the page and the library total.
   */
  @Remote('history')
  async history(request: NovelaiHistoryRequest): Promise<NovelaiHistoryValue> {
    const entries = await this.library.list()
    const offset = Math.max(0, request.offset ?? 0)
    const limit = request.limit === undefined ? entries.length : Math.min(Math.max(1, request.limit), entries.length - offset)
    return {
      entries: entries.slice(offset, offset + limit).map(toGenerationValue),
      total: entries.length,
    }
  }

  /**
   * Remove one library entry and its PNG file.
   * @param request - the entry to remove.
   * @returns the removal receipt.
   */
  @Remote('removeEntry')
  async removeEntry(request: NovelaiRemoveRequest): Promise<NovelaiRemoveValue> {
    const removed = await this.library.remove(request.id)
    if (!removed) {
      throw new RemoteError('novelai/entry-missing', `no library entry "${request.id}"`, { id: request.id })
    }
    return { removed }
  }

  /**
   * Normalize a pipeline failure into the namespace's error vocabulary.
   * @param error - the thrown pipeline failure.
   * @returns a RemoteError carrying the namespace's error code.
   */
  private asRemoteError(error: unknown): RemoteError {
    if (error instanceof RemoteError) return error
    const message = error instanceof Error ? error.message : String(error)
    if (message.startsWith('no NovelAI token')) {
      return new RemoteError('novelai/token-missing', message, {})
    }
    if (/EACCES|ENOENT|EISDIR|EPERM/.test(message)) {
      return new RemoteError('novelai/library-unavailable', `the output library at ${this.library.path} is unavailable`, { path: this.library.path })
    }
    return new RemoteError('novelai/generation-failed', message, { message })
  }
}

/** Project a library entry onto the wire value. */
function toGenerationValue(entry: Awaited<ReturnType<NovelaiImageLibrary['list']>>[number]): NovelaiGenerationValue {
  return {
    id: entry.id,
    file: entry.file,
    bytes: entry.bytes,
    ...(entry.width === undefined ? {} : { width: entry.width }),
    ...(entry.height === undefined ? {} : { height: entry.height }),
    ...(entry.seed === undefined ? {} : { seed: entry.seed }),
    ...(entry.model === undefined ? {} : { model: entry.model }),
    ...(entry.steps === undefined ? {} : { steps: entry.steps }),
    ...(entry.prompt === undefined ? {} : { prompt: entry.prompt }),
    ...(entry.negativePrompt === undefined ? {} : { negativePrompt: entry.negativePrompt }),
    createdAt: entry.createdAt,
    anlasEstimate: entry.width === undefined || entry.height === undefined || entry.steps === undefined
      ? 0
      : estimateAnlas(entry.width, entry.height, entry.steps),
  }
}

export default NovelaiController
