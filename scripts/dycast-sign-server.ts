/**
 * 抖音签名本地代理服务
 *
 * ----------------------------------------------------------------------------
 * 为什么需要这个脚本？
 *   抖音 wss 的 signature 参数由被混淆 + WebAssembly 的 webmssdk.js 计算。
 *   我们手头没有那段字节码（dycast ZIP 里是 0 字节占位符），所以主项目
 *   没法在 Node 里 1:1 复刻算法。
 *
 *   dycast README 给出的官方方案是：在浏览器侧加载抖音直播页 SDK 后，
 *   调 `window.getSign(roomId, uniqueId)`。本脚本就是这个方案的最小落地：
 *
 *     1. 启动一个无头 Chromium，访问 live.douyin.com/<roomId>
 *     2. 等页面 SDK 注入完成（轮询 window.byted_acrawler 或 5s 超时）
 *     3. 提取页面 state 里的 roomId / uniqueId
 *     4. 调 window.getSign(...) 把签名回传
 *
 *   主项目通过 `createRemoteSignatureFetcher('http://127.0.0.1:5174/api/sign')`
 *   把请求转发到这里。Chrome context 复用（首次启动后所有请求共用），签名
 *   缓存 30 分钟避免重复计算。
 *
 * 用法：
 *   # 一次性安装
 *   npm install --save-optional playwright
 *   npx playwright install chromium
 *
 *   # 启动服务（前台或后台都行）
 *   npm run dycast:sign-server
 *
 *   # 主项目侧无需改代码，设置环境变量启用 douyin source 即可
 *   # （详见 docs/douyin-integration.md）
 *
 * 端口：默认 5174（与 Vite dev server 错开，避免冲突）。
 * ----------------------------------------------------------------------------
 */

import http from 'node:http'
import { URL } from 'node:url'
import type { Page } from 'playwright'
import { decodeFrame, messageToItem, type DecodedDanmaku } from '../server/src/danmaku/decode'

/** 缓存：{ [roomId+uniqueId]: { signature, expiresAt } } */
const cache = new Map<string, { signature: string; expiresAt: number }>()
const CACHE_TTL_MS = 30 * 60 * 1000

/**
 * 已建立的直播间捕获：{ [webRid]: { page, roomId, uniqueId } }
 * 在 Edge 内开 wss 的 page 必须一直挂着（关掉就断流），由 sign-server 持有生命周期。
 */
const activeCaptures = new Map<string, { page: Page; webRid: string; roomId: string; uniqueId: string }>()

/** 已解码的弹幕环形缓冲：{ [roomId]: DecodedDanmaku[] } — Node 侧 poll 时按 max 取走 */
const danmakuBuffer = new Map<string, DecodedDanmaku[]>()
const DANMAKU_BUFFER_CAP = 2000

/**
 * 浏览器接入模式：
 *   - 默认（DOUYIN_USE_EDGE_CDP=1）：连接到你已经开着的 Edge，零登录
 *   - 否则：headless chromium 全新跑（需要登录）
 */
const USE_EDGE_CDP = process.env.DOUYIN_USE_EDGE_CDP === '1'
const EDGE_CDP_URL = process.env.EDGE_CDP_URL ?? 'http://127.0.0.1:9222'

/** 浏览器 / 持久 context（懒加载，第一次请求时才启动） */
let browserPromise: Promise<import('playwright').Browser> | null = null
let persistentContextPromise: Promise<import('playwright').BrowserContext> | null = null
async function getBrowser(): Promise<import('playwright').Browser> {
  if (USE_EDGE_CDP) {
    if (!browserPromise) {
      const { chromium } = await import('playwright')
      browserPromise = chromium.connectOverCDP(EDGE_CDP_URL, { timeout: 5000 })
      console.log(`[sign-server] connecting to Edge via CDP at ${EDGE_CDP_URL}`)
    }
    return browserPromise
  }
  if (!browserPromise) {
    const { chromium } = await import('playwright')
    browserPromise = chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    })
    console.log('[sign-server] chromium launched (headless, fresh profile)')
  }
  return browserPromise
}

/** CDP 模式必须复用用户已登录的 context，newContext() 会得到一个无 cookie 的 incognito，等于登出状态 */
async function getContext(): Promise<import('playwright').BrowserContext> {
  if (USE_EDGE_CDP) {
    if (!persistentContextPromise) {
      const browser = await getBrowser()
      const existing = browser.contexts()
      if (existing.length > 0) {
        persistentContextPromise = Promise.resolve(existing[0])
        console.log(`[sign-server] reusing ${existing.length} existing browser context(s); login cookies preserved`)
      } else {
        console.log('[sign-server] WARN: no existing context via CDP; falling back to newContext() (login required)')
        persistentContextPromise = browser.newContext({ viewport: { width: 1280, height: 800 } })
      }
    }
    return persistentContextPromise
  }
  // 非 CDP 模式：每次 computeSignature 自己 newContext + close
  throw new Error('[sign-server] getContext() only used in CDP mode')
}

interface ComputeOpts {
  roomId: string
  uniqueId: string
}

/** 打开抖音直播页，调 window.getSign 返回签名 */
async function computeSignature({ roomId, uniqueId }: ComputeOpts): Promise<string> {
  const context = USE_EDGE_CDP ? await getContext() : await (await getBrowser()).newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
    locale: 'zh-CN',
    viewport: { width: 1280, height: 800 },
  })
  const page = await context.newPage()

  try {
    const url = `https://live.douyin.com/${roomId}`
    console.log(`[sign-server] navigating ${url}`)
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })

    // 等 SDK 注入 — dycast README 说页面会暴露 window.byted_acrawler.frontierSign
    // 或 window.getSign；轮询直到拿到，否则 8s 超时
    await page.waitForFunction(
      () => {
        const w = window as unknown as {
          byted_acrawler?: { frontierSign?: unknown }
        }
        return !!w.byted_acrawler?.frontierSign
      },
      { timeout: 8_000 },
    ).catch(() => {
      // 容忍超时：某些房间可能不挂 frontierSign，但 getSign 函数仍可用
    })

    const result = await page.evaluate(
      ([rid, uid]: [string, string]) => {
        const w = window as unknown as {
          byted_acrawler?: {
            frontierSign: (
              payload: string,
              method: 'POST' | 'GET',
              url: string,
              isByteBody: boolean,
            ) => Promise<unknown>
          }
          getSign?: (roomId: string, uniqueId: string) => { 'X-Bogus': string } | unknown
        }
        if (typeof w.getSign === 'function') {
          // dycast 源码：let sign = window.getSign(roomId, uniqueId)['X-Bogus']
          return w.getSign(rid, uid)
        }
        if (w.byted_acrawler?.frontierSign) {
          return w.byted_acrawler.frontierSign(
            `${rid}_${uid}`,
            'GET',
            'https://webcast100-ws-web-lf.douyin.com/webcast/im/fetch/',
            false,
          )
        }
        throw new Error(
          '[sign-server] live.douyin.com did not expose getSign or byted_acrawler.frontierSign',
        )
      },
      [roomId, uniqueId] as [string, string],
    )

    // 抖音 SDK 返回结构：{ X-Bogus: 'xxx' } 或 frontierSign 直接返回字符串
    let signature: string | undefined
    if (result && typeof result === 'object' && 'X-Bogus' in (result as Record<string, unknown>)) {
      signature = (result as { 'X-Bogus': string })['X-Bogus']
    } else if (typeof result === 'string') {
      signature = result
    }
    if (!signature) {
      throw new Error(`[sign-server] computed signature invalid: ${JSON.stringify(result)}`)
    }
    return signature
  } finally {
    if (!USE_EDGE_CDP) {
      await context.close()
    }
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c as Buffer))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function jsonResponse(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/**
 * 用 Edge 拉直播页并抠 self.__pace_f 里的 React state
 * 解决 Node fetch 拿不到 React state 的问题（douyin 对非 UA 限制）
 *
 * 同时在 Edge 内挂一个 wss tap：拦截 douyin.com 的 WebSocket，
 * 把浏览器侧拿到的 protobuf 帧用 decodeFrame/messageToItem 解码，
 * 推到 danmakuBuffer（按 roomId 索引），供 Node 侧 GET /api/danmaku/:roomId 拉。
 *
 * 关键：捕获到 roomId 后 page 不能关 — 关掉 wss 就断。sign-server 持有 page 生命周期。
 */
async function resolveViaEdge(webRid: string): Promise<{
  roomId: string
  uniqueId: string
  webRid: string
  title?: string
}> {
  // 幂等：同一 webRid 已建过捕获就直接返回（前端轮询 resolve 不会重复开 page）
  const existing = activeCaptures.get(webRid)
  if (existing) {
    console.log(`[resolve] reuse existing capture for webRid=${webRid} roomId=${existing.roomId}`)
    return {
      roomId: existing.roomId,
      uniqueId: existing.uniqueId,
      webRid,
      title: undefined,
    }
  }

  const context = USE_EDGE_CDP ? await getContext() : await (await getBrowser()).newContext()
  const page = await context.newPage()

  // 必须在 goto 前挂 ws tap — playwright `page.on('websocket')` 只对注册后建立的 ws 生效
  attachWebSocketTap(page)

  // 拦截 douyin 加载直播数据的 XHR；典型 URL 形如
  //   https://live.douyin.com/webcast/room/web/enter/?aid=...&web_rid=...
  // 返回的 JSON 含 data.room.roomId / data.user.user_unique_id
  // 注：分字段的 mutable holder，避免 TS 在 callback 里把 `let captured: {…}|null` 推断成 never
  let capturedRoomId: string | undefined
  let capturedUniqueId: string | undefined
  let capturedTitle: string | undefined
  const seenUrls = new Set<string>()
  page.on('response', async (resp) => {
    const u = resp.url()
    // 调试：把所有 douyin 自家域名打出来，定位真实接口形态
    if (/douyin\.com|webcast\.|amemv\.com/.test(u) && !seenUrls.has(u)) {
      seenUrls.add(u)
      if (seenUrls.size <= 30) {
        console.log(`[resolve] url[${seenUrls.size}]: ${u}`)
      }
    }
    if (capturedRoomId && capturedUniqueId) return
    if (!/live\.douyin\.com/.test(u)) return
    // 抖音 webcast 接口响应通常是 protobuf，URL 参数里反而有 roomId / user_unique_id
    // 例：/webcast/im/fetch/?...&room_id=7680244078071630633&user_unique_id=7680254045773366818
    // 例：/webcast/room/web/enter/?...&web_rid=10776146386&room_id_str=7680244078071630633
    try {
      const parsed = new URL(u)
      const roomId = parsed.searchParams.get('room_id_str') ?? parsed.searchParams.get('room_id')
      const uniqueId = parsed.searchParams.get('user_unique_id')
      const webRid2 = parsed.searchParams.get('web_rid')
      if (roomId && uniqueId) {
        console.log(`[resolve] MATCHED from url params: roomId=${roomId} uniqueId=${uniqueId} webRid=${webRid2}`)
        capturedRoomId = roomId
        capturedUniqueId = uniqueId
        finalizeTap(page, roomId)
        return
      }
      // 兜底：尝试 JSON 解析（部分接口如 aweme/v1/web/* 会回 JSON）
      const ct = (resp.headers()['content-type'] ?? '').toLowerCase()
      if (!ct.includes('json')) return
      const body = (await resp.json()) as Record<string, unknown>
      const findDeep = (obj: unknown, key: string): unknown => {
        if (obj == null || typeof obj !== 'object') return undefined
        const rec = obj as Record<string, unknown>
        if (rec[key] !== undefined) return rec[key]
        for (const v of Object.values(rec)) {
          const found = findDeep(v, key)
          if (found !== undefined) return found
        }
        return undefined
      }
      const r2 = findDeep(body, 'roomId') ?? findDeep(body, 'room_id_str')
      const u2 = findDeep(body, 'user_unique_id')
      if (r2 && u2) {
        const rid = String(r2)
        const uid = String(u2)
        console.log(`[resolve] MATCHED from JSON body: roomId=${rid} uniqueId=${uid}`)
        capturedRoomId = rid
        capturedUniqueId = uid
        finalizeTap(page, rid)
      }
    } catch (e) {
      /* ignore */
    }
  })

  try {
    const url = `https://live.douyin.com/${webRid}`
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 })
  } catch {
    /* networkidle 超时也无所谓，等响应即可 */
  }

  // 兜底：再等 5s 让慢接口回来
  for (let i = 0; i < 25 && (!capturedRoomId || !capturedUniqueId); i++) {
    await new Promise((r) => setTimeout(r, 200))
  }

  if (!capturedRoomId || !capturedUniqueId) {
    const title = await page.title()
    console.log(`[resolve] debug: url=${page.url()} title=${title} no XHR captured`)
    if (!USE_EDGE_CDP) await context.close()
    throw new Error('[resolve] no room info XHR captured from live.douyin.com')
  }

  // 持有 page 生命周期 — 关掉就断流
  activeCaptures.set(webRid, {
    page,
    webRid,
    roomId: capturedRoomId,
    uniqueId: capturedUniqueId,
  })
  if (!danmakuBuffer.has(capturedRoomId)) {
    danmakuBuffer.set(capturedRoomId, [])
  }

  return {
    roomId: capturedRoomId,
    uniqueId: capturedUniqueId,
    webRid,
    title: capturedTitle,
  }
}

/**
 * 在 page 上挂 WebSocket 监听器，把 douyin.com 的 wss 帧解码后塞进 danmakuBuffer。
 *
 * 必须**在 goto 之前**挂好 — playwright `page.on('websocket')` 只对注册之后建立的 ws 生效，
 * 抖音 SDK 在页面加载后立即开 wss，错过就再也收不到。
 *
 * 帧路由用 module-level `pendingRoomIdByPage` 弱引用 map：response 监听器拿到 roomId 后写入，
 * 帧回调里取出来作为目标 buffer key。在 roomId 尚未解析出来前收到的帧会被暂存（按 ws URL 里
 * 的 room_id 参数推断到候选 key），避免匹配前的帧被丢弃。
 */
const pendingRoomIdByPage = new WeakMap<Page, string>()
const pendingPreMatchBuffers = new WeakMap<Page, Map<string, DecodedDanmaku[]>>()

function attachWebSocketTap(page: Page): void {
  if ((page as unknown as { __wsTapAttached?: boolean }).__wsTapAttached) return
  ;(page as unknown as { __wsTapAttached?: boolean }).__wsTapAttached = true
  pendingPreMatchBuffers.set(page, new Map())

  let frameCount = 0
  let cdpFrameCount = 0
  let highLevelSeen = 0
  page.on('websocket', (ws) => {
    if (!/douyin\.com/.test(ws.url())) return

    let candidateKey = pendingRoomIdByPage.get(page) ?? ''
    if (!candidateKey) {
      try {
        const u = new URL(ws.url())
        candidateKey =
          u.searchParams.get('room_id') ??
          u.searchParams.get('room_id_str') ??
          `__prematch:${page.url()}`
      } catch {
        candidateKey = `__prematch:${page.url()}`
      }
    }
    console.log(`[ws-tap] high-level attach to ${ws.url().slice(0, 80)}… (key=${candidateKey})`)

    ws.on('framereceived', (data) => {
      highLevelSeen++
      try {
        const buf = (() => {
          if (data instanceof Buffer) return new Uint8Array(data)
          if (data instanceof Uint8Array) return data
          return null
        })()
        if (!buf) return
        console.log(`[ws-tap] HIGH-LEVEL frame seen bytes=${buf.length} (count=${highLevelSeen})`)
        ingestWsFrame(page, candidateKey, buf)
      } catch (err) {
        console.log(`[ws-tap] high-level decode err: ${(err as Error).message}`)
      }
    })
    ws.on('close', () => console.log(`[ws-tap] high-level closed key=${candidateKey}`))
    ws.on('socketerror', (err) => console.log(`[ws-tap] high-level socketerr key=${candidateKey}: ${err}`))
  })

  // CDP fallback: 直接订阅 Network.webSocketFrameReceived — 不依赖 playwright 的 ws 事件。
  // 一些 wss（特别是服务端推送且无 mask 的帧）playwright 的 framereceived 可能不触发，
  // 但 CDP 一定能看到。
  void (async () => {
    try {
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('Network.enable')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cdp.on('Network.webSocketFrameReceived', (evt: any) => {
        try {
          const url: string = evt?.request?.url ?? ''
          const payload: string = evt?.response?.payloadData ?? ''
          const opcode: number = evt?.response?.opcode ?? 0
          // 诊断：每 100 帧（不限 url / opcode）打点，确认 CDP 是否真在收到帧
          if (cdpFrameCount % 100 === 0) {
            console.log(`[ws-tap] CDP any frame#${cdpFrameCount} opcode=${opcode} url=${url.slice(0, 60)} bytes=${payload.length}`)
          }
          cdpFrameCount++
          if (!/douyin\.com/.test(url)) return
          // opcode 2 = binary frame; 抖音 wss 用 binary 帧
          if (opcode !== 2) return
          // CDP 的 payloadData 是 base64
          const buf = Buffer.from(payload, 'base64')
          if (frameCount < 10 || frameCount % 100 === 0) {
            console.log(`[ws-tap] CDP raw frame#${frameCount} bytes=${buf.length} url=${url.slice(0, 60)}`)
          }
          let key = pendingRoomIdByPage.get(page) ?? ''
          if (!key) {
            try {
              const u = new URL(url)
              key = u.searchParams.get('room_id') ?? u.searchParams.get('room_id_str') ?? `__prematch:${page.url()}`
            } catch {
              key = `__prematch:${page.url()}`
            }
          }
          ingestWsFrame(page, key, new Uint8Array(buf))
        } catch (err) {
          if (frameCount < 3) console.log(`[ws-tap] CDP decode err: ${(err as Error).message}`)
        }
      })
      console.log('[ws-tap] CDP Network.webSocketFrameReceived armed')
    } catch (err) {
      console.log('[ws-tap] CDP attach failed:', (err as Error).message)
    }
  })()
}

/** 共用的帧解码+入队逻辑，被 high-level 回调和 CDP 回调共用 */
function ingestWsFrame(page: Page, candidateKey: string, buf: Uint8Array): void {
  const messages = decodeFrame(buf)
  const targetKey = pendingRoomIdByPage.get(page) ?? candidateKey
  if (!danmakuBuffer.has(targetKey)) danmakuBuffer.set(targetKey, [])
  let pushed = 0
  for (const m of messages) {
    const item = messageToItem(m)
    if (!item) continue
    const buf2 = danmakuBuffer.get(targetKey)!
    buf2.push(item)
    if (buf2.length > DANMAKU_BUFFER_CAP) buf2.splice(0, buf2.length - DANMAKU_BUFFER_CAP)
    pushed++
  }
  // 单纯累加（high-level 与 CDP 共用同一个 frameCount 闭包需要模块级；这里取巧：输出到 console 即可）
  if (pushed > 0 || messages.length > 0) {
    console.log(`[ws-tap] INGEST key=${targetKey} bytes=${buf.length} messages=${messages.length} pushed=${pushed} buf=${danmakuBuffer.get(targetKey)?.length ?? 0}`)
  }
}

/** response 监听器在 MATCHED 时调用，把所有暂存帧搬到正式 roomId 缓冲下 */
function finalizeTap(page: Page, roomId: string): void {
  pendingRoomIdByPage.set(page, roomId)
  if (!danmakuBuffer.has(roomId)) danmakuBuffer.set(roomId, [])
  const pre = pendingPreMatchBuffers.get(page)
  if (!pre) return
  const target = danmakuBuffer.get(roomId)!
  for (const [key, items] of pre.entries()) {
    if (key === roomId) continue
    target.push(...items)
    pre.delete(key)
  }
  if (target.length > DANMAKU_BUFFER_CAP) target.splice(0, target.length - DANMAKU_BUFFER_CAP)
}

const PORT = Number(process.env.DYCAST_SIGN_PORT ?? 5174)

const server = http.createServer(async (req, res) => {
  // CORS：本地开发随便用
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'content-type')
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')

  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`)

  if (req.method === 'OPTIONS') {
    res.writeHead(204).end()
    return
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    jsonResponse(res, 200, { ok: true, cacheSize: cache.size, captures: activeCaptures.size })
    return
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/danmaku/')) {
    const roomId = url.pathname.slice('/api/danmaku/'.length)
    if (!roomId) {
      jsonResponse(res, 400, { error: 'roomId required in path' })
      return
    }
    const max = Math.max(1, Math.min(500, Number(url.searchParams.get('max') ?? 100)))
    const buf = danmakuBuffer.get(roomId) ?? []
    // 原子取走：splice 一次切走前 max 条，剩下的还在 buffer
    const taken = buf.splice(0, max)
    jsonResponse(res, 200, { danmaku: taken, remaining: buf.length })
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/resolve') {
    let raw: string
    try {
      raw = await readBody(req)
    } catch (e) {
      jsonResponse(res, 400, { error: `body read failed: ${(e as Error).message}` })
      return
    }
    let payload: { webRid?: string }
    try {
      payload = JSON.parse(raw)
    } catch {
      jsonResponse(res, 400, { error: 'invalid JSON body' })
      return
    }
    const { webRid } = payload
    if (!webRid) {
      jsonResponse(res, 400, { error: 'webRid is required' })
      return
    }
    try {
      const resolved = await resolveViaEdge(webRid)
      jsonResponse(res, 200, resolved)
    } catch (e) {
      jsonResponse(res, 500, { error: (e as Error).message })
    }
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/sign') {
    let raw: string
    try {
      raw = await readBody(req)
    } catch (e) {
      jsonResponse(res, 400, { error: `body read failed: ${(e as Error).message}` })
      return
    }
    let payload: { roomId?: string; uniqueId?: string }
    try {
      payload = JSON.parse(raw)
    } catch {
      jsonResponse(res, 400, { error: 'invalid JSON body' })
      return
    }
    const { roomId, uniqueId } = payload
    if (!roomId || !uniqueId) {
      jsonResponse(res, 400, { error: 'roomId and uniqueId are required' })
      return
    }

    const cacheKey = `${roomId}_${uniqueId}`
    const cached = cache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      console.log(`[sign-server] cache hit ${cacheKey}`)
      jsonResponse(res, 200, { signature: cached.signature, cached: true })
      return
    }

    try {
      const signature = await computeSignature({ roomId, uniqueId })
      cache.set(cacheKey, {
        signature,
        expiresAt: Date.now() + CACHE_TTL_MS,
      })
      jsonResponse(res, 200, { signature, cached: false })
    } catch (e) {
      jsonResponse(res, 500, { error: (e as Error).message })
    }
    return
  }

  jsonResponse(res, 404, { error: `unknown route ${req.method} ${url.pathname}` })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[sign-server] listening http://127.0.0.1:${PORT}`)
  console.log(`  POST /api/sign  body={roomId,uniqueId}  -> {signature}`)
  console.log(`  GET  /health    -> {ok,cacheSize}`)
  if (USE_EDGE_CDP) {
    console.log(`  mode = Edge CDP attach (${EDGE_CDP_URL})`)
    console.log('  ⚠️  请先用调试端口启动 Edge:')
    console.log('     "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" --remote-debugging-port=9222')
    console.log('     然后登录抖音。Edge 关掉的话本服务会断；不用本服务时关掉。')
  } else {
    console.log('  mode = headless chromium（首次会需要登录抖音）')
    console.log('  想复用你已登录的 Edge？设 DOUYIN_USE_EDGE_CDP=1 重启')
  }
})

process.on('SIGINT', async () => {
  console.log('\n[sign-server] shutting down')
  server.close()
  if (browserPromise) {
    try {
      const b = await browserPromise
      await b.close()
    } catch {
      /* ignore */
    }
  }
  process.exit(0)
})