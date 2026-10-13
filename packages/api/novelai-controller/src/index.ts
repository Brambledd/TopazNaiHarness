/** Host NovelAI Remote owner: workbench generation and the shared output library. */

import { readFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import { Remote, TypertRemoteService, RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import {
  MAX_NOVELAI_SEED,
  NOVELAI_MODELS,
  NOVELAI_NOISE_SCHEDULES,
  NOVELAI_SAMPLERS,
  estimateAnlas,
  parseNovelaiPngMeta,
  readPngSize,
} from '@deepseek-ai/dsh-novelai-core'
import { requestAnlasBalance, requestTagSuggestions, resolveProxyUrl } from '@deepseek-ai/dsh-novelai-core/node'
import { NovelaiImageLibrary } from './library.ts'
import { WorkbenchStateStore, isValidWorkbenchSessionId, WORKBENCH_STATES_DIRECTORY } from './workbench-state-store.ts'
import { ArtistChainStore, ArtistChainRefusalError, ARTIST_CHAINS_FILENAME } from './artist-chains.ts'
import { NOVELAI_WORKBENCH_DEFAULTS, runEnhancement, runGeneration } from './generation.ts'
import { buildReverseSystemPrompt, buildReverseUserText, parseReverseAnswer } from './reverse.ts'
import { suggestTagsFromDictionary } from './tags.ts'
import { TagIndexStore } from './tag-index.ts'
import type {
  NovelaiCatalogValue,
  NovelaiDownloadTagIndexValue,
  NovelaiEnhanceRequest,
  NovelaiEntryContentValue,
  NovelaiGenerationDirValue,
  NovelaiInspectRequest,
  NovelaiInspectValue,
  NovelaiReverseRequest,
  NovelaiReverseValue,
  NovelaiEstimateRequest,
  NovelaiEstimateValue,
  NovelaiGenerateRequest,
  NovelaiGenerationValue,
  NovelaiCommitWorkbenchStateRequest,
  NovelaiReadWorkbenchStateValue,
  NovelaiArtistChainsValue,
  NovelaiSetGenerationDirRequest,
  NovelaiWorkbenchState,
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
export { WorkbenchStateStore, isValidWorkbenchSessionId, WORKBENCH_STATES_DIRECTORY } from './workbench-state-store.ts'
export { ArtistChainStore, ArtistChainRefusalError, ARTIST_CHAINS_FILENAME } from './artist-chains.ts'
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

/** Settings namespace carrying the user's generation-directory override. */
export const NOVELAI_SETTINGS_NAMESPACE = 'novelai'

/** User-configurable section of the `novelai` settings namespace. */
export interface NovelaiSettings {
  /** Generation output directory override; the empty string follows the deployment `outputDir`. */
  generationDir: string
}

/** Schema of the `novelai` settings section. */
export const NOVELAI_SETTINGS_SCHEMA: z<NovelaiSettings> = z.object({
  generationDir: z.string().default(''),
})

/**
 * Resolve the generation output directory: a non-empty settings override wins, the
 * deployment `outputDir` fills in otherwise. Relative values resolve against the
 * process cwd, mirroring the library's own constructor.
 * @param configured - the saved settings value (may be blank).
 * @param fallback - the deployment-configured output directory.
 * @returns the effective absolute directory and whether the override supplies it.
 */
export function resolveEffectiveOutputDir(configured: string, fallback: string): { dir: string; configured: boolean } {
  const override = configured.trim()
  if (override === '') return { dir: isAbsolute(fallback) ? fallback : resolve(fallback), configured: false }
  return { dir: isAbsolute(override) ? override : resolve(override), configured: true }
}

/** Deployment settings of the NovelAI workbench backend. */
export interface NovelaiControllerConfig {
  /** Default output directory of the shared image library; the saved settings `generationDir` overrides it per call. */
  outputDir: string
  /** On-disk location of the optional bilingual Danbooru tag index CSV (downloaded, never bundled). */
  tagIndexPath: string
  /** LLM provider used by the character-split auxiliary call. */
  splitProvider: string
  /** LLM model used by the character-split auxiliary call. */
  splitModel: string
  /** Output token budget of the character-split auxiliary call. */
  splitMaxTokens: number
  /** LLM provider used by the reverse-prompt vision call. */
  reverseProvider: string
  /** Vision-capable LLM model used by the reverse-prompt call. */
  reverseModel: string
  /** Output token budget of the reverse-prompt call. */
  reverseMaxTokens: number
}

/** Host service backing the generated `ctx.remote.novelai` namespace. */
export class NovelaiController extends TypertRemoteService {
  static inject = ['typert', 'llm']

  static Config: z<NovelaiControllerConfig> = z.object({
    outputDir: z.string().default('workspace/novelai'),
    tagIndexPath: z.string().default('workspace/novelai/danbooru-cn.csv'),
    splitProvider: z.string().default('zai-coding-cn'),
    splitModel: z.string().default('glm-5.3-flash'),
    splitMaxTokens: z.number().default(16384),
    reverseProvider: z.string().default('zai-coding-cn'),
    reverseModel: z.string().default('glm-5.3-flash'),
    reverseMaxTokens: z.number().default(7000),
  })

  private readonly config: NovelaiControllerConfig
  /** Library instance per resolved output directory; keyed by the absolute dir a cache miss created it for. */
  private readonly libraries = new Map<string, NovelaiImageLibrary>()
  /** Saved-generation-directory scope; absent while no settings provider is mounted. */
  private settings: SettingsScope<NovelaiSettings> | undefined
  private readonly tagIndex: TagIndexStore
  private tagIndexDownload: Promise<unknown> | undefined
  /** Latest committed workbench panel state per session; the generation tool's prompt source.
   *  Hot cache over the durable {@link WorkbenchStateStore} documents.
   *  Plain property (not a #field): the Typert dispatch invokes Remotes through a
   *  proxy receiver, and a true private field would throw on the wrong `this`. */
  private readonly workbenchStates = new Map<string, NovelaiWorkbenchState>()
  /** Durable store under the harness home; memory-only when no home resolves. */
  private readonly workbenchStore: WorkbenchStateStore
  /** Durable artist-chains library array under the harness home; memory-only when no home resolves. */
  private readonly artistChainStore: ArtistChainStore

  /** @param ctx - Host context carrying the typert registry. @param config - deployment settings. */
  constructor(ctx: Context, config: NovelaiControllerConfig) {
    super(ctx, 'novelaiController', { namespace: 'novelai' })
    this.config = config
    this.tagIndex = new TagIndexStore(config.tagIndexPath, resolveProxyUrl('') ?? '')
    // Resolved once: the panel-state directory and the artist-chains file under
    // the harness home. os.homedir() failing leaves no home to persist into;
    // both stores degrade to memory-only and warn at construction.
    let home: string | undefined
    try {
      home = resolveDshHome()
    } catch {
      home = undefined
    }
    this.workbenchStore = new WorkbenchStateStore(
      home === undefined ? undefined : join(home, WORKBENCH_STATES_DIRECTORY),
      (message) => { this.ctx.logger.warn(message) },
    )
    this.artistChainStore = new ArtistChainStore(
      home === undefined ? undefined : join(home, ARTIST_CHAINS_FILENAME),
      (message) => { this.ctx.logger.warn(message) },
    )
    // Optional settings consumer: compositions without a settings provider keep
    // the deployment `outputDir` (see resolveEffectiveOutputDir). The scope is
    // dropped with the settings service, mirroring the agent-presets registrant.
    ctx.inject(['settings'], (settingsCtx) => {
      this.settings = settingsCtx.settings.register(NOVELAI_SETTINGS_NAMESPACE, NOVELAI_SETTINGS_SCHEMA)
      settingsCtx.effect(() => () => {
        this.settings = undefined
      }, 'novelaiController.settings()')
    })
  }

  /**
   * Resolve the generation output directory for this call: the saved settings
   * override when non-empty, the deployment `outputDir` otherwise. Relative
   * values resolve against the process cwd.
   * @returns the effective absolute directory.
   */
  async effectiveOutputDir(): Promise<string> {
    return resolveEffectiveOutputDir(this.settings?.get().generationDir ?? '', this.config.outputDir).dir
  }

  /** Library instance for one resolved output directory, created and cached on first use. */
  private libraryFor(dir: string): NovelaiImageLibrary {
    const cached = this.libraries.get(dir)
    if (cached !== undefined) return cached
    const created = new NovelaiImageLibrary(dir)
    this.libraries.set(dir, created)
    return created
  }

  /** Library instance bound to the effective output directory. */
  private async currentLibrary(): Promise<NovelaiImageLibrary> {
    return this.libraryFor(await this.effectiveOutputDir())
  }

  /** Effective output directory plus the library instance that serves it, from one resolution. */
  private async generationTarget(): Promise<{ dir: string; library: NovelaiImageLibrary }> {
    const dir = await this.effectiveOutputDir()
    return { dir, library: this.libraryFor(dir) }
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
      const { dir, library } = await this.generationTarget()
      await library.ensure()
      const value = await runGeneration(request, {
        token,
        proxyUrl: '',
        baseUrl: 'https://image.novelai.net',
        timeoutMs: 180_000,
        outputDir: dir,
      })
      await library.record({
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
      throw await this.asRemoteError(error)
    }
  }

  /**
   * Commit one session's workbench panel state. The state lands in the hot map
   * immediately and persists atomically under the harness home, so the panel's
   * configuration survives a client reload and a service restart; the panel
   * re-commits on every change either way.
   * @param request - the session and its latest panel state.
   * @returns an ack.
   * @throws RemoteError `novelai/state-persist-failed` when the durable write
   *   fails — the caller learns its panel state is not durable.
   */
  @Remote('commitWorkbenchState')
  async commitWorkbenchState(request: NovelaiCommitWorkbenchStateRequest): Promise<{ ok: true }> {
    this.workbenchStates.set(request.sessionId, request.state)
    try {
      await this.workbenchStore.write(request.sessionId, request.state)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new RemoteError('novelai/state-persist-failed', message, { message })
    }
    return { ok: true }
  }

  /**
   * Read one session's latest committed workbench panel state: the hot map
   * first, the durable store otherwise (backfilling the map). A session id the
   * store refuses is one that could never have been written, so its persisted
   * state reads as absent.
   * @param request - the session id.
   * @returns the committed state, absent when the panel never committed.
   */
  @Remote('readWorkbenchState')
  async readWorkbenchState(request: { sessionId: string }): Promise<NovelaiReadWorkbenchStateValue> {
    const cached = this.workbenchStates.get(request.sessionId)
    if (cached !== undefined) return { state: cached }
    const state = isValidWorkbenchSessionId(request.sessionId)
      ? await this.workbenchStore.read(request.sessionId)
      : undefined
    if (state === undefined) return {}
    this.workbenchStates.set(request.sessionId, state)
    return { state }
  }

  /**
   * Read the workbench's named artist-chains library (画师串): whole-string
   * `weight:artist::` runs, each under its own name, newest first.
   * @returns all saved chains.
   */
  @Remote('artistChains')
  async artistChains(): Promise<NovelaiArtistChainsValue> {
    return { chains: await this.artistChainStore.list() }
  }

  /**
   * Save one named chain: an empty id creates (the chain appends as the
   * newest), a stored id updates that chain in place. The tags text is stored
   * verbatim — never parsed into per-artist rows.
   * @param request - the chain id (empty to create), its name, and its whole
   *   `weight:artist::` tags text.
   * @returns the full library after the write, newest first.
   * @throws RemoteError `novelai/artist-chain-invalid` when the trimmed name
   *   is empty or exceeds 80 characters, or the trimmed tags are empty
   *   or exceed 2000 characters.
   * @throws RemoteError `novelai/artist-chain-missing` when a non-empty id
   *   matches no stored chain.
   */
  @Remote('saveArtistChain')
  async saveArtistChain(request: { id: string; name: string; tags: string }): Promise<NovelaiArtistChainsValue> {
    try {
      return { chains: await this.artistChainStore.save(request) }
    } catch (error) {
      if (error instanceof ArtistChainRefusalError) throw artistChainRemoteError(error)
      throw await this.asRemoteError(error)
    }
  }

  /**
   * Remove one saved chain by id; small user data, so no confirmation round-trip.
   * @param request - the chain to remove.
   * @returns the full library after the write, newest first.
   * @throws RemoteError `novelai/artist-chain-missing` when the id matches no
   *   stored chain.
   */
  @Remote('removeArtistChain')
  async removeArtistChain(request: { id: string }): Promise<NovelaiArtistChainsValue> {
    try {
      return { chains: await this.artistChainStore.remove(request.id) }
    } catch (error) {
      if (error instanceof ArtistChainRefusalError) throw artistChainRemoteError(error)
      throw await this.asRemoteError(error)
    }
  }

  /**
   * Read the account's remaining Anlas through the free subscription endpoint.
   * @returns the balance; absent when the account or API exposes none.
   */
  @Remote('anlasBalance')
  async anlasBalance(): Promise<{ anlas?: number }> {
    const token = await this.resolveToken()
    if (token === '') return {}
    try {
      const anlas = await requestAnlasBalance({
        token,
        // Third-party tools must read the account through the image domain —
        // api.novelai.net answers this endpoint with a 400 refresh notice.
        baseUrl: 'https://image.novelai.net',
        timeoutMs: 10_000,
        proxyUrl: resolveProxyUrl(''),
      })
      return anlas === undefined ? {} : { anlas }
    } catch {
      // The balance is advisory: an unreachable endpoint degrades to absent.
      return {}
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
      const { dir, library } = await this.generationTarget()
      await library.ensure()
      const value = await runEnhancement(request, {
        token,
        proxyUrl: '',
        baseUrl: 'https://image.novelai.net',
        timeoutMs: 180_000,
        outputDir: dir,
      })
      await library.record({
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
      throw await this.asRemoteError(error)
    }
  }

  /**
   * Report the effective generation output directory.
   * @returns the absolute directory and whether the saved settings override supplies it.
   */
  @Remote('generationDir')
  async generationDir(): Promise<NovelaiGenerationDirValue> {
    return resolveEffectiveOutputDir(this.settings?.get().generationDir ?? '', this.config.outputDir)
  }

  /**
   * Persist the generation-directory override; the empty string clears it. The
   * next generation resolves the directory fresh, so a saved value reaches the
   * next workbench submission or `novelai_generate` call without a restart.
   * @param request - the directory to save, or '' to clear the override.
   * @returns the committed directory value.
   * @throws RemoteError `novelai/settings-write-failed` when no settings provider is mounted or the write fails.
   */
  @Remote('setGenerationDir')
  async setGenerationDir(request: NovelaiSetGenerationDirRequest): Promise<NovelaiGenerationDirValue> {
    const trimmed = request.dir.trim()
    const settings = this.settings
    if (settings === undefined) {
      const message = 'no settings provider is mounted: this deployment cannot store a generation-directory override'
      throw new RemoteError('novelai/settings-write-failed', message, { message })
    }
    try {
      await settings.update({ generationDir: trimmed })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new RemoteError('novelai/settings-write-failed', message, { message })
    }
    return resolveEffectiveOutputDir(settings.get().generationDir, this.config.outputDir)
  }

  /**
   * Read one page of the merged library, newest first.
   * @param request - paging offsets.
   * @returns the page and the library total.
   */
  @Remote('history')
  async history(request: NovelaiHistoryRequest): Promise<NovelaiHistoryValue> {
    const entries = await (await this.currentLibrary()).list()
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
    const removed = await (await this.currentLibrary()).remove(request.id)
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

  /**
   * Reverse one imported image into a NovelAI prompt through the configured
   * vision model (desktop reference parity: reproducible Danbooru output).
   * @param request - the image and reverse options.
   * @returns the reversed prompt, plus the identity/appearance variants in
   *   known-character mode.
   * @throws RemoteError when no attachment store is mounted or the vision
   *   call fails or answers unusably.
   */
  @Remote('reversePrompt')
  async reversePrompt(request: NovelaiReverseRequest): Promise<NovelaiReverseValue> {
    const attachments = this.ctx.get('attachments')
    if (attachments === undefined) {
      const message = 'no attachment store mounted: reverse needs one to carry the image to the model'
      throw new RemoteError('novelai/reverse-failed', message, { message })
    }
    const bytes = Uint8Array.from(atob(request.image), ch => ch.charCodeAt(0))
    let attachment: ImageAttachmentRef
    try {
      attachment = await attachments.saveImage({ data: bytes, mediaType: 'image/png', name: 'reverse-source.png' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new RemoteError('novelai/reverse-failed', message, { message })
    }
    const messages: Message[] = [createUserMessage({
      content: [
        { type: 'image', attachment },
        { type: 'text', text: buildReverseUserText(request) },
      ],
      source: { kind: 'plugin', plugin: 'dsh-api-novelai-controller' },
    })]
    const options: GenerateOptions = {
      provider: this.config.reverseProvider,
      model: this.config.reverseModel,
      messages,
      system: buildReverseSystemPrompt(request),
      maxTokens: this.config.reverseMaxTokens,
      purpose: 'novelai-reverse-prompt',
      signal: new AbortController().signal,
    }
    const assembler = new BlockAssembler()
    let finishKind: string | undefined
    try {
      for await (const chunk of this.ctx.llm.stream(options)) {
        assembler.push(chunk)
      }
      const finish = assembler.finish as { kind?: unknown } | undefined
      finishKind = typeof finish?.['kind'] === 'string' ? finish['kind'] : undefined
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new RemoteError('novelai/reverse-failed', message, { message })
    }
    const text = assembler.blocks()
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join(' ')
      .trim()
    if (text === '') {
      const message = finishKind === 'max-tokens'
        ? `反推输出在 ${String(this.config.reverseMaxTokens)} token 处被截断；请在 cordis.yml 调大 novelaiController 的 reverseMaxTokens 后重试`
        : finishKind === undefined ? '反推模型没有返回文本' : `反推模型以 "${finishKind}" 结束且没有文本`
      throw new RemoteError('novelai/reverse-failed', message, { message })
    }
    const answer = parseReverseAnswer(text, request.knownCharacter)
    return {
      prompt: answer.prompt,
      ...(answer.namePrompt === undefined ? {} : { namePrompt: answer.namePrompt }),
      ...(answer.featurePrompt === undefined ? {} : { featurePrompt: answer.featurePrompt }),
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
      // A reasoning model can spend the whole budget on thinking and emit no
      // answer body at all; surface the budget as the actionable fix.
      throw new Error(finishKind === 'max-tokens'
        ? `拆分输出在 ${String(this.config.splitMaxTokens)} token 处被截断且没有正文（推理占用了预算）；请在 cordis.yml 调大 novelaiController 的 splitMaxTokens 后重试`
        : finishKind === undefined ? 'split model produced no text' : `split model finished with "${finishKind}" without text`)
    }
    return { text, finishKind }
  }

  /**
   * Read the parameters NovelAI embeds in one imported PNG (prompt, negative,
   * seed, sampler, and friends) and report them for panel restoration. Pure
   * parsing: no NovelAI call, no Anlas, works offline.
   * @param request - the original file bytes.
   * @returns the found parameters; `hasMeta` false when none embedded.
   */
  @Remote('inspectImage')
  async inspectImage(request: NovelaiInspectRequest): Promise<NovelaiInspectValue> {
    const bytes = Uint8Array.from(atob(request.image), ch => ch.charCodeAt(0))
    const size = readPngSize(bytes)
    const meta = parseNovelaiPngMeta(bytes)
    const value: NovelaiInspectValue = {
      hasMeta: meta.prompt !== undefined || meta.negativePrompt !== undefined || meta.seed !== undefined
        || meta.steps !== undefined || meta.sampler !== undefined || meta.cfgScale !== undefined || meta.model !== undefined
        || meta.characters !== undefined,
      ...(meta.prompt === undefined ? {} : { prompt: meta.prompt }),
      ...(meta.negativePrompt === undefined ? {} : { negativePrompt: meta.negativePrompt }),
      ...(meta.model === undefined ? {} : { model: meta.model }),
      ...(meta.seed === undefined ? {} : { seed: meta.seed }),
      ...(meta.steps === undefined ? {} : { steps: meta.steps }),
      ...(meta.sampler === undefined ? {} : { sampler: meta.sampler }),
      ...(meta.cfgScale === undefined ? {} : { cfgScale: meta.cfgScale }),
      ...(size === undefined ? {} : { width: size.width, height: size.height }),
      ...(meta.characters === undefined ? {} : { characters: meta.characters }),
    }
    return value
  }

  /**
   * Read one library entry's PNG bytes for workbench display.
   * @param request - the entry to read.
   * @returns the base64-encoded PNG content.
   */
  @Remote('readEntry')
  async readEntry(request: NovelaiReadEntryRequest): Promise<NovelaiEntryContentValue> {
    const entries = await (await this.currentLibrary()).list()
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
  private async asRemoteError(error: unknown): Promise<RemoteError> {
    if (error instanceof RemoteError) return error
    const message = error instanceof Error ? error.message : String(error)
    if (message.startsWith('no NovelAI token')) {
      return new RemoteError('novelai/token-missing', message, {})
    }
    if (/EACCES|ENOENT|EISDIR|EPERM/.test(message)) {
      const path = (await this.currentLibrary()).path
      return new RemoteError('novelai/library-unavailable', `the output library at ${path} is unavailable`, { path })
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

/** Map one artist-chain store refusal to its namespace RemoteError code. */
function artistChainRemoteError(error: ArtistChainRefusalError): RemoteError {
  if (error.kind === 'invalid') return new RemoteError('novelai/artist-chain-invalid', error.message, { message: error.message })
  return new RemoteError('novelai/artist-chain-missing', error.message, { id: error.id ?? '' })
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
