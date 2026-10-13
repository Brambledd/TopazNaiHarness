/**
 * The Settings → General NovelAI generation-directory row: point the shared
 * output library at a directory and clear the override, with the live
 * effective path. Presentational only — the snapshot store and the Host
 * writes live in ./dir-settings.ts.
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { Button, Input, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { NovelaiGenerationDirState, NovelaiGenerationDirStore } from './dir-settings.ts'
import type { NovelaiKey } from './locales.ts'
import css from './DirRow.module.css'

/** Injected dependencies of {@link DirRow} (slot `inject`). */
export interface DirRowInjected {
  hooks: {
    /** Effective directory facts and the last action's outcome. */
    dir: SnapshotStore<NovelaiGenerationDirState>
  }
  /** The directory controller performing the Host reads and writes. */
  controller: NovelaiGenerationDirStore
  /** Row copy. */
  t: (key: NovelaiKey) => string
}

/** The General-row owner passes no props; this row lives on its inject face. */
export type DirRowProps = PropsRuntime<'settings.general.item'> & InjectFace<DirRowInjected>

/**
 * Render the generation-directory row: the labeled input with save/clear
 * actions, the effective path, and the last action's outcome. The first mount
 * triggers the initial read.
 * @param props - the General-row seat with the directory inject face.
 * @returns the row.
 */
export function DirRow(props: DirRowProps): ReactNode {
  const { controller, useDir, t } = props
  const state = useDir(snapshot => snapshot)
  // The draft rides the input once the user edits; undefined shows the Host's
  // fresh effective path after each read.
  const [draft, setDraft] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (state.status === 'idle') void controller.load()
  }, [controller, state.status])

  const draftValue = draft ?? (state.status === 'ready' ? state.dir : '')
  const canWrite = state.status === 'ready' && !state.writing

  return (
    <div className={css.wrap}>
      <div className={css.header}>
        <span className={css.label}>{t('dir.label')}</span>
        <span className={css.state}>
          {state.configured ? <StateDot state="done" /> : null}
          {state.configured ? t('dir.state.configured') : t('dir.state.default')}
        </span>
      </div>
      <p className={css.hint}>{t('dir.hint')}</p>
      <div className={css.row}>
        <Input
          className={css.input}
          value={draftValue}
          placeholder={t('dir.placeholder')}
          onChange={(event) => { setDraft(event.target.value) }}
        />
        <Button
          variant="primary"
          disabled={!canWrite || draftValue.trim() === '' || draftValue === state.dir}
          onClick={() => { void controller.save(draftValue).then(() => { setDraft(undefined) }) }}
        >
          {t('dir.save')}
        </Button>
        <Button
          disabled={!canWrite || !state.configured}
          onClick={() => { void controller.clear().then(() => { setDraft(undefined) }) }}
        >
          {t('dir.clear')}
        </Button>
      </div>
      {state.status === 'ready'
        ? <p className={css.state}>{state.dir}</p>
        : null}
      {state.feedback === undefined
        ? null
        : state.feedback.kind === 'error'
          ? <p className={`${css.feedback} ${css.feedbackError}`} role="alert">{state.feedback.message}</p>
          : (
            <p className={css.feedback}>
              {state.feedback.kind === 'saved' ? t('dir.saved') : t('dir.cleared')}
            </p>
          )}
    </div>
  )
}

export default DirRow
