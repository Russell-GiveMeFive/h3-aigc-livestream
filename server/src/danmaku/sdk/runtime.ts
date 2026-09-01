/**
 * Node 端抖音 webmssdk 运行时
 *
 * 复刻 DouyinLiveWebFetcher/liveMan.py 的 generateSignature 逻辑：
 *   - 在 Node `vm` 沙箱里跑 webmssdk.js + sign.js（沙箱内 shim window/document/navigator）
 *   - sign.js 顶层定义 `get_sign(md5_param)`，内部调用 `crawler({"X-MS-STUB": md5})["X-Bogus"]`
 *   - Python 用 MiniRacer，我们用 Node 内置 vm — 同样的 JS 代码，同样的算法
 *
 * 上层只暴露一个语义：`X-Bogus = getXbogusFromWssUrl(wssUrl)`
 *   - 入参：拼好的 wss URL（带 room_id/user_unique_id 等 query，但不必带 signature）
 *   - 出参：X-Bogus 字符串（当前版本固定 16 字符 base64-urlsafe 形式）
 *   - 缓存：MD5(参数串) -> X-Bogus 进程级缓存，避免重复计算
 */

import vm from 'node:vm'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const SIGN_JS_PATH = path.join(__dirname, 'sign.js')
const WEBMS_SDK_PATH = path.join(__dirname, 'webmssdk.js')

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

/**
 * 抖音 wss URL 签名所需 query 字段（顺序与 Python liveMan.generateSignature 一致）：
 *   live_id, aid, version_code, webcast_sdk_version,
 *   room_id, sub_room_id, sub_channel_id, did_rule,
 *   user_unique_id, device_platform, device_type, ac, identity
 * 拼成 "k=v,k=v,..."，做 MD5 → get_sign 的入参。
 */
const SIGN_PARAMS_ORDER = [
  'live_id',
  'aid',
  'version_code',
  'webcast_sdk_version',
  'room_id',
  'sub_room_id',
  'sub_channel_id',
  'did_rule',
  'user_unique_id',
  'device_platform',
  'device_type',
  'ac',
  'identity',
] as const

export function md5OfWssParams(wssUrl: string): string {
  const u = new URL(wssUrl)
  const params = u.searchParams
  const tpl = SIGN_PARAMS_ORDER.map((k) => `${k}=${params.get(k) ?? ''}`).join(',')
  return createHash('md5').update(tpl).digest('hex')
}

interface SandboxGlobals {
  window: Record<string, unknown>
  document: Record<string, unknown>
  navigator: { userAgent: string }
  self: Record<string, unknown>
  location: URL
}

function buildSandbox(): vm.Context {
  const sandbox: SandboxGlobals = {
    window: {},
    document: {},
    navigator: { userAgent: USER_AGENT },
    self: {},
    location: new URL('https://live.douyin.com/'),
  }
  sandbox.self = sandbox.window
  return vm.createContext(sandbox)
}

interface WebmsSdkRuntime {
  /** 给一个 wss URL（不带 signature），返回 X-Bogus */
  getXbogusFromWssUrl(wssUrl: string): string
  /** 直接传 MD5(参数串)，返回 X-Bogus（get_sign 入口） */
  computeXbogusFromMd5(md5Param: string): string
}

let cachedRuntime: WebmsSdkRuntime | null = null

export function getWebmsSdkRuntime(): WebmsSdkRuntime {
  if (cachedRuntime) return cachedRuntime

  const context = buildSandbox()
  const signJsCode = fs.readFileSync(SIGN_JS_PATH, 'utf8')
  const webmsSdkCode = fs.readFileSync(WEBMS_SDK_PATH, 'utf8')

  // sign.js 顶层用 `document = {}` 这种赋值，需要非 strict 沙箱
  vm.runInContext(signJsCode, context, { filename: 'sign.js' })
  vm.runInContext(webmsSdkCode, context, { filename: 'webmssdk.js' })

  const getSign = (context as unknown as { get_sign?: (md5: string) => string }).get_sign
  if (typeof getSign !== 'function') {
    throw new Error('[sdk/runtime] sign.js did not expose get_sign()')
  }

  const md5Cache = new Map<string, string>()
  cachedRuntime = {
    getXbogusFromWssUrl(wssUrl: string): string {
      const md5 = md5OfWssParams(wssUrl)
      const cached = md5Cache.get(md5)
      if (cached) return cached
      const xb = getSign(md5)
      md5Cache.set(md5, xb)
      return xb
    },
    computeXbogusFromMd5(md5Param: string): string {
      const cached = md5Cache.get(md5Param)
      if (cached) return cached
      const xb = getSign(md5Param)
      md5Cache.set(md5Param, xb)
      return xb
    },
  }
  return cachedRuntime
}