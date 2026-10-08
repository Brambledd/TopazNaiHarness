/** One real end-to-end generation through the tool's exact payload/extraction code paths. */
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { buildNovelaiPayload, estimateAnlas } from '../packages/novelai/tool-novelai/src/payload.ts'
import { extractImages } from '../packages/novelai/tool-novelai/src/unzip.ts'

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

const response = await fetch('https://image.novelai.net/ai/generate-image', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/zip, application/octet-stream',
  },
  body: JSON.stringify(payload),
})
console.log('HTTP', response.status, response.statusText)
if (!response.ok) throw new Error(await response.text())

const images = extractImages(new Uint8Array(await response.arrayBuffer()))
const outDir = resolve('workspace/novelai')
await mkdir(outDir, { recursive: true })
const path = resolve(outDir, 'e2e-verify-seed42.png')
await writeFile(path, images[0])
console.log(`saved ${images.length} image(s): ${path} (${images[0].byteLength} bytes)`)
