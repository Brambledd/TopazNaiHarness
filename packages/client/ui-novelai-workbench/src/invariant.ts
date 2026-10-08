/**
 * No runtime invariant: the workbench is a pure presentation plugin — its facts
 * live in the layout store (viewMode) and the NovelAI Remote namespace, both
 * owned and validated elsewhere.
 * @module @deepseek-ai/dsh-client-ui-novelai-workbench/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-novelai-workbench'

/** Cordis companion plugin name. */
export const name = 'ui-novelai-workbench-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Install nothing: the package owns no durable harness relation to check. */
const install: InvariantInstaller = Object.assign((_ctx: Context, _fail: InvariantFailure) => {}, {})

/**
 * Register the (empty) invariant companion so the package reserves its manifest name.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
