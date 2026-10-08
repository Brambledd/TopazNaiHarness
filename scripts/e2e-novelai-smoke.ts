/** One real end-to-end generation through the tool's exact client/payload/extraction code paths. */
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { buildNovelaiPayload, estimateAnlas } from '../packages/novelai/tool-novelai/src/payload.ts'
import { requestGeneration, resolveProxyUrl } from '../packages/novelai/tool-novelai/src/client.ts'

const token = (await import('node:fs')).readFileSync(resolve('.env'), 'utf8').match(/^NOVELAI_TOKEN=(.+)$/m)?.[1]?.trim()
if (!token) throw new Error('NOVELAI_TOKEN missing in .env')

const input = {
  prompt: '1girl, solo, blue hair, blue eyes, white dress, garden, sunlight, smile',
  negativePrompt: 'lowres, bad quality, worst quality, jpeg artifacts, multiple views, logo',
  model: 'nai-diffusion-4-5-full',
  width: 832,
  height: 1216,
  steps: 28,
  cfgScale: 5,
  sampler: 'k_euler',
  noiseSchedule: 'native',
  seed: 42,
} as const

const payload = buildNovelaiPayload(input)
console.log('anlas estimate (worst case, Opus free at this size):', estimateAnlas(input.width, input.height, input.steps))

const images = await requestGeneration({
  payload,
  token,
  baseUrl: 'https://image.novelai.net',
  timeoutMs: 180_000,
  signal: AbortSignal.timeout(180_000),
  proxyUrl: resolveProxyUrl(''),
})
const outDir = resolve('workspace/novelai')
await mkdir(outDir, { recursive: true })
const path = resolve(outDir, 'e2e-verify-seed42.png')
const image = images[0]
if (image === undefined) throw new Error('no image in response')
await writeFile(path, image)
console.log(`saved ${images.length} image(s): ${path} (${image.byteLength} bytes)`)
