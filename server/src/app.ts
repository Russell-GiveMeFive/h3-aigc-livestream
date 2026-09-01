import { createServer } from 'node:http'
import express from 'express'
import type { AppConfig } from './config'
import { createApi } from './http/api'
import { attachWs } from './http/ws'
import { RoomHub } from './ws/rooms'

/** 组合根依赖：调用方可覆盖任何一层（Provider/Story/Error/Director） */
export interface AppDeps {
  config: AppConfig
  logger?: (roomId: string, msg: string) => void
}

export interface App {
  app: express.Express
  server: ReturnType<typeof createServer>
  hub: RoomHub
}

/** createApp：所有装配收敛在这里，便于 selftest / 二开 / 第三方启动复用 */
export function createApp(deps: AppDeps): App {
  const hub = new RoomHub()
  const sessions = new Map()
  const logger = deps.logger ?? ((room, msg) => console.log(`[${room}] ${msg}`))

  const app = createApi({ hub, sessions, onLog: logger, cfg: deps.config })
  const server = createServer(app)
  attachWs(server, hub)

  return { app, server, hub }
}