/**
 * 抖音 wss signature 计算
 *
 * 方案：
 *   1) `createNodeSignatureFetcher()` — 默认：在 Node `vm` 沙箱里跑 webmssdk.js
 *      （从 DouyinLiveWebFetcher 项目拷过来的真字节码），调 frontierSign 算 X-Bogus。
 *      纯 Node，不需要浏览器、不需要 sign-server。
 *   2) `createRemoteSignatureFetcher(endpoint)` — 远程 fallback：把 (roomId, uniqueId)
 *      发给一个本地 sign-server（如果你不想用 Node vm 跑 SDK、想留 escape hatch）。
 *   3) `createFakeSignature(value)` — 测试用，永远返回同一个假签名。
 *
 * 注：上层调用方 douyin.ts 现在传进来的是已经拼好的完整 wss URL，
 *     但旧接口 (roomId, uniqueId) 仍然兼容 —— 我们内部先把 wss URL 拼好。
 *     见 douyin.ts 里改用 fetcher(wssUrl) 形态。
 */

import { getWebmsSdkRuntime } from './sdk/runtime'

export interface SignatureResult {
  /** 抖音 X-Bogus（aka 'signature' query） */
  signature: string
  /** 调试用：md5 之类的中间值，便于排查 */
  debug?: Record<string, string>
}

/**
 * 旧接口：仅给定 roomId + uniqueId 也能算签名（自动拼默认 wss URL 模板）。
 * 实际新代码都改用 fetcher(wssUrl) —— 见下方 WssSignatureFetcher。
 */
export interface SignatureFetcher {
  (roomId: string, uniqueId: string): Promise<SignatureResult>
}

/** 新接口：传完整 wss URL 进来算 X-Bogus（更精确；参数顺序跟服务端校验一致） */
export interface WssSignatureFetcher {
  (wssUrl: string): Promise<SignatureResult>
}

/** 默认实现：在 Node vm 里跑 webmssdk.js 算签名 */
export const createNodeSignatureFetcher = (): WssSignatureFetcher => {
  return async (wssUrl: string): Promise<SignatureResult> => {
    const runtime = getWebmsSdkRuntime()
    const signature = runtime.getXbogusFromWssUrl(wssUrl)
    return { signature }
  }
}

/** 默认 fetcher —— 走 Node vm，跟老接口 (roomId, uniqueId) 对齐 */
export const createNodeSignatureStub = (): SignatureFetcher => {
  // 行为兼容：内部转成 wssUrl 形态
  // 注：douyin.ts 已改用 fetcher(wssUrl)，这个工厂保留是为了不破坏其它潜在调用方
  const fetcher = createNodeSignatureFetcher()
  return async (roomId: string, uniqueId: string) => {
    // 临时拼一个最小 wss URL（参数顺序与 DouyinLiveWebFetcher generateSignature 一致）
    const u = new URL('wss://webcast100-ws-web-lq.douyin.com/webcast/im/push/v2/')
    u.searchParams.set('live_id', '1')
    u.searchParams.set('aid', '6383')
    u.searchParams.set('version_code', '180800')
    u.searchParams.set('webcast_sdk_version', '1.0.14-beta.0')
    u.searchParams.set('room_id', roomId)
    u.searchParams.set('user_unique_id', uniqueId)
    u.searchParams.set('device_platform', 'web')
    u.searchParams.set('identity', 'audience')
    return fetcher(u.toString())
  }
}

/** 远程 fetcher：把 (roomId, uniqueId) 发给一个本地 sign-server */
export const createRemoteSignatureFetcher = (endpoint: string): SignatureFetcher => {
  return async (roomId, uniqueId) => {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ roomId, uniqueId }),
    })
    if (!resp.ok) {
      throw new Error(`[douyin/signature] remote fetcher ${endpoint} returned ${resp.status}`)
    }
    const json = (await resp.json()) as Partial<SignatureResult>
    if (!json.signature) {
      throw new Error(`[douyin/signature] remote fetcher ${endpoint} did not return 'signature'`)
    }
    return { signature: json.signature }
  }
}

/** 测试用：永远返回同一个假签名 */
export const createFakeSignature = (value = 'FAKE_DEVELOPMENT_SIGNATURE'): SignatureFetcher => {
  return async () => ({ signature: value })
}