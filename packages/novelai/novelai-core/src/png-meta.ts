/**
 * Extraction of generation metadata from NovelAI PNG files (tEXt chunks and IHDR).
 * @module @deepseek-ai/dsh-novelai-core/png-meta
 */

/** Generation metadata readable from a NovelAI PNG; every field is best-effort. */
export interface NovelaiPngMeta {
  /** Positive prompt text (tEXt `Title`). */
  prompt?: string
  /** Negative prompt text (tEXt `Description`). */
  negativePrompt?: string
  /** Checkpoint id (from the `Comment` JSON when present). */
  model?: string
  /** Seed (from the `Comment` JSON when present). */
  seed?: number
  /** Step count (from the `Comment` JSON when present). */
  steps?: number
  /** Sampler id (from the `Comment` JSON when present). */
  sampler?: string
  /** CFG scale, named `scale` in the `Comment` JSON. */
  cfgScale?: number
}

/** Pixel size declared by the IHDR chunk. */
export interface NovelaiPngSize {
  readonly width: number
  readonly height: number
}

/** PNG file signature. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const

/** Map from the tEXt keywords NovelAI writes to this library's metadata fields. */
const TEXT_FIELDS: Readonly<Record<string, 'prompt' | 'negativePrompt'>> = {
  Title: 'prompt',
  Description: 'negativePrompt',
}

/**
 * Decode Latin-1 bytes; PNG tEXt text is Latin-1 by specification, while NovelAI
 * writes UTF-8 into that container, so bytes are surfaced as-is per byte.
 * @param bytes - chunk text bytes.
 * @returns the decoded text.
 */
function decodeText(bytes: Uint8Array): string {
  return Array.from(bytes, byte => String.fromCharCode(byte)).join('')
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

/**
 * Parse generation metadata from a NovelAI PNG's tEXt chunks.
 *
 * NovelAI embeds the prompt in `Title`, the negative prompt in `Description`, and a JSON
 * parameters object in `Comment`. Files without those chunks (or a non-JSON `Comment`)
 * yield only the fields that parse; the function never throws on malformed input.
 * @param bytes - PNG file bytes.
 * @returns the metadata fields found.
 */
export function parseNovelaiPngMeta(bytes: Uint8Array): NovelaiPngMeta {
  const meta: NovelaiPngMeta = {}
  walkPngChunks(bytes, (type, data) => {
    if (type !== 'tEXt') return
    const split = data.indexOf(0)
    if (split < 0) return
    const keyword = decodeText(data.subarray(0, split))
    const value = decodeText(data.subarray(split + 1))
    const field = TEXT_FIELDS[keyword]
    if (field !== undefined) {
      meta[field] = value
      return
    }
    if (keyword !== 'Comment') return
    try {
      const comment: unknown = JSON.parse(value)
      if (typeof comment !== 'object' || comment === null) return
      const record = comment as Record<string, unknown>
      if (typeof record['seed'] === 'number') meta.seed = record['seed']
      if (typeof record['steps'] === 'number') meta.steps = record['steps']
      if (typeof record['sampler'] === 'string') meta.sampler = record['sampler']
      if (typeof record['scale'] === 'number') meta.cfgScale = record['scale']
      if (typeof record['prompt'] === 'string') meta.prompt ??= record['prompt']
      if (typeof record['uc'] === 'string') meta.negativePrompt ??= record['uc']
      if (typeof record['soft'] === 'string' && record['soft'].startsWith('NovelAI')) {
        // Model ids ride `soft`-adjacent keys in some releases; keep the parsed JSON value only.
        if (typeof record['model'] === 'string') meta.model = record['model']
      }
    } catch {
      // A non-JSON Comment chunk carries no structured parameters; other chunks already parsed.
    }
  })
  return meta
}
