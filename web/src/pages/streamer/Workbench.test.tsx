import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ClipView, Danmaku, DraftBeat, WorkflowState } from '../../types'
import Workbench from './Workbench'

const baseWf = (phase: WorkflowState['phase']): WorkflowState => ({
  roomId: 'r1',
  phase,
  collectedDanmaku: [],
  draftBeats: [],
  confirmedBeats: [],
  generatedClips: [],
  scriptHistory: [],
  startedAt: 0,
})

const baseBeats: DraftBeat[] = [
  { id: 'b1', summary: 'A', shots: [{ id: 's1', beatId: 'b1', duration: 5, prompt: 'p' }], confirmed: false },
]

const baseClip: ClipView = { id: 'c1', shotId: 's1', url: '/clips/s1.mp4', duration: 5, readyAt: 0 }

const noop = () => undefined

function makeProps(over: Partial<Parameters<typeof Workbench>[0]> = {}) {
  return {
    wf: baseWf('idle'),
    busy: null,
    sessionId: 'sess_1',
    premise: '前提',
    resolution: '480P' as const,
    manualDmText: '',
    selectedDmIds: new Set<string>(),
    editedBeats: [] as DraftBeat[],
    activeUrl: null,
    roomId: 'r1',
    setPremise: noop,
    setResolution: noop,
    setManualDmText: noop,
    setActiveUrl: noop,
    onStartWizard: noop,
    onCollect: noop,
    onSubmitDm: noop,
    onAddManual: noop,
    onClearQueue: noop,
    onDeleteDm: noop,
    onToggleSelect: noop,
    onPickLiveDm: noop as (i: Danmaku) => void,
    onUpdateBeatSummary: noop,
    onUpdateShotPrompt: noop,
    onConfirmBeats: noop,
    onGenerateClips: noop,
    onResetWorkflow: noop,
    onRecoverWorkflow: noop,
    ...over,
  }
}

describe('Workbench collect button disabled rule', () => {
  // 收集按钮在 reviewing_danmaku / reviewing_beats / generating_* 阶段必须禁掉，
  // 防止用户重 collect 触发 server 端 soft reset 把已生成片段抹掉（bug a）。
  it.each([
    ['idle', false],
    ['completed', false],
    ['error', false],
    ['collecting_danmaku', true],
    ['reviewing_danmaku', true],
    ['generating_script', true],
    ['reviewing_beats', true],
    ['generating_clips', true],
  ] as const)('phase=%s → 获取弹幕按钮 disabled=%s', (phase, expected) => {
    render(<Workbench {...makeProps({ wf: baseWf(phase) })} />)
    const btn = screen.getByRole('button', { name: '获取弹幕' })
    if (expected) expect(btn).toBeDisabled()
    else expect(btn).not.toBeDisabled()
  })
})

describe('Workbench clip select wiring (bug c)', () => {
  it('点击缩略图会调用 setActiveUrl(url)', async () => {
    const setActiveUrl = vi.fn()
    const wf: WorkflowState = { ...baseWf('completed'), generatedClips: [baseClip] }
    render(<Workbench {...makeProps({ wf, setActiveUrl })} />)
    // ClipWall 渲染缩略图为 button（aria-label 包含"预览镜头"）
    await userEvent.click(screen.getByRole('button', { name: /预览镜头/ }))
    expect(setActiveUrl).toHaveBeenCalledWith('/clips/s1.mp4')
  })

  it('点击缩略图不会调用 setActiveUrl 当 clips 为空', () => {
    const setActiveUrl = vi.fn()
    render(<Workbench {...makeProps({ wf: baseWf('idle'), setActiveUrl })} />)
    expect(screen.queryByRole('button', { name: /预览镜头/ })).toBeNull()
    expect(setActiveUrl).not.toHaveBeenCalled()
  })
})

describe('Workbench beats panel render', () => {
  it('生成过剧本后显示拍数', () => {
    render(<Workbench {...makeProps({ editedBeats: baseBeats, wf: baseWf('reviewing_beats') })} />)
    expect(screen.getByText(/由弹幕生成的剧本 \(1\)/)).toBeInTheDocument()
  })

  it('没有拍时不显示剧本面板', () => {
    render(<Workbench {...makeProps({ editedBeats: [] })} />)
    expect(screen.queryByText(/由弹幕生成的剧本/)).toBeNull()
  })
})

describe('Workbench 剧本历史（scriptHistory）', () => {
  const historyRound1: import('@h3/protocol/types').Beat[] = [
    { id: 'h1', summary: '历史第 1 拍', shots: [{ id: 'hs1', beatId: 'h1', duration: 4, prompt: '历史镜头' }] },
  ]
  const historyRound2: import('@h3/protocol/types').Beat[] = [
    { id: 'r2a', summary: '历史第 2 轮 第 1 拍', shots: [{ id: 'r2s1', beatId: 'r2a', duration: 5, prompt: 'r2 镜头' }] },
    { id: 'r2b', summary: '历史第 2 轮 第 2 拍', shots: [{ id: 'r2s2', beatId: 'r2b', duration: 6, prompt: 'r2 镜头 2' }] },
  ]

  it('有 scriptHistory 时显示折叠区域', () => {
    const wf = { ...baseWf('completed'), scriptHistory: [historyRound1] }
    render(<Workbench {...makeProps({ wf })} />)
    const details = screen.getByText(/历史剧本/)
    expect(details).toBeInTheDocument()
  })

  it('无 scriptHistory 时不显示折叠区域', () => {
    render(<Workbench {...makeProps({ wf: baseWf('completed') })} />)
    expect(screen.queryByText(/历史剧本/)).toBeNull()
  })

  it('点击 summary 后展开历史拍数', async () => {
    const wf = { ...baseWf('completed'), scriptHistory: [historyRound1, historyRound2] }
    const { container } = render(<Workbench {...makeProps({ wf })} />)
    // jsdom 不会真的折叠 <details>，但 open 属性可以反映状态
    const details = container.querySelector('details.script-history')
    expect(details).not.toBeNull()
    expect(details?.hasAttribute('open')).toBe(false)
    // 点击展开
    await userEvent.click(screen.getByText(/历史剧本/))
    expect(details?.hasAttribute('open')).toBe(true)
    expect(screen.getByText(/历史第 1 拍/)).toBeInTheDocument()
    expect(screen.getByText(/历史第 2 轮 第 1 拍/)).toBeInTheDocument()
    expect(screen.getByText(/历史第 2 轮 第 2 拍/)).toBeInTheDocument()
  })

  it('历史拍数不可编辑（无 input/textarea）', async () => {
    const wf = { ...baseWf('completed'), scriptHistory: [historyRound1] }
    render(<Workbench {...makeProps({ wf })} />)
    await userEvent.click(screen.getByText(/历史剧本/))
    // 折叠区域内不应有 summary input 或 shot prompt textarea
    expect(screen.queryByLabelText('拍剧情一句话')).toBeNull()
    expect(screen.queryByLabelText(/分镜 hs1 prompt/)).toBeNull()
  })

  it('只有历史没有当前剧本时仍显示面板', () => {
    // 用户已确认并生成完成，生成完成后旧脚本已推到 history；当前无新剧本
    const wf = { ...baseWf('completed'), scriptHistory: [historyRound1] }
    render(<Workbench {...makeProps({ wf, editedBeats: [] })} />)
    expect(screen.getByText(/由弹幕生成的剧本/)).toBeInTheDocument()
  })

  it('当前一轮可编辑，历史一轮不可编辑（共存时区分）', async () => {
    const wf = { ...baseWf('reviewing_beats'), scriptHistory: [historyRound1] }
    render(<Workbench {...makeProps({ wf, editedBeats: baseBeats })} />)
    // 当前一轮有 summary input
    expect(screen.getByLabelText('拍剧情一句话')).toBeInTheDocument()
    // 展开历史
    await userEvent.click(screen.getByText(/历史剧本/))
    // 历史拍不应有 summary input（虽然有 history round 和 beat summary 文字）
    // 因为只有一个 input，确认当前可编辑
    expect(screen.getAllByLabelText('拍剧情一句话')).toHaveLength(1)
  })
})

describe('Workbench 启动按钮状态机联动', () => {
  // idle + 有 sessionId → 可点 + 显示 "▶ 启动"
  it('phase=idle, 有 session → 启动按钮可点击且显示"▶ 启动"', () => {
    render(<Workbench {...makeProps({ wf: baseWf('idle'), sessionId: 'sess_1' })} />)
    const btn = screen.getByRole('button', { name: /启动/ })
    expect(btn).toBeEnabled()
    expect(btn).toHaveTextContent('▶ 启动')
  })

  // 离开 idle（任意 phase）→ 置灰 + 显示 "已启动"
  it.each([
    'collecting_danmaku',
    'reviewing_danmaku',
    'generating_script',
    'reviewing_beats',
    'generating_clips',
    'completed',
    'error',
  ] as const)('phase=%s, 有 session → 启动按钮置灰且显示"已启动"', (phase) => {
    render(<Workbench {...makeProps({ wf: baseWf(phase), sessionId: 'sess_1' })} />)
    const btn = screen.getByRole('button', { name: /已启动/ })
    expect(btn).toBeDisabled()
    expect(btn).toHaveTextContent('已启动')
  })

  // 没 sessionId 永远禁（不论 phase）
  it('phase=idle, 无 session → 启动按钮依然置灰', () => {
    render(<Workbench {...makeProps({ wf: baseWf('idle'), sessionId: null })} />)
    const btn = screen.getByRole('button', { name: /启动/ })
    expect(btn).toBeDisabled()
  })

  // 重置回到 idle 后按钮恢复
  it('reset 后（phase=idle）启动按钮再次可点击', () => {
    const { rerender } = render(<Workbench {...makeProps({ wf: baseWf('reviewing_beats') })} />)
    expect(screen.getByRole('button', { name: /已启动/ })).toBeDisabled()
    rerender(<Workbench {...makeProps({ wf: baseWf('idle') })} />)
    const btn = screen.getByRole('button', { name: /启动/ })
    expect(btn).toBeEnabled()
    expect(btn).toHaveTextContent('▶ 启动')
  })
})
