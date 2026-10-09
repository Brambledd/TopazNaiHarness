// @vitest-environment jsdom
/** The Settings → General NovelAI token row: describe-driven state and the save/clear writes. */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { NovelaiTokenStore } from '../src/client/token-settings.ts'
import type { NovelaiTokenOperations } from '../src/client/token-settings.ts'
import { TokenRow } from '../src/client/TokenRow.tsx'
import type { CredentialInfo } from '@deepseek-ai/dsh-api-remotes/client'

/** Credential operations over a scripted fixture. */
function baseOperations(): NovelaiTokenOperations {
  return {
    describe: async (): Promise<CredentialInfo | undefined> => ({ configured: false, writable: true }),
    save: async () => undefined,
    clear: async () => undefined,
  }
}

/** Credential operations with scripted overrides. */
function operations(over: Partial<NovelaiTokenOperations> = {}): NovelaiTokenOperations {
  return { ...baseOperations(), ...over }
}

/** Mount the row on a fresh controller; the hook is the store's bound selector. */
function mount(operationsFixture: NovelaiTokenOperations = operations()) {
  const controller = new NovelaiTokenStore(operationsFixture)
  const view = render(<TokenRow {...({
    controller,
    useToken: bindSnapshotSelector(controller.store),
    t: (key: string) => key,
  } as unknown as Parameters<typeof TokenRow>[0])} />)
  return { controller, view }
}

afterEach(cleanup)

describe('TokenRow', () => {
  it('describes on mount and shows the missing state while no token is stored', async () => {
    const describe = vi.fn(async () => ({ configured: false, writable: true }))
    mount(operations({ describe }))
    await waitFor(() => { expect(screen.getByText('token.state.missing')).toBeTruthy() })
    expect(describe).toHaveBeenCalledOnce()
  })

  it('shows the configured state with its source layer once a token resolves', async () => {
    mount(operations({ describe: async () => ({ configured: true, source: 'file', writable: true }) }))
    await waitFor(() => { expect(screen.getByText(/token\.state\.configured/)).toBeTruthy() })
    expect(screen.getByText(/file/)).toBeTruthy()
  })

  it('reports an unavailable deployment without rendering the write row', async () => {
    mount(operations({ describe: async () => undefined }))
    await waitFor(() => { expect(screen.getByText('token.state.unavailable')).toBeTruthy() })
    expect(screen.queryByPlaceholderText('token.placeholder')).toBeNull()
  })

  it('saves the drafted token and lands on the saved feedback over a fresh describe', async () => {
    const save = vi.fn(async () => undefined)
    let stored = false
    mount(operations({
      save,
      describe: async () => ({ configured: stored, writable: true }),
    }))
    await waitFor(() => { expect(screen.getByRole('button', { name: 'token.save' })).toBeTruthy() })
    fireEvent.change(screen.getByPlaceholderText('token.placeholder'), { target: { value: '  nai-token  ' } })
    stored = true
    fireEvent.click(screen.getByRole('button', { name: 'token.save' }))
    await waitFor(() => { expect(screen.getByText('token.saved')).toBeTruthy() })
    expect(save).toHaveBeenCalledWith('nai-token')
    expect(screen.getByPlaceholderText('token.placeholder')).toHaveProperty('value', '')
  })

  it('renders a refused write with the Host diagnostic verbatim', async () => {
    mount(operations({
      save: async () => 'a read-only source shadows NOVELAI_TOKEN',
      describe: async () => ({ configured: true, source: 'env', writable: false }),
    }))
    await waitFor(() => { expect(screen.getByText('token.readonly')).toBeTruthy() })
  })

  it('clears the stored token and reports the cleared feedback', async () => {
    const clear = vi.fn(async () => undefined)
    mount(operations({
      clear,
      describe: async () => ({ configured: true, source: 'file', writable: true }),
    }))
    const button = await waitFor(() => screen.getByRole('button', { name: 'token.clear' }))
    fireEvent.click(button)
    await waitFor(() => { expect(screen.getByText('token.cleared')).toBeTruthy() })
    expect(clear).toHaveBeenCalledOnce()
  })
})

describe('NovelaiTokenStore', () => {
  it('skips background fetches while the row has never loaded', () => {
    const describe = vi.fn(async () => ({ configured: false, writable: true }))
    const controller = new NovelaiTokenStore(operations({ describe }))
    controller.reloadIfLoaded()
    expect(describe).not.toHaveBeenCalled()
  })

  it('refreshes an opened row on pushed invalidations', async () => {
    const describe = vi.fn(async () => ({ configured: false, writable: true }))
    const controller = new NovelaiTokenStore(operations({ describe }))
    await controller.load()
    expect(describe).toHaveBeenCalledOnce()
    controller.reloadIfLoaded()
    await vi.waitFor(() => { expect(describe).toHaveBeenCalledTimes(2) })
  })

  it('ignores an empty draft without calling the Host', async () => {
    const save = vi.fn(async () => undefined)
    const controller = new NovelaiTokenStore(operations({ save }))
    await controller.save('   ')
    expect(save).not.toHaveBeenCalled()
  })
})
