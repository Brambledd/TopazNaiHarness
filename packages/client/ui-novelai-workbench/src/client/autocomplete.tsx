/** Prompt textarea with Danbooru tag autocomplete (desktop reference parity). */
import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import type { NovelaiTagSuggestion } from '@deepseek-ai/dsh-api-novelai-controller/types'
import css from './workbench.module.css'

/** Word characters for autocomplete: Latin word chars, hyphen, and CJK. */
const WORD_CHAR = /[\w㐀-鿿-]/

/** The word immediately left of the cursor and where it starts.
 * @param text - full textarea content.
 * @param cursor - caret offset.
 * @returns the partial word and its start offset.
 */
export function wordAtCursor(text: string, cursor: number): { word: string; start: number } {
  let start = cursor
  while (start > 0 && WORD_CHAR.test(text[start - 1] ?? '')) start--
  return { word: text.slice(start, cursor), start }
}

/** Format a Danbooru post count compactly (1_900_000 -> "1.9M").
 * @param count - raw post count.
 * @returns the compact rendering.
 */
export function formatCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(0)}k`
  return String(count)
}

/** Vertical caret coordinates for the dropdown anchor (desktop mirror-div probe). */
function caretCoordinates(el: HTMLTextAreaElement, position: number): { top: number; height: number } {
  const computed = window.getComputedStyle(el)
  const div = document.createElement('div')
  const copyProps = [
    'boxSizing', 'width', 'borderTopWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderRightWidth',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'fontStyle', 'fontVariant', 'fontWeight', 'fontSize', 'lineHeight', 'fontFamily',
    'textAlign', 'letterSpacing', 'wordSpacing', 'tabSize',
  ] as const
  div.style.position = 'absolute'
  div.style.visibility = 'hidden'
  div.style.whiteSpace = 'pre-wrap'
  div.style.wordWrap = 'break-word'
  div.style.overflow = 'hidden'
  for (const prop of copyProps) {
    (div.style as unknown as Record<string, string>)[prop] = computed.getPropertyValue(
      prop.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`),
    )
  }
  div.textContent = el.value.slice(0, position)
  const span = document.createElement('span')
  span.textContent = el.value.slice(position) || '.'
  div.appendChild(span)
  document.body.appendChild(div)
  const lineHeight = Number.parseFloat(computed.lineHeight) || Number.parseFloat(computed.fontSize) * 1.3 || 18
  const result = { top: span.offsetTop, height: lineHeight }
  document.body.removeChild(div)
  return result
}

/** Suggestion lookup seam handed in by the workbench. */
export type SuggestTags = (word: string) => Promise<readonly NovelaiTagSuggestion[]>

/** Textarea with debounced tag suggestions anchored below the caret. */
export function PromptTextarea({
  value,
  onChange,
  suggest,
  placeholder,
  ariaLabel,
  className,
}: {
  value: string
  onChange: (next: string) => void
  suggest: SuggestTags
  placeholder: string
  ariaLabel: string
  className: string | undefined
}) {
  const [suggestions, setSuggestions] = useState<readonly NovelaiTagSuggestion[]>([])
  const [activeIdx, setActiveIdx] = useState(0)
  const [listTop, setListTop] = useState<number | null>(null)
  const composingRef = useRef(false)
  const areaRef = useRef<HTMLTextAreaElement | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestIdRef = useRef(0)

  // Height fits the content: the box grows with every edit, so no inner
  // scrolling is ever needed to read the full prompt.
  useEffect(() => {
    const area = areaRef.current
    if (area === null) return
    area.style.height = 'auto'
    area.style.height = `${area.scrollHeight}px`
  }, [value])

  const clearSuggestions = (): void => {
    setSuggestions([])
    setListTop(null)
  }

  const runSuggest = (word: string, cursor: number): void => {
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    const requestId = ++requestIdRef.current
    timerRef.current = setTimeout(() => {
      suggest(word).then((tags) => {
        if (requestId !== requestIdRef.current) return
        const top = tags.slice(0, 8)
        setSuggestions(top)
        setActiveIdx(0)
        const area = areaRef.current
        if (area !== null && top.length > 0) {
          const coords = caretCoordinates(area, cursor)
          setListTop(coords.top - area.scrollTop + coords.height + 2)
        }
      }).catch(() => {
        if (requestId === requestIdRef.current) clearSuggestions()
      })
    }, 80)
  }

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    const text = event.target.value
    const cursor = event.target.selectionStart ?? text.length
    onChange(text)
    if (composingRef.current) {
      clearSuggestions()
      return
    }
    const { word } = wordAtCursor(text, cursor)
    if (word.length < 1) {
      clearSuggestions()
      if (timerRef.current !== null) clearTimeout(timerRef.current)
      return
    }
    runSuggest(word, cursor)
  }

  const applyTag = (tag: string): void => {
    const area = areaRef.current
    if (area === null) return
    const cursor = area.selectionStart ?? value.length
    const { start } = wordAtCursor(value, cursor)
    let end = cursor
    while (end < value.length && WORD_CHAR.test(value[end] ?? '')) end++
    const after = value.slice(end).replace(/^\s*,\s*/, '').trimStart()
    const before = value.slice(0, start)
    const next = `${before}${tag}, ${after}`
    onChange(next)
    clearSuggestions()
    const pos = start + tag.length + 2
    requestAnimationFrame(() => { area.focus(); area.setSelectionRange(pos, pos) })
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.nativeEvent.isComposing || composingRef.current) return
    if (suggestions.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIdx(index => Math.min(index + 1, suggestions.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIdx(index => Math.max(index - 1, 0))
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      const picked = suggestions[activeIdx]
      if (picked !== undefined) applyTag(picked.tag)
    } else if (event.key === 'Escape') {
      clearSuggestions()
    }
  }

  return (
    <div className={css.acWrap}>
      <textarea
        ref={areaRef}
        className={className}
        aria-label={ariaLabel}
        value={value}
        placeholder={placeholder}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onCompositionStart={() => {
          composingRef.current = true
          clearSuggestions()
          if (timerRef.current !== null) clearTimeout(timerRef.current)
        }}
        onCompositionEnd={(event) => {
          composingRef.current = false
          handleChange(event as unknown as ChangeEvent<HTMLTextAreaElement>)
        }}
      />
      {suggestions.length > 0 && (
        <ul className={css.acList} role="listbox" aria-label={ariaLabel} style={{ top: listTop ?? 0 }}>
          {suggestions.map((tag, index) => (
            <li
              key={tag.tag}
              role="option"
              aria-selected={index === activeIdx}
              className={index === activeIdx ? `${css.acItem} ${css.acItemActive}` : css.acItem}
              onMouseEnter={() => { setActiveIdx(index) }}
              onMouseDown={(event) => { event.preventDefault(); applyTag(tag.tag) }}
            >
              <span className={css.acTag}>{tag.tag}</span>
              <span className={css.acDesc}>{tag.description}</span>
              <span className={css.acCount}>{formatCount(tag.count)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
