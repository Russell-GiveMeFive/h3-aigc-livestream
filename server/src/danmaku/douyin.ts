/**
 * Douyin DanmakuSource — 抖音直播间弹幕 Node 端接入
 *
 * 两种模式：
 *   - 'native' (default): Node 端开 wss（参考 dycast 原版，依赖 signature fetcher + 浏览器侧 cookie 转发）
 *   - 'edge-forward': 不开 wss，让 sign-server 在 Edge 浏览器里开 wss 并抓帧，Node 只拉已解码的 DanmakuItem
 *     （推荐方案 — 抖音反爬验证 cookie + signature 必须来自同一浏览器上下文）
 *
 * native 模式完整数据通路：
 *   roomIdOrUrl
 *     → resolveRoomInfo()           [roomInfo.ts]   roomId / uniqueId
 *     → signatureFetcher()          [signature.ts]  signature (X-Bogus)
 *     → buildWsUrl()                                 wss://...
 *     → ws.connect()
 *     → PushFrame.decode()         [decode.ts]
 *     → if headersMap.compress_type=='gzip' → inflate
 *     → Response.decode()
 *     → for each Message: ChatMessage.decode(payload)
 *     → onItem(DanmakuItem)
 *
 * edge-forward 模式：
 *   roomIdOrUrl → resolveRoomInfo() → 拉 sign-server 的 danmaku buffer（轮询 GET /api/danmaku/:roomId）
 */

import WebSocket from 'ws'
import type { DanmakuItem } from '@h3/protocol/types'

import { resolveRoomInfo, type ResolvedRoom } from './roomInfo'
import {
  PushFrame,
  Message,
  Response,
} from './proto'
import { decodeFrame, decodeFrameWithAck, messageToItem, type DecodedMessage, type DecodedDanmaku } from './decode'
import {
  createNodeSignatureFetcher,
  createNodeSignatureStub,
  type SignatureFetcher,
  type SignatureResult,
  type WssSignatureFetcher,
} from './signature'

// ── 对外接口 ──

export interface SubscribeOpts {
  roomId: string
  onItem: (item: DanmakuItem) => void
  signal?: AbortSignal
}

export interface DanmakuSubscription {
  stop(): Promise<void>
}

export interface DanmakuSource {
  readonly name: 'douyin' | 'manual' | 'mock'
  subscribe(opts: SubscribeOpts): Promise<DanmakuSubscription>
}

export interface DouyinSourceDeps {
  /**
   * 签名 fetcher。两形态兼容：
   *  - 新接口 (wssUrl: string) => Promise<{signature}>：用真 Node vm 算
   *  - 旧接口 (roomId, uniqueId) => Promise<{signature}>：传给一个外部服务
   * 不传则默认走 createNodeSignatureFetcher()（vm 跑 webmssdk.js）。
   */
  signatureImpl?: WssSignatureFetcher | SignatureFetcher
  /** 自定义 wss 入口（调试用，默认 webcast100-ws-web-lq） */
  wsHost?: string
  /** 调试日志开关 */
  debug?: boolean
  /**
   * 'native' (default): Node 端自己开 wss（推荐：现在签名也纯 Node 算）
   * 'edge-forward': sign-server 在浏览器侧开 wss 并抓帧，Node 轮询拉已解码的 danmaku
   */
  mode?: 'native' | 'edge-forward'
  /** 'edge-forward' 模式下必填：sign-server 地址（含协议与端口，无路径） */
  signServerUrl?: string
  /** 'edge-forward' 模式下的轮询间隔（ms），默认 500 */
  pollIntervalMs?: number
}

// ── URL 构造（直接照搬 dycast Left.vue 的格式，仅替换变量） ──

const DEFAULT_WS_HOST = 'webcast100-ws-web-lq.douyin.com'

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

function buildWsUrl(
  room: ResolvedRoom,
  sig: SignatureResult,
  host: string,
): string {
  const now = Date.now()
  const userAgent = encodeURIComponent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  )
  // 严格对齐 DouyinLiveWebFetcher/liveMan.py:wss 拼接格式（与 dycast 的格式不同）。
  const internalExt =
    `internal_src:dim|wss_push_room_id:${room.roomId}` +
    `|wss_push_did:${room.uniqueId}` +
    `|first_req_ms:${now}` +
    `|fetch_time:${now}` +
    `|seq:1|wss_info:0-${now}-0-0` +
    `|wrds_v:${now}` // 抖音侧要求非空；用 fetch_time 即可（不需要匹配 Python 那个固定值）
  const cursor = `d-1_u-1_fh-${now}_t-${now}_r-1`
  const params = [
    ['app_name', 'douyin_web'],
    ['version_code', '180800'],
    ['webcast_sdk_version', '1.0.14-beta.0'],
    ['update_version_code', '1.0.14-beta.0'],
    ['compress', 'gzip'],
    ['device_platform', 'web'],
    ['cookie_enabled', 'true'],
    ['screen_width', '1920'],
    ['screen_height', '1080'],
    ['browser_language', 'zh-CN'],
    ['browser_platform', 'Win32'],
    ['browser_name', 'Mozilla'],
    ['browser_version', userAgent],
    ['browser_online', 'true'],
    ['tz_name', 'Asia/Shanghai'],
    ['cursor', cursor],
    ['internal_ext', internalExt],
    ['host', 'https://live.douyin.com'],
    ['aid', '6383'],
    ['live_id', '1'],
    ['did_rule', '3'],
    ['endpoint', 'live_pc'],
    ['support_wrds', '1'],
    ['user_unique_id', room.uniqueId],
    ['im_path', '/webcast/im/fetch/'],
    ['identity', 'audience'],
    ['room_id', room.roomId],
    ['heartbeatDuration', '0'],
    ['need_persist_msg_count', '15'],
    ['insert_task_id', ''],
    ['live_reason', ''],
    ['signature', sig.signature],
  ]
  const qs = params.map(([k, v]) => `${k}=${v}`).join('&')
  return `wss://${host}/webcast/im/push/v2/?${qs}`
}

// ── 帧解析（实现在 decode.ts，被 server + scripts 共享） ──

// ── 主类 ──

interface ActiveSession {
  ws: WebSocket
  pingTimer: NodeJS.Timeout | null
  closed: boolean
}

export class DouyinSource implements DanmakuSource {
  readonly name = 'douyin' as const

  private readonly sig: WssSignatureFetcher
  private readonly wsHost: string
  private readonly debug: boolean
  private readonly mode: 'native' | 'edge-forward'
  private readonly signServerUrl: string | null
  private readonly pollIntervalMs: number
  private session: ActiveSession | null = null
  private edgeForwardPoller: NodeJS.Timeout | null = null

  constructor(deps: DouyinSourceDeps = {}) {
    // 默认走真 Node vm 算签名（拷过来的 webmssdk.js）
    const defaultFetcher = createNodeSignatureFetcher()
    const userFetcher = deps.signatureImpl
    // 适配老接口 (roomId, uniqueId) -> (wssUrl)
    this.sig = userFetcher
      ? userFetcher.length >= 2
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ((wssUrl: string) => (userFetcher as SignatureFetcher)(
            new URL(wssUrl).searchParams.get('room_id') ?? '',
            new URL(wssUrl).searchParams.get('user_unique_id') ?? '',
          )) as WssSignatureFetcher
        : (userFetcher as WssSignatureFetcher)
      : defaultFetcher
    this.wsHost = deps.wsHost ?? DEFAULT_WS_HOST
    this.debug = Boolean(deps.debug)
    this.mode = deps.mode ?? 'native'
    this.signServerUrl = deps.signServerUrl ?? null
    this.pollIntervalMs = deps.pollIntervalMs ?? 500
  }

  private log(...args: unknown[]) {
    if (this.debug) console.log('[douyin]', ...args)
  }

  async subscribe(opts: SubscribeOpts): Promise<DanmakuSubscription> {
    if (this.mode === 'edge-forward') {
      return this.subscribeEdgeForward(opts)
    }
    // 若旧 session 没关，先关
    if (this.session) {
      await this.closeSession()
    }

    const { roomId, onItem, signal } = opts

    // 1. 解析 roomId / uniqueId
    const room = await resolveRoomInfo(roomId)
    this.log('resolved', { roomId: room.roomId, webRid: room.webRid, title: room.title })

    // 2. 算签名（先拼一个无 signature 的 wss URL 作为入参，算出 X-Bogus 再拼回完整 URL）
    let signature: SignatureResult
    try {
      const stubUrl = buildWsUrl(room, { signature: '' }, this.wsHost)
      signature = await this.sig(stubUrl)
    } catch (err) {
      throw new Error(
        `[douyin] signature fetch failed: ${(err as Error).message}. ` +
          `Pass signatureImpl to createDouyinSource() if you want a custom fetcher.`,
      )
    }

    // 3. 打开 ws（带 3 次重试 / 指数退避）
    const MAX_RETRIES = 3
    let attempt = 0
    let lastError: Error | null = null
    while (attempt <= MAX_RETRIES) {
      try {
        await this.openOnce(room, signature, onItem, signal)
        break
      } catch (err) {
        lastError = err as Error
        attempt += 1
        if (attempt > MAX_RETRIES) break
        const backoff = 500 * Math.pow(2, attempt - 1) // 500, 1000, 2000
        this.log(`retry ${attempt}/${MAX_RETRIES} in ${backoff}ms: ${(err as Error).message}`)
        await new Promise((r) => setTimeout(r, backoff))
        if (signal?.aborted) break
      }
    }

    if (attempt > MAX_RETRIES && lastError) {
      throw new Error(
        `[douyin] failed to connect after ${MAX_RETRIES} retries: ${lastError.message}`,
      )
    }

    // 4. 返回 stop 句柄
    return {
      stop: async () => {
        await this.closeSession()
      },
    }
  }

  /**
   * edge-forward 模式：sign-server 已在浏览器侧开 wss 并抓帧解码，
   * 这里只负责轮询 sign-server 暴露的 danmaku buffer（GET /api/danmaku/:roomId）。
   *
   * 不调用 signatureFetcher、不开 Node ws，因此不踩 cookie/signature 校验的坑。
   */
  private async subscribeEdgeForward(opts: SubscribeOpts): Promise<DanmakuSubscription> {
    if (!this.signServerUrl) {
      throw new Error('[douyin/edge-forward] signServerUrl required in DouyinSourceDeps')
    }
    if (this.edgeForwardPoller) {
      clearInterval(this.edgeForwardPoller)
      this.edgeForwardPoller = null
    }

    const { roomId, onItem, signal } = opts

    // resolveRoomInfo 内部走 /api/resolve → sign-server 已开 Edge 页面 + 启动 ws tap
    const room = await resolveRoomInfo(roomId)
    this.log('edge-forward resolved', { roomId: room.roomId, webRid: room.webRid })

    const pollUrl = new URL(`/api/danmaku/${room.roomId}?max=20`, this.signServerUrl)
    let stopped = false
    const cleanups: Array<() => void> = []

    if (signal) {
      if (signal.aborted) {
        return { stop: async () => {} }
      }
      const onAbort = () => { stopped = true }
      signal.addEventListener('abort', onAbort, { once: true })
      cleanups.push(() => signal.removeEventListener('abort', onAbort))
    }

    // AbortController 让 stop() 能立刻取消正在 in-flight 的 fetch，而不是等服务器响应。
    const ctrl = new AbortController()
    if (signal) {
      const onSignalAbort = () => ctrl.abort()
      signal.addEventListener('abort', onSignalAbort, { once: true })
      cleanups.push(() => signal.removeEventListener('abort', onSignalAbort))
    }
    cleanups.push(() => ctrl.abort())

    const interval = setInterval(async () => {
      if (stopped) return
      try {
        const resp = await fetch(pollUrl.toString(), { signal: ctrl.signal })
        if (!resp.ok) return
        const data = (await resp.json()) as { danmaku: DecodedDanmaku[] }
        for (const item of data.danmaku) {
          if (stopped) break
          try {
            onItem({ ...item, source: 'douyin' } as DanmakuItem)
          } catch (err) {
            this.log('onItem threw', (err as Error).message)
          }
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        this.log('poll failed', (err as Error).message)
      }
    }, this.pollIntervalMs)
    this.edgeForwardPoller = interval
    cleanups.push(() => {
      clearInterval(interval)
      if (this.edgeForwardPoller === interval) this.edgeForwardPoller = null
    })

    return {
      stop: async () => {
        stopped = true
        for (const fn of cleanups) fn()
      },
    }
  }

  private async openOnce(
    room: ResolvedRoom,
    signature: SignatureResult,
    onItem: (item: DanmakuItem) => void,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const url = buildWsUrl(room, signature, this.wsHost)
    this.log('connecting', url.slice(0, 96) + '…')

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url, {
        perMessageDeflate: false,
        headers: {
          cookie: `ttwid=${room.ttwid}`,
          'user-agent': USER_AGENT,
        },
      })
      this.session = { ws, pingTimer: null, closed: false }

      const cleanup = () => {
        if (this.session?.pingTimer) {
          clearInterval(this.session.pingTimer)
          this.session.pingTimer = null
        }
      }

      const onAbort = () => {
        this.log('aborted by caller')
        try {
          ws.close(1000, 'client-abort')
        } catch {
          /* noop */
        }
      }
      if (signal) {
        if (signal.aborted) {
          ws.close(1000, 'client-abort')
          reject(new Error('aborted before connect'))
          return
        }
        signal.addEventListener('abort', onAbort, { once: true })
      }

      const handleMessage = (raw: WebSocket.RawData, isBinary: boolean) => {
        this.log(`ws frame: binary=${isBinary}, len=${(raw as Buffer).length}`)
        if (!isBinary) return
        try {
          const buf = raw instanceof Buffer ? raw : Buffer.from(raw as ArrayBuffer)
          const { messages, needAck, logId, internalExt } = decodeFrameWithAck(buf)
          this.log(`decoded ${messages.length} messages: [${messages.map((m) => m.method).join(',')}]; needAck=${needAck}`)
          let chatCount = 0
          for (const m of messages) {
            try {
              const item = messageToItem(m)
              if (item) {
                chatCount++
                onItem({ ...item, source: 'douyin' } as DanmakuItem)
              }
            } catch (err) {
              this.log(
                `message decode failed (method=${m.method}):`,
                (err as Error).message,
              )
            }
          }
          if (chatCount > 0) {
            this.log(`delivered ${chatCount} chat items out of ${messages.length} messages`)
          }
          // 回 ack — 抖音要求 client 在 needAck=true 时回 PushFrame{logId, payloadType:'ack', payload:internalExt}。
          // 不回 ack，服务侧扣消息（看不到 WebcastChatMessage 实时弹幕）后 close 1006。
          if (needAck) {
            try {
              const ackPayload = internalExt ? Buffer.from(internalExt, 'utf-8') : Buffer.alloc(0)
              const ack = logId !== undefined
                ? PushFrame.create({
                    logId,
                    payloadType: 'ack',
                    payload: ackPayload,
                  })
                : PushFrame.create({
                    payloadType: 'ack',
                    payload: ackPayload,
                  })
              const bytes = PushFrame.encode(ack).finish()
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(Buffer.from(bytes))
                this.log(`sent ack (logId=${logId}, internalExt=${internalExt?.slice(0, 32)}…)`)
              }
            } catch (err) {
              this.log('ack send failed:', (err as Error).message)
            }
          }
        } catch (err) {
          this.log('frame decode failed:', (err as Error).message)
        }
      }

      const connectionTimeout = setTimeout(() => {
        try { ws.close(1000, 'open-timeout') } catch { /* noop */ }
        reject(new Error(`ws open timeout after 15s`))
      }, 15_000)

      ws.on('open', () => {
        this.log('ws open')
        clearTimeout(connectionTimeout)
        // 心跳：每 5s 发一帧 PushFrame{ payloadType:'hb' }
        const sess = this.session
        if (sess) {
          sess.pingTimer = setInterval(() => {
            try {
              const hb = PushFrame.create({ payloadType: 'hb' })
              const bytes = PushFrame.encode(hb).finish()
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(Buffer.from(bytes))
              }
            } catch (err) {
              this.log('heartbeat send failed:', (err as Error).message)
            }
          }, 5000)
        }
        resolve()
      })

      ws.on('message', handleMessage)

      ws.on('error', (err) => {
        this.log('ws error:', err.message)
        clearTimeout(connectionTimeout)
        reject(err)
      })

      ws.on('close', (code, reason) => {
        this.log('ws close', code, String(reason))
        clearTimeout(connectionTimeout)
        cleanup()
        if (signal) signal.removeEventListener('abort', onAbort)
        // 注意：这里不主动 reject；open 之后的 close 是「正常结束」
      })
    })
  }

  private async closeSession(): Promise<void> {
    const sess = this.session
    if (!sess) return
    sess.closed = true
    if (sess.pingTimer) {
      clearInterval(sess.pingTimer)
      sess.pingTimer = null
    }
    await new Promise<void>((resolve) => {
      try {
        sess.ws.once('close', () => resolve())
        if (
          sess.ws.readyState === WebSocket.OPEN ||
          sess.ws.readyState === WebSocket.CONNECTING
        ) {
          sess.ws.close(1000, 'client-stop')
        } else {
          resolve()
        }
      } catch {
        resolve()
      }
    })
    this.session = null
  }
}

export function createDouyinSource(deps?: DouyinSourceDeps): DouyinSource {
  return new DouyinSource(deps)
}

// 显式暴露给测试脚本的子模块
export { buildWsUrl, decodeFrame, messageToItem }
export { resolveRoomInfo } from './roomInfo'
export { Message }
export type { SignatureFetcher } from './signature'
export { createNodeSignatureStub, createRemoteSignatureFetcher, createFakeSignature } from './signature'