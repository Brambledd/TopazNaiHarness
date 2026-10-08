import { mkdtempSync, writeFileSync } from 'node:fs'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { estimateAnlas } from '@deepseek-ai/dsh-novelai-core'
import { NovelaiImageLibrary } from '../src/library.ts'
import NovelaiController from '../src/index.ts'

const roots: Context[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
})

/** Service harness over a temporary output directory. */
function harness(): { controller: NovelaiController; library: NovelaiImageLibrary; dir: string } {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-novelai-controller-')))
  const ctx = new Context()
  roots.push(ctx)
  ctx.provide('typert', {
    lookups: { configure: () => (): void => {} },
    contexts: { configureHost: () => (): void => {} },
  } as never)
  const library = new NovelaiImageLibrary(dir)
  return { controller: new NovelaiController(ctx, { outputDir: dir, tagIndexPath: join(dir, 'tag-index.csv') }), library, dir }
}

describe('NovelaiController verbs', () => {
  it('serves the complete generation catalog', async () => {
    const { controller } = harness()
    const catalog = await controller.catalog()
    expect(catalog.models).toContain('nai-diffusion-4-5-full')
    expect(catalog.samplers).toContain('k_euler')
    expect(catalog.noiseSchedules).toContain('karras')
    expect(catalog.maxSeed).toBe(0xffff_ffff)
    expect(catalog.defaults).toMatchObject({ model: 'nai-diffusion-4-5-full', width: 832 })
  })

  it('quotes Anlas prices through the official formula', async () => {
    const { controller } = harness()
    await expect(controller.estimate({ width: 832, height: 1216, steps: 28 }))
      .resolves.toEqual({ anlas: estimateAnlas(832, 1216, 28) })
  })

  it('returns an empty history for a fresh library', async () => {
    const { controller } = harness()
    await expect(controller.history({})).resolves.toEqual({ entries: [], total: 0 })
  })

  it('serves recorded entries through history paging', async () => {
    const { controller, library, dir } = harness()
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
    const { controller } = harness()
    await expect(controller.removeEntry({ id: 'missing' })).rejects.toMatchObject({ code: 'novelai/entry-missing' })
  })

  it('reports the tag index as not downloaded and answers blank suggestions with an empty batch', async () => {
    const { controller } = harness()
    expect(await controller.status()).toMatchObject({ downloaded: false, count: 0, sizeBytes: 0 })
    expect(await controller.suggestTags({ prompt: '  ' })).toEqual({ tags: [] })
  })

  it('maps a missing token to the namespace error', async () => {
    const { controller } = harness()
    const previous = process.env['NOVELAI_TOKEN']
    delete process.env['NOVELAI_TOKEN']
    try {
      await expect(controller.generate({ prompt: 'x' })).rejects.toMatchObject({ code: 'novelai/token-missing' })
    } finally {
      if (previous !== undefined) process.env['NOVELAI_TOKEN'] = previous
    }
  })
})
