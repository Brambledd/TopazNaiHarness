/**
 * Dictionary-backed tag suggestion scoring for workbench prompt autocomplete.
 * Chinese input matches Chinese labels and keywords; Latin input matches tags and
 * aliases in underscore-normalized form. Mirrors the desktop reference ranking:
 * exact 3 > prefix 2 > substring 1, then post count.
 * @module @deepseek-ai/dsh-api-novelai-controller/tags
 */

import { TAG_DICTIONARY, type NovelaiDictEntry } from './tag-dictionary.ts'
import type { NovelaiTagSuggestion } from './types.ts'

/** Suggest tags for one partial prompt word from the built-in dictionary.
 * @param query - the partial word at the caret, in either language.
 * @param limit - maximum suggestions to return.
 * @returns ranked suggestions, best first.
 */
export function suggestTagsFromDictionary(query: string, limit = 12): NovelaiTagSuggestion[] {
  const raw = query.trim()
  if (raw === '') return []
  const isCjk = /[㐀-鿿]/.test(raw)
  const normalized = raw.toLowerCase().replace(/_/g, ' ')
  const scored: Array<{ entry: NovelaiDictEntry; score: number }> = []
  for (const entry of TAG_DICTIONARY) {
    const terms = isCjk
      ? [entry.zh, ...(entry.keywords ?? [])]
      : [entry.tag, ...(entry.aliases ?? [])].map(term => term.toLowerCase().replace(/_/g, ' '))
    let score = 0
    for (const term of terms) {
      const lower = term.toLowerCase()
      if (lower === normalized) score = Math.max(score, 3)
      else if (lower.startsWith(normalized)) score = Math.max(score, 2)
      else if (lower.includes(normalized)) score = Math.max(score, 1)
    }
    if (score > 0) scored.push({ entry, score })
  }
  return scored
    .sort((left, right) => right.score - left.score || right.entry.count - left.entry.count)
    .slice(0, limit)
    .map(({ entry }) => ({
      tag: entry.tag,
      count: entry.count,
      category: entry.category,
      description: entry.zh,
    }))
}
