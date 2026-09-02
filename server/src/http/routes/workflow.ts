import express from 'express'
import type { AppConfig } from '../../config'
import type { RoomHub } from '../../ws/rooms'
import type { WorkflowHandlerDeps } from '../../workflow/handlers'
import type { ApiDeps, Session } from '../api'
import {
  handleAddDanmaku,
  handleCollect,
  handleConfirmBeats,
  handleGenerateClips,
  handleGet,
  handleRecover,
  handleRemoveDanmaku,
  handleSubmitDanmaku,
  clearRoomResources,
} from '../../workflow/handlers'
import { workflowStore } from '../../workflow/store'
import { loadConfig } from '../../configStore'
import { getLiveDanmakuStreamer } from '../../danmaku/streamer'

export interface WorkflowRouteDeps {
  hub: RoomHub
  cfg: AppConfig
  /** mock 模式强 flag；selftest/MOCK=1 时为 true，使用 Mock providers */
  mock?: boolean
  /** session 存储：用于按 sessionId 查用户的 apiKey/mock */
  sessions: ApiDeps['sessions']
}

function jsonError(err: unknown): { status: number; body: { error: string } } {
  const e = err as Error & { status?: number }
  const status = typeof e?.status === 'number' ? e.status : 500
  return { status, body: { error: e?.message ?? 'Internal error' } }
}

/**
 * 从请求里取 sessionId → 查 session → 决定本次调用该用哪个 apiKey/mock。
 * 优先用 session 里的；session 缺/没传 → 回退到 process.env / 默认 mock。
 */
function resolveSession(
  deps: WorkflowRouteDeps,
  req: express.Request,
): { apiKey: string; mock: boolean } {
  const sessionId = String(
    req.headers['x-session-id'] ?? req.body?.sessionId ?? '',
  ).trim()
  const sess: Session | undefined = sessionId ? deps.sessions.get(sessionId) : undefined
  const envApiKey = process.env.H3_API_KEY ?? ''
  const envMock = deps.mock ?? (process.env.MOCK === '1' || deps.cfg.mock)
  if (sess) {
    return { apiKey: sess.apiKey || envApiKey, mock: sess.mock || envMock }
  }
  return { apiKey: envApiKey, mock: envMock }
}

export function workflowRoutes(deps: WorkflowRouteDeps): express.Router {
  const r = express.Router()
  const baseDefaults: Omit<WorkflowHandlerDeps, 'apiKey'> = {
    hub: deps.hub,
    cfg: deps.cfg,
    mock: deps.mock ?? (process.env.MOCK === '1' || deps.cfg.mock),
  }
  function buildDeps(apiKey: string, mock: boolean): WorkflowHandlerDeps {
    return { ...baseDefaults, apiKey, mock }
  }
  const streamer = getLiveDanmakuStreamer(deps.hub)

  r.get('/:roomId', (req, res) => {
    const roomId = String(req.params.roomId ?? '').trim()
    if (!roomId) return res.status(400).json({ error: 'roomId 必填' })
    res.json(handleGet(roomId))
  })

  // ─── 实时弹幕流：每房间一份持续订阅，UI 在 ▶ 启动后调用 start；离开/重置调用 stop ───

  r.post('/live-danmaku/start', async (req, res) => {
    const roomId = String(req.body?.roomId ?? '').trim()
    if (!roomId) return res.status(400).json({ error: 'roomId 必填' })
    try {
      const result = await streamer.start(roomId)
      res.json(result)
    } catch (e) {
      const { status, body } = jsonError(e)
      res.status(status).json(body)
    }
  })

  r.post('/live-danmaku/stop', async (req, res) => {
    const roomId = String(req.body?.roomId ?? '').trim()
    if (!roomId) return res.status(400).json({ error: 'roomId 必填' })
    try {
      await streamer.stop(roomId)
      res.json({ ok: true })
    } catch (e) {
      const { status, body } = jsonError(e)
      res.status(status).json(body)
    }
  })

  r.get('/live-danmaku/status', (req, res) => {
    const roomId = String(req.query.room ?? '').trim()
    if (!roomId) return res.status(400).json({ error: 'roomId 必填' })
    res.json({
      status: streamer.getStatus(roomId),
      source: streamer.getSource(roomId),
    })
  })

  // ─── 工作流 REST：UI 提交/确认/生成/重置/恢复 ───

  /**
   * @deprecated 批量 collect 已废弃。流式推送 + 抓取按钮替代后，
   * UI 不再调用本端点。保留路由仅为 selftest/单测验证 handleCollect 自身行为。
   * 简化语义：idle/error/completed → reviewing_danmaku，不再走 collecting_danmaku。
   */
  r.post('/collect', async (req, res) => {
    const roomId = String(req.body?.roomId ?? '').trim()
    if (!roomId) return res.status(400).json({ error: 'roomId 必填' })
    const sess = resolveSession(deps, req)
    const perReqDeps = buildDeps(sess.apiKey, sess.mock)
    try {
      const result = await handleCollect(perReqDeps, roomId, {
        targetCount: req.body?.targetCount,
        premise: req.body?.premise,
      })
      res.json(result)
    } catch (e) {
      const { status, body } = jsonError(e)
      res.status(status).json(body)
    }
  })

  r.post('/submit-danmaku', async (req, res) => {
    const roomId = String(req.body?.roomId ?? '').trim()
    if (!roomId) return res.status(400).json({ error: 'roomId 必填' })
    const sess = resolveSession(deps, req)
    const perReqDeps = buildDeps(sess.apiKey, sess.mock)
    try {
      const result = await handleSubmitDanmaku(perReqDeps, roomId, {
        itemIds: req.body?.itemIds,
        premise: req.body?.premise,
      })
      res.json(result)
    } catch (e) {
      const { status, body } = jsonError(e)
      res.status(status).json(body)
    }
  })

  r.post('/add-danmaku', async (req, res) => {
    const roomId = String(req.body?.roomId ?? '').trim()
    if (!roomId) return res.status(400).json({ error: 'roomId 必填' })
    const sess = resolveSession(deps, req)
    const perReqDeps = buildDeps(sess.apiKey, sess.mock)
    try {
      const result = await handleAddDanmaku(perReqDeps, roomId, {
        text: req.body?.text,
        user: req.body?.user,
      })
      res.json(result)
    } catch (e) {
      const { status, body } = jsonError(e)
      res.status(status).json(body)
    }
  })

  r.post('/remove-danmaku', async (req, res) => {
    const roomId = String(req.body?.roomId ?? '').trim()
    if (!roomId) return res.status(400).json({ error: 'roomId 必填' })
    const sess = resolveSession(deps, req)
    const perReqDeps = buildDeps(sess.apiKey, sess.mock)
    try {
      const result = await handleRemoveDanmaku(perReqDeps, roomId, {
        itemId: req.body?.itemId,
      })
      res.json(result)
    } catch (e) {
      const { status, body } = jsonError(e)
      res.status(status).json(body)
    }
  })

  r.post('/confirm-beats', async (req, res) => {
    const roomId = String(req.body?.roomId ?? '').trim()
    if (!roomId) return res.status(400).json({ error: 'roomId 必填' })
    const sess = resolveSession(deps, req)
    const perReqDeps = buildDeps(sess.apiKey, sess.mock)
    try {
      const result = await handleConfirmBeats(perReqDeps, roomId, {
        beats: req.body?.beats ?? [],
      })
      res.json(result)
    } catch (e) {
      const { status, body } = jsonError(e)
      res.status(status).json(body)
    }
  })

  r.post('/generate-clips', async (req, res) => {
    const roomId = String(req.body?.roomId ?? '').trim()
    if (!roomId) return res.status(400).json({ error: 'roomId 必填' })
    const sess = resolveSession(deps, req)
    const perReqDeps = buildDeps(sess.apiKey, sess.mock)
    try {
      const result = await handleGenerateClips(perReqDeps, roomId)
      res.json(result)
    } catch (e) {
      const { status, body } = jsonError(e)
      res.status(status).json(body)
    }
  })

  r.post('/reset', async (req, res) => {
    const roomId = String(req.body?.roomId ?? '').trim()
    if (!roomId) return res.status(400).json({ error: 'roomId 必填' })
    workflowStore.reset(roomId)
    await clearRoomResources(roomId)
    res.json({ ok: true })
  })

  r.post('/recover', async (req, res) => {
    const roomId = String(req.body?.roomId ?? '').trim()
    if (!roomId) return res.status(400).json({ error: 'roomId 必填' })
    const sess = resolveSession(deps, req)
    const perReqDeps = buildDeps(sess.apiKey, sess.mock)
    try {
      const result = await handleRecover(perReqDeps, roomId)
      res.json(result)
    } catch (e) {
      const { status, body } = jsonError(e)
      res.status(status).json(body)
    }
  })

  return r
}
