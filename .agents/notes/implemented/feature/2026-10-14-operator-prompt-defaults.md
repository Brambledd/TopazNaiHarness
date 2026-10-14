# Agent Note: Operator standing prompt defaults (quality positives and the extended negative preset)

Status: implemented

English | [中文](2026-10-14-operator-prompt-defaults.zh.md)

- Date: 2026-10-14
- Packages: `novelai/tool-novelai` (code), the `novelai-prompt-writer` skill (harness home)

## Problem

The model had no standing quality defaults: the skill explicitly forbade stock aesthetic terms without per-prompt approval (rule 2.3), and the tool's `DEFAULT_NEGATIVE_PROMPT` mirrored only the official V4+ "Heavy" preset. Every multi-character session therefore needed the operator to re-request quality tags and a long defect list by hand.

## Decision

Two placements, each where it binds:

- **Skill (`novelai-prompt-writer/SKILL.md`)** — a "Standing operator defaults" subsection, pre-approved and overriding rule 2.3: prepend `{{masterpiece}}, {{best quality}}, very aesthetic, masterpiece` to every positive prompt; for scenes depicting an existing game/anime's characters, also add the work's Danbooru copyright tag in `{{...}}` form (same verification pipeline as character tags, e.g. `{{honkai:_star_rail}}`) plus `{{official art}}`; original scenes skip both. The skill does NOT append the defect negative list — the generation tool enforces it.
- **Tool (`DEFAULT_NEGATIVE_PROMPT` in `payload.ts`)** — extended from the Heavy preset to the operator's full quality/border-defect list (adds dithering, halftone, screentone, negative space, border family, out of frame, cropped, incomplete composition, low quality, blurry, bad hands). It applies whenever the caller sends no negative prompt, so the defect protection holds even when the model forgets.

## Consequences

- Positive quality tags and copyright/official-art tagging arrive by default; the per-prompt confirmation burden moves to genuinely scene-specific content.
- The negative preset applies only when the caller sends none — an explicit (possibly shorter) negative still wins, preserving deliberate overrides.
- The skill file lives under the harness home (per-instance, not repo-tracked): edits deploy immediately but do not follow the repository to other instances.
