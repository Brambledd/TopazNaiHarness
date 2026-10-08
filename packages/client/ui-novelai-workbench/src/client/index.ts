/**
 * NovelAI workbench plugin, browser half: registers the workbench center
 * surface into ui-layout's declared 'workbench' slot and the conversation /
 * workbench mode switch into ui-sidebar's 'sidebar.footer.action' seat. All
 * generation verbs go through the mounted `ctx.remote.novelai` namespace; the
 * mode switch writes through `ctx.layout.setViewMode`.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { WorkbenchRoot } from './components.tsx'
import type { WorkbenchInjected } from './injected.ts'
import { en, zh, type WorkbenchKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Workbench surface and mode-switch copy. */
    'novelai-workbench': WorkbenchKey
  }
}

/** Services required by the workbench plugin. Both the 'remote' aggregate and
 * the dot-path 'remote.novelai' namespace are declared, mirroring the
 * ui-conversation / ui-commands inject pattern. */
export const inject = ['slots', 'layout', 'remote', 'remote.novelai', 'locale']

/** Register the workbench seats and dictionaries.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
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
          history: async () => {
            const result = await ctx.remote.novelai.history({ limit: 30 })
            if (!result.ok) throw Object.assign(new Error(result.error.message), result.error)
            return result.value
          },
        }),
      }, WorkbenchRoot))
    return () => { disposeWorkbench() }
  }, 'ui-novelai-workbench: seats')
}
