/**
 * The Settings → General NovelAI token row: paste, save, and clear the
 * `NOVELAI_TOKEN` credential with its live configured state. Presentational
 * only — the snapshot store and the Host writes live in ./token-settings.ts.
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { Button, Input, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { NovelaiTokenState, NovelaiTokenStore } from './token-settings.ts'
import type { NovelaiKey } from './locales.ts'
import css from './TokenRow.module.css'

/** Injected dependencies of {@link TokenRow} (slot `inject`). */
export interface TokenRowInjected {
  hooks: {
    /** Credential facts and the last action's outcome. */
    token: SnapshotStore<NovelaiTokenState>
  }
  /** The token controller performing the Host reads and writes. */
  controller: NovelaiTokenStore
  /** Row copy. */
  t: (key: NovelaiKey) => string
}

/** The General-row owner passes no props; this row lives on its inject face. */
export type TokenRowProps = PropsRuntime<'settings.general.item'> & InjectFace<TokenRowInjected>

/**
 * Render the token row: the labeled input with save/clear actions and the
 * live credential state. The first mount triggers the initial describe;
 * pushed invalidations refresh through the controller.
 * @param props - the General-row seat with the token inject face.
 * @returns the row, or the unavailable note when no provider is mounted.
 */
export function TokenRow(props: TokenRowProps): ReactNode {
  const { controller, useToken, t } = props
  const state = useToken(snapshot => snapshot)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    if (state.status === 'idle') void controller.load()
  }, [controller, state.status])

  const stateText = state.status === 'unavailable'
    ? t('token.state.unavailable')
    : state.configured
      ? `${t('token.state.configured')}${state.source === undefined ? '' : ` · ${state.source}`}`
      : t('token.state.missing')
  const canWrite = state.status === 'ready' && state.writable && !state.writing

  return (
    <div className={css.wrap}>
      <div className={css.header}>
        <span className={css.label}>{t('token.label')}</span>
        <span className={css.state}>
          {state.status === 'unavailable'
            ? null
            : <StateDot state={state.configured ? 'done' : 'warning'} />}
          {stateText}
        </span>
      </div>
      <p className={css.hint}>{t('token.hint')}</p>
      {state.status === 'unavailable'
        ? null
        : (
          <>
            <div className={css.row}>
              <Input
                className={css.input}
                type="password"
                autoComplete="off"
                value={draft}
                placeholder={t('token.placeholder')}
                onChange={(event) =>{  setDraft(event.target.value) }}
              />
              <Button
                variant="primary"
                disabled={!canWrite || draft.trim() === ''}
                onClick={() => { void controller.save(draft).then(() =>{  setDraft('') }) }}
              >
                {t('token.save')}
              </Button>
              <Button
                disabled={!canWrite || !state.configured}
                onClick={() => { void controller.clear() }}
              >
                {t('token.clear')}
              </Button>
            </div>
            {state.status === 'ready' && !state.writable
              ? <p className={css.state}>{t('token.readonly')}</p>
              : null}
            {state.feedback === undefined
              ? null
              : state.feedback.kind === 'error'
                ? <p className={`${css.feedback} ${css.feedbackError}`} role="alert">{state.feedback.message}</p>
                : (
                  <p className={css.feedback}>
                    {state.feedback.kind === 'saved' ? t('token.saved') : t('token.cleared')}
                  </p>
                )}
          </>
        )}
    </div>
  )
}

export default TokenRow
