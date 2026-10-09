/**
 * Reverse-prompt (image interrogation) pipeline: one auxiliary vision-model
 * call over an imported image, ported from the desktop reference's V5
 * reverse templates. The system prompt drives reproducible Danbooru output;
 * the answer is parsed leniently (prose around labeled sections is ignored).
 * @module @deepseek-ai/dsh-api-novelai-controller/reverse
 */

import type { NovelaiReverseRequest } from './types.ts'

/** Output contract the known-character answer follows, parsed leniently. */
const NAME_PROMPT_HEADER = 'name prompt'
const FEATURE_PROMPT_HEADER = 'feature prompt'

/** Scope labels shown to the model, mirroring the desktop's reverse scopes. */
const SCOPE_LABELS: Record<NovelaiReverseRequest['scope'], string> = {
  full: 'the full image',
  character: 'the target character only',
  object: 'the target object or prop only',
  scene: 'the background, lighting, space, and atmosphere only',
}

/** Mode-specific output instructions. */
const MODE_RULES: Record<NovelaiReverseRequest['mode'], string> = {
  tags: 'Output standard Danbooru tags, English, comma-separated, ordered by: subject count and composition, then identity, then appearance and outfit, then pose and action, then background.',
  natural: 'Output one fluent descriptive paragraph in natural language; keep every observed fact, no tag syntax.',
  mixed: 'Output Danbooru tags first, then one short natural-language sentence covering composition and mood.',
}

/**
 * Assemble the reverse system prompt for one request (desktop reference
 * parity in intent: reproducibility over vague captioning).
 * @param request - the browser's reverse request.
 * @returns the system prompt text.
 */
export function buildReverseSystemPrompt(request: NovelaiReverseRequest): string {
  const lines: string[] = [
    'You reverse anime-style images into NovelAI image-generation prompts.',
    'Reproducibility is the goal: the prompt must recreate the picture, not loosely caption it.',
    MODE_RULES[request.mode],
    'Verify against the image, item by item: subject count and identity; background color and complexity; framing (full body / half body / close-up); viewpoint; each subject\u2019s size and position in frame; standing or seated posture; the direction, bend, and pointing of each arm and leg; hand poses; head orientation; gaze and expression.',
    'Prefer mature, stable Danbooru tags you can directly observe and that reliably reproduce the composition. Do not replace observable facts (white background, full body, standing, spread legs, outstretched arm, pointing, looking at viewer, smile) with subjective decor like cinematic or beautiful lighting.',
    'For a solo full-body image, never output pointing alone: keep the mutually consistent mature tag set (1girl, solo, white background / simple background, full body, standing, and the observed pose and gaze tags).',
    'Do not invent backgrounds, actions, or lighting that are not visible; do not reinterpret standing poses as sitting meanings.',
  ]
  if (request.scope !== 'full') {
    lines.push(`Reverse scope: ${SCOPE_LABELS[request.scope]}. Output only that scope; ignore everything else in the image.`)
  }
  if (request.knownCharacter) {
    lines.push(
      'The subject is a known web/game/anime character. Answer with exactly two labeled sections, each a complete prompt:',
      `"${NAME_PROMPT_HEADER}:" using the exact Danbooru identity tags (character name and series), and`,
      `"${FEATURE_PROMPT_HEADER}:" describing the appearance, outfit, and pose without the identity tags.`,
      'No other prose outside the two sections.',
    )
  }
  return lines.join('\n')
}

/**
 * Assemble the user-side text handed to the model beside the image.
 * @param request - the browser's reverse request.
 * @returns the text part content.
 */
export function buildReverseUserText(request: NovelaiReverseRequest): string {
  const lines = ['Generate the prompt for this image.']
  if (request.hint !== undefined && request.hint.trim() !== '') {
    lines.push(`Target/character hint: ${request.hint.trim()}`)
  }
  return lines.join('\n')
}

/** The reverse answer before projection: one prompt, or the known-character pair. */
export interface ReverseAnswer {
  /** The combined or single prompt. */
  prompt: string
  /** Identity-tagged variant, when the known-character mode answered both sections. */
  namePrompt: string | undefined
  /** Appearance-only variant, when the known-character mode answered both sections. */
  featurePrompt: string | undefined
}

/**
 * Parse the model's answer leniently: prose around the labeled sections is
 * ignored, and a missing or partial section degrades to the whole text as
 * the single prompt (the desktop's tolerant-parse posture).
 * @param text - the model's text answer.
 * @param knownCharacter - whether the known-character contract was requested.
 * @returns the parsed answer.
 */
export function parseReverseAnswer(text: string, knownCharacter: boolean): ReverseAnswer {
  const trimmed = text.trim()
  if (!knownCharacter) return { prompt: trimmed, namePrompt: undefined, featurePrompt: undefined }
  const nameMatch = new RegExp(`${NAME_PROMPT_HEADER}\\s*[:：]\\s*([\\s\\S]*?)(?=${FEATURE_PROMPT_HEADER}\\s*[:：]|$)`, 'i').exec(trimmed)
  const featureMatch = new RegExp(`${FEATURE_PROMPT_HEADER}\\s*[:：]\\s*([\\s\\S]*)$`, 'i').exec(trimmed)
  const namePrompt = nameMatch?.[1]?.trim()
  const featurePrompt = featureMatch?.[1]?.trim()
  if (namePrompt !== undefined && namePrompt !== '' && featurePrompt !== undefined && featurePrompt !== '') {
    return {
      prompt: `${namePrompt}, ${featurePrompt}`,
      namePrompt,
      featurePrompt,
    }
  }
  return { prompt: trimmed, namePrompt: undefined, featurePrompt: undefined }
}
