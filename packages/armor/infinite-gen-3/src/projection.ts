/**
 * The `armor` projection unit: the {@link armorFold} packaged for the
 * session-projection registry with its state schema and whole-state wire view.
 *
 * @module @deepseek-ai/dsh-infinite-gen-3
 */

import { z } from 'zod'
import { ARMOR_IDLE, armorFold } from './armor.ts'

const armorVerdictSchema = z.enum(['pass', 'refusal', 'fallback'])

const armorProjectionSchema = z.object({
  running: z.boolean(),
  verdict: armorVerdictSchema.nullable(),
  words: z.array(z.string()),
  safe: z.array(z.string()),
  risk: z.array(z.string()),
  domain: z.string().nullable(),
  domainHits: z.number().int().nonnegative(),
}).strict()

/** The `armor` unit registered on `ctx.sessionProjections` (exported for the unit spec). */
export const armorProjectionDefinition = {
  key: 'armor' as const,
  stateVersion: 2,
  stateSchema: armorProjectionSchema,
  init: () => ARMOR_IDLE,
  apply: armorFold,
  wire: {
    viewSchema: armorProjectionSchema,
    view: (state: z.infer<typeof armorProjectionSchema>) => state,
  },
}
