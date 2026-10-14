# Agent Note: Artist chains stay durable and editable across sessions

Status: implemented

English | [中文](2026-10-14-artist-chains-editable.zh.md)

- Date: 2026-10-14
- Packages: `client/ui-novelai-workbench`

## Problem

Three operator-facing defects around 画师串: the section read the host library only once per panel mount, so the list could go stale after session switches or reloads; a saved chain had no edit path (only insert and delete, so a typo meant delete-and-retype); and the tags text rendered in a single clipped line with an ellipsis, hiding most of a curated chain.

The persistence layer itself was never broken — the host store writes `novelai-artist-chains.json` under the harness home atomically on every mutation, and saved chains were durably on disk the whole time. The vanishing was a panel-side reading policy, not storage.

## Decision

- The fold re-reads the host library on EVERY open, not once per mount. A file read per fold-toggle is cheap, and the library is instance-scoped data another seat or session may have changed.
- Each row gains an 编辑 button: it loads the chain's stored name and tags into the form, the submit flips to 保存 and updates in place through the store's existing by-id update (keeping the chain's slot), and 取消 returns the form to add mode. No host changes needed — the update path already existed.
- The row layout stacks vertically with the tags text wrapping in full (`pre-wrap`, break-anywhere) — a curated chain is verbatim data and nothing may clip it. The editing row carries a highlight border.
- New locale keys (`artists.edit/update/cancel/editingHint`) in both languages; the panel spec's local zh stub gained the same keys — a stub dictionary drifting from the real one fails as empty rendered copy, which is exactly how the first run of the edit test failed.

## Consequences

- Chains saved in any session appear in every session's panel on fold-open; a page reload re-reads the durable file.
- Editing keeps the chain's identity and position; deletion is unchanged.
- Test-side locale stubs must add every new key — the i18n gate only guards source files, not spec-local dictionaries.
