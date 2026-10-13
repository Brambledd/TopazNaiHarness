/**
 * Generation output-directory resolution for the `novelai_generate` tool: the
 * mounted NovelAI controller's live directory wins, the plugin config is the
 * fallback, and every PNG lands under the local-time `<YYYY>/<MM>/<DD>` day
 * folders — this package's owned mirror of the controller library's layout.
 * @module @deepseek-ai/dsh-tool-novelai/directory
 */

import { join } from 'node:path'
import type { NovelaiController } from '@deepseek-ai/dsh-api-novelai-controller'

/** The directory seam the tool reads off a mounted NovelAI controller. */
export type ControllerDirectorySource = Pick<NovelaiController, 'effectiveOutputDir'>

/**
 * Resolve the root directory one generation saves into.
 * @param fallback - the resolved plugin-config directory.
 * @param controller - the mounted NovelAI controller, when the composition has one.
 * @returns the absolute root directory: the controller's live value when mounted, `fallback` otherwise.
 */
export async function resolveGenerationRoot(
  fallback: string,
  controller: ControllerDirectorySource | undefined,
): Promise<string> {
  if (controller === undefined) return fallback
  return controller.effectiveOutputDir()
}

/**
 * Day folder chain under the generation root for one save instant.
 * @param root - resolved generation root directory.
 * @param now - the save instant; its local calendar date names the folders.
 * @returns `<root>/<YYYY>/<MM>/<DD>`.
 */
export function dayDirectory(root: string, now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return join(root, String(now.getFullYear()), month, day)
}
