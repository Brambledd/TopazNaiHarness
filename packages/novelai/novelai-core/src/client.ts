/**
 * HTTP client for the NovelAI image API, with optional proxy dispatch.
 * @module @deepseek-ai/dsh-novelai-core/node
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
 * @param configUrl - the configured `proxyUrl`, empty when unset.
 * @returns the proxy URL to dispatch through, or `undefined` for a direct connection.
 */
export function resolveProxyUrl(configUrl: string): string | undefined {
  if (configUrl.trim() !== '') return configUrl.trim()
  return proxyFromEnvironment()
}

/**
 * Download one binary file over GET with proxy dispatch, for on-demand data
 * files (the bilingual Danbooru tag index).
 * @param options - URL, timeout, size cap, and proxy dispatch.
 * @returns the raw bytes.
 * @throws when the request fails, times out, or exceeds `maxBytes`.
 */
export async function requestBinaryDownload(options: {
  url: string
  timeoutMs: number
  maxBytes: number
  proxyUrl: string | undefined
}): Promise<Uint8Array> {
  const proxyUrl = options.proxyUrl?.trim() ?? ''
  const dispatcher: Dispatcher | undefined = proxyUrl === '' ? undefined : new ProxyAgent(proxyUrl)
  let response: Response
  try {
    response = await fetch(options.url, {
      ...(dispatcher === undefined ? {} : { dispatcher }),
      signal: AbortSignal.timeout(options.timeoutMs),
    })
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error)
    throw new Error(`download failed: ${cause}${proxyUrl === '' ? '' : ` (via proxy ${proxyUrl})`}`)
  }
  if (!response.ok) throw new Error(`download failed with HTTP ${String(response.status)}`)
  const buffer = new Uint8Array(await response.arrayBuffer())
  if (buffer.byteLength > options.maxBytes) {
    throw new Error(`download exceeds the ${String(options.maxBytes)}-byte cap`)
  }
  return buffer
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
      ? 'No proxy is configured: set the configured `proxyUrl` or one of the environment variables '
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
    // The response body usually names the actual rejection (server-side 500s and proxy
    // error pages read very differently), so surface a snippet instead of the bare status.
    const detail = await response.text().catch(() => '')
    const snippet = detail.trim().replace(/\s+/g, ' ').slice(0, 300)
    throw new Error(
      `NovelAI generation failed: HTTP ${response.status} ${response.statusText}`
      + (snippet === '' ? '' : ` — ${snippet}`),
    )
  }
  return extractImages(new Uint8Array(await response.arrayBuffer()))
}

/**
 * Read the account's remaining Anlas through the free subscription endpoint.
 * @param options - token, API base URL, timeout, and optional proxy.
 * @returns the total Anlas balance (fixed + purchased training steps); undefined when the account exposes none.
 * @throws when the request cannot reach the API or the token is rejected.
 */
export async function requestAnlasBalance(options: {
  token: string
  baseUrl: string
  timeoutMs: number
  proxyUrl: string | undefined
}): Promise<number | undefined> {
  const proxyUrl = options.proxyUrl?.trim() ?? ''
  const dispatcher: Dispatcher | undefined = proxyUrl === '' ? undefined : new ProxyAgent(proxyUrl)
  const response = await fetch(`${options.baseUrl.replace(/\/+$/, '')}/user/subscription`, {
    headers: { Authorization: `Bearer ${options.token}` },
    signal: AbortSignal.timeout(options.timeoutMs),
    ...(dispatcher === undefined ? {} : { dispatcher }),
  })
  if (!response.ok) {
    throw new Error(`NovelAI subscription read failed: HTTP ${response.status} ${response.statusText}`)
  }
  const body = await response.json() as {
    trainingStepsLeft?: { fixedTrainingStepsLeft?: unknown; purchasedTrainingStepsLeft?: unknown }
  }
  const fixed = body.trainingStepsLeft?.fixedTrainingStepsLeft
  const purchased = body.trainingStepsLeft?.purchasedTrainingStepsLeft
  if (typeof fixed !== 'number' && typeof purchased !== 'number') return undefined
  return (typeof fixed === 'number' ? fixed : 0) + (typeof purchased === 'number' ? purchased : 0)
}

/** One tag suggestion as served by the NovelAI suggest-tags endpoint. */
export interface NovelaiWireTagSuggestion {
  /** English Danbooru tag in underscore form. */
  readonly tag: string
  /** Post count used for ordering. */
  readonly count: number
  /** Danbooru tag category id. */
  readonly category: number
  /** Server-provided description; empty when the endpoint omits it. */
  readonly description?: string
}

/**
 * Query the NovelAI suggest-tags endpoint for one partial prompt word.
 * @param options - partial word, model, credentials, endpoint, timeout, cancellation, and proxy dispatch.
 * @returns ranked suggestions; an unsuccessful or unreachable endpoint resolves to an empty list.
 */
export async function requestTagSuggestions(options: {
  prompt: string
  model: string
  token: string
  baseUrl: string
  timeoutMs: number
  signal: AbortSignal
  proxyUrl: string | undefined
}): Promise<NovelaiWireTagSuggestion[]> {
  const proxyUrl = options.proxyUrl?.trim() ?? ''
  const dispatcher: Dispatcher | undefined = proxyUrl === '' ? undefined : new ProxyAgent(proxyUrl)
  let response: Response
  try {
    const query = new URLSearchParams({ model: options.model, prompt: options.prompt })
    response = await fetch(`${options.baseUrl.replace(/\/+$/, '')}/ai/generate-image/suggest-tags?${query}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${options.token}`, Accept: 'application/json' },
      signal: options.signal,
      ...(dispatcher === undefined ? {} : { dispatcher }),
    })
  } catch {
    // The suggestion endpoint is advisory: unreachable or timed out falls back to the dictionary.
    return []
  }
  if (!response.ok) return []
  let parsed: unknown
  try {
    parsed = await response.json()
  } catch {
    return []
  }
  const tags = (parsed as { tags?: unknown }).tags
  if (!Array.isArray(tags)) return []
  return tags.filter(isWireTagSuggestion)
}

/** Structural guard for one wire tag suggestion. */
function isWireTagSuggestion(value: unknown): value is NovelaiWireTagSuggestion {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record['tag'] === 'string' && typeof record['count'] === 'number'
    && typeof record['category'] === 'number'
}
