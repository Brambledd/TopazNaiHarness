// @vitest-environment jsdom
/** Workbench panel behavior: catalog seeding, seed modes, negative fold, autocomplete, history. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import type { NovelaiGenerateRequest, NovelaiTagSuggestion } from '@deepseek-ai/dsh-api-novelai-controller/types'
import { WorkbenchRoot } from '../src/client/components.tsx'
import { wordAtCursor } from '../src/client/autocomplete.tsx'
import { CapsuleBrowser, STYLE_PRESETS } from '../src/client/capsule-picker.tsx'
import { CAPSULE_TAXONOMY, mergeCapsules, type CapsuleCategory } from '../src/client/capsule-data.ts'
import { resolutionForTier, snapDimensionWithinArea, maxDimensionFor } from '../src/client/resolution.ts'

const zh = {
  'mode.conversation': '对话',
  'mode.workbench': '创作台',
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
  'param.tier.0_4': '小图 · 0.4 MP',
  'param.tier.1': '普通 · 1 MP',
  'param.tier.1_5': '大图 · 1.5 MP',
  'param.tier.2': '超大图 · 2 MP',
  'param.tier.3': '最大 · 3 MP',
  'size.commitHint': '失焦或回车后对齐到 64 像素',
  'capsule.label': '快捷标签',
  'capsule.filter': '搜索标签（中英文均可）',
  'styles.label': '风格库',
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
  'history.label': '历史',
  'history.empty': '还没有图片',
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
  models: ['nai-diffusion-4-5-full', 'nai-diffusion-4-full'],
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
  const splitCharacters = vi.fn(async (_request: { prompt: string }) => ({
    prompt: 'park, masterpiece',
    characters: [
      { prompt: '1girl, blue hair', negativePrompt: '', useCoords: false, x: 0.5, y: 0.5 },
      { prompt: '1girl, red hair', negativePrompt: 'extra ears', useCoords: false, x: 0.5, y: 0.5 },
    ],
  }))
  const suggestions: NovelaiTagSuggestion[] = [
    { tag: '1girl', count: 19_000_000, category: 0, description: '一个女孩' },
    { tag: '1boy', count: 8_000_000, category: 0, description: '一个男孩' },
  ]
  const props = {
    catalog: vi.fn(async () => catalog),
    estimate: vi.fn(async () => ({ anlas: 0 })),
    generate,
    history: vi.fn(async () => ({ entries: historyEntries, total: historyEntries.length })),
    suggestTags: vi.fn(async () => ({ tags: suggestions })),
    readEntry: vi.fn(async () => ({ data: '', mime: 'image/png' as const })),
    splitCharacters,
    setViewMode: vi.fn(),
    useSessions: (() => { throw new Error('workbench must not read global hooks') }) as never,
    useWorkspaces: (() => { throw new Error('workbench must not read global hooks') }) as never,
    t: (key: keyof typeof zh) => zh[key],
  }
  return { props, generate, splitCharacters }
}

function mount() {
  const { props, generate, splitCharacters } = makeProps()
  const view = render(<WorkbenchRoot {...(props as unknown as ComponentProps<typeof WorkbenchRoot>)} />)
  return { view, generate, splitCharacters }
}

afterEach(() => { cleanup(); vi.useRealTimers() })

describe('workbench panel', () => {
  it('seeds the parameter panel from the catalog defaults', async () => {
    mount()
    await waitFor(() => {
      const model = screen.getByLabelText('模型') as HTMLSelectElement
      expect(model.value).toBe('nai-diffusion-4-5-full')
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

  it('omits the seed in random mode and sends it in fixed mode', async () => {
    const { generate } = mount()
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

  it('offers style presets and appends them on click from the workbench', async () => {
    mount()
    await waitFor(() => { expect(screen.getByLabelText('模型')).toBeTruthy() })
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
      expect(props.suggestTags).toHaveBeenCalledWith({ prompt: '1gi', model: 'nai-diffusion-4-5-full' })
    }, { timeout: 3000 })
    const option = await screen.findByRole('option', { name: /1girl/ }, { timeout: 3000 })
    fireEvent.mouseDown(option)
    expect(area.value).toBe('1girl, ')
  })

  it('shows the history grid and opens the lightbox', async () => {
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
    const tile = await screen.findByRole('button', { name: 'a cat' }, { timeout: 3000 })
    fireEvent.click(tile)
    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '回填参数' }))
    const area = screen.getByPlaceholderText('1girl, solo, masterpiece…') as HTMLTextAreaElement
    expect(area.value).toBe('a cat')
    const seedInput = screen.getByLabelText('种子值') as HTMLInputElement
    expect(seedInput.value).toBe('42')
  })
})

describe('character prompts', () => {
  /** Open the character fold after the catalog defaults have landed. */
  async function openCharacters(): Promise<void> {
    await waitFor(() => { expect(screen.getByLabelText('模型')).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: /角色提示词/ }))
  }

  it('adds a character card and submits it with the generation', async () => {
    const { generate } = mount()
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
    const { generate } = mount()
    await openCharacters()
    fireEvent.change(screen.getByPlaceholderText('1girl, solo, masterpiece…'), { target: { value: 'a cat' } })
    fireEvent.click(screen.getByRole('button', { name: '生成' }))
    await waitFor(() => { expect(generate).toHaveBeenCalledOnce() })
    expect('characters' in generate.mock.calls[0]![0]).toBe(false)
  })

  it('splits the merged prompt into base and character cards with one LLM call', async () => {
    const { splitCharacters } = mount()
    await waitFor(() => { expect(screen.getByLabelText('模型')).toBeTruthy() })
    // The split button lives beside the prompt, outside the character fold.
    expect(screen.getByRole('button', { name: 'AI 拆分角色' })).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText('1girl, solo, masterpiece…'), { target: { value: 'park, 2girls, blue hair, red hair' } })
    fireEvent.click(screen.getByRole('button', { name: 'AI 拆分角色' }))
    expect(splitCharacters).toHaveBeenCalledWith({ prompt: 'park, 2girls, blue hair, red hair' })
    await waitFor(() => {
      expect((screen.getByPlaceholderText('1girl, solo, masterpiece…') as HTMLTextAreaElement).value).toBe('park, masterpiece')
    })
    expect(screen.getByLabelText('角色 1')).toBeTruthy()
    expect(screen.getByLabelText('角色 2')).toBeTruthy()
    expect((screen.getByLabelText('角色 1') as HTMLTextAreaElement).value).toBe('1girl, blue hair')
    expect((screen.getByLabelText('角色 2 负面') as HTMLTextAreaElement).value).toBe('extra ears')
  })

  it('toggles custom placement and edits coordinates as percentages', async () => {
    const { generate } = mount()
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
    expect((screen.getByLabelText('角色 1') as HTMLTextAreaElement).value).toBe('')
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
    fireEvent.click(screen.getByRole('button', { name: '回填参数' }))
    expect(screen.getByLabelText('角色 1')).toBeTruthy()
    expect((screen.getByLabelText('角色 1') as HTMLTextAreaElement).value).toBe('1girl, blue hair')
    fireEvent.click(screen.getByRole('button', { name: 'park' }), { detail: 1 })
    fireEvent.click(await screen.findByRole('button', { name: '变体' }, { timeout: 3000 }))
    await waitFor(() => { expect(generate).toHaveBeenCalledOnce() })
    expect(generate.mock.calls[0]![0].characters).toEqual([
      { prompt: '1girl, blue hair', negativePrompt: '', useCoords: false, x: 0.5, y: 0.5 },
    ])
  })

  it('enforces the V4.5 capacity of six cards', async () => {
    mount()
    await openCharacters()
    for (let i = 0; i < 6; i += 1) {
      fireEvent.click(screen.getByRole('button', { name: '添加角色' }))
    }
    expect(screen.getByLabelText('角色 6')).toBeTruthy()
    expect((screen.getByRole('button', { name: '添加角色' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
