/**
 * Node-side entry: the paid submission client and response extraction.
 *
 * Imports `undici` and `fflate`; only Node consumers (the generation tool and the
 * generation controller) may import this subpath.
 * @module @deepseek-ai/dsh-novelai-core/node
 */

export * from './client.ts'
export * from './unzip.ts'
