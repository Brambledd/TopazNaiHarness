/** Sidebar shell slot registration and its Session/layout callbacks. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { SidebarRootInjected } from '@deepseek-ai/dsh-client-ui-sidebar/client'

async function bench(declare = true) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const layout = {
    toggleSidebar: vi.fn(), openDetails: vi.fn(), closeDetails: vi.fn(),
    setViewMode: vi.fn(), enterSession: vi.fn(), exitToFeed: vi.fn(),
  }
  const uiWorkspace = { startSession: vi.fn() }
  ctx.provide('layout', layout)
  ctx.provide('uiWorkspace', uiWorkspace as never)
  ctx.provide('locale', new LocaleRuntime(ctx))
  const slots = ctx.get('slots') as SlotRegistry
  if (declare) {
    slots.register(
      { name: 'root', children: { 'sidebar': { kind: 'single', scope: 'root' } } } as never,
      () => null,
    )
  }
  return { ctx, slots, layout, uiWorkspace }
}

describe('ui-sidebar apply', () => {
  it('declares only the services it uses', () => {
    expect(inject).toEqual(['slots', 'layout', 'uiWorkspace', 'locale'])
  })

  it('registers the shell and declares its child seats', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.slots.entries('sidebar')).toHaveLength(1)
    expect(b.slots.spec('sidebar.brand.mark')).toEqual({ kind: 'single', scope: 'root' })
    expect(b.slots.spec('sidebar.brand.name')).toEqual({ kind: 'single', scope: 'root' })
    expect(b.slots.spec('sidebar.workspaces')).toEqual({ kind: 'single', scope: 'root' })
    expect(b.slots.spec('sidebar.settings')).toEqual({ kind: 'single', scope: 'root' })
    expect(b.slots.spec('sidebar.footer.action')).toEqual({ kind: 'list', scope: 'root' })
    // Copy rides the standard locale seat, not the inject face.
    expect(b.slots.entries('sidebar')[0]!.locale).toBe('sidebar')
    const injected = (b.slots.entries('sidebar')[0]!.inject as () => SidebarRootInjected)()
    expect(Object.keys(injected)).toEqual(['startSession', 'toggleSidebar', 'setViewMode', 'exitToFeed', 'enterSession'])
    // Both arms delegate to the Workspace UI's shared New Session action,
    // and a start lands on the conversation surface at the session level.
    injected.startSession('workspace' as never)
    expect(b.uiWorkspace.startSession).toHaveBeenCalledWith('workspace')
    expect(b.layout.setViewMode).toHaveBeenCalledWith('conversation')
    expect(b.layout.enterSession).toHaveBeenCalled()
    injected.startSession()
    expect(b.uiWorkspace.startSession).toHaveBeenLastCalledWith(undefined)
    expect(b.layout.enterSession).toHaveBeenCalledTimes(2)
    injected.toggleSidebar()
    expect(b.layout.toggleSidebar).toHaveBeenCalledOnce()
    injected.exitToFeed()
    expect(b.layout.exitToFeed).toHaveBeenCalledOnce()
    injected.enterSession()
    expect(b.layout.enterSession).toHaveBeenCalledTimes(3) // two starts + the explicit enter
  })

  it('fails when no live owner declared the sidebar slot', async () => {
    const b = await bench(false)
    await expect(b.ctx.plugin({ inject: [...inject], apply })).rejects.toThrow(/not declared/)
  })

  it('removes the entry and child declaration on teardown', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await fiber.dispose()
    expect(b.slots.entries('sidebar')).toHaveLength(0)
    expect(b.slots.spec('sidebar.brand.mark')).toBeUndefined()
    expect(b.slots.spec('sidebar.brand.name')).toBeUndefined()
    expect(b.slots.spec('sidebar.workspaces')).toBeUndefined()
    expect(b.slots.spec('sidebar.footer.action')).toBeUndefined()
  })
})
