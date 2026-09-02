import { create } from 'zustand'
import type { Danmaku, DanmakuItem, LiveDanmakuStatus, LogLine, LogKind, LogStage, StreamStatus } from '../types'
import { classifyLog } from '../api'

/** 第三方调用 addLog 时可传入的扩展字段（stage + 任意附属字段）。 */
export interface AddLogExtras {
  stage?: LogStage
  danmakuId?: string
  clipId?: string
  durationMs?: number
}

export type LiveSource = 'douyin' | 'mock' | 'none'

const LIVE_DANMAKU_CAP = 200

interface StreamerState {
  sessionId: string | null
  mock: boolean
  /** 服务端启动级 mock（process.env.MOCK=1 / cfg.mock）。true 时 session 端传真 key 也无效。 */
  serverMock: boolean | null
  status: StreamStatus | null
  logs: LogLine[]
  wsConnected: boolean
  /** 右栏实时弹幕流：ring buffer 200，旧的滚出不持久化 */
  liveDanmaku: Danmaku[]
  /** 实时流连接状态（来自 liveDanmakuStatus 事件） */
  liveStreamStatus: LiveDanmakuStatus
  /** 实时流来源（douyin / mock / none） */
  liveSource: LiveSource
  setSession: (sessionId: string | null, mock: boolean) => void
  setServerMock: (b: boolean) => void
  setStatus: (s: StreamStatus | null) => void
  /** 添加一条日志；extras 可携带 stage/danmakuId/clipId/durationMs 让 Log 标签页可分类展示 */
  addLog: (msg: string, kind?: LogKind, extras?: AddLogExtras) => void
  setWs: (connected: boolean) => void
  clearLogs: () => void
  /** 推一条实时弹幕进 ring buffer；超 200 时丢最旧 */
  appendLiveDanmaku: (item: DanmakuItem) => void
  /** 流状态变化（来自 WS liveDanmakuStatus） */
  setLiveStatus: (status: LiveDanmakuStatus, source?: LiveSource) => void
  /** 清空 ring buffer（用户主动 / 重连场景） */
  clearLiveDanmaku: () => void
  reset: () => void
}

export const useStreamer = create<StreamerState>((set) => ({
  sessionId: sessionStorage.getItem('h3_session_id'),
  mock: false,
  serverMock: null,
  status: null,
  logs: [],
  wsConnected: false,
  liveDanmaku: [],
  liveStreamStatus: 'idle',
  liveSource: 'none',
  setSession: (sessionId, mock) => {
    if (sessionId) sessionStorage.setItem('h3_session_id', sessionId)
    else sessionStorage.removeItem('h3_session_id')
    set({ sessionId, mock })
  },
  setServerMock: (serverMock) => set({ serverMock }),
  setStatus: (status) => set({ status }),
  addLog: (msg, kind, extras) =>
    set((s) => {
      const line: LogLine = {
        ts: Date.now(),
        msg,
        kind: kind ?? classifyLog(msg),
        stage: extras?.stage,
        danmakuId: extras?.danmakuId,
        clipId: extras?.clipId,
        durationMs: extras?.durationMs,
      }
      const logs = [...s.logs, line]
      if (logs.length > 300) logs.splice(0, logs.length - 300)
      return { logs }
    }),
  setWs: (wsConnected) => set({ wsConnected }),
  clearLogs: () => set({ logs: [] }),
  appendLiveDanmaku: (item) =>
    set((s) => {
      // 同 id 已存在：跳过（避免重复推送产生噪声）
      if (s.liveDanmaku.some((d) => d.id === item.id)) return s
      const view: Danmaku = { id: item.id, user: item.user, text: item.text, ts: item.ts }
      const next = [...s.liveDanmaku, view]
      if (next.length > LIVE_DANMAKU_CAP) next.splice(0, next.length - LIVE_DANMAKU_CAP)
      return { liveDanmaku: next }
    }),
  setLiveStatus: (liveStreamStatus, source) =>
    set((s) => ({
      liveStreamStatus,
      liveSource: source ?? s.liveSource,
    })),
  clearLiveDanmaku: () => set({ liveDanmaku: [] }),
  reset: () => set({ status: null, logs: [], wsConnected: false, liveDanmaku: [], liveStreamStatus: 'idle', liveSource: 'none' }),
}))
