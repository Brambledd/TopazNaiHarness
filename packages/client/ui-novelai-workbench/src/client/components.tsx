/** Workbench presentation components (pure props; all data via inject). */
import { useState } from 'react'
import type { ViewMode } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkbenchInjected, ModeSwitchInjected } from './injected.ts'

/** Mode switch: two-segment button reading the live owner-props mode. */
export function ModeSwitch({
  viewMode,
  setViewMode,
  t,
}: PropsRuntime<'sidebar.footer.action'> & ModeSwitchInjected & PropsLocale<'novelai-workbench'>) {
  const mode = (next: ViewMode): void => { setViewMode(next) }
  return (
    <div>
      <button type="button" aria-pressed={viewMode === 'conversation'} onClick={() => mode('conversation')}>
        {t('mode.conversation')}
      </button>
      <button type="button" aria-pressed={viewMode === 'workbench'} onClick={() => mode('workbench')}>
        {t('mode.workbench')}
      </button>
    </div>
  )
}

/** Workbench center surface: prompt form, submit, status, and the back-to-conversation switch. */
export function WorkbenchRoot({
  generate,
  history,
  setViewMode,
  t,
}: PropsRuntime<'workbench'> & WorkbenchInjected & PropsLocale<'novelai-workbench'>) {
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [done, setDone] = useState<string | undefined>(undefined)
  return (
    <div>
      <button type="button" onClick={() => { setViewMode('conversation') }}>
        {t('mode.conversation')}
      </button>
      <label>
        <span>{t('prompt.label')}</span>
        <textarea value={prompt} placeholder={t('prompt.placeholder')} onChange={(e) => { setPrompt(e.target.value) }} />
      </label>
      <button
        type="button"
        disabled={busy || prompt.trim() === ''}
        onClick={() => {
          setBusy(true)
          setError(undefined)
          generate({ prompt }).then((value) => {
            setDone(value?.file ?? value?.id)
            return history()
          }).catch((e: unknown) => { setError(e instanceof Error ? e.message : String(e)) }).finally(() => { setBusy(false) })
        }}
      >
        {busy ? t('generating') : t('generate')}
      </button>
      {error !== undefined && <p role="alert">{t('error')}: {error}</p>}
      {done !== undefined && <p>{done}</p>}
    </div>
  )
}
