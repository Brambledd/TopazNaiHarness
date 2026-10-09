/**
 * Shared NovelAI output library: a JSON index merged with a directory scan of the
 * generation output directory, so workbench submissions and `novelai_generate` tool
 * calls appear as one history.
 * @module @deepseek-ai/dsh-api-novelai-controller/library
 */

import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { parseNovelaiPngMeta, readPngSize } from '@deepseek-ai/dsh-novelai-core'
import type { NovelaiCharacterPromptValue } from './types.ts'

/** One image recorded in the shared library. */
export interface NovelaiLibraryEntry {
  /** Entry id: the filename stem. */
  readonly id: string
  /** Absolute path of the PNG. */
  readonly file: string
  /** PNG size in bytes. */
  readonly bytes: number
  readonly width?: number
  readonly height?: number
  readonly seed?: number
  readonly model?: string
  readonly steps?: number
  readonly prompt?: string
  readonly negativePrompt?: string
  /** Per-character captions recorded with the submission. */
  readonly characters?: readonly NovelaiCharacterPromptValue[]
  /** ISO-8601 creation instant of the PNG file. */
  readonly createdAt: string
}

/** Name of the JSON index file inside the output directory. */
export const LIBRARY_INDEX_FILE = 'library.json'

/**
 * Read and maintain the shared NovelAI image library over one output directory.
 *
 * The JSON index records workbench submissions with their full parameters; PNGs written
 * by other producers (the `novelai_generate` tool) are discovered by the directory scan
 * and enriched with the metadata the NovelAI API embeds in the file itself. Files that
 * disappear drop out of the merged listing.
 */
export class NovelaiImageLibrary {
  private readonly directory: string

  /** @param outputDir - configured output directory; relative paths resolve against the process cwd. */
  constructor(outputDir: string) {
    this.directory = isAbsolute(outputDir) ? outputDir : resolve(outputDir)
  }

  /** Canonical absolute directory of this library. */
  get path(): string {
    return this.directory
  }

  /**
   * Create the output directory when missing.
   * @throws when the directory cannot be created (surfaced as `novelai/library-unavailable`).
   */
  async ensure(): Promise<void> {
    await mkdir(this.directory, { recursive: true })
  }

  /**
   * Record one workbench submission in the JSON index.
   * @param entry - the completed generation's entry.
   */
  async record(entry: NovelaiLibraryEntry): Promise<void> {
    const entries = await this.readIndex()
    const next = entries.filter(existing => existing.id !== entry.id)
    next.push(entry)
    await this.writeIndex(next)
  }

  /**
   * Remove one entry and its PNG file.
   * @param id - entry id (the filename stem).
   * @returns whether the entry existed and was removed.
   */
  async remove(id: string): Promise<boolean> {
    const entries = await this.readIndex()
    const entry = entries.find(candidate => candidate.id === id)
    if (entry === undefined) return false
    await unlink(entry.file).catch((error: unknown) => {
      if (!isNotExist(error)) throw error
    })
    await this.writeIndex(entries.filter(candidate => candidate.id !== id))
    return true
  }

  /**
   * List the merged library, newest first. Every PNG present in the directory appears;
   * an indexed row for a stem that still exists wins over the scan row, because the
   * index holds the exact request parameters rather than the file's embedded text.
   * @returns the complete merged listing.
   */
  async list(): Promise<NovelaiLibraryEntry[]> {
    const [indexed, scanned] = await Promise.all([this.readIndex(), this.scan()])
    const byId = new Map(scanned.entries.map(entry => [entry.id, entry]))
    for (const entry of indexed) {
      if (scanned.existingIds.has(entry.id)) byId.set(entry.id, entry)
    }
    return [...byId.values()].sort(compareNewestFirst)
  }

  /**
   * Read the JSON index; a missing or unparseable index behaves as empty.
   * @returns the indexed entries.
   */
  private async readIndex(): Promise<NovelaiLibraryEntry[]> {
    let raw: string
    try {
      raw = await readFile(join(this.directory, LIBRARY_INDEX_FILE), 'utf8')
    } catch (error) {
      if (isNotExist(error)) return []
      throw error
    }
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed)) return []
      return parsed.filter(isLibraryEntry)
    } catch {
      // An unparseable index must not hide the directory scan: treat it as empty.
      return []
    }
  }

  /**
   * Atomically write the JSON index (temporary file, then rename).
   * @param entries - the complete indexed entry set.
   */
  private async writeIndex(entries: readonly NovelaiLibraryEntry[]): Promise<void> {
    const target = join(this.directory, LIBRARY_INDEX_FILE)
    const temporary = `${target}.tmp`
    await writeFile(temporary, `${JSON.stringify(entries, null, 2)}\n`, 'utf8')
    await rename(temporary, target)
  }

  /**
   * Scan the output directory for PNGs, reading each file's embedded metadata.
   * @returns discovered entries plus the set of stems that still exist on disk.
   */
  private async scan(): Promise<{ entries: NovelaiLibraryEntry[]; existingIds: Set<string> }> {
    let names: string[]
    try {
      names = await readdir(this.directory)
    } catch (error) {
      if (isNotExist(error)) return { entries: [], existingIds: new Set() }
      throw error
    }
    const entries: NovelaiLibraryEntry[] = []
    const existingIds = new Set<string>()
    for (const name of names.sort()) {
      if (!name.toLowerCase().endsWith('.png') || name === LIBRARY_INDEX_FILE) continue
      const id = name.slice(0, -4)
      const file = join(this.directory, name)
      const [bytes, info] = await Promise.all([readFile(file), stat(file)])
      existingIds.add(id)
      const meta = parseNovelaiPngMeta(bytes)
      const size = readPngSize(bytes)
      entries.push({
        id,
        file,
        bytes: bytes.byteLength,
        ...(size === undefined ? {} : { width: size.width }),
        ...(size === undefined ? {} : { height: size.height }),
        ...(meta.seed === undefined ? {} : { seed: meta.seed }),
        ...(meta.model === undefined ? {} : { model: meta.model }),
        ...(meta.steps === undefined ? {} : { steps: meta.steps }),
        ...(meta.prompt === undefined ? {} : { prompt: meta.prompt }),
        ...(meta.negativePrompt === undefined ? {} : { negativePrompt: meta.negativePrompt }),
        createdAt: info.birthtime.toISOString(),
      })
    }
    return { entries, existingIds }
  }
}

/** Report whether the thrown value is a file-not-found error. */
function isNotExist(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as NodeJS.ErrnoException).code === 'ENOENT'
}

/** Order entries newest first; identical instants fall back to id order for stability. */
function compareNewestFirst(left: NovelaiLibraryEntry, right: NovelaiLibraryEntry): number {
  const byTime = right.createdAt.localeCompare(left.createdAt)
  return byTime !== 0 ? byTime : right.id.localeCompare(left.id)
}

/** Structural guard for JSON index rows. */
function isLibraryEntry(value: unknown): value is NovelaiLibraryEntry {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record['id'] === 'string' && typeof record['file'] === 'string'
    && typeof record['bytes'] === 'number' && typeof record['createdAt'] === 'string'
}
