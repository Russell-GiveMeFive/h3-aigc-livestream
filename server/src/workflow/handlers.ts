import type { EventEmitter } from 'node:events'
import type { AppConfig } from '../config'
import type { RoomHub } from '../ws/rooms'
import type {
  Beat,
  ClipView,
  DanmakuItem,
  DraftBeat,
  WorkflowState,
  WorkflowPhase,
} from '@h3/protocol/types'
import { nowId } from '../util'
import { AiStorySplitter } from '../story/splitter'
import { makeDefaultErrorPolicy, makeProviders, type ProviderBundle } from '../factory/providerFactory'
import { classify } from './danmakuClassifier'
import { workflowStore } from './store'
import { applyAction, canTransition, nextPhase, transitionTo, type WorkflowAction } from './stateMachine'
import { GenQueue } from '../gen/queue'

/** 弹幕收集/分类运行期配置：现阶段硬编码默认；将来由 ConfigStore 提供 */
export interface DanmakuConfig {
  targetCount: number
  blacklist: string[]
  minLength: number
  minIntervalMs: number
}

export const DEFAULT_DANMAKU_CFG: DanmakuConfig = {
  targetCount: 5,
  blacklist: ['广告', '666', '来了', '哈哈'],
  minLength: 2,
  minIntervalMs: 800,
}

export const DEFAULT_PREMISE = '互动故事：观众通过弹幕影响剧情走向。'

export interface WorkflowHandlerDeps {
  hub: RoomHub
  cfg: AppConfig
  /** mock mode 强制为 true（selftest/MOCK=1）；为 false 时走真 provider */
  mock: boolean
  /** 用户填的 API key（来自 session）；缺省回退到 env.H3_API_KEY */
  apiKey?: string
  /** 可注入 spitter（默认 AiStorySplitter） */
  makeSplitter?: () => { split: (ctx: { premise: string; provider: ProviderBundle['text']; logger: (msg: string) => void }) => Promise<{ beats: Beat[] }> }
  /** 可注入 providers（默认按 cfg 走 makeProviders） */
  makeProviders?: (apiKey: string, mock: boolean) => ProviderBundle
  /** 可注入 danmaku provider（null = 用 mock 生成）；默认 null */
  fetchDanmaku?: (count: number) => Promise<DanmakuItem[]>
}

interface CachedResources {
  queue: GenQueue
  providers: ProviderBundle
  cacheDir: string
  apiKey: string
}

/** 每房间持有一份生成侧资源（providers + queue + 保活 clip 累积） */
const roomResources = new Map<string, CachedResources>()

/** per-room Promise chain mutex：避免 collect/submit/confirm/generate 并发互踩 */
const roomMutex = new Map<string, Promise<unknown>>()

/** per-room generate-clips in-flight flag：driveGenerateClips 是 fire-and-forget，
 *  mutex 立刻释放；并发 POST 仍能再进 mutex 通过 phase 检查再起一个本地 queue。
 *  用这个 flag 二次拦截，防止 shots 双重入队。
 */
const generatingTasks = new Map<string, boolean>()
async function withRoomMutex<T>(roomId: string, fn: () => Promise<T>): Promise<T> {
  const prev = roomMutex.get(roomId) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((r) => { release = r })
  const next = prev.then(fn, fn).finally(() => release())
  roomMutex.set(roomId, gate)
  try {
    return await next
  } finally {
    if (roomMutex.get(roomId) === gate) roomMutex.delete(roomId)
  }
}

function getResources(roomId: string, deps: WorkflowHandlerDeps): CachedResources {
  const cached = roomResources.get(roomId)
  if (cached) return cached
  const apiKey = deps.apiKey ?? process.env.H3_API_KEY ?? ''
  const providers = deps.makeProviders
    ? deps.makeProviders(apiKey, deps.mock)
    : makeProviders(apiKey, deps.mock, {
        cacheDir: deps.cfg.cacheDir,
        ffmpeg: deps.cfg.ffmpeg,
        mockCardScript: deps.cfg.mockCardScript,
        python: deps.cfg.python,
        minimax: deps.cfg.minimax,
        pollIntervalMs: deps.cfg.gen.pollIntervalMs,
        log: () => {},
      })
  const queue = new GenQueue(
    providers.video,
    providers.linker ?? undefined,
    {
      onShotStart: () => {},
      onClipReady: () => {},
      onLog: () => {},
      onShotFailed: () => {},
      onLatency: () => {},
    },
    {
      concurrency: deps.cfg.gen.concurrency,
      maxRetries: deps.cfg.gen.maxRetries,
      errorPolicy: makeDefaultErrorPolicy(),
    },
  )
  const res: CachedResources = { queue, providers, cacheDir: deps.cfg.cacheDir, apiKey }
  roomResources.set(roomId, res)
  return res
}

/** 测试/重置时清资源缓存：停 GenQueue 再丢弃引用 */
export async function clearRoomResources(roomId?: string): Promise<void> {
  const stopOne = async (id: string) => {
    const res = roomResources.get(id)
    if (!res) return
    roomResources.delete(id)
    generatingTasks.delete(id)
    try { await res.queue.stop() } catch { /* swallow */ }
  }
  if (roomId) {
    await stopOne(roomId)
  } else {
    const ids = [...roomResources.keys()]
    await Promise.allSettled(ids.map(stopOne))
  }
}

/** 通过 RoomHub 广播工作流阶段变化（与 WsEvent 的 workflow 变体对齐） */
function emitPhase(bus: EventEmitter, phase: WorkflowPhase, detail?: string): void {
  bus.emit('workflow', { phase, detail })
}

function getBus(hub: RoomHub, roomId: string): EventEmitter {
  return hub.bus(roomId)
}

/** validateGuard：在应用阶段动作前先校验 */
function guard(state: WorkflowState, action: WorkflowAction): WorkflowState {
  if (action === 'reset' || action === 'fail') return state // 永远允许
  const target = nextPhase(state.phase, action)
  if (!target) {
    const err = new Error(`当前阶段 ${state.phase} 不能执行动作 ${action}`)
    ;(err as Error & { status?: number }).status = 409
    throw err
  }
  if (!canTransition(state.phase, target)) {
    const err = new Error(`非法迁移 ${state.phase} → ${target}`)
    ;(err as Error & { status?: number }).status = 409
    throw err
  }
  return state
}

// ─────────────────────────── 生成假弹幕（MOCK fallback） ───────────────────────────
// 真实模式下 fetchDanmaku 由 workflowRoutes wire douyin；mock 模式没 douyin 时
// 走这个 makeMockDanmaku，让 MOCK 演示能跑通全链路。P0-2 修了 mock 不 wire douyin，
// 所以 mock 下永远走这里不会卡抖音 wss。

const MOCK_USERS = ['观众1', '观众2', '观众3', '观众4', '观众5', '路人甲']
const MOCK_LINES = [
  '建议主角去探索那条密道',
  '我希望有更多打斗场景',
  '能不能加入音乐元素',
  '反派可以更狡猾一些',
  '想要一个温暖结局',
  '想看主角获得神秘钥匙',
  '希望节奏快一点',
  '要不要穿越到异世界',
  '希望有一段雨中告白',
  '完全看不懂，太烧脑了',
]

/** fallback danmaku producer：缺 fetchDanmaku 时使用 */
function makeMockDanmaku(count: number): DanmakuItem[] {
  const out: DanmakuItem[] = []
  const now = Date.now()
  for (let i = 0; i < count; i++) {
    out.push({
      id: nowId('dm'),
      user: MOCK_USERS[i % MOCK_USERS.length],
      text: MOCK_LINES[i % MOCK_LINES.length],
      ts: now - (count - i) * 1000,
      source: 'mock',
    })
  }
  return out
}

/** 黑名单/最小长度/去重（同用户在 minIntervalMs 内不重复） */

/** 黑名单/最小长度/去重（同用户在 minIntervalMs 内不重复） */
function filterDanmaku(
  items: DanmakuItem[],
  cfg: DanmakuConfig,
): DanmakuItem[] {
  const seenUser = new Map<string, number>()
  return items.filter((it) => {
    const text = it.text.trim()
    if (text.length < cfg.minLength) return false
    if (cfg.blacklist.some((bad) => text.includes(bad))) return false
    const last = seenUser.get(it.user) ?? 0
    if (it.ts - last < cfg.minIntervalMs) return false
    seenUser.set(it.user, it.ts)
    return true
  })
}

// ─────────────────────────── 收集弹幕 ───────────────────────────

/**
 * Collect / AddDanmaku 在"非 completed 阶段重新开局"时用：清掉 in-flight 脚本 + 弹幕，
 * 但**保留 generatedClips**——已完成生成的视频片段是用户的资产，不该被新一轮 collect 抹掉。
 * 与 `applyAction(state, 'reset')` 的区别：后者把 clips 一起清（用户主动重置工作流时用）。
 */
function softResetForCollect(state: WorkflowState): WorkflowState {
  const preservedClips = state.generatedClips
  const preservedHistory = state.scriptHistory
  const resetted = applyAction(state, 'reset')
  return { ...resetted, generatedClips: preservedClips, scriptHistory: preservedHistory }
}

export async function handleCollect(
  deps: WorkflowHandlerDeps,
  roomId: string,
  body: { targetCount?: number; premise?: string } = {},
): Promise<{ danmaku: DanmakuItem[]; state: WorkflowState }> {
  return await withRoomMutex(roomId, async () => {
  const cfg: DanmakuConfig = {
    ...DEFAULT_DANMAKU_CFG,
    targetCount: Math.min(10, Math.max(0, Number(body.targetCount ?? DEFAULT_DANMAKU_CFG.targetCount))),
  }
  const state = workflowStore.get(roomId)
  const res = getResources(roomId, deps)
  const bus = getBus(deps.hub, roomId)

  // 阶段校验：collect 在 idle/completed/error/reviewing_danmaku 都允许
  if (!['idle', 'completed', 'error', 'reviewing_danmaku'].includes(state.phase)) {
    throw Object.assign(new Error(`当前阶段 ${state.phase} 不能收集弹幕`), { status: 409 })
  }

  // 直接进 reviewing_danmaku（已废弃的 collecting_danmaku 阶段被取消）；
  // completed 状态：不 reset，保留之前 collectedDanmaku/draftBeats/confirmedBeats/generatedClips，
  //   仅追加新弹幕；语义是"再开一轮"。其他状态 idle/error/reviewing_danmaku
  //   先 softReset 到 idle（保护性：clean previous run）再 collect。
  let next = state
  if (state.phase !== 'completed') {
    // reset 前先停掉可能仍在跑的 GenQueue：error 后再 collect 会留 in-flight worker 写脏 store
    await clearRoomResources(roomId)
    next = softResetForCollect(state)
  }
  next = applyAction(next, 'collect')
  workflowStore.upsert(next)
  emitPhase(bus, 'reviewing_danmaku', '开始审阅弹幕')

  // 1) 取原始弹幕（fetchDanmaku 优先；mock 模式或未接 douyin 时 fallback 到 makeMockDanmaku）
  let raw: DanmakuItem[]
  try {
    raw = deps.fetchDanmaku ? await deps.fetchDanmaku(cfg.targetCount) : makeMockDanmaku(cfg.targetCount)
  } catch (e) {
    // 不静默吞错误：让上层看到真实失败，便于排查 douyin/signature 问题
    throw new Error(`fetchDanmaku 失败: ${(e as Error).message}`)
  }
  // 2) 黑名单/最小长度/去重 → 末尾取 cfg.targetCount 条（不够则全返回）。
  // 取"最新"而非"最早"：用户在 10s 窗口内通常更关心末尾进的事件；wrapper 已固定 10s 窗口，
  // 不会出现"前5条全是 member 噪声"把 chat 切掉的旧 bug。
  const filtered = filterDanmaku(raw, cfg)
  const danmaku = filtered.length > cfg.targetCount ? filtered.slice(-cfg.targetCount) : filtered

  // 3) LLM 分类；mock provider 跳过 classifier，直接用长度启发式。
  // 对所有 filter 后的项目打分（含截断前的）：若前端展开手选，可能改用 relevance 排序。
  const premise = body.premise ?? state.collectedDanmaku[0]?.text ?? DEFAULT_PREMISE
  const useProvider = deps.mock ? undefined : res.providers.text
  for (const item of filtered) {
    const c = await classify(item.text, { premise, provider: useProvider })
    item.relevant = c.relevant
    item.relevance = c.relevance
  }

  // 合并到 store：保留旧的（防止用户重复 collect 丢数据），追加本轮截断后的弹幕。
  const merged: DanmakuItem[] = [...next.collectedDanmaku, ...danmaku]
  const updated: WorkflowState = { ...next, collectedDanmaku: merged, startedAt: next.startedAt || Date.now() }
  // 推进入 reviewing_danmaku（合法迁移 collecting_danmaku → reviewing_danmaku）
  const finalState: WorkflowState = transitionTo(updated, 'reviewing_danmaku')
  workflowStore.upsert(finalState)
  emitPhase(bus, 'reviewing_danmaku', `收到 ${danmaku.length} 条弹幕`)

  return { danmaku, state: finalState }
  })
}

// ─────────────────────────── 手动添加弹幕 ───────────────────────────

export async function handleAddDanmaku(
  deps: WorkflowHandlerDeps,
  roomId: string,
  body: { text?: string; user?: string } = {},
): Promise<{ item: DanmakuItem; state: WorkflowState }> {
  return await withRoomMutex(roomId, async () => {
  const text = String(body.text ?? '').trim()
  if (!text) {
    throw Object.assign(new Error('弹幕内容不能为空'), { status: 400 })
  }
  const state = workflowStore.get(roomId)
  const bus = getBus(deps.hub, roomId)

  // 阶段校验：允许在 idle/completed/error/reviewing_danmaku 添加
  if (!['idle', 'completed', 'error', 'reviewing_danmaku'].includes(state.phase)) {
    throw Object.assign(new Error(`当前阶段 ${state.phase} 不能添加弹幕`), { status: 409 })
  }

  const item: DanmakuItem = {
    id: nowId('dm'),
    user: String(body.user ?? '').trim() || '我（主播）',
    text,
    ts: Date.now(),
    source: 'manual',
    relevant: true,
    relevance: 1,
  }

  // 落到 reviewing_danmaku；从非 reviewing 状态进来时走一次 softResetForCollect + collect，
  // 把上一轮的 draftBeats/confirmedBeats 清掉（保留 generatedClips + scriptHistory），
  // 然后 append 本条弹幕。
  let next = state
  if (state.phase !== 'reviewing_danmaku') {
    if (state.phase !== 'completed') {
      await clearRoomResources(roomId)
      next = softResetForCollect(state)
    }
    next = applyAction(next, 'collect')
    next = transitionTo(next, 'reviewing_danmaku', {
      collectedDanmaku: [...next.collectedDanmaku, item],
    })
  } else {
    next = { ...state, collectedDanmaku: [...state.collectedDanmaku, item] }
  }
  workflowStore.upsert(next)
  emitPhase(bus, 'reviewing_danmaku', `手动加入 1 条弹幕`)

  return { item, state: next }
  })
}

// ─────────────────────────── 手动删除弹幕 ───────────────────────────

export async function handleRemoveDanmaku(
  deps: WorkflowHandlerDeps,
  roomId: string,
  body: { itemId?: string } = {},
): Promise<{ state: WorkflowState }> {
  return await withRoomMutex(roomId, async () => {
  const itemId = String(body.itemId ?? '').trim()
  if (!itemId) {
    throw Object.assign(new Error('itemId 必填'), { status: 400 })
  }
  const state = workflowStore.get(roomId)

  const filtered = state.collectedDanmaku.filter((d) => d.id !== itemId)
  if (filtered.length === state.collectedDanmaku.length) {
    throw Object.assign(new Error('弹幕不存在或已删除'), { status: 404 })
  }

  const next: WorkflowState = { ...state, collectedDanmaku: filtered }
  workflowStore.upsert(next)

  return { state: next }
  })
}

// ─────────────────────────── 提交弹幕 → 生成剧本 ───────────────────────────

export async function handleSubmitDanmaku(
  deps: WorkflowHandlerDeps,
  roomId: string,
  body: { itemIds?: string[]; premise?: string } = {},
): Promise<{ draftBeats: DraftBeat[]; state: WorkflowState }> {
  return await withRoomMutex(roomId, async () => {
  const state = workflowStore.get(roomId)
  const bus = getBus(deps.hub, roomId)
  guard(state, 'submit_danmaku')

  // 选弹幕；如果没传 itemIds，默认用相关(relevant=true) 的
  const selected = body.itemIds && body.itemIds.length
    ? state.collectedDanmaku.filter((d) => body.itemIds!.includes(d.id))
    : state.collectedDanmaku.filter((d) => d.relevant !== false)
  if (!selected.length) {
    throw Object.assign(new Error('没有选中任何弹幕'), { status: 400 })
  }

  // 转场 → generating_script
  let cur = applyAction(state, 'submit_danmaku')
  workflowStore.upsert(cur)
  emitPhase(bus, 'generating_script', `用 ${selected.length} 条弹幕生成剧本`)

  // 调 splitter
  const res = getResources(roomId, deps)
  const splitter = new AiStorySplitter()
  const premise = body.premise ?? DEFAULT_PREMISE
  const ctxLines = selected.map((d) => `- ${d.user}: ${d.text}`).join('\n')
  let plan
  try {
    plan = await splitter.split({
      premise: `${premise}\n\n观众弹幕：\n${ctxLines}`,
      provider: res.providers.text,
      logger: () => {},
    })
  } catch (e) {
    // splitter 失败 → workflow error
    const failState = applyAction(cur, 'fail', `剧本生成失败：${(e as Error).message}`)
    workflowStore.upsert(failState)
    emitPhase(bus, 'error', failState.error)
    throw e
  }

  const draftBeats: DraftBeat[] = plan.beats.map((b) => ({
    id: b.id,
    summary: b.summary,
    shots: b.shots,
    confirmed: false,
  }))

  // 转场 → reviewing_beats（generating_script → reviewing_beats 是合法迁移）
  const next: WorkflowState = transitionTo({ ...cur, draftBeats }, 'reviewing_beats')
  workflowStore.upsert(next)
  emitPhase(bus, 'reviewing_beats', `生成 ${draftBeats.length} 拍`)

  return { draftBeats, state: next }
  })
}

// ─────────────────────────── 编辑 + 确认 beats ───────────────────────────

export async function handleConfirmBeats(
  deps: WorkflowHandlerDeps,
  roomId: string,
  body: { beats: DraftBeat[] } = { beats: [] },
): Promise<{ beats: Beat[]; state: WorkflowState }> {
  return await withRoomMutex(roomId, async () => {
  const state = workflowStore.get(roomId)
  const bus = getBus(deps.hub, roomId)
  guard(state, 'confirm_beats')

  const incoming = body.beats ?? []
  if (!Array.isArray(incoming) || !incoming.length) {
    throw Object.assign(new Error('beats 不能为空'), { status: 400 })
  }
  // 校验每条 beat 结构
  for (const b of incoming) {
    if (!b.summary || !Array.isArray(b.shots) || !b.shots.length) {
      throw Object.assign(new Error(`beat ${b.id} 缺少 summary 或 shots`), { status: 400 })
    }
    for (const s of b.shots) {
      if (!s.prompt) {
        throw Object.assign(new Error(`beat ${b.id} 含空镜头 prompt`), { status: 400 })
      }
    }
  }

  const confirmedBeats: Beat[] = incoming.map((b) => ({
    id: b.id,
    summary: b.summary,
    shots: b.shots.map((s) => ({ ...s, beatId: b.id })),
  }))

  // 本轮确认即归档：把 incoming（用户最终编辑过的版本）推入 scriptHistory 并清空 draftBeats，
  // 这样下一轮 submit 生成的剧本是唯一的"当前剧本"，历史只在折叠区可见。
  const newHistory = confirmedBeats.length > 0
    ? [...state.scriptHistory, confirmedBeats]
    : state.scriptHistory

  let next: WorkflowState = { ...state, draftBeats: [], confirmedBeats, scriptHistory: newHistory }
  next = applyAction(next, 'confirm_beats')
  workflowStore.upsert(next)
  emitPhase(bus, 'generating_clips', `确认 ${confirmedBeats.length} 拍，开始生成`)

  return { beats: confirmedBeats, state: next }
  })
}

// ─────────────────────────── 生成 clips ───────────────────────────

/** 监听 queue 的 clip/失败事件，把 clipView 写回 store，结束后切到 completed/error */
function driveGenerateClips(
  deps: WorkflowHandlerDeps,
  roomId: string,
  beats: Beat[],
  state: WorkflowState,
): void {
  const res = getResources(roomId, deps)
  const bus = getBus(deps.hub, roomId)
  const errorPolicy = makeDefaultErrorPolicy()
  const expectedShots = beats.reduce((n, b) => n + b.shots.length, 0)
  const clipMap = new Map<string, ClipView>()
  let clipsReady = 0
  let clipsFailed = 0
  let finished = false

  // 用一个本地 queue 顶替 getResources 中的"只读"queue：本任务结束并不影响原 stream start
  const queue = new GenQueue(
    res.providers.video,
    res.providers.linker ?? undefined,
    {
      onShotStart: () => {},
      onClipReady: (clip) => {
        const view: ClipView = {
          id: clip.id,
          shotId: clip.shotId,
          url: `/clips/${clip.path.split(/[\\/]/).pop()}`,
          duration: clip.duration,
          readyAt: clip.readyAt,
        }
        clipMap.set(clip.shotId, view)
        clipsReady++
        const cur = workflowStore.get(roomId)
        const all = [...cur.generatedClips.filter((c) => !clipMap.has(c.shotId)), ...clipMap.values()]
        workflowStore.upsert({ ...cur, generatedClips: all })
        bus.emit('clip', view)
        if (clipsReady + clipsFailed >= expectedShots && !finished) {
          finished = true
          generatingTasks.delete(roomId)
          if (clipsFailed > 0) {
            const failState = applyAction(workflowStore.get(roomId), 'fail', `有 ${clipsFailed} 个镜头生成失败`)
            workflowStore.upsert(failState)
            emitPhase(bus, 'error', failState.error)
          } else {
            const ok = workflowStore.get(roomId)
            // completed 不是 ALLOWED['generating_clips'] 的子迁移；走 canTransition 兜底
            const finalState: WorkflowState = { ...ok, phase: 'completed', error: undefined }
            if (canTransition('generating_clips', 'completed')) {
              workflowStore.upsert(finalState)
              emitPhase(bus, 'completed', `共生成 ${clipsReady} 个片段`)
            } else {
              // 强制覆写（兜底）
              workflowStore.upsert(finalState)
              emitPhase(bus, 'completed', `共生成 ${clipsReady} 个片段`)
            }
          }
        }
      },
      onShotFailed: (_shotId, err) => {
        clipsFailed++
        if (errorPolicy.classify(err) === 'fatal' && !finished) {
          finished = true
          generatingTasks.delete(roomId)
          const cur = workflowStore.get(roomId)
          const failState = applyAction(cur, 'fail', `致命错误：${err.message}`)
          workflowStore.upsert(failState)
          emitPhase(bus, 'error', failState.error)
        }
      },
      onLog: () => {},
      onLatency: () => {},
    },
    {
      concurrency: deps.cfg.gen.concurrency,
      maxRetries: deps.cfg.gen.maxRetries,
      errorPolicy,
    },
  )

  for (const b of beats) queue.enqueue(b.shots)
}

export async function handleGenerateClips(
  deps: WorkflowHandlerDeps,
  roomId: string,
): Promise<{ queued: number; state: WorkflowState }> {
  return await withRoomMutex(roomId, async () => {
  const state = workflowStore.get(roomId)
  const bus = getBus(deps.hub, roomId)
  if (state.phase !== 'generating_clips') {
    throw Object.assign(new Error(`当前阶段 ${state.phase} 不能生成 clips`), { status: 409 })
  }
  if (generatingTasks.get(roomId)) {
    throw Object.assign(new Error('该房间正在生成中，请稍候'), { status: 409 })
  }
  if (!state.confirmedBeats.length) {
    throw Object.assign(new Error('没有已确认的 beats'), { status: 400 })
  }
  // 数镜头
  const queued = state.confirmedBeats.reduce((n, b) => n + b.shots.length, 0)
  // 启动后台生成（不 await，让前端用 GET 轮询）；先置位 in-flight，driveGenerateClips 完成时清零
  generatingTasks.set(roomId, true)
  driveGenerateClips(deps, roomId, state.confirmedBeats, state)
  emitPhase(bus, state.phase, `已入队 ${queued} 个镜头`)
  return { queued, state: workflowStore.get(roomId) }
  })
}

// ─────────────────────────── 状态查询 ───────────────────────────

export function handleGet(roomId: string): WorkflowState {
  return workflowStore.get(roomId)
}

// ─────────────────────────── 错误恢复 ───────────────────────────

/**
 * 从 error 状态恢复：回到 reviewing_danmaku，**保留** collectedDanmaku/draftBeats/confirmedBeats/generatedClips。
 * 与 reset 的区别：reset 清空所有数据从头来；recover 让用户修 premise / 改 prompt / 重试，无需重头收集。
 */
export async function handleRecover(
  deps: WorkflowHandlerDeps,
  roomId: string,
): Promise<{ state: WorkflowState }> {
  return await withRoomMutex(roomId, async () => {
    const state = workflowStore.get(roomId)
    const bus = getBus(deps.hub, roomId)
    if (state.phase !== 'error') {
      throw Object.assign(new Error(`当前阶段 ${state.phase} 不需要恢复`), { status: 409 })
    }
    const next = applyAction(state, 'recover')
    workflowStore.upsert(next)
    emitPhase(bus, 'reviewing_danmaku', '已恢复，可继续编辑或重提')
    return { state: next }
  })
}
