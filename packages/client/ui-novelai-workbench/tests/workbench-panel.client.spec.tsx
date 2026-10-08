// @vitest-environment jsdom
/** Workbench panel behavior: catalog seeding, seed modes, negative fold, request assembly. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import type { NovelaiGenerateRequest } from '@deepseek-ai/dsh-api-novelai-controller/types'
import { WorkbenchRoot } from '../src/client/components.tsx'
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
  'history.empty': '还没有图片',
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

function makeProps() {
  const generate = vi.fn(async (_request: NovelaiGenerateRequest) => ({
    id: 'x',
    file: 'workspace/novelai/x.png',
    bytes: 1,
    seed: 1234,
    anlasEstimate: 0,
    createdAt: '2026-10-08T00:00:00Z',
  }))
  const props = {
    catalog: vi.fn(async () => catalog),
    estimate: vi.fn(async () => ({ anlas: 0 })),
    generate,
    history: vi.fn(async () => ({ entries: [], total: 0 })),
    setViewMode: vi.fn(),
    useSessions: (() => { throw new Error('workbench must not read global hooks') }) as never,
    useWorkspaces: (() => { throw new Error('workbench must not read global hooks') }) as never,
    t: (key: keyof typeof zh) => zh[key],
  }
  return { props, generate }
}

function mount() {
  const { props, generate } = makeProps()
  const view = render(<WorkbenchRoot {...(props as unknown as ComponentProps<typeof WorkbenchRoot>)} />)
  return { view, generate }
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
