/**
 * Cross-plugin bridge handed to conversation-side surfaces: the conversation's
 * `novelai_generate` tool card delivers a draft back into the mounted workbench
 * panel. Provided by the workbench plugin on the client context as the
 * `novelaiWorkbench` service.
 */

/** One conversation-side draft delivered into the workbench panel; absent fields keep their current panel value. */
export interface WorkbenchBackfillRequest {
  /** Positive prompt text. */
  readonly prompt?: string
  /** Negative prompt text. */
  readonly negativePrompt?: string
  /** Checkpoint id. */
  readonly model?: string
  /** Image width in pixels. */
  readonly width?: number
  /** Image height in pixels. */
  readonly height?: number
  /** Step count. */
  readonly steps?: number
  /** CFG scale. */
  readonly cfgScale?: number
  /** Sampler id. */
  readonly sampler?: string
  /** Noise schedule id. */
  readonly noiseSchedule?: string
  /** Seed; a defined value switches the panel to fixed mode. */
  readonly seed?: number
}

/**
 * The conversation → workbench bridge. The workbench registers one subscriber
 * while its panel is mounted; delivery without a mounted panel reports `false`
 * so the caller can hide or disable the affordance.
 */
export interface NovelaiWorkbenchBridge {
  /**
   * Deliver one draft into the mounted workbench panel.
   * @param request - the draft fields to apply.
   * @returns whether a mounted panel consumed the request.
   */
  requestBackfill(request: WorkbenchBackfillRequest): boolean
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Conversation → workbench backfill bridge (provided by ui-novelai-workbench). */
    novelaiWorkbench: NovelaiWorkbenchBridge
  }
}
