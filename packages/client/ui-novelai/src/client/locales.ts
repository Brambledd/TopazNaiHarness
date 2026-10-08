/** `novelai` namespace dictionaries for the dedicated tool row. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'novelai'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'row.title': 'NovelAI 生图',
  'row.running': '正在生成图片',
  'row.failed': '生成失败',
  'row.stopped': '生成已中止',
  'row.preview': '预览大图',
  'row.close': '关闭预览',
  'row.loadFailed': '图片加载失败',
  'row.details': '参数',
} satisfies Record<string, string>

/** The novelai namespace key union. */
export type NovelaiKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'row.title': 'NovelAI image',
  'row.running': 'Generating image',
  'row.failed': 'Generation failed',
  'row.stopped': 'Generation stopped',
  'row.preview': 'Preview image',
  'row.close': 'Close preview',
  'row.loadFailed': 'Image failed to load',
  'row.details': 'Parameters',
} satisfies Record<NovelaiKey, string>
