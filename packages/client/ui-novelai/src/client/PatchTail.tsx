import { useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkbenchPatchOperation, WorkbenchPatchRequest } from '@deepseek-ai/dsh-client-ui-novelai-workbench/client'
import { SLOT_KEY, OP_KEY } from './PatchRow.tsx'
import type { TurnPatch } from './patch-tail.ts'
import css from './PatchRow.module.css'

/** The turn-tail patch card's injected bridge. */
export interface PatchTailInjected {
  /** Apply the checked operations into the mounted workbench panel. */
  requestPatchApply: (request: WorkbenchPatchRequest) => boolean
}

/** Matched turn patches plus the locale seat and the patch bridge. */
export type PatchTailProps = {
  matched: readonly TurnPatch[]
} & PropsLocale<'novelai'> & PatchTailInjected

/** Parse `{ slot, operations }` from one call's raw arguments. */
function parsePatch(argsRaw: string): WorkbenchPatchRequest | null {
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
 * Render the turn's prompt-patch proposals under the closing assistant
 * message — outside the collapsed tool-process fold, so the apply cards are
 * visible without expanding anything.
 * @param props - matched turn patches, the locale seat, and the patch bridge.
 * @returns the patch-card tail rows.
 */
export function PatchTail({ matched, t, requestPatchApply }: PatchTailProps) {
  const [appliedIds, setAppliedIds] = useState<ReadonlySet<string>>(new Set())
  const cards: Array<{ patch: TurnPatch; request: WorkbenchPatchRequest }> = []
  for (const patch of matched) {
    const request = parsePatch(patch.argsRaw)
    if (request !== null && request.operations.length > 0) cards.push({ patch, request })
  }
  if (cards.length === 0) return null
  return (
    <>
      {cards.map(({ patch, request }) => (
        <PatchTailCard
          key={patch.callId}
          callId={patch.callId}
          request={request}
          applied={appliedIds.has(patch.callId)}
          onApplied={() => { setAppliedIds(current => new Set(current).add(patch.callId)) }}
          t={t}
          requestPatchApply={requestPatchApply}
        />
      ))}
    </>
  )
}

function PatchTailCard({ request, applied, onApplied, t, requestPatchApply }: {
  callId: string
  request: WorkbenchPatchRequest
  applied: boolean
  onApplied: () => void
  t: PatchTailProps['t']
  requestPatchApply: PatchTailInjected['requestPatchApply']
}): React.ReactNode {
  const [excluded, setExcluded] = useState<ReadonlySet<number>>(new Set())
  const checkedCount = request.operations.length - excluded.size
  return (
    <div className={css.card} data-tool="novelai_prompt_patch-tail" data-applied={applied || undefined}>
      <div className={css.head}>
        <span className={css.title}>{t('patch.title')}</span>
        <span className={css.slot}>{t(SLOT_KEY[request.slot])}</span>
      </div>
      <ul className={css.operations}>
        {request.operations.map((operation, index) => (
          <li key={index} className={css.operation}>
            <label className={css.operationLabel}>
              <input
                type="checkbox"
                checked={!excluded.has(index)}
                disabled={applied}
                onChange={() => {
                  setExcluded((current) => {
                    const next = new Set(current)
                    if (next.has(index)) next.delete(index)
                    else next.add(index)
                    return next
                  })
                }}
              />
              <span className={css.verb}>{t(OP_KEY[operation.op])}</span>
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
              disabled={checkedCount === 0}
              onClick={() => {
                const operations = request.operations.filter((_operation, index) => !excluded.has(index))
                if (operations.length === 0) return
                if (requestPatchApply({ slot: request.slot, operations })) onApplied()
              }}
            >
              {t('patch.apply', { n: checkedCount })}
            </button>
          )}
      </div>
    </div>
  )
}
