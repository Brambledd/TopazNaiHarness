/** Workbench presentation components (pure props; all data via inject). */
import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  NovelaiArtistChain,
  NovelaiCatalogValue,
  NovelaiCharacterPromptRequest,
  NovelaiCharacterPromptValue,
  NovelaiGenerateRequest,
  NovelaiGenerationValue,
} from '@deepseek-ai/dsh-api-novelai-controller/types'
import type { WorkbenchBackfillRequest, WorkbenchPatchRequest } from './bridge.ts'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  RESOLUTION_RATIOS,
  RESOLUTION_TIERS,
  enhanceOutputSize,
  enhanceStrength,
  maxDimensionFor,
  nearestRatio,
  nearestTier,
  resolutionForTier,
  snapDimensionWithinArea,
} from './resolution.ts'
import { PromptTextarea } from './autocomplete.tsx'
import type { ViewMode } from '@deepseek-ai/dsh-client-ui-layout/client'
import { CapsuleBrowser, STYLE_PRESETS } from './capsule-picker.tsx'
import { prepareReverseImage, resizeUrlToBase64 } from './enhance-image.ts'
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

/** Workbench center surface: the stage column (latest image, filmstrip) and the control column (prompt, parameters, generation). */
export function WorkbenchRoot({
  variant = 'center',
  catalog,
  estimate,
  anlasBalance,
  generate,
  enhance,
  reverse,
  inspect,
  history,
  suggestTags,
  readEntry,
  splitCharacters,
  seedDraft,
  onBackfillRequest,
  onPatchApply,
  commitWorkbenchState,
  readWorkbenchState,
  artistChains,
  saveArtistChain,
  removeArtistChain,
  setViewMode,
  useSessions,
  mode,
  t,
}: { variant?: 'center' | 'rail' } & Omit<PropsRuntime<'workbench'>, 'mode'> & { mode?: ViewMode } & WorkbenchInjected & PropsLocale<'novelai-workbench'>) {
  // The `mode` owner share exists only on the center seat (the rail seat has
  // no center-mode share to pass). The layout frame keeps the center surface
  // mounted while the conversation view is active, so the center instance is
  // dormant when its mode is not 'workbench': no network effects, no JSX —
  // otherwise it doubles every network walk and render commit the visible
  // rail panel makes. An absent share (tests, defensive) stays visible.
  const visible = variant === 'rail' || mode !== 'conversation'
  const [catalogValue, setCatalogValue] = useState<NovelaiCatalogValue | undefined>(undefined)
  const [prompt, setPrompt] = useState('')
  const [negativePrompt, setNegativePrompt] = useState('')
  const [negativeOpen, setNegativeOpen] = useState(false)
  const [capsuleOpen, setCapsuleOpen] = useState(false)
  const [stylesOpen, setStylesOpen] = useState(false)
  // Artist chains (画师串): the named library loads lazily on first open. Each
  // saved chain is ONE whole-string entry (a pasted `weight:artist::` run,
  // stored verbatim as tags — never parsed); 插入 appends the tags text to the
  // prompt. (State named savedChains: the filmstrip owns `entries`.)
  const [artistOpen, setArtistOpen] = useState(false)
  const [savedChains, setSavedChains] = useState<readonly NovelaiArtistChain[]>([])
  const [chainName, setChainName] = useState('')
  const [tagsText, setTagsText] = useState('')
  const artistLoadedRef = useRef(false)
  const [characters, setCharacters] = useState<CharacterDraft[]>([])
  const [charactersOpen, setCharactersOpen] = useState(false)
  const [splitting, setSplitting] = useState(false)
  // The commit gate: false until the active session's restore read settles,
  // so a remount's bare unseeded panel cannot overwrite the stored state.
  const [panelSettled, setPanelSettled] = useState(false)
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
  // Batch options (the desktop tool's contract): N sequential requests with a
  // per-image interval; count 1 leaves the interval inert. The safe default is
  // five seconds; anything under two risks the API's rate hygiene.
  const [batchCount, setBatchCount] = useState(1)
  const [batchIntervalSec, setBatchIntervalSec] = useState(5)
  const [batchProgress, setBatchProgress] = useState<string | undefined>(undefined)
  /** Enhance panel: open state, magnitude 1–10, and the output scale. */
  const [enhanceOpen, setEnhanceOpen] = useState(false)
  const [magnitude, setMagnitude] = useState(3)
  const [enhanceScale, setEnhanceScale] = useState<1 | 2 | 'max'>(1)
  /** Reverse tab: the imported source, options, and the answer. */
  const [workbenchTab, setWorkbenchTab] = useState<'generate' | 'reverse'>('generate')
  const [reverseSource, setReverseSource] = useState<{ image: string; previewUrl: string } | undefined>(undefined)
  /** Raw file bytes of the imported source; the restore path reads the embedded parameters from them. */
  const reverseRawRef = useRef<string | undefined>(undefined)
  const [reverseMode, setReverseMode] = useState<'tags' | 'natural' | 'mixed'>('tags')
  const [reverseScope, setReverseScope] = useState<'full' | 'character' | 'object' | 'scene'>('full')
  const [reverseHint, setReverseHint] = useState('')
  const [reverseKnown, setReverseKnown] = useState(false)
  const [reverseResult, setReverseResult] = useState('')
  const [reverseVariants, setReverseVariants] = useState<{ namePrompt: string; featurePrompt: string } | undefined>(undefined)
  const [reverseBusy, setReverseBusy] = useState(false)
  const [reverseError, setReverseError] = useState<string | undefined>(undefined)
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
  // The restore read runs in parallel with the seed (it must not wait on the
  // catalog round-trip), so once restored values are applied the seed stops
  // writing field defaults — the restored session owns the panel.
  const restoredAppliedRef = useRef(false)
  // The commit gate's seed half: the panel may commit only after the catalog
  // defaults have landed, so the bare pre-seed field values (empty checkpoint,
  // zero size) never reach the host and overwrite the stored session state.
  const [catalogReady, setCatalogReady] = useState(false)
  useEffect(() => {
    let cancelled = false
    const seeded = catalog().then((value) => {
      if (cancelled) return
      setCatalogValue(value)
      if (!restoredAppliedRef.current) {
        setSampler(current => current || value.defaults.sampler)
        setNoiseSchedule(current => current || value.defaults.noiseSchedule)
        setWidth(current => current || value.defaults.width)
        setHeight(current => current || value.defaults.height)
        setSteps(value.defaults.steps)
        setCfgScale(value.defaults.cfgScale)
        // The default checkpoint is the catalog's newest entry (the list is
        // newest-first), not the host's pricing-friendly default.
        setModel(current => current || (value.models[0] ?? value.defaults.model))
      }
      setCatalogReady(true)
    })
    seeded.catch((e: unknown) => { setError(e instanceof Error ? e.message : String(e)) })
    return () => { cancelled = true }
  }, [catalog])

  // Initial history page, refreshed after every generation. A dormant center
  // instance (the layout keeps it mounted behind the conversation view) does
  // not fetch: the visible instance owns the panel's network walks.
  useEffect(() => {
    if (!visible) return undefined
    let cancelled = false
    history().then((page) => {
      if (!cancelled) setEntries(page.entries)
    }).catch(() => { /* the grid stays empty; generation reports its own failures */ })
    return () => { cancelled = true }
  }, [history, visible])

  // Live Anlas quote, debounced across width/height/steps edits. The quote
  // waits for the restore read to settle: quoting the pre-restore dimensions
  // would spend a slow routed round-trip on values the restore immediately
  // replaces, and the prompt must render before any advisory call.
  useEffect(() => {
    if (!visible) return undefined
    if (!panelSettled || !catalogReady) return undefined
    if (width <= 0 || height <= 0) return undefined
    let cancelled = false
    const timer = setTimeout(() => {
      estimate({ width, height, steps }).then((value) => {
        if (!cancelled) setAnlas(value.anlas)
      }).catch(() => { /* the quote is advisory; generation reports real failures */ })
    }, 350)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [visible, panelSettled, catalogReady, width, height, steps, estimate])

  // Revoke every minted object URL when the surface unmounts.
  useEffect(() => () => {
    for (const url of urlCache.current.values()) URL.revokeObjectURL(url)
    urlCache.current.clear()
  }, [])

  // Commit the panel state to the host (debounced): the session's committed
  // state is the prompt source the novelai_generate tool binds to. A commit
  // failure is silent — the next panel change re-commits. The commit waits
  // for the catalog seed AND the session's restore read to settle: a remount
  // mid-switch would otherwise publish the bare unseeded panel (empty
  // checkpoint, zero size) over the stored state.
  useEffect(() => {
    if (!visible) return
    if (currentSessionId === undefined || !panelSettled || !catalogReady) return
    const state = {
      prompt,
      negativePrompt,
      model,
      width,
      height,
      steps,
      cfgScale,
      sampler,
      noiseSchedule,
      ...(seedMode === 'fixed' ? { seed } : {}),
    }
    const timer = setTimeout(() => { void commitWorkbenchState(currentSessionId, state).catch(() => {}) }, 400)
    return () => { clearTimeout(timer) }
  }, [
    commitWorkbenchState, currentSessionId, panelSettled, catalogReady, visible, prompt, negativePrompt, model,
    width, height, steps, cfgScale, sampler, noiseSchedule, seedMode, seed,
  ])

  // Restore-on-session: every session-id change re-runs the restore, so
  // switching back to a previous conversation lands its committed state again
  // (the commit loop republishes the panel, so a re-restore is idempotent).
  // The read runs in parallel with the catalog seed; whichever lands first
  // wins, and once restored values are applied the seed stops writing field
  // defaults (restoredAppliedRef). A response that resolves after the session
  // changed again (or the surface unmounted) is dropped by the cancelled flag
  // and never clobbers the panel the user is typing into. The guard commits
  // only after a settled read — a read cancelled mid-flight must not mark the
  // session as restored. panelSettled gates the commit effect until this read
  // lands, so a remount's bare unseeded panel cannot overwrite the stored
  // state; a stored document missing the seeded shape (empty checkpoint, zero
  // size — residue from the pre-gate writes) is treated as absent.
  const restoredSession = useRef<typeof currentSessionId>(undefined)
  useEffect(() => {
    if (!visible) return
    if (restoredSession.current === currentSessionId) return
    // Every session change shuts the commit gate until this session's read
    // settles: the fields still carry the previous session's content, and a
    // commit here would store it under the new session.
    setPanelSettled(false)
    if (currentSessionId === undefined) { restoredSession.current = undefined; return }
    let cancelled = false
    void readWorkbenchState(currentSessionId)
      .then((restored) => {
        if (cancelled) return
        restoredSession.current = currentSessionId
        setPanelSettled(true)
        if (restored === undefined || (restored.model === '' && restored.width === 0)) return
        restoredAppliedRef.current = true
        setPrompt(restored.prompt)
        setNegativePrompt(restored.negativePrompt)
        if (restored.negativePrompt.trim() !== '') setNegativeOpen(true)
        setModel(restored.model)
        setWidth(restored.width)
        setHeight(restored.height)
        setSteps(restored.steps)
        setCfgScale(restored.cfgScale)
        setSampler(restored.sampler)
        setNoiseSchedule(restored.noiseSchedule)
        if (restored.seed !== undefined) {
          setSeedMode('fixed')
          setSeed(restored.seed)
        }
      })
      .catch(() => {
        // The restore is advisory; the catalog defaults stay. The read has
        // still settled, so the panel may commit from here on.
        if (!cancelled) { restoredSession.current = currentSessionId; setPanelSettled(true) }
      })
    return () => { cancelled = true }
  }, [visible, readWorkbenchState, currentSessionId])

  const tier = useMemo(() => nearestTier(width, height), [width, height])
  const ratio = useMemo(() => nearestRatio(width, height), [width, height])

  // Every chains mutation re-renders from the verb's returned full library —
  // the host's one source — so no local order can drift from the stored truth.
  const toggleArtistSection = (): void => {
    const next = !artistOpen
    setArtistOpen(next)
    if (next && !artistLoadedRef.current) {
      artistLoadedRef.current = true
      void artistChains().then(setSavedChains).catch(() => { /* the empty library stands until a mutation refreshes */ })
    }
  }

  /** Append one saved chain's whole tags text to the prompt (comma-joined; verbatim). */
  const insertArtistChain = (tags: string): void => {
    setPrompt(prompt === '' ? tags : `${prompt.replace(/\s+$/, '')}, ${tags}`)
  }

  const submitArtistChain = (): void => {
    const name = chainName.trim()
    const tags = tagsText.trim()
    /* v8 ignore next -- unreachable from the form: the save button is disabled under the same emptiness condition */
    if (name === '' || tags === '') return
    void saveArtistChain({ id: '', name, tags }).then((value) => {
      setSavedChains(value)
      setChainName('')
      setTagsText('')
    }).catch(() => { /* the library keeps its last served state; the next action retries */ })
  }

  const removeSavedChain = (id: string): void => {
    void removeArtistChain(id).then(setSavedChains).catch(() => { /* removal is re-addable; keep the served library */ })
  }

  const applyTierRatio = (nextTier: Tier | null, nextRatio: string): void => {
    if (nextTier === null) return
    const size = resolutionForTier(nextTier, nextRatio as (typeof RESOLUTION_RATIOS)[number])
    setWidth(size.width)
    setHeight(size.height)
  }

  const refreshHistory = (): void => {
    history().then((page) => { setEntries(page.entries) }).catch(() => { /* keep the current page */ })
  }

  // Remaining Anlas: fetched on mount and after every completed batch — the
  // balance is advisory, so an unreachable read just keeps the last value.
  const [anlasLeft, setAnlasLeft] = useState<number | undefined>(undefined)
  const refreshAnlas = (): void => {
    void anlasBalance().then((value) => { if (value !== undefined) setAnlasLeft(value) }).catch(() => {})
  }
  useEffect(() => { refreshAnlas() }, [anlasBalance])

  const submit = (request: NovelaiGenerateRequest): void => {
    setBusy(true)
    setError(undefined)
    setBatchProgress(undefined)
    // Batch run (the desktop tool's contract): N sequential requests with the
    // configured interval between them; a fixed seed walks +1 per image so a
    // batch is not N near-identical frames. Random mode draws fresh per image.
    const count = Math.max(1, Math.min(8, batchCount))
    const intervalMs = Math.max(0, Math.min(60, batchIntervalSec)) * 1000
    const baseSeed = request.seed
    const run = async (): Promise<void> => {
      for (let index = 0; index < count; index++) {
        if (count > 1) setBatchProgress(t('batch.progress', { done: index, total: count }))
        const request_: NovelaiGenerateRequest = baseSeed === undefined
          ? request
          : { ...request, seed: baseSeed + index }
        try {
          const value = await generate(request_)
          setDone(value.file)
          if (value.seed !== undefined) setLastSeed(value.seed)
          // Follow the newest entry again: the fresh result lands on the stage.
          setSelectedId(undefined)
          refreshHistory()
          refreshAnlas()
        } catch (e: unknown) {
          setError(e instanceof Error ? e.message : String(e))
          return
        }
        if (index + 1 < count && intervalMs > 0) {
          await new Promise((resolve) => { setTimeout(resolve, intervalMs) })
        }
      }
    }
    void run().finally(() => {
      setBusy(false)
      setBatchProgress(undefined)
    })
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
    // The rail generates through the conversation: seed the request into the
    // composer, so the model's novelai_generate call — bound to this
    // committed state — lands the image in the chat beside the rail.
    if (variant === 'rail') {
      if (currentSessionId === undefined || prompt.trim() === '') return
      if (seedDraft(currentSessionId, t('rail.generateDraft'))) setDone(t('rail.generateSent'))
      else setError(t('senddraft.noInput'))
      return
    }
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
    // The conversation carries already-structured characters (the model fills
    // the tool input per character), so they land directly in the cards — no
    // LLM split on the backfill path.
    if (request.characters !== undefined) {
      setCharacters(request.characters.map(character => ({
        id: nextCharacterId(),
        prompt: character.prompt,
        negativePrompt: character.negativePrompt ?? '',
        useCoords: false,
        x: 0.5,
        y: 0.5,
      })))
      if (request.characters.length > 0) setCharactersOpen(true)
    }
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
    // Absent characters reset the cards; present ones already replaced them above.
    if (request.characters === undefined) setCharacters([])
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

  /** Place the composed draft into the conversation input without sending it;
   * the workbench prompt stays untouched for further iteration. */
  const deliverDraftToInput = (): void => {
    if (currentSessionId === undefined || prompt.trim() === '') return
    if (seedDraft(currentSessionId, composeDraft())) {
      setDone(t('senddraft.sent'))
      setViewMode('conversation')
    } else {
      setError(t('senddraft.noInput'))
    }
  }

  // Conversation-side backfill deliveries apply while the panel stays mounted.
  useEffect(() => onBackfillRequest(applyBackfillRequest), [onBackfillRequest])

  /**
   * Apply one conversation-side prompt patch (the `novelai_prompt_patch`
   * card): tag operations rewrite the comma-split prompt of the target slot,
   * settings operations set the matching panel field. The view never
   * switches — the rail is already beside the conversation. Tag updates ride
   * functional setState so the subscription's stable callback always reads
   * the live prompt.
   */
  const applyPatchRequest = (request: WorkbenchPatchRequest): void => {
    if (request.slot === 'settings') {
      for (const operation of request.operations) {
        const value = operation.value?.trim() ?? ''
        if (value === '') continue
        if (operation.field === 'model') setModel(value)
        if (operation.field === 'sampler') setSampler(value)
        if (operation.field === 'noiseSchedule') setNoiseSchedule(value)
        if (operation.field === 'width') setWidth(Number(value) || 0)
        if (operation.field === 'height') setHeight(Number(value) || 0)
        if (operation.field === 'steps') setSteps(Number(value) || 0)
        if (operation.field === 'cfgScale') setCfgScale(Number(value) || 0)
        if (operation.field === 'seed') {
          setSeedMode('fixed')
          setSeed(Number(value) || 0)
        }
      }
      return
    }
    const applyTagOps = (base: string): string => {
      let tags = base.split(',').map(tag => tag.trim()).filter(tag => tag !== '')
      for (const operation of request.operations) {
        const tag = operation.tag?.trim() ?? ''
        if (tag === '') continue
        if (operation.op === 'add') {
          if (!tags.includes(tag)) tags.push(tag)
        } else if (operation.op === 'remove') {
          tags = tags.filter(existing => existing !== tag)
        } else {
          const replacement = operation.value?.trim() ?? tag
          tags = tags.map(existing => existing === tag ? replacement : existing)
        }
      }
      return tags.join(', ')
    }
    if (request.slot === 'positive') setPrompt(applyTagOps)
    else setNegativePrompt(applyTagOps)
  }
  useEffect(() => onPatchApply(applyPatchRequest), [onPatchApply])

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

  // Wheel-to-horizontal scroll for the filmstrip: a non-passive native
  // listener, because React roots attach wheel passively and the strip must
  // consume the delta instead of scrolling the page.
  const filmstripRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const strip = filmstripRef.current
    if (strip === null) return undefined
    const onWheel = (event: WheelEvent): void => {
      if (event.deltaY === 0) return
      strip.scrollLeft += event.deltaY
      event.preventDefault()
    }
    strip.addEventListener('wheel', onWheel, { passive: false })
    return () => { strip.removeEventListener('wheel', onWheel) }
  }, [])

  /** The enhance run's output target for the stage entry at the picked scale. */
  const enhanceTarget = stageEntry?.width === undefined || stageEntry.height === undefined
    ? undefined
    : enhanceOutputSize(stageEntry.width, stageEntry.height, enhanceScale, model.startsWith('nai-diffusion-5-'))

  /** One enhance run: resize the stage image to the target, then submit img2img. */
  const runEnhance = (): void => {
    const url = stageEntry === undefined ? undefined : urlCache.current.get(stageEntry.id)
    if (stageEntry === undefined || enhanceTarget === undefined || url === undefined || busy) return
    setBusy(true)
    setError(undefined)
    resizeUrlToBase64(url, enhanceTarget.width, enhanceTarget.height).then((image) => {
      return enhance({
        image,
        width: enhanceTarget.width,
        height: enhanceTarget.height,
        prompt,
        ...(negativePrompt.trim() === '' ? {} : { negativePrompt }),
        model,
        steps,
        cfgScale,
        sampler,
        noiseSchedule,
        strength: enhanceStrength(magnitude),
        // The official V5 upscaled enhance submits at the fitted source size
        // and lets the server deliver the upscaled output.
        ...(enhanceTarget.upscaled ? { upscaledEnhance: true } : {}),
      })
    }).then((value) => {
      setDone(t('enhance.done'))
      if (value.seed !== undefined) setLastSeed(value.seed)
      // Follow the newest entry: the enhanced image lands on the stage.
      setSelectedId(undefined)
      refreshHistory()
    }).catch((e: unknown) => { setError(e instanceof Error ? e.message : String(e)) }).finally(() => { setBusy(false) })
  }

  /** Read one blob's bytes as a bare base64 string. */
  const readAsBase64 = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = () => { reject(reader.error ?? new Error('file read failed')) }
    reader.readAsDataURL(blob)
  })

  /** Import one picked file as the reverse source (downscaled for the vision call). */
  const acceptReverseFile = (file: File): void => {
    if (reverseSource !== undefined) URL.revokeObjectURL(reverseSource.previewUrl)
    setReverseError(undefined)
    readAsBase64(file).then((raw) => {
      reverseRawRef.current = raw
      return prepareReverseImage(file)
    }).then((source) => {
      setReverseSource(source)
    }).catch((e: unknown) => { setReverseError(e instanceof Error ? e.message : String(e)) })
  }

  /** Import the current stage entry as the reverse source. */
  const importStageForReverse = (): void => {
    const url = stageEntry === undefined ? undefined : urlCache.current.get(stageEntry.id)
    if (url === undefined) return
    if (reverseSource !== undefined) URL.revokeObjectURL(reverseSource.previewUrl)
    setReverseError(undefined)
    fetch(url).then(response => response.blob()).then((blob) => {
      return readAsBase64(blob).then((raw) => {
        reverseRawRef.current = raw
        return prepareReverseImage(blob)
      })
    }).then((source) => {
      setReverseSource(source)
    }).catch((e: unknown) => { setReverseError(e instanceof Error ? e.message : String(e)) })
  }

  /** Restore the NovelAI-embedded parameters of the imported image into the generate panel. */
  const restoreFromImage = (): void => {
    const raw = reverseRawRef.current
    if (raw === undefined || reverseBusy) return
    setReverseBusy(true)
    setReverseError(undefined)
    inspect({ image: raw }).then((value) => {
      if (!value.hasMeta) {
        setReverseError(t('restore.missing'))
        return
      }
      if (value.prompt !== undefined) setPrompt(value.prompt)
      if (value.negativePrompt !== undefined && value.negativePrompt.trim() !== '') {
        setNegativePrompt(value.negativePrompt)
        setNegativeOpen(true)
      }
      if (value.model !== undefined && catalogValue?.models.includes(value.model) === true) setModel(value.model)
      if (value.width !== undefined) setWidth(value.width)
      if (value.height !== undefined) setHeight(value.height)
      if (value.steps !== undefined) setSteps(value.steps)
      if (value.cfgScale !== undefined) setCfgScale(value.cfgScale)
      if (value.sampler !== undefined && catalogValue?.samplers.includes(value.sampler) === true) setSampler(value.sampler)
      if (value.seed !== undefined) {
        setSeedMode('fixed')
        setSeed(value.seed)
      }
      if (value.characters !== undefined && value.characters.length > 0) {
        setCharacters(value.characters.map(character => ({
          id: nextCharacterId(),
          prompt: character.prompt,
          negativePrompt: character.negativePrompt,
          useCoords: character.useCoords,
          x: character.x,
          y: character.y,
        })))
        setCharactersOpen(true)
      }
      setWorkbenchTab('generate')
      setDone(t('restore.ok'))
    }).catch((e: unknown) => { setReverseError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { setReverseBusy(false) })
  }

  /** Drop the reverse source and its preview URL. */
  const clearReverseSource = (): void => {
    if (reverseSource !== undefined) URL.revokeObjectURL(reverseSource.previewUrl)
    setReverseSource(undefined)
    setReverseResult('')
    setReverseVariants(undefined)
    setReverseError(undefined)
  }

  /** Run one reverse-prompt call over the imported source. */
  const runReverse = (): void => {
    if (reverseSource === undefined || reverseBusy) return
    setReverseBusy(true)
    setReverseError(undefined)
    reverse({
      image: reverseSource.image,
      mode: reverseMode,
      scope: reverseScope,
      ...(reverseHint.trim() === '' ? {} : { hint: reverseHint.trim() }),
      knownCharacter: reverseKnown,
    }).then((value) => {
      setReverseResult(value.prompt)
      setReverseVariants(value.namePrompt !== undefined && value.featurePrompt !== undefined
        ? { namePrompt: value.namePrompt, featurePrompt: value.featurePrompt }
        : undefined)
    }).catch((e: unknown) => { setReverseError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { setReverseBusy(false) })
  }

  /** Reuse one reversed prompt as the generation panel's positive prompt. */
  const reuseReverseResult = (text: string): void => {
    const trimmed = text.trim()
    if (trimmed === '') return
    setPrompt(trimmed)
    setWorkbenchTab('generate')
  }

  // A dormant center instance renders nothing: the layout frame keeps it
  // mounted behind the conversation view, and rendering the full panel tree
  // into a hidden subtree costs a render commit on every conversation switch
  // without ever being seen. Re-entering the workbench mode remounts the tree
  // fresh; the catalog is connection-cached and the session state restores
  // from the host, so the remount is cheap.
  if (!visible) return null
  return (
    <div className={css.stageLayout} data-variant={variant}>
      <div className={css.stageColumn}>
        <div className={css.stage} role="region" aria-label={t('stage.label')}>
          {workbenchTab === 'reverse' && reverseSource !== undefined
            ? (
              <img
                className={css.stageImg}
                alt={t('reverse.imageAlt')}
                src={reverseSource.previewUrl}
              />
            )
            : stageEntry === undefined
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
            <button
              type="button"
              className={css.stageMetaSeed}
              aria-expanded={enhanceOpen}
              onClick={() => { setEnhanceOpen(open => !open) }}
            >
              {t('enhance.action')}
            </button>
          </div>
        )}
        {enhanceOpen && stageEntry !== undefined && (
          <div className={css.enhancePanel} role="region" aria-label={t('enhance.action')}>
            <label className={css.fieldLabel} htmlFor="enhance-magnitude">
              {t('enhance.magnitude')}: {magnitude}
            </label>
            <input
              id="enhance-magnitude"
              type="range"
              min={1}
              max={10}
              step={1}
              value={magnitude}
              onChange={(event) => { setMagnitude(Math.max(1, Math.min(10, Math.floor(Number(event.target.value) || 1)))) }}
            />
            <p className={css.sizeHint}>{t('enhance.explain')}</p>
            <div className={css.seedRow} role="group" aria-label={t('enhance.scale')}>
              <button
                type="button"
                className={`${css.seedSegment} ${enhanceScale === 1 ? css.seedSegmentActive : ''}`}
                aria-pressed={enhanceScale === 1}
                onClick={() => { setEnhanceScale(1) }}
              >
                {t('enhance.scale1')}
              </button>
              <button
                type="button"
                className={`${css.seedSegment} ${enhanceScale === 2 ? css.seedSegmentActive : ''}`}
                aria-pressed={enhanceScale === 2}
                onClick={() => { setEnhanceScale(2) }}
              >
                {t('enhance.scale2')}
              </button>
              <button
                type="button"
                className={`${css.seedSegment} ${enhanceScale === 'max' ? css.seedSegmentActive : ''}`}
                aria-pressed={enhanceScale === 'max'}
                title={t('enhance.maxHint')}
                onClick={() => { setEnhanceScale('max') }}
              >
                {t('enhance.max')}
              </button>
            </div>
            {enhanceTarget !== undefined && (
              <p className={enhanceTarget.exceedsLimit ? css.errorText : css.sizeHint}>
                {enhanceTarget.exceedsLimit
                  ? t('enhance.limit')
                  : `${stageEntry.width ?? '?'}×${stageEntry.height ?? '?'} → ${enhanceTarget.displayWidth}×${enhanceTarget.displayHeight}`
                    + (enhanceTarget.upscaled ? ` · ${t('enhance.upscaled')}` : '')}
              </p>
            )}
            <div className={css.seedRow}>
              <button
                type="button"
                className={css.generateButton}
                disabled={busy || enhanceTarget === undefined || enhanceTarget.exceedsLimit}
                onClick={runEnhance}
              >
                {busy ? t('generating') : t('enhance.run')}
              </button>
              <button type="button" className={css.charAction} onClick={() => { setEnhanceOpen(false) }}>
                {t('enhance.close')}
              </button>
            </div>
          </div>
        )}
        <div ref={filmstripRef} className={css.filmstrip} aria-label={t('history.label')}>
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
        <div className={css.seedRow} role="tablist" aria-label={t('tab.label')}>
          <button
            type="button"
            role="tab"
            aria-selected={workbenchTab === 'generate'}
            className={`${css.seedSegment} ${workbenchTab === 'generate' ? css.seedSegmentActive : ''}`}
            onClick={() => { setWorkbenchTab('generate') }}
          >
            {t('tab.generate')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={workbenchTab === 'reverse'}
            className={`${css.seedSegment} ${workbenchTab === 'reverse' ? css.seedSegmentActive : ''}`}
            onClick={() => { setWorkbenchTab('reverse') }}
          >
            {t('tab.reverse')}
          </button>
        </div>
        {workbenchTab === 'generate' && (<>
          <div className={css.section}>
            <div className={css.promptHead}>
              <span className={css.fieldLabel}>{t('prompt.label')}</span>
              <div className={css.promptHeadActions}>
                <button
                  type="button"
                  className={css.charAction}
                  disabled={prompt.trim() === '' || currentSessionId === undefined}
                  title={currentSessionId === undefined ? t('senddraft.noSession') : undefined}
                  onClick={deliverDraftToInput}
                >
                  {t('senddraft.send')}
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
            <button
              type="button"
              className={css.foldHeader}
              aria-expanded={stylesOpen}
              onClick={() => { setStylesOpen(open => !open) }}
            >
              <span className={`${css.chevron} ${stylesOpen ? css.chevronOpen : ''}`}>▾</span>
              {t('styles.label')}
            </button>
            {stylesOpen && (
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
            )}
          </div>
          <div className={css.section}>
            <button
              type="button"
              className={css.foldHeader}
              aria-expanded={artistOpen}
              onClick={toggleArtistSection}
            >
              <span className={`${css.chevron} ${artistOpen ? css.chevronOpen : ''}`}>▾</span>
              {t('artists.label')}
            </button>
            {artistOpen && (
              <div className={css.artistList}>
                {savedChains.length === 0 && <p className={css.artistPreview}>{t('artists.empty')}</p>}
                {savedChains.map(item => (
                  <div key={item.id} className={css.artistRow}>
                    <span className={css.artistName}>{item.name}</span>
                    <span className={css.artistPreview} title={item.tags}>{item.tags}</span>
                    <button type="button" className={css.charAction} onClick={() => { insertArtistChain(item.tags) }}>
                      {t('artists.insert')}
                    </button>
                    <button type="button" className={css.charAction} onClick={() => { removeSavedChain(item.id) }}>
                      {t('artists.remove')}
                    </button>
                  </div>
                ))}
                <div className={css.artistForm}>
                  <input
                    className={css.artistInput}
                    value={chainName}
                    placeholder={t('artists.namePlaceholder')}
                    aria-label={t('artists.nameLabel')}
                    onChange={(event) => { setChainName(event.target.value) }}
                  />
                  <input
                    className={css.artistTagsInput}
                    value={tagsText}
                    placeholder={t('artists.tagsPlaceholder')}
                    aria-label={t('artists.tagsLabel')}
                    onChange={(event) => { setTagsText(event.target.value) }}
                  />
                  <button
                    type="button"
                    className={css.charAction}
                    disabled={chainName.trim() === '' || tagsText.trim() === ''}
                    onClick={submitArtistChain}
                  >
                    {t('artists.add')}
                  </button>
                </div>
              </div>
            )}
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
            <label className={css.field}>
              <span className={css.fieldLabel}>{t('param.batchCount')}</span>
              <input
                type="number"
                className={css.number}
                value={batchCount}
                min={1}
                max={8}
                title={t('param.batchCountHint')}
                onChange={(e) => { setBatchCount(Math.max(1, Math.min(8, Math.round(Number(e.target.value) || 1)))) }}
              />
            </label>
            <label className={css.field}>
              <span className={css.fieldLabel}>{t('param.batchInterval')}</span>
              <input
                type="number"
                className={css.number}
                value={batchIntervalSec}
                min={0}
                max={60}
                title={t('param.batchIntervalHint')}
                onChange={(e) => { setBatchIntervalSec(Math.max(0, Math.min(60, Number(e.target.value) || 0))) }}
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
            <span className={css.anlasBalance} title={t('anlas.balanceHint')}>
              ☾ {anlasLeft === undefined ? '…' : String(anlasLeft)}
            </span>
            <span className={css.estimate}>
              {t('estimate')}: <span className={css.estimateValue}>{anlas === undefined ? '…' : anlas === 0 ? t('estimate.free') : String(anlas * Math.max(1, Math.min(8, batchCount)))}</span>
              {batchCount > 1 && <span className={css.sizeHint}> ×{Math.min(8, batchCount)}</span>}
            </span>
            {error !== undefined && <p className={css.errorText} role="alert">{t('error')}: {error}</p>}
            {batchCount > 1 && batchIntervalSec > 0 && batchIntervalSec < 2 && (
              <p className={css.warnText} role="alert">{t('batch.intervalWarning')}</p>
            )}
            {done !== undefined && <p className={css.doneText}>{done}</p>}
            {batchProgress !== undefined && <p className={css.doneText} role="status">{batchProgress}</p>}
            <button type="button" className={css.generateButton} disabled={busy || prompt.trim() === ''} onClick={submitCurrent}>
              {busy ? (batchProgress ?? t('generating')) : (batchCount > 1 ? t('batch.run', { count: Math.min(8, batchCount) }) : t('generate'))}
            </button>
          </div>
        </>)}
        {workbenchTab === 'reverse' && (
          <div className={`${css.section} ${css.reverseSection}`}>
            <div
              className={css.reverseDrop}
              onDragOver={(event) => { event.preventDefault() }}
              onDrop={(event) => {
                event.preventDefault()
                const file = event.dataTransfer.files[0]
                if (file !== undefined) acceptReverseFile(file)
              }}
            >
              {reverseSource !== undefined
                ? <img className={css.reverseThumb} alt={t('reverse.imageAlt')} src={reverseSource.previewUrl} />
                : <span className={css.sizeHint}>{t('reverse.dropHint')}</span>}
              <label className={css.charAction}>
                {t('reverse.openFile')}
                <input
                  type="file"
                  hidden
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file !== undefined) { acceptReverseFile(file); event.target.value = '' }
                  }}
                />
              </label>
              {stageEntry !== undefined && reverseSource === undefined && (
                <button type="button" className={css.charAction} onClick={importStageForReverse}>
                  {t('reverse.fromStage')}
                </button>
              )}
              {reverseSource !== undefined && (
                <button type="button" className={css.charAction} onClick={clearReverseSource}>
                  {t('reverse.clear')}
                </button>
              )}
            </div>
            {reverseError !== undefined && <p className={css.errorText} role="alert">{reverseError}</p>}
            <div className={css.seedRow} role="group" aria-label={t('reverse.mode')}>
              {(['tags', 'natural', 'mixed'] as const).map(mode => (
                <button
                  key={mode}
                  type="button"
                  className={`${css.seedSegment} ${reverseMode === mode ? css.seedSegmentActive : ''}`}
                  aria-pressed={reverseMode === mode}
                  onClick={() => { setReverseMode(mode) }}
                >
                  {t(`reverse.mode.${mode}` as const)}
                </button>
              ))}
            </div>
            <div className={css.seedRow} role="group" aria-label={t('reverse.scope')}>
              {(['full', 'character', 'object', 'scene'] as const).map(scope => (
                <button
                  key={scope}
                  type="button"
                  className={`${css.seedSegment} ${reverseScope === scope ? css.seedSegmentActive : ''}`}
                  aria-pressed={reverseScope === scope}
                  title={t(`reverse.scope.${scope}.tip` as const)}
                  onClick={() => { setReverseScope(scope) }}
                >
                  {t(`reverse.scope.${scope}` as const)}
                </button>
              ))}
            </div>
            <label className={css.field}>
              <span className={css.fieldLabel}>{t('reverse.hint')}</span>
              <input
                className={css.number}
                value={reverseHint}
                placeholder={t('reverse.hintPlaceholder')}
                onChange={(event) => { setReverseHint(event.target.value) }}
              />
            </label>
            <label className={css.charCheck}>
              <input
                type="checkbox"
                checked={reverseKnown}
                onChange={(event) => { setReverseKnown(event.target.checked) }}
              />
              {t('reverse.known')}
            </label>
            <button
              type="button"
              className={css.generateButton}
              disabled={reverseSource === undefined || reverseBusy}
              onClick={runReverse}
            >
              {reverseBusy ? t('reverse.running') : t('reverse.run')}
            </button>
            <button
              type="button"
              className={css.charAction}
              disabled={reverseSource === undefined || reverseBusy}
              title={t('restore.tip')}
              onClick={restoreFromImage}
            >
              {t('restore.action')}
            </button>
            {reverseResult !== '' && (
              <div className={css.section}>
                <span className={css.fieldLabel}>{t('reverse.result')}</span>
                <textarea className={css.promptArea} value={reverseResult} onChange={(event) => { setReverseResult(event.target.value) }} />
                {reverseVariants !== undefined && (
                  <div className={css.charList}>
                    <div className={css.charRow}>
                      <strong className={css.charTitle}>{t('reverse.nameVariant')}</strong>
                      <textarea className={css.charArea} value={reverseVariants.namePrompt} readOnly />
                      <button type="button" className={css.charAction} onClick={() => { reuseReverseResult(reverseVariants.namePrompt) }}>
                        {t('reverse.reuse')}
                      </button>
                    </div>
                    <div className={css.charRow}>
                      <strong className={css.charTitle}>{t('reverse.featureVariant')}</strong>
                      <textarea className={css.charArea} value={reverseVariants.featurePrompt} readOnly />
                      <button type="button" className={css.charAction} onClick={() => { reuseReverseResult(reverseVariants.featurePrompt) }}>
                        {t('reverse.reuse')}
                      </button>
                    </div>
                  </div>
                )}
                <button type="button" className={css.charAction} onClick={() => { reuseReverseResult(reverseResult) }}>
                  {t('reverse.reuse')}
                </button>
              </div>
            )}
          </div>
        )}
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

/**
 * The conversation's right-rail workbench: the same surface in its rail cut
 * (control column only — the stage lives in the conversation's own image
 * cards). Registered under `conversation.details.workbench`.
 * @param props - composed slot props (rail runtime share + workbench inject face).
 * @returns the rail-wrapped workbench element tree.
 */
export function WorkbenchRail(
  props: PropsRuntime<'conversation.details.workbench'> & WorkbenchInjected & PropsLocale<'novelai-workbench'>,
) {
  return (
    <div className={`${css.railWrap} dsw-zzz-console`}>
      <WorkbenchRoot {...props} variant="rail" />
    </div>
  )
}
