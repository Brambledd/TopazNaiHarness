/**
 * Host composition of the session-list cover column: the projection unit
 * registers through the service-availability inject even when
 * `sessionProjections` materializes after this plugin's own dependencies, and
 * the cold backfill folds persisted Sessions whose cached cover cell is
 * missing while skipping resident Sessions and Sessions already carrying the
 * key (`null` included), writing each fold back to the projection cache.
 */

import { describe, expect, it, vi } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-projection'
import SessionProjectionCache from '@deepseek-ai/dsh-session-projection-cache'
import type { SessionObservation } from '@deepseek-ai/dsh-session-query'
import Storage from '@deepseek-ai/dsh-storage'
import {
  apply as storageJsonApply, Config as storageJsonConfig, inject as storageJsonInject, name as storageJsonName,
} from '@deepseek-ai/dsh-storage-json'
import {
  apply as storageDomainApply, Config as storageDomainConfig, inject as storageDomainInject, name as storageDomainName,
} from '@deepseek-ai/dsh-storage-domain'
import * as novelai from '../src/index.ts'
import { backfillLatestImageCovers } from '../src/backfill.ts'
import { latestNovelaiImageProjection } from '../src/projection.ts'

const headerOf = (id: string, createdAt: number): SessionHeader =>
  ({ version: 0, id: SessionId(id), createdAt, cwd: '/proj' })

/** The durable shape one real generation leaves: the image block nested in the presented tool-result. */
const imageLog = (callId: string, attachmentId: string): SessionEvent[] => [
  {
    type: 'tool/call', seq: 0, time: 0,
    data: { turn: 1, step: 1, callId, name: 'novelai_generate', arguments: '{}' },
  },
  {
    type: 'tool/result', seq: 1, time: 1, surfaceOp: 'append',
    data: {
      turn: 1, step: 1,
      message: {
        source: { callId },
        content: [{
          type: 'tool-result', toolCallId: callId, isError: false,
          content: [
            { type: 'text', text: 'saved' },
            { type: 'image', attachment: { attachmentId, mediaType: 'image/png', bytes: 10, width: 832, height: 1216 } },
          ],
        }],
      },
    },
  },
] as SessionEvent[]

interface HarnessRecord {
  header: SessionHeader
  events: SessionEvent[]
}

async function bootHarness(): Promise<Context> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-novelai-backfill-'))
  const ctx = new Context()
  await ctx.plugin(Storage)
  await ctx.plugin(
    { name: storageJsonName, inject: storageJsonInject, apply: storageJsonApply, Config: storageJsonConfig },
    { root },
  )
  await ctx.plugin(
    { name: storageDomainName, inject: storageDomainInject, apply: storageDomainApply, Config: storageDomainConfig },
    { backend: 'json' },
  )
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  ctx.sessionProjections.register(latestNovelaiImageProjection)
  await ctx.plugin(SessionProjectionCache, { writeEveryEvents: 100, writeIntervalMs: 60_000 })
  return ctx
}

/** Install a fake corpus: newest-first listing plus prepared observations with the record's exact log. */
function installCorpus(ctx: Context, records: readonly HarnessRecord[]): string[] {
  const observed: string[] = []
  const observation = (record: HarnessRecord): SessionObservation => ({
    source: 'prepared',
    header: record.header,
    events: record.events,
    cursor: record.events.at(-1)?.seq ?? -1,
    retain: () => observation(record),
    [Symbol.dispose]: () => {},
  })
  ctx.provide('sessionQuery', {
    listSessions: async () => records,
    observeSession: async (sessionId: SessionId) => {
      observed.push(String(sessionId))
      const record = records.find(entry => entry.header.id === sessionId)
      if (record === undefined) throw new Error(`unexpected observation: ${String(sessionId)}`)
      return observation(record)
    },
  } as never)
  return observed
}

describe('novelai cover backfill', () => {
  it('folds cold Sessions missing the cover cell and writes the rows back to the cache', async () => {
    const ctx = await bootHarness()
    const blank = headerOf('s-covered', 200)
    await ctx.sessionProjectionCache.coldSnapshot(blank, [])
    const resident = ctx.sessions.create(SessionId('s-resident'))
    void resident
    const records: HarnessRecord[] = [
      { header: headerOf('s-image', 300), events: imageLog('call-1', 'att-img') },
      { header: headerOf('s-cap', 50), events: [] },
    ]
    const observed = installCorpus(ctx, records)

    await backfillLatestImageCovers(ctx, 10)

    // The write-back is fire-and-forget behind the cache's durability chain.
    await vi.waitFor(() => {
      expect(ctx.sessionProjectionCache.cachedSnapshot(headerOf('s-image', 300))?.values['novelai/latestImage'])
        .toMatchObject({ attachmentId: 'att-img', mediaType: 'image/png', width: 832, height: 1216, seq: 1 })
      expect(ctx.sessionProjectionCache.cachedSnapshot(headerOf('s-cap', 50))?.values['novelai/latestImage']).toBeNull()
    })
    // Sessions already carrying the key (null included) and resident Sessions never reach the log.
    expect(observed).toEqual([String(SessionId('s-image')), String(SessionId('s-cap'))])
  })

  it('stops at the session budget while the newest-first order holds', async () => {
    const ctx = await bootHarness()
    const records: HarnessRecord[] = [
      { header: headerOf('s-first', 300), events: imageLog('call-1', 'att-1') },
      { header: headerOf('s-second', 200), events: imageLog('call-1', 'att-2') },
      { header: headerOf('s-third', 100), events: [] },
    ]
    const observed = installCorpus(ctx, records)

    await backfillLatestImageCovers(ctx, 1)

    expect(observed).toEqual([String(SessionId('s-first'))])
    await vi.waitFor(() => {
      expect(ctx.sessionProjectionCache.cachedSnapshot(headerOf('s-first', 300))?.values['novelai/latestImage'])
        .toMatchObject({ attachmentId: 'att-1' })
    })
    expect(ctx.sessionProjectionCache.cachedSnapshot(headerOf('s-second', 200))).toBeUndefined()
  })

  it('registers the projection through the inject even when the service lands after the plugin', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    ctx.provide('tools', { register: () => () => {} } as never)
    await ctx.plugin(novelai, {} as never)
    expect(ctx.get('sessionProjections')).toBeUndefined()

    await ctx.plugin(SessionProjectionRegistry)
    await vi.waitFor(() => {
      const probe = ctx.sessionProjections.hydrate(
        Session.create(SessionId('probe'), [], headerOf('probe', 0)),
        {},
        imageLog('call-1', 'att-late'),
        0,
      )
      expect(probe.values['novelai/latestImage']?.attachmentId).toBe('att-late')
    })
  })
})
