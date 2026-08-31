import { EventEmitter } from 'node:events'

/** 每间直播房的内部事件总线（日志/状态/剧情拍/片段），由 WS 层转发给浏览器 */
export class RoomHub {
  private buses = new Map<string, EventEmitter>()

  bus(roomId: string): EventEmitter {
    let b = this.buses.get(roomId)
    if (!b) {
      b = new EventEmitter()
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
