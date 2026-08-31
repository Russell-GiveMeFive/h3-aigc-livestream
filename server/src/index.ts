import { createServer, type IncomingMessage } from 'node:http'
import { WebSocketServer, WebSocket } from 'ws'
import { parse } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'
import { nowId } from './util'
import { config, loadEnvFile } from './config'
import { createApi, type Session } from './http/api'
import { RoomHub } from './ws/rooms'

loadEnvFile()

fs.mkdirSync(config.cacheDir, { recursive: true })

const hub = new RoomHub()
const sessions = new Map<string, Session>()

const onLog = (roomId: string, msg: string) => {
  const stamp = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  console.log(`[${stamp}] [${roomId}] ${msg}`)
  hub.bus(roomId).emit('log', { ts: Date.now(), msg })
}

const app = createApi({ hub, sessions, onLog })
const server = createServer(app)

// ── WebSocket：/ws?room=xxx ──
const wss = new WebSocketServer({ noServer: true })
server.on('upgrade', (req: IncomingMessage, socket, head) => {
  const url = parse(req.url ?? '', true)
  if (url.pathname !== '/ws') {
    socket.destroy()
    return
  }
  const roomId = String(url.query.room ?? '')
  if (!roomId || !hub.has(roomId)) {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
    socket.destroy()
    return
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req, roomId)
  })
})

wss.on('connection', (ws: WebSocket, _req: IncomingMessage, roomId: string) => {
  const bus = hub.bus(roomId)
  const clientName = `观众${nowId('user').slice(-4)}`
  let lastDanmakuAt = 0
  const events = ['log', 'clip', 'beat', 'phase', 'error', 'danmaku'] as const
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
    for (const ev of events) {
      bus.off(ev, handlers.get(ev)!)
    }
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
      /* 忽略非法消息 */
    }
  })
})

server.listen(config.port, config.host, () => {
  const lines = [
    `── 实时 AIGC 直播服务已启动 ──`,
    `  主播入口: http://${config.host}:${config.port}/streamer`,
    `  观众入口: http://${config.host}:${config.port}/viewer?room=<room>`,
    `  模式: ${config.mock ? 'MOCK（无 Key 全链路演示）' : '真实 MiniMax API'}`,
    `  文本模型: ${config.minimax.textModel} / 视频模型: ${config.minimax.videoModel} ${config.minimax.resolution}`,
    `  推流: ${config.srs.rtmpBase}/<room>  →  HLS: ${config.srs.hlsBase}/<room>.m3u8`,
    `  缓存目录: ${config.cacheDir}`,
    ``,
  ]
  console.log(lines.join('\n'))
})
