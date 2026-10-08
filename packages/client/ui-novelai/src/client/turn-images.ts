/**
 * Turn-scoped NovelAI image Definition and readers. Client-only and
 * model-free: the vocabulary comes from successful `novelai_generate` result
 * content image blocks, never presentation data or the closing prose.
 */
import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-session/surface'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'

/** One produced image published against its settling event. */
export interface TurnImage {
  readonly seq: number
  readonly attachment: ImageAttachmentRef
}

/** Immutable produced-image facts published against one Turn. */
export interface NovelaiImagesTurnData {
  readonly images: readonly TurnImage[]
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationTurnDataMap {
    /** Successful NovelAI images accumulated in this Turn. */
    'novelai-images': NovelaiImagesTurnData
  }
}

interface TurnImagesState extends NovelaiImagesTurnData {
  readonly turn: number
  readonly calls: ReadonlyMap<string, boolean>
}

/** Validate the durable image reference carried by a result content block. */
function imageRefOf(block: unknown): ImageAttachmentRef | undefined {
  if (typeof block !== 'object' || block === null) return undefined
  const record = block as { readonly type?: unknown; readonly attachment?: unknown }
  if (record.type !== 'image' || typeof record.attachment !== 'object' || record.attachment === null) {
    return undefined
  }
  const ref = record.attachment as Record<string, unknown>
  if (typeof ref.attachmentId !== 'string' || ref.attachmentId === '') return undefined
  if (typeof ref.mediaType !== 'string') return undefined
  if (typeof ref.width !== 'number' || typeof ref.height !== 'number') return undefined
  return record.attachment as ImageAttachmentRef
}

/**
 * Claim the turn-tail chain only when its closing turn produced images.
 * @param owner - Turn-tail owner currency for the closing assistant.
 * @returns Produced images as the component's match, or null to decline.
 */
export function selectTurnImages(owner: TurnTailOwnerProps): readonly TurnImage[] | null {
  const data = owner.turn.data.get('novelai-images')
  if (data === undefined) return null
  const images: TurnImage[] = []
  const seen = new Set<string>()
  for (const image of data.images) {
    if (image.seq > owner.seq || seen.has(image.attachment.attachmentId)) continue
    seen.add(image.attachment.attachmentId)
    images.push(image)
  }
  return images.length === 0 ? null : images
}

/** Turn-local NovelAI image accumulator; it publishes no view Node. */
export const turnImagesDefinition: ConversationNodeDefinition<TurnImagesState> = {
  kind: 'novelai-images',
  match: (event) => {
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    if (event.type === 'tool/call') return { id: String(event.data.turn), role: 'update' }
    if (event.type === 'tool/result' && isAppendSurfaceEvent(event)) {
      return { id: String(event.data.turn), role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'turn/start') throw new Error('novelai-images start requires turn/start')
    return { turn: match.event.data.turn, calls: new Map(), images: [] }
  },
  update: (context, match) => {
    if (match.event.type === 'tool/call') {
      const calls = new Map(context.state.calls)
      calls.set(String(match.event.data.callId), match.event.data.name === 'novelai_generate')
      return { ...context.state, calls }
    }
    if (match.event.type !== 'tool/result') return context.state
    const callId = String(match.event.data.message.source.callId)
    if (context.state.calls.get(callId) !== true) return context.state
    const content = match.event.data.message.content
    const found: TurnImage[] = []
    for (const block of Array.isArray(content) ? content : []) {
      const attachment = imageRefOf(block)
      if (attachment !== undefined) found.push({ seq: match.event.seq, attachment })
    }
    return found.length === 0
      ? context.state
      : { ...context.state, images: [...context.state.images, ...found] }
  },
  buildLocationData: (context, scope) => scope !== 'turn' || context.state === undefined
    ? null
    : {
      kind: 'turn',
      turn: context.state.turn,
      key: 'novelai-images',
      value: { images: context.state.images },
    },
}
