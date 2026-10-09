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

/** Build an uncompressed iTXt chunk payload: keyword, flags, language, translated, text. */
function itextData(keyword: string, value: string): Uint8Array {
  const encoder = new TextEncoder()
  const key = encoder.encode(keyword)
  const text = encoder.encode(value)
  const out = new Uint8Array(key.length + 5 + text.length)
  out.set(key, 0)
  out[key.length] = 0 // compression flag: uncompressed
  out[key.length + 1] = 0 // compression method
  out[key.length + 2] = 0 // language tag terminator
  out[key.length + 3] = 0 // translated keyword terminator
  out.set(text, key.length + 5)
  return out
}

/** Build a minimal PNG whose metadata rides uncompressed iTXt chunks. */
function pngWithIText(records: Array<[string, string]>): Uint8Array {
  const sig = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const parts: Uint8Array[] = [sig, ...records.map(([keyword, value]) => chunk('iTXt', itextData(keyword, value)))]
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
  it('reads the flat Comment prompt and parameters, ignoring the Title placeholder', () => {
    const comment = JSON.stringify({
      prompt: '1girl, solo',
      uc: 'lowres',
      seed: 42,
      steps: 28,
      sampler: 'k_euler',
      scale: 5,
    })
    const meta = parseNovelaiPngMeta(pngWithText([
      ['Title', 'NovelAI generated image'],
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

  it('prefers the V4 structured base caption and restores character captions', () => {
    const comment = JSON.stringify({
      prompt: 'flat fallback',
      uc: 'flat negative',
      v4_prompt: {
        caption: {
          base_caption: 'park, masterpiece',
          char_captions: [
            { char_caption: '1girl, blue hair', centers: [{ x: 0.25, y: 0.5 }] },
            { char_caption: '1girl, red hair', centers: [{ x: 0.75, y: 0.5 }] },
          ],
        },
        use_coords: true,
      },
      v4_negative_prompt: {
        caption: {
          base_caption: 'structured negative',
          char_captions: [{ char_caption: 'extra ears' }, {}],
        },
      },
    })
    const meta = parseNovelaiPngMeta(pngWithText([
      ['Title', 'NovelAI generated image'],
      ['Comment', comment],
    ]))
    expect(meta.prompt).toBe('park, masterpiece')
    expect(meta.negativePrompt).toBe('structured negative')
    expect(meta.characters).toEqual([
      { prompt: '1girl, blue hair', negativePrompt: 'extra ears', useCoords: true, x: 0.25, y: 0.5 },
      { prompt: '1girl, red hair', negativePrompt: '', useCoords: true, x: 0.75, y: 0.5 },
    ])
  })

  it('reads uncompressed iTXt chunks the current NovelAI app writes', () => {
    const comment = JSON.stringify({ prompt: 'itx t prompt', seed: 7 })
    const meta = parseNovelaiPngMeta(pngWithIText([
      ['Title', 'NovelAI generated image'],
      ['Comment', comment],
    ]))
    expect(meta.prompt).toBe('itx t prompt')
    expect(meta.seed).toBe(7)
  })

  it('normalizes free-text model hints onto the checkpoint family', () => {
    const comment = JSON.stringify({ prompt: 'x', model: 'NovelAI Diffusion V4.5 Curated' })
    expect(parseNovelaiPngMeta(pngWithText([['Comment', comment]])).model).toBe('nai-diffusion-4-5-curated')
    const exact = JSON.stringify({ prompt: 'x', model: 'nai-diffusion-5-full' })
    expect(parseNovelaiPngMeta(pngWithText([['Comment', exact]])).model).toBe('nai-diffusion-5-full')
  })

  it('survives a non-JSON Comment chunk', () => {
    const meta = parseNovelaiPngMeta(pngWithText([['Comment', 'not json']]))
    expect(meta).toEqual({})
  })

  it('survives malformed chunks and non-PNG bytes', () => {
    expect(parseNovelaiPngMeta(new Uint8Array([9, 9, 9]))).toEqual({})
    // A truncated tail after complete chunks keeps what was read; Title is not
    // a prompt source, so nothing parses from a Title-only file.
    const truncated = pngWithText([['Title', 'x']]).subarray(0, 52)
    expect(parseNovelaiPngMeta(truncated)).toEqual({})
  })
})
