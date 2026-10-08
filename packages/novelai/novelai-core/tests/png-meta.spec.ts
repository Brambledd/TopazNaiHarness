import { describe, expect, it } from 'vitest'
import { parseNovelaiPngMeta, readPngSize } from '../src/png-meta.ts'

/** PNG chunk layout: length + type + data + CRC (CRC bytes are zero here; the parser skips them). */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  for (const [index, char] of [...type].entries()) out[4 + index] = char.charCodeAt(0)
  out.set(data, 8)
  return out
}

/** Build a minimal PNG with the given tEXt records and IHDR size. */
function pngWithText(records: Array<[string, string]>, width = 832, height = 1216): Uint8Array {
  const ihdr = new Uint8Array(13)
  new DataView(ihdr.buffer).setUint32(0, width)
  new DataView(ihdr.buffer).setUint32(4, height)
  const parts: Uint8Array[] = [
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    ...records.map(([keyword, value]) => {
      const text = new Uint8Array(keyword.length + 1 + value.length)
      for (const [index, char] of [...keyword].entries()) text[index] = char.charCodeAt(0)
      for (const [index, char] of [...value].entries()) text[keyword.length + 1 + index] = char.charCodeAt(0)
      return chunk('tEXt', text)
    }),
    chunk('IEND', new Uint8Array(0)),
  ]
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

describe('readPngSize', () => {
  it('reads the IHDR dimensions', () => {
    expect(readPngSize(pngWithText([]))).toEqual({ width: 832, height: 1216 })
  })

  it('returns undefined for non-PNG bytes', () => {
    expect(readPngSize(new Uint8Array([1, 2, 3]))).toBeUndefined()
  })
})

describe('parseNovelaiPngMeta', () => {
  it('reads prompt, negative prompt, and Comment parameters', () => {
    const comment = JSON.stringify({ seed: 42, steps: 28, sampler: 'k_euler', scale: 5 })
    const meta = parseNovelaiPngMeta(pngWithText([
      ['Title', '1girl, solo'],
      ['Description', 'lowres'],
      ['Software', 'NovelAI'],
      ['Comment', comment],
    ]))
    expect(meta).toMatchObject({
      prompt: '1girl, solo',
      negativePrompt: 'lowres',
      seed: 42,
      steps: 28,
      sampler: 'k_euler',
      cfgScale: 5,
    })
  })

  it('survives a non-JSON Comment chunk', () => {
    const meta = parseNovelaiPngMeta(pngWithText([['Comment', 'not json']]))
    expect(meta).toEqual({})
  })

  it('survives malformed chunks and non-PNG bytes', () => {
    expect(parseNovelaiPngMeta(new Uint8Array([9, 9, 9]))).toEqual({})
    // sig(8) + IHDR(25) + Title tEXt(19) = 52: the complete chunk was already visited.
    const truncated = pngWithText([['Title', 'x']]).subarray(0, 52)
    expect(parseNovelaiPngMeta(truncated)).toEqual({ prompt: 'x' })
  })
})
