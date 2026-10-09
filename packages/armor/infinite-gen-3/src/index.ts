/**
 * 无限三代 (Infinite Generation Three) armor plugin, host half: the always-on
 * armor system-prompt section, the `infinite_gen3_profile` self-description
 * tool, and the `armor` projection that scores every completed assistant
 * message for the browser badge. First-party continuation of
 * Minglink/dsh-infinite-gen-3 v0.5.0 (MIT).
 *
 * @module @deepseek-ai/dsh-infinite-gen-3
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: resolves the optional ctx.sessionProjections service declaration
// and registers the project-reference redirect for the /types augmentation.
import type {} from '@deepseek-ai/dsh-session-projection/types'
import { ARMOR_PROMPT_ORDER, ARMOR_PROMPT_SECTION_NAME, ARMOR_PROMPT_TEXT } from './prompt.ts'
import { armorProjectionDefinition } from './projection.ts'
import { infiniteGen3ProfileTool } from './tool.ts'

export type { ArmorProjection, ArmorVerdict } from './types.ts'
export { ARMOR_IDLE, armorFold, armorScore } from './armor.ts'
export { armorProjectionDefinition } from './projection.ts'
export { ARMOR_PROMPT_ORDER, ARMOR_PROMPT_SECTION_NAME, ARMOR_PROMPT_TEXT } from './prompt.ts'

/** Stable Cordis plugin name. */
export const name = 'dsh-infinite-gen-3'

/** Required services: the prompt seam and the tool registry. */
export const inject = ['tools', 'systemPrompt']

/**
 * Register the armor prompt section, the profile tool, and the armor
 * projection; every registration is an effect on this plugin's fiber, so
 * unloading removes all three.
 * @param ctx - registrant context carrying the prompt and tool services.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.systemPrompt.section({
    name: ARMOR_PROMPT_SECTION_NAME,
    order: ARMOR_PROMPT_ORDER,
    text: ARMOR_PROMPT_TEXT,
  }), 'infinite-gen-3: prompt section')
  ctx.effect(() => ctx.tools.register(infiniteGen3ProfileTool), 'infinite-gen-3: profile tool')
  // Optional service via strict ctx.get: minimal compositions (tests, headless
  // fixtures without the projection carrier) load this plugin without one.
  const projections = ctx.get('sessionProjections')
  if (projections !== undefined) {
    ctx.effect(() => projections.register(armorProjectionDefinition), 'infinite-gen-3: armor projection')
  }
}
