/** Workbench presentation components (pure props; all data via inject). */
import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  NovelaiCatalogValue,
  NovelaiGenerateRequest,
  NovelaiGenerationValue,
} from '@deepseek-ai/dsh-api-novelai-controller/types'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  RESOLUTION_RATIOS,
  RESOLUTION_TIERS,
  maxDimensionFor,
  nearestRatio,
  nearestTier,
  resolutionForTier,
  snapDimensionWithinArea,
} from './resolution.ts'
import { PromptTextarea } from './autocomplete.tsx'
import type { WorkbenchInjected } from './injected.ts'
import css from './workbench.module.css'

type Tier = (typeof RESOLUTION_TIERS)[number]

/** Tier label keys, dot-free so they stay plain locale dictionary members. */
const TIER_LABEL_KEYS: Record<Tier, 'param.tier.0_4' | 'param.tier.1' | 'param.tier.1_5' | 'param.tier.2' | 'param.tier.3'> = {
  0.4: 'param.tier.0_4',
  1: 'param.tier.1',
  1.5: 'param.tier.1_5',
  2: 'param.tier.2',
  3: 'param.tier.3',
}

/** Workbench center surface: prompt, full parameter panel, generation, and history. */
export function WorkbenchRoot({
  catalog,
  estimate,
  generate,
  history,
  suggestTags,
  readEntry,
  setViewMode,
  t,
}: PropsRuntime<'workbench'> & WorkbenchInjected & PropsLocale<'novelai-workbench'>) {
  const [catalogValue, setCatalogValue] = useState<NovelaiCatalogValue | undefined>(undefined)
  const [prompt, setPrompt] = useState('')
  const [negativePrompt, setNegativePrompt] = useState('')
  const [negativeOpen, setNegativeOpen] = useState(false)
  const [model, setModel] = useState('')
  const [sampler, setSampler] = useState('')
  const [noiseSchedule, setNoiseSchedule] = useState('')
  const [width, setWidth] = useState(0)
  const [height, setHeight] = useState(0)
  const [steps, setSteps] = useState(28)
  const [cfgScale, setCfgScale] = useState(5)
  const [seedMode, setSeedMode] = useState<'random' | 'fixed'>('random')
  const [seed, setSeed] = useState(0)
  const [lastSeed, setLastSeed] = useState<number | undefined>(undefined)
  const [anlas, setAnlas] = useState<number | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [done, setDone] = useState<string | undefined>(undefined)
  const [entries, setEntries] = useState<readonly NovelaiGenerationValue[]>([])
  const [lightbox, setLightbox] = useState<NovelaiGenerationValue | undefined>(undefined)
  const urlCache = useRef(new Map<string, string>())

  // One-time catalog load seeds every dropdown and the workbench defaults.
  useEffect(() => {
    let cancelled = false
    catalog().then((value) => {
      if (cancelled) return
      setCatalogValue(value)
      setModel(current => current || value.defaults.model)
      setSampler(current => current || value.defaults.sampler)
      setNoiseSchedule(current => current || value.defaults.noiseSchedule)
      setWidth(current => current || value.defaults.width)
      setHeight(current => current || value.defaults.height)
      setSteps(value.defaults.steps)
      setCfgScale(value.defaults.cfgScale)
    }).catch((e: unknown) => { setError(e instanceof Error ? e.message : String(e)) })
    return () => { cancelled = true }
  }, [catalog])

  // Initial history page, refreshed after every generation.
  useEffect(() => {
    let cancelled = false
    history().then((page) => {
      if (!cancelled) setEntries(page.entries)
    }).catch(() => { /* the grid stays empty; generation reports its own failures */ })
    return () => { cancelled = true }
  }, [history])

  // Live Anlas quote, debounced across width/height/steps edits.
  useEffect(() => {
    if (width <= 0 || height <= 0) return undefined
    let cancelled = false
    const timer = setTimeout(() => {
      estimate({ width, height, steps }).then((value) => {
        if (!cancelled) setAnlas(value.anlas)
      }).catch(() => { /* the quote is advisory; generation reports real failures */ })
    }, 350)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [width, height, steps, estimate])

  // Revoke every minted object URL when the surface unmounts.
  useEffect(() => () => {
    for (const url of urlCache.current.values()) URL.revokeObjectURL(url)
    urlCache.current.clear()
  }, [])

  const tier = useMemo(() => nearestTier(width, height), [width, height])
  const ratio = useMemo(() => nearestRatio(width, height), [width, height])

  const applyTierRatio = (nextTier: Tier | null, nextRatio: string): void => {
    if (nextTier === null) return
    const size = resolutionForTier(nextTier, nextRatio as (typeof RESOLUTION_RATIOS)[number])
    setWidth(size.width)
    setHeight(size.height)
  }

  const refreshHistory = (): void => {
    history().then((page) => { setEntries(page.entries) }).catch(() => { /* keep the current page */ })
  }

  const submit = (request: NovelaiGenerateRequest): void => {
    setBusy(true)
    setError(undefined)
    generate(request).then((value) => {
      setDone(value.file)
      if (value.seed !== undefined) setLastSeed(value.seed)
      refreshHistory()
    }).catch((e: unknown) => { setError(e instanceof Error ? e.message : String(e)) }).finally(() => { setBusy(false) })
  }

  const submitCurrent = (): void => {
    const request: NovelaiGenerateRequest = {
      prompt,
      model,
      width,
      height,
      steps,
      cfgScale,
      sampler,
      noiseSchedule,
      ...(negativePrompt.trim() === '' ? {} : { negativePrompt }),
      ...(seedMode === 'fixed' ? { seed } : {}),
    }
    submit(request)
  }

  /** One-click variation: the entry's parameters with a fresh random seed. */
  const submitVariation = (entry: NovelaiGenerationValue): void => {
    if (entry.prompt === undefined) return
    setPrompt(entry.prompt)
    setNegativePrompt(entry.negativePrompt ?? '')
    if (entry.model !== undefined) setModel(entry.model)
    if (entry.width !== undefined) setWidth(entry.width)
    if (entry.height !== undefined) setHeight(entry.height)
    if (entry.steps !== undefined) setSteps(entry.steps)
    setSeedMode('random')
    submit({
      prompt: entry.prompt,
      ...(entry.model === undefined ? {} : { model: entry.model }),
      ...(entry.width === undefined ? {} : { width: entry.width }),
      ...(entry.height === undefined ? {} : { height: entry.height }),
      ...(entry.steps === undefined ? {} : { steps: entry.steps }),
      cfgScale,
      sampler,
      noiseSchedule,
      ...(entry.negativePrompt === undefined || entry.negativePrompt.trim() === '' ? {} : { negativePrompt: entry.negativePrompt }),
    })
    setLightbox(undefined)
  }

  /** Backfill the panel from one history entry (sampler and schedule stay as set). */
  const backfill = (entry: NovelaiGenerationValue): void => {
    if (entry.prompt !== undefined) setPrompt(entry.prompt)
    setNegativePrompt(entry.negativePrompt ?? '')
    if (entry.negativePrompt !== undefined && entry.negativePrompt.trim() !== '') setNegativeOpen(true)
    if (entry.model !== undefined) setModel(entry.model)
    if (entry.width !== undefined) setWidth(entry.width)
    if (entry.height !== undefined) setHeight(entry.height)
    if (entry.steps !== undefined) setSteps(entry.steps)
    if (entry.seed !== undefined) {
      setSeedMode('fixed')
      setSeed(entry.seed)
    }
    setDone(undefined)
    setLightbox(undefined)
  }

  /** Mint (or reuse) the object URL of one entry's PNG. */
  const entryUrl = (entry: NovelaiGenerationValue): string | undefined => {
    const cached = urlCache.current.get(entry.id)
    if (cached !== undefined) return cached
    if (entry.bytes > 8_000_000) return undefined
    void readEntry({ id: entry.id }).then((content) => {
      const bytes = Uint8Array.from(atob(content.data), ch => ch.charCodeAt(0))
      const url = URL.createObjectURL(new Blob([bytes], { type: content.mime }))
      urlCache.current.set(entry.id, url)
      const img = document.querySelector<HTMLImageElement>(`img[data-entry-id="${entry.id}"]`)
      if (img !== null) img.src = url
    }).catch(() => { /* the tile keeps its placeholder */ })
    return undefined
  }

  return (
    <div className={css.root}>
      <button type="button" className={css.backButton} onClick={() => { setViewMode('conversation') }}>
        {t('mode.conversation')}
      </button>
      <label className={css.section}>
        <span className={css.fieldLabel}>{t('prompt.label')}</span>
        <PromptTextarea
          value={prompt}
          onChange={setPrompt}
          suggest={word => suggestTags({ prompt: word, model }).then(value => value.tags)}
          placeholder={t('prompt.placeholder')}
          ariaLabel={t('prompt.label')}
          className={css.promptArea}
        />
      </label>
      <div className={css.section}>
        <button
          type="button"
          className={css.foldHeader}
          aria-expanded={negativeOpen}
          onClick={() => { setNegativeOpen(open => !open) }}
        >
          <span className={`${css.chevron} ${negativeOpen ? css.chevronOpen : ''}`}>▾</span>
          {t('negative.label')}
        </button>
        {negativeOpen && (
          <PromptTextarea
            value={negativePrompt}
            onChange={setNegativePrompt}
            suggest={word => suggestTags({ prompt: word, model }).then(value => value.tags)}
            placeholder={t('negative.placeholder')}
            ariaLabel={t('negative.label')}
            className={css.negativeArea}
          />
        )}
      </div>
      <div className={css.paramGrid}>
        <label className={css.field}>
          <span className={css.fieldLabel}>{t('param.model')}</span>
          <select className={css.select} value={model} onChange={(e) => { setModel(e.target.value) }}>
            {(catalogValue?.models ?? []).map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label className={css.field}>
          <span className={css.fieldLabel}>{t('param.sampler')}</span>
          <select className={css.select} value={sampler} onChange={(e) => { setSampler(e.target.value) }}>
            {(catalogValue?.samplers ?? []).map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className={css.field}>
          <span className={css.fieldLabel}>{t('param.noiseSchedule')}</span>
          <select className={css.select} value={noiseSchedule} onChange={(e) => { setNoiseSchedule(e.target.value) }}>
            {(catalogValue?.noiseSchedules ?? []).map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className={css.field}>
          <span className={css.fieldLabel}>{t('param.tier')}</span>
          <select
            className={css.select}
            value={tier === null ? 'custom' : String(tier)}
            onChange={(e) => { applyTierRatio(e.target.value === 'custom' ? null : Number(e.target.value) as Tier, ratio ?? '2:3') }}
          >
            {RESOLUTION_TIERS.map(value => (
              <option key={value} value={String(value)}>{t(TIER_LABEL_KEYS[value])}</option>
            ))}
            <option value="custom">{t('param.custom')}</option>
          </select>
        </label>
        <label className={css.field}>
          <span className={css.fieldLabel}>{t('param.ratio')}</span>
          <select
            className={css.select}
            value={ratio ?? 'custom'}
            onChange={(e) => { if (tier !== null) applyTierRatio(tier, e.target.value) }}
          >
            {RESOLUTION_RATIOS.map(r => <option key={r} value={r}>{r}</option>)}
            <option value="custom">{t('param.custom')}</option>
          </select>
        </label>
        <div className={css.field}>
          <span className={css.fieldLabel}>{t('param.size')}</span>
          <div className={css.sizeRow}>
            <input
              type="number"
              className={css.number}
              aria-label={t('param.width')}
              value={width || ''}
              min={64}
              max={maxDimensionFor(height)}
              step={64}
              onChange={(e) => { setWidth(Number(e.target.value)) }}
              onBlur={(e) => { setWidth(snapDimensionWithinArea(Number(e.target.value), height, width)) }}
              onKeyDown={(e) => { if (e.key === 'Enter') setWidth(snapDimensionWithinArea(Number(e.currentTarget.value), height, width)) }}
            />
            <span>×</span>
            <input
              type="number"
              className={css.number}
              aria-label={t('param.height')}
              value={height || ''}
              min={64}
              max={maxDimensionFor(width)}
              step={64}
              onChange={(e) => { setHeight(Number(e.target.value)) }}
              onBlur={(e) => { setHeight(snapDimensionWithinArea(Number(e.target.value), width, height)) }}
              onKeyDown={(e) => { if (e.key === 'Enter') setHeight(snapDimensionWithinArea(Number(e.currentTarget.value), width, height)) }}
            />
          </div>
          <span className={css.sizeHint}>{t('size.commitHint')}</span>
        </div>
        <label className={css.field}>
          <span className={css.fieldLabel}>{t('param.steps')}</span>
          <input
            type="number"
            className={css.number}
            value={steps}
            min={1}
            max={50}
            onChange={(e) => { setSteps(Math.max(1, Math.min(50, Math.round(Number(e.target.value) || 1)))) }}
          />
        </label>
        <label className={css.field}>
          <span className={css.fieldLabel}>{t('param.cfgScale')}</span>
          <input
            type="number"
            className={css.number}
            value={cfgScale}
            min={0}
            max={10}
            step={0.1}
            onChange={(e) => { setCfgScale(Math.max(0, Math.min(10, Number(e.target.value)))) }}
          />
        </label>
      </div>
      <div className={css.seedRow}>
        <span className={css.fieldLabel}>{t('seed.mode')}</span>
        <div className={css.seedSwitch} role="group" aria-label={t('seed.mode')}>
          <button
            type="button"
            className={`${css.seedSegment} ${seedMode === 'random' ? css.seedSegmentActive : ''}`}
            aria-pressed={seedMode === 'random'}
            onClick={() => { setSeedMode('random') }}
          >
            🎲 {t('seed.random')}
          </button>
          <button
            type="button"
            className={`${css.seedSegment} ${seedMode === 'fixed' ? css.seedSegmentActive : ''}`}
            aria-pressed={seedMode === 'fixed'}
            onClick={() => { setSeedMode('fixed') }}
          >
            🔒 {t('seed.fixed')}
          </button>
        </div>
        {seedMode === 'fixed' && (
          <>
            <input
              type="number"
              className={`${css.number} ${css.seedValue}`}
              aria-label={t('seed.fixedValue')}
              value={seed}
              min={0}
              max={catalogValue?.maxSeed}
              onChange={(e) => { setSeed(Math.max(0, Math.floor(Number(e.target.value) || 0))) }}
            />
            <button
              type="button"
              className={css.seedDice}
              title={t('seed.randomize')}
              onClick={() => { setSeed(Math.floor(Math.random() * (catalogValue?.maxSeed ?? 4294967295)) + 1) }}
            >
              🎲 {t('seed.randomize')}
            </button>
          </>
        )}
        {lastSeed !== undefined && (
          <span className={css.sizeHint}>{t('seed.lastLabel')} {lastSeed}</span>
        )}
      </div>
      <div className={css.footer}>
        <span className={css.estimate}>
          {t('estimate')}: <span className={css.estimateValue}>{anlas === undefined ? '…' : anlas === 0 ? t('estimate.free') : String(anlas)}</span>
        </span>
        {error !== undefined && <p className={css.errorText} role="alert">{t('error')}: {error}</p>}
        {done !== undefined && <p className={css.doneText}>{done}</p>}
        <button type="button" className={css.generateButton} disabled={busy || prompt.trim() === ''} onClick={submitCurrent}>
          {busy ? t('generating') : t('generate')}
        </button>
      </div>
      <div className={css.section}>
        <span className={css.fieldLabel}>{t('history.label')}</span>
        {entries.length === 0
          ? <p className={css.doneText}>{t('history.empty')}</p>
          : (
            <div className={css.historyGrid}>
              {entries.map(entry => (
                <button
                  key={entry.id}
                  type="button"
                  className={css.historyItem}
                  onClick={() => { setLightbox(entry) }}
                  aria-label={entry.prompt ?? entry.id}
                >
                  <img
                    data-entry-id={entry.id}
                    className={css.historyThumb}
                    loading="lazy"
                    alt={entry.prompt ?? entry.id}
                    src={entryUrl(entry)}
                  />
                </button>
              ))}
            </div>
          )}
      </div>
      {lightbox !== undefined && (
        <div
          className={css.lightbox}
          role="dialog"
          aria-modal="true"
          onClick={(event) => { if (event.target === event.currentTarget) setLightbox(undefined) }}
          onKeyDown={(event) => { if (event.key === 'Escape') setLightbox(undefined) }}
        >
          <div className={css.lightboxBody}>
            <img className={css.lightboxImg} alt={lightbox.prompt ?? lightbox.id} src={entryUrl(lightbox)} />
            <div className={css.lightboxMeta}>
              <span className={css.doneText}>{lightbox.file}</span>
              <span className={css.sizeHint}>
                {lightbox.width === undefined ? '' : `${lightbox.width}×${lightbox.height} · `}
                {lightbox.seed === undefined ? '' : `${t('seed.mode')} ${lightbox.seed} · `}
                {lightbox.steps === undefined ? '' : `${t('param.steps')} ${lightbox.steps}`}
              </span>
              <div className={css.lightboxActions}>
                <button type="button" className={css.backButton} onClick={() => { backfill(lightbox) }}>
                  {t('lightbox.backfill')}
                </button>
                {lightbox.prompt !== undefined && (
                  <button type="button" className={css.backButton} disabled={busy} onClick={() => { submitVariation(lightbox) }}>
                    {t('lightbox.variant')}
                  </button>
                )}
                <button type="button" className={css.backButton} onClick={() => { setLightbox(undefined) }}>
                  {t('lightbox.close')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
