import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { dayDirectory, resolveGenerationRoot } from '../src/directory.ts'

describe('resolveGenerationRoot', () => {
  it('prefers the mounted controller live directory', async () => {
    await expect(resolveGenerationRoot('/fallback', { effectiveOutputDir: async () => '/live' }))
      .resolves.toBe('/live')
  })

  it('falls back to the resolved plugin config without a controller', async () => {
    await expect(resolveGenerationRoot('/fallback', undefined)).resolves.toBe('/fallback')
  })
})

describe('dayDirectory', () => {
  it('names the zero-padded local-time year month day chain under the root', () => {
    expect(dayDirectory('/root', new Date(2026, 0, 2, 9, 30))).toBe(join('/root', '2026', '01', '02'))
    expect(dayDirectory('/root', new Date(2026, 10, 27))).toBe(join('/root', '2026', '11', '27'))
  })
})
