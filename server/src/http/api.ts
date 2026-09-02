import express from 'express'
import type { RoomHub } from '../ws/rooms'
import type { LiveStream } from '../domain/stream'
import type { AppConfig } from '../config'
import { sessionRoutes } from './routes/session'
import { streamRoutes } from './routes/stream'
import { staticRoutes } from './routes/static'
import { historyRoutes } from './routes/history'
import { settingsRoutes } from './routes/settings'
import { workflowRoutes } from './routes/workflow'

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
  cfg: AppConfig
}

/** createApi：仅负责挂路由；Provider 装配已搬到 factory/ */
export function createApi(deps: ApiDeps): express.Express {
  const app = express()
  app.use(express.json({ limit: '2mb' }))

  // 路由前缀统一用 /api；session/stream 内部只写 /xxx
  app.use('/api', sessionRoutes(deps))
  app.use('/api', streamRoutes({
    ...deps,
    providerDeps: {
      cacheDir: deps.cfg.cacheDir,
      ffmpeg: deps.cfg.ffmpeg,
      mockCardScript: deps.cfg.mockCardScript,
      python: deps.cfg.python,
      minimax: deps.cfg.minimax,
      pollIntervalMs: deps.cfg.gen.pollIntervalMs,
      log: () => {},
    },
    rtmpBase: deps.cfg.srs.rtmpBase,
    hlsBase: deps.cfg.srs.hlsBase,
    ffmpeg: deps.cfg.ffmpeg,
    ffprobe: deps.cfg.ffprobe,
  }))
  app.use(staticRoutes({ cacheDir: deps.cfg.cacheDir, webDist: deps.cfg.webDist }))
  app.use('/api/history', historyRoutes({ dataDir: deps.cfg.root + '/server/data', cacheDir: deps.cfg.cacheDir }))
  app.use('/api', settingsRoutes())
  app.use('/api/workflow', workflowRoutes({ hub: deps.hub, cfg: deps.cfg, mock: deps.cfg.mock, sessions: deps.sessions }))

  app.get('/api/health', (_req, res) => res.json({ ok: true, mock: deps.cfg.mock }))
  return app
}