import type { SessionResp, StartResp, StreamStatus } from './types'
import type {
  AppConfig,
  ConfigResp,
  DanmakuItem,
  DraftBeat,
  HistoryEntry,
  LiveDanmakuStatus,
  WorkflowState,
} from '@h3/protocol/types'

export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const merged: RequestInit = {
    ...(init ?? {}),
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  }
  const res = await fetch(path, merged)
  const data = (await res.json().catch(() => ({}))) as { error?: string } & T
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
  return data
}

export function wsUrl(room: string): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${location.host}/ws?room=${encodeURIComponent(room)}`
}

export function createSession(apiKey: string): Promise<SessionResp> {
  return api<SessionResp>('/api/session', { method: 'POST', body: JSON.stringify({ apiKey }) })
}

export function startStream(sessionId: string, script: string, title: string, resolution: '480P' | '768P'): Promise<StartResp> {
  return api<StartResp>('/api/stream/start', {
    method: 'POST',
    body: JSON.stringify({ sessionId, script, title, resolution }),
  })
}

export function stopStream(sessionId: string): Promise<{ ok: boolean }> {
  return api<{ ok: boolean }>('/api/stream/stop', { method: 'POST', body: JSON.stringify({ sessionId }) })
}

export function fetchStatus(room: string): Promise<StreamStatus> {
  return api<StreamStatus>(`/api/stream/status?room=${encodeURIComponent(room)}`)
}

export function timeOf(ts?: number): string {
  if (!ts) return '--:--:--'
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false })
}

export function classifyLog(msg: string): 'info' | 'ok' | 'warn' | 'err' {
  if (msg.startsWith('✅') || msg.startsWith('🎬') || msg.startsWith('📤') || msg.startsWith('📝')) return 'ok'
  if (msg.startsWith('⚠️') || msg.startsWith('⏳')) return 'warn'
  if (msg.startsWith('❌') || msg.startsWith('💥')) return 'err'
  return 'info'
}

// ── 历史 viewer ──

export function listHistory(): Promise<{ entries: HistoryEntry[] }> {
  return api<{ entries: HistoryEntry[] }>('/api/history')
}

export function getHistory(id: string): Promise<HistoryEntry> {
  return api<HistoryEntry>(`/api/history/${encodeURIComponent(id)}`)
}

export function getHistoryClipUrl(id: string, clipId: string): string {
  return `/api/history/${encodeURIComponent(id)}/clips/${encodeURIComponent(clipId)}`
}

// ── 设置页 ──

export function fetchConfig(): Promise<ConfigResp> {
  return api<ConfigResp>('/api/config')
}

export function saveConfig(cfg: AppConfig): Promise<ConfigResp> {
  return api<ConfigResp>('/api/config', { method: 'POST', body: JSON.stringify(cfg) })
}

// ── 手动工作流 API（Requirement 3：替代旧的自动 Director 循环） ──

export function getWorkflow(roomId: string): Promise<WorkflowState> {
  return api<WorkflowState>(`/api/workflow/${encodeURIComponent(roomId)}`)
}

// ── 实时弹幕流 API（LiveDanmakuStreamer） ──

export function startLiveDanmaku(
  roomId: string,
): Promise<{ status: LiveDanmakuStatus; source: 'douyin' | 'mock' | 'none' }> {
  return api('/api/workflow/live-danmaku/start', {
    method: 'POST',
    body: JSON.stringify({ roomId }),
  })
}

export function stopLiveDanmaku(roomId: string): Promise<{ ok: boolean }> {
  return api<{ ok: boolean }>('/api/workflow/live-danmaku/stop', {
    method: 'POST',
    body: JSON.stringify({ roomId }),
  })
}

export function getLiveDanmakuStatus(
  roomId: string,
): Promise<{ status: LiveDanmakuStatus; source: 'douyin' | 'mock' | 'none' }> {
  return api(`/api/workflow/live-danmaku/status?room=${encodeURIComponent(roomId)}`)
}

/**
 * @deprecated 批量 collect 已废弃。LiveDanmakuStreamer 持续推送 + 右栏抓取按钮替代。
 * 保留仅为 selftest/单测。UI 不再调用。
 */
export function collectDanmaku(
  sessionId: string,
  roomId: string,
  targetCount?: number,
  premise?: string,
): Promise<{ danmaku: DanmakuItem[]; state: WorkflowState }> {
  return api('/api/workflow/collect', {
    method: 'POST',
    headers: { 'X-Session-Id': sessionId },
    body: JSON.stringify({ roomId, sessionId, targetCount, premise }),
  })
}

export function submitDanmaku(
  sessionId: string,
  roomId: string,
  itemIds?: string[],
  premise?: string,
): Promise<{ draftBeats: DraftBeat[]; state: WorkflowState }> {
  return api('/api/workflow/submit-danmaku', {
    method: 'POST',
    headers: { 'X-Session-Id': sessionId },
    body: JSON.stringify({ roomId, sessionId, itemIds, premise }),
  })
}

export function addDanmaku(
  sessionId: string,
  roomId: string,
  text: string,
  user?: string,
): Promise<{ item: DanmakuItem; state: WorkflowState }> {
  return api('/api/workflow/add-danmaku', {
    method: 'POST',
    headers: { 'X-Session-Id': sessionId },
    body: JSON.stringify({ roomId, sessionId, text, user }),
  })
}

export function removeDanmaku(
  sessionId: string,
  roomId: string,
  itemId: string,
): Promise<{ state: WorkflowState }> {
  return api('/api/workflow/remove-danmaku', {
    method: 'POST',
    headers: { 'X-Session-Id': sessionId },
    body: JSON.stringify({ roomId, sessionId, itemId }),
  })
}

export function confirmBeats(
  sessionId: string,
  roomId: string,
  beats: DraftBeat[],
): Promise<{ beats: import('./types').Beat[]; state: WorkflowState }> {
  return api('/api/workflow/confirm-beats', {
    method: 'POST',
    headers: { 'X-Session-Id': sessionId },
    body: JSON.stringify({ roomId, sessionId, beats }),
  })
}

export function generateWorkflowClips(
  sessionId: string,
  roomId: string,
): Promise<{ queued: number; state: WorkflowState }> {
  return api('/api/workflow/generate-clips', {
    method: 'POST',
    headers: { 'X-Session-Id': sessionId },
    body: JSON.stringify({ roomId, sessionId }),
  })
}

export function resetWorkflow(roomId: string): Promise<{ ok: boolean }> {
  return api('/api/workflow/reset', {
    method: 'POST',
    body: JSON.stringify({ roomId }),
  })
}

export function recoverWorkflow(roomId: string): Promise<{ state: WorkflowState }> {
  return api<{ state: WorkflowState }>('/api/workflow/recover', {
    method: 'POST',
    body: JSON.stringify({ roomId }),
  })
}
