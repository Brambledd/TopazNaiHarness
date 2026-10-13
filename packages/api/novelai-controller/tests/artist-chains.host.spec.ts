import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArtistChainStore, ArtistChainRefusalError, ARTIST_CHAINS_NAME_MAX, ARTIST_CHAINS_TAGS_MAX } from '../src/artist-chains.ts'
import type { NovelaiArtistChain } from '../src/types.ts'

const roots: string[] = []

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Store over a fresh, not-yet-created chains array plus its warning sink. */
function store(): { store: ArtistChainStore; filePath: string; warn: ReturnType<typeof vi.fn> } {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-novelai-artist-chains-')))
  roots.push(root)
  const filePath = join(root, 'novelai-artist-chains.json')
  const warn = vi.fn()
  return { store: new ArtistChainStore(filePath, warn), filePath, warn }
}

describe('ArtistChainStore', () => {
  it('creates named chains verbatim with host-assigned ids and serves them newest first', async () => {
    const { store: store_, warn } = store()
    const pasted = '0.3:cola gotouryouta::, 0.5:yoneyama mai::, 0.7:betabeet::, 0.9:re0n::, 1.8:kim hyung tae::'
    const first = await store_.save({ id: '', name: '厚涂风', tags: pasted })
    const second = await store_.save({ id: '', name: '  watercolor  ', tags: ' 0.8:wlop::, 1.2:artgerm:: ' })
    // Newest first: the second save leads; names trim, tags trim their ends only.
    expect(first.map(item => item.name)).toEqual(['厚涂风'])
    expect(second.map(item => item.name)).toEqual(['watercolor', '厚涂风'])
    expect(second[0]?.tags).toBe('0.8:wlop::, 1.2:artgerm::')
    expect(second[1]?.tags).toBe(pasted)
    for (const item of second) expect(item.id).toMatch(/[0-9a-f-]{36}/)
    expect(warn).not.toHaveBeenCalled()
  })

  it('updates a chain in place through its id, keeping its slot and id', async () => {
    const { store: store_ } = store()
    const first = await store_.save({ id: '', name: '厚涂风', tags: '0.3:cola gotouryouta::' })
    await store_.save({ id: '', name: 'watercolor', tags: '0.8:wlop::' })
    const target = first[0]
    if (target === undefined) throw new Error('fixture chain missing')
    const updated = await store_.save({ id: target.id, name: '厚涂风 II', tags: '0.3:cola gotouryouta::, 0.9:re0n::, 1.8:kim hyung tae::' })
    // The updated chain keeps its oldest slot; the newer watercolor still leads.
    expect(updated.map(item => item.name)).toEqual(['watercolor', '厚涂风 II'])
    expect(updated[1]?.id).toBe(target.id)
    expect(updated[1]?.tags).toBe('0.3:cola gotouryouta::, 0.9:re0n::, 1.8:kim hyung tae::')
  })

  it('refuses updating through an unknown id', async () => {
    const { store: store_ } = store()
    await expect(store_.save({ id: 'no-such-id', name: 'ok', tags: '0.9:re0n::' }))
      .rejects.toBeInstanceOf(ArtistChainRefusalError)
  })

  it('removes one chain by id and keeps the rest', async () => {
    const { store: store_ } = store()
    await store_.save({ id: '', name: '厚涂风', tags: '0.3:cola gotouryouta::' })
    const saved = await store_.save({ id: '', name: 'watercolor', tags: '0.8:wlop::' })
    const target = saved[0]
    if (target === undefined) throw new Error('fixture chain missing')
    const remaining = await store_.remove(target.id)
    expect(remaining.map(item => item.name)).toEqual(['厚涂风'])
  })

  it('persists the chains array across a new store instance (restart semantics) and leaves no temporary residue', async () => {
    const { store: store_, filePath } = store()
    await store_.save({ id: '', name: '厚涂风', tags: '0.3:cola gotouryouta::, 0.9:re0n::' })
    await store_.save({ id: '', name: 'watercolor', tags: '0.8:wlop::' })
    const served = await store_.list()
    const target = served.find(item => item.name === '厚涂风')
    if (target === undefined) throw new Error('fixture chain missing')
    await store_.remove(target.id)
    expect(readdirSync(join(filePath, '..')).sort()).toEqual(['novelai-artist-chains.json'])
    // The document is a bare array, oldest first.
    const persisted = JSON.parse(readFileSync(filePath, 'utf8')) as NovelaiArtistChain[]
    expect(persisted).toEqual([expect.objectContaining({ name: 'watercolor', tags: '0.8:wlop::' })])
    const restarted = new ArtistChainStore(filePath, vi.fn())
    await expect(restarted.list()).resolves.toEqual([expect.objectContaining({ name: 'watercolor', tags: '0.8:wlop::' })])
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
    await expect(new ArtistChainStore(filePath, vi.fn()).list()).resolves.toEqual([])
    writeFileSync(filePath, '{"chains": []}', 'utf8')
    await expect(new ArtistChainStore(filePath, vi.fn()).list()).resolves.toEqual([])
    writeFileSync(filePath, '[42]', 'utf8')
    await expect(new ArtistChainStore(filePath, vi.fn()).list()).resolves.toEqual([])
    writeFileSync(filePath, '[{"id": "x", "name": "ok"}]', 'utf8')
    await expect(new ArtistChainStore(filePath, vi.fn()).list()).resolves.toEqual([])
    writeFileSync(filePath, '"just a string"', 'utf8')
    await expect(new ArtistChainStore(filePath, vi.fn()).list()).resolves.toEqual([])
  })

  it('rethrows read failures other than absence (the file path is a directory)', async () => {
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-novelai-artist-chains-')))
    roots.push(root)
    const directoryPath = join(root, 'novelai-artist-chains.json')
    mkdirSync(directoryPath)
    await expect(new ArtistChainStore(directoryPath, vi.fn()).list()).rejects.toMatchObject({ code: 'EISDIR' })
  })

  it('refuses invalid names and tags texts without persisting anything', async () => {
    const { store: store_ } = store()
    await store_.save({ id: '', name: '厚涂风', tags: '0.3:cola gotouryouta::' })
    for (const request of [
      { id: '', name: '   ', tags: '0.9:re0n::' },
      { id: '', name: 'x'.repeat(ARTIST_CHAINS_NAME_MAX + 1), tags: '0.9:re0n::' },
      { id: '', name: 'ok', tags: '   ' },
      { id: '', name: 'ok', tags: 'x'.repeat(ARTIST_CHAINS_TAGS_MAX + 1) },
    ]) {
      await expect(store_.save(request)).rejects.toMatchObject({ kind: 'invalid' })
    }
    await expect(store_.remove('no-such-id')).rejects.toMatchObject({ kind: 'missing', id: 'no-such-id' })
    await expect(store_.list()).resolves.toEqual([expect.objectContaining({ name: '厚涂风' })])
  })

  it('refuses removing from a cold store without creating the file', async () => {
    const { store: store_, filePath } = store()
    await expect(store_.remove('no-such-id')).rejects.toMatchObject({ kind: 'missing', id: 'no-such-id' })
    expect(readdirSync(join(filePath, '..'))).toEqual([])
  })

  it('saves through the array on a cold store', async () => {
    const { store: first, filePath } = store()
    const saved = await first.save({ id: '', name: '厚涂风', tags: '0.3:cola gotouryouta::' })
    const created = saved[0]
    if (created === undefined) throw new Error('fixture chain missing')
    // A restarted store has an empty cache: the update reads the array first,
    // so the in-place rewrite lands on the persisted chain.
    const restarted = new ArtistChainStore(filePath, vi.fn())
    await expect(restarted.save({ id: created.id, name: '厚涂风', tags: '0.3:cola gotouryouta::, 0.9:re0n::' }))
      .resolves.toEqual([expect.objectContaining({ name: '厚涂风', tags: '0.3:cola gotouryouta::, 0.9:re0n::' })])
  })

  it('degrades to memory-only without a file path and warns at construction', async () => {
    const warn = vi.fn()
    const store_ = new ArtistChainStore(undefined, warn)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('artist chains degrade to host memory'))
    await store_.save({ id: '', name: '厚涂风', tags: '0.3:cola gotouryouta::' })
    await expect(store_.list()).resolves.toEqual([expect.objectContaining({ name: '厚涂风' })])
    await store_.remove((await store_.list())[0]?.id ?? '')
    await expect(store_.list()).resolves.toEqual([])
  })
})
