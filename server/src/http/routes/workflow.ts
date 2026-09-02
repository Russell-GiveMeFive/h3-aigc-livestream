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
import { createDouyinSource } from '../../danmaku/douyin'
import { loadConfig } from '../../configStore'
import type { DanmakuItem } from '@h3/protocol/types'

/**
 * 把 douyin 源包成 fetchDanmaku(count) 的形态：
 * 订阅 → 10s 窗口内全量收 → stop() → 返回所有项目。
 *
 * 走 native 模式 — Node 端在 vm 沙箱里跑 webmssdk.js 算 X-Bogus，自己开 wss。
 * 不依赖 sign-server、不依赖浏览器。
 *
 * 设计要点：
 * - 固定 10s 窗口（不再"收够 N 条提前退"）：避免首帧凑齐 member/like 等噪声时
 *   把 chat 切在窗口外，参见 handlers.ts filterDanmaku 的取舍。
 * - 不在 wrapper 内截断：把"取最新 N"和"业务过滤"留给 handler，本函数只管时间窗口。
 */
const COLLECT_WINDOW_MS = 10_000
function createFetchDanmakuFromDouyin(roomId: string): (count: number) => Promise<DanmakuItem[]> {
  const source = createDouyinSource({ debug: true })
  return async (_count: number): Promise<DanmakuItem[]> => {
    const collected: DanmakuItem[] = []
    const deadline = Date.now() + COLLECT_WINDOW_MS
    const sub = await source.subscribe({
      roomId,
      onItem: (item) => {
        collected.push(item)
      },
    })
    try {
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 200))
      }
    } finally {
      await sub.stop()
    }
    return collected
  }
}

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
  // 没 session：env 有 key 就用 env；都没有就让它 401（fallback 给 env）
  return { apiKey: envApiKey, mock: envMock }
}

export function workflowRoutes(deps: WorkflowRouteDeps): express.Router {
  const r = express.Router()

  // 默认 baseDeps（不携带 apiKey/fetchDanmaku；per-request 用 resolveSession + resolveFetchDanmaku 算出来的覆盖）
  const baseDefaults: Omit<WorkflowHandlerDeps, 'apiKey' | 'fetchDanmaku'> = {
    hub: deps.hub,
    cfg: deps.cfg,
    mock: deps.mock ?? (process.env.MOCK === '1' || deps.cfg.mock),
  }
  // 把 douyin 接进 collect。
  // 每次请求都 resolve 一次：这样前端的 Config 页保存 cfg.danmaku.douyinRoomId 后，
  // 下次 /collect 立刻生效，不用重启 server。
  // mock 模式下不接 douyin：否则 collect 会连真实抖音 wss，失败时卡 30s timeout（handlers.ts deadline），
  // 跟"MOCK 无依赖演示"承诺冲突；MOCK 用户用 makeMockDanmaku 即可。
  // 优先级：cfg.danmaku.douyinRoomId（用户保存的）> process.env.DOUYIN_ROOM_ID（.env 默认值）
  function resolveFetchDanmaku(mock: boolean): ((count: number) => Promise<DanmakuItem[]>) | undefined {
    if (mock) return undefined
    const savedRoomId = loadConfig().danmaku.douyinRoomId?.trim()
    const envRoomId = process.env.DOUYIN_ROOM_ID?.trim()
    const roomId = savedRoomId || envRoomId
    if (!roomId) return undefined
    try {
      return createFetchDanmakuFromDouyin(roomId)
    } catch (e) {
      console.warn('[workflow] failed to wire douyin source:', (e as Error).message)
      return undefined
    }
  }
  function buildDeps(apiKey: string, mock: boolean): WorkflowHandlerDeps {
    const fd = resolveFetchDanmaku(mock)
    // 保留 fetchDanmaku 为 undefined 时让它真的 undefined（不要赋一个返回 undefined 的 stub）
    return fd
      ? { ...baseDefaults, apiKey, mock, fetchDanmaku: fd }
      : { ...baseDefaults, apiKey, mock }
  }
  // 启动时给一下可见的初始化状态（与之前保持兼容；真正 wire 在第一次请求时做）
  const initRoomId = loadConfig().danmaku.douyinRoomId?.trim() || process.env.DOUYIN_ROOM_ID?.trim()
  if (initRoomId && !baseDefaults.mock) {
    console.log(`[workflow] douyin source configured for roomId=${initRoomId} (will wire per-request)`)
  }

  r.get('/:roomId', (req, res) => {
    const roomId = String(req.params.roomId ?? '').trim()
    if (!roomId) return res.status(400).json({ error: 'roomId 必填' })
    res.json(handleGet(roomId))
  })

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

  // 单元测试/调试用
  r.post('/reset', async (req, res) => {
    const roomId = String(req.body?.roomId ?? '').trim()
    if (!roomId) return res.status(400).json({ error: 'roomId 必填' })
    workflowStore.reset(roomId)
    await clearRoomResources(roomId)
    res.json({ ok: true })
  })

  // error 状态逃生通道：回到 reviewing_danmaku，保留 collectedDanmaku/draftBeats/confirmedBeats/generatedClips
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
