/** Workbench presentation components (pure props; all data via inject). */
import { useEffect, useMemo, useState } from 'react'
import type {
  NovelaiCatalogValue,
  NovelaiGenerateRequest,
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

/** Workbench center surface: prompt, full parameter panel, and generation. */
export function WorkbenchRoot({
  catalog,
  estimate,
  generate,
  history,
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

  const tier = useMemo(() => nearestTier(width, height), [width, height])
  const ratio = useMemo(() => nearestRatio(width, height), [width, height])

  const applyTierRatio = (nextTier: Tier | null, nextRatio: string): void => {
    if (nextTier === null) return
    const size = resolutionForTier(nextTier, nextRatio as (typeof RESOLUTION_RATIOS)[number])
    setWidth(size.width)
    setHeight(size.height)
  }

  const submit = (): void => {
    setBusy(true)
    setError(undefined)
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
    generate(request).then((value) => {
      setDone(value.file)
      if (value.seed !== undefined) setLastSeed(value.seed)
      return history()
    }).catch((e: unknown) => { setError(e instanceof Error ? e.message : String(e)) }).finally(() => { setBusy(false) })
  }

  return (
    <div className={css.root}>
      <button type="button" className={css.backButton} onClick={() => { setViewMode('conversation') }}>
        {t('mode.conversation')}
      </button>
      <label className={css.section}>
        <span className={css.fieldLabel}>{t('prompt.label')}</span>
        <textarea
          className={css.promptArea}
          value={prompt}
          placeholder={t('prompt.placeholder')}
          onChange={(e) => { setPrompt(e.target.value) }}
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
          <textarea
            className={css.negativeArea}
            value={negativePrompt}
            placeholder={t('negative.placeholder')}
            onChange={(e) => { setNegativePrompt(e.target.value) }}
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
        <button type="button" className={css.generateButton} disabled={busy || prompt.trim() === ''} onClick={submit}>
          {busy ? t('generating') : t('generate')}
        </button>
      </div>
    </div>
  )
}
