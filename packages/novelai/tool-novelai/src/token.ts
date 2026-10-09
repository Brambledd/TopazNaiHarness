/**
 * Token resolution for the generation tool: one home for the
 * config → credential → environment order and its failure diagnostics.
 * @module @deepseek-ai/dsh-tool-novelai/token
 */

import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'

/** The credential reference the generation tool authenticates with. */
export const NOVELAI_TOKEN_REF = 'NOVELAI_TOKEN'

/** The deployment config slice token resolution reads. */
export interface TokenConfig {
  /** Explicit persistent API token from the plugin config; empty defers to the credential. */
  token: string
}

/**
 * Resolve the authenticating token for one generation: the explicit plugin
 * config wins, then the `NOVELAI_TOKEN` credential (credential store layered
 * over `.env` files and the process environment), then the bare process
 * environment when no credential provider is mounted. Resolution runs per
 * call, so a token saved from the settings surface reaches the next call
 * without a plugin restart.
 * @param config - deployment configuration.
 * @param credentials - the optional credential provider, absent in
 *   compositions without one.
 * @returns the non-empty token.
 * @throws Error when every layer is empty.
 */
export async function resolveToken(config: TokenConfig, credentials: CredentialProvider | undefined): Promise<string> {
  if (config.token !== '') return config.token
  const resolved = await credentials?.resolve(credentialRef(NOVELAI_TOKEN_REF))
  const token = resolved?.value ?? process.env[NOVELAI_TOKEN_REF] ?? ''
  if (token === '') {
    throw new Error(
      'NovelAI token missing: save it in Settings → General (NovelAI API token), or set the plugin config '
      + `\`token\` or the ${NOVELAI_TOKEN_REF} credential/environment variable`,
    )
  }
  return token
}
