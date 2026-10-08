/**
 * Isomorphic entry: parameter model, wire-payload assembly, and Anlas estimation.
 *
 * Browser-safe by construction — this module must never import Node-only runtime
 * (`undici`, `fflate`, `node:*`); the submission client lives behind the `./node`
 * subpath so browser bundles that import the root entry stay free of Node runtime.
 * @module @deepseek-ai/dsh-novelai-core
 */

export * from './types.ts'
export * from './payload.ts'
