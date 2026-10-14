/**
 * The `novelai_prompt_patch` proposal model: validation and normalization of
 * the model's structured operations into the plain records the patch card
 * renders and the workbench applies.
 * @module @deepseek-ai/dsh-tool-novelai/patch
 */

/** Settings fields a settings-slot patch may carry (mirrors the workbench panel). */
export const SETTINGS_FIELDS = [
  'model', 'width', 'height', 'steps', 'cfgScale', 'sampler', 'noiseSchedule', 'seed',
] as const

/** Model-facing description of the patch tool. */
export const PATCH_DESCRIPTION =
  'Propose a precise edit to the NovelAI workbench prompt instead of restating the whole prompt: '
  + 'one call carries the slot (positive / negative / settings / characters) and an ordered operation list '
  + '(add a tag, remove a tag, modify a tag to a new spelling, or set a settings field). '
  + 'MULTI-CHARACTER SCENES MUST USE THE CHARACTERS SLOT: give every character its own operations with its '
  + '1-based `character` number (new numbers create that character card), and keep only the SHARED scene tags '
  + '(setting, lighting, composition, quality tags) on the positive slot — never write several characters as '
  + 'plain tags on the positive slot. '
  + 'USE THIS FIRST whenever the user requests a new scene or any visual change: emit the needed tags '
  + 'as one patch per slot, tell the user to click 应用 in the card, and only then call novelai_generate. '
  + 'generation always runs off the workbench\'s live prompt — a requested scene that never reached '
  + 'the workbench will not appear in the image.'

/** Model arguments of the patch tool after schema validation. */
export interface PatchArgs {
  slot: 'positive' | 'negative' | 'settings' | 'characters'
  operations: Array<{ op: 'add' | 'remove' | 'modify'; tag?: string; field?: string; value?: string; character?: number }>
}

/**
 * Validate and normalize a patch proposal: tag ops need a tag (modify a
 * replacement value), settings ops need a known field and a value. The result
 * is plain string records so it crosses the lossless-JSON result boundary.
 * @param args - validated model arguments.
 * @returns the normalized patch the card renders.
 */
export function normalizePatch(args: PatchArgs): { slot: string; operations: Array<Record<string, string>> } {
  if (args.operations.length === 0) {
    throw new Error('empty operations: propose at least one add/remove/modify')
  }
  const operations = args.operations.map((operation, index): Record<string, string> => {
    const where = `operations[${index}]`
    if (args.slot === 'settings') {
      if (operation.field === undefined || !SETTINGS_FIELDS.includes(operation.field as (typeof SETTINGS_FIELDS)[number])) {
        throw new Error(`${where}: settings ops need field in {${SETTINGS_FIELDS.join(', ')}}`)
      }
      if (operation.value === undefined || operation.value.trim() === '') {
        throw new Error(`${where}: settings ops need a value`)
      }
      return { op: 'modify', field: operation.field, value: operation.value.trim() }
    }
    if (args.slot === 'characters') {
      if (operation.character === undefined || !Number.isInteger(operation.character) || operation.character < 1) {
        throw new Error(`${where}: characters-slot ops need a 1-based integer character number`)
      }
      if (operation.tag === undefined || operation.tag.trim() === '') {
        throw new Error(`${where}: characters-slot ops need a tag`)
      }
      if (operation.op === 'modify' && (operation.value === undefined || operation.value.trim() === '')) {
        throw new Error(`${where}: modify needs the replacement value`)
      }
      const characterRecord: Record<string, string> = {
        op: operation.op, character: String(operation.character), tag: operation.tag.trim(),
      }
      if (operation.op === 'modify' && operation.value !== undefined) characterRecord['value'] = operation.value.trim()
      return characterRecord
    }
    if (operation.tag === undefined || operation.tag.trim() === '') {
      throw new Error(`${where}: ${args.slot}-slot ops need a tag`)
    }
    if (operation.op === 'modify' && (operation.value === undefined || operation.value.trim() === '')) {
      throw new Error(`${where}: modify needs the replacement value`)
    }
    const record: Record<string, string> = { op: operation.op, tag: operation.tag.trim() }
    if (operation.op === 'modify' && operation.value !== undefined) record['value'] = operation.value.trim()
    return record
  })
  return { slot: args.slot, operations }
}
