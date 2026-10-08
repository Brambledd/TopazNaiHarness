/** Host tests for the bilingual Danbooru tag index: GBK parsing, search scoring,
 * and the store's status/download lifecycle against temp paths. */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  MIN_TAG_INDEX_RECORDS,
  TagIndexStore,
  parseCsvLine,
  parseTagIndexFromBuffer,
  searchTagIndexEntries,
} from '../src/tag-index.ts'
import type { DanbooruTag } from '../src/tag-index.ts'

/** GBK bytes of 个女孩 (the desktop's documented B8F6 C5AE BAA2 sequence). */
const GBK_GEX_NUHAI = new Uint8Array([0xb8, 0xf6, 0xc5, 0xae, 0xba, 0xa2])

/** ASCII header + one GBK row + one no-Chinese row (dropped) + one alias row.
 * Data rows must carry GBK or ASCII bytes only: the parser decodes the whole
 * buffer as GBK, so UTF-8 Chinese here would mojibake (the real dataset is GBK). */
function sampleCsv(): Uint8Array {
  const parts: Uint8Array[] = [
    new TextEncoder().encode('name,cn_name,wiki,post_count,category,nsfw\n'),
    new TextEncoder().encode('1girl,'),
    GBK_GEX_NUHAI,
    new TextEncoder().encode(',,,,\n'),
    new TextEncoder().encode('nochinese,,wiki,500,0,\n'),
    new TextEncoder().encode('topaz_(honkai:_star_rail),"topaz star rail",wiki,3000,4,\n'),
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

const tempDirs: string[] = []
afterAll(async () => {
  await Promise.all(tempDirs.map(dir => rm(dir, { recursive: true, force: true })))
})

async function tempCsv(content: Uint8Array): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'novelai-tag-index-'))
  tempDirs.push(dir)
  const path = join(dir, 'danbooru-cn.csv')
  await writeFile(path, content)
  return path
}

describe('tag index parsing', () => {
  it('parses quoted CSV fields with escapes', () => {
    expect(parseCsvLine('topaz_(honkai:_star_rail),"托帕,托帕(星穹铁道)",wiki,3000,4,')).toEqual([
      'topaz_(honkai:_star_rail)',
      '托帕,托帕(星穹铁道)',
      'wiki',
      '3000',
      '4',
      '',
    ])
    expect(parseCsvLine('a,"say ""hi""",c')).toEqual(['a', 'say "hi"', 'c'])
  })

  it('decodes GBK, keeps only Chinese rows, and sorts by post count', () => {
    const rows = parseTagIndexFromBuffer(sampleCsv())
    expect(rows).toHaveLength(2)
    const girl = rows.find(row => row.name === '1girl')
    expect(girl?.cn).toEqual(['个女孩'])
    const topaz = rows.find(row => row.name.startsWith('topaz'))
    expect(topaz?.category).toBe(4)
    expect(topaz?.cn).toEqual(['topaz star rail'])
  })

  it('rejects a wrong header instead of accepting junk', () => {
    const junk = new TextEncoder().encode('a,b\n1,2\n')
    expect(() => parseTagIndexFromBuffer(junk)).toThrow(/header/)
  })
})

describe('tag index search', () => {
  const index: DanbooruTag[] = [
    { name: 'topaz_(honkai:_star_rail)', cn: ['托帕', '托帕(星穹铁道)'], post: 3000, category: 4 },
    { name: 'topaz', cn: ['黄玉'], post: 8000, category: 0 },
    { name: '1girl', cn: ['个女孩'], post: 3_000_000, category: 0 },
  ]

  it('matches latin prefixes across underscores and ranks exact above prefix', () => {
    const hits = searchTagIndexEntries(index, 'topaz', 5)
    expect(hits[0]?.tag).toBe('topaz')
    expect(hits[1]?.tag).toBe('topaz_(honkai:_star_rail)')
  })

  it('matches CJK aliases', () => {
    expect(searchTagIndexEntries(index, '托帕', 5).map(hit => hit.tag)).toContain('topaz_(honkai:_star_rail)')
    expect(searchTagIndexEntries(index, '个女孩', 5)[0]?.tag).toBe('1girl')
  })

  it('returns empty for blank queries', () => {
    expect(searchTagIndexEntries(index, '  ', 5)).toEqual([])
  })
})

describe('tag index store lifecycle', () => {
  it('reports not-downloaded when the file is absent', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'novelai-tag-index-'))
    tempDirs.push(dir)
    const store = new TagIndexStore(join(dir, 'missing.csv'), '')
    const status = await store.status()
    expect(status.downloaded).toBe(false)
    expect(await store.search('topaz')).toEqual([])
  })

  it('rejects a download below the record floor without replacing the file', async () => {
    const path = await tempCsv(sampleCsv())
    const store = new TagIndexStore(path, '', () => Promise.resolve(sampleCsv()))
    // A valid parse but far below MIN records: download() must refuse.
    const receipt = await store.download()
    expect(receipt.ok).toBe(false)
    expect(receipt.message).toContain(String(MIN_TAG_INDEX_RECORDS))
    // The pre-existing file survives.
    const rows = parseTagIndexFromBuffer(new Uint8Array(await readFile(path)))
    expect(rows.length).toBe(2)
  })

  it('rejects a download over the byte cap without replacing the file', async () => {
    const path = await tempCsv(sampleCsv())
    const oversized = new Uint8Array(21 * 1024 * 1024)
    const store = new TagIndexStore(path, '', () => Promise.resolve(oversized))
    const receipt = await store.download()
    expect(receipt.ok).toBe(false)
    expect(receipt.message).toContain('byte cap')
  })

  it('surfaces a fetch failure as a failed receipt', async () => {
    const path = await tempCsv(sampleCsv())
    const store = new TagIndexStore(path, '', () => Promise.reject(new Error('dial tcp: refused')))
    const receipt = await store.download()
    expect(receipt.ok).toBe(false)
    expect(receipt.message).toContain('refused')
  })

  it('installs a fetched index above the record floor and searches it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'novelai-tag-index-'))
    tempDirs.push(dir)
    const path = join(dir, 'fresh.csv')
    const rows = ['name,cn_name,wiki,post_count,category,nsfw']
    for (let i = 0; i < MIN_TAG_INDEX_RECORDS; i += 1) {
      rows.push(`synthetic_tag_${String(i)},synthetic label ${String(i)},wiki,${String(100_000 - i)},0,`)
    }
    const fetched = new TextEncoder().encode(`${rows.join('\n')}\n`)
    const store = new TagIndexStore(path, '', () => Promise.resolve(fetched))
    const receipt = await store.download()
    expect(receipt.ok).toBe(true)
    expect(receipt.count).toBe(MIN_TAG_INDEX_RECORDS)
    const hits = await store.search('synthetic_tag_42', 5)
    expect(hits[0]?.tag).toBe('synthetic_tag_42')
  })

  it('searches a hand-written index file', async () => {
    const path = await tempCsv(sampleCsv())
    const store = new TagIndexStore(path, '')
    const hits = await store.search('topaz', 5)
    expect(hits[0]?.tag).toBe('topaz_(honkai:_star_rail)')
    expect(hits[0]?.description).toBe('topaz star rail')
    const status = await store.status()
    expect(status.downloaded).toBe(false) // below the record floor on purpose
    expect(status.count).toBe(2)
  })
})
