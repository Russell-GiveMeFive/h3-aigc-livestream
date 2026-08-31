export type ShotStatus = 'queued' | 'running' | 'ready' | 'failed'

export interface ShotView {
  id: string
  beatId: string
  prompt: string
  duration: number
  status: ShotStatus
}

export interface BeatView {
  id: string
  summary: string
  shots: ShotView[]
}

export interface ClipView {
  id: string
  shotId: string
  url: string
  duration: number
  readyAt: number
}

export type StreamPhase = 'idle' | 'splitting' | 'running' | 'stopping' | 'stopped' | 'error'

export interface StreamStatus {
  roomId: string
  phase: StreamPhase
  hlsUrl: string
  rtmpUrl: string
  mock: boolean
  mode: 'ai' | 'suggest' | 'crowd'
  resolution: '480P' | '768P'
  bufferedSec: number
  readyClips: number
  pendingShots: number
  runningTasks: number
  avgGenLatencyMs: number | null
  clipsProduced: number
  clipsPlayed: number
  currentBeatSummary: string | null
  error?: string
  startedAt: number
  beats: BeatView[]
  clips: ClipView[]
}

export interface SessionResp {
  sessionId: string
  mock: boolean
}

export interface StartResp {
  roomId: string
  hlsUrl: string
  rtmpUrl: string
  viewerUrl: string
}

export type VideoResolution = '480P' | '768P'

export interface Danmaku {
  id: string
  user: string
  text: string
  ts: number
}

export interface WsEvent {
  type: 'log' | 'clip' | 'beat' | 'phase' | 'error' | 'danmaku'
  msg?: string
  id?: string
  user?: string
  text?: string
  ts?: number
  summary?: string
  shots?: number
  shotId?: string
  url?: string
  duration?: number
}

export type LogKind = 'info' | 'ok' | 'warn' | 'err'

export interface LogLine {
  ts: number
  msg: string
  kind: LogKind
}
