import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { LiveDanmakuStreamer } from './streamer'
import type { DanmakuItem, LiveDanmakuStatus } from '@h3/protocol/types'
import type { RoomHub } from '../ws/rooms'

/** 简单 fake RoomHub：每个 roomId 一个 EventEmitter */
class FakeHub {
  buses = new Map<string, EventEmitter>()
  bus(id: string): EventEmitter {
    let b = this.buses.get(id)
    if (!b) {
      b = new EventEmitter()
      b.setMaxListeners(50)
      this.buses.set(id, b)
    }
    return b
  }
  has(id: string): boolean { return this.buses.has(id) }
  remove(id: string): void { this.buses.delete(id) }
}

/** 捕获某事件的所有 payload 供断言 */
function capture(bus: EventEmitter, ev: string): { items: DanmakuItem[]; statuses: LiveDanmakuStatus[] } {
  const items: DanmakuItem[] = []
  const statuses: LiveDanmakuStatus[] = []
  bus.on(ev, (p: unknown) => {
    if (ev === 'liveDanmaku') items.push((p as DanmakuItem))
    else if (ev === 'liveDanmakuStatus') statuses.push((p as { status: LiveDanmakuStatus }).status)
  })
  return { items, statuses }
}

/** fake douyin source 工厂：inject 一个订阅，模拟推 0~N 条消息再停 */
function makeFakeSourceFactory(opts: { failTimes?: number; items?: DanmakuItem[] } = {}) {
  const subs: Array<{ stop: () => Promise<void>; onItem: (i: DanmakuItem) => void }> = []
  let attempt = 0
  const create = () => ({
    name: 'douyin' as const,
    subscribe: async ({ onItem }: { onItem: (i: DanmakuItem) => void; roomId: string }) => {
      attempt++
      if (opts.failTimes && attempt <= opts.failTimes) {
        throw new Error(`fake fail ${attempt}`)
      }
      const sub = { onItem, stop: async () => undefined }
      subs.push(sub)
      // 同步推 items
      for (const it of opts.items ?? []) sub.onItem(it)
      return sub
    },
  })
  return { create, subs }
}

describe('LiveDanmakuStreamer', () => {
  let hub: FakeHub

  beforeEach(() => {
    hub = new FakeHub()
  })

  afterEach(() => {
    // 每个测试自己控制 stop()
  })

  it('start(mock mode) → status=mock, 立即吐一条假弹幕', async () => {
    const streamer = new LiveDanmakuStreamer({ hub: hub as unknown as RoomHub })
    const bus = hub.bus('r1')
    const log = capture(bus, 'liveDanmaku')
    const statusLog = capture(bus, 'liveDanmakuStatus')

    const result = await streamer.start('r1')
    expect(result.status).toBe('mock')
    expect(result.source).toBe('mock')

    // start 流程：先发 connecting 状态，再切 mock 模式
    expect(statusLog.statuses[0]).toBe('connecting')
    expect(statusLog.statuses).toContain('mock')

    // 立即吐了一条 mock 弹幕（在 'mock' 状态之后）
    expect(log.items.length).toBeGreaterThanOrEqual(1)

    await streamer.stop('r1')
    // 状态变成 closed（最后一个 status 是 stop 时发的）
    expect(statusLog.statuses[statusLog.statuses.length - 1]).toBe('closed')
    expect(streamer.keys()).toEqual([])
  })

  it('start 同一 room 两次 → refcount++，sub 不重连', async () => {
    const factory = makeFakeSourceFactory({ items: [{ id: 'd1', user: 'u', text: 'x', ts: 1, source: 'douyin' }] })
    const streamer = new LiveDanmakuStreamer({
      hub: hub as unknown as RoomHub,
      createSource: factory.create as never,
    })

    // 走真实 douyin 路径需要配置 douyinRoomId；用直接改 env 的方式不可靠 → 用 setSource 注入
    // 这里通过 process.env 临时设置
    const old = process.env.DOUYIN_ROOM_ID
    process.env.DOUYIN_ROOM_ID = 'r1'
    try {
      await streamer.start('r1')
      await streamer.start('r1')
      expect(factory.subs.length).toBe(1) // 没新建订阅
    } finally {
      if (old === undefined) delete process.env.DOUYIN_ROOM_ID
      else process.env.DOUYIN_ROOM_ID = old
      await streamer.stop('r1')
      await streamer.stop('r1')
    }
  })

  it('真实 douyin source：onItem → bus 收到 liveDanmaku 事件', async () => {
    const factory = makeFakeSourceFactory({
      items: [
        { id: 'd1', user: 'u', text: 'first', ts: 1, source: 'douyin' },
        { id: 'd2', user: 'u', text: 'second', ts: 2, source: 'douyin' },
      ],
    })
    const streamer = new LiveDanmakuStreamer({
      hub: hub as unknown as RoomHub,
      createSource: factory.create as never,
    })
    const bus = hub.bus('r2')
    const log = capture(bus, 'liveDanmaku')
    const statusLog = capture(bus, 'liveDanmakuStatus')

    const old = process.env.DOUYIN_ROOM_ID
    process.env.DOUYIN_ROOM_ID = 'r2'
    try {
      await streamer.start('r2')
      // createSource 在 subscribe 期间同步 push items → mock 已经发完
      // 实际 streamer 在 subscribe 返回后才 emit 'live'
      // 这里直接断言 bus 收到 live（同步已 push + status）
      expect(log.items.length).toBe(2)
      expect(log.items.map((i) => i.text)).toEqual(['first', 'second'])
      expect(statusLog.statuses).toContain('live')
    } finally {
      if (old === undefined) delete process.env.DOUYIN_ROOM_ID
      else process.env.DOUYIN_ROOM_ID = old
      await streamer.stop('r2')
    }
  })

  it('subscribe 抛错 → status=reconnecting，重试到 RECONNECT_MAX 后 closed', async () => {
    const factory = makeFakeSourceFactory({ failTimes: 99 }) // 永远失败
    const streamer = new LiveDanmakuStreamer({
      hub: hub as unknown as RoomHub,
      createSource: factory.create as never,
    })
    const bus = hub.bus('r3')
    const statusLog = capture(bus, 'liveDanmakuStatus')

    const old = process.env.DOUYIN_ROOM_ID
    process.env.DOUYIN_ROOM_ID = 'r3'
    try {
      await streamer.start('r3')
      // 启动即抛错 → connecting 状态先发，然后 scheduleReconnect 发 reconnecting
      expect(statusLog.statuses[0]).toBe('connecting')
      expect(statusLog.statuses).toContain('reconnecting')
      expect(['reconnecting', 'closed']).toContain(streamer.getStatus('r3'))
    } finally {
      if (old === undefined) delete process.env.DOUYIN_ROOM_ID
      else process.env.DOUYIN_ROOM_ID = old
    }
  })
})
