/** Local Danbooru bilingual tag index for workbench autocomplete (desktop parity).
 *
 * Source: SuzumiyaAkizuki/DanbooruSearchOnline `tags_enhanced.csv` — Danbooru
 * tags (>=100 posts, general/character/copyright) with Chinese translations,
 * columns `name, cn_name, wiki, post_count, category, nsfw`. Only rows with a
 * non-empty `cn_name` enter the index, so every suggestion carries Chinese.
 * The CSV is GBK-encoded (NOT UTF-8) and pinned to one commit so the parsed
 * shape cannot drift. The dataset is GPL-3.0, so it is downloaded on demand
 * into the configured path and never bundled.
 */

import { readFile, rename, stat, writeFile } from 'node:fs/promises'
import { requestBinaryDownload, resolveProxyUrl } from '@deepseek-ai/dsh-novelai-core/node'

/** Upstream commit the CSV is pinned to; `main` would drift under us. */
const PINNED_COMMIT = '2975a0aae0a375abf9d3f7abadc19276633a8e42'
const TAG_INDEX_URL = `https://raw.githubusercontent.com/SuzumiyaAkizuki/DanbooruSearchOnline/${PINNED_COMMIT}/origin_database/tags_enhanced.csv`
/** Hard cap on the accepted download. */
export const MAX_TAG_INDEX_BYTES = 20 * 1024 * 1024
/** Sanity floor for a valid dataset; fewer records means a corrupt download. */
export const MIN_TAG_INDEX_RECORDS = 10_000
/** Download timeout for the ~20MB CSV. */
const DOWNLOAD_TIMEOUT_MS = 120_000

/** One parsed index row. */
export interface DanbooruTag {
  /** English tag in Danbooru underscore form. */
  name: string
  /** Chinese aliases/translations; non-empty by construction. */
  cn: string[]
  /** Danbooru post count. */
  post: number
  /** Danbooru category: 0 general, 1 artist, 3 copyright, 4 character, 5 meta. */
  category: number
}

/**
 * Parse one CSV line honoring double-quoted fields with `""` escapes.
 * @param line - one raw CSV record without its line terminator.
 * @returns the unquoted field values.
 */
export function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        current += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      out.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  out.push(current)
  return out
}

/**
 * Parse and validate a GBK CSV buffer into index rows; throws on a wrong header.
 * @param buffer - raw `danbooru-cn.csv` bytes (GBK-encoded).
 * @returns the parsed rows, sorted by post count descending.
 */
export function parseTagIndexFromBuffer(buffer: Uint8Array): DanbooruTag[] {
  const text = new TextDecoder('gbk').decode(buffer)
  const lines = text.split(/\r?\n/u)
  const header = (lines[0] ?? '').toLowerCase()
  if (!header.includes('name') || !header.includes('cn_name')) {
    throw new Error('tag index header mismatch: missing name/cn_name columns')
  }
  const out: DanbooruTag[] = []
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (line === undefined || line === '') continue
    const cols = parseCsvLine(line)
    const name = cols[0]?.trim()
    if (name === undefined || name === '') continue
    const cn = (cols[1] ?? '').split(',').map(part => part.trim()).filter(part => part !== '')
    if (cn.length === 0) continue
    out.push({ name, cn, post: Number.parseInt(cols[3] ?? '', 10) || 0, category: Number.parseInt(cols[4] ?? '', 10) || 0 })
  }
  out.sort((a, b) => b.post - a.post)
  return out
}

/**
 * Scored search over parsed rows: CJK queries match Chinese aliases, latin
 * queries match the underscore-normalized English name; exact > prefix >
 * substring, ties by post count descending.
 * @param index - parsed rows to search.
 * @param query - user text at the caret, in either language.
 * @param limit - maximum suggestions to return.
 * @returns the best suggestions, best first.
 */
export function searchTagIndexEntries(index: readonly DanbooruTag[], query: string, limit = 12): NovelaiWireTagSuggestion[] {
  const raw = query.trim()
  if (raw === '') return []
  const isCjk = /[㐀-鿿]/u.test(raw)
  const normalized = raw.toLowerCase().replaceAll('_', ' ')
  const scored: Array<{ tag: DanbooruTag; score: number }> = []
  for (const tag of index) {
    let score = 0
    if (isCjk) {
      for (const alias of tag.cn) {
        if (alias === raw) {
          score = 3
          break
        }
        if (alias.startsWith(raw)) score = Math.max(score, 2)
        else if (alias.includes(raw)) score = Math.max(score, 1)
      }
    } else {
      const name = tag.name.toLowerCase().replaceAll('_', ' ')
      if (name === normalized) score = 3
      else if (name.startsWith(normalized)) score = 2
      else if (name.includes(normalized)) score = 1
    }
    if (score > 0) scored.push({ tag, score })
  }
  scored.sort((a, b) => b.score - a.score || b.tag.post - a.tag.post)
  return scored.slice(0, limit).map(({ tag }) => ({
    tag: tag.name,
    count: tag.post,
    category: tag.category,
    description: tag.cn.join(' '),
  }))
}

/** Wire shape of one suggestion (mirrors the suggest-tags value). */
export interface NovelaiWireTagSuggestion {
  tag: string
  count: number
  category: number
  description: string
}

/** Production binary GET used by {@link TagIndexStore.download}. */
const defaultFetchBinary = (url: string, proxyUrl: string): Promise<Uint8Array> =>
  requestBinaryDownload({ url, timeoutMs: DOWNLOAD_TIMEOUT_MS, maxBytes: MAX_TAG_INDEX_BYTES, proxyUrl: resolveProxyUrl(proxyUrl) })

/** Cached loader + downloader bound to one on-disk index path. */
export class TagIndexStore {
  private index: DanbooruTag[] | undefined
  private loading: Promise<DanbooruTag[]> | undefined

  /**
   * @param path - CSV location; relative paths resolve against the process cwd.
   * @param proxyUrl - optional outbound proxy for the download.
   * @param fetchBinary - binary GET seam; tests inject a fake, production downloads the pinned CSV.
   */
  constructor(
    private readonly path: string,
    private readonly proxyUrl: string,
    private readonly fetchBinary: (url: string, proxyUrl: string) => Promise<Uint8Array> = defaultFetchBinary,
  ) {}

  /**
   * Whether a valid index exists on disk (present and above the record floor).
   * @returns the presence report; zeroed fields when the file is absent or corrupt.
   */
  async status(): Promise<{ downloaded: boolean; count: number; sizeBytes: number }> {
    let sizeBytes = 0
    try {
      sizeBytes = (await stat(this.path)).size
    } catch {
      return { downloaded: false, count: 0, sizeBytes: 0 }
    }
    try {
      const index = await this.load()
      return { downloaded: index.length >= MIN_TAG_INDEX_RECORDS, count: index.length, sizeBytes }
    } catch {
      return { downloaded: false, count: 0, sizeBytes }
    }
  }

  /**
   * Download the pinned CSV, validate it, and atomically replace the file.
   * @returns the outcome report; `ok: false` with a reason on any failure.
   */
  async download(): Promise<{ ok: boolean; message: string; count: number }> {
    let buffer: Uint8Array
    try {
      buffer = await this.fetchBinary(TAG_INDEX_URL, this.proxyUrl)
    } catch (error) {
      return { ok: false, message: `tag index download failed: ${error instanceof Error ? error.message : String(error)}`, count: 0 }
    }
    if (buffer.byteLength > MAX_TAG_INDEX_BYTES) {
      return { ok: false, message: `tag index download exceeds the ${String(MAX_TAG_INDEX_BYTES)}-byte cap`, count: 0 }
    }
    let parsed: DanbooruTag[]
    try {
      parsed = parseTagIndexFromBuffer(buffer)
    } catch (error) {
      return { ok: false, message: `tag index validation failed: ${error instanceof Error ? error.message : String(error)}`, count: 0 }
    }
    if (parsed.length < MIN_TAG_INDEX_RECORDS) {
      return { ok: false, message: `tag index validation failed: only ${String(parsed.length)} records (floor ${String(MIN_TAG_INDEX_RECORDS)})`, count: 0 }
    }
    const temp = `${this.path}.tmp`
    try {
      await writeFile(temp, buffer)
      await rename(temp, this.path)
    } catch (error) {
      return { ok: false, message: `tag index write failed: ${error instanceof Error ? error.message : String(error)}`, count: 0 }
    }
    this.index = parsed
    this.loading = undefined
    return { ok: true, message: `downloaded the bilingual tag index (${String(parsed.length)} records)`, count: parsed.length }
  }

  /**
   * Load the on-disk index (cached); throws when absent or corrupt.
   * @returns the parsed rows; concurrent callers share one load.
   */
  async load(): Promise<DanbooruTag[]> {
    if (this.index !== undefined) return this.index
    if (this.loading !== undefined) return this.loading
    const loading = (async () => {
      const parsed = parseTagIndexFromBuffer(new Uint8Array(await readFile(this.path)))
      this.index = parsed
      return parsed
    })()
    this.loading = loading
    loading.catch(() => {
      // A corrupt or missing file must remain retryable after a re-download.
      if (this.loading === loading) this.loading = undefined
    })
    return loading
  }

  /**
   * Search the index, returning [] when it is not downloaded.
   * @param query - user text at the caret, in either language.
   * @param limit - maximum suggestions to return.
   * @returns the best suggestions, best first.
   */
  async search(query: string, limit = 12): Promise<NovelaiWireTagSuggestion[]> {
    let index: DanbooruTag[]
    try {
      index = await this.load()
    } catch {
      return []
    }
    return searchTagIndexEntries(index, query, limit)
  }
}
