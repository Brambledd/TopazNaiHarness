// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TurnImages } from '../src/client/TurnImages.tsx'
import type { TurnImage } from '../src/client/turn-images.ts'

type TurnImagesProps = Parameters<typeof TurnImages>[0]

/** Locale seat stub mirroring the framework `t`. */
const t = ((key: string): string => key) as TurnImagesProps['t']

const imageA = {
  seq: 11,
  attachment: {
    attachmentId: 'sha256:aaa',
    mediaType: 'image/webp',
    width: 832,
    height: 1216,
    name: 'one.png',
  },
}
const imageB = {
  seq: 15,
  attachment: {
    attachmentId: 'sha256:bbb',
    mediaType: 'image/webp',
    width: 832,
    height: 1216,
  },
}

const props = (matched: readonly TurnImage[], loadImage: TurnImagesProps['loadImage']) => ({
  matched,
  t,
  loadImage,
}) as unknown as TurnImagesProps

afterEach(cleanup)

describe('TurnImages', () => {
  it('loads and shows one thumbnail per produced image', async () => {
    const loadImage = vi.fn().mockResolvedValue('blob:url')
    render(<TurnImages {...props([imageA], loadImage)} />)
    await waitFor(() => expect(screen.getByRole('img')).toBeTruthy())
    expect(loadImage).toHaveBeenCalledWith(imageA.attachment)
    expect(screen.getByRole('img').getAttribute('src')).toBe('blob:url')
  })

  it('renders several produced images as a strip', async () => {
    const loadImage = vi.fn().mockResolvedValue('blob:url')
    render(<TurnImages {...props([imageA, imageB], loadImage)} />)
    await waitFor(() => expect(screen.getAllByRole('img').length).toBe(2))
  })

  it('opens the zoom lightbox from a thumbnail and closes on click', async () => {
    const loadImage = vi.fn().mockResolvedValue('blob:url')
    render(<TurnImages {...props([imageA], loadImage)} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'row.preview' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'row.preview' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.click(screen.getByRole('dialog'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows a retry control when the URL load fails, then recovers', async () => {
    const loadImage = vi.fn()
      .mockRejectedValueOnce(new Error('revoked'))
      .mockResolvedValue('blob:fixed')
    render(<TurnImages {...props([imageA], loadImage)} />)
    const retry = await screen.findByText('row.loadFailed')
    fireEvent.click(retry)
    await waitFor(() => expect(screen.getByRole('img').getAttribute('src')).toBe('blob:fixed'))
    expect(loadImage).toHaveBeenCalledTimes(2)
  })

  it('re-loads through the cache when a rendered URL breaks', async () => {
    const loadImage = vi.fn()
      .mockResolvedValueOnce('blob:broken')
      .mockResolvedValue('blob:fixed')
    render(<TurnImages {...props([imageA], loadImage)} />)
    await waitFor(() => expect(screen.getByRole('img').getAttribute('src')).toBe('blob:broken'))
    fireEvent.error(screen.getByRole('img'))
    await waitFor(() => expect(screen.getByRole('img').getAttribute('src')).toBe('blob:fixed'))
    expect(loadImage).toHaveBeenCalledTimes(2)
  })
})
