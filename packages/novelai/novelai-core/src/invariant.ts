/**
 * No runtime invariant: this library is a pure function set (request assembly, pricing,
 * response extraction) that registers no plugins and observes no event streams.
 * @module @deepseek-ai/dsh-novelai-core/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-novelai-core'

/** Cordis companion plugin name. */
export const name = 'novelai-core-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: the package owns no durable session relation to check — a pure function set registers nothing observable. */
const install: InvariantInstaller = Object.assign((_ctx: Context, _fail: InvariantFailure) => {}, {})

/**
 * Register the (empty) invariant companion so the package reserves its manifest name.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
