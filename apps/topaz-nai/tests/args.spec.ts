import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PROFILE, parseTopazNaiArgs } from '../src/args.ts'

/** One argv line through the parser; help and errors exit inside it. */
function parse(...argv: readonly string[]): ReturnType<typeof parseTopazNaiArgs> {
  return parseTopazNaiArgs(argv, '0.0.0-test')
}

/** Capture the process exit code while muting Commander's output. */
function exitCode(argv: string[]): number {
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit') })
  vi.spyOn(process.stdout, 'write').mockReturnValue(true)
  vi.spyOn(process.stderr, 'write').mockReturnValue(true)
  try {
    parse(...argv)
    throw new Error(`expected ${JSON.stringify(argv)} to exit`)
  } catch (error) {
    if ((error as Error).message !== 'exit') throw error
  } finally {
    vi.restoreAllMocks()
  }
  return exit.mock.calls.at(-1)?.[0] as number
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('parseTopazNaiArgs', () => {
  it('defaults a bare boot to the topaz profile and forwards inner arguments', () => {
    expect(parse()).toEqual({
      mode: 'profile', profile: DEFAULT_PROFILE, patchFiles: [], args: [],
    })
    expect(parse('--port', '4000', '--no-open')).toEqual({
      mode: 'profile', profile: DEFAULT_PROFILE, patchFiles: [], args: ['--port', '4000', '--no-open'],
    })
  })

  it('honors an explicit profile and repeatable patch overlays', () => {
    expect(parse('--profile', 'topaz', '--patch', 'a.yml', '--patch', 'b.yml')).toEqual({
      mode: 'profile', profile: 'topaz', patchFiles: ['a.yml', 'b.yml'], args: [],
    })
  })

  it('aliases web to the web profile and keeps unknown options as inner arguments', () => {
    expect(parse('web', '--port', '3410')).toEqual({
      mode: 'profile', profile: 'web', patchFiles: [], args: ['--port', '3410'],
    })
  })

  it('resolves the dump modes', () => {
    expect(parse('--dump-config')).toEqual({ mode: 'dump-config', profile: DEFAULT_PROFILE, defaultOnly: false, patches: [] })
    expect(parse('web', '--dump-default-config')).toEqual({ mode: 'dump-config', profile: 'web', defaultOnly: true, patches: [] })
  })

  it('forwards plugin invocations verbatim', () => {
    expect(parse('plugin', '--profile', 'topaz', 'add', './my-plugin')).toEqual({
      mode: 'plugin', profile: 'topaz', args: ['add', './my-plugin'],
    })
  })

  it('prints the launcher help for a bare -h and exits zero for --version', () => {
    expect(exitCode(['-h'])).toBe(0)
    expect(exitCode(['--version'])).toBe(0)
  })

  it('rejects config dumps that carry app arguments or overlays', () => {
    expect(exitCode(['--dump-config', '--port', '1'])).toBe(1)
    expect(exitCode(['--dump-default-config', '--patch', 'a.yml'])).toBe(1)
    expect(exitCode(['web', '--dump-config', '--dump-default-config'])).toBe(1)
  })

  it('rejects parent flags before subcommands and empty plugin forwards', () => {
    expect(exitCode(['--profile', 'x', 'web'])).toBe(1)
    expect(exitCode(['--patch', 'p.yml', 'plugin', 'add', 'y'])).toBe(1)
    expect(exitCode(['plugin', '--profile', 'topaz'])).toBe(1)
    expect(exitCode(['plugin', '--profile', ''])).toBe(1)
  })

  it('rejects a blank profile name and a blank patch path', () => {
    expect(exitCode(['--profile', ''])).toBe(1)
    expect(exitCode(['--patch='])).toBe(1)
  })
})
