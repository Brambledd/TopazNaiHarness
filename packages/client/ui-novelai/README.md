---
description: "The NovelAI conversation-surface plugin: the novelai_generate tool card, turn-tail image chain, and the backfill bridge into the workbench, for users and maintainers composing the browser chat surface."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-novelai

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-novelai` renders NovelAI generation inside the conversation: a keyed `tool.call.toolview` row for every `novelai_generate` call (state, prompt summary, expandable result details) with a backfill button that delivers the call's arguments and actual seed into the mounted workbench panel through the `novelaiWorkbench` bridge, plus the turn-tail image chain that shows each produced image under the closing assistant message. The package owns no generation logic; the workbench package and the NovelAI controller own the panel and the verbs.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Compose the package in a browser roster that already mounts ui-conversation (the overlay seat owner), the workbench (the bridge provider), and ui-tool (the toolview declaration):

```yaml
- id: ui-novelai
  name: '@deepseek-ai/dsh-client-ui-novelai'
```

The tool row derives entirely from the durable call/result events — state, prompt summary, and details fold from the session log, so replay renders identically. The backfill button appears only on settled successful calls and reports `false` when no workbench panel is mounted.

The package also registers the Settings → General **NovelAI API token** row: it saves and clears the `NOVELAI_TOKEN` credential through the Remote credentials namespace, shows the credential's configured state and source layer, and refreshes on pushed `credentials/reference-updated` events.

-----


## Dev Note

The tool card derives entirely from raw call and result events; a structured result-metadata block would remove the seed parsing from the result text, and the card reads nothing else from the tool package.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the conversation's `novelai_generate` card: the package renders logged call and result events, and its backfill button delegates model input to the queued user message the workbench sends.

#### KV Cache effect

No direct invalidation; the card renders replayed log state, and request changes belong to the messages the conversation appends.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The backfill payload reconstructs from wire arguments** — the tool card reads the request fields from the call's durable arguments and the actual seed from the result text; a future structured result metadata block would remove the text parsing.
- **Turn-tail images depend on attachment authorization** — the card renders what the session attachment surface authorizes; images the log did not record are never fetched.
