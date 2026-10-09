import { describe, expect, it } from 'vitest'
import { buildNovelaiPayload, estimateAnlas, generationFileStem } from '../src/payload.ts'

describe('buildNovelaiPayload', () => {
  it('assembles the text-to-image wire body with resolved defaults', () => {
    const payload = buildNovelaiPayload({
      prompt: '1girl, solo',
      negativePrompt: 'lowres',
      model: 'nai-diffusion-4-5-full',
      width: 832,
      height: 1216,
      steps: 28,
      cfgScale: 5,
      sampler: 'k_euler',
      noiseSchedule: 'native',
      seed: 42,
    })
    expect(payload.input).toBe('1girl, solo')
    expect(payload.model).toBe('nai-diffusion-4-5-full')
    expect(payload.action).toBe('generate')
    expect(payload.parameters).toMatchObject({
      width: 832,
      height: 1216,
      steps: 28,
      scale: 5,
      sampler: 'k_euler',
      seed: 42,
      n_samples: 1,
      noise_schedule: 'native',
      uc: 'lowres',
      negative_prompt: 'lowres',
    })
    expect(payload.parameters['v4_prompt']).toEqual({
      caption: { base_caption: '1girl, solo', char_captions: [] },
      use_coords: false,
      use_order: true,
    })
    expect(payload.parameters['v4_negative_prompt']).toEqual({
      caption: { base_caption: 'lowres', char_captions: [] },
      use_coords: false,
      use_order: false,
      legacy_uc: false,
    })
  })

  it('normalizes every V5 request to the karras noise schedule', () => {
    const payload = buildNovelaiPayload({
      prompt: 'x',
      negativePrompt: 'y',
      model: 'nai-diffusion-5-full',
      width: 832,
      height: 1216,
      steps: 28,
      cfgScale: 6,
      sampler: 'k_dpmpp_2m',
      noiseSchedule: 'native',
      seed: 1,
    })
    expect(payload.parameters['noise_schedule']).toBe('karras')
  })

  it('clamps cfg scale and seed into the accepted ranges', () => {
    const payload = buildNovelaiPayload({
      prompt: 'x',
      negativePrompt: 'y',
      model: 'nai-diffusion-3',
      width: 512,
      height: 768,
      steps: 28,
      cfgScale: 99,
      sampler: 'k_euler',
      noiseSchedule: 'native',
      seed: Number.MAX_SAFE_INTEGER,
    })
    expect(payload.parameters['scale']).toBe(10)
    expect(payload.parameters['seed']).toBe(0xffff_ffff)
  })

  it('omits the V4+ structured prompt objects on V3 models', () => {
    const payload = buildNovelaiPayload({
      prompt: 'x',
      negativePrompt: 'y',
      model: 'nai-diffusion-3',
      width: 512,
      height: 768,
      steps: 28,
      cfgScale: 7,
      sampler: 'k_euler',
      noiseSchedule: 'native',
      seed: 1,
    })
    expect(payload.parameters['v4_prompt']).toBeUndefined()
  })

  it('appends the checkpoint standard quality tags at the prompt end', () => {
    const payload = buildNovelaiPayload({
      prompt: '1girl',
      negativePrompt: 'y',
      model: 'nai-diffusion-4-5-full',
      width: 832,
      height: 1216,
      steps: 28,
      cfgScale: 5,
      sampler: 'k_euler',
      noiseSchedule: 'native',
      seed: 1,
      qualityPreset: 'standard',
    })
    expect(payload.input).toBe('1girl, very aesthetic, masterpiece, no text')
    expect((payload.parameters['v4_prompt'] as { caption: { base_caption: string } }).caption.base_caption)
      .toBe('1girl, very aesthetic, masterpiece, no text')
    expect(payload.parameters).toMatchObject({ qualityPresetId: 'standard', quality_toggle: true, tag_hint_qt: 1 })
  })

  it('uses the V5-only light tags on V5 and falls back to standard elsewhere', () => {
    const base = {
      prompt: '1girl',
      negativePrompt: 'y',
      width: 832,
      height: 1216,
      steps: 28,
      cfgScale: 5,
      sampler: 'k_euler' as const,
      noiseSchedule: 'native' as const,
      seed: 1,
    }
    const v5 = buildNovelaiPayload({ ...base, model: 'nai-diffusion-5-full', qualityPreset: 'light' })
    expect(v5.input).toBe('1girl, very aesthetic, amazing quality, no text')
    expect(v5.parameters['tag_hint_qt']).toBe(3)
    const v4 = buildNovelaiPayload({ ...base, model: 'nai-diffusion-4-5-full', qualityPreset: 'light' })
    expect(v4.input).toBe('1girl, very aesthetic, masterpiece, no text')
  })

  it('drops the contradicting no-text tag beside an explicit Text directive', () => {
    const payload = buildNovelaiPayload({
      prompt: 'sign saying Text: WELCOME',
      negativePrompt: 'y',
      model: 'nai-diffusion-4-5-full',
      width: 832,
      height: 1216,
      steps: 28,
      cfgScale: 5,
      sampler: 'k_euler',
      noiseSchedule: 'native',
      seed: 1,
      qualityPreset: 'standard',
    })
    expect(payload.input).toBe('sign saying Text: WELCOME, very aesthetic, masterpiece')
  })

  it('leaves the prompt verbatim when no preset applies', () => {
    const payload = buildNovelaiPayload({
      prompt: '1girl',
      negativePrompt: 'y',
      model: 'nai-diffusion-4-5-full',
      width: 832,
      height: 1216,
      steps: 28,
      cfgScale: 5,
      sampler: 'k_euler',
      noiseSchedule: 'native',
      seed: 1,
    })
    expect(payload.input).toBe('1girl')
    expect(payload.parameters['qualityPresetId']).toBe('none')
  })

  it('requests the V5 alpha channel for a transparent background, V5 only', () => {
    const base = {
      prompt: '1girl',
      negativePrompt: 'y',
      width: 832,
      height: 1216,
      steps: 28,
      cfgScale: 5,
      sampler: 'k_euler' as const,
      noiseSchedule: 'native' as const,
      seed: 1,
      transparentBackground: true,
    }
    const v5 = buildNovelaiPayload({ ...base, model: 'nai-diffusion-5-full', qualityPreset: 'none' })
    expect(v5.input).toBe('1girl, transparent background')
    expect(v5.parameters['straight_alpha']).toBe(true)
    expect(v5.parameters['tag_hint_transparent_background']).toBe(true)
    const v4 = buildNovelaiPayload({ ...base, model: 'nai-diffusion-4-5-full', qualityPreset: 'none' })
    expect(v4.input).toBe('1girl')
    expect(v4.parameters['straight_alpha']).toBeUndefined()
  })
})

describe('estimateAnlas', () => {
  it('returns the official-formula estimate for a default-size request', () => {
    // 832*1216 = 1011712 pixels, 28 steps → the uncapped formula lands near 29 Anlas.
    expect(estimateAnlas(832, 1216, 28)).toBeGreaterThan(10)
    expect(estimateAnlas(832, 1216, 28)).toBeLessThanOrEqual(140)
  })

  it('floors at 2 and caps at 140 Anlas', () => {
    expect(estimateAnlas(64, 64, 1)).toBe(2)
    expect(estimateAnlas(3072, 3072, 50)).toBe(140)
  })
})

describe('generationFileStem', () => {
  it('embeds the seed in a timestamped stem', () => {
    const stem = generationFileStem(1234, new Date(2026, 0, 2, 3, 4, 5))
    expect(stem).toBe('novelai-20260102-030405-1234')
  })
})
