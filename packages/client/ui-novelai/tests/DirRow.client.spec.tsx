// @vitest-environment jsdom
/** The Settings → General generation-directory row: read-driven state and the save/clear writes. */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { NovelaiGenerationDirStore } from '../src/client/dir-settings.ts'
import type { NovelaiGenerationDirOperations } from '../src/client/dir-settings.ts'
import { DirRow } from '../src/client/DirRow.tsx'

/** Directory operations over a scripted fixture. */
function baseOperations(): NovelaiGenerationDirOperations {
  return {
    read: async () => ({ value: { dir: '/default/library', configured: false } }),
    save: async () => undefined,
    clear: async () => undefined,
  }
}

/** Directory operations with scripted overrides. */
function operations(over: Partial<NovelaiGenerationDirOperations> = {}): NovelaiGenerationDirOperations {
  return { ...baseOperations(), ...over }
}

/** Mount the row on a fresh controller; the hook is the store's bound selector. */
function mount(operationsFixture: NovelaiGenerationDirOperations = operations()) {
  const controller = new NovelaiGenerationDirStore(operationsFixture)
  const view = render(<DirRow {...({
    controller,
    useDir: bindSnapshotSelector(controller.store),
    t: (key: string) => key,
  } as unknown as Parameters<typeof DirRow>[0])} />)
  return { controller, view }
}

afterEach(cleanup)

describe('DirRow', () => {
  it('reads on mount and shows the effective deployment path', async () => {
    const read = vi.fn(async () => ({ value: { dir: '/default/library', configured: false } }))
    mount(operations({ read }))
    await waitFor(() => { expect(screen.getByText('/default/library')).toBeTruthy() })
    expect(screen.getByText('dir.state.default')).toBeTruthy()
    expect(read).toHaveBeenCalledOnce()
  })

  it('marks a saved override and pre-fills the input with the effective path', async () => {
    mount(operations({ read: async () => ({ value: { dir: '/custom/library', configured: true } }) }))
    await waitFor(() => { expect(screen.getByText('dir.state.configured')).toBeTruthy() })
    expect(screen.getByPlaceholderText('dir.placeholder')).toHaveProperty('value', '/custom/library')
  })

  it('saves the drafted directory and lands on the saved feedback over a fresh read', async () => {
    const save = vi.fn(async () => undefined)
    // Ref wrapper: the read closure must observe the post-save value, and the
    // assignment happens after mount (a bare `let` trips oxlint prefer-const).
    const overrideRef: { current: string | undefined } = { current: undefined }
    mount(operations({
      save,
      read: async () => overrideRef.current === undefined
        ? { value: { dir: '/default/library', configured: false } }
        : { value: { dir: overrideRef.current, configured: true } },
    }))
    const input = await waitFor(() => screen.getByPlaceholderText('dir.placeholder'))
    await waitFor(() => { expect(input).toHaveProperty('value', '/default/library') })
    fireEvent.change(input, { target: { value: '  /custom/library  ' } })
    overrideRef.current = '/custom/library'
    fireEvent.click(screen.getByRole('button', { name: 'dir.save' }))
    await waitFor(() => { expect(screen.getByText('dir.saved')).toBeTruthy() })
    expect(save).toHaveBeenCalledWith('/custom/library')
    // The input shows the freshly read effective path again.
    await waitFor(() => { expect(screen.getByPlaceholderText('dir.placeholder')).toHaveProperty('value', '/custom/library') })
  })

  it('clears the override and reports the cleared feedback', async () => {
    const clear = vi.fn(async () => undefined)
    let override: string | undefined = '/custom/library'
    mount(operations({
      clear,
      read: async () => override === undefined
        ? { value: { dir: '/default/library', configured: false } }
        : { value: { dir: override, configured: true } },
    }))
    const button = await waitFor(() => screen.getByRole('button', { name: 'dir.clear' }))
    override = undefined
    fireEvent.click(button)
    await waitFor(() => { expect(screen.getByText('dir.cleared')).toBeTruthy() })
    expect(clear).toHaveBeenCalledOnce()
    await waitFor(() => { expect(screen.getByText('/default/library')).toBeTruthy() })
  })

  it('renders a refused read with the Host diagnostic verbatim', async () => {
    mount(operations({ read: async () => ({ refused: 'no settings provider is mounted' }) }))
    await waitFor(() => { expect(screen.getByText('no settings provider is mounted')).toBeTruthy() })
  })

  it('renders a refused write with the Host diagnostic verbatim', async () => {
    mount(operations({
      save: async () => 'settings provider is read-only',
      read: async () => ({ value: { dir: '/custom/library', configured: true } }),
    }))
    const input = await waitFor(() => screen.getByPlaceholderText('dir.placeholder'))
    fireEvent.change(input, { target: { value: '/other/library' } })
    fireEvent.click(screen.getByRole('button', { name: 'dir.save' }))
    await waitFor(() => { expect(screen.getByText('settings provider is read-only')).toBeTruthy() })
  })
})

describe('NovelaiGenerationDirStore', () => {
  it('ignores an empty draft without calling the Host', async () => {
    const save = vi.fn(async () => undefined)
    const controller = new NovelaiGenerationDirStore(operations({ save }))
    await controller.save('   ')
    expect(save).not.toHaveBeenCalled()
  })

  it('surfaces a thrown read as error feedback while staying idle', async () => {
    const controller = new NovelaiGenerationDirStore(operations({
      read: async () => { throw new Error('connection lost') },
    }))
    await controller.load()
    expect(controller.store.getSnapshot()).toMatchObject({
      status: 'idle',
      feedback: { kind: 'error', message: 'connection lost' },
    })
  })
})
