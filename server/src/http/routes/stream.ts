import express from 'express'
import type { Session } from '../api'
import { LiveStream, type StreamConfig } from '../../domain/stream'
import { PlayoutEngine } from '../../playout/engine'
import { createStream } from '../../factory/streamFactory'
import { makeProviders } from '../../factory/providerFactory'
import { NullPusher, RtmpPusher } from '../../playout/push'
import type { ApiDeps } from '../api'

export interface StreamRouteDeps extends ApiDeps {
  providerDeps: Parameters<typeof makeProviders>[2]
  rtmpBase: string
  hlsBase: string
  ffmpeg: string
  ffprobe: string
}

/** POST /api/stream/start、stop、GET /status */
export function streamRoutes(deps: StreamRouteDeps): express.Router {
  const r = express.Router()

  r.post('/stream/start', async (req, res) => {
    const session: Session | undefined = deps.sessions.get(String(req.body?.sessionId ?? ''))
    if (!session) return res.status(404).json({ error: '会话不存在，请先输入 API Key' })
    const script = String(req.body?.script ?? '').trim()
    const resolution = (req.body?.resolution === '768P' ? '768P' : '480P') as '480P' | '768P'
    if (!script) return res.status(400).json({ error: '请先编写剧本' })
    if (session.stream) await session.stream.stop().catch(() => {})

    const roomId = makeRoomId(deps.hub)
    const bus = deps.hub.bus(roomId)
    const log = (msg: string) => deps.onLog(roomId, msg)

    const cfg: StreamConfig = {
      concurrency: 2,
      targetBufferSec: 30,
      maxAheadShots: 6,
      maxRetries: 2,
      rtmpUrl: `${deps.rtmpBase}/${roomId}`,
      hlsUrl: `${deps.hlsBase}/${roomId}.m3u8`,
      clipDuration: 5,
      resolution,
    }

    const providers = makeProviders(session.apiKey, session.mock, deps.providerDeps)
    const playout = new PlayoutEngine()
    // mock 模式用 NullPusher：按真实时长本地"消费"播放池，不依赖 SRS / docker。
    // 否则 RtmpPusher 即便没人接 SRS 也会真调 ffmpeg 推 RTMP，连不上就静默失败 + 进程僵尸，
    // 跟"MOCK 无依赖演示"承诺冲突。
    const pusher = session.mock
      ? new NullPusher(playout)
      : new RtmpPusher(playout, cfg.rtmpUrl, {
          ffmpeg: deps.ffmpeg,
          ffprobe: deps.ffprobe,
          onLog: log,
        })

    const { stream, start } = createStream({
      roomId,
      script,
      mock: session.mock,
      providers,
      pusher,
      bus,
      playout,
      cfg,
      onLog: log,
    })
    session.stream = stream

    try {
      await start()
      res.json({
        roomId,
        hlsUrl: cfg.hlsUrl,
        rtmpUrl: cfg.rtmpUrl,
        viewerUrl: `/viewer?room=${roomId}`,
      })
    } catch (e) {
      session.stream = null
      deps.hub.remove(roomId)
      res.status(500).json({ error: (e as Error).message })
    }
  })

  r.post('/stream/stop', async (req, res) => {
    const session = deps.sessions.get(String(req.body?.sessionId ?? ''))
    if (!session?.stream) return res.json({ ok: true })
    const roomId = session.stream.roomId
    await session.stream.stop().catch(() => {})
    session.stream = null
    deps.hub.remove(roomId)
    res.json({ ok: true })
  })

  r.get('/stream/status', (req, res) => {
    const roomId = String(req.query.room ?? '')
    for (const session of deps.sessions.values()) {
      if (session.stream?.roomId === roomId) {
        return res.json(session.stream.status(null))
      }
    }
    res.status(404).json({ error: '房间不存在或已停止' })
  })

  return r
}

const ROOM_ID_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789'
function makeRoomId(hub: { has: (id: string) => boolean }): string {
  for (let attempt = 0; attempt < 20; attempt++) {
    let out = ''
    for (let i = 0; i < 6; i++) out += ROOM_ID_CHARS[Math.floor(Math.random() * ROOM_ID_CHARS.length)]
    if (!hub.has(out)) return out
  }
  throw new Error('暂时无法分配唯一房间号，请稍后重试')
}