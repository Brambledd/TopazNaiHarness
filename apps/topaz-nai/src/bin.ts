#!/usr/bin/env node
/**
 * Command-line entry for topaz-nai.
 * @module @deepseek-ai/topaz-nai/bin
 */

/* v8 ignore file -- built-bin acceptance exercises this self-executing dispatch. */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import { parseTopazNaiArgs } from './args.ts'

/**
 * Default instance home for the TopazNaiHarness identity. Must run before any
 * profile boot resolves a home: every subsystem (sessions, attachments,
 * credentials, settings, skills, the profile heal cache) resolves its root
 * through `$DSH_HOME` at call time, so pinning the variable here gives the
 * whole process tree the dedicated home without touching the shared
 * `@deepseek-ai/dsh-home-paths` default. An explicit `DSH_HOME` (the launcher
 * sets one) always wins; a blank value counts as unset, matching
 * {@link resolveDshHome} semantics.
 */
function ensureInstanceHome(): void {
  const current = process.env.DSH_HOME
  if (current !== undefined && current.trim() !== '') return
  process.env.DSH_HOME = join(homedir(), '.topaz-nai-harness')
}

// Both the source tree (apps/topaz-nai/src) and the bundled bin
// (apps/topaz-nai/lib) sit one directory under apps/topaz-nai, so the
// checked-in manifest resolves with the same relative hop from either artifact.
function readVersion(): string {
  const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
  ) as { version?: unknown }
  return typeof manifest.version === 'string' ? manifest.version : '0.0.0'
}

ensureInstanceHome()

const invocation = parseTopazNaiArgs(process.argv.slice(2), readVersion())

switch (invocation.mode) {
  case 'profile': {
    const { runProfile } = await import('./profile-boot.ts')
    await runProfile({
      environment: loadLayeredEnv('topaz-nai'),
      profile: invocation.profile,
      patchFiles: invocation.patchFiles,
      args: invocation.args,
    })
    break
  }
  case 'plugin': {
    const { runPlugin } = await import('./plugin.ts')
    process.exit(runPlugin(invocation.profile, invocation.args))
    break
  }
  case 'dump-config': {
    const { runDumpConfig } = await import('./dump-config.ts')
    runDumpConfig(invocation.profile, invocation.defaultOnly, invocation.patches)
    break
  }
  default:
    invocation satisfies never
    throw new Error(`topaz-nai: unhandled invocation mode ${JSON.stringify(invocation)}`)
}
