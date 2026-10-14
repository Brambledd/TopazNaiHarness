// @vitest-environment jsdom
/** Workbench panel behavior: catalog seeding, seed modes, negative fold, autocomplete, history, enhance. */
// The enhance canvas pipeline is browser-only (jsdom has no 2d context); the
// spec replaces it with a fixed base64 answer.
vi.mock('../src/client/enhance-image.ts', () => ({
  resizeUrlToBase64: async (_url: string, _width: number, _height: number) => 'cmVzaXplZA==',
  prepareReverseImage: async (_blob: Blob) => ({ image: 'cmV2ZXJzZQ==', previewUrl: 'blob:reverse-preview' }),
}))
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react'
import type { ComponentProps } from 'react'
import type { NovelaiArtistChain, NovelaiGenerateRequest, NovelaiTagSuggestion, NovelaiWorkbenchState } from '@deepseek-ai/dsh-api-novelai-controller/types'
import { WorkbenchRoot } from '../src/client/components.tsx'
import { wordAtCursor } from '../src/client/autocomplete.tsx'
import { CapsuleBrowser, STYLE_PRESETS } from '../src/client/capsule-picker.tsx'
import { CAPSULE_TAXONOMY, mergeCapsules, type CapsuleCategory } from '../src/client/capsule-data.ts'
import { resolutionForTier, snapDimensionWithinArea, maxDimensionFor } from '../src/client/resolution.ts'

const zh = {
  'mode.conversation': '对话',
  'mode.workbench': '创作台',
  'tab.label': '工作台模式',
  'tab.generate': '生成',
  'tab.reverse': '反推',
  'prompt.label': '提示词',
  'prompt.placeholder': '1girl, solo, masterpiece…',
  'negative.label': '负面提示词',
  'negative.placeholder': 'lowres, bad anatomy…',
  'param.model': '模型',
  'param.sampler': '采样器',
  'param.noiseSchedule': '噪声调度',
  'param.size': '尺寸',
  'param.tier': '像素档位',
  'param.ratio': '画面比例',
  'param.custom': '自定义',
  'param.width': '宽度',
  'param.height': '高度',
  'param.steps': '步数',
  'param.cfgScale': 'CFG',
  'param.batchCount': '批量张数',
  'param.batchCountHint': '一次连发 1–8 张（顺序请求）',
  'param.batchInterval': '间隔（秒）',
  'param.batchIntervalHint': '每张之间的等待秒数；0 表示无间隔；张数为 1 时不生效',
  'batch.progress': '批量生成中 {done}/{total}…',
  'anlas.balanceHint': '账户剩余 Anlas（生成后自动刷新）',
  'batch.intervalWarning': '⚠ API 生成间隔过低可能有风险（建议 ≥2 秒）',
  'batch.run': '生成 {count} 张',
  'param.tier.0_4': '小图 · 0.4 MP',
  'param.tier.1': '普通 · 1 MP',
  'param.tier.1_5': '大图 · 1.5 MP',
  'param.tier.2': '超大图 · 2 MP',
  'param.tier.3': '最大 · 3 MP',
  'size.commitHint': '失焦或回车后对齐到 64 像素',
  'capsule.label': '快捷标签',
  'capsule.filter': '搜索标签（中英文均可）',
  'styles.label': '风格库',
  'artists.label': '画师串',
  'artists.empty': '还没有保存的画师串，在下方添加一条。',
  'artists.insert': '插入',
  'artists.remove': '删除',
  'artists.add': '添加',
  'artists.nameLabel': '画师串名称',
  'artists.namePlaceholder': '如「厚涂风」',
  'artists.tagsLabel': '画师串标签串',
  'artists.tagsPlaceholder': '0.3:cola gotouryouta::, 0.5:yoneyama mai::, …（权重:画师::，逗号分隔）',
  'enhance.action': '增强',
  'enhance.magnitude': '增强幅度',
  'enhance.explain': '增强会以当前正面与负面提示词对舞台图做二次扩散；默认保守强度以保留姿势和构图，提高幅度仍可能改变局部结构。',
  'enhance.scale': '输出倍率',
  'enhance.scale1': '1× 保持分辨率',
  'enhance.scale2': '2× 同时放大',
  'enhance.max': 'MAX',
  'enhance.maxHint': 'MAX：V5 检查点走官方服务端放大增强，其余为 2× 自适应放大',
  'enhance.upscaled': '官方服务端放大',
  'enhance.limit': '放大后的目标尺寸超过 NovelAI 像素上限；请选择 1× 或换用更小的原图。',
  'enhance.run': '增强图像',
  'enhance.close': '收起',
  'enhance.done': '增强图像已保存。',
  'reverse.imageAlt': '反推图',
  'reverse.dropHint': '拖入图片到此处，或点击下方按钮打开',
  'reverse.openFile': '打开文件',
  'reverse.fromStage': '用舞台当前图',
  'reverse.clear': '清除图片',
  'reverse.mode': '输出风格',
  'reverse.mode.tags': 'Tag',
  'reverse.mode.natural': '自然语言',
  'reverse.mode.mixed': '混合',
  'reverse.scope': '反推范围',
  'reverse.scope.full': '整张图片',
  'reverse.scope.full.tip': '反推完整画面、人物、场景和构图',
  'reverse.scope.character': '角色',
  'reverse.scope.character.tip': '只反推指定角色的外观、服装、姿态',
  'reverse.scope.object': '物品',
  'reverse.scope.object.tip': '只反推指定物品或道具',
  'reverse.scope.scene': '场景',
  'reverse.scope.scene.tip': '只反推背景、光照、空间和氛围',
  'reverse.hint': '目标/角色提示（可选）',
  'reverse.hintPlaceholder': '例如：左边的女孩',
  'reverse.known': '这是网络/游戏/动漫角色，生成角色名版和特征版',
  'reverse.run': 'AI 反推提示词',
  'reverse.running': '反推中…',
  'reverse.result': '反推结果',
  'reverse.nameVariant': '角色名版',
  'reverse.featureVariant': '特征版',
  'reverse.reuse': '复用至生成面板',
  'restore.action': '↩ 从图片还原参数',
  'restore.tip': '读取 NovelAI 内嵌在 PNG 里的提示词、种子、采样器等参数；不消耗 Anlas，不调用外部 AI。',
  'restore.ok': '已从图片还原参数。',
  'restore.missing': '未检测到 NovelAI 参数（图片可能被压缩或来自其它来源）。',
  'characters.label': '角色提示词',
  'characters.role': '角色',
  'characters.split': 'AI 拆分角色',
  'characters.splitting': '拆分中…',
  'characters.add': '添加角色',
  'characters.clear': '清空',
  'characters.remove': '删除角色',
  'characters.placeholder': '该角色的标签…',
  'characters.negative': '负面',
  'characters.negativePlaceholder': '该角色专属负面标签…',
  'characters.position.ai': 'AI 摆位',
  'characters.position.custom': '自定义站位',
  'characters.x': 'X',
  'characters.y': 'Y',
  'senddraft.send': '放入对话输入栏',
  'senddraft.sent': '草稿已放入对话输入栏',
  'senddraft.noSession': '当前没有活动对话',
  'senddraft.noInput': '对话输入栏当前不可用',
  'senddraft.header': '请基于这份创作台草稿继续（可直接调用 novelai_generate 出图）：',
  'rail.generateDraft': '请用右侧创作台的当前提示词调用 novelai_generate 生图。',
  'rail.generateSent': '生图请求已放入对话输入栏。',
  'senddraft.positive': '正向提示词',
  'senddraft.negative': '负面提示词',
  'senddraft.params': '参数',
  'senddraft.steps': '步',
  'senddraft.seed.fixed': '固定种子',
  'senddraft.seed.random': '随机种子',
  'history.label': '历史',
  'stage.label': '最新图片',
  'stage.empty': '写好提示词点生成——最新的图片会出现在这里。',
  'stage.running': '正在生成…',
  'stage.zoom': '查看大图',
  'stage.reuseSeed': '在面板中锁定此种子',
  'lightbox.close': '关闭',
  'lightbox.backfill': '回填参数',
  'lightbox.variant': '变体',
  'backfilled': '已从历史回填参数',
  'seed.mode': '种子',
  'seed.random': '随机',
  'seed.fixed': '固定',
  'seed.fixedValue': '种子值',
  'seed.randomize': '随机种子',
  'seed.lastLabel': '上次种子',
  'estimate': '预计消耗',
  'estimate.free': '免费',
  'generate': '生成',
  'generating': '生成中…',
  'error': '生成失败',
} as const

const catalog = {
  models: ['nai-diffusion-5-full', 'nai-diffusion-4-5-full', 'nai-diffusion-4-full'],
  samplers: ['k_euler_ancestral', 'k_euler'],
  noiseSchedules: ['karras', 'exponential'],
  maxSeed: 4294967295,
  defaults: {
    model: 'nai-diffusion-4-5-full',
    width: 832,
    height: 1216,
    steps: 28,
    cfgScale: 5,
    sampler: 'k_euler_ancestral',
    noiseSchedule: 'karras',
  },
}

function makeProps(historyEntries: Array<Record<string, unknown>> = []) {
  const generate = vi.fn(async (_request: NovelaiGenerateRequest) => ({
    id: 'x',
    file: 'workspace/novelai/x.png',
    bytes: 1,
    seed: 1234,
    anlasEstimate: 0,
    createdAt: '2026-10-08T00:00:00Z',
  }))
  const enhance = vi.fn(async (_request: Record<string, unknown>) => ({
    id: 'x',
    file: 'workspace/novelai/x.png',
    bytes: 1,
    seed: 1234,
    anlasEstimate: 0,
    createdAt: '2026-10-08T00:00:00Z',
  }))
  const reverse = vi.fn(async (_request: Record<string, unknown>) => ({
    prompt: '1girl, solo, white background',
  }))
  const inspect = vi.fn(async (_request: Record<string, unknown>) => ({
    hasMeta: true,
    prompt: 'restored prompt',
    negativePrompt: 'lowres',
    seed: 42,
    steps: 30,
    cfgScale: 6,
    sampler: 'k_euler',
    width: 1024,
    height: 1024,
    characters: [
      { prompt: '1girl, blue hair', negativePrompt: '', useCoords: false, x: 0.5, y: 0.5 },
    ],
  }))
  const splitCharacters = vi.fn(async (_request: { prompt: string }) => ({
    prompt: 'park, masterpiece',
    characters: [
      { prompt: '1girl, blue hair', negativePrompt: '', useCoords: false, x: 0.5, y: 0.5 },
      { prompt: '1girl, red hair', negativePrompt: 'extra ears', useCoords: false, x: 0.5, y: 0.5 },
    ],
  }))
  const seedDraft = vi.fn((_sessionId: string, _text: string) => true)
  const commitWorkbenchState = vi.fn(async (_sessionId: string, _state: Record<string, unknown>) => {})
  const readWorkbenchState = vi.fn(async (_sessionId: string) => undefined as NovelaiWorkbenchState | undefined)
  const artistChains = vi.fn(async () => [] as readonly NovelaiArtistChain[])
  const saveArtistChain = vi.fn(async (request: { id: string; name: string; tags: string }) => [
    { id: request.id === '' ? 'chain-1' : request.id, name: request.name, tags: request.tags },
  ] as readonly NovelaiArtistChain[])
  const removeArtistChain = vi.fn(async (_id: string) => [] as readonly NovelaiArtistChain[])
  let backfillSink: ((request: Record<string, unknown>) => void) | undefined
  const onBackfillRequest = vi.fn((callback: (request: Record<string, unknown>) => void) => {
    backfillSink = callback
    return () => { backfillSink = undefined }
  })
  type PatchRequest = {
    slot: 'positive' | 'negative' | 'settings' | 'characters'
    operations: Array<{ op: 'add' | 'remove' | 'modify'; tag?: string; field?: string; value?: string; character?: number }>
  }
  let patchSink: ((request: PatchRequest) => void) | undefined
  const onPatchApply = vi.fn((callback: (request: PatchRequest) => void) => {
    patchSink = callback
    return () => { patchSink = undefined }
  })
  const suggestions: NovelaiTagSuggestion[] = [
    { tag: '1girl', count: 19_000_000, category: 0, description: '一个女孩' },
    { tag: '1boy', count: 8_000_000, category: 0, description: '一个男孩' },
  ]
  const props = {
    catalog: vi.fn(async () => catalog),
    estimate: vi.fn(async () => ({ anlas: 0 })),
    generate,
    enhance,
    reverse,
    inspect,
    history: vi.fn(async () => ({ entries: historyEntries, total: historyEntries.length })),
    anlasBalance: vi.fn(async () => 5000),
    suggestTags: vi.fn(async () => ({ tags: suggestions })),
    readEntry: vi.fn(async () => ({ data: '', mime: 'image/png' as const })),
    splitCharacters,
    seedDraft,
    onBackfillRequest,
    onPatchApply,
    commitWorkbenchState,
    readWorkbenchState,
    artistChains, saveArtistChain, removeArtistChain,
    setViewMode: vi.fn(),
    useSessions: ((selector: (state: { current: string }) => unknown) => selector({ current: 'session-1' })) as never,
    useWorkspaces: (() => { throw new Error('workbench must not read global hooks') }) as never,
    t: (key: keyof typeof zh, params?: Record<string, string | number>): string =>
      Object.entries(params ?? {}).reduce<string>((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), zh[key]),
  }
  return {
    props,
    generate,
    splitCharacters,
    seedDraft,
    readWorkbenchState,
    artistChains,
    saveArtistChain,
    removeArtistChain,
    deliverBackfill: (request: Record<string, unknown>) => backfillSink?.(request),
    deliverPatch: (request: Parameters<NonNullable<typeof patchSink>>[0]) => patchSink?.(request),
  }
}

/** Render the panel with prop-record casting; the four shares are stubbed by hand. */
function renderWith(props: Record<string, unknown>) {
  return render(<WorkbenchRoot {...(props as unknown as ComponentProps<typeof WorkbenchRoot>)} />)
}

async function mount() {
  const { props, generate, splitCharacters, seedDraft, deliverBackfill, deliverPatch } = makeProps()
  const view = render(<WorkbenchRoot {...(props as unknown as ComponentProps<typeof WorkbenchRoot>)} />)
  await act(async () => {}) // drain the restore-read chain so the commit gate opens
  return { view, props, generate, splitCharacters, seedDraft, deliverBackfill, deliverPatch, setViewMode: props.setViewMode }
}

afterEach(() => { cleanup(); vi.useRealTimers() })

describe('workbench panel', () => {
  it('seeds the parameter panel from the catalog defaults', async () => {
    mount()
    await waitFor(() => {
      const model = screen.getByLabelText('模型') as HTMLSelectElement
      // The default checkpoint is the catalog's newest entry, not the host default.
      expect(model.value).toBe('nai-diffusion-5-full')
    })
    const sampler = screen.getByLabelText('采样器') as HTMLSelectElement
    expect(sampler.value).toBe('k_euler_ancestral')
    const width = screen.getByLabelText('宽度') as HTMLInputElement
    const height = screen.getByLabelText('高度') as HTMLInputElement
    expect(width.value).toBe('832')
    expect(height.value).toBe('1216')
  })

  it('collapses the negative prompt until expanded', async () => {
    mount()
    await waitFor(() => { expect(screen.getByLabelText('模型')).toBeTruthy() })
    expect(screen.queryByPlaceholderText('lowres, bad anatomy…')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /负面提示词/ }))
    expect(screen.getByPlaceholderText('lowres, bad anatomy…')).toBeTruthy()
  })

  it('keeps the characters fold mounted even before the checkpoint seeds', async () => {
    // An empty model must not read as a missing feature: the fold header is
    // always present, and only the add button's disabled arm tracks capacity.
    mount()
    const fold = screen.getByRole('button', { name: /角色提示词/ })
    expect(fold.getAttribute('aria-expanded')).toBe('false')
    await waitFor(() => { expect(screen.getByLabelText('模型')).toBeTruthy() })
    expect(screen.getByRole('button', { name: /角色提示词/ })).toBeTruthy()
  })

  it('folds the style presets until expanded and prepends on pick', async () => {
    mount()
    await waitFor(() => { expect(screen.getByLabelText('模型')).toBeTruthy() })
    fireEvent.change(screen.getByPlaceholderText('1girl, solo, masterpiece…'), { target: { value: 'park' } })
    fireEvent.click(screen.getByRole('button', { name: /风格库/ }))
    const chip = screen.getAllByRole('button', { name: '写实' })[0]!
    fireEvent.click(chip)
    const area = screen.getByPlaceholderText('1girl, solo, masterpiece…') as HTMLTextAreaElement
    expect(area.value.startsWith('realistic')).toBe(true)
    expect(area.value).toContain('park')
  })

  it('submits an img2img enhancement of the stage image at the picked scale', async () => {
    const entries = [{
      id: 'e1', file: 'workspace/novelai/e1.png', bytes: 10, width: 832, height: 1216, seed: 42, steps: 28,
      prompt: 'a cat', createdAt: '2026-10-08T00:00:00Z',
    }]
    const { props } = makeProps(entries)
    props.enhance.mockImplementation(async (_request: Record<string, unknown>) => ({
      id: 'x', file: 'workspace/novelai/x.png', bytes: 1, seed: 99, anlasEstimate: 0, createdAt: '2026-10-09T00:00:00Z',
    }))
    const enhance = props.enhance
    render(<WorkbenchRoot {...(props as unknown as ComponentProps<typeof WorkbenchRoot>)} />)
    // The stage image must be loaded — its minted object URL feeds the resize.
    const img = await waitFor(() => {
      const node = document.querySelector('img[data-entry-id="e1"]') as HTMLImageElement
      expect(node).toBeTruthy()
      expect(node.getAttribute('src')).toBeTruthy()
      return node
    }, { timeout: 3000 })
    void img
    fireEvent.click(screen.getByRole('button', { name: '增强' }))
    fireEvent.click(screen.getByRole('button', { name: '增强图像' }))
    await waitFor(() => { expect(enhance).toHaveBeenCalledOnce() })
    const request = enhance.mock.calls[0]![0]
    // 832×1216 snapped at 1× stays 832×1216; strength maps magnitude 3 conservatively.
    expect(request.width).toBe(832)
    expect(request.height).toBe(1216)
    expect(request.strength).toBeCloseTo(0.202, 3)
    expect(typeof request.image).toBe('string')
  })

  it('doubles the enhance target at 2× and blocks a past-ceiling target', async () => {
    const entries = [{
      id: 'e1', file: 'workspace/novelai/e1.png', bytes: 10, width: 1856, height: 2176, seed: 42, steps: 28,
      prompt: 'a cat', createdAt: '2026-10-08T00:00:00Z',
    }]
    const { props } = makeProps(entries)
    props.enhance.mockImplementation(async (_request: Record<string, unknown>) => ({
      id: 'x', file: 'f', bytes: 1, seed: 99, anlasEstimate: 0, createdAt: '2026-10-09T00:00:00Z',
    }))
    const enhance = props.enhance
    render(<WorkbenchRoot {...(props as unknown as ComponentProps<typeof WorkbenchRoot>)} />)
    await screen.findByTitle('查看大图', {}, { timeout: 3000 })
    fireEvent.click(screen.getByRole('button', { name: '增强' }))
    fireEvent.click(screen.getByRole('button', { name: '2× 同时放大' }))
    expect(screen.getByText(/超过 NovelAI 像素上限/)).toBeTruthy()
    expect((screen.getByRole('button', { name: '增强图像' }) as HTMLButtonElement).disabled).toBe(true)
    expect(enhance).not.toHaveBeenCalled()
  })

  it('reuses a reversed prompt into the generate panel', async () => {
    const { props } = makeProps()
    props.reverse.mockImplementation(async () => ({
      prompt: '1girl, solo, white background',
      namePrompt: 'topaz (honkai: star rail)',
      featurePrompt: 'silver hair, blue eyes',
    }))
    const reverse = props.reverse
    const { setViewMode: _unused } = { setViewMode: props.setViewMode }
    void _unused
    render(<WorkbenchRoot {...(props as unknown as ComponentProps<typeof WorkbenchRoot>)} />)
    await waitFor(() => { expect(screen.getByLabelText('模型')).toBeTruthy() })
    // Switch to the reverse tab and import a file through the hidden input.
    fireEvent.click(screen.getByRole('tab', { name: '反推' }))
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(fileInput).toBeTruthy()
    fireEvent.change(fileInput, { target: { files: [new File([new Uint8Array([1, 2, 3])], 'src.png', { type: 'image/png' })] } })
    const preview = await waitFor(() => {
      const img = document.querySelector('img[alt="反推图"]') as HTMLImageElement
      expect(img).toBeTruthy()
      return img
    }, { timeout: 3000 })
    expect(preview.getAttribute('src')).toBe('blob:reverse-preview')
    fireEvent.click(screen.getByRole('button', { name: 'AI 反推提示词' }))
    await waitFor(() => { expect(reverse).toHaveBeenCalledOnce() })
    const request = reverse.mock.calls[0]![0]
    expect(request.image).toBe('cmV2ZXJzZQ==')
    expect(request.mode).toBe('tags')
    expect(request.scope).toBe('full')
    // The result box and both known-character variants render.
    const reuseButtons = screen.getAllByRole('button', { name: '复用至生成面板' })
    expect(reuseButtons).toHaveLength(3)
    expect(screen.getByDisplayValue('1girl, solo, white background')).toBeTruthy()
    expect(screen.getByText('角色名版')).toBeTruthy()
    expect(screen.getByText('特征版')).toBeTruthy()
    // Reusing lands the prompt in the generate panel and switches back.
    fireEvent.click(reuseButtons[reuseButtons.length - 1]!)
    expect((screen.getByPlaceholderText('1girl, solo, masterpiece…') as HTMLInputElement).value)
      .toBe('1girl, solo, white background')
    expect(screen.getByRole('tab', { name: '生成' }).getAttribute('aria-selected')).toBe('true')
  })

  it('keeps the reverse run disabled until a source is imported', async () => {
    mount()
    await waitFor(() => { expect(screen.getByLabelText('模型')).toBeTruthy() })
    fireEvent.click(screen.getByRole('tab', { name: '反推' }))
    expect((screen.getByRole('button', { name: 'AI 反推提示词' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('restores NovelAI-embedded parameters into the generate panel', async () => {
    const { props } = makeProps()
    const inspect = props.inspect
    render(<WorkbenchRoot {...(props as unknown as ComponentProps<typeof WorkbenchRoot>)} />)
    await waitFor(() => { expect(screen.getByLabelText('模型')).toBeTruthy() })
    fireEvent.click(screen.getByRole('tab', { name: '反推' }))
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [new File([new Uint8Array([1, 2, 3])], 'novel.png', { type: 'image/png' })] } })
    await waitFor(() => { expect(document.querySelector('img[alt="反推图"]')).toBeTruthy() }, { timeout: 3000 })
    fireEvent.click(screen.getByRole('button', { name: '↩ 从图片还原参数' }))
    await waitFor(() => { expect(inspect).toHaveBeenCalledOnce() })
    // Every found parameter landed in the generate panel and the tab switched back.
    await waitFor(() => {
      expect((screen.getByPlaceholderText('1girl, solo, masterpiece…') as HTMLInputElement).value).toBe('restored prompt')
    })
    expect((screen.getByPlaceholderText('lowres, bad anatomy…') as HTMLInputElement).value).toBe('lowres')
    expect((screen.getByLabelText('宽度') as HTMLInputElement).value).toBe('1024')
    expect((screen.getByLabelText('高度') as HTMLInputElement).value).toBe('1024')
    expect((screen.getByLabelText('步数') as HTMLInputElement).value).toBe('30')
    expect((screen.getByLabelText('种子值') as HTMLInputElement).value).toBe('42')
    // Restored character captions land in the (opened) character fold.
    expect((screen.getByLabelText('角色 1') as HTMLInputElement).value).toBe('1girl, blue hair')
    expect(screen.getByRole('tab', { name: '生成' }).getAttribute('aria-selected')).toBe('true')
  })

  it('reports an image without NovelAI parameters instead of restoring', async () => {
    const { props } = makeProps()
    props.inspect.mockImplementation(async (_request: Record<string, unknown>) => ({ hasMeta: false }) as never)
    render(<WorkbenchRoot {...(props as unknown as ComponentProps<typeof WorkbenchRoot>)} />)
    await waitFor(() => { expect(screen.getByLabelText('模型')).toBeTruthy() })
    fireEvent.click(screen.getByRole('tab', { name: '反推' }))
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [new File([new Uint8Array([1])], 'x.png', { type: 'image/png' })] } })
    await waitFor(() => { expect(document.querySelector('img[alt="反推图"]')).toBeTruthy() }, { timeout: 3000 })
    fireEvent.click(screen.getByRole('button', { name: '↩ 从图片还原参数' }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('未检测到 NovelAI 参数') })
    expect(screen.getByRole('tab', { name: '反推' }).getAttribute('aria-selected')).toBe('true')
  })

  it('submits the official V5 upscaled enhance from the MAX scale', async () => {    const entries = [{
    id: 'e1', file: 'workspace/novelai/e1.png', bytes: 10, width: 832, height: 1216, seed: 42, steps: 28,
    prompt: 'a cat', createdAt: '2026-10-08T00:00:00Z',
  }]
  const { props } = makeProps(entries)
  props.enhance.mockImplementation(async (_request: Record<string, unknown>) => ({
    id: 'x', file: 'f', bytes: 1, seed: 99, anlasEstimate: 0, createdAt: '2026-10-09T00:00:00Z',
  }))
  const enhance = props.enhance
  render(<WorkbenchRoot {...(props as unknown as ComponentProps<typeof WorkbenchRoot>)} />)
  const img = await waitFor(() => {
    const node = document.querySelector('img[data-entry-id="e1"]') as HTMLImageElement
    expect(node).toBeTruthy()
    expect(node.getAttribute('src')).toBeTruthy()
    return node
  }, { timeout: 3000 })
  void img
  // The catalog default is V5, so MAX takes the official upscaled path.
  fireEvent.click(screen.getByRole('button', { name: '增强' }))
  fireEvent.click(screen.getByRole('button', { name: 'MAX' }))
  expect(screen.getByText(/官方服务端放大/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '增强图像' }))
  await waitFor(() => { expect(enhance).toHaveBeenCalledOnce() })
  const request = enhance.mock.calls[0]![0]
  expect(request.upscaledEnhance).toBe(true)
  // The submission stays at the fitted source size; the server upscales.
  expect(request.width).toBe(832)
  expect(request.height).toBe(1216)
  })

  it('omits the seed in random mode and sends it in fixed mode', async () => {
    const { generate } = await mount()
    await waitFor(() => { expect(screen.getByLabelText('模型')).toBeTruthy() })
    fireEvent.change(screen.getByPlaceholderText('1girl, solo, masterpiece…'), { target: { value: 'a cat' } })
    fireEvent.click(screen.getByRole('button', { name: '生成' }))
    await waitFor(() => { expect(generate).toHaveBeenCalledOnce() })
    const randomRequest = generate.mock.calls[0]![0]
    expect('seed' in randomRequest).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: '🔒 固定' }))
    const seedInput = screen.getByLabelText('种子值') as HTMLInputElement
    fireEvent.change(seedInput, { target: { value: '42' } })
    fireEvent.click(screen.getByRole('button', { name: '生成' }))
    await waitFor(() => { expect(generate).toHaveBeenCalledTimes(2) })
    const fixedRequest = generate.mock.calls[1]![0]
    expect(fixedRequest.seed).toBe(42)
  })

  it('quotes anlas live from the estimate remote', async () => {
    const { props } = makeProps()
    const view = render(<WorkbenchRoot {...(props as unknown as ComponentProps<typeof WorkbenchRoot>)} />)
    await waitFor(() => {
      expect(props.estimate).toHaveBeenCalledWith({ width: 832, height: 1216, steps: 28 })
    }, { timeout: 3000 })
    await waitFor(() => { expect(view.container.textContent).toContain('免费') })
  })
})

describe('resolution math (desktop parity)', () => {
  it('picks the official normal 2:3 canvas', () => {
    // The lattice search reproduces the desktop picker: 832×1216 is the
    // official Normal portrait size (usable band, near-exact ratio).
    expect(resolutionForTier(1, '2:3')).toEqual({ width: 832, height: 1216 })
  })

  it('clamps a committed side under the pixel area cap', () => {
    const snapped = snapDimensionWithinArea(100000, 1216, 832)
    expect(snapped).toBeLessThanOrEqual(maxDimensionFor(1216))
    expect(snapped % 64).toBe(0)
  })
})

describe('inspiration capsule (desktop parity)', () => {
  it('builds the taxonomy from the builtin base and the authored library', () => {
    expect(CAPSULE_TAXONOMY.length).toBeGreaterThan(10)
    const people = CAPSULE_TAXONOMY.find(category => category.name === '人物')
    expect(people?.subgroups.length).toBeGreaterThan(3)
  })

  it('derives style presets from the style category', () => {
    expect(STYLE_PRESETS.length).toBeGreaterThan(5)
    expect(STYLE_PRESETS.some(style => style.zh.includes('水彩'))).toBe(true)
  })

  it('deduplicates merged categories by English tag', () => {
    const base: CapsuleCategory[] = [{ name: '测试', subgroups: [{ name: '组', tags: [{ en: 'tag_a', zh: '甲' }] }] }]
    const extra: CapsuleCategory[] = [{ name: '测试', subgroups: [{ name: '组', tags: [{ en: 'tag_a', zh: '甲二' }, { en: 'tag_b', zh: '乙' }] }] }]
    const merged = mergeCapsules(base, extra)
    const tags = merged[0]!.subgroups[0]!.tags.map(tag => tag.en)
    expect(tags).toContain('tag_b')
    expect(tags.filter(en => en === 'tag_a')).toHaveLength(1)
  })

  it('renders the capsule browser, filters, and inserts on click', () => {
    const onInsert = vi.fn()
    const view = render(<CapsuleBrowser onInsert={onInsert} filterLabel="搜索标签" />)
    fireEvent.click(screen.getByRole('tab', { name: '人物' }))
    fireEvent.click(screen.getAllByRole('button', { name: '女仆' })[0]!)
    expect(onInsert).toHaveBeenCalledWith('maid')
    const filter = screen.getByLabelText('搜索标签') as HTMLInputElement
    fireEvent.change(filter, { target: { value: '水彩' } })
    const chips = Array.from(view.container.querySelectorAll<HTMLButtonElement>('button[title]'))
    expect(chips.length).toBeGreaterThan(0)
    fireEvent.click(chips[0]!)
    expect(onInsert).toHaveBeenCalledTimes(2)
  })

  it('offers style presets behind a fold and appends them on click from the workbench', async () => {
    mount()
    await waitFor(() => { expect(screen.getByLabelText('模型')).toBeTruthy() })
    // The presets stay folded like the capsule browser until expanded.
    expect(screen.queryAllByRole('button', { name: '写实' })).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: /风格库/ }))
    const styleChip = screen.getAllByRole('button', { name: '写实' })[0]!
    fireEvent.click(styleChip)
    const area = screen.getByPlaceholderText('1girl, solo, masterpiece…') as HTMLTextAreaElement
    expect(area.value).toContain('realistic')
  })
})

describe('word segmentation (desktop parity)', () => {
  it('reads the Latin word left of the cursor', () => {
    expect(wordAtCursor('1girl, blue', 11)).toEqual({ word: 'blue', start: 7 })
  })

  it('reads a CJK word left of the cursor', () => {
    expect(wordAtCursor('1girl, 蓝眼', 9).word).toBe('蓝眼')
  })

  it('answers an empty word after a comma', () => {
    expect(wordAtCursor('a, ', 3).word).toBe('')
  })
})

describe('prompt autocomplete', () => {
  it('offers suggestions while typing and applies the picked tag', async () => {
    const { props } = makeProps()
    render(<WorkbenchRoot {...(props as unknown as ComponentProps<typeof WorkbenchRoot>)} />)
    await waitFor(() => { expect(screen.getByLabelText('模型')).toBeTruthy() })
    const area = screen.getByPlaceholderText('1girl, solo, masterpiece…') as HTMLTextAreaElement
    fireEvent.change(area, { target: { value: '1gi' } })
    await waitFor(() => {
      expect(props.suggestTags).toHaveBeenCalledWith({ prompt: '1gi', model: 'nai-diffusion-5-full' })
    }, { timeout: 3000 })
    const option = await screen.findByRole('option', { name: /1girl/ }, { timeout: 3000 })
    fireEvent.mouseDown(option)
    expect(area.value).toBe('1girl, ')
  })

  it('shows the newest entry on the stage, selects from the filmstrip, and opens the lightbox from the stage', async () => {
    const entry = {
      id: 'e1',
      file: 'workspace/novelai/e1.png',
      bytes: 10,
      width: 832,
      height: 1216,
      seed: 42,
      steps: 28,
      prompt: 'a cat',
      createdAt: '2026-10-08T00:00:00Z',
    }
    const { props } = makeProps([entry])
    render(<WorkbenchRoot {...(props as unknown as ComponentProps<typeof WorkbenchRoot>)} />)
    // The newest entry lands on the stage by default; the filmstrip tile selects.
    const stageImage = await screen.findByTitle('查看大图', {}, { timeout: 3000 })
    expect(stageImage.getAttribute('alt')).toBe('a cat')
    const tile = screen.getByRole('button', { name: 'a cat' })
    fireEvent.click(tile)
    expect(screen.getByTitle('查看大图').getAttribute('alt')).toBe('a cat')
    fireEvent.click(screen.getByTitle('查看大图'))
    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '回填参数' }))
    const area = screen.getByPlaceholderText('1girl, solo, masterpiece…') as HTMLTextAreaElement
    expect(area.value).toBe('a cat')
    const seedInput = screen.getByLabelText('种子值') as HTMLInputElement
    expect(seedInput.value).toBe('42')
  })

  it('swaps the stage to the filmstrip selection and back to the newest after generating', async () => {
    const entries: Array<Record<string, unknown>> = [
      { id: 'e2', file: 'workspace/novelai/e2.png', bytes: 10, width: 832, height: 1216, seed: 7, steps: 28, prompt: 'newest', createdAt: '2026-10-08T01:00:00Z' },
      { id: 'e1', file: 'workspace/novelai/e1.png', bytes: 10, width: 832, height: 1216, seed: 42, steps: 28, prompt: 'a cat', createdAt: '2026-10-08T00:00:00Z' },
    ]
    const { props } = makeProps(entries)
    render(<WorkbenchRoot {...(props as unknown as ComponentProps<typeof WorkbenchRoot>)} />)
    await screen.findByTitle('查看大图', {}, { timeout: 3000 })
    expect(screen.getByTitle('查看大图').getAttribute('alt')).toBe('newest')
    fireEvent.click(screen.getByRole('button', { name: 'a cat' }))
    expect(screen.getByTitle('查看大图').getAttribute('alt')).toBe('a cat')
    // A fresh generation follows the newest entry again: the refreshed page
    // answers from the same array, so the new row lands ahead of the selection.
    entries.unshift({ id: 'e3', file: 'workspace/novelai/e3.png', bytes: 10, width: 832, height: 1216, seed: 99, steps: 28, prompt: 'fresh', createdAt: '2026-10-08T02:00:00Z' })
    const area = screen.getByPlaceholderText('1girl, solo, masterpiece…') as HTMLTextAreaElement
    fireEvent.change(area, { target: { value: 'fresh prompt' } })
    fireEvent.click(screen.getByRole('button', { name: '生成' }))
    await waitFor(() => { expect(screen.getByTitle('查看大图').getAttribute('alt')).toBe('fresh') })
  })

  it('locks the stage seed into the panel from the meta row', async () => {
    const entry = {
      id: 'e1', file: 'workspace/novelai/e1.png', bytes: 10, width: 832, height: 1216, seed: 42, steps: 28,
      prompt: 'a cat', createdAt: '2026-10-08T00:00:00Z',
    }
    const { props } = makeProps([entry])
    render(<WorkbenchRoot {...(props as unknown as ComponentProps<typeof WorkbenchRoot>)} />)
    const seedButton = await screen.findByTitle('在面板中锁定此种子', {}, { timeout: 3000 })
    fireEvent.click(seedButton)
    const seedInput = screen.getByLabelText('种子值') as HTMLInputElement
    expect(seedInput.value).toBe('42')
  })
})

/** Open the character fold after the catalog defaults have landed. */
async function openCharacters(): Promise<void> {
  await waitFor(() => { expect(screen.getByLabelText('模型')).toBeTruthy() })
  fireEvent.click(screen.getByRole('button', { name: /角色提示词/ }))
}

describe('character prompts', () => {
  it('adds a character card and submits it with the generation', async () => {
    const { generate } = await mount()
    await openCharacters()
    fireEvent.click(screen.getByRole('button', { name: '添加角色' }))
    const area = screen.getByLabelText('角色 1') as HTMLTextAreaElement
    fireEvent.change(area, { target: { value: '1girl, blue hair' } })
    fireEvent.change(screen.getByPlaceholderText('1girl, solo, masterpiece…'), { target: { value: 'park' } })
    fireEvent.click(screen.getByRole('button', { name: '生成' }))
    await waitFor(() => { expect(generate).toHaveBeenCalledOnce() })
    const request = generate.mock.calls[0]![0]
    expect(request.characters).toEqual([
      { prompt: '1girl, blue hair', useCoords: false, x: 0.5, y: 0.5 },
    ])
  })

  it('omits characters when the panel stays empty', async () => {
    const { generate } = await mount()
    await openCharacters()
    fireEvent.change(screen.getByPlaceholderText('1girl, solo, masterpiece…'), { target: { value: 'a cat' } })
    fireEvent.click(screen.getByRole('button', { name: '生成' }))
    await waitFor(() => { expect(generate).toHaveBeenCalledOnce() })
    expect('characters' in generate.mock.calls[0]![0]).toBe(false)
  })

  it('splits the merged prompt into base and character cards with one LLM call', async () => {
    const { splitCharacters } = await mount()
    await waitFor(() => { expect(screen.getByLabelText('模型')).toBeTruthy() })
    // The split button lives beside the prompt, outside the character fold.
    expect(screen.getByRole('button', { name: 'AI 拆分角色' })).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText('1girl, solo, masterpiece…'), { target: { value: 'park, 2girls, blue hair, red hair' } })
    fireEvent.click(screen.getByRole('button', { name: 'AI 拆分角色' }))
    expect(splitCharacters).toHaveBeenCalledWith({ prompt: 'park, 2girls, blue hair, red hair' })
    await waitFor(() => {
      expect((screen.getByPlaceholderText('1girl, solo, masterpiece…') as HTMLInputElement).value).toBe('park, masterpiece')
    })
    expect(screen.getByLabelText('角色 1')).toBeTruthy()
    expect(screen.getByLabelText('角色 2')).toBeTruthy()
    expect((screen.getByLabelText('角色 1') as HTMLInputElement).value).toBe('1girl, blue hair')
    expect((screen.getByLabelText('角色 2 负面') as HTMLInputElement).value).toBe('extra ears')
  })

  it('toggles custom placement and edits coordinates as percentages', async () => {
    const { generate } = await mount()
    await openCharacters()
    fireEvent.click(screen.getByRole('button', { name: '添加角色' }))
    expect(screen.queryByLabelText('角色 1 X')).toBeNull()
    fireEvent.click(screen.getByLabelText('角色 1 自定义站位'))
    const x = screen.getByLabelText('角色 1 X') as HTMLInputElement
    const y = screen.getByLabelText('角色 1 Y') as HTMLInputElement
    expect(x.value).toBe('50')
    expect(y.value).toBe('50')
    fireEvent.change(x, { target: { value: '30' } })
    fireEvent.change(y, { target: { value: '70' } })
    fireEvent.change(screen.getByLabelText('角色 1'), { target: { value: '1girl, blue hair' } })
    fireEvent.change(screen.getByPlaceholderText('1girl, solo, masterpiece…'), { target: { value: 'park' } })
    fireEvent.click(screen.getByRole('button', { name: '生成' }))
    await waitFor(() => { expect(generate).toHaveBeenCalledOnce() })
    expect(generate.mock.calls[0]![0].characters).toEqual([
      { prompt: '1girl, blue hair', useCoords: true, x: 0.3, y: 0.7 },
    ])
  })

  it('removes a character card through its row button', async () => {
    mount()
    await openCharacters()
    fireEvent.click(screen.getByRole('button', { name: '添加角色' }))
    fireEvent.click(screen.getByRole('button', { name: '添加角色' }))
    expect(screen.getByLabelText('角色 2')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '删除角色 1' }))
    expect(screen.queryByLabelText('角色 2')).toBeNull()
    expect((screen.getByLabelText('角色 1') as HTMLInputElement).value).toBe('')
  })

  it('restores recorded characters on backfill and variation', async () => {
    const entry = {
      id: 'e1',
      file: 'workspace/novelai/e1.png',
      bytes: 10,
      width: 832,
      height: 1216,
      seed: 42,
      steps: 28,
      prompt: 'park',
      characters: [
        { prompt: '1girl, blue hair', negativePrompt: '', useCoords: false, x: 0.5, y: 0.5 },
      ],
      createdAt: '2026-10-08T00:00:00Z',
    }
    const { props, generate } = makeProps([entry])
    render(<WorkbenchRoot {...(props as unknown as ComponentProps<typeof WorkbenchRoot>)} />)
    const tile = await screen.findByRole('button', { name: 'park' }, { timeout: 3000 })
    fireEvent.click(tile)
    fireEvent.click(screen.getByTitle('查看大图'))
    fireEvent.click(screen.getByRole('button', { name: '回填参数' }))
    expect(screen.getByLabelText('角色 1')).toBeTruthy()
    expect((screen.getByLabelText('角色 1') as HTMLInputElement).value).toBe('1girl, blue hair')
    fireEvent.click(screen.getByTitle('查看大图'), { detail: 1 })
    fireEvent.click(await screen.findByRole('button', { name: '变体' }, { timeout: 3000 }))
    await waitFor(() => { expect(generate).toHaveBeenCalledOnce() })
    expect(generate.mock.calls[0]![0].characters).toEqual([
      { prompt: '1girl, blue hair', negativePrompt: '', useCoords: false, x: 0.5, y: 0.5 },
    ])
  })

  it('enforces the V4.5 capacity of six cards', async () => {
    mount()
    await waitFor(() => { expect(screen.getByLabelText('模型')).toBeTruthy() })
    // The default checkpoint is V5 (32 cards); switch down to V4.5 for the cap.
    fireEvent.change(screen.getByLabelText('模型'), { target: { value: 'nai-diffusion-4-5-full' } })
    await openCharacters()
    for (let i = 0; i < 6; i += 1) {
      fireEvent.click(screen.getByRole('button', { name: '添加角色' }))
    }
    expect(screen.getByLabelText('角色 6')).toBeTruthy()
    expect((screen.getByRole('button', { name: '添加角色' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('conversation interop', () => {
  it('seeds the composed draft into the conversation input without clearing the panel', async () => {
    const { seedDraft, setViewMode } = await mount()
    await openCharacters()
    fireEvent.change(screen.getByPlaceholderText('1girl, solo, masterpiece…'), { target: { value: 'park, 2girls' } })
    fireEvent.click(screen.getByRole('button', { name: '添加角色' }))
    fireEvent.change(screen.getByLabelText('角色 1'), { target: { value: '1girl, blue hair' } })
    fireEvent.click(screen.getByRole('button', { name: '放入对话输入栏' }))
    expect(seedDraft).toHaveBeenCalledOnce()
    const [sessionId, text] = seedDraft.mock.calls[0] as [string, string]
    expect(sessionId).toBe('session-1')
    expect(text).toContain('park, 2girls')
    expect(text).toContain('1girl, blue hair')
    // The workbench prompt survives the delivery; the user sends from the chat.
    expect((screen.getByPlaceholderText('1girl, solo, masterpiece…') as HTMLInputElement).value).toBe('park, 2girls')
    expect(setViewMode).toHaveBeenCalledWith('conversation')
  })

  it('reports an unavailable conversation input instead of switching views', async () => {
    const { props } = makeProps()
    props.seedDraft.mockReturnValue(false)
    render(<WorkbenchRoot {...(props as unknown as ComponentProps<typeof WorkbenchRoot>)} />)
    await waitFor(() => { expect(screen.getByLabelText('模型')).toBeTruthy() })
    fireEvent.change(screen.getByPlaceholderText('1girl, solo, masterpiece…'), { target: { value: 'park' } })
    fireEvent.click(screen.getByRole('button', { name: '放入对话输入栏' }))
    expect(screen.getByRole('alert').textContent).toContain('对话输入栏当前不可用')
    expect(props.setViewMode).not.toHaveBeenCalled()
  })

  it('applies a conversation-side backfill request and switches to the workbench', async () => {
    const { deliverBackfill, setViewMode, splitCharacters } = await mount()
    await waitFor(() => { expect(screen.getByLabelText('模型')).toBeTruthy() })
    act(() => {
      deliverBackfill({
        prompt: 'from the chat',
        negativePrompt: 'lowres',
        model: 'nai-diffusion-4-5-full',
        seed: 7,
        width: 1024,
        height: 1024,
        steps: 30,
        cfgScale: 6,
        sampler: 'k_euler_ancestral',
        noiseSchedule: 'karras',
      })
    })
    expect((screen.getByPlaceholderText('1girl, solo, masterpiece…') as HTMLInputElement).value).toBe('from the chat')
    expect((screen.getByPlaceholderText('lowres, bad anatomy…') as HTMLInputElement).value).toBe('lowres')
    expect((screen.getByLabelText('种子值') as HTMLInputElement).value).toBe('7')
    expect((screen.getByLabelText('宽度') as HTMLInputElement).value).toBe('1024')
    expect((screen.getByLabelText('模型') as HTMLSelectElement).value).toBe('nai-diffusion-4-5-full')
    expect((screen.getByLabelText('步数') as HTMLInputElement).value).toBe('30')
    expect((screen.getByLabelText('CFG') as HTMLInputElement).value).toBe('6')
    expect((screen.getByLabelText('采样器') as HTMLSelectElement).value).toBe('k_euler_ancestral')
    expect((screen.getByLabelText('噪声调度') as HTMLSelectElement).value).toBe('karras')
    expect(setViewMode).toHaveBeenCalledWith('workbench')
    // A characters-less backfill keeps today's behavior: no LLM split on the path.
    expect(splitCharacters).not.toHaveBeenCalled()
  })

  it('lands a backfill\'s structured characters directly in the cards without a split', async () => {
    const { deliverBackfill, splitCharacters } = await mount()
    await waitFor(() => { expect(screen.getByLabelText('模型')).toBeTruthy() })
    act(() => {
      deliverBackfill({
        prompt: 'park, sunset',
        characters: [
          { prompt: '1girl, blue hair', negativePrompt: 'extra ears' },
          { prompt: '1girl, red hair' },
        ],
      })
    })
    // Direct fill: fresh ids, centered AI placement, no split call anywhere.
    expect(splitCharacters).not.toHaveBeenCalled()
    expect((screen.getByPlaceholderText('1girl, solo, masterpiece…') as HTMLInputElement).value).toBe('park, sunset')
    expect((screen.getByLabelText('角色 1') as HTMLInputElement).value).toBe('1girl, blue hair')
    expect((screen.getByLabelText('角色 1 负面') as HTMLInputElement).value).toBe('extra ears')
    expect((screen.getByLabelText('角色 2') as HTMLInputElement).value).toBe('1girl, red hair')
    expect(screen.getByLabelText('角色 2 负面') as HTMLInputElement).toBeTruthy()
    expect((screen.getByLabelText('角色 2 负面') as HTMLInputElement).value).toBe('')
    // A present-but-empty array clears the cards without forcing the fold open.
    act(() => { deliverBackfill({ characters: [] }) })
    expect(screen.queryByLabelText('角色 1')).toBeNull()
  })

  it('applies a promptless or blank-prompt backfill without touching prompt or cards', async () => {
    const { deliverBackfill, splitCharacters } = await mount()
    await waitFor(() => { expect(screen.getByLabelText('模型')).toBeTruthy() })
    act(() => { deliverBackfill({ seed: 7 }) })
    await act(async () => {})
    act(() => { deliverBackfill({ prompt: '   ' }) })
    await act(async () => {})
    // A blank negative rides along without opening its fold.
    act(() => { deliverBackfill({ negativePrompt: '   ' }) })
    await act(async () => {})
    expect(splitCharacters).not.toHaveBeenCalled()
    expect((screen.getByLabelText('种子值') as HTMLInputElement).value).toBe('7')
    expect((screen.getByPlaceholderText('1girl, solo, masterpiece…') as HTMLInputElement).value).toBe('   ')
    // The fold stays closed, so the negative field is not rendered at all.
    expect(screen.queryByPlaceholderText('lowres, bad anatomy…')).toBeNull()
  })

  it('applies a prompt patch in place without switching views', async () => {
    const { deliverPatch, setViewMode } = await mount()
    await waitFor(() => { expect(screen.getByLabelText('模型')).toBeTruthy() })
    fireEvent.change(screen.getByPlaceholderText('1girl, solo, masterpiece…'), { target: { value: '1girl, garden, old dress' } })
    act(() => {
      deliverPatch({
        slot: 'positive',
        operations: [
          { op: 'add', tag: 'blue hair' },
          { op: 'remove', tag: 'old dress' },
          { op: 'modify', tag: 'garden', value: 'night city' },
        ],
      })
    })
    expect((screen.getByPlaceholderText('1girl, solo, masterpiece…') as HTMLInputElement).value)
      .toBe('1girl, night city, blue hair')
    // The patch stays beside the conversation: no view switch.
    expect(setViewMode).not.toHaveBeenCalled()
  })

  it('applies a settings patch onto the matching panel fields', async () => {
    const { deliverPatch } = await mount()
    await waitFor(() => { expect(screen.getByLabelText('模型')).toBeTruthy() })
    act(() => {
      deliverPatch({ slot: 'settings', operations: [{ op: 'modify', field: 'steps', value: '30' }, { op: 'modify', field: 'seed', value: '777' }] })
    })
    expect((screen.getByLabelText('步数') as HTMLInputElement).value).toBe('30')
    expect((screen.getByLabelText('种子值') as HTMLInputElement).value).toBe('777')
  })

  it('applies a characters patch into per-character cards without touching the shared prompt', async () => {
    const { deliverPatch } = await mount()
    await waitFor(() => { expect(screen.getByLabelText('模型')).toBeTruthy() })
    fireEvent.change(screen.getByPlaceholderText('1girl, solo, masterpiece…'), { target: { value: 'tavern, 2girls, warm light' } })
    act(() => {
      deliverPatch({
        slot: 'characters',
        operations: [
          { op: 'add', character: 1, tag: 'silver hair' },
          { op: 'add', character: 2, tag: 'cat ears' },
          { op: 'add', character: 2, tag: 'wolf tail' },
        ],
      })
    })
    // The shared prompt stays exactly as it was.
    expect((screen.getByPlaceholderText('1girl, solo, masterpiece…') as HTMLInputElement).value)
      .toBe('tavern, 2girls, warm light')
    // The patch opens the characters fold itself, and both cards land.
    expect(screen.getByRole('button', { name: /角色提示词/ }).getAttribute('aria-expanded')).toBe('true')
    expect((screen.getAllByLabelText('角色 1')[0] as HTMLTextAreaElement).value).toBe('silver hair')
    expect((screen.getAllByLabelText('角色 2')[0] as HTMLTextAreaElement).value).toBe('cat ears, wolf tail')
  })

  it('commits the panel state for the current session (debounced)', async () => {
    const { props } = makeProps()
    render(<WorkbenchRoot {...(props as unknown as ComponentProps<typeof WorkbenchRoot>)} />)
    await waitFor(() => { expect(screen.getByLabelText('模型')).toBeTruthy() })
    fireEvent.change(screen.getByPlaceholderText('1girl, solo, masterpiece…'), { target: { value: 'park' } })
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 600) }) })
    expect(props.commitWorkbenchState).toHaveBeenCalledWith('session-1', expect.objectContaining({ prompt: 'park' }))
  })

  it('commits the character cards with the panel state so generation can bind them', async () => {
    const { deliverPatch, props } = await mount()
    await waitFor(() => { expect(screen.getByLabelText('模型')).toBeTruthy() })
    act(() => {
      deliverPatch({
        slot: 'characters',
        operations: [
          { op: 'add', character: 1, tag: 'silver hair' },
          { op: 'add', character: 2, tag: 'cat ears' },
        ],
      })
    })
    fireEvent.change(screen.getByPlaceholderText('1girl, solo, masterpiece…'), { target: { value: 'tavern' } })
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 600) }) })
    expect(props.commitWorkbenchState).toHaveBeenCalledWith('session-1', expect.objectContaining({
      prompt: 'tavern',
      characters: [
        expect.objectContaining({ prompt: 'silver hair' }),
        expect.objectContaining({ prompt: 'cat ears' }),
      ],
    }))
  })

  it('commits the batch settings when the count is above one', async () => {
    const { props } = await mount()
    await waitFor(() => { expect(screen.getByLabelText('模型')).toBeTruthy() })
    fireEvent.change(screen.getByLabelText('批量张数'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('间隔（秒）'), { target: { value: '10' } })
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 600) }) })
    expect(props.commitWorkbenchState).toHaveBeenCalledWith('session-1', expect.objectContaining({
      batchCount: 3,
      batchIntervalSec: 10,
    }))
  })

  it('holds the commit until the session restore read settles, so a remount cannot publish the bare panel', async () => {
    const { props, readWorkbenchState } = makeProps()
    let releaseRead: (() => void) | undefined
    readWorkbenchState.mockImplementation(async () => await new Promise<undefined>((resolve) => {
      releaseRead = () => { resolve(undefined) }
    }))
    render(<WorkbenchRoot {...(props as unknown as ComponentProps<typeof WorkbenchRoot>)} />)
    await waitFor(() => { expect(screen.getByLabelText('模型')).toBeTruthy() })
    // The seeding defaults landed, but the restore read is still pending: a
    // switch-induced remount here would previously commit the bare panel and
    // overwrite the stored state of the session being entered.
    fireEvent.change(screen.getByPlaceholderText('1girl, solo, masterpiece…'), { target: { value: 'typed mid-read' } })
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 600) }) })
    expect(props.commitWorkbenchState).not.toHaveBeenCalled()
    releaseRead?.()
    await act(async () => {})
    fireEvent.change(screen.getByPlaceholderText('1girl, solo, masterpiece…'), { target: { value: 'typed after read' } })
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 600) }) })
    expect(props.commitWorkbenchState).toHaveBeenCalledWith('session-1', expect.objectContaining({ prompt: 'typed after read' }))
  })

  it('holds the commit while the catalog seed is pending, since the bare pre-seed fields are the overwrite shape', async () => {
    const { props } = makeProps()
    const catalogStub = props.catalog as unknown as ReturnType<typeof vi.fn>
    let releaseCatalog: (() => void) | undefined
    catalogStub.mockImplementation(async () => await new Promise<typeof catalog>((resolve) => {
      releaseCatalog = () => { resolve(catalog) }
    }))
    render(<WorkbenchRoot {...(props as unknown as ComponentProps<typeof WorkbenchRoot>)} />)
    await act(async () => {})
    // The read settles instantly (undefined), but the seed is still pending:
    // committing now would publish width 0 and an empty checkpoint — the exact
    // shape that blanked stored sessions in the field.
    fireEvent.change(screen.getByPlaceholderText('1girl, solo, masterpiece…'), { target: { value: 'typed mid-seed' } })
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 600) }) })
    expect(props.commitWorkbenchState).not.toHaveBeenCalled()
    releaseCatalog?.()
    await waitFor(() => { expect(screen.getByLabelText('模型')).toBeTruthy() })
    fireEvent.change(screen.getByPlaceholderText('1girl, solo, masterpiece…'), { target: { value: 'typed after seed' } })
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 600) }) })
    expect(props.commitWorkbenchState).toHaveBeenCalledWith('session-1', expect.objectContaining({ prompt: 'typed after seed' }))
  })

  it('the rail cut generates through the conversation, not the direct remote', async () => {
    const { props } = makeProps()
    render(<WorkbenchRoot {...({ ...(props as unknown as ComponentProps<typeof WorkbenchRoot>), variant: 'rail' as const })} />)
    await waitFor(() => { expect(screen.getByLabelText('模型')).toBeTruthy() })
    fireEvent.change(screen.getByPlaceholderText('1girl, solo, masterpiece…'), { target: { value: 'park' } })
    // Two controls read 生成 (the tab strip and the run button); the run button is the last.
    fireEvent.click(screen.getAllByRole('button', { name: '生成' }).at(-1) as HTMLElement)
    expect(props.seedDraft).toHaveBeenCalledWith('session-1', expect.stringContaining('novelai_generate'))
    expect(props.generate).not.toHaveBeenCalled()
  })

  it('a batch run fires the configured count sequentially', async () => {
    const { props } = makeProps()
    render(<WorkbenchRoot {...(props as unknown as ComponentProps<typeof WorkbenchRoot>)} />)
    await waitFor(() => { expect(screen.getByLabelText('模型')).toBeTruthy() })
    fireEvent.change(screen.getByPlaceholderText('1girl, solo, masterpiece…'), { target: { value: 'park' } })
    fireEvent.change(screen.getByLabelText('批量张数'), { target: { value: '3' } })
    // Zero the interval for the loop test (the safe default is five seconds);
    // a sub-two-second setting first shows the loud risk warning.
    fireEvent.change(screen.getByLabelText('间隔（秒）'), { target: { value: '1' } })
    expect(screen.getByRole('alert').textContent).toContain('间隔过低')
    fireEvent.change(screen.getByLabelText('间隔（秒）'), { target: { value: '0' } })
    // The run button now announces the batch size through the t interpolation.
    const run = screen.getAllByRole('button', { name: /生成 3 张/ }).at(-1) as HTMLElement
    fireEvent.click(run)
    await waitFor(() => { expect(props.generate).toHaveBeenCalledTimes(3) })
    for (const call of props.generate.mock.calls) {
      expect(call[0]).toMatchObject({ prompt: 'park' })
    }
  })
})

describe('workbench state restore', () => {
  /** A committed panel state as the host would return it. */
  function stateFixture(overrides: Partial<NovelaiWorkbenchState> = {}): NovelaiWorkbenchState {
    return {
      prompt: 'restored prompt',
      negativePrompt: '',
      model: 'nai-diffusion-4-full',
      width: 1024,
      height: 768,
      steps: 30,
      cfgScale: 6,
      sampler: 'k_euler',
      noiseSchedule: 'exponential',
      ...overrides,
    }
  }

  /** Panel props bound to one session id (catalog mock identity is preserved). */
  function withSession(base: Record<string, unknown>, sessionId: string | undefined): Record<string, unknown> {
    return {
      ...base,
      useSessions: ((selector: (state: { current: string | undefined }) => unknown) => selector({ current: sessionId })) as never,
    }
  }

  it('applies the committed state on entry after the catalog seeding wins over the defaults', async () => {
    const { props, readWorkbenchState } = makeProps()
    readWorkbenchState.mockResolvedValue(stateFixture({
      negativePrompt: 'lowres, extra ears',
      seed: 42,
    }))
    const view = renderWith(withSession(props, 'session-1'))
    await waitFor(() => { expect(readWorkbenchState).toHaveBeenCalledWith('session-1') })
    await waitFor(() => {
      expect((screen.getByPlaceholderText('1girl, solo, masterpiece…') as HTMLTextAreaElement).value).toBe('restored prompt')
    })
    // Restored parameters win over the catalog defaults (the newest catalog model).
    expect((screen.getByLabelText('模型') as HTMLSelectElement).value).toBe('nai-diffusion-4-full')
    expect((screen.getByLabelText('宽度') as HTMLInputElement).value).toBe('1024')
    expect((screen.getByLabelText('高度') as HTMLInputElement).value).toBe('768')
    expect((screen.getByLabelText('步数') as HTMLInputElement).value).toBe('30')
    expect((screen.getByLabelText('采样器') as HTMLSelectElement).value).toBe('k_euler')
    expect((screen.getByLabelText('噪声调度') as HTMLSelectElement).value).toBe('exponential')
    // A restored seed switches the seed mode to fixed with the restored value.
    expect((screen.getByLabelText('种子值') as HTMLInputElement).value).toBe('42')
    // A non-empty restored negative prompt opens its fold.
    expect((screen.getByPlaceholderText('lowres, bad anatomy…') as HTMLTextAreaElement).value).toBe('lowres, extra ears')
    expect(view).toBeTruthy()
  })

  it('rehydrates stored character cards as drafts on entry', async () => {
    const { props, readWorkbenchState } = makeProps()
    readWorkbenchState.mockResolvedValue(stateFixture({
      characters: [
        { prompt: 'silver hair, salute', useCoords: false, x: 0.3, y: 0.5 },
        { prompt: 'cat ears, wave', negativePrompt: 'extra ears', useCoords: false, x: 0.7, y: 0.5 },
      ],
    }))
    renderWith(withSession(props, 'session-1'))
    await waitFor(() => { expect(readWorkbenchState).toHaveBeenCalledWith('session-1') })
    // The fold opens by itself and both cards land with their own prompts.
    await waitFor(() => { expect(screen.getByRole('button', { name: /角色提示词/ }).getAttribute('aria-expanded')).toBe('true') })
    expect((screen.getAllByLabelText('角色 1')[0] as HTMLTextAreaElement).value).toBe('silver hair, salute')
    expect((screen.getAllByLabelText('角色 2')[0] as HTMLTextAreaElement).value).toBe('cat ears, wave')
  })

  it('restores the stored batch settings with clamping and republishes them', async () => {
    const { props, readWorkbenchState } = makeProps()
    readWorkbenchState.mockResolvedValue(stateFixture({ batchCount: 99, batchIntervalSec: -5 }))
    renderWith(withSession(props, 'session-1'))
    await waitFor(() => { expect(readWorkbenchState).toHaveBeenCalledWith('session-1') })
    // Values outside the panel's own ranges clamp to 8 / 0 on rehydrate.
    await waitFor(() => {
      expect((screen.getByLabelText('批量张数') as HTMLInputElement).value).toBe('8')
    })
    expect((screen.getByLabelText('间隔（秒）') as HTMLInputElement).value).toBe('0')
    // The restored panel republishes the clamped values in its next commit.
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 600) }) })
    expect(props.commitWorkbenchState).toHaveBeenCalledWith('session-1', expect.objectContaining({
      batchCount: 8,
      batchIntervalSec: 0,
    }))
  })

  it('reads the session state once per entry and not again on re-renders', async () => {
    const { props, readWorkbenchState } = makeProps()
    const view = renderWith(withSession(props, 'session-1'))
    await waitFor(() => { expect(readWorkbenchState).toHaveBeenCalledTimes(1) })
    view.rerender(<WorkbenchRoot {...(withSession(props, 'session-1') as unknown as ComponentProps<typeof WorkbenchRoot>)} />)
    await act(async () => {})
    expect(readWorkbenchState).toHaveBeenCalledTimes(1)
  })

  it('skips the read entirely when the surface has no session', async () => {
    const { props, readWorkbenchState } = makeProps()
    renderWith(withSession(props, undefined))
    await act(async () => {})
    expect(readWorkbenchState).not.toHaveBeenCalled()
    // The catalog defaults still seed the panel.
    await waitFor(() => { expect(screen.getByLabelText('模型')).toBeTruthy() })
  })

  it('reads again when the session changes and applies the new session’s state', async () => {
    const { props, readWorkbenchState } = makeProps()
    readWorkbenchState.mockResolvedValueOnce(stateFixture({ prompt: 'session one' }))
    const view = renderWith(withSession(props, 'session-1'))
    await waitFor(() => {
      expect((screen.getByPlaceholderText('1girl, solo, masterpiece…') as HTMLTextAreaElement).value).toBe('session one')
    })
    readWorkbenchState.mockResolvedValueOnce(stateFixture({ prompt: 'session two', model: 'nai-diffusion-4-5-full' }))
    view.rerender(<WorkbenchRoot {...(withSession(props, 'session-2') as unknown as ComponentProps<typeof WorkbenchRoot>)} />)
    await waitFor(() => { expect(readWorkbenchState).toHaveBeenCalledWith('session-2') })
    await waitFor(() => {
      expect((screen.getByPlaceholderText('1girl, solo, masterpiece…') as HTMLTextAreaElement).value).toBe('session two')
    })
    expect((screen.getByLabelText('模型') as HTMLSelectElement).value).toBe('nai-diffusion-4-5-full')
  })

  it('re-restores a previous session when the active session returns to it', async () => {
    const { props, readWorkbenchState } = makeProps()
    readWorkbenchState.mockImplementation(async (sessionId: string) =>
      sessionId === 'session-1' ? stateFixture({ prompt: 'session one', model: 'nai-diffusion-4-full' }) : stateFixture({ prompt: 'session two', model: 'nai-diffusion-4-5-full' }))
    const view = renderWith(withSession(props, 'session-1'))
    await waitFor(() => {
      expect((screen.getByPlaceholderText('1girl, solo, masterpiece…') as HTMLTextAreaElement).value).toBe('session one')
    })
    view.rerender(<WorkbenchRoot {...(withSession(props, 'session-2') as unknown as ComponentProps<typeof WorkbenchRoot>)} />)
    await waitFor(() => {
      expect((screen.getByPlaceholderText('1girl, solo, masterpiece…') as HTMLTextAreaElement).value).toBe('session two')
    })
    // Back to session-1: the guard is per-id-change, not once per mount.
    view.rerender(<WorkbenchRoot {...(withSession(props, 'session-1') as unknown as ComponentProps<typeof WorkbenchRoot>)} />)
    await waitFor(() => {
      expect((screen.getByPlaceholderText('1girl, solo, masterpiece…') as HTMLTextAreaElement).value).toBe('session one')
    })
    expect((screen.getByLabelText('模型') as HTMLSelectElement).value).toBe('nai-diffusion-4-full')
    expect(readWorkbenchState).toHaveBeenCalledTimes(3)
    // Leaving the conversation entirely reads nothing further.
    view.rerender(<WorkbenchRoot {...(withSession(props, undefined) as unknown as ComponentProps<typeof WorkbenchRoot>)} />)
    await act(async () => {})
    expect(readWorkbenchState).toHaveBeenCalledTimes(3)
  })

  it('drops a late restore whose session changed before it resolved', async () => {
    const { props, readWorkbenchState } = makeProps()
    let resolveFirst: ((value: NovelaiWorkbenchState) => void) | undefined
    readWorkbenchState.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))
    const view = renderWith(withSession(props, 'session-1'))
    await waitFor(() => { expect(readWorkbenchState).toHaveBeenCalledTimes(1) })
    // The user switches sessions before the first read answers.
    readWorkbenchState.mockResolvedValueOnce(stateFixture({ prompt: 'session two' }))
    view.rerender(<WorkbenchRoot {...(withSession(props, 'session-2') as unknown as ComponentProps<typeof WorkbenchRoot>)} />)
    await waitFor(() => {
      expect((screen.getByPlaceholderText('1girl, solo, masterpiece…') as HTMLTextAreaElement).value).toBe('session two')
    })
    await act(async () => { resolveFirst?.(stateFixture({ prompt: 'late first session' })) })
    // The stale answer never clobbers the panel the user is looking at.
    expect((screen.getByPlaceholderText('1girl, solo, masterpiece…') as HTMLTextAreaElement).value).toBe('session two')
  })

  it('keeps the catalog defaults when the session has no committed state', async () => {
    const { props, readWorkbenchState } = makeProps()
    readWorkbenchState.mockResolvedValue(undefined)
    renderWith(withSession(props, 'session-1'))
    await waitFor(() => { expect(readWorkbenchState).toHaveBeenCalledTimes(1) })
    await waitFor(() => {
      expect((screen.getByLabelText('模型') as HTMLSelectElement).value).toBe('nai-diffusion-5-full')
    })
    expect((screen.getByPlaceholderText('1girl, solo, masterpiece…') as HTMLTextAreaElement).value).toBe('')
  })

  it('keeps the catalog defaults when the restore read fails', async () => {
    const { props, readWorkbenchState } = makeProps()
    readWorkbenchState.mockRejectedValueOnce(new Error('remote down'))
    renderWith(withSession(props, 'session-1'))
    await waitFor(() => { expect(readWorkbenchState).toHaveBeenCalledTimes(1) })
    // The restore is advisory: the failure is silent and the defaults stand.
    await waitFor(() => {
      expect((screen.getByLabelText('模型') as HTMLSelectElement).value).toBe('nai-diffusion-5-full')
    })
    expect((screen.getByPlaceholderText('1girl, solo, masterpiece…') as HTMLTextAreaElement).value).toBe('')
  })
})

describe('artist chains section', () => {
  /** Chain fixture as the host serves it (newest first). */
  function savedChain(id: string, name: string, tags: string): NovelaiArtistChain {
    return { id, name, tags }
  }

  const STANDARD = '0.3:cola gotouryouta::, 0.5:yoneyama mai::, 0.7:betabeet::, 0.9:re0n::, 1.8:kim hyung tae::'

  it('loads the library on first open and renders each named chain with its whole text', async () => {
    const { props, artistChains } = makeProps()
    artistChains.mockResolvedValue([
      savedChain('chain-1', '厚涂风', STANDARD),
      savedChain('chain-2', 'watercolor', '0.8:wlop::, 1.2:artgerm::'),
    ])
    renderWith(props)
    fireEvent.click(screen.getByRole('button', { name: /画师串/ }))
    await waitFor(() => { expect(artistChains).toHaveBeenCalledTimes(1) })
    // Each row shows the chain verbatim — no parsing, no recomposition.
    expect(await screen.findByText(STANDARD)).toBeTruthy()
    expect(screen.getByText('厚涂风')).toBeTruthy()
    expect(screen.getByText('watercolor')).toBeTruthy()
    expect(screen.getByText('0.8:wlop::, 1.2:artgerm::')).toBeTruthy()
    // Re-collapsing hides the section body; the library is not re-read.
    fireEvent.click(screen.getByRole('button', { name: /画师串/ }))
    expect(screen.queryByText('watercolor')).toBeNull()
    expect(artistChains).toHaveBeenCalledTimes(1)
  })

  it('shows the empty line before anything is saved', async () => {
    const { props } = makeProps()
    renderWith(props)
    fireEvent.click(screen.getByRole('button', { name: /画师串/ }))
    expect(await screen.findByText('还没有保存的画师串，在下方添加一条。')).toBeTruthy()
  })

  it('inserts a saved chain whole into an empty prompt', async () => {
    const { props } = makeProps()
    props.artistChains.mockResolvedValue([savedChain('chain-1', '厚涂风', STANDARD)])
    renderWith(props)
    fireEvent.click(screen.getByRole('button', { name: /画师串/ }))
    fireEvent.click(await screen.findByRole('button', { name: '插入' }))
    await waitFor(() => {
      expect((screen.getByPlaceholderText('1girl, solo, masterpiece…') as HTMLTextAreaElement).value).toBe(STANDARD)
    })
  })

  it('appends a saved chain to a non-empty prompt after trimming its trailing whitespace', async () => {
    const { props } = makeProps()
    props.artistChains.mockResolvedValue([savedChain('chain-1', 'watercolor', '0.8:wlop::, 1.2:artgerm::')])
    renderWith(props)
    fireEvent.click(screen.getByRole('button', { name: /画师串/ }))
    fireEvent.change(screen.getByPlaceholderText('1girl, solo, masterpiece…'), { target: { value: '1girl, park  ' } })
    fireEvent.click(await screen.findByRole('button', { name: '插入' }))
    await waitFor(() => {
      expect((screen.getByPlaceholderText('1girl, solo, masterpiece…') as HTMLTextAreaElement).value)
        .toBe('1girl, park, 0.8:wlop::, 1.2:artgerm::')
    })
  })

  it('saves a chain from the form with trimmed fields, then resets the inputs', async () => {
    const { props, saveArtistChain } = makeProps()
    renderWith(props)
    fireEvent.click(screen.getByRole('button', { name: /画师串/ }))
    fireEvent.change(screen.getByPlaceholderText('如「厚涂风」'), { target: { value: '  厚涂风 ' } })
    fireEvent.change(screen.getByPlaceholderText(/0\.3:cola gotouryouta::/), { target: { value: ` ${STANDARD} ` } })
    fireEvent.click(screen.getByRole('button', { name: '添加' }))
    await waitFor(() => { expect(saveArtistChain).toHaveBeenCalledWith({ id: '', name: '厚涂风', tags: STANDARD }) })
    // The inputs reset and the row renders from the returned library.
    await waitFor(() => { expect(screen.getByText('厚涂风')).toBeTruthy() })
    expect((screen.getByPlaceholderText('如「厚涂风」') as HTMLInputElement).value).toBe('')
    expect((screen.getByPlaceholderText(/0\.3:cola gotouryouta::/) as HTMLInputElement).value).toBe('')
  })

  it('keeps the save button disabled until both the name and the chain text are non-empty', () => {
    const { props } = makeProps()
    renderWith(props)
    fireEvent.click(screen.getByRole('button', { name: /画师串/ }))
    const add = screen.getByRole('button', { name: '添加' }) as HTMLButtonElement
    expect(add.disabled).toBe(true)
    fireEvent.change(screen.getByPlaceholderText('如「厚涂风」'), { target: { value: '厚涂风' } })
    expect((screen.getByRole('button', { name: '添加' }) as HTMLButtonElement).disabled).toBe(true)
    // A blank chain text keeps blocking; a non-blank one enables the save.
    fireEvent.change(screen.getByPlaceholderText(/0\.3:cola gotouryouta::/), { target: { value: '   ' } })
    expect((screen.getByRole('button', { name: '添加' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByPlaceholderText(/0\.3:cola gotouryouta::/), { target: { value: '0.9:re0n::' } })
    expect((screen.getByRole('button', { name: '添加' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('removes a chain and re-renders from the returned library', async () => {
    const { props, removeArtistChain } = makeProps()
    props.artistChains.mockResolvedValue([savedChain('chain-1', 'watercolor', '0.8:wlop::')])
    renderWith(props)
    fireEvent.click(screen.getByRole('button', { name: /画师串/ }))
    fireEvent.click(await screen.findByRole('button', { name: '删除' }))
    await waitFor(() => { expect(removeArtistChain).toHaveBeenCalledWith('chain-1') })
    // The removal answer is the new full library; the empty line returns.
    expect(await screen.findByText('还没有保存的画师串，在下方添加一条。')).toBeTruthy()
  })

  it('keeps the section usable when the lazy library read fails', async () => {
    const { props } = makeProps()
    props.artistChains.mockRejectedValueOnce(new Error('remote down'))
    renderWith(props)
    fireEvent.click(screen.getByRole('button', { name: /画师串/ }))
    // The failure is silent: the empty line stands and the form still works.
    expect(await screen.findByText('还没有保存的画师串，在下方添加一条。')).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText('如「厚涂风」'), { target: { value: '厚涂风' } })
    fireEvent.change(screen.getByPlaceholderText(/0\.3:cola gotouryouta::/), { target: { value: '0.9:re0n::' } })
    fireEvent.click(screen.getByRole('button', { name: '添加' }))
    expect(await screen.findByText('厚涂风')).toBeTruthy()
  })

  it('keeps the served library and the typed fields when a save fails', async () => {
    const { props, saveArtistChain } = makeProps()
    props.artistChains.mockResolvedValue([savedChain('chain-1', 'watercolor', '0.8:wlop::')])
    saveArtistChain.mockRejectedValueOnce(new Error('persist failed'))
    renderWith(props)
    fireEvent.click(screen.getByRole('button', { name: /画师串/ }))
    fireEvent.change(screen.getByPlaceholderText('如「厚涂风」'), { target: { value: '厚涂风' } })
    fireEvent.change(screen.getByPlaceholderText(/0\.3:cola gotouryouta::/), { target: { value: '0.9:re0n::' } })
    fireEvent.click(screen.getByRole('button', { name: '添加' }))
    await waitFor(() => { expect(saveArtistChain).toHaveBeenCalled() })
    // The failed save keeps the served library and the typed fields for a retry.
    expect(screen.getByText('watercolor')).toBeTruthy()
    expect(screen.queryByText('厚涂风')).toBeNull()
    expect((screen.getByPlaceholderText('如「厚涂风」') as HTMLInputElement).value).toBe('厚涂风')
    expect((screen.getByPlaceholderText(/0\.3:cola gotouryouta::/) as HTMLInputElement).value).toBe('0.9:re0n::')
  })

  it('keeps the row when a removal fails', async () => {
    const { props, removeArtistChain } = makeProps()
    props.artistChains.mockResolvedValue([savedChain('chain-1', 'watercolor', '0.8:wlop::')])
    removeArtistChain.mockRejectedValueOnce(new Error('persist failed'))
    renderWith(props)
    fireEvent.click(screen.getByRole('button', { name: /画师串/ }))
    fireEvent.click(await screen.findByRole('button', { name: '删除' }))
    await waitFor(() => { expect(removeArtistChain).toHaveBeenCalled() })
    // The failed removal keeps the row (re-addable small data, no error surface).
    expect(screen.getByText('watercolor')).toBeTruthy()
  })
})
