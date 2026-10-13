/**
 * The NovelAI generation-directory row's apply-world state: one snapshot store
 * over the Remote novelai namespace's directory verbs. The row component stays
 * presentational; every Host round trip and its outcome mapping live here.
 */

import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
// Type-only: pulls the api-remotes Context merge (ctx.remote.novelai) and the
// generation-directory value type into this program.
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { NovelaiGenerationDirValue } from '@deepseek-ai/dsh-api-remotes/client'

/** What one completed row action answered; an error carries the Host diagnostic verbatim. */
export type GenerationDirFeedback =
  | { readonly kind: 'saved' }
  | { readonly kind: 'cleared' }
  | { readonly kind: 'error'; readonly message: string }

/** The row's snapshot: the effective directory facts plus the last action's outcome. */
export interface NovelaiGenerationDirState {
  /** `idle` until the first read lands. */
  status: 'idle' | 'ready'
  /** Current effective absolute output directory. */
  dir: string
  /** Whether the saved settings override (not the deployment config) supplies the directory. */
  configured: boolean
  /** A save or clear is in flight. */
  writing: boolean
  /** The last action's outcome, cleared by the next successful read. */
  feedback: GenerationDirFeedback | undefined
}

/** One read outcome: the effective directory facts, or the Host's refusal message. */
export type GenerationDirRead =
  | { readonly value: NovelaiGenerationDirValue }
  | { readonly refused: string }

/** The Host reads and writes the row performs, bound in the plugin body. */
export interface NovelaiGenerationDirOperations {
  /**
   * Read the effective directory facts.
   * @returns the value, or the refusal message when the read failed.
   */
  read(): Promise<GenerationDirRead>
  /**
   * Save one directory override.
   * @param value - the non-empty directory.
   * @returns the refusal message, or undefined once stored.
   */
  save(value: string): Promise<string | undefined>
  /**
   * Clear the override (idempotent).
   * @returns the refusal message, or undefined once cleared.
   */
  clear(): Promise<string | undefined>
}

const INITIAL: NovelaiGenerationDirState = {
  status: 'idle', dir: '', configured: false, writing: false, feedback: undefined,
}

/**
 * Snapshot-store controller for the generation-directory row: one read on
 * first load and the save/clear writes that re-read after committing.
 */
export class NovelaiGenerationDirStore {
  /** The observable snapshot the row subscribes to. */
  readonly store: SnapshotStore<NovelaiGenerationDirState> = createSnapshotStore(INITIAL)

  constructor(private readonly operations: NovelaiGenerationDirOperations) {}

  /**
   * Fetch the effective directory facts once; the first call moves the row out
   * of `idle`, later calls refresh the facts and keep a fresh feedback visible.
   */
  async load(): Promise<void> {
    try {
      const answered = await this.operations.read()
      if ('refused' in answered) {
        this.store.update((draft) => {
          draft.feedback = { kind: 'error', message: answered.refused }
        })
        return
      }
      this.store.set({
        status: 'ready',
        dir: answered.value.dir,
        configured: answered.value.configured,
        writing: false,
        feedback: undefined,
      })
    } catch (error: unknown) {
      this.store.update((draft) => {
        draft.feedback = { kind: 'error', message: error instanceof Error ? error.message : String(error) }
      })
    }
  }

  /**
   * Store the drafted directory, then re-read so the row's facts and the
   * feedback reflect the committed write.
   * @param value - the drafted directory; empty drafts are ignored.
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
   * Clear the stored override, then re-read; the row falls back to reporting
   * the deployment-configured directory.
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
 * Bind the row's Host operations to the plugin's Remote novelai namespace.
 * @param ctx - the plugin context, which declares `remote` in its own `inject`.
 * @returns the callbacks the controller invokes.
 */
export function createNovelaiGenerationDirOperations(ctx: ClientContext): NovelaiGenerationDirOperations {
  return {
    read: async () => {
      const response = await ctx.remote.novelai.generationDir()
      return response.ok ? { value: response.value } : { refused: response.error.message }
    },    save: async (value) => {
      const response = await ctx.remote.novelai.setGenerationDir({ dir: value })
      return response.ok ? undefined : response.error.message
    },
    clear: async () => {
      const response = await ctx.remote.novelai.setGenerationDir({ dir: '' })
      return response.ok ? undefined : response.error.message
    },
  }
}
