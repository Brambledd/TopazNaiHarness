---
description: "The NovelAI workbench plugin: the parameter panel, history canvas, tag autocomplete, character prompts, and the conversation interop bridge, for users and maintainers composing the browser studio surface."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-novelai-workbench

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-novelai-workbench` is the browser studio surface with two tabs. The Generate tab is a two-pane layout where the dominant stage shows the latest generated image (contain-fit, running overlay while generating, click-to-zoom lightbox, a seed-reuse chip, and a filmstrip of history thumbnails that swaps the stage — wheel-scrollable), with the desktop-parity **Enhance** action on the stage meta row (img2img over the stage image: a 1–10 magnitude knob mapping to the conservative strength curve, a 1×/2×/MAX output scale with pixel-ceiling guard, and a client-side canvas resize to the exact target). The Reverse tab imports an image (drop zone, file picker, or the stage's current entry) and reverses it into a NovelAI prompt through the configured vision model — output style (tags/natural/mixed), scope (full/character/object/scene), a target hint, and the known-character identity/appearance variants — with one-click reuse into the generate panel. The scrolling control column carries the prompt panel (model/size/steps/CFG/sampler/seed; the default checkpoint is the catalog's newest entry; content-sized prompt boxes that never scroll), structured character cards, tag autocomplete over the shared bilingual Danbooru index, the folded style-presets and capsule browsers, and the sticky estimate-and-generate footer. The sidebar's own 对话/创作台 switch navigates between the surfaces. It also provides the `novelaiWorkbench` bridge that the conversation's `novelai_generate` card delivers drafts through, and seeds composed drafts into the conversation's composer input (unsent — the user sends from there; the workbench prompt stays intact). All generation verbs go through the `remote.novelai` namespace owned by the NovelAI controller; the panel owns no generation logic.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Compose the package in a browser roster that already mounts ui-layout (the workbench slot owner) and the api-remotes client (the `remote.novelai` namespace):

```yaml
- id: ui-novelai-workbench
  name: '@deepseek-ai/dsh-client-ui-novelai-workbench'
```

Drafts sent to the conversation queue as real user messages; backfill deliveries overwrite only the fields a request carries, clear character cards, and pin the seed to fixed. The panel itself is pure props over the injected faces — no session writes happen outside the explicit send.

-----


## Dev Note

The 对话/创作台 mode switch and the `novelaiWorkbench` bridge are the two seams other packages may rely on; the bridge type is owned here and consumed `import type` by ui-novelai.

<a id="model-experience"></a>
## Model Experience

### 发送到对话 draft delivery

#### What the model sees

One human-readable user message serializing the current draft — prompt, negative prompt, parameters line, and per-character lines — queued into the active conversation when the user presses the `发送到对话` button; the message is ordinary logged user input, and no hidden model-visible input exists.

#### Token effect

One retained user message per explicit send; the serialized draft stays in the conversation until compaction.

#### KV Cache effect

Append-only: each sent draft follows the reusable request prefix, and further sends append without invalidating it.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Workbench-initiated images never enter the conversation log** — pushing UI-generated images into the active session needs a session-write seam design; interop today is text drafts plus the shared output library both surfaces read.
- **Position editing is numeric** — character placement uses percent X/Y inputs; a draggable position canvas remains open work.
- **User-created style presets are not persistent** — the style row derives from the curated capsule taxonomy; user-authored presets would arrive with a settings namespace.
