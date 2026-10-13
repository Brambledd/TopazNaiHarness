/**
 * Latest-wins NovelAI image projection: one wire projection key folding the
 * session log for the most recent image a successful `novelai_generate` call
 * attached. The session list serves it as a cold-session cover hint without
 * opening the session.
 * @module @deepseek-ai/dsh-tool-novelai/projection
 */

import { z as zod } from 'zod'
import type { ZodType } from 'zod'
import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-session/surface'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'

/** The durable image facts one successful `novelai_generate` leaves behind. */
export interface LatestNovelaiImage {
  readonly attachmentId: string
  readonly mediaType: string
  readonly width: number
  readonly height: number
  /** Log seq of the `tool/result` event that produced the image. */
  readonly seq: number
}

/** Fold state: novelai call ids awaiting their result, plus the latest image. */
export interface LatestNovelaiImageState {
  readonly calls: Readonly<Record<string, true>>
  readonly latest: LatestNovelaiImage | null
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Fold state of the latest-wins NovelAI image unit. */
    'novelai/latestImage': LatestNovelaiImageState
  }
  interface SessionProjectionMap {
    /**
     * The most recent image a successful `novelai_generate` call attached
     * (last-wins), or `null` before the first generation. Consumed by the
     * web session list as a cold-session cover hint.
     */
    'novelai/latestImage': LatestNovelaiImage | null
  }
}

/** Validate one durable image reference carried by a result content block. */
function imageRefOf(block: unknown): Omit<LatestNovelaiImage, 'seq'> | undefined {
  if (typeof block !== 'object' || block === null) return undefined
  const record = block as { readonly type?: unknown; readonly attachment?: unknown }
  if (record.type !== 'image' || typeof record.attachment !== 'object' || record.attachment === null) {
    return undefined
  }
  const ref = record.attachment as Record<string, unknown>
  if (typeof ref.attachmentId !== 'string' || ref.attachmentId === '') return undefined
  if (typeof ref.mediaType !== 'string') return undefined
  if (typeof ref.width !== 'number' || typeof ref.height !== 'number') return undefined
  return { attachmentId: ref.attachmentId, mediaType: ref.mediaType, width: ref.width, height: ref.height }
}

/** Collect image references from a result content list, recursing through nested tool-result blocks. */
function imageRefsIn(content: unknown): Array<Omit<LatestNovelaiImage, 'seq'>> {
  if (!Array.isArray(content)) return []
  const found: Array<Omit<LatestNovelaiImage, 'seq'>> = []
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue
    const record = block as { readonly type?: unknown; readonly content?: unknown }
    if (record.type === 'image') {
      const ref = imageRefOf(block)
      if (ref !== undefined) found.push(ref)
    }
    if (record.type === 'tool-result') found.push(...imageRefsIn(record.content))
  }
  return found
}

const latestImageSchema: ZodType<LatestNovelaiImage> = zod.object({
  attachmentId: zod.string().min(1),
  mediaType: zod.string(),
  width: zod.number(),
  height: zod.number(),
  seq: zod.number().int().nonnegative(),
}).strict()

const stateSchema: ZodType<LatestNovelaiImageState> = zod.object({
  calls: zod.record(zod.string(), zod.literal(true)),
  latest: latestImageSchema.nullable(),
}).strict()

/** Latest-wins fold over successful `novelai_generate` result images. */
export const latestNovelaiImageProjection = {
  key: 'novelai/latestImage',
  stateVersion: 1,
  stateSchema,
  init: () => ({ calls: {}, latest: null }),
  apply: (state: LatestNovelaiImageState, event: SessionEvent): LatestNovelaiImageState => {
    if (event.type === 'tool/call') {
      if (event.data.name !== 'novelai_generate') return state
      if (Object.hasOwn(state.calls, event.data.callId)) return state
      return { ...state, calls: { ...state.calls, [event.data.callId]: true } }
    }
    if (event.type !== 'tool/result' || !isAppendSurfaceEvent(event)) return state
    const callId = event.data.message.source.callId
    if (!Object.hasOwn(state.calls, callId)) return state
    const { [callId]: _consumed, ...calls } = state.calls
    const refs = imageRefsIn(event.data.message.content)
    const last = refs.at(-1)
    return last === undefined
      ? { ...state, calls }
      : { calls, latest: { ...last, seq: event.seq } }
  },
  wire: {
    viewSchema: latestImageSchema.nullable(),
    view: state => state.latest,
  },
} satisfies ProjectionDefinition<'novelai/latestImage', LatestNovelaiImageState>
