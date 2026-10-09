/** Workbench presentation components (pure props; all data via inject). */
import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  NovelaiCatalogValue,
  NovelaiCharacterPromptRequest,
  NovelaiCharacterPromptValue,
  NovelaiGenerateRequest,
  NovelaiGenerationValue,
} from '@deepseek-ai/dsh-api-novelai-controller/types'
import type { WorkbenchBackfillRequest } from './bridge.ts'
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
import { CapsuleBrowser, STYLE_PRESETS } from './capsule-picker.tsx'
import type { WorkbenchInjected } from './injected.ts'
import css from './workbench.module.css'

type Tier = (typeof RESOLUTION_TIERS)[number]

/** Editable per-character caption row of the panel. */
interface CharacterDraft {
  id: string
  prompt: string
  negativePrompt: string
  useCoords: boolean
  x: number
  y: number
}

/** Per-request character capacity of one checkpoint (desktop reference parity). */
function maxCharactersFor(model: string): number {
  if (model.startsWith('nai-diffusion-5-')) return 32
  return model.startsWith('nai-diffusion-4-') ? 6 : 0
}

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
  splitCharacters,
  sendDraft,
  onBackfillRequest,
  setViewMode,
  useSessions,
  t,
}: PropsRuntime<'workbench'> & WorkbenchInjected & PropsLocale<'novelai-workbench'>) {
  const [catalogValue, setCatalogValue] = useState<NovelaiCatalogValue | undefined>(undefined)
  const [prompt, setPrompt] = useState('')
  const [negativePrompt, setNegativePrompt] = useState('')
  const [negativeOpen, setNegativeOpen] = useState(false)
  const [capsuleOpen, setCapsuleOpen] = useState(false)
  const [characters, setCharacters] = useState<CharacterDraft[]>([])
  const [charactersOpen, setCharactersOpen] = useState(false)
  const [splitting, setSplitting] = useState(false)
  const [sending, setSending] = useState(false)
  const characterIdRef = useRef(0)
  const currentSessionId = useSessions(state => state.current)
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
  /** Filmstrip selection; undefined follows the newest entry. */
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)
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
      // Follow the newest entry again: the fresh result lands on the stage.
      setSelectedId(undefined)
      refreshHistory()
    }).catch((e: unknown) => { setError(e instanceof Error ? e.message : String(e)) }).finally(() => { setBusy(false) })
  }

  /** Append one English tag to the positive prompt, comma-separated. */
  const insertTag = (tag: string): void => {
    setPrompt((current) => {
      const trimmed = current.trimEnd().replace(/,\s*$/, '')
      return trimmed === '' ? `${tag}, ` : `${trimmed}, ${tag}, `
    })
  }

  /** Prepend one style tag ahead of the existing prompt. */
  const prependStyle = (tag: string): void => {
    setPrompt((current) => {
      const trimmed = current.trimStart()
      return trimmed === '' ? `${tag}, ` : `${tag}, ${trimmed}`
    })
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
      ...(characters.length === 0 ? {} : { characters: characters.map(toCharacterRequest) }),
      ...(seedMode === 'fixed' ? { seed } : {}),
    }
    submit(request)
  }

  /** Project one draft onto the wire request shape. */
  const toCharacterRequest = (draft: CharacterDraft): NovelaiCharacterPromptRequest => ({
    prompt: draft.prompt,
    ...(draft.negativePrompt.trim() === '' ? {} : { negativePrompt: draft.negativePrompt }),
    useCoords: draft.useCoords,
    x: draft.x,
    y: draft.y,
  })

  /** Mint a fresh local row id. */
  const nextCharacterId = (): string => {
    characterIdRef.current += 1
    return `character-${String(characterIdRef.current)}`
  }

  const addCharacter = (): void => {
    setCharacters(current => [...current, { id: nextCharacterId(), prompt: '', negativePrompt: '', useCoords: false, x: 0.5, y: 0.5 }])
  }

  const updateCharacter = (id: string, patch: Partial<CharacterDraft>): void => {
    setCharacters(current => current.map(draft => (draft.id === id ? { ...draft, ...patch } : draft)))
  }

  const removeCharacter = (id: string): void => {
    setCharacters(current => current.filter(draft => draft.id !== id))
  }

  /** One LLM call: decompose the merged prompt into base plus per-character captions. */
  const splitIntoCharacters = (): void => {
    if (prompt.trim() === '' || splitting) return
    setSplitting(true)
    setError(undefined)
    splitCharacters({ prompt }).then((value) => {
      setPrompt(value.prompt)
      setCharacters(value.characters.map(character => ({
        id: nextCharacterId(),
        prompt: character.prompt,
        negativePrompt: character.negativePrompt,
        useCoords: false,
        x: 0.5,
        y: 0.5,
      })))
      setCharactersOpen(true)
    }).catch((e: unknown) => { setError(e instanceof Error ? e.message : String(e)) }).finally(() => { setSplitting(false) })
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
    if (entry.characters !== undefined) setCharacters(entry.characters.map(toCharacterDraft))
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
      ...(entry.characters === undefined || entry.characters.length === 0 ? {} : { characters: entry.characters }),
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
    setCharacters((entry.characters ?? []).map(toCharacterDraft))
    if (entry.characters !== undefined && entry.characters.length > 0) setCharactersOpen(true)
    if (entry.seed !== undefined) {
      setSeedMode('fixed')
      setSeed(entry.seed)
    }
    setDone(undefined)
    setLightbox(undefined)
  }

  /** Project one recorded character caption onto an editable draft row. */
  const toCharacterDraft = (character: NovelaiCharacterPromptValue): CharacterDraft => ({
    id: nextCharacterId(),
    prompt: character.prompt,
    negativePrompt: character.negativePrompt,
    useCoords: character.useCoords,
    x: character.x,
    y: character.y,
  })

  /** Apply one conversation-side draft; absent fields keep their panel value. */
  const applyBackfillRequest = (request: WorkbenchBackfillRequest): void => {
    if (request.prompt !== undefined) setPrompt(request.prompt)
    if (request.negativePrompt !== undefined) {
      setNegativePrompt(request.negativePrompt)
      if (request.negativePrompt.trim() !== '') setNegativeOpen(true)
    }
    if (request.model !== undefined) setModel(request.model)
    if (request.width !== undefined) setWidth(request.width)
    if (request.height !== undefined) setHeight(request.height)
    if (request.steps !== undefined) setSteps(request.steps)
    if (request.cfgScale !== undefined) setCfgScale(request.cfgScale)
    if (request.sampler !== undefined) setSampler(request.sampler)
    if (request.noiseSchedule !== undefined) setNoiseSchedule(request.noiseSchedule)
    if (request.seed !== undefined) {
      setSeedMode('fixed')
      setSeed(request.seed)
    }
    setCharacters([])
    setDone(undefined)
    setError(undefined)
    setViewMode('workbench')
  }

  /** Serialize the current panel into one human-and-model-readable draft text. */
  const composeDraft = (): string => {
    const lines: string[] = [t('senddraft.header'), `${t('senddraft.positive')}: ${prompt.trim()}`]
    if (negativePrompt.trim() !== '') lines.push(`${t('senddraft.negative')}: ${negativePrompt.trim()}`)
    const seedText = seedMode === 'fixed' ? `${t('senddraft.seed.fixed')} ${String(seed)}` : t('senddraft.seed.random')
    lines.push(
      `${t('senddraft.params')}: ${model} · ${String(width)}×${String(height)} · ${String(steps)} ${t('senddraft.steps')} · CFG ${String(cfgScale)} · ${sampler}/${noiseSchedule} · ${seedText}`,
    )
    characters.forEach((draft, index) => {
      const negative = draft.negativePrompt.trim() === '' ? '' : `｜${t('senddraft.negative')}: ${draft.negativePrompt.trim()}`
      const placement = draft.useCoords ? `｜${t('characters.position.custom')} X ${String(Math.round(draft.x * 100))}% · Y ${String(Math.round(draft.y * 100))}%` : ''
      lines.push(`${t('characters.role')} ${String(index + 1)}: ${draft.prompt.trim()}${negative}${placement}`)
    })
    return lines.join('\n')
  }

  /** Send the composed draft into the current conversation and switch to it. */
  const sendDraftToConversation = (): void => {
    if (currentSessionId === undefined || sending || prompt.trim() === '') return
    setSending(true)
    setError(undefined)
    sendDraft(currentSessionId, composeDraft()).then(() => {
      setDone(t('senddraft.sent'))
      setViewMode('conversation')
    }).catch((e: unknown) => { setError(e instanceof Error ? e.message : String(e)) }).finally(() => { setSending(false) })
  }

  // Conversation-side backfill deliveries apply while the panel stays mounted.
  useEffect(() => onBackfillRequest(applyBackfillRequest), [onBackfillRequest])

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

  /** The stage's entry: the filmstrip selection, else the newest history row. */
  const stageEntry = (selectedId !== undefined
    ? entries.find(entry => entry.id === selectedId)
    : undefined) ?? entries[0]

  return (
    <div className={css.stageLayout}>
      <div className={css.stageColumn}>
        <div className={css.stage} role="region" aria-label={t('stage.label')}>
          {stageEntry === undefined
            ? (busy ? null : <div className={css.stageEmpty}>{t('stage.empty')}</div>)
            : (
              <img
                data-entry-id={stageEntry.id}
                className={css.stageImg}
                alt={stageEntry.prompt ?? stageEntry.id}
                src={entryUrl(stageEntry)}
                title={t('stage.zoom')}
                onClick={() => { setLightbox(stageEntry) }}
              />
            )}
          {busy && <div className={css.stageRunning} role="status">{t('stage.running')}</div>}
        </div>
        {stageEntry !== undefined && (
          <div className={css.stageMeta}>
            <button
              type="button"
              className={css.stageMetaSeed}
              title={t('stage.reuseSeed')}
              disabled={stageEntry.seed === undefined}
              onClick={() => {
                if (stageEntry.seed !== undefined) {
                  setSeedMode('fixed')
                  setSeed(stageEntry.seed)
                }
              }}
            >
              {t('seed.mode')} {stageEntry.seed ?? '—'}
            </button>
            <span className={css.sizeHint}>
              {stageEntry.width === undefined ? '' : `${stageEntry.width}×${stageEntry.height} · `}
              {stageEntry.model === undefined ? '' : `${stageEntry.model} · `}
              {stageEntry.file}
            </span>
          </div>
        )}
        <div className={css.filmstrip} aria-label={t('history.label')}>
          {entries.map(entry => (
            <button
              key={entry.id}
              type="button"
              className={`${css.filmThumb} ${entry.id === stageEntry?.id ? css.filmThumbActive : ''}`}
              onClick={() => { setSelectedId(entry.id) }}
              aria-label={entry.prompt ?? entry.id}
              aria-current={entry.id === stageEntry?.id}
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
      </div>
      <div className={css.root}>
        <button type="button" className={css.backButton} onClick={() => { setViewMode('conversation') }}>
          {t('mode.conversation')}
        </button>
        <div className={css.section}>
          <div className={css.promptHead}>
            <span className={css.fieldLabel}>{t('prompt.label')}</span>
            <div className={css.promptHeadActions}>
              <button
                type="button"
                className={css.charAction}
                disabled={sending || prompt.trim() === '' || currentSessionId === undefined}
                title={currentSessionId === undefined ? t('senddraft.noSession') : undefined}
                onClick={sendDraftToConversation}
              >
                {sending ? t('senddraft.sending') : t('senddraft.send')}
              </button>
              <button
                type="button"
                className={css.charAction}
                disabled={splitting || prompt.trim() === ''}
                onClick={splitIntoCharacters}
              >
                {splitting ? t('characters.splitting') : t('characters.split')}
              </button>
            </div>
          </div>
          <PromptTextarea
            value={prompt}
            onChange={setPrompt}
            suggest={word => suggestTags({ prompt: word, model }).then(value => value.tags)}
            placeholder={t('prompt.placeholder')}
            ariaLabel={t('prompt.label')}
            className={css.promptArea}
          />
        </div>
        <div className={css.section}>
          <span className={css.fieldLabel}>{t('styles.label')}</span>
          <div className={css.styleRow}>
            {STYLE_PRESETS.map(style => (
              <button
                key={style.en}
                type="button"
                className={css.capsuleChip}
                title={style.en}
                onClick={() => { prependStyle(style.en) }}
              >
                {style.zh}
              </button>
            ))}
          </div>
        </div>
        <div className={css.section}>
          <button
            type="button"
            className={css.foldHeader}
            aria-expanded={capsuleOpen}
            onClick={() => { setCapsuleOpen(open => !open) }}
          >
            <span className={`${css.chevron} ${capsuleOpen ? css.chevronOpen : ''}`}>▾</span>
            {t('capsule.label')}
          </button>
          {capsuleOpen && <CapsuleBrowser onInsert={insertTag} filterLabel={t('capsule.filter')} />}
        </div>
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
        {maxCharactersFor(model) > 0 && (
          <div className={css.section}>
            <button
              type="button"
              className={css.foldHeader}
              aria-expanded={charactersOpen}
              onClick={() => { setCharactersOpen(open => !open) }}
            >
              <span className={`${css.chevron} ${charactersOpen ? css.chevronOpen : ''}`}>▾</span>
              {t('characters.label')}{characters.length > 0 ? ` · ${String(characters.length)}` : ''}
            </button>
            {charactersOpen && (
              <div className={css.charList}>
                <div className={css.charActions}>
                  <button
                    type="button"
                    className={css.charAction}
                    disabled={characters.length >= maxCharactersFor(model)}
                    onClick={addCharacter}
                  >
                    {t('characters.add')}
                  </button>
                  <button
                    type="button"
                    className={css.charAction}
                    disabled={characters.length === 0}
                    onClick={() => { setCharacters([]) }}
                  >
                    {t('characters.clear')}
                  </button>
                </div>
                {characters.map((draft, index) => (
                  <div key={draft.id} className={css.charRow}>
                    <div className={css.charHead}>
                      <strong className={css.charTitle}>{t('characters.role')} {String(index + 1)}</strong>
                      <label className={css.charCheck}>
                        <input
                          type="checkbox"
                          checked={draft.useCoords}
                          aria-label={`${t('characters.role')} ${String(index + 1)} ${t('characters.position.custom')}`}
                          onChange={(e) => { updateCharacter(draft.id, { useCoords: e.target.checked }) }}
                        />
                        {t('characters.position.custom')}
                      </label>
                      <button
                        type="button"
                        className={css.charAction}
                        aria-label={`${t('characters.remove')} ${String(index + 1)}`}
                        onClick={() => { removeCharacter(draft.id) }}
                      >
                      ✕
                      </button>
                    </div>
                    <PromptTextarea
                      value={draft.prompt}
                      onChange={(next) => { updateCharacter(draft.id, { prompt: next }) }}
                      suggest={word => suggestTags({ prompt: word, model }).then(value => value.tags)}
                      placeholder={t('characters.placeholder')}
                      ariaLabel={`${t('characters.role')} ${String(index + 1)}`}
                      className={css.charArea}
                    />
                    <PromptTextarea
                      value={draft.negativePrompt}
                      onChange={(next) => { updateCharacter(draft.id, { negativePrompt: next }) }}
                      suggest={word => suggestTags({ prompt: word, model }).then(value => value.tags)}
                      placeholder={t('characters.negativePlaceholder')}
                      ariaLabel={`${t('characters.role')} ${String(index + 1)} ${t('characters.negative')}`}
                      className={css.charNeg}
                    />
                    {draft.useCoords && (
                      <div className={css.charCoords}>
                        <label className={css.field}>
                          <span className={css.fieldLabel}>{t('characters.x')}</span>
                          <span className={css.charPercent}>
                            <input
                              type="number"
                              className={css.select}
                              min={0}
                              max={100}
                              step={5}
                              value={Math.round(draft.x * 100)}
                              aria-label={`${t('characters.role')} ${String(index + 1)} ${t('characters.x')}`}
                              onChange={(e) => { updateCharacter(draft.id, { x: Number(e.target.value) / 100 }) }}
                            />
                            <span aria-hidden="true">%</span>
                          </span>
                        </label>
                        <label className={css.field}>
                          <span className={css.fieldLabel}>{t('characters.y')}</span>
                          <span className={css.charPercent}>
                            <input
                              type="number"
                              className={css.select}
                              min={0}
                              max={100}
                              step={5}
                              value={Math.round(draft.y * 100)}
                              aria-label={`${t('characters.role')} ${String(index + 1)} ${t('characters.y')}`}
                              onChange={(e) => { updateCharacter(draft.id, { y: Number(e.target.value) / 100 }) }}
                            />
                            <span aria-hidden="true">%</span>
                          </span>
                        </label>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
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
    </div>
  )
}
