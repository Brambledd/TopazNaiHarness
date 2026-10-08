/** Workbench copy dictionaries (typed keys; i18n gate owns product text). */

export const en = {
  'mode.conversation': 'Chat',
  'mode.workbench': 'Studio',
  'prompt.label': 'Prompt',
  'prompt.placeholder': '1girl, solo, masterpiece…',
  'generate': 'Generate',
  'generating': 'Generating…',
  'history.empty': 'No images yet',
  'error': 'Generation failed',
} as const

export const zh = {
  'mode.conversation': '对话',
  'mode.workbench': '创作台',
  'prompt.label': '提示词',
  'prompt.placeholder': '1girl, solo, masterpiece…',
  'generate': '生成',
  'generating': '生成中…',
  'history.empty': '还没有图片',
  'error': '生成失败',
} as const

export type WorkbenchKey = keyof typeof en
