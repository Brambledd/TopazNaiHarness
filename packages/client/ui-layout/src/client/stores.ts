/**
 * The root entry's transient layout store: panel geometry as plain widths in
 * px (0 = closed). Module level exports the factory only — a module-level
 * handle would pin the store's identity in the module
 * cache (a de-facto singleton surviving plugin reloads). register() receives
 * the factory (exclusive use: the framework instantiates per entry), AppFrame
 * derives its PropsStore share from the return type, and the service face
 * receives the bound actions through the registration's inject hook.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import {
  clampWidth, DETAILS_DEFAULT, DETAILS_MAX, DETAILS_MIN,
  SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN,
} from './columns.ts'

/**
 * The center surface the frame renders: the conversation or the workbench.
 * Owned here so the frame alone decides which center occupant is visible.
 */
export type ViewMode = 'conversation' | 'workbench'

/**
 * The frame's navigation level: the feed (the InterKnot-style session-card
 * wall, the outermost surface — no conversation content anywhere) or an
 * entered center (the conversation/workbench panes per `viewMode`). Boot
 * always lands on the feed; card activation enters, the feed's back control
 * and the sidebar's feed segment exit.
 */
export type SessionView = 'feed' | 'entered'

/**
 * Layout store state: panel width preferences in px (0 = closed), the
 * narrow-viewport pair — `narrow` mirrors AppFrame's breakpoint reading
 * (viewport < SIDEBAR_AUTO_COLLAPSE) so toggleSidebar can pick semantics, and
 * `narrowExpanded` is the manual override that re-expands the auto-collapsed
 * sidebar over the squeezed center without rewriting the width preference —
 * plus the active center `viewMode`, the navigation level `sessionView`, and
 * `feedExpanded`, the same kind of manual override for the feed level's
 * forced sidebar collapse.
 */
type LayoutState = {
  sidebar: number
  details: number
  narrow: boolean
  narrowExpanded: boolean
  viewMode: ViewMode
  sessionView: SessionView
  feedExpanded: boolean
}

/**
 * Annotation twin of the actions literal below (the export needs a declared
 * return type); drift fails assignability at the defineStore call.
 */
type LayoutActions = {
  setSidebar: (draft: LayoutState, px: number) => void
  setDetails: (draft: LayoutState, px: number) => void
  toggleSidebar: (draft: LayoutState) => void
  setNarrow: (draft: LayoutState, narrow: boolean) => void
  openDetails: (draft: LayoutState) => void
  closeDetails: (draft: LayoutState) => void
  setViewMode: (draft: LayoutState, mode: ViewMode) => void
  enterSession: (draft: LayoutState) => void
  exitToFeed: (draft: LayoutState) => void
}

/**
 * Create the layout panel store handle. The preference IS the width, so
 * closing a panel forgets its drag width — reopening restores the contract
 * default. Actions are the complete write set: drag writes clamp
 * into the panel's contract range and never cross the open/closed line;
 * open/close transitions write 0 / the default explicitly. Below the
 * auto-collapse breakpoint (AppFrame feeds setNarrow) the sidebar toggle
 * flips the narrowExpanded override instead of the preference; on the feed
 * level (the forced rail) it flips feedExpanded the same way.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createLayoutStore(): EngineStoreHandle<LayoutState, LayoutActions>  {
  const handle = defineStore({
    init: (): LayoutState => ({
      sidebar: SIDEBAR_DEFAULT, details: 0, narrow: false, narrowExpanded: false,
      viewMode: 'conversation', sessionView: 'feed', feedExpanded: false,
    }),
    actions: {
      setSidebar: (d, px: number) => { d.sidebar = clampWidth(px, SIDEBAR_MIN, SIDEBAR_MAX) },
      setDetails: (d, px: number) => { d.details = clampWidth(px, DETAILS_MIN, DETAILS_MAX) },
      // Narrow and feed toggles flip only their override: the width
      // preference survives untouched, so re-widening restores the
      // pre-squeeze layout.
      toggleSidebar: (d) => {
        if (d.sessionView === 'feed') d.feedExpanded = !d.feedExpanded
        else if (d.narrow) d.narrowExpanded = !d.narrowExpanded
        else d.sidebar = d.sidebar === 0 ? SIDEBAR_DEFAULT : 0
      },
      // Crossing the breakpoint in either direction drops the override: the
      // narrow default is auto-collapsed, the wide state is the preference.
      setNarrow: (d, narrow: boolean) => {
        if (d.narrow === narrow) return
        d.narrow = narrow
        d.narrowExpanded = false
      },
      openDetails: (d) => { if (d.details === 0) d.details = DETAILS_DEFAULT },
      closeDetails: (d) => { d.details = 0 },
      // The workbench view is its own full center surface: its details rail
      // would duplicate the console, so switching there closes it; switching
      // back to the conversation restores the rail beside the chat.
      setViewMode: (d, mode: ViewMode) => {
        d.viewMode = mode
        if (mode === 'workbench') d.details = 0
        else if (mode === 'conversation' && d.sessionView === 'entered' && d.details === 0) d.details = DETAILS_DEFAULT
      },
      // Entering drops the feed's manual expansion: the entered level starts
      // from the plain preference solve, exactly like a fresh wide boot. The
      // details rail (the conversation's workbench seat) opens with it — every
      // entry path lands with the console beside the chat.
      enterSession: (d) => {
        d.sessionView = 'entered'
        d.feedExpanded = false
        if (d.viewMode !== 'workbench' && d.details === 0) d.details = DETAILS_DEFAULT
      },
      exitToFeed: (d) => { d.sessionView = 'feed' },
    },
  })
  return handle
}
