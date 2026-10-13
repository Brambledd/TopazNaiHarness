/**
 * Session-card cover cache: bounded, reference-counted object URLs over the
 * list-level attachment read. Owned by the plugin apply closure (created in
 * apply, disposed with the plugin fiber) — no module-level state.
 * @module @deepseek-ai/dsh-client-ui-workspace/cover-cache
 */

/** One cache load callback: the injected Host-backed attachment read. */
export type CoverLoader = (
  sessionId: string,
  attachmentId: string,
) => Promise<{ mediaType: string; bytes: Uint8Array }>

interface CoverEntry {
  url?: string
  /** In-flight shared load; settles with the URL or undefined (failure). */
  promise?: Promise<string | undefined>
  /** Last failure time; an acquire after COVER_RETRY_MS starts a fresh load
   *  (a cold-boot read race must not pin the card to the default art). */
  failedAt?: number
  refs: number
}

/** Minimum spacing before a failed read may be retried. */
const COVER_RETRY_MS = 5_000

/** Bounded cover cache over one injected attachment read. */
export interface CoverCache {
  /**
   * Resolve the object URL for one attachment, loading it at most once.
   * @param sessionId - session whose log references the attachment.
   * @param attachmentId - durable attachment identity.
   * @returns the URL, or undefined when the read failed (callers render the default cover).
   */
  acquire(sessionId: string, attachmentId: string): Promise<string | undefined>
  /** Drop one card's reference; the URL revokes after the idle window unless re-acquired. */
  release(attachmentId: string): void
  /** Revoke every live URL (plugin disposal). */
  dispose(): void
}

/**
 * Create the cover cache.
 * @param load - the injected attachment read.
 * @param capacity - maximum cached entries; the least-recently-used unreferenced entry evicts first.
 * @param idleMs - how long an unreferenced URL survives before revocation.
 * @returns the cache handle.
 */
export function createCoverCache(
  load: CoverLoader,
  capacity = 64,
  idleMs = 60_000,
): CoverCache {
  const entries = new Map<string, CoverEntry>()
  const revokers = new Map<string, ReturnType<typeof setTimeout>>()
  const state = { disposed: false }

  const revoke = (attachmentId: string): void => {
    const entry = entries.get(attachmentId)
    if (entry === undefined || entry.refs > 0) return
    if (entry.url !== undefined) URL.revokeObjectURL(entry.url)
    entries.delete(attachmentId)
  }

  const scheduleEviction = (attachmentId: string): void => {
    const pending = revokers.get(attachmentId)
    if (pending !== undefined) clearTimeout(pending)
    revokers.set(attachmentId, setTimeout(() => {
      revokers.delete(attachmentId)
      revoke(attachmentId)
    }, idleMs))
  }

  const enforceCapacity = (): void => {
    let excess = entries.size - capacity
    if (excess <= 0) return
    for (const [attachmentId, entry] of entries) {
      if (excess <= 0) break
      if (entry.refs > 0 || entry.promise !== undefined) continue
      entries.delete(attachmentId)
      excess--
    }
  }

  return {
    acquire(sessionId, attachmentId) {
      if (state.disposed) return Promise.resolve(undefined)
      const existing = entries.get(attachmentId)
      if (existing?.url !== undefined) {
        existing.refs++
        const pending = revokers.get(attachmentId)
        if (pending !== undefined) {
          clearTimeout(pending)
          revokers.delete(attachmentId)
        }
        return Promise.resolve(existing.url)
      }
      if (existing !== undefined) {
        const blocked = existing.promise !== undefined
          || (existing.failedAt !== undefined && Date.now() - existing.failedAt < COVER_RETRY_MS)
        if (blocked) {
          existing.refs++
          return existing.promise ?? Promise.resolve(undefined)
        }
      }
      const entry: CoverEntry = existing ?? { refs: 0 }
      entries.set(attachmentId, entry)
      entry.refs++
      delete entry.failedAt
      entry.promise = (async () => {
        try {
          const loaded = await load(sessionId, attachmentId)
          if (state.disposed) return undefined
          const blob = new Blob([loaded.bytes as BlobPart], { type: loaded.mediaType })
          entry.url = URL.createObjectURL(blob)
          enforceCapacity()
          return entry.url
        } catch {
          entry.failedAt = Date.now()
          return undefined
        } finally {
          delete entry.promise
        }
      })()
      return entry.promise
    },
    release(attachmentId) {
      const entry = entries.get(attachmentId)
      if (entry === undefined) return
      entry.refs = Math.max(0, entry.refs - 1)
      if (entry.refs === 0) scheduleEviction(attachmentId)
    },
    dispose() {
      state.disposed = true
      for (const pending of revokers.values()) clearTimeout(pending)
      revokers.clear()
      for (const [attachmentId, entry] of entries) {
        if (entry.url !== undefined) URL.revokeObjectURL(entry.url)
        entries.delete(attachmentId)
      }
    },
  }
}
