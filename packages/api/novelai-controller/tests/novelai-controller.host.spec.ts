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

/** Service harness over a temporary output directory.
 * @param llmText - text streamed back by the fake LLM for the split call.
 * @param finishKind - finish reason the fake LLM reports. */
function harness(llmText = '', finishKind: 'stop' | 'max-tokens' = 'stop'): { controller: NovelaiController; library: NovelaiImageLibrary; dir: string } {
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
  const library = new NovelaiImageLibrary(dir)
  return {
    controller: new NovelaiController(ctx, {
      outputDir: dir,
      tagIndexPath: join(dir, 'tag-index.csv'),
      splitProvider: 'mock',
      splitModel: 'mock',
      splitMaxTokens: 4096,
      reverseProvider: 'mock',
      reverseModel: 'mock',
      reverseMaxTokens: 7000,
    }),
    library,
    dir,
  }
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

  it('splits a merged prompt into base and per-character captions through the LLM', async () => {
    const text = '{"prompt":"park, masterpiece","characters":[{"prompt":"1girl, blue hair"},{"prompt":"1girl, red hair","negativePrompt":"extra ears"}]}'
    const { controller } = harness(`Here you go: ${text}`)
    const value = await controller.splitCharacters({ prompt: 'park, masterpiece, 2girls, blue hair, red hair' })
    expect(value.prompt).toBe('park, masterpiece')
    expect(value.characters).toHaveLength(2)
    expect(value.characters[0]).toMatchObject({ prompt: '1girl, blue hair', negativePrompt: '', useCoords: false })
    expect(value.characters[1]?.negativePrompt).toBe('extra ears')
  })

  it('maps an unusable split answer to the namespace error', async () => {
    const { controller } = harness('I cannot do that')
    await expect(controller.splitCharacters({ prompt: '1girl' })).rejects.toMatchObject({ code: 'novelai/split-failed' })
  })

  it('accepts a complete split answer even when the finish reason is max-tokens', async () => {
    const text = '{"prompt":"park","characters":[{"prompt":"1girl, blue hair"}]}'
    const { controller } = harness(text, 'max-tokens')
    const value = await controller.splitCharacters({ prompt: 'park, 1girl' })
    expect(value.characters).toHaveLength(1)
  })

  it('salvages the complete character entries of a token-truncated answer', async () => {
    const truncated = '{"prompt":"park","characters":[{"prompt":"1girl, blue hair"},{"prompt":"1g'
    const { controller } = harness(truncated, 'max-tokens')
    const value = await controller.splitCharacters({ prompt: 'park' })
    expect(value.prompt).toBe('park')
    expect(value.characters).toEqual([
      { prompt: '1girl, blue hair', negativePrompt: '', useCoords: false, x: 0.5, y: 0.5 },
    ])
  })

  it('reports truncation with the configured budget when nothing survives', async () => {
    const { controller } = harness('{"prompt":"par', 'max-tokens')
    await expect(controller.splitCharacters({ prompt: 'park' })).rejects.toThrow(/splitMaxTokens/)
  })

  it('answers a blank split request without calling the model', async () => {
    const { controller } = harness()
    expect(await controller.splitCharacters({ prompt: '   ' })).toEqual({ prompt: '', characters: [] })
  })

  it('reverses an imported image into a prompt', async () => {
    const { controller } = harness('1girl, solo, white background, full body, standing')
    await expect(controller.reversePrompt({
      image: 'aGVsbG8=',
      mode: 'tags',
      scope: 'full',
      knownCharacter: false,
    })).resolves.toEqual({ prompt: '1girl, solo, white background, full body, standing' })
  })

  it('splits a known-character answer into identity and appearance variants', async () => {
    const { controller } = harness('NAME PROMPT:\ntopaz (honkai: star rail)\n\nFEATURE PROMPT:\nsilver hair, blue eyes, school uniform')
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
    const { controller } = harness('', 'stop')
    await expect(controller.reversePrompt({
      image: 'aGVsbG8=',
      mode: 'tags',
      scope: 'full',
      knownCharacter: false,
    })).rejects.toMatchObject({ code: 'novelai/reverse-failed' })
  })

  it('reads the NovelAI-embedded parameters of an imported PNG', async () => {
    const { controller } = harness()
    // signature + IHDR (832×1216) + tEXt Title + tEXt Description + tEXt Comment + IEND.
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
    parts.push(chunk('tEXt', text('Title', '1girl, solo')))
    parts.push(chunk('tEXt', text('Description', 'lowres')))
    parts.push(chunk('tEXt', text('Comment', '{"prompt":"1girl, solo","seed":42,"steps":28,"sampler":"k_euler","scale":5}')))
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
    const { controller } = harness()
    await expect(controller.inspectImage({ image: 'aGVsbG8=' })).resolves.toEqual({ hasMeta: false })
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
