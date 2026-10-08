import { mkdtempSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { estimateAnlas } from '@deepseek-ai/dsh-novelai-core'
import { NOVELAI_WORKBENCH_DEFAULTS, resolveGenerationRequest, runGeneration } from '../src/generation.ts'

describe('resolveGenerationRequest', () => {
  it('fills every omitted parameter with the workbench default', () => {
    const resolved = resolveGenerationRequest({ prompt: '1girl' })
    expect(resolved).toMatchObject({
      prompt: '1girl',
      negativePrompt: NOVELAI_WORKBENCH_DEFAULTS.negativePrompt,
      model: 'nai-diffusion-4-5-full',
      width: 832,
      height: 1216,
      steps: 28,
      cfgScale: 5,
      sampler: 'k_euler',
      noiseSchedule: 'native',
    })
    expect(resolved.seed).toBeGreaterThanOrEqual(0)
    expect(resolved.seed).toBeLessThanOrEqual(0xffff_ffff)
  })

  it('treats a blank negative prompt as omitted and keeps an explicit seed', () => {
    const resolved = resolveGenerationRequest({ prompt: 'x', negativePrompt: '   ', seed: 7 })
    expect(resolved.negativePrompt).toBe(NOVELAI_WORKBENCH_DEFAULTS.negativePrompt)
    expect(resolved.seed).toBe(7)
  })
})

describe('runGeneration', () => {
  const base = {
    token: 'token-value',
    proxyUrl: '',
    baseUrl: 'https://image.novelai.net',
    timeoutMs: 1000,
  }

  it('submits once, saves the PNG, and prices the request', async () => {
    const submissions: string[] = []
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])
    const outputDir = mkdtempSync(join(tmpdir(), 'dsh-novelai-gen-'))
    const value = await runGeneration({ prompt: 'solo', seed: 11 }, {
      ...base,
      outputDir,
      submit: async ({ payload }) => {
        submissions.push(String(payload.model))
        return [png]
      },
    })
    expect(submissions).toEqual(['nai-diffusion-4-5-full'])
    expect(value.seed).toBe(11)
    expect(value.anlasEstimate).toBe(estimateAnlas(832, 1216, 28))
    await expect(readFile(value.file)).resolves.toEqual(Buffer.from(png))
  })

  it('fails loud when no token is configured', async () => {
    await expect(runGeneration({ prompt: 'x' }, { ...base, token: '  ', outputDir: '.' })).rejects.toThrow(/token/)
  })

  it('surfaces submission failures verbatim', async () => {
    await expect(runGeneration({ prompt: 'x' }, {
      ...base,
      outputDir: '.',
      submit: async () => { throw new Error('HTTP 402 Payment Required') },
    })).rejects.toThrow(/402/)
  })
})
