import { describe, expect, it } from 'vitest'
import { buildNovelaiImg2ImgPayload, buildNovelaiPayload, estimateAnlas, generationFileStem } from '../src/payload.ts'

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

  it('assembles the enhance body: img2img action, clamped strength, fixed noise', () => {
    const payload = buildNovelaiImg2ImgPayload({
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
      image: 'aGVsbG8=',
      strength: 9,
    }, () => 0.5)
    expect(payload.action).toBe('img2img')
    expect(payload.parameters['image']).toBe('aGVsbG8=')
    expect(payload.parameters['strength']).toBe(1)
    expect(payload.parameters['noise']).toBe(0)
    expect(payload.parameters['extra_noise_seed']).toBe(Math.floor(0.5 * 0xffff_ffff))
  })

  it('keeps an explicit enhance extra noise seed verbatim', () => {
    const payload = buildNovelaiImg2ImgPayload({
      prompt: 'x',
      negativePrompt: 'y',
      model: 'nai-diffusion-5-full',
      width: 832,
      height: 1216,
      steps: 28,
      cfgScale: 5,
      sampler: 'k_euler',
      noiseSchedule: 'native',
      seed: 1,
      image: 'aGVsbG8=',
      strength: 0.2,
      extraNoiseSeed: 42,
    }, () => 0.9)
    expect(payload.parameters['extra_noise_seed']).toBe(42)
  })

  it('carries the official upscaled enhance on V5 only', () => {
    const base = {
      prompt: 'x',
      negativePrompt: 'y',
      width: 832,
      height: 1216,
      steps: 28,
      cfgScale: 5,
      sampler: 'k_euler' as const,
      noiseSchedule: 'native' as const,
      seed: 1,
      image: 'aGVsbG8=',
      strength: 0.2,
      upscaledEnhance: true,
    }
    const v5 = buildNovelaiImg2ImgPayload({ ...base, model: 'nai-diffusion-5-full' }, () => 0.1)
    expect(v5.parameters['upscaled_enhance']).toBe(true)
    const v4 = buildNovelaiImg2ImgPayload({ ...base, model: 'nai-diffusion-4-5-full' }, () => 0.1)
    expect(v4.parameters['upscaled_enhance']).toBeUndefined()
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
