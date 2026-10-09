/**
 * The NovelAI token row's apply-world state: one snapshot store over the
 * `NOVELAI_TOKEN` credential reference, written through the Remote
 * credentials namespace. The row component stays presentational; every Host
 * round trip and its outcome mapping live here.
 */

import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
// Type-only: pulls the api-remotes Context merge (ctx.remote.credentials) and
// the CredentialInfo view type into this program.
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { CredentialInfo } from '@deepseek-ai/dsh-api-remotes/client'

/** The credential reference the generation tool authenticates with (`tool-novelai`'s `NOVELAI_TOKEN_REF`). */
export const TOKEN_REF = 'NOVELAI_TOKEN'

/** What one completed row action answered; an error carries the Host diagnostic verbatim. */
export type TokenFeedback =
  | { readonly kind: 'saved' }
  | { readonly kind: 'cleared' }
  | { readonly kind: 'error'; readonly message: string }

/** The row's snapshot: credential facts plus the last action's outcome. */
export interface NovelaiTokenState {
  /** `idle` until the first describe lands; `unavailable` when the deployment mounts no credential provider. */
  status: 'idle' | 'ready' | 'unavailable'
  /** Whether a generation would currently find a token. */
  configured: boolean
  /** Supplying source layer (`file`, `env`, `project-env`, `user-env`) once configured. */
  source: string | undefined
  /** Whether the row's save and clear can write. */
  writable: boolean
  /** A save or clear is in flight. */
  writing: boolean
  /** The last action's outcome, cleared by the next successful describe. */
  feedback: TokenFeedback | undefined
}

/** The Host reads and writes the row performs, bound in the plugin body. */
export interface NovelaiTokenOperations {
  /**
   * Read the reference's state.
   * @returns the state, or undefined when the read was refused (no provider mounted).
   */
  describe(): Promise<CredentialInfo | undefined>
  /**
   * Store one token literal.
   * @param value - the non-empty token.
   * @returns the refusal message, or undefined once stored.
   */
  save(value: string): Promise<string | undefined>
  /**
   * Remove the reference (idempotent).
   * @returns the refusal message, or undefined once removed.
   */
  clear(): Promise<string | undefined>
}

const INITIAL: NovelaiTokenState = {
  status: 'idle', configured: false, source: undefined, writable: true, writing: false, feedback: undefined,
}

/**
 * Snapshot-store controller for the token row: one describe on first load,
 * refreshes driven by pushed `credentials/reference-updated` events, and the
 * save/clear writes that re-describe after committing.
 */
export class NovelaiTokenStore {
  /** The observable snapshot the row subscribes to. */
  readonly store: SnapshotStore<NovelaiTokenState> = createSnapshotStore(INITIAL)

  constructor(private readonly operations: NovelaiTokenOperations) {}

  /**
   * Fetch the credential facts once; the first call moves the row out of
   * `idle`, later calls refresh the facts and keep a fresh feedback visible.
   */
  async load(): Promise<void> {
    try {
      const info = await this.operations.describe()
      if (info === undefined) {
        this.store.set({ ...INITIAL, status: 'unavailable' })
        return
      }
      this.store.set({
        status: 'ready',
        configured: info.configured,
        source: info.source,
        writable: info.writable,
        writing: false,
        feedback: undefined,
      })
    } catch (error: unknown) {
      this.store.set({
        ...INITIAL,
        status: 'unavailable',
        feedback: { kind: 'error', message: error instanceof Error ? error.message : String(error) },
      })
    }
  }

  /** Refresh only after the first load: an unopened row must not fetch on background invalidations. */
  reloadIfLoaded(): void {
    if (this.store.getSnapshot().status === 'idle') return
    void this.load()
  }

  /**
   * Store the drafted token, then re-describe so the row's facts and the
   * feedback reflect the committed write.
   * @param value - the drafted token; empty drafts are ignored.
   */
  async save(value: string): Promise<void> {
    const trimmed = value.trim()
    if (trimmed === '') return
    this.store.update((draft) => { draft.writing = true; draft.feedback = undefined })
    const refused = await this.operations.save(trimmed)
    if (refused !== undefined) {
      this.store.update((draft) => {
        draft.writing = false
        draft.feedback = { kind: 'error', message: refused }
      })
      return
    }
    await this.load()
    this.store.update((draft) => { draft.feedback = { kind: 'saved' } })
  }

  /**
   * Remove the stored token, then re-describe. An env- or file-sourced value
   * keeps the row configured — the removal only clears the writable layer.
   */
  async clear(): Promise<void> {
    this.store.update((draft) => { draft.writing = true; draft.feedback = undefined })
    const refused = await this.operations.clear()
    if (refused !== undefined) {
      this.store.update((draft) => {
        draft.writing = false
        draft.feedback = { kind: 'error', message: refused }
      })
      return
    }
    await this.load()
    this.store.update((draft) => { draft.feedback = { kind: 'cleared' } })
  }
}

/**
 * Bind the row's Host operations to the plugin's Remote credentials namespace.
 * @param ctx - the plugin context, which declares `remote.credentials` in its own `inject`.
 * @returns the callbacks the controller invokes.
 */
export function createNovelaiTokenOperations(ctx: ClientContext): NovelaiTokenOperations {
  return {
    describe: async () => {
      const response = await ctx.remote.credentials.describe([TOKEN_REF])
      return response.ok ? response.value[TOKEN_REF] : undefined
    },
    save: async (value) => {
      const response = await ctx.remote.credentials.set(TOKEN_REF, value)
      return response.ok ? undefined : response.error.message
    },
    clear: async () => {
      const response = await ctx.remote.credentials.unset(TOKEN_REF)
      return response.ok ? undefined : response.error.message
    },
  }
}
