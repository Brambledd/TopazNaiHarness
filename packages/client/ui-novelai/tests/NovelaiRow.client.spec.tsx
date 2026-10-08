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
})
