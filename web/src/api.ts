import type { SessionResp, StartResp, StreamStatus } from './types'

export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
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
