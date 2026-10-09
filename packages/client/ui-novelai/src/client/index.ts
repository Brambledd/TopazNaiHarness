/**
 * NovelAI client plugin, browser half: the dedicated `novelai_generate` keyed
 * toolview, the turn-image accumulator, the turn-tail images link, and the
 * Settings → General token row over the `NOVELAI_TOKEN` credential.
 */
// Type-only: pulls the locale plugin's Context merge (ctx.locale) and the
// SlotRegistry service merge (ctx.slots), plus the conversation service face.
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: pulls the ctx.remote merge (credentials namespace) and the
// forwarded `credentials/reference-updated` event face into this program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the settings-shell SlotMap merge ('settings.general.item').
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { NovelaiRow } from './NovelaiRow.tsx'
import { TurnImages } from './TurnImages.tsx'
import { selectTurnImages, turnImagesDefinition } from './turn-images.ts'
import { TokenRow, type TokenRowInjected } from './TokenRow.tsx'
import { createNovelaiTokenOperations, NovelaiTokenStore } from './token-settings.ts'
import { en, NS, zh, type NovelaiKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The dedicated NovelAI tool row's copy. */
    novelai: NovelaiKey
  }
}

/** Required services: the slot registry, the conversation image channel, the
 * workbench backfill bridge, the locale service, and the credentials Remote
 * namespace backing the token row. */
export const inject = ['slots', 'uiConversation', 'novelaiWorkbench', 'locale', 'remote', 'remote.credentials']

/**
 * Client plugin body: register the dictionaries, the keyed tool row, the
 * turn-image accumulator, the turn-tail images link, and the General-section
 * token row with its pushed-credential refresh.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-novelai: dictionaries')
  ctx.uiConversation.events.register(turnImagesDefinition)
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview',
    key: 'novelai_generate',
    locale: NS,
    inject: () => ({
      requestBackfill: request => ctx.novelaiWorkbench.requestBackfill(request),
    }),
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

  const tokenStore = new NovelaiTokenStore(createNovelaiTokenOperations(ctx))
  const tokenT = ctx.locale.bind(NS) as TokenRowInjected['t']
  ctx.effect(() => {
    const refresh = (): void => { tokenStore.reloadIfLoaded() }
    const disposers = [
      ctx.remote.$on('credentials/reference-updated', refresh),
      ctx.on('connection/reset', refresh),
    ]
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'ui-novelai: token row invalidations')
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'novelai-token',
    order: 10,
    inject: () => ({
      controller: tokenStore,
      hooks: { token: tokenStore.store },
      t: tokenT,
    }),
  }, TokenRow))
}
