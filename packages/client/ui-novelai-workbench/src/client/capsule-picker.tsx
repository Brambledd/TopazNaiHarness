/** Inspiration-capsule chip browser and style presets (desktop reference parity). */
import { useMemo, useState } from 'react'
import { CAPSULE_TAXONOMY, type CapsuleCategory } from './capsule-data.ts'
import css from './workbench.module.css'

/** Insertion seam: hand one English tag to the prompt owner. */
export type InsertTag = (tag: string) => void

/** Normalize an English tag for filter matching: underscores become spaces. */
function normalizeTag(tag: string): string {
  return tag.toLowerCase().replace(/_/g, ' ')
}

/** Every tag of one category flattened, filter applied.
 * @param category - the capsule category to flatten.
 * @param filter - Chinese or English filter text; empty keeps everything.
 * @returns the visible tags in declaration order.
 */
function visibleTags(category: CapsuleCategory, filter: string): Array<{ en: string; zh: string }> {
  const needle = filter.trim().toLowerCase()
  const out: Array<{ en: string; zh: string }> = []
  for (const subgroup of category.subgroups) {
    for (const tag of subgroup.tags) {
      if (needle === ''
        || tag.zh.includes(filter.trim())
        || normalizeTag(tag.en).includes(normalizeTag(needle))) {
        out.push(tag)
      }
    }
  }
  return out
}

/** The curated style presets: every tag of the style category, first batch wins. */
export const STYLE_PRESETS: Array<{ en: string; zh: string }> = (() => {
  const category = CAPSULE_TAXONOMY.find(candidate => candidate.name === '风格画风')
  return category === undefined ? [] : visibleTags(category, '')
})()

/** One chip button rendering a capsule tag. */
function Chip({ en, zh, onInsert }: { en: string; zh: string; onInsert: InsertTag }) {
  return (
    <button type="button" className={css.capsuleChip} title={en} onClick={() => { onInsert(en) }}>
      {zh}
    </button>
  )
}

/** The full capsule browser: category tabs, a filter, and chip grids. */
export function CapsuleBrowser({ onInsert, filterLabel }: { onInsert: InsertTag; filterLabel: string }) {
  const [categoryName, setCategoryName] = useState(CAPSULE_TAXONOMY[0]?.name ?? '')
  const [filter, setFilter] = useState('')
  const category = useMemo(
    () => CAPSULE_TAXONOMY.find(candidate => candidate.name === categoryName) ?? CAPSULE_TAXONOMY[0],
    [categoryName],
  )
  const searching = filter.trim() !== ''
  return (
    <div className={css.capsulePanel}>
      <input
        type="text"
        className={css.capsuleFilter}
        aria-label={filterLabel}
        placeholder={filterLabel}
        value={filter}
        onChange={(e) => { setFilter(e.target.value) }}
      />
      <div className={css.capsuleTabs} role="tablist">
        {CAPSULE_TAXONOMY.map(candidate => (
          <button
            key={candidate.name}
            type="button"
            role="tab"
            aria-selected={!searching && candidate.name === category?.name}
            className={`${css.capsuleTab} ${!searching && candidate.name === category?.name ? css.capsuleTabActive : ''}`}
            onClick={() => { setCategoryName(candidate.name) }}
          >
            {candidate.name}
          </button>
        ))}
      </div>
      {searching
        ? (
          <div className={css.capsuleGrid}>
            {CAPSULE_TAXONOMY.flatMap(batch => visibleTags(batch, filter)).map(tag => (
              <Chip key={`${tag.en}:${tag.zh}`} en={tag.en} zh={tag.zh} onInsert={onInsert} />
            ))}
          </div>
        )
        : (
          (category?.subgroups ?? []).map(subgroup => (
            <div key={subgroup.name} className={css.capsuleSubgroup}>
              <span className={css.capsuleSubgroupLabel}>{subgroup.name}</span>
              <div className={css.capsuleGrid}>
                {subgroup.tags.map(tag => <Chip key={tag.en} en={tag.en} zh={tag.zh} onInsert={onInsert} />)}
              </div>
            </div>
          ))
        )}
    </div>
  )
}
