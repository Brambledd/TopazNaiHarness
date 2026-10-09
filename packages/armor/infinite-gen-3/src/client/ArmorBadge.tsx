/**
 * The armor badge: a floating pill above the composer card showing the live
 * `armor` projection — on while idle, pulsing while a turn runs, and flashing
 * the scored verdict (pass/refusal/fallback) plus domain/marker detail after
 * each completed answer. Ported from dsh-infinite-gen-3 v0.5.0's client half.
 *
 * @module @deepseek-ai/dsh-infinite-gen-3
 */

import { useEffect, useRef, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ArmorVerdict } from '../types.ts'
import css from './armor-badge.module.css'

/** How long a settled verdict stays on the pill before the badge relaxes. */
const VERDICT_FLASH_MS = 2500

export type ArmorBadgeProps = PropsRuntime<'conversation.input.overlay'> & PropsLocale<'infinite-gen-3'>

/**
 * Render the armor status pill from the session's `armor` projection.
 * @param props - the session-scoped overlay seat (useProjection) and locale.
 * @returns the always-on badge anchored above the composer card.
 */
export function ArmorBadge({ useProjection, t }: ArmorBadgeProps) {
  const armor = useProjection('armor')
  const lastVerdictRef = useRef<ArmorVerdict | null>(null)
  const flashUntilRef = useRef(0)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const verdict: ArmorVerdict | null = armor?.verdict ?? null
    if (verdict === lastVerdictRef.current) return
    lastVerdictRef.current = verdict
    if (verdict !== null) {
      flashUntilRef.current = Date.now() + VERDICT_FLASH_MS
      setNow(Date.now())
    }
  }, [armor])

  const running = armor?.running ?? false
  const showingVerdict = !running && lastVerdictRef.current !== null && now < flashUntilRef.current
  const verdict = showingVerdict ? lastVerdictRef.current : null
  const detail: string[] = []
  if (armor?.domain !== null && armor?.domain !== undefined) {
    detail.push(`${t('badge.domain')} ${armor.domain}`)
  }
  const markerCount = (armor?.words.length ?? 0) + (armor?.risk.length ?? 0)
  if (markerCount > 0) detail.push(`${t('badge.markers')} ${String(markerCount)}`)

  const label = running
    ? t('badge.running')
    : verdict === null
      ? t('badge.on')
      : verdict === 'pass'
        ? t('badge.verdict.pass')
        : verdict === 'refusal'
          ? t('badge.verdict.refusal')
          : t('badge.verdict.fallback')

  return (
    <div className={css.wrap}>
      <span
        className={css.badge}
        data-running={running || undefined}
        data-verdict={verdict ?? undefined}
        aria-label={t('badge.on')}
      >
        <span className={css.dot} data-running={running || undefined} aria-hidden />
        {label}
        {detail.length > 0 && <span className={css.detail}>· {detail.join(' · ')}</span>}
      </span>
    </div>
  )
}
