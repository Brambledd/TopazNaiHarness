/**
 * Three-column shell frame, registered into the built-in 'root' slot (the web
 * shell renders only 'root'). Owns the grid tracks (sidebar | center |
 * details), the drag handles (pointer capture + rAF throttle), the concession
 * chain (columns.ts), and the child-slot render decisions: the sidebar slot
 * renders HERE with live parameters from the concession solve, and the
 * session-aware occupants render in fixed column positions; strict entries
 * gate themselves on current-session availability while session-maybe
 * entries retain identity. Pure component: everything arrives
 * through the three framework shares — zero cordis or framework imports,
 * zero self-made hooks.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { IconChevronLeftOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
import { computeColumns, SIDEBAR_AUTO_COLLAPSE, SIDEBAR_DEFAULT } from './columns.ts'
import { DocumentTitle } from './DocumentTitle.tsx'
import type { createLayoutStore } from './stores.ts'
import css from './AppFrame.module.css'

/** Full composed props: runtime share + child-slot render share + store share. */
export type AppFrameProps =
  & PropsRuntime<'root'>
  & PropsRenderSlots<'sidebar' | 'conversation' | 'workbench' | 'details' | 'shell.feed' | 'shell.overlay'>
  & PropsStore<ReturnType<typeof createLayoutStore>>
  & PropsLocale<'common'>

/** Center column grid item (session-body building block). */
function CenterColumn(props: { children?: ReactNode }) {
  return <div className={css.centerCol}>{props.children}</div>
}

/** Details column grid item; width 0 keeps the subtree mounted (never unmount on close). */
function DetailsColumn(props: { children?: ReactNode }) {
  return <div className={css.detailsCol}>{props.children}</div>
}

/**
 * One drag handle: pointer capture, rAF-throttled dx reports against the drag-start origin.
 * `side` keys the hover-reveal CSS to the owning column.
 */
function DragHandle(props: { side: 'sidebar' | 'details'; left: number; onStart: () => void; onDrag: (dx: number) => void; onEnd: () => void }) {
  const [dragging, setDragging] = useState(false)
  const origin = useRef(0)
  const latest = useRef(0)
  const frame = useRef<number | null>(null)
  const callbacks = useRef({ onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd })
  callbacks.current = { onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd }

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    origin.current = e.clientX
    latest.current = e.clientX
    callbacks.current.onStart()
    setDragging(true)
  }, [])
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    latest.current = e.clientX
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null
      callbacks.current.onDrag(latest.current - origin.current)
    })
  }, [])
  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null }
    callbacks.current.onDrag(latest.current - origin.current)
    setDragging(false)
    callbacks.current.onEnd()
  }, [])

  return (
    <div
      className={css.handle}
      style={{ left: props.left }}
      data-side={props.side}
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  )
}

/** The three-column frame (see module doc). */
export function AppFrame({
  useStore,
  useSessions,
  actions,
  renderSlot,
  SessionProvider,
  t,
}: AppFrameProps) {
  const panels = useStore(s => s)
  // The details rail is the conversation's persistent workbench seat: it stays
  // open across Session switches (the console's state is session-independent).
  // No-session and blank sessions collapse the track in the column solve below.
  const detailsSession = useSessions((s) => {
    const current = s.current
    return current !== undefined && s.byId[current]?.blank === false ? current : undefined
  })
  const documentTitle = useSessions((s) => {
    const current = s.current
    return current === undefined ? undefined : s.byId[current]?.title
  })
  const frameRef = useRef<HTMLDivElement | null>(null)
  const [viewport, setViewport] = useState(() => window.innerWidth)

  // Track the frame's own box (not the window): rAF-throttled ResizeObserver.
  useEffect(() => {
    const el = frameRef.current
    /* v8 ignore next -- the ref is always attached by effect time: the frame div renders unconditionally. */
    if (el === null) return
    let raf: number | null = null
    const observer = new ResizeObserver(() => {
      raf ??= requestAnimationFrame(() => {
        raf = null
        const width = el.getBoundingClientRect().width
        if (width > 0) setViewport(width)
      })
    })
    observer.observe(el)
    return () => {
      observer.disconnect()
      if (raf !== null) cancelAnimationFrame(raf)
    }
  }, [])

  // Narrow viewports auto-collapse the sidebar; the store mirror keeps
  // toggleSidebar's semantics right (narrow toggles flip the manual
  // re-expand override, stores.ts). Collapsed is decided here, so the
  // solver stays breakpoint-free: a narrow re-expand passes the preference
  // (or the default when the wide preference is closed) and the center
  // absorbs the squeeze. The feed level force-collapses the sidebar to the
  // rail (the InterKnot feed owns the screen) with its own manual override.
  const narrow = viewport < SIDEBAR_AUTO_COLLAPSE
  useEffect(() => { actions.setNarrow(narrow) }, [actions, narrow])
  const onFeed = panels.sessionView === 'feed'
  const sidebarCollapsed = onFeed
    ? !panels.feedExpanded
    : (narrow ? !panels.narrowExpanded : panels.sidebar === 0)
  const sidebarPreference = sidebarCollapsed
    ? 0
    : panels.sidebar === 0 ? SIDEBAR_DEFAULT : panels.sidebar
  // The feed level owns the whole screen (its solve drops the details track);
  // no session or a blank session collapses the rail the same way.
  const cols = computeColumns(viewport, sidebarPreference, onFeed || detailsSession === undefined ? 0 : panels.details)
  const colsRef = useRef(cols)
  colsRef.current = cols

  // The drag base is the rendered width captured at drag start (grabbing a
  // concession-clamped panel must not jump back to the stored preference);
  // it stays frozen for the whole gesture so dx deltas do not compound.
  const sidebarBase = useRef(0)
  const detailsBase = useRef(0)
  // Track-level transitions pause for the whole gesture: eased tracks would
  // detach the column edge from the pointer (AppFrame.module.css).
  const [dragging, setDragging] = useState(false)
  const onDragEnd = useCallback(() => { setDragging(false) }, [])
  const onSidebarStart = useCallback(() => { sidebarBase.current = colsRef.current.sidebar; setDragging(true) }, [])
  const onDetailsStart = useCallback(() => { detailsBase.current = colsRef.current.details; setDragging(true) }, [])
  const onSidebarDrag = useCallback((dx: number) => {
    actions.setSidebar(sidebarBase.current + dx)
  }, [actions])
  const onDetailsDrag = useCallback((dx: number) => {
    actions.setDetails(detailsBase.current - dx)
  }, [actions])
  const productTitle = process.env.DSH_CLIENT_TITLE ?? t('brand.localBuild')

  return (
    <div
      ref={frameRef}
      className={css.frame}
      style={{ gridTemplateColumns: `${cols.sidebar}px minmax(0, 1fr) ${cols.details}px` }}
      data-sidebar-collapsed={sidebarCollapsed || undefined}
      data-details-collapsed={cols.details === 0 || undefined}
      data-dragging={dragging || undefined}
    >
      <DocumentTitle
        productTitle={productTitle}
        {...documentTitle === undefined ? {} : { title: documentTitle }}
      />
      <div className={css.sidebarCol}>
        {/* Render-site slot call with live concession output: a closed
            sidebar keeps the mounted slot at the compact-rail width, and the
            component sees its rendered state as owner params decided here
            (collapsed follows the resolved rail, so a derived auto-collapse
            renders the rail UI too). The active view mode and navigation
            level ride along: the sidebar's foot seats relay them to
            mode-switch occupants. */}
        {renderSlot('sidebar', {
          collapsed: sidebarCollapsed,
          width: cols.sidebar,
          viewMode: panels.viewMode,
          sessionView: panels.sessionView,
        })}
      </div>
      <>
        {/* Every center occupant stays at a fixed tree position from first
            paint and remains mounted across surface switches (the inactive
            pane is display:none, so a switch never remounts the
            conversation). The feed pane is the outermost level and gates the
            other two: the entered conversation/workbench panes show only
            after card activation (enterSession) and return via the feed back
            bar (exitToFeed). The conversation is session-maybe;
            SessionProvider withholds the strict details entry while no
            session is current. The workbench pane receives the live mode as
            its owner share. */}
        <CenterColumn>
          <div className={onFeed ? css.centerPane : css.centerPaneHidden}>
            {renderSlot('shell.feed', {})}
          </div>
          <div className={!onFeed && panels.viewMode === 'conversation' ? css.centerPane : css.centerPaneHidden}>
            <div className={css.backBar}>
              <button
                type="button"
                className={css.backButton}
                aria-label={t('feed.backToList')}
                onClick={() => { actions.exitToFeed() }}
              >
                <IconChevronLeftOutline14 size={14} />
                <span>{t('feed.backToList')}</span>
              </button>
              {documentTitle !== undefined && <span className={css.backTitle}>{documentTitle}</span>}
            </div>
            <div className={css.paneBody}>{renderSlot('conversation', {})}</div>
          </div>
          <div className={!onFeed && panels.viewMode === 'workbench' ? css.centerPane : css.centerPaneHidden}>
            {renderSlot('workbench', { mode: panels.viewMode })}
          </div>
        </CenterColumn>
        <DetailsColumn>
          <SessionProvider>{renderSlot('details', {})}</SessionProvider>
        </DetailsColumn>
      </>
      <div className={css.overlayLayer} data-shell-overlay>
        {renderSlot('shell.overlay', {})}
      </div>
      {/* The collapsed rail is fixed-width: no resize handle while closed. */}
      {!sidebarCollapsed && <DragHandle side="sidebar" left={cols.sidebar} onStart={onSidebarStart} onDrag={onSidebarDrag} onEnd={onDragEnd} />}
      {cols.details > 0 && <DragHandle side="details" left={viewport - cols.details} onStart={onDetailsStart} onDrag={onDetailsDrag} onEnd={onDragEnd} />}
    </div>
  )
}
