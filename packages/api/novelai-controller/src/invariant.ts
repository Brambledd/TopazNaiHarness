/**
 * No runtime invariant: the package owns no harness-internal event or data relation —
 * its outputs are workspace files (PNG library) owned by the operator's output
 * directory, and its Remote namespace is validated by the generated codec layer.
 * @module @deepseek-ai/dsh-api-novelai-controller/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-api-novelai-controller'

/** Cordis companion plugin name. */
export const name = 'api-novelai-controller-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: Remote verbs over per-call HTTP round trips own no durable harness relation to check. */
const install: InvariantInstaller = Object.assign((_ctx: Context, _fail: InvariantFailure) => {}, {})

/**
 * Register the (empty) invariant companion so the package reserves its manifest name.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
