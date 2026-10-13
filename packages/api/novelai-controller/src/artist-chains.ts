/**
 * Durable NovelAI artist-chains library (画师串): named chains under the
 * harness home, kept as one JSON array of `NovelaiArtistChain` and rewritten
 * atomically (temporary file plus rename) on every mutation. Each chain is
 * ONE named whole-string entry — a standard `weight:artist::` run pasted from
 * anywhere is stored verbatim as its `tags` text, never parsed into
 * per-artist rows. A missing or unreadable document reads as an empty
 * library; an unparseable or wrong-shaped one degrades to empty rather than
 * failing the panel. Constructed without a path the store degrades to
 * memory-only: mutations work against the in-memory list and nothing
 * survives a restart.
 * @module @deepseek-ai/dsh-api-novelai-controller/artist-chains
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { NovelaiArtistChain } from './types.ts'

/**
 * File name under the harness home holding the named-chains array. It sits
 * beside `settings.yaml` as instance-scoped user data, so the library
 * survives a page reload and a service restart without a deployment-configured
 * path.
 */
export const ARTIST_CHAINS_FILENAME = 'novelai-artist-chains.json'

/** Longest accepted chain name, measured after trimming. */
export const ARTIST_CHAINS_NAME_MAX = 80

/** Longest accepted tags text, measured after trimming. */
export const ARTIST_CHAINS_TAGS_MAX = 2000

/** Why the store refused a mutation: a bad name/tags value, or an unknown id. */
export type ArtistChainsRefusal = 'invalid' | 'missing'

/**
 * Refusal thrown by the store's mutations. The `kind` lets the owning
 * controller map each refusal to its own RemoteError code; the optional `id`
 * carries the unknown id of a `missing` refusal.
 */
export class ArtistChainRefusalError extends Error {
  readonly kind: ArtistChainsRefusal
  readonly id: string | undefined

  /**
   * @param kind - which refusal the store raised.
   * @param message - human-readable reason (the RemoteError message).
   * @param id - the unknown id, carried only by `missing` refusals.
   */
  constructor(kind: ArtistChainsRefusal, message: string, id?: string) {
    super(message)
    this.kind = kind
    this.id = id
  }
}

/**
 * Read and maintain the durable named-chains library over one array document.
 * The array is stored oldest-first (new saves append; updates rewrite their
 * slot in place); every read serves it newest-first. The array is cached
 * after the first read and rewritten in full on every mutation.
 */
export class ArtistChainStore {
  private readonly filePath: string | undefined
  private ensured = false
  private cache: readonly NovelaiArtistChain[] | undefined

  /**
   * @param filePath - absolute file holding the chains array; `undefined`
   *   selects the memory-only degradation.
   * @param warn - warning sink receiving the degradation notice at
   *   construction time when `filePath` is absent.
   */
  constructor(filePath: string | undefined, warn: (message: string) => void) {
    this.filePath = filePath
    if (filePath === undefined) {
      warn('novelai-controller: no resolvable harness home — the artist chains degrade to host memory and stop surviving restarts')
    }
  }

  /**
   * Read the whole library, newest chain first.
   * @returns the chains; empty when nothing was saved yet, the file is
   *   unreadable or unparseable, or the store is memory-only with no saves.
   */
  async list(): Promise<readonly NovelaiArtistChain[]> {
    return [...(this.cache ?? await this.load())].reverse()
  }

  /**
   * Save one named chain: an empty id creates (the new chain appends as the
   * newest), a stored id updates that chain's name and tags in place, keeping
   * its slot. The tags text is stored verbatim (outer trim only) — the store
   * never parses `weight:artist::` framing.
   * @param request - the chain id (empty to create), its name, and its whole
   *   tags text.
   * @returns the full library after the write, newest first.
   * @throws {@link ArtistChainRefusalError} kind `invalid` when the trimmed
   *   name is empty or over 80 characters, or the trimmed tags are empty or
   *   over 2000 characters; kind `missing` when a non-empty id matches no
   *   stored chain.
   */
  async save(request: { readonly id: string; readonly name: string; readonly tags: string }): Promise<readonly NovelaiArtistChain[]> {
    const name = assertName(request.name)
    const tags = assertTags(request.tags)
    const chains = [...(this.cache ?? await this.load())]
    if (request.id === '') {
      chains.push({ id: randomUUID(), name, tags })
    } else {
      const current = chains.find(item => item.id === request.id)
      if (current === undefined) throw new ArtistChainRefusalError('missing', `artist chain "${request.id}" does not exist`, request.id)
      chains[chains.indexOf(current)] = { id: current.id, name, tags }
    }
    await this.persist(chains)
    return [...chains].reverse()
  }

  /**
   * Remove one saved chain by id.
   * @param id - the chain to remove.
   * @returns the full library after the write, newest first.
   * @throws {@link ArtistChainRefusalError} kind `missing` when the id does
   *   not match a stored chain.
   */
  async remove(id: string): Promise<readonly NovelaiArtistChain[]> {
    const chains = [...(this.cache ?? await this.load())]
    const current = chains.find(item => item.id === id)
    if (current === undefined) throw new ArtistChainRefusalError('missing', `artist chain "${id}" does not exist`, id)
    chains.splice(chains.indexOf(current), 1)
    await this.persist(chains)
    return [...chains].reverse()
  }

  /** Read and cache the array; unreadable, unparseable, or wrong-shaped files read as empty. */
  private async load(): Promise<readonly NovelaiArtistChain[]> {
    const filePath = this.filePath
    if (filePath === undefined) return []
    let raw: string
    try {
      raw = await readFile(filePath, 'utf8')
    } catch (error) {
      if (isNotExist(error)) return []
      throw error
    }
    try {
      const parsed: unknown = JSON.parse(raw)
      return Array.isArray(parsed) && parsed.every(isArtistChain) ? parsed : []
    } catch {
      // An unparseable library must not break the panel: treat it as empty.
      return []
    }
  }

  /** Atomically rewrite the whole array (temporary file, then rename) and cache it. */
  private async persist(chains: readonly NovelaiArtistChain[]): Promise<void> {
    this.cache = chains
    const filePath = this.filePath
    if (filePath === undefined) return
    if (!this.ensured) {
      await mkdir(dirname(filePath), { recursive: true })
      this.ensured = true
    }
    const temporary = `${filePath}.tmp`
    await writeFile(temporary, `${JSON.stringify(chains, null, 2)}\n`, 'utf8')
    await rename(temporary, filePath)
  }
}

/** Reject a name the library cannot organize by. */
function assertName(name: string): string {
  const trimmed = name.trim()
  if (trimmed === '') throw new ArtistChainRefusalError('invalid', 'artist chain name must not be empty')
  if (trimmed.length > ARTIST_CHAINS_NAME_MAX) throw new ArtistChainRefusalError('invalid', `artist chain name exceeds ${ARTIST_CHAINS_NAME_MAX} characters`)
  return trimmed
}

/** Reject tags text that cannot be a stored chain; the accepted text is kept verbatim. */
function assertTags(tags: string): string {
  const trimmed = tags.trim()
  if (trimmed === '') throw new ArtistChainRefusalError('invalid', 'artist chain tags must not be empty')
  if (trimmed.length > ARTIST_CHAINS_TAGS_MAX) throw new ArtistChainRefusalError('invalid', `artist chain tags exceed ${ARTIST_CHAINS_TAGS_MAX} characters`)
  return trimmed
}

/** Report whether the thrown value is a file-not-found error. */
function isNotExist(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as NodeJS.ErrnoException).code === 'ENOENT'
}

/** Structural guard for persisted chains. */
function isArtistChain(value: unknown): value is NovelaiArtistChain {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record['id'] === 'string' && typeof record['name'] === 'string' && typeof record['tags'] === 'string'
}
