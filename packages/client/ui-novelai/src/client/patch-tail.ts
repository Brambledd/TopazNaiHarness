/**
 * Turn-scoped NovelAI prompt-patch accumulator: collects the turn's
 * `novelai_prompt_patch` call arguments so the closing assistant message can
 * render apply cards outside the collapsed tool-process fold.
 */
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'

/** One proposed patch published against its call. */
export interface TurnPatch {
  readonly seq: number
  readonly callId: string
  readonly argsRaw: string
}

/** Immutable patch-proposal facts published against one Turn. */
export interface NovelaiPatchesTurnData {
  readonly patches: readonly TurnPatch[]
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationTurnDataMap {
    /** NovelAI prompt patches proposed in this Turn. */
    'novelai-patches': NovelaiPatchesTurnData
  }
}

interface TurnPatchesState extends NovelaiPatchesTurnData {
  readonly turn: number
}

/**
 * Claim the turn-tail chain when the closing turn proposed prompt patches.
 * @param owner - Turn-tail owner currency for the closing assistant.
 * @returns The turn's patch proposals, or null to decline.
 */
export function selectTurnPatches(owner: TurnTailOwnerProps): readonly TurnPatch[] | null {
  const data = owner.turn.data.get('novelai-patches')
  if (data === undefined) return null
  const patches = data.patches.filter(patch => patch.seq <= owner.seq)
  return patches.length === 0 ? null : patches
}

/** Turn-local NovelAI patch accumulator; it publishes no view Node. */
export const turnPatchesDefinition: ConversationNodeDefinition<TurnPatchesState> = {
  kind: 'novelai-patches',
  match: (event) => {
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    if (event.type === 'tool/call') return { id: String(event.data.turn), role: 'update' }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'turn/start') throw new Error('novelai-patches start requires turn/start')
    return { turn: match.event.data.turn, patches: [] }
  },
  update: (context, match) => {
    if (match.event.type !== 'tool/call') return context.state
    if (match.event.data.name !== 'novelai_prompt_patch') return context.state
    const patch: TurnPatch = {
      seq: match.event.seq,
      callId: String(match.event.data.callId),
      argsRaw: String(match.event.data.arguments ?? ''),
    }
    return { ...context.state, patches: [...context.state.patches, patch] }
  },
  buildLocationData: (context, scope) => scope !== 'turn' || context.state === undefined
    ? null
    : {
      kind: 'turn',
      turn: context.state.turn,
      key: 'novelai-patches',
      value: { patches: context.state.patches },
    },
}
