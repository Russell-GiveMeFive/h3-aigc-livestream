/**
 * 抖音弹幕 protobuf 解码（共用模块，被 server/douyin.ts 和 scripts/dycast-sign-server.ts 复用）
 *
 * 不从 @h3/protocol/types 直接导入 — 让 sign-server（scripts/）无需解析 shared/ 路径别名。
 * 返回的 DecodedDanmaku 与 shared/types.ts 的 DanmakuItem 结构完全一致（TS 结构兼容）。
 */

import { gunzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import {
  PushFrame,
  Response,
  ChatMessage,
  MemberMessage,
  LikeMessage,
  SocialMessage,
  GiftMessage,
  RoomUserSeqMessage,
} from './proto'

export interface DecodedMessage {
  method: string
  payload: Uint8Array
}

/** 与 shared/types.ts DanmakuItem 结构对齐，但用宽松 string 作 source，便于 scripts/ 复用 */
export interface DecodedDanmaku {
  id: string
  user: string
  text: string
  ts: number
  source: string
  relevance?: number
  relevant?: boolean
}

export interface DecodedFrame {
  messages: DecodedMessage[]
  /** 抖音侧要求回 ack；不 ack 服务侧会扣消息后 close 1006 */
  needAck: boolean
  /** PushFrame.logId — 回 ack 时透传 */
  logId?: string
  /** Response.internalExt — 回 ack 时原样塞 payload */
  internalExt?: string
}

export function decodeFrameWithAck(buf: Uint8Array): DecodedFrame {
  const frame = PushFrame.decode(buf) as any
  const payloadBytes: Uint8Array = frame.payload ?? new Uint8Array(0)
  // 抖音的 payloadEncoding 字段可能是 "gzip" / "pb" / "plain" 等；
  // headersList 里 `compress_type: gzip` 才是真实压缩标志。
  // 不论 encoding 怎么标，只要首字节是 gzip magic (0x1f 0x8b) 就解压。
  const isGzip =
    payloadBytes[0] === 0x1f &&
    payloadBytes[1] === 0x8b
  const payload = isGzip ? gunzipSync(payloadBytes) : payloadBytes

  const res = Response.decode(payload) as any
  const messagesList: any[] = res.messagesList ?? []

  const messages: DecodedMessage[] = messagesList
    .filter((m: any) => m && m.method)
    .map((m: any) => ({
      method: String(m.method),
      payload: m.payload ?? new Uint8Array(0),
    }))

  // logId protobufjs 大数会用 Long/string 表示，统一转字符串避免后续类型坑
  const rawLogId = frame.logId
  const logId =
    rawLogId === undefined || rawLogId === null || rawLogId === 0
      ? undefined
      : typeof rawLogId === 'string'
        ? rawLogId
        : String(rawLogId)

  return {
    messages,
    needAck: Boolean(res.needAck),
    logId,
    internalExt: res.internalExt ? String(res.internalExt) : undefined,
  }
}

export function decodeFrame(buf: Uint8Array): DecodedMessage[] {
  return decodeFrameWithAck(buf).messages
}

function readVarint(buf: Uint8Array, start: number): { value: number; next: number } {
  let value = 0
  let shift = 0
  let i = start
  while (i < buf.length) {
    const b = buf[i]
    if (b === undefined) return { value: 0, next: -1 }
    value |= (b & 0x7f) << shift
    i++
    if ((b & 0x80) === 0) return { value: value >>> 0, next: i }
    shift += 7
    if (shift >= 32) return { value: 0, next: -1 }
  }
  return { value: 0, next: -1 }
}

function skipVarint(buf: Uint8Array, start: number): { next: number } {
  let i = start
  while (i < buf.length) {
    const b = buf[i]
    if (b === undefined) return { next: -1 }
    i++
    if ((b & 0x80) === 0) return { next: i }
  }
  return { next: -1 }
}

function stableId(ts: number, user: string, content: string): string {
  const h = createHash('sha1').update(`${user}|${content}`).digest('hex').slice(0, 12)
  return `${ts}-${h}`
}

export function messageToItem(message: DecodedMessage): DecodedDanmaku | null {
  const { method, payload } = message
  const ts = Date.now()
  // 从 ChatMessage payload 抓 content (field 3)。迭代顶层 fields，对 schema 顺序稳定。
  // protobufjs 解嵌套消息失败（schema 没列全字段）时使用。
  const tryPlainDecode = (): string | null => {
    let i = 0
    let content: string | null = null
    while (i < payload.length) {
      const { value: tag, next: afterTag } = readVarint(payload, i)
      if (afterTag < 0) break
      i = afterTag
      const fieldNum = tag >> 3
      const wireType = tag & 0x7
      if (wireType === 2) {
        const { value: len, next: lenEnd } = readVarint(payload, i)
        if (lenEnd < 0 || len > payload.length - lenEnd) return content
        if (fieldNum === 3) {
          try {
            content = new TextDecoder('utf-8').decode(payload.slice(lenEnd, lenEnd + len))
          } catch {
            /* keep previous content */
          }
        }
        i = lenEnd + len
      } else if (wireType === 0) {
        const { next } = skipVarint(payload, i)
        if (next < 0) return content
        i = next
      } else if (wireType === 1) {
        i += 8
      } else if (wireType === 5) {
        i += 4
      } else {
        // unknown wire type — return whatever we've decoded so far
        return content
      }
    }
    return content
  }

  // 从 ChatMessage payload 抓 User.nickName (User.field 3 = string)。
  // 同样假设字段布局 common(1)/user(2)/content(3)。
  const tryPlainDecodeUser = (buf: Uint8Array): string | null => {
    if (buf[0] !== 0x0a) return null
    let i = 1
    const { value: cLen, next: afterCommon } = readVarint(buf, i)
    if (afterCommon < 0 || cLen > buf.length - afterCommon) return null
    i = afterCommon + cLen
    if (i >= buf.length || buf[i] !== 0x12) return null
    i++
    const { value: uLen, next: afterUser } = readVarint(buf, i)
    if (afterUser < 0 || uLen > buf.length - afterUser) return null
    const userStart = afterUser
    const userEnd = afterUser + uLen
    // 在 User 子消息里找 field 3 (nickName) — wire type 2 (length-delimited string)
    let j = userStart
    while (j < userEnd) {
      const tag = buf[j]
      if (tag === undefined) break
      const fieldNum = tag >> 3
      const wireType = tag & 0x7
      j++
      if (wireType === 0) {
        const { next } = skipVarint(buf, j)
        if (next < 0) return null
        j = next
      } else if (wireType === 1) {
        j += 8
      } else if (wireType === 2) {
        const { value: len, next: lenEnd } = readVarint(buf, j)
        if (lenEnd < 0 || len > buf.length - lenEnd) return null
        const bytes = buf.slice(lenEnd, lenEnd + len)
        j = lenEnd + len
        if (fieldNum === 3) {
          try {
            const t = new TextDecoder('utf-8').decode(bytes).trim()
            if (t.length > 0 && t.length < 100) return t
          } catch {
            /* ignore */
          }
        }
      } else if (wireType === 5) {
        j += 4
      } else {
        // unknown wire type (3/4/6/7) — stop scanning, return whatever we've found
        break
      }
    }
    return null
  }
  switch (method) {
    case 'WebcastChatMessage': {
      let user = '匿名'
      let content = ''
      try {
        const m = ChatMessage.decode(payload) as any
        user = String(m.user?.nickName ?? '匿名')
        content = String(m.content ?? '')
      } catch {
        // protobufjs 解嵌套消息失败（schema 没列全字段） → 手解 payload 抓 content (field 3)
        // field 2 是 User 嵌套消息，field 3 nickName 是 wire type 2 (length-delimited string)
        const userFallback = tryPlainDecodeUser(payload)
        if (userFallback) user = userFallback
        const contentFallback = tryPlainDecode()
        if (contentFallback) content = contentFallback
      }
      if (!content) return null
      return {
        id: stableId(ts, user, content),
        user,
        text: content,
        ts,
        source: 'douyin',
      }
    }
    case 'WebcastMemberMessage': {
      const m = MemberMessage.decode(payload) as any
      const user = String(m.user?.nickName ?? '匿名')
      return {
        id: stableId(ts, user, 'join'),
        user,
        text: '来了',
        ts,
        source: 'douyin',
      }
    }
    case 'WebcastLikeMessage': {
      const m = LikeMessage.decode(payload) as any
      const user = String(m.user?.nickName ?? '匿名')
      return {
        id: stableId(ts, user, 'like'),
        user,
        text: '为主播点赞了',
        ts,
        source: 'douyin',
      }
    }
    case 'WebcastSocialMessage': {
      const m = SocialMessage.decode(payload) as any
      const user = String(m.user?.nickName ?? '匿名')
      return {
        id: stableId(ts, user, 'follow'),
        user,
        text: '关注了主播',
        ts,
        source: 'douyin',
      }
    }
    case 'WebcastGiftMessage': {
      const m = GiftMessage.decode(payload) as any
      const user = String(m.user?.nickName ?? '匿名')
      const giftName = String(m.gift?.name ?? '礼物')
      const describe = String(m.common?.describe ?? '')
      const text = describe || `送出了 ${giftName}`
      return {
        id: stableId(ts, user, `gift:${giftName}`),
        user,
        text,
        ts,
        source: 'douyin',
      }
    }
    case 'WebcastRoomUserSeqMessage': {
      // 房间统计类消息，不属于个体弹幕，跳过
      return null
    }
    default:
      return null
  }
}