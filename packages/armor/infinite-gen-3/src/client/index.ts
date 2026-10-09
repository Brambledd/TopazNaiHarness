/**
 * 无限三代 armor plugin, browser half: registers the `infinite-gen-3` locale
 * dictionaries and the ArmorBadge into the conversation input overlay (the
 * seat above the composer card). The badge reads the `armor` projection the
 * host half folds from committed events; nothing here writes anything.
 *
 * @module @deepseek-ai/dsh-infinite-gen-3
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the 'conversation.input.overlay' SlotMap declaration (the
// composer overlay seat) and the session standard kit's useProjection typing.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { ArmorBadge } from './ArmorBadge.tsx'
import { en, zh, type ArmorBadgeKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Armor badge copy. */
    'infinite-gen-3': ArmorBadgeKey
  }
}

/** Required services: the slot registry and the locale service. */
export const inject = ['slots', 'locale']

/**
 * Register the badge dictionaries and the overlay entry.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register('infinite-gen-3', { zh, en }), 'infinite-gen-3: badge dictionaries')
  ctx.effect(() => {
    const dispose = ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({
      name: 'conversation.input.overlay',
      id: 'armor-badge',
      order: 0,
      locale: 'infinite-gen-3',
    }, ArmorBadge))
    return () => { dispose() }
  }, 'infinite-gen-3: armor badge seat')
}
