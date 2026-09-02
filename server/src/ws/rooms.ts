import { EventEmitter } from 'node:events'

const RING_BUFFER_CAP = 50

interface BufferedEvent {
  ev: string
  payload: unknown
}

/**
 * 流式弹幕事件不写入 ring buffer、不重放给新连接：
 * 用户决策是"丢掉，不持久化"。新连进来的 WS 客户端应从 fresh live 流开始累计，
 * 而不是把上一次会话里的弹幕再吐一遍。
 *
 * 仍 emit 给当前已订阅的连接。
 */
const SKIP_REPLAY: ReadonlySet<string> = new Set(['liveDanmaku', 'liveDanmakuStatus'])

/**
 * EventEmitter that keeps a per-room ring buffer of recent events and replays
 * them to new listeners on subscribe (so late-joining WS clients don't miss
 * prior phase / clip / beat / log / danmaku / error events).
 */
class RoomEventBus extends EventEmitter {
  private buffer: BufferedEvent[] = []

  override on(ev: string, listener: (...args: any[]) => void): this {
    super.on(ev, listener)
    // Replay any buffered events of this type to the newly subscribed listener,
    // but only if the listener is still registered (defensive against removeAllListeners).
    if (this.listenerCount(ev) > 0 && this.listeners(ev).includes(listener)) {
      for (const { ev: bev, payload } of this.buffer) {
        if (bev === ev) listener(payload)
      }
    }
    return this
  }

  override emit(ev: string, payload?: any): boolean {
    // Skip internal "newListener"/"removeListener" events from the buffer.
    if (ev !== 'newListener' && ev !== 'removeListener' && !SKIP_REPLAY.has(ev)) {
      this.buffer.push({ ev, payload })
      if (this.buffer.length > RING_BUFFER_CAP) {
        this.buffer.splice(0, this.buffer.length - RING_BUFFER_CAP)
      }
    }
    return super.emit(ev, payload)
  }
}

/** 每间直播房的内部事件总线（日志/状态/剧情拍/片段），由 WS 层转发给浏览器 */
export class RoomHub {
  private buses = new Map<string, RoomEventBus>()

  bus(roomId: string): EventEmitter {
    let b = this.buses.get(roomId)
    if (!b) {
      b = new RoomEventBus()
      // 防止监听器泄漏告警（前端断开即 removeAllListeners）
      b.setMaxListeners(100)
      this.buses.set(roomId, b)
    }
    return b
  }

  remove(roomId: string): void {
    this.buses.delete(roomId)
  }

  has(roomId: string): boolean {
    return this.buses.has(roomId)
  }
}
