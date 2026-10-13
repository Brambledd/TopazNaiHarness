import { mkdtempSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { estimateAnlas } from '@deepseek-ai/dsh-novelai-core'
import { NOVELAI_WORKBENCH_DEFAULTS, runEnhancement, runGeneration, resolveGenerationRequest } from '../src/generation.ts'
import { resolveEffectiveOutputDir } from '../src/index.ts'

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

describe('resolveEffectiveOutputDir', () => {
  it('prefers a non-blank absolute override as-is', () => {
    const configured = join(tmpdir(), 'override')
    expect(resolveEffectiveOutputDir(`  ${configured}  `, join(tmpdir(), 'fallback'))).toEqual({ dir: configured, configured: true })
  })

  it('resolves a relative override against the process cwd', () => {
    expect(resolveEffectiveOutputDir('out/novelai', join(tmpdir(), 'fallback')))
      .toEqual({ dir: resolve('out', 'novelai'), configured: true })
  })

  it('falls back to the deployment directory, resolved, when the override is blank', () => {
    expect(resolveEffectiveOutputDir('   ', 'workspace/novelai'))
      .toEqual({ dir: resolve('workspace', 'novelai'), configured: false })
    const absolute = join(tmpdir(), 'fallback')
    expect(resolveEffectiveOutputDir('', absolute)).toEqual({ dir: absolute, configured: false })
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

  it('saves the PNG under the pinned clock local-time day folders', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])
    const outputDir = mkdtempSync(join(tmpdir(), 'dsh-novelai-gen-'))
    const value = await runGeneration({ prompt: 'solo', seed: 11 }, {
      ...base,
      outputDir,
      now: new Date(2026, 0, 2, 9, 30),
      submit: async () => [png],
    })
    expect(value.file).toBe(join(outputDir, '2026', '01', '02', `${value.id}.png`))
    expect(value.createdAt).toBe(new Date(2026, 0, 2, 9, 30).toISOString())
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

describe('runEnhancement', () => {
  const base = {
    token: 'token-value',
    proxyUrl: '',
    baseUrl: 'https://image.novelai.net',
    timeoutMs: 1000,
  }

  it('submits one img2img body with the resized source and strength', async () => {
    const bodies: unknown[] = []
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 5, 6])
    const outputDir = mkdtempSync(join(tmpdir(), 'dsh-novelai-enh-'))
    const value = await runEnhancement({
      image: 'c291cmNl',
      width: 1024,
      height: 1024,
      prompt: 'solo',
      strength: 0.202,
      seed: 9,
    }, {
      ...base,
      outputDir,
      submit: async ({ payload }) => {
        bodies.push(payload)
        return [png]
      },
    })
    expect(bodies).toHaveLength(1)
    const body = bodies[0] as { action: string; parameters: Record<string, unknown> }
    expect(body.action).toBe('img2img')
    expect(body.parameters['image']).toBe('c291cmNl')
    expect(body.parameters['strength']).toBe(0.202)
    expect(body.parameters['noise']).toBe(0)
    expect(value.width).toBe(1024)
    expect(value.height).toBe(1024)
    expect(value.seed).toBe(9)
    await expect(readFile(value.file)).resolves.toEqual(Buffer.from(png))
  })

  it('fails loud when no token is configured', async () => {
    await expect(runEnhancement({
      image: 'c291cmNl', width: 512, height: 512, prompt: 'x', strength: 0.2,
    }, { ...base, token: '', outputDir: '.' })).rejects.toThrow(/token/)
  })

  it('records the delivered pixels of an upscaled enhance at the request price', async () => {
    // A minimal valid PNG declaring 1664×2432 — what the official V5
    // upscaled enhance returns for an 832×1216 submission.
    const png = new Uint8Array(33)
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
    png.set([0, 0, 0, 13], 8)
    png.set([0x49, 0x48, 0x44, 0x52], 12)
    const view = new DataView(png.buffer)
    view.setUint32(16, 1664)
    view.setUint32(20, 2432)
    const value = await runEnhancement({
      image: 'c291cmNl',
      width: 832,
      height: 1216,
      prompt: 'solo',
      model: 'nai-diffusion-5-full',
      strength: 0.2,
      upscaledEnhance: true,
      seed: 3,
    }, {
      ...base,
      // A real directory: the settle step mkdirs the day folders and writes the PNG.
      outputDir: mkdtempSync(join(tmpdir(), 'dsh-novelai-enh-')),
      submit: async () => [png],
    })
    expect(value.width).toBe(1664)
    expect(value.height).toBe(2432)
    // Pricing stays at the submitted request size.
    expect(value.anlasEstimate).toBe(estimateAnlas(832, 1216, 28))
  })
})
