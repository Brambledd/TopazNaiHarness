import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import css from './NovelaiRow.module.css'

/** Row lifecycle derived solely from the durable call slice. */
type NovelaiRowState = 'running' | 'ok' | 'error' | 'stopped'

/** The persisted result-metadata image reference after wire validation. */
interface ImageMeta {
  attachmentId: string
  mediaType: string
  width: number
  height: number
  name?: string
}

/** Compact, replay-stable view model. */
interface NovelaiRowModel {
  readonly prompt: string
  readonly output: string | null
  readonly errorSummary: string | null
  readonly image: ImageMeta | undefined
  readonly state: NovelaiRowState
}

type NovelaiRowProps = ToolCallViewProps & PropsLocale<'novelai'>
  & InjectFace<{ loadImage: (attachment: ImageAttachmentRef) => Promise<string> }>

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

/** Validate the persisted metadata image reference; undefined when absent or malformed. */
function imageMeta(meta: unknown): ImageMeta | undefined {
  if (typeof meta !== 'object' || meta === null) return undefined
  const image = (meta as Record<string, unknown>).image
  if (typeof image !== 'object' || image === null) return undefined
  const { attachmentId, mediaType, width, height, name } = image as Record<string, unknown>
  if (typeof attachmentId !== 'string' || attachmentId === '') return undefined
  if (typeof mediaType !== 'string') return undefined
  if (typeof width !== 'number' || typeof height !== 'number') return undefined
  if (name !== undefined && typeof name !== 'string') return undefined
  return name === undefined
    ? { attachmentId, mediaType, width, height }
    : { attachmentId, mediaType, width, height, name }
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
    image: settled ? imageMeta(block.meta) : undefined,
    state,
  }
}

/**
 * Render one `novelai_generate` call: state row, prompt summary, and — when the
 * settled result carries a durable image reference — a click-to-zoom preview.
 * @param props - keyed toolview payload, locale seat, and the image loader.
 * @returns the dedicated NovelAI row.
 */
export function NovelaiRow({ block, t, loadImage }: NovelaiRowProps) {
  // The projection caches blocks, so the derived model stays referentially
  // stable between transcript updates and cannot re-arm the load effect below
  // on unrelated renders.
  const model = useMemo(() => novelaiRowModel(block), [block])
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [zoomed, setZoomed] = useState(false)
  const [expanded, setExpanded] = useState(false)
  // One load attempt per arm; `reload` re-arms after a revoked or broken URL.
  const [attempt, setAttempt] = useState(0)
  const reload = useCallback(() => { setAttempt(value => value + 1) }, [])

  useEffect(() => {
    if (model.image === undefined) return
    let alive = true
    setFailed(false)
    // The reference is the validated wire shape; the brand is type-only.
    loadImage(model.image as unknown as ImageAttachmentRef).then(
      (value) => { if (alive) setUrl(value) },
      () => { if (alive) setFailed(true) },
    )
    return () => { alive = false }
  }, [model.image, loadImage, attempt])

  useEffect(() => {
    if (!zoomed) return
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') setZoomed(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoomed])

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
      {model.image !== undefined && url !== null ? (
        <button
          type="button"
          className={css.thumbButton}
          title={t('row.preview')}
          aria-label={t('row.preview')}
          onClick={() => setZoomed(true)}
        >
          <img
            className={css.thumbnail}
            src={url}
            alt={model.image.name ?? t('row.title')}
            onError={reload}
          />
        </button>
      ) : null}
      {model.image !== undefined && failed ? (
        <button type="button" className={css.loadFailed} onClick={reload}>{t('row.loadFailed')}</button>
      ) : null}
      {open ? (
        <section className={css.detailsCard} aria-label={t('row.details')}>
          <div className={css.detailsHeader}>{t('row.details')}</div>
          <pre className={css.details} data-error={model.state === 'error' || undefined}>{model.output}</pre>
        </section>
      ) : null}
      {zoomed && url !== null ? (
        <div
          className={css.lightbox}
          role="dialog"
          aria-modal="true"
          aria-label={t('row.preview')}
          onClick={() => setZoomed(false)}
        >
          <img className={css.zoomImage} src={url} alt={model.image?.name ?? t('row.title')} />
          <button type="button" className={css.closeButton} aria-label={t('row.close')}>×</button>
        </div>
      ) : null}
    </div>
  )
}
