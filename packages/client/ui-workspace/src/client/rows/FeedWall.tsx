/**
 * The feed wall: the InterKnot-style session-card masonry that owns the
 * center at the layout's feed level (the app's outermost view). Derives the
 * same flat newest-first nodes the sidebar's "In one list" body derives, and
 * places them into the shortest column (row-major, newest top-left) — the
 * VirtualMasonry stagger without virtualization. No groups, no drag, no
 * search: the wall is the browse surface, the sidebar stays the navigator.
 * Card activation enters the session level through the layout service
 * (wired into `open` at the apply site). Pure component: everything arrives
 * through the four shares; measured card heights are component-local state
 * (the only private reactive fact, fed back as placement input).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { CoverCache } from '../cover-cache.ts'
import { SessionNodeItem } from './Rows.tsx'
import { deriveFlat } from '../tree.ts'
import { MASONRY_GAP, placeMasonry } from './feed-masonry.ts'
import css from './Feed.module.css'

/**
 * Registrant-private injected share (arrives via the register inject
 * factory): the same session verbs the sidebar browser injects, without the
 * workspace dialogs and search the wall does not render.
 */
export interface FeedWallInjected {
  /** Open (select) a session; the apply site also enters the session level. */
  open: (sessionId: SessionId) => void
  /** Fork a session at its last completed turn (card menu action). */
  forkSession: (sessionId: SessionId) => void
  /** Open the browser-owned session rename dialog (card menu action). */
  renameSession: (sessionId: SessionId, currentTitle: string) => Promise<void>
  /** Archive this session (card menu action; commits without a dialog). */
  archiveSession: (sessionId: SessionId) => Promise<void>
  /** The card cover cache over the list-level attachment read. */
  coverCache: CoverCache
}

/**
 * Full wall props: the runtime share's global hooks plus the injected
 * session verbs and the workspace locale seat.
 */
export type FeedWallProps =
  & PropsRuntime<'shell.feed'>
  & FeedWallInjected
  & PropsLocale<'workspace'>

/** Estimated card height before its real measurement arrives (the uniform
 *  fallback-cut card: 1.576 cover plus the meta strip at a 240px column). */
const FALLBACK_CARD_HEIGHT = 208

/**
 * Render the feed wall.
 * @param props - composed slot props (runtime share + injected callbacks).
 * @returns the feed element tree.
 */
export function FeedWall({
  useSessions,
  useSessionPendingInteraction,
  useWorkspaces,
  open,
  forkSession,
  renameSession,
  archiveSession,
  coverCache,
  t,
}: FeedWallProps) {
  const list = useSessions(s => s)
  const pendingInteractions = useSessionPendingInteraction(s => s)
  const archivedSessionIds = useWorkspaces(state => state.archivedSessionIds)
  const nodes = useMemo(
    () => deriveFlat(list, archivedSessionIds, pendingInteractions),
    [list, archivedSessionIds, pendingInteractions],
  )
  const now = Date.now()

  // Measured card heights are the wall's one private reactive fact: cards
  // report their rendered height (cover aspect + meta strip) and placement
  // recomputes from the measurements. Refs keep the map identity stable; the
  // version counter is the re-placement trigger.
  const heightsRef = useRef(new Map<string, number>())
  const [measureVersion, bumpMeasureVersion] = useState(0)
  const wallRef = useRef<HTMLDivElement | null>(null)
  const [wallWidth, setWallWidth] = useState(0)

  // The wall's own content box is the placement space (its padding lives
  // outside it). One observer serves the whole wall's lifetime; the runtime
  // without ResizeObserver (the unit lane's jsdom) keeps the fallback layout.
  useEffect(() => {
    const wall = wallRef.current
    if (wall === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const width = entries.at(-1)?.contentRect.width ?? 0
      setWallWidth(current => (Math.abs(current - width) < 0.5 ? current : width))
    })
    observer.observe(wall)
    return () =>{  observer.disconnect() }
  }, [])

  // Card measurement: one shared observer; an entry's content height is that
  // card's placement height. Height changes (cover loaded, column width
  // changed the wrap) schedule one version bump per frame. The runtime
  // without ResizeObserver keeps every card at the fallback height.
  const observerRef = useRef<ResizeObserver | null>(null)
  const measureFrameRef = useRef<number | null>(null)
  const measureRef = (id: string) => (element: Element | null) => {
    if (element === null || typeof ResizeObserver === 'undefined') return
    if (observerRef.current === null) {
      observerRef.current = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const observedId = (entry.target as HTMLElement).dataset.masonryId
          if (observedId !== undefined) heightsRef.current.set(observedId, entry.contentRect.height)
        }
        if (measureFrameRef.current === null) {
          measureFrameRef.current = requestAnimationFrame(() => {
            measureFrameRef.current = null
            bumpMeasureVersion(version => version + 1)
          })
        }
      })
    }
    ;(element as HTMLElement).dataset.masonryId = id
    observerRef.current.observe(element)
  }
  useEffect(() => () => {
    observerRef.current?.disconnect()
    observerRef.current = null
    if (measureFrameRef.current !== null) cancelAnimationFrame(measureFrameRef.current)
  }, [])

  const layout = useMemo(
    () => placeMasonry(nodes.map(node => node.id), heightsRef.current, wallWidth, FALLBACK_CARD_HEIGHT),
    // heightsRef holds the measured values (identity-stable, never read
    // during render); measureVersion is its re-placement trigger.
    [nodes, wallWidth, measureVersion],
  )
  const slotById = useMemo(() => new Map(layout.slots.map(slot => [slot.id, slot])), [layout])

  return (
    <div className={css.viewport}>
      <div ref={wallRef} className={css.wall} style={{ height: layout.totalHeight === 0 ? undefined : layout.totalHeight + MASONRY_GAP }}>
        {nodes.length === 0 && <div className={css.empty}>{t('empty.none')}</div>}
        {nodes.map((node) => {
          const slot = slotById.get(node.id)
          return (
            <div
              key={node.id}
              ref={measureRef(node.id)}
              className={css.cell}
              style={slot === undefined ? { visibility: 'hidden' } : { transform: `translate(${slot.x}px, ${slot.y}px)`, width: slot.width }}
            >
              <SessionNodeItem
                node={node}
                currentId={list.current}
                now={now}
                onOpen={open}
                onRename={(id, title) => { void renameSession(id, title) }}
                onFork={forkSession}
                onArchive={(id) => { void archiveSession(id) }}
                coverCache={coverCache}
                t={t}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
