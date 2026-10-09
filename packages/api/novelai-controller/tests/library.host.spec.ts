import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { NovelaiImageLibrary, LIBRARY_INDEX_FILE } from '../src/library.ts'

const roots: string[] = []

afterEach(() => {
  roots.splice(0)
})

/** PNG chunk layout with zero CRC bytes; the parser walks length/type/data only. */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  for (const [index, char] of [...type].entries()) out[4 + index] = char.charCodeAt(0)
  out.set(data, 8)
  return out
}

/** Minimal NovelAI-style PNG carrying prompt metadata. */
function metaPng(seed: number): Uint8Array {
  const ihdr = new Uint8Array(13)
  new DataView(ihdr.buffer).setUint32(0, 832)
  new DataView(ihdr.buffer).setUint32(4, 1216)
  const comment = JSON.stringify({ prompt: '1girl, solo', uc: 'lowres', seed, steps: 28, sampler: 'k_euler', scale: 5 })
  const text = (keyword: string, value: string): Uint8Array => {
    const bytes = new Uint8Array(keyword.length + 1 + value.length)
    for (const [index, char] of [...keyword].entries()) bytes[index] = char.charCodeAt(0)
    for (const [index, char] of [...value].entries()) bytes[keyword.length + 1 + index] = char.charCodeAt(0)
    return bytes
  }
  const parts = [
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('tEXt', text('Title', '1girl, solo')),
    chunk('tEXt', text('Description', 'lowres')),
    chunk('tEXt', text('Comment', comment)),
    chunk('IEND', new Uint8Array(0)),
  ]
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

/** Fresh library root directory per test. */
function harness(): { library: NovelaiImageLibrary; dir: string } {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-novelai-library-')))
  roots.push(dir)
  return { library: new NovelaiImageLibrary(dir), dir }
}

describe('NovelaiImageLibrary', () => {
  it('lists an empty library for a missing directory', async () => {
    const { library } = harness()
    await expect(library.list()).resolves.toEqual([])
  })

  it('discovers foreign PNGs with their embedded metadata', async () => {
    const { library, dir } = harness()
    writeFileSync(join(dir, 'novelai-20260102-030405-42.png'), metaPng(42))
    const entries = await library.list()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ id: 'novelai-20260102-030405-42', width: 832, height: 1216, seed: 42, steps: 28, prompt: '1girl, solo', negativePrompt: 'lowres' })
  })

  it('records workbench submissions and lets the indexed row win over the scan', async () => {
    const { library, dir } = harness()
    await library.ensure()
    writeFileSync(join(dir, 'stem-a.png'), metaPng(7))
    await library.record({
      id: 'stem-a', file: join(dir, 'stem-a.png'), bytes: 5, width: 512, height: 512,
      seed: 7, model: 'nai-diffusion-4-5-full', steps: 28, prompt: 'p', negativePrompt: 'n',
      createdAt: new Date(0).toISOString(),
    })
    const entries = await library.list()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ bytes: 5, model: 'nai-diffusion-4-5-full', prompt: 'p' })
  })

  it('drops indexed rows whose file vanished', async () => {
    const { library, dir } = harness()
    await library.ensure()
    await library.record({
      id: 'gone', file: join(dir, 'gone.png'), bytes: 5, createdAt: new Date(0).toISOString(),
    })
    await expect(library.list()).resolves.toEqual([])
  })

  it('removes the file and the index row, reporting missing entries', async () => {
    const { library, dir } = harness()
    await library.ensure()
    writeFileSync(join(dir, 'stem.png'), metaPng(1))
    await library.record({ id: 'stem', file: join(dir, 'stem.png'), bytes: 5, createdAt: new Date(0).toISOString() })
    await expect(library.remove('stem')).resolves.toBe(true)
    await expect(library.remove('stem')).resolves.toBe(false)
    await expect(library.list()).resolves.toEqual([])
  })

  it('orders newest first', async () => {
    const { library, dir } = harness()
    await library.ensure()
    writeFileSync(join(dir, 'old.png'), metaPng(1))
    writeFileSync(join(dir, 'new.png'), metaPng(2))
    await library.record({ id: 'old', file: join(dir, 'old.png'), bytes: 1, createdAt: '2026-01-01T00:00:00.000Z' })
    await library.record({ id: 'new', file: join(dir, 'new.png'), bytes: 1, createdAt: '2026-01-02T00:00:00.000Z' })
    const entries = await library.list()
    expect(entries.map(entry => entry.id)).toEqual(['new', 'old'])
  })

  it('treats an unparseable index as empty and still scans the directory', async () => {
    const { library, dir } = harness()
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, LIBRARY_INDEX_FILE), '{broken')
    writeFileSync(join(dir, 'lonely.png'), metaPng(3))
    const entries = await library.list()
    expect(entries.map(entry => entry.id)).toEqual(['lonely'])
  })
})
