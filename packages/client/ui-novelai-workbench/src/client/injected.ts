/** Injected callback faces handed to the workbench components. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkbenchBackfillRequest, WorkbenchPatchRequest } from './bridge.ts'
import type {
  NovelaiCatalogValue,
  NovelaiEnhanceRequest,
  NovelaiEntryContentValue,
  NovelaiInspectRequest,
  NovelaiInspectValue,
  NovelaiReverseRequest,
  NovelaiReverseValue,
  NovelaiEstimateRequest,
  NovelaiEstimateValue,
  NovelaiGenerateRequest,
  NovelaiGenerationValue,
  NovelaiHistoryValue,
  NovelaiReadEntryRequest,
  NovelaiSplitCharactersRequest,
  NovelaiSplitCharactersValue,
  NovelaiSuggestTagsRequest,
  NovelaiTagSuggestionsValue,
  NovelaiWorkbenchState,
} from '@deepseek-ai/dsh-api-novelai-controller/types'
import type { ViewMode } from '@deepseek-ai/dsh-client-ui-layout/client'

/** Workbench center surface callbacks (over the NovelAI Remote namespace). */
export interface WorkbenchInjected extends ModeSwitchInjected {
  /** Read the checkpoint/sampler/schedule catalog and workbench defaults. */
  catalog: () => Promise<NovelaiCatalogValue>
  /** Quote the Anlas price of one request size. */
  estimate: (request: NovelaiEstimateRequest) => Promise<NovelaiEstimateValue>
  /** Submit one paid generation. */
  generate: (request: NovelaiGenerateRequest) => Promise<NovelaiGenerationValue>
  /** Submit one paid enhance (img2img) run over the client-resized source. */
  enhance: (request: NovelaiEnhanceRequest) => Promise<NovelaiGenerationValue>
  /** Reverse one imported image into a prompt through the configured vision model. */
  reverse: (request: NovelaiReverseRequest) => Promise<NovelaiReverseValue>
  /** Read the NovelAI-embedded parameters of an imported PNG for panel restoration. */
  inspect: (request: NovelaiInspectRequest) => Promise<NovelaiInspectValue>
  /** Read the first library page (newest first). */
  history: () => Promise<NovelaiHistoryValue>
  /** Read the account's remaining Anlas; undefined when unavailable. */
  anlasBalance: () => Promise<number | undefined>
  /** Suggest Danbooru tags for one partial prompt word. */
  suggestTags: (request: NovelaiSuggestTagsRequest) => Promise<NovelaiTagSuggestionsValue>
  /** Read one library entry's PNG bytes. */
  readEntry: (request: NovelaiReadEntryRequest) => Promise<NovelaiEntryContentValue>
  /** Split one merged prompt into base plus per-character captions with the host LLM. */
  splitCharacters: (request: NovelaiSplitCharactersRequest) => Promise<NovelaiSplitCharactersValue>
  /** Seed one composed draft text into the given conversation's composer input; the user sends it from there. */
  seedDraft: (sessionId: SessionId, text: string) => boolean
  /** Commit the panel state for one session; the host-side mirror binds `novelai_generate` to it. */
  commitWorkbenchState: (sessionId: SessionId, state: NovelaiWorkbenchState) => Promise<void>
  /**
   * Subscribe to conversation-side backfill deliveries while the panel is mounted.
   * @param callback - invoked with the delivered draft.
   * @returns the unsubscribe disposer.
   */
  onBackfillRequest: (callback: (request: WorkbenchBackfillRequest) => void) => () => void
  /**
   * Subscribe to conversation-side patch deliveries (the `novelai_prompt_patch`
   * card's apply) while the panel is mounted.
   * @param callback - invoked with the applied patch.
   * @returns the unsubscribe disposer.
   */
  onPatchApply: (callback: (request: WorkbenchPatchRequest) => void) => () => void
}

/** Mode-switch callbacks. */
export interface ModeSwitchInjected {
  /** Switch the frame's center surface. */
  setViewMode: (mode: ViewMode) => void
}
