import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArtistChainsStore, ArtistChainsRefusalError, ARTIST_CHAINS_CHAIN_MAX, ARTIST_CHAINS_NAME_MAX } from '../src/artist-chains.ts'
import type { NovelaiArtistChain } from '../src/types.ts'

const roots: string[] = []

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Store over a fresh, not-yet-created chains document plus its warning sink. */
function store(): { store: ArtistChainsStore; filePath: string; warn: ReturnType<typeof vi.fn> } {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-novelai-artist-chains-')))
  roots.push(root)
  const filePath = join(root, 'novelai-artist-chains.json')
  const warn = vi.fn()
  return { store: new ArtistChainsStore(filePath, warn), filePath, warn }
}

describe('ArtistChainsStore', () => {
  it('saves named chains verbatim, appending in insertion order with host-assigned ids', async () => {
    const { store: store_, warn } = store()
    const pasted = '0.3:cola gotouryouta::, 0.5:yoneyama mai::, 0.7:betabeet::, 0.9:re0n::, 1.8:kim hyung tae::'
    await store_.save({ name: '厚涂风', chain: pasted })
    await store_.save({ name: '  watercolor  ', chain: ' 0.8:wlop::, 1.2:artgerm:: ' })
    const chains = await store_.list()
    expect(chains.map(item => item.name)).toEqual(['厚涂风', 'watercolor'])
    // Whole-string, verbatim: no parsing, no recomposition.
    expect(chains[0]?.chain).toBe(pasted)
    expect(chains[1]?.chain).toBe('0.8:wlop::, 1.2:artgerm::')
    for (const item of chains) expect(item.id).toMatch(/[0-9a-f-]{36}/)
    expect(warn).not.toHaveBeenCalled()
  })

  it('re-saving an existing name replaces that chain in place, keeping its id and position', async () => {
    const { store: store_ } = store()
    await store_.save({ name: '厚涂风', chain: '0.3:cola gotouryouta::' })
    const first = await store_.save({ name: 'watercolor', chain: '0.8:wlop::' })
    const target = first.find(item => item.name === '厚涂风')
    if (target === undefined) throw new Error('fixture chain missing')
    const saved = await store_.save({ name: ' 厚涂风 ', chain: '0.3:cola gotouryouta::, 0.9:re0n::, 1.8:kim hyung tae::' })
    expect(saved.map(item => item.name)).toEqual(['厚涂风', 'watercolor'])
    expect(saved[0]?.id).toBe(target.id)
    expect(saved[0]?.chain).toBe('0.3:cola gotouryouta::, 0.9:re0n::, 1.8:kim hyung tae::')
  })

  it('removes one chain by id and keeps the rest', async () => {
    const { store: store_ } = store()
    await store_.save({ name: '厚涂风', chain: '0.3:cola gotouryouta::' })
    const saved = await store_.save({ name: 'watercolor', chain: '0.8:wlop::' })
    const target = saved.find(item => item.name === 'watercolor')
    if (target === undefined) throw new Error('fixture chain missing')
    const remaining = await store_.remove(target.id)
    expect(remaining.map(item => item.name)).toEqual(['厚涂风'])
  })

  it('persists the { chains } document across a new store instance (restart semantics) and leaves no temporary residue', async () => {
    const { store: store_, filePath } = store()
    await store_.save({ name: '厚涂风', chain: '0.3:cola gotouryouta::, 0.9:re0n::' })
    await store_.save({ name: 'watercolor', chain: '0.8:wlop::' })
    const served = await store_.list()
    const target = served.find(item => item.name === '厚涂风')
    if (target === undefined) throw new Error('fixture chain missing')
    await store_.remove(target.id)
    expect(readdirSync(join(filePath, '..')).sort()).toEqual(['novelai-artist-chains.json'])
    const persisted = JSON.parse(readFileSync(filePath, 'utf8')) as { chains: NovelaiArtistChain[] }
    expect(persisted.chains).toEqual([expect.objectContaining({ name: 'watercolor', chain: '0.8:wlop::' })])
    const restarted = new ArtistChainsStore(filePath, vi.fn())
    await expect(restarted.list()).resolves.toEqual([expect.objectContaining({ name: 'watercolor', chain: '0.8:wlop::' })])
  })

  it('reads a missing file as an empty library', async () => {
    const { store: store_ } = store()
    await expect(store_.list()).resolves.toEqual([])
  })

  it('reads unparseable and wrong-shaped documents as an empty library', async () => {
    // A fresh store per fixture: the in-memory cache would otherwise serve the
    // first read's answer for every later one.
    const { store: first, filePath } = store()
    writeFileSync(filePath, 'not json at all', 'utf8')
    await expect(first.list()).resolves.toEqual([])
    writeFileSync(filePath, '{"a": 1}', 'utf8')
    await expect(new ArtistChainsStore(filePath, vi.fn()).list()).resolves.toEqual([])
    writeFileSync(filePath, '{"chains": [42]}', 'utf8')
    await expect(new ArtistChainsStore(filePath, vi.fn()).list()).resolves.toEqual([])
    writeFileSync(filePath, '{"chains": [{"id": "x", "name": "ok"}]}', 'utf8')
    await expect(new ArtistChainsStore(filePath, vi.fn()).list()).resolves.toEqual([])
    writeFileSync(filePath, '"just a string"', 'utf8')
    await expect(new ArtistChainsStore(filePath, vi.fn()).list()).resolves.toEqual([])
  })

  it('rethrows read failures other than absence (the file path is a directory)', async () => {
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-novelai-artist-chains-')))
    roots.push(root)
    const directoryPath = join(root, 'novelai-artist-chains.json')
    mkdirSync(directoryPath)
    await expect(new ArtistChainsStore(directoryPath, vi.fn()).list()).rejects.toMatchObject({ code: 'EISDIR' })
  })

  it('refuses invalid names and chain texts without persisting anything', async () => {
    const { store: store_ } = store()
    await store_.save({ name: '厚涂风', chain: '0.3:cola gotouryouta::' })
    for (const request of [
      { name: '   ', chain: '0.9:re0n::' },
      { name: 'x'.repeat(ARTIST_CHAINS_NAME_MAX + 1), chain: '0.9:re0n::' },
      { name: 'ok', chain: '   ' },
      { name: 'ok', chain: 'x'.repeat(ARTIST_CHAINS_CHAIN_MAX + 1) },
    ]) {
      await expect(store_.save(request)).rejects.toMatchObject({ kind: 'invalid' })
    }
    await expect(store_.remove('no-such-id')).rejects.toBeInstanceOf(ArtistChainsRefusalError)
    await expect(store_.list()).resolves.toEqual([expect.objectContaining({ name: '厚涂风' })])
  })

  it('refuses removing from a cold store without creating the file', async () => {
    const { store: store_, filePath } = store()
    await expect(store_.remove('no-such-id')).rejects.toMatchObject({ kind: 'missing', id: 'no-such-id' })
    expect(readdirSync(join(filePath, '..'))).toEqual([])
  })

  it('saves through the document on a cold store', async () => {
    const { store: first, filePath } = store()
    await first.save({ name: '厚涂风', chain: '0.3:cola gotouryouta::' })
    // A restarted store has an empty cache: the save reads the document first,
    // so the re-save lands as the in-place replace of the persisted chain.
    const restarted = new ArtistChainsStore(filePath, vi.fn())
    await expect(restarted.save({ name: '厚涂风', chain: '0.3:cola gotouryouta::, 0.9:re0n::' }))
      .resolves.toEqual([expect.objectContaining({ name: '厚涂风', chain: '0.3:cola gotouryouta::, 0.9:re0n::' })])
  })

  it('degrades to memory-only without a file path and warns at construction', async () => {
    const warn = vi.fn()
    const store_ = new ArtistChainsStore(undefined, warn)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('artist chains degrade to host memory'))
    await store_.save({ name: '厚涂风', chain: '0.3:cola gotouryouta::' })
    await expect(store_.list()).resolves.toEqual([expect.objectContaining({ name: '厚涂风' })])
    await store_.remove((await store_.list())[0]?.id ?? '')
    await expect(store_.list()).resolves.toEqual([])
  })
})
