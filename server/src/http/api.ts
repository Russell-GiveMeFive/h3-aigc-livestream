import express from 'express'
import path from 'node:path'
import fs from 'node:fs'
import { EventEmitter } from 'node:events'
import { config } from '../config'
import { MiniMaxClient } from '../providers/minimax'
import { MiniMaxTextProvider, MockTextProvider } from '../providers/text'
import { MiniMaxVideoProvider, MockVideoProvider } from '../providers/video'
import { MiniMaxFrameLinker, MockFrameLinker } from '../gen/frameLink'
import { LiveStream } from '../stream'
import { RtmpPusher } from '../playout/push'
import { RoomHub } from '../ws/rooms'
import { nowId } from '../util'

export interface Session {
  id: string
  apiKey: string
  mock: boolean
  stream: LiveStream | null
}

export interface ApiDeps {
  hub: RoomHub
  sessions: Map<string, Session>
  /** 全局日志回调（透传到房间总线） */
  onLog: (roomId: string, msg: string) => void
}

const ROOM_ID_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789'

function makeRoomId(hub: RoomHub): string {
  for (let attempt = 0; attempt < 20; attempt++) {
    let out = ''
    for (let i = 0; i < 6; i++) out += ROOM_ID_CHARS[Math.floor(Math.random() * ROOM_ID_CHARS.length)]
    if (!hub.has(out)) return out
  }
  throw new Error('暂时无法分配唯一房间号，请稍后重试')
}

export function createApi(deps: ApiDeps): express.Express {
  const app = express()
  app.use(express.json({ limit: '2mb' }))

  // ── 会话：主播输入自己的 API Key（内存保存，绝不落盘）──
  app.post('/api/session', async (req, res) => {
    const apiKey = String(req.body?.apiKey ?? '').trim()
    if (config.mock) {
      const session: Session = { id: nowId('sess'), apiKey: '', mock: true, stream: null }
      deps.sessions.set(session.id, session)
      return res.json({ sessionId: session.id, mock: true })
    }
    if (!apiKey) return res.status(400).json({ error: '请填写 MiniMax API Key（文本 + 视频通用）' })
    const client = new MiniMaxClient(apiKey)
    const ok = await client.validateKey()
    if (!ok) return res.status(401).json({ error: 'API Key 无效（无法访问 MiniMax 服务）' })
    const session: Session = { id: nowId('sess'), apiKey, mock: false, stream: null }
    deps.sessions.set(session.id, session)
    res.json({ sessionId: session.id, mock: false })
  })

  // ── 开播 ──
  app.post('/api/stream/start', async (req, res) => {
    const session = deps.sessions.get(String(req.body?.sessionId ?? ''))
    if (!session) return res.status(404).json({ error: '会话不存在，请先输入 API Key' })
    const script = String(req.body?.script ?? '').trim()
    const defaultResolution: '480P' | '768P' = config.minimax.resolution === '480P' ? '480P' : '768P'
    const resolution: '480P' | '768P' = req.body?.resolution === '480P' ? '480P' : req.body?.resolution === '768P' ? '768P' : defaultResolution
    if (!script) return res.status(400).json({ error: '请先编写剧本' })
    if (session.stream) {
      await session.stream.stop().catch(() => {})
    }

    const roomId = makeRoomId(deps.hub)
    const bus = deps.hub.bus(roomId)
    const log = (msg: string) => deps.onLog(roomId, msg)

    const cfg = {
      concurrency: config.gen.concurrency,
      targetBufferSec: config.gen.targetBufferSec,
      maxAheadShots: 6,
      maxRetries: config.gen.maxRetries,
      rtmpUrl: `${config.srs.rtmpBase}/${roomId}`,
      hlsUrl: `${config.srs.hlsBase}/${roomId}.m3u8`,
      ffmpeg: config.ffmpeg,
      ffprobe: config.ffprobe,
      clipDuration: config.gen.clipDuration,
      resolution,
    }

    let providers
    if (session.mock) {
      providers = {
        text: new MockTextProvider(),
        video: new MockVideoProvider({
          cacheDir: config.cacheDir,
          ffmpeg: config.ffmpeg,
          mockCardScript: config.mockCardScript,
          python: config.python,
          onLog: log,
        }),
        linker: new MockFrameLinker({ cacheDir: config.cacheDir, ffmpeg: config.ffmpeg }),
      }
    } else {
      const client = new MiniMaxClient(session.apiKey, config.minimax.baseUrl, log)
      providers = {
        text: new MiniMaxTextProvider(client, config.minimax.textModel),
        video: new MiniMaxVideoProvider(client, {
          model: config.minimax.videoModel,
          resolution,
          cacheDir: config.cacheDir,
          pollIntervalMs: config.gen.pollIntervalMs,
          onLog: log,
        }),
        linker: new MiniMaxFrameLinker(client, { cacheDir: config.cacheDir, ffmpeg: config.ffmpeg, onLog: log }),
      }
    }

    const stream = new LiveStream({
      roomId,
      script,
      mock: session.mock,
      providers,
      textModelName: config.minimax.textModel,
      bus,
      pushFactory: (engine) => new RtmpPusher(engine, cfg.rtmpUrl, { ffmpeg: cfg.ffmpeg, ffprobe: cfg.ffprobe, onLog: log }),
      cfg,
      onLog: log,
    })
    session.stream = stream

    try {
      await stream.start()
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

  app.post('/api/stream/stop', async (req, res) => {
    const session = deps.sessions.get(String(req.body?.sessionId ?? ''))
    if (!session?.stream) return res.json({ ok: true })
    const roomId = session.stream.roomId
    await session.stream.stop().catch(() => {})
    session.stream = null
    deps.hub.remove(roomId)
    res.json({ ok: true })
  })

  app.get('/api/stream/status', (req, res) => {
    const roomId = String(req.query.room ?? '')
    for (const session of deps.sessions.values()) {
      if (session.stream?.roomId === roomId) {
        return res.json(session.stream.status())
      }
    }
    res.status(404).json({ error: '房间不存在或已停止' })
  })

  app.get('/api/health', (_req, res) => res.json({ ok: true, mock: config.mock }))

  // ── 生成视频预览（主播端回看；sendFile 自带 Range 支持，可拖动进度条）──
  app.get('/clips/:file', (req, res) => {
    const file = path.basename(String(req.params.file ?? ''))
    if (!file || !/^[\w.-]+$/.test(file)) return res.status(400).json({ error: 'bad file name' })
    const full = path.join(config.cacheDir, file)
    if (!fs.existsSync(full)) return res.status(404).json({ error: 'not found' })
    res.setHeader('Content-Type', 'video/mp4')
    res.sendFile(full)
  })

  // ── 生产模式：托管 web 构建产物（SPA，非 /api /ws /clips 路径回退到 index.html）──
  const dist = path.join(config.root, 'web', 'dist')
  if (fs.existsSync(dist)) {
    app.use(express.static(dist))
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/ws') || req.path.startsWith('/clips')) {
        return next()
      }
      res.sendFile(path.join(dist, 'index.html'))
    })
  }

  return app
}
