import { useState } from 'react'
import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkbenchPatchOperation, WorkbenchPatchRequest } from '@deepseek-ai/dsh-client-ui-novelai-workbench/client'
import css from './PatchRow.module.css'

/** One conversation-side patch card's injected bridge. */
interface PatchRowInjected {
  /** Apply the checked operations into the mounted workbench panel. */
  requestPatchApply: (request: WorkbenchPatchRequest) => boolean
}

type PatchRowProps = ToolCallViewProps & PropsLocale<'novelai'> & PatchRowInjected

/** Locale keys per patch slot (shared with the turn-tail card). */
export const SLOT_KEY = {
  positive: 'patch.slot.positive',
  negative: 'patch.slot.negative',
  settings: 'patch.slot.settings',
  characters: 'patch.slot.characters',
} as const

/** Locale keys per operation verb (shared with the turn-tail card). */
export const OP_KEY = { add: 'patch.op.add', remove: 'patch.op.remove', modify: 'patch.op.modify' } as const

/** The patch proposal parsed from the durable call arguments. */
interface PatchModel {
  slot: WorkbenchPatchRequest['slot']
  operations: WorkbenchPatchOperation[]
}

/** Parse `{ slot, operations }` from the call's raw arguments (shared with the turn-tail card). */
export function patchModel(block: ToolCallViewProps['block']): PatchModel | null {
  const settled = 'kind' in block
  const argsRaw = (settled ? block.call?.argsRaw : block.argsRaw) ?? ''
  try {
    const parsed = JSON.parse(argsRaw) as { slot?: unknown; operations?: unknown }
    if (parsed.slot !== 'positive' && parsed.slot !== 'negative' && parsed.slot !== 'settings') return null
    if (!Array.isArray(parsed.operations)) return null
    const operations = parsed.operations.filter((operation): operation is WorkbenchPatchOperation => {
      if (typeof operation !== 'object' || operation === null) return false
      const op = (operation as { op?: unknown }).op
      return op === 'add' || op === 'remove' || op === 'modify'
    })
    return { slot: parsed.slot, operations }
  } catch {
    return null
  }
}

/**
 * Render one `novelai_prompt_patch` call as an apply card: every operation is
 * a checkable row; one apply click hands the checked subset to the mounted
 * workbench panel through the bridge.
 * @param props - the durable call slice, the locale seat, and the patch bridge.
 * @returns the patch card element tree.
 */
export function PatchRow({ block, t, requestPatchApply }: PatchRowProps) {
  const [checked, setChecked] = useState<boolean[] | null>(null)
  const [applied, setApplied] = useState(false)
  const settled = 'kind' in block
  const state = !settled ? 'running' : block.isError ? 'error' : 'done'
  const model = patchModel(block)
  if (model === null) {
    return (
      <div className={css.card} data-tool="novelai_prompt_patch" data-state={state}>
        <StateDot state={state === 'running' ? 'ongoing' : state === 'error' ? 'warning' : 'done'} />
        <span className={css.title}>{t('patch.title')}</span>
        <span className={css.meta}>{t('patch.unreadable')}</span>
      </div>
    )
  }
  const isChecked = (index: number): boolean => checked?.[index] ?? true
  const checkedCount = model.operations.filter((_operation, index) => isChecked(index)).length
  const apply = (): void => {
    const operations = model.operations.filter((_operation, index) => isChecked(index))
    if (operations.length === 0) return
    if (requestPatchApply({ slot: model.slot, operations })) setApplied(true)
  }
  return (
    <div className={css.card} data-tool="novelai_prompt_patch" data-state={state} data-applied={applied || undefined}>
      <div className={css.head}>
        <StateDot state={state === 'running' ? 'ongoing' : state === 'error' ? 'warning' : 'done'} />
        <span className={css.title}>{t('patch.title')}</span>
        <span className={css.slot}>{t(SLOT_KEY[model.slot])}</span>
      </div>
      <ul className={css.operations}>
        {model.operations.map((operation, index) => (
          <li key={index} className={css.operation}>
            <label className={css.operationLabel}>
              <input
                type="checkbox"
                checked={isChecked(index)}
                disabled={applied || state === 'running'}
                onChange={() => {
                  setChecked((current) => {
                    const next = (current ?? model.operations.map(() => true)).slice()
                    next[index] = !isChecked(index)
                    return next
                  })
                }}
              />
              <span className={css.verb}>{t(OP_KEY[operation.op])}</span>
              {model.slot === 'characters' && (
                <span className={css.target}>{t('patch.characterN').replace('{n}', operation.character !== undefined ? String(operation.character) : '?')}</span>
              )}
              <span className={css.target}>{operation.field ?? operation.tag}</span>
              {operation.op === 'modify' && operation.value !== undefined && (
                <span className={css.value}>→ {operation.value}</span>
              )}
            </label>
          </li>
        ))}
      </ul>
      <div className={css.actions}>
        {applied
          ? <span className={css.applied}>{t('patch.applied')}</span>
          : (
            <button
              type="button"
              className={css.apply}
              disabled={state === 'running' || checkedCount === 0}
              onClick={apply}
            >
              {t('patch.apply', { n: checkedCount })}
            </button>
          )}
      </div>
    </div>
  )
}
