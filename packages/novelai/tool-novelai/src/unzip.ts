/**
 * Extraction of image buffers from a NovelAI generation response.
 * @module @deepseek-ai/dsh-tool-novelai/unzip
 */

import { unzipSync } from 'fflate'

/** Upper bound on one accepted response body (transport limit, matches the official client). */
export const MAX_RESPONSE_BYTES = 128 * 1024 * 1024

/** PNG magic number as a byte prefix test. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47] as const

/**
 * Report whether a buffer starts with the PNG signature.
 * @param bytes - candidate body.
 * @returns true when the body is a bare PNG rather than a ZIP container.
 */
function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)
}

/**
 * Extract the generated images from one response body.
 *
 * The API normally answers with a ZIP archive whose entries are the generated PNGs; a bare
 * PNG body is also accepted. Non-archive bodies (JSON/HTML error pages) fail loud so the
 * caller never mistakes an error page for a missing image and resubmits a paid request.
 * @param body - the raw response bytes.
 * @returns one buffer per generated image, in archive order.
 * @throws when the body is empty, oversized, not a ZIP/PNG, contains no PNG entry, or a non-image entry is present.
 */
export function extractImages(body: Uint8Array): Buffer[] {
  if (body.byteLength === 0 || body.byteLength > MAX_RESPONSE_BYTES) {
    throw new Error('NovelAI returned no usable image body; not retrying to avoid a duplicate charge')
  }
  if (isPng(body)) return [Buffer.from(body)]
  if (!(body[0] === 0x50 && body[1] === 0x4b && body[2] === 0x03 && body[3] === 0x04)) {
    throw new Error('NovelAI returned a non-archive body (likely an error response); not retrying to avoid a duplicate charge')
  }
  const entries = unzipSync(body)
  const names = Object.keys(entries)
  if (names.length === 0 || names.length > 64) {
    throw new Error('NovelAI returned an empty or oversized archive; not retrying to avoid a duplicate charge')
  }
  const images: Buffer[] = []
  let total = 0
  for (const name of names.sort()) {
    const data = entries[name]
    if (data === undefined || !( data instanceof Uint8Array)) {
      throw new Error(`NovelAI archive entry ${name} could not be read as file content`)
    }
    const file = data as Uint8Array
    total += file.byteLength
    if (total > MAX_RESPONSE_BYTES) {
      throw new Error('NovelAI archive exceeds the response limit; not retrying to avoid a duplicate charge')
    }
    if (isPng(file)) {
      images.push(Buffer.from(file))
    } else if (/\.(png|jpe?g|webp)$/i.test(name)) {
      throw new Error(`NovelAI archive entry ${name} is marked as an image but has no image signature`)
    }
  }
  if (images.length === 0) {
    throw new Error('NovelAI archive contains no PNG image; not retrying to avoid a duplicate charge')
  }
  return images
}
