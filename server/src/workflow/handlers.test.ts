import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { WorkflowState, Beat, DraftBeat } from '@h3/protocol/types'

const storeState: Record<string, WorkflowState> = {}

vi.mock('./store', () => ({
  workflowStore: {
    get: (roomId: string): WorkflowState => {
      if (!storeState[roomId]) {
        storeState[roomId] = {
          roomId,
          phase: 'reviewing_beats',
          collectedDanmaku: [],
          draftBeats: [],
          confirmedBeats: [],
          generatedClips: [],
          scriptHistory: [],
          startedAt: 0,
        }
      }
      return storeState[roomId]
    },
    upsert: (s: WorkflowState) => {
      storeState[s.roomId] = s
    },
    reset: (roomId: string) => {
      delete storeState[roomId]
    },
  },
}))

vi.mock('../story/splitter', () => ({
  AiStorySplitter: class {
    async split() {
      return { beats: [] as Beat[] }
    }
  },
}))

vi.mock('../factory/providerFactory', () => ({
  makeProviders: () => ({
    text: undefined,
    video: undefined,
    linker: undefined,
  }),
  makeDefaultErrorPolicy: () => ({ classify: () => 'fatal' as const }),
}))

const makeHub = () => ({
  bus: () => ({
    emit: () => undefined,
    on: () => undefined,
    off: () => undefined,
    removeAllListeners: () => undefined,
  }),
})

const baseDeps = (mock = true) =>
  ({
    hub: makeHub() as never,
    cfg: {
      cacheDir: '',
      ffmpeg: '',
      mockCardScript: false,
      python: '',
      minimax: undefined,
      gen: { concurrency: 1, maxRetries: 0, pollIntervalMs: 1000 },
      mock: true,
    } as never,
    mock,
    apiKey: '',
  })

const blankState = (roomId: string): WorkflowState => ({
  roomId,
  phase: 'reviewing_beats',
  collectedDanmaku: [],
  draftBeats: [],
  confirmedBeats: [],
  generatedClips: [],
  scriptHistory: [],
  startedAt: 0,
})

const sampleBeats = (label: string): DraftBeat[] => [
  {
    id: `${label}-b1`,
    summary: `${label} 拍`,
    confirmed: false,
    shots: [
      { id: `${label}-s1`, beatId: `${label}-b1`, prompt: `${label} prompt`, duration: 4 },
    ],
  },
]

describe('handleConfirmBeats → 确认即归档（draftBeats 清空 + 推入 scriptHistory）', () => {
  beforeEach(() => {
    for (const k of Object.keys(storeState)) delete storeState[k]
  })

  it('第 1 次 confirm → 本轮剧本立即入 history，draftBeats 清空', async () => {
    const { handleConfirmBeats } = await import('./handlers')
    storeState['r1'] = { ...blankState('r1'), draftBeats: sampleBeats('R1') }
    const r = await handleConfirmBeats(baseDeps(), 'r1', { beats: sampleBeats('R1') })
    expect(r.state.confirmedBeats).toHaveLength(1)
    expect(r.state.confirmedBeats[0].summary).toBe('R1 拍')
    expect(r.state.draftBeats).toEqual([])
    expect(r.state.scriptHistory).toHaveLength(1)
    expect(r.state.scriptHistory[0][0].summary).toBe('R1 拍')
    expect(r.state.phase).toBe('generating_clips')
  })

  it('归档的是用户编辑后的 incoming，而非 store 里的原始 draftBeats', async () => {
    const { handleConfirmBeats } = await import('./handlers')
    storeState['r1'] = { ...blankState('r1'), draftBeats: sampleBeats('R1') }
    const edited = sampleBeats('R1')
    edited[0].summary = 'R1 拍（主播改过）'
    const r = await handleConfirmBeats(baseDeps(), 'r1', { beats: edited })
    expect(r.state.scriptHistory[0][0].summary).toBe('R1 拍（主播改过）')
  })

  it('连续 2 轮：history 按顺序累积 [R1, R2]，每轮 confirm 后 draftBeats 都为空', async () => {
    const { handleConfirmBeats } = await import('./handlers')
    storeState['r1'] = { ...blankState('r1'), draftBeats: sampleBeats('R1') }
    const c1 = await handleConfirmBeats(baseDeps(), 'r1', { beats: sampleBeats('R1') })
    expect(c1.state.draftBeats).toEqual([])

    // 新一轮 submit 的效果：只覆盖 draftBeats，不动 history
    storeState['r1'] = { ...c1.state, phase: 'reviewing_beats', draftBeats: sampleBeats('R2') }
    const c2 = await handleConfirmBeats(baseDeps(), 'r1', { beats: sampleBeats('R2') })
    expect(c2.state.confirmedBeats[0].summary).toBe('R2 拍')
    expect(c2.state.draftBeats).toEqual([])
    expect(c2.state.scriptHistory).toHaveLength(2)
    expect(c2.state.scriptHistory[0][0].summary).toBe('R1 拍')
    expect(c2.state.scriptHistory[1][0].summary).toBe('R2 拍')
  })

  it('连续 3 轮 → history 恰好 3 项且互不重复（回归：不重复推入同一轮）', async () => {
    const { handleConfirmBeats } = await import('./handlers')
    storeState['r1'] = { ...blankState('r1'), draftBeats: sampleBeats('R1') }
    const c1 = await handleConfirmBeats(baseDeps(), 'r1', { beats: sampleBeats('R1') })
    storeState['r1'] = { ...c1.state, phase: 'reviewing_beats', draftBeats: sampleBeats('R2') }
    const c2 = await handleConfirmBeats(baseDeps(), 'r1', { beats: sampleBeats('R2') })
    storeState['r1'] = { ...c2.state, phase: 'reviewing_beats', draftBeats: sampleBeats('R3') }
    const c3 = await handleConfirmBeats(baseDeps(), 'r1', { beats: sampleBeats('R3') })
    expect(c3.state.scriptHistory).toHaveLength(3)
    const all = c3.state.scriptHistory.flat().map((b) => b.summary)
    expect(all).toEqual(['R1 拍', 'R2 拍', 'R3 拍'])
    expect(new Set(all).size).toBe(all.length)
  })

  it('beats 为空 → 400，history 不受影响', async () => {
    const { handleConfirmBeats } = await import('./handlers')
    storeState['r1'] = { ...blankState('r1'), draftBeats: sampleBeats('R1') }
    await expect(handleConfirmBeats(baseDeps(), 'r1', { beats: [] })).rejects.toThrow(/不能为空/)
    expect(storeState['r1'].scriptHistory).toEqual([])
  })
})