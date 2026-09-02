import type { EventEmitter } from 'node:events'
import type { DanmakuItem, LiveDanmakuStatus } from '@h3/protocol/types'
import type { RoomHub } from '../ws/rooms'
import { createDouyinSource, type DanmakuSubscription } from './douyin'
import { loadConfig } from '../configStore'

/**
 * LiveDanmakuStreamer —— 每间房一个持续 douyin / mock 订阅。
 *
 * 设计要点：
 * - per-room 状态：subscribe + 状态机；不持久化（用户决策：历史回放 = 丢）。
 * - refcount：同 roomId 多次 start() 仅 refcount++，复用同一 subscribe；
 *   直到 refcount 归零才真正 stop()。允许多端连同一房间（主播多开标签页、未来观众端共看）。
 * - mock 模式：未配置 douyinRoomId 时启动 setInterval（3~5s 随机）注入假弹幕，
 *   让 MOCK 演示模式也有"实时流"体验。
 * - bus 通道：所有 liveDanmaku/liveDanmakuStatus 经由 RoomHub.bus(roomId).emit 转发，
 *   http/ws.ts 会自动序列化给该房间的 WS 客户端；liveDanmaku 在 ws/rooms.ts 标记 SKIP_REPLAY，
 *   新连接不会重放过往流（用户决策：不持久化）。
 * - douyin 抛错 → status='reconnecting'，3 次重试后切 'closed'（不无限重连避免占资源）。
 */

const RECONNECT_MAX = 3
const MOCK_INTERVAL_MIN_MS = 3000
const MOCK_INTERVAL_RANGE_MS = 2000

const MOCK_TEXTS = [
  '来啦来啦～',
  '前排打卡',
  '这是什么神仙画面',
  '换个场景吧',
  '主人翁穿这件衣服好看',
  'BGM 来一首？',
  '路人路过求关注',
  '剧情是不是有点快',
  '求剧透',
  '弹幕辛苦，主播加油',
  '换个更暗的色调',
  '加个特写镜头',
  '把镜头拉远一点',
  '再来一段动作戏',
  '结尾别太赶',
]
const MOCK_USERS = ['阿伟', '小柚', '麦麦', '老王', '阿光', '小绿', '胖墩', 'Cici']

interface StreamState {
  roomId: string
  status: LiveDanmakuStatus
  source: 'douyin' | 'mock' | 'none'
  /** douyin 订阅句柄；mock 模式为 null */
  sub: DanmakuSubscription | null
  /** mock 定时器；douyin 模式为 null */
  mockTimer: NodeJS.Timeout | null
  refcount: number
  startedAt: number
  reconnectAttempts: number
}

export interface LiveDanmakuStreamerDeps {
  hub: RoomHub
  /** 测试用：注入假的 douyin 源工厂（替代真实 createDouyinSource） */
  createSource?: typeof createDouyinSource
  /** 测试用：覆盖默认 mock 文案/用户表 */
  mockTexts?: string[]
  mockUsers?: string[]
}

export class LiveDanmakuStreamer {
  private states = new Map<string, StreamState>()
  private readonly hub: RoomHub
  private readonly createSource: typeof createDouyinSource
  private readonly mockTexts: string[]
  private readonly mockUsers: string[]

  constructor(deps: LiveDanmakuStreamerDeps) {
    this.hub = deps.hub
    this.createSource = deps.createSource ?? createDouyinSource
    this.mockTexts = deps.mockTexts ?? MOCK_TEXTS
    this.mockUsers = deps.mockUsers ?? MOCK_USERS
  }

  /** 取当前订阅状态；不存在返回 'idle'。 */
  getStatus(roomId: string): LiveDanmakuStatus {
    return this.states.get(roomId)?.status ?? 'idle'
  }

  /** 取当前来源类型；不存在返回 'none'。 */
  getSource(roomId: string): 'douyin' | 'mock' | 'none' {
    return this.states.get(roomId)?.source ?? 'none'
  }

  /**
   * 启动（refcount++ 语义）：
   * - 已存在且 status !== 'closed'：refcount++，复用现有订阅，**不重连**；
   * - 否则新建 stream，按 douyinRoomId 是否配置走真/假两条路。
   * 返回当前 status（异步：不等待 douyin 连接完成）。
   */
  async start(roomId: string): Promise<{ status: LiveDanmakuStatus; source: 'douyin' | 'mock' | 'none' }> {
    const existing = this.states.get(roomId)
    if (existing && existing.status !== 'closed') {
      existing.refcount++
      return { status: existing.status, source: existing.source }
    }

    const roomIdForDouyin = this.resolveDouyinRoomId()
    const source: 'douyin' | 'mock' | 'none' = roomIdForDouyin ? 'douyin' : 'mock'

    const state: StreamState = {
      roomId,
      status: 'connecting',
      source,
      sub: null,
      mockTimer: null,
      refcount: 1,
      startedAt: Date.now(),
      reconnectAttempts: 0,
    }
    this.states.set(roomId, state)
    this.emitStatus(state, 'connecting')

    if (source === 'douyin') {
      try {
        const src = this.createSource({ debug: true })
        const sub = await src.subscribe({
          roomId: roomIdForDouyin!,
          onItem: (item) => this.emitLive(state, { ...item, source: 'douyin' }),
        })
        state.sub = sub
        if (state.status !== 'closed') {
          state.status = 'live'
          state.reconnectAttempts = 0
          this.emitStatus(state, 'live')
        }
      } catch (e) {
        // 启动期失败：不留挂起 → 进入 reconnecting 重试链
        state.reconnectAttempts++
        console.warn(`[live-danmaku] douyin subscribe failed: ${(e as Error).message}`)
        this.scheduleReconnect(state)
      }
    } else {
      // mock 模式
      state.mockTimer = setInterval(() => this.emitMock(state), this.nextMockInterval())
      state.status = 'mock'
      this.emitStatus(state, 'mock')
      // 立即吐一条，让 UI 立刻感知流活着
      this.emitMock(state)
    }

    return { status: this.getStatus(roomId), source: this.getSource(roomId) }
  }

  /**
   * 停止（refcount-- 语义）：
   * - refcount > 1：仅减，不真正断开；
   * - refcount 到 0：await sub?.stop() + clearInterval(mockTimer) + 删 Map 项。
   */
  async stop(roomId: string): Promise<void> {
    const state = this.states.get(roomId)
    if (!state) return
    state.refcount = Math.max(0, state.refcount - 1)
    if (state.refcount > 0) return

    state.status = 'closed'
    if (state.mockTimer) {
      clearInterval(state.mockTimer)
      state.mockTimer = null
    }
    if (state.sub) {
      try {
        await state.sub.stop()
      } catch (e) {
        console.warn(`[live-danmaku] sub.stop() failed: ${(e as Error).message}`)
      }
      state.sub = null
    }
    this.emitStatus(state, 'closed')
    this.states.delete(roomId)
  }

  /** 清掉所有（服务关闭时用） */
  async stopAll(): Promise<void> {
    const ids = [...this.states.keys()]
    await Promise.all(ids.map((id) => this.stop(id)))
  }

  /** 测试/debug：当前活跃房间列表 */
  keys(): string[] {
    return [...this.states.keys()]
  }

  // ─── 私有 ─────────────────────────────────────────

  private bus(roomId: string): EventEmitter {
    return this.hub.bus(roomId)
  }

  private emitLive(state: StreamState, item: DanmakuItem): void {
    if (state.status === 'closed') return
    this.bus(state.roomId).emit('liveDanmaku', item)
  }

  private emitStatus(state: StreamState, status: LiveDanmakuStatus): void {
    const detail = status === 'mock' ? 'mock 模式（未配置 douyinRoomId）' :
                   status === 'reconnecting' ? `重试 ${state.reconnectAttempts}/${RECONNECT_MAX}` :
                   undefined
    this.bus(state.roomId).emit('liveDanmakuStatus', { status, detail })
  }

  private resolveDouyinRoomId(): string | null {
    const saved = loadConfig().danmaku.douyinRoomId?.trim()
    if (saved) return saved
    const env = process.env.DOUYIN_ROOM_ID?.trim()
    return env || null
  }

  private nextMockInterval(): number {
    return MOCK_INTERVAL_MIN_MS + Math.floor(Math.random() * MOCK_INTERVAL_RANGE_MS)
  }

  private emitMock(state: StreamState): void {
    if (state.status === 'closed') return
    const text = this.mockTexts[Math.floor(Math.random() * this.mockTexts.length)]
    const user = this.mockUsers[Math.floor(Math.random() * this.mockUsers.length)]
    const item: DanmakuItem = {
      id: `mock_${state.roomId}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
      user,
      text,
      ts: Date.now(),
      source: 'mock',
    }
    this.emitLive(state, item)
    // 重新排下一条（独立间隔，让不同条间隔看起来更随机）
    if (state.mockTimer) {
      clearInterval(state.mockTimer)
      state.mockTimer = setInterval(() => this.emitMock(state), this.nextMockInterval())
    }
  }

  private scheduleReconnect(state: StreamState): void {
    if (state.reconnectAttempts >= RECONNECT_MAX) {
      state.status = 'closed'
      this.emitStatus(state, 'closed')
      this.states.delete(state.roomId)
      return
    }
    state.status = 'reconnecting'
    this.emitStatus(state, 'reconnecting')
    const delay = 1500 * state.reconnectAttempts
    setTimeout(() => {
      if (state.status !== 'reconnecting') return // 已被 stop
      this.tryReconnect(state)
    }, delay)
  }

  private async tryReconnect(state: StreamState): Promise<void> {
    const roomIdForDouyin = this.resolveDouyinRoomId()
    if (!roomIdForDouyin) {
      // 配置丢了 → 切 mock 更友好（不应发生，兜底）
      state.source = 'mock'
      state.mockTimer = setInterval(() => this.emitMock(state), this.nextMockInterval())
      state.status = 'mock'
      this.emitStatus(state, 'mock')
      return
    }
    try {
      const src = this.createSource({ debug: true })
      const sub = await src.subscribe({
        roomId: roomIdForDouyin,
        onItem: (item) => this.emitLive(state, { ...item, source: 'douyin' }),
      })
      state.sub = sub
      state.status = 'live'
      state.reconnectAttempts = 0
      this.emitStatus(state, 'live')
    } catch (e) {
      console.warn(`[live-danmaku] reconnect ${state.reconnectAttempts + 1} failed: ${(e as Error).message}`)
      state.reconnectAttempts++
      this.scheduleReconnect(state)
    }
  }
}

/** 单例：保持与 Hub/WorkflowStore 同生命周期（每个进程一份） */
let _instance: LiveDanmakuStreamer | null = null
export function getLiveDanmakuStreamer(hub: RoomHub): LiveDanmakuStreamer {
  if (!_instance) _instance = new LiveDanmakuStreamer({ hub })
  return _instance
}

/** 测试用：重置单例（每个 test 独立起一个 LiveDanmakuStreamer，避免互相污染） */
export function __resetLiveDanmakuStreamerForTests(): void {
  _instance = null
}
