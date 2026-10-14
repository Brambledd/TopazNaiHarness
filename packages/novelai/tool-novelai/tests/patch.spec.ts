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

  it('normalizes characters operations and keeps the 1-based character number', () => {
    expect(normalizePatch({
      slot: 'characters',
      operations: [
        { op: 'add', character: 1, tag: ' silver hair ' },
        { op: 'add', character: 2, tag: 'cat ears' },
        { op: 'modify', character: 2, tag: 'cat ears', value: 'wolf ears' },
        { op: 'remove', character: 1, tag: 'silver hair' },
      ],
    })).toEqual({
      slot: 'characters',
      operations: [
        { op: 'add', character: '1', tag: 'silver hair' },
        { op: 'add', character: '2', tag: 'cat ears' },
        { op: 'modify', character: '2', tag: 'cat ears', value: 'wolf ears' },
        { op: 'remove', character: '1', tag: 'silver hair' },
      ],
    })
  })

  const rejectCases: Array<[string, PatchArgs]> = [
    ['empty operations', { slot: 'positive', operations: [] }],
    ['tag op without a tag', { slot: 'negative', operations: [{ op: 'add' }] }],
    ['modify without a replacement', { slot: 'positive', operations: [{ op: 'modify', tag: 'garden' }] }],
    ['settings op with an unknown field', { slot: 'settings', operations: [{ op: 'modify', field: 'anlas', value: '5' }] }],
    ['settings op without a value', { slot: 'settings', operations: [{ op: 'modify', field: 'steps' }] }],
    ['characters op without a number', { slot: 'characters', operations: [{ op: 'add', tag: 'silver hair' }] }],
    ['characters op with a zero number', { slot: 'characters', operations: [{ op: 'add', character: 0, tag: 'silver hair' }] }],
    ['characters op with a fractional number', { slot: 'characters', operations: [{ op: 'add', character: 1.5, tag: 'silver hair' }] }],
    ['characters op without a tag', { slot: 'characters', operations: [{ op: 'add', character: 1 }] }],
  ]
  it.each(rejectCases)('rejects %s', (_name, args) => {
    expect(() => normalizePatch(args)).toThrow(/operations\[0\]|empty operations/)
  })
})
