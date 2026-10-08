/**
 * NovelAI tool row plugin, browser half: registers the dedicated
 * `novelai_generate` keyed toolview. The row derives its state purely from
 * the durable call/result slice; when the settled result carries the
 * persisted image attachment reference (result metadata), the row loads the
 * durable image URL through the conversation service and renders a
 * click-to-zoom preview.
 */
// Type-only: pulls the locale plugin's Context merge (ctx.locale) and the
// SlotRegistry service merge (ctx.slots), plus the conversation service face.
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { NovelaiRow } from './NovelaiRow.tsx'
import { TurnImages } from './TurnImages.tsx'
import { selectTurnImages, turnImagesDefinition } from './turn-images.ts'
import { en, NS, zh, type NovelaiKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The dedicated NovelAI tool row's copy. */
    novelai: NovelaiKey
  }
}

/** Required services: the slot registry, the conversation image channel, and the locale service. */
export const inject = ['slots', 'uiConversation', 'locale']

/**
 * Client plugin body: register the dictionaries, the keyed tool row, the
 * turn-image accumulator, and the turn-tail images link.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-novelai: dictionaries')
  ctx.uiConversation.events.register(turnImagesDefinition)
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview',
    key: 'novelai_generate',
    locale: NS,
  }, NovelaiRow))
  // The image itself renders under the closing assistant message, in the
  // turn-tail chain — the answer body, not the tool process fold.
  ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail',
    select: selectTurnImages,
    locale: NS,
    inject: (sessionId: SessionId) => ({
      loadImage: (attachment: ImageAttachmentRef): Promise<string> =>
        ctx.uiConversation.imageUrl(sessionId, attachment),
    }),
  }, TurnImages))
}
