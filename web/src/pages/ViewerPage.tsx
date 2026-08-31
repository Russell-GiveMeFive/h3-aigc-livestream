import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import Hls from 'hls.js'
import { fetchStatus, wsUrl } from '../api'
import type { StreamStatus, WsEvent } from '../types'
import { Chip } from '../components/ui'
import DanmakuFeed from '../components/DanmakuFeed'
import '../styles/viewer.css'

export default function ViewerPage() {
  const [params] = useSearchParams()
  const [room, setRoom] = useState<string | null>(params.get('room'))
  const [roomInput, setRoomInput] = useState('')
  const [enterError, setEnterError] = useState('')
  const [joined, setJoined] = useState(false)
  const [poster, setPoster] = useState('信号接入中...')
  const [onAir, setOnAir] = useState(false)
  const [beat, setBeat] = useState('等待剧情...')
  const [buffered, setBuffered] = useState(0)
  const [produced, setProduced] = useState(0)
  const [latency, setLatency] = useState<string>('--')
  const [resolution, setResolution] = useState<'480P' | '768P' | '--'>('--')
  const [tickerMsg, setTickerMsg] = useState('')
  const [danmakus, setDanmakus] = useState<import('../types').Danmaku[]>([])

  const playerRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const hlsUrlRef = useRef<string | null>(null)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryCountRef = useRef(0)
  const stuckRef = useRef(false)
  const endedRef = useRef(false)
  const wsRef = useRef<WebSocket | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const roomRef = useRef<string | null>(null)
  roomRef.current = room

  const destroyHls = useCallback(() => {
    if (hlsRef.current) {
      try {
        hlsRef.current.destroy()
      } catch {
        /* ignore */
      }
      hlsRef.current = null
    }
  }, [])

  const scheduleRetry = useCallback(() => {
    if (stuckRef.current || endedRef.current) return
    destroyHls()
    retryCountRef.current++
    const delay = Math.min(1500 * 2 ** Math.min(retryCountRef.current, 4), 12000)
    setOnAir(false)
    setPoster(`信号中断，${Math.round(delay / 1000)}s 后自动重连...（第 ${retryCountRef.current} 次）`)
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null
      connectHls()
    }, delay)
  }, [destroyHls])

  const connectHls = useCallback(() => {
    const url = hlsUrlRef.current
    const player = playerRef.current
    if (!url || !player || stuckRef.current || endedRef.current) return
    destroyHls()
    if (Hls.isSupported()) {
      const hls = new Hls({ lowLatencyMode: false, liveSyncDurationCount: 2 })
      hlsRef.current = hls
      hls.loadSource(url)
      hls.attachMedia(player)
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        retryCountRef.current = 0
        setOnAir(true)
        setPoster('')
        void player.play().catch(() => {})
      })
      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (!data.fatal) return
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError()
          return
        }
        scheduleRetry()
      })
    } else if (player.canPlayType('application/vnd.apple.mpegurl')) {
      player.src = url
      player.addEventListener('loadedmetadata', () => {
        retryCountRef.current = 0
        setOnAir(true)
        setPoster('')
      })
      player.addEventListener('error', () => scheduleRetry())
    } else {
      setPoster('当前浏览器不支持 HLS 播放')
    }
  }, [destroyHls, scheduleRetry])

  const join = useCallback(
    async (r: string) => {
      const clean = r.trim().toLowerCase()
      if (!clean) return
      setRoom(clean)
      endedRef.current = false
      stuckRef.current = false
      setJoined(true)
      history.replaceState(null, '', `/viewer?room=${clean}`)
      try {
        const s = await fetchStatus(clean)
        setResolution(s.resolution)
        if (s.phase === 'running') {
          hlsUrlRef.current = s.hlsUrl
          setPoster('信号接入中...')
          connectHls()
        } else if (s.phase === 'error') {
          stuckRef.current = true
          setPoster(s.error ?? '直播异常')
        } else {
          setPoster('主播尚未开播，自动等待信号...')
        }
        attachWs(clean)
        startPoll()
      } catch {
        // 房间可能尚未创建 → 直接尝试 SRS 地址，开播后自动恢复
        hlsUrlRef.current = `http://${location.hostname}:8080/live/${clean}.m3u8`
        setPoster('房间未开播，自动等待信号...')
        connectHls()
        startPoll()
      }
    },
    [connectHls],
  )

  const attachWs = useCallback((r: string) => {
    wsRef.current?.close()
    const ws = new WebSocket(wsUrl(r))
    wsRef.current = ws
    ws.onmessage = (ev) => {
      try {
        const d = JSON.parse(ev.data as string) as WsEvent
        if (d.type === 'danmaku' && d.id && d.user && d.text && d.ts) {
          setDanmakus((items) => [...items.slice(-99), { id: d.id!, user: d.user!, text: d.text!, ts: d.ts! }])
        } else if (d.type === 'beat' && d.summary) {
          setBeat(d.summary)
          setTickerMsg(`新剧情拍 · ${d.summary}`)
        } else if (d.type === 'log' && d.msg) {
          setTickerMsg(d.msg)
        } else if (d.type === 'phase' && d.msg === 'running' && !hlsRef.current && !retryTimerRef.current) {
          connectHls()
        } else if (d.type === 'phase' && d.msg === 'stopped') {
          endedRef.current = true
          if (pollRef.current) clearInterval(pollRef.current)
          if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
          ws.close()
          setOnAir(false)
          setPoster('直播已结束')
        } else if (d.type === 'error' && d.msg) {
          endedRef.current = true
          if (pollRef.current) clearInterval(pollRef.current)
          if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
          ws.close()
          stuckRef.current = true
          setOnAir(false)
          setPoster(d.msg)
          if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
        }
      } catch {
        /* ignore */
      }
    }
    ws.onclose = () => {
      if (roomRef.current && !endedRef.current) setTimeout(() => attachWs(roomRef.current!), 2000)
    }
  }, [connectHls])

  const startPoll = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      const r = roomRef.current
      if (!r) return
      try {
        const s = await fetchStatus(r)
        setBuffered(s.bufferedSec)
        setProduced(s.clipsProduced)
        setLatency(s.avgGenLatencyMs != null ? String(s.avgGenLatencyMs) : '--')
        setResolution(s.resolution)
        if (s.currentBeatSummary) setBeat(s.currentBeatSummary)
        if (s.phase === 'error' && s.error) {
          endedRef.current = true
          stuckRef.current = true
          if (pollRef.current) clearInterval(pollRef.current)
          if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
          wsRef.current?.close()
          setOnAir(false)
          setPoster(s.error)
          if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
          return
        }
        if (s.phase === 'stopped') {
          endedRef.current = true
          if (pollRef.current) clearInterval(pollRef.current)
          wsRef.current?.close()
          setOnAir(false)
          setPoster('直播已结束')
          return
        }
        if (s.phase === 'running') {
          hlsUrlRef.current = s.hlsUrl
          endedRef.current = false
          stuckRef.current = false
          if (!hlsRef.current && !retryTimerRef.current) {
            connectHls()
          }
          const p = playerRef.current
          if (p && (p.currentTime > 0 || p.readyState >= 2)) setPoster('')
        }
      } catch {
        /* room 可能已停止 */
      }
    }, 2000)
  }, [connectHls])

  const sendDanmaku = (text: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify({ type: 'danmaku', text }))
  }

  useEffect(() => {
    if (room) void join(room)
    return () => {
      endedRef.current = true
      if (pollRef.current) clearInterval(pollRef.current)
      wsRef.current?.close()
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
      destroyHls()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="app viewer">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">◤</span>
          <span className="brand-name">H3·LIVE</span>
          <span className="brand-sub">放映厅 / THEATER</span>
        </div>
        <div className="top-right">
          <Chip tone={onAir ? 'rec' : 'warn'} dot>
            {onAir ? 'ON AIR' : 'OFF AIR'}
          </Chip>
          {room && (
            <Chip tone="warn" dot>
              房间 {room}
            </Chip>
          )}
          <Chip tone="on" dot>
            视频 {resolution}
          </Chip>
        </div>
      </header>

      <main className="stage">
        {!joined && (
          <section className="panel enter-box">
            <h1 className="enter-title">进入放映厅</h1>
            <p className="enter-sub">输入主播提供的房间码</p>
            <div className="enter-row">
              <input
                aria-label="直播房间码"
                value={roomInput}
                onChange={(e) => setRoomInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && join(roomInput)}
                placeholder="房间码"
                maxLength={8}
              />
              <button className="primary" onClick={() => join(roomInput)}>
                入场
              </button>
            </div>
            {enterError && <p className="enter-error">{enterError}</p>}
          </section>
        )}

        {joined && (
          <section className="theater">
            <div className="video-frame">
              <video ref={playerRef} muted playsInline controls />
              <div className={`poster${poster ? '' : ' hidden'}`} role="status" aria-live="polite">
                <div className="poster-title">◤ H3·LIVE</div>
                <div className="poster-sub">{poster || ' '}</div>
              </div>
              <div className="watermark">AIGC 实时生成 · H3</div>
            </div>

            <div className="below">
              <div className="panel beat-card">
                <span className="section-title">正在上演</span>
                <p className="beat-text" aria-live="polite">{beat}</p>
              </div>
              <div className="stats-strip">
                <div className="stat slim">
                  <div className="label">缓冲</div>
                  <div className="value">
                    {buffered}
                    <span className="unit">s</span>
                  </div>
                </div>
                <div className="stat slim">
                  <div className="label">镜头</div>
                  <div className="value cyan">{produced}</div>
                </div>
                <div className="stat slim">
                  <div className="label">生成延迟</div>
                  <div className="value">
                    {latency}
                    <span className="unit">ms</span>
                  </div>
                </div>
              </div>
              {tickerMsg && (
                <div className="ticker" aria-live="polite">
                  <span className="ticker-label">LIVE FEED</span>
                  <span className="ticker-text">{tickerMsg}</span>
                </div>
              )}
              <DanmakuFeed items={danmakus} onSend={sendDanmaku} />
            </div>
          </section>
        )}
      </main>
    </div>
  )
}
