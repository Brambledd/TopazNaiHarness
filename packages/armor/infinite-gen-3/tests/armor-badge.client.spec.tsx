/**
 * ArmorBadge behavior on a real cordis Context + SlotRegistry: the overlay
 * entry follows the conversation.input.overlay declaration and unregisters on
 * fiber teardown; the pill renders from driven projection values — on while
 * idle, running while a turn is in flight, and the scored verdict with
 * domain/marker detail after an answer.
 */
// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply, inject } from '@deepseek-ai/dsh-infinite-gen-3/client'
import { ArmorBadge, type ArmorBadgeProps } from '@deepseek-ai/dsh-infinite-gen-3/src/client/ArmorBadge.tsx'
import { en, zh, type ArmorBadgeKey } from '@deepseek-ai/dsh-infinite-gen-3/src/client/locales.ts'
import type { ArmorProjection } from '@deepseek-ai/dsh-infinite-gen-3/types'

const t = (key: ArmorBadgeKey): string => zh[key]

/** Drive the badge with one projection value; the seat is fully synthetic. */
function mountBadge(armorValue: ArmorProjection | undefined): ReturnType<typeof render> {
  return render(<ArmorBadge {...({
    useProjection: () => armorValue,
    t,
  } as unknown as ArmorBadgeProps)} />)
}

/** The idle armor value plus overrides. */
function armor(overrides: Partial<ArmorProjection> = {}): ArmorProjection {
  return {
    running: false, verdict: null, words: [], safe: [], risk: [], domain: null, domainHits: 0,
    ...overrides,
  }
}

afterEach(cleanup)

describe('armor badge apply wiring', () => {
  async function bench() {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    const slots = ctx.get('slots') as SlotRegistry
    slots.register(
      { name: 'root', children: { 'conversation.input.overlay': { kind: 'list', scope: 'session' } } } as never,
      () => null,
    )
    const locale = new LocaleRuntime(ctx)
    ctx.provide('locale', locale)
    return { ctx, slots, locale }
  }

  it('declares the slots and locale dependencies', () => {
    expect(inject).toEqual(['slots', 'locale'])
  })

  it('registers the bilingual badge dictionaries and the overlay entry, and removes both on teardown', async () => {
    const { ctx, slots, locale } = await bench()
    const fiber = await ctx.plugin({ inject: [...inject], apply })
    expect(slots.entries('conversation.input.overlay').map(entry => entry.options.id)).toEqual(['armor-badge'])
    expect(slots.entries('conversation.input.overlay')[0]?.locale).toBe('infinite-gen-3')
    locale.setLocale('zh')
    expect(locale.bind('infinite-gen-3')('badge.on')).toBe('破甲已开启 · 无限三代 v0.5.0')
    locale.setLocale('en')
    expect(locale.bind('infinite-gen-3')('badge.on')).toBe(en['badge.on'])
    await fiber.dispose()
    expect(slots.entries('conversation.input.overlay')).toHaveLength(0)
  })
})

describe('armor badge rendering', () => {
  it('shows the always-on label while idle', () => {
    mountBadge(armor())
    expect(screen.getByLabelText('破甲已开启 · 无限三代 v0.5.0')).toBeTruthy()
    expect(screen.getByText('破甲已开启 · 无限三代 v0.5.0')).toBeTruthy()
  })

  it('shows the running label while a turn is in flight', () => {
    mountBadge(armor({ running: true }))
    expect(screen.getByText('执行中…')).toBeTruthy()
  })

  it('flashes the scored verdict with domain and marker detail after an answer', async () => {
    mountBadge(armor({ verdict: 'refusal', words: ['我无法'], domain: 'web', domainHits: 2 }))
    await waitFor(() => { expect(screen.getByText('检出拒绝')).toBeTruthy() })
    expect(screen.getByText(/web/)).toBeTruthy()
    expect(screen.getByText(/载荷 1/)).toBeTruthy()
  })

  it('renders nothing verdict-specific when the projection capability is absent', () => {
    mountBadge(undefined)
    expect(screen.getByText('破甲已开启 · 无限三代 v0.5.0')).toBeTruthy()
  })
})
