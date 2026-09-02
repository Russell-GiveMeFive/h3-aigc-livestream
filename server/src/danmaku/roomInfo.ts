/**
 * 房间信息解析（纯 Node，参考 DouyinLiveWebFetcher/liveMan.py）
 *
 * 数据通路：
 *   1) GET https://live.douyin.com/                 → 拿 ttwid cookie
 *   2) GET https://live.douyin.com/<webRid>         → 拿响应 Set-Cookie 中的 __ac_nonce
 *   3) 用 acSignature.getAcSignature() 算 __ac_signature
 *   4) 再 GET live 页，带完整 cookie                → 响应 HTML 里抠 roomId
 *      - regex:  roomId\\":\\"(\d+)\\"
 *
 * 不依赖 sign-server、不依赖浏览器。
 *
 * 兼容三种输入：
 *   - 纯 webRid / roomId（数字字符串，如 "10776146386"）
 *   - 完整 URL（"https://live.douyin.com/10776146386"）
 */

import { getAcSignature } from './sdk/acSignature'

export interface ResolvedRoom {
  /** im 系统内部数字房间号（发往 wss 的 room_id） */
  roomId: string
  /** 浏览器/匿名用户唯一 id（wss URL 中的 user_unique_id + wss_push_did） */
  uniqueId: string
  /** 抖音下发的 ttwid cookie — wss 升级请求要带回去 */
  ttwid: string
  /** 短号（URL 中可写的 10776146386） */
  webRid: string
  /** 直播间标题（可选，调试用） */
  title?: string
  /** 主播头像（可选） */
  avatar?: string
}

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const HEADERS = {
  'user-agent': USER_AGENT,
  accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
}

const LIVE_HOME = 'https://live.douyin.com/'
const MS_TOKEN_LEN = 182
const MS_TOKEN_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

const NONCE_FALLBACK = '0123407cc00a9e438deb4'

const FETCH_TIMEOUT_MS = 10_000

function normalizeInput(input: string): string {
  const trimmed = input.trim()
  const urlMatch = trimmed.match(/live\.douyin\.com\/(\w+)/i)
  if (urlMatch) return urlMatch[1]
  return trimmed
}

function generateMsToken(length = MS_TOKEN_LEN): string {
  let s = ''
  const alphabetLen = MS_TOKEN_ALPHABET.length
  for (let i = 0; i < length; i++) {
    s += MS_TOKEN_ALPHABET[Math.floor(Math.random() * alphabetLen)]
  }
  return s
}

function randomUniqueId(): string {
  // 19 位数字字符串，模拟 webRid 用户唯一 id（不够准但够过抖音校验）。
  // 真实用浏览器的话从 page state.userStore.odin.user_unique_id 抠。
  // 这里用固定值兜底，抖音 wss 不强校验这个字段，只要签名 + ttwid 有效即可。
  return '7319483754668557238'
}

function parseCookies(setCookieHeaders: string[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const sc of setCookieHeaders) {
    const first = sc.split(';')[0]
    const eq = first.indexOf('=')
    if (eq > 0) {
      out.set(first.slice(0, eq).trim(), first.slice(eq + 1).trim())
    }
  }
  return out
}

function cookieMapToString(m: Map<string, string>): string {
  return Array.from(m.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: ac.signal })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 解析房间信息。失败时抛出（调用方决定是否降级 / fallback）。
 */
export async function resolveRoomInfo(
  roomIdOrUrl: string,
): Promise<ResolvedRoom> {
  const webRid = normalizeInput(roomIdOrUrl)
  console.log(`[douyin/roomInfo] resolving webRid=${webRid}`)

  // 1. 拿 ttwid cookie
  const homeResp = await fetchWithTimeout(LIVE_HOME, { headers: HEADERS })
  if (!homeResp.ok) {
    throw new Error(`[douyin/roomInfo] GET ${LIVE_HOME} → HTTP ${homeResp.status}`)
  }
  const homeCookies = parseCookies(homeResp.headers.getSetCookie?.() ?? [])
  const ttwid = homeCookies.get('ttwid')
  if (!ttwid) {
    throw new Error('[douyin/roomInfo] ttwid cookie not set by home page')
  }
  console.log(`[douyin/roomInfo] got ttwid=${ttwid.slice(0, 16)}...`)

  // 2. 第一次拉直播页（带 ttwid + msToken + 假 __ac_nonce），从响应里抠真 nonce
  const msToken = generateMsToken()
  const cookieHeader1 =
    `ttwid=${ttwid}; msToken=${msToken}; __ac_nonce=${NONCE_FALLBACK}`
  const pageResp1 = await fetchWithTimeout(
    `${LIVE_HOME}${webRid}`,
    { headers: { ...HEADERS, cookie: cookieHeader1 } },
  )
  if (!pageResp1.ok) {
    throw new Error(
      `[douyin/roomInfo] GET live page (1st) → HTTP ${pageResp1.status}`,
    )
  }
  const resp1Cookies = parseCookies(pageResp1.headers.getSetCookie?.() ?? [])
  const acNonce = resp1Cookies.get('__ac_nonce') ?? NONCE_FALLBACK

  // 3. 用真实 nonce 算 __ac_signature
  const acSignature = getAcSignature(
    'www.douyin.com/',
    acNonce,
    USER_AGENT,
  )

  // 4. 第二次拉直播页，带完整 cookie 头
  const fullCookie = cookieMapToString(
    new Map([
      ['ttwid', ttwid],
      ['msToken', msToken],
      ['__ac_nonce', acNonce],
      ['__ac_signature', acSignature],
    ]),
  )
  const pageResp2 = await fetchWithTimeout(
    `${LIVE_HOME}${webRid}`,
    { headers: { ...HEADERS, cookie: fullCookie } },
  )
  if (!pageResp2.ok) {
    throw new Error(
      `[douyin/roomInfo] GET live page (2nd) → HTTP ${pageResp2.status}`,
    )
  }
  const html = await pageResp2.text()
  console.log(
    `[douyin/roomInfo] live page HTML len=${html.length}, scanning for roomId...`,
  )

  // 5. 正则抠 roomId — 用最后一次匹配，因为真实 roomId 在 renderData state JSON（页面靠后）。
  // 第一次匹配可能是注释/JSON 示例里的占位数字。
  const matches = [...html.matchAll(/roomId\\":\\"(\d+)\\"/g)]
  if (!matches.length) {
    throw new Error(
      '[douyin/roomInfo] roomId not found in live page HTML ' +
        `(webRid=${webRid}, html head: ${html.slice(0, 200)})`,
    )
  }
  const roomId = matches[matches.length - 1]![1]!

  // 6. uniqueId 抖音不返回就生成一个（wss 不强校验，与 dycast 行为一致）
  const uniqueId = randomUniqueId()

  // 7. 提取标题（可选）
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
  const title = titleMatch ? titleMatch[1].trim() : undefined

  console.log(
    `[douyin/roomInfo] resolved: roomId=${roomId}, webRid=${webRid}, title=${title ?? '(none)'}`,
  )

  return {
    roomId,
    uniqueId,
    ttwid,
    webRid,
    title,
  }
}
