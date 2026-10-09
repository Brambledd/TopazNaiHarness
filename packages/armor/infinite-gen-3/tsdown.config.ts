import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle(
  '@deepseek-ai/dsh-infinite-gen-3',
  ['lib/types/index.js', 'lib/types/invariant.js'],
  { hostPhase: true },
)
