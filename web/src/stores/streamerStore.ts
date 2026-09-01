import { create } from 'zustand'
import type { LogLine, LogKind, LogStage, StreamStatus } from '../types'
import { classifyLog } from '../api'

/** 第三方调用 addLog 时可传入的扩展字段（stage + 任意附属字段）。 */
export interface AddLogExtras {
  stage?: LogStage
  danmakuId?: string
  clipId?: string
  durationMs?: number
}

interface StreamerState {
  sessionId: string | null
  mock: boolean
  /** 服务端启动级 mock（process.env.MOCK=1 / cfg.mock）。true 时 session 端传真 key 也无效。 */
  serverMock: boolean | null
  status: StreamStatus | null
  logs: LogLine[]
  wsConnected: boolean
  setSession: (sessionId: string | null, mock: boolean) => void
  setServerMock: (b: boolean) => void
  setStatus: (s: StreamStatus | null) => void
  /** 添加一条日志；extras 可携带 stage/danmakuId/clipId/durationMs 让 Log 标签页可分类展示 */
  addLog: (msg: string, kind?: LogKind, extras?: AddLogExtras) => void
  setWs: (connected: boolean) => void
  clearLogs: () => void
  reset: () => void
}

export const useStreamer = create<StreamerState>((set) => ({
  sessionId: sessionStorage.getItem('h3_session_id'),
  mock: false,
  serverMock: null,
  status: null,
  logs: [],
  wsConnected: false,
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
  reset: () => set({ status: null, logs: [], wsConnected: false }),
}))
