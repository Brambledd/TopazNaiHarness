/** `infinite-gen-3` namespace dictionaries for the armor badge. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'infinite-gen-3'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'badge.on': '破甲已开启 · 无限三代 v0.5.0',
  'badge.running': '执行中…',
  'badge.verdict.pass': '破甲通过',
  'badge.verdict.refusal': '检出拒绝',
  'badge.verdict.fallback': '检出改写',
  'badge.domain': '命中域',
  'badge.markers': '载荷',
} satisfies Record<string, string>

/** The infinite-gen-3 namespace key union. */
export type ArmorBadgeKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'badge.on': 'Armor on · Infinite Gen 3 v0.5.0',
  'badge.running': 'Running…',
  'badge.verdict.pass': 'Armor pass',
  'badge.verdict.refusal': 'Refusal detected',
  'badge.verdict.fallback': 'Fallback redirect detected',
  'badge.domain': 'domain',
  'badge.markers': 'markers',
} satisfies Record<ArmorBadgeKey, string>
