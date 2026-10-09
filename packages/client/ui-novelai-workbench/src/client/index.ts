/**
 * NovelAI workbench plugin, browser half: registers the workbench center
 * surface into ui-layout's declared 'workbench' slot and the conversation /
 * workbench mode switch into ui-sidebar's 'sidebar.footer.action' seat. All
 * generation verbs go through the mounted `ctx.remote.novelai` namespace; the
 * mode switch writes through `ctx.layout.setViewMode`. The plugin also provides
 * the `novelaiWorkbench` bridge that lets the conversation's `novelai_generate`
 * card deliver drafts into the mounted panel.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the Conversation service merge (ctx.conversation) that
// carries the composer-draft seeding path.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import { WorkbenchRoot } from './components.tsx'
import type { WorkbenchBackfillRequest } from './bridge.ts'
import type { WorkbenchInjected } from './injected.ts'
import { en, zh, type WorkbenchKey } from './locales.ts'

export type { NovelaiWorkbenchBridge, WorkbenchBackfillRequest } from './bridge.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Workbench surface and mode-switch copy. */
    'novelai-workbench': WorkbenchKey
  }
}

/** Services required by the workbench plugin. Both the 'remote' aggregate and
 * the dot-path 'remote.novelai' namespace are declared, mirroring the
 * ui-conversation / ui-commands inject pattern; 'conversation' seeds the
 * composer draft of the current session. */
export const inject = ['slots', 'layout', 'remote', 'remote.novelai', 'conversation', 'locale']

/** Register the workbench seats and dictionaries.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  // Conversation → workbench backfill bridge: the mounted panel subscribes
  // through its inject face; delivery without a panel reports false.
  const backfillSubscribers = new Set<(request: WorkbenchBackfillRequest) => void>()
  ctx.effect(() => {
    ctx.provide('novelaiWorkbench', {
      requestBackfill: (request) => {
        if (backfillSubscribers.size === 0) return false
        for (const subscriber of backfillSubscribers) subscriber(request)
        return true
      },
    })
    return () => { backfillSubscribers.clear() }
  }, 'ui-novelai-workbench: backfill bridge')
  ctx.effect(() => ctx.locale.register('novelai-workbench', { zh, en }), 'ui-novelai-workbench: dictionaries')
  ctx.effect(() => {
    // The sidebar footer seat is list-kind: the slots API allows no inject
    // face there, so the mode switch lives in the workbench's own top bar for
    // now; a sidebar entry needs a single-kind seat from ui-sidebar first.
    const disposeWorkbench = ctx.slots.inject('workbench', () =>
      ctx.slots.register({
        name: 'workbench',
        locale: 'novelai-workbench',
        inject: (): WorkbenchInjected => ({
          setViewMode: (mode) => { ctx.layout.setViewMode(mode) },
          catalog: async () => {
            const result = await ctx.remote.novelai.catalog()
            if (!result.ok) throw Object.assign(new Error(result.error.message), result.error)
            return result.value
          },
          estimate: async (request) => {
            const result = await ctx.remote.novelai.estimate(request)
            if (!result.ok) throw Object.assign(new Error(result.error.message), result.error)
            return result.value
          },
          generate: async (request) => {
            const result = await ctx.remote.novelai.generate(request)
            if (!result.ok) throw Object.assign(new Error(result.error.message), result.error)
            return result.value
          },
          enhance: async (request) => {
            const result = await ctx.remote.novelai.enhance(request)
            if (!result.ok) throw Object.assign(new Error(result.error.message), result.error)
            return result.value
          },
          reverse: async (request) => {
            const result = await ctx.remote.novelai.reversePrompt(request)
            if (!result.ok) throw Object.assign(new Error(result.error.message), result.error)
            return result.value
          },
          inspect: async (request) => {
            const result = await ctx.remote.novelai.inspectImage(request)
            if (!result.ok) throw Object.assign(new Error(result.error.message), result.error)
            return result.value
          },
          history: async () => {
            const result = await ctx.remote.novelai.history({ limit: 30 })
            if (!result.ok) throw Object.assign(new Error(result.error.message), result.error)
            return result.value
          },
          suggestTags: async (request) => {
            const result = await ctx.remote.novelai.suggestTags(request)
            if (!result.ok) throw Object.assign(new Error(result.error.message), result.error)
            return result.value
          },
          readEntry: async (request) => {
            const result = await ctx.remote.novelai.readEntry(request)
            if (!result.ok) throw Object.assign(new Error(result.error.message), result.error)
            return result.value
          },
          splitCharacters: async (request) => {
            const result = await ctx.remote.novelai.splitCharacters(request)
            if (!result.ok) throw Object.assign(new Error(result.error.message), result.error)
            return result.value
          },
          seedDraft: (sessionId, text) => ctx.conversation.seedDraft(sessionId, text),
          onBackfillRequest: (callback) => {
            backfillSubscribers.add(callback)
            return () => { backfillSubscribers.delete(callback) }
          },
        }),
      }, WorkbenchRoot))
    return () => { disposeWorkbench() }
  }, 'ui-novelai-workbench: seats')
}
