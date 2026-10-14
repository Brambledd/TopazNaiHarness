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
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import { WorkbenchRail, WorkbenchRoot } from './components.tsx'
import type { WorkbenchBackfillRequest, WorkbenchPatchRequest } from './bridge.ts'
import type { WorkbenchInjected } from './injected.ts'
import type { NovelaiWorkbenchState as WorkbenchStateMirror } from '@deepseek-ai/dsh-api-novelai-controller/types'
import { en, zh, type WorkbenchKey } from './locales.ts'

export type { NovelaiWorkbenchBridge, WorkbenchBackfillCharacter, WorkbenchBackfillRequest, WorkbenchPatchOperation, WorkbenchPatchRequest } from './bridge.ts'

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
  // Conversation → workbench bridges: the mounted panel subscribes through its
  // inject face; delivery without a panel reports false.
  const backfillSubscribers = new Set<(request: WorkbenchBackfillRequest) => void>()
  const patchSubscribers = new Set<(request: WorkbenchPatchRequest) => void>()
  ctx.effect(() => {
    ctx.provide('novelaiWorkbench', {
      requestBackfill: (request) => {
        if (backfillSubscribers.size === 0) return false
        for (const subscriber of backfillSubscribers) subscriber(request)
        return true
      },
      requestPatchApply: (request) => {
        if (patchSubscribers.size === 0) return false
        for (const subscriber of patchSubscribers) subscriber(request)
        return true
      },
    })
    return () => { backfillSubscribers.clear(); patchSubscribers.clear() }
  }, 'ui-novelai-workbench: backfill bridge')
  ctx.effect(() => ctx.locale.register('novelai-workbench', { zh, en }), 'ui-novelai-workbench: dictionaries')
  // Host mirror resilience: commits persist host-side across restarts, but a
  // connection reset can still swallow an in-flight commit. Cache the last
  // commit per session and re-push every cached state after the reset (the
  // token row's pattern).
  const lastStates = new Map<string, WorkbenchStateMirror>()
  ctx.effect(() => {
    const disposers = [
      ctx.on('connection/reset', () => {
        for (const [sessionId, state] of lastStates) {
          void ctx.remote.novelai.commitWorkbenchState({ sessionId, state }).catch(() => {
            // The next panel change re-commits; a lost re-push heals the same way.
          })
        }
      }),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'ui-novelai-workbench: state mirror re-push')
  /** Shared inject face: both seats (center surface and conversation rail) expose the same verbs.
   * Built once — the apply closure's methods are stable, and a per-render factory would hand the
   * panel freshly-referenced props every render, re-running every effect that depends on a face
   * method (the restore and catalog-seed chains included). */
  const workbenchInjectInstance: WorkbenchInjected = {
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
    anlasBalance: async () => {
      const result = await ctx.remote.novelai.anlasBalance()
      if (!result.ok) throw Object.assign(new Error(result.error.message), result.error)
      return result.value.anlas
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
    commitWorkbenchState: async (sessionId, state) => {
      lastStates.set(sessionId, state)
      const result = await ctx.remote.novelai.commitWorkbenchState({ sessionId: sessionId, state })
      if (!result.ok) throw Object.assign(new Error(result.error.message), result.error)
    },
    readWorkbenchState: async (sessionId) => {
      const result = await ctx.remote.novelai.readWorkbenchState({ sessionId })
      if (!result.ok) throw Object.assign(new Error(result.error.message), result.error)
      return result.value.state
    },
    artistChains: async () => {
      const result = await ctx.remote.novelai.artistChains()
      if (!result.ok) throw Object.assign(new Error(result.error.message), result.error)
      return result.value.chains
    },
    saveArtistChain: async (request) => {
      const result = await ctx.remote.novelai.saveArtistChain(request)
      if (!result.ok) throw Object.assign(new Error(result.error.message), result.error)
      return result.value.chains
    },
    removeArtistChain: async (id) => {
      const result = await ctx.remote.novelai.removeArtistChain({ id })
      if (!result.ok) throw Object.assign(new Error(result.error.message), result.error)
      return result.value.chains
    },
    onBackfillRequest: (callback) => {
      backfillSubscribers.add(callback)
      return () => { backfillSubscribers.delete(callback) }
    },
    onPatchApply: (callback) => {
      patchSubscribers.add(callback)
      return () => { patchSubscribers.delete(callback) }
    },
  }
  const workbenchInject = (): WorkbenchInjected => workbenchInjectInstance
  ctx.effect(() => {
    // The sidebar footer seat is list-kind: the slots API allows no inject
    // face there, so the mode switch lives in the workbench's own top bar for
    // now; a sidebar entry needs a single-kind seat from ui-sidebar first.
    const disposeWorkbench = ctx.slots.inject('workbench', () =>
      ctx.slots.register({
        name: 'workbench',
        locale: 'novelai-workbench',
        inject: workbenchInject,
      }, WorkbenchRoot))
    // The conversation's right rail: the same surface in its rail cut,
    // replacing the details panel's tool body while mounted.
    const disposeRail = ctx.slots.inject('conversation.details.workbench', () =>
      ctx.slots.register({
        name: 'conversation.details.workbench',
        locale: 'novelai-workbench',
        inject: workbenchInject,
      }, WorkbenchRail))
    return () => { disposeWorkbench(); disposeRail() }
  }, 'ui-novelai-workbench: seats')
}
