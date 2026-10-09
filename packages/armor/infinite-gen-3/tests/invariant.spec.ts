/** The invariant companion reserves and releases its package name. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import Invariants from '@deepseek-ai/dsh-invariants'
import * as Invariant from '@deepseek-ai/dsh-infinite-gen-3/invariant'

describe('infinite-gen-3 invariant companion', () => {
  it('registers the package name and releases it on dispose', async () => {
    const ctx = new Context()
    await ctx.plugin(Invariants)
    const fiber = await ctx.plugin(Invariant)
    // The reservation is observable through double registration: an occupied
    // name throws, a released one does not.
    await expect(ctx.plugin(Invariant)).rejects.toThrow('already registered')
    await fiber.dispose()
    await ctx.plugin(Invariant)
    await ctx.fiber.dispose()
  })
})
