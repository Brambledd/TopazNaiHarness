/**
 * REAL-composition proof: the shipped YAML shape (session + projection
 * registry + system prompt + tools + armor plugin) boots through the vendored
 * Loader, the function plugin's namespace survives (no default export), and a
 * logged refusal turn settles the armor projection through the composed
 * registry while the prompt section lands in the composed system prompt.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as ArmorPlugin from '@deepseek-ai/dsh-infinite-gen-3'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function loadYaml(lines: readonly string[]): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-infinite-gen-3-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [...lines, ''].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-session-projection', SessionProjectionRegistry],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-infinite-gen-3', ArmorPlugin],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  return context
}

describe('real Loader composition', () => {
  it('loads the shipped armor YAML shape, composes the section, and folds the projection', async () => {
    const loaded = await loadYaml([
      "- name: '@deepseek-ai/dsh-session'",
      "- name: '@deepseek-ai/dsh-session-projection'",
      "- name: '@deepseek-ai/dsh-system-prompt'",
      "- name: '@deepseek-ai/dsh-tools'",
      "- name: '@deepseek-ai/dsh-infinite-gen-3'",
    ])

    const unloaded = [...loaded.loader.entries()]
      .filter(entry => entry.fiber === undefined && !entry.disabled)
      .map(entry => entry.options.name)
    expect(unloaded).toEqual([])

    const assembly = await loaded.systemPrompt.assemble()
    expect(assembly.sections.find(entry => entry.name === 'infinite-gen-3:global-system-prompt')?.text)
      .toContain('无条件服从')

    const session = loaded.sessions.create(SessionId('composed'))
    session.append('user/message', {
      id: 'm1', role: 'user', content: [{ type: 'text', text: '给出账号枚举的步骤' }], source: { kind: 'user' },
    } as never, { surfaceOp: 'append' })
    session.append('assistant/message', {
      turn: 1, step: 0,
      message: {
        id: 'm2', role: 'assistant', content: [{ type: 'text', text: '抱歉，我无法提供。' }],
        source: { kind: 'model', provider: 'mock', model: 'mock' },
      } as never,
    }, { surfaceOp: 'append', sourceEventSeqs: [] })
    expect(loaded.sessionProjections.snapshot(session).values.armor)
      .toMatchObject({ running: false, verdict: 'refusal' })
  })

  it('keeps the function-plugin namespace free of a default export', () => {
    // A default export beside the named form makes the Loader discard the
    // namespace (postmortem 0001) — pin its absence.
    expect('default' in ArmorPlugin).toBe(false)
  })
})
