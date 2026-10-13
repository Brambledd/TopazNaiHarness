import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { latestNovelaiImageProjection } from '../src/projection.ts'
import type { LatestNovelaiImageState } from '../src/projection.ts'

const imageContent = (attachmentId: string, width = 832, height = 1216): unknown => [
  { type: 'text', text: 'done' },
  { type: 'image', attachment: { attachmentId, mediaType: 'image/webp', width, height } },
]

const callEvent = (callId: string, name = 'novelai_generate', seq = 1): SessionEvent => ({
  type: 'tool/call', seq, time: seq,
  data: { turn: 1, step: 1, callId, name, arguments: '{}' },
}) as SessionEvent

const resultEvent = (
  callId: string,
  content: unknown,
  seq = 2,
  surfaceOp: 'append' | 'replace' | undefined = 'append',
): SessionEvent => ({
  type: 'tool/result', seq, time: seq,
  ...(surfaceOp === undefined ? {} : { surfaceOp }),
  data: { turn: 1, step: 1, message: { source: { callId }, content } },
}) as SessionEvent

const initialState = (): LatestNovelaiImageState => latestNovelaiImageProjection.init()

const fold = (state: LatestNovelaiImageState, events: readonly SessionEvent[]): LatestNovelaiImageState =>
  events.reduce<LatestNovelaiImageState>(
    (current, event) => latestNovelaiImageProjection.apply(current, event),
    state,
  )

describe('latest NovelAI image projection', () => {
  it('starts with no image and no pending calls', () => {
    expect(initialState()).toEqual({ calls: {}, latest: null })
  })

  it('keeps the last image of the last successful generation (last-wins)', () => {
    const state = fold(initialState(), [
      callEvent('call-1', 'novelai_generate', 1),
      resultEvent('call-1', imageContent('att-1'), 2),
      callEvent('call-2', 'novelai_generate', 3),
      resultEvent('call-2', imageContent('att-2'), 4),
    ])
    expect(state.calls).toEqual({})
    expect(state.latest).toEqual({
      attachmentId: 'att-2', mediaType: 'image/webp', width: 832, height: 1216, seq: 4,
    })
  })

  it('prefers the final image block when one result carries several', () => {
    const content = [
      { type: 'image', attachment: { attachmentId: 'att-a', mediaType: 'image/png', width: 1, height: 2 } },
      { type: 'image', attachment: { attachmentId: 'att-b', mediaType: 'image/jpeg', width: 3, height: 4 } },
    ]
    const state = fold(initialState(), [
      callEvent('call-1'), resultEvent('call-1', content, 2),
    ])
    expect(state.latest?.attachmentId).toBe('att-b')
    expect(state.latest?.seq).toBe(2)
  })

  it('ignores calls and results of other tools', () => {
    const state = fold(initialState(), [
      callEvent('call-1', 'shell_run', 1),
      resultEvent('call-1', imageContent('att-1'), 2),
    ])
    expect(state.calls).toEqual({})
    expect(state.latest).toBeNull()
  })

  it('consumes the call id on a result without images and publishes nothing', () => {
    const state = fold(initialState(), [
      callEvent('call-1'),
      resultEvent('call-1', [{ type: 'text', text: 'refused' }], 2),
      resultEvent('call-1', imageContent('att-late'), 3),
    ])
    expect(state.calls).toEqual({})
    expect(state.latest).toBeNull()
  })

  it('skips malformed image references and keeps the previous latest', () => {
    const malformed = [
      { type: 'image', attachment: { attachmentId: '', mediaType: 'image/webp', width: 1, height: 1 } },
      { type: 'image', attachment: { mediaType: 'image/webp', width: 1, height: 1 } },
      { type: 'text', text: 'no image here' },
    ]
    const state = fold(initialState(), [
      callEvent('call-1'), resultEvent('call-1', imageContent('att-1'), 2),
      callEvent('call-2', 'novelai_generate', 3),
      resultEvent('call-2', malformed, 4),
    ])
    expect(state.latest?.attachmentId).toBe('att-1')
  })

  it('ignores a replacement-surface tool result (it never appended)', () => {
    const state = fold(initialState(), [
      callEvent('call-1'),
      resultEvent('call-1', imageContent('att-replacement'), 2, 'replace'),
    ])
    // The unclaimed call id stays pending for the real append result.
    expect(state.calls).toEqual({ 'call-1': true })
    expect(state.latest).toBeNull()
  })

  it('keeps the call pending when the result belongs to another call id', () => {
    const state = fold(initialState(), [
      callEvent('call-1'),
      resultEvent('call-other', imageContent('att-1'), 2),
    ])
    expect(state.calls).toEqual({ 'call-1': true })
    expect(state.latest).toBeNull()
  })
})
