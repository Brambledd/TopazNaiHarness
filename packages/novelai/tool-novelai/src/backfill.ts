/**
 * One-shot cold backfill for the session-list cover column: fold persisted
 * Sessions whose cached `novelai/latestImage` cell is missing so the list can
 * serve a generated cover without waiting for the Session to become resident.
 * The projection-cache row written here is the same write-behind checkpoint a
 * resident turn would produce, so later boots skip the fold.
 * @module @deepseek-ai/dsh-tool-novelai/backfill
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-projection-cache'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from './projection.ts'

/**
 * Fold every cold Session whose cached cover cell is absent, bounded by the
 * deployment's `coverBackfillSessions` budget and the newest-first catalog
 * order. Resident Sessions are skipped (their snapshots come from memory and
 * the mandatory cache points already checkpoint them); Sessions whose cached
 * row already carries the key — including `null`, meaning no generation yet —
 * are skipped without a log read. The whole pass is fail-soft: any failure
 * logs and leaves the remaining covers on default art until their next
 * activity, never blocking startup.
 * @param ctx - Host context carrying Session, query, and projection-cache services.
 * @param maxSessions - maximum cold Sessions to fold; `0` disables the pass.
 */
export async function backfillLatestImageCovers(ctx: Context, maxSessions: number): Promise<void> {
  try {
    const query = ctx.get('sessionQuery')
    const cache = ctx.get('sessionProjectionCache')
    // Strict store reads: this helper runs on an inject-scoped context whose
    // plugin face deliberately declares none of these services.
    const sessions = ctx.get('sessions')
    if (query === undefined || cache === undefined) return
    for (const record of await query.listSessions(undefined)) {
      if (maxSessions <= 0) return
      const header = record.header
      if (header.cwd === undefined) continue
      if (sessions?.get(header.id) !== undefined) continue
      if (cache.cachedSnapshot(header)?.values['novelai/latestImage'] !== undefined) continue
      try {
        using observation = await query.observeSession(header.id, { projectionMode: 'none' })
        // The Session may have attached while the cold source was prepared; its
        // resident lifecycle owns the next checkpoint instead of this pass.
        if (sessions?.get(header.id) !== undefined) continue
        cache.coldSnapshot(observation.header, observation.events)
        maxSessions -= 1
      } catch (error: unknown) {
        ctx.logger.warn(`tool-novelai: cover backfill fold for "${header.id}" failed: ${String(error)}`)
      }
    }
  } catch (error: unknown) {
    ctx.logger.warn(`tool-novelai: cover backfill pass failed: ${String(error)}`)
  }
}
