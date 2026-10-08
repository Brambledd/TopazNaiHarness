/**
 * HTTP client for the NovelAI image API, with optional proxy dispatch.
 * @module @deepseek-ai/dsh-tool-novelai/client
 */

import { ProxyAgent, fetch, type Dispatcher, type Response } from 'undici'
import type { NovelaiWirePayload } from './types.ts'
import { extractImages } from './unzip.ts'

/** Where an unresolved proxy URL comes from, named for the error message. */
const PROXY_ENV_VARS = ['NOVELAI_PROXY', 'HTTPS_PROXY', 'https_proxy'] as const

/**
 * Read the first proxy environment variable that is set.
 * @returns the proxy URL, or `undefined` when none is set.
 */
export function proxyFromEnvironment(): string | undefined {
  for (const name of PROXY_ENV_VARS) {
    const value = process.env[name]
    if (value && value.trim() !== '') return value.trim()
  }
  return undefined
}

/**
 * Resolve the effective proxy URL: explicit config first, environment second.
 * @param configUrl - the plugin config `proxyUrl`, empty when unset.
 * @returns the proxy URL to dispatch through, or `undefined` for a direct connection.
 */
export function resolveProxyUrl(configUrl: string): string | undefined {
  if (configUrl.trim() !== '') return configUrl.trim()
  return proxyFromEnvironment()
}

/**
 * Submit one paid text-to-image request and extract the returned images.
 *
 * A network-level failure (connection refused, unreachable host, TLS handshake failure)
 * is reported with the proxy guidance, because the API host is unreachable from some
 * networks without a proxy and a bare `fetch failed` hides that.
 * @param options - payload, credentials, endpoint, timeout, cancellation, and proxy dispatch.
 * @returns one buffer per generated image, in archive order.
 * @throws when the request cannot reach the API or the API rejects it; never retries.
 */
export async function requestGeneration(options: {
  payload: NovelaiWirePayload
  token: string
  baseUrl: string
  timeoutMs: number
  signal: AbortSignal
  proxyUrl: string | undefined
}): Promise<Buffer[]> {
  const proxyUrl = options.proxyUrl?.trim() ?? ''
  const dispatcher: Dispatcher | undefined = proxyUrl === '' ? undefined : new ProxyAgent(proxyUrl)
  let response: Response
  try {
    response = await fetch(`${options.baseUrl.replace(/\/+$/, '')}/ai/generate-image`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.token}`,
        'Content-Type': 'application/json',
        Accept: 'application/zip, application/octet-stream',
      },
      body: JSON.stringify(options.payload),
      signal: options.signal,
      ...(dispatcher === undefined ? {} : { dispatcher }),
    })
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error)
    const proxyHint = dispatcher === undefined
      ? 'No proxy is configured: set the plugin config `proxyUrl` or one of the environment variables '
        + PROXY_ENV_VARS.join(', ')
        + ' and restart the profile.'
      : `The configured proxy ${proxyUrl} did not carry the request.`
    throw new Error(
      `NovelAI request never reached the API (${cause}). ${proxyHint}`,
      { cause: error },
    )
  }
  if (!response.ok) {
    // Never auto-retry a failed paid submission: the server may have charged for the image.
    throw new Error(`NovelAI generation failed: HTTP ${response.status} ${response.statusText}`)
  }
  return extractImages(new Uint8Array(await response.arrayBuffer()))
}
