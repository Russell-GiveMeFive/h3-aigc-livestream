import { useCallback, useEffect, useRef, useState } from 'react'
import { useStreamer } from '../stores/streamerStore'
import { createSession, fetchStatus, startStream, stopStream, wsUrl } from '../api'
import type { VideoResolution, WsEvent } from '../types'
import { Chip, Panel, Stat } from '../components/ui'
import BeatsTimeline from '../components/BeatsTimeline'
import ClipWall from '../components/ClipWall'
import LogConsole from '../components/LogConsole'
import DanmakuFeed from '../components/DanmakuFeed'
import '../styles/streamer.css'

const TARGET_BUFFER = 30

export default function StreamerPage() {
  const { sessionId, mock, status, logs, wsConnected, setSession, setStatus, addLog, setWs } = useStreamer()
  const [apiKey, setApiKey] = useState('')
  const [keyMsg, setKeyMsg] = useState('')
  const [script, setScript] = useState('')
  const [title, setTitle] = useState('')
  const [resolution, setResolution] = useState<VideoResolution>('480P')
  const [roomId, setRoomId] = useState<string | null>(null)
  const [hlsUrl, setHlsUrl] = useState('')
  const [activeUrl, setActiveUrl] = useState<string | null>(null)
  const [danmakus, setDanmakus] = useState<import('../types').Danmaku[]>([])
  const [starting, setStarting] = useState(false)

  const wsRef = useRef<WebSocket | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const roomRef = useRef<string | null>(null)
  roomRef.current = roomId

  const phase = status?.phase ?? 'idle'
  const beats = status?.beats ?? []
  const clips = status?.clips ?? []
  const error = status?.error

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const cleanupStream = useCallback(() => {
    stopPoll()
    wsRef.current?.close()
    wsRef.current = null
    setWs(false)
    setStatus(null)
    setRoomId(null)
    setHlsUrl('')
    setActiveUrl(null)
  }, [setWs, stopPoll])

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((h: { mock?: boolean }) => {
        if (h.mock) addLog('MOCK 模式：免 Key 演示，生成 AI 场景卡片', 'warn')
      })
      .catch(() => {})
    return () => cleanupStream()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const connectWs = useCallback(
    (room: string) => {
      wsRef.current?.close()
      const ws = new WebSocket(wsUrl(room))
      wsRef.current = ws
      ws.onopen = () => setWs(true)
      ws.onclose = () => {
        setWs(false)
        if (roomRef.current === room) setTimeout(() => connectWs(room), 2000)
      }
      ws.onerror = () => setWs(false)
      ws.onmessage = (ev) => {
        try {
          const d = JSON.parse(ev.data as string) as WsEvent
          if (d.type === 'danmaku' && d.id && d.user && d.text && d.ts) {
            setDanmakus((items) => [...items.slice(-99), { id: d.id!, user: d.user!, text: d.text!, ts: d.ts! }])
          } else if (d.type === 'log' && d.msg) addLog(d.msg)
          else if (d.type === 'clip' && d.url) {
            addLog(`🎞 新片段 ${d.shotId ?? ''} (${d.duration ?? ''}s)`, 'ok')
          } else if (d.type === 'beat' && d.summary) {
            addLog(`📝 新剧情拍: ${d.summary}`, 'ok')
          } else if (d.type === 'phase' && d.msg === 'stopped') {
            addLog('🛑 直播已停止', 'warn')
          } else if (d.type === 'error' && d.msg) {
            addLog(`❌ ${d.msg}`, 'err')
          }
        } catch {
          /* ignore */
        }
      }
    },
    [addLog, setWs],
  )

  const startPoll = useCallback(() => {
    stopPoll()
    pollRef.current = setInterval(async () => {
      const room = roomRef.current
      if (!room) return
      try {
        const s = await fetchStatus(room)
        setStatus(s)
        setActiveUrl((prev) => prev ?? s.clips.at(-1)?.url ?? null)
      } catch {
        /* room 可能已停止 */
      }
    }, 2000)
  }, [setStatus, stopPoll])

  const handleSaveKey = async () => {
    try {
      const resp = await createSession(apiKey.trim())
      setSession(resp.sessionId, resp.mock)
      setKeyMsg(resp.mock ? 'MOCK 模式已接入（服务端 MOCK=1）' : '✅ Key 已验证，仅存内存')
      addLog(resp.mock ? '已进入 MOCK 模式' : '✅ MiniMax API Key 已验证', 'ok')
    } catch (e) {
      setKeyMsg(`❌ ${(e as Error).message}`)
    }
  }

  const handleStart = async () => {
    if (!sessionId) {
      setKeyMsg('请先接入 API Key（或服务端以 MOCK=1 启动）')
      return
    }
    if (!script.trim()) {
      addLog('请先填写剧情梗概', 'warn')
      return
    }
    setStarting(true)
    addLog('🚀 正在开播：拆分剧本 → 生成 → 推流...', 'ok')
    try {
      const resp = await startStream(sessionId, script.trim(), title.trim(), resolution)
      setRoomId(resp.roomId)
      setHlsUrl(resp.hlsUrl)
      addLog(`🎬 开播成功，房间 ${resp.roomId}`, 'ok')
      connectWs(resp.roomId)
      startPoll()
    } catch (e) {
      addLog(`💥 开播失败: ${(e as Error).message}`, 'err')
    } finally {
      setStarting(false)
    }
  }

  const handleStop = async () => {
    if (sessionId) {
      try {
        await stopStream(sessionId)
      } catch {
        /* ignore */
      }
    }
    addLog('🛑 直播已停止', 'warn')
    cleanupStream()
  }

  const handlePlayShot = (shotId: string) => {
    const clip = clips.find((c) => c.shotId === shotId)
    if (clip) setActiveUrl(clip.url)
  }

  const buffered = status?.bufferedSec ?? 0
  const bufferPct = Math.min(100, Math.round((buffered / TARGET_BUFFER) * 100))
  const targetPct = Math.min(100, (TARGET_BUFFER / 60) * 100)

  return (
    <div className="app streamer">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">◤</span>
          <span className="brand-name">H3·LIVE</span>
          <span className="brand-sub">导演台 / DIRECTOR CONSOLE</span>
        </div>
        <div className="top-right">
          <Chip tone={mock ? 'on' : ''} dot>
            {mock ? 'MOCK 模式' : '真实 API'}
          </Chip>
          <Chip tone={wsConnected ? 'on' : ''} dot>
            WS {wsConnected ? '已连接' : '断开'}
          </Chip>
          <Chip tone="warn" dot>
            视频 {status?.resolution ?? resolution}
          </Chip>
          {roomId && (
            <Chip tone="warn" dot>
              房间 {roomId}
            </Chip>
          )}
          {roomId && (
            <a className="chip-link" href={`/viewer?room=${roomId}`} target="_blank" rel="noreferrer">
              观众入口 ↗
            </a>
          )}
        </div>
      </header>

      <div className="layout">
        {/* ── 左侧：接入 / 剧本 / 开播 / 监控 ── */}
        <aside className="rail">
          <Panel title="01 · 模型接入">
            <div className="key-row">
              <input
                aria-label="MiniMax API Key"
                type="password"
                placeholder="MiniMax API Key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSaveKey()}
              />
              <button className="primary" onClick={handleSaveKey}>
                接入
              </button>
            </div>
            <p className={`hint${keyMsg.startsWith('❌') ? ' err' : ''}`}>{keyMsg || 'Key 仅在服务器内存中使用，绝不落盘。'}</p>
          </Panel>

          <Panel title="02 · 剧本">
            <input aria-label="直播标题" placeholder="直播标题（可选）" value={title} onChange={(e) => setTitle(e.target.value)} />
            <label className="field-label" htmlFor="resolution-select">视频分辨率</label>
            <select id="resolution-select" aria-label="视频分辨率" value={resolution} onChange={(e) => setResolution(e.target.value as VideoResolution)}>
              <option value="480P">480P · 省成本 / 更快</option>
              <option value="768P">768P · 更清晰 / 更高成本</option>
            </select>
            <textarea
              aria-label="剧情梗概"
              style={{ marginTop: 10 }}
              rows={7}
              placeholder="例如：末日废土，主角阿光穿越荒原寻找水源，发现废弃地下实验室，他必须决定是否进入……"
              value={script}
              onChange={(e) => setScript(e.target.value)}
            />
            <div className="actions" style={{ marginTop: 12 }}>
              <button className="primary" disabled={starting} onClick={handleStart}>
                {starting ? '开播中…' : '● 开始直播'}
              </button>
              <button className="danger" disabled={!roomId} onClick={handleStop}>
                ■ 停止
              </button>
            </div>
            {roomId && (
              <div className="stream-info">
                <p className="hint">
                  房间码 <span className="room-big">{roomId}</span>
                </p>
                <p className="hint dim">HLS {hlsUrl}</p>
              </div>
            )}
          </Panel>

          <Panel title="03 · 监控">
            <div className="stats-grid">
              <Stat label="播放缓冲" value={buffered} unit="s" />
              <Stat label="已生成镜头" value={status?.clipsProduced ?? 0} />
              <Stat label="已推流" value={status?.clipsPlayed ?? 0} tone="cyan" />
              <Stat label="生成延迟" value={status?.avgGenLatencyMs ?? '--'} unit="ms" />
              <Stat label="队列待生成" value={status?.pendingShots ?? 0} tone="dim" />
              <Stat label="生成中" value={status?.runningTasks ?? 0} tone="dim" />
            </div>
            <div className="buffer-wrap">
              <div className="bar-head">
                <span className="hint dim">缓冲水位</span>
                <span className="hint dim">
                  {buffered} / {TARGET_BUFFER}s
                </span>
              </div>
              <div className="buffer-track">
                <div className="buffer-fill" style={{ width: `${bufferPct}%` }} />
                <div className="buffer-target" style={{ left: `${targetPct}%` }} />
              </div>
            </div>
            <div className="mode-line">
              <span className="hint dim">续写模式</span>
              <span className="mode-tag">AI</span>
              <span className="hint dim" style={{ marginLeft: 'auto' }}>
                {status?.mock ? 'mock' : `${status?.resolution ?? resolution} · H3-Max`}
              </span>
            </div>
          </Panel>
        </aside>

        {/* ── 主区：预览 + 剧本时间线 + 日志 ── */}
        <main className="stage">
          {phase === 'error' && error && (
            <div className="error-banner" role="alert" aria-live="assertive">
              <span className="error-icon">⚠</span>
              <span>{error}</span>
            </div>
          )}

          <Panel className="preview-panel">
            <div className="bar-head">
              <span className="section-title">生成画面预览</span>
              <span className="hint dim">
                {phase === 'running' ? '● LIVE' : phase.toUpperCase()} · 点击胶片或镜头回看
              </span>
            </div>
            <ClipWall clips={clips} activeUrl={activeUrl} onSelect={setActiveUrl} />
          </Panel>

          <div className="content-grid">
            <Panel title={`各幕剧本（${beats.length} 幕）`} className="timeline-panel">
              <BeatsTimeline beats={beats} onPlayShot={handlePlayShot} />
            </Panel>
            <LogConsole logs={logs} onClear={() => useStreamer.getState().clearLogs()} />
            <DanmakuFeed items={danmakus} />
          </div>
        </main>
      </div>
    </div>
  )
}
