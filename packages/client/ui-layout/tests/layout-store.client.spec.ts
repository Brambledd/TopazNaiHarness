// @vitest-environment jsdom
/**
 * createLayoutStore unit account: init shape, the action write set (clamp
 * inside actions), and the absence of browser persistence. Uses the
 * test-sanctioned path: factory self-call + .create() gives the
 * real engine instance (same create path as production).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createLayoutStore } from '@deepseek-ai/dsh-client-ui-layout/src/client/stores.ts'
import {
  DETAILS_DEFAULT, DETAILS_MAX, DETAILS_MIN,
  SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN,
} from '@deepseek-ai/dsh-client-ui-layout/src/client/columns.ts'

const PERSIST_KEY = 'dsh.layout.panels'

beforeEach(() => { localStorage.clear() })

describe('createLayoutStore', () => {
  it('initializes on the feed level, sidebar at its default width, details closed, wide viewport assumed', () => {
    const { store } = createLayoutStore().create()
    expect(store.getSnapshot()).toEqual({
      sidebar: SIDEBAR_DEFAULT, details: 0, narrow: false, narrowExpanded: false,
      viewMode: 'conversation', sessionView: 'feed', feedExpanded: false,
    })
  })

  it('each create() is an independent instance (factory is not a singleton)', () => {
    const a = createLayoutStore().create()
    const b = createLayoutStore().create()
    a.actions.setSidebar(400)
    expect(b.store.getSnapshot().sidebar).toBe(SIDEBAR_DEFAULT)
  })

  it('setSidebar/setDetails clamp into the contract ranges', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setSidebar(1)
    expect(store.getSnapshot().sidebar).toBe(SIDEBAR_MIN)
    actions.setSidebar(9999)
    expect(store.getSnapshot().sidebar).toBe(SIDEBAR_MAX)
    actions.setDetails(1)
    expect(store.getSnapshot().details).toBe(DETAILS_MIN)
    actions.setDetails(9999)
    expect(store.getSnapshot().details).toBe(DETAILS_MAX)
  })

  it('toggleSidebar flips closed <-> contract default on the entered level (drag width forgotten)', () => {
    const { store, actions } = createLayoutStore().create()
    actions.enterSession()
    actions.setSidebar(400)
    actions.toggleSidebar()
    expect(store.getSnapshot().sidebar).toBe(0)
    actions.toggleSidebar()
    expect(store.getSnapshot().sidebar).toBe(SIDEBAR_DEFAULT)
  })

  it('feed toggleSidebar flips only the feed expansion override; the width preference survives', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setSidebar(400)
    actions.toggleSidebar()
    expect(store.getSnapshot()).toMatchObject({ sessionView: 'feed', feedExpanded: true, sidebar: 400 })
    actions.toggleSidebar()
    expect(store.getSnapshot().feedExpanded).toBe(false)
    expect(store.getSnapshot().sidebar).toBe(400)
  })

  it('enterSession moves to the entered level and drops the feed expansion; exitToFeed returns', () => {
    const { store, actions } = createLayoutStore().create()
    actions.toggleSidebar()
    expect(store.getSnapshot().feedExpanded).toBe(true)
    actions.enterSession()
    expect(store.getSnapshot()).toMatchObject({ sessionView: 'entered', feedExpanded: false })
    actions.exitToFeed()
    expect(store.getSnapshot().sessionView).toBe('feed')
  })

  it('narrow toggleSidebar flips only the re-expand override; the width preference survives', () => {
    const { store, actions } = createLayoutStore().create()
    actions.enterSession()
    actions.setSidebar(400)
    actions.setNarrow(true)
    actions.toggleSidebar()
    // Entry opened the workbench rail; the narrow override leaves it open
    // (the frame's narrow solve concedes the track, not the store).
    expect(store.getSnapshot()).toEqual({
      sidebar: 400, details: DETAILS_DEFAULT, narrow: true, narrowExpanded: true,
      viewMode: 'conversation', sessionView: 'entered', feedExpanded: false,
    })
    actions.toggleSidebar()
    expect(store.getSnapshot().narrowExpanded).toBe(false)
    expect(store.getSnapshot().sidebar).toBe(400)
  })

  it('crossing the breakpoint drops the override; a same-value setNarrow keeps it', () => {
    const { store, actions } = createLayoutStore().create()
    actions.enterSession()
    actions.setNarrow(true)
    actions.toggleSidebar()
    expect(store.getSnapshot().narrowExpanded).toBe(true)
    actions.setNarrow(true)
    expect(store.getSnapshot().narrowExpanded).toBe(true)
    actions.setNarrow(false)
    expect(store.getSnapshot()).toMatchObject({ narrow: false, narrowExpanded: false })
    actions.setNarrow(true)
    expect(store.getSnapshot().narrowExpanded).toBe(false)
  })

  it('openDetails uses the contract default, preserves an open width, and closeDetails zeroes', () => {
    const { store, actions } = createLayoutStore().create()
    actions.openDetails()
    expect(store.getSnapshot().details).toBe(DETAILS_DEFAULT)
    actions.setDetails(500)
    actions.openDetails()
    expect(store.getSnapshot().details).toBe(500)
    actions.closeDetails()
    expect(store.getSnapshot().details).toBe(0)
  })

  it('does not persist panel geometry', () => {
    const first = createLayoutStore().create()
    first.actions.setSidebar(400)
    first.actions.openDetails()
    first.actions.setDetails(500)
    expect(localStorage.getItem(PERSIST_KEY)).toBeNull()

    const second = createLayoutStore().create()
    expect(second.store.getSnapshot()).toEqual({
      sidebar: SIDEBAR_DEFAULT,
      details: 0,
      narrow: false,
      narrowExpanded: false,
      viewMode: 'conversation',
      sessionView: 'feed',
      feedExpanded: false,
    })
  })

  it('setViewMode switches the center surface in place', () => {
    const { store, actions } = createLayoutStore().create()
    expect(store.getSnapshot().viewMode).toBe('conversation')
    actions.setViewMode('workbench')
    expect(store.getSnapshot().viewMode).toBe('workbench')
    actions.setViewMode('conversation')
    expect(store.getSnapshot().viewMode).toBe('conversation')
  })

  it('entry arms the workbench rail; the workbench view closes it, conversation restores it', () => {
    const { store, actions } = createLayoutStore().create()
    actions.enterSession()
    expect(store.getSnapshot().details).toBe(DETAILS_DEFAULT)
    // The workbench view is its own full center surface: its rail would
    // duplicate the console, so switching there closes it.
    actions.setViewMode('workbench')
    expect(store.getSnapshot().details).toBe(0)
    // Returning to the conversation at the entered level restores the rail.
    actions.setViewMode('conversation')
    expect(store.getSnapshot().details).toBe(DETAILS_DEFAULT)
    // At the feed level the mode switch leaves the stored width alone: the
    // frame's feed solve drops the track, and entry re-arms it on return.
    actions.exitToFeed()
    actions.setViewMode('conversation')
    expect(store.getSnapshot().details).toBe(DETAILS_DEFAULT)
  })
})
