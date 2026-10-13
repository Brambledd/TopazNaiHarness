# NovelAI 工作台 Remote

[English](novelai.md) | 中文

[`@deepseek-ai/dsh-api-novelai-controller`](../../packages/api/novelai-controller) 所拥有的宿主 NovelAI 业务 API 与浏览器安全的传输词汇：工作台生成（txt2img 与 enhance）、共享图片库、标签工具，以及两个 LLM 辅助调用（角色拆分与反推提示词）。生成工具与 Web 工作台是消费方；各包 README 负责部署配置、文件布局与失败行为，生成结果携带的持久图片引用词汇归[附件](attachment.zh.md)页所有。

源码：[`packages/api/novelai-controller/src/index.ts`](../../packages/api/novelai-controller/src/index.ts)、[`packages/api/novelai-controller/src/types.ts`](../../packages/api/novelai-controller/src/types.ts)

## 目录与图库分页

`catalog()` 提供可选的 checkpoint/sampler/schedule 列表，以及请求缺省时客户端套用的工作台默认值。`history()` 按最新优先对共享图库分页；每个条目是一次已完成生成，携带 PNG 块或索引行保有的元数据。

```ts type-equiv
/** Checkpoint, sampler, and schedule catalogs plus the workbench defaults, served by `catalog()`. */
interface NovelaiCatalogValue {
  /** Selectable checkpoints. */
  readonly models: readonly string[]
  /** Selectable samplers. */
  readonly samplers: readonly string[]
  /** Selectable noise schedules. */
  readonly noiseSchedules: readonly string[]
  /** Inclusive upper bound of a seed. */
  readonly maxSeed: number
  /** Workbench defaults applied when a request omits a parameter. */
  readonly defaults: NovelaiGenerationDefaults
}
```

```ts type-equiv
/** Parameter defaults applied by the host when a request omits them. */
interface NovelaiGenerationDefaults {
  readonly model: string
  readonly width: number
  readonly height: number
  readonly steps: number
  readonly cfgScale: number
  readonly sampler: string
  readonly noiseSchedule: string
}
```

```ts type-equiv
/** Anlas price quote request. */
interface NovelaiEstimateRequest {
  readonly width: number
  readonly height: number
  readonly steps: number
}
```

```ts type-equiv
/** Anlas price quote. */
interface NovelaiEstimateValue {
  readonly anlas: number
}
```

```ts type-equiv
/** Library page request; paging walks newest-first. */
interface NovelaiHistoryRequest {
  /** Zero-based first entry of the page. */
  readonly offset?: number
  /** Maximum entries in the page. */
  readonly limit?: number
}
```

```ts type-equiv
/** One library page. */
interface NovelaiHistoryValue {
  readonly entries: readonly NovelaiGenerationValue[]
  /** Total entries in the library. */
  readonly total: number
}
```

```ts type-equiv
/** Library entry content request. */
interface NovelaiReadEntryRequest {
  /** Library entry id (the filename stem). */
  readonly id: string
}
```

```ts type-equiv
/** One library entry's PNG bytes, base64-encoded for the JSON remote channel. */
interface NovelaiEntryContentValue {
  /** Base64-encoded PNG bytes. */
  readonly data: string
  /** Image media type; always `image/png`. */
  readonly mime: 'image/png'
}
```

```ts type-equiv
/** Library entry removal request. */
interface NovelaiRemoveRequest {
  /** Library entry id (the filename stem). */
  readonly id: string
}
```

```ts type-equiv
/** Removal receipt. */
interface NovelaiRemoveValue {
  /** Whether the entry and its file were removed. */
  readonly removed: boolean
}
```

## 生成与增强

`generate()` 执行一次付费 txt2img 提交并把结果记入共享图库；`enhance()` 在新参数下重绘一张由客户端缩放好的源图（img2img）。逐角色描述在入参侧走 `NovelaiCharacterPromptRequest`，在结果侧走 `NovelaiCharacterPromptValue`。

```ts type-equiv
/** One per-character caption of a workbench generation request. */
interface NovelaiCharacterPromptRequest {
  /** The character's own positive prompt. */
  readonly prompt: string
  /** The character's own negative prompt; empty when unset. */
  readonly negativePrompt?: string
  /** Whether the request fixes this character at `(x, y)`. */
  readonly useCoords: boolean
  /** Horizontal placement in the 0–1 image space. */
  readonly x: number
  /** Vertical placement in the 0–1 image space. */
  readonly y: number
}
```

```ts type-equiv
/** One per-character caption recorded with a completed generation. */
interface NovelaiCharacterPromptValue {
  /** The character's own positive prompt. */
  readonly prompt: string
  /** The character's own negative prompt; empty when unset. */
  readonly negativePrompt: string
  /** Whether the generation fixed this character at `(x, y)`. */
  readonly useCoords: boolean
  /** Horizontal placement in the 0–1 image space. */
  readonly x: number
  /** Vertical placement in the 0–1 image space. */
  readonly y: number
}
```

```ts type-equiv
/** Workbench generation request; every parameter except `prompt` is optional. */
interface NovelaiGenerateRequest {
  /** Positive prompt text. */
  readonly prompt: string
  /** Negative prompt; the host merges its default when omitted or blank. */
  readonly negativePrompt?: string
  /** Checkpoint id; a workbench default applies when omitted. */
  readonly model?: string
  /** Image width in pixels, a positive multiple of 64. */
  readonly width?: number
  /** Image height in pixels, a positive multiple of 64. */
  readonly height?: number
  /** Step count, 1–50. */
  readonly steps?: number
  /** CFG scale, 0–10. */
  readonly cfgScale?: number
  /** Sampler id. */
  readonly sampler?: string
  /** Noise schedule id. */
  readonly noiseSchedule?: string
  /** Seed; a random seed applies when omitted. */
  readonly seed?: number
  /** Per-character captions; V4+ checkpoints only, capped at 6 (V4/V4.5) or 32 (V5). */
  readonly characters?: readonly NovelaiCharacterPromptRequest[]
}
```

```ts type-equiv
/** One enhance (img2img) request: the generation parameters plus the resized source. */
interface NovelaiEnhanceRequest {
  /** Base64 PNG of the source image, already resized to `width`×`height`. */
  readonly image: string
  /** Output width in pixels; the client resized the source to exactly this. */
  readonly width: number
  /** Output height in pixels; the client resized the source to exactly this. */
  readonly height: number
  /** Positive prompt text; enhancement re-renders the source under this prompt. */
  readonly prompt: string
  /** Negative prompt; the host merges its default when omitted or blank. */
  readonly negativePrompt?: string
  /** Checkpoint id; a workbench default applies when omitted. */
  readonly model?: string
  /** Step count, 1–50. */
  readonly steps?: number
  /** CFG scale, 0–10. */
  readonly cfgScale?: number
  /** Sampler id. */
  readonly sampler?: string
  /** Noise schedule id. */
  readonly noiseSchedule?: string
  /** Denoise strength 0–1; conservative values keep the source pose and composition. */
  readonly strength: number
  /** V5-only official server-side upscaled enhance; forced off for non-V5 checkpoints. */
  readonly upscaledEnhance?: boolean
  /** Seed; a random seed applies when omitted. */
  readonly seed?: number
}
```

```ts type-equiv
/** One completed generation, recorded in the shared library. Fields the PNG or index row does not carry stay absent. */
interface NovelaiGenerationValue {
  /** Library entry id (the filename stem). */
  readonly id: string
  /** Absolute host path of the saved PNG. */
  readonly file: string
  /** PNG size in bytes. */
  readonly bytes: number
  readonly width?: number
  readonly height?: number
  readonly seed?: number
  readonly model?: string
  readonly steps?: number
  readonly prompt?: string
  readonly negativePrompt?: string
  /** Per-character captions the generation carried, when known. */
  readonly characters?: readonly NovelaiCharacterPromptValue[]
  /** ISO-8601 creation instant. */
  readonly createdAt: string
  /** Estimated Anlas charge; 0 when the entry's parameters are unknown. */
  readonly anlasEstimate: number
}
```

## 标签工具与 LLM 辅助调用

`suggestTags()` 为提示词自动补全给出双语词典排序候选；标签索引 CSV 按需下载，由 `status()`/`downloadTagIndex()` 上报状态。`splitCharacters()` 与 `reversePrompt()` 是两个 LLM 辅助调用（文本拆分与视觉反推），`inspectImage()` 不经模型调用、直接读取导入 PNG 中内嵌的 NovelAI 参数。

```ts type-equiv
/** Tag suggestion request for workbench prompt autocomplete. */
interface NovelaiSuggestTagsRequest {
  /** The partial word at the caret, in either language. */
  readonly prompt: string
  /** Checkpoint the suggestions are scoped to; the workbench default applies when omitted. */
  readonly model?: string
}
```

```ts type-equiv
/** One ranked tag suggestion. */
interface NovelaiTagSuggestion {
  /** English Danbooru tag in underscore form. */
  readonly tag: string
  /** Post count used for ordering. */
  readonly count: number
  /** Danbooru tag category id. */
  readonly category: number
  /** Human-readable description (Chinese label when known). */
  readonly description: string
}
```

```ts type-equiv
/** Ranked tag suggestions, best first. */
interface NovelaiTagSuggestionsValue {
  readonly tags: readonly NovelaiTagSuggestion[]
}
```

```ts type-equiv
/** Bilingual tag index presence report. */
interface NovelaiTagIndexStatusValue {
  /** Whether a valid index file is present and above the record floor. */
  readonly downloaded: boolean
  /** Parsed record count (0 when absent or corrupt). */
  readonly count: number
  /** Index file size in bytes (0 when absent). */
  readonly sizeBytes: number
}
```

```ts type-equiv
/** Tag index download receipt. */
interface NovelaiDownloadTagIndexValue {
  /** Whether the download succeeded and the file was replaced. */
  readonly ok: boolean
  /** Human-readable outcome. */
  readonly message: string
  /** Parsed record count (0 on failure). */
  readonly count: number
}
```

```ts type-equiv
/** LLM character-split request: one merged prompt to decompose. */
interface NovelaiSplitCharactersRequest {
  /** The merged prompt text to split. */
  readonly prompt: string
}
```

```ts type-equiv
/** LLM character-split result: the remaining base prompt plus one entry per character. */
interface NovelaiSplitCharactersValue {
  /** Prompt text that stays in the base caption (scene, composition, quality). */
  readonly prompt: string
  /** One entry per character, in the order the model found them. */
  readonly characters: readonly NovelaiCharacterPromptValue[]
}
```

```ts type-equiv
/** One reverse-prompt (image interrogation) request over an imported image. */
interface NovelaiReverseRequest {
  /** Base64 PNG of the image, already downscaled by the client for the vision call. */
  readonly image: string
  /** Output style of the reversed prompt. */
  readonly mode: 'tags' | 'natural' | 'mixed'
  /** What part of the image the reverse covers. */
  readonly scope: 'full' | 'character' | 'object' | 'scene'
  /** Optional target/character hint narrowing the reverse. */
  readonly hint?: string
  /** Whether the subject is a known character (identity + appearance variants). */
  readonly knownCharacter: boolean
}
```

```ts type-equiv
/** The reversed prompt answer. */
interface NovelaiReverseValue {
  /** The combined (or single) prompt text. */
  readonly prompt: string
  /** Identity-tagged variant, when the known-character mode answered both sections. */
  readonly namePrompt?: string
  /** Appearance-only variant, when the known-character mode answered both sections. */
  readonly featurePrompt?: string
}
```

```ts type-equiv
/** One inspect (restore-parameters) request over an imported PNG's raw bytes. */
interface NovelaiInspectRequest {
  /** Base64 of the original file bytes; the canvas pipeline must not touch them. */
  readonly image: string
}
```

```ts type-equiv
/** The NovelAI-embedded parameters found in one imported image. */
interface NovelaiInspectValue {
  /** Whether any NovelAI parameter chunk was found. */
  readonly hasMeta: boolean
  /** Positive prompt from the `Title` chunk. */
  readonly prompt?: string
  /** Negative prompt from the `Description` chunk. */
  readonly negativePrompt?: string
  /** Checkpoint id from the `Comment` JSON, when present. */
  readonly model?: string
  /** Seed from the `Comment` JSON, when present. */
  readonly seed?: number
  /** Step count from the `Comment` JSON, when present. */
  readonly steps?: number
  /** Sampler id from the `Comment` JSON, when present. */
  readonly sampler?: string
  /** CFG scale from the `Comment` JSON, when present. */
  readonly cfgScale?: number
  /** Pixel width declared by the IHDR chunk. */
  readonly width?: number
  /** Pixel height declared by the IHDR chunk. */
  readonly height?: number
  /** Per-character captions of a V4+ structured prompt, in prompt order. */
  readonly characters?: readonly NovelaiCharacterPromptValue[]
}
```

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxnovelaicontroller--novelaicontroller"></a>

### `ctx.novelaiController` — `NovelaiController`

Host service backing the generated `ctx.remote.novelai` namespace.

```ts cordis-catalog
/**
 * Serve the checkpoint/sampler/schedule catalogs and workbench defaults.
 * @returns the complete generation catalog.
 */
@Remote('catalog') catalog(): Promise<NovelaiCatalogValue>

/**
 * Quote the Anlas price of one request size.
 * @param request - width, height, and steps of the imagined request.
 * @returns the estimated Anlas charge.
 */
@Remote('estimate') estimate(request: NovelaiEstimateRequest): Promise<NovelaiEstimateValue>

/**
 * Submit one paid text-to-image generation and record it in the shared library.
 * @param request - the workbench's partial generation request.
 * @returns the completed generation value.
 */
@Remote('generate') async generate(request: NovelaiGenerateRequest): Promise<NovelaiGenerationValue>

/**
 * Submit one paid enhance (img2img) run over the client-resized source and
 * record the result in the shared library.
 * @param request - the workbench's enhance request.
 * @returns the completed generation value of the enhanced image.
 */
@Remote('enhance') async enhance(request: NovelaiEnhanceRequest): Promise<NovelaiGenerationValue>

/**
 * Read one page of the merged library, newest first.
 * @param request - paging offsets.
 * @returns the page and the library total.
 */
@Remote('history') async history(request: NovelaiHistoryRequest): Promise<NovelaiHistoryValue>

/**
 * Remove one library entry and its PNG file.
 * @param request - the entry to remove.
 * @returns the removal receipt.
 */
@Remote('removeEntry') async removeEntry(request: NovelaiRemoveRequest): Promise<NovelaiRemoveValue>

/**
 * Suggest tags for one partial prompt word: the NovelAI suggest-tags endpoint
 * first, the built-in Chinese dictionary when the endpoint is unavailable or
 * answers without suggestions.
 * @param request - the partial word and its checkpoint scope.
 * @returns ranked suggestions, best first.
 */
@Remote('suggestTags') async suggestTags(request: NovelaiSuggestTagsRequest): Promise<NovelaiTagSuggestionsValue>

/**
 * Report the bilingual tag index state.
 * @returns download presence, record count, and file size.
 */
@Remote('tagIndexStatus') async status(): Promise<NovelaiTagIndexStatusValue>

/**
 * Download (or refresh) the bilingual tag index CSV.
 * @returns the download receipt.
 */
@Remote('downloadTagIndex') async downloadTagIndex(): Promise<NovelaiDownloadTagIndexValue>

/**
 * Split one merged prompt into a base prompt plus per-character captions with an
 * auxiliary LLM call. The base keeps scene, composition, and quality tags; each
 * character receives its own Danbooru caption.
 * @param request - the merged prompt to decompose.
 * @returns the remaining base prompt and the ordered character captions.
 */
@Remote('splitCharacters') async splitCharacters(request: NovelaiSplitCharactersRequest): Promise<NovelaiSplitCharactersValue>

/**
 * Reverse one imported image into a NovelAI prompt through the configured
 * vision model (desktop reference parity: reproducible Danbooru output).
 * @param request - the image and reverse options.
 * @returns the reversed prompt, plus the identity/appearance variants in
 *   known-character mode.
 * @throws RemoteError when no attachment store is mounted or the vision
 *   call fails or answers unusably.
 */
@Remote('reversePrompt') async reversePrompt(request: NovelaiReverseRequest): Promise<NovelaiReverseValue>

/**
 * Read the parameters NovelAI embeds in one imported PNG (prompt, negative,
 * seed, sampler, and friends) and report them for panel restoration. Pure
 * parsing: no NovelAI call, no Anlas, works offline.
 * @param request - the original file bytes.
 * @returns the found parameters; `hasMeta` false when none embedded.
 */
@Remote('inspectImage') async inspectImage(request: NovelaiInspectRequest): Promise<NovelaiInspectValue>

/**
 * Read one library entry's PNG bytes for workbench display.
 * @param request - the entry to read.
 * @returns the base64-encoded PNG content.
 */
@Remote('readEntry') async readEntry(request: NovelaiReadEntryRequest): Promise<NovelaiEntryContentValue>
```

Source: [`packages/api/novelai-controller/src/index.ts`](../../packages/api/novelai-controller/src/index.ts)
<!-- END GENERATED cordis-surface -->
