import { describe, expect, it } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { extractImages } from '../src/unzip.ts'

/** Minimal PNG-signature buffer of the requested length. */
function fakePng(length = 64): Uint8Array {
  const bytes = new Uint8Array(length)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return bytes
}

describe('extractImages', () => {
  it('accepts a bare PNG body', () => {
    const images = extractImages(fakePng())
    expect(images).toHaveLength(1)
    expect(images[0]?.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  })

  it('extracts the PNG entries from a ZIP archive', () => {
    const zip = zipSync({ 'image_0.png': fakePng(), 'image_1.png': fakePng(32) })
    const images = extractImages(zip)
    expect(images).toHaveLength(2)
    expect(images[0]?.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  })

  it('fails loud on a JSON error body', () => {
    expect(() => extractImages(strToU8('{"detail":"unauthorized"}'))).toThrow(/non-archive body/)
  })

  it('fails loud on an archive without images', () => {
    const zip = zipSync({ 'readme.txt': strToU8('nothing here') })
    expect(() => extractImages(zip)).toThrow(/contains no PNG/)
  })

  it('fails loud on an empty body', () => {
    expect(() => extractImages(new Uint8Array(0))).toThrow(/no usable image/)
  })
})
