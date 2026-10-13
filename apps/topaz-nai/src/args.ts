/**
 * `topaz-nai` command grammar: the launcher flags end at the first unknown
 * token; everything after belongs to the booted profile's app.
 * The default profile is `topaz` in the instance home
 * (`~/.topaz-nai-harness`, overridable by `DSH_HOME`).
 * and `topaz-nai -h` prints this launcher's help, not the web app's.
 * `web` is a hardcoded alias for `--profile web`; `plugin` manages a profile's
 * plugins through pnpm.
 */

import { Command, CommanderError } from 'commander'

/** Boot flags shared by the default command and the `web` alias. */
interface BootOptions {
  patch?: string[]
  dumpConfig?: boolean
  dumpDefaultConfig?: boolean
}

/**
 * Repeatable single-value collector: `--patch a.yml --patch b.yml`. Never
 * variadic — a variadic `--patch` would swallow the inner arguments.
 */
const collect = (value: string, previous: string[] = []): string[] => [...previous, value]

/** The profile a bare `topaz-nai` boots when `--profile` is absent. */
export const DEFAULT_PROFILE = 'topaz'

/** The launcher's own help text; the booted app prints its own. */
const HELP_EXAMPLES = `
Examples:
  topaz-nai                                  boot the default profile (same as: topaz-nai --profile topaz)
  topaz-nai web                              boot the web profile (alias of --profile web)
  topaz-nai --profile topaz --patch ./x.yml  boot a profile with one extra overlay
  topaz-nai --profile topaz -h               the web app's own flags and help
  topaz-nai plugin --profile topaz add <pkg> install a plugin into the topaz profile
`

/** One resolved `topaz-nai` invocation. Help, version, and errors exit inside {@link parseTopazNaiArgs}. */
export type TopazNaiInvocation = ProfileInvocation | DumpConfigInvocation | PluginInvocation

interface ProfileInvocation {
  mode: 'profile'
  profile: string
  patchFiles: readonly string[]
  /** Raw inner arguments, verbatim. */
  args: string[]
}

interface DumpConfigInvocation {
  mode: 'dump-config'
  profile: string
  defaultOnly: boolean
  patches: readonly string[]
}

interface PluginInvocation {
  mode: 'plugin'
  profile: string
  /** Raw pnpm arguments, verbatim. */
  args: string[]
}

/**
 * Resolve a boot or dump invocation from the launcher flags and the leftover
 * inner arguments.
 * @param program - the command whose options were parsed (the root, or the `web` alias).
 * @param profile - the profile these flags boot.
 * @param options - the launcher flags commander collected.
 * @param args - the leftover arguments, in argv order.
 * @returns the resolved invocation.
 */
function resolveBoot(program: Command, profile: string, options: BootOptions, args: string[]): TopazNaiInvocation {
  const patches = options.patch ?? []
  if (patches.includes('')) program.error('error: --patch needs a path')
  if (options.dumpConfig !== true && options.dumpDefaultConfig !== true) {
    return { mode: 'profile', profile, patchFiles: patches, args }
  }
  if (options.dumpConfig === true && options.dumpDefaultConfig === true) {
    program.error('error: --dump-config and --dump-default-config are mutually exclusive')
  }
  // The dump is boot-free: it never runs app command-line providers, so it
  // cannot show what those flags would decide, and printing a tree that differs
  // from the same invocation's boot would mislead.
  if (args.length > 0) {
    program.error(`error: config dumps take no app arguments, got ${args.map(argument => JSON.stringify(argument)).join(' ')}`)
  }
  const defaultOnly = options.dumpDefaultConfig === true
  if (defaultOnly && patches.length > 0) {
    program.error('error: --dump-default-config prints the bundle layers and takes no --patch')
  }
  return { mode: 'dump-config', profile, defaultOnly, patches }
}

/**
 * Resolve argv into one invocation, or print and exit for help, version, or an
 * error. Unlike `dsh`, a missing `--profile` defaults to {@link DEFAULT_PROFILE}
 * instead of erroring: the instance exists to boot one profile.
 * @param argv - arguments after the Node binary and script.
 * @param version - version string printed by `--version`.
 * @returns the resolved invocation.
 */
export function parseTopazNaiArgs(argv: readonly string[], version: string): TopazNaiInvocation {
  let resolved: TopazNaiInvocation | undefined
  // Annotated, not inferred: the actions below call back into `program`, and an
  // inferred type would be circular through its own chain.
  const program: Command = new Command()
  program
    .name('topaz-nai')
    .version(version, '-V, --version', 'output the version number')
    .description('topaz-nai: boot the TopazNaiHarness profile stack — an ordered stack of plugin-bundle patch layers in the dedicated instance home.')
    .addHelpText('after', HELP_EXAMPLES)
    .exitOverride()
    // The launcher's flags come first and end at the first token it does not
    // know; everything from there on belongs to the booted app, including
    // its -h. A bare `-h` (nothing to forward it to) prints this help, below.
    .helpOption(false)
    .allowUnknownOption()
    .passThroughOptions()
    .enablePositionalOptions()
    .argument('[args...]', 'arguments for the booted profile\'s app (see: topaz-nai --profile topaz --help)')
    .option('--profile <name>', `the profile under the instance home to boot (default: ${DEFAULT_PROFILE})`)
    .option('--patch <path>', 'extra patch-list overlay applied after the profile layer (repeatable)', collect)
    .option('--dump-config', 'print the composed profile tree and exit')
    .option('--dump-default-config', 'print the profile tree without its user layer or --patch overlays and exit')
    .action((args: string[], options: BootOptions & { profile?: string }) => {
      // With the app owning -h, the launcher's own help is what a bare
      // `topaz-nai -h` (nothing to hand it to) must print.
      if (args.some(argument => argument === '-h' || argument === '--help')) program.help()
      const profile = options.profile ?? DEFAULT_PROFILE
      if (profile === '') program.error('error: --profile needs a name')
      resolved = resolveBoot(program, profile, options, args)
    })

  /** Reject parent options supplied before a subcommand. */
  const rejectParentOptions = (command: string): void => {
    const parent = program.opts<BootOptions & { profile?: string }>()
    if (parent.profile !== undefined || parent.patch !== undefined
      || parent.dumpConfig !== undefined || parent.dumpDefaultConfig !== undefined) {
      program.error(`error: ${command} takes none of parent --profile, --patch, --dump-config, or --dump-default-config`)
    }
  }

  const web = program.command('web').description('boot the web profile (alias of --profile web); the web app\'s own flags follow')
  web
    .helpOption(false)
    .allowUnknownOption()
    .passThroughOptions()
    .enablePositionalOptions()
    .argument('[args...]', 'arguments for the web app (see: topaz-nai web --help)')
    .option('--patch <path>', 'extra patch-list overlay applied after the profile layer (repeatable)', collect)
    .option('--dump-config', 'print the composed web-profile tree (with the user layer and any --patch) and exit')
    .option('--dump-default-config', 'print the web profile\'s bundle layers (no user layer) and exit')
    .action((args: string[], options: BootOptions) => {
      rejectParentOptions('web')
      resolved = resolveBoot(web, 'web', options, args)
    })

  const plugin = program.command('plugin').description('manage a profile\'s plugins by forwarding the remaining arguments to pnpm in the profile directory')
  plugin
    .requiredOption('--profile <name>', 'the profile whose plugins to manage (initialized on first use)')
    .allowUnknownOption()
    .argument('[args...]', 'pnpm arguments, forwarded verbatim (add <pkg>, remove <pkg>, why <pkg>, ...)')
    .action((args: string[], options: { profile: string }) => {
      rejectParentOptions('plugin')
      if (options.profile === '') program.error('error: --profile needs a name')
      if (args.length === 0) program.error('error: plugin needs pnpm arguments to forward (e.g. add <package>)')
      resolved = { mode: 'plugin', profile: options.profile, args }
    })

  try {
    program.parse(argv, { from: 'user' })
  } catch (error) {
    return process.exit(error instanceof CommanderError ? error.exitCode : 1)
  }
  /* v8 ignore next -- an action resolves or Commander throws */
  if (resolved === undefined) throw new Error('topaz-nai: no invocation resolved')
  return resolved
}
