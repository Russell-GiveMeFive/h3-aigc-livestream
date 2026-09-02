import type http from 'node:http'
import type { IncomingMessage } from 'node:http'
import { URL } from 'node:url'
import { WebSocketServer, WebSocket } from 'ws'
import { nowId } from '../util'
import type { RoomHub } from '../ws/rooms'

/** 挂到现有 http.Server 上，提供 /ws?room=xxx 升级端点。
 *  房间总线里的事件按 WsEvent 协议转发给浏览器。 */
export function attachWs(server: http.Server, hub: RoomHub): void {
  const wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '', 'http://localhost')
    if (url.pathname !== '/ws') {
      socket.destroy()
      return
    }
    const roomId = String(url.searchParams.get('room') ?? '')
    if (!roomId) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
      socket.destroy()
      return
    }
    // RoomHub.bus() 是懒创建的（first subscribe / emit 时才 new RoomEventBus），
    // 所以连接时 hub.has(roomId) === false 是正常的。允许任意 roomId 进入。
    // 后续事件会通过 hub.bus(roomId) 自然触发创建。
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, roomId)
    })
  })

  wss.on('connection', (ws: WebSocket, _req: IncomingMessage, roomId: string) => {
    const bus = hub.bus(roomId)
    const clientName = `观众${nowId('user').slice(-4)}`
    let lastDanmakuAt = 0
    const events = ['log', 'clip', 'beat', 'phase', 'error', 'danmaku', 'liveDanmaku', 'liveDanmakuStatus'] as const
    const handlers = new Map<string, (payload: unknown) => void>()
    for (const ev of events) {
      const handler = (payload: unknown) => {
        if (ws.readyState !== WebSocket.OPEN) return
        const body = payload !== null && typeof payload === 'object' ? payload : { msg: payload }
        ws.send(JSON.stringify({ type: ev, ...body }))
      }
      handlers.set(ev, handler)
      bus.on(ev, handler)
    }
    ws.on('close', () => {
      for (const ev of events) bus.off(ev, handlers.get(ev)!)
    })
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(String(data))
        if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }))
        if (msg.type === 'danmaku') {
          const now = Date.now()
          const text = String(msg.text ?? '').trim().replace(/[\x00-\x1f]/g, '').slice(0, 120)
          if (!text || now - lastDanmakuAt < 800) return
          lastDanmakuAt = now
          bus.emit('danmaku', { id: nowId('dm'), user: clientName, text, ts: now })
        }
      } catch {
        /* ignore */
      }
    })
  })
}