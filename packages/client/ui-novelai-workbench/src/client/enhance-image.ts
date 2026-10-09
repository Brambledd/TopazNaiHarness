/**
 * Browser-only canvas pipeline of the enhance run: NovelAI's img2img expects
 * the source image to match the output width×height, so the stage image is
 * redrawn at the exact target pixels before submission (desktop reference
 * parity).
 */

/* v8 ignore start -- browser-only canvas pipeline; jsdom provides no 2d context or createImageBitmap, so this module is mocked in specs. */

/**
 * Resize one browser image URL to the exact target pixels and return its
 * base64 PNG body.
 * @param url - object URL of the source image.
 * @param width - target width in pixels.
 * @param height - target height in pixels.
 * @returns the base64 PNG (data-URL prefix stripped).
 */
export async function resizeUrlToBase64(url: string, width: number, height: number): Promise<string> {
  const bitmap = await createImageBitmap(await (await fetch(url)).blob())
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('canvas 2d context unavailable')
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) => { canvas.toBlob(resolve, 'image/png') })
  if (blob === null) throw new Error('canvas PNG encode failed')
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = () => { reject(reader.error ?? new Error('canvas PNG read failed')) }
    reader.readAsDataURL(blob)
  })
}

/* v8 ignore stop */
