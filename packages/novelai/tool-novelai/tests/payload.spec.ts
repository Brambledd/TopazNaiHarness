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
      char_captions: [],
      char_prompts: [],
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

  it('omits the V4+ character fields on V3 models', () => {
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
    expect(payload.parameters['char_captions']).toBeUndefined()
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
