/** Injected callback faces handed to the workbench components. */
import type {
  NovelaiCatalogValue,
  NovelaiEstimateRequest,
  NovelaiEstimateValue,
  NovelaiGenerateRequest,
  NovelaiGenerationValue,
  NovelaiHistoryValue,
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
  /** Read the first library page (newest first). */
  history: () => Promise<NovelaiHistoryValue>
}

/** Mode-switch callbacks. */
export interface ModeSwitchInjected {
  /** Switch the frame's center surface. */
  setViewMode: (mode: ViewMode) => void
}
