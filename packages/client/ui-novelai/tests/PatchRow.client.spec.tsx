// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PatchRow } from '../src/client/PatchRow.tsx'
import type {} from '../src/client/index.ts'

type PatchRowProps = Parameters<typeof PatchRow>[0]

/** Locale seat stub mirroring the framework `t`. */
const t = ((key: string): string => key) as PatchRowProps['t']

/** Settled result node carrying one patch proposal in its call arguments. */
function settledBlock(args: object) {
  return {
    kind: 'tool-result' as const,
    seq: 9,
    time: 0,
    callId: 'call-1',
    call: { name: 'novelai_prompt_patch', argsRaw: JSON.stringify(args) },
    callTime: 0,
    content: [{ type: 'text' as const, text: 'Proposed 2 positive-slot operation(s)' }],
    isError: false,
    meta: undefined,
    subCalls: [],
  }
}

const props = (block: PatchRowProps['block'], requestPatchApply = vi.fn(() => true)) => ({
  callId: 'call-1',
  toolName: 'novelai_prompt_patch',
  block,
  openFile: vi.fn(),
  requestPatchApply,
  t,
}) as unknown as PatchRowProps

const PATCH = {
  slot: 'positive',
  operations: [
    { op: 'add', tag: 'blue hair' },
    { op: 'remove', tag: 'old dress' },
    { op: 'modify', tag: 'garden', value: 'night city' },
  ],
}

afterEach(cleanup)

describe('PatchRow', () => {
  it('renders every operation as a checkable row with the slot badge', () => {
    render(<PatchRow {...props(settledBlock(PATCH))} />)
    expect(screen.getByText('patch.slot.positive')).toBeTruthy()
    expect(screen.getByText('blue hair')).toBeTruthy()
    expect(screen.getByText('old dress')).toBeTruthy()
    expect(screen.getByText(/night city/)).toBeTruthy()
    expect(screen.getAllByRole('checkbox')).toHaveLength(3)
  })

  it('applies only the checked operations through the bridge and locks the card', () => {
    const requestPatchApply = vi.fn(() => true)
    render(<PatchRow {...props(settledBlock(PATCH), requestPatchApply)} />)
    // Drop the removal from the selection, then apply.
    fireEvent.click(screen.getAllByRole('checkbox')[1]!)
    fireEvent.click(screen.getByText('patch.apply'))
    expect(requestPatchApply).toHaveBeenCalledWith({
      slot: 'positive',
      operations: [PATCH.operations[0], PATCH.operations[2]],
    })
    expect(screen.getByText('patch.applied')).toBeTruthy()
  })

  it('stays inert while the call is running', () => {
    const block = { argsRaw: JSON.stringify(PATCH), name: 'novelai_prompt_patch' } as unknown as PatchRowProps['block']
    render(<PatchRow {...props(block)} />)
    expect(screen.getByText('patch.apply').hasAttribute('disabled')).toBe(true)
  })

  it('degrades to the unreadable note for malformed arguments', () => {
    render(<PatchRow {...props(settledBlock({ slot: 'nope' }))} />)
    expect(screen.getByText('patch.unreadable')).toBeTruthy()
  })
})
