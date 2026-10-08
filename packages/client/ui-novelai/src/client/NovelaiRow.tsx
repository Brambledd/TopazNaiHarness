import { useState, type KeyboardEvent } from 'react'
import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './NovelaiRow.module.css'

/** Row lifecycle derived solely from the durable call slice. */
type NovelaiRowState = 'running' | 'ok' | 'error' | 'stopped'

/** Compact, replay-stable view model. */
interface NovelaiRowModel {
  readonly prompt: string
  readonly output: string | null
  readonly errorSummary: string | null
  readonly state: NovelaiRowState
}

type NovelaiRowProps = ToolCallViewProps & PropsLocale<'novelai'>

/** First physical line of a text block. */
function firstLine(text: string): string {
  const newline = text.indexOf('\n')
  return newline === -1 ? text : text.slice(0, newline)
}

/** Flatten durable result blocks under the generic Tool-row text contract. */
function resultText(block: ToolCallViewProps['block']): string | null {
  if (!('kind' in block)) return null
  const parts: string[] = []
  for (const item of block.content) {
    parts.push(item.type === 'text' ? item.text : JSON.stringify(item, null, 2))
  }
  if (parts.length === 0 && block.error !== undefined) {
    parts.push(`${block.error.name}: ${block.error.code}`)
  }
  return parts.join('\n') || null
}

/** Derive the display model without consulting any live service. */
function novelaiRowModel(block: ToolCallViewProps['block']): NovelaiRowModel {
  const settled = 'kind' in block
  const argsRaw = (settled ? block.call?.argsRaw : block.argsRaw) ?? ''
  const state: NovelaiRowState = !settled
    ? 'running'
    : block.error?.code === 'interrupted'
      ? 'stopped'
      : block.isError ? 'error' : 'ok'
  const output = resultText(block)
  let prompt = firstLine(argsRaw)
  try {
    const parsed = JSON.parse(argsRaw) as unknown
    if (typeof parsed === 'object' && parsed !== null) {
      const value = (parsed as Record<string, unknown>).prompt
      if (typeof value === 'string' && value !== '') prompt = firstLine(value)
    }
  } catch {
    // Streaming can expose a truncated JSON prefix; the raw first line stands.
  }
  return {
    prompt: prompt === '' ? block.callId : prompt,
    output,
    errorSummary: state === 'error' && output !== null ? firstLine(output) : null,
    state,
  }
}

/**
 * Render one `novelai_generate` call as a compact process row. The produced
 * image itself lives in the turn-tail chain under the closing assistant
 * message — the answer body — not inside this process fold.
 * @param props - keyed toolview payload and the locale seat.
 * @returns the dedicated NovelAI process row.
 */
export function NovelaiRow({ block, t }: NovelaiRowProps) {
  const model = novelaiRowModel(block)
  const [expanded, setExpanded] = useState(false)
  const summary = model.errorSummary ?? model.prompt
  const expandable = model.output !== null
  const open = expanded && expandable
  const toggleExpand = (): void => { setExpanded(value => !value) }
  const toggleFromKeyboard = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!expandable || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    toggleExpand()
  }
  const disclosureProps = expandable ? {
    role: 'button' as const,
    tabIndex: 0,
    'aria-expanded': open,
    onClick: toggleExpand,
    onKeyDown: toggleFromKeyboard,
  } : {}

  return (
    <div className={css.card} data-tool="novelai_generate" data-state={model.state}>
      <div
        className={css.row}
        data-expandable={expandable || undefined}
        {...disclosureProps}
      >
        <span className={css.leading}>
          {model.state === 'error' ? <StateDot state="error" />
            : model.state === 'stopped' ? <StateDot state="warning" />
              : <StateDot state={model.state === 'running' ? 'ongoing' : 'done'} />}
        </span>
        <span className={css.title}>{t('row.title')}</span>
        <span className={css.separator} aria-hidden />
        <span className={model.errorSummary === null ? css.summary : `${css.summary} ${css.errorSummary}`}>
          {summary}
        </span>
      </div>
      {open ? (
        <section className={css.detailsCard} aria-label={t('row.details')}>
          <div className={css.detailsHeader}>{t('row.details')}</div>
          <pre className={css.details} data-error={model.state === 'error' || undefined}>{model.output}</pre>
        </section>
      ) : null}
    </div>
  )
}
