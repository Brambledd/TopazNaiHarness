/**
 * Durable NovelAI artist-chains library (画师串): named chains under the
 * harness home, kept as a `{ chains }` JSON document and rewritten atomically
 * (temporary file plus rename) on every mutation. Each chain is ONE named
 * whole-string entry — a standard `weight:artist::` run pasted from anywhere
 * is stored verbatim, never parsed into per-artist rows. A missing or
 * unreadable document reads as an empty library; an unparseable or
 * wrong-shaped one degrades to empty rather than failing the panel.
 * Constructed without a path the store degrades to memory-only: mutations
 * work against the in-memory list and nothing survives a restart.
 * @module @deepseek-ai/dsh-api-novelai-controller/artist-chains
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { NovelaiArtistChain } from './types.ts'

/**
 * File name under the harness home holding the named-chains document. It sits
 * beside `settings.yaml` as instance-scoped user data, so the library
 * survives a page reload and a service restart without a deployment-configured
 * path.
 */
export const ARTIST_CHAINS_FILENAME = 'novelai-artist-chains.json'

/** Longest accepted chain name, measured after trimming. */
export const ARTIST_CHAINS_NAME_MAX = 60

/** Longest accepted chain text, measured after trimming. */
export const ARTIST_CHAINS_CHAIN_MAX = 4000

/** Why the store refused a mutation: a bad name/chain value, or an unknown id. */
export type ArtistChainsRefusal = 'invalid' | 'missing'

/**
 * Refusal thrown by the store's mutations. The `kind` lets the owning
 * controller map each refusal to its own RemoteError code; the optional `id`
 * carries the unknown id of a `missing` refusal.
 */
export class ArtistChainsRefusalError extends Error {
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
 * Read and maintain the durable named-chains library over one document.
 * Chains are stored in insertion order (append on save, in-place on re-save
 * of the same name); the list is cached after the first read and rewritten in
 * full on every mutation.
 */
export class ArtistChainsStore {
  private readonly filePath: string | undefined
  private ensured = false
  private cache: readonly NovelaiArtistChain[] | undefined

  /**
   * @param filePath - absolute file holding the `{ chains }` document;
   *   `undefined` selects the memory-only degradation.
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
   * Read the whole library, chains in insertion order.
   * @returns the chains; empty when nothing was saved yet, the file is
   *   unreadable or unparseable, or the store is memory-only with no saves.
   */
  async list(): Promise<readonly NovelaiArtistChain[]> {
    if (this.cache === undefined) this.cache = await this.load()
    return this.cache
  }

  /**
   * Save one named chain: a new name appends, an existing name replaces that
   * chain's text in place. The chain text is stored verbatim (outer trim
   * only) — the store never parses `weight:artist::` framing.
   * @param request - the chain's name and its whole text.
   * @returns the full library after the write, in insertion order.
   * @throws {@link ArtistChainsRefusalError} kind `invalid` when the trimmed
   *   name is empty or over 60 characters, or the trimmed chain is empty or
   *   over 4000 characters.
   */
  async save(request: { readonly name: string; readonly chain: string }): Promise<readonly NovelaiArtistChain[]> {
    const name = assertName(request.name)
    const chain = assertChain(request.chain)
    const chains = [...(this.cache ?? await this.load())]
    const current = chains.find(item => item.name === name)
    if (current === undefined) {
      chains.push({ id: randomUUID(), name, chain })
    } else {
      chains[chains.indexOf(current)] = { id: current.id, name, chain }
    }
    await this.persist(chains)
    return chains
  }

  /**
   * Remove one saved chain by id.
   * @param id - the chain to remove.
   * @returns the full library after the write, in insertion order.
   * @throws {@link ArtistChainsRefusalError} kind `missing` when the id does
   *   not match a stored chain.
   */
  async remove(id: string): Promise<readonly NovelaiArtistChain[]> {
    const chains = [...(this.cache ?? await this.load())]
    const current = chains.find(item => item.id === id)
    if (current === undefined) throw new ArtistChainsRefusalError('missing', `artist chain "${id}" does not exist`, id)
    chains.splice(chains.indexOf(current), 1)
    await this.persist(chains)
    return chains
  }

  /** Read and cache the document; unreadable, unparseable, or wrong-shaped files read as empty. */
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
      if (typeof parsed !== 'object' || parsed === null) return []
      const chains = (parsed as Record<string, unknown>)['chains']
      return Array.isArray(chains) && chains.every(isArtistChain) ? chains : []
    } catch {
      // An unparseable library must not break the panel: treat it as empty.
      return []
    }
  }

  /** Atomically rewrite the whole document (temporary file, then rename) and cache it. */
  private async persist(chains: readonly NovelaiArtistChain[]): Promise<void> {
    this.cache = chains
    const filePath = this.filePath
    if (filePath === undefined) return
    if (!this.ensured) {
      await mkdir(dirname(filePath), { recursive: true })
      this.ensured = true
    }
    const temporary = `${filePath}.tmp`
    await writeFile(temporary, `${JSON.stringify({ chains }, null, 2)}\n`, 'utf8')
    await rename(temporary, filePath)
  }
}

/** Reject a name the library cannot organize by. */
function assertName(name: string): string {
  const trimmed = name.trim()
  if (trimmed === '') throw new ArtistChainsRefusalError('invalid', 'artist chain name must not be empty')
  if (trimmed.length > ARTIST_CHAINS_NAME_MAX) throw new ArtistChainsRefusalError('invalid', `artist chain name exceeds ${ARTIST_CHAINS_NAME_MAX} characters`)
  return trimmed
}

/** Reject chain text that cannot be a stored chain; the accepted text is kept verbatim. */
function assertChain(chain: string): string {
  const trimmed = chain.trim()
  if (trimmed === '') throw new ArtistChainsRefusalError('invalid', 'artist chain text must not be empty')
  if (trimmed.length > ARTIST_CHAINS_CHAIN_MAX) throw new ArtistChainsRefusalError('invalid', `artist chain text exceeds ${ARTIST_CHAINS_CHAIN_MAX} characters`)
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
  return typeof record['id'] === 'string' && typeof record['name'] === 'string' && typeof record['chain'] === 'string'
}
