/**
 * No runtime invariant: this model-facing adapter owns no independent lifecycle stream;
 * execution outcomes are per-call HTTP round trips whose results live in the session log.
 * @module @deepseek-ai/dsh-tool-novelai/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-novelai'

/** Cordis companion plugin name. */
export const name = 'tool-novelai-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Install nothing: the package owns no durable session relation to check. */
const install: InvariantInstaller = Object.assign((_ctx: Context, _fail: InvariantFailure) => {}, {})

/**
 * Register the (empty) invariant companion so the package reserves its manifest name.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
