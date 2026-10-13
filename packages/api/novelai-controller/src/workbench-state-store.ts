/**
 * Durable per-session workbench panel states: one JSON document per session
 * under the resolved states directory, written atomically (temporary file plus
 * rename). A missing or unparseable document reads as absent, mirroring the
 * image library's index tolerance. Constructed without a directory the store
 * degrades to memory-only: writes resolve without touching the filesystem and
 * reads answer undefined — the owning controller's hot map keeps serving
 * commits, but nothing survives a restart.
 * @module @deepseek-ai/dsh-api-novelai-controller/workbench-state-store
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { NovelaiWorkbenchState } from './types.ts'

/**
 * Directory name under the harness home holding the per-session workbench
 * state documents (`<sessionId>.json`). It sits beside `settings.yaml` as
 * instance-scoped data, so every panel commit survives a page reload and a
 * service restart without a deployment-configured path.
 */
export const WORKBENCH_STATES_DIRECTORY = 'novelai-workbench-states'

/**
 * Report whether a session id may name a workbench state document. The id
 * arrives off the wire and becomes a filename, so anything outside letters,
 * digits, underscore, and hyphen (1–64 chars) is refused before it touches a
 * path — a path-traversal guard, not a format validation.
 * @param sessionId - the raw session id from a Remote request.
 * @returns whether the id is safe to use as a document stem.
 */
export function isValidWorkbenchSessionId(sessionId: string): boolean {
  return /^[\w-]{1,64}$/.test(sessionId)
}

/**
 * Read and maintain the per-session durable workbench panel states over one
 * directory. Every write replaces the session's document atomically; the
 * directory is created on first use.
 */
export class WorkbenchStateStore {
  private readonly directory: string | undefined
  private ensured = false

  /**
   * @param statesDir - absolute directory holding the `<sessionId>.json`
   *   documents; `undefined` selects the memory-only degradation.
   * @param warn - warning sink receiving the degradation notice at
   *   construction time when `statesDir` is absent.
   */
  constructor(statesDir: string | undefined, warn: (message: string) => void) {
    this.directory = statesDir
    if (statesDir === undefined) {
      warn('novelai-controller: no resolvable harness home — workbench panel states degrade to host memory and stop surviving restarts')
    }
  }

  /**
   * Read one session's persisted panel state.
   * @param sessionId - the session whose state to read.
   * @returns the persisted state; `undefined` when absent, unparseable, of the
   *   wrong shape, or when the store is memory-only.
   * @throws when `sessionId` is not a safe document stem.
   */
  async read(sessionId: string): Promise<NovelaiWorkbenchState | undefined> {
    this.assertSessionId(sessionId)
    const directory = this.directory
    if (directory === undefined) return undefined
    let raw: string
    try {
      raw = await readFile(join(directory, `${sessionId}.json`), 'utf8')
    } catch (error) {
      if (isNotExist(error)) return undefined
      throw error
    }
    try {
      const parsed: unknown = JSON.parse(raw)
      return isWorkbenchState(parsed) ? parsed : undefined
    } catch {
      // An unparseable document must not break the restore: treat it as absent.
      return undefined
    }
  }

  /**
   * Atomically persist one session's panel state (temporary file, then rename).
   * @param sessionId - the session whose state to persist.
   * @param state - the committed panel state.
   * @throws when `sessionId` is not a safe document stem, or the directory or
   *   document cannot be written.
   */
  async write(sessionId: string, state: NovelaiWorkbenchState): Promise<void> {
    this.assertSessionId(sessionId)
    const directory = this.directory
    if (directory === undefined) return
    if (!this.ensured) {
      await mkdir(directory, { recursive: true })
      this.ensured = true
    }
    const target = join(directory, `${sessionId}.json`)
    const temporary = `${target}.tmp`
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    await rename(temporary, target)
  }

  /** Reject session ids that must never reach the filesystem. */
  private assertSessionId(sessionId: string): void {
    if (!isValidWorkbenchSessionId(sessionId)) {
      throw new Error(`invalid workbench session id "${sessionId}": only 1-64 letters, digits, "_" and "-" may name a state document`)
    }
  }
}

/** Report whether the thrown value is a file-not-found error. */
function isNotExist(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as NodeJS.ErrnoException).code === 'ENOENT'
}

/** Structural guard for persisted state documents. */
function isWorkbenchState(value: unknown): value is NovelaiWorkbenchState {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record['prompt'] === 'string' && typeof record['negativePrompt'] === 'string'
    && typeof record['model'] === 'string' && typeof record['width'] === 'number'
    && typeof record['height'] === 'number' && typeof record['steps'] === 'number'
    && typeof record['cfgScale'] === 'number' && typeof record['sampler'] === 'string'
    && typeof record['noiseSchedule'] === 'string'
    && (record['seed'] === undefined || typeof record['seed'] === 'number')
}
