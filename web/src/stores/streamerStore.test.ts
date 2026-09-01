import { describe, expect, it, beforeEach } from 'vitest'
import { useStreamer } from './streamerStore'

describe('streamerStore', () => {
  beforeEach(() => {
    useStreamer.getState().reset()
    sessionStorage.clear()
  })

  it('initial state is empty', () => {
    const s = useStreamer.getState()
    expect(s.sessionId).toBeNull()
    expect(s.mock).toBe(false)
    expect(s.serverMock).toBeNull()
    expect(s.logs).toEqual([])
    expect(s.wsConnected).toBe(false)
  })

  it('addLog appends a LogLine with defaults', () => {
    useStreamer.getState().addLog('hello')
    const { logs } = useStreamer.getState()
    expect(logs).toHaveLength(1)
    expect(logs[0].msg).toBe('hello')
    expect(logs[0].ts).toBeTypeOf('number')
    expect(logs[0].kind).toBeDefined()
  })

  it('addLog carries stage/danmakuId/clipId/durationMs when extras passed', () => {
    useStreamer.getState().addLog('gen ok', 'ok', { stage: 'gen', clipId: 'shot-1', durationMs: 1234 })
    const { logs } = useStreamer.getState()
    expect(logs[0].stage).toBe('gen')
    expect(logs[0].clipId).toBe('shot-1')
    expect(logs[0].durationMs).toBe(1234)
  })

  it('addLog caps at 300 lines, FIFO', () => {
    const { addLog } = useStreamer.getState()
    for (let i = 0; i < 305; i++) addLog(`m${i}`)
    const { logs } = useStreamer.getState()
    expect(logs).toHaveLength(300)
    expect(logs[0].msg).toBe('m5')
    expect(logs[299].msg).toBe('m304')
  })

  it('clearLogs empties the buffer', () => {
    useStreamer.getState().addLog('a')
    useStreamer.getState().addLog('b')
    useStreamer.getState().clearLogs()
    expect(useStreamer.getState().logs).toEqual([])
  })

  it('setSession persists sessionId to sessionStorage', () => {
    useStreamer.getState().setSession('sess_xyz', true)
    expect(sessionStorage.getItem('h3_session_id')).toBe('sess_xyz')
    expect(useStreamer.getState().mock).toBe(true)
  })

  it('setSession(null) removes sessionId from storage', () => {
    useStreamer.getState().setSession('sess_xyz', false)
    useStreamer.getState().setSession(null, false)
    expect(sessionStorage.getItem('h3_session_id')).toBeNull()
  })

  it('setWs toggles WS indicator', () => {
    useStreamer.getState().setWs(true)
    expect(useStreamer.getState().wsConnected).toBe(true)
    useStreamer.getState().setWs(false)
    expect(useStreamer.getState().wsConnected).toBe(false)
  })

  it('setServerMock persists server-level mock flag from /api/health', () => {
    expect(useStreamer.getState().serverMock).toBeNull()
    useStreamer.getState().setServerMock(true)
    expect(useStreamer.getState().serverMock).toBe(true)
    useStreamer.getState().setServerMock(false)
    expect(useStreamer.getState().serverMock).toBe(false)
  })

  it('reset wipes status/logs/ws but keeps sessionId', () => {
    useStreamer.getState().setSession('keep', true)
    useStreamer.getState().setStatus({} as any)
    useStreamer.getState().addLog('x')
    useStreamer.getState().setWs(true)
    useStreamer.getState().reset()
    const s = useStreamer.getState()
    expect(s.sessionId).toBe('keep')
    expect(s.status).toBeNull()
    expect(s.logs).toEqual([])
    expect(s.wsConnected).toBe(false)
  })
})