// @vitest-environment jsdom
/**
 * FeedWall spec: the shell.feed occupant derives the flat newest-first node
 * list and wires card activation to the injected `open` (whose apply-site
 * closure enters the session level). Uses the four-share props form with a
 * real useSessions snapshot and a stubbed pending-interaction hook; card
 * internals are Rows.tsx spec territory — this suite pins the wall's
 * composition (ordering, blank-row exclusion, current highlight, callbacks).
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import { FeedWall } from '@deepseek-ai/dsh-client-ui-workspace/src/client/rows/FeedWall.tsx'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

function summary(id: string, updatedAt: number, overrides: Partial<SessionListState['byId'][SessionId]> = {}): SessionListState['byId'][SessionId] {
  return {
    id: id as SessionId,
    displayTitle: id,
    running: false,
    completed: false,
    blank: false,
    updatedAt,
    ...overrides,
  }
}

function hookOf<T>(snapshot: T) {
  return ((selector: (s: T) => unknown) => selector(snapshot)) as never
}

function mountFeed(summaries: SessionListState['byId'][SessionId][], current: SessionId | undefined) {
  const list = {
    ids: summaries.map(s => s.id),
    byId: Object.fromEntries(summaries.map(s => [s.id, s])),
    current,
    phase: 'ready',
  } as unknown as SessionListState
  const attention = new Map()
  const workspaces: WorkspaceSnapshot = {
    items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
  }
  const open = vi.fn()
  const renderResult = render(<FeedWall
    useSessions={hookOf(list)}
    useSessionPendingInteraction={hookOf(attention)}
    useWorkspaces={hookOf(workspaces)}
    open={open}
    forkSession={vi.fn()}
    renameSession={vi.fn()}
    archiveSession={vi.fn()}
    coverCache={{ acquire: vi.fn(async () => undefined), release: vi.fn(), dispose: vi.fn() }}
    t={(key: string) => key}
  />)
  return { open, ...renderResult }
}

describe('FeedWall', () => {
  it('renders one card per visible session, newest first, with the current card highlighted', () => {
    const { container } = mountFeed(
      [summary('old', 1), summary('new', 2), summary('provisional', 3, { blank: true })],
      'new' as SessionId,
    )
    const cards = [...container.querySelectorAll('[class*="sessionRow"]')]
    expect(cards).toHaveLength(2) // the blank provisional row never renders on the wall
    expect(cards[0]!.className).toContain('selected')
  })

  it('card activation calls the injected open (the apply site enters the session level)', () => {
    const { container, open } = mountFeed([summary('a', 1), summary('b', 2)], undefined)
    const cards = [...container.querySelectorAll('[class*="sessionRow"]')]
    expect(cards).toHaveLength(2)
    fireEvent.click(cards[1]!)
    expect(open).toHaveBeenCalledWith('a')
  })

  it('renders the empty state with the locale key when no session is visible', () => {
    const { container } = mountFeed([], undefined)
    expect(container.querySelector('[class*="empty"]')?.textContent).toBe('empty.none')
    expect(container.querySelectorAll('[class*="sessionRow"]')).toHaveLength(0)
  })
})
