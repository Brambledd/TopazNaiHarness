// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NovelaiRow } from '../src/client/NovelaiRow.tsx'
// Type-only: pulls the LocaleNamespaceMap declaration so the composed props
// include the framework `t` seat typed to this package's namespace.
import type {} from '../src/client/index.ts'

type NovelaiRowProps = Parameters<typeof NovelaiRow>[0]

/** Locale seat stub mirroring the framework `t`. */
const t = ((key: string): string => key) as NovelaiRowProps['t']

/** Settled result node with the text contract the generic row flattens. */
function settledBlock(text: string) {
  return {
    kind: 'tool-result' as const,
    seq: 9,
    time: 0,
    callId: 'call-1',
    call: { name: 'novelai_generate', argsRaw: JSON.stringify({ prompt: 'topaz, umbrella' }) },
    callTime: 0,
    content: [{ type: 'text' as const, text }],
    isError: false,
    meta: undefined,
    subCalls: [],
  }
}

const props = (block: NovelaiRowProps['block']) => ({
  callId: 'call-1',
  toolName: 'novelai_generate',
  block,
  openFile: vi.fn(),
  requestBackfill: vi.fn(),
  t,
}) as unknown as NovelaiRowProps

afterEach(cleanup)

describe('NovelaiRow', () => {
  it('renders the prompt summary row for a settled successful call', () => {
    render(<NovelaiRow {...props(settledBlock('Saved image to x.png'))} />)
    expect(screen.getByText('topaz, umbrella')).toBeTruthy()
  })

  it('keeps the process row image-free; the image lives in the turn tail', () => {
    render(<NovelaiRow {...props(settledBlock('Saved image to x.png'))} />)
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('expands the persisted result details on activation', () => {
    render(<NovelaiRow {...props(settledBlock('Saved 832x1216 to x.png'))} />)
    expect(screen.queryByText('row.details')).toBeNull()
    fireEvent.click(screen.getByText('topaz, umbrella'))
    expect(screen.getByText('row.details')).toBeTruthy()
    expect(screen.getByText(/Saved 832x1216/)).toBeTruthy()
  })

  it('renders a running call from the streaming args prefix', () => {
    render(<NovelaiRow {...props({
      callId: 'call-2',
      name: 'novelai_generate',
      argsRaw: JSON.stringify({ prompt: 'wip' }),
      turn: 1,
      step: 1,
      time: 0,
      subCalls: [],
    })} />)
    expect(screen.getByText('wip')).toBeTruthy()
  })

  it('offers backfill for a settled successful call and delivers the request parameters', () => {
    const block = settledBlock('Saved nai-diffusion-4-5-full image (832x1216, seed 4242, ~0 Anlas) to x.png')
    const requestBackfill = vi.fn()
    render(<NovelaiRow {...({ ...props(block), requestBackfill })} />)
    fireEvent.click(screen.getByRole('button', { name: 'row.backfill' }))
    expect(requestBackfill).toHaveBeenCalledWith({ prompt: 'topaz, umbrella', seed: 4242 })
  })

  it('offers no backfill for a failed call', () => {
    const block = { ...settledBlock('boom'), isError: true }
    render(<NovelaiRow {...props(block)} />)
    expect(screen.queryByRole('button', { name: 'row.backfill' })).toBeNull()
  })
})
