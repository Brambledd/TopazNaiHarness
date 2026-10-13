import { describe, expect, it } from 'vitest'
import { normalizePatch } from '../src/patch.ts'
import type { PatchArgs } from '../src/patch.ts'

describe('normalizePatch', () => {
  it('normalizes tag operations and keeps the modify replacement', () => {
    expect(normalizePatch({
      slot: 'positive',
      operations: [
        { op: 'add', tag: ' blue hair ' },
        { op: 'remove', tag: 'old dress' },
        { op: 'modify', tag: 'garden', value: ' night city ' },
      ],
    })).toEqual({
      slot: 'positive',
      operations: [
        { op: 'add', tag: 'blue hair' },
        { op: 'remove', tag: 'old dress' },
        { op: 'modify', tag: 'garden', value: 'night city' },
      ],
    })
  })

  it('normalizes settings operations to field/value records', () => {
    expect(normalizePatch({
      slot: 'settings',
      operations: [{ op: 'modify', field: 'steps', value: '30' }],
    })).toEqual({ slot: 'settings', operations: [{ op: 'modify', field: 'steps', value: '30' }] })
  })

  const rejectCases: Array<[string, PatchArgs]> = [
    ['empty operations', { slot: 'positive', operations: [] }],
    ['tag op without a tag', { slot: 'negative', operations: [{ op: 'add' }] }],
    ['modify without a replacement', { slot: 'positive', operations: [{ op: 'modify', tag: 'garden' }] }],
    ['settings op with an unknown field', { slot: 'settings', operations: [{ op: 'modify', field: 'anlas', value: '5' }] }],
    ['settings op without a value', { slot: 'settings', operations: [{ op: 'modify', field: 'steps' }] }],
  ]
  it.each(rejectCases)('rejects %s', (_name, args) => {
    expect(() => normalizePatch(args)).toThrow(/operations\[0\]|empty operations/)
  })
})
