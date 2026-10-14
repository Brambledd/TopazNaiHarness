import { describe, expect, it } from 'vitest'
import { resolveInput } from '../src/input.ts'

/** One fully populated workbench state. */
const COMMITTED = {
  prompt: '1girl, night city',
  negativePrompt: 'lowres',
  model: 'nai-diffusion-5-full',
  width: 1024,
  height: 1024,
  steps: 30,
  cfgScale: 6,
  sampler: 'k_euler_ancestral',
  noiseSchedule: 'karras',
  seed: 777,
}

describe('resolveInput (workbench binding)', () => {
  it('a committed state binds prompt and parameters; only seed/filename ride along', () => {
    const input = resolveInput({ prompt: 'ignored', width: 832, height: 1216, steps: 28 }, COMMITTED)
    expect(input.prompt).toBe('1girl, night city')
    expect(input.negativePrompt).toBe('lowres')
    expect(input.model).toBe('nai-diffusion-5-full')
    expect(input.width).toBe(1024)
    expect(input.height).toBe(1024)
    expect(input.steps).toBe(30)
    expect(input.cfgScale).toBe(6)
    expect(input.sampler).toBe('k_euler_ancestral')
    expect(input.noiseSchedule).toBe('karras')
    // The committed seed carries; the call's own seed still wins when given.
    expect(input.seed).toBe(777)
    expect(resolveInput({}, COMMITTED).seed).toBe(777)
    expect(resolveInput({ seed: 42 }, COMMITTED).seed).toBe(42)
  })

  it('without a committed state the call must carry its own prompt', () => {
    const input = resolveInput({ prompt: '1girl, park' }, undefined)
    expect(input.prompt).toBe('1girl, park')
    expect(() => resolveInput({}, undefined)).toThrow(/prompt is required/)
  })

  it('an empty committed workbench prompt fails with the rail guidance', () => {
    expect(() => resolveInput({}, { ...COMMITTED, prompt: '  ' })).toThrow(/workbench prompt is empty/)
  })

  it('an empty committed negative prompt falls back to the heavy preset', () => {
    const input = resolveInput({}, { ...COMMITTED, negativePrompt: '' })
    expect(input.negativePrompt).not.toBe('')
  })

  it('the call\'s characters pass through trimmed and capped, even under a live workbench', () => {
    const input = resolveInput({
      prompt: 'ignored',
      characters: [
        { prompt: ' 1girl, blue hair ', negativePrompt: ' extra ears ' },
        { prompt: '1girl, red hair' },
      ],
    }, COMMITTED)
    expect(input.characters).toEqual([
      { prompt: '1girl, blue hair', negativePrompt: 'extra ears' },
      { prompt: '1girl, red hair', negativePrompt: '' },
    ])
  })

  it('the committed panel\'s character cards bind over the call\'s characters', () => {
    const input = resolveInput({
      prompt: 'ignored',
      characters: [{ prompt: 'call character' }],
    }, {
      ...COMMITTED,
      characters: [
        { prompt: 'panel silver hair', negativePrompt: 'extra ears', useCoords: true, x: 0.3, y: 0.7 },
        { prompt: 'panel cat ears', useCoords: false, x: 0.5, y: 0.5 },
      ],
    })
    // The panel is the visible truth the operator applied; the wire-only
    // coordinate fields drop in the caption normalization.
    expect(input.characters).toEqual([
      { prompt: 'panel silver hair', negativePrompt: 'extra ears' },
      { prompt: 'panel cat ears', negativePrompt: '' },
    ])
  })

  it('an empty panel characters list falls back to the call\'s characters', () => {
    const input = resolveInput(
      { characters: [{ prompt: 'call character' }] },
      { ...COMMITTED, characters: [] },
    )
    expect(input.characters).toEqual([{ prompt: 'call character', negativePrompt: '' }])
  })

  it('binds the panel\'s batch count and interval, clamped; absent means a single image', () => {
    const batched = resolveInput({}, { ...COMMITTED, batchCount: 3, batchIntervalSec: 10 })
    expect(batched.batchCount).toBe(3)
    expect(batched.batchIntervalSec).toBe(10)
    // Values outside the panel's own ranges clamp instead of failing.
    const clamped = resolveInput({}, { ...COMMITTED, batchCount: 99, batchIntervalSec: -5 })
    expect(clamped.batchCount).toBe(8)
    expect(clamped.batchIntervalSec).toBe(0)
    // No panel batch settings: the fields stay absent (single image, default gap).
    const single = resolveInput({}, COMMITTED)
    expect(single.batchCount).toBeUndefined()
    expect(single.batchIntervalSec).toBeUndefined()
  })

  it('blank character entries drop and the checkpoint cap clamps the rest', () => {
    const seven = Array.from({ length: 7 }, (_, index) => ({ prompt: `char ${index}` }))
    const input = resolveInput({
      prompt: 'park',
      characters: [{ prompt: '  ' }, { prompt: '' }, ...seven],
    }, { ...COMMITTED, model: 'nai-diffusion-4-5-full' })
    expect(input.characters).toHaveLength(6)
    expect(input.characters![0]).toEqual({ prompt: 'char 0', negativePrompt: '' })
    expect(input.characters![5]).toEqual({ prompt: 'char 5', negativePrompt: '' })
  })

  it('absent or fully blank characters stay absent in the resolved input', () => {
    expect(resolveInput({ prompt: 'park' }, undefined).characters).toBeUndefined()
    expect(resolveInput({ prompt: 'park', characters: [{ prompt: '  ' }] }, undefined).characters).toBeUndefined()
    // V3 checkpoints accept no structured characters at all.
    const v3 = resolveInput({ prompt: 'park', characters: [{ prompt: '1girl' }] }, { ...COMMITTED, model: 'nai-diffusion-3' })
    expect(v3.characters).toBeUndefined()
  })
})
