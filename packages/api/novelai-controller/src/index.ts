/** Host NovelAI Remote owner: workbench generation and the shared output library. */

import { readFile } from 'node:fs/promises'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import { Remote, TypertRemoteService, RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import {
  MAX_NOVELAI_SEED,
  NOVELAI_MODELS,
  NOVELAI_NOISE_SCHEDULES,
  NOVELAI_SAMPLERS,
  estimateAnlas,
} from '@deepseek-ai/dsh-novelai-core'
import { requestTagSuggestions, resolveProxyUrl } from '@deepseek-ai/dsh-novelai-core/node'
import { NovelaiImageLibrary } from './library.ts'
import { NOVELAI_WORKBENCH_DEFAULTS, runEnhancement, runGeneration } from './generation.ts'
import { suggestTagsFromDictionary } from './tags.ts'
import { TagIndexStore } from './tag-index.ts'
import type {
  NovelaiCatalogValue,
  NovelaiDownloadTagIndexValue,
  NovelaiEnhanceRequest,
  NovelaiEntryContentValue,
  NovelaiEstimateRequest,
  NovelaiEstimateValue,
  NovelaiGenerateRequest,
  NovelaiGenerationValue,
  NovelaiHistoryRequest,
  NovelaiHistoryValue,
  NovelaiReadEntryRequest,
  NovelaiRemoveRequest,
  NovelaiRemoveValue,
  NovelaiSplitCharactersRequest,
  NovelaiSplitCharactersValue,
  NovelaiSuggestTagsRequest,
  NovelaiTagIndexStatusValue,
  NovelaiTagSuggestionsValue,
} from './types.ts'

export type * from './types.ts'
export { NovelaiImageLibrary, LIBRARY_INDEX_FILE } from './library.ts'
export { NOVELAI_WORKBENCH_DEFAULTS, resolveGenerationRequest, runGeneration } from './generation.ts'
export { suggestTagsFromDictionary } from './tags.ts'
export { TAG_DICTIONARY, type NovelaiDictEntry } from './tag-dictionary.ts'
export { TagIndexStore, searchTagIndexEntries, parseTagIndexFromBuffer, parseCsvLine } from './tag-index.ts'

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
  /** On-disk location of the optional bilingual Danbooru tag index CSV (downloaded, never bundled). */
  tagIndexPath: string
  /** LLM provider used by the character-split auxiliary call. */
  splitProvider: string
  /** LLM model used by the character-split auxiliary call. */
  splitModel: string
  /** Output token budget of the character-split auxiliary call. */
  splitMaxTokens: number
}

/** Host service backing the generated `ctx.remote.novelai` namespace. */
export class NovelaiController extends TypertRemoteService {
  static inject = ['typert', 'llm']

  static Config: z<NovelaiControllerConfig> = z.object({
    outputDir: z.string().default('workspace/novelai'),
    tagIndexPath: z.string().default('workspace/novelai/danbooru-cn.csv'),
    splitProvider: z.string().default('zai-coding-cn'),
    splitModel: z.string().default('glm-5.3-flash'),
    splitMaxTokens: z.number().default(4096),
  })

  private readonly config: NovelaiControllerConfig
  private readonly library: NovelaiImageLibrary
  private readonly tagIndex: TagIndexStore
  private tagIndexDownload: Promise<unknown> | undefined

  /** @param ctx - Host context carrying the typert registry. @param config - deployment settings. */
  constructor(ctx: Context, config: NovelaiControllerConfig) {
    super(ctx, 'novelaiController', { namespace: 'novelai' })
    this.config = config
    this.library = new NovelaiImageLibrary(config.outputDir)
    this.tagIndex = new TagIndexStore(config.tagIndexPath, resolveProxyUrl('') ?? '')
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
   * Resolve the authenticating token through the credential seam — the
   * `NOVELAI_TOKEN` credential (store over `.env` and environment) first, the
   * bare environment when no provider is mounted — so a token saved from the
   * settings row reaches the next workbench generation without a restart.
   * @returns the token; empty means the host has none configured.
   */
  private async resolveToken(): Promise<string> {
    const credentials = this.ctx.get('credentials')
    const resolved = await credentials?.resolve(credentialRef('NOVELAI_TOKEN'))
    return resolved?.value ?? process.env['NOVELAI_TOKEN'] ?? ''
  }

  /**
   * Submit one paid text-to-image generation and record it in the shared library.
   * @param request - the workbench's partial generation request.
   * @returns the completed generation value.
   */
  @Remote('generate')
  async generate(request: NovelaiGenerateRequest): Promise<NovelaiGenerationValue> {
    const token = await this.resolveToken()
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
        ...(value.characters === undefined ? {} : { characters: value.characters }),
        createdAt: value.createdAt,
      })
      return value
    } catch (error) {
      throw this.asRemoteError(error)
    }
  }

  /**
   * Submit one paid enhance (img2img) run over the client-resized source and
   * record the result in the shared library.
   * @param request - the workbench's enhance request.
   * @returns the completed generation value of the enhanced image.
   */
  @Remote('enhance')
  async enhance(request: NovelaiEnhanceRequest): Promise<NovelaiGenerationValue> {
    const token = await this.resolveToken()
    try {
      await this.library.ensure()
      const value = await runEnhancement(request, {
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
   * Suggest tags for one partial prompt word: the NovelAI suggest-tags endpoint
   * first, the built-in Chinese dictionary when the endpoint is unavailable or
   * answers without suggestions.
   * @param request - the partial word and its checkpoint scope.
   * @returns ranked suggestions, best first.
   */
  @Remote('suggestTags')
  async suggestTags(request: NovelaiSuggestTagsRequest): Promise<NovelaiTagSuggestionsValue> {
    const prompt = request.prompt.trim()
    if (prompt === '') return { tags: [] }
    // First round on a fresh deployment kicks off the one-time index download in
    // the background; this round still answers from the endpoint or dictionary.
    void this.status().then((status) => {
      if (!status.downloaded) this.ensureTagIndexDownload()
    }).catch(() => {})
    const model = request.model ?? NOVELAI_WORKBENCH_DEFAULTS.model
    const fromIndex = await this.tagIndex.search(prompt, 12)
    if (fromIndex.length > 0) return { tags: fromIndex }
    try {
      const tags = await requestTagSuggestions({
        prompt,
        model,
        token: process.env['NOVELAI_TOKEN'] ?? '',
        baseUrl: 'https://api.novelai.net',
        timeoutMs: 5_000,
        signal: new AbortController().signal,
        proxyUrl: resolveProxyUrl(''),
      })
      if (tags.length > 0) {
        return { tags: tags.map(tag => ({ tag: tag.tag, count: tag.count, category: tag.category, description: tag.description ?? '' })) }
      }
    } catch {
      // The suggestion endpoint is advisory: fall through to the dictionary.
    }
    return { tags: suggestTagsFromDictionary(prompt, 12) }
  }

  /**
   * Report the bilingual tag index state.
   * @returns download presence, record count, and file size.
   */
  @Remote('tagIndexStatus')
  async status(): Promise<NovelaiTagIndexStatusValue> {
    const status = await this.tagIndex.status()
    return status
  }

  /**
   * Download (or refresh) the bilingual tag index CSV.
   * @returns the download receipt.
   */
  @Remote('downloadTagIndex')
  async downloadTagIndex(): Promise<NovelaiDownloadTagIndexValue> {
    this.tagIndexDownload = undefined
    return this.tagIndex.download()
  }

  /** Start one shared background index download; concurrent calls collapse. */
  private ensureTagIndexDownload(): Promise<unknown> {
    if (this.tagIndexDownload === undefined) {
      this.tagIndexDownload = this.tagIndex.download().catch(() => {})
    }
    return this.tagIndexDownload
  }

  /**
   * Split one merged prompt into a base prompt plus per-character captions with an
   * auxiliary LLM call. The base keeps scene, composition, and quality tags; each
   * character receives its own Danbooru caption.
   * @param request - the merged prompt to decompose.
   * @returns the remaining base prompt and the ordered character captions.
   */
  @Remote('splitCharacters')
  async splitCharacters(request: NovelaiSplitCharactersRequest): Promise<NovelaiSplitCharactersValue> {
    const prompt = request.prompt.trim()
    if (prompt === '') return { prompt: '', characters: [] }
    const { text, finishKind } = await this.completeSplit(prompt)
    try {
      return parseSplitResponse(text, prompt)
    } catch (error) {
      // A complete JSON answer is accepted regardless of the finish reason; only an
      // unusable answer surfaces the reason, with an actionable hint on truncation.
      const raw = error instanceof Error ? error.message : String(error)
      const message = finishKind === 'max-tokens'
        ? `拆分输出在 ${String(this.config.splitMaxTokens)} token 处被截断；请在 cordis.yml 调大 novelaiController 的 splitMaxTokens 后重试`
        : raw
      throw new RemoteError('novelai/split-failed', message, { message })
    }
  }

  /** Run one auxiliary LLM completion for the split and return its text output plus the finish reason. */
  private async completeSplit(prompt: string): Promise<{ text: string; finishKind: string | undefined }> {
    const system
      = 'You split anime image-generation prompts into per-character captions. '
      + 'Answer with STRICT JSON only, no markdown, no explanation: '
      + '{"prompt":"<base tags that are not character-specific>","characters":[{"prompt":"<one character tags>","negativePrompt":"<optional per-character negative tags>"}]}. '
      + 'Rules: every character (1girl, 2girls, 1boy, multiple counts, named characters) becomes one entry in order; '
      + 'character-scoped tags (hair, eyes, outfit, pose of that character) move into that character entry; '
      + 'global tags (scene, background, composition, angle, lighting, quality, style) stay in the base prompt; '
      + 'keep Danbooru tag style, English, comma-separated; never invent tags that are not implied by the input.'
    const messages: Message[] = [createUserMessage({
      content: [{ type: 'text', text: prompt }],
      source: { kind: 'plugin', plugin: 'dsh-api-novelai-controller' },
    })]
    const options: GenerateOptions = {
      provider: this.config.splitProvider,
      model: this.config.splitModel,
      messages,
      system,
      maxTokens: this.config.splitMaxTokens,
      purpose: 'novelai-split-characters',
      signal: new AbortController().signal,
    }
    const assembler = new BlockAssembler()
    for await (const chunk of this.ctx.llm.stream(options)) {
      assembler.push(chunk)
    }
    const finish = assembler.finish as { kind?: unknown } | undefined
    const finishKind = typeof finish?.['kind'] === 'string' ? finish['kind'] : undefined
    const text = assembler.blocks()
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join(' ')
      .trim()
    if (text === '') {
      throw new Error(finishKind === undefined ? 'split model produced no text' : `split model finished with "${finishKind}" without text`)
    }
    return { text, finishKind }
  }

  /**
   * Read one library entry's PNG bytes for workbench display.
   * @param request - the entry to read.
   * @returns the base64-encoded PNG content.
   */
  @Remote('readEntry')
  async readEntry(request: NovelaiReadEntryRequest): Promise<NovelaiEntryContentValue> {
    const entries = await this.library.list()
    const entry = entries.find(candidate => candidate.id === request.id)
    if (entry === undefined) {
      throw new RemoteError('novelai/entry-missing', `no library entry "${request.id}"`, { id: request.id })
    }
    const bytes = await readFile(entry.file)
    return { data: bytes.toString('base64'), mime: 'image/png' }
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

/**
 * Parse one split-model answer into the wire value, tolerating prose around the
 * JSON and salvaging the complete character entries of a token-truncated answer.
 * @param text - the model's text output.
 * @param fallbackPrompt - the original prompt, used when the model omits the base prompt.
 * @returns the base prompt and ordered character captions.
 */
export function parseSplitResponse(text: string, fallbackPrompt: string): NovelaiSplitCharactersValue {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error('split model answer contains no JSON object')
  const body = text.slice(start, end + 1)
  const parsed = tryParseJson(body) ?? tryParseJson(salvageTruncatedJson(body))
  if (parsed === undefined) throw new Error('split model answer is not valid JSON')
  if (typeof parsed !== 'object' || parsed === null) throw new Error('split model answer is not an object')
  const record = parsed as Record<string, unknown>
  const base = typeof record['prompt'] === 'string' ? record['prompt'].trim() : ''
  const list = Array.isArray(record['characters']) ? record['characters'] : []
  const characters = list.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return []
    const item = entry as Record<string, unknown>
    const caption = typeof item['prompt'] === 'string' ? item['prompt'].trim() : ''
    if (caption === '') return []
    return [{
      prompt: caption,
      negativePrompt: typeof item['negativePrompt'] === 'string' ? item['negativePrompt'].trim() : '',
      useCoords: false,
      x: 0.5,
      y: 0.5,
    }]
  })
  return { prompt: base === '' ? fallbackPrompt : base, characters }
}

/** Parse one JSON candidate, reporting failure as `undefined` instead of throwing. */
function tryParseJson(candidate: string): unknown {
  try {
    return JSON.parse(candidate)
  } catch {
    return undefined
  }
}

/**
 * Cut a truncated `{"prompt":...,"characters":[...]}` body back to the last
 * complete character entry and close the array; usable when the model hit the
 * token cap mid-list.
 */
function salvageTruncatedJson(body: string): string {
  const cut = body.lastIndexOf('}')
  if (cut <= 0) return body
  return `${body.slice(0, cut + 1).trimEnd().replace(/,\s*$/, '')}]}`
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
    ...(entry.characters === undefined ? {} : { characters: entry.characters }),
    createdAt: entry.createdAt,
    anlasEstimate: entry.width === undefined || entry.height === undefined || entry.steps === undefined
      ? 0
      : estimateAnlas(entry.width, entry.height, entry.steps),
  }
}

export default NovelaiController
