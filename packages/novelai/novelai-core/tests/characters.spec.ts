import { describe, expect, it } from 'vitest'
import { buildNovelaiPayload, charactersToPipePrompt, maxNovelaiCharacters, supportsNovelaiCharacters } from '../src/payload.ts'
import type { NovelaiGenerateInput } from '../src/types.ts'

function base(overrides: Partial<NovelaiGenerateInput> = {}): NovelaiGenerateInput {
  return {
    prompt: 'masterpiece, 2girls, park',
    negativePrompt: 'lowres',
    model: 'nai-diffusion-4-5-full',
    width: 832,
    height: 1216,
    steps: 28,
    cfgScale: 5,
    sampler: 'k_euler',
    noiseSchedule: 'native',
    seed: 42,
    ...overrides,
  }
}

describe('structured character captions', () => {
  it('reports the per-generation capacity', () => {
    expect(maxNovelaiCharacters('nai-diffusion-4-5-full')).toBe(6)
    expect(maxNovelaiCharacters('nai-diffusion-5-full')).toBe(32)
    expect(maxNovelaiCharacters('nai-diffusion-3-full')).toBe(0)
    expect(supportsNovelaiCharacters('nai-diffusion-4-5-full')).toBe(true)
    expect(supportsNovelaiCharacters('nai-diffusion-3-full')).toBe(false)
  })

  it('writes positive captions, AI-choice sentinel centers, and use_coords', () => {
    const payload = buildNovelaiPayload(base({
      characters: [
        { prompt: '1girl, blue hair', negativePrompt: '', useCoords: false, x: 0.5, y: 0.5 },
        { prompt: '1girl, red hair', negativePrompt: 'extra ears', useCoords: true, x: 0.2, y: 0.8 },
      ],
    }))
    type CaptionList = Array<{ char_caption: string; centers: Array<{ x: number; y: number }> }>
    const positive = (payload.parameters.v4_prompt as { caption: { char_captions: CaptionList } }).caption
    expect(positive.char_captions).toHaveLength(2)
    expect(positive.char_captions[0]).toEqual({ char_caption: '1girl, blue hair', centers: [{ x: 0.5, y: 0.5 }] })
    expect(positive.char_captions[1]?.centers).toEqual([{ x: 0.2, y: 0.8 }])
    expect(payload.parameters.use_coords).toBe(true)
  })

  it('mirrors the negative captions one-for-one whenever characters exist', () => {
    const withNegative = buildNovelaiPayload(base({
      characters: [
        { prompt: '1girl', negativePrompt: 'extra ears', useCoords: false, x: 0.5, y: 0.5 },
        { prompt: '1boy', negativePrompt: '', useCoords: false, x: 0.5, y: 0.5 },
      ],
    }))
    const negative = (withNegative.parameters.v4_negative_prompt as { caption: { char_captions: unknown[] } }).caption
    expect(negative.char_captions).toEqual([
      { char_caption: 'extra ears', centers: [{ x: 0.5, y: 0.5 }] },
      { char_caption: '', centers: [{ x: 0.5, y: 0.5 }] },
    ])
    // A populated positive list with an empty negative list is a server-side
    // rejection risk: the mirror ships even when every personal negative is empty.
    const withoutNegative = buildNovelaiPayload(base({
      characters: [{ prompt: '1girl', negativePrompt: '', useCoords: false, x: 0.5, y: 0.5 }],
    }))
    expect((withoutNegative.parameters.v4_negative_prompt as { caption: { char_captions: unknown[] } }).caption.char_captions).toEqual([
      { char_caption: '', centers: [{ x: 0.5, y: 0.5 }] },
    ])
  })

  it('clamps coordinates and drops blank captions beyond trimming', () => {
    const payload = buildNovelaiPayload(base({
      characters: [
        { prompt: '  ', negativePrompt: '', useCoords: false, x: 0.5, y: 0.5 },
        { prompt: '1boy', negativePrompt: '', useCoords: true, x: 2, y: -1 },
      ],
    }))
    type CaptionList = Array<{ char_caption: string; centers: Array<{ x: number; y: number }> }>
    const positive = (payload.parameters.v4_prompt as { caption: { char_captions: CaptionList } }).caption
    expect(positive.char_captions).toHaveLength(1)
    expect(positive.char_captions[0]?.centers).toEqual([{ x: 1, y: 0 }])
  })

  it('caps captions at the model capacity', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ prompt: `char ${String(i)}`, negativePrompt: '', useCoords: false, x: 0.5, y: 0.5 }))
    const payload = buildNovelaiPayload(base({ characters: many }))
    const positive = (payload.parameters.v4_prompt as { caption: { char_captions: unknown[] } }).caption
    expect(positive.char_captions).toHaveLength(6)
  })

  it('keeps empty captions when no characters are set', () => {
    const payload = buildNovelaiPayload(base())
    expect((payload.parameters.v4_prompt as { caption: { char_captions: unknown[] } }).caption.char_captions).toEqual([])
    expect(payload.parameters.use_coords).toBe(false)
  })

  it('folds characters into one pipe-joined prompt on demand', () => {
    expect(charactersToPipePrompt('park', [
      { prompt: '1girl, blue hair', negativePrompt: '', useCoords: false, x: 0.5, y: 0.5 },
      { prompt: '1girl, red hair', negativePrompt: '', useCoords: false, x: 0.5, y: 0.5 },
    ])).toBe('park | 1girl, blue hair | 1girl, red hair')
    expect(charactersToPipePrompt('park', [])).toBe('park')
  })
})
