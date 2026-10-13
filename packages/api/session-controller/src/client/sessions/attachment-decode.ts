/**
 * Shared client-side decode of one `session.attachment` RPC payload: base64
 * wire bytes into a browser `Uint8Array`, preserving the Remote result shape.
 * @module @deepseek-ai/dsh-api-session-controller/client
 */

import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

/** One successfully decoded attachment read. */
export type DecodedAttachment = {
  attachment: ImageAttachmentRef
  data: Uint8Array
}

/**
 * Decode one `session.attachment` wire payload.
 * @param result - the RPC result carrying base64-encoded bytes.
 * @returns the decoded value, or the failure unchanged.
 */
export function decodeAttachmentPayload(
  result: RemoteResult<{ attachment: ImageAttachmentRef; data: string }>,
): RemoteResult<DecodedAttachment> {
  if (!result.ok) return result
  const binary = atob(result.value.data)
  const data = Uint8Array.from(binary, char => char.charCodeAt(0))
  return { ok: true, value: { attachment: result.value.attachment, data } }
}
