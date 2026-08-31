import { create } from 'zustand'
import type { LogLine, LogKind, StreamStatus } from '../types'
import { classifyLog } from '../api'

interface StreamerState {
  sessionId: string | null
  mock: boolean
  status: StreamStatus | null
  logs: LogLine[]
  wsConnected: boolean
  setSession: (sessionId: string | null, mock: boolean) => void
  setStatus: (s: StreamStatus | null) => void
  addLog: (msg: string, kind?: LogKind) => void
  setWs: (connected: boolean) => void
  clearLogs: () => void
  reset: () => void
}

export const useStreamer = create<StreamerState>((set) => ({
  sessionId: sessionStorage.getItem('h3_session_id'),
  mock: false,
  status: null,
  logs: [],
  wsConnected: false,
  setSession: (sessionId, mock) => {
    if (sessionId) sessionStorage.setItem('h3_session_id', sessionId)
    else sessionStorage.removeItem('h3_session_id')
    set({ sessionId, mock })
  },
  setStatus: (status) => set({ status }),
  addLog: (msg, kind) =>
    set((s) => {
      const line: LogLine = { ts: Date.now(), msg, kind: kind ?? classifyLog(msg) }
      const logs = [...s.logs, line]
      if (logs.length > 300) logs.splice(0, logs.length - 300)
      return { logs }
    }),
  setWs: (wsConnected) => set({ wsConnected }),
  clearLogs: () => set({ logs: [] }),
  reset: () => set({ status: null, logs: [], wsConnected: false }),
}))
