import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCoverCache } from '../src/client/cover-cache.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

/** jsdom's URL.createObjectURL is unimplemented; stub both directions. */
function installUrlStubs(): { revoke: ReturnType<typeof vi.fn> } {
  const revoke = vi.fn()
  URL.createObjectURL = vi.fn(() => `blob:mock-${Math.random()}`)
  URL.revokeObjectURL = revoke as unknown as typeof URL.revokeObjectURL
  return { revoke }
}

describe('session card cover cache', () => {
  it('loads one attachment once and serves repeat acquires the same URL', async () => {
    installUrlStubs()
    const load = vi.fn(async () => ({ mediaType: 'image/webp', bytes: new Uint8Array([1]) }))
    const cache = createCoverCache(load)
    const first = await cache.acquire('session-a', 'att-1')
    const second = await cache.acquire('session-a', 'att-1')
    expect(first).toBeDefined()
    expect(second).toBe(first)
    expect(load).toHaveBeenCalledOnce()
    cache.dispose()
  })

  it('holds a failed read for the retry window, then reloads on the next acquire', async () => {
    vi.useFakeTimers()
    try {
      installUrlStubs()
      let fails = true
      const load = vi.fn(async () => {
        if (fails) throw new Error('attachment not referenced by this session')
        return { mediaType: 'image/webp', bytes: new Uint8Array([1]) }
      })
      const cache = createCoverCache(load)
      // First read fails (the cold-boot projection race).
      await expect(cache.acquire('session-a', 'att-x')).resolves.toBeUndefined()
      // Inside the retry window the failure is served without a new load.
      await expect(cache.acquire('session-a', 'att-x')).resolves.toBeUndefined()
      expect(load).toHaveBeenCalledOnce()
      // After the window, the same attachment reloads and succeeds.
      fails = false
      await vi.advanceTimersByTimeAsync(5_001)
      await expect(cache.acquire('session-a', 'att-x')).resolves.toBeDefined()
      expect(load).toHaveBeenCalledTimes(2)
      cache.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('shares one in-flight load across concurrent acquires', async () => {
    installUrlStubs()
    let settleLoad: ((value: { mediaType: string; bytes: Uint8Array }) => void) | undefined
    const load = vi.fn(() => new Promise<{ mediaType: string; bytes: Uint8Array }>((resolve) => {
      settleLoad = resolve
    }))
    const cache = createCoverCache(load)
    const first = cache.acquire('session-a', 'att-1')
    const second = cache.acquire('session-a', 'att-1')
    settleLoad?.({ mediaType: 'image/png', bytes: new Uint8Array([2]) })
    await expect(first).resolves.toBe(await second)
    expect(load).toHaveBeenCalledOnce()
    cache.dispose()
  })

  it('revokes an unreferenced URL after the idle window and survives a release-acquire cycle', async () => {
    vi.useFakeTimers()
    try {
      const { revoke } = installUrlStubs()
      const load = async () => ({ mediaType: 'image/webp', bytes: new Uint8Array([3]) })
      const cache = createCoverCache(load, 64, 60_000)
      const url = await cache.acquire('session-a', 'att-1')
      cache.release('att-1')
      // Still alive before the idle window elapses.
      await vi.advanceTimersByTimeAsync(59_999)
      expect(revoke).not.toHaveBeenCalled()
      // The idle sweep revokes exactly once.
      await vi.advanceTimersByTimeAsync(1)
      expect(revoke).toHaveBeenCalledWith(url)
      expect(revoke).toHaveBeenCalledOnce()
      cache.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps a referenced URL alive past the idle window and evicts only unreferenced entries over capacity', async () => {
    vi.useFakeTimers()
    try {
      const { revoke } = installUrlStubs()
      const load = async () => ({ mediaType: 'image/webp', bytes: new Uint8Array([4]) })
      const cache = createCoverCache(load, 2, 1_000)
      const held = await cache.acquire('session-a', 'att-held')
      await cache.acquire('session-a', 'att-old')
      cache.release('att-old')
      await cache.acquire('session-a', 'att-new')
      cache.release('att-new')
      await vi.advanceTimersByTimeAsync(2_000)
      // att-held survived its idle window; the two released entries were evicted by capacity.
      expect(revoke).not.toHaveBeenCalledWith(held)
      cache.dispose()
      // Disposal revokes everything still live.
      expect(revoke).toHaveBeenCalledWith(held)
    } finally {
      vi.useRealTimers()
    }
  })

  it('resolves nothing after disposal', async () => {
    installUrlStubs()
    const load = vi.fn(async () => ({ mediaType: 'image/webp', bytes: new Uint8Array([5]) }))
    const cache = createCoverCache(load)
    cache.dispose()
    await expect(cache.acquire('session-a', 'att-1')).resolves.toBeUndefined()
    expect(load).not.toHaveBeenCalled()
  })
})
