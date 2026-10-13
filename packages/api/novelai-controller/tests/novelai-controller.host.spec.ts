import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { estimateAnlas } from '@deepseek-ai/dsh-novelai-core'
import { NovelaiImageLibrary } from '../src/library.ts'
import NovelaiController from '../src/index.ts'
import type { WorkbenchStateStore } from '../src/workbench-state-store.ts'
import type { NovelaiWorkbenchState } from '../src/types.ts'

/** Delegating home-path mock: tests flip `resolveFails` to exercise the memory-only degradation. */
const homeState = vi.hoisted(() => ({ resolveFails: false }))
vi.mock('@deepseek-ai/dsh-home-paths', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@deepseek-ai/dsh-home-paths')>()
  return {
    ...actual,
    resolveDshHome: (...args: Parameters<typeof actual.resolveDshHome>) => {
      if (homeState.resolveFails) throw new Error('no resolvable home')
      return actual.resolveDshHome(...args)
    },
  }
})

const roots: Context[] = []

/** Sandbox home per test: the controller persists workbench states under it, never the operator's real home. */
let sandboxHome = ''
const previousHome = process.env['DSH_HOME']

beforeEach(() => {
  sandboxHome = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-novelai-home-')))
  process.env['DSH_HOME'] = sandboxHome
})

afterEach(async () => {
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
  if (previousHome !== undefined) process.env['DSH_HOME'] = previousHome
  else delete process.env['DSH_HOME']
})

/**
 * Minimal in-memory settings provider over one document: the controller reads
 * and writes the `novelai` namespace through `register` exactly as with the
 * real Service Definition.
 */
function settingsProvider(options: { doc?: Record<string, unknown>; writable?: boolean } = {}): unknown {
  const doc = structuredClone(options.doc ?? {})
  const writable = options.writable ?? true
  return {
    register: (ns: string, schema: (input: unknown) => Record<string, unknown>) => ({
      get: () => schema(doc[ns] ?? {}),
      update: async (patch: Record<string, unknown>) => {
        if (!writable) throw new Error('settings provider is read-only: "novelai" cannot be updated in-process')
        doc[ns] = { ...(doc[ns] as Record<string, unknown> | undefined ?? {}), ...patch }
      },
      replace: async () => {},
      watch: () => () => {},
    }),
  }
}

/** Service harness over a temporary output directory.
 * @param llmText - text streamed back by the fake LLM for the split call.
 * @param finishKind - finish reason the fake LLM reports. */
async function harness(llmText = '', finishKind: 'stop' | 'max-tokens' = 'stop'): Promise<{ controller: NovelaiController; library: NovelaiImageLibrary; dir: string }> {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-novelai-controller-')))
  const ctx = new Context()
  roots.push(ctx)
  ctx.provide('typert', {
    lookups: { configure: () => (): void => {} },
    contexts: { configureHost: () => (): void => {} },
  } as never)
  ctx.provide('llm', {
    stream: async function* () {
      yield { type: 'text-delta', index: 0, text: llmText }
      yield { type: 'finish', reason: { kind: finishKind } }
    },
  } as never)
  ctx.provide('attachments', {
    saveImage: async (input: { data: Uint8Array; mediaType: string }) => ({
      attachmentId: 'att-1',
      mediaType: input.mediaType,
      bytes: input.data.byteLength,
      width: 64,
      height: 64,
    }),
  } as never)
  // The controller's settings registration binds against this provider so the
  // plugin fiber activates; tests without an override never read it.
  ctx.provide('settings', settingsProvider())
  const controller = new NovelaiController(ctx, {
    outputDir: dir,
    tagIndexPath: join(dir, 'tag-index.csv'),
    splitProvider: 'mock',
    splitModel: 'mock',
    splitMaxTokens: 4096,
    reverseProvider: 'mock',
    reverseModel: 'mock',
    reverseMaxTokens: 7000,
  })
  const library = new NovelaiImageLibrary(dir)
  // Join the test invariant host's ready chain, so afterEach never disposes a
  // root whose companion plugin is still mounting.
  await ctx.plugin({ apply: () => {} })
  return { controller, library, dir }
}

/**
 * Harness with an optional in-memory settings provider mounted before the
 * controller, so its `settings` registration binds.
 */
async function settingsHarness(options: { doc?: Record<string, unknown>; writable?: boolean } = {}): Promise<{
  controller: NovelaiController
  dir: string
}> {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-novelai-controller-')))
  const ctx = new Context()
  roots.push(ctx)
  ctx.provide('typert', {
    lookups: { configure: () => (): void => {} },
    contexts: { configureHost: () => (): void => {} },
  } as never)
  ctx.provide('llm', { stream: async function* () {} } as never)
  ctx.provide('settings', settingsProvider(options))
  const controller = new NovelaiController(ctx, {
    outputDir: dir,
    tagIndexPath: join(dir, 'tag-index.csv'),
    splitProvider: 'mock',
    splitModel: 'mock',
    splitMaxTokens: 4096,
    reverseProvider: 'mock',
    reverseModel: 'mock',
    reverseMaxTokens: 7000,
  })
  // Join the test invariant host's ready chain before the polling wait, so
  // afterEach never disposes a root whose companion plugin is still mounting.
  await ctx.plugin({ apply: () => {} })
  await vi.waitFor(() => {
    if ((controller as unknown as { settings?: unknown }).settings === undefined) throw new Error('settings scope not bound yet')
  })
  return { controller, dir }
}

describe('NovelaiController verbs', () => {
  it('serves the complete generation catalog', async () => {
    const { controller } = await harness()
    const catalog = await controller.catalog()
    expect(catalog.models).toContain('nai-diffusion-4-5-full')
    expect(catalog.samplers).toContain('k_euler')
    expect(catalog.noiseSchedules).toContain('karras')
    expect(catalog.maxSeed).toBe(0xffff_ffff)
    expect(catalog.defaults).toMatchObject({ model: 'nai-diffusion-4-5-full', width: 832 })
  })

  it('quotes Anlas prices through the official formula', async () => {
    const { controller } = await harness()
    await expect(controller.estimate({ width: 832, height: 1216, steps: 28 }))
      .resolves.toEqual({ anlas: estimateAnlas(832, 1216, 28) })
  })

  it('returns an empty history for a fresh library', async () => {
    const { controller } = await harness()
    await expect(controller.history({})).resolves.toEqual({ entries: [], total: 0 })
  })

  it('serves recorded entries through history paging', async () => {
    const { controller, library, dir } = await harness()
    const file = join(dir, 'a.png')
    writeFileSync(file, Buffer.from([1]))
    await library.ensure()
    await library.record({
      id: 'a', file, bytes: 1, width: 832, height: 1216, steps: 28,
      seed: 5, model: 'nai-diffusion-4-5-full', prompt: 'p', negativePrompt: 'n',
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    const page = await controller.history({ offset: 0, limit: 10 })
    expect(page.total).toBe(1)
    expect(page.entries[0]).toMatchObject({
      id: 'a', file, bytes: 1, seed: 5, model: 'nai-diffusion-4-5-full',
      anlasEstimate: estimateAnlas(832, 1216, 28),
    })
    expect(await controller.history({ offset: 1, limit: 10 })).toMatchObject({ entries: [], total: 1 })
  })

  it('rejects removal of a missing entry with the namespace error', async () => {
    const { controller } = await harness()
    await expect(controller.removeEntry({ id: 'missing' })).rejects.toMatchObject({ code: 'novelai/entry-missing' })
  })

  it('reports the tag index as not downloaded and answers blank suggestions with an empty batch', async () => {
    const { controller } = await harness()
    expect(await controller.status()).toMatchObject({ downloaded: false, count: 0, sizeBytes: 0 })
    expect(await controller.suggestTags({ prompt: '  ' })).toEqual({ tags: [] })
  })

  it('splits a merged prompt into base and per-character captions through the LLM', async () => {
    const text = '{"prompt":"park, masterpiece","characters":[{"prompt":"1girl, blue hair"},{"prompt":"1girl, red hair","negativePrompt":"extra ears"}]}'
    const { controller } = await harness(`Here you go: ${text}`)
    const value = await controller.splitCharacters({ prompt: 'park, masterpiece, 2girls, blue hair, red hair' })
    expect(value.prompt).toBe('park, masterpiece')
    expect(value.characters).toHaveLength(2)
    expect(value.characters[0]).toMatchObject({ prompt: '1girl, blue hair', negativePrompt: '', useCoords: false })
    expect(value.characters[1]?.negativePrompt).toBe('extra ears')
  })

  it('maps an unusable split answer to the namespace error', async () => {
    const { controller } = await harness('I cannot do that')
    await expect(controller.splitCharacters({ prompt: '1girl' })).rejects.toMatchObject({ code: 'novelai/split-failed' })
  })

  it('accepts a complete split answer even when the finish reason is max-tokens', async () => {
    const text = '{"prompt":"park","characters":[{"prompt":"1girl, blue hair"}]}'
    const { controller } = await harness(text, 'max-tokens')
    const value = await controller.splitCharacters({ prompt: 'park, 1girl' })
    expect(value.characters).toHaveLength(1)
  })

  it('salvages the complete character entries of a token-truncated answer', async () => {
    const truncated = '{"prompt":"park","characters":[{"prompt":"1girl, blue hair"},{"prompt":"1g'
    const { controller } = await harness(truncated, 'max-tokens')
    const value = await controller.splitCharacters({ prompt: 'park' })
    expect(value.prompt).toBe('park')
    expect(value.characters).toEqual([
      { prompt: '1girl, blue hair', negativePrompt: '', useCoords: false, x: 0.5, y: 0.5 },
    ])
  })

  it('reports truncation with the configured budget when nothing survives', async () => {
    const { controller } = await harness('{"prompt":"par', 'max-tokens')
    await expect(controller.splitCharacters({ prompt: 'park' })).rejects.toThrow(/splitMaxTokens/)
  })

  it('answers a blank split request without calling the model', async () => {
    const { controller } = await harness()
    expect(await controller.splitCharacters({ prompt: '   ' })).toEqual({ prompt: '', characters: [] })
  })

  it('reverses an imported image into a prompt', async () => {
    const { controller } = await harness('1girl, solo, white background, full body, standing')
    await expect(controller.reversePrompt({
      image: 'aGVsbG8=',
      mode: 'tags',
      scope: 'full',
      knownCharacter: false,
    })).resolves.toEqual({ prompt: '1girl, solo, white background, full body, standing' })
  })

  it('splits a known-character answer into identity and appearance variants', async () => {
    const { controller } = await harness('NAME PROMPT:\ntopaz (honkai: star rail)\n\nFEATURE PROMPT:\nsilver hair, blue eyes, school uniform')
    const value = await controller.reversePrompt({
      image: 'aGVsbG8=',
      mode: 'tags',
      scope: 'character',
      knownCharacter: true,
    })
    expect(value.namePrompt).toBe('topaz (honkai: star rail)')
    expect(value.featurePrompt).toBe('silver hair, blue eyes, school uniform')
    expect(value.prompt).toBe('topaz (honkai: star rail), silver hair, blue eyes, school uniform')
  })

  it('rejects an answer without text as the namespace error', async () => {
    const { controller } = await harness('', 'stop')
    await expect(controller.reversePrompt({
      image: 'aGVsbG8=',
      mode: 'tags',
      scope: 'full',
      knownCharacter: false,
    })).rejects.toMatchObject({ code: 'novelai/reverse-failed' })
  })

  it('reads the NovelAI-embedded parameters of an imported PNG', async () => {
    const { controller } = await harness()
    // signature + IHDR (832脳1216) + tEXt Title + tEXt Description + tEXt Comment + IEND.
    const parts: Uint8Array[] = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])]
    const chunk = (type: string, data: Uint8Array): Uint8Array => {
      const out = new Uint8Array(12 + data.length)
      new DataView(out.buffer).setUint32(0, data.length)
      out.set(new Uint8Array([...type].map(ch => ch.charCodeAt(0))), 4)
      out.set(data, 8)
      return out
    }
    const text = (keyword: string, value: string): Uint8Array => {
      const bytes = new Uint8Array(keyword.length + 1 + value.length)
      bytes.set(new Uint8Array([...keyword].map(ch => ch.charCodeAt(0))), 0)
      bytes.set(new Uint8Array([...value].map(ch => ch.charCodeAt(0))), keyword.length + 1)
      return bytes
    }
    const ihdr = new Uint8Array(13)
    const view = new DataView(ihdr.buffer)
    view.setUint32(0, 832)
    view.setUint32(4, 1216)
    parts.push(chunk('IHDR', ihdr))
    parts.push(chunk('tEXt', text('Title', 'NovelAI generated image')))
    parts.push(chunk('tEXt', text('Description', 'lowres')))
    parts.push(chunk('tEXt', text('Comment', '{"prompt":"1girl, solo","uc":"lowres","seed":42,"steps":28,"sampler":"k_euler","scale":5}')))
    parts.push(chunk('IEND', new Uint8Array()))
    const png = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
    let offset = 0
    for (const part of parts) {
      png.set(part, offset)
      offset += part.length
    }
    const base64 = Buffer.from(png).toString('base64')
    await expect(controller.inspectImage({ image: base64 })).resolves.toEqual({
      hasMeta: true,
      prompt: '1girl, solo',
      negativePrompt: 'lowres',
      seed: 42,
      steps: 28,
      sampler: 'k_euler',
      cfgScale: 5,
      width: 832,
      height: 1216,
    })
  })

  it('reports a parameter-less image honestly', async () => {
    const { controller } = await harness()
    await expect(controller.inspectImage({ image: 'aGVsbG8=' })).resolves.toEqual({ hasMeta: false })
  })

  it('maps a missing token to the namespace error', async () => {
    const { controller } = await harness()
    const previous = process.env['NOVELAI_TOKEN']
    delete process.env['NOVELAI_TOKEN']
    try {
      await expect(controller.generate({ prompt: 'x' })).rejects.toMatchObject({ code: 'novelai/token-missing' })
    } finally {
      if (previous !== undefined) process.env['NOVELAI_TOKEN'] = previous
    }
  })
})

describe('generation directory', () => {
  it('reports the deployment directory until an override is stored', async () => {
    const { controller, dir } = await settingsHarness()
    await expect(controller.generationDir()).resolves.toEqual({ dir, configured: false })
    await expect(controller.effectiveOutputDir()).resolves.toBe(dir)
  })

  it('reports a pre-seeded override resolved against the process cwd', async () => {
    const { controller } = await settingsHarness({ doc: { novelai: { generationDir: 'preset/novelai' } } })
    await expect(controller.generationDir()).resolves.toEqual({ dir: join(process.cwd(), 'preset', 'novelai'), configured: true })
  })

  it('persists the override and serves the library from it', async () => {
    const { controller, dir } = await settingsHarness()
    const target = join(dir, 'custom-library')
    const value = await controller.setGenerationDir({ dir: `  ${target}  ` })
    expect(value).toEqual({ dir: target, configured: true })
    await expect(controller.generationDir()).resolves.toEqual({ dir: target, configured: true })
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'placed.png'), Buffer.from([1]))
    const page = await controller.history({})
    expect(page.entries.map(entry => entry.id)).toContain('placed')
  })

  it('clears the override back to the deployment directory', async () => {
    const { controller, dir } = await settingsHarness()
    await controller.setGenerationDir({ dir: join(dir, 'custom-library') })
    await expect(controller.setGenerationDir({ dir: '   ' })).resolves.toEqual({ dir, configured: false })
  })

  it('refuses the write when no settings provider is mounted', async () => {
    const { controller } = await settingsHarness()
    // Simulate the unmounted-provider composition: the scope never bound.
    ;(controller as unknown as { settings: unknown }).settings = undefined
    await expect(controller.setGenerationDir({ dir: 'somewhere' }))
      .rejects.toMatchObject({ code: 'novelai/settings-write-failed' })
  })

  it('refuses the write when the provider is read-only', async () => {
    const { controller } = await settingsHarness({ writable: false })
    await expect(controller.setGenerationDir({ dir: 'somewhere' }))
      .rejects.toMatchObject({ code: 'novelai/settings-write-failed', message: /read-only/ })
  })

  it('maps a filesystem failure to the library error with the effective directory', async () => {
    const { controller, dir } = await settingsHarness()
    const overridden = join(dir, 'overridden')
    await controller.setGenerationDir({ dir: overridden })
    const ensure = vi.spyOn(NovelaiImageLibrary.prototype, 'ensure')
      .mockRejectedValue(new Error('EACCES: permission denied, mkdir'))
    const previous = process.env['NOVELAI_TOKEN']
    process.env['NOVELAI_TOKEN'] = 'test-token'
    try {
      await expect(controller.generate({ prompt: 'x' })).rejects.toMatchObject({
        code: 'novelai/library-unavailable',
        details: { path: overridden },
      })
    } finally {
      ensure.mockRestore()
      if (previous !== undefined) process.env['NOVELAI_TOKEN'] = previous
      else delete process.env['NOVELAI_TOKEN']
    }
  })
})

/** Committed panel state fixture. */
function workbenchState(prompt: string): NovelaiWorkbenchState {
  return {
    prompt,
    negativePrompt: 'lowres',
    model: 'nai-diffusion-4-full',
    width: 832,
    height: 1216,
    steps: 28,
    cfgScale: 5,
    sampler: 'k_euler_ancestral',
    noiseSchedule: 'karras',
    seed: 42,
  }
}

describe('workbench state persistence', () => {
  it('round-trips a commit through the hot map and serves it back', async () => {
    const { controller } = await harness()
    await expect(controller.commitWorkbenchState({ sessionId: 'session-1', state: workbenchState('1girl, solo') }))
      .resolves.toEqual({ ok: true })
    await expect(controller.readWorkbenchState({ sessionId: 'session-1' }))
      .resolves.toEqual({ state: workbenchState('1girl, solo') })
  })

  it('persists the commit under the harness home and restores it into a fresh controller', async () => {
    // The sandbox home comes from beforeEach; both controllers resolve the same
    // `<home>/novelai-workbench-states` directory.
    const first = await harness()
    await first.controller.commitWorkbenchState({ sessionId: 'session-9', state: workbenchState('committed prompt') })
    // A second controller over the same home (empty hot map) reads the durable document.
    const second = await harness()
    await expect(second.controller.readWorkbenchState({ sessionId: 'session-9' }))
      .resolves.toEqual({ state: workbenchState('committed prompt') })
    // The restored document backfills the hot map, so later reads keep serving it.
    await expect(second.controller.readWorkbenchState({ sessionId: 'session-9' }))
      .resolves.toEqual({ state: workbenchState('committed prompt') })
  })

  it('answers absent for a session that never committed', async () => {
    const { controller } = await harness()
    await expect(controller.readWorkbenchState({ sessionId: 'session-1' })).resolves.toEqual({})
  })

  it('refuses to persist an unsafe session id with the persist-failed code', async () => {
    const { controller } = await harness()
    await expect(controller.commitWorkbenchState({ sessionId: '../escape', state: workbenchState('1girl') }))
      .rejects.toMatchObject({ code: 'novelai/state-persist-failed', details: { message: expect.stringContaining('invalid workbench session id') } })
  })

  it('renders a non-Error persist failure into the same code', async () => {
    const { controller } = await harness()
    const store = (controller as unknown as { workbenchStore: WorkbenchStateStore }).workbenchStore
    const write = vi.spyOn(store, 'write').mockRejectedValueOnce('disk gone')
    try {
      await expect(controller.commitWorkbenchState({ sessionId: 'session-1', state: workbenchState('1girl') }))
        .rejects.toMatchObject({ code: 'novelai/state-persist-failed', details: { message: 'disk gone' } })
    } finally {
      write.mockRestore()
    }
  })

  it('reads an unpersistable session id as absent instead of failing', async () => {
    const { controller } = await harness()
    await expect(controller.readWorkbenchState({ sessionId: 'subagent:nested:parent' })).resolves.toEqual({})
  })

  it('degrades to memory-only when the harness home cannot resolve', async () => {
    homeState.resolveFails = true
    try {
      const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-novelai-controller-')))
      const ctx = new Context()
      roots.push(ctx)
      ctx.provide('typert', {
        lookups: { configure: () => (): void => {} },
        contexts: { configureHost: () => (): void => {} },
      } as never)
      ctx.provide('llm', { stream: async function* () {} } as never)
      ctx.provide('attachments', { saveImage: async () => ({ attachmentId: 'att-1', mediaType: 'image/png', bytes: 1, width: 64, height: 64 }) } as never)
      ctx.provide('settings', settingsProvider())
      const warnings: string[] = []
      ctx.logger.warn = ((message: unknown) => { warnings.push(String(message)) }) as typeof ctx.logger.warn
      const controller = new NovelaiController(ctx, {
        outputDir: dir,
        tagIndexPath: join(dir, 'tag-index.csv'),
        splitProvider: 'mock',
        splitModel: 'mock',
        splitMaxTokens: 4096,
        reverseProvider: 'mock',
        reverseModel: 'mock',
        reverseMaxTokens: 7000,
      })
      await ctx.plugin({ apply: () => {} })
      // The composition kept booting; the degradation is announced.
      expect(warnings.some(message => message.includes('degrade to host memory'))).toBe(true)
      // The hot map still serves the generation tool's prompt source.
      await expect(controller.commitWorkbenchState({ sessionId: 'session-1', state: workbenchState('1girl') }))
        .resolves.toEqual({ ok: true })
      await expect(controller.readWorkbenchState({ sessionId: 'session-1' }))
        .resolves.toEqual({ state: workbenchState('1girl') })
    } finally {
      homeState.resolveFails = false
    }
  })
})

describe('artist chains', () => {
  it('answers an empty library before anything is saved', async () => {
    const { controller } = await harness()
    await expect(controller.artistChains()).resolves.toEqual({ chains: [] })
  })

  it('creates named chains verbatim and serves them newest first', async () => {
    const { controller } = await harness()
    await controller.saveArtistChain({ id: '', name: '厚涂风', tags: '0.3:cola gotouryouta::, 0.5:yoneyama mai::, 0.9:re0n::, 1.8:kim hyung tae::' })
    const saved = await controller.saveArtistChain({ id: '', name: 'watercolor', tags: '0.8:wlop::, 1.2:artgerm::' })
    expect(saved.chains.map(chain => chain.name)).toEqual(['watercolor', '厚涂风'])
    expect(saved.chains[1]?.tags).toBe('0.3:cola gotouryouta::, 0.5:yoneyama mai::, 0.9:re0n::, 1.8:kim hyung tae::')
    for (const chain of saved.chains) expect(chain.id).toMatch(/[0-9a-f-]{36}/)
  })

  it('updates a chain in place through its stored id', async () => {
    const { controller } = await harness()
    const first = await controller.saveArtistChain({ id: '', name: '厚涂风', tags: '0.3:cola gotouryouta::' })
    const target = first.chains[0]
    if (target === undefined) throw new Error('fixture chain missing')
    const updated = await controller.saveArtistChain({ id: target.id, name: '厚涂风', tags: '0.3:cola gotouryouta::, 0.9:re0n::, 1.8:kim hyung tae::' })
    expect(updated.chains).toEqual([expect.objectContaining({ id: target.id, name: '厚涂风', tags: '0.3:cola gotouryouta::, 0.9:re0n::, 1.8:kim hyung tae::' })])
  })

  it('removes by id and refuses unknown ids with the missing code', async () => {
    const { controller } = await harness()
    const created = await controller.saveArtistChain({ id: '', name: '厚涂风', tags: '0.3:cola gotouryouta::' })
    const target = created.chains[0]
    if (target === undefined) throw new Error('fixture chain missing')
    const after = await controller.removeArtistChain({ id: target.id })
    expect(after.chains).toEqual([])
    await expect(controller.removeArtistChain({ id: 'no-such-id' }))
      .rejects.toMatchObject({ code: 'novelai/artist-chain-missing', details: { id: 'no-such-id' } })
    await expect(controller.saveArtistChain({ id: 'no-such-id', name: 'ok', tags: '0.9:re0n::' }))
      .rejects.toMatchObject({ code: 'novelai/artist-chain-missing', details: { id: 'no-such-id' } })
  })

  it('refuses invalid names and tags texts with the invalid code and the reason', async () => {
    const { controller } = await harness()
    await expect(controller.saveArtistChain({ id: '', name: '   ', tags: '0.9:re0n::' }))
      .rejects.toMatchObject({ code: 'novelai/artist-chain-invalid', details: { message: expect.stringContaining('name must not be empty') } })
    await expect(controller.saveArtistChain({ id: '', name: 'ok', tags: '   ' }))
      .rejects.toMatchObject({ code: 'novelai/artist-chain-invalid', details: { message: expect.stringContaining('tags must not be empty') } })
    await expect(controller.artistChains()).resolves.toEqual({ chains: [] })
  })

  it('persists the library across a fresh controller over the same harness home', async () => {
    const first = await harness()
    await first.controller.saveArtistChain({ id: '', name: '厚涂风', tags: '0.3:cola gotouryouta::, 0.9:re0n::' })
    const second = await harness()
    await expect(second.controller.artistChains())
      .resolves.toEqual({ chains: [expect.objectContaining({ name: '厚涂风', tags: '0.3:cola gotouryouta::, 0.9:re0n::' })] })
  })
})
