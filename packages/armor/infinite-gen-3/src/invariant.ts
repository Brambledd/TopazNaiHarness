/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-infinite-gen-3`.
 * @module @deepseek-ai/dsh-infinite-gen-3/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-infinite-gen-3'

/** Cordis companion plugin name. */
export const name = 'infinite-gen-3-invariant'

/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the package owns a static prompt section, a pure
 * self-description tool, and a pure projection fold whose wire payload is
 * schema-validated by the projection registry at every emission; the event
 * relations the fold reads (committed `user/message` and `assistant/message`
 * with their message content) are owned and runtime-checked by dsh-agent-loop
 * and the session surface, not here.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
