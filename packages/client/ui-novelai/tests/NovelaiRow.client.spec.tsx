// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NovelaiRow } from '../src/client/NovelaiRow.tsx'
// Type-only: pulls the LocaleNamespaceMap declaration so the composed props
// include the framework `t` seat typed to this package's namespace.
import type {} from '../src/client/index.ts'

type NovelaiRowProps = Parameters<typeof NovelaiRow>[0]

/** Locale seat stub mirroring the framework `t`. */
const t = ((key: string): string => key) as NovelaiRowProps['t']

/** Settled result node carrying the persisted image metadata. */
function settledBlock(meta: unknown) {
  return {
    kind: 'tool-result' as const,
    seq: 9,
    time: 0,
    callId: 'call-1',
    call: { name: 'novelai_generate', argsRaw: JSON.stringify({ prompt: 'topaz, umbrella' }) },
    callTime: 0,
    content: [{ type: 'text' as const, text: 'Saved image to x.png' }],
    isError: false,
    meta,
    subCalls: [],
  }
}

const imageMeta = {
  image: {
    attachmentId: 'sha256:abc',
    mediaType: 'image/webp',
    bytes: 1,
    width: 832,
    height: 1216,
    name: 'topaz.png',
  },
}

const props = (meta: unknown) => ({
  callId: 'call-1',
  toolName: 'novelai_generate',
  block: settledBlock(meta),
  openFile: vi.fn(),
  t,
  loadImage: vi.fn().mockResolvedValue('blob:image-url'),
}) as unknown as NovelaiRowProps

afterEach(cleanup)

describe('NovelaiRow', () => {
  it('renders the prompt summary row for a settled successful call', () => {
    render(<NovelaiRow {...props(undefined)} />)
    expect(screen.getByText('topaz, umbrella')).toBeTruthy()
  })

  it('loads and shows the persisted image thumbnail', async () => {
    const p = props(imageMeta)
    render(<NovelaiRow {...p} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'row.preview' })).toBeTruthy())
    expect(p.loadImage).toHaveBeenCalledWith({
      attachmentId: 'sha256:abc',
      mediaType: 'image/webp',
      width: 832,
      height: 1216,
      name: 'topaz.png',
    })
    expect(screen.getByRole('img').getAttribute('src')).toBe('blob:image-url')
  })

  it('opens the zoom lightbox on thumbnail click and closes on click', async () => {
    render(<NovelaiRow {...props(imageMeta)} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'row.preview' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'row.preview' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeTruthy()
    fireEvent.click(dialog)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows the load-failed note when the image URL cannot resolve', async () => {
    const p = props(imageMeta)
    p.loadImage = vi.fn().mockRejectedValue(new Error('gone'))
    render(<NovelaiRow {...p} />)
    await waitFor(() => expect(screen.getByText('row.loadFailed')).toBeTruthy())
  })

  it('re-loads through the cache when the rendered URL breaks', async () => {
    const p = props(imageMeta)
    p.loadImage = vi.fn()
      .mockResolvedValueOnce('blob:broken')
      .mockResolvedValue('blob:fixed')
    render(<NovelaiRow {...p} />)
    await waitFor(() => expect(screen.getByRole('img').getAttribute('src')).toBe('blob:broken'))
    fireEvent.error(screen.getByRole('img'))
    await waitFor(() => expect(screen.getByRole('img').getAttribute('src')).toBe('blob:fixed'))
    expect(p.loadImage).toHaveBeenCalledTimes(2)
  })

  it('renders a running call without an image', () => {
    render(<NovelaiRow {...props(undefined)} block={{
      callId: 'call-2',
      name: 'novelai_generate',
      argsRaw: JSON.stringify({ prompt: 'wip' }),
      turn: 1,
      step: 1,
      time: 0,
      subCalls: [],
    }} />)
    expect(screen.getByText('wip')).toBeTruthy()
    expect(screen.queryByRole('img')).toBeNull()
  })
})
