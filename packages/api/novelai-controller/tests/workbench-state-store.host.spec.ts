import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkbenchStateStore, isValidWorkbenchSessionId } from '../src/workbench-state-store.ts'
import type { NovelaiWorkbenchState } from '../src/types.ts'

const roots: string[] = []

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Committed panel state fixture; `seed` omitted keeps the wire field optional. */
function state(prompt: string, seed?: number): NovelaiWorkbenchState {
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
    ...(seed === undefined ? {} : { seed }),
  }
}

/** Store over a fresh, not-yet-created states directory plus its warning sink. */
function store(): { store: WorkbenchStateStore; statesDir: string; warn: ReturnType<typeof vi.fn> } {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-novelai-workbench-store-')))
  roots.push(root)
  const statesDir = join(root, 'novelai-workbench-states')
  const warn = vi.fn()
  return { store: new WorkbenchStateStore(statesDir, warn), statesDir, warn }
}

describe('WorkbenchStateStore', () => {
  it('round-trips a committed state through the session document, creating the directory on first use', async () => {
    const { store: store_, statesDir, warn } = store()
    await store_.write('session-1', state('1girl, solo', 42))
    await expect(store_.read('session-1')).resolves.toEqual(state('1girl, solo', 42))
    expect(warn).not.toHaveBeenCalled()
    expect(readFileSync(join(statesDir, 'session-1.json'), 'utf8')).toContain('"prompt": "1girl, solo"')
  })

  it('replaces the document atomically: a second write leaves no temporary residue', async () => {
    const { store: store_, statesDir } = store()
    await store_.write('session-1', state('first'))
    await store_.write('session-1', state('second', 7))
    await expect(store_.read('session-1')).resolves.toEqual(state('second', 7))
    expect(readdirSync(statesDir).sort()).toEqual(['session-1.json'])
  })

  it('reads a missing session as absent', async () => {
    const { store: store_ } = store()
    await store_.write('session-1', state('1girl'))
    await expect(store_.read('session-2')).resolves.toBeUndefined()
  })

  it('reads an unparseable document as absent', async () => {
    const { store: store_, statesDir } = store()
    await store_.write('session-1', state('1girl'))
    writeFileSync(join(statesDir, 'session-1.json'), '{not json', 'utf8')
    await expect(store_.read('session-1')).resolves.toBeUndefined()
  })

  it('reads a wrong-shaped document as absent', async () => {
    const { store: store_, statesDir } = store()
    await store_.write('session-1', state('1girl'))
    for (const broken of ['42', '[]', JSON.stringify({ prompt: '1girl' }), JSON.stringify({ ...state('1girl'), seed: '42' })]) {
      writeFileSync(join(statesDir, 'session-1.json'), broken, 'utf8')
      await expect(store_.read('session-1')).resolves.toBeUndefined()
    }
  })

  it('reads a state without a seed back as a valid state', async () => {
    const { store: store_ } = store()
    await store_.write('session-1', state('1girl'))
    await expect(store_.read('session-1')).resolves.toEqual(state('1girl'))
  })

  it('rejects session ids that could name paths outside the states directory', async () => {
    const { store: store_ } = store()
    for (const bad of ['', '../escape', 'a/b', 'with:colon', 'x'.repeat(65)]) {
      await expect(store_.write(bad, state('1girl'))).rejects.toThrowError(/invalid workbench session id/)
      await expect(store_.read(bad)).rejects.toThrowError(/invalid workbench session id/)
    }
  })

  it('rethrows read failures other than absence', async () => {
    const { store: store_, statesDir } = store()
    await store_.write('session-1', state('1girl'))
    mkdirSync(join(statesDir, 'session-2.json'))
    await expect(store_.read('session-2')).rejects.toThrowError()
  })

  it('degrades to memory-only without a directory and warns at construction', async () => {
    const warn = vi.fn()
    const degraded = new WorkbenchStateStore(undefined, warn)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toContain('degrade to host memory')
    await expect(degraded.write('session-1', state('1girl'))).resolves.toBeUndefined()
    await expect(degraded.read('session-1')).resolves.toBeUndefined()
  })

  it('guards ids before they touch the filesystem', () => {
    expect(isValidWorkbenchSessionId('session-1')).toBe(true)
    expect(isValidWorkbenchSessionId('a'.repeat(64))).toBe(true)
    expect(isValidWorkbenchSessionId('')).toBe(false)
    expect(isValidWorkbenchSessionId('../escape')).toBe(false)
    expect(isValidWorkbenchSessionId('with:colon')).toBe(false)
    expect(isValidWorkbenchSessionId('a'.repeat(65))).toBe(false)
  })
})
