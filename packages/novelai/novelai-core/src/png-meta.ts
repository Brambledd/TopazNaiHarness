/**
 * Extraction of generation metadata from NovelAI PNG files (tEXt/iTXt chunks
 * and IHDR), ported from the desktop reference's priority chain: the real
 * prompt lives in the `Comment` JSON (V4 structured base caption first, then
 * the flat `prompt`), never in `Title` — NovelAI writes its
 * "NovelAI generated image" placeholder there.
 * @module @deepseek-ai/dsh-novelai-core/png-meta
 */

/** One restored per-character caption of a V4+ structured prompt. */
export interface NovelaiPngCharacter {
  /** The character's own positive caption. */
  prompt: string
  /** The character's own negative caption; empty shares nothing extra. */
  negativePrompt: string
  /** Whether the image fixed this character at `(x, y)`. */
  useCoords: boolean
  /** Horizontal placement in the 0–1 image space. */
  x: number
  /** Vertical placement in the 0–1 image space. */
  y: number
}

/** Generation metadata readable from a NovelAI PNG; every field is best-effort. */
export interface NovelaiPngMeta {
  /** Positive prompt: the V4 base caption, else the flat `Comment.prompt`, else `Description`. */
  prompt?: string
  /** Negative prompt: the V4 negative base caption, else the flat `Comment.uc`. */
  negativePrompt?: string
  /** Checkpoint id (the `Comment.model` or `Source` text, normalized when recognizable). */
  model?: string
  /** Seed (from the `Comment` JSON when present). */
  seed?: number
  /** Step count (from the `Comment` JSON when present). */
  steps?: number
  /** Sampler id (from the `Comment` JSON when present). */
  sampler?: string
  /** CFG scale, named `scale` in the `Comment` JSON. */
  cfgScale?: number
  /** Per-character captions of a V4+ structured prompt, in prompt order. */
  characters?: NovelaiPngCharacter[]
}

/** Pixel size declared by the IHDR chunk. */
export interface NovelaiPngSize {
  readonly width: number
  readonly height: number
}

/** PNG file signature. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const

/**
 * Decode Latin-1 bytes; PNG tEXt text is Latin-1 by specification, while NovelAI
 * writes UTF-8 into that container, so bytes are surfaced as-is per byte.
 * @param bytes - chunk text bytes.
 * @returns the decoded text.
 */
function decodeText(bytes: Uint8Array): string {
  return Array.from(bytes, byte => String.fromCharCode(byte)).join('')
}

/** Decode UTF-8 bytes (iTXt payload). */
function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes)
}

/**
 * Walk PNG chunks and hand each chunk's data range to the visitor.
 * @param bytes - PNG file bytes.
 * @param visit - callback receiving the chunk type and its data subarray.
 * @returns false when the bytes are not a PNG; otherwise true after the walk.
 */
function walkPngChunks(
  bytes: Uint8Array,
  visit: (type: string, data: Uint8Array) => void,
): boolean {
  if (bytes.length < 8 || !PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) return false
  let offset = 8
  while (offset + 8 <= bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 8)
    const length = view.getUint32(0)
    const type = decodeText(bytes.subarray(offset + 4, offset + 8))
    const dataStart = offset + 8
    if (dataStart + length + 4 > bytes.length) return true // truncated tail: keep what was read
    visit(type, bytes.subarray(dataStart, dataStart + length))
    offset = dataStart + length + 4
  }
  return true
}

/**
 * Read pixel dimensions from the PNG IHDR chunk.
 * @param bytes - PNG file bytes.
 * @returns the declared size, or `undefined` when the bytes are not a PNG with IHDR.
 */
export function readPngSize(bytes: Uint8Array): NovelaiPngSize | undefined {
  let size: NovelaiPngSize | undefined
  walkPngChunks(bytes, (type, data) => {
    if (type === 'IHDR' && data.length >= 8) {
      const view = new DataView(data.buffer, data.byteOffset, 8)
      size = { width: view.getUint32(0), height: view.getUint32(4) }
    }
  })
  return size
}

/** Collect the text chunks NovelAI writes: tEXt plus uncompressed iTXt. */
function readTextChunks(bytes: Uint8Array): Record<string, string> {
  const result: Record<string, string> = {}
  walkPngChunks(bytes, (type, data) => {
    if (type === 'tEXt' && data.length > 0) {
      const split = data.indexOf(0)
      if (split >= 0) result[decodeText(data.subarray(0, split))] = decodeText(data.subarray(split + 1))
      return
    }
    if (type === 'iTXt' && data.length > 0) {
      const keywordEnd = data.indexOf(0)
      if (keywordEnd < 0 || keywordEnd + 2 >= data.length) return
      const keyword = decodeText(data.subarray(0, keywordEnd))
      const compressionFlag = data[keywordEnd + 1] ?? 1
      if (compressionFlag !== 0) return // only uncompressed iTXt carries plain text
      let cursor = keywordEnd + 3
      const languageEnd = data.indexOf(0, cursor)
      if (languageEnd < 0) return
      cursor = languageEnd + 1
      const translatedEnd = data.indexOf(0, cursor)
      if (translatedEnd < 0) return
      result[keyword] = decodeUtf8(data.subarray(translatedEnd + 1))
    }
  })
  return result
}

/** Read one record field as a finite number. */
function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Read one record field as a non-empty string. */
function rawText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/** Read one record field as a plain object. */
function objectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/**
 * Normalize a model hint onto the known checkpoint family (desktop reference
 * parity: exact ids pass through; free text maps by version keywords).
 * @param value - the `Comment.model` or `Source` text.
 * @returns the recognized checkpoint id, or the verbatim text when unknown.
 */
function normalizeModel(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const known = [
    'nai-diffusion-5-full', 'nai-diffusion-5-curated',
    'nai-diffusion-4-5-full', 'nai-diffusion-4-5-curated',
    'nai-diffusion-4-full', 'nai-diffusion-4-curated-preview',
    'nai-diffusion-3', 'nai-diffusion-furry-3',
  ]
  if (known.includes(value)) return value
  const name = value.toLowerCase()
  if (name.includes('furry') && name.includes('v3')) return 'nai-diffusion-furry-3'
  if (name.includes('v5')) return name.includes('curated') ? 'nai-diffusion-5-curated' : 'nai-diffusion-5-full'
  if (name.includes('v4.5') || name.includes('v4 5')) {
    return name.includes('curated') ? 'nai-diffusion-4-5-curated' : 'nai-diffusion-4-5-full'
  }
  if (name.includes('v4')) {
    return name.includes('curated') ? 'nai-diffusion-4-curated-preview' : 'nai-diffusion-4-full'
  }
  if (name.includes('v3')) return 'nai-diffusion-3'
  return value
}

/**
 * Parse the V4 structured character captions out of the `Comment` JSON.
 * @param comment - the parsed `Comment` record.
 * @returns the character captions, in prompt order; absent when none carry text.
 */
function parseCharacters(comment: Record<string, unknown>): NovelaiPngCharacter[] | undefined {
  const caption = objectValue(objectValue(comment['v4_prompt'])?.['caption'])
  const items = Array.isArray(caption?.['char_captions']) ? caption['char_captions'] as unknown[] : []
  const useCoords = objectValue(comment['v4_prompt'])?.['use_coords'] === true
  const negativeCaption = objectValue(objectValue(comment['v4_negative_prompt'])?.['caption'])
  const negativeItems = Array.isArray(negativeCaption?.['char_captions'])
    ? negativeCaption['char_captions'] as unknown[]
    : []
  const characters: NovelaiPngCharacter[] = []
  for (const raw of items) {
    const item = objectValue(raw)
    const prompt = rawText(item?.['char_caption'])
    if (prompt === undefined) continue
    const negative = objectValue(negativeItems[characters.length])
    const center = objectValue(Array.isArray(item?.['centers']) ? (item['centers'] as unknown[])[0] : undefined)
    characters.push({
      prompt,
      negativePrompt: rawText(negative?.['char_caption']) ?? '',
      useCoords,
      x: finiteNumber(center?.['x']) ?? 0.5,
      y: finiteNumber(center?.['y']) ?? 0.5,
    })
  }
  return characters.length === 0 ? undefined : characters
}

/**
 * Parse generation metadata out of a NovelAI PNG's text chunks.
 *
 * NovelAI writes the prompt into the `Comment` JSON — the V4 structured
 * `v4_prompt.caption.base_caption` first, the flat `prompt` second — and
 * `Description` as the last fallback; `Title` carries the "NovelAI generated
 * image" placeholder and is deliberately not read. Files without those chunks
 * yield only the fields that parse; the function never throws on malformed
 * input.
 * @param bytes - PNG file bytes.
 * @returns the metadata fields found.
 */
export function parseNovelaiPngMeta(bytes: Uint8Array): NovelaiPngMeta {
  const text = readTextChunks(bytes)
  const meta: NovelaiPngMeta = {}
  let comment: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(text['Comment'] ?? '{}')
    comment = objectValue(parsed) ?? {}
  } catch {
    // A non-JSON Comment chunk carries no structured parameters; text chunks stand alone.
  }
  const v4Caption = objectValue(objectValue(comment['v4_prompt'])?.['caption'])
  const v4NegativeCaption = objectValue(objectValue(comment['v4_negative_prompt'])?.['caption'])
  const prompt = rawText(v4Caption?.['base_caption']) ?? rawText(comment['prompt']) ?? rawText(text['Description'])
  const negativePrompt = rawText(v4NegativeCaption?.['base_caption']) ?? rawText(comment['uc'])
  if (prompt !== undefined) meta.prompt = prompt
  if (negativePrompt !== undefined) meta.negativePrompt = negativePrompt
  const model = normalizeModel(rawText(comment['model']) ?? rawText(text['Source']))
  if (model !== undefined) meta.model = model
  const seed = finiteNumber(comment['seed'])
  if (seed !== undefined) meta.seed = seed
  const steps = finiteNumber(comment['steps'])
  if (steps !== undefined) meta.steps = steps
  const sampler = rawText(comment['sampler'])
  if (sampler !== undefined) meta.sampler = sampler
  const cfgScale = finiteNumber(comment['scale'])
  if (cfgScale !== undefined) meta.cfgScale = cfgScale
  const characters = parseCharacters(comment)
  if (characters !== undefined) meta.characters = characters
  return meta
}
