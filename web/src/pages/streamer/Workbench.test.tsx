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
