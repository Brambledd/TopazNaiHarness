/** Token resolution order: plugin config, then the credential, then the bare environment. */

import { describe, expect, it } from 'vitest'
import type { CredentialProvider, CredentialRef, ResolvedCredential } from '@deepseek-ai/dsh-credentials'
import { NOVELAI_TOKEN_REF, resolveToken } from '../src/token.ts'

/** A credential provider answering from a fixed table; empty values are absent per the seam rule. */
function provider(table: Partial<Record<string, string>> = {}): CredentialProvider {
  return {
    resolve: async (ref: CredentialRef): Promise<ResolvedCredential | undefined> => {
      const value = table[ref]
      return value === undefined || value === '' ? undefined : { value, source: 'file' }
    },
  } as unknown as CredentialProvider
}

describe('resolveToken', () => {
  it('prefers the explicit plugin config over every other layer', async () => {
    const token = await resolveToken(
      { token: 'config-token' },
      provider({ [NOVELAI_TOKEN_REF]: 'stored-token' }),
    )
    expect(token).toBe('config-token')
  })

  it('falls back to the credential store, including its env layering', async () => {
    const token = await resolveToken({ token: '' }, provider({ [NOVELAI_TOKEN_REF]: 'stored-token' }))
    expect(token).toBe('stored-token')
  })

  it('reads the bare process environment when no provider is mounted', async () => {
    process.env['NOVELAI_TOKEN'] = 'env-token'
    try {
      const token = await resolveToken({ token: '' }, undefined)
      expect(token).toBe('env-token')
    } finally {
      delete process.env['NOVELAI_TOKEN']
    }
  })

  it('falls back to the environment when the credential is unconfigured', async () => {
    process.env['NOVELAI_TOKEN'] = 'env-token'
    try {
      const token = await resolveToken({ token: '' }, provider({ [NOVELAI_TOKEN_REF]: '' }))
      expect(token).toBe('env-token')
    } finally {
      delete process.env['NOVELAI_TOKEN']
    }
  })

  it('fails loud naming every configurable layer when all are empty', async () => {
    delete process.env['NOVELAI_TOKEN']
    await expect(resolveToken({ token: '' }, provider())).rejects.toThrow(
      /Settings → General[\s\S]*NOVELAI_TOKEN/,
    )
  })
})
