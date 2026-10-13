import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { clientBundle } from '../../client/tsdown.client.ts'

/**
 * The tsc-emitted client channel publishes real runtime JS, so the stylesheet
 * `ArmorBadge.js` imports must ship beside it in `lib/types/client/`. tsc never
 * copies non-TS assets; this rides every tsdown face build (which always runs
 * after the aggregate `tsc -b` in the repository build).
 */
function copyEmittedClientAssets(): void {
  const destination = resolve(import.meta.dirname, 'lib/types/client/armor-badge.module.css')
  mkdirSync(dirname(destination), { recursive: true })
  copyFileSync(resolve(import.meta.dirname, 'src/client/armor-badge.module.css'), destination)
}

const base = clientBundle(
  '@deepseek-ai/dsh-infinite-gen-3',
  ['lib/types/index.js', 'lib/types/invariant.js'],
  { hostPhase: true },
)

export default ({ env }: { env?: Record<string, string> }) => {
  const selected = base({ env })
  const configs = Array.isArray(selected) ? selected : [selected]
  return configs.map((config) => ({
    ...config,
    onSuccess: copyEmittedClientAssets,
  }))
}
