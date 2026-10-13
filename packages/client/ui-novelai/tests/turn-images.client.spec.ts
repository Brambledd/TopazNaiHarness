import { describe, expect, it } from 'vitest'
import { turnImagesDefinition } from '../src/client/turn-images.ts'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'

/** Minimal SessionEventLike stand-in with only the fields the Definition reads. */
function event(type: string, data: Record<string, unknown>, seq: number) {
  return { type, data, seq, time: seq * 1000 }
}

const ref: ImageAttachmentRef = {
  attachmentId: 'sha256:abc' as ImageAttachmentRef['attachmentId'],
  mediaType: 'image/webp',
  bytes: 1000,
  width: 832,
  height: 1216,
}

describe('turnImagesDefinition', () => {
  it('accumulates novelai result image blocks per turn', () => {
    let state = turnImagesDefinition.start(
      {} as never,
      { event: event('turn/start', { turn: 3 }, 10) } as never,
      { previous: () => undefined },
    )
    state = turnImagesDefinition.update({ state } as never, {
      event: event('tool/call', { callId: 'call-1', name: 'novelai_generate', turn: 3, step: 1 }, 11),
    } as never)
    state = turnImagesDefinition.update({ state } as never, {
      event: event('tool/result', {
        message: {
          source: { callId: 'call-1' },
          // Durable tool results wrap the rendered blocks in one nested
          // tool-result block; the scan must recurse.
          content: [{
            type: 'tool-result',
            toolCallId: 'call-1',
            content: [
              { type: 'text', text: 'Saved' },
              { type: 'image', attachment: ref },
            ],
          }],
        },
      }, 12),
    } as never)
    const location = turnImagesDefinition.buildLocationData?.(
      { state } as never, 'turn',
    )
    expect(location).not.toBeNull()
    if (location === null || location === undefined) return
    expect(location.key).toBe('novelai-images')
    const value = location.value as unknown as { images: { attachment: ImageAttachmentRef }[] }
    expect(value.images.length).toBe(1)
    expect(value.images[0]?.attachment.attachmentId).toBe(ref.attachmentId)
  })

  it('ignores other tools and failed results', () => {
    let state = turnImagesDefinition.start(
      {} as never,
      { event: event('turn/start', { turn: 1 }, 1) } as never,
      { previous: () => undefined },
    )
    state = turnImagesDefinition.update({ state } as never, {
      event: event('tool/call', { callId: 'c2', name: 'read', turn: 1, step: 1 }, 2),
    } as never)
    state = turnImagesDefinition.update({ state } as never, {
      event: event('tool/result', {
        isError: true,
        message: { source: { callId: 'c2' }, content: [{ type: 'image', attachment: ref }] },
      }, 3),
    } as never)
    const location = turnImagesDefinition.buildLocationData?.({ state } as never, 'turn')
    const value = location?.value as unknown as { images: unknown[] } | null | undefined
    expect(value?.images.length ?? 0).toBe(0)
  })
})
